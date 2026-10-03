// ─────────────────────────────────────────────────────────────────────────────
// arXiv's HTML version of a paper, saved as a snapshot attachment of its item
// at the user's request (one paper at a time, never in batch). The steps of
// Zotero's own importFromURL: a hidden browser loads the versioned page
// https://arxiv.org/html/<id>v<N>, and Zotero captures it with SingleFile,
// images and styles included; the attachment is titled "arXiv HTML v<N>".
// Before the capture, arXiv's stylesheet is written into the page: arXiv's
// stylesheet file only imports its two parts into cascade layers
// (@import "…" layer(name)), and SingleFile copies such an import as it is,
// so that it would point nowhere in the saved file. The link is replaced by a
// <style> holding the parts in their layers (@layer name { … }), which
// SingleFile keeps. (SingleFile does not look for fonts used inside layers:
// arXiv's math font stays a link to arxiv.org, which the saved page's content
// policy does not load, so formulas show in the installed STIX Two Math, else
// Cambria Math or the system's math font; the text font of arXiv's font
// service is left out.) A page linking a deleted stylesheet file of arXiv's
// gets the current one first.
// The hidden browser has a desktop window's size: arXiv's stylesheet hides
// footnotes, among other parts, in narrow windows, and SingleFile leaves out
// what is hidden; the saved file keeps the styles for every width.
// The capture takes a place in the arxiv.org web scheduler's chain like one
// request: it starts 15 s after the previous arxiv.org request, and nothing
// else (another capture included) goes to arxiv.org while it runs. The plugin
// cannot pace the page's own images and styles, which the hidden browser
// loads.
// A paper without an HTML version (arXiv answers 404) or a failed load or
// capture leaves nothing: Zotero removes what it had written.
// arXiv shows SVG figures with <object type="image/svg+xml">; SingleFile
// embeds them as data URIs, but Zotero's reader shows a snapshot under a
// content policy that blocks every <object> (images from data URIs are
// allowed), so the saved file shows them as <img> instead.
// Snapshots saved so are recognised by their URL, arxiv.org/html/<id>[v<N>];
// the abstract-page snapshot of Zotero's arXiv translator (arxiv.org/abs/…)
// is not one of them.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../utils/locale";
import { firstAttachmentID } from "../inspire/library/localPdf";
import { fetchArxivApiEntries } from "./arxivApi";
import {
  ArxivFetchError,
  getArxivWebScheduler,
  type ArxivFetchErrorKind,
  type ArxivScheduler,
} from "./arxivFetch";
import { RESTORE_STYLESHEET_FUNCTIONS } from "./arxivHtmlStylesheet";

export type HtmlSnapshotFailure =
  /** arXiv has no HTML version of the paper (404) */
  | "noHtml"
  /** The library does not allow files */
  | "filesNotEditable"
  /** The page could not be loaded or captured */
  | "capture"
  | ArxivFetchErrorKind;

export type HtmlSnapshotResult =
  | { status: "saved"; attachment: Zotero.Item }
  | { status: "failed"; reason: HtmlSnapshotFailure; message: string };

/** A paper's HTML version: its identifier and version */
export interface HtmlSnapshotSource {
  id: string;
  version: number;
}

/** Zotero 10's hidden browser (chrome://zotero/content/HiddenBrowser.mjs) */
interface HiddenBrowser {
  load(
    url: string,
    options: { requireSuccessfulStatus: boolean },
  ): Promise<boolean>;
  waitForDocument(): Promise<void>;
  /** Settled once the browser element exists */
  readonly _createdPromise: Promise<void>;
  /** The browser element's style */
  readonly style: CSSStyleDeclaration;
  readonly messageManager: {
    loadFrameScript(url: string, allowDelayedLoad: boolean): void;
    addMessageListener(name: string, listener: () => void): void;
    removeMessageListener(name: string, listener: () => void): void;
  };
  destroy(): void;
}

interface ZoteroAttachments {
  importFromDocument(options: {
    browser: HiddenBrowser;
    parentItemID: number;
    title: string;
  }): Promise<Zotero.Item>;
}

const STYLES_MESSAGE = "zoteroinspire:arxiv-snapshot-styles";

/**
 * Source of a script for the loaded page's process (a frame script): a link
 * to a deleted stylesheet file of arXiv's is pointed at the current one, then
 * each stylesheet link whose sheet imports into cascade layers is replaced by
 * a <style> of the same rules, each imported sheet's rules in its layer. It
 * sends STYLES_MESSAGE when done, also after an error.
 */
