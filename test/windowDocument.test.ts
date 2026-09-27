import { readFileSync } from "node:fs";
import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import {
  invalidateDarkModeCache,
  isDarkMode,
} from "../src/modules/inspire/styles";
import {
  renderMathContent,
  resetKatexState,
} from "../src/modules/inspire/mathRenderer";
import { HoverPreviewRenderer } from "../src/modules/inspire/panel/HoverPreviewRenderer";
import { HoverPreviewController } from "../src/modules/inspire/panel/HoverPreviewController";
import {
  AuthorPreviewController,
  authorSearchUrls,
} from "../src/modules/inspire/panel/AuthorPreviewController";
import { showAbstractContextMenu } from "../src/modules/inspire/panel/abstractContextMenu";
import { EntryListRenderer } from "../src/modules/inspire/panel/EntryListRenderer";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import {
  showTargetPickerUI,
  type SaveTargetRow,
} from "../src/modules/pickerUI";
import { InspireReferencePanelController } from "../src/modules/zinspire";

// The panel's UI helpers show their overlays, cards, menus and notices in the
// main Zotero window, where the References panel lives. These tests fix that
// behaviour for the panel: "main" is a jsdom window standing in for the main
// Zotero window, and every element the panel shows belongs to it. Each helper
// can instead be given another window of its own ("second"), where it then
// shows everything; the last part of this file checks that.

const profiles = vi.hoisted(() => ({ fetchAuthorProfile: vi.fn() }));
vi.mock(
  "../src/modules/inspire/authorProfileService",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/modules/inspire/authorProfileService")
    >()),
    ...profiles,
  }),
);
const network = vi.hoisted(() => ({ inspireFetch: vi.fn() }));
vi.mock("../src/modules/inspire/rateLimiter", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/inspire/rateLimiter")
  >()),
  ...network,
}));

let main: DOMWindow;
let copied: ReturnType<typeof vi.fn>;
let prefs: Record<string, unknown>;

function newWindow(): DOMWindow {
  return new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://zotero.test/",
  }).window;
}

beforeEach(() => {
  main = newWindow();
  copied = vi.fn();
  prefs = {};
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    getMainWindow: () => main,
    launchURL: vi.fn(),
    Prefs: { get: (key: string) => prefs[key] },
    Libraries: { getAll: () => [] },
    DB: { queryAsync: async () => [] },
    Utilities: { Internal: { copyTextToClipboard: copied } },
  });
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
  invalidateDarkModeCache();
  resetKatexState();
  profiles.fetchAuthorProfile.mockReset();
  network.inspireFetch.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

/** The text getString() returns for a message under the locale stub above. */
function msg(key: string) {
  return `${config.addonRef}-${key}`;
}

/** Zotero marks its theme on the root element of each window. */
function setTheme(win: DOMWindow, theme: "dark" | "light") {
  win.document.documentElement.setAttribute(
    "zotero-platform-darkmode",
    theme === "dark" ? "true" : "false",
  );
  invalidateDarkModeCache();
}

/** A colour as the window's style declarations report it. */
function css(win: DOMWindow, color: string) {
  const probe = win.document.createElement("div");
  probe.style.color = color;
  return probe.style.color;
}

function setViewport(win: DOMWindow, width: number, height: number) {
  const root = win.document.documentElement;
  Object.defineProperty(root, "clientWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(root, "clientHeight", {
    value: height,
    configurable: true,
  });
}

function placeAt(
  el: Element,
  box: { left: number; top: number; width: number; height: number },
) {
  const rect = {
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
  };
  el.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
}

function paper(
  fields: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id: "0-100",
    recid: "100",
    title: "Hidden-charm pentaquarks",
    year: "2024",
    authors: ["Guo, Feng-Kun"],
    authorText: "Guo, Feng-Kun",
    displayText: "",
    searchText: "",
    abstract: "",
    ...fields,
  };
}

