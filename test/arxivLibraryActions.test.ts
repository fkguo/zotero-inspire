import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import type {
  AddPaperOutcome,
  AddPaperRequest,
} from "../src/modules/arxiv/addToLibrary";
import type { ArxivPdfResult } from "../src/modules/arxiv/arxivPdf";
import type { WindowReporter } from "../src/modules/arxiv/browser/browserActions";
import {
  toBrowserEntry,
  type BrowserEntry,
} from "../src/modules/arxiv/browser/browserList";
import { LibraryActions } from "../src/modules/arxiv/browser/libraryActions";
import type { ArxivListingEntry } from "../src/modules/arxiv/listingTypes";
import type { SaveTargetSelection } from "../src/modules/pickerUI";

// Adding the arXiv browser's papers and relating them: where a paper goes
// (the picker, or the window's default target with one key), what the user
// is told of each outcome and offered next, and relations to items chosen in
// Zotero's Select Items dialog.

const PREFIX = config.prefsPrefix;
const TARGET_PREF = `${PREFIX}.arxiv_browser_save_target`;

let prefs: Record<string, unknown>;

/** A library item that keeps its relations by key, as Zotero does */
interface FakeItem {
  id: number;
  key: string;
  libraryID: number;
  relatedItems: string[];
  addRelatedItem(other: FakeItem): boolean;
  removeRelatedItem(other: FakeItem): Promise<boolean>;
  save(): Promise<void>;
  getDisplayTitle(): string;
}
let items: Map<number, FakeItem>;

function item(id: number, libraryID = 1): FakeItem {
  const fake: FakeItem = {
    id,
    key: `KEY${id}`,
    libraryID,
    relatedItems: [],
    addRelatedItem(other) {
      if (this.relatedItems.includes(other.key)) return false;
      this.relatedItems.push(other.key);
      return true;
    },
    async removeRelatedItem(other) {
      const at = this.relatedItems.indexOf(other.key);
      if (at < 0) return false;
      this.relatedItems.splice(at, 1);
      return true;
    },
    save: async () => undefined,
    getDisplayTitle: () => `Item ${id}`,
  };
  items.set(id, fake);
  return fake;
}

beforeEach(() => {
  prefs = {};
  items = new Map();
  const libraries = [
    { libraryID: 1, name: "My Library", editable: true, filesEditable: true },
    { libraryID: 2, name: "Group", editable: true, filesEditable: true },
  ];
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Prefs: {
      get: (key: string) => prefs[key],
      set: (key: string, value: unknown) => {
        prefs[key] = value;
      },
      clear: (key: string) => delete prefs[key],
    },
    Libraries: {
      get: (id: number) => ({
        ...(libraries.find((library) => library.libraryID === id) ?? {}),
        waitForDataLoad: async () => undefined,
      }),
      getAll: () => libraries,
      userLibrary: libraries[0],
    },
    Collections: {
      get: (id: number) =>
        id === 12
          ? { id, name: "to-read", libraryID: 1, deleted: false }
          : false,
      getByLibrary: () => [],
    },
    Items: {
      get: (id: number) => items.get(id) ?? false,
      getByLibraryAndKey: (libraryID: number, key: string) =>
        [...items.values()].find(
          (it) => it.libraryID === libraryID && it.key === key,
        ) ?? false,
      getAsync: async (ids: number | number[]) =>
        Array.isArray(ids)
          ? ids.map((id) => items.get(id)).filter(Boolean)
          : (items.get(ids) ?? false),
    },
    DB: { executeTransaction: async (fn: () => Promise<unknown>) => fn() },
    getActiveZoteroPane: () => null,
  });
  vi.stubGlobal("addon", {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id, args }]: Array<{
            id: string;
            args?: Record<string, unknown>;
          }>) => [{ value: args ? `${id} ${JSON.stringify(args)}` : id }],
        },
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function msg(key: string, args?: Record<string, unknown>) {
  const id = `${config.addonRef}-${key}`;
  return args ? `${id} ${JSON.stringify(args)}` : id;
}

