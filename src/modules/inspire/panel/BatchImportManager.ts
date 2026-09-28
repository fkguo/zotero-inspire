// ─────────────────────────────────────────────────────────────────────────────
// BatchImportManager - Batch import functionality for References Panel
// Extracted from InspireReferencePanelController as part of controller refactoring
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import {
  type InspireReferenceEntry,
  buildDisplayText,
  findItemsByRecids,
  findItemsByArxivs,
  findItemsByDOIs,
  createAbortController,
  createMockSignal,
} from "../index";
import type { SaveTargetSelection } from "../../pickerUI";
import { LibraryIndexError } from "../library/arxivIndex";
import type { Reporter } from "./reporter";

// XHTML namespace for proper element creation in Zotero (FIX-NAMESPACE-WARNING)
const XHTML_NS = "http://www.w3.org/1999/xhtml";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Duplicate detection result for an entry.
 */
export interface DuplicateInfo {
  localItemID: number;
  matchType: "recid" | "arxiv" | "doi";
}

/**
 * Result of batch import operation.
 */
export interface BatchImportResult {
  success: number;
  failed: number;
  cancelled: boolean;
}

/**
 * Options for BatchImportManager initialization.
 */
export interface BatchImportManagerOptions {
  /**
   * Callback to get the document for UI operations; Escape pressed in its
   * window stops a running import
   */
  getDocument: () => Document;
  /** Callback to get the body element for attaching dialogs */
  getBody: () => HTMLElement;
  /**
   * Callback to get the list element for checkbox updates. Called on every
   * update, since the panel replaces the list element when it re-renders.
   */
  getListElement: () => HTMLElement;
  /** Callback to get all entries */
  getAllEntries: () => InspireReferenceEntry[];
  /** Callback to get filtered entries (current view) */
  getFilteredEntries: () => InspireReferenceEntry[];
  /** Callback to import a single reference by recid */
  importReference: (
    recid: string,
    target: SaveTargetSelection,
  ) => Promise<Zotero.Item | null>;
  /** Callback to prompt for save target (shows picker UI) */
  promptForSaveTarget: (
    anchor: HTMLElement,
  ) => Promise<SaveTargetSelection | null>;
  /** Where notices and the import's progress are shown */
  reporter: Reporter;
  /** Callback to update a single row's status in the list */
  updateRowStatus: (entry: InspireReferenceEntry) => void;
  /** Callback when batch toolbar visibility should be updated */
  onSelectionChange?: (count: number) => void;
  /**
   * Callback when a batch import in any panel starts (true) and when it is
   * over (false), its duplicate dialog and save-target prompt included
   */
  onImportStateChange?: (inProgress: boolean) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// BatchImportManager Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages batch import functionality for the References Panel.
 * Handles selection, duplicate detection, and batch import with progress.
 */
export class BatchImportManager {
  // One batch import at a time across all references panels: set from the
  // Import click until that import is over, and announced to every open panel
  private static importInProgress = false;
  private static openManagers = new Set<BatchImportManager>();

  private options: BatchImportManagerOptions;

  // Selection state
  private selectedEntryIDs = new Set<string>();
  private lastSelectedEntryID?: string; // For Shift+Click range selection

  // Closes the duplicate dialog while it is open
  private closeDuplicateDialog?: (
    result: InspireReferenceEntry[] | null,
  ) => void;
  // Stops waiting for the duplicate search while it runs
  private cancelDuplicateSearch?: () => void;
  // Set once the panel has gone away
  private disposed = false;

  // Import state
  private importAbort?: AbortController;

