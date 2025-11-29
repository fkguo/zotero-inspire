import { config } from "../../../package.json";
import { getString } from "../../utils/locale";

export class ZInsMenu {
  static registerRightClickMenuPopup() {
    ztoolkit.Menu.register("item", {
      tag: "menuseparator",
    });
    const menuIcon = `chrome://${config.addonRef}/content/icons/inspire.png`;
    ztoolkit.Menu.register(
      "item",
      {
        tag: "menu",
        label: getString("menupopup-label"),
        children: [
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel0"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedItems("full");
            },
          },
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel1"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedItems("noabstract");
            },
          },
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel2"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedItems("citations");
            },
          },
          {
            tag: "menuseparator",
          },
          {
            tag: "menuitem",
            label: "Cancel Update",
            commandListener: (_ev) => {
              _globalThis.inspire.cancelUpdate();
            },
          },
        ],
        icon: menuIcon,
      },
    );
  }

  static registerRightClickCollectionMenu() {
    ztoolkit.Menu.register("collection", {
      tag: "menuseparator",
    });
    const menuIcon = `chrome://${config.addonRef}/content/icons/inspire.png`;
    ztoolkit.Menu.register(
      "collection",
      {
        tag: "menu",
        label: getString("menupopup-label"),
        children: [
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel0"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedCollection("full");
            },
          },
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel1"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedCollection("noabstract");
            },
          },
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel2"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedCollection("citations");
            },
          },
          {
            tag: "menuseparator",
          },
          {
            tag: "menuitem",
            label: "Cancel Update",
            commandListener: (_ev) => {
              _globalThis.inspire.cancelUpdate();
            },
          },
        ],
        icon: menuIcon,
      },
    );
  }
}

