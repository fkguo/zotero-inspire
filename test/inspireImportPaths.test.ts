// ─────────────────────────────────────────────────────────────────────────────
// Adding a paper from its INSPIRE record, as the References panel and the
// citation graph do it: the new item's type, library, collections, tags,
// INSPIRE fields and child note, saved without being selected. These tests
// pass before and after the two copies were merged into one function
// (library/itemCreation.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMeta: vi.fn(),
  setInspireMeta: vi.fn(),
}));

vi.mock("../src/modules/inspire/metadataService", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchInspireMetaByRecid: mocks.fetchMeta,
}));
vi.mock("../src/modules/inspire/itemUpdater", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setInspireMeta: mocks.setInspireMeta,
  getItemTypePolicy: () => ({ keepPreprintType: true }),
  saveItemWithPendingInspireNote: (item: any, options: unknown) =>
    item.saveTx(options),
}));
vi.mock("../src/utils/locale", () => ({ getString: (key: string) => key }));
vi.mock("../src/utils/prefs", () => ({
  getPref: () => undefined,
  setPref: () => undefined,
}));

import { InspireReferencePanelController } from "../src/modules/zinspire";
import { CitationGraphDialog } from "../src/modules/inspire/panel/CitationGraphDialog";
import { stopLibraryIndex } from "../src/modules/inspire/library/arxivIndex";
import { FakeLibrary } from "./fakeLibrary";
import { FakeNewItem, installFakeNewItems } from "./fakeNewItem";

/** An unpublished arXiv paper's record, as fetchInspireMetaByRecid gives it */
const META = {
  recid: 2800001,
  title: "A paper",
  arxiv: { value: "2609.28544", categories: ["hep-ph"] },
  document_type: ["article"],
};

const TARGET = {
  libraryID: 2,
  collectionIDs: [7, 7, 9],
  tags: ["to-read", "hep"],
  note: "<p>Read this</p>",
  primaryRowID: "C7",
};

let lib: FakeLibrary;
let toasts: string[];
let prefs: Record<string, unknown>;

beforeEach(() => {
  lib = new FakeLibrary();
  toasts = [];
  prefs = {};
  vi.stubGlobal("Zotero", {
    ...lib.zoteroGlobals(),
    Prefs: {
      get: (key: string) => prefs[key],
      set: (key: string, value: unknown) => {
        prefs[key] = value;
      },
      clear: (key: string) => delete prefs[key],
    },
    // Read (unused) by the panel's copy before the merge
    getActiveZoteroPane: () => null,
  });
  installFakeNewItems();
  mocks.fetchMeta.mockReset().mockResolvedValue(META);
  mocks.setInspireMeta.mockReset().mockImplementation(async (item: any) => {
    item.setField("archive", "INSPIRE");
    item.setField("archiveLocation", String(META.recid));
  });
});

afterEach(() => {
  stopLibraryIndex();
  vi.unstubAllGlobals();
});

/** The paper's item and child note as saved */
function expectSavedPaper(item: FakeNewItem) {
  expect(item).toMatchObject({
    itemType: "preprint",
    libraryID: 2,
    collections: [7, 9],
    tags: ["to-read", "hep"],
    saves: [{ skipSelect: true }],
  });
  expect(item.fields).toMatchObject({
    extra: "",
    archive: "INSPIRE",
    archiveLocation: "2800001",
  });
  expect(mocks.setInspireMeta).toHaveBeenCalledWith(item, META, "full");
  const [note] = FakeNewItem.created.filter((i) => i.itemType === "note");
  expect(note).toMatchObject({
    noteText: "<p>Read this</p>",
    parentID: item.id,
    libraryID: 2,
    saves: [{ skipSelect: true }],
  });
}

describe("adding a paper from the References panel", () => {
  function panel() {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const shown = lib.put({ fields: { title: "The paper read" } });
    Object.assign(controller, {
      currentItemID: shown.id,
      captureScrollState: () => ({ scrollTop: 0, scrollLeft: 0 }),
      restoreScrollPositionIfNeeded: vi.fn(),
      showToast: (text: string) => toasts.push(text),
    });
    return controller;
  }

  it("creates the item in the chosen library and collections, with tags, INSPIRE fields and note", async () => {
    const controller = panel();
    const item = await controller.importReference("2800001", TARGET);
    expect(mocks.fetchMeta.mock.calls[0][0]).toBe("2800001");
    expectSavedPaper(item);
    // The target used, first among the recent ones
    expect(prefs.recentSaveTargets).toBe(JSON.stringify([{ id: "C7" }]));
    expect(toasts).toEqual(["references-panel-toast-added"]);
  });

  it("saves nothing, and says nothing, when a batch import is cancelled while INSPIRE is asked", async () => {
    const controller = new AbortController();
    // A cancel ends the request: fetchInspireMetaByRecid then gives -1
    mocks.fetchMeta.mockImplementation(
      async (_recid: string, signal: AbortSignal) => {
        controller.abort();
        return signal?.aborted ? -1 : { recid: "2800001" };
      },
    );
    const item = await panel().importReference(
      "2800001",
      TARGET,
      controller.signal,
    );
    expect(mocks.fetchMeta.mock.calls[0][1]).toBe(controller.signal);
    expect(item).toBeNull();
    expect(FakeNewItem.created).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it("adds nothing when INSPIRE gives no record", async () => {
    mocks.fetchMeta.mockResolvedValue(-1);
    const item = await panel().importReference("2800001", TARGET);
    expect(item).toBeNull();
    expect(FakeNewItem.created).toEqual([]);
    expect(toasts).toEqual(["references-panel-toast-missing"]);
  });
});

describe("adding a paper from the citation graph", () => {
  function graph() {
    const dialog = Object.create(CitationGraphDialog.prototype) as any;
    Object.assign(dialog, {
      disposed: false,
      graphResult: undefined,
      entryByRecid: new Map(),
      nodeLabelByRecid: new Map(),
      promptForSaveTarget: vi.fn(async () => TARGET),
      showToast: (text: string) => toasts.push(text),
    });
    return dialog;
  }

  it("creates the item in the chosen library and collections, with tags, INSPIRE fields and note", async () => {
    const entry: any = { id: "e1", recid: "2800001", title: "A paper" };
    await graph().importEntryToLibrary(entry);
    const [item] = FakeNewItem.created;
    expect(mocks.fetchMeta.mock.calls[0][0]).toBe("2800001");
    expectSavedPaper(item);
    expect(entry.localItemID).toBe(item.id);
    expect(toasts).toEqual(["references-panel-toast-added"]);
  });

  it("adds nothing when INSPIRE gives no record", async () => {
    mocks.fetchMeta.mockResolvedValue(-1);
    const entry: any = { id: "e1", recid: "2800001", title: "A paper" };
    await graph().importEntryToLibrary(entry);
    expect(FakeNewItem.created).toEqual([]);
    expect(entry.localItemID).toBeUndefined();
    expect(toasts).toEqual(["references-panel-toast-missing"]);
  });
});
