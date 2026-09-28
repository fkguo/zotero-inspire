// ─────────────────────────────────────────────────────────────────────────────
// Cancelling a metadata update while another one starts: a cancelled run
// stays cancelled (its items are not updated, it reports only its own
// numbers), Escape and "Cancel update" keep working for the runs that are
// still going, and two runs that nobody cancels both go through all their
// items, each with its own progress popup and final notice. The same holds
// across kinds of runs (metadata update, reference-cache download, preprint
// check). INSPIRE answers are held until the test releases them, which
// stands for a request that waits, e.g. in a 429 backoff.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

const mocks = vi.hoisted(() => ({
  getInspireMeta: vi.fn(),
  fetchReferencesEntries: vi.fn(),
  cacheSet: vi.fn(),
  batchCheckPublicationStatus: vi.fn(),
  prefs: new Map<string, unknown>(),
  popupEscape: [] as Array<() => void>,
}));

/** The plugin toolkit's ProgressWindowHelper, as far as the runs use it */
const { FakeProgressWindow } = vi.hoisted(() => {
  class FakeProgressWindow {
    static all: FakeProgressWindow[] = [];
    headline = "";
    lines: string[] = [];
    closed = false;
    win = {
      changeHeadline: (headline: string) => this.changeHeadline(headline),
    };
    constructor(
      public header: string,
      public options: { run?: boolean } = {},
    ) {
      FakeProgressWindow.all.push(this);
    }
    changeHeadline(headline: string) {
      this.headline = headline;
      return this;
    }
    createLine({ text }: { text?: string }) {
      if (text !== undefined) this.lines.push(text);
      return this;
    }
    changeLine({ text }: { text?: string }) {
      if (text !== undefined) this.lines.push(text);
      return this;
    }
    show() {
      return this;
    }
    startCloseTimer() {
      return this;
    }
    close() {
      this.closed = true;
      return this;
    }
    get text() {
      return this.lines.at(-1);
    }
  }
  return { FakeProgressWindow };
});
vi.mock("zotero-plugin-toolkit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("zotero-plugin-toolkit")>()),
  ProgressWindowHelper: FakeProgressWindow,
}));
vi.mock("../src/modules/inspire/metadataService", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/inspire/metadataService")
  >()),
  getInspireMeta: mocks.getInspireMeta,
}));
vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: {
    getCacheDir: async () => "/cache",
    isEnabled: () => true,
    set: mocks.cacheSet,
  },
}));
vi.mock("../src/modules/inspire/referencesService", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/inspire/referencesService")
  >()),
  fetchReferencesEntries: mocks.fetchReferencesEntries,
  enrichReferencesEntries: async () => ({ complete: true, failedRecids: [] }),
}));
vi.mock("../src/modules/inspire/apiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/inspire/apiUtils")>()),
  // The test papers' recid is their item ID
  deriveRecidFromItem: (item: Zotero.Item) => String(item.id),
}));
vi.mock(
  "../src/modules/inspire/preprintWatchService",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/modules/inspire/preprintWatchService")
    >()),
    isUnpublishedPreprint: () => true,
    beginManualCheck: () => () => {},
    batchCheckPublicationStatus: mocks.batchCheckPublicationStatus,
  }),
);
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  setPref: (key: string, value: unknown) => mocks.prefs.set(key, value),
}));
// The run's progress popup; Escape in it calls the given onEscape
vi.mock("../src/modules/inspire/runProgressWindow", () => ({
  openRunProgressWindow: (
    header: string,
    options: { onEscape: () => void },
  ) => {
    mocks.popupEscape.push(options.onEscape);
    return new FakeProgressWindow(header, { run: true });
  },
}));

import { ZInspire } from "../src/modules/inspire/itemUpdater";

/** Progress popups of runs, in the order the runs started */
const runWindows = () => FakeProgressWindow.all.filter((w) => w.options.run);
/** Notices shown at the end of runs (finished, cancelled, not found) */
const notices = () =>
  FakeProgressWindow.all.filter((w) => !w.options.run).map((w) => w.text);

