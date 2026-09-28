import { describe, expect, it } from "vitest";
import {
  ArxivFetchError,
  ArxivScheduler,
} from "../src/modules/arxiv/arxivFetch";
import {
  estimateListingRequests,
  ListingService,
} from "../src/modules/arxiv/listingService";
import { MemoryListingStore } from "../src/modules/arxiv/listingStore";
import {
  displaySection,
  type DayListing,
} from "../src/modules/arxiv/listingTypes";
import {
  parseCatchupPage,
  parseNewPage,
} from "../src/modules/arxiv/listingParser";
import { htmlDocument, readArxivFixture } from "./arxivFixtures";
import {
  CATCHUP_URL,
  catchupPageHtml,
  INDEX_URL,
  LIST_URL,
  newPageHtml,
  recentIndexHtml,
  SimulatedArxiv,
  type SiteEntry,
} from "./arxivSite";
import { VirtualClock } from "./virtualClock";

// The listing service against a simulated arxiv.org on a simulated clock.
// Real pages from test/fixtures/arxiv where they exist (hep-ph /new of
// 25 September, hep-ph catch-up of 21 September, cs.LG /new in four pages,
// cs.GL empty day, math archive), pages built like arXiv's elsewhere.

/** Sunday 27 September 2026, 13:00 in New York: newest listing is Friday 25 */
const SUNDAY_AFTERNOON = "2026-09-27T17:00:00Z";
const INDEX = [
  "2026-09-25",
  "2026-09-24",
  "2026-09-23",
  "2026-09-22",
  "2026-09-21",
];
/** The announcement day after each day (Friday is followed by Monday) */
const NEXT: Record<string, string> = {
  "2026-09-17": "2026-09-18",
  "2026-09-18": "2026-09-21",
  "2026-09-21": "2026-09-22",
  "2026-09-22": "2026-09-23",
  "2026-09-23": "2026-09-24",
  "2026-09-24": "2026-09-25",
  "2026-09-25": "2026-09-28",
};

let idCounter = 10000;
function paper(
  primary: string,
  section: SiteEntry["section"] = "new",
  cross: string[] = [],
): SiteEntry {
  return { id: `2609.${idCounter++}`, section, primary, cross };
}

/** A small day of a category: 2 new, 1 cross, 1 replacement */
function smallDay(spec: string): SiteEntry[] {
  return [
    paper(spec),
    paper(spec),
    paper("gr-qc", "cross", [spec]),
    paper(spec, "replace"),
  ];
}

function setup(now = SUNDAY_AFTERNOON, newPageSize?: number) {
  const clock = new VirtualClock(Date.parse(now));
  const site = new SimulatedArxiv(clock);
  const scheduler = new ArxivScheduler({
    host: "arxiv.org",
    minIntervalMs: 15000,
    timeoutMs: 60000,
    transport: site.transport,
    clock,
  });
  const store = new MemoryListingStore();
  const service = new ListingService({
    scheduler,
    store,
    clock,
    parseHtml: htmlDocument,
    newPageSize,
  });
  return { clock, site, scheduler, store, service };
}

type Site = ReturnType<typeof setup>["site"];

/**
 * Serve `specs` for `days` (oldest first): /new shows `latest`, /catchup
 * pages of the others link to the next day (the latest one has no link)
 */
function serveDays(
  site: Site,
  specs: string[],
  days: string[],
  latest: string,
  index: string[] = INDEX,
) {
  site.html(INDEX_URL, recentIndexHtml("math", index));
  const content = new Map<string, SiteEntry[]>();
  for (const spec of specs) {
    for (const day of [...days, latest]) {
      const entries = smallDay(spec);
      content.set(`${spec} ${day}`, entries);
      site.html(
        CATCHUP_URL(spec, day),
        catchupPageHtml(spec, day, entries, day === latest ? null : NEXT[day]),
      );
    }
    site.html(
      LIST_URL(spec),
      newPageHtml(spec, latest, content.get(`${spec} ${latest}`)!),
    );
  }
  return content;
}

function summary(days: DayListing[]) {
  return days.map((day) => `${day.date} ${day.status} ${day.entries.length}`);
}

function stateOf(day: DayListing, spec: string) {
  return day.specs.find((item) => item.spec === spec)?.state;
}

describe("the simulated site", () => {
  it("builds pages the parser reads like arXiv's", () => {
    const entries = [...smallDay("hep-ph"), ...smallDay("hep-ph")];
    const pages = [0, 3, 6].map((skip) =>
      parseNewPage(
        htmlDocument(newPageHtml("hep-ph", "2026-09-25", entries, skip, 3)),
      ),
    );
    expect(pages.map((page) => [page.firstIndex, page.next])).toEqual([
      [1, 3],
      [4, 6],
      [7, null],
    ]);
    const catchup = parseCatchupPage(
      htmlDocument(
        catchupPageHtml("hep-ph", "2026-09-05", entries, "2026-09-08", 2, 5),
      ),
    );
    expect(catchup).toMatchObject({
      date: "2026-09-05",
      total: 8,
      pageNumber: 2,
      next: null,
      firstIndex: 6,
      nextDay: "2026-09-08",
    });
  });
});

