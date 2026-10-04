// ─────────────────────────────────────────────────────────────────────────────
// HtmlPane: arXiv's HTML version of a paper, shown in the arXiv browser's
// right-hand side in place of the detail pane. Above the page: a button back
// to the paper's details, the paper's identifier and title, and a button that
// opens the page in the web browser instead; "Loading…" until the page's
// title has arrived.
// The page is shown in a <browser> element as Zotero's own viewer window
// (basicViewer.xhtml) has it: web content, moved to a content process when
// the page loads, without access to Zotero. The element exists only while the
// pane is shown.
// A click on a link within the page (a section, a citation, a footnote) moves
// there; a click on a link to elsewhere (the abstract page, the PDF, a DOI)
// opens that in the web browser and the page stays. Zotero's own
// ExternalLinkHandler does the same for its viewer, but only for a click on
// the link's own text, and arXiv's pages have links around icons and
// formatted text; so a small script in the page's process reports such
// clicks here. The script also reports a right-click, for the page's menu:
// copying the selection, and a link's entries. (Ctrl/Cmd+C and Ctrl/Cmd+A
// are the page's own.) It puts back arXiv's stylesheet when the page links
// one that arXiv has deleted (see arxivHtmlStylesheet). And it shows, while
// the pointer rests on a link to an equation, a figure, a table or a
// reference, that element in a small box (see arxivHtmlPreview).
// Zotero's browsers follow web links only (its setting
// network.protocol-handler.expose-all is off), so a javascript: link — the
// buttons of arXiv's page header that show the table of contents and switch
// the reading mode — does nothing when clicked. The script runs such a link's
// code with the eval of the link's own document: in the page, with the page's
// rights. (Not all a web browser does for such a link: what the code returns
// is ignored, and a page whose policy forbids eval is not served. arXiv's
// pages need neither.)
// Finding in the page is the platform's own find bar (<findbar>, as in a web
// browser: the field, next and previous, highlight all, match case), below
// the page; the window's keys open it (find(), findAgain(), closeFind()).
// Zotero ships its texts in English only. The find bar talks to the page
// through the platform's FindBar actor, which serves the browsers of the
// message-manager group "browsers": the page's element is in that group.
// The page is loaded at once, like in a web browser, not in the arxiv.org
// scheduler's chain: it is one page the user asked for.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { renderMathContent } from "../../inspire/mathRenderer";
import { HTML_PREVIEW_SCRIPT } from "../arxivHtmlPreview";
import { RESTORE_STYLESHEET_SCRIPT } from "../arxivHtmlStylesheet";
import { button, html, showMenuAt, type MenuEntry } from "./dom";

/** The paper whose HTML version is shown */
export interface HtmlPanePaper {
  id: string;
  /** The version shown, when the page is that of one version */
  version?: number;
  /** The title of what is shown, when known */
  title?: string;
  /** The page's address */
  url: string;
}

/** Zotero's <browser> element, as far as the pane uses it */
export interface PageBrowser extends Element {
  loadURI?(uri: unknown, options: { triggeringPrincipal: unknown }): void;
}

/** The platform's <findbar> element, as far as the pane uses it */
interface FindBar extends Element {
  /** The page it finds in */
  browser?: PageBrowser | null;
  hidden: boolean;
  /** Open the bar with the focus in its field */
  onFindCommand?(): unknown;
  /** The next match, or the previous one */
  onFindAgainCommand?(previous: boolean): unknown;
  close?(): void;
}

export interface HtmlPaneOptions {
  /** The right-hand side's element for the pane (hidden while not shown) */
  container: HTMLElement;
  /** Open an address in the web browser */
  openInWebBrowser(url: string): void;
  /** Copy a text (the page's selection, a link's address) */
  copyText(text: string): void;
  /** The pane was shown or closed */
  onToggle(shown: boolean): void;
  /** Loads a page in the browser element (default: Zotero's loadURI) */
  load?: (browser: PageBrowser, url: string) => void;
}

