// ─────────────────────────────────────────────────────────────────────────────
// Quick Filter Predicates and Configuration
// ─────────────────────────────────────────────────────────────────────────────
// This module consolidates filter predicates for Quick Filters, making them
// reusable and testable. The filter configurations are already defined in
// constants.ts (QUICK_FILTER_CONFIGS), this module provides the predicate
// functions.

import {
  HIGH_CITATIONS_THRESHOLD,
  SMALL_AUTHOR_GROUP_THRESHOLD,
  type QuickFilterType,
} from "./constants";
import { isReviewArticleEntry } from "./reviewUtils";
import type { InspireReferenceEntry, InspireArxivDetails } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Filter Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context data available to filter predicates.
 * Provides access to runtime information needed for filtering.
 */
export interface FilterContext {
  currentYear: number;
  /** Function to get citation value (handles self-citation exclusion) */
  getCitationValue: (entry: InspireReferenceEntry) => number;
}

/**
 * Create a default filter context.
 */
export function createDefaultFilterContext(
  getCitationValue?: (entry: InspireReferenceEntry) => number,
): FilterContext {
  return {
    currentYear: new Date().getFullYear(),
    getCitationValue: getCitationValue ?? ((entry) => entry.citationCount ?? 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if entry has arXiv identifier.
 */
export function hasArxivIdentifier(entry: InspireReferenceEntry): boolean {
  const arxivDetails = entry.arxivDetails;
  if (!arxivDetails) {
    return false;
  }
  if (typeof arxivDetails === "string") {
    return arxivDetails.trim().length > 0;
  }
  if (typeof arxivDetails === "object") {
    const details = arxivDetails as InspireArxivDetails;
    if (typeof details.id === "string" && details.id.trim()) {
      return true;
    }
    if (Array.isArray(details.categories) && details.categories.length) {
      return true;
    }
  }
  return false;
}

/**
 * Check if entry has journal information (formally published).
 */
export function hasJournalInfo(entry: InspireReferenceEntry): boolean {
  const info = entry.publicationInfo;
  return !!(info?.journal_title || info?.journal_title_abbrev);
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Predicates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter predicate function type.
 */
export type FilterPredicate = (
  entry: InspireReferenceEntry,
  context: FilterContext,
) => boolean;

/**
 * High citations filter: papers with > threshold citations.
 */
export function matchesHighCitations(
  entry: InspireReferenceEntry,
  context: FilterContext,
): boolean {
  const citationCount = context.getCitationValue(entry);
  return citationCount > HIGH_CITATIONS_THRESHOLD;
}

/**
 * Recent years filter: papers from the last N years.
 */
export function matchesRecentYears(
  entry: InspireReferenceEntry,
  context: FilterContext,
  years: number,
): boolean {
  const normalizedYears = Math.max(1, years);
  const thresholdYear = context.currentYear - (normalizedYears - 1);
  const entryYear = Number.parseInt(entry.year ?? "", 10);
  if (Number.isNaN(entryYear)) {
    return false;
  }
  return entryYear >= thresholdYear;
}

/**
 * Published only filter: papers with journal information.
 */
export function matchesPublishedOnly(entry: InspireReferenceEntry): boolean {
  return hasJournalInfo(entry);
}

/**
 * Preprint only filter: papers with arXiv but no journal info.
 */
export function matchesPreprintOnly(entry: InspireReferenceEntry): boolean {
  return hasArxivIdentifier(entry) && !hasJournalInfo(entry);
}

/**
 * Non-review articles filter: hide entries marked as reviews.
 * Uses INSPIRE document_type and journal heuristics; missing metadata passes through.
 */
export function matchesNonReviewOnly(entry: InspireReferenceEntry): boolean {
  return !isReviewArticleEntry(entry);
}

/**
 * Related only filter: papers marked as related.
 */
export function matchesRelatedOnly(entry: InspireReferenceEntry): boolean {
  return entry.isRelated === true;
}

/**
 * Local items filter: papers in local library.
 */
export function matchesLocalItems(entry: InspireReferenceEntry): boolean {
  return typeof entry.localItemID === "number" && entry.localItemID > 0;
}

/**
 * Online items filter: papers not in local library.
 */
export function matchesOnlineItems(entry: InspireReferenceEntry): boolean {
  return typeof entry.localItemID !== "number" || entry.localItemID <= 0;
}

/**
 * Small author group filter: papers with <= threshold authors.
 */
export function matchesSmallAuthorGroup(entry: InspireReferenceEntry): boolean {
  const authorCount = entry.totalAuthors ?? entry.authors?.length ?? 0;
  return authorCount > 0 && authorCount <= SMALL_AUTHOR_GROUP_THRESHOLD;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Filter Predicate Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the predicate function for a quick filter type.
 * Returns undefined for unknown filter types.
 */
export function getQuickFilterPredicate(
  filterType: QuickFilterType,
):
  | ((entry: InspireReferenceEntry, context: FilterContext) => boolean)
  | undefined {
  switch (filterType) {
    case "highCitations":
      return matchesHighCitations;
    case "recent5Years":
      return (entry, ctx) => matchesRecentYears(entry, ctx, 5);
    case "recent1Year":
      return (entry, ctx) => matchesRecentYears(entry, ctx, 1);
    case "nonReviewOnly":
      return (entry) => matchesNonReviewOnly(entry);
    case "publishedOnly":
      return matchesPublishedOnly;
    case "preprintOnly":
      return matchesPreprintOnly;
    case "relatedOnly":
      return matchesRelatedOnly;
    case "localItems":
      return matchesLocalItems;
    case "onlineItems":
      return matchesOnlineItems;
    default:
      return undefined;
  }
}

/**
 * Apply multiple quick filters to an entry.
 * Returns true if entry passes ALL active filters (AND logic).
 */
export function applyQuickFilters(
  entry: InspireReferenceEntry,
  activeFilters: Set<QuickFilterType>,
  context: FilterContext,
): boolean {
  if (activeFilters.size === 0) {
    return true;
  }

  for (const filterType of activeFilters) {
    const predicate = getQuickFilterPredicate(filterType);
    if (predicate && !predicate(entry, context)) {
      return false;
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Mutual Exclusivity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mutual exclusivity rules for quick filters.
 * If filter A is enabled, filters in the array should be disabled.
 */
export const QUICK_FILTER_EXCLUSIONS: Record<
  QuickFilterType,
  QuickFilterType[]
> = {
  highCitations: [],
  recent5Years: ["recent1Year"],
  recent1Year: ["recent5Years"],
  nonReviewOnly: [],
  publishedOnly: ["preprintOnly"],
  preprintOnly: ["publishedOnly"],
  relatedOnly: [],
  localItems: ["onlineItems"],
  onlineItems: ["localItems"],
};

/**
 * Enforce mutual exclusivity constraints when enabling a filter.
 * Returns the set of filters that should be disabled.
 */
export function getExcludedFilters(
  filterType: QuickFilterType,
): QuickFilterType[] {
  return QUICK_FILTER_EXCLUSIONS[filterType] ?? [];
}
