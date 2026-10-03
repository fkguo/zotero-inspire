// ─────────────────────────────────────────────────────────────────────────────
// arXiv's HTML version saved as a snapshot: the steps of Zotero's
// importFromURL for the versioned page (a hidden browser, here at a desktop
// window's size), with arXiv's stylesheet written into the page before the
// capture, started only in the arxiv.org scheduler's slot (15 s after the
// previous request); a paper without HTML version or a page that did not
// load leaves nothing; snapshots are recognised by their URL, the arXiv
// translator's abstract-page snapshot not among them. SVG figures, which
// arXiv shows with <object> and Zotero's reader blocks, are saved as <img>.
// In the page, each stylesheet link that imports into cascade layers becomes
// a <style> of the same rules in their layers, after a deleted stylesheet of
// arXiv's has been replaced by the current one.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/locale", () => ({
  getString: (key: string, options?: { args?: Record<string, unknown> }) =>
    key === "arxiv-html-snapshot-title"
      ? `arXiv HTML v${options?.args?.version}`
      : key,
}));

import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import {
  htmlSnapshotID,
  htmlSnapshotVersion,
  saveArxivHtmlSnapshot,
  SNAPSHOT_STYLES_SCRIPT,
  svgObjectsAsImages,
} from "../src/modules/arxiv/arxivHtmlSnapshot";
import { ARXIV_PAPER_STYLESHEET } from "../src/modules/arxiv/arxivHtmlStylesheet";
import { flushPromises, VirtualClock } from "./virtualClock";

const SOURCE = { id: "2609.28538", version: 2 };
const URL_V2 = "https://arxiv.org/html/2609.28538v2";

/** An attachment as Zotero has it */
function attachment(id: number, url: string, contentType = "text/html") {
  return {
    id,
    attachmentContentType: contentType,
    getField: (field: string) => (field === "url" ? url : ""),
    getFilePathAsync: async () => `/storage/${id}/2609.html`,
  };
}

// An SVG figure and a PNG figure as SingleFile saves arXiv's HTML version
const SVG_DATA = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iIi8+";
const SVG_FIGURE =
  `<figure id=S4.F2 class=ltx_figure><object type=image/svg+xml data="${SVG_DATA}" ` +
  `id=S4.F2.g1 class="ltx_graphics ltx_centering ltx_img_landscape" ` +
  `style=aspect-ratio:476/211 width=476 height=211></object>`;
const SVG_AS_IMAGE =
  `<figure id=S4.F2 class=ltx_figure><img src="${SVG_DATA}" ` +
  `id=S4.F2.g1 class="ltx_graphics ltx_centering ltx_img_landscape" ` +
  `style=aspect-ratio:476/211 width=476 height=211>`;
const PNG_FIGURE =
  `<figure id=S3.F1 class=ltx_figure><img src=data:image/png;base64,iVBORw0K ` +
  `id=S3.F1.g1 class="ltx_graphics" width=476 height=403 alt="Refer to caption">`;

let clock: VirtualClock;
let scheduler: ArxivScheduler;
let sent: { url: string; at: number }[];
/** What happened to the hidden browsers, in order */
let steps: string[];
/** The frame scripts loaded, as data: URLs */
let scripts: string[];
/** Whether the page's script sends its message */
let scriptAnswers: boolean;
let imports: { options: any; at: number }[];
let browsers: FakeBrowser[];
let load: (url: string) => Promise<boolean>;
let importFromDocument: (options: any) => Promise<unknown>;
let filesEditable: boolean;
let files: Record<string, string>;

const item = { id: 77, libraryID: 1 } as unknown as Zotero.Item;

/** Zotero's HiddenBrowser as the plugin uses it */
class FakeBrowser {
  readonly _createdPromise = Promise.resolve();
  readonly style: Record<string, string> = { display: "none" };
  destroyed = false;
  private readonly listeners = new Map<string, () => void>();
  readonly messageManager = {
    addMessageListener: (name: string, listener: () => void) =>
      this.listeners.set(name, listener),
    removeMessageListener: (name: string) => this.listeners.delete(name),
    // The page's script ends with its message
    loadFrameScript: (url: string) => {
      steps.push("script");
      scripts.push(url);
      // Later than any promise callback, as a message from the page's process
      if (scriptAnswers) {
        setImmediate(() => {
          steps.push("styles written");
          this.listeners.get(STYLES_MESSAGE)?.();
        });
      }
    },
  };