describe("dark mode", () => {
  it("reads the theme of the main window", () => {
    setTheme(main, "dark");
    expect(isDarkMode()).toBe(true);
    setTheme(main, "light");
    expect(isDarkMode()).toBe(false);
    main.document.documentElement.removeAttribute("zotero-platform-darkmode");
    main.document.documentElement.setAttribute("data-color-scheme", "dark");
    invalidateDarkModeCache();
    expect(isDarkMode()).toBe(true);
  });

  it("keeps the value it read for a moment, until told the theme changed", () => {
    setTheme(main, "dark");
    expect(isDarkMode()).toBe(true);
    main.document.documentElement.setAttribute(
      "zotero-platform-darkmode",
      "false",
    );
    expect(isDarkMode()).toBe(true);
    invalidateDarkModeCache();
    expect(isDarkMode()).toBe(false);
  });
});

describe("save-target picker in the References panel", () => {
  const TARGETS: SaveTargetRow[] = [
    {
      id: "L1",
      name: "My Library",
      level: 0,
      type: "library",
      libraryID: 1,
      filesEditable: true,
    },
  ];

  function openPicker() {
    const doc = main.document;
    const body = doc.createElement("div");
    const listEl = doc.createElement("div");
    const anchor = doc.createElement("button");
    body.append(listEl, anchor);
    doc.body.appendChild(body);
    setViewport(main, 1000, 800);
    placeAt(anchor, { left: 100, top: 50, width: 20, height: 20 });
    const picked = showTargetPickerUI(TARGETS, null, anchor, body, listEl);
    const overlay = doc.querySelector(
      ".zinspire-collection-picker__overlay",
    ) as HTMLElement;
    const panel = overlay.querySelector(
      ".zinspire-collection-picker",
    ) as HTMLElement;
    return { doc, picked, overlay, panel };
  }

  it("covers the main window and sits below its button there", async () => {
    const { doc, picked, overlay, panel } = openPicker();
    // (Compared by identity: vitest would walk two jsdom elements)
    expect(overlay.parentElement === doc.documentElement).toBe(true);
    expect(panel.style.top).toBe("75px");
    expect(panel.style.left).toBe("80px");

    // Escape pressed in the main window closes it without a choice
    doc.dispatchEvent(new main.KeyboardEvent("keydown", { key: "Escape" }));
    expect(await picked).toBeNull();
    expect(
      doc.querySelector(".zinspire-collection-picker__overlay"),
    ).toBeNull();
  });

  it("takes its colours from the main window's theme", async () => {
    setTheme(main, "dark");
    const dark = openPicker();
    expect(dark.panel.style.backgroundColor).toBe(css(main, "#1e1e1e"));
    dark.doc.dispatchEvent(
      new main.KeyboardEvent("keydown", { key: "Escape" }),
    );
    await dark.picked;

    setTheme(main, "light");
    const light = openPicker();
    expect(light.panel.style.backgroundColor).toBe(css(main, "#fff"));
    light.doc.dispatchEvent(
      new main.KeyboardEvent("keydown", { key: "Escape" }),
    );
    await light.picked;
  });
});

describe("formula stylesheet", () => {
  /** Stand-ins for KaTeX, as loaded into the main window. */
  function fakeKatex(win: DOMWindow) {
    const render = vi.fn((el: HTMLElement) => {
      el.innerHTML = '<span class="katex">m</span>';
    });
    Object.assign(win, {
      katex: { render: vi.fn(), renderToString: vi.fn() },
      renderMathInElement: render,
    });
    return render;
  }
  const stylesheets = (win: DOMWindow) =>
    win.document.querySelectorAll('link[href*="katex.min.css"]').length;

  it("is added once to the main window for formulas shown there", async () => {
    prefs[`${config.prefsPrefix}.latex_render_mode`] = "katex";
    const render = fakeKatex(main);
    const title = main.document.createElement("div");
    const abstract = main.document.createElement("div");
    main.document.body.append(title, abstract);

    await renderMathContent("The mass $m_\\pi$", title);
    await renderMathContent("Width $\\Gamma$", abstract);

    expect(render).toHaveBeenCalledTimes(2);
    expect(stylesheets(main)).toBe(1);
    expect(title.querySelector(".katex")).not.toBeNull();
  });

  it("follows the latex_render_mode setting", async () => {
    prefs[`${config.prefsPrefix}.latex_render_mode`] = "unicode";
    const render = fakeKatex(main);
    const title = main.document.createElement("div");
    main.document.body.appendChild(title);

    await renderMathContent("The mass $m_\\pi$", title);

    expect(render).not.toHaveBeenCalled();
    expect(stylesheets(main)).toBe(0);
    expect(title.textContent).not.toContain("$");
  });
});

