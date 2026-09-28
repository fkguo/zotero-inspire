// ─────────────────────────────────────────────────────────────────────────────
// "In library" marks of the References panel, the citation graph and the
// panel's batch import
//
// The papers are looked up in a small library in SQLite (fakeLibrary.ts);
// changes to it reach the panel through the notifier as they do in Zotero.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { EntryListRenderer } from "../src/modules/inspire/panel/EntryListRenderer";
import { HoverPreviewRenderer } from "../src/modules/inspire/panel/HoverPreviewRenderer";
import { BatchImportManager } from "../src/modules/inspire/panel/BatchImportManager";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import {
  findItemsByRecids,
  stopLibraryIndex,
} from "../src/modules/inspire/library/arxivIndex";
import { FakeLibrary, GROUP_LIBRARY, type FakeItem } from "./fakeLibrary";

let lib: FakeLibrary;
beforeEach(() => {
  lib = new FakeLibrary();
  vi.stubGlobal("Zotero", {
    ...lib.zoteroGlobals(),
    Prefs: { get: () => undefined },
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
  id: string,
  fields: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id,
    recid: id,
    title: `Paper ${id}`,
    year: "2024",
    authors: [],
    authorText: "Guo",
    displayText: "",
    searchText: "",
    ...fields,
  };
}

/** The plugin's layout of an item imported from INSPIRE */
function pluginFields(recid: string): Record<string, string> {
  return { archive: "INSPIRE", archiveLocation: recid };
}

/**
 * A References panel on jsdom showing `entries` as rows drawn by its own row
 * renderer, with its notifier observer registered and following the library,
 * as the panel is after it showed a list for the item `current`.
 */
function setUpPanel(entries: InspireReferenceEntry[], current?: FakeItem) {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><div class='panel'><div class='list'></div></div></body>",
    { url: "https://zotero.test/" },
  );
  const doc = dom.window.document;
  (globalThis as any).Zotero.getMainWindow = () => dom.window;
  const controller = Object.create(
    InspireReferencePanelController.prototype,
  ) as any;
  Object.assign(controller, {
    body: doc.querySelector(".panel"),
    listEl: doc.querySelector(".list"),
    allEntries: entries,
    currentItemID: current?.id,
    viewMode: "references",
    referenceSort: "default",
    referencesCache: new Map(),
    filterText: "",
    chartSelectedBins: new Set(),
    authorFilterEnabled: false,
    publishedOnlyFilterEnabled: false,
    quickFilters: new Set(),
    excludeSelfCitations: false,
    entryRenderer: new EntryListRenderer({ document: doc, maxPoolSize: 50 }),
    rowCache: new Map(),
    getFirstPdfAttachmentID: () => null,
    showToast: vi.fn(),
  });
  controller.batchImport = new BatchImportManager(
    controller.getBatchImportOptions(),
  );
  /** Draw the rows of the list shown, as the panel does for a new list */
  const draw = () => {
    controller.listEl.replaceChildren();
    controller.rowCache.clear();
    for (const e of controller.allEntries) {
      controller.listEl.appendChild(controller.createReferenceRow(e));
    }
  };
  draw();
  controller.registerNotifier();
  controller.followLibrary();

  const part = (id: string, name: string) =>
    controller.listEl.querySelector(
      `.zinspire-ref-entry[data-entry-id="${id}"] .zinspire-ref-entry__${name}`,
    ) as HTMLElement;
  return {
    controller,
    draw,
    /** The row's mark and its tooltip */
    mark: (id: string) => part(id, "dot").textContent,
    markTitle: (id: string) => part(id, "dot").getAttribute("title"),
    /** The state of the row's link button */
    link: (id: string) => part(id, "link").dataset.state,
    /** The panel's local-status pass over its list, as after a load */
    enrich: () => controller.enrichLocalStatus(controller.allEntries),
    dispose: () => {
      controller.unregisterNotifier();
      controller.stopFollowingLibrary?.();
      controller.batchImport.dispose();
    },
  };
}

const IN_LIBRARY = "●";
const ADD = "⊕";
const UNKNOWN = "?";

describe("References panel: in-library marks", () => {
  let panel: ReturnType<typeof setUpPanel> | undefined;
  afterEach(() => {
    panel?.dispose();
    panel = undefined;
    stopLibraryIndex();
  });

  it("marks the papers whose recid an item has", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries);
    await panel.enrich();
    expect(entries[0].localItemID).toBe(item.id);
    expect(panel.mark("100")).toBe(IN_LIBRARY);
    expect(panel.markTitle("100")).toBe(
      "zoteroinspire-references-panel-dot-local",
    );
    expect(entries[1].localItemID).toBeUndefined();
    expect(panel.mark("200")).toBe(ADD);
  });

  it("marks a paper whose item is added, and unmarks it when the item is deleted", async () => {
    const entries = [entry("100")];
    panel = setUpPanel(entries);
    await panel.enrich();
    expect(panel.mark("100")).toBe(ADD);

    const item = await lib.add({ fields: pluginFields("100") });
    await vi.waitFor(() => expect(panel!.mark("100")).toBe(IN_LIBRARY));
    expect(entries[0].localItemID).toBe(item.id);

    await lib.erase(item);
    await vi.waitFor(() => expect(panel!.mark("100")).toBe(ADD));
    expect(entries[0].localItemID).toBeUndefined();
  });

  // Intentional change: before, the mark of an item moved to the trash
  // stayed, even when the list was looked up again
  it("unmarks a paper whose item goes to the trash, and marks it again when it is restored", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const entries = [entry("100")];
    panel = setUpPanel(entries);
    await panel.enrich();
    expect(panel.mark("100")).toBe(IN_LIBRARY);

    await lib.trash(item);
    await vi.waitFor(() => expect(panel!.mark("100")).toBe(ADD));
    expect(entries[0].localItemID).toBeUndefined();

    await lib.restore(item);
    await vi.waitFor(() => expect(panel!.mark("100")).toBe(IN_LIBRARY));
  });

  // Intentional change: before, the old recid kept its mark and the new one
  // got it only when the list was looked up again
  it("moves the mark when an item's recid changes", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const entries = [entry("100"), entry("300")];
    panel = setUpPanel(entries);
    await panel.enrich();

    await lib.edit(item, { archiveLocation: "300" });
    await vi.waitFor(() => expect(panel!.mark("300")).toBe(IN_LIBRARY));
    expect(panel.mark("100")).toBe(ADD);
  });

  // Intentional change: before, a number in Archive Location counted under
  // any Archive, and an INSPIRE URL did not count
  it("marks a paper by its item's recid as resolveItemRecid reads it", async () => {
    lib.put({ fields: { archive: "Shelf 4", archiveLocation: "100" } });
    const byURL = lib.put({
      fields: { url: "https://inspirehep.net/literature/200" },
    });
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries);
    await panel.enrich();
    expect(panel.mark("100")).toBe(ADD);
    expect(panel.mark("200")).toBe(IN_LIBRARY);
    expect(entries[1].localItemID).toBe(byURL.id);
  });

  // Intentional change: before, one of the two items was taken, shown with a
  // single mark
  it("shows how many items have the paper's recid and lists them", async () => {
    const a = lib.put({
      fields: { ...pluginFields("100"), title: "Hadronic molecules" },
    });
    const b = lib.put({
      libraryID: GROUP_LIBRARY,
      fields: { ...pluginFields("100"), title: "Hadronic molecules (copy)" },
    });
    const entries = [entry("100")];
    panel = setUpPanel(entries);
    await panel.enrich();
    expect(entries[0].localItemID).toBe(a.id);
    expect(entries[0].localItemIDs).toEqual([a.id, b.id]);
    expect(panel.mark("100")).toBe("②");
    expect(panel.markTitle("100")).toBe(
      [
        'zoteroinspire-references-panel-dot-local-several {"count":2}',
        "• Hadronic molecules — My Library",
        `• Hadronic molecules (copy) — Group ${GROUP_LIBRARY}`,
      ].join("\n"),
    );
  });

  // Intentional change: before, the library lookup also wrote whether each
  // paper's item was related to the item selected when the lookup finished,
  // onto list entries that other items share (a recid's References list, an
  // author's papers) and that the local cache keeps. A lookup finishing after
  // another item was selected gave the old list that item's marks.
  it("draws the related marks of the item shown, even after a lookup that finished late", async () => {
    const itemA = lib.put({ fields: pluginFields("1") });
    const itemB = lib.put({ fields: pluginFields("1") });
    const paperX = lib.put({ fields: pluginFields("100") });
    itemA.relatedItems = [paperX.key];
    paperX.relatedItems = [itemA.key];
    // One list, shown for both items (they have the same recid)
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries, itemA);

    // The first lookup reads the library; hold it until B is selected
    const globals = (globalThis as any).Zotero;
    const query = globals.DB.queryAsync;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    globals.DB.queryAsync = async (sql: string, params?: unknown[]) => {
      await held;
      return query(sql, params);
    };
    const lookup = panel.enrich();
    panel.controller.currentItemID = itemB.id;
    release();
    await lookup;

    panel.draw();
    expect(panel.mark("100")).toBe(IN_LIBRARY);
    expect(panel.link("100")).toBe("unlinked");
    panel.controller.currentItemID = itemA.id;
    panel.draw();
    expect(panel.link("100")).toBe("linked");
    expect(panel.link("200")).toBe("unlinked");
    // Nothing about relations is kept with the list
    expect(JSON.stringify(entries)).not.toContain("isRelated");
  });

  // Intentional change: before, a failed lookup left every paper shown as
  // not in the library (⊕), and a click on ⊕ added it
  it("shows ? when the library cannot be read, and marks the papers once it can", async () => {
    lib.put({ fields: pluginFields("100") });
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries);
    lib.queryError = new Error("database is locked");
    await panel.enrich();
    expect(entries[0].localItemID).toBeUndefined();
    expect(entries[0].localStatusUnknown).toBe(true);
    expect([panel.mark("100"), panel.mark("200")]).toEqual([UNKNOWN, UNKNOWN]);
    expect(panel.markTitle("100")).toBe(
      "zoteroinspire-references-panel-dot-unknown",
    );

    // A click on ? tries again; it still fails
    await panel.controller.handleMarkerClick(entries[1]);
    expect(panel.controller.showToast).toHaveBeenLastCalledWith(
      "zoteroinspire-references-panel-library-lookup-failed",
    );
    expect(panel.mark("200")).toBe(UNKNOWN);

    // Once the library can be read, a click brings the marks
    lib.queryError = undefined;
    await panel.controller.handleMarkerClick(entries[1]);
    expect([panel.mark("100"), panel.mark("200")]).toEqual([IN_LIBRARY, ADD]);
    expect(entries[0].localStatusUnknown).toBeUndefined();
  });

  it("marks the papers shown as ? once another lookup reads the library", async () => {
    lib.put({ fields: pluginFields("100") });
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries);
    lib.queryError = new Error("database is locked");
    await panel.enrich();
    expect([panel.mark("100"), panel.mark("200")]).toEqual([UNKNOWN, UNKNOWN]);

    // The citation graph or the batch import reads the library
    lib.queryError = undefined;
    await findItemsByRecids(["300"]);
    await vi.waitFor(() =>
      expect([panel.mark("100"), panel.mark("200")]).toEqual([IN_LIBRARY, ADD]),
    );
  });

  // Intentional change: before, an add went by the row's mark alone
  it("does not add a paper whose item turns out to be in the library", async () => {
    const entries = [entry("100")];
    panel = setUpPanel(entries);
    await panel.enrich();
    expect(panel.mark("100")).toBe(ADD);
    // An item arrives without the panel hearing of it (the index learns of
    // it at the next read)
    const item = lib.put({ fields: pluginFields("100") });
    stopLibraryIndex();
    panel.controller.promptForSaveTarget = vi.fn();

    await panel.controller.handleAddAction(entries[0], panel.controller.body);

    expect(panel.controller.promptForSaveTarget).not.toHaveBeenCalled();
    expect(entries[0].localItemID).toBe(item.id);
    expect(panel.mark("100")).toBe(IN_LIBRARY);
    expect(panel.controller.showToast).toHaveBeenCalledWith(
      "zoteroinspire-references-panel-dot-local",
    );
  });

  // Intentional change: before, a paper was added without a lookup
  it("adds nothing and says so when the library cannot be read", async () => {
    const entries = [entry("100")];
    panel = setUpPanel(entries);
    lib.queryError = new Error("database is locked");
    panel.controller.promptForSaveTarget = vi.fn();

    await panel.controller.handleAddAction(entries[0], panel.controller.body);

    expect(panel.controller.promptForSaveTarget).not.toHaveBeenCalled();
    expect(panel.controller.showToast).toHaveBeenCalledWith(
      "zoteroinspire-references-panel-library-lookup-failed-add",
    );
    expect(panel.mark("100")).toBe(UNKNOWN);
  });

  // Intentional change: before, the citation export imported the papers the
  // list showed as not in the library, even when the lookup had failed
  it("imports nothing for a citation export when the library cannot be read", async () => {
    const entries = [entry("100")];
    panel = setUpPanel(entries);
    lib.queryError = new Error("database is locked");
    panel.controller.importReference = vi.fn();
    panel.controller.promptForSaveTarget = vi.fn();

    await panel.controller.handleCitationStyleExport(entries);

    expect(panel.controller.promptForSaveTarget).not.toHaveBeenCalled();
    expect(panel.controller.importReference).not.toHaveBeenCalled();
    expect(panel.controller.showToast).toHaveBeenCalledWith(
      "zoteroinspire-references-panel-library-lookup-failed-add",
    );
  });

  // Intentional change: before, a paper moved to the trash kept its mark and
  // stayed in a list filtered to the library's papers
  it("takes a paper out of a list filtered to papers in the library when its item goes to the trash", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    lib.put({ fields: pluginFields("200") });
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries);
    await panel.enrich();
    const { controller } = panel;
    controller.quickFilters = new Set(["localItems"]);
    controller.renderReferenceList = vi.fn();
    const shown = () =>
      controller
        .getFilteredEntries(controller.allEntries)
        .map((e: InspireReferenceEntry) => e.id);
    expect(shown()).toEqual(["100", "200"]);

    await lib.trash(item);
    await vi.waitFor(() =>
      expect(controller.renderReferenceList).toHaveBeenCalledWith({
        preserveScroll: true,
      }),
    );
    expect(shown()).toEqual(["200"]);
  });

  // Intentional change: before, a paper whose related item went to the trash
  // stayed in a list filtered to related papers
  it("takes a paper out of a list filtered to related papers when its item goes to the trash", async () => {
    const current = lib.put({ fields: pluginFields("1") });
    const item = lib.put({ fields: pluginFields("100") });
    const other = lib.put({ fields: pluginFields("200") });
    current.relatedItems = [item.key, other.key];
    item.relatedItems = [current.key];
    other.relatedItems = [current.key];
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries, current);
    await panel.enrich();
    const { controller } = panel;
    controller.quickFilters = new Set(["relatedOnly"]);
    controller.renderReferenceList = vi.fn();
    const shown = () =>
      controller
        .getFilteredEntries(controller.allEntries)
        .map((e: InspireReferenceEntry) => e.id);
    expect(shown()).toEqual(["100", "200"]);

    await lib.trash(item);
    await vi.waitFor(() =>
      expect(controller.renderReferenceList).toHaveBeenCalledWith({
        preserveScroll: true,
      }),
    );
    expect(shown()).toEqual(["200"]);
  });

  // Intentional change: before, only one item of the paper was asked about
  it("shows a paper as related when the item shown is related to its second item, and unlinks that one", async () => {
    const current = lib.put({ fields: pluginFields("1") });
    const first = lib.put({ fields: pluginFields("100") });
    const second = lib.put({ fields: pluginFields("100") });
    current.relatedItems = [second.key];
    second.relatedItems = [current.key];
    const entries = [entry("100")];
    panel = setUpPanel(entries, current);
    await panel.enrich();
    panel.draw();
    expect(entries[0].localItemID).toBe(first.id);
    expect(panel.link("100")).toBe("linked");
    panel.controller.quickFilters = new Set(["relatedOnly"]);
    expect(
      panel.controller
        .getFilteredEntries(entries)
        .map((e: InspireReferenceEntry) => e.id),
    ).toEqual(["100"]);

    panel.controller.renderReferenceList = vi.fn();
    await panel.controller.handleLinkAction(entries[0]);

    // The relation with the second item is removed; the first stays unrelated
    expect(current.relatedItems).toEqual([]);
    expect(second.relatedItems).toEqual([]);
    expect(first.relatedItems).toEqual([]);
    panel.draw();
    expect(panel.link("100")).toBe("unlinked");
  });

  // A paper saved twice whose items are both related to the item shown
  // (Zotero's Duplicate Item copies an item's relations)
  it.each(["the link button", "the hover card"])(
    "unlinks both items of a paper related twice with one notice, from %s",
    async (from) => {
      const current = lib.put({ fields: pluginFields("1") });
      const first = lib.put({ fields: pluginFields("100") });
      const second = lib.put({ fields: pluginFields("100") });
      current.relatedItems = [first.key, second.key];
      first.relatedItems = [current.key];
      second.relatedItems = [current.key];
      const entries = [entry("100")];
      panel = setUpPanel(entries, current);
      await panel.enrich();
      panel.controller.renderReferenceList = vi.fn();

      if (from === "the link button") {
        await panel.controller.handleLinkAction(entries[0]);
      } else {
        await panel.controller.getPreviewCallbacks().onUnlink(entries[0]);
      }

      expect(current.relatedItems).toEqual([]);
      expect(first.relatedItems).toEqual([]);
      expect(second.relatedItems).toEqual([]);
      expect(panel.controller.showToast).toHaveBeenCalledTimes(1);
      expect(panel.controller.showToast).toHaveBeenCalledWith(
        "zoteroinspire-references-panel-toast-unlinked",
      );
    },
  );

  // Intentional change: before, a list shown again from memory kept the
  // marks it had when it was loaded
  it("looks the papers up again when a list is shown again from memory", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const entries = [entry("100")];
    panel = setUpPanel([]);
    await panel.enrich();
    const { controller } = panel;
    Object.assign(controller, {
      currentRecid: "1",
      cancelActiveRequest: vi.fn(),
      setStatus: vi.fn(),
      renderMessage: vi.fn(),
      setRefreshButtonLoading: vi.fn(),
      renderChart: vi.fn(),
      renderReferenceList: vi.fn(),
      updateCacheSourceDisplay: vi.fn(),
      restoreScrollPositionIfNeeded: vi.fn(),
    });
    // The list was loaded before, when the item was in the library, and is
    // kept in memory; the item then went to the trash
    entries[0].localItemID = item.id;
    controller.referencesCache.set("1", entries);
    await lib.trash(item);

    await controller.loadEntries("1", "references");

    await vi.waitFor(() => expect(entries[0].localItemID).toBeUndefined());
  });
});

