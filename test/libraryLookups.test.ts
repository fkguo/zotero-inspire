// ─────────────────────────────────────────────────────────────────────────────
// Looking papers up in the library by INSPIRE recid, arXiv ID and DOI
//
// The lookups run on a small library in SQLite (fakeLibrary.ts) whose items
// have the field layouts found in real libraries: the plugin's (recid in
// Archive Location with Archive "INSPIRE", arXiv line in Extra), Zotero's
// arXiv translator (arXiv links in URL, Archive ID and DOI), items in the
// trash and in a group library.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findItemByRecid,
  findItemsByArxivs,
  findItemsByDOIs,
  findItemsByRecids,
} from "../src/modules/inspire/apiUtils";
import { FakeLibrary, GROUP_LIBRARY, type FakeItem } from "./fakeLibrary";

let lib: FakeLibrary;
beforeEach(() => {
  lib = new FakeLibrary();
  vi.stubGlobal("Zotero", lib.zoteroGlobals());
});
afterEach(() => vi.unstubAllGlobals());

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

/** Item labels of the IDs a lookup gave, for readable expectations */
function labelsOf(
  items: Record<string, FakeItem>,
  ids: Iterable<number>,
): string[] {
  const byID = new Map(Object.entries(items).map(([k, v]) => [v.id, k]));
  return [...ids].map((id) => byID.get(id) ?? `#${id}`).sort();
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

  it.each([
    ["Archive empty", { archiveLocation: "1234567" }, true],
    [
      "Archive a shelf name",
      { archive: "Library shelf", archiveLocation: "1234567" },
      true,
    ],
    [
      "only an INSPIRE URL",
      { url: "https://inspirehep.net/literature/1234567" },
      false,
    ],
  ])(
    "with %s: found %s",
    async (_name, fields: Record<string, string>, before) => {
      const item = lib.put({ fields });
      const found = await findItemByRecid("1234567");
      expect(found ? found.id === item.id : false).toBe(before);
    },
  );

  it("finds an item in the trash", async () => {
    const item = lib.put({ fields: pluginItem("1234567"), deleted: true });
    expect((await findItemByRecid("1234567"))?.id).toBe(item.id);
  });

  it("gives one of two items with the same recid", async () => {
    const a = lib.put({ fields: pluginItem("1234567") });
    const b = lib.put({ fields: pluginItem("1234567") });
    expect([a.id, b.id]).toContain((await findItemByRecid("1234567"))?.id);
  });

  it("rejects when the database query fails", async () => {
    lib.put({ fields: pluginItem("1234567") });
    lib.queryError = new Error("database is locked");
    await expect(findItemByRecid("1234567")).rejects.toThrow();
  });
});

describe("findItemsByRecids", () => {
  it("maps each recid found to an item, by Archive Location or INSPIRE URL", async () => {
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
      "100": items.plugin.id,
      "200": items.group.id,
      "300": items.url.id,
      "400": items.urlWww.id,
    });
  });

  it.each([
    ["Archive empty", { archiveLocation: "100" }, true],
    [
      "Archive a shelf name",
      { archive: "Shelf", archiveLocation: "100" },
      true,
    ],
    ["API URL", { url: "https://inspirehep.net/api/literature/100" }, false],
    ["legacy record URL", { url: "http://inspirehep.net/record/100" }, false],
    [
      "URL on a lookalike host",
      { url: "https://notinspirehep.net/literature/100" },
      true,
    ],
    [
      "URL with an INSPIRE link in its query",
      {
        url: "https://example.org/?next=https://inspirehep.net/literature/100",
      },
      true,
    ],
  ])(
    "with %s: found %s",
    async (_name, fields: Record<string, string>, before) => {
      const item = lib.put({ fields });
      const found = await findItemsByRecids(["100"]);
      expect(found.get("100") === item.id).toBe(before);
    },
  );

  it("finds an item in the trash", async () => {
    const item = lib.put({ fields: pluginItem("100"), deleted: true });
    expect((await findItemsByRecids(["100"])).get("100")).toBe(item.id);
  });

  it("gives one of two items with the same recid", async () => {
    const a = lib.put({ fields: pluginItem("100") });
    const b = lib.put({ fields: pluginItem("100") });
    const found = await findItemsByRecids(["100"]);
    expect([a.id, b.id]).toContain(found.get("100"));
  });

  it("gives no match when the database query fails", async () => {
    lib.put({ fields: pluginItem("100") });
    lib.queryError = new Error("database is locked");
    expect((await findItemsByRecids(["100"])).size).toBe(0);
  });
});

