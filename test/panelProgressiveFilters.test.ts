import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import {
  RENDER_PAGE_SIZE,
  RENDER_PAGE_SIZE_FILTERED,
  type QuickFilterType,
} from "../src/modules/inspire/constants";
import { localCache } from "../src/modules/inspire/localCache";
import * as searchService from "../src/modules/inspire/panel/SearchService";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

// List filters while a list is still arriving page by page (Cited by, author
// papers, INSPIRE search): every page after the first must be shown through
// the active filters, and the author card must count the filtered papers.
// The list is rendered into jsdom; only what needs a running Zotero (row
// markup, chart, caches, network) is stubbed.

function entry(
  id: string,
  fields: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id,
    title: id,
    year: "",
    authors: [],
    authorText: "",
    displayText: "",
    searchText: "",
    ...fields,
  };
}

// The first page as fetched, then the rest.
function pages(): InspireReferenceEntry[][] {
  return [
    [
      entry("article-1", {
        displayText: "Hidden-charm pentaquarks",
        documentType: ["article"],
        publicationInfo: { journal_title: "Phys. Rev. D" },
        totalAuthors: 3,
        citationCount: 120,
        year: "2024",
      }),
      entry("review-1", {
        displayText: "Hadronic molecules",
        documentType: ["review"],
        publicationInfo: { journal_title: "Rev. Mod. Phys." },
        totalAuthors: 2,
        citationCount: 300,
        year: "2018",
      }),
    ],
    [
      entry("preprint-2", {
        displayText: "Pentaquark line shapes",
        documentType: ["article"],
        arxivDetails: { id: "2501.00002" },
        totalAuthors: 1,
        citationCount: 5,
        year: "2025",
      }),
      entry("review-2", {
        displayText: "Exotic hadrons",
        documentType: ["review"],
        publicationInfo: { journal_title: "Prog. Part. Nucl. Phys." },
        totalAuthors: 1,
        citationCount: 80,
        year: "2023",
      }),
      entry("collab-2", {
        displayText: "Observation of pentaquark states",
        documentType: ["article"],
        publicationInfo: { journal_title: "Phys. Rev. Lett." },
        totalAuthors: 900,
        citationCount: 60,
        year: "2019",
      }),
    ],
  ];
}

const AUTHOR_KEY = "a F.K.Guo.1";
const AUTHOR_SOURCE = {
  authorQuery: AUTHOR_KEY,
  authorSearchInfo: { fullName: "Guo, Feng-Kun", bai: "F.K.Guo.1" },
  label: "Feng-Kun Guo",
};

function createController(): any {
  const dom = new JSDOM(
    '<div class="item-pane-content"><div class="panel"><div class="list"></div></div></div>',
  );
  const doc = dom.window.document;
  const cache = new Map<string, InspireReferenceEntry[]>();
  const controller = Object.create(
    InspireReferencePanelController.prototype,
  ) as any;
  Object.assign(controller, {
    body: doc.querySelector(".panel"),
    listEl: doc.querySelector(".list"),
    currentItemID: 42,
    currentRecid: "1234",
    viewMode: "citedBy",
    allEntries: [],
    totalApiCount: null,
    renderedCount: 0,
    currentPaginationBatchSize: RENDER_PAGE_SIZE,
    rowCache: new Map(),
    lastRenderedEntries: [],
    searchCache: new Map(),
    searchSort: "mostrecent",
    // List filters, all off
    filterText: "",
    chartViewMode: "year",
    chartSelectionMode: "year",
    chartSelectedBins: new Set<string>(),
    authorFilterEnabled: false,
    publishedOnlyFilterEnabled: false,
    quickFilters: new Set<QuickFilterType>(),
    excludeSelfCitations: false,
    // Parts that need a running Zotero or the network
    getCacheForMode: () => cache,
    getCacheKey: (key: string) => key,
    getSortOptionForMode: () => "mostrecent",
    getLocalCacheType: () => null,
    getLoadingMessageForMode: () => "Loading",
    getCountMessageForMode: (_mode: string, count: number) => `${count}`,
    getFilterCountMessageForMode: (
      _mode: string,
      visible: number,
      total: number,
    ) => `${visible} of ${total}`,
    setStatus: vi.fn(),
    setRefreshButtonLoading: vi.fn(),
    updateCacheSourceDisplay: vi.fn(),
    renderChart: vi.fn(),
    renderChartImmediate: vi.fn(),
    restoreScrollPositionIfNeeded: vi.fn(),
    updateAuthorProfileCard: vi.fn(),
    recycleRowsToPool: vi.fn(),
    createReferenceRow: (e: InspireReferenceEntry) => {
      const row = doc.createElement("div");
      row.className = "zinspire-ref-entry";
      row.dataset.entryId = e.id;
      return row;
    },
    enrichLocalStatus: vi.fn(async () => undefined),
    enrichEntries: vi.fn(async () => undefined),
    persistEnrichedCache: vi.fn(async () => undefined),
  });
  return controller;
}

