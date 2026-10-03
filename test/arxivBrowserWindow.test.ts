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
  orderWithPaneAfter,
  registerArxivBrowserMenu,
  registerArxivBrowserSidenav,
  removeArxivBrowserButton,
  unregisterArxivBrowserMenu,
  unregisterArxivBrowserSidenav,
} from "../src/modules/arxiv/browser/browserEntryPoints";
import {
  addMainWindowLabels,
  removeMainWindowLabels,
} from "../src/utils/locale";
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
let sections: {
  registerSection: ReturnType<typeof vi.fn>;
  unregisterSection: ReturnType<typeof vi.fn>;
};
let prefs: Map<string, string>;

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
  const escapedKey = (pluginID: string, id: string) =>
    `${pluginID}-${id}`.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`);
  menus = {
    registerMenu: vi.fn((options: { menuID: string; pluginID: string }) => {
      const key = escapedKey(options.pluginID, options.menuID);
      registered.add(key);
      return key;
    }),
    unregisterMenu: vi.fn((key: string) => registered.delete(key)),
  };
  // Sections are keyed the same way, by pluginID + "-" + paneID
  sections = {
    registerSection: vi.fn((options: { paneID: string; pluginID: string }) =>
      escapedKey(options.pluginID, options.paneID),
    ),
    unregisterSection: vi.fn(() => true),
  };
  prefs = new Map();
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    getMainWindow: () => main,
    getMainWindows: () => [main],
    MenuManager: menus,
    ItemPaneManager: sections,
    Notifier: {
      registerObserver: vi.fn(() => "observer"),
      unregisterObserver: vi.fn(),
    },
    Prefs: {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: string) => prefs.set(key, value),
    },
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
  unregisterArxivBrowserSidenav();
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
    const paper = {
      id: "2609.35133",
      title: "The Dπ and D*π femtoscopy puzzle",
    };
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
    expect(item.icon).toBe(
      `chrome://${config.addonRef}/content/icons/arxiv.svg`,
    );
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

  it("is a button in the item pane's side navigation, after INSPIRE's", () => {
    const inspire = "zoteroinspire\\@itp\\.ac\\.cn-zoteroinspire-references";
    prefs.set("sidenav.order", `info,abstract,${inspire},tags`);
    registerArxivBrowserSidenav(inspire);
    registerArxivBrowserSidenav(inspire);

    expect(sections.registerSection).toHaveBeenCalledTimes(1);
    const options = sections.registerSection.mock.calls[0][0];
    expect(options.pluginID).toBe(config.addonID);
    expect(options.sidenav).toEqual({
      l10nID: `${config.addonRef}-arxiv-browser-button`,
      icon: `chrome://${config.addonRef}/content/icons/arxiv-sidenav.svg`,
    });
    // The user arranged the order: the button goes right after INSPIRE's
    const pane = sections.registerSection.mock.results[0].value;
    expect(pane).toBe("zoteroinspire\\@itp\\.ac\\.cn-arxiv-browser");
    expect(prefs.get("sidenav.order")).toBe(
      `info,abstract,${inspire},${pane},tags`,
    );
    // Only the button is wanted: the section stays out of sight
    const section = main.document.createElement("item-pane-custom-section");
    const body = main.document.createElement("div");
    section.append(body);
    options.onInit({ body });
    expect(section.style.display).toBe("none");

    unregisterArxivBrowserSidenav();
    expect(sections.unregisterSection).toHaveBeenCalledWith(pane);
  });

  it("finds the button's place in the side navigation order once", () => {
    expect(orderWithPaneAfter("a,inspire,b", "arxiv", "inspire")).toBe(
      "a,inspire,arxiv,b",
    );
    expect(orderWithPaneAfter("a,inspire", "arxiv", "inspire")).toBe(
      "a,inspire,arxiv",
    );
    // Not arranged yet: Zotero adds the button after INSPIRE's by itself
    expect(orderWithPaneAfter(undefined, "arxiv", "inspire")).toBeNull();
    expect(orderWithPaneAfter("", "arxiv", "inspire")).toBeNull();
    // Placed already (perhaps moved by the user), or no INSPIRE to follow
    expect(
      orderWithPaneAfter("arxiv,a,inspire", "arxiv", "inspire"),
    ).toBeNull();
    expect(orderWithPaneAfter("a,b", "arxiv", "inspire")).toBeNull();
  });

  it("opens the browser from the side navigation button", () => {
    registerArxivBrowserSidenav();
    const pane = sections.registerSection.mock.results[0].value as string;
    const doc = main.document;
    doc.body.insertAdjacentHTML(
      "beforeend",
      `<item-pane-sidenav>
        <div class="inherit-flex">
          <div class="pin-wrapper"><div class="btn" id="arxiv"></div></div>
          <div class="pin-wrapper"><div class="btn" data-pane="tags"></div></div>
        </div>
        <div class="context-menu">
          <div class="zotero-menuitem-pin"></div>
          <div class="zotero-menuitem-unpin"></div>
          <div class="zotero-menuitem-pin-separator"></div>
          <div class="zotero-menuitem-reorder-up"></div>
        </div>
      </item-pane-sidenav>`,
    );
    const sidenav = doc.querySelector("item-pane-sidenav")!;
    const button = doc.getElementById("arxiv")!;
    button.dataset.pane = pane;
    const tags = doc.querySelector<HTMLElement>('[data-pane="tags"]')!;
    const menu = doc.querySelector(".context-menu")!;
    // What Zotero's side navigation itself receives
    const zoteroClicks: Element[] = [];
    sidenav.addEventListener("click", (event) =>
      zoteroClicks.push(event.target as Element),
    );
    const open = vi.fn();
    addArxivBrowserButton(main as unknown as Window, open);
    addArxivBrowserButton(main as unknown as Window, open);
    const click = (target: Element, detail: number) =>
      target.dispatchEvent(
        new main.MouseEvent("click", { bubbles: true, detail, button: 0 }),
      );

    // A click opens the browser, once per double click, and never reaches
    // Zotero, which would go to the (hidden) section or pin it
    click(button, 1);
    expect(open).toHaveBeenCalledTimes(1);
    click(button, 1);
    click(button, 2);
    expect(open).toHaveBeenCalledTimes(2);
    expect(zoteroClicks).toEqual([]);
    click(tags, 1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(zoteroClicks).toEqual([tags]);

    // Its context menu has no pin items, the other buttons' menus keep them
    const hiddenItems = () =>
      [...menu.children]
        .filter((item) => (item as HTMLElement).hidden)
        .map((item) => item.className);
    const rightClick = (target: Element) => {
      for (const item of menu.children) (item as HTMLElement).hidden = false;
      target.dispatchEvent(
        new main.MouseEvent("contextmenu", { bubbles: true }),
      );
      menu.dispatchEvent(new main.Event("popupshowing", { bubbles: true }));
    };
    rightClick(button);
    expect(hiddenItems()).toEqual([
      "zotero-menuitem-pin",
      "zotero-menuitem-unpin",
      "zotero-menuitem-pin-separator",
    ]);
    rightClick(tags);
    expect(hiddenItems()).toEqual([]);

    // Removed from the window, the button is Zotero's again
    removeArxivBrowserButton(main as unknown as Window);
    click(button, 1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(zoteroClicks).toEqual([tags, button]);
  });

  it("has its labels loaded into the main window, and removed again", () => {
    const insertFTLIfNeeded = vi.fn((name: string) => {
      const link = main.document.createElement("link");
      link.rel = "localization";
      link.setAttribute("href", name);
      main.document.head.append(link);
    });
    (main as any).MozXULElement = { insertFTLIfNeeded };

    addMainWindowLabels(main as unknown as Window);
    expect(insertFTLIfNeeded).toHaveBeenCalledWith(
      `${config.addonRef}-mainWindow.ftl`,
    );

    removeMainWindowLabels(main as unknown as Window);
    expect(main.document.querySelector('link[rel="localization"]')).toBeNull();
  });
});
