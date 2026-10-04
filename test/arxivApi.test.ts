import { describe, expect, it } from "vitest";
import {
  apiBatches,
  apiUrl,
  arxivSearchQuery,
  fetchArxivApiEntries,
  fetchArxivApiVersion,
  parseApiFeed,
  parseSearchFeed,
  searchArxiv,
  searchUrl,
} from "../src/modules/arxiv/arxivApi";
import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import { readArxivFixture, xmlDocument } from "./arxivFixtures";
import { SimulatedArxiv } from "./arxivSite";
import { VirtualClock } from "./virtualClock";

// The arXiv API client on real answers of export.arxiv.org (fixtures
// api-idlist-5.xml: 5 papers returned in another order than asked;
// api-idlist-14-default-max10.xml: 14 asked without max_results, 10 returned;
// api-idlist-1706.03762v2.xml: version 2 of a paper whose newest is 7).

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
  const search = (
    query: string,
    start: number,
    count: number,
    signal?: AbortSignal,
  ) =>
    clock.run(
      searchArxiv(query, start, count, {
        scheduler,
        parseXml: xmlDocument,
        signal,
      }),
    );
  return { clock, site, fetch, search, scheduler };
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

describe("fetchArxivApiVersion", () => {
  const V2 =
    "https://export.arxiv.org/api/query?id_list=1706.03762v2&max_results=1";

  it("gives the version asked for, with its own submission and comments", async () => {
    const { site, clock, scheduler } = setup();
    site.html(V2, readArxivFixture("api-idlist-1706.03762v2.xml"));
    const answer = await clock.run(
      fetchArxivApiVersion("1706.03762", 2, {
        scheduler,
        parseXml: xmlDocument,
      }),
    );
    expect(site.sent.map((request) => request.url)).toEqual([V2]);
    expect(answer.ok).toBe(true);
    const entry = answer.ok ? answer.entry : undefined;
    expect(entry).toMatchObject({
      id: "1706.03762",
      version: 2,
      title: "Attention Is All You Need",
      // Version 1's submission, and version 2's
      published: "2017-06-12T17:57:34Z",
      updated: "2017-06-19T16:49:45Z",
      comments: "15 pages, 5 figure",
      categories: ["cs.CL", "cs.LG"],
    });
  });

  it("fails when the answer holds another version", async () => {
    const { site, clock, scheduler } = setup();
    site.html(V2, feed(["1706.03762"]));
    const answer = await clock.run(
      fetchArxivApiVersion("1706.03762", 2, {
        scheduler,
        parseXml: xmlDocument,
      }),
    );
    expect(answer).toMatchObject({ ok: false, reason: "parse" });
  });

  it("gives the newest version when none is asked for", async () => {
    const { site, clock, scheduler } = setup();
    const newest =
      "https://export.arxiv.org/api/query?id_list=1706.03762&max_results=1";
    site.html(newest, feed(["1706.03762"]));
    const answer = await clock.run(
      fetchArxivApiVersion("1706.03762", undefined, {
        scheduler,
        parseXml: xmlDocument,
      }),
    );
    expect(site.sent.map((request) => request.url)).toEqual([newest]);
    expect(answer).toMatchObject({ ok: true, entry: { id: "1706.03762" } });
  });
});

describe("arxivSearchQuery", () => {
  it("searches all fields for plain words, all of which must match", () => {
    expect(arxivSearchQuery("tetraquark")).toBe("all:tetraquark");
    expect(arxivSearchQuery("  chiral   perturbation ")).toBe(
      "all:chiral AND all:perturbation",
    );
    expect(arxivSearchQuery('"chiral perturbation" theory')).toBe(
      'all:"chiral perturbation" AND all:theory',
    );
  });

  it("passes arXiv's syntax through", () => {
    expect(arxivSearchQuery("au:Guo_F_K")).toBe("au:Guo_F_K");
    expect(arxivSearchQuery("cat:hep-ph AND ti:tetraquark")).toBe(
      "cat:hep-ph AND ti:tetraquark",
    );
    expect(
      arxivSearchQuery('au:del_maestro ANDNOT (ti:checkerboard OR ti:"a b")'),
    ).toBe('au:del_maestro ANDNOT ( ti:checkerboard OR ti:"a b" )');
    expect(
      arxivSearchQuery(
        "au:del_maestro submittedDate:[202301010600 TO 202401010600]",
      ),
    ).toBe("au:del_maestro AND submittedDate:[202301010600 TO 202401010600]");
    // A field term next to a plain word: both must match
    expect(arxivSearchQuery("cat:hep-lat pion")).toBe(
      "cat:hep-lat AND all:pion",
    );
  });

  it("reads and / or typed in lower case as the operators", () => {
    expect(arxivSearchQuery("pion or kaon and mass")).toBe(
      "all:pion OR all:kaon AND all:mass",
    );
    expect(arxivSearchQuery('ti:"pion and kaon"')).toBe('ti:"pion and kaon"');
  });

  it("closes an open quote or bracket and drops a trailing operator", () => {
    expect(arxivSearchQuery('ti:"quantum critic')).toBe('ti:"quantum critic"');
    expect(arxivSearchQuery("submittedDate:[2023 TO 2024")).toBe(
      "submittedDate:[2023 TO 2024]",
    );
    expect(arxivSearchQuery("au:witten AND")).toBe("au:witten");
  });

  it("gives nothing for nothing typed", () => {
    expect(arxivSearchQuery("")).toBe("");
    expect(arxivSearchQuery("   ")).toBe("");
  });
});

