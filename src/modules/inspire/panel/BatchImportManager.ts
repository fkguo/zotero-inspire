// ─────────────────────────────────────────────────────────────────────────────
// BatchImportManager - Batch import functionality for References Panel
// Extracted from InspireReferencePanelController as part of controller refactoring
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import {
  type InspireReferenceEntry,
  buildDisplayText,
  createAbortController,
  createMockSignal,
} from "../index";
import type { SaveTargetSelection } from "../../pickerUI";
import type { AddPaperOutcome } from "../../arxiv/addToLibrary";
import type { ArxivPdfResult } from "../../arxiv/arxivPdf";
import { LibraryIndexError } from "../library/arxivIndex";
import {
  duplicateInfo,
  entryArxivId,
  findDuplicates,
  mergeHits,
  type DuplicateInfo,
} from "../library/localStatus";
import type { Reporter } from "./reporter";

// XHTML namespace for proper element creation in Zotero (FIX-NAMESPACE-WARNING)
const XHTML_NS = "http://www.w3.org/1999/xhtml";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Duplicate detection result for an entry (library/localStatus.ts).
 */
export type { DuplicateInfo };

/**
 * The selected rows that show one paper (a paper announced on two days has a
 * row on each): the paper is checked and imported once, and what came of it
 * is written to every row showing it
 */
export interface SelectedPaper {
  /** The selected rows, in list order; the first stands for the paper */
  entries: InspireReferenceEntry[];
}

/**
 * The identifiers that make rows one paper: the canonical arXiv identifier
 * and the INSPIRE recid (one INSPIRE record per arXiv identifier); a row
 * with neither is a paper of its own
 */
function paperKeys(entry: InspireReferenceEntry): string[] {
  const keys: string[] = [];
  const arxivId = entryArxivId(entry);
  if (arxivId) keys.push(`arxiv:${arxivId}`);
  if (entry.recid) keys.push(`recid:${entry.recid}`);
  return keys.length ? keys : [`row:${entry.id}`];
}

/** `entries` gathered into papers, in the order of their first rows */
export function groupByPaper(
  entries: readonly InspireReferenceEntry[],
): SelectedPaper[] {
  const papers: SelectedPaper[] = [];
  const paperOf = new Map<string, SelectedPaper>();
  for (const entry of entries) {
    const keys = paperKeys(entry);
    let paper = keys.map((key) => paperOf.get(key)).find(Boolean);
    if (!paper) {
      paper = { entries: [] };
      papers.push(paper);
    }
    paper.entries.push(entry);
    for (const key of keys) if (!paperOf.has(key)) paperOf.set(key, paper);
  }
  return papers;
}

/** A paper added by a batch import */
export interface AddedPaper {
  /** Its selected rows */
  entries: InspireReferenceEntry[];
  outcome: Extract<AddPaperOutcome, { status: "added" }>;
  /** How attaching its arXiv PDF ended, when one was attached */
  pdf?: ArxivPdfResult;
}

/** A paper a batch import did not add, and why */
export interface NotAddedPaper {
  /** Its selected rows */
  entries: InspireReferenceEntry[];
  outcome: Exclude<AddPaperOutcome, { status: "added" }>;
}

/** The name of a library, as Zotero shows it */
function libraryName(libraryID: number): string {
  const library = Zotero.Libraries.get(libraryID) as { name?: string } | false;
  return (library && library.name) || `Library ${libraryID}`;
}

/** A paper skipped in the duplicate dialog: in the library already */
function skippedPaper(
  paper: SelectedPaper,
  info: DuplicateInfo | undefined,
): NotAddedPaper {
  const hits = info?.hits ?? [];
  return {
    entries: paper.entries,
    outcome: {
      status: "inLibrary",
      hits,
      doiOnly: hits.every((hit) => hit.by.every((by) => by === "doi")),
    },
  };
}

/**
 * Result of batch import operation.
 */
