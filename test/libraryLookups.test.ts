// ─────────────────────────────────────────────────────────────────────────────
// Looking papers up in the library by INSPIRE recid, arXiv ID and DOI
//
// The lookups run on a small library in SQLite (fakeLibrary.ts) whose items
// have the field layouts found in real libraries: the plugin's (recid in
// Archive Location with Archive "INSPIRE", arXiv line in Extra), Zotero's
// arXiv translator (arXiv links in URL, Archive ID and DOI), items in the
// trash and in a group library.
//
// Cases written "before -> after" are the intentional behaviour changes of the
// library index (the lookups read it instead of querying single fields); the
// "before" values are what the SQL queries of apiUtils gave.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findItemByRecid,
  findItemsByArxivs,
  findItemsByDOIs,
  findItemsByRecids,
  LibraryIndexError,
  libraryLookup,
  onLibraryIndexChange,
  stopLibraryIndex,
  type LibraryHit,
} from "../src/modules/inspire/library/arxivIndex";
import {
  FakeLibrary,
  FEED_LIBRARY,
  GROUP_LIBRARY,
  USER_LIBRARY,
  type FakeItem,
} from "./fakeLibrary";

let lib: FakeLibrary;
beforeEach(() => {
  lib = new FakeLibrary();
  vi.stubGlobal("Zotero", lib.zoteroGlobals());
});
afterEach(() => {
  stopLibraryIndex();
  vi.unstubAllGlobals();
});

/** The plugin's layout of an item imported from INSPIRE */
function pluginItem(recid: string, arxiv?: string, doi?: string) {
  return {
    archive: "INSPIRE",
    archiveLocation: recid,
    ...(arxiv ? { extra: `arXiv:${arxiv} [hep-ph]` } : {}),
    ...(doi ? { DOI: doi } : {}),
  };
}

/** Zotero's arXiv translator layout (preprint) */
function translatorItem(arxiv: string) {
  return {
    url: `http://arxiv.org/abs/${arxiv}`,
    archiveID: `arXiv:${arxiv}`,
    DOI: `10.48550/arXiv.${arxiv}`,
  };
}

/** The item IDs of hits, in their order */
function ids(hits: LibraryHit[] | undefined): number[] {
  return (hits ?? []).map((hit) => hit.itemID);
}

/** Item labels of the IDs a lookup gave, for readable expectations */
function labelsOf(
  items: Record<string, FakeItem>,
  itemIDs: Iterable<number>,
): string[] {
  const byID = new Map(Object.entries(items).map(([k, v]) => [v.id, k]));
  return [...itemIDs].map((id) => byID.get(id) ?? `#${id}`).sort();
}

describe("findItemByRecid", () => {
  it("finds the item with the recid in Archive Location", async () => {
    const item = lib.put({ fields: pluginItem("1234567") });
    lib.put({ fields: pluginItem("7654321") });
    expect((await findItemByRecid("1234567"))?.id).toBe(item.id);
    expect(await findItemByRecid("1111111")).toBeNull();
  });

  it("finds an item in a group library", async () => {
    const item = lib.put({
      libraryID: GROUP_LIBRARY,
      fields: pluginItem("1234567"),
    });
    expect((await findItemByRecid("1234567"))?.id).toBe(item.id);
  });

  // Intentional change: the recid is the one resolveItemRecid reads
  it.each([
    ["Archive empty", { archiveLocation: "1234567" }, true, false],
    [
      "Archive a shelf name",
      { archive: "Library shelf", archiveLocation: "1234567" },
      true,
      false,
    ],
    [
      "only an INSPIRE URL",
      { url: "https://inspirehep.net/literature/1234567" },
      false,
      true,
    ],
  ])(
    "with %s: found %s before -> %s after",
    async (_name, fields: Record<string, string>, _before, after) => {
      const item = lib.put({ fields });
      const found = await findItemByRecid("1234567");
      expect(found ? found.id === item.id : false).toBe(after);
    },
  );

  // Intentional change: before, the item in the trash was found
  it("does not find an item in the trash", async () => {
    lib.put({ fields: pluginItem("1234567"), deleted: true });
    expect(await findItemByRecid("1234567")).toBeNull();
  });

  // Intentional change: before, either item could be given
  it("gives the item with the lowest ID of two with the same recid", async () => {
    const a = lib.put({ fields: pluginItem("1234567") });
    lib.put({ fields: pluginItem("1234567") });
    expect((await findItemByRecid("1234567"))?.id).toBe(a.id);
  });

  it("rejects when the library cannot be read", async () => {
    lib.put({ fields: pluginItem("1234567") });
    lib.queryError = new Error("database is locked");
    await expect(findItemByRecid("1234567")).rejects.toThrow(LibraryIndexError);
  });
});