describe("new", () => {
  it("fetches /new once per category and joins the real hep-ph page", async () => {
    const { clock, site, service } = setup();
    site.html(
      LIST_URL("hep-ph"),
      readArxivFixture("list-hep-ph-new-2026-09-25.html"),
    );
    const result = await clock.run(service.loadNew(["hep-ph"]));
    expect(site.sent.map((request) => request.url)).toEqual([
      LIST_URL("hep-ph"),
    ]);
    expect(summary(result.days)).toEqual(["2026-09-25 complete 72"]);
    const day = result.days[0];
    expect(day.latest).toBe(true);
    const cross = day.entries.find((entry) => entry.id === "2609.22470")!;
    expect(cross).toMatchObject({
      section: "cross",
      // The first of the 15 cross-lists, after the 27 new submissions
      streams: [{ category: "hep-ph", section: "cross", position: 27 }],
      matchedCategories: ["hep-ph"],
      announceDate: "2026-09-25",
      primaryCategory: "astro-ph.CO",
    });
    expect(result.previousIssue).toBe(false);
    expect(result.newestDay).toBe("2026-09-25");
    // Replacements whose primary category is not hep-ph (12 of 30 that day)
    // belong to hep-ph's replacement stream
    const replacedElsewhere = day.entries.filter(
      (entry) =>
        entry.section === "replace" && entry.primaryCategory !== "hep-ph",
    );
    expect(replacedElsewhere).toHaveLength(12);
    for (const entry of replacedElsewhere) {
      expect(entry.streams).toEqual([
        {
          category: "hep-ph",
          section: "replace",
          position: day.entries.indexOf(entry),
        },
      ]);
    }
  });

  it("records each paper's place on its category's page (real hep-ph listing)", async () => {
    const { clock, site, service } = setup();
    const html = readArxivFixture("list-hep-ph-new-2026-09-25.html");
    site.html(LIST_URL("hep-ph"), html);
    const [day] = (await clock.run(service.loadNew(["hep-ph"]))).days;
    const page = parseNewPage(htmlDocument(html));
    expect(day.entries).toHaveLength(page.entries.length);
    for (const entry of day.entries) {
      const position = page.entries.findIndex((item) => item.id === entry.id);
      expect(entry.streams).toEqual([
        { category: "hep-ph", section: entry.section, position },
      ]);
    }
  });

  it("follows the pages of a long listing (real cs.LG pages of 100)", async () => {
    const { clock, site, service } = setup(SUNDAY_AFTERNOON, 100);
    for (const skip of [0, 100, 200, 300]) {
      site.html(
        LIST_URL("cs.LG", skip, 100),
        readArxivFixture(`list-cs.LG-new-show100-skip${skip}-2026-09-25.html`),
      );
    }
    const result = await clock.run(service.loadNew(["cs.LG"]));
    expect(site.sent.map((request) => request.url)).toEqual(
      [0, 100, 200, 300].map((skip) => LIST_URL("cs.LG", skip, 100)),
    );
    expect(summary(result.days)).toEqual(["2026-09-25 complete 331"]);
    const sections = { new: 0, cross: 0, replace: 0 };
    for (const entry of result.days[0].entries) sections[entry.section]++;
    expect(sections).toEqual({ new: 119, cross: 111, replace: 101 });
    // Places run on across the four pages
    const pages = [0, 100, 200, 300].flatMap(
      (skip) =>
        parseNewPage(
          htmlDocument(
            readArxivFixture(
              `list-cs.LG-new-show100-skip${skip}-2026-09-25.html`,
            ),
          ),
        ).entries,
    );
    expect(
      result.days[0].entries.map((entry) => entry.streams[0].position),
    ).toEqual(
      result.days[0].entries.map((entry) =>
        pages.findIndex((item) => item.id === entry.id),
      ),
    );
    expect(
      result.days[0].entries.map((entry) => entry.streams[0].position),
    ).toEqual(pages.map((_, index) => index));
  });

  it("fetches an alias from its canonical category's page", async () => {
    const { clock, site, service } = setup();
    site.html(
      LIST_URL("math-ph"),
      newPageHtml("math-ph", "2026-09-25", smallDay("math-ph")),
    );
    const result = await clock.run(service.loadNew(["math.MP", "math-ph"]));
    expect(site.sent.map((request) => request.url)).toEqual([
      LIST_URL("math-ph"),
    ]);
    expect(result.days[0].specs.map((item) => item.spec)).toEqual(["math-ph"]);
    expect(result.days[0].entries[0].matchedCategories).toEqual(["math-ph"]);
  });

  it("reads an archive page and an empty day", async () => {
    const { clock, site, service } = setup();
    site.html(
      LIST_URL("math"),
      readArxivFixture("list-math-new-2026-09-25-trimmed.html"),
    );
    site.html(
      LIST_URL("cs.GL"),
      readArxivFixture("list-cs.GL-new-empty-2026-09-25.html"),
    );
    const result = await clock.run(service.loadNew(["math", "cs.GL"]));
    expect(site.sent.map((request) => request.url)).toEqual([
      LIST_URL("math"),
      LIST_URL("cs.GL"),
    ]);
    const day = result.days[0];
    expect(day.status).toBe("complete");
    expect(stateOf(day, "cs.GL")).toEqual({
      state: "complete",
      count: 0,
      fromCache: false,
    });
    expect(day.entries).toHaveLength(33);
    expect(
      day.entries.every((entry) => entry.matchedCategories[0] === "math"),
    ).toBe(true);
  });

  it("merges a paper that appears on two subscribed pages", async () => {
    const { clock, site, service } = setup();
    const shared = paper("hep-ph", "new", ["hep-th"]);
    const sharedReplacement = paper("hep-ph", "replace", ["hep-th"]);
    const hepPh = [shared, paper("hep-ph"), { ...sharedReplacement }];
    const hepTh = [
      paper("hep-th"),
      { ...shared, section: "cross" as const },
      { ...sharedReplacement, section: "cross" as const },
    ];
    site.html(LIST_URL("hep-ph"), newPageHtml("hep-ph", "2026-09-25", hepPh));
    site.html(LIST_URL("hep-th"), newPageHtml("hep-th", "2026-09-25", hepTh));
    const result = await clock.run(service.loadNew(["hep-ph", "hep-th"]));
    const day = result.days[0];
    expect(day.entries).toHaveLength(4);
    const merged = day.entries.find((entry) => entry.id === shared.id)!;
    // With the paper's place on each page (hep-th lists its new paper first)
    expect(merged.streams).toEqual([
      { category: "hep-ph", section: "new", position: 0 },
      { category: "hep-th", section: "cross", position: 1 },
    ]);
    expect(merged.matchedCategories).toEqual(["hep-ph", "hep-th"]);
    expect(merged.section).toBe("new");
    // A replacement of hep-ph that is a cross-list on hep-th: shown as cross
    // while all sections are open, as a replacement when only those are
    const replaced = day.entries.find(
      (entry) => entry.id === sharedReplacement.id,
    )!;
    expect(replaced.section).toBe("cross");
    expect(displaySection(replaced.streams, new Set(["replace"]))).toBe(
      "replace",
    );
    expect(displaySection(replaced.streams, new Set(["new"]))).toBeNull();
  });

  it("fetches a category once more when its /new still shows the previous listing", async () => {
    const { clock, site, service } = setup("2026-09-28T00:10:00Z");
    const hepPh = smallDay("hep-ph");
    site.html(LIST_URL("hep-ph"), newPageHtml("hep-ph", "2026-09-28", hepPh));
    const hepThOld = smallDay("hep-th");
    const hepThNew = smallDay("hep-th");
    site.page(LIST_URL("hep-th"), (attempt) => ({
      text:
        attempt === 1
          ? newPageHtml("hep-th", "2026-09-25", hepThOld)
          : newPageHtml("hep-th", "2026-09-28", hepThNew),
    }));
    const result = await clock.run(service.loadNew(["hep-ph", "hep-th"]));
    expect(site.count(LIST_URL("hep-th"))).toBe(2);
    expect(summary(result.days)).toEqual(["2026-09-28 complete 8"]);
    expect(result.previousIssue).toBe(false);
  });

  it("marks the day incomplete when the second fetch still shows the previous listing", async () => {
    const { clock, site, service, store } = setup("2026-09-28T00:10:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", smallDay("hep-ph")),
    );
    site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-25", smallDay("hep-th")),
    );
    const result = await clock.run(service.loadNew(["hep-ph", "hep-th"]));
    expect(site.count(LIST_URL("hep-th"))).toBe(2);
    const day = result.days[0];
    expect(`${day.date} ${day.status}`).toBe("2026-09-28 incomplete");
    expect(stateOf(day, "hep-th")).toEqual({
      state: "stale",
      shownDate: "2026-09-25",
    });
    // Only hep-ph's papers: pages of two listings are not joined
    expect(
      day.entries.every((entry) => entry.matchedCategories[0] === "hep-ph"),
    ).toBe(true);
    // The older page is still a checked listing of its own day
    expect((await store.getDay("hep-th", "2026-09-25"))?.entries).toHaveLength(
      4,
    );
  });

  it("fetches again when the listing changes between two pages", async () => {
    const { clock, site, service } = setup("2026-09-28T00:10:00Z", 3);
    const old = [...smallDay("cs.LG"), ...smallDay("cs.LG")];
    const fresh = [...smallDay("cs.LG"), ...smallDay("cs.LG")];
    const pageOf = (entries: SiteEntry[], date: string, skip: number) =>
      newPageHtml("cs.LG", date, entries, skip, 3);
    site.page(LIST_URL("cs.LG", 0, 3), (attempt) => ({
      text:
        attempt === 1
          ? pageOf(old, "2026-09-25", 0)
          : pageOf(fresh, "2026-09-28", 0),
    }));
    site.html(LIST_URL("cs.LG", 3, 3), pageOf(fresh, "2026-09-28", 3));
    site.html(LIST_URL("cs.LG", 6, 3), pageOf(fresh, "2026-09-28", 6));
    const result = await clock.run(service.loadNew(["cs.LG"]));
    // First pass: page 1 of the old listing, page 2 of the new one; second
    // pass: all three pages of the new listing
    expect(site.sent.map((request) => new URL(request.url).search)).toEqual([
      "?skip=0&show=3",
      "?skip=3&show=3",
      "?skip=0&show=3",
      "?skip=3&show=3",
      "?skip=6&show=3",
    ]);
    expect(summary(result.days)).toEqual(["2026-09-28 complete 8"]);
  });

  it("reuses /new for 10 minutes unless an announcement was scheduled since", async () => {
    // 19:50 in New York on Sunday: the announcement is due at 20:00
    const { clock, site, service } = setup("2026-09-27T23:50:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-25", smallDay("hep-ph")),
    );
    await clock.run(service.loadNew(["hep-ph"]));
    await clock.advanceTo(Date.parse("2026-09-27T23:55:00Z"));
    const cached = await clock.run(service.loadNew(["hep-ph"]));
    expect(site.sent).toHaveLength(1);
    expect(stateOf(cached.days[0], "hep-ph")).toMatchObject({
      fromCache: true,
    });

    // 20:02: less than 10 minutes, but past the scheduled announcement
    await clock.advanceTo(Date.parse("2026-09-28T00:02:00Z"));
    const after = await clock.run(service.loadNew(["hep-ph"]));
    expect(site.sent).toHaveLength(2);
    // Still Friday's listing: arXiv may have postponed the announcement
    expect(after.previousIssue).toBe(true);
  });

  it("fetches again on the user's retry, even within 10 minutes", async () => {
    // 20:02 in New York: the announcement is due, arXiv still shows Friday
    const { clock, site, service } = setup("2026-09-28T00:02:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-25", smallDay("hep-ph")),
    );
    const first = await clock.run(service.loadNew(["hep-ph"]));
    expect(first.previousIssue).toBe(true);
    await clock.advanceBy(3 * 60 * 1000);
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", smallDay("hep-ph")),
    );
    const cached = await clock.run(service.loadNew(["hep-ph"]));
    expect(cached.days[0].date).toBe("2026-09-25");
    expect(site.sent).toHaveLength(1);
    const retried = await clock.run(
      service.loadNew(["hep-ph"], { refresh: true }),
    );
    expect(site.sent).toHaveLength(2);
    expect(retried.days[0].date).toBe("2026-09-28");
    expect(retried.previousIssue).toBe(false);
  });

  it("fetches again after 10 minutes", async () => {
    const { clock, site, service } = setup();
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-25", smallDay("hep-ph")),
    );
    await clock.run(service.loadNew(["hep-ph"]));
    await clock.advanceBy(9 * 60 * 1000);
    await clock.run(service.loadNew(["hep-ph"]));
    expect(site.sent).toHaveLength(1);
    await clock.advanceBy(2 * 60 * 1000);
    await clock.run(service.loadNew(["hep-ph"]));
    expect(site.sent).toHaveLength(2);
  });

  it("shows the cached copy when fetching fails", async () => {
    const { clock, site, service } = setup();
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-25", smallDay("hep-ph")),
    );
    await clock.run(service.loadNew(["hep-ph"]));
    await clock.advanceBy(60 * 60 * 1000);
    site.page(LIST_URL("hep-ph"), {
      error: new ArxivFetchError("offline", "Zotero is offline"),
    });
    const result = await clock.run(service.loadNew(["hep-ph"]));
    expect(summary(result.days)).toEqual(["2026-09-25 complete 4"]);
    expect(stateOf(result.days[0], "hep-ph")).toEqual({
      state: "complete",
      count: 4,
      fromCache: true,
      fetchFailed: { reason: "offline", message: "Zotero is offline" },
    });
  });

  it("stops sending when arXiv refuses, even where a cached copy is shown", async () => {
    const { clock, site, service } = setup();
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-25", smallDay("hep-ph")),
    );
    site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-25", smallDay("hep-th")),
    );
    await clock.run(service.loadNew(["hep-ph", "hep-th"]));
    await clock.advanceBy(60 * 60 * 1000);
    site.page(LIST_URL("hep-ph"), { status: 403 });
    const before = site.sent.length;
    const result = await clock.run(service.loadNew(["hep-ph", "hep-th"]));
    expect(site.sent.length - before).toBe(1);
    expect(result.stopped?.reason).toBe("forbidden");
    expect(stateOf(result.days[0], "hep-ph")).toMatchObject({
      state: "complete",
      fromCache: true,
      fetchFailed: { reason: "forbidden" },
    });
    expect(stateOf(result.days[0], "hep-th")).toMatchObject({
      state: "failed",
      message: "Not requested: loading stopped",
    });
  });

  it("does not show a cached copy of an older day as the newest day", async () => {
    const { clock, site, service } = setup("2026-09-28T00:10:00Z");
    site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-25", smallDay("hep-th")),
    );
    await clock.run(service.loadNew(["hep-th"]));
    await clock.advanceBy(60 * 60 * 1000);
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", smallDay("hep-ph")),
    );
    site.page(LIST_URL("hep-th"), { status: 500 });
    const result = await clock.run(service.loadNew(["hep-ph", "hep-th"]));
    expect(result.days[0].date).toBe("2026-09-28");
    expect(stateOf(result.days[0], "hep-th")).toMatchObject({
      state: "failed",
      reason: "http",
    });
  });

  it("reports why nothing could be shown", async () => {
    const { clock, site, service } = setup();
    site.page(LIST_URL("hep-ph"), { status: 500 });
    const result = await clock.run(service.loadNew(["hep-ph"]));
    expect(result.days).toEqual([]);
    expect(result.stopped?.reason).toBe("http");
  });
});

