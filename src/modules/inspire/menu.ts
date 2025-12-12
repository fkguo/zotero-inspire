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

