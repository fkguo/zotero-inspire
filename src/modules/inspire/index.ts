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
  ensureSearchText,
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
  // Batch query functions for duplicate detection (FTR-BATCH-IMPORT)
  findItemsByRecids,
  findItemsByArxivs,
  findItemsByDOIs,
} from "./apiUtils";

// Re-export author utilities
export {
  extractAuthorNamesFromReference,
  extractAuthorNamesLimited,
  isValidBAI,
  extractAuthorSearchInfos,
} from "./authorUtils";

// Re-export classes and utilities
export { LRUCache, ZInsUtils, ReaderTabHelper, clearAllHistoryPrefs } from "./utils";
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

// Re-export local cache service
export { localCache } from "./localCache";

// Re-export reference services
export { fetchReferencesEntries, buildReferenceEntry, enrichReferencesEntries } from "./referencesService";

// Re-export PDF annotate module (FTR-PDF-ANNOTATE)
export {
  // Types
  type CitationType,
  type ParsedCitation,
  type CitationPosition,
  type MatchResult,
  type AlignmentIssue,
  type AlignmentReport,
  type ScanResult,
  type CitationLookupEvent,
  type PageScanCompleteEvent,
  type ReaderState,
  // Classes
  CitationParser,
  getCitationParser,
  LabelMatcher,
  ReaderIntegration,
  getReaderIntegration,
} from "./pdfAnnotate";

// Re-export style utilities
export {
  FLEX_STYLES,
  BUTTON_STYLES,
  TEXT_STYLES,
  CONTAINER_STYLES,
  CHART_STYLES,
  STATUS_COLORS,
  TAB_COLORS,
  applyStyle,
  applyStyles,
  toStyleString,
  isDarkMode,
} from "./styles";

// Re-export filter utilities
export {
  type FilterContext,
  type FilterPredicate,
  createDefaultFilterContext,
  hasArxivIdentifier,
  hasJournalInfo,
  matchesHighCitations,
  matchesRecentYears,
  matchesPublishedOnly,
  matchesPreprintOnly,
  matchesRelatedOnly,
  matchesLocalItems,
  matchesOnlineItems,
  matchesSmallAuthorGroup,
  getQuickFilterPredicate,
  applyQuickFilters,
  QUICK_FILTER_EXCLUSIONS,
  getExcludedFilters,
} from "./filters";

// Re-export API types
export {
  // Literature API types
  type InspireLiteratureSearchResponse,
  type InspireLiteratureHit,
  type InspireLiteratureMetadata,
  type InspireTitle,
  type InspireAuthor,
  type InspireAuthorID,
  type InspireAffiliation,
  type InspirePublicationInfo,
  type InspireArxivEprint,
  type InspireDOI,
  type InspireAbstract,
  type InspireCollaboration,
  type InspireISBN,
  type InspireImprint,
  type InspireCategory,
  type InspireKeyword,
  type InspireReportNumber,
  type InspireExternalID,
  // Reference types
  type InspireReference,
  type InspireReferenceData,
  type InspireRecordRef,
  // CrossRef types
  type CrossRefWorksResponse,
  type CrossRefWork,
  type CrossRefAuthor,
  type CrossRefDate,
  // Type guards
  isInspireLiteratureSearchResponse,
  isInspireLiteratureHit,
  isCrossRefWorksResponse,
  // Utility functions
  extractRecidFromRef,
  getPrimaryTitle,
  getPrimaryArxivId,
  getPrimaryDoi,
  getPrimaryAbstract,
} from "./apiTypes";

// Re-export panel components (refactored from controller)
export {
  ChartManager,
  type ChartViewMode,
  type ChartState,
  type ChartManagerOptions,
  FilterManager,
  type FilterState,
  type FilterManagerOptions,
  NavigationManager,
  type NavigationState,
  type NavigationContext,
  type NavigationManagerOptions,
  ExportManager,
  type ExportFormat,
  type ExportTarget,
  type ExportFormatConfig,
  type ExportManagerOptions,
  type ExportResult,
  EXPORT_FORMATS,
  BatchImportManager,
  type DuplicateInfo,
  type BatchImportResult,
  type BatchSaveTarget,
  type BatchImportManagerOptions,
  type BatchImportState,
  PerformanceMonitor,
  getPerformanceMonitor,
  resetPerformanceMonitor,
  wrapWithMonitoring,
  wrapAsyncWithMonitoring,
  type PerformanceMetric,
  type PerformanceStats,
  type PerformanceReport,
  type PerformanceMonitorOptions,
  RowPoolManager,
  replaceContainerAsync,
  createRowsFragment,
  type StyleApplicator,
  type RowPoolManagerOptions,
  type PoolStats,
  type ListRenderContext,
  type ListRenderOptions,
} from "./panel";
