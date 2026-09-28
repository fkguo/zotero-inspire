// ─────────────────────────────────────────────────────────────────────────────
// Adding arXiv papers: the route each paper takes (INSPIRE import, journal
// version by DOI, arXiv data), what waits for the user (INSPIRE did not
// answer, arXiv did not answer), the duplicate check in the target library
// after the journal DOI is known, and one check-and-create at a time per
// library. The item writers are replaced by stand-ins that add an item to a
// small SQLite library; the library index is the real one.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookupInspire: vi.fn(),
  fetchApi: vi.fn(),
  fetchMeta: vi.fn(),
  fromInspire: vi.fn(),
  fromArxiv: vi.fn(),
  lookUpJournal: vi.fn(),
  fromJournal: vi.fn(),
  attachPdf: vi.fn(),
  prefs: new Map<string, unknown>(),
}));

vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  setPref: () => undefined,
}));
vi.mock("../src/modules/arxiv/inspireByArxiv", () => ({
  lookupInspireByArxiv: mocks.lookupInspire,
}));
vi.mock("../src/modules/arxiv/arxivApi", () => ({
  fetchArxivApiEntries: mocks.fetchApi,
}));
vi.mock("../src/modules/inspire/metadataService", () => ({
  fetchInspireMetaByRecid: mocks.fetchMeta,
}));
vi.mock("../src/modules/inspire/library/itemCreation", () => ({
  createItemFromInspireMeta: mocks.fromInspire,
}));
vi.mock("../src/modules/arxiv/arxivItem", () => ({
  createItemFromArxiv: mocks.fromArxiv,
}));
vi.mock("../src/modules/arxiv/journalItem", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  lookUpJournalVersion: mocks.lookUpJournal,
  createItemFromJournalVersion: mocks.fromJournal,
}));
vi.mock("../src/modules/arxiv/arxivPdf", () => ({
  attachArxivPdf: mocks.attachPdf,
}));

import { addArxivPapers } from "../src/modules/arxiv/addToLibrary";
import type { ArxivApiEntry } from "../src/modules/arxiv/arxivApi";
import { stopLibraryIndex } from "../src/modules/inspire/library/arxivIndex";
import { FakeLibrary, GROUP_LIBRARY, USER_LIBRARY } from "./fakeLibrary";

let lib: FakeLibrary;
let libraries: Map<number, { editable: boolean }>;
let loaded: number[];

const TARGET = { libraryID: USER_LIBRARY, collectionIDs: [3] };

function apiEntry(id: string, extra: Partial<ArxivApiEntry> = {}) {
  return {
    id,
    version: 2,
    title: `Paper ${id}`,
    abstract: "",
    authors: ["A. Author"],
    published: "2026-09-24T00:00:00Z",
    updated: "2026-09-24T00:00:00Z",
    pdfUrl: `https://arxiv.org/pdf/${id}v2`,
    primaryCategory: "hep-ph",
    categories: ["hep-ph"],
    ...extra,
  };
}

/** The arXiv API answers with these entries (and fails for `failed`) */
function api(
  entries: ArxivApiEntry[],
  failed: string[] = [],
  missing: string[] = [],
) {
  mocks.fetchApi.mockResolvedValue({
    entries: new Map(entries.map((e) => [e.id, e])),
    missing,
    failed: failed.length
      ? [{ ids: failed, reason: "unavailable", message: "503" }]
      : [],
  });
}

/** INSPIRE's answers by arXiv ID */
function inspire(answers: Record<string, any>) {
  mocks.lookupInspire.mockImplementation(async (ids: string[]) => {
    return new Map(
      ids.map((id) => [id, answers[id] ?? { status: "notFound", at: 0 }]),
    );
  });
}

/** An item writer that saves an item with these fields, taking a while */
function writer(
  fields: (...args: any[]) => Record<string, string>,
  itemType = "preprint",
) {
  return async (...args: any[]) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const target = args.find((a) => a && "collectionIDs" in a);
    return lib.add({
      libraryID: target.libraryID,
      itemType,
      fields: fields(...args),
    });
  };
}