/** A regular item without an INSPIRE record (getInspireMeta answers -1) */
function paper(id: number) {
  return {
    id,
    isRegularItem: () => true,
    getField: () => "",
    hasTag: () => false,
    addTag: vi.fn(),
    removeTag: vi.fn(),
    saveTx: vi.fn(async () => true),
  } as unknown as Zotero.Item;
}

function papers(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => paper(from + i));
}

/** Answers of getInspireMeta, held until released */
let held: Array<() => void>;
async function releaseAll() {
  while (held.length) {
    for (const release of held.splice(0)) release();
    await settle();
  }
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Reference lists asked for by cache downloads, held until released */
let heldReferences: Array<() => void>;
async function releaseReferences() {
  while (heldReferences.length) {
    for (const release of heldReferences.splice(0)) release();
    await settle();
  }
}
/** Recids whose reference lists cache downloads asked for, in order */
const askedRecids = () =>
  mocks.fetchReferencesEntries.mock.calls.map(([recid]) => recid);
/** Recids whose reference lists were stored in the cache */
const cachedRecids = () => mocks.cacheSet.mock.calls.map(([, recid]) => recid);

/** IDs of the items INSPIRE was asked about, in order */
const askedIDs = () =>
  mocks.getInspireMeta.mock.calls.map(([item]) => (item as Zotero.Item).id);

let selectedItems: Zotero.Item[];
let mainDom: JSDOM;

/**
 * Escape in the main window, e.g. in the items list; returns once the key
 * has been handled everywhere
 */
async function pressEscapeInMainWindow(
  target: EventTarget = mainDom.window.document.body,
) {
  const event = new mainDom.window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return event;
}

async function startMenuUpdate(inspire: ZInspire, items: Zotero.Item[]) {
  selectedItems = items;
  inspire.updateSelectedItems("full");
  await settle();
}

beforeEach(() => {
  held = [];
  heldReferences = [];
  FakeProgressWindow.all = [];
  mocks.cacheSet.mockReset();
  mocks.fetchReferencesEntries.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        heldReferences.push(() => resolve([]));
      }),
  );
  // A preprint check waits for INSPIRE until it is aborted
  mocks.batchCheckPublicationStatus.mockReset().mockImplementation(
    (_items: unknown, options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  );
  selectedItems = [];
  mocks.popupEscape.length = 0;
  mocks.prefs.clear();
  mainDom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://example.org/",
  });
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    getMainWindow: () => mainDom.window,
    getActiveZoteroPane: () => ({ getSelectedItems: () => selectedItems }),
  });
  vi.stubGlobal("ztoolkit", { ProgressWindow: FakeProgressWindow });
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
  mocks.getInspireMeta.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        held.push(() => resolve(-1));
      }),
  );
});

afterEach(() => {
  mainDom.window.close();
  vi.unstubAllGlobals();
});

