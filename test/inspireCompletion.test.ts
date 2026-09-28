// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE completion: which items are offered (added in the last 30 days,
// arXiv ID, no recid, editable libraries), what the check shows, and the
// write of the plugin's own fields only -- refused for an item that is shown,
// has unsaved changes, or changed since the check; Date Modified kept.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  prefs: new Map<string, unknown>([["citekey", "inspire"]]),
}));
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  setPref: () => undefined,
}));
vi.mock("../src/modules/arxiv/inspireByArxiv", () => ({
  resolveInspireByArxiv: mocks.resolve,
}));

import {
  checkInspireCompletion,
  findCompletionCandidates,
  writeInspireCompletion,
  type CompletionEntry,
} from "../src/modules/inspire/library/inspireCompletion";
import {
  FakeLibrary,
  GROUP_LIBRARY,
  USER_LIBRARY,
  type FakeItem,
} from "./fakeLibrary";

const NOW = Date.UTC(2026, 8, 29, 3);
let lib: FakeLibrary;
let selected: number[];
let readers: { itemID: number }[];
let groupEditable: boolean;

function sqlDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/** An item added `days` ago from arXiv data (no recid) */
function preprint(
  arxivId: string,
  days = 2,
  extra: Partial<Record<string, string>> = {},
) {
  return lib.put({
    itemType: "preprint",
    dateAdded: sqlDate(NOW - days * 24 * 3600 * 1000),
    fields: {
      title: `Paper ${arxivId}`,
      extra: `arXiv:${arxivId} [hep-ph]`,
      archiveID: `arXiv:${arxivId}`,
      ...extra,
    },
    creators: [{ firstName: "Rahul", lastName: "Pathak" }],
  });
}

/** INSPIRE's answers for items, in their order */
function inspireFinds(
  answers: Record<string, { recid: string; mismatches?: string[] } | null>,
) {
  mocks.resolve.mockImplementation(async (items: { arxivId: string }[]) =>
    items.map(({ arxivId }) => {
      const answer = answers[arxivId];
      if (!answer) return { status: "notFound" };
      return {
        status: "found",
        recid: answer.recid,
        mismatches: answer.mismatches ?? [],
        metadata: {
          titles: [{ title: `Paper ${arxivId}` }],
          first_author: { full_name: "Pathak, Rahul" },
          texkeys: [`Pathak:2026abc`],
          citation_count: 7,
          citation_count_without_self_citations: 5,
        },
      };
    }),
  );
}

