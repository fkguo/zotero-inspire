import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The arXiv window's stylesheet restyles rows the References panel's
// renderer draws; its rules must reach the window's rows only, so that the
// panel looks as before.

const css = readFileSync(
  new URL("../addon/content/arxivBrowser.css", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The selectors of the rules whose block sets `property` */
function selectorsSetting(property: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => new RegExp(`(^|;|\\s)${property}\\s*:`).test(body))
    .flatMap(([, selectors]) => selectors.split(",").map((s) => s.trim()));
}

describe("arXiv window stylesheet", () => {
  it("draws the author names in the row's text colour, in the window's rows only", () => {
    const authorRules = selectorsSetting("color").filter((selector) =>
      selector.includes("zinspire-ref-entry__author-link"),
    );
    expect(authorRules).toEqual([
      ".arxiv-browser__row .zinspire-ref-entry__author-link",
    ]);
    expect(css).toMatch(
      /\.arxiv-browser__row \.zinspire-ref-entry__author-link\s*\{\s*color: inherit !important;/,
    );
  });

  it("underlines the rows' author names with dots, as the detail pane does", () => {
    const underline = (selector: string) =>
      new RegExp(
        `${selector.replace(/[.]/g, "\\.")}\\s*\\{[^}]*border-bottom: 1px dotted`,
      );
    expect(css).toMatch(
      underline(".arxiv-browser__row .zinspire-ref-entry__author-link"),
    );
    expect(css).toMatch(underline(".arxiv-browser__author"));
  });

  it("shows the rows' tick box, in-library mark and relate button as the References panel does", () => {
    const hiding = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([, selectors, body]) =>
        /zinspire-ref-entry__(checkbox|dot|link)\b/.test(selectors) &&
        /(display\s*:\s*none|visibility\s*:\s*hidden)/.test(body),
    );
    expect(hiding).toEqual([]);
  });

  it("is loaded under an address that changes with every build", () => {
    // Zotero keeps a stylesheet it has loaded, by its address, until it
    // restarts: a plugin updated in a running Zotero would draw its window
    // with the stylesheet of the build before
    const markup = readFileSync(
      new URL("../addon/content/arxivBrowser.xhtml", import.meta.url),
      "utf8",
    );
    const hrefs = [...markup.matchAll(/<\?xml-stylesheet href="([^"]+)"/g)]
      .map(([, href]) => href)
      .filter((href) => href.startsWith("chrome://__addonRef__/"));
    expect(hrefs).toEqual([
      "chrome://__addonRef__/content/arxivBrowser.css?__buildTime__",
    ]);
  });

  it("wraps the day chips onto more lines instead of scrolling them sideways", () => {
    // A horizontal scrollbar drawn over the chips cut them in half
    const block = (selector: string) =>
      [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selectors]) =>
        selectors.split(",").some((s) => s.trim() === selector),
      )?.[2] ?? "";
    expect(block(".arxiv-browser__days")).toMatch(/flex-wrap:\s*wrap/);
    expect(selectorsSetting("overflow-x")).not.toContain(
      ".arxiv-browser__days",
    );
    expect(selectorsSetting("overflow")).not.toContain(".arxiv-browser__days");
    // Hidden during a search, with the order and the sections
    expect(block(".arxiv-browser__days[hidden]")).toMatch(/display:\s*none/);
    expect(block(".arxiv-browser__label[hidden]")).toMatch(/display:\s*none/);
    expect(block(".arxiv-browser__sections[hidden]")).toMatch(
      /display:\s*none/,
    );
  });

  it("draws the HTML button and its menu as one system button, like the PDF button", () => {
    // A button given its own corners, border or background loses the
    // system's drawing and turns square and bevelled
    expect(css).toMatch(
      /\.arxiv-browser__split\s*\{[^}]*-moz-default-appearance:\s*button;/,
    );
    const ownDrawing = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([selectors, , body]) =>
        /arxiv-browser__split/.test(selectors) &&
        /border(-[a-z-]+)?-radius\s*:/.test(body),
    );
    expect(ownDrawing).toEqual([]);
    expect(css).toMatch(
      /\.arxiv-browser__split > \.arxiv-browser__button\s*\{[^}]*appearance:\s*none;[^}]*border:\s*none;[^}]*background:\s*transparent;/,
    );
  });

  it("styles the References panel's row parts only inside the window's rows", () => {
    const panelParts = [...css.matchAll(/([^{}]+)\{/g)]
      .flatMap(([, selectors]) => selectors.split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.includes(".zinspire-"));
    expect(panelParts.length).toBeGreaterThan(0);
    for (const selector of panelParts) {
      expect(selector).toMatch(/^\.arxiv-browser__/);
    }
  });
});