beforeEach(() => {
  lib = new FakeLibrary();
  libraries = new Map([
    [USER_LIBRARY, { editable: true }],
    [GROUP_LIBRARY, { editable: true }],
  ]);
  loaded = [];
  const globals = lib.zoteroGlobals();
  vi.stubGlobal("Zotero", {
    ...globals,
    Libraries: {
      get: (libraryID: number) => {
        const library = libraries.get(libraryID);
        return library
          ? {
              ...library,
              libraryID,
              waitForDataLoad: async (type: string) => {
                if (type === "item") loaded.push(libraryID);
              },
            }
          : false;
      },
    },
  });
  mocks.prefs.clear();
  for (const mock of Object.values(mocks)) {
    if (typeof mock === "function") mock.mockReset();
  }
  mocks.fetchMeta.mockImplementation(async (recid: string) => ({ recid }));
  mocks.fromInspire.mockImplementation(
    writer(
      (meta) => ({
        archive: "INSPIRE",
        archiveLocation: String(meta.recid),
      }),
      "journalArticle",
    ),
  );
  mocks.fromArxiv.mockImplementation(
    writer((entry) => ({ extra: `arXiv:${entry.id} [hep-ph]` })),
  );
  mocks.fromJournal.mockImplementation(
    writer(
      (data, entry) => ({
        DOI: data.DOI,
        extra: `arXiv:${entry.id} [hep-ph]`,
      }),
      "journalArticle",
    ),
  );
  mocks.attachPdf.mockResolvedValue({ status: "attached" });
});

afterEach(() => {
  stopLibraryIndex();
  vi.unstubAllGlobals();
});