describe("a cancelled metadata update", () => {
  it("stays cancelled when the next update starts before its requests end", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    expect(askedIDs()).toEqual([1, 2, 3]);

    // Escape while the three requests still wait, then a new update
    await pressEscapeInMainWindow();
    await startMenuUpdate(inspire, [paper(7)]);
    expect(askedIDs()).toEqual([1, 2, 3, 7]);

    await releaseAll();

    // Items 4 to 6 of the cancelled run are never updated
    expect(askedIDs()).toEqual([1, 2, 3, 7]);
    expect(runWindows().every((w) => w.closed)).toBe(true);
    // Each run reports its own numbers: the cancelled one 3 of 6, the new
    // one its single item, which has no INSPIRE record
    expect(notices()).toEqual([
      'zoteroinspire-update-cancelled-stats {"completed":"3","total":"6"}',
      "No INSPIRE recid was found for 1 item.",
    ]);
  });

  it("does not show a finished notice when it ends after the next run", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 4));
    await pressEscapeInMainWindow();
    // The first three requests of the cancelled run are still waiting
    const cancelledRequests = held.splice(0);
    await startMenuUpdate(inspire, [paper(5)]);
    await releaseAll();
    expect(notices()).toEqual(["No INSPIRE recid was found for 1 item."]);

    for (const release of cancelledRequests) release();
    await settle();

    expect(askedIDs()).toEqual([1, 2, 3, 5]);
    expect(notices()).toEqual([
      "No INSPIRE recid was found for 1 item.",
      'zoteroinspire-update-cancelled-stats {"completed":"3","total":"4"}',
    ]);
  });

  it("does not take the next run's Escape handling with it when it ends", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 4));
    await pressEscapeInMainWindow();
    const cancelledRequests = held.splice(0);
    await startMenuUpdate(inspire, papers(11, 16));
    expect(askedIDs()).toEqual([1, 2, 3, 11, 12, 13]);

    // The cancelled run ends while the new one goes on
    for (const release of cancelledRequests) release();
    await settle();

    // Escape in the main window still cancels the new run
    await pressEscapeInMainWindow();
    await releaseAll();
    expect(askedIDs()).toEqual([1, 2, 3, 11, 12, 13]);
    expect(notices()).toEqual([
      'zoteroinspire-update-cancelled-stats {"completed":"3","total":"4"}',
      'zoteroinspire-update-cancelled-stats {"completed":"3","total":"6"}',
    ]);
  });
});

describe("cancelling", () => {
  it("still works when a collection update finds no collection", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    // "Update metadata" on the collection while the library is selected
    inspire.updateSelectedCollection("full");
    await settle();

    await pressEscapeInMainWindow();
    await releaseAll();
    expect(askedIDs()).toEqual([1, 2, 3]);
    expect(notices()).toEqual([
      'zoteroinspire-update-cancelled-stats {"completed":"3","total":"6"}',
    ]);
  });

  it("works from the progress popup", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    mocks.popupEscape.at(-1)!();
    await releaseAll();
    expect(askedIDs()).toEqual([1, 2, 3]);
    expect(notices()).toEqual([
      'zoteroinspire-update-cancelled-stats {"completed":"3","total":"6"}',
    ]);
  });

  it("works from the Cancel update menu entry", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    inspire.cancelUpdate();
    await releaseAll();
    expect(askedIDs()).toEqual([1, 2, 3]);
    expect(notices()).toEqual([
      'zoteroinspire-update-cancelled-stats {"completed":"3","total":"6"}',
    ]);
  });

  it("stops every run that is going", async () => {
    const inspire = new ZInspire();
    // Papers added to the library are updated at once, in two batches
    inspire.updateItems(papers(1, 5), "full");
    await settle();
    inspire.updateItems(papers(11, 15), "full");
    await settle();
    expect(askedIDs()).toEqual([1, 2, 3, 11, 12, 13]);

    inspire.cancelUpdate();
    await releaseAll();

    expect(askedIDs()).toEqual([1, 2, 3, 11, 12, 13]);
    expect(notices()).toEqual([
      'zoteroinspire-update-cancelled-stats {"completed":"3","total":"5"}',
      'zoteroinspire-update-cancelled-stats {"completed":"3","total":"5"}',
    ]);
  });
});

describe("two updates that nobody cancels", () => {
  it("both go through all their items", async () => {
    const inspire = new ZInspire();
    inspire.updateItems(papers(1, 5), "full");
    await settle();
    inspire.updateItems(papers(11, 14), "full");
    await settle();

    // The first run's requests are not given up when the second starts
    for (const call of mocks.getInspireMeta.mock.calls) {
      const signal = call[2] as AbortSignal | undefined;
      expect(signal?.aborted ?? false).toBe(false);
    }

    await releaseAll();

    expect([...askedIDs()].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 11, 12, 13, 14,
    ]);
    expect(runWindows().every((w) => w.closed)).toBe(true);
    expect(
      notices().filter((text) => text?.includes("update-cancelled")),
    ).toEqual([]);
  });

  it("run one after the other as before", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 2));
    await releaseAll();
    await startMenuUpdate(inspire, papers(3, 5));
    await releaseAll();

    expect(askedIDs()).toEqual([1, 2, 3, 4, 5]);
    expect(notices()).toEqual([
      "No INSPIRE recid was found for 2 items.",
      "No INSPIRE recid was found for 3 items.",
    ]);
  });
});

