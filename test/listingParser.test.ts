import { describe, expect, it } from "vitest";
import {
  assembleSpecDay,
  ListingParseError,
  listingId,
  parseCatchupPage,
  parseNewPage,
  parseRecentIndex,
} from "../src/modules/arxiv/listingParser";
import type { ListingPage } from "../src/modules/arxiv/listingTypes";
import {
  fixtureDocument,
  htmlDocument,
  readArxivFixture,
} from "./arxivFixtures";

// Listing pages saved from arxiv.org (test/fixtures/arxiv, see its README).
// Expected values were read off the raw HTML, not from the parser.

const HEP_PH_NEW = "list-hep-ph-new-2026-09-25.html";
const CS_LG_PAGES = [0, 100, 200, 300].map(
  (skip) => `list-cs.LG-new-show100-skip${skip}-2026-09-25.html`,
);

function sectionSummary(page: ListingPage) {
  return page.sections.map((s) => `${s.section} ${s.shown}/${s.total}`);
}

/** The fixture with `replace` applied once (it must match) */
function editedDocument(
  name: string,
  search: string | RegExp,
  replacement: string,
): Document {
  const html = readArxivFixture(name);
  const edited = html.replace(search, replacement);
  expect(edited).not.toBe(html);
  return htmlDocument(edited);
}

describe("parseNewPage on hep-ph /new of 25 September 2026", () => {
  const page = parseNewPage(fixtureDocument(HEP_PH_NEW));
  const byId = new Map(page.entries.map((entry) => [entry.id, entry]));

  it("reads the date, total and the three sections", () => {
    expect(page.kind).toBe("new");
    expect(page.date).toBe("2026-09-25");
    expect(page.total).toBe(72);
    expect(sectionSummary(page)).toEqual([
      "new 27/27",
      "cross 15/15",
      "replace 30/30",
    ]);
    expect(page.entries).toHaveLength(72);
    expect(page.firstIndex).toBe(1);
    expect(page.next).toBeNull();
    expect(page.nextDay).toBeUndefined();
  });

  it("assigns each entry the section of its list", () => {
    const counts = { new: 0, cross: 0, replace: 0 };
    for (const entry of page.entries) counts[entry.section]++;
    expect(counts).toEqual({ new: 27, cross: 15, replace: 30 });
    expect(byId.get("2609.22470")?.section).toBe("cross");
    expect(byId.get("2502.20357")?.section).toBe("replace");
  });

  it("reads title, version, categories and the author split", () => {
    const entry = byId.get("2609.28538")!;
    expect(entry.title).toBe(
      "Spectral shaping of Gaussian white noise for synthetic axion signal generation in microwave cavity haloscopes",
    );
    expect(entry.version).toBe(1);
    expect(entry.primaryCategory).toBe("hep-ph");
    expect(entry.categories).toEqual(["hep-ph", "physics.ins-det"]);
    expect(entry.authors).toHaveLength(9);
    expect(entry.authors[0]).toEqual({
      display: "D. Vattolo",
      family: "Vattolo",
      given: "D.",
    });
    // arXiv's own split keeps the particle with the surname
    expect(entry.authors[3]).toEqual({
      display: "R. Di Vora",
      family: "Di Vora",
      given: "R.",
    });
    // Known limitation (design 5.3): a double surname without particle is
    // split by arXiv itself as surname "Infirri"
    expect(entry.authors[7]).toEqual({
      display: "G. Sardo Infirri",
      family: "Infirri",
      given: "G. Sardo",
    });
  });

  it("reads cross-lists with their own primary category", () => {
    const entry = byId.get("2609.22470")!;
    expect(entry.primaryCategory).toBe("astro-ph.CO");
    expect(entry.categories).toEqual([
      "astro-ph.CO",
      "gr-qc",
      "hep-ph",
      "hep-th",
    ]);
    expect(entry.comments).toBe(
      "6 pages, 1 figure, to be submitted to MNRAS letters",
    );
  });

  it("turns <br> into a line break and links into their text", () => {
    const withBreak = byId.get("2609.28544")!;
    expect(withBreak.abstract.split("\n")).toHaveLength(2);
    expect(withBreak.abstract).toMatch(
      /Dalgarno--Lewis perturbative method with the Coulomb part as parent\.\nThe numerical study/,
    );
    expect(withBreak.abstract).not.toMatch(/^\s|\s$/);
    expect(withBreak.journalRef).toBe(
      "published in Eur. Phys. J. Plus (2025) 140:1069",
    );

    const withLink = byId.get("2609.28617")!;
    expect(withLink.abstract).toContain(
      "we include a Python script this http URL which implements",
    );
    expect(withLink.comments).toBe(
      "57 pages, 7 figures, ancillary file this http URL",
    );
    expect(byId.get("2506.21871")?.comments).toContain(
      "in arXiv:2510.04223(v2) and will not be published separately",
    );
  });

  it("keeps TeX left in titles and abstracts", () => {
    expect(byId.get("2609.28544")?.title).toBe(
      "Hyperfine Structure of $B$ and $D$ Mesons in a QCD-Inspired Potential Model",
    );
    expect(byId.get("2609.28544")?.abstract).toContain("$\\alpha_s$");
  });

  it("takes the version only from an entry's HTML link", () => {
    expect(byId.get("2502.20357")?.version).toBe(2);
    expect(byId.get("2402.00473")?.version).toBe(4);
    expect(byId.get("2506.21871")).toBeDefined();
    expect(byId.get("2506.21871")?.version).toBeUndefined();
  });
});

