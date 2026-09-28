// ─────────────────────────────────────────────────────────────────────────────
// The arXiv browser window (arxivBrowser.xhtml). At most one is open: the View
// menu and the toolbar button open it or bring it to the front. Its content is
// built when the window has loaded. However the window closes — by hand, when
// the plugin is disabled or updated, or when the main window closes — the
// requests to arXiv it started, and anything still queued for arXiv, are
// cancelled.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getArxivApiScheduler, getArxivWebScheduler } from "../arxivFetch";
import { onLibraryIndexChange } from "../../inspire/library/arxivIndex";
import { ArxivBrowserView } from "./ArxivBrowserView";
import { followItems, itemsWithArxivIds } from "./browserLibrary";

export const ARXIV_BROWSER_WINDOWTYPE = `${config.addonRef}:arxiv-browser`;
export const ARXIV_BROWSER_URL = `chrome://${config.addonRef}/content/arxivBrowser.xhtml`;
const WINDOW_FEATURES = "chrome,resizable,centerscreen,dialog=no";

/** What the window shows, built when it loads */
export interface ArxivBrowserContent {
  /** Stop everything the content started and drop its listeners */
  dispose(): void;
}

export type ArxivBrowserContentFactory = (
  root: HTMLElement,
) => ArxivBrowserContent;

const createView: ArxivBrowserContentFactory = (root) =>
  new ArxivBrowserView(root, {
    inLibrary: itemsWithArxivIds,
    followLibrary: onLibraryIndexChange,
    followItems,
  });

/** The open window; set as soon as it is opened, before it has loaded */
let browserWindow: Window | null = null;
let content: ArxivBrowserContent | null = null;

/** The open arXiv browser window, if any */
export function getArxivBrowserWindow(): Window | null {
  if (browserWindow && !browserWindow.closed) return browserWindow;
  const listed = Services.wm.getMostRecentWindow(
    ARXIV_BROWSER_WINDOWTYPE,
  ) as Window | null;
  return listed && !listed.closed ? listed : null;
}

/** Open the arXiv browser, or bring the open one to the front */
export function openArxivBrowser(): void {
  const open = getArxivBrowserWindow();
  if (open) {
    open.focus();
    return;
  }
  const main = Zotero.getMainWindow();
  if (!main) return;
  browserWindow = main.openDialog(
    ARXIV_BROWSER_URL,
    "_blank",
    WINDOW_FEATURES,
  ) as Window | null;
}

/** The window has loaded: build its content */
export function onArxivBrowserLoad(
  win: Window,
  createContent: ArxivBrowserContentFactory = createView,
): void {
  const root = win.document.getElementById("arxiv-browser-root");
  if (!root) return;
  content?.dispose();
  browserWindow = win;
  content = createContent(root as HTMLElement);
}

/** The window is closing */
export function onArxivBrowserUnload(win: Window): void {
  if (browserWindow && win !== browserWindow) return;
  release();
}

/**
 * Close the window, cancelling its requests (the plugin is disabled or
 * updated, or the main window closes)
 */
export function closeArxivBrowser(): void {
  const win = getArxivBrowserWindow();
  // Before the window goes: its unload may come after the plugin has gone
  release();
  win?.close();
}

function release(): void {
  const current = content;
  content = null;
  browserWindow = null;
  try {
    current?.dispose();
  } catch (error) {
    Zotero.debug(`[${config.addonName}] arXiv browser dispose: ${error}`);
  }
  // Nothing queued for arXiv is wanted once the browser is gone
  getArxivWebScheduler().cancelAll();
  getArxivApiScheduler().cancelAll();
}
