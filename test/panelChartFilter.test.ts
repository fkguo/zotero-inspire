// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

// When no entry has a usable year, the year chart falls back to citation bins
// while the chosen view mode stays "year". Clicking a bar must then filter by
// the bins that were drawn; getFilteredEntries() is what the list shows.

const doc = globalThis.document;
const win = globalThis.window;

// Undated entries carry the localised "year unknown" string ("n.d.").
const UNDATED = "n.d.";
const CITATION_KEYS = [
  "0",
  "1-9",
  "10-49",
  "50-99",
  "100-249",
  "250-499",
  "500+",
];

function entry(
  id: string,
  fields: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id,
    title: id,
    year: UNDATED,
    authors: [],
    authorText: "",
    displayText: "",
    searchText: id,
    ...fields,
  };
}

function createController(entries: InspireReferenceEntry[]) {
  const controller = Object.create(
    InspireReferencePanelController.prototype,
  ) as any;
  Object.assign(controller, {
    body: doc.createElement("div"),
    chartSvgWrapper: doc.createElement("div"),
    chartStatsTopLine: doc.createElement("div"),
    chartStatsBottomLine: doc.createElement("div"),
    chartCollapsed: false,
    chartViewMode: "year",
    chartSelectionMode: "year",
    chartSelectedBins: new Set<string>(),
    lastChartRenderTime: 0,
    allEntries: entries,
    filterText: "",
    authorFilterEnabled: false,
    publishedOnlyFilterEnabled: false,
    quickFilters: new Set(),
    quickFilterCheckboxes: new Map(),
    excludeSelfCitations: false,
    renderReferenceList: vi.fn(),
  });
  return controller;
}

function drawnKeys(controller: any): string[] {
  return Array.from(
    controller.chartSvgWrapper.querySelectorAll(
      ".zinspire-chart-bar-group",
    ) as NodeListOf<Element>,
    (group) => group.getAttribute("data-key") ?? "",
  );
}

// Click a bar on screen without running the chart redraw that follows.
function pressBar(controller: any, key: string, init: MouseEventInit = {}) {
  const bar = controller.chartSvgWrapper.querySelector(
    `.zinspire-chart-bar-group[data-key="${key}"] rect`,
  ) as Element | null;
  expect(bar, `bar ${key}`).not.toBeNull();
  const listRefreshes = controller.renderReferenceList.mock.calls.length;
  bar!.dispatchEvent(new win.MouseEvent("click", { bubbles: true, ...init }));
  expect(controller.renderReferenceList).toHaveBeenCalledTimes(
    listRefreshes + 1,
  );
}

function clickBar(controller: any, key: string, init: MouseEventInit = {}) {
  pressBar(controller, key, init);
  // Run the deferred chart redraw that follows the list refresh.
  vi.runAllTimers();
}

function listedIDs(controller: any): string[] {
  return controller
    .getFilteredEntries(controller.allEntries)
    .map((e: InspireReferenceEntry) => e.id);
}

function headerSummary(controller: any): string[] {
  return [
    controller.chartStatsTopLine.textContent,
    controller.chartStatsBottomLine.textContent,
  ];
}

