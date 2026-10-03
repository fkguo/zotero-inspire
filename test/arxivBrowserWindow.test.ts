import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import {
  getArxivApiScheduler,
  getArxivWebScheduler,
} from "../src/modules/arxiv/arxivFetch";
import {
  ARXIV_BROWSER_URL,
  closeArxivBrowser,
  onArxivBrowserLoad,
  onArxivBrowserUnload,
  openArxivBrowser,
} from "../src/modules/arxiv/browser/browserWindow";
import {
  addArxivBrowserButton,
  ARXIV_BROWSER_BUTTON_ID,
  registerArxivBrowserMenu,
  removeArxivBrowserButton,
  unregisterArxivBrowserMenu,
} from "../src/modules/arxiv/browser/browserEntryPoints";
import type { ArxivBrowserViewOptions } from "../src/modules/arxiv/browser/ArxivBrowserView";
import {
  followItems,
  itemsWithArxivIds,
} from "../src/modules/arxiv/browser/browserLibrary";
import { onLibraryIndexChange } from "../src/modules/inspire/library/arxivIndex";

// The options the window gives the content it builds
const views = vi.hoisted(() => ({ options: [] as ArxivBrowserViewOptions[] }));
vi.mock(
  "../src/modules/arxiv/browser/ArxivBrowserView",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("../src/modules/arxiv/browser/ArxivBrowserView")
      >();
    class RecordedView extends real.ArxivBrowserView {
      constructor(root: HTMLElement, options: ArxivBrowserViewOptions = {}) {
        super(root, options);
        views.options.push(options);
      }
    }
    return { ...real, ArxivBrowserView: RecordedView };
  },
);

// The arXiv browser window: one at a time, opened from the View menu or the
// toolbar button of the main window, its content built on load, and its
// requests cancelled however it closes. "main" stands in for Zotero's main
// window, "browser" for the window arxivBrowser.xhtml opens in.

let main: DOMWindow;
let browser: DOMWindow;
let openDialog: ReturnType<typeof vi.fn>;
let mediator: { getMostRecentWindow: ReturnType<typeof vi.fn> };
let menus: {
  registerMenu: ReturnType<typeof vi.fn>;
  unregisterMenu: ReturnType<typeof vi.fn>;
};

function newWindow(html: string): DOMWindow {
  return new JSDOM(html, { url: "https://zotero.test/" }).window;
}

beforeEach(() => {
  views.options.length = 0;
  main = newWindow(`<!DOCTYPE html><html><head></head><body>
    <div id="zotero-tabs-toolbar">
      <button id="zotero-tb-tabs-menu"></button>
      <button id="zotero-tb-sync"></button>
    </div></body></html>`);
  (main.document as any).createXULElement = (tag: string) =>
    main.document.createElement(tag);
  browser = newWindow(
    `<!DOCTYPE html><html><body><div id="arxiv-browser-root"></div></body></html>`,
  );
  vi.spyOn(browser, "focus").mockImplementation(() => undefined);
  vi.spyOn(browser, "close").mockImplementation(() => undefined);
  openDialog = vi.fn(() => browser);
  (main as any).openDialog = openDialog;
  mediator = { getMostRecentWindow: vi.fn(() => null) };
  // Zotero keys a menu by CSS.escape(pluginID + "-" + menuID)
  // (pluginAPIBase.mjs _namespacedMainKey); jsdom has no CSS.escape, and
  // for these IDs it escapes the "@" and "." of the plugin's ID
  const registered = new Set<string>();
  menus = {
    registerMenu: vi.fn((options: { menuID: string; pluginID: string }) => {
      const key = `${options.pluginID}-${options.menuID}`.replace(
        /[^A-Za-z0-9_-]/g,
        (char) => `\\${char}`,
      );
      registered.add(key);
      return key;
    }),
    unregisterMenu: vi.fn((key: string) => registered.delete(key)),
  };
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    getMainWindow: () => main,
    getMainWindows: () => [main],
    MenuManager: menus,
    Notifier: {
      registerObserver: vi.fn(() => "observer"),
      unregisterObserver: vi.fn(),
    },
    Prefs: { get: () => undefined, set: vi.fn() },
  });
  vi.stubGlobal("Services", { wm: mediator });
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
});