describe("updates that overlap", () => {
  it("each keep their progress popup and show their own final notice", async () => {
    const inspire = new ZInspire();
    // Papers saved one batch after the other are updated at once
    inspire.updateItems(papers(1, 5), "full");
    await settle();
    inspire.updateItems(papers(11, 14), "full");
    await settle();

    expect(runWindows().map((w) => w.closed)).toEqual([false, false]);

    await releaseAll();

    expect(runWindows().map((w) => w.closed)).toEqual([true, true]);
    expect([...notices()].sort()).toEqual([
      "No INSPIRE recid was found for 4 items.",
      "No INSPIRE recid was found for 5 items.",
    ]);
  });

  it("do not close each other's popup when one ends", async () => {
    const inspire = new ZInspire();
    inspire.updateItems([paper(1)], "full");
    await settle();
    inspire.updateItems(papers(11, 13), "full");
    await settle();
    expect(askedIDs()).toEqual([1, 11, 12, 13]);

    // The first run gets its answer and ends
    held.shift()!();
    await settle();

    expect(notices()).toEqual(["No INSPIRE recid was found for 1 item."]);
    expect(runWindows().map((w) => w.closed)).toEqual([true, false]);

    await releaseAll();
    expect(notices()).toEqual([
      "No INSPIRE recid was found for 1 item.",
      "No INSPIRE recid was found for 3 items.",
    ]);
  });
});

describe("runs of different kinds", () => {
  it("a cancelled cache download stays cancelled when another starts", async () => {
    const inspire = new ZInspire();
    selectedItems = papers(1, 3);
    void inspire.downloadReferencesCacheForSelection();
    await settle();
    expect(askedRecids()).toEqual(["1"]);

    await pressEscapeInMainWindow();
    selectedItems = [paper(4)];
    void inspire.downloadReferencesCacheForSelection();
    await settle();
    await releaseReferences();

    expect(askedRecids()).toEqual(["1", "4"]);
    expect(cachedRecids()).toEqual(["4"]);
  });

  it("a cancelled cache download is not resumed by a preprint check", async () => {
    const inspire = new ZInspire();
    selectedItems = papers(1, 3);
    void inspire.downloadReferencesCacheForSelection();
    await settle();
    await pressEscapeInMainWindow();

    selectedItems = [paper(9)];
    const check = inspire.checkSelectedItemsPreprints();
    await settle();
    expect(mocks.batchCheckPublicationStatus).toHaveBeenCalledTimes(1);
    await releaseReferences();

    expect(askedRecids()).toEqual(["1"]);
    expect(cachedRecids()).toEqual([]);

    inspire.cancelUpdate();
    await check;
  });

  it("Escape still cancels a metadata update after a cache download ended", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    selectedItems = [paper(20)];
    void inspire.downloadReferencesCacheForSelection();
    await settle();
    await releaseReferences();
    expect(cachedRecids()).toEqual(["20"]);

    await pressEscapeInMainWindow();
    await releaseAll();

    expect(askedIDs()).toEqual([1, 2, 3]);
  });

  it("Escape still cancels a cache download after a metadata update ended", async () => {
    const inspire = new ZInspire();
    selectedItems = papers(1, 3);
    void inspire.downloadReferencesCacheForSelection();
    await settle();
    await startMenuUpdate(inspire, [paper(10)]);
    await releaseAll();
    expect(askedIDs()).toEqual([10]);

    await pressEscapeInMainWindow();
    await releaseReferences();

    expect(askedRecids()).toEqual(["1"]);
    expect(cachedRecids()).toEqual([]);
  });

  it("Escape cancels a preprint check and a metadata update that run together", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    selectedItems = [paper(9)];
    const check = inspire.checkSelectedItemsPreprints();
    await settle();

    await pressEscapeInMainWindow();
    await check;
    await releaseAll();

    const [, options] = mocks.batchCheckPublicationStatus.mock.calls[0];
    expect((options as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect(askedIDs()).toEqual([1, 2, 3]);
  });

  it("a menu update with nothing selected leaves Escape to Zotero", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, []);

    const escape = new mainDom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    mainDom.window.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(false);
    expect(runWindows()).toEqual([]);
    expect(notices()).toEqual(["INSPIRE metadata updated for 0 items."]);
  });
});