describe("References panel: recid found on INSPIRE for the item shown", () => {
  it("is looked up again after the item changes", async () => {
    const fetchRecidForItem = vi.fn(async () => "new-recid");
    const loadEntries = vi.fn().mockResolvedValue(undefined);
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "remote-recid",
      recidStateRevision: 0,
      pendingAutoCheckItemID: undefined,
      pendingVisibleItemSwitchID: undefined,
      lastAsyncRenderKey: "42:remote-recid:references",
      asyncRenderLoad: undefined,
      allEntries: [],
      lastRenderedEntries: [],
      fetchRecidForItem,
      restoreScrollPositionIfNeeded: vi.fn(),
      cancelActiveRequest: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
    });
    const item = { id: 42, isRegularItem: () => true, getField: () => "" };

    // The item is edited (its DOI, say), then shown again
    controller.handleItemModified([42]);
    await controller.handleItemChange({ tabType: "library", item } as any, {
      loadData: true,
    });

    // Intentional change: before, "remote-recid" was used again without a
    // lookup
    expect(fetchRecidForItem).toHaveBeenCalledOnce();
    expect(controller.currentRecid).toBe("new-recid");
  });

  it("is kept through notifications about other items", async () => {
    const fetchRecidForItem = vi.fn(async () => "new-recid");
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "remote-recid",
      recidStateRevision: 0,
      lastAsyncRenderKey: "42:remote-recid:references",
      allEntries: [],
      lastRenderedEntries: [],
      fetchRecidForItem,
      restoreScrollPositionIfNeeded: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries: vi.fn().mockResolvedValue(undefined),
    });
    const item = { id: 42, isRegularItem: () => true, getField: () => "" };

    controller.handleItemModified([7]);
    await controller.handleItemChange({ tabType: "library", item } as any, {
      loadData: true,
    });

    expect(fetchRecidForItem).not.toHaveBeenCalled();
    expect(controller.currentRecid).toBe("remote-recid");
  });
});