/** The message of a click on a link that leads out of the page */
const LINK_MESSAGE = "zoteroinspire:arxiv-html-link";
/** The message of a right-click in the page */
const MENU_MESSAGE = "zoteroinspire:arxiv-html-menu";

/** What the page's process tells of a right-click */
interface PageMenuRequest {
  /** The text selected in the page */
  text: string;
  /** The address of the web link clicked on, if one */
  link: string;
  /** Where in the page's view the click was */
  x: number;
  y: number;
}

/**
 * Runs in the page's process, for every page loaded in the window: a click
 * on a web link that leads out of the page is reported instead of followed
 * (a link within the page, and a mailto: link, is left alone); a click on a
 * javascript: link that the page itself did not handle runs the link's code
 * in the page; a right-click the page does not handle is reported with the
 * selection and the link under it; a deleted arXiv stylesheet is replaced;
 * a link's equation, figure, table or reference is shown in a box
 */
const LINK_SCRIPT = `"use strict";
function linkOf(event) {
  var target = event.composedTarget || event.target;
  return (
    (target && target.closest && target.closest("a[href], area[href]")) || null
  );
}
function linkUrl(link) {
  try {
    return link && new URL(link.getAttribute("href"), link.baseURI);
  } catch (error) {
    return null;
  }
}
function webLink(event) {
  var url = linkUrl(linkOf(event));
  return url && (url.protocol === "http:" || url.protocol === "https:")
    ? url
    : null;
}
function onLinkClick(event) {
  // The left and the middle button (a right-click asks for the menu)
  if (event.button !== 0 && event.button !== 1) return;
  var url = webLink(event);
  if (!url) return;
  var here = content.location;
  if (
    url.origin === here.origin &&
    url.pathname === here.pathname &&
    url.search === here.search
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  sendAsyncMessage("${LINK_MESSAGE}", url.href);
}
function onScriptLinkClick(event) {
  if (event.button !== 0 || event.defaultPrevented) return;
  var link = linkOf(event);
  var url = linkUrl(link);
  if (!url || url.protocol !== "javascript:") return;
  event.preventDefault();
  var code = url.href.slice("javascript:".length);
  try {
    code = decodeURIComponent(code);
  } catch (error) {}
  // The eval of the link's own document: the code runs there, as the page's
  link.ownerDocument.defaultView.eval(code);
}
function onContextMenu(event) {
  if (event.defaultPrevented) return;
  var url = webLink(event);
  sendAsyncMessage("${MENU_MESSAGE}", {
    text: String(content.getSelection() || ""),
    link: url ? url.href : "",
    x: event.clientX,
    y: event.clientY,
  });
}
addEventListener("click", onLinkClick, true);
addEventListener("auxclick", onLinkClick, true);
addEventListener("click", onScriptLinkClick, false);
addEventListener("contextmenu", onContextMenu, false);
// arXiv's box for the table of contents, in a view narrower than 1280
// pixels: fixed over the right of the text, and empty (transparent) until
// the contents are asked for, it takes the pointer from the text and links
// under it. The pointer goes through the box; the contents, shown, take it.
function letPointerThroughContentsBox() {
  var box = content.document.querySelector(".ltx_page_navbar");
  if (!box) return;
  box.style.pointerEvents = "none";
  var contents = box.querySelector("nav.ltx_TOC");
  if (contents) contents.style.pointerEvents = "auto";
}
addEventListener("DOMContentLoaded", function (event) {
  if (event.target === content.document) letPointerThroughContentsBox();
}, true);
if (content.document.readyState !== "loading") letPointerThroughContentsBox();
${RESTORE_STYLESHEET_SCRIPT}
${HTML_PREVIEW_SCRIPT}`;
const LINK_SCRIPT_URL = `data:application/javascript;charset=utf-8,${encodeURIComponent(LINK_SCRIPT)}`;

const WEB_ADDRESS = /^https?:\/\//i;

