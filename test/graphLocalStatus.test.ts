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
import {
  LibraryIndexError,
  stopLibraryIndex,
} from "../src/modules/inspire/library/arxivIndex";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { FakeLibrary, GROUP_LIBRARY } from "./fakeLibrary";

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
afterEach(() => {
  stopLibraryIndex();
  vi.unstubAllGlobals();
});

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

  // Intentional change: before, an item in the trash counted, and a mark
  // the cached graph had was kept (77, an item since deleted)
  it("leaves out items in the trash and recomputes earlier marks", async () => {
    const refs = [entry("100"), entry("200", { localItemID: 77 })];
    const seed = cachedGraph(refs);
    lib.put({ fields: pluginFields("100"), deleted: true });
    const graph = await getCachedCitationGraphOneHop(seed);
    expect(graph?.references.map((e) => e.localItemID)).toEqual([
      undefined,
      undefined,
    ]);
  });

  // Intentional change: before, a number in Archive Location counted under
  // any Archive, and an INSPIRE URL did not count
  it("marks by the recid resolveItemRecid reads", async () => {
    const refs = [entry("100"), entry("200")];
    const seed = cachedGraph(refs);
    lib.put({ fields: { archive: "Shelf", archiveLocation: "100" } });
    const byURL = lib.put({
      fields: { url: "https://inspirehep.net/literature/200" },
    });
    const graph = await getCachedCitationGraphOneHop(seed);
    expect(graph?.references.map((e) => e.localItemID)).toEqual([
      undefined,
      byURL.id,
    ]);
  });

  it("lists every item with a paper's recid", async () => {
    const refs = [entry("100")];
    const seed = cachedGraph(refs);
    const a = lib.put({ fields: pluginFields("100") });
    const b = lib.put({ fields: pluginFields("100") });
    const graph = await getCachedCitationGraphOneHop(seed);
    expect(graph?.references[0]).toMatchObject({
      localItemID: a.id,
      localItemIDs: [a.id, b.id],
    });
  });

  // Intentional change: before, a failed lookup left the papers shown as not
  // in the library
  it("marks the papers unknown when the library cannot be read", async () => {
    const refs = [entry("100")];
    const seed = cachedGraph(refs);
    lib.put({ fields: pluginFields("100") });
    lib.queryError = new Error("database is locked");
    const graph = await getCachedCitationGraphOneHop(seed);
    expect(graph?.references[0].localItemID).toBeUndefined();
    expect(graph?.references[0].localStatusUnknown).toBe(true);
    expect(graph?.center.localStatusUnknown).toBe(true);
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

  // Intentional change: before, the item in the trash was taken as the
  // paper's item and nothing was added
  it("adds a paper whose only item is in the trash", async () => {
    lib.put({ fields: pluginFields("100"), deleted: true });
    const dialog = graphDialog();
    const e = entry("100");
    await dialog.importEntryToLibrary(e);
    expect(e.localItemID).toBeUndefined();
    expect(dialog.promptForSaveTarget).toHaveBeenCalled();
  });

  // Intentional change: before, a failed lookup was taken for "not in the
  // library" and the paper was added
  it("adds nothing and says so when the library cannot be read", async () => {
    lib.put({ fields: pluginFields("100") });
    lib.queryError = new Error("database is locked");
    const dialog = graphDialog();
    await dialog.importEntryToLibrary(entry("100"));
    expect(dialog.promptForSaveTarget).not.toHaveBeenCalled();
    expect(toasts).toEqual([
      "zoteroinspire-references-panel-library-lookup-failed-add",
    ]);
  });

  it("selects the paper's item on a click on its node", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const dialog = graphDialog();
    await dialog.handleNodeClick("100", { ctrlKey: false, metaKey: false });
    expect(selected).toEqual([[item.id]]);
  });

  // Intentional change: before, the item in the trash was selected
  it("says a paper whose only item is in the trash is not in the library", async () => {
    lib.put({ fields: pluginFields("100"), deleted: true });
    const dialog = graphDialog();
    await dialog.handleNodeClick("100", { ctrlKey: false, metaKey: false });
    expect(selected).toEqual([]);
    expect(toasts).toEqual([
      'zoteroinspire-references-panel-citation-graph-not-in-library {"title":"100"}',
    ]);
  });

  // Intentional change: before, the click did nothing (the lookup's failure
  // went unhandled)
  it("says so on a click when the library cannot be read", async () => {
    lib.put({ fields: pluginFields("100") });
    lib.queryError = new Error("database is locked");
    const dialog = graphDialog();
    await dialog.handleNodeClick("100", { ctrlKey: false, metaKey: false });
    expect(selected).toEqual([]);
    expect(toasts).toEqual([
      "zoteroinspire-references-panel-library-lookup-failed",
    ]);
  });

  it("selects an item of a library whose items are not loaded yet", async () => {
    const item = lib.put({
      libraryID: GROUP_LIBRARY,
      fields: pluginFields("100"),
    });
    lib.unloadedLibraries.add(GROUP_LIBRARY);
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

describe("citation graph dialog: following the library", () => {
  function graphShown(references: InspireReferenceEntry[]) {
    const dialog = graphDialog();
    const graph = {
      seeds: [{ recid: "1", title: "Seed", inspireUrl: "", isSeed: true }],
      seedEdges: [],
      references,
      citedBy: [],
      totals: { references: references.length, citedBy: 0 },
      shown: { references: references.length, citedBy: 0 },
      sort: "mostrecent",
    };
    Object.assign(dialog, {
      graphResult: graph,
      updateHeader: vi.fn(),
      renderGraph: vi.fn(),
    });
    dialog.followLibrary();
    return { dialog, graph };
  }

  // Intentional change: before, the graph's marks were read once, when it
  // was built
  it("draws the graph again when a paper's item goes to the trash or is added", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const refs = [entry("100"), entry("200")];
    const { dialog, graph } = graphShown(refs);
    await dialog.refreshLocalMarks();
    expect(refs[0].localItemID).toBe(item.id);
    expect(dialog.renderGraph).toHaveBeenCalledTimes(1);

    await lib.trash(item);
    await vi.waitFor(() => expect(dialog.renderGraph).toHaveBeenCalledTimes(2));
    expect(refs[0].localItemID).toBeUndefined();
    expect(dialog.renderGraph).toHaveBeenLastCalledWith(graph);

    const added = await lib.add({ fields: pluginFields("200") });
    await vi.waitFor(() => expect(dialog.renderGraph).toHaveBeenCalledTimes(3));
    expect(refs[1].localItemID).toBe(added.id);

    // A change that no mark depends on draws nothing
    await lib.edit(added, { title: "New title" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog.renderGraph).toHaveBeenCalledTimes(3);
    dialog.stopFollowingLibrary();
  });

  it("marks every node again once a click on a node reads the library", async () => {
    const a = lib.put({ fields: pluginFields("100") });
    const b = lib.put({ fields: pluginFields("100") });
    const refs = [entry("100"), entry("200")];
    const { dialog } = graphShown(refs);
    lib.queryError = new Error("database is locked");
    await dialog.refreshLocalMarks();
    expect(refs.map((e) => e.localStatusUnknown)).toEqual([true, true]);
    expect(dialog.renderGraph).toHaveBeenCalledTimes(1);

    lib.queryError = undefined;
    await dialog.handleNodeClick("200", { ctrlKey: false, metaKey: false });
    await vi.waitFor(() => expect(dialog.renderGraph).toHaveBeenCalledTimes(2));
    expect(refs[0]).toEqual(
      entry("100", { localItemID: a.id, localItemIDs: [a.id, b.id] }),
    );
    expect(refs[1]).toEqual(entry("200"));
    dialog.stopFollowingLibrary();
  });

  it("gives a paper found when it is added every item, once the library can be read", async () => {
    const a = lib.put({ fields: pluginFields("100") });
    const b = lib.put({ fields: pluginFields("100") });
    const refs = [entry("100")];
    const { dialog } = graphShown(refs);
    lib.queryError = new Error("database is locked");
    await dialog.refreshLocalMarks();
    expect(refs[0].localStatusUnknown).toBe(true);

    lib.queryError = undefined;
    await dialog.importEntryToLibrary(refs[0]);
    expect(dialog.promptForSaveTarget).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(refs[0].localStatusUnknown).toBeUndefined());
    expect(refs[0]).toEqual(
      entry("100", { localItemID: a.id, localItemIDs: [a.id, b.id] }),
    );
    dialog.stopFollowingLibrary();
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

  // Intentional changes: items in the trash are no duplicates, and every
  // field that holds an arXiv ID is read
  it.each([
    ["an item in the trash", "recid", null, { ...pluginFields("100") }, true],
    [
      "an arXiv ID only in the URL",
      null,
      "arxiv",
      { url: "https://arxiv.org/abs/2301.12345" },
      false,
    ],
  ])(
    "with %s: duplicate by %s before -> %s after",
    async (_name, _before, after, fields: Record<string, string>, deleted) => {
      const item = lib.put({ fields, deleted });
      const m = manager();
      const duplicates = await (m as any).detectDuplicates([
        entry("100", { arxivDetails: { id: "2301.12345" } }),
      ]);
      expect(duplicates.get("e100")?.matchType ?? null).toBe(after);
      if (after) expect(duplicates.get("e100")?.localItemID).toBe(item.id);
      m.dispose();
    },
  );

  it("gives the first of several items with a paper's identifier", async () => {
    const withoutRecid = lib.put({ fields: { extra: "arXiv:2301.12345" } });
    const withRecid = lib.put({ fields: pluginFields("999") });
    await lib.edit(withRecid, { extra: "arXiv:2301.12345" });
    const m = manager();
    const duplicates = await (m as any).detectDuplicates([
      entry("100", { arxivDetails: { id: "2301.12345" } }),
    ]);
    // The item with a recid comes first
    expect(duplicates.get("e100")).toEqual({
      localItemID: withRecid.id,
      matchType: "arxiv",
    });
    expect(withoutRecid.id).toBeLessThan(withRecid.id);
    m.dispose();
  });

  // Intentional change: before, a failed lookup gave no duplicates and every
  // selected paper was imported
  it("imports nothing and says so when the library cannot be read", async () => {
    lib.put({ fields: pluginFields("100") });
    lib.queryError = new Error("database is locked");
    const entries = [entry("100"), entry("200")];
    const notify = vi.fn();
    const importReference = vi.fn();
    const promptForSaveTarget = vi.fn();
    const m = new BatchImportManager({
      getDocument: () => ({}) as Document,
      getBody: () => ({}) as HTMLElement,
      getListElement: () => ({ querySelectorAll: () => [] }) as any,
      getAllEntries: () => entries,
      getFilteredEntries: () => entries,
      importReference,
      promptForSaveTarget,
      reporter: { notify, startProgress: vi.fn() as any },
      updateRowStatus: vi.fn(),
    });
    await expect((m as any).detectDuplicates(entries)).rejects.toThrow(
      LibraryIndexError,
    );
    m.selectAll();
    expect(await m.handleBatchImport({} as HTMLElement)).toBeNull();
    expect(notify).toHaveBeenCalledWith(
      "zoteroinspire-references-panel-batch-duplicate-check-failed",
    );
    expect(promptForSaveTarget).not.toHaveBeenCalled();
    expect(importReference).not.toHaveBeenCalled();
    m.dispose();
  });
});
