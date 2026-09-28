// ─────────────────────────────────────────────────────────────────────────────
// The progress popup of a metadata update while the user works in the main
// window: it stays above the main window, a click on it does not close it, it
// can be dragged, Escape in it cancels the run, and a failing progress update
// does not end the run. The popups are the plugin toolkit's real
// ProgressWindowHelper over a fake Zotero.ProgressWindow that opens its popup
// the way Zotero 10's does; the windows are jsdom windows.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";

const mocks = vi.hoisted(() => ({
  lookupInspireMeta: vi.fn(),
  prefs: new Map<string, unknown>(),
}));
vi.mock("../src/modules/inspire/metadataService", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/inspire/metadataService")
  >()),
  lookupInspireMeta: mocks.lookupInspireMeta,
}));
vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: { getCacheDir: async () => "/cache" },
}));
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  setPref: (key: string, value: unknown) => mocks.prefs.set(key, value),
}));

import { ZInspire } from "../src/modules/inspire/itemUpdater";
import { openRunProgressWindow } from "../src/modules/inspire/runProgressWindow";

const POPUP_URL = "chrome://zotero/content/progressWindow.xhtml";

interface Popup {
  window: Window;
  features: string;
  dom: JSDOM;
  dragging?: string;
}

/**
 * Zotero 10's Zotero.ProgressWindow (xpcom/progressWindow.js), cut down to
 * what the plugin uses: show() opens the popup from the given window (else
 * the main window) with openDialog(), a mouseup on the popup closes it unless
 * closeOnClick is false, and lines are drawn once the popup has loaded. After
 * close() lines are no longer drawn; a popup that went away without close()
 * (closed by the user) makes drawing throw.
 */
class FakeZoteroProgressWindow {
  static all: FakeZoteroProgressWindow[] = [];
  popup: Popup | undefined;
  closed = false;
  /** The popup window was closed without close() being called */
  popupGone = false;
  closeTimer: number | undefined;
  lines: FakeItemProgress[] = [];
  /** Set to make drawing a line throw, as it does in a popup already gone */
  static drawingFails = false;
  ItemProgress: new (icon: string, text: string) => FakeItemProgress;

  constructor(private options: { window?: any; closeOnClick?: boolean } = {}) {
    FakeZoteroProgressWindow.all.push(this);
    const owner = this;
    this.ItemProgress = class extends FakeItemProgress {
      constructor(icon: string, text: string) {
        super(text, owner);
        owner.lines.push(this);
      }
    };
  }

  show() {
    const opener = this.options.window || Zotero.getMainWindow();
    const window = opener.openDialog(
      POPUP_URL,
      "",
      "chrome,dialog=no,titlebar=no,dependent=yes",
    ) as Window;
    this.popup = popups.find((popup) => popup.window === window);
    opener.addEventListener("close", () => this.close());
    window.addEventListener("mouseup", () => {
      if (this.options.closeOnClick ?? true) this.close();
    });
    return true;
  }
  changeHeadline() {}
  startCloseTimer(ms: number) {
    this.closeTimer = ms;
  }
  close() {
    this.closed = true;
  }

  /** The last text of the first line */
  get text() {
    return this.lines[0]?.texts.at(-1);
  }
}

class FakeItemProgress {
  texts: string[] = [];
  _image = { dataset: {}, style: { backgroundImage: "" } };
  constructor(
    text: string,
    private owner: FakeZoteroProgressWindow,
  ) {
    this.texts.push(text);
  }
  setText(text: string) {
    if (this.owner.closed) return;
    if (FakeZoteroProgressWindow.drawingFails || this.owner.popupGone) {
      throw new TypeError("can't access dead object");
    }
    this.texts.push(text);
  }
  setProgress() {}
  setItemTypeAndIcon() {}
}

let popups: Popup[];
let mainDom: JSDOM;

function fakeMainWindow(): Window {
  const main = mainDom.window as any;
  main.openDialog = (url: string, _name: string, features: string) => {
    expect(url).toBe(POPUP_URL);
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "https://example.org/",
    });
    const popup: Popup = { window: dom.window as any, features, dom };
    // jsdom drops CSS properties it does not know
    const style = dom.window.document.documentElement.style;
    const setProperty = style.setProperty.bind(style);
    style.setProperty = (name: string, value: string, priority?: string) => {
      if (name === "-moz-window-dragging") popup.dragging = value;
      setProperty(name, value, priority);
    };
    popups.push(popup);
    return dom.window;
  };
  return main;
}

/** A regular item without an INSPIRE record (INSPIRE answers "not found") */
function paper(id: number) {
  return {
    id,
    isRegularItem: () => true,
    hasTag: () => false,
    addTag: vi.fn(),
    removeTag: vi.fn(),
    saveTx: vi.fn(async () => true),
  } as unknown as Zotero.Item;
}

/**
 * Answers of lookupInspireMeta, held until released; a request aborted
 * before ends at once as cancelled, as fetch does
 */
