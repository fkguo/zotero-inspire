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
import { BatchImportManager } from "../src/modules/inspire/panel/BatchImportManager";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import { FakeLibrary, type FakeItem } from "./fakeLibrary";

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
 * renderer, with its notifier observer registered, as the panel is after it
 * showed a list for the item `current`.
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
    filterText: "",
    chartSelectedBins: new Set(),
    authorFilterEnabled: false,
    publishedOnlyFilterEnabled: false,
    quickFilters: new Set(),
    excludeSelfCitations: false,
    entryRenderer: new EntryListRenderer({ document: doc, maxPoolSize: 50 }),
    rowCache: new Map(),
    getFirstPdfAttachmentID: () => null,
  });
  controller.batchImport = new BatchImportManager(
    controller.getBatchImportOptions(),
  );
  for (const e of entries) {
    controller.listEl.appendChild(controller.createReferenceRow(e));
  }
  controller.registerNotifier();

  const marker = (id: string) =>
    controller.listEl.querySelector(
      `.zinspire-ref-entry[data-entry-id="${id}"] .zinspire-ref-entry__dot`,
    ) as HTMLElement;
  return {
    controller,
    /** The row's mark and its tooltip */
    mark: (id: string) => marker(id).textContent,
    markTitle: (id: string) => marker(id).getAttribute("title"),
    /** The panel's local-status pass over its list, as after a load */
    enrich: () => controller.enrichLocalStatus(controller.allEntries),
    dispose: () => {
      controller.unregisterNotifier();
      controller.batchImport.dispose();
    },
  };
}

const IN_LIBRARY = "●";
const ADD = "⊕";

describe("References panel: in-library marks", () => {
  let panel: ReturnType<typeof setUpPanel> | undefined;
  afterEach(() => panel?.dispose());

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
    expect(entries[0].localItemID).toBe(item.id);
    expect(panel.mark("100")).toBe(IN_LIBRARY);

    await lib.erase(item);
    expect(entries[0].localItemID).toBeUndefined();
    expect(panel.mark("100")).toBe(ADD);
  });

  it("keeps the mark of a paper whose item went to the trash", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const entries = [entry("100")];
    panel = setUpPanel(entries);
    await panel.enrich();

    await lib.trash(item);
    expect(entries[0].localItemID).toBe(item.id);
    expect(panel.mark("100")).toBe(IN_LIBRARY);
    // A later pass (the list shown again) finds the item in the trash
    await panel.enrich();
    expect(panel.mark("100")).toBe(IN_LIBRARY);
  });

  it("keeps the mark of a paper whose item's recid changed", async () => {
    const item = lib.put({ fields: pluginFields("100") });
    const entries = [entry("100"), entry("300")];
    panel = setUpPanel(entries);
    await panel.enrich();

    await lib.edit(item, { archiveLocation: "300" });
    expect(panel.mark("100")).toBe(IN_LIBRARY);
    expect(panel.mark("300")).toBe(ADD);
    // A later pass marks the new recid but does not unmark the old one
    await panel.enrich();
    expect(panel.mark("100")).toBe(IN_LIBRARY);
    expect(panel.mark("300")).toBe(IN_LIBRARY);
  });

  it("marks a paper by a number in Archive Location whatever the Archive", async () => {
    lib.put({ fields: { archive: "Shelf 4", archiveLocation: "100" } });
    lib.put({ fields: { url: "https://inspirehep.net/literature/200" } });
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries);
    await panel.enrich();
    expect(panel.mark("100")).toBe(IN_LIBRARY);
    expect(panel.mark("200")).toBe(ADD);
  });

  it("shows one of two items with the paper's recid, as a single mark", async () => {
    const a = lib.put({ fields: pluginFields("100") });
    const b = lib.put({ fields: pluginFields("100") });
    const entries = [entry("100")];
    panel = setUpPanel(entries);
    await panel.enrich();
    expect([a.id, b.id]).toContain(entries[0].localItemID);
    expect(panel.mark("100")).toBe(IN_LIBRARY);
    expect(panel.markTitle("100")).toBe(
      "zoteroinspire-references-panel-dot-local",
    );
  });

  it("marks papers related to the item shown", async () => {
    const current = lib.put({ fields: pluginFields("1") });
    const related = lib.put({ fields: pluginFields("100") });
    lib.put({ fields: pluginFields("200") });
    current.relatedItems = [related.key];
    const entries = [entry("100"), entry("200")];
    panel = setUpPanel(entries, current);
    await panel.enrich();
    expect(entries.map((e) => e.isRelated)).toEqual([true, false]);
  });

  it("shows papers as not in the library when the lookup fails", async () => {
    lib.put({ fields: pluginFields("100") });
    const entries = [entry("100")];
    panel = setUpPanel(entries);
    lib.queryError = new Error("database is locked");
    await panel.enrich();
    expect(entries[0].localItemID).toBeUndefined();
    expect(panel.mark("100")).toBe(ADD);
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
