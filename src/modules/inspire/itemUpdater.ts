import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import {
  DOI_ORG_URL,
  INSPIRE_API_BASE,
  INSPIRE_NOTE_HTML_ENTITIES,
  INSPIRE_LITERATURE_URL,
} from "./constants";

// Plugin icon for progress windows (PNG format required for ProgressWindow headline)
const PLUGIN_ICON = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;

// ─────────────────────────────────────────────────────────────────────────────
// RegExp Constants (hoisted to module level for performance)
// ─────────────────────────────────────────────────────────────────────────────
const ARXIV_EXTRA_LINE_REGEX = /^.*(arXiv:|_eprint:).*$(\n|)/gim;

import type {
  jsobject,
  ItemWithPendingInspireNote,
  FavoritePaper,
} from "./types";
import {
  getInspireMeta,
  getCrossrefCount,
  fetchBibTeX,
} from "./metadataService";
import { deriveRecidFromItem, copyToClipboard } from "./apiUtils";
import { localCache } from "./localCache";
import {
  fetchReferencesEntries,
  enrichReferencesEntries,
} from "./referencesService";
import { inspireFetch } from "./rateLimiter";
import {
  isSmartUpdateEnabled,
  shouldShowPreview,
  compareItemWithInspire,
  filterProtectedChanges,
  getFieldProtectionConfig,
  showSmartUpdatePreviewDialog,
  mergeCreatorsWithProtectedNames,
  type FieldChange,
} from "./smartUpdate";
import {
  isUnpublishedPreprint,
  findUnpublishedPreprints,
  batchCheckPublicationStatus,
  buildCheckSummary,
  batchUpdatePreprints,
  type PreprintCheckResult,
  type PreprintCheckSummary,
} from "./preprintWatchService";
import {
  isCollabTagEnabled,
  isCollabTagAutoEnabled,
  addCollabTagsToItem,
  batchAddCollabTags,
} from "./collabTagService";
import { createAbortController } from "./utils";
import { copyFundingInfo } from "./funding";
import { AIDialog } from "./panel/AIDialog";
import type { ReaderSelectionPayload } from "./readerSelection";
import { captureSelectionImagesFromReader } from "./readerSelectionImage";
import { profileSupportsImageInput } from "./llm/capabilities";
import { getActiveAIProfile } from "./llm/profileStore";
// NOTE: CitationGraphDialog is imported lazily to avoid circular dependencies.

// ─────────────────────────────────────────────────────────────────────────────
// ZInspire Class - Batch Update Controller
// ─────────────────────────────────────────────────────────────────────────────

export class ZInspire {
  current: number;
  toUpdate: number;
  itemsToUpdate: Zotero.Item[];
  numberOfUpdatedItems: number;
  counter: number;
  CrossRefcounter: number;
  noRecidCount: number;
  error_norecid: boolean;
  error_norecid_shown: boolean;
  final_count_shown: boolean;
  progressWindow: ProgressWindowHelper;
  private updateController: AbortController | null = null;
  private isCancelled: boolean = false;
  private escapeHandler?: (e: KeyboardEvent) => void;
  private aiWindow?: Window;