afterEach(() => {
  // Leave no window behind for the next test
  closeArxivBrowser();
  unregisterArxivBrowserMenu();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function schedulerSpies() {
  return {
    web: vi.spyOn(getArxivWebScheduler(), "cancelAll"),
    api: vi.spyOn(getArxivApiScheduler(), "cancelAll"),
  };
}

describe("arXiv browser window", () => {
  it("opens as a window of its own, and only once", () => {
    openArxivBrowser();
    openArxivBrowser();

    expect(openDialog).toHaveBeenCalledTimes(1);
    const [url, name, features] = openDialog.mock.calls[0];
    expect(url).toBe(ARXIV_BROWSER_URL);
    expect(url).toBe(`chrome://${config.addonRef}/content/arxivBrowser.xhtml`);
    expect(name).toBe("_blank");
    expect(features.split(",")).toEqual(
      expect.arrayContaining(["chrome", "resizable", "dialog=no"]),
    );
    // The second request brings the open window to the front
    expect(browser.focus).toHaveBeenCalledTimes(1);
  });

  it("brings a loaded window to the front, found by its window type", () => {
    onArxivBrowserLoad(browser as unknown as Window, () => ({
      dispose: vi.fn(),
    }));
    // The window is known to Zotero's window mediator once it has loaded
    mediator.getMostRecentWindow.mockImplementation((type: string) =>
      type === `${config.addonRef}:arxiv-browser` ? browser : null,
    );

    openArxivBrowser();

    expect(openDialog).not.toHaveBeenCalled();
    expect(browser.focus).toHaveBeenCalledTimes(1);
  });

  it("opens a new window after the previous one was closed", () => {
    openArxivBrowser();
    onArxivBrowserLoad(browser as unknown as Window, () => ({
      dispose: vi.fn(),
    }));
    onArxivBrowserUnload(browser as unknown as Window);

    openArxivBrowser();

    expect(openDialog).toHaveBeenCalledTimes(2);
  });

  it("opened at a paper, shows its HTML version once the window has loaded", () => {
    const showHtml = vi.fn();
    const paper = { id: "2609.35133", title: "The Dπ and D*π femtoscopy puzzle" };
    openArxivBrowser(paper);
    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(showHtml).not.toHaveBeenCalled();

    onArxivBrowserLoad(browser as unknown as Window, () => ({
      showHtml,
      dispose: vi.fn(),
    }));

    expect(showHtml).toHaveBeenCalledTimes(1);
    expect(showHtml).toHaveBeenCalledWith(paper);
  });

  it("asked for a paper while open, brings the window to the front and shows it", () => {
    const showHtml = vi.fn();
    openArxivBrowser();
    // Asked again while the window loads: the last paper asked for
    openArxivBrowser({ id: "2609.00001" });
    openArxivBrowser({ id: "2609.00002" });
    onArxivBrowserLoad(browser as unknown as Window, () => ({
      showHtml,
      dispose: vi.fn(),
    }));
    expect(showHtml.mock.calls).toEqual([[{ id: "2609.00002" }]]);

    openArxivBrowser({ id: "hep-ph/0101001" });

    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(showHtml).toHaveBeenLastCalledWith({ id: "hep-ph/0101001" });
    expect(browser.focus).toHaveBeenCalledTimes(3);
  });

  it("forgets the paper asked for when the window closes before it loaded", () => {
    const showHtml = vi.fn();
    openArxivBrowser({ id: "2609.00001" });
    closeArxivBrowser();

    openArxivBrowser();
    onArxivBrowserLoad(browser as unknown as Window, () => ({
      showHtml,
      dispose: vi.fn(),
    }));

    expect(showHtml).not.toHaveBeenCalled();
  });

  it("builds its content into the window when it loads", () => {
    onArxivBrowserLoad(browser as unknown as Window);

    const root = browser.document.getElementById("arxiv-browser-root")!;
    expect(root.querySelector(".arxiv-browser__list")).not.toBeNull();
    expect(root.querySelector(".arxiv-browser__detail")).not.toBeNull();
    // Without subscriptions it offers to make one
    const empty = root.querySelector(".arxiv-browser__empty")!;
    expect(empty.firstChild?.textContent).toBe(
      `${config.addonRef}-arxiv-browser-empty`,
    );
    const makeNew = empty.querySelector("button")!;
    expect(makeNew.textContent).toBe(
      `${config.addonRef}-arxiv-browser-subscription-new`,
    );
    makeNew.dispatchEvent(new browser.MouseEvent("click"));
    expect(root.querySelector(".arxiv-browser__editor")).not.toBeNull();
  });

  it("gives its content the library index and the library's items, for the marks and PDF buttons", () => {
    onArxivBrowserLoad(browser as unknown as Window);

    expect(views.options).toHaveLength(1);
    expect(views.options[0].inLibrary).toBe(itemsWithArxivIds);
    expect(views.options[0].followLibrary).toBe(onLibraryIndexChange);
    expect(views.options[0].followItems).toBe(followItems);
  });

  it("closed by hand, stops its content and cancels the queued requests", () => {
    const dispose = vi.fn();
    const spies = schedulerSpies();
    openArxivBrowser();
    onArxivBrowserLoad(browser as unknown as Window, () => ({ dispose }));

    onArxivBrowserUnload(browser as unknown as Window);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(spies.web).toHaveBeenCalledTimes(1);
    expect(spies.api).toHaveBeenCalledTimes(1);
  });

  it("is closed, its requests cancelled, when the plugin is disabled or the main window closes", () => {
    const dispose = vi.fn();
    const spies = schedulerSpies();
    openArxivBrowser();
    onArxivBrowserLoad(browser as unknown as Window, () => ({ dispose }));

    closeArxivBrowser();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(spies.web).toHaveBeenCalledTimes(1);
    expect(spies.api).toHaveBeenCalledTimes(1);
    // The window's own unload, which follows, changes nothing more
    onArxivBrowserUnload(browser as unknown as Window);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("stops the request in flight and the one waiting for its turn", async () => {
    // Zotero.HTTP.request that answers only when cancelled
    class CancelledException extends Error {}
    const cancellers: Array<() => void> = [];
    (globalThis as any).Zotero.HTTP = {
      CancelledException,
      TimeoutException: class extends Error {},
      BrowserOfflineException: class extends Error {},
      request: vi.fn(
        (_method: string, _url: string, options: any) =>
          new Promise((_resolve, reject) => {
            options.cancellerReceiver(() => reject(new CancelledException()));
            cancellers.push(() => reject(new CancelledException()));
          }),
      ),
    };
    const scheduler = getArxivWebScheduler();
    const outcome = (url: string) =>
      scheduler.request(url).then(
        () => "answered",
        (error: { kind?: string }) => error.kind,
      );
    const inFlight = outcome("https://arxiv.org/list/hep-ph/new");
    const waiting = outcome("https://arxiv.org/list/hep-lat/new");
    openArxivBrowser();
    onArxivBrowserLoad(browser as unknown as Window, () => ({
      dispose: vi.fn(),
    }));
    await vi.waitFor(() => expect(cancellers).toHaveLength(1));

    closeArxivBrowser();

    expect(await inFlight).toBe("cancelled");
    expect(await waiting).toBe("cancelled");
    expect((globalThis as any).Zotero.HTTP.request).toHaveBeenCalledTimes(1);
  });
});

describe("where the arXiv browser opens from", () => {
  it("is an item of the main window's View menu", () => {
    const open = vi.fn();
    registerArxivBrowserMenu(open);
    registerArxivBrowserMenu(open);

    expect(menus.registerMenu).toHaveBeenCalledTimes(1);
    const options = menus.registerMenu.mock.calls[0][0];
    expect(options.target).toBe("main/menubar/view");
    expect(options.pluginID).toBe(config.addonID);
    const item = options.menus.find(
      (menu: { menuType: string }) => menu.menuType === "menuitem",
    );
    expect(item.l10nID).toBe(`${config.addonRef}-arxiv-browser-menuitem`);
    item.onCommand(new main.Event("command"), {});
    expect(open).toHaveBeenCalledTimes(1);

    expect(menus.registerMenu.mock.results[0].value).toBe(
      "zoteroinspire\\@itp\\.ac\\.cn-zoteroinspire-arxiv-browser-menu",
    );
    unregisterArxivBrowserMenu();
    expect(menus.unregisterMenu).toHaveBeenCalledTimes(1);
    expect(menus.unregisterMenu.mock.results[0].value).toBe(true);
    // Enabled again, the plugin adds the item again
    registerArxivBrowserMenu(open);
    expect(menus.registerMenu).toHaveBeenCalledTimes(2);
  });

  it("is a button in the tabs toolbar, added once per main window", () => {
    const open = vi.fn();
    addArxivBrowserButton(main as unknown as Window, open);
    addArxivBrowserButton(main as unknown as Window, open);

    const buttons = main.document.querySelectorAll(
      `#${ARXIV_BROWSER_BUTTON_ID}`,
    );
    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLElement;
    expect(button.nextElementSibling?.id).toBe("zotero-tb-sync");
    expect(button.getAttribute("data-l10n-id")).toBe(
      `${config.addonRef}-arxiv-browser-button`,
    );
    button.dispatchEvent(new main.Event("command"));
    expect(open).toHaveBeenCalledTimes(1);

    removeArxivBrowserButton(main as unknown as Window);
    expect(main.document.getElementById(ARXIV_BROWSER_BUTTON_ID)).toBeNull();
  });

  it("loads its labels into the main window, and removes them again", () => {
    const insertFTLIfNeeded = vi.fn((name: string) => {
      const link = main.document.createElement("link");
      link.rel = "localization";
      link.setAttribute("href", name);
      main.document.head.append(link);
    });
    (main as any).MozXULElement = { insertFTLIfNeeded };

    addArxivBrowserButton(main as unknown as Window, vi.fn());
    expect(insertFTLIfNeeded).toHaveBeenCalledWith(
      `${config.addonRef}-mainWindow.ftl`,
    );

    removeArxivBrowserButton(main as unknown as Window);
    expect(main.document.querySelector('link[rel="localization"]')).toBeNull();
  });
});
