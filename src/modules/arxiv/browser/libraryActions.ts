// ─────────────────────────────────────────────────────────────────────────────
// Adding the arXiv browser's papers to the library, relating them to items
// the user chooses (Zotero's Select Items dialog, relatedItemsDialog.ts) and
// saving arXiv's HTML version of one as a snapshot (arxivHtmlSnapshot.ts).
//
// A paper is added where the user chooses, in the save-target picker as in
// the References panel. Each add goes the route its data allow
// (addToLibrary.ts); what came
// of it is told in a notice: added (with "Show in library"), already there,
// or why not. When INSPIRE cannot be reached the user chooses: add from
// arXiv data now, or try later. Adding is not undoable; a relation is (one
// step of Zotero's Edit → Undo, linkItems). Relating a paper, or saving its
// HTML version, adds a paper not in the library first.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { openAttachment } from "../../inspire/library/localPdf";
import { loadedItem } from "../../inspire/library/localStatus";
import {
  linkItems,
  type RelationChange,
} from "../../inspire/library/relatedItems";
import type {
  AddedPaper,
  BatchImportResult,
  NotAddedPaper,
} from "../../inspire/panel/BatchImportManager";
import type { InspireReferenceEntry } from "../../inspire/types";
import type { SaveTargetSelection } from "../../pickerUI";
import {
  pickSaveTarget,
  rememberSaveTarget,
  saveTargetOf,
} from "../../saveTargets";
import {
  addArxivPapers,
  type AddNote,
  type AddPaperOutcome,
  type AddPaperRequest,
} from "../addToLibrary";
import type { fetchArxivApiEntries } from "../arxivApi";
import {
  saveArxivHtmlSnapshot,
  saveArxivHtmlVersion,
} from "../arxivHtmlSnapshot";
import type { ArxivPdfResult } from "../arxivPdf";
import { arxivAddRequest } from "../batchAdd";
import type { NoticeAction, WindowReporter } from "./browserActions";
import type { BrowserEntry } from "./browserList";
import { htmlSaveText, reasonText } from "./browserText";

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
  /** Relate it, once added, to items the user chooses */
  relate?: boolean;
  /** Save its HTML version, once added */
  htmlSnapshot?: boolean;
  /** The version to save (absent: the listing's, else the newest) */
  htmlVersion?: number;
}

export interface LibraryActionsOptions {
  reporter: WindowReporter;
  /**
   * Asks for the items to relate a paper to, among those of `libraryID`
   * (Zotero's Select Items dialog); none when the user chose none
   */
  pickRelated(libraryID: number): Promise<Zotero.Item[]>;
  /** The element the save-target picker covers, and the list it keeps */
  host: HTMLElement;
  list(): HTMLElement;
  /** A paper was added as `item`: its rows show it in the library */
  onAdded(entry: BrowserEntry, item: Zotero.Item): void;
  /** Relations of the paper's items changed */
  onRelationChange(entry: BrowserEntry): void;
  showInLibrary(itemIDs: readonly number[]): void;
  /** Adds papers (default: the router, addArxivPapers) */
  addPapers?: typeof addArxivPapers;
  /** Asks for a target (default: the save-target picker) */
  pickTarget?: (anchor: HTMLElement) => Promise<SaveTargetSelection | null>;
  /** Saves an HTML snapshot (default: saveArxivHtmlSnapshot) */
  saveHtmlSnapshot?: typeof saveArxivHtmlSnapshot;
  /** Asks the arXiv API for versions (default: fetchArxivApiEntries) */
  apiEntries?: typeof fetchArxivApiEntries;
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
  /** HTML versions being saved ("<arXiv ID> <version asked for>") */
  private readonly savingHtml = new Set<string>();
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

  /**
   * Ask for a target with the save-target picker; the target chosen becomes
   * the most recent target
   */
  async chooseTarget(anchor: HTMLElement): Promise<NamedTarget | null> {
    const selection = await (this.options.pickTarget
      ? this.options.pickTarget(anchor)
      : pickSaveTarget(
          anchor,
          this.options.host,
          this.options.list(),
          (message) => this.reporter.notify(message),
          { document: this.options.host.ownerDocument },
        ));
    if (!selection || this.disposed) return null;
    rememberSaveTarget(selection.primaryRowID);
    const named = saveTargetOf(selection.primaryRowID);
    return { ...selection, name: named?.name ?? "" };
  }

