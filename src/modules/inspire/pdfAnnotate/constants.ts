// ─────────────────────────────────────────────────────────────────────────────
// Constants for PDF Annotation and Matching
// FTR-PDF-MATCHING: Centralized configuration for matching algorithms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score thresholds for matching decisions.
 * Higher scores indicate better matches.
 */
export const SCORE = {
  /** arXiv ID exact match - highest priority identifier */
  ARXIV_EXACT: 10,
  /** DOI exact match - second highest priority */
  DOI_EXACT: 9,
  /** Journal + volume + page exact match */
  JOURNAL_EXACT: 8,
  /** Threshold for accepting validation match */
  VALIDATION_ACCEPT: 3,
  /** Threshold for accepting year-matched result */
  YEAR_MATCH_ACCEPT: 4,
  /** Threshold for accepting result when no year info available */
  NO_YEAR_ACCEPT: 6,
  /** Normalized score threshold for findMatchingInspireEntry */
  NORMALIZED_ACCEPT: 1.5,
  /** Author exact match */
  AUTHOR_EXACT: 4,
  /** Author partial match */
  AUTHOR_PARTIAL: 3,
  /** Author found in text */
  AUTHOR_IN_TEXT: 2,
  /** Year exact match */
  YEAR_EXACT: 2,
  /** Year close (±1 year) */
  YEAR_CLOSE: 1.5,
  /** Year reasonable (±2 years) */
  YEAR_REASONABLE: 1,
  /** Year acceptable (±3 years) */
  YEAR_ACCEPTABLE: 0.5,
  /** Page match */
  PAGE_MATCH: 2,
  /** Journal match bonus */
  JOURNAL_MATCH: 4,
  /** Marginal score threshold - scores <= this are weak (just author+year+small bonus) */
  MARGINAL_THRESHOLD: 7,
} as const;

/**
 * Year difference thresholds.
 * arXiv and published versions can differ significantly in publication year.
 */
export const YEAR_DELTA = {
  /** Close match: same year or ±1 year */
  CLOSE: 1,
  /** Reasonable match: ±2 years (common for arXiv -> journal delay) */
  REASONABLE: 2,
  /** Maximum acceptable: ±3 years (some papers take long to publish) */
  MAX_ACCEPTABLE: 3,
} as const;

/**
 * API configuration for INSPIRE requests.
 */
export const API_CONFIG = {
  /** Batch size for bulk queries */
  BATCH_SIZE: 5,
  /** Number of retry attempts */
  RETRY_COUNT: 3,
  /** Delay between retries in milliseconds */
  RETRY_DELAY: 1000,
  /** Request timeout in milliseconds */
  TIMEOUT: 30000,
  /** Maximum references to fetch per request */
  MAX_REFS_PER_REQUEST: 200,
} as const;

/**
 * PDF parsing configuration.
 */
export const PARSE_CONFIG = {
  /** Maximum pages to search for reference section */
  MAX_REF_PAGES: 10,
  /** Maximum length of a single reference entry */
  MAX_ENTRY_LENGTH: 2000,
  /** Warning threshold for large reference lists */
  MAX_REFS_WARNING: 500,
  /** Minimum labels to consider parsing successful */
  MIN_LABELS_SUCCESS: 5,
  /** Page chunk size for heuristic splitting */
  PAGE_CHUNK_SIZE: 8000,
} as const;

/**
 * Matching strategy thresholds.
 */
export const MATCH_CONFIG = {
  /** Alignment rate threshold for "USE_INSPIRE_LABEL" recommendation */
  ALIGN_RATE_HIGH: 0.95,
  /** Alignment rate threshold for "USE_INDEX_WITH_FALLBACK" recommendation */
  ALIGN_RATE_MEDIUM: 0.7,
  /** Label availability rate threshold for index-only mode */
  LABEL_RATE_LOW: 0.3,
  /** Maximum citation label number (filter out invalid) */
  MAX_LABEL_NUMBER: 1500,
  /** Year range for filtering (min) */
  YEAR_RANGE_MIN: 1900,
  /** Year range for filtering (max) */
  YEAR_RANGE_MAX: 2099,
  /** Maximum range span for concatenated range detection */
  MAX_RANGE_SPAN: 50,
  /** Heuristic mode threshold for concatenated range parts */
  HEURISTIC_PART_MAX: 100,
} as const;

/**
 * UI feedback configuration.
 */
export const UI_CONFIG = {
  /** Duration of highlight animation in milliseconds */
  HIGHLIGHT_DURATION: 2500,
  /** Maximum selection length for citation detection */
  MAX_SELECTION_LENGTH: 2000,
  /** Short selection threshold (use parseSelection vs parseText) */
  SHORT_SELECTION_THRESHOLD: 50,
} as const;

/**
 * Confidence levels for match results.
 */
export type MatchConfidence = "high" | "medium" | "low";

/**
 * Match methods for tracking how a match was found.
 */
export type MatchMethod =
  | "exact"           // Direct label or identifier match
  | "inferred"        // Index-based fallback
  | "fuzzy"           // Fuzzy/case-insensitive match
  | "strict-fallback" // Global search in strict mode
  | "label"           // INSPIRE label match
  | "index";          // Pure index match