describe("findItemsByArxivs", () => {
  it("maps each arXiv ID found in Extra to an item", async () => {
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
    expect(Object.fromEntries(found)).toEqual({
      "2301.12345": items.extra.id,
      "2302.00001": items.eprint.id,
      "hep-ph/0101001": items.old.id,
      "2303.00002": items.versioned.id,
      "2304.00003": items.group.id,
    });
  });

  it.each([
    // Zotero's arXiv translator layout
    [
      "URL, Archive ID and DOI",
      translatorItem("2301.12345"),
      "2301.12345",
      false,
    ],
    [
      "URL only",
      { url: "https://arxiv.org/abs/2301.12345v2" },
      "2301.12345",
      false,
    ],
    [
      "Journal Abbr",
      { journalAbbreviation: "arXiv:2301.12345 [hep-ph]" },
      "2301.12345",
      false,
    ],
    [
      "space after the colon",
      { extra: "arXiv: 2301.12345" },
      "2301.12345",
      false,
    ],
    // an ID mentioned inside a line, not an arXiv line
    [
      "ID inside a line",
      { extra: "Comment: see arXiv:2301.12345" },
      "2301.12345",
      true,
    ],
    // subject class in the item, canonical ID asked
    [
      "subject class in Extra",
      { extra: "arXiv:math.GT/0309136" },
      "math/0309136",
      false,
    ],
    // a shorter number is part of a longer one
    ["prefix of another ID", { extra: "arXiv:1501.01234" }, "1501.0123", true],
  ])(
    "item with %s, asked %s: found %s",
    async (_name, fields: Record<string, string>, asked, before) => {
      const item = lib.put({ fields });
      const found = await findItemsByArxivs([asked]);
      expect(found.get(asked) === item.id).toBe(before);
    },
  );

  it("finds an item in the trash", async () => {
    const item = lib.put({
      fields: { extra: "arXiv:2301.12345" },
      deleted: true,
    });
    expect((await findItemsByArxivs(["2301.12345"])).get("2301.12345")).toBe(
      item.id,
    );
  });

  it("gives one of two items with the same arXiv ID", async () => {
    const a = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    const b = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    const found = await findItemsByArxivs(["2301.12345"]);
    expect([a.id, b.id]).toContain(found.get("2301.12345"));
  });

  it("gives no match when the database query fails", async () => {
    lib.put({ fields: { extra: "arXiv:2301.12345" } });
    lib.queryError = new Error("database is locked");
    expect((await findItemsByArxivs(["2301.12345"])).size).toBe(0);
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
    expect(labelsOf(items, found.values())).toEqual([
      "exact",
      "group",
      "upper",
    ]);
    expect(found.get("10.1103/physrevd.100.054321")).toBe(items.upper.id);
  });

  it("finds an item in the trash", async () => {
    const item = lib.put({ fields: { DOI: "10.1/x" }, deleted: true });
    expect((await findItemsByDOIs(["10.1/x"])).get("10.1/x")).toBe(item.id);
  });

  it("gives one of two items with the same DOI", async () => {
    const a = lib.put({ fields: { DOI: "10.1/x" } });
    const b = lib.put({ fields: { DOI: "10.1/X" } });
    const found = await findItemsByDOIs(["10.1/x"]);
    expect([a.id, b.id]).toContain(found.get("10.1/x"));
  });

  it("gives no match when the database query fails", async () => {
    lib.put({ fields: { DOI: "10.1/x" } });
    lib.queryError = new Error("database is locked");
    expect((await findItemsByDOIs(["10.1/x"])).size).toBe(0);
  });
});
