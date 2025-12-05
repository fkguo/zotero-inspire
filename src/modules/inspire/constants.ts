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
export const REFERENCE_SORT_OPTIONS = ["default", "yearDesc", "citationDesc"] as const;
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
export const CITED_BY_MAX_PAGES = 40;  // Max pages to fetch (40 * 250 = 10000)
export const CITED_BY_MAX_RESULTS = 10000;
export const CITED_BY_PARALLEL_BATCH_SIZE = 5; // Number of pages to fetch in parallel (increased for faster loading)
// Frontend pagination: render entries in chunks for better performance
export const RENDER_PAGE_SIZE = 100; // Number of entries to render per "page"
export const NAVIGATION_STACK_LIMIT = 20;
// Large collaboration threshold: if authors > this, only show first author + et al.
export const LARGE_COLLABORATION_THRESHOLD = 20;

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
export const isReferenceSortOption = (value: string): value is ReferenceSortOption =>
  (REFERENCE_SORT_OPTIONS as readonly string[]).includes(value);

export const isInspireSortOption = (value: string): value is InspireSortOption =>
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
  return typeof value === "string" && QUICK_FILTER_TYPES.includes(value as QuickFilterType);
}

export interface QuickFilterConfig {
  type: QuickFilterType;
  emoji: string;
  labelKey: string;
  tooltipKey?: string;
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

