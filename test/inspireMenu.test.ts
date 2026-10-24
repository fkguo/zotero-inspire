import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import { ZInsMenu } from "../src/modules/inspire/menu";

type MenuData =
  _ZoteroTypes.MenuManager.MenuData<_ZoteroTypes.MenuManager.LibraryMenuContext>;
type MenuOptions = _ZoteroTypes.MenuManager.LibraryMenuOptions;

let dom: JSDOM;
let registrations: MenuOptions[];
let registerMenu: ReturnType<typeof vi.fn>;
let unregisterMenu: ReturnType<typeof vi.fn>;
let actions: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  dom = new JSDOM("<!DOCTYPE html><body></body>");
  registrations = [];
  registerMenu = vi.fn((options: MenuOptions) => {
    registrations.push(options);
    return `${options.pluginID}-${options.menuID}`;
  });
  unregisterMenu = vi.fn();
  actions = Object.fromEntries(
    [
      "updateSelectedItems",
      "updateSelectedCollection",
      "downloadReferencesCacheForSelection",
      "downloadReferencesCacheForCollection",
      "openCombinedCitationGraphFromSelection",
      "openCombinedCitationGraphFromCollection",
      "copyBibTeX",
      "copyCitationKey",
      "copyInspireRecid",
      "copyInspireLink",
      "copyInspireLinkMarkdown",
      "copyZoteroLink",
      "copyFundingInfo",
      "addCollabTagsToSelection",
      "checkSelectedItemsPreprints",
      "toggleFavoritePaperFromMenu",
      "checkPreprintsInCollection",
      "checkAllPreprintsInLibrary",
      "reapplyCollabTagsToCollection",
      "cancelUpdate",
    ].map((name) => [name, vi.fn()]),
  );
  vi.stubGlobal("Zotero", {
    MenuManager: { registerMenu, unregisterMenu },
    debug: vi.fn(),
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
});

afterEach(() => {
  ZInsMenu.unregisterMenus();
  vi.unstubAllGlobals();
  dom.window.close();
});

function label(entry: MenuData): string | null {
  const menuElem = dom.window.document.createElement("menuitem");
  entry.onShowing?.(new dom.window.Event("popupshowing"), {
    menuElem,
  } as unknown as _ZoteroTypes.MenuManager.LibraryMenuContext);
  return menuElem.getAttribute("label");
}

async function command(options: MenuOptions, key: string) {
  const entry = options.menus[1].menus!.find(
    (entry) => label(entry) === `${config.addonRef}-${key}`,
  );
  expect(entry, key).toBeDefined();
  await entry!.onCommand!(
    new dom.window.Event("command"),
    {} as _ZoteroTypes.MenuManager.LibraryMenuContext,
  );
}

describe("native INSPIRE context menus", () => {
  it("registers once for all windows and unregisters both menus on shutdown", () => {
    for (let window = 0; window < 2; window++) {
      ZInsMenu.registerRightClickMenuPopup();
      ZInsMenu.registerRightClickCollectionMenu();
    }
    expect(registerMenu).toHaveBeenCalledTimes(2);
    expect(registrations.map((entry) => entry.target)).toEqual([
      "main/library/item",
      "main/library/collection",
    ]);
    for (const options of registrations) {
      expect(options.pluginID).toBe(config.addonID);
      expect(label(options.menus[1])).toBe(
        `${config.addonRef}-menupopup-label`,
      );
      for (const entry of options.menus[1].menus!) {
        if (entry.menuType === "menuitem") expect(label(entry)).toBeTruthy();
      }
    }
    ZInsMenu.unregisterMenus();
    expect(unregisterMenu).toHaveBeenCalledTimes(2);
    ZInsMenu.unregisterMenus();
    expect(unregisterMenu).toHaveBeenCalledTimes(2);
    ZInsMenu.registerRightClickMenuPopup();
    expect(registerMenu).toHaveBeenCalledTimes(3);
  });

  it("keeps every item-menu command connected to its action", async () => {
    ZInsMenu.registerRightClickMenuPopup();
    const options = registrations[0];
    for (const [key, mode] of [
      ["menuitem-submenulabel0", "full"],
      ["menuitem-submenulabel1", "noabstract"],
      ["menuitem-submenulabel2", "citations"],
    ]) {
      await command(options, key);
      expect(actions.updateSelectedItems).toHaveBeenLastCalledWith(mode);
    }
    for (const [key, action] of [
      ["menuitem-download-cache", "downloadReferencesCacheForSelection"],
      [
        "menuitem-citation-graph-merge",
        "openCombinedCitationGraphFromSelection",
      ],
      ["menuitem-copy-bibtex", "copyBibTeX"],
      ["menuitem-copy-citation-key", "copyCitationKey"],
      ["menuitem-copy-inspire-recid", "copyInspireRecid"],
      ["menuitem-copy-inspire-link", "copyInspireLink"],
      ["menuitem-copy-inspire-link-md", "copyInspireLinkMarkdown"],
      ["menuitem-copy-zotero-link", "copyZoteroLink"],
      ["menuitem-copy-funding", "copyFundingInfo"],
      ["collab-tag-menu-add", "addCollabTagsToSelection"],
      ["preprint-check-menu", "checkSelectedItemsPreprints"],
      ["menuitem-favorite-paper", "toggleFavoritePaperFromMenu"],
      ["menuitem-cancel-update", "cancelUpdate"],
    ]) {
      await command(options, key);
      expect(actions[action]).toHaveBeenCalledOnce();
    }
  });

  it("keeps collection actions separate from item actions", async () => {
    ZInsMenu.registerRightClickCollectionMenu();
    const options = registrations[0];
    for (const [key, mode] of [
      ["menuitem-submenulabel0", "full"],
      ["menuitem-submenulabel1", "noabstract"],
      ["menuitem-submenulabel2", "citations"],
    ]) {
      await command(options, key);
      expect(actions.updateSelectedCollection).toHaveBeenLastCalledWith(mode);
    }
    for (const [key, action] of [
      ["menuitem-download-cache", "downloadReferencesCacheForCollection"],
      [
        "menuitem-citation-graph-merge",
        "openCombinedCitationGraphFromCollection",
      ],
      ["preprint-check-collection-menu", "checkPreprintsInCollection"],
      ["preprint-check-all-menu", "checkAllPreprintsInLibrary"],
      ["collab-tag-menu-reapply", "reapplyCollabTagsToCollection"],
      ["menuitem-cancel-update", "cancelUpdate"],
    ]) {
      await command(options, key);
      expect(actions[action]).toHaveBeenCalledOnce();
    }
    expect(actions.updateSelectedItems).not.toHaveBeenCalled();
  });

  it("can retry registration if Zotero rejects it", () => {
    registerMenu.mockReturnValueOnce(false);
    ZInsMenu.registerRightClickMenuPopup();
    ZInsMenu.registerRightClickMenuPopup();
    expect(registerMenu).toHaveBeenCalledTimes(2);
  });
});
