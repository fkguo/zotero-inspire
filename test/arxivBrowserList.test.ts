import { describe, expect, it } from "vitest";
import {
  arrangeList,
  filterGroups,
  pageBlocks,
  pageCount,
  pageOfDay,
  pageOfEntry,
  rowKey,
  toBrowserEntry,
  type ArrangedList,
  type BrowserEntry,
  type ListOptions,
  type PageBlock,
} from "../src/modules/arxiv/browser/browserList";
import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import { ListingService } from "../src/modules/arxiv/listingService";
import { MemoryListingStore } from "../src/modules/arxiv/listingStore";
import {
  LISTING_SECTIONS,
  type ArxivListingEntry,
  type DayListing,
  type ListingSection,
} from "../src/modules/arxiv/listingTypes";
import { htmlDocument, readArxivFixture } from "./arxivFixtures";
import { LIST_URL, SimulatedArxiv } from "./arxivSite";
import { VirtualClock } from "./virtualClock";

// The arXiv browser's list as data: its entries, the order of the papers
// within a day, the text filter, and the cutting into pages with headers
// that are repeated, marked as continued, when a page begins inside a day or
// a section.

const ALL = new Set<ListingSection>(LISTING_SECTIONS);

function paper(
  id: string,
  date: string,
  streams: Array<[string, ListingSection, number]>,
  fields: Partial<ArxivListingEntry> = {},
): ArxivListingEntry {
  return {
    id,
    title: `Paper ${id}`,
    authors: [{ display: "A. Author", family: "Author", given: "A." }],
    abstract: `Abstract of ${id}.`,
    primaryCategory: streams[0]?.[0] ?? "hep-ph",
    categories: [streams[0]?.[0] ?? "hep-ph"],
    matchedCategories: [...new Set(streams.map(([category]) => category))],
    section: streams[0]?.[1] ?? "new",
    streams: streams.map(([category, section, position]) => ({
      category,
      section,
      position,
    })),
    announceDate: date,
    ...fields,
  };
}

function day(
  date: string,
  entries: ArxivListingEntry[],
  status: DayListing["status"] = "complete",
): DayListing {
  return { date, status, entries, specs: [], latest: false };
}

/** Days with their entries built once, as the view keeps them */
function arrange(days: DayListing[], options: Partial<ListOptions> = {}) {
  const built = new Map(days.map((d) => [d, d.entries.map(toBrowserEntry)]));
  return arrangeList(days, (d) => built.get(d)!, {
    sort: "announcement",
    sections: ALL,
    filter: [],
    specs: ["hep-ph"],
    ...options,
  });
}

const ids = (entries: readonly BrowserEntry[]) =>
  entries.map((entry) => entry.listing.id);

/** A page as text lines: headers with "(cont.)", papers by ID */
function describePage(list: ArrangedList, page: number, size: number) {
  return pageBlocks(list, page, size).map((block: PageBlock) => {
    if (block.kind === "day") {
      return `# ${block.day.listing.date}${block.continued ? " (cont.)" : ""}`;
    }
    if (block.kind === "group") {
      return `## ${block.group.key}${block.continued ? " (cont.)" : ""}`;
    }
    return block.entry.listing.id;
  });
}

/** A day of `count` papers: `news` new, the rest cross-lists, on hep-ph */
function numberedDay(date: string, count: number, news = count): DayListing {
  const entries = Array.from({ length: count }, (_, i) =>
    paper(`${date.slice(2, 4)}${date.slice(5, 7)}.${String(10000 + i)}`, date, [
      ["hep-ph", i < news ? "new" : "cross", i],
    ]),
  );
  return day(date, entries);
}

