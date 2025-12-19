// ─────────────────────────────────────────────────────────────────────────────
// ExportManager - Export functionality for References Panel
// Extracted from InspireReferencePanelController as part of controller refactoring
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import {
  INSPIRE_API_BASE,
  METADATA_BATCH_SIZE,
  PROGRESS_CLOSE_DELAY_MS,
  PROGRESS_CLOSE_DELAY_WARN_MS,
  CLIPBOARD_WARN_SIZE_BYTES,
  type InspireReferenceEntry,
  inspireFetch,
  fetchBibTeX,
  copyToClipboard,
  getCachedStrings,
  // FTR-ABORT-CONTROLLER-FIX
  createAbortController,
} from "../index";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export format types supported by INSPIRE API.
 */
export type ExportFormat = "bibtex" | "latex-us" | "latex-eu";

/**
 * Export target - clipboard or file.
 */
export type ExportTarget = "clipboard" | "file";

/**
 * Format configuration for export menu.
 */
export interface ExportFormatConfig {
  id: ExportFormat;
  label: string;
  ext: string;
}

/**
 * Options for ExportManager initialization.
 */
export interface ExportManagerOptions {
  /** Callback to get the document for UI operations */
  getDocument: () => Document;
  /** Callback to get entries for export */
  getEntries: () => InspireReferenceEntry[];
  /** Callback to get selected entry IDs */
  getSelectedEntryIDs: () => Set<string>;
  /** Callback to get current recid for filename generation */
  getCurrentRecid: () => string | undefined;
}

/**
 * Export result information.
 */
export interface ExportResult {
  success: boolean;
  count: number;
  format: string;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Supported export formats */
export const EXPORT_FORMATS: ExportFormatConfig[] = [
  { id: "bibtex", label: "BibTeX (.bib)", ext: ".bib" },
  { id: "latex-us", label: "LaTeX (US)", ext: ".tex" },
  { id: "latex-eu", label: "LaTeX (EU)", ext: ".tex" },
];

// ─────────────────────────────────────────────────────────────────────────────
// ExportManager Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages export functionality for the References Panel.
 * Handles BibTeX/LaTeX export to clipboard and file.
 */
export class ExportManager {
  private options: ExportManagerOptions;

  // PERF-FIX-2: Track AbortController for cancellable exports
  private exportAbort?: AbortController;

  constructor(options: ExportManagerOptions) {
    this.options = options;
  }