describe("References panel chart filter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).addon = { data: {} };
    (globalThis as any).Zotero = {
      debug: vi.fn(),
      Prefs: { get: vi.fn(), set: vi.fn() },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).addon;
    delete (globalThis as any).Zotero;
  });

  it("filters by the clicked citation bar when the year chart falls back to citation bins", () => {
    const controller = createController([
      entry("uncited"),
      entry("few", { citationCount: 3 }),
      entry("some", { citationCount: 7 }),
      entry("many", { citationCount: 120 }),
    ]);
    controller.renderChartImmediate();
    expect(drawnKeys(controller)).toEqual(CITATION_KEYS);

    clickBar(controller, "1-9");

    expect(listedIDs(controller)).toEqual(["few", "some"]);
    expect(controller.chartViewMode).toBe("year");
  });

  it("shift-click selects a range of the drawn citation bins", () => {
    const controller = createController([
      entry("uncited"),
      entry("few", { citationCount: 3 }),
      entry("some", { citationCount: 30 }),
      entry("many", { citationCount: 120 }),
    ]);
    controller.renderChartImmediate();

    clickBar(controller, "0");
    clickBar(controller, "10-49", { shiftKey: true });

    expect(Array.from(controller.chartSelectedBins)).toEqual([
      "0",
      "1-9",
      "10-49",
    ]);
    expect(listedIDs(controller)).toEqual(["uncited", "few", "some"]);
  });

  describe("selecting bars by mouse", () => {
    const setup = () => {
      const controller = createController([
        entry("uncited"),
        entry("few", { citationCount: 3 }),
        entry("some", { citationCount: 30 }),
        entry("many", { citationCount: 120 }),
      ]);
      controller.renderChartImmediate();
      return controller;
    };
    const selected = (controller: any) =>
      Array.from(controller.chartSelectedBins as Set<string>).sort();

    it("selects only the clicked bar, and clears it when clicked again", () => {
      const controller = setup();
      clickBar(controller, "1-9");
      clickBar(controller, "10-49");
      expect(selected(controller)).toEqual(["10-49"]);
      clickBar(controller, "10-49");
      expect(selected(controller)).toEqual([]);
    });

    it("adds and removes bars with Ctrl+click and Cmd+click", () => {
      const controller = setup();
      clickBar(controller, "0");
      clickBar(controller, "10-49", { ctrlKey: true });
      clickBar(controller, "100-249", { metaKey: true });
      expect(selected(controller)).toEqual(["0", "10-49", "100-249"]);
      clickBar(controller, "0", { metaKey: true });
      clickBar(controller, "100-249", { ctrlKey: true });
      expect(selected(controller)).toEqual(["10-49"]);
    });

    it("selects the bars from the last clicked one with Shift+click, in either direction", () => {
      const controller = setup();
      clickBar(controller, "50-99");
      clickBar(controller, "1-9", { shiftKey: true });
      expect(selected(controller)).toEqual(["1-9", "10-49", "50-99"]);
      // The range replaces the selection: the bars outside it go
      clickBar(controller, "500+", { ctrlKey: true });
      clickBar(controller, "100-249", { shiftKey: true });
      expect(selected(controller)).toEqual(["100-249", "250-499", "500+"]);
      clickBar(controller, "500+");
      clickBar(controller, "250-499", { shiftKey: true });
      expect(selected(controller)).toEqual(["250-499", "500+"]);
    });

    it("adds the range to the selection with Shift+Ctrl/Cmd+click", () => {
      const controller = setup();
      clickBar(controller, "0");
      clickBar(controller, "50-99", { metaKey: true });
      clickBar(controller, "250-499", { shiftKey: true, metaKey: true });
      expect(selected(controller)).toEqual([
        "0",
        "100-249",
        "250-499",
        "50-99",
      ]);
      clickBar(controller, "500+", { ctrlKey: true });
      clickBar(controller, "1-9", { shiftKey: true, ctrlKey: true });
      expect(selected(controller).length).toBe(CITATION_KEYS.length);
    });

    it("selects only the clicked bar with Shift+click when nothing is selected", () => {
      const controller = setup();
      clickBar(controller, "10-49");
      clickBar(controller, "10-49");
      clickBar(controller, "250-499", { shiftKey: true });
      expect(selected(controller)).toEqual(["250-499"]);
    });
  });

  it("keeps the citation bar and shift-click ranges working right after a quick filter change", () => {
    const controller = createController([
      entry("uncited"),
      entry("uncitedLocal", { localItemID: 7 }),
      entry("few", { citationCount: 3 }),
      entry("some", { citationCount: 30 }),
    ]);
    controller.renderChartImmediate();
    clickBar(controller, "0");
    expect(listedIDs(controller)).toEqual(["uncited", "uncitedLocal"]);

    // The list refreshes at once; the chart is redrawn only afterwards.
    controller.setQuickFilterState("onlineItems", true, { skipPersist: true });
    expect(listedIDs(controller)).toEqual(["uncited"]);

    // Shift-click a bar still on screen, before that redraw.
    clickBar(controller, "10-49", { shiftKey: true });

    expect(Array.from(controller.chartSelectedBins)).toEqual([
      "0",
      "1-9",
      "10-49",
    ]);
    expect(listedIDs(controller)).toEqual(["uncited", "few", "some"]);
  });

  it("shift-click ranges follow the bars still on screen after all filters are cleared", () => {
    const controller = createController([
      entry("uncited"),
      entry("few", { citationCount: 3 }),
      entry("some", { citationCount: 30 }),
    ]);
    controller.renderChartImmediate();
    controller.setQuickFilterState("onlineItems", true, { skipPersist: true });
    vi.runAllTimers();

    controller.clearAllFilters();
    // Both clicks land before the deferred chart redraw.
    pressBar(controller, "0", { shiftKey: true });
    pressBar(controller, "10-49", { shiftKey: true });

    expect(Array.from(controller.chartSelectedBins)).toEqual([
      "0",
      "1-9",
      "10-49",
    ]);
    expect(listedIDs(controller)).toEqual(["uncited", "few", "some"]);
  });

  it("starts a new shift-click range after the view is switched", () => {
    const controller = createController([
      entry("uncited"),
      entry("few", { citationCount: 3 }),
      entry("some", { citationCount: 30 }),
    ]);
    controller.renderChartImmediate();
    clickBar(controller, "0");

    controller.toggleChartView("citation");
    vi.runAllTimers();
    expect(drawnKeys(controller)).toEqual(CITATION_KEYS);
    clickBar(controller, "10-49", { shiftKey: true });

    expect(Array.from(controller.chartSelectedBins)).toEqual(["10-49"]);
    expect(listedIDs(controller)).toEqual(["some"]);
  });

  it("summarises the bins that were drawn in the chart header", () => {
    const controller = createController([
      entry("uncited", { searchText: "undated" }),
      entry("few", { citationCount: 3, searchText: "undated" }),
      entry("cited2020", {
        year: "2020",
        citationCount: 7,
        searchText: "published",
      }),
    ]);
    controller.filterText = "undated";
    controller.renderChartImmediate();
    expect(drawnKeys(controller)).toEqual(CITATION_KEYS);
    expect(headerSummary(controller)).toEqual(["3 citations", "h=1 · avg 1.5"]);

    controller.filterText = "";
    controller.renderChartImmediate();
    expect(drawnKeys(controller)).toEqual(["2020"]);
    expect(headerSummary(controller)).toEqual(["3 papers", ""]);
  });

  it("clears the chart header summary while no bars are drawn", () => {
    const controller = createController([
      entry("uncited"),
      entry("few", { citationCount: 3 }),
    ]);
    controller.renderChartImmediate();
    expect(headerSummary(controller)).toEqual(["3 citations", "h=1 · avg 1.5"]);

    controller.renderChartLoading();
    expect(headerSummary(controller)).toEqual(["", ""]);

    controller.renderChartImmediate();
    expect(headerSummary(controller)).toEqual(["3 citations", "h=1 · avg 1.5"]);
    // No entry is in the local library, so this quick filter leaves none.
    controller.setQuickFilterState("localItems", true, { skipPersist: true });
    vi.runAllTimers();
    expect(drawnKeys(controller)).toEqual([]);
    expect(headerSummary(controller)).toEqual(["", ""]);
  });

  it("keeps a citation selection when year bins are drawn again, until a year bar is clicked", () => {
    const controller = createController([
      entry("uncited", { searchText: "undated" }),
      entry("few", { citationCount: 5, searchText: "undated" }),
      entry("uncited2020", { year: "2020", searchText: "published" }),
      entry("cited2021", {
        year: "2021",
        citationCount: 7,
        searchText: "published",
      }),
    ]);
    controller.filterText = "undated";
    controller.renderChartImmediate();
    expect(drawnKeys(controller)).toEqual(CITATION_KEYS);
    clickBar(controller, "0");
    expect(listedIDs(controller)).toEqual(["uncited"]);

    controller.filterText = "";
    controller.renderChartImmediate();
    expect(drawnKeys(controller)).toEqual(["2020", "2021"]);
    // The selected bar still means "0 citations".
    expect(listedIDs(controller)).toEqual(["uncited", "uncited2020"]);

    clickBar(controller, "2021", { ctrlKey: true });

    expect(Array.from(controller.chartSelectedBins)).toEqual(["2021"]);
    expect(listedIDs(controller)).toEqual(["cited2021"]);
  });
});