export const SNAPSHOT_STYLES_SCRIPT = `${RESTORE_STYLESHEET_FUNCTIONS}
function snapshotSheetText(sheet) {
  var text = "";
  var layered = false;
  for (var i = 0; i < sheet.cssRules.length; i++) {
    var rule = sheet.cssRules[i];
    // An import into a layer (only imports have a layerName)
    if (typeof rule.layerName === "string" && rule.styleSheet) {
      layered = true;
      text += "@layer " + rule.layerName + " {\\n";
      for (var j = 0; j < rule.styleSheet.cssRules.length; j++) {
        text += rule.styleSheet.cssRules[j].cssText + "\\n";
      }
      text += "}\\n";
    } else {
      text += rule.cssText + "\\n";
    }
  }
  return layered ? text : null;
}
function snapshotLoaded(link) {
  return new Promise(function (resolve) {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
  });
}
async function snapshotStyles() {
  var doc = content.document;
  var links = doc.querySelectorAll("link[rel~=stylesheet]");
  for (var i = 0; i < links.length; i++) {
    var link = links[i];
    if (!link.sheet || !link.sheet.cssRules.length) {
      var href = link.href;
      restorePaperStylesheet(link);
      if (link.href === href) continue;
      await snapshotLoaded(link);
      if (!link.sheet) continue;
    }
    var text = snapshotSheetText(link.sheet);
    if (text === null) continue;
    var style = doc.createElement("style");
    style.textContent = text;
    link.replaceWith(style);
  }
}
snapshotStyles().catch(function () {}).then(function () {
  sendAsyncMessage(${JSON.stringify(STYLES_MESSAGE)});
});
`;
const SNAPSHOT_STYLES_SCRIPT_URL = `data:application/javascript;charset=utf-8,${encodeURIComponent(SNAPSHOT_STYLES_SCRIPT)}`;

/** The versioned address of a paper's HTML version */
export function arxivHtmlUrl(source: HtmlSnapshotSource): string {
  return `https://arxiv.org/html/${source.id}v${source.version}`;
}

/**
 * The paper's HTML-version addresses, with or without version (and a
 * trailing slash)
 */
function htmlUrlPattern(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(
    `^https?://(?:www\\.)?arxiv\\.org/html/${escaped}(?:v(\\d+))?/?(?:[?#].*)?$`,
    "i",
  );
}

/**
 * The version of an attachment that is an HTML snapshot of arXiv's HTML
 * version of paper `id`: 0 when its address has none, null when it is not
 * such a snapshot
 */
export function htmlSnapshotVersion(
  attachment: Zotero.Item,
  id: string,
): number | null {
  if (attachment.attachmentContentType !== "text/html") return null;
  const url = String(attachment.getField?.("url") ?? "");
  const match = url.match(htmlUrlPattern(id));
  return match ? Number(match[1] ?? 0) : null;
}

/**
 * The ID of the item's first HTML snapshot of paper `id` (at `version`, when
 * given), or null
 */
export function htmlSnapshotID(
  itemID: number,
  id: string,
  version?: number,
): number | null {
  return firstAttachmentID(itemID, (attachment) => {
    const saved = htmlSnapshotVersion(attachment, id);
    return saved !== null && (version === undefined || saved === version);
  });
}

/**
 * Save arXiv's HTML version of a paper, at `source.version`, as a snapshot
 * attachment of `item`
 */
export async function saveArxivHtmlSnapshot(
  item: Zotero.Item,
  source: HtmlSnapshotSource,
  options: { signal?: AbortSignal; scheduler?: ArxivScheduler } = {},
): Promise<HtmlSnapshotResult> {
  const fail = (
    reason: HtmlSnapshotFailure,
    message: string,
  ): HtmlSnapshotResult => ({ status: "failed", reason, message });
  const library = Zotero.Libraries.get(item.libraryID) as
    | { filesEditable?: boolean }
    | false;
  if (!library || !library.filesEditable) {
    return fail("filesNotEditable", "The library does not allow files");
  }
  const url = arxivHtmlUrl(source);
  const title = getString("arxiv-html-snapshot-title", {
    args: { version: source.version },
  });
  try {
    const attachment = await (options.scheduler ?? getArxivWebScheduler()).run(
      url,
      () => importArxivPage(url, item.id, title),
      { signal: options.signal },
    );
    await showSvgObjectsAsImages(attachment);
    return { status: "saved", attachment };
  } catch (err) {
    if (err instanceof ArxivFetchError) return fail(err.kind, err.message);
    // Zotero.HTTP.UnexpectedStatusException of the hidden browser's load
    if ((err as { status?: number } | null)?.status === 404) {
      return fail("noHtml", `arXiv has no HTML version at ${url}`);
    }
    return fail("capture", String(err));
  }
}

/** What came of a request to save a paper's HTML version to an item */
export type HtmlSaveOutcome =
  | {
      /** Saved now, or that version was there already */
      status: "saved" | "there";
      version: number;
      attachmentID: number;
    }
  | {
      status: "failed";
      /** Absent: the arXiv API gave no version */
      version?: number;
      reason: HtmlSnapshotFailure;
      message: string;
    };

export interface HtmlSaveOptions {
  /** Saves the snapshot (default: saveArxivHtmlSnapshot) */
  saveHtmlSnapshot?: typeof saveArxivHtmlSnapshot;
  /** Asks the arXiv API for versions (default: fetchArxivApiEntries) */
  apiEntries?: typeof fetchArxivApiEntries;
}

/**
 * Save arXiv's HTML version of paper `id` at `version` (absent: the newest,
 * as the arXiv API gives it) to `item`, unless that version is there already
 */