  /**
   * PERF-FIX-2: Cancel any ongoing export operation.
   * Call this when the panel is destroyed or user navigates away.
   */
  cancelExport(): void {
    if (this.exportAbort) {
      this.exportAbort.abort();
      this.exportAbort = undefined;
      Zotero.debug(`[${config.addonName}] Export operation cancelled`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Copy all visible references as BibTeX to the clipboard.
   * Uses batch queries to efficiently fetch BibTeX from INSPIRE.
   * PERF-FIX-2: Now cancellable via AbortController.
   */
  async copyAllBibTeX(): Promise<void> {
    const strings = getCachedStrings();
    const entries = this.options.getEntries();
    const entriesWithRecid = entries.filter((e) => e.recid);

    if (!entriesWithRecid.length) {
      this.showNotification(strings.noRecidEntries, "default");
      return;
    }

    // PERF-FIX-2: Create AbortController for this export operation
    this.cancelExport(); // Cancel any previous export
    // FTR-ABORT-CONTROLLER-FIX: Use utility function to safely create AbortController
    // Don't create mock signal - only pass real signal to fetch()
    this.exportAbort = createAbortController();

    const allBibTeX: string[] = [];
    let successCount = 0;

    const progressWin = this.createProgressWindow(strings.bibtexFetching);

    try {
      for (let i = 0; i < entriesWithRecid.length; i += METADATA_BATCH_SIZE) {
        // PERF-FIX-2: Check abort before each batch (use optional chaining)
        if (this.exportAbort?.signal?.aborted) {
          Zotero.debug(`[${config.addonName}] BibTeX export aborted`);
          progressWin.changeLine({ text: "Export cancelled", type: "default" });
          break;
        }

        const batch = entriesWithRecid.slice(i, i + METADATA_BATCH_SIZE);
        const recids = batch.map((e) => e.recid!);
        const query = recids.map((r) => `recid:${r}`).join(" OR ");
        const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${recids.length}&format=bibtex`;

        try {
          // PERF-FIX-2: Only pass signal to fetch if it's a real AbortSignal
          const fetchOptions = this.exportAbort?.signal
            ? { signal: this.exportAbort.signal }
            : {};
          const response = await inspireFetch(url, fetchOptions);
          if (response.ok) {
            const bibtex = await response.text();
            if (bibtex?.trim()) {
              allBibTeX.push(bibtex.trim());
              successCount += recids.length;
            }
          }
        } catch (e) {
          // PERF-FIX-2: Handle abort error gracefully
          if ((e as Error).name === "AbortError") {
            Zotero.debug(`[${config.addonName}] BibTeX batch aborted`);
            break;
          }
          Zotero.debug(
            `[${config.addonName}] Failed to fetch BibTeX batch: ${e}`,
          );
        }
      }

      // PERF-FIX-2: Only show success if not aborted (use optional chaining)
      if (!this.exportAbort?.signal?.aborted && allBibTeX.length) {
        const success = await copyToClipboard(allBibTeX.join("\n\n"));
        if (success) {
          progressWin.changeLine({
            text: getString("references-panel-bibtex-all-copied", {
              args: { count: successCount },
            }),
            type: "success",
          });
        }
      } else if (!this.exportAbort?.signal?.aborted) {
        progressWin.changeLine({
          text: strings.bibtexAllFailed,
          type: "fail",
        });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        Zotero.debug(`[${config.addonName}] Copy all BibTeX error: ${e}`);
        progressWin.changeLine({
          text: strings.bibtexAllFailed,
          type: "fail",
        });
      }
    } finally {
      // PERF-FIX-2: Clear abort controller after export completes
      this.exportAbort = undefined;
    }

    setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
  }

  /**
   * Show export menu with format options (BibTeX, LaTeX US, LaTeX EU).
   * User can choose to copy to clipboard or export to file.
   */
  showExportMenu(event: Event): void {
    const entries = this.options.getEntries();
    const selectedIDs = this.options.getSelectedEntryIDs();
    const hasSelection = selectedIDs.size > 0;

    const targetEntries = hasSelection
      ? entries.filter((e) => selectedIDs.has(e.id))
      : entries;

    const entriesWithRecid = targetEntries.filter((e) => e.recid);

    if (!entriesWithRecid.length) {
      const strings = getCachedStrings();
      this.showNotification(strings.noRecidEntries, "default");
      return;
    }

    const doc = this.options.getDocument();

    // Remove existing popup if any
    const existingPopup = doc.getElementById("zinspire-export-popup");
    if (existingPopup) {
      existingPopup.remove();
    }

    // Create popup menu
    const popup = doc.createXULElement("menupopup") as XUL.MenuPopup;
    popup.id = "zinspire-export-popup";

    // Copy to clipboard section header
    const copyHeader = doc.createXULElement("menuitem");
    const copyLabel = getString("references-panel-export-copy-header");
    copyHeader.setAttribute(
      "label",
      hasSelection ? `${copyLabel} (${entriesWithRecid.length})` : copyLabel,
    );
    copyHeader.setAttribute("disabled", "true");
    popup.appendChild(copyHeader);

    for (const format of EXPORT_FORMATS) {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", `  ${format.label}`);
      item.addEventListener("command", () => {
        this.exportEntries(format.id, "clipboard");
      });
      popup.appendChild(item);
    }

    // Separator
    popup.appendChild(doc.createXULElement("menuseparator"));

    // Export to file section header
    const exportHeader = doc.createXULElement("menuitem");
    const exportLabel = getString("references-panel-export-file-header");
    exportHeader.setAttribute(
      "label",
      hasSelection
        ? `${exportLabel} (${entriesWithRecid.length})`
        : exportLabel,
    );
    exportHeader.setAttribute("disabled", "true");
    popup.appendChild(exportHeader);

    for (const format of EXPORT_FORMATS) {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", `  ${format.label}`);
      item.addEventListener("command", () => {
        this.exportEntries(format.id, "file", format.ext);
      });
      popup.appendChild(item);
    }

    // Add popup to document and show near the button
    doc.documentElement.appendChild(popup);
    const anchor = event.target as Element;
    popup.openPopup(anchor, "after_end", 0, 0, false, false);
  }

  /**
   * Export entries in specified format to clipboard or file.
   * Supports: bibtex, latex-us, latex-eu
   * PERF-FIX-2: Now cancellable via AbortController.
   */
  async exportEntries(
    format: ExportFormat,
    target: ExportTarget,
    fileExt: string = ".bib",
  ): Promise<ExportResult> {
    const entries = this.options.getEntries();
    const selectedIDs = this.options.getSelectedEntryIDs();
    const hasSelection = selectedIDs.size > 0;

    const targetEntries = hasSelection
      ? entries.filter((e) => selectedIDs.has(e.id))
      : entries;

    const entriesWithRecid = targetEntries.filter((e) => e.recid);
    const strings = getCachedStrings();

    // PERF-FIX-2: Create AbortController for this export operation
    this.cancelExport(); // Cancel any previous export
    // FTR-ABORT-CONTROLLER-FIX: Use utility function to safely create AbortController
    // Don't create mock signal - only pass real signal to fetch()
    this.exportAbort = createAbortController();

    const allContent: string[] = [];
    let successCount = 0;
    let failedBatches = 0;

    const progressWin = this.createProgressWindow(strings.bibtexFetching);

    try {
      for (let i = 0; i < entriesWithRecid.length; i += METADATA_BATCH_SIZE) {
        // PERF-FIX-2: Check abort before each batch (use optional chaining)
        if (this.exportAbort?.signal?.aborted) {
          Zotero.debug(`[${config.addonName}] ${format} export aborted`);
          progressWin.changeLine({ text: "Export cancelled", type: "default" });
          setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
          return { success: false, count: 0, format, message: "Export cancelled" };
        }

        const batch = entriesWithRecid.slice(i, i + METADATA_BATCH_SIZE);
        const recids = batch.map((e) => e.recid!);
        const query = recids.map((r) => `recid:${r}`).join(" OR ");
        const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${recids.length}&format=${format}`;

        try {
          // PERF-FIX-2: Only pass signal to fetch if it's a real AbortSignal
          const fetchOptions = this.exportAbort?.signal
            ? { signal: this.exportAbort.signal }
            : {};
          const response = await inspireFetch(url, fetchOptions);
          if (response.ok) {
            const content = await response.text();
            if (content?.trim()) {
              allContent.push(content.trim());
              // Count entries (BibTeX uses @type{, LaTeX uses direct entries)
              const entryCount =
                format === "bibtex"
                  ? (content.match(/@\w+\{/g) || []).length
                  : recids.length;
              successCount += entryCount;
            } else {
              failedBatches++;
            }
          } else {
            failedBatches++;
          }
        } catch (e) {
          // PERF-FIX-2: Handle abort error gracefully
          if ((e as Error).name === "AbortError") {
            Zotero.debug(`[${config.addonName}] ${format} batch aborted`);
            progressWin.changeLine({ text: "Export cancelled", type: "default" });
            setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
            return { success: false, count: 0, format, message: "Export cancelled" };
          }
          Zotero.debug(
            `[${config.addonName}] Failed to fetch ${format} batch: ${e}`,
          );
          failedBatches++;
        }
      }

      if (!allContent.length) {
        progressWin.changeLine({ text: strings.bibtexAllFailed, type: "fail" });
        setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
        return {
          success: false,
          count: 0,
          format,
          message: strings.bibtexAllFailed,
        };
      }

      const fullContent = allContent.join("\n\n");
      const formatLabel =
        format === "bibtex"
          ? "BibTeX"
          : format === "latex-us"
            ? "LaTeX(US)"
            : "LaTeX(EU)";

      if (target === "clipboard") {
        return await this.exportToClipboard(
          fullContent,
          successCount,
          formatLabel,
          progressWin,
        );
      } else {
        return await this.exportToFile(
          fullContent,
          successCount,
          formatLabel,
          fileExt,
          progressWin,
        );
      }
    } catch (e) {
      // PERF-FIX-2: Handle abort error at top level
      if ((e as Error).name === "AbortError") {
        progressWin.changeLine({ text: "Export cancelled", type: "default" });
        setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
        return { success: false, count: 0, format, message: "Export cancelled" };
      }
      Zotero.debug(`[${config.addonName}] Export error: ${e}`);
      progressWin.changeLine({ text: strings.bibtexAllFailed, type: "fail" });
      setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
      return { success: false, count: 0, format, message: String(e) };
    } finally {
      // PERF-FIX-2: Clear abort controller after export completes
      this.exportAbort = undefined;
    }
  }

  /**
   * Handle single entry BibTeX copy button click.
   * Fetches BibTeX from INSPIRE and copies to clipboard.
   */
  async handleSingleBibTeXCopy(
    entry: InspireReferenceEntry,
    button: HTMLButtonElement,
  ): Promise<boolean> {
    if (!entry.recid) {
      return false;
    }

    const originalText = button.textContent;
    button.textContent = "⏳";
    button.disabled = true;

    try {
      const bibtex = await fetchBibTeX(entry.recid);
      if (bibtex) {
        const success = await copyToClipboard(bibtex);
        if (success) {
          button.textContent = "✓";
          this.showToast(
            getString("references-panel-bibtex-copied"),
            "success",
          );
          this.restoreButton(button, originalText);
          return true;
        } else {
          throw new Error("Clipboard copy failed");
        }
      } else {
        throw new Error("BibTeX not found");
      }
    } catch (err) {
      button.textContent = "✗";
      Zotero.debug(`[${config.addonName}] BibTeX copy failed: ${err}`);
      this.showToast(getString("references-panel-bibtex-failed"), "fail");
      this.restoreButton(button, originalText);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Export Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private async exportToClipboard(
    content: string,
    count: number,
    formatLabel: string,
    progressWin: InstanceType<typeof ztoolkit.ProgressWindow>,
  ): Promise<ExportResult> {
    // Warn if content is very large (may exceed clipboard limits)
    const contentSize = new Blob([content]).size;

    if (contentSize > CLIPBOARD_WARN_SIZE_BYTES) {
      // Content too large, suggest file export
      const message = getString("references-panel-export-too-large", {
        args: { size: Math.round(contentSize / 1024) },
      });
      progressWin.changeLine({
        text: message,
        type: "fail",
      });
      setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_WARN_MS);
      return { success: false, count: 0, format: formatLabel, message };
    }

    const success = await copyToClipboard(content);
    if (success) {
      const message = getString("references-panel-export-copied", {
        args: { count, format: formatLabel },
      });
      progressWin.changeLine({
        text: message,
        type: "success",
      });
      setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
      return { success: true, count, format: formatLabel };
    } else {
      const message = getString("references-panel-export-clipboard-failed");
      progressWin.changeLine({
        text: message,
        type: "fail",
      });
      setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
      return { success: false, count: 0, format: formatLabel, message };
    }
  }

  private async exportToFile(
    content: string,
    count: number,
    formatLabel: string,
    fileExt: string,
    progressWin: InstanceType<typeof ztoolkit.ProgressWindow>,
  ): Promise<ExportResult> {
    const currentRecid = this.options.getCurrentRecid();
    const filename = `references_${currentRecid || "export"}${fileExt}`;
    const filePath = await this.promptSaveFile(filename, fileExt);

    if (filePath) {
      await Zotero.File.putContentsAsync(filePath, content);
      const message = getString("references-panel-export-saved", {
        args: { count, format: formatLabel },
      });
      progressWin.changeLine({
        text: message,
        type: "success",
      });
      setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
      return { success: true, count, format: formatLabel };
    } else {
      const message = getString("references-panel-export-cancelled");
      progressWin.changeLine({
        text: message,
        type: "default",
      });
      setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
      return { success: false, count: 0, format: formatLabel, message };
    }
  }

  /**
   * Prompt user to save file with FilePicker dialog.
   */
  private async promptSaveFile(
    defaultFilename: string,
    ext: string,
  ): Promise<string | null> {
    const win = Zotero.getMainWindow();
    const fp = new win.FilePicker();
    fp.init(win, getString("references-panel-export-save-title"), fp.modeSave);

    if (ext === ".bib") {
      fp.appendFilter("BibTeX", "*.bib");
    } else {
      fp.appendFilter("LaTeX", "*.tex");
    }
    fp.appendFilters(fp.filterAll);
    fp.defaultString = defaultFilename;

    const result = await fp.show();
    if (result === fp.returnOK || result === fp.returnReplace) {
      return fp.file;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: UI Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private createProgressWindow(initialText: string) {
    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
    const progressWin = new ztoolkit.ProgressWindow(config.addonName);
    progressWin.win.changeHeadline(config.addonName, icon);
    progressWin.createLine({ icon, text: initialText, type: "default" });
    progressWin.show();
    return progressWin;
  }

  private showNotification(
    text: string,
    type: "default" | "success" | "fail",
  ): void {
    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
    const progressWin = new ztoolkit.ProgressWindow(config.addonName);
    progressWin.win.changeHeadline(config.addonName, icon);
    progressWin.createLine({ icon, text, type });
    progressWin.show();
    setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
  }

  private showToast(text: string, type: "success" | "fail"): void {
    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
    const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    progressWindow.win.changeHeadline(config.addonName, icon);
    progressWindow.createLine({ text, type });
    progressWindow.show();
    progressWindow.startCloseTimer(2000);
  }

  private restoreButton(
    button: HTMLButtonElement,
    originalText: string | null,
  ): void {
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1500);
  }
}
