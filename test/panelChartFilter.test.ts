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

function clickBar(controller: any, key: string, init: MouseEventInit = {}) {
  const bar = controller.chartSvgWrapper.querySelector(
    `.zinspire-chart-bar-group[data-key="${key}"] rect`,
  ) as Element | null;
  expect(bar, `bar ${key}`).not.toBeNull();
  const listRefreshes = controller.renderReferenceList.mock.calls.length;
  bar!.dispatchEvent(new win.MouseEvent("click", { bubbles: true, ...init }));
  expect(controller.renderReferenceList).toHaveBeenCalledTimes(
    listRefreshes + 1,
  );
  // Run the deferred chart redraw that follows the list refresh.
  vi.runAllTimers();
}

function listedIDs(controller: any): string[] {
  return controller
    .getFilteredEntries(controller.allEntries)
    .map((e: InspireReferenceEntry) => e.id);
}

describe("References panel chart filter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).Zotero = { debug: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("keeps filtering by the citation bar after a quick filter clears the cached bins", () => {
    const controller = createController([
      entry("uncited"),
      entry("uncitedLocal", { localItemID: 7 }),
      entry("few", { citationCount: 3 }),
    ]);
    controller.renderChartImmediate();
    clickBar(controller, "0");
    expect(listedIDs(controller)).toEqual(["uncited", "uncitedLocal"]);

    // The list refreshes before the deferred chart redraw caches the bins again.
    controller.setQuickFilterState("onlineItems", true, { skipPersist: true });

    expect(controller.cachedChartStats).toBeUndefined();
    expect(listedIDs(controller)).toEqual(["uncited"]);
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