export interface BatchImportResult {
  success: number;
  /** Papers not added for another reason than the cancel */
  failed: number;
  cancelled: boolean;
  /** The papers added, in list order */
  added: AddedPaper[];
  /**
   * The papers not added, in list order: those the cancel stopped, and those
   * skipped in the duplicate dialog (as in the library), included
   */
  notAdded: NotAddedPaper[];
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
  /**
   * Whether a selected row can be imported (default: it has an INSPIRE
   * record)
   */
  canImport?: (entry: InspireReferenceEntry) => boolean;
  /**
   * Called once, before the first paper is imported, with the first row of
   * every paper to import: what the papers need from the network can be
   * asked for all of them at once
   */
  prepareImport?: (
    entries: InspireReferenceEntry[],
    target: SaveTargetSelection,
    signal: AbortSignal,
  ) => Promise<void>;
  /**
   * Import one paper (`entry` is its first selected row) into `target`, a
   * few at a time. When the user cancels, `signal` aborts: the paper's
   * requests, waiting or in flight, end, and nothing is saved after that; a
   * save already under way completes.
   */
  importEntry: (
    entry: InspireReferenceEntry,
    target: SaveTargetSelection,
    signal: AbortSignal,
  ) => Promise<AddPaperOutcome>;
  /** Callback to prompt for save target (shows picker UI) */
  promptForSaveTarget: (
    anchor: HTMLElement,
  ) => Promise<SaveTargetSelection | null>;
  /** Where notices and the import's progress are shown */
  reporter: Reporter;
  /**
   * Tell the user what came of an import (default: a notice with the counts
   * of papers added and not added)
   */
  summarize?: (result: BatchImportResult) => void;
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
  private closeDuplicateDialog?: (result: SelectedPaper[] | null) => void;
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