describe("parseNewPage on multi-page listings", () => {
  const pages = CS_LG_PAGES.map((name) => parseNewPage(fixtureDocument(name)));

  it("reads each page's range, next page and partial sections", () => {
    expect(pages.map((page) => [page.firstIndex, page.next])).toEqual([
      [1, 100],
      [101, 200],
      [201, 300],
      [301, null],
    ]);
    expect(pages.map((page) => page.entries.length)).toEqual([
      100, 100, 100, 31,
    ]);
    expect(pages.map(sectionSummary)).toEqual([
      ["new 100/119"],
      ["new 19/119", "cross 81/111"],
      ["cross 30/111", "replace 70/101"],
      ["replace 31/101"],
    ]);
    for (const page of pages) {
      expect(page.date).toBe("2026-09-25");
      expect(page.total).toBe(331);
    }
  });

  it("reads a first page whose later sections are complete", () => {
    const page = parseNewPage(
      fixtureDocument("list-astro-ph.CO-new-show25-2026-09-25.html"),
    );
    expect(page.total).toBe(37);
    expect([page.firstIndex, page.next]).toEqual([1, 25]);
    expect(sectionSummary(page)).toEqual([
      "new 7/7",
      "cross 13/13",
      "replace 5/17",
    ]);

    const quantPh = parseNewPage(
      fixtureDocument("list-quant-ph-new-show25-2026-09-25.html"),
    );
    expect([quantPh.total, quantPh.next]).toEqual([137, 25]);
    expect(sectionSummary(quantPh)).toEqual(["new 25/73"]);
  });

  it("reads an archive page with papers from aliased categories", () => {
    // Trimmed copy of math /new: entries removed, counts set to the rest
    const page = parseNewPage(
      fixtureDocument("list-math-new-2026-09-25-trimmed.html"),
    );
    expect(sectionSummary(page)).toEqual([
      "new 12/12",
      "cross 8/8",
      "replace 13/13",
    ]);
    expect(page.total).toBe(33);
    const byId = new Map(page.entries.map((entry) => [entry.id, entry]));
    // cs.IT (alias math.IT) and math-ph (alias math.MP) papers are new
    // submissions of the math archive, not cross-lists
    const aliased = page.entries.filter(
      (entry) =>
        entry.section === "new" &&
        ["cs.IT", "math-ph"].includes(entry.primaryCategory),
    );
    expect(aliased.map((entry) => entry.primaryCategory).sort()).toEqual([
      "cs.IT",
      "cs.IT",
      "math-ph",
      "math-ph",
    ]);
    // A replacement of an old-style identifier
    expect(byId.get("math/0702261")?.section).toBe("replace");
    expect(byId.get("2609.28500")?.section).toBe("new");
  });

  it("reads a /new page of a day without papers as complete and empty", () => {
    const page = parseNewPage(
      fixtureDocument("list-cs.GL-new-empty-2026-09-25.html"),
    );
    expect(page).toMatchObject({
      kind: "new",
      date: "2026-09-25",
      total: 0,
      entries: [],
      sections: [],
      next: null,
    });
  });
});

