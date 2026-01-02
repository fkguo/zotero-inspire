import { config } from "../../../package.json";
import { extractArxivIdFromItem } from "./preprintWatchService";
import { LRUCache } from "./utils";
import { getPref } from "../../utils/prefs";

type MaybePromise<T> = T | Promise<T>;

// Use stable, hyphen-free keys for compatibility with Zotero 8's virtualized
// table column resize implementation. (It parses generated CSS rules by the
// first '-' in the selector, so any hyphen inside `dataKey` breaks resizing.)
const CITES_COLUMN_KEY = "zinspireCites";
const ARXIV_COLUMN_KEY = "zinspireArxiv";
// Intentionally left empty to prevent Zotero from namespacing/escaping the
// `dataKey` (which would introduce '-' and break resize).
const ITEM_TREE_COLUMNS_PLUGIN_ID = "";

const CITES_SORT_PAD = 10;
const ARXIV_SORT_PAD = 5;
const SORT_DISPLAY_SEPARATOR = "\t";

type CachedValue = { signature: string; value: string };
const citesValueCache = new LRUCache<string, CachedValue>(4000);
const arxivValueCache = new LRUCache<string, CachedValue>(4000);

let registeredColumnKeys: string[] = [];
let columnsRegistered = false;

export function refreshInspireItemTreeColumns(clearCaches = true): void {
  if (clearCaches) {
    citesValueCache.clear();
    arxivValueCache.clear();
  }

  // For column data changes (not column definitions), Zotero caches row data in
  // the ItemTree view. Force a redraw by clearing its row cache, so our
  // dataProvider() runs again with the new preference value.
  let invalidated = false;
  try {
    const panes: any[] = [];
    try {
      const activePane = Zotero.getActiveZoteroPane?.();
      if (activePane) panes.push(activePane);
    } catch {
      // Ignore active pane lookup errors
    }
    try {
      const allPanes = Zotero.getZoteroPanes?.() as any[] | undefined;
      if (Array.isArray(allPanes)) panes.push(...allPanes);
    } catch {
      // Ignore pane enumeration errors
    }

    const seen = new Set<any>();
    for (const pane of panes) {
      const itemsView = pane?.itemsView as any;
      if (!itemsView || seen.has(itemsView)) continue;
      seen.add(itemsView);

      const tree = itemsView.tree;
      if (typeof tree?.invalidate !== "function") continue;

      const rowCache = itemsView._rowCache;
      if (rowCache && typeof rowCache.clear === "function") {
        rowCache.clear();
      } else {
        itemsView._rowCache = {};
      }
      tree.invalidate();
      invalidated = true;
    }
  } catch {
    // Ignore refresh errors
  }

  if (!invalidated) {
    const manager = (Zotero as any).ItemTreeManager as
      | _ZoteroTypes.ItemTreeManager
      | undefined;
    manager?.refreshColumns?.();
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function getItemCacheKey(item: Zotero.Item): string {
  const libraryID = (item as any).libraryID;
  const id = (item as any).id;
  return `${libraryID ?? "?"}:${id ?? "?"}`;
}

function getCitesExcludeSelfPref(): boolean {
  try {
    return Boolean(getPref("cites_column_exclude_self"));
  } catch {
    return false;
  }
}

function parseInspireCitationsFromExtra(
  extra: string,
  excludeSelfCitations: boolean,
): number | null {
  if (!extra) {
    return null;
  }

  // Prefer INSPIRE citation lines from Extra; fallback to any "X citations (...)" line.
  let withSelfInspire: number | null = null;
  let withoutSelfInspire: number | null = null;
  let withSelfFallback: number | null = null;
  let withoutSelfFallback: number | null = null;
  const lines = extra.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    const match = line.match(/^(\d+)\s+citations\b.*$/i);
    if (!match) continue;
    const count = Number.parseInt(match[1], 10);
    if (!Number.isFinite(count)) continue;

    const isWithoutSelf =
      /\bw\/o\s+self\b/i.test(line) || /\bwithout\s+self\b/i.test(line);
    const isInspire = /\(INSPIRE\b/i.test(line);
    if (isWithoutSelf) {
      if (isInspire) {
        withoutSelfInspire ??= count;
      } else {
        withoutSelfFallback ??= count;
      }
    } else {
      if (isInspire) {
        withSelfInspire ??= count;
      } else {
        withSelfFallback ??= count;
      }
    }
  }

  const primary = excludeSelfCitations
    ? withoutSelfInspire ?? withoutSelfFallback
    : withSelfInspire ?? withSelfFallback;
  if (typeof primary === "number") {
    return primary;
  }

  // Older/partial data: fall back to whichever count is available.
  return (
    withSelfInspire ??
    withSelfFallback ??
    withoutSelfInspire ??
    withoutSelfFallback
  );
}

function padNumericSortKey(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "";
  }
  const raw = String(Math.trunc(value));
  if (raw.length >= CITES_SORT_PAD) {
    return raw;
  }
  return raw.padStart(CITES_SORT_PAD, "0");
}

function displayNumericSortKey(padded: string): string {
  if (!padded) return "";
  const trimmed = padded.replace(/^0+/, "");
  return trimmed || "0";
}

function decodeSortDisplayValue(value: string): { sortKey: string; display: string } {
  const idx = value.indexOf(SORT_DISPLAY_SEPARATOR);
  if (idx === -1) {
    return { sortKey: value, display: value };
  }
  return { sortKey: value.slice(0, idx), display: value.slice(idx + 1) };
}

function encodeSortDisplayValue(sortKey: string, display: string): string {
  if (!display) return "";
  return `${sortKey || display}${SORT_DISPLAY_SEPARATOR}${display}`;
}

function normalizeArxivTwoDigitYear(twoDigit: string): string | null {
  const yy = Number.parseInt(twoDigit, 10);
  if (!Number.isFinite(yy) || yy < 0 || yy > 99) {
    return null;
  }
  // arXiv started in 1991. Prefer 19xx for 91-99, otherwise 20xx.
  return String(yy >= 91 ? 1900 + yy : 2000 + yy);
}

function buildArxivSortKey(arxivId: string): string {
  const trimmed = (arxivId || "").trim();
  if (!trimmed) return "";

  const normalized = trimmed.replace(/v\d+$/i, "");

  // New-style: YYMM.NNNNN (post-2007). Example: 2301.12345
  const newMatch = normalized.match(/^(\d{4})\.(\d{4,5})$/);
  if (newMatch) {
    const yymm = newMatch[1];
    const seqRaw = newMatch[2];
    const year = normalizeArxivTwoDigitYear(yymm.slice(0, 2));
    const month = yymm.slice(2, 4);
    if (year && /^[01]\d$/.test(month)) {
      return `${year}${month}${seqRaw.padStart(ARXIV_SORT_PAD, "0")}`;
    }
  }

  // Old-style: archive/YYMMNNN. Example: hep-th/9802109, hep-ph/0610008
  const oldMatch = normalized.match(/^[a-z-]+\/(\d{7})$/i);
  if (oldMatch) {
    const digits = oldMatch[1];
    const year = normalizeArxivTwoDigitYear(digits.slice(0, 2));
    const month = digits.slice(2, 4);
    const seq = digits.slice(4, 7);
    if (year && /^[01]\d$/.test(month)) {
      return `${year}${month}${seq.padStart(ARXIV_SORT_PAD, "0")}`;
    }
    // Fall back to numeric-only sorting
    return digits.padStart(11, "0");
  }

  // Fallback: numeric-only (keeps ordering stable for unusual formats)
  const numeric = normalized.replace(/\D/g, "");
  return numeric ? numeric.padStart(11, "0") : normalized;
}

function getArxivCellData(item: Zotero.Item): string {
  const key = getItemCacheKey(item);
  const journalAbbrev = asString(item.getField("journalAbbreviation"));
  const extra = asString(item.getField("extra"));
  const url = asString(item.getField("url"));
  const doi = asString(item.getField("DOI"));
  const signature = `${journalAbbrev}\n${extra}\n${url}\n${doi}`;

  const cached = arxivValueCache.get(key);
  if (cached && cached.signature === signature) {
    return cached.value;
  }

  const arxivId = extractArxivIdFromItem(item) || "";
  const sortKey = arxivId ? buildArxivSortKey(arxivId) : "";
  const encoded = encodeSortDisplayValue(sortKey, arxivId);
  arxivValueCache.set(key, { signature, value: encoded });
  return encoded;
}

function getCitesCellData(item: Zotero.Item): string {
  const key = getItemCacheKey(item);
  const excludeSelf = getCitesExcludeSelfPref();
  const extra = asString(item.getField("extra"));
  const signature = `${excludeSelf ? "no-self" : "with-self"}\n${extra}`;

  const cached = citesValueCache.get(key);
  if (cached && cached.signature === signature) {
    return cached.value;
  }

  const count = parseInspireCitationsFromExtra(extra, excludeSelf);
  const value = typeof count === "number" ? padNumericSortKey(count) : "";
  citesValueCache.set(key, { signature, value });
  return value;
}

async function maybeAwait<T>(value: MaybePromise<T>): Promise<T> {
  return await Promise.resolve(value);
}

export async function registerInspireItemTreeColumns(): Promise<void> {
  if (columnsRegistered) {
    return;
  }

  const manager = (Zotero as any).ItemTreeManager as
    | _ZoteroTypes.ItemTreeManager
    | undefined;
  if (!manager) {
    return;
  }
  const register =
    (manager as any)?.registerColumn || (manager as any)?.registerColumns;
  if (typeof register !== "function") {
    return;
  }

  // Cleanup legacy keys that were registered with Zotero namespacing
  // (CSS.escape(`${pluginID}-${dataKey}`)), which introduces '-' into `dataKey`
  // and breaks column resizing in Zotero 8's virtualized table.
  try {
    if (typeof manager.unregisterColumn === "function") {
      const legacyKeys = new Set<string>([
        // Historical (v2.4.0+): pluginID=config.addonID, dataKey=cites/arxiv
        CSS.escape(`${config.addonID}-cites`),
        CSS.escape(`${config.addonID}-arxiv`),
        // Intermediate experiments: pluginID=config.addonID, dataKey=zinspire*
        CSS.escape(`${config.addonID}-${CITES_COLUMN_KEY}`),
        CSS.escape(`${config.addonID}-${ARXIV_COLUMN_KEY}`),
        // Intermediate experiments: pluginID=config.addonRef, dataKey=cites/arxiv
        CSS.escape(`${config.addonRef}-cites`),
        CSS.escape(`${config.addonRef}-arxiv`),
        // Intermediate experiments: pluginID=config.addonRef, dataKey=zinspire*
        CSS.escape(`${config.addonRef}-${CITES_COLUMN_KEY}`),
        CSS.escape(`${config.addonRef}-${ARXIV_COLUMN_KEY}`),
      ]);
      for (const key of legacyKeys) {
        manager.unregisterColumn(key);
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  const citesResult = await maybeAwait(
    register.call(manager, {
      dataKey: CITES_COLUMN_KEY,
      label: "Cites",
      // Required by Zotero API. Use an empty string to avoid automatic
      // namespacing (which introduces a '-' and breaks column resize logic).
      pluginID: ITEM_TREE_COLUMNS_PLUGIN_ID,
      enabledTreeIDs: ["main"],
      flex: 0,
      width: "70",
      showInColumnPicker: true,
      columnPickerSubMenu: false,
      dataProvider: (item: Zotero.Item) => getCitesCellData(item),
      renderCell: (
        _index: number,
        data: string,
        column: _ZoteroTypes.ItemTreeManager.ItemTreeColumnOptions & {
          className: string;
        },
        _isFirstColumn: boolean,
        doc: Document,
      ) => {
        const span = doc.createElement("span");
        span.className = `cell ${column.className}`;
        span.textContent = displayNumericSortKey(data);
        return span;
      },
      zoteroPersist: ["width", "hidden", "sortDirection"],
    }),
  );

  const arxivResult = await maybeAwait(
    register.call(manager, {
      dataKey: ARXIV_COLUMN_KEY,
      label: "arXiv",
      // Required by Zotero API. Use an empty string to avoid automatic
      // namespacing (which introduces a '-' and breaks column resize logic).
      pluginID: ITEM_TREE_COLUMNS_PLUGIN_ID,
      enabledTreeIDs: ["main"],
      flex: 0,
      width: "110",
      showInColumnPicker: true,
      columnPickerSubMenu: false,
      dataProvider: (item: Zotero.Item) => getArxivCellData(item),
      renderCell: (
        _index: number,
        data: string,
        column: _ZoteroTypes.ItemTreeManager.ItemTreeColumnOptions & {
          className: string;
        },
        _isFirstColumn: boolean,
        doc: Document,
      ) => {
        const { display } = decodeSortDisplayValue(data);
        const span = doc.createElement("span");
        span.className = `cell ${column.className}`;
        span.textContent = display;
        span.setAttribute("title", display);
        return span;
      },
      zoteroPersist: ["width", "hidden", "sortDirection"],
    }),
  );

  const resolvedCitesKey =
    typeof citesResult === "string"
      ? citesResult
      : manager.isCustomColumn?.(CITES_COLUMN_KEY)
        ? CITES_COLUMN_KEY
        : null;
  const resolvedArxivKey =
    typeof arxivResult === "string"
      ? arxivResult
      : manager.isCustomColumn?.(ARXIV_COLUMN_KEY)
        ? ARXIV_COLUMN_KEY
        : null;

  registeredColumnKeys = [];
  if (resolvedCitesKey) registeredColumnKeys.push(resolvedCitesKey);
  if (resolvedArxivKey) registeredColumnKeys.push(resolvedArxivKey);

  if (registeredColumnKeys.length === 0) {
    // Registration failed; allow retries (e.g. if Zotero loads APIs late).
    columnsRegistered = false;
    return;
  }

  manager.refreshColumns?.();
  columnsRegistered = true;
}

export function unregisterInspireItemTreeColumns(): void {
  const manager = (Zotero as any).ItemTreeManager as
    | _ZoteroTypes.ItemTreeManager
    | undefined;
  if (!manager?.unregisterColumn) {
    return;
  }

  const keys = new Set<string>(registeredColumnKeys);
  // Best-effort unregister, even if the previous registration didn't store keys.
  keys.add(CITES_COLUMN_KEY);
  keys.add(ARXIV_COLUMN_KEY);

  for (const key of keys) {
    try {
      manager.unregisterColumn(key);
    } catch {
      // Ignore unregister errors (e.g. already removed)
    }
  }
  registeredColumnKeys = [];
  columnsRegistered = false;
}
