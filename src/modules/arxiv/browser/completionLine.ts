// ─────────────────────────────────────────────────────────────────────────────
// The arXiv browser's INSPIRE completion entry (design 7.5), in its status
// area: "N preprints added recently have no INSPIRE record yet [Check now]".
// The count is from the library alone. Only when the user asks is INSPIRE
// asked; the items it has a record of are listed next to their records in
// the preprint results dialog, where the user ticks what is written (the
// plugin's own fields only: recid, empty citation key, citation counts).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import {
  checkInspireCompletion,
  findCompletionCandidates,
  type CompletionEntry,
} from "../../inspire/library/inspireCompletion";
import { createAbortController } from "../../inspire/utils";
import type { WindowReporter } from "./browserActions";
import { button, html } from "./dom";

/** Wait after a change of the library before counting again */
const RECOUNT_DELAY_MS = 2000;

export interface CompletionLineOptions {
  reporter: WindowReporter;
  /** Items added recently with an arXiv ID and no recid */
  candidates?: () => Promise<Zotero.Item[]>;
  /** Ask INSPIRE about them */
  check?: typeof checkInspireCompletion;
  /**
   * Show the items INSPIRE has a record of for the user to tick, and write
   * those ticked (default: the preprint results dialog, in this window)
   */
  review?: (
    entries: CompletionEntry[],
    where: { document: Document; notify(lines: string[]): void },
  ) => Promise<void>;
}

export class CompletionLine {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly text: HTMLElement;
  private readonly checkButton: HTMLButtonElement;
  private readonly controller: AbortController | undefined;
  private timer: number | undefined;
  /** Counting or checking now */
  private busy = false;
  private disposed = false;

  constructor(
    doc: Document,
    private readonly options: CompletionLineOptions,
  ) {
    this.doc = doc;
    this.element = html(doc, "span", "arxiv-browser__completion");
    this.element.hidden = true;
    this.text = html(doc, "span");
    this.checkButton = button(
      doc,
      getString("arxiv-browser-completion-check"),
      () => void this.check(),
    );
    this.element.append(this.text, this.checkButton);
    this.controller = createAbortController();
    void this.count();
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    if (this.timer !== undefined)
      this.doc.defaultView?.clearTimeout(this.timer);
  }

  /** The library changed: count again, a moment later */
  recount(): void {
    const win = this.doc.defaultView;
    if (this.disposed || !win) return;
    if (this.timer !== undefined) win.clearTimeout(this.timer);
    this.timer = win.setTimeout(() => {
      this.timer = undefined;
      void this.count();
    }, RECOUNT_DELAY_MS);
  }

  private candidates(): Promise<Zotero.Item[]> {
    return (this.options.candidates ?? findCompletionCandidates)();
  }

  private async count(): Promise<void> {
    if (this.busy) return;
    let count = 0;
    try {
      count = (await this.candidates()).length;
    } catch (error) {
      Zotero.debug(`[${config.addonName}] arXiv completion count: ${error}`);
    }
    if (this.disposed || this.busy) return;
    this.element.hidden = count === 0;
    this.text.textContent = getString("arxiv-browser-completion", {
      args: { count },
    });
  }

  /** Ask INSPIRE (the user clicked Check now) and list what it has */
  private async check(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.checkButton.disabled = true;
    const { reporter } = this.options;
    const progress = reporter.startProgress(
      getString("arxiv-browser-completion-checking"),
    );
    try {
      const entries = await (this.options.check ?? checkInspireCompletion)(
        await this.candidates(),
        { signal: this.controller?.signal },
      );
      progress.close();
      if (this.disposed) return;
      const found = entries.filter((entry) => entry.status === "found");
      const failed = entries.filter((entry) => entry.status === "failed");
      if (failed.length) {
        reporter.ask(
          getString("arxiv-browser-completion-failed", {
            args: { count: failed.length },
          }),
          [],
        );
      }
      if (!found.length) {
        if (!failed.length) {
          reporter.notify(getString("arxiv-browser-completion-none-found"));
        }
        return;
      }
      const review =
        this.options.review ??
        ((records, where) =>
          _globalThis.inspire.reviewInspireRecords(records, where));
      await review(found, {
        document: this.doc,
        notify: (lines) => reporter.ask(lines, []),
      });
    } catch (error) {
      progress.close();
      if ((error as { name?: string })?.name !== "AbortError") {
        Zotero.debug(`[${config.addonName}] arXiv completion: ${error}`);
        reporter.notify(getString("arxiv-browser-completion-unreachable"));
      }
    } finally {
      this.busy = false;
      this.checkButton.disabled = false;
      void this.count();
    }
  }
}
