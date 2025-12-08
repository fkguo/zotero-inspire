// ─────────────────────────────────────────────────────────────────────────────
// Author Search Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Author search information for precise INSPIRE author search.
 * Priority: BAI > fullName > recid
 * BAI (INSPIRE Author ID) like "Feng.Kun.Guo.1" is the most reliable.
 * Note: INSPIRE currently doesn't support querying authors by recid,
 * so recid is kept as lowest priority for potential future support.
 */
export interface AuthorSearchInfo {
  fullName: string;
  bai?: string;    // INSPIRE BAI (e.g., "Feng.Kun.Guo.1") - most precise
  recid?: string;  // INSPIRE author recid (lowest priority, not currently supported by INSPIRE API)
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference Entry Types
// ─────────────────────────────────────────────────────────────────────────────

export interface InspireArxivDetails {
  id?: string;
  categories?: string[];
}

export interface InspireReferenceEntry {
  id: string;
  label?: string;
  recid?: string;
  inspireUrl?: string;
  fallbackUrl?: string;
  title: string;
  summary?: string;
  year: string;
  authors: string[];
  totalAuthors?: number;  // Total author count (for detecting "et al." need)
  authorSearchInfos?: AuthorSearchInfo[];  // Author info for precise search
  authorText: string;
  displayText: string;
  searchText: string;
  localItemID?: number;
  isRelated?: boolean;
  citationCount?: number;
  citationCountWithoutSelf?: number;  // Citation count excluding self-citations
  publicationInfo?: any;
  publicationInfoErrata?: Array<{ info: any; label: string }>;
  arxivDetails?: InspireArxivDetails | string | null;
  abstract?: string;
  abstractLoading?: boolean;
  doi?: string;  // DOI for duplicate detection (FTR-BATCH-IMPORT)
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation and Scroll Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScrollSnapshot {
  element: Element;
  top: number;
  left: number;
}

export interface ScrollState {
  scrollTop: number;
  scrollLeft: number;
  scrollSnapshots: ScrollSnapshot[];
  activeElement: Element | null;
}

export interface NavigationSnapshot {
  itemID: number;
  recid?: string;
  scrollState: ScrollState;
  tabType: "library" | "reader";
  readerTabID?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Cited Source
// ─────────────────────────────────────────────────────────────────────────────

export interface EntryCitedSource {
  recid?: string;
  authorQuery?: string; // Author search query (deprecated, for cache key only)
  authorSearchInfo?: AuthorSearchInfo; // Full author info for precise search
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChartBin {
  label: string;
  count: number;
  range?: [number, number]; // For citation bins: [min, max]
  years?: number[]; // For year bins: [year] or [start, end, ...]
  key: string; // Unique key for selection
}

// ─────────────────────────────────────────────────────────────────────────────
// View Mode Types
// ─────────────────────────────────────────────────────────────────────────────

export type InspireViewMode = "references" | "citedBy" | "entryCited" | "search";

// ─────────────────────────────────────────────────────────────────────────────
// Search History Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchHistoryItem {
  query: string;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic JSON Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic JSON object type for dynamic INSPIRE metadata
 */
export type jsobject = {
  [key: string]: any;
};

// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE API Response Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * INSPIRE API metadata response structure (partial)
 */
export interface InspireMetadataResponse {
  control_number?: string;
  titles?: Array<{ title: string; source?: string }>;
  authors?: Array<{
    full_name: string;
    inspire_roles?: string[];
    affiliations?: Array<{ value: string }>;
  }>;
  publication_info?: Array<{
    journal_title?: string;
    journal_volume?: string;
    journal_issue?: string;
    year?: number;
    artid?: string;
    page_start?: string;
    page_end?: string;
    material?: string;
    pubinfo_freetext?: string;
  }>;
  citation_count?: number;
  citation_count_without_self_citations?: number;
  dois?: Array<{ value: string }>;
  arxiv_eprints?: Array<{ value: string; categories?: string[] }>;
  abstracts?: Array<{ value: string; source?: string }>;
  texkeys?: string[];
  document_type?: string[];
  collaborations?: Array<{ value: string }>;
  isbns?: Array<{ value: string }>;
  imprints?: Array<{ publisher?: string; date?: string }>;
  author_count?: number;
  earliest_date?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Token Type
// ─────────────────────────────────────────────────────────────────────────────

export type ParsedFilterToken = { text: string; quoted: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Item with Pending Note Type
// ─────────────────────────────────────────────────────────────────────────────

export type ItemWithPendingInspireNote = Zotero.Item & {
  _zinspirePendingInspireNote?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Local Cache Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache type identifier for file naming
 */
export type LocalCacheType = "refs" | "cited" | "author";

/**
 * Local cache file structure for persistent storage.
 * Uses short property names to reduce file size.
 */
export interface LocalCacheFile<T> {
  v: number;           // version
  t: LocalCacheType;   // type
  k: string;           // key (recid or author BAI)
  ts: number;          // timestamp (Date.now())
  ttl: number;         // TTL in hours (-1 = permanent)
  d: T;                // data
  c?: boolean;         // complete flag (true = fetch completed successfully)
  n?: number;          // total count from API (for smart caching: if n <= limit, data is complete)
}

/**
 * Cache source indicator for UI display
 */
export type CacheSource = "api" | "memory" | "local";

/**
 * Data with cache source information
 */
export interface CachedData<T> {
  data: T;
  source: CacheSource;
  ageHours?: number;   // Age in hours (for local cache)
}

