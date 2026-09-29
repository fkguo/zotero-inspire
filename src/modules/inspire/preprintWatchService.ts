/**
 * Preprint Watch Service (FTR-PREPRINT-WATCH)
 *
 * Detects unpublished arXiv preprints in Zotero library and checks INSPIRE
 * for publication status. Updates metadata when preprints are published.
 *
 * Key design principles:
 * - Reuses existing functions from metadataService.ts
 * - Every check scans the collection or the editable libraries for its
 *   preprints; the cache file keeps INSPIRE's answers only
 * - A check asks INSPIRE about every preprint, 50 arXiv IDs per request, and
 *   takes a record only when it is the record of the item's arXiv ID and its
 *   title and first author agree with the item's (resolveInspireByArxiv);
 *   only the background check at startup skips papers INSPIRE had no record
 *   of in the last 7 days
 * - Worker pattern for concurrent API calls (max 3)
 * - Incremental library scanning to avoid UI freezing
 */

import { config } from "../../../package.json";
import { getPref, setPref } from "../../utils/prefs";
import {
  API_FIELDS_INSPIRE_COMPLETION,
  API_FIELDS_PREPRINT_CHECK,
} from "./constants";
import { localCache } from "./localCache";
import { fetchInspireMetaByRecid } from "./metadataService";
import { creatorsForUpdate, getFieldProtectionConfig } from "./smartUpdate";
import { createAbortControllerWithSignal } from "./utils";
import { addArxivCategoryTag } from "./arxivTag";
import { arxivIdFromItem } from "../arxiv/arxivId";
import {
  INSPIRE_ARXIV_BATCH_SIZE,
  resolveInspireByArxiv,
  type ResolvedInspireRecord,
} from "../arxiv/inspireByArxiv";
import {
  completionEntry,
  itemIdentity,
  type CheckedIdentity,
} from "./library/inspireCompletion";
import { resolveItemRecid } from "./library/itemRecid";
import type { jsobject } from "./types";
import type {
  PublicationInfo,
  PreprintCheckResult,
  PreprintCheckSummary,
  PreprintUpdateOptions,
  PreprintWatchCache,
  PreprintWatchEntry,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** arXiv DOI prefix for identification */
export const ARXIV_DOI_PREFIX = "10.48550/arXiv";

/** Regex to match arXiv info in journalAbbreviation field */
const ARXIV_JOURNAL_ABBREV_REGEX = /^arXiv:/i;

/** Requests to INSPIRE in flight at once, each for up to 50 arXiv IDs */
const CONCURRENCY = 3;

/** Batch size for library scanning (to avoid UI freezing) */
const SCAN_BATCH_SIZE = 100;

/**
 * Unified preprint watch cache version.
 * 2: an entry holds INSPIRE's last answer about an arXiv ID (published,
 *    unpublished or no record) and the time INSPIRE gave it; failed requests
 *    are not stored.
 * 1: answers taken from the cache renewed their time, and failed requests and
 *    papers without an INSPIRE record were stored as "unpublished". Version-1
 *    entries are kept until INSPIRE answers again, but count as never checked.
 */
const PREPRINT_WATCH_CACHE_VERSION = 2;

/** Cache file name (without extension) */
const PREPRINT_WATCH_CACHE_FILE = "preprintWatch";

/** Background check: a paper without an INSPIRE record is asked about again at most this often */
const BACKGROUND_NO_RECORD_REUSE_MS = 7 * 24 * 60 * 60 * 1000;

/** Answers are written to disk after this many, so that a check stopped early keeps them */
const SAVE_EVERY_ANSWERS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Caching (Unified single-file cache)
// ─────────────────────────────────────────────────────────────────────────────

/** The preprint watch cache, with the file it is written back to */
interface LoadedPreprintWatchCache {
  cache: PreprintWatchCache;
  /** null without a cache folder, or for a file this version cannot read (left unchanged) */
  saveTo: string | null;
}

/** The cache read from the file of the current cache folder */
let preprintWatchCacheLoad: {
  filePath: string | null;
  loaded: Promise<LoadedPreprintWatchCache>;
} | null = null;

/**
 * Get cache directory path from localCache.
 */
async function getCacheDir(): Promise<string | null> {
  return localCache.getCacheDir();
}

/**
 * Get full path to the unified preprint watch cache file.
 */
async function getPreprintWatchCachePath(): Promise<string | null> {
  const cacheDir = await getCacheDir();
  if (!cacheDir) return null;
  return PathUtils.join(cacheDir, `${PREPRINT_WATCH_CACHE_FILE}.json`);
}

/**
 * The unified preprint watch cache: read from disk on first use, then shared
 * by all checks (so that concurrent checks add their answers to the same
 * object). Read again when the cache folder was changed in Preferences; a
 * check still running keeps writing to the file it read. Empty when there is
 * no cache folder or file.
 */
async function loadPreprintWatchCache(): Promise<LoadedPreprintWatchCache> {
  const filePath = await getPreprintWatchCachePath();
  if (!preprintWatchCacheLoad || preprintWatchCacheLoad.filePath !== filePath) {
    preprintWatchCacheLoad = {
      filePath,
      loaded: readPreprintWatchCache(filePath),
    };
  }
  return preprintWatchCacheLoad.loaded;
}

async function readPreprintWatchCache(
  filePath: string | null,
): Promise<LoadedPreprintWatchCache> {
  if (!filePath) return { cache: createEmptyCache(), saveTo: null };
  const empty = { cache: createEmptyCache(), saveTo: filePath };

  try {
    const exists = await IOUtils.exists(filePath);
    if (!exists) return empty;

    const cached = (await IOUtils.readJSON(filePath)) as {
      version?: unknown;
      entries?: unknown;
    } | null;

    if (Array.isArray(cached?.entries)) {
      if (cached.version === PREPRINT_WATCH_CACHE_VERSION) {
        return { cache: cached as PreprintWatchCache, saveTo: filePath };
      }
      if (cached.version === 1) {
        return {
          cache: upgradeVersion1Cache(cached.entries),
          saveTo: filePath,
        };
      }
    }

    // Another version of the plugin wrote it: leave the file as it is
    Zotero.debug(
      `[${config.addonName}] Preprint watch cache has an unknown format (version ${cached?.version}); it is left unchanged`,
    );
    return { cache: createEmptyCache(), saveTo: null };
  } catch (e) {
    Zotero.debug(
      `[${config.addonName}] Failed to load preprint watch cache: ${e}`,
    );
    return empty;
  }
}

/**
 * Entries of a version-1 cache, kept until INSPIRE answers again. Their
 * status stays, but lastChecked 0 makes them count as never checked: a
 * version-1 time may come from an answer taken from the cache, and its
 * "unpublished" may stand for a failed request or a missing record.
 */
function upgradeVersion1Cache(entries: unknown[]): PreprintWatchCache {
  const upgraded: PreprintWatchEntry[] = [];
  for (const entry of entries as Array<Partial<PreprintWatchEntry> | null>) {
    if (typeof entry?.arxivId !== "string") continue;
    upgraded.push({
      arxivId: entry.arxivId,
      status: entry.status ?? "unpublished",
      lastChecked: 0,
      ...(entry.publicationInfo
        ? { publicationInfo: entry.publicationInfo }
        : {}),
    });
  }
  return { version: PREPRINT_WATCH_CACHE_VERSION, entries: upgraded };
}

/** Writes of the cache file, one after the other (two checks can save at the same time) */
let preprintWatchCacheWrites: Promise<void> = Promise.resolve();

/**
 * Save the unified preprint watch cache to the file it was read from. Writes
 * run one after the other, each with the cache as it is when the write
 * starts, so the last write holds every answer recorded before it. The file
 * is replaced only once the new content is complete on disk (written to a
 * temporary file first, as Zotero writes its own files), so quitting during
 * a write cannot leave it cut short.
 */
function savePreprintWatchCache(
  loaded: LoadedPreprintWatchCache,
): Promise<void> {
  preprintWatchCacheWrites = preprintWatchCacheWrites.then(() =>
    writePreprintWatchCache(loaded),
  );
  return preprintWatchCacheWrites;
}

async function writePreprintWatchCache({
  cache,
  saveTo,
}: LoadedPreprintWatchCache): Promise<void> {
  if (!saveTo) return;

  try {
    await IOUtils.writeJSON(saveTo, cache, { tmpPath: `${saveTo}.tmp` });
    Zotero.debug(
      `[${config.addonName}] Saved preprint watch cache (${cache.entries.length} entries)`,
    );
  } catch (e) {
    Zotero.debug(
      `[${config.addonName}] Failed to save preprint watch cache: ${e}`,
    );
  }
}

/**
 * Create empty preprint watch cache.
 */
function createEmptyCache(): PreprintWatchCache {
  return {
    version: PREPRINT_WATCH_CACHE_VERSION,
    entries: [],
  };
}

/**
 * Get entry from cache by arXiv ID.
 */
function getCacheEntry(
  cache: PreprintWatchCache,
  arxivId: string,
): PreprintWatchEntry | undefined {
  return cache.entries.find((e) => e.arxivId === arxivId);
}

/**
 * Update or add entry in cache.
 */
function updateCacheEntry(
  cache: PreprintWatchCache,
  entry: PreprintWatchEntry,
): void {
  const idx = cache.entries.findIndex((e) => e.arxivId === entry.arxivId);
  if (idx >= 0) {
    cache.entries[idx] = entry;
  } else {
    cache.entries.push(entry);
  }
}

/**
 * Fetch Zotero items by IDs in batches, respecting AbortSignal.
 */
async function getItemsInBatches(
  itemIDs: number[],
  signal?: AbortSignal,
  batchSize = 500,
): Promise<Zotero.Item[]> {
  const items: Zotero.Item[] = [];
  for (let i = 0; i < itemIDs.length; i += batchSize) {
    if (signal?.aborted) break;
    const batch = itemIDs.slice(i, i + batchSize);
    const batchItems = await Zotero.Items.getAsync(batch);
    items.push(...batchItems);
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Detection Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a DOI is an arXiv DOI.
 */
export function isArxivDoi(doi: string | null | undefined): boolean {
  return doi?.startsWith(ARXIV_DOI_PREFIX) ?? false;
}

/** Item types scanned by Preprint Watch. */
const PREPRINT_WATCH_ITEM_TYPES: ReadonlySet<string> = new Set([
  "journalArticle",
  "preprint",
]);

/**
 * Check if a Zotero item is an unpublished arXiv preprint or needs metadata update.
 * Uses multiple signals: journalAbbreviation, DOI, Extra field, volume, pages.
 *
 * Two kinds of items qualify:
 * - `preprint` items (kept as such by the "keep preprint type" option, or
 *   created by Zotero's arXiv translator): unpublished by definition, they are
 *   candidates whenever an arXiv ID can be found on the item.
 * - `journalArticle` items that this plugin historically used for arXiv papers:
 *   - journalAbbreviation: "arXiv:2301.12345 [hep-ph]" (legacy option)
 *   - DOI: may be arXiv DOI "10.48550/arXiv.2301.12345"
 *   They need an update if ANY of these holds:
 *   1. journalAbbreviation starts with "arXiv:" (pure preprint)
 *   2. Has non-arXiv DOI but missing volume/pages (incomplete publication info)
 *   3. No journal info but has arXiv in Extra
 *   4. Only has arXiv DOI
 */
export function isUnpublishedPreprint(item: Zotero.Item): boolean {
  if (item.itemType === "preprint") {
    return arxivIdFromItem(item) !== null;
  }
  // Skip non-journal articles
  if (item.itemType !== "journalArticle") return false;

  const journalAbbrev = item.getField("journalAbbreviation") as string;
  const doi = item.getField("DOI") as string;
  const extra = item.getField("extra") as string;
  const volume = item.getField("volume") as string;
  const pages = item.getField("pages") as string;

  // Case 1: journalAbbreviation starts with "arXiv:"
  if (journalAbbrev && ARXIV_JOURNAL_ABBREV_REGEX.test(journalAbbrev)) {
    // Even if has journal DOI, still needs update if missing volume/pages
    if (doi && !isArxivDoi(doi)) {
      // Has journal DOI - check if publication info is complete
      if (volume && pages) {
        return false; // Fully published with complete info
      }
      // Has DOI but missing volume or pages - needs update
      return true;
    }
    return true; // Pure preprint (no journal DOI)
  }

  // Case 2: No journal info but has arXiv in Extra
  if (!journalAbbrev && extra?.includes("arXiv:")) {
    return true;
  }

  // Case 3: Only has arXiv DOI
  if (doi && isArxivDoi(doi) && !journalAbbrev) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Library Scanning (Optimized for performance)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IDs of all items in a library whose type is one of `types`
 * (one search per type; Zotero ANDs conditions, so "is A" and "is B" cannot
 * be combined in a single search).
 */
async function searchItemIDsByTypes(
  libraryID: number,
  types: Iterable<string>,
): Promise<number[]> {
  const ids: number[] = [];
  for (const itemType of types) {
    const search = new Zotero.Search({ libraryID });
    search.addCondition("itemType", "is", itemType);
    ids.push(...(await search.search()));
  }
  return ids;
}

/**
 * Libraries whose preprints are checked: the personal library and the group
 * libraries the user can edit (a published preprint can only be updated
 * there). Feeds and read-only groups are skipped.
 */
function editableLibraryIDs(): number[] {
  return Zotero.Libraries.getAll()
    .filter((library) => library.editable && library.libraryType !== "feed")
    .map((library) => library.libraryID);
}

/**
 * Find the unpublished arXiv preprints of a collection, of one library, or
 * (without either) of every editable library. The items are scanned on every
 * call, in batches to avoid UI freezing; the preprint watch cache only keeps
 * INSPIRE's answers, not the list of preprints.
 */
export async function findUnpublishedPreprints(
  libraryID?: number,
  collectionID?: number,
  options?: {
    signal?: AbortSignal;
    onProgress?: (found: number, scanned: number) => void;
  },
): Promise<Zotero.Item[]> {
  const preprints: Zotero.Item[] = [];
  const seen = new Set<number>();

  // Collection mode: small scope, always do full scan
  if (collectionID) {
    const collection = await Zotero.Collections.getAsync(collectionID);
    if (!collection) {
      Zotero.debug(
        `[zotero-inspire] findUnpublishedPreprints: collection ${collectionID} not found`,
      );
      return [];
    }
    const allItems = collection
      .getChildItems()
      .filter((item) => PREPRINT_WATCH_ITEM_TYPES.has(item.itemType));
    const total = allItems.length;

    for (let i = 0; i < total; i += SCAN_BATCH_SIZE) {
      if (options?.signal?.aborted) break;
      const batchEnd = Math.min(i + SCAN_BATCH_SIZE, total);
      const batchItems = allItems.slice(i, batchEnd);
      for (const item of batchItems) {
        if (!item.deleted && isUnpublishedPreprint(item)) {
          if (!seen.has(item.id)) {
            preprints.push(item);
            seen.add(item.id);
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      options?.onProgress?.(preprints.length, batchEnd);
    }
    return preprints;
  }

  // Library mode: scan the journal articles and preprints of each library
  const libraryIDs =
    libraryID !== undefined ? [libraryID] : editableLibraryIDs();
  let scanned = 0;
  for (const scanLibraryID of libraryIDs) {
    // Zotero loads a library's items when the library is first shown; one
    // not shown in this session has no field data yet (Zotero's own code
    // waits for it the same way before reading items)
    const library = Zotero.Libraries.get(scanLibraryID);
    if (library) await library.waitForDataLoad("item");
    if (options?.signal?.aborted) return preprints;

    const itemIDs = await searchItemIDsByTypes(
      scanLibraryID,
      PREPRINT_WATCH_ITEM_TYPES,
    );

    for (let i = 0; i < itemIDs.length; i += SCAN_BATCH_SIZE) {
      if (options?.signal?.aborted) return preprints;
      const batchIDs = itemIDs.slice(i, i + SCAN_BATCH_SIZE);
      const batchItems = await Zotero.Items.getAsync(batchIDs);

      for (const item of batchItems) {
        scanned++;
        if (!item.deleted && isUnpublishedPreprint(item)) {
          if (!seen.has(item.id)) {
            preprints.push(item);
            seen.add(item.id);
          }
        }
      }

      // Yield main thread to avoid UI freezing
      await new Promise((resolve) => setTimeout(resolve, 0));
      options?.onProgress?.(preprints.length, scanned);
    }
  }

  return preprints;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE API Functions
// ─────────────────────────────────────────────────────────────────────────────

/** INSPIRE's answer about one arXiv preprint */
type InspireAnswer =
  | { status: "published"; publicationInfo: PublicationInfo }
  | { status: "unpublished" }
  | { status: "not_in_inspire" };

/** INSPIRE fields the check reads, beyond those of the identity check */
const PREPRINT_CHECK_FIELDS = [
  ...API_FIELDS_PREPRINT_CHECK.split(","),
  ...API_FIELDS_INSPIRE_COMPLETION.split(","),
];

/**
 * The journal publication of an INSPIRE record (the first entry with a
 * journal that is not an erratum), or null for a record without one
 */
function publicationOf(metadata: any): PublicationInfo | null {
  // Some INSPIRE records have pubinfo_freetext in [0] and structured data in [1]
  const primary = (metadata.publication_info as any[] | undefined)?.find(
    (p) => p.journal_title && p.material !== "erratum",
  );
  if (!primary) return null;
  // Format journal title consistently (add spaces after dots)
  // This matches the formatting in metadataService.ts buildMetaFromMetadata
  const formattedJournalTitle = primary.journal_title.replace(/\.\s|\./g, ". ");
  return {
    journalTitle: formattedJournalTitle,
    volume: primary.journal_volume,
    pageStart: primary.page_start || primary.artid,
    year: primary.year,
    doi: extractPublishedDoi(metadata.dois) ?? undefined,
    recid: metadata.control_number?.toString(),
    preprintDate: metadata.preprint_date,
  };
}

/**
 * Extract non-arXiv DOI from INSPIRE dois array.
 */
function extractPublishedDoi(
  dois: Array<{ value: string }> | undefined,
): string | null {
  if (!dois?.length) return null;
  for (const doi of dois) {
    if (doi.value && !isArxivDoi(doi.value)) {
      return doi.value;
    }
  }
  return null;
}

/**
 * The result of `item`, checked as `identity`, from INSPIRE's answer about
 * its arXiv ID: an unpublished record of an item without a recid carries
 * the entry that "write INSPIRE record" writes
 */
function checkedResult(
  item: Zotero.Item,
  identity: CheckedIdentity,
  answer: ResolvedInspireRecord,
): PreprintCheckResult {
  const base = {
    itemID: item.id,
    arxivId: identity.arxivId,
    title: identity.title,
  };
  switch (answer.status) {
    case "failed":
      return { ...base, status: "error", error: "INSPIRE did not answer" };
    case "notFound":
      return { ...base, status: "not_in_inspire" };
  }
  const itemRecid = resolveItemRecid(item);
  // An item that names the record already is the record's paper, also when
  // the titles differ (a journal's title) or the record lacks an author
  const mismatches = itemRecid === answer.recid ? [] : answer.mismatches;
  const publicationInfo = publicationOf(answer.metadata);
  if (publicationInfo) {
    return { ...base, status: "published", publicationInfo, mismatches };
  }
  return {
    ...base,
    status: "unpublished",
    mismatches,
    ...(itemRecid
      ? {}
      : { completion: completionEntry(item, identity, answer) }),
  };
}

/** INSPIRE's answer about an arXiv ID, as the cache keeps it */
function answerOf(answer: ResolvedInspireRecord): InspireAnswer | null {
  if (answer.status === "failed") return null;
  if (answer.status === "notFound") return { status: "not_in_inspire" };
  const publicationInfo = publicationOf(answer.metadata);
  return publicationInfo
    ? { status: "published", publicationInfo }
    : { status: "unpublished" };
}

/**
 * The background check does not ask again about a paper INSPIRE had no
 * record of less than BACKGROUND_NO_RECORD_REUSE_MS ago
 */
function hasRecentNoRecord(
  entry: PreprintWatchEntry | undefined,
  now: number,
): boolean {
  if (entry?.status !== "not_in_inspire" || entry.lastChecked <= 0) {
    return false;
  }
  const age = now - entry.lastChecked;
  return age >= 0 && age < BACKGROUND_NO_RECORD_REUSE_MS;
}

/** The cache entry for an answer INSPIRE gave at `answeredAt` */
function cacheEntryForAnswer(
  arxivId: string,
  answer: InspireAnswer,
  answeredAt: number,
): PreprintWatchEntry {
  return answer.status === "published"
    ? {
        arxivId,
        status: "published",
        lastChecked: answeredAt,
        publicationInfo: answer.publicationInfo,
      }
    : { arxivId, status: answer.status, lastChecked: answeredAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Check Functions (Worker Pattern)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Batch check publication status for multiple items using worker pattern.
 * INSPIRE is asked about 50 arXiv IDs per request, once per arXiv ID, also
 * when the paper is in several items or libraries; each item is checked
 * against the record (its title and first author) on its own.
 *
 * A manual check asks INSPIRE about every item. The background check
 * (`background: true`) skips papers INSPIRE had no record of in the last
 * 7 days (see hasRecentNoRecord).
 *
 * The cache stores INSPIRE's answers with the time each was given. A failed
 * request gives an "error" result and leaves the item's cache entry as it
 * was. When the signal aborts, the answers received so far are stored, and
 * the results of the items answered so far are returned.
 *
 * A manual check is enclosed in beginManualCheck(), which stops a background
 * check in progress: both would ask INSPIRE about the same preprints.
 */
export async function batchCheckPublicationStatus(
  items: Zotero.Item[],
  options?: {
    signal?: AbortSignal;
    /** Called as items are answered: items answered so far, all items */
    onProgress?: (done: number, total: number) => void;
    /**
     * Background check: skip papers without a record lately, and send the
     * requests after those a user is waiting for
     */
    background?: boolean;
  },
): Promise<PreprintCheckResult[]> {
  const total = items.length;
  const results: PreprintCheckResult[] = new Array(total);
  let done = 0;

  // Item indexes by arXiv ID
  const itemIndexesByArxivId = new Map<string, number[]>();
  items.forEach((item, index) => {
    const arxivId = arxivIdFromItem(item);
    if (!arxivId) {
      results[index] = {
        itemID: item.id,
        arxivId: "",
        title: item.getField("title") as string,
        status: "error",
        error: "Could not extract arXiv ID",
      };
      done++;
      return;
    }
    const indexes = itemIndexesByArxivId.get(arxivId);
    if (indexes) {
      indexes.push(index);
    } else {
      itemIndexesByArxivId.set(arxivId, [index]);
    }
  });

  const loaded = await loadPreprintWatchCache();
  const { cache } = loaded;
  const toAsk: string[] = [];
  const now = Date.now();
  for (const [arxivId, indexes] of itemIndexesByArxivId) {
    if (
      options?.background &&
      hasRecentNoRecord(getCacheEntry(cache, arxivId), now)
    ) {
      for (const index of indexes) {
        results[index] = {
          itemID: items[index].id,
          arxivId,
          title: items[index].getField("title") as string,
          status: "not_in_inspire",
        };
        done++;
      }
    } else {
      toAsk.push(arxivId);
    }
  }
  if (done > 0) options?.onProgress?.(done, total);

  const batches: string[][] = [];
  for (let i = 0; i < toAsk.length; i += INSPIRE_ARXIV_BATCH_SIZE) {
    batches.push(toAsk.slice(i, i + INSPIRE_ARXIV_BATCH_SIZE));
  }
  let next = 0;
  let unsavedAnswers = 0;

  const worker = async () => {
    while (next < batches.length && !options?.signal?.aborted) {
      const batch = batches[next++];
      const checked = batch.flatMap((arxivId) =>
        itemIndexesByArxivId.get(arxivId)!.map((index) => ({
          index,
          identity: itemIdentity(items[index], arxivId),
        })),
      );

      let answers: ResolvedInspireRecord[];
      try {
        answers = await resolveInspireByArxiv(
          checked.map(({ identity }) => identity),
          {
            fields: PREPRINT_CHECK_FIELDS,
            signal: options?.signal,
            background: options?.background,
          },
        );
      } catch (error: any) {
        const message =
          error?.name === "AbortError"
            ? "Cancelled"
            : error?.message || "Unknown error";
        for (const { index, identity } of checked) {
          results[index] = {
            itemID: items[index].id,
            arxivId: identity.arxivId,
            title: identity.title,
            status: "error",
            error: message,
          };
        }
        done += checked.length;
        options?.onProgress?.(done, total);
        continue;
      }

      const answeredAt = Date.now();
      const stored = new Set<string>();
      checked.forEach(({ index, identity }, i) => {
        results[index] = checkedResult(items[index], identity, answers[i]);
        const answer = answerOf(answers[i]);
        if (answer && !stored.has(identity.arxivId)) {
          stored.add(identity.arxivId);
          updateCacheEntry(
            cache,
            cacheEntryForAnswer(identity.arxivId, answer, answeredAt),
          );
          unsavedAnswers++;
        }
      });
      if (unsavedAnswers >= SAVE_EVERY_ANSWERS) {
        unsavedAnswers = 0;
        await savePreprintWatchCache(loaded);
      }
      done += checked.length;
      options?.onProgress?.(done, total);
    }
  };

  // Start worker pool
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, batches.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (unsavedAnswers > 0) await savePreprintWatchCache(loaded);

  return results.filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a single preprint item with publication info from INSPIRE.
 *
 * FTR-REFACTOR: Now uses full metadata fetch when recid is available,
 * ensuring consistency with right-click update and smart update modes.
 * This provides complete field updates including:
 * - Title, creators, abstract
 * - Page ranges (start-end), issue, erratum notes
 * - Citation counts, citation key
 * - Collaboration tags
 *
 * Preserves arXiv info in Extra field.
 */
export async function updatePreprintWithPublicationInfo(
  item: Zotero.Item,
  pubInfo: PublicationInfo,
  options?: PreprintUpdateOptions,
): Promise<void> {
  const opts: Required<PreprintUpdateOptions> = {
    updateDoi: true,
    updateJournal: true,
    updateVolume: true,
    updatePages: true,
    updateDate: true,
    preserveArxivInExtra: true,
    ...options,
  };

  // Preserve arXiv info before any updates
  const currentJournalAbbrev = item.getField("journalAbbreviation") as string;
  const currentDoi = item.getField("DOI") as string;
  let extra = item.getField("extra") as string;

  // Preserve arXiv info in Extra if needed
  if (opts.preserveArxivInExtra) {
    // Add arXiv ID if not already present
    if (
      currentJournalAbbrev?.startsWith("arXiv:") &&
      !extra.includes("arXiv:")
    ) {
      const arxivLine = currentJournalAbbrev.split(" ")[0]; // e.g., "arXiv:2301.12345"
      extra = extra ? `${extra}\n${arxivLine}` : arxivLine;
    }

    // Add old arXiv DOI as note if being replaced
    if (
      currentDoi &&
      isArxivDoi(currentDoi) &&
      pubInfo.doi &&
      !extra.includes(currentDoi)
    ) {
      extra = extra
        ? `${extra}\nOriginal arXiv DOI: ${currentDoi}`
        : `Original arXiv DOI: ${currentDoi}`;
    }

    if (extra !== (item.getField("extra") as string)) {
      item.setField("extra", extra);
    }
  }

  // FTR-REFACTOR: If recid is available, fetch full metadata and do complete update
  // This ensures consistency with setInspireMeta() used by right-click and smart update
  if (pubInfo.recid) {
    const fullMeta = await fetchInspireMetaByRecid(
      pubInfo.recid,
      undefined,
      "full",
    );
    if (fullMeta !== -1 && typeof fullMeta === "object") {
      await updatePreprintWithFullMetadata(item, fullMeta as jsobject, opts);
      return;
    }
    // If full metadata fetch failed, fall through to minimal update
    Zotero.debug(
      `[${config.addonName}] Full metadata fetch failed for recid ${pubInfo.recid}, using minimal update`,
    );
  }

  // Fallback: Minimal update using only PublicationInfo fields
  // This path is used when recid is not available or full fetch failed
  await updatePreprintMinimal(item, pubInfo, opts);
}

/**
 * Full metadata update for preprint-to-published conversion.
 * Reuses the same logic as setInspireMeta() for consistency.
 */
async function updatePreprintWithFullMetadata(
  item: Zotero.Item,
  meta: jsobject,
  opts: Required<PreprintUpdateOptions>,
): Promise<void> {
  const publication = item.getField("publicationTitle") as string;

  // Ensure item type is normalized to journalArticle for published papers
  if (item.itemType !== "journalArticle") {
    if (meta.document_type?.[0] === "book") {
      item.setType(Zotero.ItemTypes.getID("book") as number);
    } else {
      item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
    }
  }

  // Set archive info
  item.setField("archive", "INSPIRE");
  item.setField("archiveLocation", meta.recid);

  // Journal / Publication info
  if (opts.updateJournal && meta.journalAbbreviation) {
    if (item.itemType === "journalArticle") {
      item.setField("journalAbbreviation", meta.journalAbbreviation);
      // Also update publicationTitle for better display
      if (
        !publication ||
        publication.startsWith("arXiv:") ||
        publication.toLowerCase().includes("arxiv")
      ) {
        item.setField("publicationTitle", meta.journalAbbreviation);
      }
    } else if (meta.document_type?.[0] === "book" && item.itemType === "book") {
      item.setField("series", meta.journalAbbreviation);
    } else {
      item.setField("publicationTitle", meta.journalAbbreviation);
    }
  }

  // Volume
  if (opts.updateVolume && meta.volume) {
    if (meta.document_type?.[0] === "book") {
      item.setField("seriesNumber", meta.volume);
    } else {
      item.setField("volume", meta.volume);
    }
  }

  // Pages (with full range support, unlike minimal update)
  if (opts.updatePages && meta.pages && meta.document_type?.[0] !== "book") {
    item.setField("pages", meta.pages);
  }

  // Date
  if (opts.updateDate && meta.date) {
    item.setField("date", meta.date);
  }

  // Issue (not available in minimal update)
  if (meta.issue) {
    item.setField("issue", meta.issue);
  }

  // DOI
  if (opts.updateDoi && meta.DOI) {
    if (item.itemType === "journalArticle" || item.itemType === "preprint") {
      item.setField("DOI", meta.DOI);
    }
  }

  // ISBN (only if empty)
  if (meta.isbns && !item.getField("ISBN")) {
    item.setField("ISBN", meta.isbns);
  }

  // Publisher (only if empty)
  if (
    meta.publisher &&
    !item.getField("publisher") &&
    (item.itemType === "book" || item.itemType === "bookSection")
  ) {
    item.setField("publisher", meta.publisher);
  }

  // Title (update if INSPIRE has a different/better title)
  if (meta.title) {
    const currentTitle = item.getField("title") as string;
    // Only update if title is meaningfully different
    if (!currentTitle || currentTitle.trim() !== meta.title.trim()) {
      item.setField("title", meta.title);
    }
  }

  // Creators; an author INSPIRE's list lacks is not dropped
  if (meta.creators) {
    item.setCreators(
      creatorsForUpdate(
        item.getCreators() as _ZoteroTypes.Item.Creator[],
        meta.creators,
        getFieldProtectionConfig().protectedNames,
      ),
    );
  }

  // Abstract
  if (meta.abstractNote) {
    item.setField("abstractNote", meta.abstractNote);
  }

  // Extra field updates
  let extra = item.getField("extra") as string;

  // arXiv info
  if (meta.arxiv) {
    const arxivId = meta.arxiv.value;
    let arXivInfo = "";
    if (/^\d/.test(arxivId)) {
      const arxivPrimaryCategory = meta.arxiv.categories?.[0];
      arXivInfo = arxivPrimaryCategory
        ? `arXiv:${arxivId} [${arxivPrimaryCategory}]`
        : `arXiv:${arxivId}`;
    } else {
      arXivInfo = "arXiv:" + arxivId;
    }
    const numberOfArxiv = (extra.match(/^.*(arXiv:|_eprint:).*$(\n|)/gim) || "")
      .length;
    if (numberOfArxiv !== 1) {
      extra = extra.replace(/^.*(arXiv:|_eprint:).*$(\n|)/gim, "");
      if (extra.endsWith("\n")) {
        extra += arXivInfo;
      } else {
        extra += "\n" + arXivInfo;
      }
    } else {
      extra = extra.replace(/^.*(arXiv:|_eprint:).*$/gim, arXivInfo);
    }

    // Set URL if empty
    const url = item.getField("url");
    if (meta.urlArxiv && !url) {
      item.setField("url", meta.urlArxiv);
    }
  }

  extra = extra.replace(/^.*type: article.*$\n/gm, "");

  // Collaboration
  if (meta.collaborations && !extra.includes("tex.collaboration")) {
    extra =
      extra + "\n" + "tex.collaboration: " + meta.collaborations.join(", ");
  }

  // Citations
  if (meta.citation_count !== undefined) {
    extra = setCitationsInExtra(
      extra,
      meta.citation_count,
      meta.citation_count_wo_self_citations,
    );
  }

  // Citation key
  const citekey_pref = getPref("citekey");
  if (citekey_pref === "inspire" && meta.citekey) {
    const zoteroVersion = Zotero.platformMajorVersion;
    if (zoteroVersion >= 8) {
      item.setField("citationKey", meta.citekey);
    } else {
      if (extra.includes("Citation Key")) {
        const initialCiteKey = (extra.match(/^.*Citation\sKey:.*$/gm) ||
          "")[0]?.split(": ")[1];
        if (initialCiteKey !== meta.citekey) {
          extra = extra.replace(
            /^.*Citation\sKey.*$/gm,
            `Citation Key: ${meta.citekey}`,
          );
        }
      } else {
        extra += "\nCitation Key: " + meta.citekey;
      }
    }
  }

  extra = extra.replace(/\n\n/gm, "\n");
  extra = reorderExtraFieldsPreprint(extra);
  item.setField("extra", extra);

  // arXiv category tag
  addArxivCategoryTag(item, meta.arxiv?.categories?.[0]);

  await item.saveTx();
}

/**
 * Minimal update using only PublicationInfo fields.
 * Used as fallback when full metadata is not available.
 */
async function updatePreprintMinimal(
  item: Zotero.Item,
  pubInfo: PublicationInfo,
  opts: Required<PreprintUpdateOptions>,
): Promise<void> {
  // Ensure item type is normalized to journalArticle for published papers
  if (item.itemType !== "journalArticle") {
    item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
  }

  // Update DOI (replace arXiv DOI with journal DOI)
  if (opts.updateDoi && pubInfo.doi) {
    item.setField("DOI", pubInfo.doi);
  }

  // Update journal abbreviation and publicationTitle
  if (opts.updateJournal && pubInfo.journalTitle) {
    item.setField("journalAbbreviation", pubInfo.journalTitle);
    const currentPubTitle = item.getField("publicationTitle") as string;
    if (
      !currentPubTitle ||
      currentPubTitle.startsWith("arXiv:") ||
      currentPubTitle.toLowerCase().includes("arxiv")
    ) {
      item.setField("publicationTitle", pubInfo.journalTitle);
    }
  }

  // Update volume
  if (opts.updateVolume && pubInfo.volume) {
    item.setField("volume", pubInfo.volume);
  }

  // Update pages
  if (opts.updatePages && pubInfo.pageStart) {
    item.setField("pages", pubInfo.pageStart);
  }

  // Update date to publication year
  if (opts.updateDate && pubInfo.year) {
    item.setField("date", String(pubInfo.year));
  }

  await item.saveTx();
}

/**
 * Set citation counts in Extra field.
 * Duplicated from itemUpdater.ts to avoid circular dependency.
 */
function setCitationsInExtra(
  extra: string,
  citation_count: number,
  citation_count_wo_self_citations?: number,
): string {
  const today = new Date(Date.now()).toLocaleDateString("zh-CN");

  // Check if citations are unchanged
  const topLinesMatch = extra.match(
    /^(\d+)\scitations\s\(INSPIRE\s[\d/-]+\)\n(\d+)\scitations\sw\/o\sself\s\(INSPIRE\s[\d/-]+\)\n/,
  );
  if (topLinesMatch) {
    const topCitation = Number(topLinesMatch[1]);
    const topCitationWoSelf = Number(topLinesMatch[2]);
    if (
      citation_count === topCitation &&
      citation_count_wo_self_citations === topCitationWoSelf
    ) {
      return extra;
    }
  }

  // Get existing citation values
  const temp = extra.match(/^\d+\scitations/gm);
  let existingCitations: number[] = [0, 0];
  if (temp !== null && temp.length >= 2) {
    existingCitations = temp.map((e: any) =>
      Number(e.replace(" citations", "")),
    );
  }

  const dateMatch = extra.match(/INSPIRE\s([\d/-]+)/);
  const existingDate = dateMatch ? dateMatch[1] : today;

  extra = extra.replace(/^.*citations.*$\n?/gm, "");
  extra = extra.replace(/^\n+/, "");

  const woSelf = citation_count_wo_self_citations ?? 0;

  if (
    citation_count === existingCitations[0] &&
    woSelf === existingCitations[1]
  ) {
    extra =
      `${citation_count} citations (INSPIRE ${existingDate})\n` +
      `${woSelf} citations w/o self (INSPIRE ${existingDate})\n` +
      extra;
  } else {
    extra =
      `${citation_count} citations (INSPIRE ${today})\n` +
      `${woSelf} citations w/o self (INSPIRE ${today})\n` +
      extra;
  }

  return extra;
}

/**
 * Reorder Extra fields for consistency.
 * Duplicated from itemUpdater.ts to avoid circular dependency.
 */
function reorderExtraFieldsPreprint(extra: string): string {
  const order_pref = getPref("extra_order");

  if (order_pref === "citations_first") {
    return extra;
  }

  const citationLines: string[] = [];
  const arxivLines: string[] = [];
  const otherLines: string[] = [];

  const lines = extra.split("\n");
  for (const line of lines) {
    if (line.match(/^\d+\scitations/)) {
      citationLines.push(line);
    } else if (line.match(/^(arXiv:|_eprint:)/i)) {
      arxivLines.push(line);
    } else if (line.trim() !== "") {
      otherLines.push(line);
    }
  }

  const reordered = [...arxivLines, ...otherLines, ...citationLines];
  return reordered.join("\n");
}

/**
 * Batch update multiple preprints with their publication info.
 */
export async function batchUpdatePreprints(
  results: PreprintCheckResult[],
  options?: {
    signal?: AbortSignal;
    onProgress?: (current: number, total: number) => void;
    updateOptions?: PreprintUpdateOptions;
  },
): Promise<{ success: number; failed: number }> {
  const publishedResults = results.filter(
    (r) => r.status === "published" && r.publicationInfo,
  );
  const total = publishedResults.length;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    if (options?.signal?.aborted) break;

    const result = publishedResults[i];
    try {
      const item = await Zotero.Items.getAsync(result.itemID);
      if (item && result.publicationInfo) {
        await updatePreprintWithPublicationInfo(
          item,
          result.publicationInfo,
          options?.updateOptions,
        );
        success++;
      }
    } catch (error) {
      Zotero.debug(
        `[${config.addonName}] Failed to update item ${result.itemID}: ${error}`,
      );
      failed++;
    }

    options?.onProgress?.(i + 1, total);
  }

  return { success, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build summary from check results.
 */
export function buildCheckSummary(
  results: PreprintCheckResult[],
): PreprintCheckSummary {
  return {
    total: results.length,
    published: results.filter((r) => r.status === "published").length,
    unpublished: results.filter((r) => r.status === "unpublished").length,
    errors: results.filter((r) => r.status === "error").length,
    notInInspire: results.filter((r) => r.status === "not_in_inspire").length,
    withoutRecid: results.filter((r) => r.completion).length,
    results,
  };
}

/**
 * Forget the preprint watch cache read in this session; the next check reads
 * the file again.
 */
export function clearPreprintCache(): void {
  preprintWatchCacheLoad = null;
}

/**
 * Remove published entries from unified cache after batch updates.
 * Called after batchUpdatePreprints to clean up successfully updated items.
 */
export async function removePreprintFromCache(arxivId: string): Promise<void> {
  const loaded = await loadPreprintWatchCache();
  loaded.cache.entries = loaded.cache.entries.filter(
    (e) => e.arxivId !== arxivId,
  );
  await savePreprintWatchCache(loaded);
}

// ─────────────────────────────────────────────────────────────────────────────
// Background Check Support
// ─────────────────────────────────────────────────────────────────────────────

/** The background check in progress */
let backgroundCheckController: AbortController | undefined;

/** Manual checks in progress (see beginManualCheck) */
let manualChecksInProgress = 0;

/**
 * Start a background check: returns the signal that stops it, or null while
 * a manual check is in progress (it asks INSPIRE about the same preprints,
 * and its results dialog may still be open).
 * A background check takes minutes when it has many preprints to ask about;
 * a manual check that starts meanwhile stops it.
 */
export function startBackgroundCheck(): AbortSignal | null {
  if (manualChecksInProgress > 0) return null;
  backgroundCheckController?.abort();
  const { controller, signal } = createAbortControllerWithSignal();
  backgroundCheckController = controller;
  return signal;
}

/** Stop the background check in progress, if any */
export function stopBackgroundCheck(): void {
  backgroundCheckController?.abort();
  backgroundCheckController = undefined;
}

/**
 * Begin a manual check (from the scan or the first request to INSPIRE until
 * its results dialog is closed and the chosen items are updated; calls may
 * be nested): stops a background check in progress and keeps a new one from
 * starting. Returns the function that ends the manual check.
 */
export function beginManualCheck(): () => void {
  manualChecksInProgress++;
  stopBackgroundCheck();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    manualChecksInProgress--;
  };
}

/**
 * The background check at startup, as set by preprint_watch_auto_check: all
 * editable libraries, skipping recent missing records. `showResults` shows
 * the results dialog when preprints were found published. A stopped check (by
 * a manual check, or at shutdown) or one whose every result is an error is not
 * recorded as done, so the next start checks the papers not answered yet.
 */
export async function runBackgroundCheck(
  showResults: (results: PreprintCheckResult[]) => Promise<void>,
): Promise<void> {
  // Abort previous background check if still running; none while a manual
  // check is in progress (it asks about the same preprints)
  const signal = startBackgroundCheck();
  if (!signal) {
    Zotero.debug(
      `[${config.addonName}] Manual preprint check in progress, skipping background check`,
    );
    return;
  }

  try {
    // Check if preprint watch is enabled
    const enabled = getPref("preprint_watch_enabled" as any) as boolean;
    if (!enabled) {
      Zotero.debug(
        `[${config.addonName}] Preprint watch disabled, skipping background check`,
      );
      return;
    }

    // Check if we should run based on timing preference
    if (!shouldRunBackgroundCheck()) {
      return;
    }

    Zotero.debug(`[${config.addonName}] Starting background preprint check`);

    // Find unpublished preprints in all editable libraries
    const preprints = await findUnpublishedPreprints(undefined, undefined, {
      signal,
    });
    if (signal.aborted) return;
    if (preprints.length === 0) {
      updateLastCheckTime();
      Zotero.debug(
        `[${config.addonName}] No unpublished preprints found in library`,
      );
      return;
    }

    Zotero.debug(
      `[${config.addonName}] Found ${preprints.length} unpublished preprints, checking INSPIRE...`,
    );

    // Check publication status, skipping recent missing records (updates
    // unified cache internally)
    const results = await batchCheckPublicationStatus(preprints, {
      signal,
      background: true,
    });
    if (signal.aborted) return;
    const summary = buildCheckSummary(results);
    // Every result is an error (e.g. no network at startup): not recorded as
    // done, so a later start asks again. Papers skipped for a recent missing
    // record count as results; failures among the others are asked again by
    // the next day's check (failures are not stored).
    if (summary.errors < summary.total) updateLastCheckTime();

    // If publications found, show results dialog for user to review and update
    if (summary.published > 0) {
      await showResults(results);
    }

    Zotero.debug(
      `[${config.addonName}] Background preprint check completed: ${summary.published} published, ${summary.unpublished} unpublished (${summary.withoutRecid} without recid), ${summary.notInInspire} not in INSPIRE, ${summary.errors} errors`,
    );
  } catch (err) {
    Zotero.debug(
      `[${config.addonName}] Background preprint check failed: ${err}`,
    );
  }
}

/**
 * Check if background preprint check should run based on last check time.
 */
export function shouldRunBackgroundCheck(): boolean {
  // Cast to any to handle type generation timing - these prefs are defined in prefs.js
  const autoCheckMode = getPref("preprint_watch_auto_check" as any) as string;
  if (autoCheckMode === "never") return false;

  // Seconds (see updateLastCheckTime). A value stored in milliseconds by an
  // earlier version wrapped around to an arbitrary number; it lies outside the
  // last day (almost surely), so the next check simply runs.
  const lastCheck = getPref("preprint_watch_last_check" as any) as number;
  const sinceLastCheck = Math.round(Date.now() / 1000) - lastCheck;

  if (autoCheckMode === "daily") {
    const oneDay = 24 * 60 * 60;
    if (sinceLastCheck >= 0 && sinceLastCheck < oneDay) {
      Zotero.debug(
        `[${config.addonName}] Skipping daily preprint check (already checked today)`,
      );
      return false;
    }
  }

  return true;
}

/**
 * Update last check timestamp, in seconds as Zotero stores its own times: an
 * integer preference holds 32 bits, too few for milliseconds.
 */
export function updateLastCheckTime(): void {
  // Cast to any to handle type generation timing
  setPref("preprint_watch_last_check" as any, Math.round(Date.now() / 1000));
}

// Re-export types for convenience
export type {
  PublicationInfo,
  PreprintCheckResult,
  PreprintCheckSummary,
  PreprintUpdateOptions,
  PreprintWatchCache,
  PreprintWatchEntry,
} from "./types";