describe("the route of each paper", () => {
  it("adds a paper INSPIRE has through the INSPIRE import, then its arXiv PDF", async () => {
    inspire({
      "2609.00001": { status: "found", recid: "3000001", metadata: {} },
    });
    api([apiEntry("2609.00001")]);

    const [outcome] = await addArxivPapers(
      [{ arxivId: "2609.00001" }],
      TARGET,
      {
        attachPdf: true,
      },
    );

    expect(outcome).toMatchObject({
      status: "added",
      route: "inspire",
      notes: [],
    });
    expect(mocks.fetchMeta.mock.calls[0][0]).toBe("3000001");
    expect(mocks.fromInspire).toHaveBeenCalledWith(
      { recid: "3000001" },
      TARGET,
    );
    expect(mocks.fromArxiv).not.toHaveBeenCalled();
    expect(mocks.attachPdf.mock.calls[0][1]).toMatchObject({
      id: "2609.00001",
      version: 2,
    });
    expect(await (outcome as any).pdf).toEqual({ status: "attached" });
    // The target library's items were loaded first
    expect(loaded).toEqual([USER_LIBRARY]);
  });

  it("adds a paper INSPIRE has no record of from arXiv data, with the listing's authors", async () => {
    inspire({});
    api([apiEntry("2609.00002")]);
    const listingAuthors = [
      { display: "A. Author", family: "Author", given: "A." },
    ];

    const [outcome] = await addArxivPapers(
      [{ arxivId: "2609.00002", listingAuthors }],
      TARGET,
    );

    expect(outcome).toMatchObject({ status: "added", route: "arxiv" });
    expect(mocks.fromArxiv).toHaveBeenCalledWith(
      expect.objectContaining({ id: "2609.00002" }),
      TARGET,
      listingAuthors,
    );
    // No PDF unless asked for (the option is off)
    expect(outcome).not.toHaveProperty("pdf");
    expect(mocks.attachPdf).not.toHaveBeenCalled();
  });

  it("adds the journal version by DOI when the user chose it and the DOI's data are the paper's", async () => {
    inspire({});
    api([apiEntry("2609.00003", { doi: "10.1103/PhysRevD.113.000003" })]);
    mocks.lookUpJournal.mockResolvedValue({
      status: "same",
      data: { itemType: "journalArticle", DOI: "10.1103/PhysRevD.113.000003" },
    });

    const [outcome] = await addArxivPapers(
      [{ arxivId: "2609.00003", journalVersion: true }],
      TARGET,
    );

    expect(outcome).toMatchObject({
      status: "added",
      route: "journal",
      notes: [],
    });
    expect(mocks.lookUpJournal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "2609.00003" }),
      "10.1103/PhysRevD.113.000003",
    );
  });

  it.each([
    [
      "belongs to another paper",
      { status: "different", data: {}, reasons: ["title"] },
      "journalDoiMismatch",
    ],
    ["finds nothing", { status: "notFound" }, "journalNotFound"],
  ])(
    "adds from arXiv data, saying so, when the DOI %s",
    async (_label, lookup, note) => {
      inspire({});
      api([apiEntry("2609.00004", { doi: "10.1103/x" })]);
      mocks.lookUpJournal.mockResolvedValue(lookup);
      const [outcome] = await addArxivPapers(
        [{ arxivId: "2609.00004", journalVersion: true }],
        TARGET,
      );
      expect(outcome).toMatchObject({
        status: "added",
        route: "arxiv",
        notes: [note],
      });
      expect(mocks.fromJournal).not.toHaveBeenCalled();
    },
  );

  it("adds a paper whose authors gave another paper's DOI, although that paper is in the library", async () => {
    lib.put({ fields: { DOI: "10.1103/wrong" } });
    inspire({});
    api([apiEntry("2609.00015", { doi: "10.1103/WRONG" })]);
    mocks.lookUpJournal.mockResolvedValue({
      status: "different",
      data: { DOI: "10.1103/wrong" },
      reasons: ["title", "firstAuthor"],
    });
    const [outcome] = await addArxivPapers(
      [{ arxivId: "2609.00015", journalVersion: true }],
      TARGET,
    );
    expect(outcome).toMatchObject({
      status: "added",
      route: "arxiv",
      notes: ["journalDoiMismatch"],
    });
  });

  it("adds from arXiv data, not the journal version, when INSPIRE did not answer", async () => {
    inspire({ "2609.00016": { status: "failed" } });
    api([apiEntry("2609.00016", { doi: "10.1103/x16" })]);
    const [outcome] = await addArxivPapers(
      [{ arxivId: "2609.00016", journalVersion: true, withoutInspire: true }],
      TARGET,
    );
    expect(outcome).toMatchObject({
      status: "added",
      route: "arxiv",
      notes: [],
    });
    expect(mocks.lookUpJournal).not.toHaveBeenCalled();
  });

  it("does not look the journal version up unless the user chose it", async () => {
    inspire({});
    api([apiEntry("2609.00005", { doi: "10.1103/x" })]);
    const [outcome] = await addArxivPapers([{ arxivId: "2609.00005" }], TARGET);
    expect(outcome).toMatchObject({ route: "arxiv" });
    expect(mocks.lookUpJournal).not.toHaveBeenCalled();
  });

  it("leaves a paper INSPIRE did not answer about to the user, and adds it from arXiv data when told to", async () => {
    inspire({ "2609.00006": { status: "failed" } });
    api([apiEntry("2609.00006")]);
    expect(await addArxivPapers([{ arxivId: "2609.00006" }], TARGET)).toEqual([
      { status: "inspireUnknown" },
    ]);
    expect(mocks.fromArxiv).not.toHaveBeenCalled();

    const [outcome] = await addArxivPapers(
      [{ arxivId: "2609.00006", withoutInspire: true }],
      TARGET,
    );
    expect(outcome).toMatchObject({ status: "added", route: "arxiv" });
  });

  it("asks INSPIRE afresh when adding, with the record's DOIs", async () => {
    inspire({
      "2609.00007": { status: "found", recid: "3000007", metadata: {} },
    });
    api([apiEntry("2609.00007")]);
    const [outcome] = await addArxivPapers([{ arxivId: "2609.00007" }], TARGET);
    expect(mocks.lookupInspire).toHaveBeenCalledWith(["2609.00007"], {
      fields: ["dois.value"],
      signal: undefined,
    });
    // The list may have shown the paper as not in INSPIRE hours ago
    expect(outcome).toMatchObject({ status: "added", route: "inspire" });
  });

  it("adds a paper INSPIRE has without its PDF when the arXiv API fails, and no other paper", async () => {
    inspire({
      "2609.00008": { status: "found", recid: "3000008", metadata: {} },
    });
    api([], ["2609.00008", "2609.00009"]);

    const outcomes = await addArxivPapers(
      [{ arxivId: "2609.00008" }, { arxivId: "2609.00009" }],
      TARGET,
      { attachPdf: true },
    );

    expect(outcomes[0]).toMatchObject({
      status: "added",
      route: "inspire",
      notes: ["noPdfArxivUnavailable"],
    });
    expect(outcomes[0]).not.toHaveProperty("pdf");
    expect(outcomes[1]).toEqual({ status: "arxivUnavailable" });
    expect(mocks.fromArxiv).not.toHaveBeenCalled();
  });

  it("adds nothing for a paper the arXiv API answered without", async () => {
    inspire({});
    api([], [], ["2609.00010"]);
    expect(await addArxivPapers([{ arxivId: "2609.00010" }], TARGET)).toEqual([
      { status: "notOnArxiv" },
    ]);
  });

  it("adds nothing when INSPIRE no longer gives the record", async () => {
    inspire({
      "2609.00011": { status: "found", recid: "3000011", metadata: {} },
    });
    api([apiEntry("2609.00011")]);
    mocks.fetchMeta.mockResolvedValue(-1);
    const [outcome] = await addArxivPapers([{ arxivId: "2609.00011" }], TARGET);
    expect(outcome).toMatchObject({
      status: "failed",
      reason: "inspireRecord",
    });
    expect(mocks.fromInspire).not.toHaveBeenCalled();
  });
});

