// Helpers for tests that read the arXiv pages in test/fixtures/arxiv.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

export const ARXIV_FIXTURES = join(__dirname, "fixtures", "arxiv");

export function readArxivFixture(name: string): string {
  return readFileSync(join(ARXIV_FIXTURES, name), "utf-8");
}

/** Parse HTML the way the plugin does (an HTML document, no scripts) */
export function htmlDocument(html: string): Document {
  return new JSDOM(html).window.document;
}

export function fixtureDocument(name: string): Document {
  return htmlDocument(readArxivFixture(name));
}

/** Parse XML (the arXiv API's Atom feed) */
export function xmlDocument(xml: string): Document {
  return new new JSDOM("").window.DOMParser().parseFromString(
    xml,
    "application/xml",
  );
}
