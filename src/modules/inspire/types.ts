// ─────────────────────────────────────────────────────────────────────────────
// Author Search Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Author search information for precise INSPIRE author profile lookup.
 * Priority: recid > BAI > fullName
 *
 * - recid: Direct lookup via `/api/authors/{recid}` - 100% accurate, fastest
 * - BAI (INSPIRE Author ID) like "Feng.Kun.Guo.1" - highly reliable (search query)
 * - fullName: Fallback when recid and BAI are not available
 *
 * Note: author recid can be extracted from paper's `authors[].record.$ref` field.
 * See `authorUtils.ts:extractAuthorSearchInfos()` for extraction logic.
 */
export interface AuthorSearchInfo {
  fullName: string;
  bai?: string; // INSPIRE BAI (e.g., "Feng.Kun.Guo.1") - highly reliable search
  recid?: string; // INSPIRE author recid - direct /api/authors/{recid} lookup (highest priority)
}

// ─────────────────────────────────────────────────────────────────────────────
// Author Profile Types
// ─────────────────────────────────────────────────────────────────────────────

export interface InspireAuthorProfile {
  recid: string;
  name: string;
  currentPosition?: {
    institution: string;
    rank?: string;
  };
  orcid?: string;
  inspireId?: string;
  bai?: string;
  arxivCategories?: string[];
  homepageUrl?: string;
  emails?: string[];
  status?: string;
  advisors?: Array<{ name: string; degreeType?: string; recid?: string }>;
}

export interface AuthorStats {
  paperCount: number;
  totalCitations: number;
  hIndex: number;
  citationsWithoutSelf?: number;
}

/**
 * Favorite author for quick access in References Panel.
 */
export interface FavoriteAuthor {
  authorSearchInfo: AuthorSearchInfo;
  label: string;
  addedAt: number;
}

/**
 * Favorite paper for quick access in References Panel.
 */
export interface FavoritePaper {
  recid?: string;
  itemID?: number; // Zotero item ID for navigation
  title: string;
  authors?: string; // First author or abbreviated author list
  year?: number;
  addedAt: number;
}

/**
 * Favorite presentation for quick access in References Panel.
 */
export interface FavoritePresentation extends FavoritePaper {}

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
  /** Original title before smart fallback (may be empty if unavailable). */
  titleOriginal?: string;
  summary?: string;
  /** INSPIRE earliest_date (ISO-like string, e.g., 2020-06-15). */
  earliestDate?: string;
  year: string;
  authors: string[];
  totalAuthors?: number; // Total author count (for detecting "et al." need)
  authorSearchInfos?: AuthorSearchInfo[]; // Author info for precise search
  authorText: string;
  displayText: string;
  searchText: string;
  localItemID?: number;
  isRelated?: boolean;
  /** FTR-RELATED-PAPERS: bibliographic coupling signal (how many shared references) */
  relatedSharedRefCount?: number;
  /** FTR-RELATED-PAPERS: up to a few shared reference titles for tooltip explanation */
  relatedSharedRefTitles?: string[];
  /** FTR-RELATED-PAPERS: co-citation signal (how many papers cite both seed and this entry) */
  relatedCoCitationCount?: number;
  /** FTR-RELATED-PAPERS: normalized co-citation cosine similarity in [0, 1] */
  relatedCoCitationScore?: number;
  /** FTR-RELATED-PAPERS: normalized coupling score in [0, 1] */
  relatedCouplingScore?: number;
  /** FTR-RELATED-PAPERS: combined score used for ranking (coupling + co-citation) */
  relatedCombinedScore?: number;
  citationCount?: number;
  citationCountWithoutSelf?: number; // Citation count excluding self-citations
  /** INSPIRE document types (e.g., article, review) */
  documentType?: string[];
  publicationInfo?: any;
  publicationInfoErrata?: Array<{ info: any; label: string; doi?: string }>;
  arxivDetails?: InspireArxivDetails | string | null;
  abstract?: string;
  abstractLoading?: boolean;
  doi?: string; // DOI for journal link and duplicate detection
  texkey?: string; // INSPIRE texkey for quick copy
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
// Citation Graph Types (FTR-CITATION-GRAPH)
// ─────────────────────────────────────────────────────────────────────────────

export type CitationGraphSortMode = "relevance" | "mostrecent" | "mostcited";

export interface CitationGraphNode {
  recid: string;
  title: string;
  inspireUrl: string;
  authorLabel?: string; // "Author et al. (Year)" format
  year?: string;
  citationCount?: number;
  localItemID?: number;
  isSeed: boolean;
}

export interface SeedEdge {
  source: string; // recid of the citing seed
  target: string; // recid of the referenced seed
  type: "seed-to-seed";
}

export interface MultiSeedGraphResult {
  seeds: CitationGraphNode[];
  seedEdges: SeedEdge[];
  references: InspireReferenceEntry[];
  citedBy: InspireReferenceEntry[];
  totals: { references: number; citedBy: number };
  shown: { references: number; citedBy: number };
  sort: CitationGraphSortMode;
  /**
   * Optional per-seed breakdown for UI rendering (edges, seed list stats).
   * Keys are seed recids.
   */
  bySeed?: Record<
    string,
    {
      references: string[]; // recids (shown)
      citedBy: string[]; // recids (shown)
      totals: { references: number; citedBy: number };
      shown: { references: number; citedBy: number };
    }
  >;
}

export type CitationGraphNodeKind = "seed" | "reference" | "citedBy";