describe("findItemsByRecids", () => {
  it("gives the items with each recid, by Archive Location or INSPIRE URL", async () => {
    const items = {
      plugin: lib.put({ fields: pluginItem("100") }),
      group: lib.put({ libraryID: GROUP_LIBRARY, fields: pluginItem("200") }),
      url: lib.put({
        fields: { url: "https://inspirehep.net/literature/300" },
      }),
      urlWww: lib.put({
        fields: { url: "http://www.inspirehep.net/literature/400/" },
      }),
    };
    const found = await findItemsByRecids(["100", "200", "300", "400", "500"]);
    expect(Object.fromEntries(found)).toEqual({
      "100": [
        { itemID: items.plugin.id, libraryID: USER_LIBRARY, hasRecid: true },
      ],
      "200": [
        { itemID: items.group.id, libraryID: GROUP_LIBRARY, hasRecid: true },
      ],
      "300": [
        { itemID: items.url.id, libraryID: USER_LIBRARY, hasRecid: true },
      ],
      "400": [
        { itemID: items.urlWww.id, libraryID: USER_LIBRARY, hasRecid: true },
      ],
    });
  });

  // Intentional change: the recid is the one resolveItemRecid reads
  it.each([
    ["Archive empty", { archiveLocation: "100" }, true, false],
    [
      "Archive a shelf name",
      { archive: "Shelf", archiveLocation: "100" },
      true,
      false,
    ],
    [
      "API URL",
      { url: "https://inspirehep.net/api/literature/100" },
      false,
      true,
    ],
    [
      "legacy record URL",
      { url: "http://inspirehep.net/record/100" },
      false,
      true,
    ],
    [
      "URL on a lookalike host",
      { url: "https://notinspirehep.net/literature/100" },
      true,
      false,
    ],
    [
      "URL with an INSPIRE link in its query",
      {
        url: "https://example.org/?next=https://inspirehep.net/literature/100",
      },
      true,
      false,
    ],
  ])(
    "with %s: found %s before -> %s after",
    async (_name, fields: Record<string, string>, _before, after) => {
      const item = lib.put({ fields });
      const found = await findItemsByRecids(["100"]);
      expect(ids(found.get("100")).includes(item.id)).toBe(after);
    },
  );

  // Intentional change: before, the item in the trash was found
  it("does not find an item in the trash", async () => {
    lib.put({ fields: pluginItem("100"), deleted: true });
    expect((await findItemsByRecids(["100"])).size).toBe(0);
  });

  // Intentional change: before, one of the two was given
  it("gives every item with the recid", async () => {
    const a = lib.put({ fields: pluginItem("100") });
    const b = lib.put({ fields: pluginItem("100") });
    expect(ids((await findItemsByRecids(["100"])).get("100"))).toEqual([
      a.id,
      b.id,
    ]);
  });

  // Intentional change: before, a failed query gave no match
  it("rejects when the library cannot be read", async () => {
    lib.put({ fields: pluginItem("100") });
    lib.queryError = new Error("database is locked");
    await expect(findItemsByRecids(["100"])).rejects.toThrow(LibraryIndexError);
  });
});