/** The window's message manager, as far as the pane uses it */
interface WindowMessageManager {
  loadFrameScript(url: string, allowDelayedLoad: boolean): void;
  removeDelayedFrameScript(url: string): void;
  addMessageListener(name: string, listener: unknown): void;
  removeMessageListener(name: string, listener: unknown): void;
}

/** Load `url` as Zotero's viewer window does */
function loadPage(browser: PageBrowser, url: string): void {
  browser.loadURI?.(Services.io.newURI(url), {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
}

export class HtmlPane {
  private readonly doc: Document;
  private readonly bar: HTMLElement;
  private readonly label: HTMLElement;
  private readonly loading: HTMLElement;
  private browser: PageBrowser | null = null;
  private findBar: FindBar | null = null;
  /** Set once the link script is loaded in the window's pages */
  private links: WindowMessageManager | null = null;
  private readonly onLinkMessage = (message: {
    target?: unknown;
    data?: unknown;
  }): void => {
    const url = message.data;
    if (message.target !== this.browser || typeof url !== "string") return;
    // The page's process is not trusted: web addresses only
    if (WEB_ADDRESS.test(url)) this.options.openInWebBrowser(url);
  };
  private readonly onMenuMessage = (message: {
    target?: unknown;
    data?: Partial<PageMenuRequest> | null;
  }): void => {
    const request = message.data;
    if (!this.browser || message.target !== this.browser || !request) return;
    const { openInWebBrowser, copyText } = this.options;
    const entries: MenuEntry[] = [];
    const text = typeof request.text === "string" ? request.text : "";
    if (text.trim()) {
      entries.push({
        label: getString("references-panel-abstract-copy-selection"),
        run: () => copyText(text),
      });
    }
    const link = typeof request.link === "string" ? request.link : "";
    if (WEB_ADDRESS.test(link)) {
      entries.push(
        {
          label: getString("arxiv-browser-menu-open-link"),
          run: () => openInWebBrowser(link),
        },
        {
          label: getString("arxiv-browser-menu-copy-link"),
          run: () => copyText(link),
        },
      );
    }
    if (!entries.length) return;
    showMenuAt(
      this.browser,
      entries,
      Number(request.x) || 0,
      Number(request.y) || 0,
    );
  };
  private shown: HtmlPanePaper | null = null;

  constructor(private readonly options: HtmlPaneOptions) {
    const { container } = options;
    const doc = (this.doc = container.ownerDocument);
    container.hidden = true;
    this.bar = html(doc, "div", "arxiv-browser__html-bar");
    const back = button(doc, getString("arxiv-browser-html-pane-back"), () =>
      this.close(),
    );
    back.title = getString("arxiv-browser-html-pane-back-tip");
    this.label = html(doc, "span", "arxiv-browser__html-label");
    this.loading = html(
      doc,
      "span",
      "arxiv-browser__html-loading",
      getString("arxiv-browser-html-pane-loading"),
    );
    this.loading.hidden = true;
    const outside = button(
      doc,
      getString("arxiv-browser-html-menu-browser"),
      () => this.shown && options.openInWebBrowser(this.shown.url),
    );
    this.bar.append(back, this.label, this.loading, outside);
    container.append(this.bar);
  }

  /** Whether this window can show pages (a Zotero window can) */
  static available(doc: Document): boolean {
    return (
      typeof (doc as { createXULElement?: unknown }).createXULElement ===
      "function"
    );
  }

  /** The paper whose HTML version is shown, if one */
  get paper(): HtmlPanePaper | null {
    return this.shown;
  }

  /** Whether `target` is the page shown (keys pressed in it come from it) */
  isPage(target: unknown): boolean {
    return this.browser !== null && target === this.browser;
  }

  /** Whether `target` is in the find bar (its field, its buttons) */
  inFindBar(target: unknown): boolean {
    return this.findBar?.contains(target as Node | null) ?? false;
  }

  /** Find in the page: the find bar, with the focus in its field */
  find(): void {
    void this.findBar?.onFindCommand?.();
  }

  /** The next match (the previous one); the find bar when nothing is sought */
  findAgain(previous: boolean): void {
    void this.findBar?.onFindAgainCommand?.(previous);
  }

  /** Close the find bar; whether it was open */
  closeFind(): boolean {
    const bar = this.findBar;
    if (!bar || bar.hidden) return false;
    bar.close?.();
    return true;
  }

  /** Show a paper's HTML version in place of the detail pane */
  show(paper: HtmlPanePaper): void {
    const { container } = this.options;
    const wasShown = this.shown !== null;
    this.shown = paper;
    const name = `arXiv:${paper.id}${paper.version ? `v${paper.version}` : ""}`;
    if (paper.title) {
      const title = html(this.doc, "span", undefined, paper.title);
      void renderMathContent(paper.title, title);
      this.label.replaceChildren(this.doc.createTextNode(`${name} · `), title);
    } else {
      this.label.textContent = name;
    }
    this.label.title = paper.title ?? name;
    container.hidden = false;
    if (!this.browser) {
      const doc = this.doc as Document & {
        createXULElement(tag: string): Element;
      };
      const browser = doc.createXULElement("browser") as PageBrowser;
      browser.setAttribute("type", "content");
      browser.setAttribute("remote", "false");
      browser.setAttribute("maychangeremoteness", "true");
      browser.setAttribute("disableglobalhistory", "true");
      // The find bar's actor serves this group's browsers
      browser.setAttribute("messagemanagergroup", "browsers");
      browser.setAttribute("class", "arxiv-browser__html-page");
      // The page's title has arrived: the page is being shown. (A progress
      // listener would be lost when the page moves to a content process.)
      browser.addEventListener("pagetitlechanged", () => {
        this.loading.hidden = true;
      });
      this.followLinks();
      const findBar = doc.createXULElement("findbar") as FindBar;
      container.append(browser, findBar);
      findBar.browser = browser;
      // Every load moves the page to a content process. The element drops
      // its finder when it is set up again for that, after
      // XULFrameLoaderCreated (so that event is too early);
      // DidChangeBrowserRemoteness follows: the find bar is told then
      browser.addEventListener("DidChangeBrowserRemoteness", () => {
        findBar.browser = browser;
      });
      this.browser = browser;
      this.findBar = findBar;
    } else {
      // Another paper in the same element: the find bar closes (its field
      // keeps what was sought, as a web browser's does)
      this.closeFind();
    }
    this.loading.hidden = false;
    (this.options.load ?? loadPage)(this.browser, paper.url);
    if (!wasShown) this.options.onToggle(true);
  }

  /** Back to the detail pane: the page goes */
  close(): void {
    if (!this.shown) return;
    this.shown = null;
    this.dropBrowser();
    this.options.container.hidden = true;
    this.options.onToggle(false);
  }

  dispose(): void {
    this.shown = null;
    this.dropBrowser();
    if (this.links) {
      this.links.removeDelayedFrameScript(LINK_SCRIPT_URL);
      this.links.removeMessageListener(LINK_MESSAGE, this.onLinkMessage);
      this.links.removeMessageListener(MENU_MESSAGE, this.onMenuMessage);
      this.links = null;
    }
  }

  /**
   * The link script for the pages of this window (the pane's are its only
   * ones), also after a page has moved to another process
   */
  private followLinks(): void {
    if (this.links) return;
    const manager = (
      this.doc.defaultView as { messageManager?: WindowMessageManager } | null
    )?.messageManager;
    if (!manager) return;
    manager.loadFrameScript(LINK_SCRIPT_URL, true);
    manager.addMessageListener(LINK_MESSAGE, this.onLinkMessage);
    manager.addMessageListener(MENU_MESSAGE, this.onMenuMessage);
    this.links = manager;
  }

  private dropBrowser(): void {
    this.loading.hidden = true;
    // The find bar first: it lets go of the page it finds in
    this.findBar?.remove();
    this.findBar = null;
    this.browser?.remove();
    this.browser = null;
  }
}