describe("parseCatchupPage", () => {
  it("reads a day with abstracts and its next-day link", () => {
    const page = parseCatchupPage(
      fixtureDocument("catchup-hep-ph-2026-09-21.html"),
    );
    expect(page.kind).toBe("catchup");
    expect(page.date).toBe("2026-09-21");
    expect(page.total).toBe(57);
    expect(sectionSummary(page)).toEqual([
      "new 23/23",
      "cross 10/10",
      "replace 24/24",
    ]);
    expect([page.pageNumber, page.next, page.firstIndex]).toEqual([1, null, 1]);
    expect(page.nextDay).toBe("2026-09-22");
    expect(page.entries[0]).toMatchObject({
      id: "2609.20914",
      title: "All-Order Helicity Selection Rules in Effective Field Theories",
      comments: "4 pages",
      categories: ["hep-ph", "hep-th"],
    });
    expect(page.entries[0].abstract).toMatch(/^Using on-shell methods/);
  });

  it("reads page 2 of a day (trimmed copy)", () => {
    const page = parseCatchupPage(
      fixtureDocument("catchup-cs-2026-09-22-page2-trimmed.html"),
    );
    expect(page.date).toBe("2026-09-22");
    expect(page.total).toBe(2274);
    expect([page.pageNumber, page.next, page.firstIndex]).toEqual([
      2,
      null,
      2001,
    ]);
    expect(sectionSummary(page)).toEqual(["replace 3/735"]);
    expect(page.nextDay).toBe("2026-09-23");
  });

  it("reads empty days: a past day, the latest day, a weekend, a holiday", () => {
    const past = parseCatchupPage(
      fixtureDocument("catchup-cs.GL-2026-09-24-empty.html"),
    );
    expect(past).toMatchObject({
      total: 0,
      entries: [],
      nextDay: "2026-09-25",
    });
    const latest = parseCatchupPage(
      fixtureDocument("catchup-cs.GL-2026-09-25-empty-latest.html"),
    );
    expect(latest).toMatchObject({ total: 0, entries: [], nextDay: null });
    const weekend = parseCatchupPage(
      fixtureDocument("catchup-hep-ph-2026-09-19-weekend-noabs.html"),
    );
    expect(weekend).toMatchObject({
      date: "2026-09-19",
      total: 0,
      nextDay: "2026-09-21",
    });
    const holiday = parseCatchupPage(
      fixtureDocument("catchup-hep-ph-2026-09-08-holiday-noabs.html"),
    );
    expect(holiday).toMatchObject({
      date: "2026-09-08",
      total: 0,
      nextDay: "2026-09-09",
    });
  });

  it("rejects arXiv's out-of-range error page", () => {
    expect(() =>
      parseCatchupPage(
        fixtureDocument("catchup-hep-ph-2026-06-01-status400.html"),
      ),
    ).toThrow(ListingParseError);
  });
});

describe("parseRecentIndex", () => {
  it("reads the five dates of the math recent index", () => {
    expect(
      parseRecentIndex(
        fixtureDocument("list-math-recent-show25-2026-09-25.html"),
      ),
    ).toEqual([
      "2026-09-25",
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
    ]);
  });

  it("rejects a page without the index", () => {
    expect(() => parseRecentIndex(fixtureDocument(HEP_PH_NEW))).toThrow(
      ListingParseError,
    );
  });
});

describe("page checks catch damaged pages", () => {
  it("a <dt> without its <dd>", () => {
    const doc = editedDocument(
      HEP_PH_NEW,
      /(<a href ="\/abs\/2609\.28538"[\s\S]*?<\/dt>)\s*<dd>[\s\S]*?<\/dd>/,
      "$1",
    );
    expect(() => parseNewPage(doc)).toThrow(/dt|entries/);
  });

  it("a section count that differs from its entries", () => {
    const doc = editedDocument(
      HEP_PH_NEW,
      /showing 27 of 27 entries/g,
      "showing 26 of 27 entries",
    );
    expect(() => parseNewPage(doc)).toThrow(/26/);
  });

  it("an unreadable section heading", () => {
    const doc = editedDocument(
      HEP_PH_NEW,
      /Cross submissions \(showing 15 of 15 entries\)/g,
      "Cross submissions (15 entries)",
    );
    expect(() => parseNewPage(doc)).toThrow(/heading/);
  });

  it("accepts white space inside a heading", () => {
    const doc = editedDocument(
      HEP_PH_NEW,
      /Cross submissions \(showing 15 of 15 entries\)/g,
      "Cross submissions  ( showing 15 of 15 entries )",
    );
    expect(sectionSummary(parseNewPage(doc))).toContain("cross 15/15");
  });

  it("an identifier twice on one page", () => {
    const doc = editedDocument(
      HEP_PH_NEW,
      /\/abs\/2609\.28544"/,
      '/abs/2609.28538"',
    );
    expect(() => parseNewPage(doc)).toThrow(/twice/);
  });

  it("a header date whose weekday is wrong", () => {
    const doc = editedDocument(
      HEP_PH_NEW,
      "Showing new listings for Friday, 25 September 2026",
      "Showing new listings for Thursday, 25 September 2026",
    );
    expect(() => parseNewPage(doc)).toThrow(/date/);
  });

  it("a single page whose entries differ from its total", () => {
    const doc = editedDocument(
      HEP_PH_NEW,
      /Total of 72 entries/g,
      "Total of 73 entries",
    );
    expect(() => parseNewPage(doc)).toThrow(/72 entries/);
  });

  it("a page without entries and without 'No updates today.'", () => {
    const doc = editedDocument(
      "list-cs.GL-new-empty-2026-09-25.html",
      "No updates today.",
      "",
    );
    expect(() => parseNewPage(doc)).toThrow(ListingParseError);
  });
});