  constructor(readonly options: unknown) {
    browsers.push(this);
  }

  async load(url: string, options: unknown) {
    steps.push(`load ${url} ${JSON.stringify(options)} ${this.size()}`);
    return load(url);
  }

  async waitForDocument() {
    steps.push("ready");
  }

  destroy() {
    steps.push("destroy");
    this.destroyed = true;
  }

  private size() {
    return `${this.style.display || "shown"} ${this.style.width} ${this.style.height}`;
  }
}

const STYLES_MESSAGE = "zoteroinspire:arxiv-snapshot-styles";

beforeEach(() => {
  clock = new VirtualClock();
  sent = [];
  steps = [];
  scripts = [];
  scriptAnswers = true;
  imports = [];
  browsers = [];
  filesEditable = true;
  scheduler = new ArxivScheduler({
    host: "arxiv.org",
    minIntervalMs: 15000,
    timeoutMs: 60000,
    clock,
    transport: async (url) => {
      sent.push({ url, at: clock.now() });
      return { status: 200, text: "", header: () => null };
    },
  });
  load = async () => true;
  importFromDocument = async () => attachment(78, URL_V2);
  files = {};
  vi.stubGlobal("ChromeUtils", {
    importESModule: (url: string) =>
      url === "chrome://zotero/content/HiddenBrowser.mjs"
        ? { HiddenBrowser: FakeBrowser }
        : {},
  });
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    File: {
      getContentsAsync: async (path: string) => files[path] ?? "",
      putContentsAsync: async (path: string, text: string) => {
        files[path] = text;
      },
    },
    Libraries: { get: () => ({ filesEditable }) },
    Attachments: {
      importFromDocument: (options: any) => {
        steps.push("capture");
        imports.push({ options, at: clock.now() });
        return importFromDocument(options);
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saving arXiv's HTML version as a snapshot", () => {
  it("captures the versioned page as Zotero's importFromURL does, at a desktop window's size, after the page's styles are written in, titled with the version, in the scheduler's slot 15 s after the previous arxiv.org request", async () => {
    const listing = scheduler.request("https://arxiv.org/list/hep-ph/new");
    const saving = saveArxivHtmlSnapshot(item, SOURCE, { scheduler });
    await clock.advanceBy(14999);
    expect(steps).toEqual([]);
    const result = await clock.run(saving);
    await listing;

    expect(browsers.map((browser) => browser.options)).toEqual([
      { docShell: { allowImages: true } },
    ]);
    expect(steps).toEqual([
      `load ${URL_V2} {"requireSuccessfulStatus":true} shown 1920px 1080px`,
      "ready",
      "script",
      "styles written",
      "capture",
      "destroy",
    ]);
    // The styles script, which ends with its message
    expect(
      scripts.map((url) => decodeURIComponent(url.replace(/^data:[^,]*,/, ""))),
    ).toEqual([SNAPSHOT_STYLES_SCRIPT]);
    expect(imports).toEqual([
      {
        options: {
          browser: browsers[0],
          parentItemID: 77,
          title: "arXiv HTML v2",
        },
        at: 15000,
      },
    ]);
    expect(result).toMatchObject({ status: "saved", attachment: { id: 78 } });
  });

  it("captures the page after 30 s when the page's script does not answer (its process ended)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      scriptAnswers = false;
      const saving = saveArxivHtmlSnapshot(item, SOURCE, { scheduler });
      while (!steps.includes("script")) await flushPromises();
      vi.advanceTimersByTime(29999);
      await flushPromises();
      expect(steps).not.toContain("capture");
      vi.advanceTimersByTime(1);
      expect(await clock.run(saving)).toMatchObject({ status: "saved" });
      expect(steps.slice(-2)).toEqual(["capture", "destroy"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves SVG figures as images, which Zotero's reader shows, and leaves the rest of the page", async () => {
    const page = `<p>${PNG_FIGURE}</figure>${SVG_FIGURE}</figure></p>`;
    files["/storage/78/2609.html"] = page;
    const result = await clock.run(
      saveArxivHtmlSnapshot(item, SOURCE, { scheduler }),
    );
    expect(result).toMatchObject({ status: "saved" });
    expect(files["/storage/78/2609.html"]).toBe(
      `<p>${PNG_FIGURE}</figure>${SVG_AS_IMAGE}</figure></p>`,
    );
  });

  it("captures one page at a time: a second save waits for the first to end", async () => {
    let finish: () => void = () => undefined;
    importFromDocument = async () => {
      if (imports.length === 1) {
        await new Promise<void>((resolve) => (finish = resolve));
      }
      return attachment(78 + imports.length, URL_V2);
    };
    const first = saveArxivHtmlSnapshot(item, SOURCE, { scheduler });
    const second = saveArxivHtmlSnapshot(
      item,
      { id: "2609.28540", version: 1 },
      { scheduler },
    );
    await clock.advanceBy(60000);
    expect(imports.map((i) => i.at)).toEqual([0]);
    finish();
    await clock.run(Promise.all([first, second]));
    expect(imports.map((i) => i.at)).toEqual([0, 75000]);
  });

  it("says arXiv has no HTML version when the page answers 404, with nothing saved", async () => {
    load = async () => {
      throw Object.assign(new Error("Invalid response 404"), { status: 404 });
    };
    const result = await clock.run(
      saveArxivHtmlSnapshot(item, SOURCE, { scheduler }),
    );
    expect(result).toMatchObject({ status: "failed", reason: "noHtml" });
    expect(imports).toHaveLength(0);
    expect(browsers[0].destroyed).toBe(true);
  });

  it("captures nothing when Zotero gave up waiting for the page", async () => {
    load = async () => false;
    const result = await clock.run(
      saveArxivHtmlSnapshot(item, SOURCE, { scheduler }),
    );
    expect(result).toMatchObject({ status: "failed", reason: "capture" });
    expect(imports).toHaveLength(0);
    expect(browsers[0].destroyed).toBe(true);
  });

  it("reports a failed capture, and a library without files before any request", async () => {
    importFromDocument = async () => {
      throw new Error("Timed out getting the snapshot");
    };
    expect(
      await clock.run(saveArxivHtmlSnapshot(item, SOURCE, { scheduler })),
    ).toMatchObject({ status: "failed", reason: "capture" });
    expect(browsers[0].destroyed).toBe(true);

    filesEditable = false;
    steps = [];
    expect(
      await clock.run(saveArxivHtmlSnapshot(item, SOURCE, { scheduler })),
    ).toMatchObject({ status: "failed", reason: "filesNotEditable" });
    expect(steps).toEqual([]);
  });
});

const CSS = "/static/browse/0.3.4/css/";

/** A rule as the page's CSS object model gives it */
const rule = (cssText: string) => ({ cssText, layerName: undefined });
/** An @import rule into `layer` of a sheet with `rules` */
const layeredImport = (href: string, layer: string, rules: string[]) => ({
  cssText: `@import url("${href}") layer(${layer});`,
  layerName: layer,
  styleSheet: { cssRules: rules.map(rule) },
});

/** arXiv's current stylesheet for its HTML papers, once loaded */
const PAPER_SHEET = {
  cssRules: [
    layeredImport(`${CSS}ar5iv.0.9.1.min.css`, "ar5iv", [
      "@layer reset;",
      ".ltx_page_main { margin: auto; }",
    ]),
    layeredImport(`${CSS}arxiv-html-papers-theme-20260807.css`, "arxiv-theme", [
      '@font-face { font-family: "STIX Two Math"; src: url("/static/browse/0.3.4/fonts/STIXTwoMath-Regular.woff2"); }',
      "@layer header { .html-header-nav { display: flex; } }",
    ]),
    rule("@layer ar5iv, arxiv-theme;"),
  ],
};
const PAPER_STYLE =
  "@layer ar5iv {\n@layer reset;\n.ltx_page_main { margin: auto; }\n}\n" +
  '@layer arxiv-theme {\n@font-face { font-family: "STIX Two Math"; src: url("/static/browse/0.3.4/fonts/STIXTwoMath-Regular.woff2"); }\n' +
  "@layer header { .html-header-nav { display: flex; } }\n}\n" +
  "@layer ar5iv, arxiv-theme;\n";

/** What a link's sheet is: its rules, an empty sheet, or none */
type Sheet = { cssRules: unknown[] } | "empty" | "none";

/**
 * A paper's page at arxiv.org with the given stylesheet links, loaded, and
 * the styles script started in it; `messages` are the script's messages
 */
function paperPage(links: Array<[id: string, href: string, sheet: Sheet]>) {
  const window = new JSDOM(
    `<head>${links
      .map(([id, href]) => `<link id="${id}" rel="stylesheet" href="${href}">`)
      .join("")}</head><body></body>`,
    { url: "https://arxiv.org/html/2610.00014v1" },
  ).window;
  const { document } = window;
  const sheets: Record<string, unknown> = {};
  for (const [id, , sheet] of links) {
    sheets[id] =
      sheet === "none" ? null : sheet === "empty" ? { cssRules: [] } : sheet;
    Object.defineProperty(document.getElementById(id)!, "sheet", {
      get: () => sheets[id],
    });
  }
  const messages: string[] = [];
  new window.Function("content", "sendAsyncMessage", SNAPSHOT_STYLES_SCRIPT)(
    { document },
    (name: string) => messages.push(name),
  );
  const head = () =>
    [...document.head.children].map((element) =>
      element.localName === "style"
        ? `style ${element.textContent}`
        : `link ${element.getAttribute("href")}`,
    );
  /** The link's file loads (or fails) with `sheet` */
  const loaded = (id: string, sheet: Sheet, type = "load") => {
    sheets[id] = sheet === "empty" ? { cssRules: [] } : sheet;
    document.getElementById(id)!.dispatchEvent(new window.Event(type));
  };
  return { document, messages, head, loaded };
}

describe("the page's styles written in before the capture", () => {
  it("replaces a link whose sheet imports into layers by a <style> of each imported sheet's rules in its layer, and leaves other links", async () => {
    const page = paperPage([
      ["paper", `${CSS}arxiv-html-papers-20260807.css`, PAPER_SHEET],
      [
        "header",
        "/static/base/1.0.1/css/arxiv-header-footer.css",
        {
          cssRules: [
            rule('@import url("fonts.css");'),
            rule("a { color: red; }"),
          ],
        },
      ],
      [
        "typekit",
        "https://use.typekit.net/utz6mli.css",
        {
          cssRules: [rule("@font-face { font-family: rival-sans; }")],
        },
      ],
    ]);
    await flushPromises();
    expect(page.head()).toEqual([
      `style ${PAPER_STYLE}`,
      "link /static/base/1.0.1/css/arxiv-header-footer.css",
      "link https://use.typekit.net/utz6mli.css",
    ]);
    expect(page.messages).toEqual([STYLES_MESSAGE]);
  });

  it("first points a link to a deleted stylesheet of arXiv's at the current one, and writes it in once it has loaded", async () => {
    const page = paperPage([
      ["deleted", `${CSS}arxiv-html-papers-20260131.css`, "empty"],
    ]);
    await flushPromises();
    expect(page.head()).toEqual([
      `link https://arxiv.org${ARXIV_PAPER_STYLESHEET}`,
    ]);
    expect(page.messages).toEqual([]);

    page.loaded("deleted", PAPER_SHEET);
    await flushPromises();
    expect(page.head()).toEqual([`style ${PAPER_STYLE}`]);
    expect(page.messages).toEqual([STYLES_MESSAGE]);
  });

  it("leaves failed stylesheets that are not arXiv's older ones, and one whose replacement failed too", async () => {
    const page = paperPage([
      ["current", ARXIV_PAPER_STYLESHEET, "empty"],
      ["other", "https://example.org/a.css", "none"],
      ["deleted", `${CSS}arxiv-html-papers-20260131.css`, "empty"],
    ]);
    await flushPromises();
    page.loaded("deleted", "empty", "error");
    await flushPromises();
    expect(page.head()).toEqual([
      `link ${ARXIV_PAPER_STYLESHEET}`,
      "link https://example.org/a.css",
      `link https://arxiv.org${ARXIV_PAPER_STYLESHEET}`,
    ]);
    expect(page.messages).toEqual([STYLES_MESSAGE]);
  });

  it("sends its message also when a sheet cannot be read", async () => {
    const page = paperPage([
      [
        "paper",
        `${CSS}arxiv-html-papers-20260807.css`,
        {
          get cssRules(): unknown[] {
            throw new Error("SecurityError");
          },
        },
      ],
    ]);
    await flushPromises();
    expect(page.messages).toEqual([STYLES_MESSAGE]);
  });
});

describe("turning SVG objects into images", () => {
  it("turns an <object> of an SVG data URI into an <img> with the same attributes, quoted or not", () => {
    expect(svgObjectsAsImages(SVG_FIGURE)).toEqual({
      html: SVG_AS_IMAGE,
      count: 1,
    });
    expect(
      svgObjectsAsImages(
        `<OBJECT data='${SVG_DATA}' type="image/svg+xml" hidden>fallback</OBJECT>`,
      ),
    ).toEqual({ html: `<img src='${SVG_DATA}' hidden>`, count: 1 });
    expect(
      svgObjectsAsImages(
        `<object type=image/svg+xml data=${SVG_DATA} id=S0.F1.g1></object>`,
      ),
    ).toEqual({ html: `<img src=${SVG_DATA} id=S0.F1.g1>`, count: 1 });
  });

  it("leaves other objects and images alone", () => {
    const page =
      `${PNG_FIGURE}<object type=application/pdf data="data:application/pdf;base64,JVBERi0="></object>` +
      `<object type=image/svg+xml data="x1.svg"></object>`;
    expect(svgObjectsAsImages(page)).toEqual({ html: page, count: 0 });
  });
});

describe("recognising a paper's HTML snapshots", () => {
  it("takes an HTML attachment of arxiv.org/html/<id>, with or without version, and nothing else", () => {
    const version = (url: string, type?: string) =>
      htmlSnapshotVersion(
        attachment(1, url, type) as unknown as Zotero.Item,
        "2609.28538",
      );
    expect(version(URL_V2.replace("v2", "v3"))).toBe(3);
    expect(version("https://arxiv.org/html/2609.28538")).toBe(0);
    expect(version("https://arxiv.org/html/2609.28538v1/")).toBe(1);
    expect(version("http://www.arxiv.org/html/2609.28538v1")).toBe(1);
    // The arXiv translator's snapshot of the abstract page
    expect(version("https://arxiv.org/abs/2609.28538v1")).toBeNull();
    // Another paper; the PDF
    expect(version("https://arxiv.org/html/2609.285381v1")).toBeNull();
    expect(version("https://arxiv.org/html/2609.28538v1/x1.png")).toBeNull();
    expect(
      version("https://arxiv.org/html/2609.28538v1", "application/pdf"),
    ).toBeNull();
    // An old-style identifier
    expect(
      htmlSnapshotVersion(
        attachment(2, "https://arxiv.org/html/hep-ph/0101001v2") as any,
        "hep-ph/0101001",
      ),
    ).toBe(2);
  });

  it("finds the item's first snapshot of the paper, of any version or of one", () => {
    const attachments: Record<number, unknown> = {
      1: {
        getAttachments: () => [2, 3, 4],
      },
      2: attachment(2, "https://arxiv.org/abs/2609.28538v1"),
      3: attachment(3, "https://arxiv.org/html/2609.28538v1"),
      4: attachment(4, "https://arxiv.org/html/2609.28538v2"),
    };
    vi.stubGlobal("Zotero", {
      Items: { get: (id: number) => attachments[id] },
    });
    expect(htmlSnapshotID(1, "2609.28538")).toBe(3);
    expect(htmlSnapshotID(1, "2609.28538", 2)).toBe(4);
    expect(htmlSnapshotID(1, "2609.28538", 5)).toBeNull();
    expect(htmlSnapshotID(1, "2609.28540")).toBeNull();
  });
});
