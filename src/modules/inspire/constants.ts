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
export const CITED_BY_PARALLEL_BATCH_SIZE = 3; // Number of pages to fetch in parallel
// Frontend pagination: render entries in chunks for better performance
export const RENDER_PAGE_SIZE = 100; // Number of entries to render per "page"
export const NAVIGATION_STACK_LIMIT = 20;
// Large collaboration threshold: if authors > this, only show first author + et al.
export const LARGE_COLLABORATION_THRESHOLD = 20;

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