describe("References panel: items of a library not loaded yet", () => {
  // Zotero loads a library's items when the library is first shown or
  // synced; until then Zotero.Items.get throws for them. Before, a list
  // whose paper had such an item could not be drawn (the PDF button asked
  // for the item); the related state is now asked when rows are drawn too.
  let panel: ReturnType<typeof setUpPanel> | undefined;
  afterEach(() => {
    panel?.dispose();
    panel = undefined;
    stopLibraryIndex();
  });

  it("draws the paper as in the library, and lists the item by its library", async () => {
    const mine = lib.put({
      fields: { ...pluginFields("100"), title: "Hadronic molecules" },
    });
    const inGroup = lib.put({
      libraryID: GROUP_LIBRARY,
      fields: pluginFields("200"),
    });
    const groupCopy = lib.put({
      libraryID: GROUP_LIBRARY,
      fields: pluginFields("100"),
    });
    lib.unloadedLibraries.add(GROUP_LIBRARY);
    const current = lib.put({ fields: pluginFields("1") });
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries, current);
    // The panel's own PDF lookup, not the harness's
    delete panel.controller.getFirstPdfAttachmentID;

    await panel.enrich();
    panel.draw();

    expect(entries[1].localItemID).toBe(inGroup.id);
    expect(panel.mark("200")).toBe(IN_LIBRARY);
    expect(panel.link("200")).toBe("unlinked");
    expect(panel.mark("100")).toBe("②");
    expect(panel.markTitle("100")).toBe(
      [
        'zoteroinspire-references-panel-dot-local-several {"count":2}',
        "• Hadronic molecules — My Library",
        `• Group ${GROUP_LIBRARY}`,
      ].join("\n"),
    );
    expect(entries[0].localItemIDs).toEqual([mine.id, groupCopy.id]);
  });
});