function paper(id: string): BrowserEntry {
  const listing: ArxivListingEntry = {
    id,
    title: `Paper ${id}`,
    authors: [{ display: "A. Author", family: "Author", given: "A." }],
    abstract: "",
    primaryCategory: "hep-ph",
    categories: ["hep-ph"],
    section: "new",
    announceDate: "2026-09-25",
    streams: [{ category: "hep-ph", section: "new", position: 0 }],
  } as ArxivListingEntry;
  return toBrowserEntry(listing);
}

/** A notice as the reporter was given it */
interface Notice {
  lines: string[];
  actions: { label: string; run(): void }[];
  stay: boolean;
}

function reporter() {
  const notices: Notice[] = [];
  const notes: string[] = [];
  const progress: string[] = [];
  const window: WindowReporter = {
    notify: (message) => void notes.push(message),
    ask: (lines, actions, options = {}) =>
      void notices.push({
        lines: typeof lines === "string" ? [lines] : [...lines],
        actions: [...actions],
        stay: Boolean(options.stay),
      }),
    startProgress: (text) => {
      progress.push(text);
      return { update: () => undefined, close: () => undefined };
    },
  };
  return { window, notices, notes, progress };
}

const target: SaveTargetSelection = {
  libraryID: 1,
  primaryRowID: "C12",
  collectionIDs: [12],
  tags: [],
  note: "",
};

function actions(
  outcomes: AddPaperOutcome[] = [],
  options: {
    /** The items chosen in the Select Items dialog */
    related?: FakeItem[];
    pick?: SaveTargetSelection | null;
  } = {},
) {
  const report = reporter();
  const calls: { requests: AddPaperRequest[]; target: unknown }[] = [];
  const addPapers = vi.fn(async (requests: readonly AddPaperRequest[], to) => {
    calls.push({ requests: [...requests], target: to });
    return [outcomes.shift() ?? { status: "cancelled" as const }];
  });
  const pickTarget = vi.fn(async () =>
    options.pick === undefined ? target : options.pick,
  );
  const added: [BrowserEntry, number][] = [];
  const relationChanged: BrowserEntry[] = [];
  const shown: number[][] = [];
  const pickRelated = vi.fn(
    async (_libraryID: number) =>
      (options.related ?? []) as unknown as Zotero.Item[],
  );
  const library = new LibraryActions({
    reporter: report.window,
    pickRelated,
    host: {} as HTMLElement,
    list: () => ({}) as HTMLElement,
    onAdded: (entry, it) => void added.push([entry, it.id]),
    onRelationChange: (entry) => void relationChanged.push(entry),
    onTargetChange: vi.fn(),
    showInLibrary: (ids) => void shown.push([...ids]),
    addPapers: addPapers as any,
    pickTarget,
  });
  return {
    library,
    report,
    calls,
    addPapers,
    pickTarget,
    pickRelated,
    added,
    relationChanged,
    shown,
  };
}

const anchor = {} as HTMLElement;
const addedOutcome = (
  it: FakeItem,
  extra: Partial<Extract<AddPaperOutcome, { status: "added" }>> = {},
): AddPaperOutcome => ({
  status: "added",
  route: "arxiv",
  item: it as unknown as Zotero.Item,
  notes: [],
  ...extra,
});

