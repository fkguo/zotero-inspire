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
} from "../index";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";

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
 * Save target for batch import (passed from picker).
 */
export interface BatchSaveTarget {
  libraryID?: number;
  collectionIDs: (number | undefined)[];
  tags?: string[];
  note?: string;
  primaryRowID: string;
}

/**
 * Options for BatchImportManager initialization.
 */
export interface BatchImportManagerOptions {
  /** Callback to get the document for UI operations */
  getDocument: () => Document;
  /** Callback to get the body element for attaching dialogs */
  getBody: () => HTMLElement;
  /** Callback to get the list element for checkbox updates */
  getListElement: () => HTMLElement;
  /** Callback to get all entries */
  getAllEntries: () => InspireReferenceEntry[];
  /** Callback to get filtered entries (current view) */
  getFilteredEntries: () => InspireReferenceEntry[];
  /** Callback to import a single reference by recid */
  importReference: (recid: string, target: BatchSaveTarget) => Promise<Zotero.Item | null>;
  /** Callback to prompt for save target (shows picker UI) */
  promptForSaveTarget: (anchor: HTMLElement) => Promise<BatchSaveTarget | null>;
  /** Callback to show a toast notification */
  showToast: (message: string) => void;
  /** Callback to update a single row's status in the list */
  updateRowStatus: (entry: InspireReferenceEntry) => void;
  /** Callback when batch toolbar visibility should be updated */
  onSelectionChange?: (count: number) => void;
}

/**
 * Batch import state.
 */
export interface BatchImportState {
  selectedCount: number;
  isImporting: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// BatchImportManager Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages batch import functionality for the References Panel.
 * Handles selection, duplicate detection, and batch import with progress.
 */
export class BatchImportManager {
  private options: BatchImportManagerOptions;

  // Selection state
  private selectedEntryIDs = new Set<string>();
  private lastSelectedEntryID?: string;

  // Import state
  private importAbort?: AbortController;
  private isImporting = false;

