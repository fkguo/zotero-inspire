import { config } from "../../../package.json";
import { INSPIRE_MENU_ICON, menuLabel } from "./menuAppearance";

type MenuData =
  _ZoteroTypes.MenuManager.MenuData<_ZoteroTypes.MenuManager.LibraryMenuContext>;

export class ZInsMenu {
  private static registeredMenus: Partial<
    Record<"item" | "collection", string>
  > = {};

  static registerRightClickMenuPopup() {
    this.registerMenu("item");
  }

  static registerRightClickCollectionMenu() {
    this.registerMenu("collection");
  }

  static unregisterMenus() {
    for (const id of Object.values(this.registeredMenus)) {
      Zotero.MenuManager.unregisterMenu(id);
    }
    this.registeredMenus = {};
  }

  private static registerMenu(context: "item" | "collection") {
    if (this.registeredMenus[context]) return;
    const id = Zotero.MenuManager.registerMenu({
      menuID: `${config.addonRef}-inspire-${context}`,
      pluginID: config.addonID,
      target:
        context === "item" ? "main/library/item" : "main/library/collection",
      menus: [
        // Zotero groups these targets and inserts the top-level separator.
        {
          menuType: "submenu",
          onShowing: menuLabel("menupopup-label", true),
          menus: this.buildMenuChildren(context),
          icon: INSPIRE_MENU_ICON,
        },
      ],
    });
    if (id) this.registeredMenus[context] = id;
  }

  private static buildMenuChildren(context: "item" | "collection"): MenuData[] {
    const isItem = context === "item";
    const updateHandler = isItem
      ? (operation: string) =>
          _globalThis.inspire.updateSelectedItems(operation)
      : (operation: string) =>
          _globalThis.inspire.updateSelectedCollection(operation);
    const cacheHandler = isItem
      ? () => _globalThis.inspire.downloadReferencesCacheForSelection()
      : () => _globalThis.inspire.downloadReferencesCacheForCollection();

    const children: MenuData[] = [
      {
        menuType: "menuitem",
        onShowing: menuLabel("menuitem-submenulabel0"),
        onCommand: () => updateHandler("full"),
      },
      {
        menuType: "menuitem",
        onShowing: menuLabel("menuitem-submenulabel1"),
        onCommand: () => updateHandler("noabstract"),
      },
      {
        menuType: "menuitem",
        onShowing: menuLabel("menuitem-submenulabel2"),
        onCommand: () => updateHandler("citations"),
      },
      { menuType: "separator" },
      {
        menuType: "menuitem",
        onShowing: menuLabel("menuitem-download-cache"),
        onCommand: () => cacheHandler(),
      },
    ];

    if (isItem) {
      // Citation graph actions for items (FTR-CITATION-GRAPH / Phase 3.1)
      children.push(
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-citation-graph-merge"),
          onCommand: () => {
            _globalThis.inspire.openCombinedCitationGraphFromSelection?.();
          },
        },
      );

      // Copy actions for items
      children.push(
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-copy-bibtex"),
          onCommand: () => {
            _globalThis.inspire.copyBibTeX();
          },
        },
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-copy-citation-key"),
          onCommand: () => {
            _globalThis.inspire.copyCitationKey();
          },
        },
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-copy-inspire-recid"),
          onCommand: () => {
            _globalThis.inspire.copyInspireRecid();
          },
        },
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-copy-inspire-link"),
          onCommand: () => {
            _globalThis.inspire.copyInspireLink();
          },
        },
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-copy-inspire-link-md"),
          onCommand: () => {
            _globalThis.inspire.copyInspireLinkMarkdown();
          },
        },
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-copy-zotero-link"),
          onCommand: () => {
            _globalThis.inspire.copyZoteroLink();
          },
        },
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-copy-funding"),
          onCommand: () => {
            _globalThis.inspire.copyFundingInfo();
          },
        },
        // Collaboration tags for selected items (FTR-COLLAB-TAGS)
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: menuLabel("collab-tag-menu-add"),
          onCommand: () => {
            _globalThis.inspire.addCollabTagsToSelection?.();
          },
        },
        // Preprint check for selected items (FTR-PREPRINT-WATCH)
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: menuLabel("preprint-check-menu"),
          onCommand: () => {
            _globalThis.inspire.checkSelectedItemsPreprints?.();
          },
        },
        // Favorite paper (FTR-FAVORITE-PAPERS)
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-favorite-paper"),
          onCommand: () => {
            _globalThis.inspire.toggleFavoritePaperFromMenu?.();
          },
        },
      );
    } else {
      // Citation graph actions for collections (FTR-CITATION-GRAPH / Phase 3.1)
      children.push(
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: menuLabel("menuitem-citation-graph-merge"),
          onCommand: () => {
            _globalThis.inspire.openCombinedCitationGraphFromCollection?.();
          },
        },
      );

      // Collection-specific actions (FTR-PREPRINT-WATCH)
      children.push(
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: menuLabel("preprint-check-collection-menu"),
          onCommand: async () => {
            Zotero.debug(
              "[zotero-inspire] Menu: checkPreprintsInCollection clicked",
            );
            try {
              await _globalThis.inspire.checkPreprintsInCollection();
            } catch (err) {
              Zotero.debug(
                `[zotero-inspire] Menu: checkPreprintsInCollection error: ${err}`,
              );
            }
          },
        },
        {
          menuType: "menuitem",
          onShowing: menuLabel("preprint-check-all-menu"),
          onCommand: async () => {
            Zotero.debug(
              "[zotero-inspire] Menu: checkAllPreprintsInLibrary clicked",
            );
            try {
              await _globalThis.inspire.checkAllPreprintsInLibrary();
            } catch (err) {
              Zotero.debug(
                `[zotero-inspire] Menu: checkAllPreprintsInLibrary error: ${err}`,
              );
            }
          },
        },
        // Collaboration tags for collection items (FTR-COLLAB-TAGS)
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: menuLabel("collab-tag-menu-reapply"),
          onCommand: () => {
            _globalThis.inspire.reapplyCollabTagsToCollection?.();
          },
        },
      );
    }

    children.push(
      { menuType: "separator" },
      {
        menuType: "menuitem",
        onShowing: menuLabel("menuitem-cancel-update"),
        onCommand: () => {
          _globalThis.inspire.cancelUpdate();
        },
      },
    );

    return children;
  }
}