describe("Adding a paper", () => {
  it("asks where, remembers the choice as the window's default, and adds the paper there", async () => {
    const it1 = item(901);
    const { library, calls, pickTarget, added, report, shown } = actions([
      addedOutcome(it1),
    ]);
    const entry = paper("2609.20001");
    await library.add(entry, { ask: true, anchor });

    expect(pickTarget).toHaveBeenCalledTimes(1);
    expect(prefs[TARGET_PREF]).toBe("C12");
    expect(prefs.recentSaveTargets).toBe(JSON.stringify([{ id: "C12" }]));
    expect(calls).toHaveLength(1);
    expect(calls[0].requests).toEqual([
      { arxivId: "2609.20001", listingAuthors: entry.listing.authors },
    ]);
    expect(calls[0].target).toMatchObject({
      libraryID: 1,
      collectionIDs: [12],
    });
    expect(added).toEqual([[entry, 901]]);
    const [notice] = report.notices;
    expect(notice.lines[0]).toBe(
      msg("arxiv-browser-added", { id: "2609.20001", target: "to-read" }),
    );
    // Adding is not undoable: the notice offers the item, nothing else
    expect(notice.actions.map((action) => action.label)).toEqual([
      msg("arxiv-browser-show-in-library"),
    ]);
    notice.actions[0].run();
    expect(shown).toEqual([[901]]);
    expect(library.defaultTarget?.name).toBe("to-read");
  });

  it("adds to the default target with one key, without asking", async () => {
    prefs[TARGET_PREF] = "C12";
    const { library, calls, pickTarget } = actions([addedOutcome(item(901))]);
    await library.add(paper("2609.20001"), { ask: false, anchor });
    expect(pickTarget).not.toHaveBeenCalled();
    expect(calls[0].target).toMatchObject({ collectionIDs: [12] });
  });

  it("asks where the first time, when there is no default target yet", async () => {
    const { library, pickTarget } = actions([addedOutcome(item(901))]);
    await library.add(paper("2609.20001"), { ask: false, anchor });
    expect(pickTarget).toHaveBeenCalledTimes(1);
  });

  it("asks where when the default target is gone (its collection deleted)", async () => {
    prefs[TARGET_PREF] = "C99";
    const { library, pickTarget } = actions([addedOutcome(item(901))]);
    await library.add(paper("2609.20001"), { ask: false, anchor });
    expect(pickTarget).toHaveBeenCalledTimes(1);
  });

  it("adds nothing when the picker is closed", async () => {
    const { library, addPapers } = actions([], { pick: null });
    await library.add(paper("2609.20001"), { ask: true, anchor });
    expect(addPapers).not.toHaveBeenCalled();
  });

  it("adds a paper once when its key is pressed again while it is added", async () => {
    prefs[TARGET_PREF] = "L1";
    const { library, addPapers } = actions([addedOutcome(item(901))]);
    const entry = paper("2609.20001");
    await Promise.all([
      library.add(entry, { ask: false, anchor }),
      library.add(entry, { ask: false, anchor }),
    ]);
    expect(addPapers).toHaveBeenCalledTimes(1);
  });

  it("asks for the journal version when the user chose it", async () => {
    prefs[TARGET_PREF] = "L1";
    const { library, calls } = actions([addedOutcome(item(901))]);
    await library.add(paper("2609.20001"), {
      ask: false,
      anchor,
      journalVersion: true,
    });
    expect(calls[0].requests[0].journalVersion).toBe(true);
  });

  it("says why a paper asked for in its journal version was added as the preprint when arXiv gives no journal DOI", async () => {
    prefs[TARGET_PREF] = "L1";
    const { library, report } = actions([
      addedOutcome(item(901)),
      addedOutcome(item(902), { route: "inspire" }),
    ]);
    await library.add(paper("2609.20001"), {
      ask: false,
      anchor,
      journalVersion: true,
    });
    expect(report.notices[0].lines[1]).toBe(
      msg("arxiv-browser-note-no-journal-doi"),
    );
    // INSPIRE's record (the journal version once published): no note
    await library.add(paper("2609.20002"), {
      ask: false,
      anchor,
      journalVersion: true,
    });
    expect(report.notices[1].lines).toHaveLength(1);
  });

  it("lists the notes of the route taken", async () => {
    prefs[TARGET_PREF] = "L1";
    const { library, report } = actions([
      addedOutcome(item(901), { notes: ["journalDoiMismatch"] }),
    ]);
    await library.add(paper("2609.20001"), { ask: false, anchor });
    expect(report.notices[0].lines[1]).toBe(
      msg("arxiv-browser-note-journal-mismatch"),
    );
  });

  it("tells when the PDF was not attached, and why", async () => {
    prefs[TARGET_PREF] = "L1";
    let finish!: (result: ArxivPdfResult) => void;
    const pdf = new Promise<ArxivPdfResult>((resolve) => (finish = resolve));
    const { library, report } = actions([addedOutcome(item(901), { pdf })]);
    await library.add(paper("2609.20001"), { ask: false, anchor });
    expect(report.notices).toHaveLength(1);
    finish({ status: "failed", reason: "notPdf", message: "" });
    await vi.waitFor(() => expect(report.notices).toHaveLength(2));
    expect(report.notices[1].lines).toEqual([
      msg("arxiv-browser-pdf-failed", {
        id: "2609.20001",
        reason: msg("arxiv-browser-pdf-not-pdf"),
      }),
    ]);
  });

  it("offers to add from arXiv data, or to try later, when INSPIRE could not be reached", async () => {
    prefs[TARGET_PREF] = "L1";
    const { library, report, calls } = actions([
      { status: "inspireUnknown" },
      addedOutcome(item(901)),
    ]);
    await library.add(paper("2609.20001"), { ask: false, anchor });
    const [question] = report.notices;
    expect(question.stay).toBe(true);
    expect(question.actions.map((action) => action.label)).toEqual([
      msg("arxiv-browser-add-from-arxiv"),
      msg("arxiv-browser-try-later"),
    ]);
    question.actions[0].run();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].requests[0].withoutInspire).toBe(true);
    // Into the same target
    expect(calls[1].target).toBe(calls[0].target);
  });

  it("shows the item a paper is found as, and asks when only its journal DOI matched", async () => {
    prefs[TARGET_PREF] = "L1";
    item(700);
    const { library, report, calls, shown } = actions([
      {
        status: "inLibrary",
        hits: [{ itemID: 700, by: ["doi"] }],
        doiOnly: true,
      },
      addedOutcome(item(901)),
    ]);
    await library.add(paper("2609.20001"), { ask: false, anchor });
    const [question] = report.notices;
    expect(question.lines[0]).toBe(
      msg("arxiv-browser-doi-only", {
        id: "2609.20001",
        library: "My Library",
        titles: "Item 700",
      }),
    );
    question.actions[0].run();
    expect(shown).toEqual([[700]]);
    question.actions[1].run();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].requests[0].notTheDoiItems).toBe(true);
  });

  it("says why a paper was not added", async () => {
    prefs[TARGET_PREF] = "L1";
    const { library, report } = actions([{ status: "arxivUnavailable" }]);
    await library.add(paper("2609.20001"), { ask: false, anchor });
    expect(report.notices[0].lines).toEqual([
      msg("arxiv-browser-not-added", {
        id: "2609.20001",
        reason: msg("arxiv-browser-not-added-arxiv-unavailable"),
      }),
    ]);
  });
});