describe("findItemsByArxivs", () => {
  it("gives the items with each arXiv ID in Extra", async () => {
    const items = {
      extra: lib.put({ fields: pluginItem("1", "2301.12345") }),
      eprint: lib.put({ fields: { extra: "_eprint:2302.00001" } }),
      old: lib.put({ fields: { extra: "arXiv:hep-ph/0101001" } }),
      versioned: lib.put({ fields: { extra: "arXiv:2303.00002v3" } }),
      group: lib.put({
        libraryID: GROUP_LIBRARY,
        fields: { extra: "arXiv:2304.00003" },
      }),
    };
    const found = await findItemsByArxivs([
      "2301.12345",
      "2302.00001",
      "hep-ph/0101001",
      "2303.00002",
      "2304.00003",
      "2305.00004",
    ]);
    expect(
      Object.fromEntries([...found].map(([id, hits]) => [id, ids(hits)])),
    ).toEqual({
      "2301.12345": [items.extra.id],
      "2302.00001": [items.eprint.id],
      "hep-ph/0101001": [items.old.id],
      "2303.00002": [items.versioned.id],
      "2304.00003": [items.group.id],
    });
    expect(found.get("2301.12345")![0].hasRecid).toBe(true);
    expect(found.get("2302.00001")![0].hasRecid).toBe(false);
  });

  // Intentional changes: every field that holds an arXiv ID is read, only
  // from its own place (a line start in Extra), and IDs are compared in
  // canonical form
  it.each([
    // Zotero's arXiv translator layout
    [
      "URL, Archive ID and DOI",
      translatorItem("2301.12345"),
      "2301.12345",
      false,
      true,
    ],
    [
      "URL only",
      { url: "https://arxiv.org/abs/2301.12345v2" },
      "2301.12345",
      false,
      true,
    ],
    [
      "Journal Abbr",
      { journalAbbreviation: "arXiv:2301.12345 [hep-ph]" },
      "2301.12345",
      false,
      true,
    ],
    [
      "space after the colon",
      { extra: "arXiv: 2301.12345" },
      "2301.12345",
      false,
      true,
    ],
    // an ID mentioned inside a line, not an arXiv line
    [
      "ID inside a line",
      { extra: "Comment: see arXiv:2301.12345" },
      "2301.12345",
      true,
      false,
    ],
    // subject class in the item, canonical ID asked
    [
      "subject class in Extra",
      { extra: "arXiv:math.GT/0309136" },
      "math/0309136",
      false,
      true,
    ],
    // a shorter number is part of a longer one
    [
      "prefix of another ID",
      { extra: "arXiv:1501.01234" },
      "1501.0123",
      true,
      false,
    ],
  ])(
    "item with %s, asked %s: found %s before -> %s after",
    async (_name, fields: Record<string, string>, asked, _before, after) => {
      const item = lib.put({ fields });
      const found = await findItemsByArxivs([asked]);
      expect(ids(found.get(asked)).includes(item.id)).toBe(after);
    },
  );

  it("finds an item by an arXiv ID in any notation", async () => {
    const item = lib.put({ fields: { extra: "arXiv:math/0309136" } });
    const found = await findItemsByArxivs([
      "arXiv:math.GT/0309136v2",
      "https://arxiv.org/abs/math/0309136",
      "not an ID",
    ]);
    expect(ids(found.get("arXiv:math.GT/0309136v2"))).toEqual([item.id]);
    expect(ids(found.get("https://arxiv.org/abs/math/0309136"))).toEqual([
      item.id,
    ]);
    expect(found.has("not an ID")).toBe(false);
  });

  it("finds an item by each of the IDs in its fields", async () => {
    // INSPIRE lists two eprints for some papers
    const item = lib.put({
      fields: {
        extra: "arXiv:2301.12345 [hep-ph]",
        url: "https://arxiv.org/abs/2302.54321",
      },
    });
    const found = await findItemsByArxivs(["2301.12345", "2302.54321"]);
    expect(ids(found.get("2301.12345"))).toEqual([item.id]);
    expect(ids(found.get("2302.54321"))).toEqual([item.id]);
  });

  it("does not take a feed's items for papers in the library", async () => {
    // An arXiv RSS feed subscribed in Zotero
    lib.put({
      libraryID: FEED_LIBRARY,
      itemType: "preprint",
      fields: { url: "http://arxiv.org/abs/2301.12345v1", DOI: "10.1/feed" },
    });
    expect((await findItemsByArxivs(["2301.12345"])).size).toBe(0);
    expect((await findItemsByDOIs(["10.1/feed"])).size).toBe(0);
  });

  it("does not take attachments and notes for papers", async () => {
    lib.put({
      itemType: "attachment",
      fields: { url: "https://arxiv.org/pdf/2301.12345v1" },
    });
    lib.put({ itemType: "note", fields: { extra: "arXiv:2301.12345" } });
    expect((await findItemsByArxivs(["2301.12345"])).size).toBe(0);
  });

  // Intentional change: before, the item in the trash was found
  it("does not find an item in the trash", async () => {
    lib.put({ fields: { extra: "arXiv:2301.12345" }, deleted: true });
    expect((await findItemsByArxivs(["2301.12345"])).size).toBe(0);
  });

  // Intentional change: before, one of the two was given
  it("gives every item with the arXiv ID, those with a recid first", async () => {
    const a = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    const b = lib.put({ fields: pluginItem("100", "2301.12345") });
    const c = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    expect(
      ids((await findItemsByArxivs(["2301.12345"])).get("2301.12345")),
    ).toEqual([b.id, a.id, c.id]);
  });

  it("gives only the items of a library when asked", async () => {
    lib.put({ fields: { extra: "arXiv:2301.12345" } });
    const group = lib.put({
      libraryID: GROUP_LIBRARY,
      fields: { extra: "arXiv:2301.12345" },
    });
    const found = await findItemsByArxivs(["2301.12345"], GROUP_LIBRARY);
    expect(found.get("2301.12345")).toEqual([
      { itemID: group.id, libraryID: GROUP_LIBRARY, hasRecid: false },
    ]);
  });

  // Intentional change: before, a failed query gave no match
  it("rejects when the library cannot be read", async () => {
    lib.put({ fields: { extra: "arXiv:2301.12345" } });
    lib.queryError = new Error("database is locked");
    await expect(findItemsByArxivs(["2301.12345"])).rejects.toThrow(
      LibraryIndexError,
    );
  });
});

