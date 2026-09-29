// ─────────────────────────────────────────────────────────────────────────────
// Adding the arXiv browser's papers to the library and relating them to the
// relation target (relationTarget.ts).
//
// A paper is added where the user chooses (the save-target picker), or with
// one key to the window's default target: the target chosen last in the
// window. Each add goes the route its data allow (addToLibrary.ts); what came
// of it is told in a notice: added (with "Show in library"), already there,
// or why not. When INSPIRE cannot be reached the user chooses: add from
// arXiv data now, or try later. Adding is not undoable; a relation is (one
// step of Zotero's Edit → Undo, linkItems).
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { getPref, setPref } from "../../../utils/prefs";
import { loadedItem } from "../../inspire/library/localStatus";
import {
  linkItems,
  unlinkItems,
  type RelationChange,
} from "../../inspire/library/relatedItems";
import type {
  AddedPaper,
  BatchImportResult,
  NotAddedPaper,
} from "../../inspire/panel/BatchImportManager";
import type { InspireReferenceEntry } from "../../inspire/types";
import { showTargetPickerUI, type SaveTargetSelection } from "../../pickerUI";
import {
  buildSaveTargets,
  mainWindowSaveTargetID,
  recentSaveTargets,
  rememberSaveTarget,
  saveTargetOf,
} from "../../saveTargets";
import {
  addArxivPapers,
  type AddNote,
  type AddPaperOutcome,
  type AddPaperRequest,
} from "../addToLibrary";
import type { ArxivPdfResult } from "../arxivPdf";
import { arxivAddRequest } from "../batchAdd";
import type { NoticeAction, WindowReporter } from "./browserActions";
import type { BrowserEntry } from "./browserList";
import { reasonText } from "./browserText";
import type { RelationTarget } from "./relationTarget";

/** The window's default target (a picker row ID) */
const TARGET_PREF = "arxiv_browser_save_target";

const NOTE_TEXTS: Record<AddNote, Parameters<typeof getString>[0]> = {
  journalDoiMismatch: "arxiv-browser-note-journal-mismatch",
  journalNotFound: "arxiv-browser-note-journal-not-found",
  noPdfArxivUnavailable: "arxiv-browser-note-no-pdf",
};

/** A save target with its name, for the buttons */
export type NamedTarget = SaveTargetSelection & { name: string };

/** What the user asked for a paper, besides the paper */
interface AddChoice {
  journalVersion?: boolean;
  withoutInspire?: boolean;
  notTheDoiItems?: boolean;
  /**
   * Relate it, once added, to this item: the relation target when the user
   * asked (another item may be selected in the main window meanwhile)
   */
  link?: Zotero.Item;
}

export interface LibraryActionsOptions {
  reporter: WindowReporter;
  relation: RelationTarget;
  /** The element the save-target picker covers, and the list it keeps */
  host: HTMLElement;
  list(): HTMLElement;
  /** A paper was added as `item`: its rows show it in the library */
  onAdded(entry: BrowserEntry, item: Zotero.Item): void;
  /** Relations of the paper's items changed */
  onRelationChange(entry: BrowserEntry): void;
  /** The default target changed */
  onTargetChange(): void;
  showInLibrary(itemIDs: readonly number[]): void;
  /** Adds papers (default: the router, addArxivPapers) */
  addPapers?: typeof addArxivPapers;
  /** Asks for a target (default: the save-target picker) */
  pickTarget?: (
    anchor: HTMLElement,
    defaultID: string | null,
  ) => Promise<SaveTargetSelection | null>;
}

/** Why a paper was not added, in words */
export function notAddedText(
  outcome: Exclude<AddPaperOutcome, { status: "added" }>,
): string {
  switch (outcome.status) {
    case "inLibrary":
      return getString("arxiv-browser-not-added-in-library");
    case "inspireUnknown":
      return getString("arxiv-browser-not-added-inspire-unknown");
    case "arxivUnavailable":
      return getString("arxiv-browser-not-added-arxiv-unavailable");
    case "notOnArxiv":
      return getString("arxiv-browser-not-added-not-on-arxiv");
    case "cancelled":
      return getString("arxiv-browser-reason-cancelled");
    case "failed":
      return outcome.reason === "libraryUnreadable"
        ? getString("arxiv-browser-not-added-library-unreadable")
        : outcome.reason === "notEditable"
          ? getString("arxiv-browser-not-added-not-editable")
          : outcome.message;
  }
}