describe("hover card: in-library state", () => {
  function card(
    fields: Partial<InspireReferenceEntry>,
    ctx: Record<string, unknown> = {},
  ) {
    const dom = new JSDOM("<!DOCTYPE html><body></body>", {
      url: "https://zotero.test/",
    });
    (globalThis as any).Zotero.getMainWindow = () => dom.window;
    (globalThis as any).Zotero.launchURL = vi.fn();
    const renderer = new HoverPreviewRenderer({
      document: dom.window.document,
    });
    const el = renderer.createCard();
    const e = entry("100", fields);
    renderer.buildContent(el, {
      entry: e,
      onAdd: vi.fn(),
      onLink: vi.fn(),
      onUnlink: vi.fn(),
      onSelectInLibrary: vi.fn(),
      ...ctx,
    });
    const status = el.querySelector(
      ".zinspire-preview-card__status",
    ) as HTMLButtonElement;
    const buttons = [...el.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    return { status, buttons };
  }

  // Intentional change: before, the card said "In Library" for one of the
  // items and nothing about the other
  it("shows how many items have the paper's recid and lists them", async () => {
    const a = lib.put({
      fields: { ...pluginFields("100"), title: "Hadronic molecules" },
    });
    const b = lib.put({
      libraryID: GROUP_LIBRARY,
      fields: { ...pluginFields("100"), title: "Hadronic molecules (copy)" },
    });
    const { status, buttons } = card({
      localItemID: a.id,
      localItemIDs: [a.id, b.id],
    });
    expect(status.textContent).toBe(
      '●zoteroinspire-references-panel-status-local-several {"count":2}',
    );
    expect(status.title).toBe(
      [
        "zoteroinspire-references-panel-button-select",
        'zoteroinspire-references-panel-dot-local-several {"count":2}',
        "• Hadronic molecules — My Library",
        `• Hadronic molecules (copy) — Group ${GROUP_LIBRARY}`,
      ].join("\n"),
    );
    expect(status.disabled).toBe(false);
    expect(buttons).not.toContain("zoteroinspire-references-panel-button-add");
  });

  it("offers to link or unlink as the item shown is related or not", () => {
    const item = lib.put({ fields: pluginFields("100") });
    expect(
      card({ localItemID: item.id }, { isRelated: true }).buttons,
    ).toContain("zoteroinspire-references-panel-button-unlink");
    expect(
      card({ localItemID: item.id }, { isRelated: false }).buttons,
    ).toContain("zoteroinspire-references-panel-button-link");
  });

  // Intentional change: before, a failed lookup showed the paper as online,
  // with its add buttons
  it("offers nothing to do with the library when it cannot be read", () => {
    const { status, buttons } = card({ localStatusUnknown: true });
    expect(status.textContent).toBe(
      "?zoteroinspire-references-panel-status-unknown",
    );
    expect(status.title).toBe("zoteroinspire-references-panel-dot-unknown");
    expect(status.disabled).toBe(true);
    expect(buttons).not.toContain("zoteroinspire-references-panel-button-add");
    expect(buttons).not.toContain("⊕");
    expect(buttons).not.toContain("zoteroinspire-references-panel-button-link");
  });
});