describe("assembleSpecDay", () => {
  const csLgPages = CS_LG_PAGES.map((name) =>
    parseNewPage(fixtureDocument(name)),
  );

  it("joins the four real cs.LG pages into one day", () => {
    const day = assembleSpecDay("cs.LG", csLgPages, 1000);
    expect(day).toMatchObject({
      spec: "cs.LG",
      date: "2026-09-25",
      source: "new",
      total: 331,
      fetchedAt: 1000,
    });
    expect(day.entries).toHaveLength(331);
    expect(new Set(day.entries.map((entry) => entry.id)).size).toBe(331);
    expect(day.nextDay).toBeUndefined();
  });

  it("a missing page", () => {
    expect(() =>
      assembleSpecDay("cs.LG", [csLgPages[0], csLgPages[2], csLgPages[3]], 0),
    ).toThrow(/starts at entry 201/);
    expect(() => assembleSpecDay("cs.LG", csLgPages.slice(0, 3), 0)).toThrow(
      /last page links to a further page/,
    );
    const firstWithoutNext = { ...csLgPages[0], next: null };
    expect(() =>
      assembleSpecDay("cs.LG", [firstWithoutNext, ...csLgPages.slice(1)], 0),
    ).toThrow(/without next page/);
  });

  it("pages whose totals disagree", () => {
    const last = { ...csLgPages[3], total: 332 };
    expect(() =>
      assembleSpecDay("cs.LG", [...csLgPages.slice(0, 3), last], 0),
    ).toThrow(/totals 331 and 332/);
  });

  it("pages whose dates disagree", () => {
    const last = { ...csLgPages[3], date: "2026-09-28" };
    expect(() =>
      assembleSpecDay("cs.LG", [...csLgPages.slice(0, 3), last], 0),
    ).toThrow(/2026-09-25 and 2026-09-28/);
  });

  it("an identifier on two pages", () => {
    const last = {
      ...csLgPages[3],
      entries: [
        { ...csLgPages[3].entries[0], id: csLgPages[0].entries[0].id },
        ...csLgPages[3].entries.slice(1),
      ],
    };
    expect(() =>
      assembleSpecDay("cs.LG", [...csLgPages.slice(0, 3), last], 0),
    ).toThrow(/two pages/);
  });

  it("a section whose pages do not add up to its total", () => {
    const second = {
      ...csLgPages[1],
      sections: [
        { section: "new" as const, shown: 19, total: 120 },
        csLgPages[1].sections[1],
      ],
    };
    expect(() =>
      assembleSpecDay(
        "cs.LG",
        [csLgPages[0], second, ...csLgPages.slice(2)],
        0,
      ),
    ).toThrow(/Section new/);
  });

  it("keeps the next-day link of catch-up pages", () => {
    const page = parseCatchupPage(
      fixtureDocument("catchup-hep-ph-2026-09-21.html"),
    );
    expect(assembleSpecDay("hep-ph", [page], 0).nextDay).toBe("2026-09-22");
    const latest = parseCatchupPage(
      fixtureDocument("catchup-cs.GL-2026-09-25-empty-latest.html"),
    );
    const day = assembleSpecDay("cs.GL", [latest], 0);
    expect(day).toMatchObject({ total: 0, entries: [], nextDay: null });
  });
});

describe("listingId", () => {
  it("accepts the identifiers listings print", () => {
    expect(listingId("2609.28538")).toBe("2609.28538");
    expect(listingId("1411.4567")).toBe("1411.4567");
    expect(listingId("math/0702261")).toBe("math/0702261");
    expect(listingId("math.GT/0309136")).toBe("math/0309136");
    expect(listingId("2609.1")).toBeNull();
    expect(listingId("")).toBeNull();
  });
});