export async function saveArxivHtmlVersion(
  item: Zotero.Item,
  id: string,
  version: number | undefined,
  options: HtmlSaveOptions = {},
): Promise<HtmlSaveOutcome> {
  try {
    if (version === undefined) {
      const api = await (options.apiEntries ?? fetchArxivApiEntries)([id]);
      version = api.entries.get(id)?.version;
    }
    if (version === undefined) {
      return {
        status: "failed",
        reason: "capture",
        message: "The arXiv API gave no version",
      };
    }
    const there = htmlSnapshotID(item.id, id, version);
    if (there !== null) {
      return { status: "there", version, attachmentID: there };
    }
    const result = await (options.saveHtmlSnapshot ?? saveArxivHtmlSnapshot)(
      item,
      { id, version },
    );
    return result.status === "saved"
      ? { status: "saved", version, attachmentID: result.attachment.id }
      : { ...result, version };
  } catch (error) {
    return {
      status: "failed",
      ...(version === undefined ? {} : { version }),
      reason: "capture",
      message: String(error),
    };
  }
}

/**
 * Zotero's importFromURL of an HTML page, with arXiv's stylesheet written
 * into the page before the capture
 */
async function importArxivPage(
  url: string,
  parentItemID: number,
  title: string,
): Promise<Zotero.Item> {
  const { HiddenBrowser } = ChromeUtils.importESModule(
    "chrome://zotero/content/HiddenBrowser.mjs",
  ) as {
    HiddenBrowser: new (options: {
      docShell: { allowImages: boolean };
    }) => HiddenBrowser;
  };
  const browser = new HiddenBrowser({ docShell: { allowImages: true } });
  try {
    // A desktop window's size for the page, which is 0 px wide otherwise
    await browser._createdPromise;
    Object.assign(browser.style, {
      display: "",
      width: "1920px",
      height: "1080px",
    });
    // False when Zotero gave up waiting for the page
    if (!(await browser.load(url, { requireSuccessfulStatus: true }))) {
      throw new Error(`${url} did not load`);
    }
    await browser.waitForDocument();
    await writeStylesIntoPage(browser);
    // Zotero 10's attachment functions, beyond zotero-types' list
    return await (
      Zotero.Attachments as unknown as ZoteroAttachments
    ).importFromDocument({ browser, parentItemID, title });
  } finally {
    browser.destroy();
  }
}

/**
 * Run SNAPSHOT_STYLES_SCRIPT in the loaded page, until it is done or for 30 s
 * at most (as Zotero waits for a hidden browser's page data): the page's
 * process may end without its message, and the arxiv.org chain waits for
 * this capture
 */
function writeStylesIntoPage(browser: HiddenBrowser): Promise<void> {
  const manager = browser.messageManager;
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      manager.removeMessageListener(STYLES_MESSAGE, done);
      resolve();
    };
    const timer = setTimeout(done, 30000);
    manager.addMessageListener(STYLES_MESSAGE, done);
    manager.loadFrameScript(SNAPSHOT_STYLES_SCRIPT_URL, false);
  });
}

/** An <object> element with its start tag's attributes and its content */
const OBJECT_ELEMENT =
  /<object\b((?:[^>"']|"[^"]*"|'[^']*')*)>[\s\S]*?<\/object\s*>/gi;
/** One attribute of a start tag: name, and value with its quotes if any */
const ATTRIBUTE = /\s+([^\s=>"'/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g;

/**
 * The page with each <object> showing an SVG image from a data URI turned
 * into an <img> of that image, its other attributes kept; `count` is the
 * number of objects turned
 */
export function svgObjectsAsImages(html: string): {
  html: string;
  count: number;
} {
  let count = 0;
  const result = html.replace(OBJECT_ELEMENT, (element, attributes: string) => {
    const kept: string[] = [];
    let isSvg = false;
    for (const [, name, value = ""] of attributes.matchAll(ATTRIBUTE)) {
      const lower = name.toLowerCase();
      if (lower === "type") continue;
      if (lower === "data") {
        isSvg = /^["']?data:image\/svg\+xml[;,]/i.test(value);
        kept.push(`src=${value}`);
      } else {
        kept.push(value ? `${name}=${value}` : name);
      }
    }
    if (!isSvg) return element;
    count++;
    return `<img ${kept.join(" ")}>`;
  });
  return { html: result, count };
}

/**
 * Rewrite a saved snapshot's SVG objects as images, so that Zotero's reader
 * shows them; the snapshot stays as it is when that fails
 */
async function showSvgObjectsAsImages(attachment: Zotero.Item): Promise<void> {
  try {
    const path = await attachment.getFilePathAsync();
    if (!path) return;
    const saved = (await Zotero.File.getContentsAsync(path, "utf-8")) as string;
    const { html, count } = svgObjectsAsImages(saved);
    if (count) await Zotero.File.putContentsAsync(path, html);
  } catch (err) {
    Zotero.debug(`[arXiv] SVG figures of the HTML snapshot kept: ${err}`);
  }
}
