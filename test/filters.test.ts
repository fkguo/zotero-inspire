// ─────────────────────────────────────────────────────────────────────────────
// filters.test.ts - Unit tests for filter predicates
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  createDefaultFilterContext,
  hasArxivIdentifier,
  hasJournalInfo,
  matchesHighCitations,
  matchesRecentYears,
  matchesPublishedOnly,
  matchesPreprintOnly,
  matchesNonReviewOnly,
  matchesRelatedOnly,
  matchesLocalItems,
  matchesOnlineItems,
  matchesSmallAuthorGroup,
  getQuickFilterPredicate,
  applyQuickFilters,
  getExcludedFilters,
  type FilterContext,
} from "../src/modules/inspire/filters";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

// Helper to create a minimal entry for testing
function createEntry(
  overrides: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id: "test-id",
    recid: 12345,
    label: "1",
    title: "Test Paper",
    authors: [],
    year: "2023",
    ...overrides,
  };
}

describe("createDefaultFilterContext", () => {
  it("creates context with current year", () => {
    const ctx = createDefaultFilterContext();
    expect(ctx.currentYear).toBe(new Date().getFullYear());
  });

  it("uses default citation value getter when not provided", () => {
    const ctx = createDefaultFilterContext();
    const entry = createEntry({ citationCount: 100 });
    expect(ctx.getCitationValue(entry)).toBe(100);
  });

  it("uses custom citation value getter when provided", () => {
    const customGetter = (e: InspireReferenceEntry) =>
      (e.citationCount ?? 0) - (e.citationCountWithoutSelf ?? 0);
    const ctx = createDefaultFilterContext(customGetter);
    const entry = createEntry({
      citationCount: 100,
      citationCountWithoutSelf: 90,
    });
    expect(ctx.getCitationValue(entry)).toBe(10);
  });
});

describe("hasArxivIdentifier", () => {
  it("returns false for no arxivDetails", () => {
    const entry = createEntry({ arxivDetails: undefined });
    expect(hasArxivIdentifier(entry)).toBe(false);
  });

  it("returns true for string arxivDetails", () => {
    const entry = createEntry({ arxivDetails: "2301.12345" as unknown as any });
    expect(hasArxivIdentifier(entry)).toBe(true);
  });

  it("returns false for empty string arxivDetails", () => {
    const entry = createEntry({ arxivDetails: "  " as unknown as any });
    expect(hasArxivIdentifier(entry)).toBe(false);
  });

  it("returns true for object with id", () => {
    const entry = createEntry({
      arxivDetails: { id: "2301.12345", categories: [] },
    });
    expect(hasArxivIdentifier(entry)).toBe(true);
  });

  it("returns true for object with categories", () => {
    const entry = createEntry({
      arxivDetails: { id: "", categories: ["hep-th"] },
    });
    expect(hasArxivIdentifier(entry)).toBe(true);
  });

  it("returns false for object with empty id and no categories", () => {
    const entry = createEntry({
      arxivDetails: { id: "", categories: [] },
    });
    expect(hasArxivIdentifier(entry)).toBe(false);
  });
});

describe("hasJournalInfo", () => {
  it("returns false for no publicationInfo", () => {
    const entry = createEntry({ publicationInfo: undefined });
    expect(hasJournalInfo(entry)).toBe(false);
  });

  it("returns true for journal_title", () => {
    const entry = createEntry({
      publicationInfo: { journal_title: "Phys. Rev. D" },
    });
    expect(hasJournalInfo(entry)).toBe(true);
  });

  it("returns true for journal_title_abbrev", () => {
    const entry = createEntry({
      publicationInfo: { journal_title_abbrev: "PRD" },
    });
    expect(hasJournalInfo(entry)).toBe(true);
  });

  it("returns false for empty journal info", () => {
    const entry = createEntry({
      publicationInfo: { journal_volume: "100" },
    });
    expect(hasJournalInfo(entry)).toBe(false);
  });
});