describe("recent", () => {
  it("dates the days by the math index and loads the newest first: 1 + 5N requests", async () => {
    const { clock, site, service } = setup();
    // Real hep-ph pages for Friday (/new) and Monday (catch-up)
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    site.html(
      LIST_URL("hep-ph"),
      readArxivFixture("list-hep-ph-new-2026-09-25.html"),
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-21"),
      readArxivFixture("catchup-hep-ph-2026-09-21.html"),
    );
    const emitted: [string, number][] = [];
    const result = await clock.run(
      service.loadRecent(["hep-ph", "hep-th"], {
        onDay: (day) => emitted.push([day.date, clock.now()]),
      }),
    );
    expect(site.sent).toHaveLength(1 + 5 * 2);
    expect(site.sent.slice(0, 3).map((request) => request.url)).toEqual([
      INDEX_URL,
      LIST_URL("hep-ph"),
      LIST_URL("hep-th"),
    ]);
    expect(summary(result.days)).toEqual([
      "2026-09-25 complete 76",
      "2026-09-24 complete 8",
      "2026-09-23 complete 8",
      "2026-09-22 complete 8",
      "2026-09-21 complete 61",
    ]);
    expect(result.days.map((day) => day.latest)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    // Each day is shown as soon as its pages are in: the newest after 3
    // requests, then one day per 2 requests (each 0.8 s, 15 s after the
    // previous one ended)
    const start = Date.parse(SUNDAY_AFTERNOON);
    expect(
      emitted.map(([date, at]) => [date, Math.round(at - start) / 1000]),
    ).toEqual([
      ["2026-09-25", 32.4],
      ["2026-09-24", 64],
      ["2026-09-23", 95.6],
      ["2026-09-22", 127.2],
      ["2026-09-21", 158.8],
    ]);
  });

  it("adds a newer listing than the index knows and drops the oldest day", async () => {
    const { clock, site, service } = setup("2026-09-28T00:05:00Z");
    // The index still ends on Thursday; /new already shows Friday
    const staleIndex = [
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
      "2026-09-18",
    ];
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"],
      "2026-09-25",
      staleIndex,
    );
    const result = await clock.run(service.loadRecent(["hep-ph", "hep-th"]));
    expect(result.days.map((day) => day.date)).toEqual(INDEX);
    expect(result.days.every((day) => day.status === "complete")).toBe(true);
    expect(site.sent).toHaveLength(1 + 5 * 2);
  });

  it("walks the next-day links when the index is behind by more than one day", async () => {
    const { clock, site, service } = setup("2026-09-28T00:05:00Z");
    const staleIndex = [
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
      "2026-09-18",
      "2026-09-17",
    ];
    serveDays(
      site,
      ["hep-ph"],
      ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"],
      "2026-09-25",
      staleIndex,
    );
    const result = await clock.run(service.loadRecent(["hep-ph"]));
    expect(result.days.map((day) => day.date)).toEqual(INDEX);
    // Thursday was found from Wednesday's page; no page was fetched twice
    expect(new Set(site.sent.map((request) => request.url)).size).toBe(
      site.sent.length,
    );
    expect(site.sent).toHaveLength(1 + 5);
  });

  it("stops instead of leaving a day out when a next-day link cannot be fetched", async () => {
    // The index request fails and the cached index of Wednesday is used;
    // /new shows Friday; Wednesday's catch-up page fails once
    const { clock, site, service, store } = setup();
    await store.putRecentIndex("math", {
      dates: [
        "2026-09-23",
        "2026-09-22",
        "2026-09-21",
        "2026-09-18",
        "2026-09-17",
      ],
      fetchedAt: Date.parse("2026-09-23T12:00:00Z"),
    });
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    site.page(INDEX_URL, { status: 500 });
    const saved = site.routes.get(CATCHUP_URL("hep-ph", "2026-09-23"))!;
    site.page(CATCHUP_URL("hep-ph", "2026-09-23"), (attempt) =>
      attempt === 1 ? { status: 500 } : (saved as never),
    );
    const result = await clock.run(service.loadRecent(["hep-ph"]));
    expect(result.days.map((day) => day.date)).toEqual(["2026-09-25"]);
    expect(result.stopped).toMatchObject({
      reason: "http",
      date: "2026-09-23",
    });
    expect(result.stopped?.message).toMatch(/day after 2026-09-23/);
    // Its five days were not settled: none are named as left to load
    expect(result.notLoaded).toBeUndefined();

    // On retry the link is found and Thursday is not left out
    const retry = await clock.run(service.loadRecent(["hep-ph"]));
    expect(retry.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-25 complete",
      "2026-09-24 complete",
      "2026-09-23 complete",
      "2026-09-22 complete",
      "2026-09-21 complete",
    ]);
  });

  it("needs no link when no weekday lies between the index and /new", async () => {
    // The index still ends on Thursday (its request failed; the cached
    // copy is used), /new shows Friday, Thursday's catch-up page fails
    const { clock, site, service, store } = setup("2026-09-25T00:10:00Z");
    await store.putRecentIndex("math", {
      dates: [
        "2026-09-24",
        "2026-09-23",
        "2026-09-22",
        "2026-09-21",
        "2026-09-18",
      ],
      fetchedAt: Date.parse("2026-09-24T12:00:00Z"),
    });
    serveDays(
      site,
      ["hep-ph"],
      ["2026-09-18", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"],
      "2026-09-25",
    );
    site.page(INDEX_URL, { status: 500 });
    site.page(CATCHUP_URL("hep-ph", "2026-09-24"), { status: 500 });
    const result = await clock.run(service.loadRecent(["hep-ph"]));
    expect(result.stopped).toBeUndefined();
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-25 complete",
      "2026-09-24 failed",
      "2026-09-23 complete",
      "2026-09-22 complete",
      "2026-09-21 complete",
    ]);
    // Thursday's page was asked once, for Thursday itself
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-24"))).toBe(1);
  });

  it("marks the newest day incomplete for a category whose /new is behind the index", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    // hep-th's /new still shows Thursday (fetched twice)
    site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-24", smallDay("hep-th")),
    );
    const result = await clock.run(service.loadRecent(["hep-ph", "hep-th"]));
    expect(site.count(LIST_URL("hep-th"))).toBe(2);
    expect(stateOf(result.days[0], "hep-th")).toEqual({
      state: "stale",
      shownDate: "2026-09-24",
    });
    expect(result.days[0].status).toBe("incomplete");
    // Thursday of hep-th comes from that /new page, not from /catchup
    expect(site.count(CATCHUP_URL("hep-th", "2026-09-24"))).toBe(0);
    expect(result.days[1]).toMatchObject({
      date: "2026-09-24",
      status: "complete",
    });
  });

  it("refuses a catch-up page whose next day contradicts the index", async () => {
    const { clock, site, service } = setup();
    const content = serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    site.html(
      CATCHUP_URL("hep-th", "2026-09-23"),
      catchupPageHtml(
        "hep-th",
        "2026-09-23",
        content.get("hep-th 2026-09-23")!,
        "2026-09-25",
      ),
    );
    const result = await clock.run(service.loadRecent(["hep-ph", "hep-th"]));
    const wednesday = result.days.find((day) => day.date === "2026-09-23")!;
    expect(wednesday.status).toBe("incomplete");
    expect(stateOf(wednesday, "hep-th")).toMatchObject({
      state: "failed",
      reason: "check",
    });
  });

  it("stops after arXiv answers 503 twice", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th", "hep-ex"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    site.page(LIST_URL("hep-th"), {
      status: 503,
      headers: { "Retry-After": "120" },
    });
    const result = await clock.run(
      service.loadRecent(["hep-ph", "hep-th", "hep-ex"]),
    );
    expect(site.sent.map((request) => request.url)).toEqual([
      INDEX_URL,
      LIST_URL("hep-ph"),
      LIST_URL("hep-th"),
      LIST_URL("hep-th"),
    ]);
    // The retry waited for Retry-After
    expect(site.sent[3].start - site.sent[2].end!).toBe(120000);
    expect(result.stopped?.reason).toBe("unavailable");
    expect(summary(result.days)).toEqual(["2026-09-25 incomplete 4"]);
    expect(stateOf(result.days[0], "hep-ex")).toMatchObject({
      state: "failed",
      reason: "unavailable",
      message: "Not requested: loading stopped",
    });
  });

  it("stops on 403", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    site.page(LIST_URL("hep-ph"), { status: 403 });
    const result = await clock.run(service.loadRecent(["hep-ph", "hep-th"]));
    expect(site.sent).toHaveLength(2);
    expect(result.stopped?.reason).toBe("forbidden");
  });
});