describe("hover card of the References panel", () => {
  it("is placed within the main window's viewport", () => {
    setViewport(main, 1000, 800);
    const renderer = new HoverPreviewRenderer({ document: main.document });
    const card = renderer.createCard();
    main.document.body.appendChild(card);
    const row = main.document.createElement("div");
    main.document.body.appendChild(row);
    placeAt(row, { left: 100, top: 200, width: 200, height: 40 });

    // Room on the right of the row: the card goes there
    renderer.positionRelativeToRow(card, row);
    expect([card.style.left, card.style.top]).toEqual(["308px", "200px"]);

    // Anchored to a button in the lower half: the card grows upward from it
    renderer.positionRelativeToRect(card, {
      left: 100,
      top: 500,
      right: 120,
      bottom: 520,
    });
    expect([card.style.left, card.style.bottom]).toEqual(["128px", "308px"]);
  });

  it("copies the text selected in the main window on Ctrl+C", async () => {
    const controller = new HoverPreviewController({
      document: main.document,
      container: main.document.body,
      showDelay: 0,
    });
    try {
      const row = main.document.createElement("div");
      main.document.body.appendChild(row);
      placeAt(row, { left: 100, top: 200, width: 200, height: 40 });
      controller.scheduleShow(paper(), row);
      await vi.waitFor(() => expect(controller.isVisible()).toBe(true));
      main.getSelection = () => ({ toString: () => "hidden-charm" }) as any;

      const event = new main.KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        cancelable: true,
      });
      main.document.dispatchEvent(event);

      await vi.waitFor(() =>
        expect(copied).toHaveBeenCalledWith("hidden-charm"),
      );
      expect(event.defaultPrevented).toBe(true);
    } finally {
      controller.dispose();
    }
  });
});

describe("abstract context menu of the References panel", () => {
  /** A panel controller with what the menu uses; Zotero's XUL menus faked. */
  function panelController() {
    const doc = main.document as any;
    doc.createXULElement = (tag: string) => {
      const el = doc.createElement(tag);
      el.openPopupAtScreen = vi.fn();
      return el;
    };
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      showToast: vi.fn(),
      hoverPreview: { setContextMenuOpen: vi.fn() },
      scheduleTooltipHide: vi.fn(),
      abstractContextMenuOpen: false,
    });
    return controller;
  }

  it("opens in the main window and copies the abstract", async () => {
    prefs[`${config.prefsPrefix}.latex_render_mode`] = "katex";
    const controller = panelController();
    const abstract = main.document.createElement("div");
    abstract.textContent = "The width $\\Gamma$ is small.";
    abstract.dataset.latexSource = "The width $\\Gamma$ is small.";
    main.document.body.appendChild(abstract);

    controller.showAbstractContextMenu(
      new main.MouseEvent("contextmenu", { screenX: 40, screenY: 60 }),
      abstract,
    );

    const popup = main.document.getElementById(
      "zinspire-abstract-context-popup",
    ) as any;
    expect(popup.parentElement === main.document.documentElement).toBe(true);
    expect(popup.openPopupAtScreen).toHaveBeenCalledWith(40, 60, true);
    const items = [...popup.children] as HTMLElement[];
    expect(items.map((item) => item.getAttribute("label"))).toEqual([
      msg("references-panel-abstract-copy"),
      msg("references-panel-abstract-copy-latex"),
    ]);
    // The hover card stays open while the menu is
    expect(controller.hoverPreview.setContextMenuOpen).toHaveBeenLastCalledWith(
      true,
    );

    items[1].dispatchEvent(new main.Event("command"));
    await vi.waitFor(() =>
      expect(controller.showToast).toHaveBeenCalledWith(
        msg("references-panel-abstract-latex-copied"),
      ),
    );
    expect(copied).toHaveBeenCalledWith("The width $\\Gamma$ is small.");

    popup.dispatchEvent(new main.Event("popuphidden"));
    expect(
      main.document.getElementById("zinspire-abstract-context-popup"),
    ).toBeNull();
    expect(controller.abstractContextMenuOpen).toBe(false);
    expect(controller.hoverPreview.setContextMenuOpen).toHaveBeenLastCalledWith(
      false,
    );
    expect(controller.scheduleTooltipHide).toHaveBeenCalled();
  });
});