describe("matchesHighCitations", () => {
  const ctx: FilterContext = {
    currentYear: 2024,
    getCitationValue: (e) => e.citationCount ?? 0,
  };

  it("returns false for low citations", () => {
    const entry = createEntry({ citationCount: 10 });
    expect(matchesHighCitations(entry, ctx)).toBe(false);
  });

  it("returns false for exactly threshold citations", () => {
    // HIGH_CITATIONS_THRESHOLD is 50
    const entry = createEntry({ citationCount: 50 });
    expect(matchesHighCitations(entry, ctx)).toBe(false);
  });

  it("returns true for above threshold citations", () => {
    const entry = createEntry({ citationCount: 51 });
    expect(matchesHighCitations(entry, ctx)).toBe(true);
  });

  it("returns false for undefined citations", () => {
    const entry = createEntry({ citationCount: undefined });
    expect(matchesHighCitations(entry, ctx)).toBe(false);
  });
});

describe("matchesRecentYears", () => {
  const ctx: FilterContext = {
    currentYear: 2024,
    getCitationValue: (e) => e.citationCount ?? 0,
  };

  it("matches papers from current year for 1 year filter", () => {
    const entry = createEntry({ year: "2024" });
    expect(matchesRecentYears(entry, ctx, 1)).toBe(true);
  });

  it("does not match last year for 1 year filter", () => {
    const entry = createEntry({ year: "2023" });
    expect(matchesRecentYears(entry, ctx, 1)).toBe(false);
  });

  it("matches papers from last 5 years", () => {
    expect(matchesRecentYears(createEntry({ year: "2024" }), ctx, 5)).toBe(
      true,
    );
    expect(matchesRecentYears(createEntry({ year: "2023" }), ctx, 5)).toBe(
      true,
    );
    expect(matchesRecentYears(createEntry({ year: "2020" }), ctx, 5)).toBe(
      true,
    );
    expect(matchesRecentYears(createEntry({ year: "2019" }), ctx, 5)).toBe(
      false,
    );
  });

  it("returns false for invalid year", () => {
    const entry = createEntry({ year: "invalid" });
    expect(matchesRecentYears(entry, ctx, 5)).toBe(false);
  });

  it("returns false for undefined year", () => {
    const entry = createEntry({ year: undefined });
    expect(matchesRecentYears(entry, ctx, 5)).toBe(false);
  });

  it("handles edge case of years = 0 (normalized to 1)", () => {
    const entry = createEntry({ year: "2024" });
    expect(matchesRecentYears(entry, ctx, 0)).toBe(true);
  });
});

describe("matchesPublishedOnly", () => {
  it("returns true for published papers", () => {
    const entry = createEntry({
      publicationInfo: { journal_title: "Phys. Rev. D" },
    });
    expect(matchesPublishedOnly(entry)).toBe(true);
  });

  it("returns false for preprints", () => {
    const entry = createEntry({ publicationInfo: undefined });
    expect(matchesPublishedOnly(entry)).toBe(false);
  });
});

describe("matchesPreprintOnly", () => {
  it("returns true for arXiv-only papers", () => {
    const entry = createEntry({
      arxivDetails: { id: "2301.12345", categories: ["hep-th"] },
      publicationInfo: undefined,
    });
    expect(matchesPreprintOnly(entry)).toBe(true);
  });

  it("returns false for published papers", () => {
    const entry = createEntry({
      arxivDetails: { id: "2301.12345", categories: ["hep-th"] },
      publicationInfo: { journal_title: "Phys. Rev. D" },
    });
    expect(matchesPreprintOnly(entry)).toBe(false);
  });

  it("returns false for papers without arXiv", () => {
    const entry = createEntry({
      arxivDetails: undefined,
      publicationInfo: undefined,
    });
    expect(matchesPreprintOnly(entry)).toBe(false);
  });
});

