// ─────────────────────────────────────────────────────────────────────────────
// Where the arXiv browser opens from in the main window: an item of the View
// menu (Zotero.MenuManager), a button in the tabs toolbar and a button in the
// side navigation of the item pane, next to INSPIRE's. Zotero has no
// interface for toolbar buttons, so the button is added to the toolbar the
// way Zotero adds its own. The labels come from mainWindow.ftl, which is
// loaded into the main window for them.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getLocaleID } from "../../../utils/locale";

const MENU_ID = `${config.addonRef}-arxiv-browser-menu`;
export const ARXIV_BROWSER_BUTTON_ID = `${config.addonRef}-tb-arxiv-browser`;
const MAIN_WINDOW_FTL = `${config.addonRef}-mainWindow.ftl`;
/** The toolbar button's icon, a line drawing like Zotero's toolbar buttons */
const ICON = `chrome://${config.addonRef}/content/icons/arxiv-browser.svg`;
/** arXiv's X on the plugin's dark tile, like INSPIRE's icons */
const MENU_ICON = `chrome://${config.addonRef}/content/icons/arxiv.svg`;
const SIDENAV_ICON = `chrome://${config.addonRef}/content/icons/arxiv-sidenav.svg`;

/** The key Zotero gave the registered menu (it prefixes the plugin's ID) */
let registeredMenu: string | false = false;
/** The ID Zotero gave the side navigation button's section (also prefixed) */
let sidenavPane: string | false = false;
/** Per main window: removes the listeners of the side navigation button */
const sidenavListeners = new WeakMap<Window, () => void>();

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
        icon: MENU_ICON,
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
 * Add a button to the side navigation of the item pane (the Reader's too),
 * right after INSPIRE's. Zotero makes these buttons only for sections of the
 * item pane, so it is the button of a section that stays hidden; its clicks
 * open the browser instead of going to the section (see
 * addArxivBrowserButton, which listens for them in each main window).
 *
 * @param inspirePane the ID of INSPIRE's section
 */
export function registerArxivBrowserSidenav(inspirePane?: string): void {
  if (sidenavPane) return;
  sidenavPane = Zotero.ItemPaneManager.registerSection({
    paneID: "arxiv-browser",
    pluginID: config.addonID,
    header: { l10nID: getLocaleID("arxiv-browser-menuitem"), icon: MENU_ICON },
    sidenav: {
      l10nID: getLocaleID("arxiv-browser-button"),
      icon: SIDENAV_ICON,
    },
    onInit: ({ body }) => {
      const section = body.closest<HTMLElement>("item-pane-custom-section");
      if (section) section.style.display = "none";
    },
    onRender: () => {},
  });
  if (!sidenavPane || !inspirePane) return;
  // Zotero puts a button it has no place for at the end; the first time,
  // give it the place after INSPIRE's in the order the user arranged
  const order = orderWithPaneAfter(
    Zotero.Prefs.get("sidenav.order") as string | undefined,
    sidenavPane,
    inspirePane,
  );
  if (order) Zotero.Prefs.set("sidenav.order", order);
}

export function unregisterArxivBrowserSidenav(): void {
  if (!sidenavPane) return;
  Zotero.ItemPaneManager.unregisterSection(sidenavPane);
  sidenavPane = false;
}

/**
 * The side navigation order (Zotero's comma-separated list of section IDs)
 * with `pane` right after `after`, or null if it stays as it is: no order
 * arranged yet (the registration order already puts the button after
 * INSPIRE's), `pane` placed already, or `after` not in it.
 */
export function orderWithPaneAfter(
  order: string | undefined,
  pane: string,
  after: string,
): string | null {
  if (!order) return null;
  const panes = order.split(",");
  const index = panes.indexOf(after);
  if (panes.includes(pane) || index < 0) return null;
  panes.splice(index + 1, 0, pane);
  return panes.join(",");
}

/**
 * Open the browser from the side navigation button, and keep the pin items
 * out of its context menu (there is no section to pin)
 */
function listenToSidenavButton(win: Window, open: () => void): void {
  if (sidenavListeners.has(win)) return;
  const isButton = (target: EventTarget | null) =>
    !!sidenavPane &&
    (target as HTMLElement | null)?.dataset?.pane === sidenavPane &&
    !!(target as HTMLElement).closest("item-pane-sidenav");
  let menuForButton = false;
  const onClick = (event: MouseEvent) => {
    if (!isButton(event.target)) return;
    // Zotero would go to the hidden section, or pin it on a double click
    event.stopPropagation();
    if (event.button === 0 && event.detail <= 1) open();
  };
  const onContextMenu = (event: Event) => {
    menuForButton = isButton(event.target);
  };
  const onPopupShowing = (event: Event) => {
    const menu = event.target as Element;
    if (!menuForButton || !menu.matches?.("item-pane-sidenav .context-menu")) {
      return;
    }
    menuForButton = false;
    const pinItems = menu.querySelectorAll(
      ".zotero-menuitem-pin, .zotero-menuitem-unpin, .zotero-menuitem-pin-separator",
    ) as NodeListOf<HTMLElement>;
    pinItems.forEach((item) => (item.hidden = true));
  };
  // Capturing, so the clicks never reach the side navigation's own handler
  win.addEventListener("click", onClick, true);
  win.addEventListener("contextmenu", onContextMenu, true);
  win.addEventListener("popupshowing", onPopupShowing, true);
  sidenavListeners.set(win, () => {
    win.removeEventListener("click", onClick, true);
    win.removeEventListener("contextmenu", onContextMenu, true);
    win.removeEventListener("popupshowing", onPopupShowing, true);
  });
}

/**
 * Load the labels into a main window, add the toolbar button there and
 * listen for the side navigation button (once, however often the window is
 * announced)
 */
export function addArxivBrowserButton(win: Window, open: () => void): void {
  const doc = win.document;
  (win as any).MozXULElement?.insertFTLIfNeeded(MAIN_WINDOW_FTL);
  listenToSidenavButton(win, open);
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

/** Remove the button, the listeners and the labels from a main window */
export function removeArxivBrowserButton(win: Window): void {
  const doc = win.document;
  doc.getElementById(ARXIV_BROWSER_BUTTON_ID)?.remove();
  sidenavListeners.get(win)?.();
  sidenavListeners.delete(win);
  doc
    .querySelector(`link[rel="localization"][href="${MAIN_WINDOW_FTL}"]`)
    ?.remove();
}