describe("findItemsByDOIs", () => {
  it("compares DOIs without regard to case", async () => {
    const items = {
      exact: lib.put({ fields: { DOI: "10.1103/PhysRevD.100.012345" } }),
      upper: lib.put({ fields: { DOI: "10.1103/PHYSREVD.100.054321" } }),
      group: lib.put({
        libraryID: GROUP_LIBRARY,
        fields: { DOI: "10.1007/JHEP01(2020)001" },
      }),
      spaced: lib.put({ fields: { DOI: " 10.1016/j.physletb.2020.135000" } }),
    };
    const found = await findItemsByDOIs([
      "10.1103/PhysRevD.100.012345",
      "10.1103/physrevd.100.054321",
      "10.1007/JHEP01(2020)001",
      "10.1016/j.physletb.2020.135000",
    ]);
    expect(labelsOf(items, [...found.values()].flatMap(ids))).toEqual([
      "exact",
      "group",
      "upper",
    ]);
    expect(ids(found.get("10.1103/physrevd.100.054321"))).toEqual([
      items.upper.id,
    ]);
  });

  // Intentional change: before, the item in the trash was found
  it("does not find an item in the trash", async () => {
    lib.put({ fields: { DOI: "10.1/x" }, deleted: true });
    expect((await findItemsByDOIs(["10.1/x"])).size).toBe(0);
  });

  // Intentional change: before, one of the two was given
  it("gives every item with the DOI", async () => {
    const a = lib.put({ fields: { DOI: "10.1/x" } });
    const b = lib.put({ fields: { DOI: "10.1/X" } });
    expect(ids((await findItemsByDOIs(["10.1/x"])).get("10.1/x"))).toEqual([
      a.id,
      b.id,
    ]);
  });

  // Intentional change: before, a failed query gave no match
  it("rejects when the library cannot be read", async () => {
    lib.put({ fields: { DOI: "10.1/x" } });
    lib.queryError = new Error("database is locked");
    await expect(findItemsByDOIs(["10.1/x"])).rejects.toThrow(
      LibraryIndexError,
    );
  });
});

