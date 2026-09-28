// ─────────────────────────────────────────────────────────────────────────────
// Where the arXiv browser opens from in the main window: an item of the View
// menu (Zotero.MenuManager) and a button in the tabs toolbar. Zotero has no
// interface for toolbar buttons, so the button is added to the toolbar the
// way Zotero adds its own. Both labels come from mainWindow.ftl, which is
// loaded into the main window for them.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getLocaleID } from "../../../utils/locale";

const MENU_ID = `${config.addonRef}-arxiv-browser-menu`;
export const ARXIV_BROWSER_BUTTON_ID = `${config.addonRef}-tb-arxiv-browser`;
const MAIN_WINDOW_FTL = `${config.addonRef}-mainWindow.ftl`;
const ICON = `chrome://${config.addonRef}/content/icons/arxiv-browser.svg`;

/** The key Zotero gave the registered menu (it prefixes the plugin's ID) */
let registeredMenu: string | false = false;

/** Add "arXiv Browser" to the View menu of the main window */
export function registerArxivBrowserMenu(open: () => void): void {
  if (registeredMenu) return;
  registeredMenu = Zotero.MenuManager.registerMenu({
    menuID: MENU_ID,
    pluginID: config.addonID,
    target: "main/menubar/view",
    menus: [
      { menuType: "separator" },
      {
        menuType: "menuitem",
        l10nID: getLocaleID("arxiv-browser-menuitem"),
        icon: ICON,
        onCommand: () => open(),
      },
    ],
  });
}

export function unregisterArxivBrowserMenu(): void {
  if (!registeredMenu) return;
  Zotero.MenuManager.unregisterMenu(registeredMenu);
  registeredMenu = false;
}

/**
 * Load the labels into a main window and add the toolbar button there
 * (once, however often the window is announced)
 */
export function addArxivBrowserButton(win: Window, open: () => void): void {
  const doc = win.document;
  (win as any).MozXULElement?.insertFTLIfNeeded(MAIN_WINDOW_FTL);
  if (doc.getElementById(ARXIV_BROWSER_BUTTON_ID)) return;
  const toolbar = doc.getElementById("zotero-tabs-toolbar");
  if (!toolbar) return;
  const button = (doc as any).createXULElement("toolbarbutton") as XULElement;
  button.id = ARXIV_BROWSER_BUTTON_ID;
  button.classList.add("zotero-tb-button");
  button.setAttribute("tabindex", "-1");
  button.setAttribute("data-l10n-id", getLocaleID("arxiv-browser-button"));
  // Drawn in the toolbar's text colour, like Zotero's own buttons
  button.style.listStyleImage = `url("${ICON}")`;
  button.style.fill = "currentColor";
  button.style.setProperty("-moz-context-properties", "fill, fill-opacity");
  button.addEventListener("command", () => open());
  // Next to the sync button, at the right end of the toolbar
  toolbar.insertBefore(button, doc.getElementById("zotero-tb-sync"));
}

/** Remove the button and the labels from a main window */
export function removeArxivBrowserButton(win: Window): void {
  const doc = win.document;
  doc.getElementById(ARXIV_BROWSER_BUTTON_ID)?.remove();
  doc
    .querySelector(`link[rel="localization"][href="${MAIN_WINDOW_FTL}"]`)
    ?.remove();
}
