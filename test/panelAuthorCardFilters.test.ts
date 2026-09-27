import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import {
  FILTER_DEBOUNCE_MS,
  RENDER_PAGE_SIZE,
  type QuickFilterType,
} from "../src/modules/inspire/constants";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

// The author card on an author's papers tab counts the papers the list
// filters keep (every filter but the chart selection). Clearing the filters
// or typing in the filter box must recount it, as the filter toggles do.
// The list is rendered into jsdom; only what needs a running Zotero (row and
// card markup, chart) is stubbed.

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

function papers(): InspireReferenceEntry[] {
  return [
    entry("article-1", {
      displayText: "Hidden-charm pentaquarks",
      documentType: ["article"],
      citationCount: 120,
    }),
    entry("review-1", {
      displayText: "Hadronic molecules",
      documentType: ["review"],
      citationCount: 300,
    }),
    entry("preprint-2", {
      displayText: "Pentaquark line shapes",
      documentType: ["article"],
      citationCount: 5,
    }),
    entry("review-2", {
      displayText: "Exotic hadrons",
      documentType: ["review"],
      citationCount: 80,
    }),
    entry("collab-2", {
      displayText: "Observation of pentaquark states",
      documentType: ["article"],
      citationCount: 60,
    }),
  ];
}

const ALL_IDS = papers().map((e) => e.id);
const ALL_STATS = { paperCount: 5, totalCitations: 565, hIndex: 5 };
// article-1 (120), preprint-2 (5), collab-2 (60)
const NON_REVIEW_STATS = { paperCount: 3, totalCitations: 185, hIndex: 3 };
// review-1 (300), review-2 (80)
const HADRON_STATS = { paperCount: 2, totalCitations: 380, hIndex: 2 };

// An author's papers tab once its list has loaded, the card counted for the
// quick filters given.
function authorTab(quickFilters: QuickFilterType[] = []): any {
  const dom = new JSDOM(
    '<div class="item-pane-content"><div class="panel"><div class="list"></div></div></div>',
  );
  const doc = dom.window.document;
  const controller = Object.create(
    InspireReferencePanelController.prototype,
  ) as any;
  Object.assign(controller, {
    body: doc.querySelector(".panel"),
    listEl: doc.querySelector(".list"),
    viewMode: "entryCited",
    entryCitedSource: {
      authorQuery: "a F.K.Guo.1",
      authorSearchInfo: { fullName: "Guo, Feng-Kun", bai: "F.K.Guo.1" },
      label: "Feng-Kun Guo",
    },
    isFavoritesViewActive: false,
    allEntries: papers(),
    totalApiCount: null,
    renderedCount: 0,
    currentPaginationBatchSize: RENDER_PAGE_SIZE,
    rowCache: new Map(),
    lastRenderedEntries: [],
    filterDebounceDelay: FILTER_DEBOUNCE_MS,
    // List filters
    filterText: "",
    chartViewMode: "year",
    chartSelectedBins: new Set<string>(),
    authorFilterEnabled: false,
    // The controller keeps this flag in step with the publishedOnly filter.
    publishedOnlyFilterEnabled: quickFilters.includes("publishedOnly"),
    quickFilters: new Set(quickFilters),
    quickFilterCheckboxes: new Map(),
    excludeSelfCitations: false,
    // Parts that need a running Zotero
    getCountMessageForMode: (_mode: string, count: number) => `${count}`,
    getFilterCountMessageForMode: (
      _mode: string,
      visible: number,
      total: number,
    ) => `${visible} of ${total}`,
    setStatus: vi.fn(),
    renderChart: vi.fn(),
    recycleRowsToPool: vi.fn(),
    createReferenceRow: (e: InspireReferenceEntry) => {
      const row = doc.createElement("div");
      row.className = "zinspire-ref-entry";
      row.dataset.entryId = e.id;
      return row;
    },
    renderFavoriteAuthorsList: vi.fn(),
    // The card is drawn from authorStats; keep the counts it shows.
    updateAuthorProfileCard: vi.fn(() => {
      controller.cardCounts = controller.authorStats && {
        ...controller.authorStats,
      };
    }),
  });
  controller.renderReferenceList();
  controller.updateAuthorStats(controller.getEntriesForAuthorStats());
  controller.updateAuthorProfileCard();
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

function typeFilterText(controller: any, text: string) {
  controller.handleFilterInputChange(text);
  vi.advanceTimersByTime(FILTER_DEBOUNCE_MS);
}

beforeEach(() => {
  (globalThis as any).addon = { data: {} };
  (globalThis as any).Zotero = {
    debug: vi.fn(),
    Prefs: { get: vi.fn(), set: vi.fn() },
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("author card when the list filters change", () => {
  it("counts every paper again once the filters are cleared", () => {
    const controller = authorTab(["nonReviewOnly"]);
    expect(controller.cardCounts).toMatchObject(NON_REVIEW_STATS);

    controller.clearAllFilters();

    expect(renderedIDs(controller)).toEqual(ALL_IDS);
    expect(controller.cardCounts).toMatchObject(ALL_STATS);
  });

  it("counts the papers matching the filter text once typing pauses", () => {
    const controller = authorTab();
    expect(controller.cardCounts).toMatchObject(ALL_STATS);

    typeFilterText(controller, "hadron");

    expect(renderedIDs(controller)).toEqual(["review-1", "review-2"]);
    expect(controller.cardCounts).toMatchObject(HADRON_STATS);
  });

  // The card counts the author's papers only; returning to the author's tab
  // recounts it.
  it.each([
    ["the filters are cleared", (c: any) => c.clearAllFilters()],
    ["filter text is typed", (c: any) => typeFilterText(c, "hadron")],
  ])("is left alone when %s on another tab", (_name, change) => {
    const controller = authorTab(["nonReviewOnly"]);
    controller.viewMode = "citedBy";
    controller.allEntries = [
      entry("citing-1", {
        displayText: "Hadron spectroscopy",
        citationCount: 7,
      }),
    ];
    controller.renderReferenceList();
    const list = controller.listEl;
    controller.updateAuthorProfileCard.mockClear();

    change(controller);

    // That tab's list is rendered again; the author's card is not recounted.
    expect(controller.listEl).not.toBe(list);
    expect(renderedIDs(controller)).toEqual(["citing-1"]);
    expect(controller.authorStats).toMatchObject(NON_REVIEW_STATS);
    expect(controller.updateAuthorProfileCard).not.toHaveBeenCalled();
  });

  it("is left alone when filter text narrows the favorites", () => {
    const controller = authorTab();
    Object.assign(controller, {
      favoritesTabButton: controller.body.ownerDocument.createElement("button"),
      updateTabSelection: vi.fn(),
    });
    controller.showFavoritesList();
    const renderReferenceList = vi.spyOn(controller, "renderReferenceList");
    controller.renderFavoriteAuthorsList.mockClear();
    controller.updateAuthorProfileCard.mockClear();

    typeFilterText(controller, "guo");

    expect(controller.renderFavoriteAuthorsList).toHaveBeenCalledTimes(1);
    expect(renderReferenceList).not.toHaveBeenCalled();
    expect(controller.updateAuthorProfileCard).not.toHaveBeenCalled();
  });
});