  /** Select or unselect these rows */
  setSelected(
    entries: readonly InspireReferenceEntry[],
    selected: boolean,
  ): void {
    for (const entry of entries) {
      if (selected) this.selectedEntryIDs.add(entry.id);
      else this.selectedEntryIDs.delete(entry.id);
    }
    this.updateAllCheckboxes();
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
    const canImport = this.options.canImport ?? ((e) => !!e.recid);
    const selectedEntries = allEntries.filter(
      (e) => this.selectedEntryIDs.has(e.id) && canImport(e),
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
      return await this.importSelectedPapers(
        groupByPaper(selectedEntries),
        anchor,
      );
    } finally {
      BatchImportManager.setImportInProgress(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Import Flow
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check the selected papers for duplicates, ask for the save target, and
   * import. Returns the import result or null if cancelled.
   */
  private async importSelectedPapers(
    selectedPapers: SelectedPaper[],
    anchor: HTMLElement,
  ): Promise<BatchImportResult | null> {
    // Detect duplicates
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: detecting duplicates...`,
    );
    // If the panel goes away meanwhile, stop waiting for the search
    let duplicates: Map<SelectedPaper, DuplicateInfo> | null;
    try {
      duplicates = await new Promise<Map<SelectedPaper, DuplicateInfo> | null>(
        (resolve, reject) => {
          this.cancelDuplicateSearch = () => resolve(null);
          this.detectDuplicates(selectedPapers).then(resolve, reject);
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
    let papersToImport = selectedPapers;
    if (duplicates.size > 0) {
      const result = await this.showDuplicateDialog(selectedPapers, duplicates);
      if (!result) {
        return null; // User cancelled
      }
      papersToImport = result;
    }

    if (papersToImport.length === 0) {
      // Every paper was skipped in the duplicate dialog
      const result: BatchImportResult = {
        success: 0,
        failed: 0,
        cancelled: false,
        added: [],
        notAdded: selectedPapers.map((paper) =>
          skippedPaper(paper, duplicates.get(paper)),
        ),
      };
      if (this.options.summarize) {
        this.options.summarize(result);
      } else {
        this.options.reporter.notify(
          getString("references-panel-batch-no-selection"),
        );
      }
      return result;
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
      `[${config.addonName}] handleBatchImport: starting batch import for ${papersToImport.length} papers`,
    );
    return this.runBatchImport(
      selectedPapers,
      papersToImport,
      target,
      duplicates,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Duplicate Detection
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Papers of the selection already in the library (localStatus.ts), with
   * the items found by any of their rows. Rejects with LibraryIndexError
   * when the library cannot be read.
   */
  private async detectDuplicates(
    papers: SelectedPaper[],
  ): Promise<Map<SelectedPaper, DuplicateInfo>> {
    const byRow = await findDuplicates(papers.flatMap((p) => p.entries));
    const duplicates = new Map<SelectedPaper, DuplicateInfo>();
    for (const paper of papers) {
      const info = duplicateInfo(
        mergeHits(paper.entries.flatMap((e) => byRow.get(e.id)?.hits ?? [])),
      );
      if (info) duplicates.set(paper, info);
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
    papers: SelectedPaper[],
    duplicates: Map<SelectedPaper, DuplicateInfo>,
  ): Promise<SelectedPaper[] | null> {
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
      const close = (result: SelectedPaper[] | null) => {
        this.closeDuplicateDialog = undefined;
        overlay.remove();
        doc.removeEventListener("keydown", escapeHandler);
        resolve(result);
      };
      const escapeHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          // Handled here: a running update does not take it as a cancel
          e.preventDefault();
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

      const duplicatePapers = papers.filter((p) => duplicates.has(p));
      const hasGroups = Zotero.Libraries.getAll().some(
        (library) => library.libraryType === "group",
      );
      const checkboxMap = new Map<SelectedPaper, HTMLInputElement>();

      for (const paper of duplicatePapers) {
        const [entry] = paper.entries;
        const match = duplicates.get(paper)!;
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
        checkboxMap.set(paper, checkbox);
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
        // Several items have the paper (in one library or in several)
        if (match.hits.length > 1) {
          matchEl.textContent += ` ${getString(
            "references-panel-batch-duplicate-items",
            { args: { count: match.hits.length } },
          )}`;
        }
        // With group libraries, say which libraries have the paper: the
        // target is chosen after this dialog, and the paper may be wanted in
        // another library all the same
        const libraryIDs = [...new Set(match.hits.map((hit) => hit.libraryID))];
        if (hasGroups) {
          matchEl.textContent += ` ${getString(
            "references-panel-batch-duplicate-libraries",
            { args: { libraries: libraryIDs.map(libraryName).join(", ") } },
          )}`;
        }
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
        close(
          papers.filter(
            (paper) =>
              !duplicates.has(paper) || checkboxMap.get(paper)?.checked,
          ),
        );
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
   * Run batch import with progress display: import `papers`, of the
   * `selectedPapers` (the others were skipped in the duplicate dialog).
   */
  private async runBatchImport(
    selectedPapers: SelectedPaper[],
    papers: SelectedPaper[],
    target: SaveTargetSelection,
    duplicates: Map<SelectedPaper, DuplicateInfo>,
  ): Promise<BatchImportResult> {
    const total = papers.length;
    let done = 0;
    const outcomes: AddPaperOutcome[] = [];
    const pdfs: Promise<ArxivPdfResult>[] = [];
    const pdfOf = new Map<number, ArxivPdfResult>();

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

    // The list's rows by paper, for writing each outcome to every row showing
    // the paper
    const rowsByKey = new Map<string, InspireReferenceEntry[]>();
    for (const entry of this.options.getAllEntries()) {
      for (const key of paperKeys(entry)) {
        const rows = rowsByKey.get(key);
        if (rows) rows.push(entry);
        else rowsByKey.set(key, [entry]);
      }
    }

    // Concurrency limiter
    const CONCURRENCY = 3;
    let index = 0;

    const worker = async () => {
      while (index < papers.length && !signal.aborted) {
        const currentIndex = index++;
        const paper = papers[currentIndex];

        let outcome: AddPaperOutcome;
        try {
          outcome = await this.options.importEntry(
            paper.entries[0],
            target,
            signal,
          );
        } catch (err) {
          Zotero.debug(`[${config.addonName}] Batch import error: ${err}`);
          outcome = signal.aborted
            ? { status: "cancelled" }
            : { status: "failed", reason: "save", message: String(err) };
        }
        outcomes[currentIndex] = outcome;
        if (outcome.status === "cancelled") continue;
        if (outcome.status === "added") {
          try {
            this.markAdded(paper, outcome.item, rowsByKey);
          } catch (err) {
            Zotero.debug(`[${config.addonName}] Batch import rows: ${err}`);
          }
          const pdf = outcome.pdf;
          if (pdf) {
            pdfs.push(
              pdf
                .catch(
                  (err): ArxivPdfResult => ({
                    status: "failed",
                    reason: "save",
                    message: String(err),
                  }),
                )
                .then((result) => {
                  pdfOf.set(currentIndex, result);
                  return result;
                }),
            );
          }
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
      // Should it fail, each paper's import says why it was not added
      await this.options
        .prepareImport?.(
          papers.map((paper) => paper.entries[0]),
          target,
          signal,
        )
        .catch((err) =>
          Zotero.debug(`[${config.addonName}] Batch import: ${err}`),
        );
      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.min(CONCURRENCY, papers.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      // The PDFs are fetched after the items are saved; Escape still stops
      // them
      if (pdfs.length) {
        let attached = 0;
        const showPdfs = () =>
          progress.update(
            getString("references-panel-batch-attaching-pdfs", {
              args: { done: attached, total: pdfs.length },
            }),
            Math.round((attached / pdfs.length) * 100),
          );
        showPdfs();
        await Promise.all(
          pdfs.map((pdf) =>
            pdf.then(() => {
              attached++;
              showPdfs();
            }),
          ),
        );
      }
    } finally {
      panelWindow?.removeEventListener("keydown", escapeHandler, true);
      this.importAbort = undefined;

      progress.close();
    }

    const added: AddedPaper[] = [];
    const notAdded: NotAddedPaper[] = [];
    const indexOf = new Map(papers.map((paper, i) => [paper, i]));
    for (const paper of selectedPapers) {
      const i = indexOf.get(paper);
      if (i === undefined) {
        notAdded.push(skippedPaper(paper, duplicates.get(paper)));
        continue;
      }
      const outcome = outcomes[i] ?? { status: "cancelled" };
      if (outcome.status === "added") {
        const pdf = pdfOf.get(i);
        added.push({
          entries: paper.entries,
          outcome,
          ...(pdf ? { pdf } : {}),
        });
      } else {
        notAdded.push({ entries: paper.entries, outcome });
      }
    }
    const success = added.length;
    // Of the papers imported, those not added for another reason than the
    // cancel
    const failed = outcomes.filter(
      (o) => o && o.status !== "added" && o.status !== "cancelled",
    ).length;

    const result: BatchImportResult = {
      success,
      failed,
      cancelled: signal.aborted,
      added,
      notAdded,
    };
    if (this.options.summarize) {
      this.options.summarize(result);
    } else if (signal.aborted) {
      // Show result toast
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

    return result;
  }

  /**
   * Show `item` as the paper's on every row showing it (the selected ones,
   * and any other the list has), and unselect them
   */
  private markAdded(
    paper: SelectedPaper,
    item: Zotero.Item,
    rowsByKey: ReadonlyMap<string, InspireReferenceEntry[]>,
  ): void {
    const rows = new Set(paper.entries);
    for (const key of paper.entries.flatMap(paperKeys)) {
      for (const entry of rowsByKey.get(key) ?? []) rows.add(entry);
    }
    for (const entry of rows) {
      // The new item first, as the mark shows it, with the items already known
      entry.localItemID = item.id;
      entry.localItemIDs = [
        item.id,
        ...(entry.localItemIDs ?? []).filter((id) => id !== item.id),
      ];
      entry.displayText = buildDisplayText(entry);
      entry.searchText = "";
      this.selectedEntryIDs.delete(entry.id);
      this.options.updateRowStatus(entry);
    }
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