beforeEach(() => {
  lib = new FakeLibrary();
  selected = [];
  readers = [];
  groupEditable = true;
  const globals = lib.zoteroGlobals();
  const library = (libraryID: number) => ({
    libraryID,
    libraryType: libraryID === USER_LIBRARY ? "user" : "group",
    editable: libraryID === USER_LIBRARY || groupEditable,
    waitForDataLoad: async () => undefined,
  });
  vi.stubGlobal("Zotero", {
    ...globals,
    Libraries: {
      get: library,
      getAll: () => [library(USER_LIBRARY), library(GROUP_LIBRARY)],
    },
    Date: { dateToSQL: (date: Date) => sqlDate(date.getTime()) },
    platformMajorVersion: 10,
    DB: {
      ...globals.DB,
      executeTransaction: async (fn: () => Promise<unknown>) => fn(),
    },
    getMainWindows: () => [
      {
        ZoteroPane: {
          getSelectedItems: (asIDs: boolean, options?: any) =>
            asIDs && options?.libraryTabOnly ? selected : [],
        },
      },
    ],
    Reader: {
      get _readers() {
        return readers;
      },
    },
  });
  mocks.prefs.set("citekey", "inspire");
  mocks.resolve.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function checked(...items: FakeItem[]): Promise<CompletionEntry[]> {
  return checkInspireCompletion(items as any);
}

describe("the items offered for INSPIRE completion", () => {
  it("are the recent items with an arXiv ID and no recid, in editable libraries", async () => {
    const recent = preprint("2609.00001", 2);
    preprint("2608.00002", 45); // added too long ago
    lib.put({
      dateAdded: sqlDate(NOW),
      fields: {
        extra: "arXiv:2609.00003",
        archive: "INSPIRE",
        archiveLocation: "3000003",
      },
    });
    lib.put({ dateAdded: sqlDate(NOW), fields: { title: "No arXiv ID" } });
    lib.put({
      dateAdded: sqlDate(NOW),
      deleted: true,
      fields: { extra: "arXiv:2609.00005" },
    });
    const inGroup = lib.put({
      libraryID: GROUP_LIBRARY,
      dateAdded: sqlDate(NOW),
      fields: { url: "https://arxiv.org/abs/2609.00006" },
    });
    expect((await findCompletionCandidates(NOW)).map((i) => i.id)).toEqual([
      recent.id,
      inGroup.id,
    ]);
    groupEditable = false;
    expect((await findCompletionCandidates(NOW)).map((i) => i.id)).toEqual([
      recent.id,
    ]);
  });
});

describe("the check against INSPIRE", () => {
  it("shows each item with its record, ticked when the record is the item's paper", async () => {
    const a = preprint("2609.00011");
    const b = preprint("2609.00012");
    const c = preprint("2609.00013");
    inspireFinds({
      "2609.00011": { recid: "3000011" },
      "2609.00012": { recid: "3000012", mismatches: ["title"] },
    });
    const entries = await checked(a, b, c);
    expect(mocks.resolve.mock.calls[0][0]).toEqual([
      {
        item: a,
        arxivId: "2609.00011",
        title: "Paper 2609.00011",
        firstAuthor: { lastName: "Pathak", firstName: "Rahul" },
      },
      expect.anything(),
      expect.anything(),
    ]);
    expect(entries.map((e) => [e.status, e.preselected, e.mismatches])).toEqual(
      [
        ["found", true, []],
        ["found", false, ["title"]],
        ["notFound", false, []],
      ],
    );
    expect(entries[0].record).toEqual({
      recid: "3000011",
      title: "Paper 2609.00011",
      firstAuthor: "Pathak, Rahul",
      texkey: "Pathak:2026abc",
      citationCount: 7,
      citationCountWithoutSelf: 5,
    });
  });
});

describe("writing an item's INSPIRE fields", () => {
  it("writes recid, empty citation key and citation lines only, keeping Date Modified", async () => {
    const item = preprint("2609.00021", 2, {
      extra: "arXiv:2609.00021 [hep-ph]\nmy own note",
    });
    inspireFinds({ "2609.00021": { recid: "3000021" } });
    const [entry] = await checked(item);
    const before = {
      ...Object.fromEntries(
        ["title", "archiveID", "url", "DOI"].map((f) => [f, item.getField(f)]),
      ),
    };

    expect(await writeInspireCompletion([entry])).toEqual([
      {
        status: "written",
        wrote: ["recid", "citations", "citationKey"],
        archiveConflict: false,
      },
    ]);
    expect(item.saves).toEqual([{ skipDateModifiedUpdate: true }]);
    expect(item.getField("archive")).toBe("INSPIRE");
    expect(item.getField("archiveLocation")).toBe("3000021");
    expect(item.getField("citationKey")).toBe("Pathak:2026abc");
    expect(item.getField("extra").split("\n")).toEqual([
      "arXiv:2609.00021 [hep-ph]",
      "my own note",
      expect.stringMatching(/^7 citations \(INSPIRE [\d/]+\)$/),
      expect.stringMatching(/^5 citations w\/o self \(INSPIRE [\d/]+\)$/),
    ]);
    for (const [field, value] of Object.entries(before)) {
      expect(item.getField(field), field).toBe(value);
    }
    // Saved: the library index now finds the recid
    const row = lib.db
      .prepare(
        "SELECT value FROM itemData JOIN itemDataValues USING (valueID) JOIN fields USING (fieldID) WHERE itemID = ? AND fieldName = 'archiveLocation'",
      )
      .get(item.id) as { value: string };
    expect(row.value).toBe("3000021");
  });

  it("leaves a citation key the item has, and writes none unless keys come from INSPIRE", async () => {
    const own = preprint("2609.00022", 2, { citationKey: "mine" });
    const other = preprint("2609.00023");
    inspireFinds({
      "2609.00022": { recid: "3000022" },
      "2609.00023": { recid: "3000023" },
    });
    mocks.prefs.set("citekey", "none");
    const results = await writeInspireCompletion(await checked(own, other));
    expect(own.getField("citationKey")).toBe("mine");
    expect(other.getField("citationKey")).toBe("");
    expect(results.map((r) => (r as any).wrote)).toEqual([
      ["recid", "citations"],
      ["recid", "citations"],
    ]);
  });

  it("writes the citation key to Extra on Zotero 7, where there is no Citation Key field", async () => {
    (globalThis as any).Zotero.platformMajorVersion = 7;
    const item = preprint("2609.00026");
    const keyed = preprint("2609.00027", 2, {
      extra: "arXiv:2609.00027 [hep-ph]\nCitation Key: mine",
    });
    inspireFinds({
      "2609.00026": { recid: "3000026" },
      "2609.00027": { recid: "3000027" },
    });
    const results = await writeInspireCompletion(await checked(item, keyed));
    expect(item.getField("citationKey")).toBe("");
    expect(item.getField("extra")).toContain("Citation Key: Pathak:2026abc");
    expect(keyed.getField("extra")).toContain("Citation Key: mine");
    expect(keyed.getField("extra")).not.toContain("Pathak:2026abc");
    expect(results.map((r) => (r as any).wrote)).toEqual([
      ["recid", "citations", "citationKey"],
      ["recid", "citations"],
    ]);
  });

  it("completes a half-filled Archive, and leaves both alone when one holds something else", async () => {
    const half = preprint("2609.00024", 2, { archive: "INSPIRE" });
    const shelf = preprint("2609.00025", 2, {
      archive: "Library",
      archiveLocation: "Shelf 3",
    });
    inspireFinds({
      "2609.00024": { recid: "3000024" },
      "2609.00025": { recid: "3000025" },
    });
    const results = await writeInspireCompletion(await checked(half, shelf));
    expect(half.getField("archiveLocation")).toBe("3000024");
    expect(results[1]).toMatchObject({
      status: "written",
      archiveConflict: true,
    });
    expect(shelf.getField("archive")).toBe("Library");
    expect(shelf.getField("archiveLocation")).toBe("Shelf 3");
  });

  it("writes nothing to an item selected in the library or open in a reader", async () => {
    const shown = preprint("2609.00031");
    const read = preprint("2609.00032");
    const attachment = lib.put({ itemType: "attachment" });
    attachment.parentItemID = read.id;
    inspireFinds({
      "2609.00031": { recid: "3000031" },
      "2609.00032": { recid: "3000032" },
    });
    const entries = await checked(shown, read);
    selected = [shown.id];
    readers = [{ itemID: attachment.id }];
    expect(await writeInspireCompletion(entries)).toEqual([
      { status: "skipped", reason: "shown" },
      { status: "skipped", reason: "shown" },
    ]);
    expect(shown.saves).toEqual([]);
    // Once no longer shown, the same entries are written
    selected = [];
    readers = [];
    expect(
      (await writeInspireCompletion(entries)).map((r) => r.status),
    ).toEqual(["written", "written"]);
  });

  it("writes nothing to an item with unsaved changes, and keeps those changes", async () => {
    const item = preprint("2609.00041");
    inspireFinds({ "2609.00041": { recid: "3000041" } });
    const [entry] = await checked(item);
    item.setField("title", "Being edited");
    expect(await writeInspireCompletion([entry])).toEqual([
      { status: "skipped", reason: "unsaved" },
    ]);
    expect(item.getField("title")).toBe("Being edited");
    expect(item.hasChanged()).toBe(true);
    expect(item.saves).toEqual([]);
  });

  it("writes nothing to an item edited, moved to the trash or given a recid since the check", async () => {
    const edited = preprint("2609.00051");
    const trashed = preprint("2609.00052");
    const other = preprint("2609.00053");
    const corrected = preprint("2609.00054");
    inspireFinds({
      "2609.00051": { recid: "3000051" },
      "2609.00052": { recid: "3000052" },
      "2609.00053": { recid: "3000053" },
      "2609.00054": { recid: "3000054" },
    });
    const entries = await checked(edited, trashed, other, corrected);
    // The arXiv ID corrected in Extra; Archive ID still has the old one
    await lib.edit(corrected, { extra: "arXiv:2609.00055 [hep-ph]" });
    await lib.edit(edited, { title: "A corrected title" });
    await lib.trash(trashed);
    await lib.edit(other, { archive: "INSPIRE", archiveLocation: "3000053" });
    expect(await writeInspireCompletion(entries)).toEqual([
      { status: "skipped", reason: "changed" },
      { status: "skipped", reason: "gone" },
      { status: "skipped", reason: "changed" },
      { status: "skipped", reason: "changed" },
    ]);
  });

  it("writes an item once when the same entry is written twice at the same time", async () => {
    const item = preprint("2609.00061");
    inspireFinds({ "2609.00061": { recid: "3000061" } });
    const [entry] = await checked(item);
    const results = await Promise.all([
      writeInspireCompletion([entry]),
      writeInspireCompletion([entry]),
    ]);
    expect(results.flat().map((r) => r.status)).toEqual(["written", "skipped"]);
    expect(item.saves).toHaveLength(1);
  });

  it("writes nothing for an item INSPIRE had no record of", async () => {
    const item = preprint("2609.00071");
    inspireFinds({});
    expect(await writeInspireCompletion(await checked(item))).toEqual([
      { status: "skipped", reason: "notFound" },
    ]);
  });
});