describe("notices of the References panel", () => {
  it("are popups next to the main window that close after 3 s", () => {
    const shownPopups: any[] = [];
    vi.stubGlobal("ztoolkit", {
      ProgressWindow: class {
        calls: unknown[][] = [];
        win = {
          changeHeadline: (...args: unknown[]) =>
            this.calls.push(["changeHeadline", ...args]),
        };
        constructor(...args: unknown[]) {
          this.calls.push(["new", ...args]);
          shownPopups.push(this);
        }
        createLine(...args: unknown[]) {
          this.calls.push(["createLine", ...args]);
          return this;
        }
        show(...args: unknown[]) {
          this.calls.push(["show", ...args]);
          return this;
        }
        startCloseTimer(...args: unknown[]) {
          this.calls.push(["startCloseTimer", ...args]);
          return this;
        }
      },
    });
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;

    controller.showToast("Added to your library");

    expect(shownPopups).toHaveLength(1);
    expect(shownPopups[0].calls).toEqual([
      ["new", config.addonName, { closeOnClick: true }],
      [
        "changeHeadline",
        config.addonName,
        `chrome://${config.addonRef}/content/icons/inspire-icon.png`,
      ],
      ["createLine", { text: "Added to your library" }],
      ["show"],
      ["startCloseTimer", 3000],
    ]);
  });
});

describe("author card of the References panel", () => {
  it("shows the INSPIRE profile, its links coloured by the main window's theme", async () => {
    setTheme(main, "dark");
    profiles.fetchAuthorProfile.mockResolvedValue({
      recid: "1011",
      name: "Feng-Kun Guo",
      bai: "F.K.Guo.1",
    });
    const onViewPapers = vi.fn();
    const author = new AuthorPreviewController({
      document: main.document,
      container: main.document.body,
      showDelay: 0,
      callbacks: { onViewPapers },
    });
    try {
      const anchor = main.document.createElement("a");
      main.document.body.appendChild(anchor);
      placeAt(anchor, { left: 100, top: 50, width: 60, height: 14 });

      author.scheduleShow(
        paper({
          authorSearchInfos: [{ fullName: "Guo, Feng-Kun", bai: "F.K.Guo.1" }],
        }),
        0,
        anchor,
      );

      const card = () =>
        main.document.querySelector(
          ".zinspire-author-preview-card",
        ) as HTMLElement;
      await vi.waitFor(() => expect(card()?.textContent).toContain("INSPIRE"));
      expect(profiles.fetchAuthorProfile.mock.calls[0][0]).toEqual({
        fullName: "Guo, Feng-Kun",
        bai: "F.K.Guo.1",
        recid: undefined,
      });
      expect(card().textContent).toContain("Feng-Kun Guo (F.K.Guo.1)");
      const links = [...card().querySelectorAll("a")] as HTMLAnchorElement[];
      expect(links.map((a) => a.textContent)).toEqual([
        "INSPIRE",
        msg("references-panel-author-preview-view-papers"),
      ]);
      expect(links[0].href).toBe("https://inspirehep.net/authors/1011");
      expect(links[0].style.color).toBe(css(main, "#60a5fa"));
    } finally {
      author.dispose();
    }
  });
});