describe("matchesNonReviewOnly", () => {
  it("returns false for review document type", () => {
    const entry = createEntry({ documentType: ["review"] });
    expect(matchesNonReviewOnly(entry)).toBe(false);
  });

  it("returns true for non-review document type", () => {
    const entry = createEntry({ documentType: ["article"] });
    expect(matchesNonReviewOnly(entry)).toBe(true);
  });

  it("returns false for major review journals even when documentType is missing", () => {
    const entry = createEntry({
      documentType: undefined,
      publicationInfo: { journal_title: "Rev. Mod. Phys." },
    });
    expect(matchesNonReviewOnly(entry)).toBe(false);
  });

  it("returns false for Annual Review journals", () => {
    const entry = createEntry({
      documentType: undefined,
      publicationInfo: { journal_title: "Annual Review of Nuclear and Particle Science" },
    });
    expect(matchesNonReviewOnly(entry)).toBe(false);
  });

  it("returns false for Phys. Rep. abbreviation", () => {
    const entry = createEntry({
      documentType: undefined,
      publicationInfo: { journal_title_abbrev: "Phys. Rep." },
    });
    expect(matchesNonReviewOnly(entry)).toBe(false);
  });

  it("returns true when documentType is missing", () => {
    const entry = createEntry({ documentType: undefined });
    expect(matchesNonReviewOnly(entry)).toBe(true);
  });
});

describe("matchesRelatedOnly", () => {
  it("returns true for related papers", () => {
    const entry = createEntry({ isRelated: true });
    expect(matchesRelatedOnly(entry)).toBe(true);
  });

  it("returns false for non-related papers", () => {
    const entry = createEntry({ isRelated: false });
    expect(matchesRelatedOnly(entry)).toBe(false);
  });

  it("returns false for undefined isRelated", () => {
    const entry = createEntry({ isRelated: undefined });
    expect(matchesRelatedOnly(entry)).toBe(false);
  });
});

describe("matchesLocalItems", () => {
  it("returns true for positive localItemID", () => {
    const entry = createEntry({ localItemID: 123 });
    expect(matchesLocalItems(entry)).toBe(true);
  });

  it("returns false for zero localItemID", () => {
    const entry = createEntry({ localItemID: 0 });
    expect(matchesLocalItems(entry)).toBe(false);
  });

  it("returns false for undefined localItemID", () => {
    const entry = createEntry({ localItemID: undefined });
    expect(matchesLocalItems(entry)).toBe(false);
  });
});

describe("matchesOnlineItems", () => {
  it("returns false for positive localItemID", () => {
    const entry = createEntry({ localItemID: 123 });
    expect(matchesOnlineItems(entry)).toBe(false);
  });

  it("returns true for zero localItemID", () => {
    const entry = createEntry({ localItemID: 0 });
    expect(matchesOnlineItems(entry)).toBe(true);
  });

  it("returns true for undefined localItemID", () => {
    const entry = createEntry({ localItemID: undefined });
    expect(matchesOnlineItems(entry)).toBe(true);
  });
});

describe("matchesSmallAuthorGroup", () => {
  it("returns true for small author group", () => {
    const entry = createEntry({
      totalAuthors: 5,
      authors: [],
    });
    expect(matchesSmallAuthorGroup(entry)).toBe(true);
  });

  it("returns true for exactly threshold authors", () => {
    // SMALL_AUTHOR_GROUP_THRESHOLD is 10
    const entry = createEntry({ totalAuthors: 10 });
    expect(matchesSmallAuthorGroup(entry)).toBe(true);
  });

  it("returns false for large collaboration", () => {
    const entry = createEntry({ totalAuthors: 100 });
    expect(matchesSmallAuthorGroup(entry)).toBe(false);
  });

  it("returns false for zero authors", () => {
    const entry = createEntry({ totalAuthors: 0 });
    expect(matchesSmallAuthorGroup(entry)).toBe(false);
  });

  it("falls back to authors array length", () => {
    const entry = createEntry({
      totalAuthors: undefined,
      authors: [{ name: "A" }, { name: "B" }, { name: "C" }],
    });
    expect(matchesSmallAuthorGroup(entry)).toBe(true);
  });
});

