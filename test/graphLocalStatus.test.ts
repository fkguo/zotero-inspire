// ─────────────────────────────────────────────────────────────────────────────
// "In library" state in the citation graph and the batch import's duplicate
// check, on a small library in SQLite (fakeLibrary.ts)
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ graphs: new Map<string, unknown>() }));
vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: {
    get: vi.fn(async (type: string, key: string) =>
      type === "citation_graph" && cache.graphs.has(key)
        ? { data: cache.graphs.get(key), fromCache: true, ageHours: 0 }
        : null,
    ),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  },
}));

import { getCachedCitationGraphOneHop } from "../src/modules/inspire/citationGraphService";
import { CitationGraphDialog } from "../src/modules/inspire/panel/CitationGraphDialog";
import { BatchImportManager } from "../src/modules/inspire/panel/BatchImportManager";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { FakeLibrary } from "./fakeLibrary";

let lib: FakeLibrary;
let toasts: string[];
let selected: number[][];
beforeEach(() => {
  lib = new FakeLibrary();
  toasts = [];
  selected = [];
  vi.stubGlobal("Zotero", {
    ...lib.zoteroGlobals(),
    Prefs: { get: () => undefined },
    getActiveZoteroPane: () => ({
      selectItems: async (ids: number[]) => {
        selected.push(ids);
        return true;
      },
    }),
    ProgressWindow: class {
      changeHeadline() {}
      addDescription(text: string) {
        toasts.push(text);
      }
      show() {}
      close() {}
    },
  });
  vi.stubGlobal("addon", {
    data: {
      alive: true,
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

function entry(
  recid: string,
  fields: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id: `e${recid}`,
    recid,
    title: `Paper ${recid}`,
    year: "2024",
    authors: [],
    authorText: "",
    displayText: "",
    searchText: "",
    ...fields,
  };
}

function pluginFields(recid: string): Record<string, string> {
  return { archive: "INSPIRE", archiveLocation: recid };
}

let nextSeed = 1;
/** A citation graph kept in the local cache, as a graph opened before */
function cachedGraph(references: InspireReferenceEntry[]) {
  const seed = `${900000 + nextSeed++}`;
  cache.graphs.set(seed, {
    center: { recid: seed, title: "Seed", inspireUrl: "", isSeed: true },
    references,
    citedBy: [],
    totals: { references: references.length, citedBy: 0 },
    shown: { references: references.length, citedBy: 0 },
    sort: "mostrecent",
  });
  return seed;
}

describe("citation graph: in-library state of a cached graph", () => {
  it("marks the seed and the papers whose recid an item has", async () => {
    const refs = [entry("100"), entry("200")];
    const seed = cachedGraph(refs);
    const seedItem = lib.put({ fields: pluginFields(seed) });
    const item = lib.put({ fields: pluginFields("100") });
    const graph = await getCachedCitationGraphOneHop(seed);
    expect(graph?.center.localItemID).toBe(seedItem.id);
    expect(graph?.references.map((e) => e.localItemID)).toEqual([
      item.id,
      undefined,
    ]);
  });

  it("counts an item in the trash, and keeps a paper's earlier mark", async () => {
    const refs = [entry("100"), entry("200", { localItemID: 77 })];
    const seed = cachedGraph(refs);
    const trashed = lib.put({ fields: pluginFields("100"), deleted: true });
    const graph = await getCachedCitationGraphOneHop(seed);
    expect(graph?.references.map((e) => e.localItemID)).toEqual([
      trashed.id,
      77,
    ]);
  });

  it("marks by a number in Archive Location whatever the Archive", async () => {
    const refs = [entry("100")];
    const seed = cachedGraph(refs);
    const item = lib.put({
      fields: { archive: "Shelf", archiveLocation: "100" },
    });
    const graph = await getCachedCitationGraphOneHop(seed);
    expect(graph?.references[0].localItemID).toBe(item.id);
  });

  it("shows papers as not in the library when the lookup fails", async () => {
    const refs = [entry("100")];
    const seed = cachedGraph(refs);
    lib.put({ fields: pluginFields("100") });
    lib.queryError = new Error("database is locked");
    const graph = await getCachedCitationGraphOneHop(seed);
    expect(graph?.references[0].localItemID).toBeUndefined();
  });
});

/** A citation graph dialog reduced to what adding and clicking a node use */
function graphDialog() {
  const dialog = Object.create(CitationGraphDialog.prototype) as any;
  Object.assign(dialog, {
    disposed: false,
    graphResult: undefined,
    entryByRecid: new Map(),
    nodeLabelByRecid: new Map(),
    promptForSaveTarget: vi.fn(async () => null),
    dispose: vi.fn(),
  });
  return dialog;
}

describe("citation graph: adding a paper and clicking a node", () => {
  it("does not add a paper whose recid an item has", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const dialog = graphDialog();
    const e = entry("100");
    await dialog.importEntryToLibrary(e);
    expect(e.localItemID).toBe(item.id);
    expect(dialog.promptForSaveTarget).not.toHaveBeenCalled();
  });

  it("takes an item in the trash as the paper's item", async () => {
    const item = lib.put({ fields: pluginFields("100"), deleted: true });
    const dialog = graphDialog();
    const e = entry("100");
    await dialog.importEntryToLibrary(e);
    expect(e.localItemID).toBe(item.id);
    expect(dialog.promptForSaveTarget).not.toHaveBeenCalled();
  });

  it("goes on to add the paper when the lookup fails", async () => {
    lib.put({ fields: pluginFields("100") });
    lib.queryError = new Error("database is locked");
    const dialog = graphDialog();
    await dialog.importEntryToLibrary(entry("100"));
    expect(dialog.promptForSaveTarget).toHaveBeenCalled();
  });

  it("selects the paper's item on a click on its node", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const dialog = graphDialog();
    await dialog.handleNodeClick("100", { ctrlKey: false, metaKey: false });
    expect(selected).toEqual([[item.id]]);
  });

  it("selects an item in the trash on a click on its node", async () => {
    const item = lib.put({ fields: pluginFields("100"), deleted: true });
    const dialog = graphDialog();
    await dialog.handleNodeClick("100", { ctrlKey: false, metaKey: false });
    expect(selected).toEqual([[item.id]]);
  });

  it("says a paper without an item is not in the library", async () => {
    const dialog = graphDialog();
    await dialog.handleNodeClick("100", { ctrlKey: false, metaKey: false });
    expect(selected).toEqual([]);
    expect(toasts).toEqual([
      'zoteroinspire-references-panel-citation-graph-not-in-library {"title":"100"}',
    ]);
  });
});

describe("batch import: duplicate check against the library", () => {
  function manager() {
    return new BatchImportManager({
      getDocument: () => ({}) as Document,
      getBody: () => ({}) as HTMLElement,
      getListElement: () => ({}) as HTMLElement,
      getAllEntries: () => [],
      getFilteredEntries: () => [],
      importReference: vi.fn(),
      promptForSaveTarget: vi.fn(),
      reporter: { notify: vi.fn(), startProgress: vi.fn() as any },
      updateRowStatus: vi.fn(),
    });
  }

  it("finds items by recid, arXiv ID and DOI", async () => {
    const byRecid = lib.put({ fields: pluginFields("100") });
    const byArxiv = lib.put({ fields: { extra: "arXiv:2302.00002" } });
    const byDOI = lib.put({ fields: { DOI: "10.1/C" } });
    const m = manager();
    const duplicates = await (m as any).detectDuplicates([
      entry("100"),
      entry("200", { arxivDetails: { id: "2302.00002" } }),
      entry("300", { doi: "10.1/c" }),
      entry("400", { arxivDetails: { id: "2304.00004" }, doi: "10.1/d" }),
    ]);
    expect(Object.fromEntries(duplicates)).toEqual({
      e100: { localItemID: byRecid.id, matchType: "recid" },
      e200: { localItemID: byArxiv.id, matchType: "arxiv" },
      e300: { localItemID: byDOI.id, matchType: "doi" },
    });
    m.dispose();
  });

  it.each([
    ["an item in the trash", { ...pluginFields("100") }, true, "recid"],
    [
      "an arXiv ID only in the URL",
      { url: "https://arxiv.org/abs/2301.12345" },
      false,
      null,
    ],
  ])(
    "with %s: duplicate %s",
    async (_name, fields: Record<string, string>, deleted, before) => {
      const item = lib.put({ fields, deleted });
      const m = manager();
      const duplicates = await (m as any).detectDuplicates([
        entry("100", { arxivDetails: { id: "2301.12345" } }),
      ]);
      expect(duplicates.get("e100")?.matchType ?? null).toBe(before);
      if (before) expect(duplicates.get("e100")?.localItemID).toBe(item.id);
      m.dispose();
    },
  );

  it("reports no duplicates when the lookup fails", async () => {
    lib.put({ fields: pluginFields("100") });
    lib.queryError = new Error("database is locked");
    const m = manager();
    const duplicates = await (m as any).detectDuplicates([entry("100")]);
    expect(duplicates.size).toBe(0);
    m.dispose();
  });
});