function renderedIDs(controller: any): string[] {
  return Array.from(
    controller.listEl.querySelectorAll(".zinspire-ref-entry") as ArrayLike<{
      dataset: { entryId?: string };
    }>,
    (row) => row.dataset.entryId ?? "",
  );
}

type ProgressCallback = (
  entries: InspireReferenceEntry[],
  total: number | null,
) => void;
type Fetch = (onProgress: ProgressCallback) => Promise<InspireReferenceEntry[]>;

// Deliver the pages the way the INSPIRE fetches do: one growing array,
// reported after each page. `afterPage` sees the panel between pages.
function fetchPages(
  batches: InspireReferenceEntry[][],
  afterPage: (index: number) => void,
): Fetch {
  const total = batches.reduce((sum, batch) => sum + batch.length, 0);
  return async (onProgress) => {
    const loaded: InspireReferenceEntry[] = [];
    batches.forEach((batch, index) => {
      loaded.push(...batch);
      onProgress(loaded, total);
      afterPage(index);
    });
    return loaded;
  };
}

const MODES: { name: string; load: (c: any, fetch: Fetch) => Promise<void> }[] =
  [
    {
      name: "Cited by",
      load: (c, fetch) => {
        c.viewMode = "citedBy";
        c.fetchCitedBy = (
          _recid: string,
          _sort: string,
          _signal: AbortSignal,
          onProgress: ProgressCallback,
        ) => fetch(onProgress);
        return c.loadEntries("1234", "citedBy");
      },
    },
    {
      name: "author papers",
      load: (c, fetch) => {
        c.viewMode = "entryCited";
        c.entryCitedSource = AUTHOR_SOURCE;
        c.fetchAuthorPapers = (
          _info: unknown,
          _sort: string,
          _signal: AbortSignal,
          onProgress: ProgressCallback,
        ) => fetch(onProgress);
        return c.loadEntries(AUTHOR_KEY, "entryCited");
      },
    },
    {
      name: "INSPIRE search",
      load: (c, fetch) => {
        c.viewMode = "search";
        vi.spyOn(searchService, "fetchInspireSearch").mockImplementation(
          (options) => fetch(options.onProgress!),
        );
        return c.loadSearchResults("t pentaquark");
      },
    },
  ];

// Each filter with the entries it keeps.
const FILTERS: [string, (c: any) => void, string[]][] = [
  [
    "a quick filter",
    (c) => c.quickFilters.add("nonReviewOnly"),
    ["article-1", "preprint-2", "collab-2"],
  ],
  [
    "the published-only filter",
    (c) => {
      // The controller keeps this flag in step with the publishedOnly filter.
      c.quickFilters.add("publishedOnly");
      c.publishedOnlyFilterEnabled = true;
    },
    ["article-1", "review-1", "review-2", "collab-2"],
  ],
  [
    "the author-count filter",
    (c) => {
      c.authorFilterEnabled = true;
    },
    ["article-1", "review-1", "preprint-2", "review-2"],
  ],
  [
    "the text filter",
    (c) => {
      c.filterText = "hadron";
    },
    ["review-1", "review-2"],
  ],
  [
    "a chart selection",
    (c) => {
      c.chartSelectedBins = new Set(["2023", "2024", "2025"]);
    },
    ["article-1", "preprint-2", "review-2"],
  ],
];