describe("searchUrl", () => {
  it("asks for one page, newest submission first", () => {
    const url = new URL(searchUrl('cat:hep-ph AND ti:"x y"', 50, 50));
    expect(url.origin + url.pathname).toBe(
      "https://export.arxiv.org/api/query",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search_query: 'cat:hep-ph AND ti:"x y"',
      sortBy: "submittedDate",
      sortOrder: "descending",
      start: "50",
      max_results: "50",
    });
    // Spaces as + (arXiv's own examples)
    expect(url.search).toContain(
      "search_query=cat%3Ahep-ph+AND+ti%3A%22x+y%22&",
    );
  });
});

describe("parseSearchFeed", () => {
  it("reads a real answer: papers in arXiv's order and the total", () => {
    // cat:hep-ph AND ti:tetraquark, 3 of 809, saved 29 Sep 2026
    const answer = parseSearchFeed(
      xmlDocument(readArxivFixture("api-search-hep-ph-tetraquark-3.xml")),
    );
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.total).toBe(809);
    expect(answer.entries.map((entry) => entry.id)).toEqual([
      "2609.10822",
      "2609.04628",
      "2609.04049",
    ]);
    expect(answer.entries[0]).toMatchObject({
      version: 2,
      title:
        "A Colour-Casimir Adjacency Matrix Approach to Fully-Heavy Tetraquarks",
      published: "2026-09-09T20:48:58Z",
      primaryCategory: "hep-ph",
    });
  });

  it("gives arXiv's message for a search it refuses", () => {
    // ti:( answered with HTTP 400 and an error entry
    expect(
      parseSearchFeed(
        xmlDocument(readArxivFixture("api-search-error-400.xml")),
      ),
    ).toEqual({
      ok: false,
      reason: "query",
      message: "Invalid query string: '('",
    });
  });
});

describe("searchArxiv", () => {
  it("sends one request through the API scheduler per page, 3 s apart", async () => {
    const { site, search } = setup();
    const query = "all:pion";
    site.html(searchUrl(query, 0, 2), feed(["2609.10001", "2609.10002"]));
    site.html(searchUrl(query, 2, 2), feed(["2609.10003"]));
    const first = await search(query, 0, 2);
    const second = await search(query, 2, 2);
    expect(first.ok && first.entries.map((entry) => entry.id)).toEqual([
      "2609.10001",
      "2609.10002",
    ]);
    expect(second.ok && second.entries.map((entry) => entry.id)).toEqual([
      "2609.10003",
    ]);
    expect(
      site.sent.map((request) => request.start - site.sent[0].start),
    ).toEqual([0, 3400]);
  });

  it("reports a search arXiv refuses with its message", async () => {
    const { site, search } = setup();
    site.page(searchUrl("ti:(", 0, 50), {
      status: 400,
      text: readArxivFixture("api-search-error-400.xml"),
    });
    expect(await search("ti:(", 0, 50)).toEqual({
      ok: false,
      reason: "query",
      message: "Invalid query string: '('",
    });
  });

  it("leaves 503 to the scheduler, and reports other statuses", async () => {
    const { site, search } = setup();
    site.page(searchUrl("all:a", 0, 50), { status: 503 });
    expect(await search("all:a", 0, 50)).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
    site.page(searchUrl("all:b", 0, 50), { status: 500, text: "error" });
    expect(await search("all:b", 0, 50)).toMatchObject({
      ok: false,
      reason: "http",
    });
  });

  it("can be cancelled while it waits for its turn", async () => {
    const { site, clock, scheduler } = setup();
    site.html(searchUrl("all:a", 0, 50), feed(["2609.10001"]));
    site.html(searchUrl("all:b", 0, 50), feed(["2609.10002"]));
    const controller = new AbortController();
    const options = { scheduler, parseXml: xmlDocument };
    const first = searchArxiv("all:a", 0, 50, options);
    const second = searchArxiv("all:b", 0, 50, {
      ...options,
      signal: controller.signal,
    });
    controller.abort();
    await clock.run(Promise.all([first, second]));
    expect(await second).toMatchObject({ ok: false, reason: "cancelled" });
    expect(site.sent.map((request) => request.url)).toEqual([
      searchUrl("all:a", 0, 50),
    ]);
  });
});