describe("in a window of its own", () => {
  let second: DOMWindow;
  beforeEach(() => {
    second = newWindow();
  });

  it("dark mode is read and kept per window", () => {
    setTheme(main, "dark");
    setTheme(second, "light");
    expect(isDarkMode()).toBe(true);
    expect(isDarkMode(main.document)).toBe(true);
    expect(isDarkMode(second.document)).toBe(false);

    // Each window's reading is kept until told the theme changed
    second.document.documentElement.setAttribute(
      "zotero-platform-darkmode",
      "true",
    );
    expect(isDarkMode(second.document)).toBe(false);
    invalidateDarkModeCache();
    expect(isDarkMode(second.document)).toBe(true);
    expect(isDarkMode()).toBe(true);
  });

  it("the save-target picker covers that window, placed and coloured by it", async () => {
    setTheme(main, "light");
    setTheme(second, "dark");
    setViewport(main, 1000, 800);
    setViewport(second, 600, 400);
    const doc = second.document;
    const body = doc.createElement("div");
    const listEl = doc.createElement("div");
    const anchor = doc.createElement("button");
    body.append(listEl, anchor);
    doc.body.appendChild(body);
    placeAt(anchor, { left: 500, top: 300, width: 20, height: 20 });

    const picked = showTargetPickerUI(
      [
        {
          id: "L1",
          name: "My Library",
          level: 0,
          type: "library",
          libraryID: 1,
          filesEditable: true,
        },
      ],
      null,
      anchor,
      body,
      listEl,
      { document: doc },
    );

    expect(
      main.document.querySelector(".zinspire-collection-picker__overlay"),
    ).toBeNull();
    const overlay = doc.querySelector(
      ".zinspire-collection-picker__overlay",
    ) as HTMLElement;
    expect(overlay.parentElement === doc.documentElement).toBe(true);
    const panel = overlay.querySelector(
      ".zinspire-collection-picker",
    ) as HTMLElement;
    // Too close to the right edge and no room above or below the button in a
    // 600 x 400 window: pulled left, and centred vertically
    expect([panel.style.left, panel.style.top]).toEqual(["160px", "50px"]);
    expect(panel.style.backgroundColor).toBe(css(second, "#1e1e1e"));

    // Escape in the main window is not for it; Escape in its window is
    main.document.dispatchEvent(
      new main.KeyboardEvent("keydown", { key: "Escape" }),
    );
    expect(
      doc.querySelector(".zinspire-collection-picker__overlay"),
    ).not.toBeNull();
    doc.dispatchEvent(new second.KeyboardEvent("keydown", { key: "Escape" }));
    expect(await picked).toBeNull();
  });

  it("the formula stylesheet is added to that window", async () => {
    prefs[`${config.prefsPrefix}.latex_render_mode`] = "katex";
    Object.assign(main, {
      katex: { render: vi.fn(), renderToString: vi.fn() },
      renderMathInElement: (el: HTMLElement) => {
        el.innerHTML = '<span class="katex">m</span>';
      },
    });
    const title = second.document.createElement("div");
    second.document.body.appendChild(title);

    await renderMathContent("The mass $m_\\pi$", title);

    const sheets = (win: DOMWindow) =>
      win.document.querySelectorAll('link[href*="katex.min.css"]').length;
    expect([sheets(main), sheets(second)]).toEqual([0, 1]);
  });

  it("KaTeX loaded in the main window renders formulas into that window", async () => {
    // The real KaTeX, loaded the way Zotero loads it: into the main window
    main = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
      url: "https://zotero.test/",
      runScripts: "outside-only",
    }).window;
    const loadSubScript = vi.fn((url: string, win: DOMWindow) => {
      const file = url.replace(
        `chrome://${config.addonRef}/content/`,
        "addon/content/",
      );
      win.eval(readFileSync(file, "utf8"));
    });
    vi.stubGlobal("Services", { scriptloader: { loadSubScript } });
    prefs[`${config.prefsPrefix}.latex_render_mode`] = "katex";
    const abstract = second.document.createElement("div");
    second.document.body.appendChild(abstract);

    await renderMathContent("A width $\\Gamma \\ll m_\\pi$ at rest.", abstract);

    expect(loadSubScript.mock.calls.map(([, win]) => win === main)).toEqual([
      true,
      true,
    ]);
    const formula = abstract.querySelector(".katex") as HTMLElement;
    expect(formula).not.toBeNull();
    expect(formula.ownerDocument === second.document).toBe(true);
    expect(abstract.textContent).toContain("A width ");
    expect(abstract.textContent).not.toContain("$");
  });

  it("the hover card is placed within that window's viewport", () => {
    setViewport(main, 1000, 800);
    setViewport(second, 500, 800);
    const renderer = new HoverPreviewRenderer({ document: second.document });
    const card = renderer.createCard();
    second.document.body.appendChild(card);
    const row = second.document.createElement("div");
    second.document.body.appendChild(row);
    placeAt(row, { left: 100, top: 200, width: 200, height: 40 });

    // No room for the card on either side of the row: it goes below it
    renderer.positionRelativeToRow(card, row);
    expect([card.style.left, card.style.top]).toEqual(["72px", "248px"]);

    renderer.positionRelativeToRect(card, {
      left: 100,
      top: 500,
      right: 120,
      bottom: 520,
    });
    expect([card.style.left, card.style.bottom]).toEqual(["72px", "308px"]);
  });

  it("the hover card copies what is selected in that window", async () => {
    const controller = new HoverPreviewController({
      document: second.document,
      container: second.document.body,
      showDelay: 0,
    });
    try {
      const row = second.document.createElement("div");
      second.document.body.appendChild(row);
      placeAt(row, { left: 100, top: 200, width: 200, height: 40 });
      controller.scheduleShow(paper(), row);
      await vi.waitFor(() => expect(controller.isVisible()).toBe(true));
      main.getSelection = () =>
        ({ toString: () => "in the main window" }) as any;
      second.getSelection = () => ({ toString: () => "hidden-charm" }) as any;

      second.document.dispatchEvent(
        new second.KeyboardEvent("keydown", { key: "c", ctrlKey: true }),
      );

      await vi.waitFor(() =>
        expect(copied).toHaveBeenCalledWith("hidden-charm"),
      );
      expect(copied).toHaveBeenCalledTimes(1);
    } finally {
      controller.dispose();
    }
  });

  it("the abstract context menu opens in that window", async () => {
    const doc = second.document as any;
    doc.createXULElement = (tag: string) => {
      const el = doc.createElement(tag);
      el.openPopupAtScreen = vi.fn();
      return el;
    };
    const abstract = second.document.createElement("div");
    abstract.textContent = "A narrow state.";
    second.document.body.appendChild(abstract);
    const notify = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();

    showAbstractContextMenu(
      new second.MouseEvent("contextmenu", { screenX: 5, screenY: 6 }),
      abstract,
      { document: second.document, notify, onOpen, onClose },
    );

    expect(
      main.document.getElementById("zinspire-abstract-context-popup"),
    ).toBeNull();
    const popup = second.document.getElementById(
      "zinspire-abstract-context-popup",
    ) as any;
    expect(popup.parentElement === second.document.documentElement).toBe(true);
    expect(popup.openPopupAtScreen).toHaveBeenCalledWith(5, 6, true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Not in the KaTeX mode (the setting is unset): only "Copy"
    const items = [...popup.children] as HTMLElement[];
    expect(items.map((item) => item.getAttribute("label"))).toEqual([
      msg("references-panel-abstract-copy"),
    ]);
    items[0].dispatchEvent(new second.Event("command"));
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        msg("references-panel-abstract-copied"),
      ),
    );
    expect(copied).toHaveBeenCalledWith("A narrow state.");
    popup.dispatchEvent(new second.Event("popuphidden"));
    expect(
      second.document.getElementById("zinspire-abstract-context-popup"),
    ).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the row renderer takes its colours from that window's theme", () => {
    setTheme(main, "dark");
    setTheme(second, "light");
    const renderer = new EntryListRenderer({ document: second.document });
    const entry = paper();

    const row = renderer.createRow(entry, {
      selectedEntryIDs: new Set(),
      focusedEntryID: entry.id,
      viewMode: "references",
      maxAuthors: 3,
      getCitationValue: () => 0,
    });
    const marker = row.querySelector(".zinspire-ref-entry__dot") as HTMLElement;
    expect(marker.style.color).toBe(css(second, "#d93025"));
    expect(row.style.boxShadow).toBe("inset 3px 0 0 #0060df");

    renderer.updateLocalState(row, true);
    expect(marker.style.color).toBe(css(second, "#1a8f4d"));
    renderer.updatePdfState(row, "disabled");
    const icon = row.querySelector(".zinspire-ref-entry__pdf svg path");
    expect(icon?.getAttribute("fill")).toBe("#9ca3af");
  });
});