beforeEach(() => {
  (globalThis as any).addon = { data: {} };
  (globalThis as any).Zotero = {
    debug: vi.fn(),
    Prefs: { get: vi.fn(), set: vi.fn() },
  };
});

afterEach(async () => {
  // Let the enrichment scheduled after each load finish inside its own test.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.restoreAllMocks();
});

describe.each(MODES)("$name list while loading", ({ load }) => {
  it.each(FILTERS)(
    "applies %s to the pages after the first",
    async (_name, applyFilter, kept) => {
      const controller = createController();
      applyFilter(controller);
      const batches = pages();
      const shown: string[][] = [];
      await load(
        controller,
        fetchPages(batches, () => shown.push(renderedIDs(controller))),
      );

      const firstIDs = batches[0].map((e) => e.id);
      const allIDs = batches.flat().map((e) => e.id);
      expect(shown).toEqual([
        firstIDs.filter((id) => kept.includes(id)),
        allIDs.filter((id) => kept.includes(id)),
      ]);
    },
  );

  it("filters the later pages once a quick filter is switched on mid-load", async () => {
    const controller = createController();
    controller.quickFilterCheckboxes = new Map();
    const shown: string[][] = [];
    await load(
      controller,
      fetchPages(pages(), (index) => {
        if (index === 0) {
          controller.setQuickFilterState("nonReviewOnly", true);
        }
        shown.push(renderedIDs(controller));
      }),
    );

    expect(shown).toEqual([
      ["article-1"],
      ["article-1", "preprint-2", "collab-2"],
    ]);
  });

  it("appends the later pages to the list when no filter is active", async () => {
    const controller = createController();
    const batches = pages();
    const shown: string[][] = [];
    const lists: unknown[] = [];
    await load(
      controller,
      fetchPages(batches, () => {
        shown.push(renderedIDs(controller));
        lists.push(controller.listEl);
      }),
    );

    expect(shown).toEqual([
      batches[0].map((e) => e.id),
      batches.flat().map((e) => e.id),
    ]);
    // Appended to the rendered list rather than rebuilt
    expect(lists[1]).toBe(lists[0]);
  });
});

describe("appending a loaded page to the rendered list", () => {
  it.each(FILTERS)("is refused while %s is active", (_name, applyFilter) => {
    const controller = createController();
    applyFilter(controller);
    controller.allEntries = pages().flat();
    controller.renderedCount = 2;

    expect(controller.appendNewEntries(2)).toBe(0);
    expect(renderedIDs(controller)).toEqual([]);
  });
});

// The match count replaces the plain count exactly when a filter can drop
// entries; a filter text without any search token filters nothing.
describe("status line of the rendered list", () => {
  const cases: [string, (c: any) => void, string][] = [
    ["no filter", () => undefined, "5"],
    [
      "filter text without a search token",
      (c) => {
        c.filterText = '"';
      },
      "5",
    ],
    ...FILTERS.map(
      ([name, applyFilter, kept]) =>
        [name, applyFilter, `${kept.length} of 5`] as [
          string,
          (c: any) => void,
          string,
        ],
    ),
  ];

  it.each(cases)("with %s", (_name, applyFilter, status) => {
    const controller = createController();
    applyFilter(controller);
    controller.allEntries = pages().flat();

    controller.renderReferenceList();

    expect(controller.setStatus).toHaveBeenLastCalledWith(status);
  });
});