  /** Add a paper where the user chooses */
  async add(
    entry: BrowserEntry,
    how: { anchor: HTMLElement } & AddChoice,
  ): Promise<void> {
    const id = entry.listing.id;
    if (this.adding.has(id)) return;
    const target = await this.chooseTarget(how.anchor);
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
        if (choice.relate) await this.relateItems(entry, [outcome.item]);
        if (choice.htmlSnapshot) {
          await this.saveHtmlTo(entry, outcome.item, choice.htmlVersion);
        }
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
        const items = itemIDs
          .map((itemID) => loadedItem(itemID))
          .filter((item): item is Zotero.Item => item !== null);
        if (choice.relate) await this.relateItems(entry, items);
        if (choice.htmlSnapshot && items[0]) {
          await this.saveHtmlTo(entry, items[0], choice.htmlVersion);
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
  // HTML snapshots
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Save arXiv's HTML version of the paper (at `version` when given) as a
   * snapshot of its (first) item; a paper not in the library is added first
   * (the user chooses where)
   */
  async saveHtmlSnapshot(
    entry: BrowserEntry,
    anchor: HTMLElement,
    version?: number,
  ): Promise<void> {
    const item = entry.localItemID ? loadedItem(entry.localItemID) : null;
    if (item) await this.saveHtmlTo(entry, item, version);
    else if (!entry.localItemID) {
      await this.add(entry, {
        anchor,
        htmlSnapshot: true,
        ...(version === undefined ? {} : { htmlVersion: version }),
      });
    }
  }

  /**
   * Save the paper's HTML version, at `wanted` (else the listing's version,
   * else the arXiv API's), to `item`, unless that version is there already
   */
  private async saveHtmlTo(
    entry: BrowserEntry,
    item: Zotero.Item,
    wanted?: number,
  ): Promise<void> {
    const id = entry.listing.id;
    // One save at a time per paper and version asked for
    const job = `${id} ${wanted ?? ""}`;
    if (this.savingHtml.has(job) || this.disposed) return;
    this.savingHtml.add(job);
    const progress = this.reporter.startProgress(
      getString("arxiv-browser-html-saving", { args: { id } }),
    );
    const outcome = await saveArxivHtmlVersion(
      item,
      id,
      wanted ?? entry.listing.version,
      {
        saveHtmlSnapshot: this.options.saveHtmlSnapshot,
        apiEntries: this.options.apiEntries,
      },
    ).finally(() => {
      progress.close();
      this.savingHtml.delete(job);
    });
    if (this.disposed) return;
    this.reporter.ask(
      htmlSaveText(id, outcome),
      outcome.status === "failed"
        ? []
        : [
            {
              label: getString("arxiv-browser-html-menu-open"),
              run: () => void openAttachment(outcome.attachmentID),
            },
            this.showAction([item.id]),
          ],
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Relations
  // ───────────────────────────────────────────────────────────────────────────

  /** The items the paper's library items are related to */
  relatedItemsOf(entry: BrowserEntry): Zotero.Item[] {
    if (!entry.localItemID) return [];
    const related: Zotero.Item[] = [];
    for (const itemID of entry.localItemIDs ?? [entry.localItemID]) {
      const item = loadedItem(itemID);
      for (const key of item?.relatedItems ?? []) {
        const other = Zotero.Items.getByLibraryAndKey(item!.libraryID, key);
        if (other && !related.includes(other)) related.push(other);
      }
    }
    return related;
  }

  isRelated(entry: BrowserEntry): boolean {
    return (entry.localItemIDs ?? [entry.localItemID]).some(
      (itemID) =>
        itemID !== undefined &&
        (loadedItem(itemID)?.relatedItems.length ?? 0) > 0,
    );
  }

  /**
   * Relate the paper to items the user chooses in Zotero's Select Items
   * dialog; a paper not in the library is added first (the user chooses
   * where)
   */
  async relate(entry: BrowserEntry, anchor: HTMLElement): Promise<void> {
    if (!entry.localItemID) {
      await this.add(entry, { anchor, relate: true });
      return;
    }
    const items = (await Zotero.Items.getAsync(
      entry.localItemIDs ?? [entry.localItemID],
    )) as Zotero.Item[];
    await this.relateItems(entry, items);
  }

  /** Relate the paper's first item to the items chosen in its library */
  private async relateItems(
    entry: BrowserEntry,
    items: readonly Zotero.Item[],
  ): Promise<void> {
    const item = items[0];
    if (!item) return;
    const chosen = await this.options.pickRelated(item.libraryID);
    if (!chosen.length || this.disposed) return;
    this.tellRelation(await linkItems(item, chosen), chosen);
    this.options.onRelationChange(entry);
  }

  private tellRelation(
    change: RelationChange,
    chosen: readonly Zotero.Item[],
  ): void {
    if (this.disposed) return;
    if (change.status === "otherLibrary") {
      this.reporter.notify(
        getString("references-panel-toast-link-other-library"),
      );
    } else if (change.status === "changed") {
      const text =
        chosen.length === 1
          ? getString("arxiv-browser-linked", {
              args: { title: chosen[0].getDisplayTitle() },
            })
          : getString("arxiv-browser-linked-several", {
              args: { count: chosen.length },
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
