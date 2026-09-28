import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import {
  QUICK_FILTER_CONFIGS,
  QUICK_FILTER_TYPES,
  type QuickFilterType,
} from "../src/modules/inspire/constants";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

// Quick filters as the References panel applies them: getFilteredEntries() is
// the pipeline shared by the list and the chart, so a filter offered in the
// popup but ignored by the panel shows up here.

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

// The current year is pinned to 2026 in beforeEach.
const ENTRIES: InspireReferenceEntry[] = [
  entry("reviewByType", {
    documentType: ["review"],
    publicationInfo: { journal_title: "Phys. Rev. D" },
    arxivDetails: { id: "2601.00001", categories: ["hep-ph"] },
    year: "2026",
    citationCount: 200,
    citationCountWithoutSelf: 150,
    localItemID: 3,
  }),
  entry("reviewByJournal", {
    documentType: ["article"],
    publicationInfo: { journal_title: "Phys. Rept." },
    year: "2025",
    citationCount: 10,
  }),
  entry("article", {
    documentType: ["article"],
    publicationInfo: { journal_title: "Phys. Lett. B" },
    arxivDetails: { id: "2602.00002", categories: ["hep-ph"] },
    year: "2026",
    citationCount: 120,
    citationCountWithoutSelf: 30,
  }),
  entry("preprint", {
    documentType: ["article"],
    arxivDetails: { id: "2301.00003", categories: ["hep-th"] },
    year: "2023",
    citationCountWithoutSelf: 80,
    localItemID: 9,
  }),
  entry("bare", { year: "n.d." }),
  entry("oldPublished", {
    documentType: ["article"],
    publicationInfo: { journal_title: "Nucl. Phys. B" },
    year: "2010",
    citationCount: 51,
    citationCountWithoutSelf: 51,
    localItemID: 0,
  }),
];

// Entries each quick filter keeps on its own (self-citations included).
const EXPECTED: Record<QuickFilterType, string[]> = {
  highCitations: ["reviewByType", "article", "preprint", "oldPublished"],
  recent5Years: ["reviewByType", "reviewByJournal", "article", "preprint"],
  recent1Year: ["reviewByType", "article"],
  nonReviewOnly: ["article", "preprint", "bare", "oldPublished"],
  publishedOnly: ["reviewByType", "reviewByJournal", "article", "oldPublished"],
  preprintOnly: ["preprint"],
  // The item shown is related to the item of reviewByType (item 3); the
  // paper oldPublished has no item, so it cannot be related to any
  relatedOnly: ["reviewByType"],
  localItems: ["reviewByType", "preprint"],
  onlineItems: ["reviewByJournal", "article", "bare", "oldPublished"],
};

function visibleIDs(
  filters: QuickFilterType[],
  excludeSelfCitations = false,
): string[] {
  const controller = Object.create(
    InspireReferencePanelController.prototype,
  ) as any;
  Object.assign(controller, {
    currentItemID: 1,
    filterText: "",
    chartSelectedBins: new Set<string>(),
    authorFilterEnabled: false,
    // The controller keeps this flag in step with the publishedOnly filter.
    publishedOnlyFilterEnabled: filters.includes("publishedOnly"),
    quickFilters: new Set(filters),
    excludeSelfCitations,
  });
  return controller
    .getFilteredEntries(ENTRIES)
    .map((e: InspireReferenceEntry) => e.id);
}

describe("References panel quick filters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15));
    // The item shown (1) is related to item 3
    const items: Record<number, object> = {
      1: { id: 1, key: "KEY1", libraryID: 1, relatedItems: ["KEY3"] },
      3: { id: 3, key: "KEY3", libraryID: 1, relatedItems: ["KEY1"] },
      9: { id: 9, key: "KEY9", libraryID: 1, relatedItems: [] },
    };
    vi.stubGlobal("Zotero", { Items: { get: (id: number) => items[id] } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("covers every quick filter offered in the popup", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      [...QUICK_FILTER_TYPES].sort(),
    );
    for (const { type } of QUICK_FILTER_CONFIGS) {
      expect(EXPECTED).toHaveProperty(type);
    }
  });

  it("keeps every entry when no quick filter is active", () => {
    expect(visibleIDs([])).toEqual(ENTRIES.map((e) => e.id));
  });

  it.each(Object.entries(EXPECTED))(
    "%s keeps only the matching entries",
    (filter, ids) => {
      expect(visibleIDs([filter as QuickFilterType])).toEqual(ids);
    },
  );

  it("hides review articles when nonReviewOnly is combined with other filters", () => {
    expect(visibleIDs(["nonReviewOnly", "highCitations"])).toEqual([
      "article",
      "preprint",
      "oldPublished",
    ]);
    expect(visibleIDs(["nonReviewOnly", "recent1Year"])).toEqual(["article"]);
  });

  it("counts citations without self-citations when that toggle is on", () => {
    expect(visibleIDs(["highCitations"], true)).toEqual([
      "reviewByType",
      "preprint",
      "oldPublished",
    ]);
  });
});
