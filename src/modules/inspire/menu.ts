import { config } from "../../../package.json";
import { getString } from "../../utils/locale";

export class ZInsMenu {
  static registerRightClickMenuPopup() {
    ztoolkit.Menu.register("item", {
      tag: "menuseparator",
    });
    const menuIcon = `chrome://${config.addonRef}/content/icons/inspire.svg`;
    ztoolkit.Menu.register("item", {
      tag: "menu",
      label: getString("menupopup-label"),
      children: this.buildMenuChildren("item") as any,
      icon: menuIcon,
    });
  }

  static registerRightClickCollectionMenu() {
    ztoolkit.Menu.register("collection", {
      tag: "menuseparator",
    });
    const menuIcon = `chrome://${config.addonRef}/content/icons/inspire.svg`;
    ztoolkit.Menu.register("collection", {
      tag: "menu",
      label: getString("menupopup-label"),
      children: this.buildMenuChildren("collection") as any,
      icon: menuIcon,
    });
  }

  private static buildMenuChildren(
    context: "item" | "collection",
  ): Array<Record<string, any>> {
    const isItem = context === "item";
    const updateHandler = isItem
      ? (operation: string) =>
          _globalThis.inspire.updateSelectedItems(operation)
      : (operation: string) =>
          _globalThis.inspire.updateSelectedCollection(operation);
    const cacheHandler = isItem
      ? () => _globalThis.inspire.downloadReferencesCacheForSelection()
      : () => _globalThis.inspire.downloadReferencesCacheForCollection();

    const children: Array<Record<string, any>> = [
      {
        tag: "menuitem",
        label: getString("menuitem-submenulabel0"),
        commandListener: () => updateHandler("full"),
      },
      {
        tag: "menuitem",
        label: getString("menuitem-submenulabel1"),
        commandListener: () => updateHandler("noabstract"),
      },
      {
        tag: "menuitem",
        label: getString("menuitem-submenulabel2"),
        commandListener: () => updateHandler("citations"),
      },
      { tag: "menuseparator" },
      {
        tag: "menuitem",
        label: getString("menuitem-download-cache"),
        commandListener: () => cacheHandler(),
      },
    ];

    if (isItem) {
      // Citation graph actions for items (FTR-CITATION-GRAPH / Phase 3.1)
      children.push(
        { tag: "menuseparator" },
        {
          tag: "menuitem",
          label: getString("menuitem-citation-graph-merge"),
          commandListener: () => {
            _globalThis.inspire.openCombinedCitationGraphFromSelection?.();
          },
        },
      );

      // Copy actions for items
      children.push(
        { tag: "menuseparator" },
        {
          tag: "menuitem",
          label: getString("menuitem-copy-bibtex"),
          commandListener: () => {
            _globalThis.inspire.copyBibTeX();
          },
        },
        {
          tag: "menuitem",
          label: getString("menuitem-copy-citation-key"),
          commandListener: () => {
            _globalThis.inspire.copyCitationKey();
          },
        },
        {
          tag: "menuitem",
          label: getString("menuitem-copy-inspire-recid"),
          commandListener: () => {
            _globalThis.inspire.copyInspireRecid();
          },
        },
        {
          tag: "menuitem",
          label: getString("menuitem-copy-inspire-link"),
          commandListener: () => {
            _globalThis.inspire.copyInspireLink();
          },
        },
        {
          tag: "menuitem",
          label: getString("menuitem-copy-inspire-link-md"),
          commandListener: () => {
            _globalThis.inspire.copyInspireLinkMarkdown();
          },
        },
        {
          tag: "menuitem",
          label: getString("menuitem-copy-zotero-link"),
          commandListener: () => {
            _globalThis.inspire.copyZoteroLink();
          },
        },
        {
          tag: "menuitem",
          label: getString("menuitem-copy-funding"),
          commandListener: () => {
            _globalThis.inspire.copyFundingInfo();
          },
        },
        // Collaboration tags for selected items (FTR-COLLAB-TAGS)
        { tag: "menuseparator" },
        {
          tag: "menuitem",
          label: getString("collab-tag-menu-add"),
          commandListener: () => {
            _globalThis.inspire.addCollabTagsToSelection?.();
          },
        },
        // Preprint check for selected items (FTR-PREPRINT-WATCH)
        { tag: "menuseparator" },
        {
          tag: "menuitem",
          label: getString("preprint-check-menu"),
          commandListener: () => {
            _globalThis.inspire.checkSelectedItemsPreprints?.();
          },
        },
        // Favorite paper (FTR-FAVORITE-PAPERS)
        {
          tag: "menuitem",
          label: getString("menuitem-favorite-paper"),
          commandListener: () => {
            _globalThis.inspire.toggleFavoritePaperFromMenu?.();
          },
        },
      );
    } else {
      // Citation graph actions for collections (FTR-CITATION-GRAPH / Phase 3.1)
      children.push(
        { tag: "menuseparator" },
        {
          tag: "menuitem",
          label: getString("menuitem-citation-graph-merge"),
          commandListener: () => {
            _globalThis.inspire.openCombinedCitationGraphFromCollection?.();
          },
        },
      );

      // Collection-specific actions (FTR-PREPRINT-WATCH)
      children.push(
        { tag: "menuseparator" },
        {
          tag: "menuitem",
          label: getString("preprint-check-collection-menu"),
          commandListener: async () => {
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
          tag: "menuitem",
          label: getString("preprint-check-all-menu"),
          commandListener: async () => {
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
        { tag: "menuseparator" },
        {
          tag: "menuitem",
          label: getString("collab-tag-menu-reapply"),
          commandListener: () => {
            _globalThis.inspire.reapplyCollabTagsToCollection?.();
          },
        },
      );
    }

    children.push(
      { tag: "menuseparator" },
      {
        tag: "menuitem",
        label: getString("menuitem-cancel-update"),
        commandListener: () => {
          _globalThis.inspire.cancelUpdate();
        },
      },
    );

    return children;
  }
}
