// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE Module - Unified Exports
// ─────────────────────────────────────────────────────────────────────────────

// Re-export constants
export * from "./constants";

// Re-export types
export * from "./types";

// Re-export text utilities
export {
  normalizeSearchText,
  buildVariantSet,
  buildSearchIndexText,
  buildFilterTokenVariants,
  parseFilterTokens,
} from "./textUtils";

// Re-export formatters
export {
  getCachedStrings,
  clearCachedStrings,
  normalizeInitials,
  buildInitials,
  formatAuthorName,
  formatAuthors,
  convertFullNameToSearchQuery,
  splitPublicationInfo,
  getPublicationNoteLabel,
  formatPublicationInfo,
  buildPublicationSummary,
  normalizeArxivID,
  normalizeArxivCategories,
  formatArxivDetails,
  formatArxivTag,
  buildDisplayText,
  extractJournalName,
  buildEntrySearchText,
} from "./formatters";

// Re-export API utilities
export {
  deriveRecidFromItem,
  extractRecidFromRecordRef,
  extractRecidFromUrls,
  extractRecidFromUrl,
  buildReferenceUrl,
  buildFallbackUrl,
  buildFallbackUrlFromMetadata,
  extractArxivFromReference,
  extractArxivFromMetadata,
  findItemByRecid,
  copyToClipboard,
  recidLookupCache,
} from "./apiUtils";

// Re-export author utilities
export {
  extractAuthorNamesFromReference,
  extractAuthorNamesLimited,
  isValidBAI,
  extractAuthorSearchInfos,
} from "./authorUtils";

// Re-export classes and utilities
export { LRUCache, ZInsUtils, ReaderTabHelper } from "./utils";
export { ZInsMenu } from "./menu";
export { ZInspire, setInspireMeta, setCrossRefCitations, saveItemWithPendingInspireNote } from "./itemUpdater";

// Re-export metadata service
export {
  getInspireMeta,
  fetchRecidFromInspire,
  fetchInspireMetaByRecid,
  fetchInspireAbstract,
  fetchBibTeX,
  getCrossrefCount,
  buildMetaFromMetadata,
} from "./metadataService";

// Re-export rate limiter
export {
  inspireFetch,
  getRateLimiterStatus,
  onRateLimiterStatusChange,
  resetRateLimiter,
  InspireRateLimiter,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  type RateLimiterStatus,
} from "./rateLimiter";