describe("the arXiv PDF of an added paper", () => {
  it("is not attached to a journal item when the user said so, but to a preprint", async () => {
    mocks.prefs.set("arxiv_pdf_skip_journal_items", true);
    inspire({
      "2609.00012": { status: "found", recid: "3000012", metadata: {} },
    });
    api([apiEntry("2609.00012"), apiEntry("2609.00013")]);
    const outcomes = await addArxivPapers(
      [{ arxivId: "2609.00012" }, { arxivId: "2609.00013" }],
      TARGET,
      { attachPdf: true },
    );
    // A journal article from INSPIRE: no PDF; a preprint from arXiv data: PDF
    expect(outcomes[0]).not.toHaveProperty("pdf");
    expect(outcomes[1]).toHaveProperty("pdf");
    expect(mocks.attachPdf).toHaveBeenCalledOnce();
  });

  it("follows the find-full-text option when not told", async () => {
    mocks.prefs.set("auto_find_fulltext_on_import", true);
    inspire({});
    api([apiEntry("2609.00014")]);
    const [outcome] = await addArxivPapers([{ arxivId: "2609.00014" }], TARGET);
    expect(outcome).toHaveProperty("pdf");
  });
});

describe("papers already in the library", () => {
  it("adds nothing for a paper an item of the target library has, by arXiv ID or recid", async () => {
    const byArxiv = lib.put({ fields: { extra: "arXiv:2609.00020 [hep-ph]" } });
    const byRecid = lib.put({
      fields: { archive: "INSPIRE", archiveLocation: "3000021" },
    });
    inspire({
      "2609.00021": { status: "found", recid: "3000021", metadata: {} },
    });
    api([apiEntry("2609.00020"), apiEntry("2609.00021")]);

    const outcomes = await addArxivPapers(
      [{ arxivId: "2609.00020" }, { arxivId: "2609.00021" }],
      TARGET,
    );

    expect(outcomes).toEqual([
      {
        status: "inLibrary",
        hits: [{ itemID: byArxiv.id, by: ["arxiv"] }],
        doiOnly: false,
      },
      {
        status: "inLibrary",
        hits: [{ itemID: byRecid.id, by: ["recid"] }],
        doiOnly: false,
      },
    ]);
    expect(mocks.fromArxiv).not.toHaveBeenCalled();
    expect(mocks.fromInspire).not.toHaveBeenCalled();
  });

  it("finds an item saved under the journal DOI only, for the user to confirm", async () => {
    const journal = lib.put({ fields: { DOI: "10.1103/PhysRevD.113.000022" } });
    inspire({});
    api([apiEntry("2609.00022", { doi: "10.1103/physrevd.113.000022" })]);
    const [outcome] = await addArxivPapers([{ arxivId: "2609.00022" }], TARGET);
    expect(outcome).toEqual({
      status: "inLibrary",
      hits: [{ itemID: journal.id, by: ["doi"] }],
      doiOnly: true,
    });
  });

  it("adds the paper when the user says the item found by the DOI alone is another paper", async () => {
    lib.put({ fields: { DOI: "10.1103/other" } });
    inspire({});
    api([apiEntry("2609.00035", { doi: "10.1103/other" })]);
    const [outcome] = await addArxivPapers(
      [{ arxivId: "2609.00035", notTheDoiItems: true }],
      TARGET,
    );
    expect(outcome).toMatchObject({ status: "added", route: "arxiv" });
  });

  it("still finds the paper by arXiv ID when the user set aside the DOI's items", async () => {
    const item = lib.put({
      fields: { extra: "arXiv:2609.00036", DOI: "10.1103/x36" },
    });
    inspire({});
    api([apiEntry("2609.00036", { doi: "10.1103/x36" })]);
    const [outcome] = await addArxivPapers(
      [{ arxivId: "2609.00036", notTheDoiItems: true }],
      TARGET,
    );
    expect(outcome).toMatchObject({
      status: "inLibrary",
      hits: [{ itemID: item.id, by: ["arxiv", "doi"] }],
    });
  });

  it("finds an item under the journal DOI of the INSPIRE record when the arXiv API fails", async () => {
    const journal = lib.put({ fields: { DOI: "10.1103/PhysRevD.113.000037" } });
    // The record lists arXiv's DOI first, the journal's second; the fetched
    // record's own DOI field gives the first only
    inspire({
      "2609.00037": {
        status: "found",
        recid: "3000037",
        metadata: {
          dois: [
            { value: "10.48550/arXiv.2609.00037" },
            { value: "10.1103/PhysRevD.113.000037" },
          ],
        },
      },
    });
    mocks.fetchMeta.mockResolvedValue({
      recid: "3000037",
      DOI: "10.48550/arXiv.2609.00037",
    });
    api([], ["2609.00037"]);
    const [outcome] = await addArxivPapers([{ arxivId: "2609.00037" }], TARGET);
    expect(outcome).toEqual({
      status: "inLibrary",
      hits: [{ itemID: journal.id, by: ["doi"] }],
      doiOnly: true,
    });
    expect(mocks.fromInspire).not.toHaveBeenCalled();
  });

  it("finds an item by a DOI of the INSPIRE record, but not by arXiv's own DOI", async () => {
    const journal = lib.put({ fields: { DOI: "10.1016/j.physletb.2026.1" } });
    lib.put({
      fields: { DOI: "10.48550/arXiv.2609.00024" },
      libraryID: GROUP_LIBRARY,
    });
    inspire({
      "2609.00023": {
        status: "found",
        recid: "3000023",
        metadata: {
          dois: [{ value: "10.1016/j.physletb.2026.1" }],
        },
      },
    });
    api([apiEntry("2609.00023"), apiEntry("2609.00024")]);
    const outcomes = await addArxivPapers(
      [{ arxivId: "2609.00023" }, { arxivId: "2609.00024" }],
      TARGET,
    );
    expect(outcomes[0]).toMatchObject({
      status: "inLibrary",
      hits: [{ itemID: journal.id, by: ["doi"] }],
    });
    expect(outcomes[1]).toMatchObject({ status: "added" });
  });

  it("adds a paper that only another library has", async () => {
    lib.put({
      libraryID: GROUP_LIBRARY,
      fields: { extra: "arXiv:2609.00025 [hep-ph]" },
    });
    inspire({});
    api([apiEntry("2609.00025")]);
    const [outcome] = await addArxivPapers([{ arxivId: "2609.00025" }], TARGET);
    expect(outcome).toMatchObject({ status: "added" });
  });

  it("adds a paper once when two adds of it run at the same time", async () => {
    inspire({});
    api([apiEntry("2609.00026")]);
    const [first, second] = await Promise.all([
      addArxivPapers([{ arxivId: "2609.00026" }], TARGET),
      addArxivPapers([{ arxivId: "2609.00026" }], TARGET),
    ]);
    expect([first[0].status, second[0].status].sort()).toEqual([
      "added",
      "inLibrary",
    ]);
    expect(mocks.fromArxiv).toHaveBeenCalledOnce();
  });

  it("adds one of two papers with the same journal DOI added at the same time", async () => {
    inspire({});
    mocks.fetchApi.mockImplementation(async (ids: string[]) => ({
      entries: new Map(
        ids.map((id) => [id, apiEntry(id, { doi: "10.1103/same" })]),
      ),
      missing: [],
      failed: [],
    }));
    mocks.lookUpJournal.mockImplementation(async () => ({
      status: "same",
      data: { itemType: "journalArticle", DOI: "10.1103/same" },
    }));
    const [first, second] = await Promise.all([
      addArxivPapers([{ arxivId: "2609.00027", journalVersion: true }], TARGET),
      addArxivPapers([{ arxivId: "2609.00028", journalVersion: true }], TARGET),
    ]);
    expect([first[0].status, second[0].status].sort()).toEqual([
      "added",
      "inLibrary",
    ]);
    expect(mocks.fromJournal).toHaveBeenCalledOnce();
  });

  it("adds in two libraries at the same time without one waiting for the other's check", async () => {
    inspire({});
    api([apiEntry("2609.00029")]);
    const outcomes = await Promise.all([
      addArxivPapers([{ arxivId: "2609.00029" }], TARGET),
      addArxivPapers([{ arxivId: "2609.00029" }], {
        libraryID: GROUP_LIBRARY,
        collectionIDs: [],
      }),
    ]);
    expect(outcomes.map((o) => o[0].status)).toEqual(["added", "added"]);
  });

  it("adds nothing when the library cannot be read", async () => {
    inspire({});
    api([apiEntry("2609.00030")]);
    lib.queryError = new Error("database is locked");
    const [outcome] = await addArxivPapers([{ arxivId: "2609.00030" }], TARGET);
    expect(outcome).toMatchObject({
      status: "failed",
      reason: "libraryUnreadable",
    });
    expect(mocks.fromArxiv).not.toHaveBeenCalled();
  });
});