describe("catch-up", () => {
  it("walks the next-day links from the start day, the newest day from /new", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      ["2026-09-18", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"],
      "2026-09-25",
    );
    const result = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-18"),
    );
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-18 complete",
      "2026-09-21 complete",
      "2026-09-22 complete",
      "2026-09-23 complete",
      "2026-09-24 complete",
      "2026-09-25 complete",
    ]);
    expect(site.sent).toHaveLength(1 + 6 * 2);
    expect(site.sent.slice(-2).map((request) => request.url)).toEqual([
      LIST_URL("hep-ph"),
      LIST_URL("hep-th"),
    ]);
    expect(result.days.at(-1)?.latest).toBe(true);
  });

  it("skips a start day without announcement, asking the math archive", async () => {
    const { clock, site, service } = setup();
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    // Tuesday 8 September: no announcement after Labor Day. The real hep-ph
    // page shows 0 entries, like a day without hep-ph papers would
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-08"),
      readArxivFixture("catchup-hep-ph-2026-09-08-holiday-noabs.html"),
    );
    // The math archive has papers on every announcement day, but not on 8
    // September; its page links on with abs=False, as arXiv's pages do
    const mathCheck = "https://arxiv.org/catchup/math/2026-09-08?abs=False";
    site.html(
      mathCheck,
      catchupPageHtml("math", "2026-09-08", [], "2026-09-09").replaceAll(
        "abs=True",
        "abs=False",
      ),
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-09"),
      catchupPageHtml("hep-ph", "2026-09-09", smallDay("hep-ph"), "2026-09-10"),
    );
    site.page(CATCHUP_URL("hep-ph", "2026-09-10"), { status: 500 });
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-08"),
    );
    // Only the date is taken from the link; the request asks with abs=True
    expect(site.sent.slice(1, 4).map((request) => request.url)).toEqual([
      CATCHUP_URL("hep-ph", "2026-09-08"),
      mathCheck,
      "https://arxiv.org/catchup/hep-ph/2026-09-09?abs=True",
    ]);
    expect(result.noAnnouncementOn).toBe("2026-09-08");
    expect(
      result.days.map(
        (day) => `${day.date} ${day.status} ${day.entries.length}`,
      ),
    ).toEqual(["2026-09-09 complete 4", "2026-09-10 failed 0"]);
  });

  it("skips a start day without announcement although one page failed", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-08"),
      readArxivFixture("catchup-hep-ph-2026-09-08-holiday-noabs.html"),
    );
    site.page(CATCHUP_URL("hep-th", "2026-09-08"), { status: 500 });
    site.html(
      "https://arxiv.org/catchup/math/2026-09-08?abs=False",
      catchupPageHtml("math", "2026-09-08", [], "2026-09-09"),
    );
    for (const spec of ["hep-ph", "hep-th"]) {
      site.html(
        CATCHUP_URL(spec, "2026-09-09"),
        catchupPageHtml(spec, "2026-09-09", smallDay(spec), "2026-09-10"),
      );
      site.page(CATCHUP_URL(spec, "2026-09-10"), { status: 500 });
    }
    const result = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-08"),
    );
    expect(result.noAnnouncementOn).toBe("2026-09-08");
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-09 complete",
      "2026-09-10 failed",
    ]);
  });

  it("uses a subscribed math archive's own page for the start-day check", async () => {
    const { clock, site, service } = setup();
    serveDays(site, ["math"], INDEX.slice(1).reverse(), "2026-09-25");
    site.html(
      CATCHUP_URL("math", "2026-09-08"),
      catchupPageHtml("math", "2026-09-08", [], "2026-09-09"),
    );
    site.html(
      CATCHUP_URL("math", "2026-09-09"),
      catchupPageHtml("math", "2026-09-09", smallDay("math"), "2026-09-10"),
    );
    site.page(CATCHUP_URL("math", "2026-09-10"), { status: 500 });
    const result = await clock.run(service.loadCatchup(["math"], "2026-09-08"));
    expect(result.noAnnouncementOn).toBe("2026-09-08");
    expect(site.sent.some((request) => request.url.includes("abs=False"))).toBe(
      false,
    );
    expect(result.days[0].date).toBe("2026-09-09");
  });

  it("keeps a start day with an announcement but no subscribed papers", async () => {
    const { clock, site, service } = setup();
    serveDays(site, ["cs.GL"], INDEX.slice(1).reverse(), "2026-09-25");
    site.html(
      CATCHUP_URL("cs.GL", "2026-09-17"),
      catchupPageHtml("cs.GL", "2026-09-17", [], "2026-09-18"),
    );
    site.html(
      "https://arxiv.org/catchup/math/2026-09-17?abs=False",
      catchupPageHtml("math", "2026-09-17", smallDay("math"), "2026-09-18"),
    );
    site.html(
      CATCHUP_URL("cs.GL", "2026-09-18"),
      catchupPageHtml("cs.GL", "2026-09-18", [], "2026-09-21"),
    );
    const result = await clock.run(
      service.loadCatchup(["cs.GL"], "2026-09-17"),
    );
    expect(result.noAnnouncementOn).toBeUndefined();
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-17 complete",
      "2026-09-18 complete",
      "2026-09-21 complete",
      "2026-09-22 complete",
      "2026-09-23 complete",
      "2026-09-24 complete",
      "2026-09-25 complete",
    ]);
    // The math archive is asked once, for the start day only
    expect(
      site.sent.filter((request) => request.url.includes("/catchup/math/")),
    ).toHaveLength(1);
  });

  it("starts a weekend start day on the next Monday", async () => {
    const { clock, site, service } = setup();
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-19"),
    );
    expect(result.days[0].date).toBe("2026-09-21");
    expect(site.sent[1].url).toBe(CATCHUP_URL("hep-ph", "2026-09-21"));
  });

  it("says which day is the newest when the start is later", async () => {
    // Sunday afternoon: the newest listing is Friday's; a start on Saturday
    // moves to Monday, which has no listing yet
    const { clock, site, service } = setup();
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-26"),
    );
    expect(result.days).toEqual([]);
    expect(result.stopped).toBeUndefined();
    expect(result.newestDay).toBe("2026-09-25");
    expect(result.previousIssue).toBe(false);
    // Monday's listing is not due before Sunday 20:00 in New York: /new is
    // not asked
    expect(site.sent.map((request) => request.url)).toEqual([INDEX_URL]);
  });

  it("finds a start day that /new shows but the lagging index not yet", async () => {
    // Just after the announcement of Friday's listing the index still ends
    // on Thursday; the start is Friday
    const { clock, site, service } = setup("2026-09-25T00:03:00Z");
    const staleIndex = [
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
      "2026-09-18",
    ];
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      ["2026-09-24"],
      "2026-09-25",
      staleIndex,
    );
    const result = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-25"),
    );
    expect(
      result.days.map((day) => `${day.date} ${day.status} ${day.latest}`),
    ).toEqual(["2026-09-25 complete true"]);
    expect(result.newestDay).toBe("2026-09-25");
    expect(site.sent.map((request) => request.url)).toEqual([
      INDEX_URL,
      LIST_URL("hep-ph"),
      LIST_URL("hep-th"),
    ]);
  });

  it("does not take a cached /new page older than the start as the answer", async () => {
    // Thursday 20:01 in New York: /new still shows Thursday, and the "new"
    // mode caches it
    const { clock, site, service } = setup("2026-09-25T00:01:00Z");
    const staleIndex = [
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
      "2026-09-18",
    ];
    serveDays(site, ["hep-ph"], ["2026-09-24"], "2026-09-25", staleIndex);
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-24", smallDay("hep-ph")),
    );
    await clock.run(service.loadNew(["hep-ph"]));
    // Three minutes later /new shows Friday; the index still ends Thursday
    await clock.advanceBy(3 * 60 * 1000);
    serveDays(site, ["hep-ph"], ["2026-09-24"], "2026-09-25", staleIndex);
    const before = site.sent.length;
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-25"),
    );
    expect(site.sent.slice(before).map((request) => request.url)).toEqual([
      INDEX_URL,
      LIST_URL("hep-ph"),
    ]);
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-25 complete",
    ]);
  });

  it("does not take an old cached /new page when the index falls back to its cache", async () => {
    // Thursday 20:03 in New York, just after Friday's listing was announced:
    // the index still ends on Thursday, /new shows Friday; catch-up from
    // Friday caches both
    const { clock, site, service } = setup("2026-09-25T00:03:00Z");
    const thursdayIndex = [
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
      "2026-09-18",
    ];
    serveDays(site, ["hep-ph"], ["2026-09-24"], "2026-09-25", thursdayIndex);
    await clock.run(service.loadCatchup(["hep-ph"], "2026-09-25"));
    // Monday 21:00 in New York, after Sunday's announcement: the index
    // request fails (the cached Thursday index is used), /new shows Monday
    await clock.advanceTo(Date.parse("2026-09-28T01:00:00Z"));
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-25"),
      catchupPageHtml("hep-ph", "2026-09-25", smallDay("hep-ph"), "2026-09-28"),
    );
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", smallDay("hep-ph")),
    );
    site.page(INDEX_URL, { status: 500 });
    const before = site.sent.length;
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-25"),
    );
    expect(site.sent.slice(before).map((request) => request.url)).toEqual([
      INDEX_URL,
      LIST_URL("hep-ph"),
      CATCHUP_URL("hep-ph", "2026-09-25"),
    ]);
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-25 complete",
      "2026-09-28 complete",
    ]);
    expect(result.newestDay).toBe("2026-09-28");
  });

  it("does not reuse a /new page fetched before the last announcement", async () => {
    // Thursday 14:00 in New York: /new shows Thursday
    const { clock, site, service } = setup("2026-09-24T18:00:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-24", smallDay("hep-ph")),
    );
    await clock.run(service.loadNew(["hep-ph"]));
    // 20:03: Friday is announced; the index still ends on Wednesday
    await clock.advanceTo(Date.parse("2026-09-25T00:03:00Z"));
    const wednesdayIndex = [
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
      "2026-09-18",
      "2026-09-17",
    ];
    serveDays(site, ["hep-ph"], ["2026-09-24"], "2026-09-25", wednesdayIndex);
    const before = site.sent.length;
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-24"),
    );
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-24 complete",
      "2026-09-25 complete",
    ]);
    expect(result.newestDay).toBe("2026-09-25");
    expect(result.previousIssue).toBe(false);
    expect(site.sent.slice(before).map((request) => request.url)).toEqual([
      INDEX_URL,
      LIST_URL("hep-ph"),
      CATCHUP_URL("hep-ph", "2026-09-24"),
    ]);
  });

  it("does not conclude 'not announced' while a category's /new failed", async () => {
    // Thursday 20:03 in New York: the index and hep-ph's /new still show
    // Thursday, hep-th's /new fails
    const { clock, site, service } = setup("2026-09-25T00:03:00Z");
    const thursdayIndex = [
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
      "2026-09-18",
    ];
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      ["2026-09-24"],
      "2026-09-25",
      thursdayIndex,
    );
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-24", smallDay("hep-ph")),
    );
    site.page(LIST_URL("hep-th"), { status: 500 });
    const result = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-25"),
    );
    expect(result.days).toEqual([]);
    expect(result.stopped).toMatchObject({
      reason: "http",
      date: "2026-09-25",
    });
  });

  it("marks a late announcement also when no day is loaded", async () => {
    // Sunday 20:30 in New York: Monday's listing is due but late; /new and
    // the index still end on Friday. A caught-up reader starts on Monday.
    const { clock, site, service } = setup("2026-09-28T00:30:00Z");
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-26"),
    );
    expect(result.days).toEqual([]);
    expect(result.stopped).toBeUndefined();
    expect(result.newestDay).toBe("2026-09-25");
    expect(result.previousIssue).toBe(true);
    expect(site.sent.map((request) => request.url)).toEqual([
      INDEX_URL,
      LIST_URL("hep-ph"),
    ]);
  });

  it("stops when /new cannot tell whether the start day is announced", async () => {
    // Sunday 21:00 in New York: Monday's listing is due, the index still
    // ends on Friday
    const { clock, site, service } = setup("2026-09-28T01:00:00Z");
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    site.page(LIST_URL("hep-ph"), { status: 500 });
    site.page(LIST_URL("hep-th"), {
      error: new ArxivFetchError("timeout", "Timed out"),
    });
    const result = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-28"),
    );
    expect(result.days).toEqual([]);
    expect(result.stopped).toMatchObject({
      reason: "http",
      date: "2026-09-28",
    });
    expect(result.stopped?.message).toMatch(/has been announced/);
  });

  it("stops, without showing the start day, when the math check fails", async () => {
    const { clock, site, service } = setup();
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-08"),
      readArxivFixture("catchup-hep-ph-2026-09-08-holiday-noabs.html"),
    );
    site.page("https://arxiv.org/catchup/math/2026-09-08?abs=False", {
      error: new ArxivFetchError("timeout", "Timed out"),
    });
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-08"),
    );
    expect(result.days).toEqual([]);
    expect(result.stopped).toMatchObject({
      reason: "timeout",
      date: "2026-09-08",
    });
    expect(result.stopped?.message).toMatch(/had an announcement/);
  });

  it("moves a start before arXiv's 90 days to the first day it serves", async () => {
    const { clock, site, service } = setup();
    site.html(INDEX_URL, recentIndexHtml("math", INDEX));
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-05-01"),
    );
    expect(result.clampedStart).toBe("2026-06-29");
    expect(site.sent[1].url).toBe(CATCHUP_URL("hep-ph", "2026-06-29"));
  });

  it("takes the next day from the index when a day came from a cached /new page", async () => {
    const { clock, site, service } = setup();
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    // Thursday read in "new" mode on Thursday
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-24", smallDay("hep-ph")),
    );
    await clock.run(service.loadNew(["hep-ph"]));
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    await clock.advanceBy(60 * 60 * 1000);
    const before = site.sent.length;
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-24"),
    );
    expect(result.days.map((day) => day.date)).toEqual([
      "2026-09-24",
      "2026-09-25",
    ]);
    expect(site.sent.slice(before).map((request) => request.url)).toEqual([
      INDEX_URL,
      LIST_URL("hep-ph"),
    ]);
  });

  it("finds the day after a day older than the index on its catch-up page", async () => {
    // Thursday 10 September was read in "new" mode that day: no next-day
    // link, and it is older than the index of 27 September
    const { clock, site, service } = setup("2026-09-10T17:00:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-10", smallDay("hep-ph")),
    );
    await clock.run(service.loadNew(["hep-ph"]));
    await clock.advanceTo(Date.parse(SUNDAY_AFTERNOON));
    serveDays(
      site,
      ["hep-ph"],
      ["2026-09-11", ...INDEX.slice(1).reverse()],
      "2026-09-25",
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-10"),
      catchupPageHtml("hep-ph", "2026-09-10", smallDay("hep-ph"), "2026-09-11"),
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-11"),
      catchupPageHtml("hep-ph", "2026-09-11", smallDay("hep-ph"), "2026-09-14"),
    );
    site.page(CATCHUP_URL("hep-ph", "2026-09-14"), { status: 500 });
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-10"),
    );
    // Not 21 September (the index's oldest day): 11 September, from the link
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-10 complete",
      "2026-09-11 complete",
      "2026-09-14 failed",
    ]);
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-10"))).toBe(1);
  });

  it("stops, saying why, when the day after a day cannot be found", async () => {
    const { clock, site, service } = setup("2026-09-10T17:00:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-10", smallDay("hep-ph")),
    );
    await clock.run(service.loadNew(["hep-ph"]));
    await clock.advanceTo(Date.parse(SUNDAY_AFTERNOON));
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    site.page(CATCHUP_URL("hep-ph", "2026-09-10"), { status: 500 });
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-10"),
    );
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-10 complete",
    ]);
    expect(result.stopped).toMatchObject({
      reason: "http",
      date: "2026-09-10",
    });
    expect(result.stopped?.message).toMatch(/day after 2026-09-10/);
  });

  it("keeps loading past a day that is only partly fetched", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    site.page(CATCHUP_URL("hep-th", "2026-09-22"), { status: 500 });
    const result = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-21"),
    );
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-21 complete",
      "2026-09-22 incomplete",
      "2026-09-23 complete",
      "2026-09-24 complete",
      "2026-09-25 complete",
    ]);
    expect(stateOf(result.days[1], "hep-th")).toMatchObject({
      state: "failed",
      reason: "http",
    });
    expect(result.stopped).toBeUndefined();
  });

  it("stops when every page of a day fails and continues from there on retry", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    const failing = [
      CATCHUP_URL("hep-ph", "2026-09-23"),
      CATCHUP_URL("hep-th", "2026-09-23"),
    ];
    const saved = failing.map((url) => site.routes.get(url)!);
    for (const url of failing) {
      site.page(url, { error: new ArxivFetchError("timeout", "Timed out") });
    }
    const first = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-21"),
    );
    expect(first.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-21 complete",
      "2026-09-22 complete",
      "2026-09-23 failed",
    ]);
    expect(first.stopped).toMatchObject({
      reason: "timeout",
      date: "2026-09-23",
    });

    // Retry: the days already fetched come from the cache
    failing.forEach((url, i) => site.page(url, saved[i]));
    const before = site.sent.length;
    const retry = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-21"),
    );
    expect(retry.days.map((day) => `${day.date} ${day.status}`)).toEqual([
      "2026-09-21 complete",
      "2026-09-22 complete",
      "2026-09-23 complete",
      "2026-09-24 complete",
      "2026-09-25 complete",
    ]);
    const urls = site.sent.slice(before).map((request) => request.url);
    expect(urls).not.toContain(CATCHUP_URL("hep-ph", "2026-09-21"));
    expect(urls).toContain(CATCHUP_URL("hep-ph", "2026-09-23"));
  });

  it("loads a newer listing that appears while loading", async () => {
    const { clock, site, service } = setup("2026-09-25T00:03:00Z");
    // The index still ends on Thursday, /new already shows Friday
    const staleIndex = [
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
      "2026-09-18",
    ];
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      ["2026-09-22", "2026-09-23", "2026-09-24"],
      "2026-09-25",
      staleIndex,
    );
    const result = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-23"),
    );
    expect(
      result.days.map((day) => `${day.date} ${day.status} ${day.latest}`),
    ).toEqual([
      "2026-09-23 complete false",
      "2026-09-24 complete false",
      "2026-09-25 complete true",
    ]);
    expect(site.sent.map((request) => request.url)).toEqual([
      INDEX_URL,
      CATCHUP_URL("hep-ph", "2026-09-23"),
      CATCHUP_URL("hep-th", "2026-09-23"),
      LIST_URL("hep-ph"),
      LIST_URL("hep-th"),
      CATCHUP_URL("hep-ph", "2026-09-24"),
      CATCHUP_URL("hep-th", "2026-09-24"),
    ]);
  });

  it("marks the newest day incomplete when a category's /new is older", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-24", smallDay("hep-th")),
    );
    const result = await clock.run(
      service.loadCatchup(["hep-ph", "hep-th"], "2026-09-24"),
    );
    const friday = result.days.at(-1)!;
    expect(`${friday.date} ${friday.status}`).toBe("2026-09-25 incomplete");
    expect(stateOf(friday, "hep-th")).toEqual({
      state: "stale",
      shownDate: "2026-09-24",
    });
  });

  it("reads a day of several catch-up pages", async () => {
    const { clock, site, service } = setup();
    serveDays(site, ["cs"], INDEX.slice(1).reverse(), "2026-09-25");
    const big = [...smallDay("cs"), ...smallDay("cs"), ...smallDay("cs")];
    const perPage = 5;
    for (const page of [1, 2, 3]) {
      site.html(
        CATCHUP_URL("cs", "2026-09-24", page),
        catchupPageHtml("cs", "2026-09-24", big, "2026-09-25", page, perPage),
      );
    }
    const result = await clock.run(service.loadCatchup(["cs"], "2026-09-24"));
    expect(summary(result.days)[0]).toBe("2026-09-24 complete 12");
    expect(site.sent.slice(1, 4).map((request) => request.url)).toEqual([
      CATCHUP_URL("cs", "2026-09-24"),
      CATCHUP_URL("cs", "2026-09-24", 2),
      CATCHUP_URL("cs", "2026-09-24", 3),
    ]);
  });

  it("reports a date arXiv no longer serves", async () => {
    const { clock, site, service } = setup();
    site.html(INDEX_URL, recentIndexHtml("math", INDEX));
    site.page(CATCHUP_URL("hep-ph", "2026-06-29"), {
      status: 400,
      text: readArxivFixture("catchup-hep-ph-2026-06-01-status400.html"),
    });
    const result = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-06-29"),
    );
    expect(stateOf(result.days[0], "hep-ph")).toMatchObject({
      state: "failed",
      reason: "out-of-range",
    });
  });
});