describe("Relating a paper to items chosen in Zotero's Select Items dialog", () => {
  it("relates the paper's item to the items chosen among those of its library", async () => {
    const paperItem = item(900, 2);
    const chosen = item(42, 2);
    const { library, report, pickRelated, relationChanged } = actions([], {
      related: [chosen],
    });
    const entry = paper("2609.20001");
    entry.localItemID = 900;
    expect(library.isRelated(entry)).toBe(false);

    await library.relate(entry, anchor);
    expect(pickRelated).toHaveBeenCalledWith(2);
    expect(paperItem.relatedItems).toEqual([chosen.key]);
    expect(chosen.relatedItems).toEqual([paperItem.key]);
    expect(library.isRelated(entry)).toBe(true);
    expect(library.relatedItemsOf(entry)).toEqual([chosen]);
    expect(report.notes[0]).toBe(
      msg("arxiv-browser-linked", { title: "Item 42" }),
    );
    expect(relationChanged).toEqual([entry]);
  });

  it("relates it to several items at once, and does nothing when none was chosen", async () => {
    const paperItem = item(900, 1);
    const env = actions([], { related: [item(42), item(43)] });
    const entry = paper("2609.20001");
    entry.localItemID = 900;
    await env.library.relate(entry, anchor);
    expect(paperItem.relatedItems).toEqual(["KEY42", "KEY43"]);
    expect(env.report.notes[0]).toBe(
      msg("arxiv-browser-linked-several", { count: 2 }),
    );

    const none = actions([], { related: [] });
    const other = paper("2609.20002");
    other.localItemID = item(901).id;
    await none.library.relate(other, anchor);
    expect(none.pickRelated).toHaveBeenCalledTimes(1);
    expect(none.report.notes).toEqual([]);
    expect(none.relationChanged).toEqual([]);
  });

  it("adds a paper not in the library (asking where), then asks for the items of its library to relate it to", async () => {
    const chosen = item(42, 1);
    const added = item(901, 1);
    const { library, pickTarget, pickRelated } = actions(
      [addedOutcome(added)],
      { related: [chosen] },
    );
    await library.relate(paper("2609.20001"), anchor);
    expect(pickTarget).toHaveBeenCalled();
    expect(pickRelated).toHaveBeenCalledWith(1);
    expect(chosen.relatedItems).toEqual([added.key]);
    expect(added.relatedItems).toEqual([chosen.key]);
  });
});

