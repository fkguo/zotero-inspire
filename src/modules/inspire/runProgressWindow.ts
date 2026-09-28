// ─────────────────────────────────────────────────────────────────────────────
// Progress popup for work that runs for a while and can be cancelled
// (metadata update, reference-cache download, preprint check)
//
// Zotero's progress popup is made for short notices: it opens as an ordinary
// window, so any click on the main window covers it, and a click on the popup
// closes it. During a long run both make the progress disappear while the work
// goes on. This popup is Zotero's own, opened with the "alwaysontop" window
// feature (what Zotero itself uses when there is no main window), with clicks
// ignored and the whole popup draggable. It goes away when the run ends or is
// cancelled, so only runs that Escape cancels use it.
// ─────────────────────────────────────────────────────────────────────────────

import { ProgressWindowHelper } from "zotero-plugin-toolkit";

export interface RunProgressWindowOptions {
  /**
   * Cancels the run. Called on Escape while the popup has the keyboard focus
   * (it gets it once clicked or dragged), since the main window's Escape
   * handler then no longer sees the key.
   */
  onEscape: () => void;
}

/**
 * Open a progress popup (call show() as usual) that stays above the main
 * window, stays open when clicked, and can be dragged.
 */
export function openRunProgressWindow(
  header: string,
  options: RunProgressWindowOptions,
): ProgressWindowHelper {
  const mainWindow = Zotero.getMainWindow();
  const progressWindow: ProgressWindowHelper = new ProgressWindowHelper(
    header,
    {
      closeOnClick: false,
      closeTime: -1,
      window: mainWindow
        ? openerWithPopupsOnTop(mainWindow, (popup) =>
            preparePopup(popup, options, () => progressWindow.close()),
          )
        : undefined,
    },
  );
  return progressWindow;
}

/**
 * The main window as Zotero.ProgressWindow sees it, except that the popup it
 * opens with openDialog() floats above the other windows.
 */
function openerWithPopupsOnTop(
  mainWindow: Window,
  onOpen: (popup: Window) => void,
): Window {
  return new Proxy(mainWindow, {
    get(target, property) {
      if (property === "openDialog") {
        return (
          url: string,
          name: string,
          features: string,
          ...rest: any[]
        ) => {
          const popup = (target as any).openDialog(
            url,
            name,
            `${features},alwaysontop=yes`,
            ...rest,
          ) as Window;
          onOpen(popup);
          return popup;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function preparePopup(
  popup: Window,
  options: RunProgressWindowOptions,
  closeProgressWindow: () => void,
): void {
  popup.addEventListener(
    "load",
    () => {
      popup.document.documentElement?.style.setProperty(
        "-moz-window-dragging",
        "drag",
      );
      // Zotero only notices the popup going away when it closes the popup
      // itself; after the user closes it (Cmd-W once it has the focus), the
      // next progress line would draw into a dead window and throw, ending
      // the run. Telling Zotero lets later lines be skipped instead.
      popup.addEventListener("unload", closeProgressWindow, { once: true });
    },
    { once: true },
  );
  // On macOS a double click in a draggable area zooms the window, as on a
  // title bar; the popup has nothing to zoom
  popup.addEventListener("mousedown", (event) => {
    if (event.detail > 1) {
      event.preventDefault();
    }
  });
  popup.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      options.onEscape();
    }
  });
}