let held: Array<() => void>;
function releaseAll() {
  for (const release of held.splice(0)) release();
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

let selectedItems: Zotero.Item[];

beforeEach(() => {
  popups = [];
  held = [];
  selectedItems = [];
  FakeZoteroProgressWindow.all = [];
  FakeZoteroProgressWindow.drawingFails = false;
  mocks.prefs.clear();
  mainDom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://example.org/",
  });
  const mainWindow = fakeMainWindow();
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    ProgressWindow: FakeZoteroProgressWindow,
    getMainWindow: () => mainWindow,
    getActiveZoteroPane: () => ({ getSelectedItems: () => selectedItems }),
  });
  vi.stubGlobal("ztoolkit", { ProgressWindow: ProgressWindowHelper });
  vi.stubGlobal("addon", {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id }]: Array<{ id: string }>) => [
            { value: id },
          ],
        },
      },
    },
  });
  mocks.lookupInspireMeta.mockReset().mockImplementation(
    (_item: unknown, _operation: unknown, signal?: AbortSignal) =>
      new Promise((resolve) => {
        held.push(() => resolve({ kind: "notFound" }));
        signal?.addEventListener("abort", () =>
          resolve({ kind: "failed", aborted: true }),
        );
      }),
  );
});

afterEach(() => {
  for (const popup of popups) popup.dom.window.close();
  mainDom.window.close();
  vi.unstubAllGlobals();
});

function debugLines(): string[] {
  return (Zotero.debug as ReturnType<typeof vi.fn>).mock.calls.map(([text]) =>
    String(text),
  );
}

/** The progress window of the run (the first one opened) */
const runWindow = () => FakeZoteroProgressWindow.all[0];

async function startMenuUpdate(count: number) {
  selectedItems = Array.from({ length: count }, (_, i) => paper(i + 1));
  new ZInspire().updateSelectedItems("full");
  await settle();
}

describe("progress popup of a metadata update", () => {
  it("floats above the main window and stays open when clicked", async () => {
    const inspire = new ZInspire();
    selectedItems = [paper(1), paper(2), paper(3), paper(4), paper(5)];
    inspire.updateSelectedItems("full");
    await settle();

    const popup = runWindow().popup!;
    expect(popup.features).toContain("alwaysontop=yes");
    expect(popup.dragging).toBe("drag");

    // A click on the popup (e.g. to drag it) leaves it open
    popup.window.dispatchEvent(
      new popup.dom.window.MouseEvent("mouseup", { bubbles: true }),
    );
    expect(runWindow().closed).toBe(false);

    // The run goes on through all items
    while (held.length) {
      releaseAll();
      await settle();
    }
    expect(mocks.lookupInspireMeta).toHaveBeenCalledTimes(5);
    expect(runWindow().closed).toBe(true);
    expect(debugLines().some((line) => line.includes("fatal error"))).toBe(
      false,
    );
  });

  it("cancels the run on Escape in the popup", async () => {
    await startMenuUpdate(6);
    const popup = runWindow().popup!;

    popup.window.dispatchEvent(
      new popup.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    // The requests of the three items in progress are aborted (the items
    // are left as they are); no further item is started
    for (const call of mocks.lookupInspireMeta.mock.calls) {
      const signal = call[2] as AbortSignal | undefined;
      expect(signal?.aborted).toBe(true);
    }
    releaseAll();
    await settle();

    expect(mocks.lookupInspireMeta).toHaveBeenCalledTimes(3);
    expect(held).toHaveLength(0);
    expect(runWindow().closed).toBe(true);
    const stats = FakeZoteroProgressWindow.all.at(-1)!;
    expect(stats.text).toContain("update-cancelled-stats");
  });

  it("goes on when drawing the progress fails", async () => {
    await startMenuUpdate(5);
    FakeZoteroProgressWindow.drawingFails = true;

    while (held.length) {
      releaseAll();
      await settle();
    }

    expect(mocks.lookupInspireMeta).toHaveBeenCalledTimes(5);
    expect(debugLines().some((line) => line.includes("fatal error"))).toBe(
      false,
    );
    expect(
      debugLines().some((line) => line.includes("all workers finished")),
    ).toBe(true);
  });
});

describe("progress popup closed by the user", () => {
  it("lets Zotero skip the later progress lines", async () => {
    const progressWindow = openRunProgressWindow("Header", {
      onEscape: () => {},
    });
    progressWindow.createLine({
      text: "Processing 0 of 5 items...",
      progress: 0,
    });
    progressWindow.show();
    await settle();
    const zoteroWindow = runWindow();
    const popup = zoteroWindow.popup!;

    // Cmd-W in the focused popup: the window goes away, Zotero is not told
    zoteroWindow.popupGone = true;
    popup.window.dispatchEvent(new popup.dom.window.Event("unload"));

    expect(zoteroWindow.closed).toBe(true);
    expect(() =>
      progressWindow.changeLine({ text: "Processing 1 of 5 items..." }),
    ).not.toThrow();
  });
});

describe("a run started after a cancelled one", () => {
  it("does not start with the cancelled run's aborted signal", async () => {
    const inspire = new ZInspire();
    // A paper added to the library is updated at once
    inspire.updateItems([paper(1)], "full");
    await settle();
    releaseAll();
    await settle();
    // Later the user updates the selected items and cancels with Escape
    selectedItems = [paper(2), paper(3), paper(4), paper(5)];
    inspire.updateSelectedItems("full");
    await settle();
    mainDom.window.dispatchEvent(
      new mainDom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    releaseAll();
    await settle();
    expect(runWindow().closed).toBe(true);
    mocks.lookupInspireMeta.mockClear();

    // The next update does not ask INSPIRE with the aborted signal
    selectedItems = [paper(6)];
    inspire.updateSelectedItems("full");
    await settle();

    expect(mocks.lookupInspireMeta).toHaveBeenCalledTimes(1);
    const signal = mocks.lookupInspireMeta.mock.calls[0][2] as
      | AbortSignal
      | undefined;
    expect(signal?.aborted ?? false).toBe(false);
    releaseAll();
    await settle();
  });
});
