// ─────────────────────────────────────────────────────────────────────────────
// arXiv's stylesheet put back in a paper's HTML page whose own stylesheet
// file arXiv has deleted: a link to one of arXiv's dated stylesheets for its
// HTML papers that fails to load (its error, or an empty sheet once the page
// has loaded) is pointed at the current file. Other stylesheets, and pages
// whose stylesheet loads, stay as they are.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  ARXIV_PAPER_STYLESHEET,
  RESTORE_STYLESHEET_SCRIPT,
} from "../src/modules/arxiv/arxivHtmlStylesheet";

const CSS = "/static/browse/0.3.4/css/";
const CURRENT = `https://arxiv.org${ARXIV_PAPER_STYLESHEET}`;

/** What a link's sheet is after its load: rules, an empty sheet, or none */
type Sheet = number | "empty" | "none";

/**
 * A paper's page at arxiv.org with the given stylesheet links, readyState
 * `ready`, and the script started in it
 */
function page(
  links: Array<[id: string, href: string, sheet: Sheet]>,
  ready: string,
) {
  const window = new JSDOM(
    `<head>${links
      .map(([id, href]) => `<link id="${id}" rel="stylesheet" href="${href}">`)
      .join("")}</head><body></body>`,
    { url: "https://arxiv.org/html/2610.00014" },
  ).window;
  const { document } = window;
  for (const [id, , sheet] of links) {
    const value =
      sheet === "none"
        ? null
        : { cssRules: new Array(sheet === "empty" ? 0 : sheet).fill({}) };
    Object.defineProperty(document.getElementById(id)!, "sheet", { value });
  }
  Object.defineProperty(document, "readyState", { value: ready });
  const listeners: Record<string, (event: { target: unknown }) => void> = {};
  new window.Function("addEventListener", "content", RESTORE_STYLESHEET_SCRIPT)(
    (
      type: string,
      listener: (event: { target: unknown }) => void,
      capture: boolean,
    ) => {
      listeners[type] = listener;
      window.addEventListener(type, listener as () => void, capture);
    },
    { document },
  );
  const href = (id: string) =>
    (document.getElementById(id) as HTMLLinkElement).href;
  const error = (id: string) =>
    document.getElementById(id)!.dispatchEvent(new window.Event("error"));
  /** The window's load event (its target is the document, in Gecko) */
  const loaded = () => listeners.load({ target: document });
  const link = (id: string) => document.getElementById(id);
  return { href, error, loaded, link, listeners };
}

describe("arXiv HTML page: a deleted stylesheet replaced by arXiv's current one", () => {
  it("points a link whose load fails at the current stylesheet, and only arXiv's paper stylesheets", () => {
    const { href, error } = page(
      [
        ["deleted", `${CSS}arxiv-html-papers-20260131.css`, "empty"],
        ["current", ARXIV_PAPER_STYLESHEET, "empty"],
        ["theme", `${CSS}arxiv-html-papers-theme-20260807.css`, "empty"],
        [
          "other",
          "https://example.org/static/browse/0.3.4/css/arxiv-html-papers-20260131.css",
          "empty",
        ],
        ["header", "/static/base/1.0.1/css/arxiv-header-footer.css", "empty"],
      ],
      "loading",
    );
    // Nothing done while the page loads
    expect(href("deleted")).toBe(
      `https://arxiv.org${CSS}arxiv-html-papers-20260131.css`,
    );

    error("deleted");
    expect(href("deleted")).toBe(CURRENT);
    // The current file failing too: left so (no second try)
    error("deleted");
    error("current");
    expect(href("deleted")).toBe(CURRENT);
    expect(href("current")).toBe(CURRENT);
    for (const id of ["theme", "other", "header"]) error(id);
    expect(href("theme")).toBe(
      `https://arxiv.org${CSS}arxiv-html-papers-theme-20260807.css`,
    );
    expect(href("other")).toBe(
      "https://example.org/static/browse/0.3.4/css/arxiv-html-papers-20260131.css",
    );
    expect(href("header")).toBe(
      "https://arxiv.org/static/base/1.0.1/css/arxiv-header-footer.css",
    );
  });

  it("looks at the page's stylesheets once all have loaded: a failed one (empty or no sheet) is replaced, a working one kept", () => {
    const links: Array<[string, string, Sheet]> = [
      ["empty", `${CSS}arxiv-html-papers-20260131.css`, "empty"],
      ["none", `${CSS}arxiv-html-papers-20250916.css`, "none"],
      ["working", `${CSS}arxiv-html-papers-20260807.css`, 3],
      ["fonts", "https://use.typekit.net/utz6mli.css", "empty"],
    ];
    const loading = page(links, "loading");
    // An image's or a stylesheet's load event is not the page's
    loading.listeners.load({ target: loading.link("empty") });
    expect(loading.href("empty")).toBe(
      `https://arxiv.org${CSS}arxiv-html-papers-20260131.css`,
    );
    loading.loaded();
    expect(loading.href("empty")).toBe(CURRENT);
    expect(loading.href("none")).toBe(CURRENT);
    expect(loading.href("working")).toBe(
      `https://arxiv.org${CSS}arxiv-html-papers-20260807.css`,
    );
    expect(loading.href("fonts")).toBe("https://use.typekit.net/utz6mli.css");

    // The script started after the page had loaded: it looks at once
    const complete = page(links, "complete");
    expect(complete.href("empty")).toBe(CURRENT);
    expect(complete.href("working")).toBe(
      `https://arxiv.org${CSS}arxiv-html-papers-20260807.css`,
    );
  });
});