describe("entries of the list", () => {
  it("are keyed by paper and announcement day", () => {
    expect(rowKey("2609.28544", "2026-09-25")).toBe(
      "arxiv-2609.28544-2026-09-25",
    );
    const entry = toBrowserEntry(
      paper("2609.28544", "2026-09-25", [["hep-ph", "new", 0]], {
        title: "Decays of $B$ mesons",
        authors: [
          {
            display: "Krishna Kingkar Pathak",
            family: "Pathak",
            given: "Krishna Kingkar",
          },
          { display: "R. Di Vora", family: "Di Vora", given: "R." },
          { display: "ATLAS Collaboration" },
        ],
        categories: ["hep-ph", "hep-ex"],
      }),
    );
    expect(entry).toMatchObject({
      id: "arxiv-2609.28544-2026-09-25",
      title: "Decays of B mesons",
      titleOriginal: "Decays of $B$ mesons",
      authors: [
        "Pathak, Krishna Kingkar",
        "Di Vora, R.",
        "ATLAS Collaboration",
      ],
      authorText: "Krishna Kingkar Pathak, R. Di Vora, ATLAS Collaboration",
      fallbackUrl: "https://arxiv.org/abs/2609.28544",
      arxivDetails: { id: "2609.28544", categories: ["hep-ph", "hep-ex"] },
      abstract: "Abstract of 2609.28544.",
    });
    expect(entry.year).toBe("2026");
    // An old paper announced again keeps its own year
    expect(
      toBrowserEntry(
        paper("hep-th/9901001", "2026-09-25", [["hep-th", "replace", 0]]),
      ).year,
    ).toBe("1999");
    expect(entry.recid).toBeUndefined();
    expect(entry.localItemID).toBeUndefined();
  });
});

