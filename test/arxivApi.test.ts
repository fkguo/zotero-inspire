import { describe, expect, it } from "vitest";
import {
  apiBatches,
  apiUrl,
  fetchArxivApiEntries,
  parseApiFeed,
} from "../src/modules/arxiv/arxivApi";
import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import { readArxivFixture, xmlDocument } from "./arxivFixtures";
import { SimulatedArxiv } from "./arxivSite";
import { VirtualClock } from "./virtualClock";

// The arXiv API client on real answers of export.arxiv.org (fixtures
// api-idlist-5.xml: 5 papers returned in another order than asked;
// api-idlist-14-default-max10.xml: 14 asked without max_results, 10 returned).

const FIVE = [
  "1706.03762",
  "1801.00862",
  "2103.00001",
  "2609.28534",
  "2502.20357",
];
const FOURTEEN = [
  "2609.28538",
  "2609.28544",
  "2609.28555",
  "2609.28616",
  "2609.28619",
  "2609.28686",
  "2609.28700",
  "2609.28704",
  "2609.28740",
  "2609.28752",
  "2609.28819",
  "2609.28840",
  "2609.29025",
  "2609.29135",
];

function setup() {
  const clock = new VirtualClock(Date.parse("2026-09-28T02:00:00Z"));
  const site = new SimulatedArxiv(clock, () => 400);
  const scheduler = new ArxivScheduler({
    host: "export.arxiv.org",
    minIntervalMs: 3000,
    timeoutMs: 30000,
    transport: site.transport,
    clock,
  });
  const fetch = (ids: string[], signal?: AbortSignal) =>
    clock.run(
      fetchArxivApiEntries(ids, { scheduler, parseXml: xmlDocument, signal }),
    );
  return { clock, site, fetch };
}

/** A feed with one entry per identifier */
function feed(ids: string[]): string {
  const entries = ids
    .map(
      (
        id,
      ) => `<entry><id>http://arxiv.org/abs/${id}v1</id><title>T ${id}</title>
      <summary>A ${id}</summary><published>2026-09-24T12:00:00Z</published>
      <updated>2026-09-24T12:00:00Z</updated><author><name>A. Author</name></author>
      <arxiv:primary_category term="hep-ph"/><category term="hep-ph" scheme="http://arxiv.org/schemas/atom"/></entry>`,
    )
    .join("");
  return `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
}

describe("parseApiFeed", () => {
  const entries = parseApiFeed(
    xmlDocument(readArxivFixture("api-idlist-5.xml")),
  );

  it("reads every entry by identifier, whatever the order", () => {
    expect([...entries.keys()].sort()).toEqual([...FIVE].sort());
  });

  it("reads the current version and its fields", () => {
    const attention = entries.get("1706.03762")!;
    expect(attention).toMatchObject({
      id: "1706.03762",
      version: 7,
      title: "Attention Is All You Need",
      published: "2017-06-12T17:57:34Z",
      updated: "2023-08-02T00:41:18Z",
      pdfUrl: "https://arxiv.org/pdf/1706.03762v7",
      comments: "15 pages, 5 figures",
      primaryCategory: "cs.CL",
      categories: ["cs.CL", "cs.LG"],
    });
    expect(attention.authors).toHaveLength(8);
    expect(attention.authors[5]).toBe("Aidan N. Gomez");
    expect(attention.abstract).toMatch(
      /^The dominant sequence transduction models/,
    );
    expect(attention.doi).toBeUndefined();
  });

  it("reads the journal DOI and reference the authors entered", () => {
    expect(entries.get("2103.00001")).toMatchObject({
      version: 3,
      doi: "10.1038/s41524-021-00644-z",
      journalRef: "npj Comput Mater 7, 175 (2021)",
      primaryCategory: "eess.IV",
    });
  });

  it("rejects what is not an Atom feed", () => {
    expect(() =>
      parseApiFeed(xmlDocument("<html><body>busy</body></html>")),
    ).toThrow(/Atom/);
  });

  it("leaves out the API's error entries", () => {
    const withError = feed(["2609.28538"]).replace(
      "</feed>",
      `<entry><id>http://arxiv.org/api/errors#incorrect_id_format_for_2609.1</id><title>Error</title></entry></feed>`,
    );
    expect([...parseApiFeed(xmlDocument(withError)).keys()]).toEqual([
      "2609.28538",
    ]);
  });
});