describe("cancellation", () => {
  it("sends nothing more and shows no further day once cancelled", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    const controller = new AbortController();
    const shown: string[] = [];
    const result = await clock.run(
      service.loadRecent(["hep-ph", "hep-th"], {
        signal: controller.signal,
        onDay: (day) => {
          shown.push(day.date);
          if (day.date === "2026-09-24") controller.abort();
        },
      }),
    );
    expect(shown).toEqual(["2026-09-25", "2026-09-24"]);
    expect(site.sent).toHaveLength(5);
    expect(result.stopped?.reason).toBe("cancelled");
  });

  it("aborts the request in flight", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    const controller = new AbortController();
    const loading = service.loadRecent(["hep-ph", "hep-th"], {
      signal: controller.signal,
    });
    // The second request (hep-ph /new) is in flight from 15.8 s to 16.6 s
    await clock.advanceBy(16000);
    controller.abort();
    const result = await clock.run(loading);
    expect(site.sent).toHaveLength(2);
    expect(site.sent[1].end).toBe(Date.parse(SUNDAY_AFTERNOON) + 16000);
    expect(result.days).toEqual([]);
    expect(result.stopped?.reason).toBe("cancelled");
  });
});

describe("the days a stopped recent run had not loaded", () => {
  it("are the rest of its five days, also when /new was ahead of the index", async () => {
    // Sunday 20:30 in New York: /new shows Monday, the index ends Friday
    const { clock, site, service } = setup("2026-09-28T00:30:00Z");
    serveDays(site, ["hep-ph"], [...INDEX].reverse(), "2026-09-28");
    const controller = new AbortController();
    const arrived: string[] = [];
    const loading = service.loadRecent(["hep-ph"], {
      signal: controller.signal,
      onDay: (day) => {
        arrived.push(day.date);
        if (arrived.length === 2) controller.abort();
      },
    });
    const result = await clock.run(loading);
    expect(arrived).toEqual(["2026-09-28", "2026-09-25"]);
    expect(result.stopped?.reason).toBe("cancelled");
    // Friday 21 Sep is not among the five days any more
    expect(result.notLoaded).toEqual([
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
    ]);
  });

  it("are none while its five days were not settled: cancelled before /new answered", async () => {
    const { clock, site, service } = setup("2026-09-28T00:30:00Z");
    serveDays(site, ["hep-ph"], [...INDEX].reverse(), "2026-09-28");
    const controller = new AbortController();
    const loading = service.loadRecent(["hep-ph"], {
      signal: controller.signal,
    });
    // The index at once; /new would go 15 s later
    await clock.advanceBy(5000);
    controller.abort();
    const result = await clock.run(loading);
    expect(result.days).toEqual([]);
    expect(result.stopped?.reason).toBe("cancelled");
    expect(result.notLoaded).toBeUndefined();
  });

  it("are none while its five days were not settled: /new did not answer", async () => {
    // Sunday 20:30 in New York: /new fails, the index still ends Friday
    const { clock, site, service } = setup("2026-09-28T00:30:00Z");
    serveDays(site, ["hep-ph"], [...INDEX].reverse(), "2026-09-28");
    site.page(LIST_URL("hep-ph"), { status: 500 });
    const controller = new AbortController();
    const arrived: string[] = [];
    const loading = service.loadRecent(["hep-ph"], {
      signal: controller.signal,
      onDay: (day) => {
        arrived.push(day.date);
        if (arrived.length === 2) controller.abort();
      },
    });
    const result = await clock.run(loading);
    // Friday stood in for the newest day, which /new did not tell
    expect(arrived[0]).toBe("2026-09-25");
    expect(result.stopped?.reason).toBe("cancelled");
    expect(result.notLoaded).toBeUndefined();
  });

  it("are none while its five days were not settled: cancelled during the search for the days between", async () => {
    // The index ends on Wednesday, /new shows Friday: Thursday comes from
    // Wednesday's "next day" link
    const { clock, site, service } = setup();
    site.html(
      INDEX_URL,
      recentIndexHtml("math", [
        "2026-09-23",
        "2026-09-22",
        "2026-09-21",
        "2026-09-18",
        "2026-09-17",
      ]),
    );
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-25", smallDay("hep-ph")),
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-23"),
      catchupPageHtml("hep-ph", "2026-09-23", smallDay("hep-ph"), "2026-09-24"),
    );
    const controller = new AbortController();
    const loading = service.loadRecent(["hep-ph"], {
      signal: controller.signal,
    });
    // Each request takes 0.8 s and the next goes 15 s after it: the index at
    // 0 s, /new at 15.8 s, Wednesday's page at 31.6 s
    await clock.advanceBy(31900);
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-23"))).toBe(1);
    controller.abort();
    const result = await clock.run(loading);
    expect(result.stopped?.reason).toBe("cancelled");
    expect(result.notLoaded).toBeUndefined();
  });
});

