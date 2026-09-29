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
      /\.arxiv-browser__row \.zinspire-ref-entry__author-link\s*\{\s*color: inherit !important;\s*\}/,
    );
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