describe("Escape meant for something else", () => {
  it("is left to a text field, e.g. the search box", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    const searchBox = mainDom.window.document.createElement("input");
    mainDom.window.document.body.appendChild(searchBox);

    const escape = await pressEscapeInMainWindow(searchBox);
    await releaseAll();

    expect(escape.defaultPrevented).toBe(false);
    expect(askedIDs()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("is left to a dialog that handles it, also one opened after the run started", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    const closeDialog = vi.fn((event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    });
    mainDom.window.addEventListener("keydown", closeDialog);

    await pressEscapeInMainWindow();
    await releaseAll();

    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(askedIDs()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  /**
   * Zotero's collection tree (zoteroPane.js): its pane takes Escape from the
   * focused tree, clears the collection filter if there is one and marks
   * the key as handled either way
   */
  function collectionTree(filter: string) {
    const doc = mainDom.window.document;
    const search = doc.createElement("input");
    search.id = "zotero-collections-search";
    search.value = filter;
    const pane = doc.createElement("div");
    pane.id = "zotero-collections-tree";
    const tree = doc.createElement("div");
    tree.id = "collection-tree";
    pane.appendChild(tree);
    pane.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && (event.target as Element).id === tree.id) {
        search.value = "";
        event.preventDefault();
        event.stopPropagation();
      }
    });
    doc.body.append(search, pane);
    return tree;
  }

  it("cancels from the collection tree when Zotero has no filter to clear", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));

    await pressEscapeInMainWindow(collectionTree(""));
    await releaseAll();

    expect(askedIDs()).toEqual([1, 2, 3]);
  });

  it("is left to Zotero to clear the collection filter", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));

    await pressEscapeInMainWindow(collectionTree("cern"));
    await releaseAll();

    expect(askedIDs()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("is left to a dialog that handles it while the collection tree has the focus", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    const tree = collectionTree("");
    // e.g. the preprint check's results, opened without taking the focus
    const closeDialog = vi.fn((event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    });
    mainDom.window.document.addEventListener("keydown", closeDialog, true);

    await pressEscapeInMainWindow(tree);
    await releaseAll();

    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(askedIDs()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("cancels from a checkbox, where nothing is typed", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    const checkbox = mainDom.window.document.createElement("input");
    checkbox.type = "checkbox";
    mainDom.window.document.body.appendChild(checkbox);

    await pressEscapeInMainWindow(checkbox);
    await releaseAll();

    expect(askedIDs()).toEqual([1, 2, 3]);
  });

  it("is left to Zotero in a reader tab", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    (mainDom.window as any).Zotero_Tabs = { selectedIndex: 1 };

    await pressEscapeInMainWindow();
    await releaseAll();

    expect(askedIDs()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("still reaches Zotero when it cancels a run", async () => {
    const inspire = new ZInspire();
    await startMenuUpdate(inspire, papers(1, 6));
    const zoteroKeyDown = vi.fn();
    mainDom.window.document.addEventListener("keydown", zoteroKeyDown);

    await pressEscapeInMainWindow();
    await releaseAll();

    expect(zoteroKeyDown).toHaveBeenCalledTimes(1);
    expect(askedIDs()).toEqual([1, 2, 3]);
  });
});