describe("loadDays", () => {
  /**
   * The real math index and hep-ph pages of 25 September (/new) and
   * 21 September (catch-up); built catch-up pages between them
   */
  function serveHepPh(site: Site) {
    site.html(
      INDEX_URL,
      readArxivFixture("list-math-recent-show25-2026-09-25.html"),
    );
    site.html(
      LIST_URL("hep-ph"),
      readArxivFixture("list-hep-ph-new-2026-09-25.html"),
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-21"),
      readArxivFixture("catchup-hep-ph-2026-09-21.html"),
    );
    for (const day of ["2026-09-22", "2026-09-23", "2026-09-24"]) {
      site.html(
        CATCHUP_URL("hep-ph", day),
        catchupPageHtml("hep-ph", day, smallDay("hep-ph"), NEXT[day]),
      );
    }
  }

  it("loads the chosen days newest first: the newest from /new, the others from their catch-up pages", async () => {
    const { clock, site, service } = setup();
    serveHepPh(site);
    const arrived: string[] = [];
    const result = await clock.run(
      service.loadDays(["hep-ph"], ["2026-09-21", "2026-09-25", "2026-09-23"], {
        onDay: (day) => arrived.push(day.date),
      }),
    );
    expect(arrived).toEqual(["2026-09-25", "2026-09-23", "2026-09-21"]);
    expect(summary(result.days)).toEqual([
      "2026-09-25 complete 72",
      "2026-09-23 complete 4",
      "2026-09-21 complete 57",
    ]);
    expect(site.sent.map((request) => request.url)).toEqual([
      INDEX_URL,
      LIST_URL("hep-ph"),
      CATCHUP_URL("hep-ph", "2026-09-23"),
      CATCHUP_URL("hep-ph", "2026-09-21"),
    ]);
    expect(result.newestDay).toBe("2026-09-25");
    expect(result.previousIssue).toBe(false);
    expect(result.stopped).toBeUndefined();
    // Asked again: from the cache
    const before = site.sent.length;
    await clock.run(service.loadDays(["hep-ph"], ["2026-09-23", "2026-09-21"]));
    expect(site.sent.length).toBe(before);
  });

  it("reports a chosen day that had no announcement and does not show it", async () => {
    const { clock, site, service } = setup();
    serveHepPh(site);
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-08"),
      readArxivFixture("catchup-hep-ph-2026-09-08-holiday-noabs.html"),
    );
    // The math archive has papers on every announcement day, not on 8 Sep
    site.html(
      "https://arxiv.org/catchup/math/2026-09-08?abs=False",
      catchupPageHtml("math", "2026-09-08", [], "2026-09-09"),
    );
    const result = await clock.run(
      service.loadDays(["hep-ph"], ["2026-09-08", "2026-09-22"]),
    );
    expect(summary(result.days)).toEqual(["2026-09-22 complete 4"]);
    expect(result.noAnnouncementDays).toEqual(["2026-09-08"]);
    expect(result.stopped).toBeUndefined();
  });

  it("shows a day whose pages all failed as not fully fetched, and loads the others", async () => {
    const { clock, site, service } = setup();
    serveHepPh(site);
    site.page(CATCHUP_URL("hep-ph", "2026-09-23"), {
      error: new ArxivFetchError("timeout", "Timed out"),
    });
    const result = await clock.run(
      service.loadDays(["hep-ph"], ["2026-09-24", "2026-09-23", "2026-09-22"]),
    );
    expect(summary(result.days)).toEqual([
      "2026-09-24 complete 4",
      "2026-09-23 failed 0",
      "2026-09-22 complete 4",
    ]);
    expect(stateOf(result.days[1], "hep-ph")).toMatchObject({
      state: "failed",
      reason: "timeout",
    });
    expect(result.stopped).toBeUndefined();
  });

  it("leaves out a chosen day not announced yet and notes the late listing", async () => {
    // Sunday 21:00 in New York: Monday's listing is due, /new still shows Friday
    const { clock, site, service } = setup("2026-09-28T01:00:00Z");
    serveHepPh(site);
    const result = await clock.run(
      service.loadDays(["hep-ph"], ["2026-09-28", "2026-09-25"]),
    );
    expect(summary(result.days)).toEqual(["2026-09-25 complete 72"]);
    expect(result.newestDay).toBe("2026-09-25");
    expect(result.previousIssue).toBe(true);
  });

  it("stops when cancelled, keeping the days loaded", async () => {
    const { clock, site, service } = setup();
    serveHepPh(site);
    const controller = new AbortController();
    const arrived: string[] = [];
    const loading = service.loadDays(
      ["hep-ph"],
      ["2026-09-24", "2026-09-23", "2026-09-22"],
      {
        signal: controller.signal,
        onDay: (day) => {
          arrived.push(day.date);
          controller.abort();
        },
      },
    );
    const result = await clock.run(loading);
    expect(arrived).toEqual(["2026-09-24"]);
    expect(result.stopped?.reason).toBe("cancelled");
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-22"))).toBe(0);
    // The days it had yet to load
    expect(result.notLoaded).toEqual(["2026-09-23", "2026-09-22"]);
  });

  it("counts the newest chosen day as not loaded when cancelled before /new told", async () => {
    // Sunday 20:30 in New York: Monday's listing is due, the index ends Friday
    const { clock, site, service } = setup("2026-09-28T00:30:00Z");
    serveHepPh(site);
    const controller = new AbortController();
    const loading = service.loadDays(["hep-ph"], ["2026-09-28", "2026-09-25"], {
      signal: controller.signal,
    });
    // The index at once; /new would go 15 s later
    await clock.advanceBy(5000);
    controller.abort();
    const result = await clock.run(loading);
    expect(result.days).toEqual([]);
    expect(result.notLoaded).toEqual(["2026-09-28", "2026-09-25"]);
  });

  it("does not ask /new for days older than the newest day a run before found", async () => {
    // Sunday 20:30 in New York: /new shows Monday, the index still ends Friday
    const { clock, site, service } = setup("2026-09-28T00:30:00Z");
    serveDays(site, ["hep-ph"], [...INDEX].reverse(), "2026-09-28");
    const result = await clock.run(
      service.loadDays(["hep-ph"], ["2026-09-25", "2026-09-24"], {
        newestDay: "2026-09-28",
      }),
    );
    expect(summary(result.days)).toEqual([
      "2026-09-25 complete 4",
      "2026-09-24 complete 4",
    ]);
    expect(site.count(LIST_URL("hep-ph"))).toBe(0);
    expect(result.newestDay).toBe("2026-09-28");
  });

  it("reports no days not loaded when the run was not stopped", async () => {
    const { clock, site, service } = setup();
    serveHepPh(site);
    const result = await clock.run(
      service.loadDays(["hep-ph"], ["2026-09-24", "2026-09-28"]),
    );
    expect(result.stopped).toBeUndefined();
    expect(result.notLoaded).toBeUndefined();
  });
});

