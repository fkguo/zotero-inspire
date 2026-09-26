import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import type { NavigationSnapshot } from "../src/modules/inspire/types";

// Back/forward history of the References panel. A history jump asks Zotero to
// show another item and sets isNavigatingHistory; the ← / → buttons are
// disabled while it is set. These tests press the arrow keys again while it
// is set and check the history once Zotero has shown the requested items.

const Panel = InspireReferencePanelController as any;
const A = 1;
const B = 2;
const C = 3;

function snapshot(itemID: number, readerTabID?: string): NavigationSnapshot {
  return {
    itemID,
    recid: String(100 + itemID),
    scrollState: {
      scrollTop: 0,
      scrollLeft: 0,
      scrollSnapshots: [],
      activeElement: null,
    },
    tabType: readerTabID ? "reader" : "library",
    readerTabID,
  };
}

const ids = (stack: NavigationSnapshot[]) => stack.map((s) => s.itemID);

function resetHistory() {
  Panel.instances.clear();
  Panel.navigationStack = [];
  Panel.forwardStack = [];
  Panel.isNavigatingHistory = false;
  Panel.sharedPendingScrollRestore = undefined;
}

describe("References panel back/forward history", () => {
  // Regular items A, B, C, each with one PDF attachment (item ID + 10).
  const items = new Map<number, any>();
  for (const id of [A, B, C]) {
    items.set(id, {
      id,
      isRegularItem: () => true,
      getField: (field: string) =>
        field === "archiveLocation" ? String(100 + id) : "",
      getAttachments: () => [id + 10],
    });
    items.set(id + 10, { id: id + 10, isPDFAttachment: () => true });
  }
  let selectItems: ReturnType<typeof vi.fn>;
  let openReader: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    selectItems = vi.fn();
    openReader = vi.fn();
    (globalThis as any).Zotero = {
      debug: vi.fn(),
      Items: { get: (id: number) => items.get(id) ?? null },
      getActiveZoteroPane: () => ({ selectItems }),
      Prefs: { get: (key: string) => key.endsWith(".reader_auto_reopen") },
      Reader: { open: openReader, getByTabID: () => undefined },
    };
    (globalThis as any).Zotero_Tabs = {
      selectedType: "library",
      selectedID: "zotero-pane",
      select: vi.fn(),
    };
    resetHistory();
  });

  afterEach(() => {
    resetHistory();
    delete (globalThis as any).Zotero;
    delete (globalThis as any).Zotero_Tabs;
  });

  // A panel showing `itemID`, driven through its own keyboard handler.
  function openPanel(itemID?: number) {
    let keydown: (event: unknown) => void = () => undefined;
    const doc = {
      activeElement: null,
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type === "keydown") keydown = listener;
      },
    };
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      body: { ownerDocument: doc, contains: () => true, parentElement: null },
      listEl: { addEventListener: vi.fn(), scrollTop: 0, scrollLeft: 0 },
      backButton: { disabled: true, style: {} },
      forwardButton: { disabled: true, style: {} },
      viewMode: "references",
      currentTabType: "library",
      currentItemID: itemID,
      labelMatcherCache: new Map(),
      selectedEntryIDs: new Set(),
      chartSelectedBins: new Set(),
      allEntries: [],
      isFavoritesViewActive: false,
      updateBatchToolbarVisibility: vi.fn(),
      clearAutoCheckNotification: vi.fn(),
      clearEntryCitedContext: vi.fn(),
      cancelActiveRequest: vi.fn(),
    });
    controller.setupEventDelegation();
    Panel.instances.add(controller);

    const press = (key: "ArrowLeft" | "ArrowRight") => {
      const event = {
        key,
        target: { tagName: "DIV" },
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      keydown(event);
      return event;
    };
    // Zotero tells the section which item it now shows (onItemChange).
    const arrive = (id: number, tabType = "library") =>
      controller.handleItemChange(
        { tabType, item: items.get(id) },
        { loadData: false },
      );
    // Zotero shows, in order, every item the panel asked it to select.
    let shown = 0;
    const showSelected = async () => {
      const requested = selectItems.mock.calls.slice(shown);
      shown += requested.length;
      for (const [[id]] of requested) await arrive(id);
    };
    const history = () => ({
      back: ids(Panel.navigationStack),
      current: controller.currentItemID,
      forward: ids(Panel.forwardStack),
    });
    return { controller, press, arrive, showSelected, history };
  }

  it("ignores a second ← until the item of the first has arrived", async () => {
    // Visited A, then B, then C; the panel shows C.
    Panel.navigationStack = [snapshot(A), snapshot(B)];
    const panel = openPanel(C);

    panel.press("ArrowLeft");
    expect(selectItems).toHaveBeenCalledWith([B]);
    expect(panel.controller.backButton.disabled).toBe(true);
    const second = panel.press("ArrowLeft"); // B has not reached the panel yet
    expect(second.preventDefault).toHaveBeenCalled();
    await panel.showSelected();

    expect(panel.history()).toEqual({ back: [A], current: B, forward: [C] });
    expect(selectItems.mock.calls).toEqual([[[B]]]);

    // Once B has arrived, ← works again.
    expect(panel.controller.backButton.disabled).toBe(false);
    panel.press("ArrowLeft");
    await panel.showSelected();
    expect(panel.history()).toEqual({ back: [], current: A, forward: [C, B] });
  });

  it("ignores a second → until the item of the first has arrived", async () => {
    // Visited A, then B, then C, and went back to A; the panel shows A.
    Panel.forwardStack = [snapshot(C), snapshot(B)];
    const panel = openPanel(A);

    panel.press("ArrowRight");
    expect(selectItems).toHaveBeenCalledWith([B]);
    expect(panel.controller.forwardButton.disabled).toBe(true);
    const second = panel.press("ArrowRight"); // B has not reached the panel yet
    expect(second.preventDefault).toHaveBeenCalled();
    await panel.showSelected();

    expect(panel.history()).toEqual({ back: [A], current: B, forward: [C] });
    expect(selectItems.mock.calls).toEqual([[[B]]]);
  });

  it("ignores a second ← while the Reader tab of the first reopens", async () => {
    // Visited A in the library, B in a Reader tab closed since, then C.
    Panel.navigationStack = [snapshot(A), snapshot(B, "reader-B")];
    let finishOpening: (reader: unknown) => void = () => undefined;
    openReader.mockReturnValue(
      new Promise((resolve) => {
        finishOpening = resolve;
      }),
    );
    const panel = openPanel(C);

    panel.press("ArrowLeft");
    expect(openReader).toHaveBeenCalledWith(B + 10, undefined, {
      allowDuplicate: false,
    });
    const second = panel.press("ArrowLeft"); // B's Reader tab is still opening
    expect(second.preventDefault).toHaveBeenCalled();
    await panel.showSelected();

    // Zotero opens and selects a new Reader tab for B, whose own item pane
    // then shows B.
    finishOpening({ tabID: "reader-B2", focus: vi.fn() });
    Object.assign((globalThis as any).Zotero_Tabs, {
      selectedType: "reader",
      selectedID: "reader-B2",
    });
    const readerPanel = openPanel();
    await readerPanel.arrive(B, "reader");

    expect(readerPanel.history()).toEqual({
      back: [A],
      current: B,
      forward: [C],
    });
    expect(selectItems).not.toHaveBeenCalled();
    expect(openReader).toHaveBeenCalledTimes(1);
  });
});