describe("Load more while a filtered list is loading", () => {
  it("pages through the matching entries only", async () => {
    // Every second entry is a review; the second page brings enough
    // non-reviews to need "Load more".
    const all = Array.from({ length: 1200 }, (_, i) =>
      entry(`e${i}`, { documentType: [i % 2 ? "review" : "article"] }),
    );
    const nonReviews = all.filter((_, i) => i % 2 === 0).map((e) => e.id);
    const controller = createController();
    controller.quickFilters.add("nonReviewOnly");
    let afterSecondPage: string[] = [];
    let afterLoadMore: string[] = [];
    await MODES[0].load(
      controller,
      fetchPages([all.slice(0, 120), all.slice(120)], (index) => {
        if (index !== 1) return;
        afterSecondPage = renderedIDs(controller);
        (
          controller.listEl.querySelector(".zinspire-load-more-button") as {
            click(): void;
          } | null
        )?.click();
        afterLoadMore = renderedIDs(controller);
      }),
    );

    expect(afterSecondPage).toEqual(
      nonReviews.slice(0, RENDER_PAGE_SIZE_FILTERED),
    );
    expect(afterLoadMore).toEqual(nonReviews);
  });

  it("drops the previous list's entries when nothing matches", () => {
    const controller = createController();
    controller.allEntries = Array.from({ length: 150 }, (_, i) =>
      entry(`e${i}`),
    );
    controller.renderReferenceList();
    // Unfiltered, the list is paginated over its live array.
    expect(controller.currentFilteredEntries).toBe(controller.allEntries);

    controller.filterText = "no such paper";
    controller.renderReferenceList();

    expect(renderedIDs(controller)).toEqual([]);
    // "Load more" pages through this array.
    expect(controller.currentFilteredEntries).toBeUndefined();
  });
});