describe("getQuickFilterPredicate", () => {
  it("returns predicate for known filter types", () => {
    expect(getQuickFilterPredicate("highCitations")).toBeDefined();
    expect(getQuickFilterPredicate("recent5Years")).toBeDefined();
    expect(getQuickFilterPredicate("recent1Year")).toBeDefined();
    expect(getQuickFilterPredicate("nonReviewOnly")).toBeDefined();
    expect(getQuickFilterPredicate("publishedOnly")).toBeDefined();
    expect(getQuickFilterPredicate("preprintOnly")).toBeDefined();
    expect(getQuickFilterPredicate("relatedOnly")).toBeDefined();
    expect(getQuickFilterPredicate("localItems")).toBeDefined();
    expect(getQuickFilterPredicate("onlineItems")).toBeDefined();
  });

  it("returns undefined for unknown filter type", () => {
    expect(getQuickFilterPredicate("unknown" as any)).toBeUndefined();
  });
});

describe("applyQuickFilters", () => {
  const ctx: FilterContext = {
    currentYear: 2024,
    getCitationValue: (e) => e.citationCount ?? 0,
  };

  it("returns true when no filters active", () => {
    const entry = createEntry();
    expect(applyQuickFilters(entry, new Set(), ctx)).toBe(true);
  });

  it("applies single filter", () => {
    const highCiteEntry = createEntry({ citationCount: 100 });
    const lowCiteEntry = createEntry({ citationCount: 10 });

    expect(
      applyQuickFilters(highCiteEntry, new Set(["highCitations"]), ctx),
    ).toBe(true);
    expect(
      applyQuickFilters(lowCiteEntry, new Set(["highCitations"]), ctx),
    ).toBe(false);
  });

  it("applies multiple filters with AND logic", () => {
    const entry = createEntry({
      citationCount: 100,
      year: "2024",
      publicationInfo: { journal_title: "Phys. Rev. D" },
    });

    expect(
      applyQuickFilters(
        entry,
        new Set(["highCitations", "recent1Year", "publishedOnly"]),
        ctx,
      ),
    ).toBe(true);
  });

  it("returns false if any filter fails", () => {
    const entry = createEntry({
      citationCount: 100,
      year: "2020", // Not recent
      publicationInfo: { journal_title: "Phys. Rev. D" },
    });

    expect(
      applyQuickFilters(entry, new Set(["highCitations", "recent1Year"]), ctx),
    ).toBe(false);
  });
});

describe("getExcludedFilters", () => {
  it("returns exclusions for publishedOnly", () => {
    expect(getExcludedFilters("publishedOnly")).toEqual(["preprintOnly"]);
  });

  it("returns exclusions for preprintOnly", () => {
    expect(getExcludedFilters("preprintOnly")).toEqual(["publishedOnly"]);
  });

  it("returns exclusions for recent5Years", () => {
    expect(getExcludedFilters("recent5Years")).toEqual(["recent1Year"]);
  });

  it("returns exclusions for recent1Year", () => {
    expect(getExcludedFilters("recent1Year")).toEqual(["recent5Years"]);
  });

  it("returns exclusions for localItems", () => {
    expect(getExcludedFilters("localItems")).toEqual(["onlineItems"]);
  });

  it("returns exclusions for onlineItems", () => {
    expect(getExcludedFilters("onlineItems")).toEqual(["localItems"]);
  });

  it("returns empty array for highCitations", () => {
    expect(getExcludedFilters("highCitations")).toEqual([]);
  });

  it("returns empty array for relatedOnly", () => {
    expect(getExcludedFilters("relatedOnly")).toEqual([]);
  });

  it("returns empty array for nonReviewOnly", () => {
    expect(getExcludedFilters("nonReviewOnly")).toEqual([]);
  });
});