describe("order within a day", () => {
  it("is arXiv's page order for one category (real hep-ph listing of 25 September)", async () => {
    const clock = new VirtualClock(Date.parse("2026-09-27T17:00:00Z"));
    const site = new SimulatedArxiv(clock);
    site.html(
      LIST_URL("hep-ph"),
      readArxivFixture("list-hep-ph-new-2026-09-25.html"),
    );
    const service = new ListingService({
      scheduler: new ArxivScheduler({
        host: "arxiv.org",
        minIntervalMs: 15000,
        timeoutMs: 60000,
        transport: site.transport,
        clock,
      }),
      store: new MemoryListingStore(),
      clock,
      parseHtml: htmlDocument,
    });
    const [loaded] = (await clock.run(service.loadNew(["hep-ph"]))).days;

    const list = arrange([loaded]);

    expect(ids(list.entries)).toEqual(loaded.entries.map((entry) => entry.id));
    expect(
      list.days[0].groups.map((group) => [group.key, group.entries.length]),
    ).toEqual([
      ["new", 27],
      ["cross", 15],
      ["replace", 30],
    ]);
  });

  it("places a paper where the shown section lists it, by the subscription's order of categories", () => {
    // hep-ph: new A, B; cross X.  hep-lat: new L1, X, L2.
    const date = "2026-09-25";
    const entries = [
      paper("2609.00001", date, [["hep-ph", "new", 0]]),
      paper("2609.00002", date, [["hep-ph", "new", 1]]),
      paper("2609.00009", date, [
        ["hep-ph", "cross", 2],
        ["hep-lat", "new", 1],
      ]),
      paper("2609.00005", date, [["hep-lat", "new", 0]]),
      paper("2609.00003", date, [["hep-lat", "new", 2]]),
    ];
    const specs = ["hep-ph", "hep-lat"];

    const all = arrange([day(date, entries)], { specs });
    expect(ids(all.entries)).toEqual([
      "2609.00001",
      "2609.00002",
      "2609.00005",
      "2609.00009",
      "2609.00003",
    ]);
    expect(all.days[0].groups.map((group) => group.key)).toEqual(["new"]);

    // Only cross-lists: X, as hep-ph lists it
    const cross = arrange([day(date, entries)], {
      specs,
      sections: new Set(["cross"]),
    });
    expect(ids(cross.entries)).toEqual(["2609.00009"]);
    expect(cross.days[0]).toMatchObject({ count: 1, inSections: 1 });

    // hep-lat first in the subscription: its papers come first
    const latFirst = arrange([day(date, entries)], {
      specs: ["hep-lat", "hep-ph"],
    });
    expect(ids(latFirst.entries)).toEqual([
      "2609.00005",
      "2609.00009",
      "2609.00003",
      "2609.00001",
      "2609.00002",
    ]);
  });

  it("shows only the papers the chosen category pages list, each where those pages list it", () => {
    // hep-ph: new A, B; cross X.  hep-lat: new L1, X, L2.
    const date = "2026-09-25";
    const entries = [
      paper("2609.00001", date, [["hep-ph", "new", 0]]),
      paper("2609.00002", date, [["hep-ph", "new", 1]]),
      paper("2609.00009", date, [
        ["hep-ph", "cross", 2],
        ["hep-lat", "new", 1],
      ]),
      paper("2609.00005", date, [["hep-lat", "new", 0]]),
      paper("2609.00003", date, [["hep-lat", "new", 2]]),
    ];
    const specs = ["hep-ph", "hep-lat"];

    // hep-ph alone: X is a cross-list there
    const hepPh = arrange([day(date, entries)], {
      specs,
      categories: new Set(["hep-ph"]),
    });
    expect(
      hepPh.days[0].groups.map((group) => [group.key, ids(group.entries)]),
    ).toEqual([
      ["new", ["2609.00001", "2609.00002"]],
      ["cross", ["2609.00009"]],
    ]);
    expect(hepPh.days[0]).toMatchObject({
      count: 3,
      inSections: 3,
      onChosenPages: 3,
    });
    // Each paper stands in the section of the chosen page: X is a cross-list
    // on hep-ph, new on hep-lat and, with nothing chosen, new
    const x = (list: ArrangedList) =>
      list.sectionOf.get(
        list.entries.find((entry) => entry.listing.id === "2609.00009")!,
      );
    expect(x(hepPh)).toBe("cross");

    // A category without papers that day
    const hepEx = arrange([day(date, entries)], {
      specs,
      categories: new Set(["hep-ex"]),
    });
    expect(hepEx.days[0]).toMatchObject({
      count: 0,
      inSections: 0,
      onChosenPages: 0,
    });

    // hep-lat alone: X is new there, in hep-lat's order
    const hepLat = arrange([day(date, entries)], {
      specs,
      categories: new Set(["hep-lat"]),
    });
    expect(x(hepLat)).toBe("new");
    expect(ids(hepLat.entries)).toEqual([
      "2609.00005",
      "2609.00009",
      "2609.00003",
    ]);

    // Both chosen, or none: the whole subscription
    const both = arrange([day(date, entries)], {
      specs,
      categories: new Set(["hep-ph", "hep-lat"]),
    });
    const none = arrange([day(date, entries)], {
      specs,
      categories: new Set(),
    });
    expect(ids(both.entries)).toEqual(ids(none.entries));
    expect(x(none)).toBe("new");
    expect(ids(none.entries)).toEqual([
      "2609.00001",
      "2609.00002",
      "2609.00005",
      "2609.00009",
      "2609.00003",
    ]);
  });

  it("tells whether the pages a day's papers are taken from were fetched completely", () => {
    const date = "2026-09-25";
    const listing: DayListing = {
      ...day(date, [paper("2609.00001", date, [["hep-ph", "new", 0]])]),
      status: "incomplete",
      specs: [
        {
          spec: "hep-ph",
          state: { state: "complete", count: 1, fromCache: false },
        },
        {
          spec: "hep-lat",
          state: { state: "failed", reason: "http", message: "HTTP 500" },
        },
      ],
    };
    const specs = ["hep-ph", "hep-lat"];
    const choose = (categories: string[]) =>
      arrange([listing], { specs, categories: new Set(categories) }).days[0];
    expect(choose(["hep-lat"])).toMatchObject({
      count: 0,
      onChosenPages: 0,
      pagesFetched: false,
    });
    expect(choose(["hep-ph"])).toMatchObject({ count: 1, pagesFetched: true });
    // None chosen: all of the subscription's pages count
    expect(choose([])).toMatchObject({ count: 1, pagesFetched: false });
  });

  it("sorts by arXiv identifier, old-style identifiers by their date", () => {
    const date = "2026-09-25";
    const entries = [
      paper("2609.20000", date, [["hep-ph", "new", 0]]),
      paper("2508.00226", date, [["hep-ph", "replace", 2]]),
      paper("hep-th/0101001", date, [["hep-ph", "replace", 1]]),
      paper("2609.10000", date, [["hep-ph", "cross", 3]]),
    ];
    const up = arrange([day(date, entries)], { sort: "id-asc" });
    expect(ids(up.entries)).toEqual([
      "hep-th/0101001",
      "2508.00226",
      "2609.10000",
      "2609.20000",
    ]);
    // One group without a header
    expect(up.days[0].groups.map((group) => group.kind)).toEqual(["all"]);
    const down = arrange([day(date, entries)], { sort: "id-desc" });
    expect(ids(down.entries)).toEqual([
      "2609.20000",
      "2609.10000",
      "2508.00226",
      "hep-th/0101001",
    ]);
  });

  it("groups by primary category: the subscription's first, then the others", () => {
    const date = "2026-09-25";
    const entries = [
      paper("2609.00001", date, [["hep-ph", "cross", 3]], {
        primaryCategory: "math-ph",
      }),
      paper("2609.00002", date, [["hep-lat", "new", 0]], {
        primaryCategory: "hep-lat",
      }),
      paper("2609.00003", date, [["math", "new", 0]], {
        primaryCategory: "math.AG",
      }),
      paper("2609.00004", date, [["hep-ph", "new", 1]], {
        primaryCategory: "hep-ph",
      }),
      paper("2609.00005", date, [["hep-ph", "cross", 2]], {
        primaryCategory: "astro-ph.CO",
      }),
      paper("2609.00006", date, [["hep-ph", "new", 0]], {
        primaryCategory: "hep-ph",
      }),
    ];
    const list = arrange([day(date, entries)], {
      sort: "primary",
      specs: ["hep-ph", "math", "hep-lat"],
    });
    // math-ph goes with math, whose page lists it (through math.MP)
    expect(
      list.days[0].groups.map((group) => [group.key, ids(group.entries)]),
    ).toEqual([
      ["hep-ph", ["2609.00006", "2609.00004"]],
      ["math-ph", ["2609.00001"]],
      ["math.AG", ["2609.00003"]],
      ["hep-lat", ["2609.00002"]],
      ["astro-ph.CO", ["2609.00005"]],
    ]);
  });
});