  constructor(options: BatchImportManagerOptions) {
    this.options = options;
    BatchImportManager.openManagers.add(this);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the selected entry IDs. This is the live set, not a copy: it
   * reflects later selection changes.
   */
  getSelectedEntryIDs(): ReadonlySet<string> {
    return this.selectedEntryIDs;
  }

  /**
   * Handle checkbox click with Shift+Click range selection support.
   */
  handleCheckboxClick(entry: InspireReferenceEntry, event: MouseEvent): void {
    Zotero.debug(
      `[${config.addonName}] handleCheckboxClick: entry.id=${entry.id}`,
    );
    const checkbox = event.target as HTMLInputElement;
    const isChecked = checkbox.checked;
    Zotero.debug(
      `[${config.addonName}] handleCheckboxClick: isChecked=${isChecked}`,
    );

    // Shift+Click: the rows in view from the last clicked row to this one
    let range: InspireReferenceEntry[] | undefined;
    if (event.shiftKey && this.lastSelectedEntryID) {
      const filteredEntries = this.options.getFilteredEntries();
      const lastIndex = filteredEntries.findIndex(
        (e) => e.id === this.lastSelectedEntryID,
      );
      const currentIndex = filteredEntries.findIndex((e) => e.id === entry.id);

      if (lastIndex >= 0 && currentIndex >= 0) {
        range = filteredEntries.slice(
          Math.min(lastIndex, currentIndex),
          Math.max(lastIndex, currentIndex) + 1,
        );
      }
    }

    if (range) {
      for (const e of range) {
        if (isChecked) {
          this.selectedEntryIDs.add(e.id);
        } else {
          this.selectedEntryIDs.delete(e.id);
        }
      }

      this.updateAllCheckboxes();
    } else {
      // Regular click, or Shift+Click when the last clicked row is no longer
      // in view (e.g. filtered out): toggle this row alone
      if (isChecked) {
        this.selectedEntryIDs.add(entry.id);
      } else {
        this.selectedEntryIDs.delete(entry.id);
      }
    }

    this.lastSelectedEntryID = entry.id;
    this.notifySelectionChange();
  }

  /**
   * Select all entries in the current filtered view.
   */
  selectAll(): void {
    const filteredEntries = this.options.getFilteredEntries();
    for (const entry of filteredEntries) {
      this.selectedEntryIDs.add(entry.id);
    }
    this.updateAllCheckboxes();
    this.notifySelectionChange();
  }

  /**
   * Clear all selections.
   */
  clearSelection(): void {
    this.selectedEntryIDs.clear();
    this.lastSelectedEntryID = undefined;
    this.updateAllCheckboxes();
    this.notifySelectionChange();
  }

  /**
   * Call when the panel goes away. An import that has not asked anything yet
   * is cancelled, as is one whose duplicate dialog (part of the panel) is
   * open; a save-target prompt already open is left to the user, and an
   * import already running is left to finish.
   */
  dispose(): void {
    this.disposed = true;
    BatchImportManager.openManagers.delete(this);
    this.cancelDuplicateSearch?.();
    this.closeDuplicateDialog?.(null);
  }

  /**
   * Whether a batch import is under way, in this panel or another.
   */
  isImportInProgress(): boolean {
    return BatchImportManager.importInProgress;
  }

  /**
   * Handle batch import button click.
   * Returns the import result, or null if cancelled or if a batch import is
   * already under way (in any panel).
   */
  async handleBatchImport(
    anchor: HTMLElement,
  ): Promise<BatchImportResult | null> {
    if (BatchImportManager.importInProgress) {
      Zotero.debug(
        `[${config.addonName}] handleBatchImport: an import is already in progress`,
      );
      return null;
    }
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: started, selectedEntryIDs.size=${this.selectedEntryIDs.size}`,
    );
    if (this.selectedEntryIDs.size === 0) {
      this.options.reporter.notify(
        getString("references-panel-batch-no-selection"),
      );
      return null;
    }

    const allEntries = this.options.getAllEntries();
    const selectedEntries = allEntries.filter(
      (e) => this.selectedEntryIDs.has(e.id) && e.recid,
    );
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: selectedEntries.length=${selectedEntries.length}`,
    );

    if (selectedEntries.length === 0) {
      this.options.reporter.notify(
        getString("references-panel-batch-no-selection"),
      );
      return null;
    }

    try {
      BatchImportManager.setImportInProgress(true);
      return await this.importSelectedEntries(selectedEntries, anchor);
    } finally {
      BatchImportManager.setImportInProgress(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Import Flow
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check the selected entries for duplicates, ask for the save target, and
   * import. Returns the import result or null if cancelled.
   */
  private async importSelectedEntries(
    selectedEntries: InspireReferenceEntry[],
    anchor: HTMLElement,
  ): Promise<BatchImportResult | null> {
    // Detect duplicates
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: detecting duplicates...`,
    );
    // If the panel goes away meanwhile, stop waiting for the search
    let duplicates: Map<string, DuplicateInfo> | null;
    try {
      duplicates = await new Promise<Map<string, DuplicateInfo> | null>(
        (resolve, reject) => {
          this.cancelDuplicateSearch = () => resolve(null);
          this.detectDuplicates(selectedEntries).then(resolve, reject);
        },
      );
    } catch (err) {
      // Without the check, papers already in the library would be added
      // again: import nothing, and say so
      if (!(err instanceof LibraryIndexError)) throw err;
      Zotero.debug(`[${config.addonName}] handleBatchImport: ${err}`);
      if (!this.disposed) {
        this.options.reporter.notify(
          getString("references-panel-batch-duplicate-check-failed"),
        );
      }
      return null;
    } finally {
      this.cancelDuplicateSearch = undefined;
    }
    // The panel went away during the search: ask nothing, import nothing
    if (!duplicates || this.disposed) {
      Zotero.debug(
        `[${config.addonName}] handleBatchImport: the panel was closed during the duplicate search`,
      );
      return null;
    }
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: duplicates.size=${duplicates.size}`,
    );

    // If there are duplicates, show dialog
    let entriesToImport = selectedEntries;
    if (duplicates.size > 0) {
      const result = await this.showDuplicateDialog(
        selectedEntries,
        duplicates,
      );
      if (!result) {
        return null; // User cancelled
      }
      entriesToImport = result;
    }

    if (entriesToImport.length === 0) {
      this.options.reporter.notify(
        getString("references-panel-batch-no-selection"),
      );
      return null;
    }

    // Prompt for save target
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: prompting for save target...`,
    );
    const target = await this.options.promptForSaveTarget(anchor);
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: target=${target ? "selected" : "cancelled"}`,
    );
    if (!target) {
      return null;
    }

    // Run batch import
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: starting batch import for ${entriesToImport.length} entries`,
    );
    return this.runBatchImport(entriesToImport, target);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Duplicate Detection
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Detect duplicates for selected entries.
   */
  private async detectDuplicates(
    entries: InspireReferenceEntry[],
  ): Promise<Map<string, DuplicateInfo>> {
    const duplicates = new Map<string, DuplicateInfo>();

    // Skip entries that already have localItemID
    const entriesToCheck = entries.filter((e) => !e.localItemID);
    if (entriesToCheck.length === 0) {
      // All entries already have localItemID
      for (const entry of entries) {
        if (entry.localItemID) {
          duplicates.set(entry.id, {
            localItemID: entry.localItemID,
            matchType: "recid",
          });
        }
      }
      return duplicates;
    }

    // Collect identifiers for batch queries
    const recids: string[] = [];
    const arxivIds: string[] = [];
    const dois: string[] = [];
    const entryByRecid = new Map<string, InspireReferenceEntry>();
    const entryByArxiv = new Map<string, InspireReferenceEntry>();
    const entryByDOI = new Map<string, InspireReferenceEntry>();

    for (const entry of entriesToCheck) {
      if (entry.recid) {
        recids.push(entry.recid);
        entryByRecid.set(entry.recid, entry);
      }
      const arxivId =
        typeof entry.arxivDetails === "object"
          ? entry.arxivDetails?.id
          : undefined;
      if (arxivId) {
        arxivIds.push(arxivId);
        entryByArxiv.set(arxivId, entry);
      }
      if (entry.doi) {
        dois.push(entry.doi);
        entryByDOI.set(entry.doi, entry);
      }
    }

    // Batch query for each identifier type (priority: recid > arXiv > DOI);
    // of several items with one identifier, the first (with a recid first,
    // then by item ID)
    const [recidMatches, arxivMatches, doiMatches] = await Promise.all([
      findItemsByRecids(recids),
      findItemsByArxivs(arxivIds),
      findItemsByDOIs(dois),
    ]);

    // Add already-local entries
    for (const entry of entries) {
      if (entry.localItemID) {
        duplicates.set(entry.id, {
          localItemID: entry.localItemID,
          matchType: "recid",
        });
      }
    }

    // Process matches in priority order
    for (const [recid, [hit]] of recidMatches) {
      const entry = entryByRecid.get(recid);
      if (entry && !duplicates.has(entry.id)) {
        duplicates.set(entry.id, { localItemID: hit.itemID, matchType: "recid" });
      }
    }

    for (const [arxivId, [hit]] of arxivMatches) {
      const entry = entryByArxiv.get(arxivId);
      if (entry && !duplicates.has(entry.id)) {
        duplicates.set(entry.id, { localItemID: hit.itemID, matchType: "arxiv" });
      }
    }

    for (const [doi, [hit]] of doiMatches) {
      const entry = entryByDOI.get(doi);
      if (entry && !duplicates.has(entry.id)) {
        duplicates.set(entry.id, { localItemID: hit.itemID, matchType: "doi" });
      }
    }

    return duplicates;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Duplicate Dialog
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Show duplicate detection dialog.
   */
  private showDuplicateDialog(
    entries: InspireReferenceEntry[],
    duplicates: Map<string, DuplicateInfo>,
  ): Promise<InspireReferenceEntry[] | null> {
    return new Promise((resolve) => {
      const doc = this.options.getDocument();
      const body = this.options.getBody();
      Zotero.debug(
        `[${config.addonName}] showDuplicateDialog: duplicates.size=${duplicates.size}`,
      );

      // Create overlay
      const overlay = doc.createElement("div");
      overlay.className = "zinspire-duplicate-dialog";
      Object.assign(overlay.style, {
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: "10000",
      });

      // However the dialog closes, it also stops listening for Escape
      const close = (result: InspireReferenceEntry[] | null) => {
        this.closeDuplicateDialog = undefined;
        overlay.remove();
        doc.removeEventListener("keydown", escapeHandler);
        resolve(result);
      };
      const escapeHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          close(null);
        }
      };

      // Create content container
      const content = doc.createElement("div");
      content.className = "zinspire-duplicate-dialog__content";
      Object.assign(content.style, {
        background: "var(--material-background, #ffffff)",
        borderRadius: "8px",
        padding: "16px",
        maxWidth: "90%",
        maxHeight: "70%",
        overflowY: "auto",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
      });

      // Title
      const title = doc.createElement("div");
      title.className = "zinspire-duplicate-dialog__title";
      Object.assign(title.style, {
        fontSize: "14px",
        fontWeight: "600",
        marginBottom: "8px",
      });
      title.textContent = getString("references-panel-batch-duplicate-title");
      content.appendChild(title);

      // Message
      const message = doc.createElement("div");
      message.className = "zinspire-duplicate-dialog__message";
      Object.assign(message.style, {
        fontSize: "12px",
        marginBottom: "12px",
      });
      message.textContent = getString(
        "references-panel-batch-duplicate-message",
        {
          args: { count: duplicates.size },
        },
      );
      content.appendChild(message);

      // List of duplicates
      const list = doc.createElement("div");
      list.className = "zinspire-duplicate-dialog__list";
      Object.assign(list.style, {
        maxHeight: "150px",
        overflowY: "auto",
        border: "1px solid var(--fill-quinary, #e0e0e0)",
        borderRadius: "4px",
        marginBottom: "12px",
      });

      const duplicateEntries = entries.filter((e) => duplicates.has(e.id));
      const checkboxMap = new Map<string, HTMLInputElement>();

      for (const entry of duplicateEntries) {
        const match = duplicates.get(entry.id)!;
        const item = doc.createElement("div");
        item.className = "zinspire-duplicate-dialog__item";
        Object.assign(item.style, {
          display: "flex",
          alignItems: "flex-start",
          gap: "8px",
          padding: "8px",
          borderBottom: "1px solid var(--fill-quinary, #e0e0e0)",
          fontSize: "12px",
        });

        const checkbox = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
        checkbox.type = "checkbox";
        Object.assign(checkbox.style, { marginTop: "2px", flexShrink: "0" });
        checkbox.checked = false;
        checkboxMap.set(entry.id, checkbox);
        item.appendChild(checkbox);

        const info = doc.createElement("div");
        Object.assign(info.style, { flex: "1", minWidth: "0" });

        const titleEl = doc.createElement("div");
        Object.assign(titleEl.style, {
          fontWeight: "500",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        });
        titleEl.textContent = entry.title;
        titleEl.title = entry.title;
        info.appendChild(titleEl);

        const matchEl = doc.createElement("div");
        Object.assign(matchEl.style, {
          fontSize: "10px",
          color: "var(--zotero-blue-6, #2554c7)",
          marginTop: "2px",
        });
        matchEl.textContent = getString(
          `references-panel-batch-duplicate-match-${match.matchType}`,
        );
        info.appendChild(matchEl);

        item.appendChild(info);
        list.appendChild(item);
      }
      content.appendChild(list);

      // Actions
      const actions = doc.createElement("div");
      Object.assign(actions.style, {
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
        justifyContent: "flex-end",
      });

      const createBtn = (text: string, primary = false) => {
        const btn = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
        Object.assign(btn.style, {
          border: "1px solid var(--zotero-gray-4, #d1d1d5)",
          borderRadius: "4px",
          padding: "6px 12px",
          fontSize: "12px",
          cursor: "pointer",
          background: primary
            ? "var(--zotero-blue-5, #0060df)"
            : "var(--zotero-gray-1, #ffffff)",
          color: primary ? "#ffffff" : "var(--zotero-gray-7, #2b2b30)",
          borderColor: primary
            ? "var(--zotero-blue-5, #0060df)"
            : "var(--zotero-gray-4, #d1d1d5)",
        });
        btn.textContent = text;
        return btn;
      };

      // Skip All
      const skipAllBtn = createBtn(
        getString("references-panel-batch-duplicate-skip-all"),
      );
      skipAllBtn.addEventListener("click", () => {
        for (const cb of checkboxMap.values()) cb.checked = false;
      });
      actions.appendChild(skipAllBtn);

      // Import All
      const importAllBtn = createBtn(
        getString("references-panel-batch-duplicate-import-all"),
      );
      importAllBtn.addEventListener("click", () => {
        for (const cb of checkboxMap.values()) cb.checked = true;
      });
      actions.appendChild(importAllBtn);

      // Cancel
      const cancelBtn = createBtn(
        getString("references-panel-batch-duplicate-cancel"),
      );
      cancelBtn.addEventListener("click", () => close(null));
      actions.appendChild(cancelBtn);

      // Confirm
      const confirmBtn = createBtn(
        getString("references-panel-batch-duplicate-confirm"),
        true,
      );
      confirmBtn.addEventListener("click", () => {
        const result: InspireReferenceEntry[] = [];
        for (const entry of entries) {
          if (!duplicates.has(entry.id)) {
            result.push(entry);
          } else if (checkboxMap.get(entry.id)?.checked) {
            result.push(entry);
          }
        }
        close(result);
      });
      actions.appendChild(confirmBtn);

      content.appendChild(actions);
      overlay.appendChild(content);
      body.appendChild(overlay);

      // Close on overlay click
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          close(null);
        }
      });

      // Close on Escape
      doc.addEventListener("keydown", escapeHandler);
      this.closeDuplicateDialog = close;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Batch Import
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Run batch import with progress display.
   */
  private async runBatchImport(
    entries: InspireReferenceEntry[],
    target: SaveTargetSelection,
  ): Promise<BatchImportResult> {
    const total = entries.length;
    let done = 0;
    let success = 0;
    let failed = 0;

    // Setup cancellation
    this.importAbort = createAbortController();
    const signal = this.importAbort?.signal || createMockSignal();

    // Escape key listener
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.importAbort?.abort();
      }
    };
    // In the panel's window (for the References panel, the main window)
    const panelWindow =
      this.options.getDocument().defaultView ?? Zotero.getMainWindow();
    panelWindow?.addEventListener("keydown", escapeHandler, true);

    // Progress display
    const progress = this.options.reporter.startProgress(
      getString("references-panel-batch-importing", {
        args: { done: 0, total },
      }),
    );

    // Concurrency limiter
    const CONCURRENCY = 3;
    let index = 0;

    const worker = async () => {
      while (index < entries.length && !signal.aborted) {
        const currentIndex = index++;
        const entry = entries[currentIndex];

        try {
          const newItem = await this.options.importReference(
            entry.recid!,
            target,
          );
          if (newItem) {
            entry.localItemID = newItem.id;
            entry.displayText = buildDisplayText(entry);
            entry.searchText = "";
            this.selectedEntryIDs.delete(entry.id);
            this.options.updateRowStatus(entry);
            success++;
          } else {
            failed++;
          }
        } catch (err) {
          Zotero.debug(`[${config.addonName}] Batch import error: ${err}`);
          failed++;
        }

        done++;
        const percent = Math.round((done / total) * 100);
        progress.update(
          getString("references-panel-batch-importing", {
            args: { done, total },
          }),
          percent,
        );
      }
    };

    try {
      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.min(CONCURRENCY, entries.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
    } finally {
      panelWindow?.removeEventListener("keydown", escapeHandler, true);
      this.importAbort = undefined;

      progress.close();

      // Show result toast
      if (signal.aborted) {
        this.options.reporter.notify(
          getString("references-panel-batch-import-cancelled", {
            args: { done, total },
          }),
        );
      } else if (failed > 0) {
        this.options.reporter.notify(
          getString("references-panel-batch-import-partial", {
            args: { success, total, failed },
          }),
        );
      } else {
        this.options.reporter.notify(
          getString("references-panel-batch-import-success", {
            args: { count: success },
          }),
        );
      }

      this.updateAllCheckboxes();
      this.notifySelectionChange();
    }

    return { success, failed, cancelled: signal.aborted };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: UI Updates
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update all visible checkboxes to match selection state.
   */
  private updateAllCheckboxes(): void {
    const listEl = this.options.getListElement();
    const checkboxes = listEl.querySelectorAll(".zinspire-ref-entry__checkbox");
    for (let i = 0; i < checkboxes.length; i++) {
      const checkbox = checkboxes[i] as HTMLInputElement;
      const entryId = checkbox.dataset?.entryId;
      if (entryId) {
        checkbox.checked = this.selectedEntryIDs.has(entryId);
      }
    }
  }

  /**
   * Notify about selection change.
   */
  private notifySelectionChange(): void {
    this.options.onSelectionChange?.(this.selectedEntryIDs.size);
  }

  /**
   * Record whether a batch import is under way and tell every open panel. A
   * panel that fails to update (its window may be gone) does not stop the
   * others.
   */
  private static setImportInProgress(inProgress: boolean): void {
    BatchImportManager.importInProgress = inProgress;
    for (const manager of BatchImportManager.openManagers) {
      try {
        manager.options.onImportStateChange?.(inProgress);
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] onImportStateChange failed: ${err}`,
        );
      }
    }
  }
}