  constructor(options: BatchImportManagerOptions) {
    this.options = options;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the current batch import state.
   */
  getState(): BatchImportState {
    return {
      selectedCount: this.selectedEntryIDs.size,
      isImporting: this.isImporting,
    };
  }

  /**
   * Get the set of selected entry IDs.
   */
  getSelectedEntryIDs(): Set<string> {
    return new Set(this.selectedEntryIDs);
  }

  /**
   * Check if an entry is selected.
   */
  isSelected(entryId: string): boolean {
    return this.selectedEntryIDs.has(entryId);
  }

  /**
   * Handle checkbox click with Shift+Click range selection support.
   */
  handleCheckboxClick(entry: InspireReferenceEntry, event: MouseEvent): void {
    const checkbox = event.target as HTMLInputElement;
    const isChecked = checkbox.checked;

    if (event.shiftKey && this.lastSelectedEntryID) {
      // Shift+Click: select range
      const filteredEntries = this.options.getFilteredEntries();
      const lastIndex = filteredEntries.findIndex((e) => e.id === this.lastSelectedEntryID);
      const currentIndex = filteredEntries.findIndex((e) => e.id === entry.id);

      if (lastIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);

        for (let i = start; i <= end; i++) {
          const e = filteredEntries[i];
          if (isChecked) {
            this.selectedEntryIDs.add(e.id);
          } else {
            this.selectedEntryIDs.delete(e.id);
          }
        }

        this.updateAllCheckboxes();
      }
    } else {
      // Regular click: toggle single item
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
   * Handle batch import button click.
   * Returns the import result or null if cancelled.
   */
  async handleBatchImport(anchor: HTMLElement): Promise<BatchImportResult | null> {
    if (this.selectedEntryIDs.size === 0) {
      this.options.showToast(getString("references-panel-batch-no-selection"));
      return null;
    }

    const allEntries = this.options.getAllEntries();
    const selectedEntries = allEntries.filter(
      (e) => this.selectedEntryIDs.has(e.id) && e.recid
    );

    if (selectedEntries.length === 0) {
      this.options.showToast(getString("references-panel-batch-no-selection"));
      return null;
    }

    // Detect duplicates
    const duplicates = await this.detectDuplicates(selectedEntries);

    // If there are duplicates, show dialog
    let entriesToImport = selectedEntries;
    if (duplicates.size > 0) {
      const result = await this.showDuplicateDialog(selectedEntries, duplicates);
      if (!result) {
        return null; // User cancelled
      }
      entriesToImport = result;
    }

    if (entriesToImport.length === 0) {
      this.options.showToast(getString("references-panel-batch-no-selection"));
      return null;
    }

    // Prompt for save target
    const target = await this.options.promptForSaveTarget(anchor);
    if (!target) {
      return null;
    }

    // Run batch import
    return this.runBatchImport(entriesToImport, target);
  }

  /**
   * Cancel the current batch import operation.
   */
  cancelImport(): void {
    this.importAbort?.abort();
  }

  /**
   * Cleanup manager resources.
   */
  destroy(): void {
    this.cancelImport();
    this.selectedEntryIDs.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Duplicate Detection
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Detect duplicates for selected entries.
   */
  private async detectDuplicates(
    entries: InspireReferenceEntry[]
  ): Promise<Map<string, DuplicateInfo>> {
    const duplicates = new Map<string, DuplicateInfo>();

    // Skip entries that already have localItemID
    const entriesToCheck = entries.filter((e) => !e.localItemID);
    if (entriesToCheck.length === 0) {
      // All entries already have localItemID
      for (const entry of entries) {
        if (entry.localItemID) {
          duplicates.set(entry.id, { localItemID: entry.localItemID, matchType: "recid" });
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
        typeof entry.arxivDetails === "object" ? entry.arxivDetails?.id : undefined;
      if (arxivId) {
        arxivIds.push(arxivId);
        entryByArxiv.set(arxivId, entry);
      }
      if (entry.doi) {
        dois.push(entry.doi);
        entryByDOI.set(entry.doi, entry);
      }
    }

    // Batch query for each identifier type (priority: recid > arXiv > DOI)
    const [recidMatches, arxivMatches, doiMatches] = await Promise.all([
      recids.length > 0 ? findItemsByRecids(recids) : Promise.resolve(new Map<string, number>()),
      arxivIds.length > 0
        ? findItemsByArxivs(arxivIds)
        : Promise.resolve(new Map<string, number>()),
      dois.length > 0 ? findItemsByDOIs(dois) : Promise.resolve(new Map<string, number>()),
    ]);

    // Add already-local entries
    for (const entry of entries) {
      if (entry.localItemID) {
        duplicates.set(entry.id, { localItemID: entry.localItemID, matchType: "recid" });
      }
    }

    // Process matches in priority order
    for (const [recid, localItemID] of recidMatches) {
      const entry = entryByRecid.get(recid);
      if (entry && !duplicates.has(entry.id)) {
        duplicates.set(entry.id, { localItemID, matchType: "recid" });
      }
    }

    for (const [arxivId, localItemID] of arxivMatches) {
      const entry = entryByArxiv.get(arxivId);
      if (entry && !duplicates.has(entry.id)) {
        duplicates.set(entry.id, { localItemID, matchType: "arxiv" });
      }
    }

    for (const [doi, localItemID] of doiMatches) {
      const entry = entryByDOI.get(doi);
      if (entry && !duplicates.has(entry.id)) {
        duplicates.set(entry.id, { localItemID, matchType: "doi" });
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
    duplicates: Map<string, DuplicateInfo>
  ): Promise<InspireReferenceEntry[] | null> {
    return new Promise((resolve) => {
      const doc = this.options.getDocument();
      const body = this.options.getBody();

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
      Object.assign(title.style, {
        fontSize: "14px",
        fontWeight: "600",
        marginBottom: "8px",
      });
      title.textContent = getString("references-panel-batch-duplicate-title");
      content.appendChild(title);

      // Message
      const message = doc.createElement("div");
      Object.assign(message.style, {
        fontSize: "12px",
        marginBottom: "12px",
      });
      message.textContent = getString("references-panel-batch-duplicate-message", {
        args: { count: duplicates.size },
      });
      content.appendChild(message);

      // List of duplicates
      const list = doc.createElement("div");
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
        Object.assign(item.style, {
          display: "flex",
          alignItems: "flex-start",
          gap: "8px",
          padding: "8px",
          borderBottom: "1px solid var(--fill-quinary, #e0e0e0)",
          fontSize: "12px",
        });

        const checkbox = doc.createElement("input");
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
          `references-panel-batch-duplicate-match-${match.matchType}`
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
        const btn = doc.createElement("button");
        Object.assign(btn.style, {
          border: "1px solid var(--zotero-gray-4, #d1d1d5)",
          borderRadius: "4px",
          padding: "6px 12px",
          fontSize: "12px",
          cursor: "pointer",
          background: primary ? "var(--zotero-blue-5, #0060df)" : "var(--zotero-gray-1, #ffffff)",
          color: primary ? "#ffffff" : "var(--zotero-gray-7, #2b2b30)",
          borderColor: primary ? "var(--zotero-blue-5, #0060df)" : "var(--zotero-gray-4, #d1d1d5)",
        });
        btn.textContent = text;
        return btn;
      };

      // Skip All
      const skipAllBtn = createBtn(getString("references-panel-batch-duplicate-skip-all"));
      skipAllBtn.addEventListener("click", () => {
        for (const cb of checkboxMap.values()) cb.checked = false;
      });
      actions.appendChild(skipAllBtn);

      // Import All
      const importAllBtn = createBtn(getString("references-panel-batch-duplicate-import-all"));
      importAllBtn.addEventListener("click", () => {
        for (const cb of checkboxMap.values()) cb.checked = true;
      });
      actions.appendChild(importAllBtn);

      // Cancel
      const cancelBtn = createBtn(getString("references-panel-batch-duplicate-cancel"));
      cancelBtn.addEventListener("click", () => {
        overlay.remove();
        resolve(null);
      });
      actions.appendChild(cancelBtn);

      // Confirm
      const confirmBtn = createBtn(
        getString("references-panel-batch-duplicate-confirm"),
        true
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
        overlay.remove();
        resolve(result);
      });
      actions.appendChild(confirmBtn);

      content.appendChild(actions);
      overlay.appendChild(content);
      body.appendChild(overlay);

      // Close on overlay click
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(null);
        }
      });

      // Close on Escape
      const escapeHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          overlay.remove();
          resolve(null);
          doc.removeEventListener("keydown", escapeHandler);
        }
      };
      doc.addEventListener("keydown", escapeHandler);
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
    target: BatchSaveTarget
  ): Promise<BatchImportResult> {
    const total = entries.length;
    let done = 0;
    let success = 0;
    let failed = 0;

    this.isImporting = true;

    // Setup cancellation
    let AbortControllerClass =
      typeof AbortController !== "undefined" ? AbortController : null;
    if (!AbortControllerClass) {
      const win = Zotero.getMainWindow();
      if (win && (win as any).AbortController) {
        AbortControllerClass = (win as any).AbortController;
      }
    }

    this.importAbort = AbortControllerClass ? new AbortControllerClass() : undefined;
    const signal = this.importAbort?.signal || {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    // Escape key listener
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.importAbort?.abort();
      }
    };
    const mainWindow = Zotero.getMainWindow();
    mainWindow?.addEventListener("keydown", escapeHandler, true);

    // Progress window
    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
    const progressWindow = new ProgressWindowHelper(config.addonName);
    progressWindow.win.changeHeadline(config.addonName, icon);
    progressWindow.createLine({
      text: getString("references-panel-batch-importing", { args: { done: 0, total } }),
      progress: 0,
    });
    progressWindow.show(-1);

    // Concurrency limiter
    const CONCURRENCY = 3;
    let index = 0;

    const worker = async () => {
      while (index < entries.length && !signal.aborted) {
        const currentIndex = index++;
        const entry = entries[currentIndex];

        try {
          const newItem = await this.options.importReference(entry.recid!, target);
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
        progressWindow.changeLine({
          text: getString("references-panel-batch-importing", { args: { done, total } }),
          progress: percent,
        });
      }
    };

    try {
      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.min(CONCURRENCY, entries.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
    } finally {
      mainWindow?.removeEventListener("keydown", escapeHandler, true);
      this.importAbort = undefined;
      this.isImporting = false;

      progressWindow.close();

      // Show result toast
      if (signal.aborted) {
        this.options.showToast(
          getString("references-panel-batch-import-cancelled", { args: { done, total } })
        );
      } else if (failed > 0) {
        this.options.showToast(
          getString("references-panel-batch-import-partial", { args: { success, total, failed } })
        );
      } else {
        this.options.showToast(
          getString("references-panel-batch-import-success", { args: { count: success } })
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
}
