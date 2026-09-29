// ─────────────────────────────────────────────────────────────────────────────
// The batch import's toolbar: the number of papers selected, Select all,
// Clear and Import. Shown only while papers are selected. The References
// panel and the arXiv browser window use it with their BatchImportManager.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import type { BatchImportManager } from "./BatchImportManager";

type BatchActions = Pick<
  BatchImportManager,
  "selectAll" | "clearSelection" | "handleBatchImport" | "isImportInProgress"
>;

export class BatchToolbar {
  readonly element: HTMLDivElement;
  private readonly badge: HTMLSpanElement;
  private readonly importButton: HTMLButtonElement;

  constructor(doc: Document, batch: BatchActions) {
    this.element = doc.createElement("div");
    this.element.className = "zinspire-batch-toolbar";
    this.element.style.display = "none";

    // Selection badge
    this.badge = doc.createElement("span");
    this.badge.className = "zinspire-batch-toolbar__badge";
    this.badge.textContent = getString("references-panel-batch-selected", {
      args: { count: 0 },
    });
    this.element.appendChild(this.badge);

    // Select All button
    const selectAllBtn = doc.createElement("button");
    selectAllBtn.className = "zinspire-batch-toolbar__btn";
    selectAllBtn.textContent = getString("references-panel-batch-select-all");
    selectAllBtn.addEventListener("click", () => batch.selectAll());
    this.element.appendChild(selectAllBtn);

    // Clear button
    const clearBtn = doc.createElement("button");
    clearBtn.className = "zinspire-batch-toolbar__btn";
    clearBtn.textContent = getString("references-panel-batch-clear");
    clearBtn.addEventListener("click", () => batch.clearSelection());
    this.element.appendChild(clearBtn);

    // Import button
    this.importButton = doc.createElement("button");
    this.importButton.className =
      "zinspire-batch-toolbar__btn zinspire-batch-toolbar__btn--primary";
    this.importButton.textContent = getString("references-panel-batch-import");
    // A batch import may already be running elsewhere
    this.importButton.disabled = batch.isImportInProgress();
    this.importButton.addEventListener("click", () => {
      batch.handleBatchImport(this.importButton).catch((err) => {
        Zotero.debug(`[${config.addonName}] handleBatchImport error: ${err}`);
      });
    });
    this.element.appendChild(this.importButton);
  }

  /** Show the toolbar with the number of papers selected, or hide it at 0 */
  update(count: number): void {
    if (count > 0) {
      this.element.style.display = "flex";
      this.badge.textContent = getString("references-panel-batch-selected", {
        args: { count },
      });
    } else {
      this.element.style.display = "none";
    }
  }

  /** One batch import at a time: Import waits while one is under way */
  setImportInProgress(inProgress: boolean): void {
    this.importButton.disabled = inProgress;
  }
}