describe("reloadDay", () => {
  it("fetches only the categories that were not complete", async () => {
    const { clock, site, service } = setup();
    serveDays(
      site,
      ["hep-ph", "hep-th"],
      INDEX.slice(1).reverse(),
      "2026-09-25",
    );
    const saved = site.routes.get(CATCHUP_URL("hep-th", "2026-09-23"))!;
    site.page(CATCHUP_URL("hep-th", "2026-09-23"), { status: 500 });
    const first = await clock.run(service.loadRecent(["hep-ph", "hep-th"]));
    expect(first.days[2]).toMatchObject({
      date: "2026-09-23",
      status: "incomplete",
    });
    site.page(CATCHUP_URL("hep-th", "2026-09-23"), saved);
    const before = site.sent.length;
    const retry = await clock.run(
      service.reloadDay(["hep-ph", "hep-th"], "2026-09-23"),
    );
    expect(summary(retry.days)).toEqual(["2026-09-23 complete 8"]);
    expect(site.sent.slice(before).map((request) => request.url)).toEqual([
      CATCHUP_URL("hep-th", "2026-09-23"),
    ]);
  });
});

describe("reloadDay of a start day that had no announcement", () => {
  it("does not show it as an announcement day", async () => {
    const { clock, site, service } = setup();
    serveDays(site, ["hep-ph"], INDEX.slice(1).reverse(), "2026-09-25");
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-08"),
      readArxivFixture("catchup-hep-ph-2026-09-08-holiday-noabs.html"),
    );
    const mathCheck = "https://arxiv.org/catchup/math/2026-09-08?abs=False";
    site.page(mathCheck, {
      error: new ArxivFetchError("timeout", "Timed out"),
    });
    const first = await clock.run(
      service.loadCatchup(["hep-ph"], "2026-09-08"),
    );
    expect(first.stopped?.date).toBe("2026-09-08");

    // The day is retried on its own; math now answers
    site.html(
      mathCheck,
      catchupPageHtml("math", "2026-09-08", [], "2026-09-09"),
    );
    const before = site.sent.length;
    const retry = await clock.run(service.reloadDay(["hep-ph"], "2026-09-08"));
    expect(site.sent.slice(before).map((request) => request.url)).toEqual([
      mathCheck,
    ]);
    expect(retry.days).toEqual([]);
    expect(retry.noAnnouncementOn).toBe("2026-09-08");
  });

  it("shows an index day without subscribed papers without asking math", async () => {
    const { clock, site, service } = setup();
    serveDays(site, ["cs.GL"], INDEX.slice(1).reverse(), "2026-09-25");
    site.html(
      CATCHUP_URL("cs.GL", "2026-09-23"),
      catchupPageHtml("cs.GL", "2026-09-23", [], "2026-09-24"),
    );
    await clock.run(service.loadRecent(["cs.GL"]));
    const before = site.sent.length;
    const retry = await clock.run(service.reloadDay(["cs.GL"], "2026-09-23"));
    expect(site.sent.length - before).toBe(0);
    expect(summary(retry.days)).toEqual(["2026-09-23 complete 0"]);
  });
});