describe("the target library and cancelling", () => {
  it("adds nothing to a library that cannot be edited", async () => {
    libraries.set(GROUP_LIBRARY, { editable: false });
    const outcomes = await addArxivPapers([{ arxivId: "2609.00031" }], {
      libraryID: GROUP_LIBRARY,
      collectionIDs: [],
    });
    expect(outcomes).toEqual([
      { status: "failed", reason: "notEditable", message: expect.any(String) },
    ]);
    expect(mocks.lookupInspire).not.toHaveBeenCalled();
  });

  it("adds nothing more once cancelled", async () => {
    inspire({});
    api([apiEntry("2609.00032"), apiEntry("2609.00033")]);
    const controller = new AbortController();
    mocks.fromArxiv.mockImplementationOnce(async (...args: any[]) => {
      const item = await writer((entry) => ({ extra: `arXiv:${entry.id}` }))(
        ...args,
      );
      controller.abort();
      return item;
    });
    const outcomes = await addArxivPapers(
      [{ arxivId: "2609.00032" }, { arxivId: "2609.00033" }],
      TARGET,
      { signal: controller.signal },
    );
    // The item being saved is kept; the next paper is not added
    expect(outcomes.map((o) => o.status)).toEqual(["added", "cancelled"]);
    expect(mocks.fromArxiv).toHaveBeenCalledOnce();
  });

  it("adds nothing when cancelled while INSPIRE is asked", async () => {
    mocks.lookupInspire.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const outcomes = await addArxivPapers([{ arxivId: "2609.00034" }], TARGET);
    expect(outcomes).toEqual([{ status: "cancelled" }]);
    expect(mocks.fetchApi).not.toHaveBeenCalled();
  });
});