describe("text filter", () => {
  const date = "2026-09-25";
  const entries = [
    paper("2609.00001", date, [["hep-ph", "new", 0]], {
      title: "Two-pole structures of the $\\Lambda(1405)$",
      authors: [
        { display: "Ulf-G. Meißner", family: "Meißner", given: "Ulf-G." },
      ],
      journalRef: "Phys. Rev. D 110 (2024) 054001",
    }),
    paper("2609.00002", date, [["hep-ph", "new", 1]], {
      abstract: "We study hadronic molecules near thresholds.",
      comments: "12 pages, 3 figures",
    }),
    paper("2609.00003", date, [["hep-ph", "cross", 2]], {
      categories: ["nucl-th", "hep-ph"],
    }),
  ];
  const filtered = (text: string) =>
    ids(arrange([day(date, entries)], { filter: filterGroups(text) }).entries);

  it("finds words in title, authors, abstract, comments, categories and identifier", () => {
    expect(filtered("pole")).toEqual(["2609.00001"]);
    expect(filtered("meissner")).toEqual(["2609.00001"]);
    expect(filtered("hadronic molecules")).toEqual(["2609.00002"]);
    expect(filtered("figures")).toEqual(["2609.00002"]);
    expect(filtered("nucl-th")).toEqual(["2609.00003"]);
    expect(filtered("2609.00003")).toEqual(["2609.00003"]);
    // As papers cite it and as the list shows it
    expect(filtered("arXiv:2609.00003")).toEqual(["2609.00003"]);
    // Every word must be found
    expect(filtered("pole hadronic")).toEqual([]);
    expect(filtered("")).toHaveLength(3);
  });

  it("matches quoted phrases also without dots and spaces", () => {
    expect(filtered('"PhysRevD"')).toEqual(["2609.00001"]);
    expect(filtered('"near thresholds"')).toEqual(["2609.00002"]);
  });

  it("keeps a day whose papers all fail the filter, with none shown", () => {
    const list = arrange([day(date, entries)], {
      filter: filterGroups("nothing-like-this"),
    });
    expect(list.days).toHaveLength(1);
    expect(list.days[0]).toMatchObject({ count: 0, inSections: 3 });
  });
});