export type CitationGraphEdgeType =
  | "seed-to-seed"
  | "seed-to-reference"
  | "cited-by-to-seed";

export interface CitationGraphNodeData {
  recid: string;
  kind: CitationGraphNodeKind;
  title?: string;
  authorLabel?: string;
  year?: string;
  citationCount?: number;
  localItemID?: number;
  inspireUrl?: string;
  arxivId?: string;
  doi?: string;
}

export interface CitationGraphEdgeData {
  source: string;
  target: string;
  type: CitationGraphEdgeType;
}

export interface CitationGraphSaveData {
  version: string;
  createdAt: string;
  seeds: { recid: string; title: string; localItemID?: number }[];
  graph: { nodes: CitationGraphNodeData[]; edges: CitationGraphEdgeData[] };
  viewState?: { panX: number; panY: number; scale: number };
  settings: { sort: CitationGraphSortMode };
}

// ─────────────────────────────────────────────────────────────────────────────
// View Mode Types
// ─────────────────────────────────────────────────────────────────────────────

export type InspireViewMode =
  | "references"
  | "citedBy"
  | "entryCited"
  | "related"
  | "search";

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
export type LocalCacheType =
  | "refs"
  | "citation_graph" // FTR-CITATION-GRAPH: One-hop citation graph snapshots (permanent)
  | "cited"
  | "author"
  | "related"
  | "preprint"
  | "preprintCandidates"
  | "crossref"
  | "ai_summary"
  | "deep_read_doc_index" // FTR-DEEP-READ-LOCAL-CONTEXT: Per-PDF local Deep Read index (permanent)
  | "author_profile" // FTR-AUTHOR-PROFILE: Author profile cache (permanent)
  | "author_papers"; // FTR-AUTHOR-PROFILE: Author papers list cache (permanent)

/**
 * Local cache file structure for persistent storage.
 * Uses short property names to reduce file size.
 */
export interface LocalCacheFile<T> {
  v: number; // version
  t: LocalCacheType; // type
  k: string; // key (recid or author BAI)
  ts: number; // timestamp (Date.now())
  ttl: number; // TTL in hours (-1 = permanent)
  d: T; // data
  c?: boolean; // complete flag (true = fetch completed successfully)
  n?: number; // total count from API (for smart caching: if n <= limit, data is complete)
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep Read Persistent Index Types (FTR-DEEP-READ-LOCAL-CONTEXT)
// ─────────────────────────────────────────────────────────────────────────────

export type DeepReadDocIndexSource =
  | "zotero_fulltext_cache"
  | "pdfworker"
  | "abstract_fallback";

export type DeepReadDocIndexChunk = {
  id: string;
  pageIndex?: number; // 1-based page number if known
  text: string;
  mathScore?: number;
  eqRefs?: string[];
};

export type DeepReadDocIndex = {
  version: 1;
  attachmentId: number;
  parentItemKey?: string;
  pdfItemKey?: string;
  fingerprint: string;
  builtAt: number;
  source: DeepReadDocIndexSource;
  extractedPages?: number;
  totalPages?: number;
  rawText?: string;
  chunks: DeepReadDocIndexChunk[];
};

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
  ageHours?: number; // Age in hours (for local cache)
}

// ─────────────────────────────────────────────────────────────────────────────
// Preprint Watch Types (FTR-PREPRINT-WATCH)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Publication information from INSPIRE for a newly published paper.
 */
export interface PublicationInfo {
  journalTitle: string;
  volume?: string;
  pageStart?: string; // page_start or artid
  year?: number; // Publication year (for date field)
  doi?: string; // Non-arXiv DOI (journal DOI)
  recid?: string; // INSPIRE record ID
  preprintDate?: string; // Original arXiv submission date (preserved for reference)
}

/**
 * Result of checking a single preprint's publication status.
 */
export interface PreprintCheckResult {
  itemID: number;
  arxivId: string;
  title?: string; // Item title (for display)
  status: "published" | "unpublished" | "error" | "not_in_inspire";
  publicationInfo?: PublicationInfo;
  error?: string;
}

/**
 * Summary of batch preprint check operation.
 */
export interface PreprintCheckSummary {
  total: number;
  published: number; // Found new publications
  unpublished: number; // Still preprints
  errors: number; // Check failures
  notInInspire: number; // Not found in INSPIRE
  results: PreprintCheckResult[];
}

/**
 * Options for preprint update operation.
 */
export interface PreprintUpdateOptions {
  updateDoi?: boolean; // Replace arXiv DOI with journal DOI
  updateJournal?: boolean; // Update journalAbbreviation
  updateVolume?: boolean;
  updatePages?: boolean;
  updateDate?: boolean; // Update date to publication year
  preserveArxivInExtra?: boolean; // Keep arXiv info in Extra field
}

/**
 * Single entry in the unified preprint watch cache.
 */
export interface PreprintWatchEntry {
  arxivId: string; // Stable identifier (e.g., "2301.12345")
  itemId?: number; // Zotero item ID for fast lookup (may become stale)
  lastChecked: number; // Timestamp of last INSPIRE check
  status: "unpublished" | "published" | "error";
  publicationInfo?: PublicationInfo; // Only set when status === "published"
}

/**
 * Unified preprint watch cache structure (single file).
 * Replaces per-arxivId cache files for simpler management.
 */
export interface PreprintWatchCache {
  version: number; // Cache format version
  lastFullScan: number; // Timestamp of last full library scan
  lastCheck: number; // Timestamp of last batch check
  entries: PreprintWatchEntry[];
}
