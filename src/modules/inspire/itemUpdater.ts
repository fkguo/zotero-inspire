import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { addArxivCategoryTag } from "./arxivTag";
import { getPref, setPref } from "../../utils/prefs";
import { getPrimarySelectedCollection } from "../../utils/zoteroPaneSelection";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import {
  DOI_ORG_URL,
  INSPIRE_API_BASE,
  INSPIRE_NOTE_HTML_ENTITIES,
} from "./constants";

// Plugin icon for progress windows (PNG format required for ProgressWindow headline)
const PLUGIN_ICON = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;

// How long the counts of a preprint check stay on screen (five numbers to read)
const PREPRINT_SUMMARY_DISPLAY_MS = 10000;

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
  lookupInspireMeta,
  getCrossrefCount,
  fetchBibTeX,
} from "./metadataService";
import {
  deriveRecidFromItem,
  copyToClipboard,
  inspireLiteratureUrl,
} from "./apiUtils";
import { localCache } from "./localCache";
import {
  fetchReferencesEntries,
  enrichReferencesEntries,
} from "./referencesService";
import { itemCitationKey } from "./library/itemCitationKey";
import { inspireFetch } from "./rateLimiter";
import {
  resolveInspireItemType,
  policyFromPrefs,
  type ItemTypePolicy,
  type LocalPublicationFields,
  type TargetItemType,
} from "./itemTypePolicy";
import {
  isSmartUpdateEnabled,
  shouldShowPreview,
  compareItemWithInspire,
  filterProtectedChanges,
  getFieldProtectionConfig,
  showSmartUpdatePreviewDialog,
  mergeCreatorsWithProtectedNames,
  creatorsForUpdate,
  type FieldChange,
} from "./smartUpdate";
import {
  isUnpublishedPreprint,
  findUnpublishedPreprints,
  batchCheckPublicationStatus,
  beginManualCheck,
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
import { openRunProgressWindow } from "./runProgressWindow";
import { copyFundingInfo } from "./funding";
// NOTE: CitationGraphDialog is imported lazily to avoid circular dependencies.

// Zotero's own uses of Escape in the main window (zoteroPane.js, Zotero 10):
// in a tab other than the library it moves the focus back into the reader;
// in the collection tree it clears the collection filter, and with no filter
// it only focuses the tree again, yet marks the key as handled all the same

function isReaderTabSelected(): boolean {
  const tabs = (Zotero.getMainWindow() as any)?.Zotero_Tabs;
  return typeof tabs?.selectedIndex === "number" && tabs.selectedIndex > 0;
}

function isCollectionTreeWithoutFilter(event: KeyboardEvent): boolean {
  const target = event.target as Element | null;
  if (!target?.closest?.("#collection-tree")) {
    return false;
  }
  const filter = target.ownerDocument?.getElementById(
    "zotero-collections-search",
  ) as HTMLInputElement | null;
  return !filter?.value;
}

/** Input types in which nothing is typed (a checkbox, a button, …) */
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "image",
  "file",
  "color",
  "range",
  "hidden",
]);