describe("pages", () => {
  it("repeat the day's and the section's header, marked as continued", () => {
    // 25 Sep: 72 papers, 40 new and 32 cross-lists; 24 Sep: 30 new
    const list = arrange([
      numberedDay("2026-09-25", 72, 40),
      numberedDay("2026-09-24", 30),
    ]);
    expect(pageCount(list, 50)).toBe(3);
    const first = describePage(list, 0, 50);
    expect(first.slice(0, 3)).toEqual(["# 2026-09-25", "## new", "2609.10000"]);
    expect(first.filter((line) => line.startsWith("#"))).toEqual([
      "# 2026-09-25",
      "## new",
      "## cross",
    ]);
    expect(first.filter((line) => !line.startsWith("#"))).toHaveLength(50);
    const second = describePage(list, 1, 50);
    expect(second.filter((line) => line.startsWith("#"))).toEqual([
      "# 2026-09-25 (cont.)",
      "## cross (cont.)",
      "# 2026-09-24",
      "## new",
    ]);
    expect(second[2]).toBe("2609.10050");
    const third = describePage(list, 2, 50);
    expect(third.slice(0, 3)).toEqual([
      "# 2026-09-24 (cont.)",
      "## new (cont.)",
      "2609.10028",
    ]);
    expect(third).toHaveLength(4);
  });

  it("start a day without a continued mark when it begins the page", () => {
    const list = arrange([
      numberedDay("2026-09-25", 50),
      numberedDay("2026-09-24", 10),
    ]);
    expect(describePage(list, 1, 50).slice(0, 2)).toEqual([
      "# 2026-09-24",
      "## new",
    ]);
  });

  it("show a day without papers after the paper before it", () => {
    const failed = day("2026-09-23", [], "failed");
    const list = arrange([
      numberedDay("2026-09-25", 50),
      failed,
      numberedDay("2026-09-24", 10),
      day("2026-09-22", [], "failed"),
    ]);
    expect(describePage(list, 0, 50).filter((l) => l.startsWith("# "))).toEqual(
      ["# 2026-09-25", "# 2026-09-23"],
    );
    expect(describePage(list, 0, 50).slice(-2)).toEqual([
      "2609.10049",
      "# 2026-09-23",
    ]);
    expect(describePage(list, 1, 50).filter((l) => l.startsWith("# "))).toEqual(
      ["# 2026-09-24", "# 2026-09-22"],
    );
    expect(pageOfDay(list, "2026-09-23", 50)).toBe(0);
    expect(pageOfDay(list, "2026-09-22", 50)).toBe(1);
    expect(pageOfDay(list, "2026-09-20", 50)).toBe(-1);
  });

  it("keep a day without papers on its page when later days arrive", () => {
    // The first day fills page 1 exactly; the next day shows nothing
    const loaded = [
      numberedDay("2026-09-25", 50),
      day("2026-09-24", [], "failed"),
    ];
    const before = arrange(loaded);
    const after = arrange([...loaded, numberedDay("2026-09-23", 10)]);
    expect(describePage(after, 0, 50)).toEqual(describePage(before, 0, 50));
    expect(pageOfDay(after, "2026-09-24", 50)).toBe(
      pageOfDay(before, "2026-09-24", 50),
    );
  });

  it("repeat the category's header under the primary-category sort, and only the day's when sorted by identifier", () => {
    const date = "2026-09-25";
    const entries = Array.from({ length: 30 }, (_, i) =>
      paper(`2609.${10000 + i}`, date, [["hep-ph", "new", i]], {
        primaryCategory: i < 20 ? "hep-ph" : "hep-lat",
      }),
    );
    const byCategory = arrange([day(date, entries)], {
      sort: "primary",
      specs: ["hep-ph", "hep-lat"],
    });
    expect(describePage(byCategory, 1, 15).slice(0, 3)).toEqual([
      "# 2026-09-25 (cont.)",
      "## hep-ph (cont.)",
      "2609.10015",
    ]);
    expect(describePage(byCategory, 1, 15)).toContain("## hep-lat");
    const byId = arrange([day(date, entries)], { sort: "id-desc" });
    expect(describePage(byId, 1, 15).slice(0, 2)).toEqual([
      "# 2026-09-25 (cont.)",
      "2609.10014",
    ]);
  });

  it("with no paper at all, are one page of day headers", () => {
    const list = arrange([
      day("2026-09-25", [], "failed"),
      day("2026-09-24", []),
    ]);
    expect(pageCount(list, 50)).toBe(1);
    expect(describePage(list, 0, 50)).toEqual(["# 2026-09-25", "# 2026-09-24"]);
  });

  it("do not change when a later day arrives", () => {
    const first = [numberedDay("2026-09-25", 72, 40)];
    const before = arrange(first);
    const after = arrange([...first, numberedDay("2026-09-24", 30)]);
    expect(describePage(after, 0, 50)).toEqual(describePage(before, 0, 50));
    expect(describePage(after, 1, 50).slice(0, 24)).toEqual(
      describePage(before, 1, 50),
    );
  });

  it("find a paper's page, for 10 to 500 papers per page", () => {
    const list = arrange([
      numberedDay("2026-09-25", 72, 40),
      numberedDay("2026-09-24", 30),
    ]);
    const key = rowKey("2609.10005", "2026-09-24");
    expect(pageOfEntry(list, key, 10)).toBe(7);
    expect(pageOfEntry(list, key, 50)).toBe(1);
    expect(pageOfEntry(list, key, 500)).toBe(0);
    expect(pageOfEntry(list, "arxiv-none", 50)).toBe(-1);
    expect(pageCount(list, 10)).toBe(11);
    expect(pageCount(list, 500)).toBe(1);
    expect(describePage(list, 0, 500)).toHaveLength(102 + 5);
  });
});