describe("reloadDay of the newest day", () => {
  it("fetches only the categories whose /new did not show the day", async () => {
    const { clock, site, service } = setup("2026-09-28T00:10:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", smallDay("hep-ph")),
    );
    site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-25", smallDay("hep-th")),
    );
    const first = await clock.run(service.loadNew(["hep-ph", "hep-th"]));
    expect(first.days[0]).toMatchObject({
      date: "2026-09-28",
      status: "incomplete",
    });
    await clock.advanceBy(2 * 60 * 1000);
    site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-28", smallDay("hep-th")),
    );
    const before = site.sent.length;
    const retry = await clock.run(
      service.reloadDay(["hep-ph", "hep-th"], "2026-09-28", { latest: true }),
    );
    expect(site.sent.slice(before).map((request) => request.url)).toEqual([
      LIST_URL("hep-th"),
    ]);
    expect(summary(retry.days)).toEqual(["2026-09-28 complete 8"]);
  });
});

describe("estimateListingRequests", () => {
  it("counts N, 1 + 5N and 1 + N per day at 15 s each", () => {
    expect(estimateListingRequests("new", 3)).toEqual({
      requests: 3,
      minimumMs: 30000,
    });
    expect(estimateListingRequests("recent", 3)).toEqual({
      requests: 16,
      minimumMs: 225000,
    });
    expect(estimateListingRequests("recent", 20).requests).toBe(101);
    expect(estimateListingRequests("catchup", 3, 10).requests).toBe(31);
  });
});
