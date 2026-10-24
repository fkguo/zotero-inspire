import { config } from "../../../package.json";
import type { FluentMessageId } from "../../../typings/i10n";
import { getString } from "../../utils/locale";

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
        { menuType: "separator" },
        {
          menuType: "submenu",
          onShowing: this.setLabel("menupopup-label"),
          menus: this.buildMenuChildren(context),
          icon: `chrome://${config.addonRef}/content/icons/inspire.svg`,
        },
      ],
    });
    if (id) this.registeredMenus[context] = id;
  }

  // These labels already live in addon.ftl, loaded by the plugin's Localization.
  private static setLabel(key: FluentMessageId): MenuData["onShowing"] {
    return (_event, { menuElem }) => {
      menuElem.setAttribute("label", getString(key));
    };
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
        onShowing: this.setLabel("menuitem-submenulabel0"),
        onCommand: () => updateHandler("full"),
      },
      {
        menuType: "menuitem",
        onShowing: this.setLabel("menuitem-submenulabel1"),
        onCommand: () => updateHandler("noabstract"),
      },
      {
        menuType: "menuitem",
        onShowing: this.setLabel("menuitem-submenulabel2"),
        onCommand: () => updateHandler("citations"),
      },
      { menuType: "separator" },
      {
        menuType: "menuitem",
        onShowing: this.setLabel("menuitem-download-cache"),
        onCommand: () => cacheHandler(),
      },
    ];

    if (isItem) {
      // Citation graph actions for items (FTR-CITATION-GRAPH / Phase 3.1)
      children.push(
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: this.setLabel("menuitem-citation-graph-merge"),
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
          onShowing: this.setLabel("menuitem-copy-bibtex"),
          onCommand: () => {
            _globalThis.inspire.copyBibTeX();
          },
        },
        {
          menuType: "menuitem",
          onShowing: this.setLabel("menuitem-copy-citation-key"),
          onCommand: () => {
            _globalThis.inspire.copyCitationKey();
          },
        },
        {
          menuType: "menuitem",
          onShowing: this.setLabel("menuitem-copy-inspire-recid"),
          onCommand: () => {
            _globalThis.inspire.copyInspireRecid();
          },
        },
        {
          menuType: "menuitem",
          onShowing: this.setLabel("menuitem-copy-inspire-link"),
          onCommand: () => {
            _globalThis.inspire.copyInspireLink();
          },
        },
        {
          menuType: "menuitem",
          onShowing: this.setLabel("menuitem-copy-inspire-link-md"),
          onCommand: () => {
            _globalThis.inspire.copyInspireLinkMarkdown();
          },
        },
        {
          menuType: "menuitem",
          onShowing: this.setLabel("menuitem-copy-zotero-link"),
          onCommand: () => {
            _globalThis.inspire.copyZoteroLink();
          },
        },
        {
          menuType: "menuitem",
          onShowing: this.setLabel("menuitem-copy-funding"),
          onCommand: () => {
            _globalThis.inspire.copyFundingInfo();
          },
        },
        // Collaboration tags for selected items (FTR-COLLAB-TAGS)
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: this.setLabel("collab-tag-menu-add"),
          onCommand: () => {
            _globalThis.inspire.addCollabTagsToSelection?.();
          },
        },
        // Preprint check for selected items (FTR-PREPRINT-WATCH)
        { menuType: "separator" },
        {
          menuType: "menuitem",
          onShowing: this.setLabel("preprint-check-menu"),
          onCommand: () => {
            _globalThis.inspire.checkSelectedItemsPreprints?.();
          },
        },
        // Favorite paper (FTR-FAVORITE-PAPERS)
        {
          menuType: "menuitem",
          onShowing: this.setLabel("menuitem-favorite-paper"),
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
          onShowing: this.setLabel("menuitem-citation-graph-merge"),
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
          onShowing: this.setLabel("preprint-check-collection-menu"),
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
          onShowing: this.setLabel("preprint-check-all-menu"),
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
          onShowing: this.setLabel("collab-tag-menu-reapply"),
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
        onShowing: this.setLabel("menuitem-cancel-update"),
        onCommand: () => {
          _globalThis.inspire.cancelUpdate();
        },
      },
    );

    return children;
  }
}
