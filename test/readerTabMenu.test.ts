import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import {
  registerInspireReaderTabMenu,
  unregisterInspireReaderTabMenu,
} from "../src/modules/inspire/readerTabMenu";

type Options = _ZoteroTypes.MenuManager.MenuOptions<"main/tab">;
type Context = _ZoteroTypes.MenuManager.TabMenuContext;
let dom: JSDOM;
let options: Options;
let registerMenu: ReturnType<typeof vi.fn>;
let unregisterMenu: ReturnType<typeof vi.fn>;
let actions: Record<string, ReturnType<typeof vi.fn>>;
let papers: Map<number, Zotero.Item>;
let launchURL: ReturnType<typeof vi.fn>;

const paper = (id: number, recid = "3071234") =>
  ({
    id,
    isRegularItem: () => true,
    getField: (key: string) =>
      ({ archive: "INSPIRE", archiveLocation: recid })[key] ?? "",
  }) as unknown as Zotero.Item;

function context(
  attachment: Partial<Zotero.Item> = {
    parentID: 42,
    isPDFAttachment: () => true,
  },
): Context {
  return {
    tabID: "right-clicked-background-tab",
    tabType: "reader",
    tabSubType: "pdf",
    items: [attachment as Zotero.Item],
    menuElem: dom.window.document.createElement("menu"),
    setVisible: vi.fn(),
    setEnabled: vi.fn(),
  } as unknown as Context;
}

function entry(key: string) {
  const ctx = context();
  return options.menus[0].menus!.find((data) => {
    data.onShowing?.(new dom.window.Event("popupshowing"), ctx);
    return ctx.menuElem.getAttribute("label") === `${config.addonRef}-${key}`;
  })!;
}

beforeEach(() => {
  dom = new JSDOM("<!DOCTYPE html><body></body>");
  registerMenu = vi.fn((value: Options) => {
    options = value;
    return "pdf-tab-menu";
  });
  unregisterMenu = vi.fn();
  launchURL = vi.fn();
  papers = new Map([
    [42, paper(42)],
    [99, paper(99, "9999999")],
  ]);
  actions = Object.fromEntries(
    [
      "updateSelectedItems",
      "copyBibTeX",
      "copyCitationKey",
      "copyInspireRecid",
      "copyInspireLink",
      "copyInspireLinkMarkdown",
      "copyZoteroLink",
      "copyFundingInfo",
      "checkSelectedItemsPreprints",
      "toggleFavoritePaperFromMenu",
    ].map((name) => [name, vi.fn()]),
  );
  vi.stubGlobal("Zotero", {
    MenuManager: { registerMenu, unregisterMenu },
    Items: { get: (id: number) => papers.get(id) ?? false },
    launchURL,
    getActiveZoteroPane: () => {
      throw new Error("Must not read the active library selection");
    },
  });
  vi.stubGlobal("_globalThis", { inspire: actions });
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
  registerInspireReaderTabMenu();
});

afterEach(() => {
  unregisterInspireReaderTabMenu();
  vi.unstubAllGlobals();
  dom.window.close();
});

describe("INSPIRE on a PDF tab", () => {
  it("registers once and supplies the root icon explicitly", () => {
    registerInspireReaderTabMenu();
    expect(registerMenu).toHaveBeenCalledOnce();
    expect(options.target).toBe("main/tab");
    const ctx = context();
    options.menus[0].onShowing!(new dom.window.Event("popupshowing"), ctx);
    expect(ctx.setVisible).toHaveBeenCalledWith(true);
    expect(ctx.menuElem.getAttribute("image")).toBe(options.menus[0].icon);
    expect(ctx.menuElem.style.listStyleImage).toContain("inspire-menu.png");
  });

  it("hides the menu for other tab types, standalone PDFs and missing parents", () => {
    for (const attachment of [
      { isPDFAttachment: () => false },
      { isPDFAttachment: () => true },
      { isPDFAttachment: () => true, parentID: 123456 },
    ]) {
      const ctx = context(attachment);
      options.menus[0].onShowing!(new dom.window.Event("popupshowing"), ctx);
      expect(ctx.setVisible).toHaveBeenCalledWith(false);
    }
  });

  it("hides the menu when Zotero supplies no item for the library tab", () => {
    const ctx = context();
    ctx.items = [false] as unknown as Zotero.Item[];
    options.menus[0].onShowing!(new dom.window.Event("popupshowing"), ctx);
    expect(ctx.setVisible).toHaveBeenCalledWith(false);
    ctx.items = [];
    options.menus[0].onShowing!(new dom.window.Event("popupshowing"), ctx);
    expect(ctx.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("opens the clicked PDF's parent record", () => {
    entry("menuitem-open-inspire").onCommand!(
      new dom.window.Event("command"),
      context(),
    );
    expect(launchURL).toHaveBeenCalledWith(
      "https://inspirehep.net/literature/3071234",
    );
  });

  it("routes updates and paper actions to the clicked background tab's parent", async () => {
    const ctx = context();
    for (const [key, mode] of [
      ["menuitem-submenulabel0", "full"],
      ["menuitem-submenulabel1", "noabstract"],
      ["menuitem-submenulabel2", "citations"],
    ]) {
      await entry(key).onCommand!(new dom.window.Event("command"), ctx);
      expect(actions.updateSelectedItems).toHaveBeenLastCalledWith(mode, [
        papers.get(42),
      ]);
    }
    for (const [key, action] of [
      ["menuitem-copy-bibtex", "copyBibTeX"],
      ["menuitem-copy-citation-key", "copyCitationKey"],
      ["menuitem-copy-inspire-recid", "copyInspireRecid"],
      ["menuitem-copy-inspire-link", "copyInspireLink"],
      ["menuitem-copy-inspire-link-md", "copyInspireLinkMarkdown"],
      ["menuitem-copy-zotero-link", "copyZoteroLink"],
      ["preprint-check-menu", "checkSelectedItemsPreprints"],
      ["menuitem-favorite-paper", "toggleFavoritePaperFromMenu"],
    ]) {
      await entry(key).onCommand!(new dom.window.Event("command"), ctx);
      expect(actions[action]).toHaveBeenCalledWith([papers.get(42)]);
    }
    await entry("menuitem-copy-funding").onCommand!(
      new dom.window.Event("command"),
      ctx,
    );
    expect(actions.copyFundingInfo).toHaveBeenCalledWith(ctx.items);
  });

  it("disables record-dependent actions without an INSPIRE ID", () => {
    papers.set(42, paper(42, ""));
    const ctx = context();
    const open = entry("menuitem-open-inspire");
    open.onShowing!(new dom.window.Event("popupshowing"), ctx);
    expect(ctx.setEnabled).toHaveBeenCalledWith(false);
    open.onCommand!(new dom.window.Event("command"), ctx);
    expect(launchURL).not.toHaveBeenCalled();
  });

  it("does nothing if the PDF's parent was deleted before the command", () => {
    const command = entry("menuitem-copy-inspire-link");
    papers.delete(42);
    command.onCommand!(new dom.window.Event("command"), context());
    expect(actions.copyInspireLink).not.toHaveBeenCalled();
  });

  it("unregisters on shutdown and can register again", () => {
    unregisterInspireReaderTabMenu();
    expect(unregisterMenu).toHaveBeenCalledWith("pdf-tab-menu");
    registerInspireReaderTabMenu();
    expect(registerMenu).toHaveBeenCalledTimes(2);
  });
});