/** The key event comes from a text field, whose own Escape it is */
function isInTextField(event: Event): boolean {
  return event.composedPath().some((node) => {
    const element = node as HTMLElement;
    return (
      (element.localName === "input" &&
        !NON_TEXT_INPUT_TYPES.has((element as HTMLInputElement).type)) ||
      element.localName === "textarea" ||
      element.isContentEditable === true
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ZInspire Class - Batch Update Controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A run the user can cancel: a metadata update, a reference-cache download
 * or a preprint check. Each run has its own cancelled flag, so starting a
 * run never resumes one the user cancelled.
 */
interface CancellableRun {
  cancelled: boolean;
  /** Escape in the main window cancels it (runs started from a menu) */
  cancelByEscape: boolean;
  /** Called once, when the run is cancelled */
  onCancel?: () => void;
}

/**
 * One metadata update run. It has its own counts, so items of a cancelled
 * run that finish late are not reported by the next run.
 */
interface UpdateRun extends CancellableRun {
  total: number;
  /** Aborts the run's INSPIRE requests when the run is cancelled */
  controller: AbortController | null;
  /** Items taken off the queue and finished */
  completed: number;
  /** Items saved with INSPIRE data */
  counter: number;
  crossRefCounter: number;
  noRecidCount: number;
  /** Items whose request got no answer: failed, or aborted by the cancel */
  unanswered: number;
  /** Items whose request failed (no network, server error) */
  failed: number;
}

/**
 * How the INSPIRE request for one item ended: answered (record or no record),
 * failed (no network, server error) or aborted (update cancelled). An item
 * whose request got no answer is left as it is.
 */
type ItemRequestOutcome = "answered" | "failed" | "aborted";

export class ZInspire {
  private closedProgressWindows = new WeakSet<ProgressWindowHelper>();
  /** Runs that have started and not ended yet */
  private activeRuns = new Set<CancellableRun>();
  private escapeHandler?: (e: KeyboardEvent) => void;

  private closeActiveProgressWindow(progressWindow: ProgressWindowHelper) {
    if (this.closedProgressWindows.has(progressWindow)) {
      return;
    }
    this.closedProgressWindows.add(progressWindow);
    try {
      progressWindow.close();
    } catch (error) {
      Zotero.debug(
        `[${config.addonName}] Failed to close progress window: ${error}`,
      );
    }
  }

  /**
   * The notice at the end of an update: the items without an INSPIRE record
   * if there were any, else how many items were updated
   */
  private showFinalNotice(
    operation: string,
    counts: Pick<UpdateRun, "counter" | "crossRefCounter" | "noRecidCount">,
  ) {
    if (counts.noRecidCount > 0) {
      const icon = "chrome://zotero/skin/cross.png";
      const progressWindowNoRecid = new ztoolkit.ProgressWindow(
        config.addonName,
        { closeOnClick: true },
      );
      progressWindowNoRecid.changeHeadline("INSPIRE recid not found");
      const itemWord = counts.noRecidCount === 1 ? "item" : "items";
      if (getPref("tag_enable") && getPref("tag_norecid") !== "") {
        progressWindowNoRecid.createLine({
          icon: icon,
          text: `No INSPIRE recid was found for ${counts.noRecidCount} ${itemWord}. Tagged with '${getPref("tag_norecid")}'.`,
        });
      } else {
        progressWindowNoRecid.createLine({
          icon: icon,
          text: `No INSPIRE recid was found for ${counts.noRecidCount} ${itemWord}.`,
        });
      }
      progressWindowNoRecid.show();
      progressWindowNoRecid.startCloseTimer(3000);
    } else {
      const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
        closeOnClick: true,
      });
      progressWindow.win.changeHeadline("Finished", PLUGIN_ICON);
      if (operation === "full" || operation === "noabstract") {
        progressWindow.createLine({
          icon: PLUGIN_ICON,
          text: "INSPIRE metadata updated for " + counts.counter + " items.",
          progress: 100,
        });
      } else if (operation === "citations") {
        progressWindow.createLine({
          icon: PLUGIN_ICON,
          text:
            "INSPIRE citations updated for " +
            counts.counter +
            " items;\n" +
            "CrossRef citations updated for " +
            counts.crossRefCounter +
            " items.",
          progress: 100,
        });
      }
      progressWindow.show();
      progressWindow.startCloseTimer(3000);
    }
  }

  /** Cancel every run that is going */
  cancelUpdate() {
    for (const run of this.activeRuns) {
      if (!run.cancelled) {
        run.cancelled = true;
        run.onCancel?.();
      }
    }
    this.removeEscapeListener();
  }

  private startRun<T extends CancellableRun>(run: T): T {
    this.activeRuns.add(run);
    if (run.cancelByEscape) {
      this.setupEscapeListener();
    }
    return run;
  }

  /** Ends a run; Escape stays with the runs still going */
  private endRun(run: CancellableRun) {
    if (!this.activeRuns.delete(run)) {
      return;
    }
    for (const other of this.activeRuns) {
      if (other.cancelByEscape && !other.cancelled) {
        return;
      }
    }
    this.removeEscapeListener();
  }

  /**
   * Listen for Escape in the main window to cancel the runs. Escape is left
   * to whatever else uses it: a text field (the search box clears), a menu,
   * dialog or panel that handles it and so prevents its default, and Zotero
   * in a reader tab (it moves the focus back into the reader). The key is
   * seen first (capture) and not stopped; the decision waits until it has
   * been handled everywhere.
   */
  private setupEscapeListener() {
    this.removeEscapeListener(); // Clean up any existing listener
    const handler = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape" ||
        isInTextField(e) ||
        isReaderTabSelected()
      ) {
        return;
      }
      // In the collection tree with no filter, Zotero marks the key as
      // handled without using it; it still counts as handled if something
      // before Zotero (e.g. a dialog) handled it. The filter is read before
      // Zotero clears it.
      let unusedByZotero = false;
      const target = e.target as EventTarget | null;
      const seeTargetReached = (reached: Event) => {
        unusedByZotero = !reached.defaultPrevented;
      };
      if (isCollectionTreeWithoutFilter(e)) {
        target?.addEventListener("keydown", seeTargetReached, true);
      }
      setTimeout(() => {
        target?.removeEventListener("keydown", seeTargetReached, true);
        // Not if the listener was removed meanwhile (the runs ended)
        if (
          (e.defaultPrevented && !unusedByZotero) ||
          this.escapeHandler !== handler
        ) {
          return;
        }
        this.cancelUpdate();
        Zotero.debug(
          `[${config.addonName}] Operation cancelled via Escape key`,
        );
      }, 0);
    };
    this.escapeHandler = handler;
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
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
    this.updateItemsConcurrent(items, operation, true);
  }

  updateSelectedCollection(operation: string) {
    const collection = getPrimarySelectedCollection(
      Zotero.getActiveZoteroPane(),
    );
    if (collection) {
      this.updateItemsConcurrent(collection.getChildItems(), operation, true);
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

      void Promise.all([import("./panel/CitationGraphDialog"), import("../zinspire")])
        .then(([{ CitationGraphDialog }, { InspireReferencePanelController }]) => {
          const authorCallbacks = InspireReferencePanelController.getGraphAuthorCallbacks(doc);
          new CitationGraphDialog(doc, seeds, {
            authorPreviewCallbacks: authorCallbacks,
            onViewAuthorPapers: author => { void authorCallbacks.onViewPapers?.(author); },
          });
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
      const collection = getPrimarySelectedCollection(
        Zotero.getActiveZoteroPane(),
      );
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

      void Promise.all([import("./panel/CitationGraphDialog"), import("../zinspire")])
        .then(([{ CitationGraphDialog }, { InspireReferencePanelController }]) => {
          const authorCallbacks = InspireReferencePanelController.getGraphAuthorCallbacks(doc);
          new CitationGraphDialog(doc, seeds, {
            authorPreviewCallbacks: authorCallbacks,
            onViewAuthorPapers: author => { void authorCallbacks.onViewPapers?.(author); },
          });
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
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForSelection: calling prefetch for ${regularItems.length} items`,
      );
      await this.prefetchReferencesCache(regularItems);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForSelection: error: ${err}`,
      );
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
      const collection = getPrimarySelectedCollection(
        Zotero.getActiveZoteroPane(),
      );
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
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForCollection: calling prefetch for ${items.length} items`,
      );
      await this.prefetchReferencesCache(items);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] downloadReferencesCacheForCollection: error: ${err}`,
      );
    }
  }

  async updateItems(items: Zotero.Item[], operation: string) {
    // Updates of newly added papers run in the background: Escape in the
    // main window is left to Zotero
    this.updateItemsConcurrent(
      items.filter((item) => item.isRegularItem()),
      operation,
      false,
    );
  }

  /**
   * Concurrent item processor with controlled parallelism
   */
  private async updateItemsConcurrent(
    items: Zotero.Item[],
    operation: string,
    cancelByEscape: boolean,
  ) {
    const CONCURRENCY = 3;
    const total = items.length;

    if (!total) {
      this.showFinalNotice(operation, {
        counter: 0,
        crossRefCounter: 0,
        noRecidCount: 0,
      });
      return;
    }

    // Show initial progress
    const progressWindow = openRunProgressWindow(config.addonName, {
      onEscape: () => this.cancelUpdate(),
    });
    // Note: Zotero 7 ProgressWindow headline does not display icons
    // Use icon in createLine instead to show plugin logo
    progressWindow.createLine({
      icon: PLUGIN_ICON,
      text: `Processing 0 of ${total} items...`,
      progress: 0,
    });
    progressWindow.show();

    const controller = createAbortController() ?? null;
    const run = this.startRun<UpdateRun>({
      cancelled: false,
      cancelByEscape,
      onCancel: () => controller?.abort(),
      total,
      controller,
      completed: 0,
      counter: 0,
      crossRefCounter: 0,
      noRecidCount: 0,
      unanswered: 0,
      failed: 0,
    });

    // Create a queue of pending items
    const queue = [...items];
    let index = 0;

    const worker = async () => {
      while (index < queue.length && !run.cancelled) {
        const currentIndex = index++;
        const item = queue[currentIndex];

        if (!item || !item.isRegularItem()) {
          run.completed++;
          continue;
        }

        try {
          const outcome = await this.updateItemInternal(item, operation, run);
          if (outcome !== "answered") {
            run.unanswered++;
            if (outcome === "failed") run.failed++;
          }
        } catch (err) {
          Zotero.debug(
            `[${config.addonName}] updateItemsConcurrent: error updating item ${item.id}: ${err}`,
          );
        }

        run.completed++;

        // Update progress; a failure here must not end the run
        if (!run.cancelled) {
          const percent = Math.round((run.completed / total) * 100);
          try {
            progressWindow.changeLine({
              icon: PLUGIN_ICON,
              text: `Processing ${run.completed} of ${total} items...`,
              progress: percent,
            });
          } catch (err) {
            Zotero.debug(
              `[${config.addonName}] updateItemsConcurrent: progress update failed: ${err}`,
            );
          }
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
        `[${config.addonName}] updateItemsConcurrent: all workers finished, completed=${run.completed}`,
      );

      // Finish
      if (!run.cancelled) {
        this.closeActiveProgressWindow(progressWindow);
        // Every run shows its own notice, also when runs overlap
        this.showFinalNotice(operation, run);
        if (run.failed > 0) {
          this.showRequestFailedNotice(run.failed);
        }
        Zotero.debug(
          `[${config.addonName}] updateItemsConcurrent: done, counter=${run.counter}, failed=${run.failed}`,
        );
      } else {
        // Cancelled - show stats
        this.closeActiveProgressWindow(progressWindow);
        this.showCancelledStats(run);
        // Requests that failed before the cancel
        if (run.failed > 0) {
          this.showRequestFailedNotice(run.failed);
        }
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] updateItemsConcurrent: fatal error: ${err}`,
      );
      this.closeActiveProgressWindow(progressWindow);
    } finally {
      this.endRun(run);
    }
  }

  /**
   * The notice that INSPIRE gave no answer for some items, which were left as
   * they were (not tagged as having no INSPIRE record)
   */
  private showRequestFailedNotice(count: number) {
    const notice = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    notice.createLine({
      icon: "chrome://zotero/skin/cross.png",
      text: getString("update-request-failed", { args: { count } }),
    });
    notice.show();
    notice.startCloseTimer(5000);
  }

  /**
   * Show statistics when update was cancelled: the items processed (whatever
   * INSPIRE answered; not the ones whose request the cancel aborted or that
   * got no answer) and, of those, the items updated
   */
  private showCancelledStats(run: UpdateRun) {
    const statsWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    statsWindow.win.changeHeadline(getString("update-cancelled"), PLUGIN_ICON);
    statsWindow.createLine({
      icon: PLUGIN_ICON,
      text: getString("update-cancelled-stats", {
        args: {
          completed: (run.completed - run.unanswered).toString(),
          total: run.total.toString(),
          // CrossRef counts only items without an INSPIRE record
          updated: (run.counter + run.crossRefCounter).toString(),
        },
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
    const run = this.startRun<CancellableRun>({
      cancelled: false,
      cancelByEscape: true,
    });
    try {
      Zotero.debug(
        `[${config.addonName}] prefetchReferencesCache: creating progress window`,
      );
      const progressWindow = openRunProgressWindow(
        getString("download-cache-progress-title"),
        { onEscape: () => this.cancelUpdate() },
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
        if (run.cancelled) {
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
          if (run.cancelled) {
            progressWindow.close();
            this.showCacheCancelledStats(success, total);
            return;
          }
          // Enrich entries with complete metadata (title, authors, citation count)
          // This ensures cached data is complete and usable offline
          const enrichmentResult = await enrichReferencesEntries(entries);
          if (!enrichmentResult.complete) {
            throw new Error(
              `Metadata enrichment failed for ${enrichmentResult.failedRecids.length} linked references`,
            );
          }
          if (run.cancelled) {
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
    } finally {
      this.endRun(run);
    }
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

  /**
   * Internal method to update a single item (used by concurrent processor)
   */
  private async updateItemInternal(
    item: Zotero.Item,
    operation: string,
    run: UpdateRun,
  ): Promise<ItemRequestOutcome> {
    Zotero.debug(
      `[${config.addonName}] updateItemInternal: starting, item=${item.id}, operation=${operation}`,
    );
    if (
      operation === "full" ||
      operation === "noabstract" ||
      operation === "citations"
    ) {
      Zotero.debug(
        `[${config.addonName}] updateItemInternal: calling lookupInspireMeta`,
      );
      const lookup = await lookupInspireMeta(
        item,
        operation,
        run.controller?.signal,
      );
      // No answer from INSPIRE says nothing about the record: leave the item
      if (lookup.kind === "failed") {
        Zotero.debug(
          `[${config.addonName}] updateItemInternal: no answer for item ${item.id} (${lookup.aborted ? "cancelled" : "request failed"}), left unchanged`,
        );
        return lookup.aborted ? "aborted" : "failed";
      }
      const metaInspire = lookup.kind === "found" ? lookup.meta : -1;
      Zotero.debug(
        `[${config.addonName}] updateItemInternal: lookupInspireMeta returned, recid=${metaInspire !== -1 ? (metaInspire as jsobject).recid : "N/A"}`,
      );
      if (metaInspire !== -1 && (metaInspire as jsobject).recid !== undefined) {
        if (item.hasTag(getPref("tag_norecid") as string)) {
          item.removeTag(getPref("tag_norecid") as string);
        }
        // Decide the item type first but apply it only once the item is
        // going to be saved, so a cancelled preview leaves it untouched.
        const targetType = resolveTargetItemType(
          item,
          metaInspire as jsobject,
          operation,
        );

        // Smart update mode: compare and filter changes
        if (isSmartUpdateEnabled()) {
          const diff = compareItemWithInspire(
            item,
            metaInspire as jsobject,
            targetType ?? undefined,
          );
          let allowedChanges: FieldChange[] = [];
          if (diff.hasChanges) {
            const protectionConfig = getFieldProtectionConfig();
            allowedChanges = filterProtectedChanges(diff, protectionConfig);
            const skippedCount = diff.changes.length - allowedChanges.length;

            if (skippedCount > 0) {
              Zotero.debug(
                `[${config.addonName}] Smart update: skipped ${skippedCount} protected fields`,
              );
            }

            // Show preview dialog only for single-item updates (not batch)
            const preview =
              allowedChanges.length > 0 &&
              shouldShowPreview() &&
              run.total === 1;
            // Without a preview, an author list lacking authors of the item
            // is not written; in the preview it is offered unticked
            if (!preview) {
              allowedChanges = allowedChanges.filter((c) => !c.conflict);
            }
            if (preview) {
              const result = await showSmartUpdatePreviewDialog(
                diff,
                allowedChanges,
              );
              if (!result.confirmed) {
                Zotero.debug(
                  `[${config.addonName}] Smart update: user cancelled preview`,
                );
                return "answered";
              }
              // Filter to only user-selected fields
              allowedChanges = allowedChanges.filter((c) =>
                result.selectedFields.includes(c.field),
              );
              if (allowedChanges.length === 0) {
                Zotero.debug(
                  `[${config.addonName}] Smart update: no fields selected by user`,
                );
                return "answered";
              }
            }
          }

          if (allowedChanges.length > 0) {
            // Apply only allowed changes
            applyItemType(item, targetType);
            await setInspireMetaSelective(
              item,
              metaInspire as jsobject,
              operation,
              allowedChanges,
            );
            await saveItemWithPendingInspireNote(item);
            run.counter++;
          } else if (targetType) {
            // No field changes, but the item type still has to change
            applyItemType(item, targetType);
            await item.saveTx();
            run.counter++;
          } else {
            Zotero.debug(
              `[${config.addonName}] Smart update: no changes to apply`,
            );
          }
        } else {
          // Standard update mode
          applyItemType(item, targetType);
          await setInspireMeta(item, metaInspire as jsobject, operation);
          await saveItemWithPendingInspireNote(item);
          run.counter++;
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
        run.noRecidCount++;
        if (operation === "citations") {
          const crossref_count = await setCrossRefCitations(item);
          await item.saveTx();
          if (crossref_count >= 0) {
            run.crossRefCounter++;
          }
        }
      }
    }
    return "answered";
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

    const url = inspireLiteratureUrl(recid);
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

    const url = inspireLiteratureUrl(recid);
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
      .map(itemCitationKey)
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
   * Copy INSPIRE recid for the selected items.
   */
  async copyInspireRecid() {
    const items = this.getSelectedRegularItems();
    if (!items.length) return;

    const recids: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const recid = deriveRecidFromItem(item);
      if (!recid || seen.has(recid)) continue;
      seen.add(recid);
      recids.push(recid);
    }

    if (!recids.length) {
      this.showCopyNotification(getString("copy-error-no-recid"), "fail");
      return;
    }

    const copiedCount = recids.length;
    const success = await copyToClipboard(recids.join(", "));
    if (success) {
      this.showCopyNotification(
        getString("copy-success-inspire-recid", {
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
    const items = ZoteroPane.getSelectedItems();
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
    const collection = getPrimarySelectedCollection(
      Zotero.getActiveZoteroPane(),
    );
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

    // Stops a background check before scanning (see beginManualCheck)
    const endManualCheck = beginManualCheck();
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
    } finally {
      endManualCheck();
    }
  }

  /**
   * Check all preprints in My Library and every editable group library.
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

    // Stops a background check before scanning (see beginManualCheck)
    const endManualCheck = beginManualCheck();
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
    } finally {
      endManualCheck();
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
    // Cancellable until the check ends; the results dialog and the updates
    // after it are not
    const run = this.startRun<CancellableRun>({
      cancelled: false,
      cancelByEscape: true,
      onCancel: () => abortController?.abort(),
    });

    const progressWindow = openRunProgressWindow(config.addonName, {
      onEscape: () => this.cancelUpdate(),
    });
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

    // Until the dialog is closed and the updates are done: no background
    // check runs meanwhile (it would ask about, and offer, the same papers)
    const endManualCheck = beginManualCheck();
    try {
      const results = await batchCheckPublicationStatus(preprints, {
        signal: abortController?.signal,
        onProgress: (current, total) => {
          // Also check the flag for environments without AbortController
          if (run.cancelled) return;
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
      this.endRun(run);

      if (run.cancelled) {
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
      this.endRun(run);
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
    } finally {
      this.endRun(run);
      endManualCheck();
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

      // If no published items found, show how many preprints had each outcome
      if (publishedResults.length === 0) {
        this.showPreprintNotification(
          getString("preprint-check-summary", {
            args: {
              total: summary.total,
              published: summary.published,
              unpublished: summary.unpublished,
              notInInspire: summary.notInInspire,
              errors: summary.errors,
            },
          }),
          summary.errors > 0 ? "fail" : "default",
          PREPRINT_SUMMARY_DISPLAY_MS,
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
      const notInInspireSpan = doc.createElement("span");
      notInInspireSpan.textContent = `${getString("preprint-results-not-in-inspire")}: ${summary.notInInspire}`;
      const errorsSpan = doc.createElement("span");
      errorsSpan.textContent = `${getString("preprint-results-errors")}: ${summary.errors}`;
      summaryBar.append(
        publishedSpan,
        unpublishedSpan,
        notInInspireSpan,
        errorsSpan,
      );
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

      // Add to document
      doc.documentElement.appendChild(overlay);

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
    closeDelayMs = 2500,
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
    progressWindow.startCloseTimer(closeDelayMs);
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

    const collection = getPrimarySelectedCollection(
      Zotero.getActiveZoteroPane(),
    );
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
// Item Type Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Effective item-type policy from preferences.
 * See `policyFromPrefs` for why the legacy Journal Abbr. option wins.
 */
export function getItemTypePolicy(): ItemTypePolicy {
  return policyFromPrefs(
    getPref("keep_preprint_type"),
    getPref("arxiv_in_journal_abbrev"),
  );
}

/** Journal-related fields of the item, read type-agnostically ("" if absent). */
function readLocalPublicationFields(item: Zotero.Item): LocalPublicationFields {
  return {
    journalAbbreviation: item.getField("journalAbbreviation") as string,
    publicationTitle: item.getField("publicationTitle") as string,
    volume: item.getField("volume") as string,
    pages: item.getField("pages") as string,
    DOI: item.getField("DOI") as string,
  };
}

/**
 * Item type the item should get for this INSPIRE match, or null.
 * The Journal Article -> Preprint direction needs the full record (journal
 * info and arXiv ID), so it is only considered for full/noabstract updates;
 * citation-count-only requests carry no publication data.
 */
function resolveTargetItemType(
  item: Zotero.Item,
  metaInspire: jsobject,
  operation: string,
): TargetItemType | null {
  const local =
    operation === "full" || operation === "noabstract"
      ? readLocalPublicationFields(item)
      : undefined;
  return resolveInspireItemType(
    item.itemType,
    metaInspire,
    getItemTypePolicy(),
    local,
  );
}

/** Change the item type (Zotero drops fields the new type lacks). */
function applyItemType(
  item: Zotero.Item,
  targetType: TargetItemType | null,
): void {
  if (targetType && targetType !== item.itemType) {
    item.setType(Zotero.ItemTypes.getID(targetType) as number);
  }
}

/**
 * An arXiv paper's line in Extra: "arXiv:2401.00001 [hep-ph]" with the
 * primary category for new-style identifiers, "arXiv:hep-ph/0101001" for
 * old-style ones (their archive names the subject)
 */
export function arxivExtraLine(
  arxivId: string,
  primaryCategory: string | undefined,
): string {
  return /^\d/.test(arxivId)
    ? `arXiv:${arxivId} [${primaryCategory}]`
    : `arXiv:${arxivId}`;
}

/**
 * Preprint items: fill the fields Zotero's own arXiv translator uses
 * (Archive ID "arXiv:ID", Repository "arXiv") when they are still empty.
 */
export function setPreprintArxivFields(
  item: Zotero.Item,
  metaInspire: jsobject,
): void {
  if (item.itemType !== "preprint") return;
  const arxivId = metaInspire.arxiv?.value;
  if (!arxivId) return;
  if (!item.getField("archiveID")) {
    item.setField("archiveID", `arXiv:${arxivId}`);
  }
  if (!item.getField("repository")) {
    item.setField("repository", "arXiv");
  }
}

/**
 * True when `field` exists for the item's current type.
 * Zotero's setField throws for a non-empty value on a field the type does not
 * have, and kept preprint/report items lack several journal/book fields.
 */
function canSetField(item: Zotero.Item, field: string): boolean {
  try {
    const fieldID = Zotero.ItemFields.getID(field);
    if (!fieldID) return false;
    const typeFieldID =
      Zotero.ItemFields.getFieldIDFromTypeAndBase(item.itemTypeID, fieldID) ||
      fieldID;
    return Boolean(
      Zotero.ItemFields.isValidForType(typeFieldID, item.itemTypeID),
    );
  } catch {
    return true;
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
      setPreprintArxivFields(item, metaInspire);

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

      if (
        metaInspire.isbns &&
        canSetField(item, "ISBN") &&
        !item.getField("ISBN")
      ) {
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
        // No one is asked here: an author INSPIRE's list lacks is not dropped
        item.setCreators(
          creatorsForUpdate(
            item.getCreators() as _ZoteroTypes.Item.Creator[],
            metaInspire.creators,
            getFieldProtectionConfig().protectedNames,
          ),
        );
      }

      if (metaInspire.arxiv) {
        const arxivId = metaInspire.arxiv.value;
        const arXivInfo = arxivExtraLine(
          arxivId,
          metaInspire.arxiv.categories[0],
        );
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

      if (citekey_pref === "inspire" && metaInspire.citekey) {
        const zoteroVersion = Zotero.platformMajorVersion;
        if (zoteroVersion >= 8) {
          item.setField("citationKey", metaInspire.citekey);
        } else {
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

    setArxivCategoryTag(item, metaInspire.arxiv?.categories?.[0]);
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
      setPreprintArxivFields(item, metaInspire);

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
      if (
        metaInspire.isbns &&
        canSetField(item, "ISBN") &&
        !item.getField("ISBN")
      ) {
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

      if (
        allowedFields.has("citekey") &&
        citekey_pref === "inspire" &&
        metaInspire.citekey
      ) {
        const zoteroVersion = Zotero.platformMajorVersion;
        if (zoteroVersion >= 8) {
          item.setField("citationKey", metaInspire.citekey);
        } else {
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

    setArxivCategoryTag(item, metaInspire.arxiv?.categories?.[0]);
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

async function flushPendingInspireNote(
  item: Zotero.Item,
  saveOptions?: Parameters<Zotero.Item["saveTx"]>[0],
) {
  const itemWithPending = item as ItemWithPendingInspireNote;
  if (item.id && itemWithPending._zinspirePendingInspireNote) {
    await upsertInspireNote(
      item,
      itemWithPending._zinspirePendingInspireNote,
      saveOptions,
    );
    delete itemWithPending._zinspirePendingInspireNote;
  }
}

export async function saveItemWithPendingInspireNote(
  item: Zotero.Item,
  saveOptions?: Parameters<Zotero.Item["saveTx"]>[0],
) {
  await item.saveTx(saveOptions);
  await flushPendingInspireNote(item, saveOptions);
}

async function upsertInspireNote(
  item: Zotero.Item,
  noteText: string,
  saveOptions?: Parameters<Zotero.Item["saveTx"]>[0],
) {
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
    const note = Zotero.Items.get(id) as Zotero.Item;
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
      await noteToUpdate.saveTx(saveOptions);
    }
    return;
  }

  const newNote = new Zotero.Item("note");
  newNote.setNote(noteText);
  newNote.parentID = item.id;
  newNote.libraryID = item.libraryID;
  await newNote.saveTx(saveOptions);
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

/**
 * Extra with INSPIRE's citation count lines set, laid out as the INSPIRE
 * update lays them out
 */
export function setInspireCitationLines(
  extra: string,
  citationCount: number,
  citationCountWithoutSelf: number,
): string {
  const updated = setCitations(
    extra,
    citationCount,
    citationCountWithoutSelf,
  ).replace(/\n\n/gm, "\n");
  return reorderExtraFields(updated);
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

function setArxivCategoryTag(item: Zotero.Item, primaryCategory?: string) {
  if (addArxivCategoryTag(item, primaryCategory)) {
    // Only persist here for an already-saved item. For a NEW (unsaved) item
    // the caller (e.g. importReference) saves it right after, and a second
    // concurrent saveTx on the same new item races that save -> duplicate
    // INSERT -> "NOT NULL constraint failed: items.itemTypeID", which throws
    // and aborts the whole add flow (including auto-find-full-text). The
    // in-memory tag added above is persisted by the caller's save.
    // skipSelect keeps the (already-saved) item's tree selection unchanged.
    if (item.id) {
      item.saveTx({ skipSelect: true });
    }
  }
}