describe("local form of the author card", () => {
  it("links author searches on arXiv and INSPIRE for the name as given", () => {
    expect(authorSearchUrls(" Feng-Kun Guo ")).toEqual({
      arxiv: "https://arxiv.org/search/?searchtype=author&query=Feng-Kun%20Guo",
      inspire: "https://inspirehep.net/authors?q=Feng-Kun%20Guo",
    });
    expect(authorSearchUrls("Guo, F.-K.").inspire).toBe(
      "https://inspirehep.net/authors?q=Guo%2C%20F.-K.",
    );
  });

  it("shows the name, the papers in the library and the two searches, asking INSPIRE nothing", async () => {
    const second = newWindow();
    setTheme(main, "light");
    setTheme(second, "dark");
    const author = new AuthorPreviewController({
      document: second.document,
      container: second.document.body,
      showDelay: 0,
      callbacks: { onViewPapers: vi.fn(), onAcademicTree: vi.fn() },
    });
    try {
      const anchor = second.document.createElement("a");
      second.document.body.appendChild(anchor);
      placeAt(anchor, { left: 100, top: 50, width: 60, height: 14 });
      let counted: (count: number) => void = () => {};
      const countInLibrary = vi.fn(
        () => new Promise<number>((resolve) => (counted = resolve)),
      );

      author.scheduleLocalAuthor(
        { fullName: "Feng-Kun Guo" },
        anchor,
        countInLibrary,
      );

      const card = () =>
        second.document.querySelector(
          ".zinspire-author-preview-card",
        ) as HTMLElement;
      await vi.waitFor(() => expect(card()?.style.display).toBe("block"));
      expect(countInLibrary.mock.calls[0][0]).toEqual({
        fullName: "Feng-Kun Guo",
      });
      // Name and searches at once; the count when known
      const lines = () =>
        [...card().children].map((child) => child.textContent);
      expect(lines()).toEqual(["Feng-Kun Guo", "arXivINSPIRE"]);
      counted(12);
      await vi.waitFor(() =>
        expect(lines()).toEqual([
          "Feng-Kun Guo",
          `${msg("references-panel-author-library-count")} {"count":12}`,
          "arXivINSPIRE",
        ]),
      );

      const links = [...card().querySelectorAll("a")] as HTMLAnchorElement[];
      expect(links.map((a) => [a.textContent, a.title])).toEqual([
        ["arXiv", msg("references-panel-author-search-arxiv")],
        ["INSPIRE", msg("references-panel-author-search-inspire")],
      ]);
      expect(links[0].style.color).toBe(css(second, "#60a5fa"));
      links[1].dispatchEvent(
        new second.MouseEvent("click", { cancelable: true }),
      );
      expect((Zotero as any).launchURL).toHaveBeenCalledWith(
        "https://inspirehep.net/authors?q=Feng-Kun%20Guo",
      );

      expect(profiles.fetchAuthorProfile).not.toHaveBeenCalled();
      expect(network.inspireFetch).not.toHaveBeenCalled();
    } finally {
      author.dispose();
    }
  });

  it("keeps the card without a count when counting fails", async () => {
    const author = new AuthorPreviewController({
      document: main.document,
      container: main.document.body,
      showDelay: 0,
    });
    try {
      const anchor = main.document.createElement("a");
      main.document.body.appendChild(anchor);
      placeAt(anchor, { left: 100, top: 50, width: 60, height: 14 });
      const countInLibrary = vi.fn(async () => {
        throw new Error("database is busy");
      });

      author.scheduleLocalAuthor(
        { fullName: "A. Author" },
        anchor,
        countInLibrary,
      );

      await vi.waitFor(() => expect(countInLibrary).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      const card = main.document.querySelector(
        ".zinspire-author-preview-card",
      ) as HTMLElement;
      expect([...card.children].map((child) => child.textContent)).toEqual([
        "A. Author",
        "arXivINSPIRE",
      ]);
    } finally {
      author.dispose();
    }
  });
});