describe("library index: following the library", () => {
  async function arxivHits(id: string) {
    return ids((await libraryLookup()).byArxiv(id));
  }

  it("reads the library once and answers later lookups from memory", async () => {
    lib.put({ fields: pluginItem("100", "2301.12345", "10.1/a") });
    await findItemsByRecids(["100"]);
    const queries = lib.queryCount;
    await findItemsByArxivs(["2301.12345"]);
    await findItemsByDOIs(["10.1/a"]);
    await findItemByRecid("100");
    expect(lib.queryCount).toBe(queries);
    expect(lib.observerCount).toBe(1);
  });

  it("has an added item once its save is over", async () => {
    await arxivHits("2301.12345");
    const item = await lib.add({ fields: pluginItem("100", "2301.12345") });
    expect(await arxivHits("2301.12345")).toEqual([item.id]);
    expect(ids((await libraryLookup()).byRecid("100"))).toEqual([item.id]);
  });

  it("follows edits of an item's identifiers", async () => {
    const item = lib.put({ fields: pluginItem("100", "2301.12345", "10.1/a") });
    await arxivHits("2301.12345");
    await lib.edit(item, {
      extra: "arXiv:2302.00001",
      archiveLocation: "200",
      DOI: "",
    });
    const lookup = await libraryLookup();
    expect(ids(lookup.byArxiv("2301.12345"))).toEqual([]);
    expect(ids(lookup.byArxiv("2302.00001"))).toEqual([item.id]);
    expect(ids(lookup.byRecid("100"))).toEqual([]);
    expect(ids(lookup.byRecid("200"))).toEqual([item.id]);
    expect(ids(lookup.byDOI("10.1/a"))).toEqual([]);
  });

  it("follows moves to and from the trash, and deletion", async () => {
    const item = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    expect(await arxivHits("2301.12345")).toEqual([item.id]);
    await lib.trash(item);
    expect(await arxivHits("2301.12345")).toEqual([]);
    await lib.restore(item);
    expect(await arxivHits("2301.12345")).toEqual([item.id]);
    await lib.erase(item);
    expect(await arxivHits("2301.12345")).toEqual([]);
  });

  it("forgets the items of a group library that is removed", async () => {
    const mine = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    lib.put({
      libraryID: GROUP_LIBRARY,
      fields: { extra: "arXiv:2301.12345" },
    });
    await arxivHits("2301.12345");
    await lib.removeGroup(GROUP_LIBRARY, 77);
    expect(await arxivHits("2301.12345")).toEqual([mine.id]);
  });

  it("keeps a change made while the library is first read", async () => {
    const edited = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    // The first query waits until the edit below is made
    const globals = (globalThis as any).Zotero;
    const query = globals.DB.queryAsync;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    globals.DB.queryAsync = async (sql: string, params?: unknown[]) => {
      const rows = await query(sql, params);
      if (first) {
        first = false;
        await held;
      }
      return rows;
    };
    const reading = arxivHits("2301.12345");
    await vi.waitFor(() => expect(first).toBe(false));
    const added = await lib.add({ fields: { extra: "arXiv:2302.00001" } });
    await lib.edit(edited, { extra: "arXiv:2303.00001" });
    release();
    expect(await reading).toEqual([]);
    expect(await arxivHits("2302.00001")).toEqual([added.id]);
    expect(await arxivHits("2303.00001")).toEqual([edited.id]);
  });

  it("reads the library again after a failed read", async () => {
    const item = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    lib.queryError = new Error("database is locked");
    await expect(arxivHits("2301.12345")).rejects.toThrow(LibraryIndexError);
    lib.queryError = undefined;
    expect(await arxivHits("2301.12345")).toEqual([item.id]);
  });

  it("says so when the library can be read again after a failed read", async () => {
    const item = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    const told: number[][] = [];
    const stop = onLibraryIndexChange((itemIDs) => told.push(itemIDs));
    lib.queryError = new Error("database is locked");
    await expect(arxivHits("2301.12345")).rejects.toThrow(LibraryIndexError);
    expect(told).toEqual([]);
    lib.queryError = undefined;
    // Papers shown as unknown elsewhere are looked up again
    expect(await arxivHits("2301.12345")).toEqual([item.id]);
    expect(told).toEqual([[]]);
    // Once only
    await arxivHits("2301.12345");
    expect(told).toEqual([[]]);
    stop();
  });

  it("is read again when an update fails, and says so", async () => {
    const item = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    await arxivHits("2301.12345");
    const told: number[][] = [];
    const stop = onLibraryIndexChange((itemIDs) => told.push(itemIDs));
    lib.queryError = new Error("database is locked");
    await lib.edit(item, { extra: "arXiv:2302.00001" });
    expect(told).toEqual([[]]);
    lib.queryError = undefined;
    expect(await arxivHits("2302.00001")).toEqual([item.id]);
    stop();
  });

  it("tells its listeners which items changed their identifiers", async () => {
    const item = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    await arxivHits("2301.12345");
    const told: number[][] = [];
    const stop = onLibraryIndexChange((itemIDs) => told.push(itemIDs));
    await lib.edit(item, { title: "A new title" });
    expect(told).toEqual([]);
    await lib.edit(item, { extra: "arXiv:2302.00001" });
    const added = await lib.add({ fields: { DOI: "10.1/b" } });
    await lib.trash(item);
    expect(told).toEqual([[item.id], [added.id], [item.id]]);
    stop();
    await lib.restore(item);
    expect(told).toHaveLength(3);
  });

  it("stops following the library when stopped", async () => {
    await arxivHits("2301.12345");
    expect(lib.observerCount).toBe(1);
    stopLibraryIndex();
    expect(lib.observerCount).toBe(0);
    const item = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    // Asked again, it reads the library anew
    expect(await arxivHits("2301.12345")).toEqual([item.id]);
  });
});