/** Why a PDF was not attached, in words */
export function pdfFailureText(
  result: Extract<ArxivPdfResult, { status: "failed" }>,
): string {
  switch (result.reason) {
    case "notPdf":
      return getString("arxiv-browser-pdf-not-pdf");
    case "filesNotEditable":
      return getString("arxiv-browser-pdf-files-not-editable");
    case "save":
      return getString("arxiv-browser-pdf-save");
    default:
      return reasonText(result.reason);
  }
}

/** The name of a library, as Zotero shows it */
function libraryName(libraryID: number): string {
  const library = Zotero.Libraries.get(libraryID);
  return (library && library.name) || String(libraryID);
}

const idOf = (entry: InspireReferenceEntry) =>
  (entry as BrowserEntry).listing.id;

export class LibraryActions {
  private readonly reporter: WindowReporter;
  private readonly addPapers: typeof addArxivPapers;
  /** Papers being added (arXiv IDs): a second press adds nothing */
  private readonly adding = new Set<string>();
  /** The target chosen for the batch import under way */
  batchTarget: NamedTarget | null = null;
  private disposed = false;

  constructor(private readonly options: LibraryActionsOptions) {
    this.reporter = options.reporter;
    this.addPapers = options.addPapers ?? addArxivPapers;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** The window's default target: the one chosen last in the window */
  get defaultTarget(): NamedTarget | null {
    const id = getPref(TARGET_PREF);
    return typeof id === "string" && id ? saveTargetOf(id) : null;
  }

  /**
   * Ask for a target with the save-target picker; the target chosen becomes
   * the window's default and the most recent target
   */
  async chooseTarget(anchor: HTMLElement): Promise<NamedTarget | null> {
    const recent = recentSaveTargets();
    const targets = buildSaveTargets(recent.ids);
    if (!targets.length) {
      this.reporter.notify(getString("references-panel-picker-empty"));
      return null;
    }
    const defaultID =
      this.defaultTarget?.primaryRowID ??
      mainWindowSaveTargetID() ??
      recent.ordered[0] ??
      targets[0].id;
    const selection = await (this.options.pickTarget
      ? this.options.pickTarget(anchor, defaultID)
      : showTargetPickerUI(
          targets,
          defaultID,
          anchor,
          this.options.host,
          this.options.list(),
          { document: this.options.host.ownerDocument },
        ));
    if (!selection || this.disposed) return null;
    setPref(TARGET_PREF, selection.primaryRowID);
    rememberSaveTarget(selection.primaryRowID);
    this.options.onTargetChange();
    const named = saveTargetOf(selection.primaryRowID);
    return { ...selection, name: named?.name ?? "" };
  }

  /**
   * Add a paper: to the default target, or (`ask`, or no default yet) where
   * the user chooses
   */
  async add(
    entry: BrowserEntry,
    how: { ask: boolean; anchor: HTMLElement } & AddChoice,
  ): Promise<void> {
    const id = entry.listing.id;
    if (this.adding.has(id)) return;
    const target =
      (!how.ask && this.defaultTarget) || (await this.chooseTarget(how.anchor));
    if (!target) return;
    await this.addTo(entry, target, how);
  }

  private async addTo(
    entry: BrowserEntry,
    target: NamedTarget,
    choice: AddChoice,
  ): Promise<void> {
    const id = entry.listing.id;
    if (this.adding.has(id) || this.disposed) return;
    this.adding.add(id);
    const progress = this.reporter.startProgress(
      getString("arxiv-browser-adding", { args: { id } }),
    );
    let outcome: AddPaperOutcome;
    try {
      const request: AddPaperRequest = {
        ...arxivAddRequest(entry)!,
        ...(choice.journalVersion ? { journalVersion: true } : {}),
        ...(choice.withoutInspire ? { withoutInspire: true } : {}),
        ...(choice.notTheDoiItems ? { notTheDoiItems: true } : {}),
      };
      [outcome] = await this.addPapers([request], target);
    } catch (error) {
      outcome = { status: "failed", reason: "save", message: String(error) };
    } finally {
      progress.close();
      this.adding.delete(id);
    }
    if (this.disposed) return;
    await this.report(entry, outcome, target, choice);
  }

  /** Tell what came of adding a paper, and offer what can be done next */
  private async report(
    entry: BrowserEntry,
    outcome: AddPaperOutcome,
    target: NamedTarget,
    choice: AddChoice,
  ): Promise<void> {
    const id = entry.listing.id;
    const again = (more: AddChoice) => () =>
      void this.addTo(entry, target, { ...choice, ...more });
    switch (outcome.status) {
      case "added": {
        this.options.onAdded(entry, outcome.item);
        this.reporter.ask(
          [
            getString("arxiv-browser-added", {
              args: { id, target: target.name },
            }),
            ...outcome.notes.map((note) => getString(NOTE_TEXTS[note])),
            // The journal version was asked for, INSPIRE has no record and
            // arXiv gives no journal DOI to look it up by
            ...(choice.journalVersion &&
            !choice.withoutInspire &&
            outcome.route === "arxiv" &&
            !outcome.notes.length
              ? [getString("arxiv-browser-note-no-journal-doi")]
              : []),
          ],
          [this.showAction([outcome.item.id])],
        );
        void outcome.pdf?.then((result) => {
          if (result.status === "failed" && !this.disposed) {
            this.reporter.ask(
              getString("arxiv-browser-pdf-failed", {
                args: { id, reason: pdfFailureText(result) },
              }),
              [],
            );
          }
        });
        if (choice.link) await this.link(entry, [outcome.item], choice.link);
        return;
      }
      case "inLibrary": {
        const itemIDs = outcome.hits.map((hit) => hit.itemID);
        if (outcome.doiOnly) {
          const titles = itemIDs
            .map((itemID) => loadedItem(itemID)?.getDisplayTitle())
            .filter(Boolean)
            .join("; ");
          this.reporter.ask(
            getString("arxiv-browser-doi-only", {
              args: { id, library: libraryName(target.libraryID), titles },
            }),
            [
              this.showAction(itemIDs),
              {
                label: getString("arxiv-browser-doi-only-add"),
                run: again({ notTheDoiItems: true }),
              },
            ],
            { stay: true },
          );
          return;
        }
        this.reporter.ask(
          getString("arxiv-browser-in-library-already", {
            args: { id, library: libraryName(target.libraryID) },
          }),
          [this.showAction(itemIDs)],
        );
        if (choice.link) {
          const items = itemIDs
            .map((itemID) => loadedItem(itemID))
            .filter((item): item is Zotero.Item => item !== null);
          if (items.length) await this.link(entry, items, choice.link);
        }
        return;
      }
      case "inspireUnknown":
        this.reporter.ask(
          getString("arxiv-browser-inspire-unknown", { args: { id } }),
          [
            {
              label: getString("arxiv-browser-add-from-arxiv"),
              run: again({ withoutInspire: true }),
            },
            { label: getString("arxiv-browser-try-later"), run: () => {} },
          ],
          { stay: true },
        );
        return;
      case "cancelled":
        return;
      default:
        this.reporter.ask(
          getString("arxiv-browser-not-added", {
            args: { id, reason: notAddedText(outcome) },
          }),
          [],
        );
    }
  }

  private showAction(itemIDs: readonly number[]): NoticeAction {
    return {
      label: getString("arxiv-browser-show-in-library"),
      run: () => this.options.showInLibrary(itemIDs),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Batch import
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Tell what came of a batch import: how many were added, those not added
   * and PDFs not attached with the reasons, with "Show in library"; papers
   * INSPIRE did not answer about can be added from arXiv data
   */
  reportBatch(result: BatchImportResult): void {
    const target = this.batchTarget;
    this.batchTarget = null;
    const total = result.added.length + result.notAdded.length;
    // No target: every paper was skipped in the duplicate dialog
    const lines = [
      target
        ? getString("arxiv-browser-batch-added", {
            args: { added: result.added.length, total, target: target.name },
          })
        : getString("arxiv-browser-batch-none-added", { args: { total } }),
    ];
    const line = (paper: AddedPaper | NotAddedPaper, reason: string) =>
      `arXiv:${idOf(paper.entries[0])} — ${reason}`;
    // Papers the cancel stopped are counted, not listed
    const notAdded = result.notAdded.filter(
      (paper) => paper.outcome.status !== "cancelled",
    );
    if (notAdded.length) {
      lines.push(getString("arxiv-browser-batch-not-added"));
      for (const paper of notAdded) {
        lines.push(line(paper, notAddedText(paper.outcome)));
      }
    }
    const pdfFailed = result.added.filter(
      (paper) => paper.pdf?.status === "failed",
    );
    if (pdfFailed.length) {
      lines.push(getString("arxiv-browser-batch-pdf-failed"));
      for (const paper of pdfFailed) {
        const pdf = paper.pdf as Extract<ArxivPdfResult, { status: "failed" }>;
        lines.push(line(paper, pdfFailureText(pdf)));
      }
    }
    const stopped = result.notAdded.length - notAdded.length;
    if (stopped) {
      lines.push(
        getString("arxiv-browser-batch-cancelled", {
          args: { count: stopped },
        }),
      );
    }
    const actions: NoticeAction[] = [];
    if (result.added.length) {
      actions.push(
        this.showAction(result.added.map((paper) => paper.outcome.item.id)),
      );
    }
    const unknown = result.notAdded.filter(
      (paper) => paper.outcome.status === "inspireUnknown",
    );
    if (unknown.length && target) {
      actions.push({
        label: getString("arxiv-browser-add-from-arxiv-count", {
          args: { count: unknown.length },
        }),
        run: () =>
          void this.addWithoutInspire(
            unknown.map((paper) => paper.entries[0] as BrowserEntry),
            target,
          ),
      });
    }
    this.reporter.ask(lines, actions, {
      stay: notAdded.length > 0 || pdfFailed.length > 0,
    });
  }

  /** Add papers INSPIRE did not answer about from arXiv data */
  private async addWithoutInspire(
    entries: readonly BrowserEntry[],
    target: NamedTarget,
  ): Promise<void> {
    for (const entry of entries) {
      await this.addTo(entry, target, { withoutInspire: true });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Relations
  // ───────────────────────────────────────────────────────────────────────────

  /** The paper's items related to the relation target */
  relatedItemsOf(entry: BrowserEntry): Zotero.Item[] {
    const target = this.options.relation.item;
    if (!target || !entry.localItemID) return [];
    const related = target.relatedItems;
    return (entry.localItemIDs ?? [entry.localItemID])
      .map((itemID) => loadedItem(itemID))
      .filter(
        (item): item is Zotero.Item =>
          item !== null &&
          item.libraryID === target.libraryID &&
          (related.includes(item.key) ||
            related.includes(`${item.libraryID}/${item.key}`)),
      );
  }

  isRelated(entry: BrowserEntry): boolean {
    return this.relatedItemsOf(entry).length > 0;
  }

  /**
   * Relate the paper to the relation target, or remove the relation when
   * there is one; a paper not in the library is added first (the user
   * chooses where)
   */
  async toggleLink(entry: BrowserEntry, anchor: HTMLElement): Promise<void> {
    const target = this.options.relation.item;
    if (!target) {
      this.reporter.notify(getString("arxiv-browser-link-no-target"));
      return;
    }
    if (!entry.localItemID) {
      await this.add(entry, { ask: true, anchor, link: target });
      return;
    }
    const related = this.relatedItemsOf(entry);
    if (related.length) {
      this.tellRelation(
        await unlinkItems(target, related),
        target,
        "arxiv-browser-unlinked",
      );
      this.options.onRelationChange(entry);
      return;
    }
    const items = (await Zotero.Items.getAsync(
      entry.localItemIDs ?? [entry.localItemID],
    )) as Zotero.Item[];
    await this.link(entry, items, target);
  }

  /** Relate the paper's item (in the target's library) to `target` */
  private async link(
    entry: BrowserEntry,
    items: readonly Zotero.Item[],
    target: Zotero.Item,
  ): Promise<void> {
    // Deleted for good while the paper was added
    if (!Zotero.Items.get(target.id)) {
      this.reporter.notify(
        getString("references-panel-toast-link-target-gone"),
      );
      return;
    }
    const item =
      items.find((other) => other.libraryID === target.libraryID) ?? items[0];
    if (!item) return;
    this.tellRelation(
      await linkItems(target, [item]),
      target,
      "arxiv-browser-linked",
    );
    this.options.onRelationChange(entry);
  }

  private tellRelation(
    change: RelationChange,
    target: Zotero.Item,
    done: "arxiv-browser-linked" | "arxiv-browser-unlinked",
  ): void {
    if (this.disposed) return;
    if (change.status === "otherLibrary") {
      this.reporter.notify(
        getString("references-panel-toast-link-other-library"),
      );
    } else if (change.status === "changed") {
      const text = getString(done, {
        args: { title: target.getDisplayTitle() },
      });
      // Zotero 10's Edit → Undo takes a relation back
      this.reporter.notify(
        (Zotero as any).UndoHistory
          ? `${text} ${getString("arxiv-browser-undo-hint")}`
          : text,
      );
    }
  }
}