describe("The result of a batch import", () => {
  it("lists the papers not added and the PDFs not attached, and offers to add from arXiv data those INSPIRE did not answer about", async () => {
    const { library, report, calls, shown } = actions([
      addedOutcome(item(903)),
    ]);
    library.batchTarget = { ...target, name: "to-read" };
    const [a, b, c, d] = [
      "2609.10001",
      "2609.10002",
      "2609.10003",
      "2609.10004",
    ].map(paper);
    library.reportBatch({
      success: 1,
      failed: 2,
      cancelled: false,
      added: [
        {
          entries: [a],
          outcome: addedOutcome(item(901)) as any,
          pdf: { status: "failed", reason: "http", message: "" },
        },
      ],
      notAdded: [
        { entries: [b], outcome: { status: "inspireUnknown" } },
        { entries: [c], outcome: { status: "notOnArxiv" } },
        {
          entries: [d],
          outcome: { status: "inLibrary", hits: [], doiOnly: false },
        },
      ],
    });
    const [notice] = report.notices;
    expect(notice.lines).toEqual([
      msg("arxiv-browser-batch-added", {
        added: 1,
        total: 4,
        target: "to-read",
      }),
      msg("arxiv-browser-batch-not-added"),
      `arXiv:2609.10002 — ${msg("arxiv-browser-not-added-inspire-unknown")}`,
      `arXiv:2609.10003 — ${msg("arxiv-browser-not-added-not-on-arxiv")}`,
      `arXiv:2609.10004 — ${msg("arxiv-browser-not-added-in-library")}`,
      msg("arxiv-browser-batch-pdf-failed"),
      `arXiv:2609.10001 — ${msg("arxiv-browser-reason-http")}`,
    ]);
    expect(notice.stay).toBe(true);
    notice.actions[0].run();
    expect(shown).toEqual([[901]]);
    notice.actions[1].run();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].requests[0]).toMatchObject({
      arxivId: "2609.10002",
      withoutInspire: true,
    });
  });

  it("says that none was added when every paper was skipped as already in the library", () => {
    const { library, report } = actions();
    const [a] = ["2609.10001"].map(paper);
    library.reportBatch({
      success: 0,
      failed: 0,
      cancelled: false,
      added: [],
      notAdded: [
        {
          entries: [a],
          outcome: { status: "inLibrary", hits: [], doiOnly: false },
        },
      ],
    });
    expect(report.notices[0].lines).toEqual([
      msg("arxiv-browser-batch-none-added", { total: 1 }),
      msg("arxiv-browser-batch-not-added"),
      `arXiv:2609.10001 — ${msg("arxiv-browser-not-added-in-library")}`,
    ]);
  });

  it("counts, without listing, the papers a cancel stopped", () => {
    const { library, report } = actions();
    library.batchTarget = { ...target, name: "to-read" };
    const [a, b] = ["2609.10001", "2609.10002"].map(paper);
    library.reportBatch({
      success: 1,
      failed: 0,
      cancelled: true,
      added: [{ entries: [a], outcome: addedOutcome(item(901)) as any }],
      notAdded: [{ entries: [b], outcome: { status: "cancelled" } }],
    });
    expect(report.notices[0].lines).toEqual([
      msg("arxiv-browser-batch-added", {
        added: 1,
        total: 2,
        target: "to-read",
      }),
      msg("arxiv-browser-batch-cancelled", { count: 1 }),
    ]);
    expect(report.notices[0].stay).toBe(false);
  });
});