describe("author card while the author's papers load", () => {
  // With "non-review only": article-1 (120 citations), preprint-2 (5) and
  // collab-2 (60). Unfiltered it would be 5 papers, 565 citations, h = 5.
  const FILTERED_STATS = { paperCount: 3, totalCitations: 185, hIndex: 3 };

  function authorController() {
    const controller = createController();
    controller.viewMode = "entryCited";
    controller.entryCitedSource = AUTHOR_SOURCE;
    controller.quickFilters.add("nonReviewOnly");
    return controller;
  }

  const cacheRead = () => ({
    data: pages().flat(),
    fromCache: true as const,
    ageHours: 1,
    total: 5,
  });

  it("counts the filtered papers from the memory cache", async () => {
    const controller = authorController();
    controller.getCacheForMode().set(AUTHOR_KEY, pages().flat());

    await controller.loadEntries(AUTHOR_KEY, "entryCited");

    expect(controller.authorStats).toMatchObject(FILTERED_STATS);
  });

  it("counts the filtered papers from the local cache", async () => {
    const controller = authorController();
    controller.getLocalCacheType = () => "author";
    vi.spyOn(localCache, "get").mockResolvedValue(cacheRead());

    await controller.loadEntries(AUTHOR_KEY, "entryCited");

    expect(controller.authorStats).toMatchObject(FILTERED_STATS);
  });

  it("counts the filtered papers from INSPIRE, before and after enrichment", async () => {
    const controller = authorController();
    controller.fetchAuthorPapers = vi.fn(async () => pages().flat());

    await controller.loadEntries(AUTHOR_KEY, "entryCited");
    expect(controller.authorStats).toMatchObject(FILTERED_STATS);

    // Enrichment runs afterwards and recomputes the card.
    controller.authorStats = undefined;
    await vi.waitFor(() =>
      expect(controller.persistEnrichedCache).toHaveBeenCalled(),
    );
    expect(controller.authorStats).toMatchObject(FILTERED_STATS);
  });

  // Load the author's papers from INSPIRE and hold the enrichment that
  // follows; `finish` lets it complete, after running `change` on the list.
  async function loadWithPendingEnrichment(controller: any) {
    let finish!: (change?: (entries: InspireReferenceEntry[]) => void) => void;
    controller.enrichEntries = vi.fn(
      (entries: InspireReferenceEntry[]) =>
        new Promise<void>((resolve) => {
          finish = (change) => {
            change?.(entries);
            resolve();
          };
        }),
    );
    controller.fetchAuthorPapers = vi.fn(async () => pages().flat());
    await controller.loadEntries(AUTHOR_KEY, "entryCited");
    await vi.waitFor(() => expect(controller.enrichEntries).toHaveBeenCalled());
    return (change?: (entries: InspireReferenceEntry[]) => void) => {
      finish(change);
      return vi.waitFor(() =>
        expect(controller.persistEnrichedCache).toHaveBeenCalled(),
      );
    };
  }

  // Methods activateViewMode() calls that need the full panel UI
  function allowTabSwitch(controller: any) {
    Object.assign(controller, {
      isFavoritesViewActive: false,
      clearFocusedEntry: vi.fn(),
      requestPanelRightInsetUpdate: vi.fn(),
      updateTabSelection: vi.fn(),
      updateSearchUIVisibility: vi.fn(),
    });
  }

  it("leaves the card alone when enrichment finishes while another tab is shown", async () => {
    const controller = authorController();
    const finishEnrichment = await loadWithPendingEnrichment(controller);

    controller.viewMode = "references";
    controller.allEntries = [entry("reference", { citationCount: 7 })];
    await finishEnrichment();

    expect(controller.authorStats).toMatchObject(FILTERED_STATS);
  });

  it("keeps the next author's counts when the previous author's enrichment finishes", async () => {
    const controller = authorController();
    allowTabSwitch(controller);
    const finishEnrichment = await loadWithPendingEnrichment(controller);

    // Open another author whose papers are in the memory cache.
    controller.entryCitedSource = {
      authorQuery: "a J.Doe.1",
      authorSearchInfo: { fullName: "Doe, J.", bai: "J.Doe.1" },
      label: "J. Doe",
    };
    controller
      .getCacheForMode()
      .set("a J.Doe.1", [entry("doe-1", { citationCount: 7 })]);
    await controller.activateViewMode("entryCited");
    const doeStats = { paperCount: 1, totalCitations: 7, hIndex: 1 };
    expect(controller.authorStats).toMatchObject(doeStats);

    await finishEnrichment();

    expect(controller.authorStats).toMatchObject(doeStats);
  });

  it("recounts the card when enrichment finishes after leaving the author's tab and returning", async () => {
    const controller = authorController();
    allowTabSwitch(controller);
    const finishEnrichment = await loadWithPendingEnrichment(controller);

    // Another tab loads its list; the author's list then comes back from
    // the memory cache while enrichment is still running.
    controller.pendingToken = "references-load";
    controller.viewMode = "references";
    controller.allEntries = [entry("reference", { citationCount: 7 })];
    await controller.activateViewMode("entryCited");
    await finishEnrichment((entries) => {
      entries.find((e) => e.id === "preprint-2")!.citationCount = 50;
    });

    // article-1 (120), preprint-2 (now 50), collab-2 (60)
    expect(controller.authorStats).toMatchObject({
      paperCount: 3,
      totalCitations: 230,
      hIndex: 3,
    });
  });

  it("counts the filtered papers from a stale cache when INSPIRE fails", async () => {
    const controller = authorController();
    controller.getLocalCacheType = () => "author";
    // Nothing usable before the request (both cache lookups), a cache file
    // by the time it fails, e.g. written by a background refresh.
    vi.spyOn(localCache, "get")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(cacheRead());
    controller.fetchAuthorPapers = vi.fn(async () => {
      throw new Error("offline");
    });

    await controller.loadEntries(AUTHOR_KEY, "entryCited");

    expect(controller.authorStats).toMatchObject(FILTERED_STATS);
  });

  it("counts the filtered papers when returning to the author's tab", async () => {
    const controller = authorController();
    allowTabSwitch(controller);
    controller.viewMode = "references";
    controller.getCacheForMode().set(AUTHOR_KEY, pages().flat());

    await controller.activateViewMode("entryCited");

    expect(controller.authorStats).toMatchObject(FILTERED_STATS);
  });
});