  constructor(
    current: number = -1,
    toUpdate: number = 0,
    itemsToUpdate: Zotero.Item[] = [],
    numberOfUpdatedItems: number = 0,
    counter: number = 0,
    CrossRefcounter: number = 0,
    noRecidCount: number = 0,
    error_norecid: boolean = false,
    error_norecid_shown: boolean = false,
    final_count_shown: boolean = false,
  ) {
    this.current = current;
    this.toUpdate = toUpdate;
    this.itemsToUpdate = itemsToUpdate;
    this.numberOfUpdatedItems = numberOfUpdatedItems;
    this.counter = counter;
    this.CrossRefcounter = CrossRefcounter;
    this.noRecidCount = noRecidCount;
    this.error_norecid = error_norecid;
    this.error_norecid_shown = error_norecid_shown;
    this.final_count_shown = final_count_shown;
    this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
      closeTime: -1,
    });
  }

  resetState(operation: string) {
    if (operation === "initial") {
      if (this.progressWindow) {
        this.progressWindow.close();
      }
      this.current = -1;
      this.toUpdate = 0;
      this.itemsToUpdate = [];
      this.numberOfUpdatedItems = 0;
      this.counter = 0;
      this.CrossRefcounter = 0;
      this.noRecidCount = 0;
      this.error_norecid = false;
      this.error_norecid_shown = false;
      this.final_count_shown = false;
    } else {
      if (this.error_norecid) {
        this.progressWindow.close();
        const icon = "chrome://zotero/skin/cross.png";
        if (this.error_norecid && !this.error_norecid_shown) {
          const progressWindowNoRecid = new ztoolkit.ProgressWindow(
            config.addonName,
            { closeOnClick: true },
          );
          progressWindowNoRecid.changeHeadline("INSPIRE recid not found");
          const itemWord = this.noRecidCount === 1 ? "item" : "items";
          if (getPref("tag_enable") && getPref("tag_norecid") !== "") {
            progressWindowNoRecid.createLine({
              icon: icon,
              text: `No INSPIRE recid was found for ${this.noRecidCount} ${itemWord}. Tagged with '${getPref("tag_norecid")}'.`,
            });
          } else {
            progressWindowNoRecid.createLine({
              icon: icon,
              text: `No INSPIRE recid was found for ${this.noRecidCount} ${itemWord}.`,
            });
          }
          progressWindowNoRecid.show();
          progressWindowNoRecid.startCloseTimer(3000);
          this.error_norecid_shown = true;
        }
      } else {
        if (!this.final_count_shown) {
          this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
            closeOnClick: true,
          });
          this.progressWindow.win.changeHeadline("Finished", PLUGIN_ICON);
          if (operation === "full" || operation === "noabstract") {
            this.progressWindow.createLine({
              icon: PLUGIN_ICON,
              text: "INSPIRE metadata updated for " + this.counter + " items.",
              progress: 100,
            });
          } else if (operation === "citations") {
            this.progressWindow.createLine({
              icon: PLUGIN_ICON,
              text:
                "INSPIRE citations updated for " +
                this.counter +
                " items;\n" +
                "CrossRef citations updated for " +
                this.CrossRefcounter +
                " items.",
              progress: 100,
            });
          }
          this.progressWindow.show();
          this.progressWindow.startCloseTimer(3000);
          this.final_count_shown = true;
        }
      }
    }
  }

  cancelUpdate() {
    this.isCancelled = true;
    this.updateController?.abort();
    this.removeEscapeListener();
  }

  openAIWindowFromSelection(): void {
    try {
      const mainWindow = Zotero.getMainWindow();
      const pane = Zotero.getActiveZoteroPane?.();
      const selected = (pane?.getSelectedItems?.() as Zotero.Item[]) || [];
      const item = selected.find((it) => it && it.isRegularItem()) || null;
      if (!item) {
        Zotero.alert?.(mainWindow, "AI", "Select a regular item first.");
        return;
      }
      const recid = deriveRecidFromItem(item);
      if (!recid) {
        Zotero.alert?.(mainWindow, "AI", "Selected item has no INSPIRE recid.");
        return;
      }
      this.openOrFocusAIWindow({ seedItem: item, seedRecid: recid });
    } catch (err) {
      Zotero.debug?.(
        `[${config.addonName}] openAIWindowFromSelection error: ${err}`,
      );
    }
  }

  openAIWindowFromReaderSelection(params: {
    selection: ReaderSelectionPayload;
    reader?: any;
    mode?: "text" | "image";
  }): void {
    try {
      const mainWindow = Zotero.getMainWindow();
      const selection = params.selection;
      const parentItemID = Number(selection?.parentItemID);
      if (!Number.isFinite(parentItemID) || parentItemID <= 0) {
        Zotero.alert?.(
          mainWindow,
          "AI",
          "Cannot ask: invalid Zotero parent item for the selection.",
        );
        return;
      }

      const item = Zotero.Items.get(parentItemID);
      if (!item || !item.isRegularItem()) {
        Zotero.alert?.(
          mainWindow,
          "AI",
          "Cannot ask: failed to resolve the selected paper item.",
        );
        return;
      }

      const recid = deriveRecidFromItem(item);
      if (!recid) {
        Zotero.alert?.(mainWindow, "AI", "Selected item has no INSPIRE recid.");
        return;
      }

      const mode = params.mode === "image" ? "image" : "text";
      this.openOrFocusAIWindow({
        seedItem: item,
        seedRecid: recid,
        ask: { selection, reader: params.reader, mode },
      });
    } catch (err) {
      Zotero.debug?.(
        `[${config.addonName}] openAIWindowFromReaderSelection error: ${err}`,
      );
    }
  }

  private openOrFocusAIWindow(params: {
    seedItem: Zotero.Item;
    seedRecid: string;
    ask?: { selection: ReaderSelectionPayload; reader?: any; mode: "text" | "image" };
  }): void {
    const mainWindow = Zotero.getMainWindow();
    const url = `chrome://${config.addonRef}/content/aiWindow.xhtml`;
    const features = "chrome,resizable,centerscreen,width=1200,height=900";

    if (this.aiWindow && !this.aiWindow.closed) {
      try {
        this.aiWindow.focus();
        const existing = (this.aiWindow as any).__zinspireAiDialog as
          | AIDialog
          | undefined;
        const existingRecid =
          typeof (existing as any)?.getSeedRecid === "function"
            ? (existing as any).getSeedRecid()
            : (existing as any)?.seedRecid;
        if (existing && String(existingRecid || "") === params.seedRecid) {
          if (params.ask) {
            void this.runReaderAsk(existing, this.aiWindow.document, params.ask);
          }
          return;
        }

        this.renderAIWindow(this.aiWindow, params);
        return;
      } catch {
        // ignore
      }
    }

    const win = mainWindow.openDialog(
      url,
      "zoteroinspire-ai-window",
      features,
    ) as Window;
    this.aiWindow = win;
    let rendered = false;
    const tryRender = () => {
      if (rendered || win.closed) return;
      try {
        const doc = win.document;
        const href = String(
          (doc as any)?.location?.href || (doc as any)?.URL || "",
        );
        const looksLikeAiWindow =
          href.includes("aiWindow.xhtml") ||
          Boolean(doc?.getElementById?.("zinspire-ai-window-placeholder"));
        if (!looksLikeAiWindow || !doc.body) {
          return;
        }
        const readyState = String((doc as any)?.readyState || "");
        if (readyState && readyState !== "interactive" && readyState !== "complete") {
          return;
        }
        const ok = this.renderAIWindow(win, params);
        if (ok) {
          rendered = true;
        }
      } catch {
        // ignore
      }
    };

    // Try immediately, then retry on DOM lifecycle events and a longer poll.
    tryRender();
    try {
      win.addEventListener("DOMContentLoaded", tryRender);
      win.addEventListener("load", tryRender);
      win.addEventListener("pageshow", tryRender);
      win.document?.addEventListener?.("DOMContentLoaded", tryRender);
      win.document?.addEventListener?.("readystatechange", tryRender);
    } catch {
      // ignore
    }
    try {
      const start = Date.now();
      let warned = false;
      const poll = () => {
        if (rendered || win.closed) return;
        tryRender();
        if (rendered || win.closed) return;
        const elapsed = Date.now() - start;

        // If the user is stuck on "Loading…" for a while, show a hint.
        if (!warned && elapsed > 2000) {
          warned = true;
          try {
            const doc = win.document;
            const placeholder = doc?.getElementById?.(
              "zinspire-ai-window-placeholder",
            ) as HTMLElement | null;
            if (placeholder) {
              placeholder.textContent =
                "Still loading AI UI… (if this persists, open Debug Output and check for render errors)";
            }
          } catch {
            // ignore
          }
        }

        if (elapsed > 15000) {
          try {
            const doc = win.document;
            const placeholder = doc?.getElementById?.(
              "zinspire-ai-window-placeholder",
            ) as HTMLElement | null;
            if (placeholder) {
              const readyState = String((doc as any)?.readyState || "");
              const href = String(
                (doc as any)?.location?.href || (doc as any)?.URL || "",
              );
              placeholder.textContent = `Failed to load AI UI (timeout). readyState=${readyState}, url=${href}`;
            }
          } catch {
            // ignore
          }
          return;
        }

        try {
          win.setTimeout(poll, 100);
        } catch {
          setTimeout(poll, 100);
        }
      };
      win.setTimeout(poll, 50);
    } catch {
      // ignore
    }
    win.addEventListener(
      "unload",
      () => {
        if (this.aiWindow === win) this.aiWindow = undefined;
      },
      { once: true },
    );
  }

  private async runReaderAsk(
    dialog: AIDialog,
    doc: Document,
    ask: { selection: ReaderSelectionPayload; reader?: any; mode: "text" | "image" },
  ): Promise<void> {
    const selection = ask.selection;
    const mode = ask.mode === "image" ? "image" : "text";

    if (mode === "text") {
      await dialog.askFromReaderSelection({ selection, mode: "text" });
      return;
    }

    const mainWindow = Zotero.getMainWindow();
    const activeProfile = getActiveAIProfile();
    if (!profileSupportsImageInput(activeProfile)) {
      Zotero.alert?.(mainWindow, "AI", "模型不支持图像输入，将回退到文本问答。");
      await dialog.askFromReaderSelection({ selection, mode: "text" });
      return;
    }

    if (!ask.reader) {
      Zotero.alert?.(mainWindow, "AI", "无法访问 Reader 实例，回退到文本问答。");
      await dialog.askFromReaderSelection({ selection, mode: "text" });
      return;
    }

    const position = selection.position;
    if (!position) {
      Zotero.alert?.(mainWindow, "AI", "选区缺少位置信息，回退到文本问答。");
      await dialog.askFromReaderSelection({ selection, mode: "text" });
      return;
    }

    try {
      const images = await captureSelectionImagesFromReader({
        reader: ask.reader,
        position,
        doc,
        paddingPx: 8,
        maxDimPx: 1024,
      });
      await dialog.askFromReaderSelection({
        selection,
        mode: "image",
        images,
      });
    } catch (err: any) {
      Zotero.alert?.(
        mainWindow,
        "AI",
        `选区截图失败：${String(err?.message || err)}\n将回退到文本问答。`,
      );
      await dialog.askFromReaderSelection({ selection, mode: "text" });
    }
  }

  private renderAIWindow(
    win: Window,
    params: {
      seedItem: Zotero.Item;
      seedRecid: string;
      ask?: { selection: ReaderSelectionPayload; reader?: any; mode: "text" | "image" };
    },
  ): boolean {
    const ensurePlaceholder = (doc: Document): HTMLElement | null => {
      try {
        let el = doc.getElementById(
          "zinspire-ai-window-placeholder",
        ) as HTMLElement | null;
        if (el) return el;

        el = doc.createElement("div");
        el.id = "zinspire-ai-window-placeholder";
        el.textContent = "Loading AI…";
        el.style.position = "absolute";
        el.style.inset = "0";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.color = "var(--zotero-gray-6, #5b5b5f)";
        el.style.fontSize = "13px";

        const root =
          (doc.body as unknown as HTMLElement | null) ||
          (doc.documentElement as unknown as HTMLElement | null);
        root?.appendChild(el);
        return el;
      } catch {
        return null;
      }
    };

    try {
      const doc = win.document;
      const placeholder = ensurePlaceholder(doc);
      if (placeholder) {
        placeholder.textContent = placeholder.textContent || "Loading AI…";
        placeholder.style.display = "flex";
      }

      const existing = (win as any).__zinspireAiDialog as AIDialog | undefined;
      existing?.dispose();
      (win as any).__zinspireAiDialog = undefined;

      const overlay = doc.querySelector(
        ".zinspire-ai-dialog",
      ) as HTMLElement | null;
      overlay?.remove();

      const dialog = new AIDialog(doc, {
        seedItem: params.seedItem,
        seedRecid: params.seedRecid,
        mode: "window",
      });
      (win as any).__zinspireAiDialog = dialog;
      if (params.ask) {
        void this.runReaderAsk(dialog, doc, params.ask);
      }
      if (placeholder) {
        placeholder.style.display = "none";
      }
      return true;
    } catch (err) {
      try {
        const doc = win.document;
        const placeholder = ensurePlaceholder(doc);
        const overlay = doc.querySelector(
          ".zinspire-ai-dialog",
        ) as HTMLElement | null;
        overlay?.remove();
        if (placeholder) {
          placeholder.textContent = `Failed to render AI UI: ${String(err)}`;
          placeholder.style.display = "flex";
        }
      } catch {
        // ignore
      }
      Zotero.debug?.(`[${config.addonName}] renderAIWindow error: ${err}`);
      return false;
    }
  }

  /**
   * Setup global Escape key listener to cancel ongoing operations
   */
  private setupEscapeListener() {
    this.removeEscapeListener(); // Clean up any existing listener
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.cancelUpdate();
        Zotero.debug(
          `[${config.addonName}] Operation cancelled via Escape key`,
        );
      }
    };
    // Use Zotero main window for global key capture
    const win = Zotero.getMainWindow();
    if (win) {
      win.addEventListener("keydown", this.escapeHandler, true);
    }
  }

  /**
   * Remove the Escape key listener
   */
  private removeEscapeListener() {
    if (this.escapeHandler) {
      const win = Zotero.getMainWindow();
      if (win) {
        win.removeEventListener("keydown", this.escapeHandler, true);
      }
      this.escapeHandler = undefined;
    }
  }

  updateSelectedItems(operation: string) {
    this.resetState("initial");
    this.isCancelled = false;
    this.setupEscapeListener();
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
    this.toUpdate = items.length;
    this.itemsToUpdate = items;
    this.updateItemsConcurrent(operation);
  }

  updateSelectedCollection(operation: string) {
    this.resetState("initial");
    this.isCancelled = false;
    this.setupEscapeListener();
    const collection = Zotero.getActiveZoteroPane()?.getSelectedCollection();
    if (collection) {
      this.itemsToUpdate = collection.getChildItems();
      this.toUpdate = this.itemsToUpdate.length;
      this.updateItemsConcurrent(operation);
    } else {
      this.removeEscapeListener();
    }
  }

  private buildItemAuthorLabel(item: Zotero.Item): string | undefined {
    try {
      const creators: any[] = (item as any)?.getCreators?.() ?? [];
      const first = Array.isArray(creators) ? creators[0] : undefined;
      const lastNameRaw =
        (first?.lastName as string | undefined) ??
        (first?.name as string | undefined) ??
        "";
      const lastName =
        typeof lastNameRaw === "string" ? lastNameRaw.trim() : "";
      const authorPart = lastName
        ? creators.length > 1
          ? `${lastName} et al.`
          : lastName
        : "";
      const dateRaw = item.getField("date");
      const match =
        typeof dateRaw === "string" ? dateRaw.match(/(19|20)\d{2}/) : null;
      const year = match ? match[0] : "";
      if (year) {
        return authorPart ? `${authorPart} (${year})` : year;
      }
      return authorPart || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Open a combined citation graph dialog for the current item selection.
   * Requires at least 2 selected items with valid INSPIRE recids.
   */
  openCombinedCitationGraphFromSelection(): void {
    try {
      const items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
      const regularItems = items.filter((item) => item?.isRegularItem());

      const seeds: Array<{
        recid: string;
        title?: string;
        authorLabel?: string;
      }> = [];
      const seen = new Set<string>();
      const MAX_SEEDS = 10;

      for (const item of regularItems) {
        const recid = deriveRecidFromItem(item);
        if (!recid || seen.has(recid)) continue;
        seen.add(recid);
        const rawTitle = item.getField("title");
        const title = typeof rawTitle === "string" ? rawTitle : undefined;
        const authorLabel = this.buildItemAuthorLabel(item);
        seeds.push({ recid, title, authorLabel });
        if (seeds.length >= MAX_SEEDS) {
          break;
        }
      }

      if (seeds.length < 2) {
        this.showCacheNotification(
          getString("citation-graph-merge-no-selection") ||
            "Select at least two items with INSPIRE IDs to merge citation graphs.",
          "info",
        );
        return;
      }

      if (
        regularItems.length > seeds.length &&
        regularItems.length > MAX_SEEDS
      ) {
        this.showCacheNotification(
          getString("citation-graph-merge-truncated", {
            args: { count: MAX_SEEDS },
          }) ||
            `Selection is large; only the first ${MAX_SEEDS} seeds will be used.`,
          "info",
        );
      }

      const win = Zotero.getMainWindow();
      const doc = win?.document;
      if (!doc) {
        return;
      }

      void import("./panel/CitationGraphDialog")
        .then(({ CitationGraphDialog }) => {
          new CitationGraphDialog(doc, seeds);
        })
        .catch((err) => {
          Zotero.debug(
            `[${config.addonName}] Failed to load CitationGraphDialog: ${err}`,
          );
        });
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] openCombinedCitationGraphFromSelection error: ${err}`,
      );
    }
  }

  /**
   * Open a combined citation graph dialog for the currently selected collection.
   * Uses up to MAX_SEEDS items with valid INSPIRE recids.
   */
  openCombinedCitationGraphFromCollection(): void {
    try {
      const collection = Zotero.getActiveZoteroPane()?.getSelectedCollection();
      const items = collection?.getChildItems?.() ?? [];
      const regularItems = items.filter((item) => item?.isRegularItem());

      const seeds: Array<{
        recid: string;
        title?: string;
        authorLabel?: string;
      }> = [];
      const seen = new Set<string>();
      const MAX_SEEDS = 10;

      for (const item of regularItems) {
        const recid = deriveRecidFromItem(item);
        if (!recid || seen.has(recid)) continue;
        seen.add(recid);
        const rawTitle = item.getField("title");
        const title = typeof rawTitle === "string" ? rawTitle : undefined;
        const authorLabel = this.buildItemAuthorLabel(item);
        seeds.push({ recid, title, authorLabel });
        if (seeds.length >= MAX_SEEDS) {
          break;
        }
      }

      if (seeds.length < 2) {
        this.showCacheNotification(
          getString("citation-graph-merge-no-selection") ||
            "Select a collection with at least two items with INSPIRE IDs to merge citation graphs.",
          "info",
        );
        return;
      }

      if (regularItems.length > MAX_SEEDS) {
        this.showCacheNotification(
          getString("citation-graph-merge-truncated", {
            args: { count: MAX_SEEDS },
          }) || `Only the first ${MAX_SEEDS} seeds will be used.`,
          "info",
        );
      }

      const win = Zotero.getMainWindow();
      const doc = win?.document;
      if (!doc) {
        return;
      }

      void import("./panel/CitationGraphDialog")
        .then(({ CitationGraphDialog }) => {
          new CitationGraphDialog(doc, seeds);
        })
        .catch((err) => {
          Zotero.debug(
            `[${config.addonName}] Failed to load CitationGraphDialog: ${err}`,
          );
        });
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] openCombinedCitationGraphFromCollection error: ${err}`,
      );
    }
  }

  async downloadReferencesCacheForSelection() {
    try {
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForSelection: starting`,
      );
      if (!localCache.isEnabled()) {
        this.showCacheNotification(
          getString("download-cache-disabled"),
          "error",
        );
        return;
      }
      const items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
      const regularItems = items.filter((item) => item?.isRegularItem());
      if (!regularItems.length) {
        this.showCacheNotification(
          getString("download-cache-no-selection"),
          "error",
        );
        return;
      }
      // Reset cancel state and setup Escape listener
      this.isCancelled = false;
      this.setupEscapeListener();
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForSelection: calling prefetch for ${regularItems.length} items`,
      );
      await this.prefetchReferencesCache(regularItems);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForSelection: error: ${err}`,
      );
    } finally {
      this.removeEscapeListener();
    }
  }

  async downloadReferencesCacheForCollection() {
    try {
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForCollection: starting`,
      );
      if (!localCache.isEnabled()) {
        this.showCacheNotification(
          getString("download-cache-disabled"),
          "error",
        );
        return;
      }
      const collection = Zotero.getActiveZoteroPane()?.getSelectedCollection();
      if (!collection) {
        this.showCacheNotification(
          getString("download-cache-no-selection"),
          "error",
        );
        return;
      }
      const items = collection
        .getChildItems()
        .filter((item) => item?.isRegularItem());
      if (!items.length) {
        this.showCacheNotification(
          getString("download-cache-no-selection"),
          "error",
        );
        return;
      }
      // Reset cancel state and setup Escape listener
      this.isCancelled = false;
      this.setupEscapeListener();
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForCollection: calling prefetch for ${items.length} items`,
      );
      await this.prefetchReferencesCache(items);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForCollection: error: ${err}`,
      );
    } finally {
      this.removeEscapeListener();
    }
  }

  async updateItems(items: Zotero.Item[], operation: string) {
    this.resetState("initial");
    this.isCancelled = false;
    // Abort any previous update run
    this.updateController?.abort();
    this.updateController = createAbortController() ?? null;

    const filteredItems = items.filter((item) => item.isRegularItem());
    this.itemsToUpdate = filteredItems;
    this.toUpdate = filteredItems.length;
    this.updateItemsConcurrent(operation);
  }

  /**
   * Concurrent item processor with controlled parallelism
   */
  private async updateItemsConcurrent(operation: string) {
    const CONCURRENCY = 3;
    let completed = 0;
    const total = this.itemsToUpdate.length;

    if (!total) {
      this.resetState(operation);
      return;
    }

    // Show initial progress
    this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
      closeTime: -1,
    });
    // Note: Zotero 7 ProgressWindow headline does not display icons
    // Use icon in createLine instead to show plugin logo
    this.progressWindow.createLine({
      icon: PLUGIN_ICON,
      text: `Processing 0 of ${total} items...`,
      progress: 0,
    });
    this.progressWindow.show();

    // Create a queue of pending items
    const queue = [...this.itemsToUpdate];
    let index = 0;

    const worker = async () => {
      while (index < queue.length && !this.isCancelled) {
        const currentIndex = index++;
        const item = queue[currentIndex];

        if (!item || !item.isRegularItem()) {
          completed++;
          continue;
        }

        try {
          await this.updateItemInternal(
            item,
            operation,
            this.updateController?.signal,
          );
        } catch (err) {
          Zotero.debug(
            `[${config.addonName}] updateItemsConcurrent: error updating item ${item.id}: ${err}`,
          );
        }

        completed++;

        // Update progress
        if (!this.isCancelled) {
          const percent = Math.round((completed / total) * 100);
          this.progressWindow.changeLine({
            icon: PLUGIN_ICON,
            text: `Processing ${completed} of ${total} items...`,
            progress: percent,
          });
        }
      }
    };

    try {
      // Start concurrent workers
      const workers: Promise<void>[] = [];
      const workerCount = Math.min(CONCURRENCY, total);
      Zotero.debug(
        `[${config.addonName}] updateItemsConcurrent: starting ${workerCount} workers`,
      );
      for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
      }

      await Promise.all(workers);
      Zotero.debug(
        `[${config.addonName}] updateItemsConcurrent: all workers finished, completed=${completed}`,
      );

      // Finish
      if (!this.isCancelled) {
        this.progressWindow.close();
        this.numberOfUpdatedItems = total;
        this.current = total - 1;
        this.resetState(operation);
        Zotero.debug(
          `[${config.addonName}] updateItemsConcurrent: done, counter=${this.counter}`,
        );
      } else {
        // Cancelled - show stats
        this.progressWindow.close();
        this.numberOfUpdatedItems = total;
        this.current = total - 1;
        this.showCancelledStats(completed, total);
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] updateItemsConcurrent: fatal error: ${err}`,
      );
      try {
        this.progressWindow.close();
      } catch (_e) {
        /* ignore */
      }
      this.numberOfUpdatedItems = this.toUpdate;
    } finally {
      this.removeEscapeListener();
    }
  }

  /**
   * Show statistics when update was cancelled
   */
  private showCancelledStats(completed: number, total: number) {
    const statsWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    statsWindow.win.changeHeadline(getString("update-cancelled"), PLUGIN_ICON);
    statsWindow.createLine({
      icon: PLUGIN_ICON,
      text: getString("update-cancelled-stats", {
        args: { completed: completed.toString(), total: total.toString() },
      }),
    });
    statsWindow.show();
    statsWindow.startCloseTimer(5000);
  }

  private async prefetchReferencesCache(items: Zotero.Item[]): Promise<void> {
    Zotero.debug(
      `[${config.addonName}] prefetchReferencesCache: starting with ${items.length} items`,
    );
    const recidSet = new Set<string>();
    for (const item of items) {
      const recid = deriveRecidFromItem(item);
      if (recid) {
        recidSet.add(recid);
      }
    }
    Zotero.debug(
      `[${config.addonName}] prefetchReferencesCache: found ${recidSet.size} unique recids`,
    );

    if (!recidSet.size) {
      this.showCacheNotification(getString("download-cache-no-recid"), "error");
      return;
    }

    const total = recidSet.size;
    Zotero.debug(
      `[${config.addonName}] prefetchReferencesCache: creating progress window`,
    );
    const progressWindow = new ProgressWindowHelper(
      getString("download-cache-progress-title"),
    );
    progressWindow.win.changeHeadline(
      getString("download-cache-progress-title"),
      PLUGIN_ICON,
    );
    progressWindow.createLine({
      icon: PLUGIN_ICON,
      text: getString("download-cache-start", { args: { total } }),
      progress: 0,
    });
    progressWindow.show(-1); // Disable auto-close timer during download
    Zotero.debug(
      `[${config.addonName}] prefetchReferencesCache: progress window shown`,
    );

    let processed = 0;
    let success = 0;
    let failed = 0;

    for (const recid of recidSet) {
      // Check cancellation at start of each iteration
      if (this.isCancelled) {
        progressWindow.close();
        this.showCacheCancelledStats(success, total);
        return;
      }

      processed++;
      progressWindow.changeLine({
        icon: PLUGIN_ICON,
        text: getString("download-cache-progress", {
          args: { done: processed, total },
        }),
        progress: Math.round((processed / total) * 100),
      });

      try {
        const entries = await fetchReferencesEntries(recid);
        // Check again after async operation
        if (this.isCancelled) {
          progressWindow.close();
          this.showCacheCancelledStats(success, total);
          return;
        }
        // Enrich entries with complete metadata (title, authors, citation count)
        // This ensures cached data is complete and usable offline
        await enrichReferencesEntries(entries);
        if (this.isCancelled) {
          progressWindow.close();
          this.showCacheCancelledStats(success, total);
          return;
        }
        // Store without sort parameter (client-side sorting for references)
        // Pass total = entries.length since references data is always complete
        await localCache.set("refs", recid, entries, undefined, entries.length);
        success++;
      } catch (err) {
        failed++;
        Zotero.debug(
          `[${config.addonName}] Failed to cache references for ${recid}: ${err}`,
        );
      }
    }

    progressWindow.win.changeHeadline(
      getString("download-cache-progress-title"),
      PLUGIN_ICON,
    );
    progressWindow.createLine({
      icon: PLUGIN_ICON,
      text: getString("download-cache-success", { args: { success } }),
      type: "success",
    });
    if (failed > 0) {
      progressWindow.createLine({
        icon: PLUGIN_ICON,
        text: getString("download-cache-failed", { args: { failed } }),
        type: "error",
      });
    }
    progressWindow.startCloseTimer(4000);
  }

  /**
   * Show statistics when cache download was cancelled
   */
  private showCacheCancelledStats(completed: number, total: number) {
    const statsWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    statsWindow.win.changeHeadline(
      getString("download-cache-cancelled-title"),
      PLUGIN_ICON,
    );
    statsWindow.createLine({
      icon: PLUGIN_ICON,
      text: getString("download-cache-cancelled", {
        args: { done: completed.toString(), total: total.toString() },
      }),
    });
    statsWindow.show();
    statsWindow.startCloseTimer(5000);
  }

  private showCacheNotification(
    message: string,
    type: "info" | "error" = "info",
  ) {
    const window = new ProgressWindowHelper(config.addonName);
    window.win.changeHeadline(config.addonName, PLUGIN_ICON);
    window.createLine({ icon: PLUGIN_ICON, text: message, type });
    window.show();
    window.startCloseTimer(3000);
  }

  // Legacy serial method (kept for reference)
  updateNextItem(operation: string) {
    this.numberOfUpdatedItems++;

    if (this.current === this.toUpdate - 1) {
      this.progressWindow.close();
      this.resetState(operation);
      return;
    }

    this.current++;

    const percent = Math.round(
      (this.numberOfUpdatedItems / this.toUpdate) * 100,
    );
    this.progressWindow.changeLine({ icon: PLUGIN_ICON, progress: percent });
    this.progressWindow.changeLine({
      icon: PLUGIN_ICON,
      text: "Item " + this.current + " of " + this.toUpdate,
    });
    this.progressWindow.show();

    this.updateItem(this.itemsToUpdate[this.current], operation);
  }

  /**
   * Internal method to update a single item (used by concurrent processor)
   */
  private async updateItemInternal(
    item: Zotero.Item,
    operation: string,
    signal?: AbortSignal,
  ) {
    Zotero.debug(
      `[${config.addonName}] updateItemInternal: starting, item=${item.id}, operation=${operation}`,
    );
    if (
      operation === "full" ||
      operation === "noabstract" ||
      operation === "citations"
    ) {
      Zotero.debug(
        `[${config.addonName}] updateItemInternal: calling getInspireMeta`,
      );
      const metaInspire = await getInspireMeta(item, operation, signal);
      Zotero.debug(
        `[${config.addonName}] updateItemInternal: getInspireMeta returned, recid=${metaInspire !== -1 ? (metaInspire as jsobject).recid : "N/A"}`,
      );
      if (metaInspire !== -1 && (metaInspire as jsobject).recid !== undefined) {
        if (item.hasTag(getPref("tag_norecid") as string)) {
          item.removeTag(getPref("tag_norecid") as string);
        }
        if (item.itemType === "report" || item.itemType === "preprint") {
          item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
        }
        if (
          item.itemType !== "book" &&
          (metaInspire as jsobject).document_type == "book"
        ) {
          item.setType(Zotero.ItemTypes.getID("book") as number);
        }

        // Smart update mode: compare and filter changes
        if (isSmartUpdateEnabled()) {
          const diff = compareItemWithInspire(item, metaInspire as jsobject);
          if (diff.hasChanges) {
            const protectionConfig = getFieldProtectionConfig();
            let allowedChanges = filterProtectedChanges(diff, protectionConfig);
            const skippedCount = diff.changes.length - allowedChanges.length;

            if (skippedCount > 0) {
              Zotero.debug(
                `[${config.addonName}] Smart update: skipped ${skippedCount} protected fields`,
              );
            }

            if (allowedChanges.length > 0) {
              // Show preview dialog only for single-item updates (not batch)
              if (shouldShowPreview() && this.toUpdate === 1) {
                const result = await showSmartUpdatePreviewDialog(
                  diff,
                  allowedChanges,
                );
                if (!result.confirmed) {
                  Zotero.debug(
                    `[${config.addonName}] Smart update: user cancelled preview`,
                  );
                  return;
                }
                // Filter to only user-selected fields
                allowedChanges = allowedChanges.filter((c) =>
                  result.selectedFields.includes(c.field),
                );
                if (allowedChanges.length === 0) {
                  Zotero.debug(
                    `[${config.addonName}] Smart update: no fields selected by user`,
                  );
                  return;
                }
              }

              // Apply only allowed changes
              await setInspireMetaSelective(
                item,
                metaInspire as jsobject,
                operation,
                allowedChanges,
              );
              await saveItemWithPendingInspireNote(item);
              this.counter++;
            } else {
              Zotero.debug(
                `[${config.addonName}] Smart update: no changes to apply after filtering`,
              );
            }
          } else {
            Zotero.debug(
              `[${config.addonName}] Smart update: no changes detected`,
            );
          }
        } else {
          // Standard update mode
          await setInspireMeta(item, metaInspire as jsobject, operation);
          await saveItemWithPendingInspireNote(item);
          this.counter++;
        }
      } else {
        if (
          getPref("tag_enable") &&
          getPref("tag_norecid") !== "" &&
          !item.hasTag(getPref("tag_norecid") as string)
        ) {
          item.addTag(getPref("tag_norecid") as string, 1);
          await item.saveTx();
        } else if (
          !getPref("tag_enable") &&
          item.hasTag(getPref("tag_norecid") as string)
        ) {
          item.removeTag(getPref("tag_norecid") as string);
          await item.saveTx();
        }
        this.error_norecid = true;
        this.noRecidCount++;
        if (operation === "citations") {
          const crossref_count = await setCrossRefCitations(item);
          await item.saveTx();
          if (crossref_count >= 0) {
            this.CrossRefcounter++;
          }
        }
      }
    }
  }

  async updateItem(item: Zotero.Item, operation: string) {
    if (
      operation === "full" ||
      operation === "noabstract" ||
      operation === "citations"
    ) {
      const metaInspire = await getInspireMeta(item, operation);
      if (metaInspire !== -1 && (metaInspire as jsobject).recid !== undefined) {
        if (item.hasTag(getPref("tag_norecid") as string)) {
          item.removeTag(getPref("tag_norecid") as string);
          item.saveTx();
        }
        if (item.itemType === "report" || item.itemType === "preprint") {
          item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
        }
        if (
          item.itemType !== "book" &&
          (metaInspire as jsobject).document_type == "book"
        ) {
          item.setType(Zotero.ItemTypes.getID("book") as number);
        }
        await setInspireMeta(item, metaInspire as jsobject, operation);
        await saveItemWithPendingInspireNote(item);
        this.counter++;
      } else {
        if (
          getPref("tag_enable") &&
          getPref("tag_norecid") !== "" &&
          !item.hasTag(getPref("tag_norecid") as string)
        ) {
          item.addTag(getPref("tag_norecid") as string, 1);
          item.saveTx();
        } else if (
          !getPref("tag_enable") &&
          item.hasTag(getPref("tag_norecid") as string)
        ) {
          item.removeTag(getPref("tag_norecid") as string);
          item.saveTx();
        }
        this.error_norecid = true;
        this.noRecidCount++;
        if (operation == "citations") {
          const crossref_count = await setCrossRefCitations(item);
          item.saveTx();
          if (crossref_count >= 0) {
            this.CrossRefcounter++;
          }
        }
      }
      this.updateNextItem(operation);
    } else {
      this.updateNextItem(operation);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Context Menu Copy Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the single selected regular item, or show an error notification.
   * Returns null if selection is invalid.
   */
  private getSelectedSingleItem(): Zotero.Item | null {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
    const regularItems = items.filter((item) => item?.isRegularItem());
    if (regularItems.length !== 1) {
      this.showCopyNotification(getString("copy-error-no-selection"), "fail");
      return null;
    }
    return regularItems[0];
  }

  /**
   * Get all selected regular items. Shows an error if none are selected.
   */
  private getSelectedRegularItems(): Zotero.Item[] {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
    const regularItems = items.filter((item) => item?.isRegularItem());
    if (!regularItems.length) {
      this.showCopyNotification(getString("copy-error-no-selection"), "fail");
    }
    return regularItems;
  }

  /**
   * Get selected items for funding extraction (regular items or PDF attachments).
   * Shows an error if no valid items are selected.
   */
  private getSelectedItemsForFunding(): Zotero.Item[] {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
    const validItems = items.filter(
      (item) => item?.isRegularItem() || item?.isPDFAttachment(),
    );
    if (!validItems.length) {
      this.showCopyNotification(getString("funding-no-selection"), "fail");
    }
    return validItems;
  }

  /**
   * Show a brief notification for copy actions.
   */
  private showCopyNotification(
    message: string,
    type: "success" | "fail" = "success",
  ) {
    const window = new ProgressWindowHelper(config.addonName);
    window.createLine({ icon: PLUGIN_ICON, text: message, type });
    window.show();
    window.startCloseTimer(2500);
  }

  /**
   * Copy BibTeX from INSPIRE for the selected item.
   */
  async copyBibTeX() {
    const items = this.getSelectedRegularItems();
    if (!items.length) return;

    const recids = Array.from(
      new Set(
        items
          .map((item) => deriveRecidFromItem(item))
          .filter((recid): recid is string => !!recid),
      ),
    );

    if (!recids.length) {
      this.showCopyNotification(getString("copy-error-no-recid"), "fail");
      return;
    }

    try {
      const bibtex =
        recids.length === 1
          ? await fetchBibTeX(recids[0])
          : await this.fetchBibTeXBatch(recids);
      if (!bibtex) {
        this.showCopyNotification(
          getString("copy-error-bibtex-failed"),
          "fail",
        );
        return;
      }
      const entryCount = this.countBibTeXEntries(bibtex) || recids.length;
      const success = await copyToClipboard(bibtex);
      if (success) {
        this.showCopyNotification(
          getString("copy-success-bibtex", { args: { count: entryCount } }),
          "success",
        );
      } else {
        this.showCopyNotification(
          getString("copy-error-clipboard-failed"),
          "fail",
        );
      }
    } catch (err) {
      Zotero.debug(`[${config.addonName}] copyBibTeX error: ${err}`);
      this.showCopyNotification(getString("copy-error-bibtex-failed"), "fail");
    }
  }

  /**
   * Copy INSPIRE literature URL for the selected item.
   */
  async copyInspireLink() {
    const item = this.getSelectedSingleItem();
    if (!item) return;

    const recid = deriveRecidFromItem(item);
    if (!recid) {
      this.showCopyNotification(getString("copy-error-no-recid"), "fail");
      return;
    }

    const url = `${INSPIRE_LITERATURE_URL}/${recid}`;
    const success = await copyToClipboard(url);
    if (success) {
      this.showCopyNotification(
        getString("copy-success-inspire-link"),
        "success",
      );
    } else {
      this.showCopyNotification(
        getString("copy-error-clipboard-failed"),
        "fail",
      );
    }
  }

  /**
   * Copy INSPIRE link as Markdown format: [citation_key](url)
   */
  async copyInspireLinkMarkdown() {
    const item = this.getSelectedSingleItem();
    if (!item) return;

    const recid = deriveRecidFromItem(item);
    if (!recid) {
      this.showCopyNotification(getString("copy-error-no-recid"), "fail");
      return;
    }

    const citationKey = (
      item.getField("citationKey") as string | undefined
    )?.trim();
    if (!citationKey) {
      this.showCopyNotification(
        getString("copy-error-no-citation-key"),
        "fail",
      );
      return;
    }

    const url = `${INSPIRE_LITERATURE_URL}/${recid}`;
    const markdown = `[${citationKey}](${url})`;
    const success = await copyToClipboard(markdown);
    if (success) {
      this.showCopyNotification(
        getString("copy-success-inspire-link-md"),
        "success",
      );
    } else {
      this.showCopyNotification(
        getString("copy-error-clipboard-failed"),
        "fail",
      );
    }
  }

  /**
   * Copy citation key for the selected item.
   */
  async copyCitationKey() {
    const items = this.getSelectedRegularItems();
    if (!items.length) return;

    const citationKeys = items
      .map((item) =>
        (item.getField("citationKey") as string | undefined)?.trim(),
      )
      .filter((key): key is string => !!key);

    if (!citationKeys.length) {
      this.showCopyNotification(
        getString("copy-error-no-citation-key"),
        "fail",
      );
      return;
    }

    const copiedCount = citationKeys.length;
    const success = await copyToClipboard(citationKeys.join(", "));
    if (success) {
      this.showCopyNotification(
        getString("copy-success-citation-key", {
          args: { count: copiedCount },
        }),
        "success",
      );
    } else {
      this.showCopyNotification(
        getString("copy-error-clipboard-failed"),
        "fail",
      );
    }
  }

  /**
   * Copy Zotero select link for the selected item.
   * Format: zotero://select/library/items/KEY or zotero://select/groups/GROUPID/items/KEY
   */
  async copyZoteroLink() {
    const item = this.getSelectedSingleItem();
    if (!item) return;

    const libraryID = item.libraryID;
    const key = item.key;
    let link: string;

    // Check if this is a group library
    const library = Zotero.Libraries.get(libraryID);
    if (library && library.libraryType === "group") {
      // Group library format: zotero://select/groups/GROUPID/items/KEY
      // TypeScript types don't include groupID but it exists at runtime for group libraries
      const groupID = (library as any).groupID;
      link = `zotero://select/groups/${groupID}/items/${key}`;
    } else {
      // Personal library format: zotero://select/library/items/KEY
      link = `zotero://select/library/items/${key}`;
    }

    const success = await copyToClipboard(link);
    if (success) {
      this.showCopyNotification(
        getString("copy-success-zotero-link"),
        "success",
      );
    } else {
      this.showCopyNotification(
        getString("copy-error-clipboard-failed"),
        "fail",
      );
    }
  }

  /**
   * Copy funding info from PDF acknowledgments.
   * Supports both regular items and PDF attachments directly.
   */
  async copyFundingInfo() {
    const items = this.getSelectedItemsForFunding();
    if (!items.length) return;
    await copyFundingInfo(items);
  }

  /**
   * Toggle favorite paper status for selected item from main window menu.
   * FTR-FAVORITE-PAPERS
   */
  /**
   * Toggle favorite paper or presentation status for selected item from main window menu.
   * FTR-FAVORITE-PAPERS / FTR-FAVORITE-PRESENTATIONS
   */
  toggleFavoritePaperFromMenu() {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems?.() ?? [];
    if (!items || items.length !== 1) {
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({
          text: getString("references-panel-favorite-paper-select-one"),
          type: "default",
        })
        .show();
      return;
    }
    const item = items[0];
    if (!item.isRegularItem()) return;

    const recid = deriveRecidFromItem(item);
    const isPresentation = item.itemType === "presentation";
    const prefKey = isPresentation
      ? "favorite_presentations"
      : "favorite_papers";

    // Get current favorites
    const json = getPref(prefKey) as string;
    let favorites: FavoritePaper[];
    try {
      favorites = JSON.parse(json || "[]");
    } catch {
      favorites = [];
    }

    // Check if already favorite - match by recid if available, otherwise by itemID
    const existingIndex = favorites.findIndex(
      (f) => (recid && f.recid === recid) || (item.id && f.itemID === item.id),
    );
    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1);
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({
          text: getString(
            isPresentation
              ? "references-panel-favorite-presentation-removed"
              : "references-panel-favorite-paper-removed",
          ),
          type: "success",
        })
        .show();
    } else {
      // Get item info
      const title = item.getField("title") as string;
      const creators = item.getCreators();
      const creatorType = isPresentation ? "presenter" : "author";
      const creatorTypeID = Zotero.CreatorTypes.getID(creatorType);
      const firstCreator = creators.find(
        (c) => c.creatorTypeID === creatorTypeID,
      );
      const creatorCount = creators.filter(
        (c) => c.creatorTypeID === creatorTypeID,
      ).length;
      const authors = firstCreator
        ? creatorCount > 1
          ? `${firstCreator.lastName} et al.`
          : firstCreator.lastName
        : undefined;
      const year = parseInt(item.getField("year") as string, 10) || undefined;

      favorites.push({
        recid: recid || undefined,
        itemID: item.id,
        title: title || "Untitled",
        authors,
        year,
        addedAt: Date.now(),
      });
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({
          text: getString(
            isPresentation
              ? "references-panel-favorite-presentation-added"
              : "references-panel-favorite-paper-added",
          ),
          type: "success",
        })
        .show();
    }

    setPref(prefKey, JSON.stringify(favorites));
  }

  /**
   * Fetch BibTeX for multiple recids in batches and concatenate results.
   */
  private async fetchBibTeXBatch(recids: string[]): Promise<string | null> {
    const BATCH_SIZE = 50;
    const allContent: string[] = [];

    for (let i = 0; i < recids.length; i += BATCH_SIZE) {
      const batch = recids.slice(i, i + BATCH_SIZE);
      const query = batch.map((r) => `recid:${r}`).join(" OR ");
      const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${batch.length}&format=bibtex`;

      try {
        const response = await inspireFetch(url).catch(() => null);
        if (!response || !response.ok) {
          continue;
        }
        const content = (await response.text())?.trim();
        if (content) {
          allContent.push(content);
        }
      } catch (_err) {
        // Continue to next batch on failure
      }
    }

    if (!allContent.length) {
      return null;
    }

    // If some batches failed, still return what we have; caller decides success/failure display.
    return allContent.join("\n\n");
  }

  /**
   * Count BibTeX entries in a blob of BibTeX text.
   */
  private countBibTeXEntries(content: string): number {
    const matches = content.match(/@\w+\s*\{/g);
    return matches ? matches.length : 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Preprint Watch Methods (FTR-PREPRINT-WATCH)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Show results from background preprint check.
   * Called from hooks.ts when background check finds published preprints.
   * This allows users to review and update items even from automatic checks.
   */
  async showBackgroundPreprintResults(
    results: PreprintCheckResult[],
  ): Promise<void> {
    const summary = buildCheckSummary(results);
    const { selectedItemIDs, cancelled } =
      await this.showPreprintCheckResultsDialog(summary);

    if (cancelled || selectedItemIDs.length === 0) return;

    // Filter results to only selected items
    const selectedResults = summary.results.filter(
      (r) => selectedItemIDs.includes(r.itemID) && r.status === "published",
    );

    // Perform updates
    const updateResult = await batchUpdatePreprints(selectedResults);

    // Show completion notification
    this.showPreprintNotification(
      getString("preprint-update-success", {
        args: { count: updateResult.success },
      }),
      "success",
    );
  }

  /**
   * Check preprint status for selected items.
   * Main entry point from item context menu.
   */
  async checkSelectedItemsPreprints(): Promise<void> {
    Zotero.debug(`[${config.addonName}] checkSelectedItemsPreprints: starting`);

    try {
      const items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
      Zotero.debug(
        `[${config.addonName}] checkSelectedItemsPreprints: selected ${items.length} items`,
      );

      if (!items.length) {
        Zotero.debug(
          `[${config.addonName}] checkSelectedItemsPreprints: no items selected, returning`,
        );
        return;
      }

      // Filter to unpublished preprints only
      const preprints = items.filter((item) => {
        const result = isUnpublishedPreprint(item);
        Zotero.debug(
          `[${config.addonName}] isUnpublishedPreprint for "${item.getField("title")}": ${result}, itemType=${item.itemType}, journalAbbrev="${item.getField("journalAbbreviation")}", DOI="${item.getField("DOI")}"`,
        );
        return result;
      });

      Zotero.debug(
        `[${config.addonName}] checkSelectedItemsPreprints: found ${preprints.length} unpublished preprints`,
      );

      if (preprints.length === 0) {
        Zotero.debug(
          `[${config.addonName}] checkSelectedItemsPreprints: no preprints, showing notification`,
        );
        this.showPreprintNotification(
          getString("preprint-no-preprints"),
          "default",
        );
        return;
      }

      await this.checkPreprintsWithProgressAndDialog(preprints);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] checkSelectedItemsPreprints error: ${err}`,
      );
    }
  }

  /**
   * Check preprints in selected collection.
   * Entry point from collection context menu.
   */
  async checkPreprintsInCollection(): Promise<void> {
    Zotero.debug(`[${config.addonName}] checkPreprintsInCollection: starting`);
    const collection = Zotero.getActiveZoteroPane()?.getSelectedCollection();
    if (!collection) {
      Zotero.debug(
        `[${config.addonName}] checkPreprintsInCollection: no collection selected`,
      );
      return;
    }

    // Show scanning progress
    Zotero.debug(
      `[${config.addonName}] checkPreprintsInCollection: showing scan progress`,
    );
    const scanProgress = new ProgressWindowHelper(config.addonName);
    scanProgress.createLine({
      icon: PLUGIN_ICON,
      text: getString("preprint-check-scanning"),
      progress: 0,
    });
    scanProgress.show(-1);

    try {
      const preprints = await findUnpublishedPreprints(
        collection.libraryID,
        collection.id,
      );
      scanProgress.close();
      Zotero.debug(
        `[${config.addonName}] checkPreprintsInCollection: found ${preprints.length} preprints`,
      );

      if (preprints.length === 0) {
        this.showPreprintNotification(
          getString("preprint-no-preprints"),
          "default",
        );
        return;
      }

      await this.checkPreprintsWithProgressAndDialog(preprints);
    } catch (err) {
      scanProgress.close();
      Zotero.debug(
        `[${config.addonName}] checkPreprintsInCollection error: ${err}`,
      );
    }
  }

  /**
   * Check all preprints in user library.
   * Entry point from collection context menu.
   */
  async checkAllPreprintsInLibrary(): Promise<void> {
    Zotero.debug(`[${config.addonName}] checkAllPreprintsInLibrary: starting`);

    // Show scanning progress
    const scanProgress = new ProgressWindowHelper(config.addonName);
    scanProgress.createLine({
      icon: PLUGIN_ICON,
      text: getString("preprint-check-scanning"),
      progress: 0,
    });
    scanProgress.show(-1);

    try {
      const preprints = await findUnpublishedPreprints();
      scanProgress.close();
      Zotero.debug(
        `[${config.addonName}] checkAllPreprintsInLibrary: found ${preprints.length} preprints`,
      );

      if (preprints.length === 0) {
        this.showPreprintNotification(
          getString("preprint-no-preprints"),
          "default",
        );
        return;
      }

      await this.checkPreprintsWithProgressAndDialog(preprints);
    } catch (err) {
      scanProgress.close();
      Zotero.debug(
        `[${config.addonName}] checkAllPreprintsInLibrary error: ${err}`,
      );
    }
  }

  /**
   * Check preprints with progress display and results dialog.
   * Shared implementation for all check entry points.
   */
  private async checkPreprintsWithProgressAndDialog(
    preprints: Zotero.Item[],
  ): Promise<void> {
    Zotero.debug(
      `[${config.addonName}] checkPreprintsWithProgressAndDialog: starting with ${preprints.length} preprints`,
    );

    const abortController = createAbortController() ?? null;

    this.isCancelled = false;
    this.setupEscapeListener();

    // Override cancel handler to also abort the controller
    const originalCancelUpdate = this.cancelUpdate.bind(this);
    this.cancelUpdate = () => {
      abortController?.abort();
      originalCancelUpdate();
    };

    const progressWindow = new ProgressWindowHelper(config.addonName);
    progressWindow.createLine({
      icon: PLUGIN_ICON,
      text: getString("preprint-check-progress", {
        args: { current: 0, total: preprints.length },
      }),
      progress: 0,
    });
    progressWindow.show(-1);
    Zotero.debug(
      `[${config.addonName}] checkPreprintsWithProgressAndDialog: progress window shown`,
    );

    try {
      const results = await batchCheckPublicationStatus(preprints, {
        signal: abortController?.signal,
        onProgress: (current, total, _found) => {
          // Also check isCancelled flag for environments without AbortController
          if (this.isCancelled) return;
          progressWindow.changeLine({
            icon: PLUGIN_ICON,
            text: getString("preprint-check-progress", {
              args: { current, total },
            }),
            progress: Math.round((current / total) * 100),
          });
        },
      });
      // Note: batchCheckPublicationStatus updates cache internally

      Zotero.debug(
        `[${config.addonName}] checkPreprintsWithProgressAndDialog: check completed, closing progress`,
      );
      progressWindow.close();
      this.removeEscapeListener();

      if (this.isCancelled) {
        this.showPreprintNotification(
          getString("preprint-check-cancelled"),
          "fail",
        );
        return;
      }

      const summary = buildCheckSummary(results);
      const { selectedItemIDs, cancelled } =
        await this.showPreprintCheckResultsDialog(summary);

      if (cancelled || selectedItemIDs.length === 0) return;

      // Filter results to only selected items
      const selectedResults = summary.results.filter(
        (r) => selectedItemIDs.includes(r.itemID) && r.status === "published",
      );

      // Perform updates
      const updateResult = await batchUpdatePreprints(selectedResults);

      // Show completion notification
      this.showPreprintNotification(
        getString("preprint-update-success", {
          args: { count: updateResult.success },
        }),
        "success",
      );
    } catch (err: any) {
      progressWindow.close();
      this.removeEscapeListener();
      if (err.name === "AbortError") {
        this.showPreprintNotification(
          getString("preprint-check-cancelled"),
          "fail",
        );
      } else {
        Zotero.debug(
          `[${config.addonName}] checkPreprintsWithProgressAndDialog error: ${err}`,
        );
      }
    }
  }

  /**
   * Show preprint check results dialog.
   * Allows user to select which items to update.
   */
  private async showPreprintCheckResultsDialog(
    summary: PreprintCheckSummary,
  ): Promise<{ selectedItemIDs: number[]; cancelled: boolean }> {
    return new Promise((resolve) => {
      const win = Zotero.getMainWindow();
      if (!win) {
        resolve({ selectedItemIDs: [], cancelled: true });
        return;
      }

      const doc = win.document;
      const publishedResults = summary.results.filter(
        (r) => r.status === "published" && r.publicationInfo,
      );

      // If no published items found, show simple notification
      if (publishedResults.length === 0) {
        this.showPreprintNotification(
          getString("preprint-all-current"),
          "default",
        );
        resolve({ selectedItemIDs: [], cancelled: false });
        return;
      }

      // Create overlay
      const overlay = doc.createElement("div");
      overlay.id = "zinspire-preprint-results-overlay";
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        z-index: 10000; background-color: rgba(0, 0, 0, 0.4);
        display: flex; align-items: center; justify-content: center;
      `;

      // Create panel
      const panel = doc.createElement("div");
      panel.style.cssText = `
        background-color: var(--material-background, #fff);
        color: var(--fill-primary, #000);
        border: 1px solid var(--fill-quinary, #ccc);
        border-radius: 8px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
        display: flex; flex-direction: column; font-size: 13px;
        max-width: 600px; width: 90%; max-height: 70vh; overflow: hidden;
      `;
      overlay.appendChild(panel);

      // Header
      const header = doc.createElement("div");
      header.style.cssText = `
        padding: 12px 16px; font-weight: 600; font-size: 14px;
        border-bottom: 1px solid var(--fill-quinary, #eee);
        background-color: var(--material-sidepane, #f5f5f5);
        border-radius: 8px 8px 0 0;
      `;
      header.textContent = getString("preprint-found-published", {
        args: { count: publishedResults.length },
      });
      panel.appendChild(header);

      // Summary bar
      const summaryBar = doc.createElement("div");
      summaryBar.style.cssText = `
        padding: 8px 16px; font-size: 12px;
        color: var(--fill-secondary, #666);
        border-bottom: 1px solid var(--fill-quinary, #eee);
        display: flex; gap: 16px;
      `;
      const publishedSpan = doc.createElement("span");
      publishedSpan.textContent = `${getString("preprint-results-published")}: ${summary.published}`;
      const unpublishedSpan = doc.createElement("span");
      unpublishedSpan.textContent = `${getString("preprint-results-unpublished")}: ${summary.unpublished}`;
      const errorsSpan = doc.createElement("span");
      errorsSpan.textContent = `${getString("preprint-results-errors")}: ${summary.errors}`;
      summaryBar.append(publishedSpan, unpublishedSpan, errorsSpan);
      panel.appendChild(summaryBar);

      // List container
      const listContainer = doc.createElement("div");
      listContainer.style.cssText = `flex: 1; overflow-y: auto; padding: 8px 16px;`;
      panel.appendChild(listContainer);

      // Track selected items (all selected by default)
      const selectedIDs = new Set<number>(
        publishedResults.map((r) => r.itemID),
      );

      // Create rows for each published item using DocumentFragment for batching
      const fragment = doc.createDocumentFragment();
      for (const result of publishedResults) {
        const row = this.createPreprintResultRow(doc, result, selectedIDs);
        fragment.appendChild(row);
      }
      listContainer.appendChild(fragment);

      // Actions bar
      const actions = doc.createElement("div");
      actions.style.cssText = `
        padding: 12px 16px; display: flex; justify-content: space-between;
        align-items: center; gap: 8px;
        border-top: 1px solid var(--fill-quinary, #eee);
        background-color: var(--material-sidepane, #f5f5f5);
        border-radius: 0 0 8px 8px;
      `;

      // Select all checkbox
      const selectAllContainer = doc.createElement("label");
      selectAllContainer.style.cssText = `display: flex; align-items: center; gap: 6px; cursor: pointer;`;
      const selectAllCheckbox = doc.createElement("input");
      selectAllCheckbox.type = "checkbox";
      selectAllCheckbox.checked = true;
      selectAllCheckbox.addEventListener("change", () => {
        const checkboxes = listContainer.querySelectorAll(
          'input[type="checkbox"]',
        );
        checkboxes.forEach((cb: any) => {
          cb.checked = selectAllCheckbox.checked;
          const itemID = parseInt(cb.dataset.itemId, 10);
          if (selectAllCheckbox.checked) {
            selectedIDs.add(itemID);
          } else {
            selectedIDs.delete(itemID);
          }
        });
      });
      selectAllContainer.appendChild(selectAllCheckbox);
      selectAllContainer.appendChild(
        doc.createTextNode(getString("preprint-select-all")),
      );
      actions.appendChild(selectAllContainer);

      // Button container
      const buttonContainer = doc.createElement("div");
      buttonContainer.style.cssText = `display: flex; gap: 8px;`;

      // Cancel button
      const cancelBtn = doc.createElement("button");
      cancelBtn.textContent = getString("preprint-cancel");
      cancelBtn.style.cssText = `
        padding: 6px 16px; min-width: 80px;
        border: 1px solid var(--fill-quinary, #ccc);
        border-radius: 4px; background-color: var(--material-background, #fff);
        cursor: pointer; font-size: 13px;
      `;
      buttonContainer.appendChild(cancelBtn);

      // Update button
      const updateBtn = doc.createElement("button");
      updateBtn.textContent = getString("preprint-update-selected");
      updateBtn.style.cssText = `
        padding: 6px 16px; min-width: 80px; border: none;
        border-radius: 4px; background-color: #0066cc; color: #fff;
        cursor: pointer; font-size: 13px; font-weight: 500;
      `;
      buttonContainer.appendChild(updateBtn);
      actions.appendChild(buttonContainer);
      panel.appendChild(actions);

      // Add to document (XUL vs HTML host docs differ; prefer <body> when present)
      (doc.body || doc.documentElement).appendChild(overlay);

      // Event handlers
      let isFinished = false;
      const finish = (cancelled: boolean) => {
        if (isFinished) return;
        isFinished = true;
        overlay.remove();
        doc.removeEventListener("keydown", onKeyDown, true);
        resolve({
          selectedItemIDs: cancelled ? [] : Array.from(selectedIDs),
          cancelled,
        });
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(true);
        }
      };

      cancelBtn.addEventListener("click", () => finish(true));
      updateBtn.addEventListener("click", () => finish(false));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) finish(true);
      });
      doc.addEventListener("keydown", onKeyDown, true);
    });
  }

  /**
   * Create a row for a single preprint result item.
   */
  private createPreprintResultRow(
    doc: Document,
    result: PreprintCheckResult,
    selectedIDs: Set<number>,
  ): HTMLElement {
    const row = doc.createElement("div");
    row.style.cssText = `
      display: flex; align-items: flex-start; padding: 10px;
      margin-bottom: 8px; border-radius: 6px;
      background-color: var(--material-background, #fafafa);
      border: 1px solid var(--fill-quinary, #e0e0e0);
    `;

    // Checkbox
    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.itemId = String(result.itemID);
    checkbox.style.cssText = `margin-right: 10px; margin-top: 3px; cursor: pointer;`;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedIDs.add(result.itemID);
      } else {
        selectedIDs.delete(result.itemID);
      }
    });
    row.appendChild(checkbox);

    // Content
    const content = doc.createElement("div");
    content.style.cssText = `flex: 1; min-width: 0;`;

    // Title
    const titleDiv = doc.createElement("div");
    titleDiv.style.cssText = `font-weight: 500; margin-bottom: 4px; word-break: break-word;`;
    titleDiv.textContent = result.title || `arXiv:${result.arxivId}`;
    content.appendChild(titleDiv);

    // Publication info
    if (result.publicationInfo) {
      const pubInfo = result.publicationInfo;
      const infoDiv = doc.createElement("div");
      infoDiv.style.cssText = `font-size: 12px; color: var(--fill-secondary, #666);`;

      const journalInfo = [
        pubInfo.journalTitle,
        pubInfo.volume,
        pubInfo.pageStart ? `${pubInfo.pageStart}` : null,
        pubInfo.year ? `(${pubInfo.year})` : null,
      ]
        .filter(Boolean)
        .join(" ");

      const journalLine = doc.createElement("div");
      journalLine.style.color = "#16a34a";
      journalLine.style.marginBottom = "2px";
      journalLine.textContent = `\u2192 ${journalInfo}`;
      infoDiv.appendChild(journalLine);

      if (pubInfo.doi) {
        const doiLine = doc.createElement("div");
        doiLine.textContent = `DOI: ${pubInfo.doi}`;
        infoDiv.appendChild(doiLine);
      }
      content.appendChild(infoDiv);
    }

    row.appendChild(content);
    return row;
  }

  /**
   * Show a notification for preprint operations.
   */
  private showPreprintNotification(
    text: string,
    type: "success" | "fail" | "default",
  ): void {
    Zotero.debug(
      `[${config.addonName}] showPreprintNotification: "${text}", type=${type}`,
    );
    const progressWindow = new ProgressWindowHelper(config.addonName);
    const icon =
      type === "fail" ? "chrome://zotero/skin/cross.png" : PLUGIN_ICON;
    progressWindow.createLine({
      text,
      icon,
      type: type === "default" ? "success" : type,
    });
    progressWindow.show();
    progressWindow.startCloseTimer(2500);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Collaboration Tags Methods (FTR-COLLAB-TAGS)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add collaboration tags to selected items.
   * Entry point from item context menu.
   */
  async addCollabTagsToSelection(): Promise<void> {
    Zotero.debug(`[${config.addonName}] addCollabTagsToSelection: starting`);

    if (!isCollabTagEnabled()) {
      this.showCollabTagNotification(getString("collab-tag-disabled"), "fail");
      return;
    }

    const items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
    const regularItems = items.filter((item) => item?.isRegularItem());

    if (!regularItems.length) {
      this.showCollabTagNotification(
        getString("collab-tag-no-selection"),
        "fail",
      );
      return;
    }

    // Show progress
    const progressWindow = new ProgressWindowHelper(config.addonName);
    progressWindow.createLine({
      icon: PLUGIN_ICON,
      text: getString("collab-tag-progress"),
      progress: 0,
    });
    progressWindow.show(-1);

    try {
      const result = await batchAddCollabTags(regularItems, (done, total) => {
        progressWindow.changeLine({
          icon: PLUGIN_ICON,
          text: getString("collab-tag-progress"),
          progress: Math.round((done / total) * 100),
        });
      });

      progressWindow.close();

      // Show result notification
      this.showCollabTagNotification(
        getString("collab-tag-result", {
          args: {
            added: result.added,
            updated: result.updated,
            skipped: result.skipped,
          },
        }),
        result.added > 0 || result.updated > 0 ? "success" : "default",
      );
    } catch (err) {
      progressWindow.close();
      Zotero.debug(
        `[${config.addonName}] addCollabTagsToSelection error: ${err}`,
      );
      this.showCollabTagNotification(
        getString("collab-tag-result", {
          args: { added: 0, updated: 0, skipped: 0 },
        }),
        "fail",
      );
    }
  }

  /**
   * Reapply collaboration tags to all items in selected collection.
   * Entry point from collection context menu.
   */
  async reapplyCollabTagsToCollection(): Promise<void> {
    Zotero.debug(
      `[${config.addonName}] reapplyCollabTagsToCollection: starting`,
    );

    if (!isCollabTagEnabled()) {
      this.showCollabTagNotification(getString("collab-tag-disabled"), "fail");
      return;
    }

    const collection = Zotero.getActiveZoteroPane()?.getSelectedCollection();
    if (!collection) {
      this.showCollabTagNotification(
        getString("collab-tag-no-selection"),
        "fail",
      );
      return;
    }

    const items = collection
      .getChildItems()
      .filter((item) => item?.isRegularItem());

    if (!items.length) {
      this.showCollabTagNotification(
        getString("collab-tag-no-selection"),
        "fail",
      );
      return;
    }

    // Show progress
    const progressWindow = new ProgressWindowHelper(config.addonName);
    progressWindow.createLine({
      icon: PLUGIN_ICON,
      text: getString("collab-tag-progress"),
      progress: 0,
    });
    progressWindow.show(-1);

    try {
      const result = await batchAddCollabTags(items, (done, total) => {
        progressWindow.changeLine({
          icon: PLUGIN_ICON,
          text: getString("collab-tag-progress"),
          progress: Math.round((done / total) * 100),
        });
      });

      progressWindow.close();

      // Show result notification
      this.showCollabTagNotification(
        getString("collab-tag-result", {
          args: {
            added: result.added,
            updated: result.updated,
            skipped: result.skipped,
          },
        }),
        result.added > 0 || result.updated > 0 ? "success" : "default",
      );
    } catch (err) {
      progressWindow.close();
      Zotero.debug(
        `[${config.addonName}] reapplyCollabTagsToCollection error: ${err}`,
      );
      this.showCollabTagNotification(
        getString("collab-tag-result", {
          args: { added: 0, updated: 0, skipped: 0 },
        }),
        "fail",
      );
    }
  }

  /**
   * Show a notification for collaboration tag operations.
   */
  private showCollabTagNotification(
    text: string,
    type: "success" | "fail" | "default",
  ): void {
    const progressWindow = new ProgressWindowHelper(config.addonName);
    const icon =
      type === "fail" ? "chrome://zotero/skin/cross.png" : PLUGIN_ICON;
    progressWindow.createLine({
      text,
      icon,
      type: type === "default" ? "success" : type,
    });
    progressWindow.show();
    progressWindow.startCloseTimer(3000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Item Metadata Setting
// ─────────────────────────────────────────────────────────────────────────────

export async function setInspireMeta(
  item: Zotero.Item,
  metaInspire: jsobject,
  operation: string,
) {
  let extra = item.getField("extra") as string;
  const publication = item.getField("publicationTitle") as string;
  const citekey_pref = getPref("citekey");
  const arxivInJournalAbbrev = getPref("arxiv_in_journal_abbrev");

  if (metaInspire.recid !== -1 && metaInspire.recid !== undefined) {
    if (operation === "full" || operation === "noabstract") {
      item.setField("archive", "INSPIRE");
      item.setField("archiveLocation", metaInspire.recid);

      if (metaInspire.journalAbbreviation) {
        if (item.itemType === "journalArticle") {
          item.setField("journalAbbreviation", metaInspire.journalAbbreviation);
          // Also update publicationTitle for better display in Zotero UI
          // Set to journal name if currently empty or contains arXiv info
          if (
            !publication ||
            publication.startsWith("arXiv:") ||
            publication.toLowerCase().includes("arxiv")
          ) {
            item.setField("publicationTitle", metaInspire.journalAbbreviation);
          }
        } else if (
          metaInspire.document_type[0] === "book" &&
          item.itemType === "book"
        ) {
          item.setField("series", metaInspire.journalAbbreviation);
        } else {
          item.setField("publicationTitle", metaInspire.journalAbbreviation);
        }
      }
      if (metaInspire.volume) {
        if (metaInspire.document_type[0] == "book") {
          item.setField("seriesNumber", metaInspire.volume);
        } else {
          item.setField("volume", metaInspire.volume);
        }
      }
      if (metaInspire.pages && metaInspire.document_type[0] !== "book") {
        item.setField("pages", metaInspire.pages);
      }
      if (metaInspire.date) {
        item.setField("date", metaInspire.date);
      }
      if (metaInspire.issue) {
        item.setField("issue", metaInspire.issue);
      }
      if (metaInspire.DOI) {
        if (
          item.itemType === "journalArticle" ||
          item.itemType === "preprint"
        ) {
          item.setField("DOI", metaInspire.DOI);
        } else {
          item.setField("url", `${DOI_ORG_URL}/${metaInspire.DOI}`);
        }
      }

      if (metaInspire.isbns && !item.getField("ISBN")) {
        item.setField("ISBN", metaInspire.isbns);
      }
      if (
        metaInspire.publisher &&
        !item.getField("publisher") &&
        (item.itemType == "book" || item.itemType == "bookSection")
      ) {
        item.setField("publisher", metaInspire.publisher);
      }

      if (metaInspire.title) {
        item.setField("title", metaInspire.title);
      }
      if (metaInspire.creators) {
        // Check for protected author names
        const protectionConfig = getFieldProtectionConfig();
        const localCreators = item.getCreators() as _ZoteroTypes.Item.Creator[];
        const mergedCreators = mergeCreatorsWithProtectedNames(
          localCreators,
          metaInspire.creators,
          protectionConfig.protectedNames,
        );
        item.setCreators(mergedCreators ?? metaInspire.creators);
      }

      if (metaInspire.arxiv) {
        const arxivId = metaInspire.arxiv.value;
        let arXivInfo = "";
        if (/^\d/.test(arxivId)) {
          const arxivPrimeryCategory = metaInspire.arxiv.categories[0];
          arXivInfo = `arXiv:${arxivId} [${arxivPrimeryCategory}]`;
        } else {
          arXivInfo = "arXiv:" + arxivId;
        }
        const numberOfArxiv = (extra.match(ARXIV_EXTRA_LINE_REGEX) || "")
          .length;
        if (numberOfArxiv !== 1) {
          extra = extra.replace(ARXIV_EXTRA_LINE_REGEX, "");
          if (extra.endsWith("\n")) {
            extra += arXivInfo;
          } else {
            extra += "\n" + arXivInfo;
          }
        } else {
          extra = extra.replace(/^.*(arXiv:|_eprint:).*$/gim, arXivInfo);
        }

        if (!metaInspire.journalAbbreviation) {
          if (arxivInJournalAbbrev && item.itemType == "journalArticle") {
            item.setField("journalAbbreviation", arXivInfo);
          }
          // Clear publicationTitle if it contains arXiv info (unpublished preprint should have empty Publication field)
          if (
            publication.startsWith("arXiv:") ||
            publication.toLowerCase().includes("arxiv")
          ) {
            item.setField("publicationTitle", "");
          }
        }
        const url = item.getField("url");
        if (metaInspire.urlArxiv && !url) {
          item.setField("url", metaInspire.urlArxiv);
        }
      }

      extra = extra.replace(/^.*type: article.*$\n/gm, "");

      if (metaInspire.collaborations && !extra.includes("tex.collaboration")) {
        extra =
          extra +
          "\n" +
          "tex.collaboration: " +
          metaInspire.collaborations.join(", ");
      }

      // Auto-add collaboration tags (FTR-COLLAB-TAGS)
      if (isCollabTagAutoEnabled() && metaInspire.collaborations) {
        await addCollabTagsToItem(item, metaInspire.collaborations, false);
      }

      extra = setCitations(
        extra,
        metaInspire.citation_count,
        metaInspire.citation_count_wo_self_citations,
      );

      await queueOrUpsertInspireNote(item, metaInspire.note);

      if (citekey_pref === "inspire") {
        if (extra.includes("Citation Key")) {
          const initialCiteKey = (extra.match(/^.*Citation\sKey:.*$/gm) ||
            "")[0].split(": ")[1];
          if (initialCiteKey !== metaInspire.citekey) {
            extra = extra.replace(
              /^.*Citation\sKey.*$/gm,
              `Citation Key: ${metaInspire.citekey}`,
            );
          }
        } else {
          extra += "\nCitation Key: " + metaInspire.citekey;
        }
      }
    }

    if (operation === "full" && metaInspire.abstractNote) {
      item.setField("abstractNote", metaInspire.abstractNote);
    }

    if (operation === "citations") {
      extra = setCitations(
        extra,
        metaInspire.citation_count,
        metaInspire.citation_count_wo_self_citations,
      );
    }
    extra = extra.replace(/\n\n/gm, "\n");
    extra = reorderExtraFields(extra);
    item.setField("extra", extra);

    setArxivCategoryTag(item);
  }
}

/**
 * Selective metadata update - only updates fields that are in the allowedChanges list
 * Used by smart update mode to preserve user-edited fields
 */
export async function setInspireMetaSelective(
  item: Zotero.Item,
  metaInspire: jsobject,
  operation: string,
  allowedChanges: FieldChange[],
) {
  let extra = item.getField("extra") as string;
  const publication = item.getField("publicationTitle") as string;
  const citekey_pref = getPref("citekey");
  const arxivInJournalAbbrev = getPref("arxiv_in_journal_abbrev");

  // Build a set of allowed field names for quick lookup
  const allowedFields = new Set(allowedChanges.map((c) => c.field));

  if (metaInspire.recid !== -1 && metaInspire.recid !== undefined) {
    // Always set archive info (this is identification, not user content)
    item.setField("archive", "INSPIRE");
    item.setField("archiveLocation", metaInspire.recid);

    if (operation === "full" || operation === "noabstract") {
      // Journal / Publication info
      // Note: If no journal info but has arXiv, use arXiv as fallback (matches setInspireMeta logic)
      if (allowedFields.has("journalAbbreviation")) {
        if (metaInspire.journalAbbreviation) {
          if (item.itemType === "journalArticle") {
            item.setField(
              "journalAbbreviation",
              metaInspire.journalAbbreviation,
            );
            // Also update publicationTitle for better display in Zotero UI
            // Set to journal name if currently empty or contains arXiv info
            if (
              !publication ||
              publication.startsWith("arXiv:") ||
              publication.toLowerCase().includes("arxiv")
            ) {
              item.setField(
                "publicationTitle",
                metaInspire.journalAbbreviation,
              );
            }
          } else if (
            metaInspire.document_type?.[0] === "book" &&
            item.itemType === "book"
          ) {
            item.setField("series", metaInspire.journalAbbreviation);
          } else {
            item.setField("publicationTitle", metaInspire.journalAbbreviation);
          }
        } else if (
          arxivInJournalAbbrev &&
          metaInspire.arxiv?.value &&
          item.itemType === "journalArticle"
        ) {
          // arXiv fallback for unpublished papers
          const arxivId = metaInspire.arxiv.value;
          let arXivInfo = "";
          if (/^\d/.test(arxivId) && metaInspire.arxiv.categories?.[0]) {
            arXivInfo = `arXiv:${arxivId} [${metaInspire.arxiv.categories[0]}]`;
          } else {
            arXivInfo = `arXiv:${arxivId}`;
          }
          item.setField("journalAbbreviation", arXivInfo);
        }
      }

      // Volume
      if (allowedFields.has("volume") && metaInspire.volume) {
        if (metaInspire.document_type?.[0] === "book") {
          item.setField("seriesNumber", metaInspire.volume);
        } else {
          item.setField("volume", metaInspire.volume);
        }
      }

      // Pages
      if (
        allowedFields.has("pages") &&
        metaInspire.pages &&
        metaInspire.document_type?.[0] !== "book"
      ) {
        item.setField("pages", metaInspire.pages);
      }

      // Date
      if (allowedFields.has("date") && metaInspire.date) {
        item.setField("date", metaInspire.date);
      }

      // Issue
      if (allowedFields.has("issue") && metaInspire.issue) {
        item.setField("issue", metaInspire.issue);
      }

      // DOI
      if (allowedFields.has("DOI") && metaInspire.DOI) {
        if (
          item.itemType === "journalArticle" ||
          item.itemType === "preprint"
        ) {
          item.setField("DOI", metaInspire.DOI);
        } else {
          item.setField("url", `${DOI_ORG_URL}/${metaInspire.DOI}`);
        }
      }

      // ISBN (only if empty)
      if (metaInspire.isbns && !item.getField("ISBN")) {
        item.setField("ISBN", metaInspire.isbns);
      }

      // Publisher (only if empty)
      if (
        metaInspire.publisher &&
        !item.getField("publisher") &&
        (item.itemType === "book" || item.itemType === "bookSection")
      ) {
        item.setField("publisher", metaInspire.publisher);
      }

      // Title - update if allowed (protection is handled by filterProtectedChanges)
      if (allowedFields.has("title") && metaInspire.title) {
        item.setField("title", metaInspire.title);
      }

      // Creators - update if allowed, but preserve protected names
      if (allowedFields.has("creators") && metaInspire.creators) {
        const protectionConfig = getFieldProtectionConfig();
        const localCreators = item.getCreators() as _ZoteroTypes.Item.Creator[];
        const mergedCreators = mergeCreatorsWithProtectedNames(
          localCreators,
          metaInspire.creators,
          protectionConfig.protectedNames,
        );
        item.setCreators(mergedCreators ?? metaInspire.creators);
      }

      // arXiv info (in Extra field)
      if (allowedFields.has("arXiv") && metaInspire.arxiv) {
        const arxivId = metaInspire.arxiv.value;
        let arXivInfo = "";
        if (/^\d/.test(arxivId)) {
          const arxivPrimeryCategory = metaInspire.arxiv.categories?.[0] || "";
          arXivInfo = arxivPrimeryCategory
            ? `arXiv:${arxivId} [${arxivPrimeryCategory}]`
            : `arXiv:${arxivId}`;
        } else {
          arXivInfo = "arXiv:" + arxivId;
        }
        const numberOfArxiv = (extra.match(ARXIV_EXTRA_LINE_REGEX) || "")
          .length;
        if (numberOfArxiv !== 1) {
          extra = extra.replace(ARXIV_EXTRA_LINE_REGEX, "");
          if (extra.endsWith("\n")) {
            extra += arXivInfo;
          } else {
            extra += "\n" + arXivInfo;
          }
        } else {
          extra = extra.replace(/^.*(arXiv:|_eprint:).*$/gim, arXivInfo);
        }

        // Clear publicationTitle if it contains arXiv info AND no journal info
        // (unpublished preprint should have empty Publication field)
        if (
          !metaInspire.journalAbbreviation &&
          (publication.startsWith("arXiv:") ||
            publication.toLowerCase().includes("arxiv"))
        ) {
          item.setField("publicationTitle", "");
        }
        // Set URL if empty
        const url = item.getField("url");
        if (metaInspire.urlArxiv && !url) {
          item.setField("url", metaInspire.urlArxiv);
        }
      }

      extra = extra.replace(/^.*type: article.*$\n/gm, "");

      // Collaboration
      if (
        allowedFields.has("collaboration") &&
        metaInspire.collaborations &&
        !extra.includes("tex.collaboration")
      ) {
        extra =
          extra +
          "\n" +
          "tex.collaboration: " +
          metaInspire.collaborations.join(", ");
      }

      // Auto-add collaboration tags (FTR-COLLAB-TAGS)
      if (
        allowedFields.has("collaboration") &&
        isCollabTagAutoEnabled() &&
        metaInspire.collaborations
      ) {
        await addCollabTagsToItem(item, metaInspire.collaborations, false);
      }

      // Citations (always update if in allowed list)
      if (
        allowedFields.has("citations") ||
        allowedFields.has("citationsWithoutSelf")
      ) {
        extra = setCitations(
          extra,
          metaInspire.citation_count,
          metaInspire.citation_count_wo_self_citations,
        );
      }

      await queueOrUpsertInspireNote(item, metaInspire.note);

      // Citation key
      if (
        allowedFields.has("citekey") &&
        citekey_pref === "inspire" &&
        metaInspire.citekey
      ) {
        if (extra.includes("Citation Key")) {
          const initialCiteKey = (extra.match(/^.*Citation\sKey:.*$/gm) ||
            "")[0]?.split(": ")[1];
          if (initialCiteKey !== metaInspire.citekey) {
            extra = extra.replace(
              /^.*Citation\sKey.*$/gm,
              `Citation Key: ${metaInspire.citekey}`,
            );
          }
        } else {
          extra += "\nCitation Key: " + metaInspire.citekey;
        }
      }
    }

    // Abstract
    if (
      allowedFields.has("abstractNote") &&
      operation === "full" &&
      metaInspire.abstractNote
    ) {
      item.setField("abstractNote", metaInspire.abstractNote);
    }

    // Citations-only mode
    if (
      operation === "citations" &&
      (allowedFields.has("citations") ||
        allowedFields.has("citationsWithoutSelf"))
    ) {
      extra = setCitations(
        extra,
        metaInspire.citation_count,
        metaInspire.citation_count_wo_self_citations,
      );
    }

    extra = extra.replace(/\n\n/gm, "\n");
    extra = reorderExtraFields(extra);
    item.setField("extra", extra);

    setArxivCategoryTag(item);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Note Management
// ─────────────────────────────────────────────────────────────────────────────

async function queueOrUpsertInspireNote(item: Zotero.Item, noteText?: string) {
  const trimmed = noteText?.trim();
  const itemWithPending = item as ItemWithPendingInspireNote;

  if (!trimmed || trimmed === "[]") {
    delete itemWithPending._zinspirePendingInspireNote;
    return;
  }

  if (!item.id) {
    itemWithPending._zinspirePendingInspireNote = trimmed;
    return;
  }

  await upsertInspireNote(item, trimmed);
  delete itemWithPending._zinspirePendingInspireNote;
}

async function flushPendingInspireNote(item: Zotero.Item) {
  const itemWithPending = item as ItemWithPendingInspireNote;
  if (item.id && itemWithPending._zinspirePendingInspireNote) {
    await upsertInspireNote(item, itemWithPending._zinspirePendingInspireNote);
    delete itemWithPending._zinspirePendingInspireNote;
  }
}

export async function saveItemWithPendingInspireNote(item: Zotero.Item) {
  await item.saveTx();
  await flushPendingInspireNote(item);
}

async function upsertInspireNote(item: Zotero.Item, noteText: string) {
  if (!item.id) {
    return;
  }

  const normalizedTarget = normalizeInspireNoteContent(noteText);
  if (!normalizedTarget) {
    return;
  }

  const noteIDs = item.getNotes();
  let exactMatch: Zotero.Item | undefined;
  let fallbackMatch: Zotero.Item | undefined;
  const targetLooksLikeErratum = normalizedTarget.includes("erratum");

  for (const id of noteIDs) {
    const note = Zotero.Items.get(id);
    const normalizedExisting = normalizeInspireNoteContent(note.getNote());
    if (!normalizedExisting) {
      continue;
    }

    if (normalizedExisting === normalizedTarget) {
      exactMatch = note;
      break;
    }

    if (
      !fallbackMatch &&
      targetLooksLikeErratum &&
      normalizedExisting.includes("erratum")
    ) {
      fallbackMatch = note;
    }
  }

  const noteToUpdate = exactMatch ?? fallbackMatch;
  if (noteToUpdate) {
    if (noteToUpdate.getNote() !== noteText) {
      noteToUpdate.setNote(noteText);
      await noteToUpdate.saveTx();
    }
    return;
  }

  const newNote = new Zotero.Item("note");
  newNote.setNote(noteText);
  newNote.parentID = item.id;
  newNote.libraryID = item.libraryID;
  await newNote.saveTx();
}

function normalizeInspireNoteContent(note?: string): string {
  if (!note) {
    return "";
  }

  const withoutTags = note
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  const decoded = withoutTags.replace(
    /&([a-z]+);/gi,
    (_match, entity: string) =>
      INSPIRE_NOTE_HTML_ENTITIES[entity.toLowerCase()] ?? " ",
  );

  return decoded
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation Management
// ─────────────────────────────────────────────────────────────────────────────

function setExtraCitations(extra: any, source: string, citation_count: any) {
  const today = new Date(Date.now()).toLocaleDateString("zh-CN");

  const topLineMatch = extra.match(/^(\d+)\scitations\s\([\w\s]+[\d/-]+\)\n/);
  if (topLineMatch) {
    const topCitation = Number(topLineMatch[1]);
    if (citation_count === topCitation) {
      return extra;
    }
  }

  const temp = extra.match(/^\d+\scitations/gm);
  let existingCitation = 0;
  if (temp !== null && temp.length > 0) {
    existingCitation = Number(temp[0].replace(" citations", ""));
  }

  const dateMatch = extra.match(new RegExp(`${source}\\s([\\d/-]+)`));
  const existingDate = dateMatch ? dateMatch[1] : today;

  extra = extra.replace(/^.*citations.*$\n?/gm, "");
  extra = extra.replace(/^\n+/, "");

  if (citation_count === existingCitation) {
    extra = `${citation_count} citations (${source} ${existingDate})\n` + extra;
  } else {
    extra = `${citation_count} citations (${source} ${today})\n` + extra;
  }

  return extra;
}

export async function setCrossRefCitations(item: Zotero.Item): Promise<number> {
  let extra = item.getField("extra");
  let count_crossref = await getCrossrefCount(item);
  if (count_crossref >= 0) {
    extra = setExtraCitations(extra, "CrossRef", count_crossref) as string;
    extra = extra.replace(/\n\n/gm, "\n");
    extra = reorderExtraFields(extra);
    item.setField("extra", extra);
    setArxivCategoryTag(item);
  } else {
    count_crossref = -1;
  }
  return count_crossref;
}

function reorderExtraFields(extra: string): string {
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

function setCitations(
  extra: string,
  citation_count: number,
  citation_count_wo_self_citations: number,
): string {
  const today = new Date(Date.now()).toLocaleDateString("zh-CN");

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

  if (
    citation_count === existingCitations[0] &&
    citation_count_wo_self_citations === existingCitations[1]
  ) {
    extra =
      `${citation_count} citations (INSPIRE ${existingDate})\n` +
      `${citation_count_wo_self_citations} citations w/o self (INSPIRE ${existingDate})\n` +
      extra;
  } else {
    extra =
      `${citation_count} citations (INSPIRE ${today})\n` +
      `${citation_count_wo_self_citations} citations w/o self (INSPIRE ${today})\n` +
      extra;
  }

  return extra;
}

// ─────────────────────────────────────────────────────────────────────────────
// arXiv Tag Management
// ─────────────────────────────────────────────────────────────────────────────

function setArxivCategoryTag(item: Zotero.Item) {
  const arxiv_tag_pref = getPref("arxiv_tag_enable");
  if (!arxiv_tag_pref) {
    return;
  }

  const extra = item.getField("extra") as string;
  let primaryCategory = "";

  const newFormatMatch = extra.match(/arXiv:\d{4}\.\d{4,5}\s*\[([^\]]+)\]/i);
  if (newFormatMatch) {
    primaryCategory = newFormatMatch[1];
  } else {
    const oldFormatMatch = extra.match(/arXiv:([a-z-]+)\/\d{7}/i);
    if (oldFormatMatch) {
      primaryCategory = oldFormatMatch[1];
    }
  }

  if (primaryCategory) {
    if (!item.hasTag(primaryCategory)) {
      item.addTag(primaryCategory);
      item.saveTx();
    }
  }
}
