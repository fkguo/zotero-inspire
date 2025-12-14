import type { FluentMessageId } from "../../../typings/i10n";

// ─────────────────────────────────────────────────────────────────────────────
// API Constants
// ─────────────────────────────────────────────────────────────────────────────
export const INSPIRE_API_BASE = "https://inspirehep.net/api";
export const INSPIRE_LITERATURE_URL = "https://inspirehep.net/literature";
export const ARXIV_ABS_URL = "https://arxiv.org/abs";
export const DOI_ORG_URL = "https://doi.org";
export const CROSSREF_API_URL = "https://api.crossref.org/works";

// ─────────────────────────────────────────────────────────────────────────────
// Sort Options
// ─────────────────────────────────────────────────────────────────────────────
export const REFERENCE_SORT_OPTIONS = [
  "default",
  "yearDesc",
  "citationDesc",
] as const;
export type ReferenceSortOption = (typeof REFERENCE_SORT_OPTIONS)[number];
export const INSPIRE_SORT_OPTIONS = ["mostrecent", "mostcited"] as const;
export type InspireSortOption = (typeof INSPIRE_SORT_OPTIONS)[number];
export const DEFAULT_REFERENCE_SORT: ReferenceSortOption = "default";
export const DEFAULT_CITED_BY_SORT: InspireSortOption = "mostrecent";

// ─────────────────────────────────────────────────────────────────────────────
// Pagination and Limits
// ─────────────────────────────────────────────────────────────────────────────
// Page sizing: use consistent page size to avoid pagination offset bugs
// INSPIRE API calculates offset as (page-1) * size, so different sizes cause gaps
export const CITED_BY_PAGE_SIZE = 250; // Consistent page size for all pages
export const CITED_BY_MAX_PAGES = 40; // Max pages to fetch (40 * 250 = 10000)
export const CITED_BY_MAX_RESULTS = 10000;
export const CITED_BY_PARALLEL_BATCH_SIZE = 5; // Number of pages to fetch in parallel (increased for faster loading)
// Frontend pagination: render entries in chunks for better performance
export const RENDER_PAGE_SIZE = 100; // Number of entries to render per "page"
export const NAVIGATION_STACK_LIMIT = 20;
// Large collaboration threshold: if authors > this, only show first author + et al.
export const LARGE_COLLABORATION_THRESHOLD = 20;

// ─────────────────────────────────────────────────────────────────────────────
// UI Timing Constants
// ─────────────────────────────────────────────────────────────────────────────
/** Filter input debounce delay in milliseconds */
export const FILTER_DEBOUNCE_MS = 150;
/** Chart render throttle interval in milliseconds */
export const CHART_THROTTLE_MS = 300;
/** Tooltip show delay in milliseconds (hover before showing) */
export const TOOLTIP_SHOW_DELAY_MS = 300;
/** Tooltip hide delay in milliseconds (mouse leave before hiding) */
export const TOOLTIP_HIDE_DELAY_MS = 600;
/** Delay for scroll and highlight operations after DOM updates */
export const SCROLL_HIGHLIGHT_DELAY_MS = 150;
/** Progress window auto-close delay after success */
export const PROGRESS_CLOSE_DELAY_MS = 2000;
/** Progress window auto-close delay after warning */
export const PROGRESS_CLOSE_DELAY_WARN_MS = 3000;
/** Fallback frame interval when requestAnimationFrame unavailable */
export const RAF_FALLBACK_MS = 16;

// ─────────────────────────────────────────────────────────────────────────────
// Cache Size Constants
// ─────────────────────────────────────────────────────────────────────────────
/** LRU cache size for references data */
export const REFERENCES_CACHE_SIZE = 100;
/** LRU cache size for cited-by data */
export const CITED_BY_CACHE_SIZE = 50;
/** LRU cache size for entry cited data */
export const ENTRY_CITED_CACHE_SIZE = 50;
/** LRU cache size for metadata */
export const METADATA_CACHE_SIZE = 500;
/** LRU cache size for search results */
export const SEARCH_CACHE_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Cache TTL Constants (FTR-REFACTOR: Centralized TTL values)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache TTL values in milliseconds.
 * Centralizes all cache expiration times for easier tuning.
 */