describe("fetchArxivApiEntries", () => {
  it("asks for a batch with max_results set to its size", async () => {
    const { site, fetch } = setup();
    site.html(apiUrl(FIVE), readArxivFixture("api-idlist-5.xml"));
    const result = await fetch(FIVE);
    expect(site.sent.map((request) => request.url)).toEqual([
      `https://export.arxiv.org/api/query?id_list=${FIVE.join(",")}&max_results=5`,
    ]);
    expect(result.entries.size).toBe(5);
    expect(result.missing).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("reports the papers an answer leaves out", async () => {
    const { site, fetch } = setup();
    // The real answer to these 14 without max_results: only 10 entries
    site.html(
      apiUrl(FOURTEEN),
      readArxivFixture("api-idlist-14-default-max10.xml"),
    );
    const result = await fetch(FOURTEEN);
    expect(result.entries.size).toBe(10);
    expect(result.missing).toEqual([
      "2609.28555",
      "2609.28616",
      "2609.28740",
      "2609.29025",
    ]);
  });

  it("splits more than 50 papers into batches, 3 s apart", async () => {
    const { site, fetch } = setup();
    const ids = Array.from({ length: 120 }, (_, i) => `2609.${20000 + i}`);
    const batches = apiBatches(ids);
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 20]);
    for (const batch of batches) site.html(apiUrl(batch), feed(batch));
    const result = await fetch([...ids, ids[0]]);
    expect(result.entries.size).toBe(120);
    expect(
      site.sent.map((request) =>
        new URL(request.url).searchParams.get("max_results"),
      ),
    ).toEqual(["50", "50", "20"]);
    expect(
      site.sent.map((request) => request.start - site.sent[0].start),
    ).toEqual([0, 3400, 6800]);
  });

  it("sends a failed batch once more", async () => {
    const { site, fetch } = setup();
    const ids = ["2609.28538", "2609.28544"];
    site.page(apiUrl(ids), (attempt) =>
      attempt === 1 ? { status: 500, text: "error" } : { text: feed(ids) },
    );
    const result = await fetch(ids);
    expect(site.count(apiUrl(ids))).toBe(2);
    expect(result.entries.size).toBe(2);
  });

  it("reports a batch that fails twice and goes on with the others", async () => {
    const { site, fetch } = setup();
    const ids = Array.from({ length: 60 }, (_, i) => `2609.${30000 + i}`);
    const [first, second] = apiBatches(ids);
    site.page(apiUrl(first), { text: "<html>not xml" });
    site.html(apiUrl(second), feed(second));
    const result = await fetch(ids);
    expect(site.count(apiUrl(first))).toBe(2);
    expect(result.failed).toEqual([
      { ids: first, reason: "parse", message: expect.any(String) },
    ]);
    expect(result.entries.size).toBe(10);
    expect(result.missing).toEqual([]);
  });

  it("sends no further batch after arXiv refuses", async () => {
    const { site, fetch } = setup();
    const ids = Array.from({ length: 60 }, (_, i) => `2609.${40000 + i}`);
    const [first, second] = apiBatches(ids);
    site.page(apiUrl(first), { status: 403 });
    const result = await fetch(ids);
    expect(site.sent).toHaveLength(1);
    expect(
      result.failed.map((failure) => [failure.ids.length, failure.reason]),
    ).toEqual([
      [50, "forbidden"],
      [10, "forbidden"],
    ]);
    expect(result.failed[1].ids).toEqual(second);
  });
});
