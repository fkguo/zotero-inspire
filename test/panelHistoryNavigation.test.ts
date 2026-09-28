import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import type { NavigationSnapshot } from "../src/modules/inspire/types";

// Back/forward history of the References panel. A history jump asks Zotero to
// show another item and sets isNavigatingHistory until that item reaches a
// panel; the ← / → buttons are disabled while it is set. These tests press the
// arrow keys, replay the item changes Zotero reports meanwhile, and check the
// history once Zotero has shown the requested items.

const Panel = InspireReferencePanelController as any;
const A = 1;
const B = 2;
const C = 3;
const D = 4;

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
  Panel.historyJump = undefined;
  Panel.sharedPendingScrollRestore = undefined;
}

describe("References panel back/forward history", () => {
  // Regular items A, B, C, D, each with one PDF attachment (item ID + 10).
  const items = new Map<number, any>();
  for (const id of [A, B, C, D]) {
    items.set(id, {
      id,
      isRegularItem: () => true,
      getField: (field: string) =>
        field === "archiveLocation"
          ? String(100 + id)
          : field === "archive"
            ? "INSPIRE"
            : "",
      getAttachments: () => [id + 10],
    });
    items.set(id + 10, { id: id + 10, isPDFAttachment: () => true });
  }
  let selectItems: ReturnType<typeof vi.fn>;
  let openReader: ReturnType<typeof vi.fn>;
  let selectedInLibrary: number[];

  beforeEach(() => {
    selectedInLibrary = [];
    selectItems = vi.fn(async (ids: number[]) => {
      selectedInLibrary = ids;
      return true;
    });
    openReader = vi.fn();
    (globalThis as any).Zotero = {
      debug: vi.fn(),
      Items: { get: (id: number) => items.get(id) ?? null },
      getActiveZoteroPane: () => ({
        selectItems,
        getSelectedItems: () => selectedInLibrary,
      }),
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

  afterEach(async () => {
    // Let the timers a test started fire now: a panel restoring its scroll
    // position later would take the next test's pending restore.
    await new Promise((resolve) => setTimeout(resolve, 0));
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
      batchImport: { clearSelection: vi.fn() },
      chartSelectedBins: new Set(),
      allEntries: [],
      isFavoritesViewActive: false,
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

  // Zotero also calls onItemChange for the item a panel already shows, for
  // example when it renders the item pane again after a "refresh"
  // notification.
  it.each([
    // Visited A, then B, then C; the panel shows C.
    {
      direction: "Back",
      key: "ArrowLeft",
      back: [A, B],
      shown: C,
      forward: [],
    },
    // Visited A, then B, then C, and went back to A; the panel shows A.
    {
      direction: "Forward",
      key: "ArrowRight",
      back: [],
      shown: A,
      forward: [C, B],
    },
  ] as const)(
    "keeps a $direction jump pending while Zotero shows the item it leaves again",
    async ({ key, back, shown, forward }) => {
      Panel.navigationStack = back.map((id) => snapshot(id));
      Panel.forwardStack = forward.map((id) => snapshot(id));
      const panel = openPanel(shown);

      panel.press(key);
      await panel.arrive(shown); // Zotero renders it again before B arrives
      expect(panel.controller.backButton.disabled).toBe(true);
      panel.press(key);
      await panel.showSelected();

      expect(panel.history()).toEqual({ back: [A], current: B, forward: [C] });
      expect(selectItems.mock.calls).toEqual([[[B]]]);
    },
  );

  it("keeps a jump pending while the references of the item it leaves load", async () => {
    // Visited A, then B, then C; Zotero shows C and has the open section
    // load C's references (onAsyncRender).
    Panel.navigationStack = [snapshot(A), snapshot(B)];
    const panel = openPanel();
    await panel.arrive(C);
    let finishLoading: () => void = () => undefined;
    const loadEntries = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLoading = resolve;
        }),
    );
    Object.assign(panel.controller, {
      renderChartLoading: vi.fn(),
      renderMessage: vi.fn(),
      getLoadingMessageForMode: () => "",
      performAutoCheck: vi.fn(async () => undefined),
      updateSortSelector: vi.fn(),
      loadEntries,
    });
    const loading = panel.controller.handleVisibleItemChange({
      tabType: "library",
      item: items.get(C),
    });
    expect(loadEntries).toHaveBeenCalledTimes(1);

    panel.press("ArrowLeft");
    finishLoading(); // C's references arrive before B does
    await loading;
    expect(panel.controller.backButton.disabled).toBe(true);
    await panel.showSelected();

    expect(panel.history()).toEqual({ back: [A], current: B, forward: [C] });
  });

  it("ends a jump to an open Reader tab when that tab shows its item", async () => {
    // Visited A in the library, then C in a Reader tab that is still open,
    // and went back to A; the library panel shows A.
    Panel.forwardStack = [snapshot(C, "reader-C")];
    const readerC = { tabID: "reader-C", focus: vi.fn() };
    (globalThis as any).Zotero.Reader.getByTabID = (tabID: string) =>
      tabID === "reader-C" ? readerC : undefined;
    const panel = openPanel(A);
    const readerPanel = openPanel(C); // the item pane of C's Reader tab

    panel.press("ArrowRight");
    expect((globalThis as any).Zotero_Tabs.select).toHaveBeenCalledWith(
      "reader-C",
    );
    // Zotero selects the tab and renders its item pane, which shows C again.
    Object.assign((globalThis as any).Zotero_Tabs, {
      selectedType: "reader",
      selectedID: "reader-C",
    });
    await readerPanel.arrive(C, "reader");

    expect(readerPanel.history()).toEqual({
      back: [A],
      current: C,
      forward: [],
    });
    expect(readerPanel.controller.backButton.disabled).toBe(false);
  });

  it("ends a jump once Zotero shows its target, even the item already shown", async () => {
    // Went from C to D through the panel, then selected C again in the
    // library, so the item behind C is C itself; the panel shows C.
    Panel.navigationStack = [snapshot(C)];
    const panel = openPanel(C);

    panel.press("ArrowLeft");
    expect(selectItems).toHaveBeenCalledWith([C]);
    // Zotero reports nothing for an item that is already selected, but
    // reports it again whenever it renders the item pane again.
    await panel.arrive(C);

    expect(Panel.isNavigatingHistory).toBe(false);
  });

  // Zotero reports no item when asked to show the item the library already
  // shows: selecting its selected item again renders nothing, and going back
  // to the library tab only performs a render put off while it was hidden.
  it.each([
    // Went from A to B in the library, then opened C's PDF from B's panel.
    {
      direction: "Back",
      key: "ArrowLeft",
      back: [A, B],
      forward: [],
      after: { back: [A], current: B, forward: [C] },
    },
    // In C's Reader tab, selected B in the library from C's panel, then went
    // back to C.
    {
      direction: "Forward",
      key: "ArrowRight",
      back: [],
      forward: [B],
      after: { back: [C], current: B, forward: [] },
    },
  ] as const)(
    "ends a $direction jump from a Reader tab to the item the library shows",
    async ({ key, back, forward, after }) => {
      selectedInLibrary = [B];
      const panel = openPanel(B); // the library selects and shows B
      Object.assign((globalThis as any).Zotero_Tabs, {
        selectedType: "reader",
        selectedID: "reader-C",
      });
      const readerPanel = openPanel(); // the item pane of C's Reader tab
      await readerPanel.arrive(C, "reader");
      Panel.navigationStack = back.map((id) => snapshot(id));
      Panel.forwardStack = forward.map((id) => snapshot(id));
      // B's list was scrolled down when the user left it.
      const target = [...Panel.navigationStack, ...Panel.forwardStack].find(
        (s: NavigationSnapshot) => s.itemID === B,
      );
      target.scrollState.scrollTop = 120;
      let finishSelecting: (found: boolean) => void = () => undefined;
      selectItems.mockReturnValue(
        new Promise((resolve) => {
          finishSelecting = resolve;
        }),
      );

      readerPanel.press(key);
      expect(selectItems.mock.calls).toEqual([[[B]]]);
      expect(panel.controller.backButton.disabled).toBe(true);
      // Zotero shows the library tab, where B is already selected, and
      // renders nothing.
      Object.assign((globalThis as any).Zotero_Tabs, {
        selectedType: "library",
        selectedID: "zotero-pane",
      });
      finishSelecting(true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(panel.history()).toEqual(after);
      expect(panel.controller.backButton.disabled).toBe(false);
      expect(panel.controller.forwardButton.disabled).toBe(
        after.forward.length === 0,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(panel.controller.listEl.scrollTop).toBe(120);
    },
  );

  it.each([
    [
      "reopening Reader tabs is turned off",
      () => {
        (globalThis as any).Zotero.Prefs.get = () => false;
      },
    ],
    [
      "Zotero fails to reopen it",
      () => openReader.mockRejectedValue(new Error("cannot open")),
    ],
  ])(
    "ends a jump to the item the library shows when its Reader tab is closed and %s",
    async (_cause, preventReopening) => {
      // Visited A in the library, B in a Reader tab closed since, then C;
      // the library still selects and shows B.
      selectedInLibrary = [B];
      const panel = openPanel(B);
      Object.assign((globalThis as any).Zotero_Tabs, {
        selectedType: "reader",
        selectedID: "reader-C",
      });
      const readerPanel = openPanel(); // the item pane of C's Reader tab
      await readerPanel.arrive(C, "reader");
      Panel.navigationStack = [snapshot(A), snapshot(B, "reader-B")];
      preventReopening();
      // Zotero shows the library tab, where B is already selected, and
      // renders nothing.
      selectItems.mockImplementation(async () => {
        Object.assign((globalThis as any).Zotero_Tabs, {
          selectedType: "library",
          selectedID: "zotero-pane",
        });
        return true;
      });

      readerPanel.press("ArrowLeft");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(selectItems.mock.calls).toEqual([[[B]]]);
      expect(panel.history()).toEqual({ back: [A], current: B, forward: [C] });
      expect(panel.controller.backButton.disabled).toBe(false);
      expect(panel.controller.forwardButton.disabled).toBe(false);
    },
  );

  it.each([
    ["returns without showing the library", async () => false],
    [
      "shows the library without selecting B",
      async () => {
        Object.assign((globalThis as any).Zotero_Tabs, {
          selectedType: "library",
          selectedID: "zotero-pane",
        });
        return true;
      },
    ],
  ])("keeps a jump pending if Zotero %s", async (_outcome, selectNothing) => {
    // Visited A, then B, then C in a Reader tab. The library selects
    // nothing now, which Zotero shows without rendering the item pane, so
    // the library panel still shows B.
    const panel = openPanel(B);
    Object.assign((globalThis as any).Zotero_Tabs, {
      selectedType: "reader",
      selectedID: "reader-C",
    });
    const readerPanel = openPanel(); // the item pane of C's Reader tab
    await readerPanel.arrive(C, "reader");
    Panel.navigationStack = [snapshot(A), snapshot(B)];
    selectItems.mockImplementation(selectNothing);

    readerPanel.press("ArrowLeft");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(selectItems.mock.calls).toEqual([[[B]]]);
    expect(panel.controller.backButton.disabled).toBe(true);
    expect(panel.controller.forwardButton.disabled).toBe(true);
  });

  it("ends a jump to the item of the Reader tab already selected", async () => {
    // In C's Reader tab, opened D's PDF from C's panel, then selected C's
    // Reader tab again, so the item behind C is C itself.
    const readerC = { tabID: "reader-C", focus: vi.fn() };
    (globalThis as any).Zotero.Reader.getByTabID = (tabID: string) =>
      tabID === "reader-C" ? readerC : undefined;
    Object.assign((globalThis as any).Zotero_Tabs, {
      selectedType: "reader",
      selectedID: "reader-C",
    });
    const readerPanel = openPanel(); // the item pane of C's Reader tab
    await readerPanel.arrive(C, "reader");
    Panel.navigationStack = [snapshot(C, "reader-C")];

    readerPanel.press("ArrowLeft");
    // Zotero does nothing when asked to select the tab already selected.
    expect((globalThis as any).Zotero_Tabs.select).toHaveBeenCalledWith(
      "reader-C",
    );

    expect(readerPanel.history()).toEqual({
      back: [],
      current: C,
      forward: [C],
    });
    expect(readerPanel.controller.forwardButton.disabled).toBe(false);
  });

  it.each([
    [
      "its PDF has been deleted since",
      () => {
        const itemB = { ...items.get(B), getAttachments: () => [] };
        (globalThis as any).Zotero.Items.get = (id: number) =>
          id === B ? itemB : (items.get(id) ?? null);
      },
    ],
    [
      "Zotero fails to open it",
      () => openReader.mockRejectedValue(new Error("cannot open")),
    ],
  ])(
    "shows the item in the library when its Reader tab cannot be reopened: %s",
    async (_cause, preventReopening) => {
      // Visited A in the library, B in a Reader tab closed since, then C.
      Panel.navigationStack = [snapshot(A), snapshot(B, "reader-B")];
      preventReopening();
      const panel = openPanel(C);

      panel.press("ArrowLeft");
      await new Promise((resolve) => setTimeout(resolve, 0)); // reopening fails
      expect(selectItems).toHaveBeenCalledWith([B]);
      await panel.showSelected();

      expect(panel.history()).toEqual({ back: [A], current: B, forward: [C] });
      expect(panel.controller.backButton.disabled).toBe(false);
      expect(panel.controller.forwardButton.disabled).toBe(false);
    },
  );

  it("ends a jump once the user shows another tab", async () => {
    // Visited A in the library, B in a Reader tab closed since, then C.
    Panel.navigationStack = [snapshot(A), snapshot(B, "reader-B")];
    openReader.mockReturnValue(new Promise(() => undefined)); // still opening
    const panel = openPanel(C);
    const readerPanel = openPanel(D); // the item pane of D's Reader tab

    panel.press("ArrowLeft");
    // While B's Reader tab opens, the user selects D's Reader tab, whose
    // item pane Zotero renders again.
    Object.assign((globalThis as any).Zotero_Tabs, {
      selectedType: "reader",
      selectedID: "reader-D",
    });
    await readerPanel.arrive(D, "reader");

    expect(Panel.isNavigatingHistory).toBe(false);
    expect(readerPanel.controller.backButton.disabled).toBe(false);
  });

  it.each([
    ["selects another item", (panel: any) => panel.arrive(D)],
    [
      "switches to a Reader tab that also shows C",
      () => {
        const readerPanel = openPanel(C); // the item pane of C's Reader tab
        Object.assign((globalThis as any).Zotero_Tabs, {
          selectedType: "reader",
          selectedID: "reader-C",
        });
        return readerPanel.arrive(C, "reader");
      },
    ],
    [
      "switches to a note tab",
      () => {
        Object.assign((globalThis as any).Zotero_Tabs, {
          selectedType: "note",
          selectedID: "note-1",
        });
      },
    ],
  ])(
    "leaves the user's choice alone if the user %s before reopening fails",
    async (_choice, goElsewhere) => {
      // Visited A in the library, B in a Reader tab closed since, then C.
      Panel.navigationStack = [snapshot(A), snapshot(B, "reader-B")];
      let failOpening: (error: Error) => void = () => undefined;
      openReader.mockReturnValue(
        new Promise((_resolve, reject) => {
          failOpening = reject;
        }),
      );
      const panel = openPanel(C);

      panel.press("ArrowLeft");
      await goElsewhere(panel); // while B's Reader tab is opening
      failOpening(new Error("cannot open"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(selectItems).not.toHaveBeenCalled();
      expect(Panel.isNavigatingHistory).toBe(false);
      expect(panel.controller.backButton.disabled).toBe(false);
    },
  );

  it("stores nothing when every earlier item has been deleted", () => {
    const X = 9; // deleted since it was visited
    Panel.navigationStack = [snapshot(X)];
    const panel = openPanel(C);

    panel.press("ArrowLeft");

    expect(panel.history()).toEqual({ back: [], current: C, forward: [] });
    expect(selectItems).not.toHaveBeenCalled();
    expect(panel.controller.forwardButton.disabled).toBe(true);
  });

  it("stores nothing when every later item has been deleted", () => {
    const X = 9; // deleted since it was visited
    Panel.forwardStack = [snapshot(X)];
    const panel = openPanel(A);

    panel.press("ArrowRight");

    expect(panel.history()).toEqual({ back: [], current: A, forward: [] });
    expect(selectItems).not.toHaveBeenCalled();
    expect(panel.controller.backButton.disabled).toBe(true);
  });
});