export const CACHE_TTL = {
  /** ReaderIntegration processed data cache (5 minutes) */
  READER_INTEGRATION_MS: 5 * 60 * 1000,
  /** Local disk cache default (24 hours) */
  LOCAL_CACHE_MS: 24 * 60 * 60 * 1000,
  /** In-memory metadata cache (30 minutes) */
  METADATA_MS: 30 * 60 * 1000,
  /** Short-lived session cache (10 minutes) */
  SESSION_MS: 10 * 60 * 1000,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Render Configuration
// ─────────────────────────────────────────────────────────────────────────────
/** Maximum size of the row element pool for DOM recycling */
export const ROW_POOL_MAX_SIZE = 150;
/** Maximum bar width in chart (pixels) */
export const CHART_MAX_BAR_WIDTH = 50;
/** Pagination threshold when filter is active (show all up to this limit) */
export const RENDER_PAGE_SIZE_FILTERED = 500;
/** Batch size for metadata enrichment */
export const METADATA_BATCH_SIZE = 50;
/** Batch size for local status SQL queries */
export const LOCAL_STATUS_BATCH_SIZE = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Filter Thresholds
// ─────────────────────────────────────────────────────────────────────────────
/** Citation count threshold for "high citations" filter */
export const HIGH_CITATIONS_THRESHOLD = 50;
/** Author count threshold for "small author group" filter */
export const SMALL_AUTHOR_GROUP_THRESHOLD = 10;
/** Maximum author name display length before truncation */
export const AUTHOR_NAME_MAX_LENGTH = 30;
/** Clipboard warning size threshold in bytes (500KB) */
export const CLIPBOARD_WARN_SIZE_BYTES = 500 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Citation Range Boundaries (for chart statistics)
// ─────────────────────────────────────────────────────────────────────────────
export const CITATION_RANGES = {
  LOW_MIN: 1,
  LOW_MAX: 9,
  MID_LOW_MIN: 10,
  MID_LOW_MAX: 49,
  MID_MIN: 50,
  MID_MAX: 99,
  MID_HIGH_MIN: 100,
  MID_HIGH_MAX: 249,
  HIGH_MIN: 250,
  HIGH_MAX: 499,
  VERY_HIGH_MIN: 500,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Search History
// ─────────────────────────────────────────────────────────────────────────────
export const SEARCH_HISTORY_MAX_ENTRIES = 50;
export const SEARCH_HISTORY_PREF_KEY = "inspireSearchHistory";
export const SEARCH_HISTORY_DAYS_PREF_KEY = "search_history_days";
export const SEARCH_HISTORY_DAYS_DEFAULT = 30;
export const FILTER_HISTORY_MAX_ENTRIES = 50;
export const FILTER_HISTORY_PREF_KEY = "inspireFilterHistory";

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────
export const isReferenceSortOption = (
  value: string,
): value is ReferenceSortOption =>
  (REFERENCE_SORT_OPTIONS as readonly string[]).includes(value);

export const isInspireSortOption = (
  value: string,
): value is InspireSortOption =>
  (INSPIRE_SORT_OPTIONS as readonly string[]).includes(value);

// ─────────────────────────────────────────────────────────────────────────────
// Author Processing Constants
// ─────────────────────────────────────────────────────────────────────────────
export const AUTHOR_IDS_EXTRACT_LIMIT = 10; // Support up to 10 displayed authors

// Non-person author patterns (collaborations, organizations)
export const NON_PERSON_AUTHOR_PATTERN =
  /^(.*\s+collaboration|.*\s+group|.*\s+team|.*\s+consortium|.*\s+project|.*\s+experiment|.*\s+collaboration)$/i;

// Family name particles that should not be capitalized
export const FAMILY_NAME_PARTICLES = new Set([
  "de",
  "du",
  "da",
  "di",
  "del",
  "della",
  "van",
  "von",
  "le",
  "la",
  "ter",
  "ten",
  "ibn",
  "bin",
  "al",
  "el",
  "den",
  "der",
  "dos",
  "das",
  "mac",
  "mc",
]);

// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE Note Processing
// ─────────────────────────────────────────────────────────────────────────────
export const INSPIRE_NOTE_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// ─────────────────────────────────────────────────────────────────────────────
// Quick Filter Configuration
// ─────────────────────────────────────────────────────────────────────────────

export type QuickFilterType =
  | "highCitations"
  | "recent5Years"
  | "recent1Year"
  | "publishedOnly"
  | "preprintOnly"
  | "relatedOnly"
  | "localItems"
  | "onlineItems";

export const QUICK_FILTER_TYPES: QuickFilterType[] = [
  "highCitations",
  "recent5Years",
  "recent1Year",
  "publishedOnly",
  "preprintOnly",
  "relatedOnly",
  "localItems",
  "onlineItems",
];

export const QUICK_FILTER_PREF_KEY = "quick_filters_last_used";

export function isQuickFilterType(value: unknown): value is QuickFilterType {
  return (
    typeof value === "string" &&
    QUICK_FILTER_TYPES.includes(value as QuickFilterType)
  );
}

export interface QuickFilterConfig {
  type: QuickFilterType;
  emoji: string;
  labelKey: FluentMessageId;
  tooltipKey?: FluentMessageId;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Field Selection (FTR-API-FIELD-OPTIMIZATION)
// ─────────────────────────────────────────────────────────────────────────────
// Use these field configurations to reduce API response size by 70-80%
// INSPIRE API supports `fields=` parameter to select specific fields

/**
 * Minimal fields for citation count updates only.
 * ~200 bytes vs ~5KB full response
 */
export const API_FIELDS_CITATIONS =
  "control_number,citation_count,citation_count_without_self_citations";

/**
 * Fields for reference list display (panel entries).
 * Includes basic metadata for display and filtering.
 */
export const API_FIELDS_LIST_DISPLAY =
  "control_number,titles.title,authors.full_name,authors.ids,author_count,publication_info,earliest_date,dois,arxiv_eprints,citation_count,citation_count_without_self_citations";

/**
 * Fields for reference enrichment (batch metadata fetch).
 * Same as list display but without author IDs (not needed for enrichment).
 */
export const API_FIELDS_ENRICHMENT =
  "control_number,citation_count,citation_count_without_self_citations,titles.title,authors.full_name,author_count,publication_info,earliest_date,arxiv_eprints,dois";

/**
 * Fields for abstract tooltip fetch.
 */
export const API_FIELDS_ABSTRACT = "metadata.abstracts";

/**
 * Fields for full metadata update (right-click update).
 * Includes all fields needed for Zotero item update.
 */
export const API_FIELDS_FULL_UPDATE =
  "control_number,titles,authors,publication_info,dois,arxiv_eprints,abstracts,texkeys,citation_count,citation_count_without_self_citations,document_type,collaborations,isbns,imprints,preprint_date";

/**
 * Fields for auto-check comparison (smart update).
 * Same as FULL_UPDATE but without abstracts (~80% smaller response).
 */
export const API_FIELDS_AUTO_CHECK =
  "control_number,titles,authors,publication_info,dois,arxiv_eprints,texkeys,citation_count,citation_count_without_self_citations,document_type,collaborations,preprint_date";

/**
 * Fields for literature lookup (finding recid from DOI/arXiv).
 * Only need basic identification fields.
 */
export const API_FIELDS_LOOKUP =
  "control_number,titles.title,dois,arxiv_eprints,texkeys";

/**
 * Build query string with fields parameter.
 * @param fields - The fields configuration string
 * @returns Query string with fields parameter (includes leading &)
 */
export function buildFieldsParam(fields: string): string {
  return `&fields=${fields}`;
}

export const QUICK_FILTER_CONFIGS: QuickFilterConfig[] = [
  {
    type: "highCitations",
    emoji: "🔥",
    labelKey: "references-panel-quick-filter-high-citations",
    tooltipKey: "references-panel-quick-filter-high-citations-tooltip",
  },
  {
    type: "relatedOnly",
    emoji: "🔗",
    labelKey: "references-panel-quick-filter-related",
    tooltipKey: "references-panel-quick-filter-related-tooltip",
  },
  {
    type: "localItems",
    emoji: "📚",
    labelKey: "references-panel-quick-filter-local-items",
    tooltipKey: "references-panel-quick-filter-local-items-tooltip",
  },
  {
    type: "onlineItems",
    emoji: "🌐",
    labelKey: "references-panel-quick-filter-online-items",
    tooltipKey: "references-panel-quick-filter-online-items-tooltip",
  },
  {
    type: "recent5Years",
    emoji: "📅",
    labelKey: "references-panel-quick-filter-recent-5y",
    tooltipKey: "references-panel-quick-filter-recent-5y-tooltip",
  },
  {
    type: "recent1Year",
    emoji: "📅",
    labelKey: "references-panel-quick-filter-recent-1y",
    tooltipKey: "references-panel-quick-filter-recent-1y-tooltip",
  },
  {
    type: "publishedOnly",
    emoji: "📰",
    labelKey: "references-panel-quick-filter-published",
    tooltipKey: "references-panel-quick-filter-published-tooltip",
  },
  {
    type: "preprintOnly",
    emoji: "📝",
    labelKey: "references-panel-quick-filter-preprint",
    tooltipKey: "references-panel-quick-filter-preprint-tooltip",
  },
];
