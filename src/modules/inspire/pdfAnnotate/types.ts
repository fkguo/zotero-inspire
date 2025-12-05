// ─────────────────────────────────────────────────────────────────────────────
// PDF Annotate Types
// FTR-PDF-ANNOTATE: Citation detection and References Panel integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation type detected from PDF text
 */
export type CitationType = "numeric" | "author-year" | "arxiv" | "mixed" | "unknown";

/**
 * Parsed citation from PDF text
 */
export interface ParsedCitation {
  /** Original raw text (e.g., "[1,2,5]") */
  raw: string;
  /** Citation format type */
  type: CitationType;
  /** Extracted labels (e.g., ["1", "2", "5"]) */
  labels: string[];
  /** Position information (optional, filled by scanner) */
  position?: CitationPosition | null;
}

/**
 * Position of a citation in the PDF
 */
export interface CitationPosition {
  pageIndex: number;
  rect?: DOMRect;
  textNode?: Text;
}

/**
 * Result of matching a PDF label to an INSPIRE entry
 */
export interface MatchResult {
  /** The PDF label that was matched */
  pdfLabel: string;
  /** Index in the entries array */
  entryIndex: number;
  /** The matched entry (optional, for convenience) */
  entryId?: string;
  /** Confidence level of the match */
  confidence: "high" | "medium" | "low";
  /** How the match was determined */
  matchMethod: "exact" | "inferred" | "fuzzy";
}

/**
 * Issue found during label alignment diagnosis
 */
export interface AlignmentIssue {
  index: number;
  type: "missing" | "misaligned";
  expected: string;
  actual: string | null;
}

/**
 * Report from label alignment diagnosis
 */
export interface AlignmentReport {
  totalEntries: number;
  alignedCount: number;
  issues: AlignmentIssue[];
  recommendation: "USE_INSPIRE_LABEL" | "USE_INDEX_WITH_FALLBACK" | "USE_INDEX_ONLY";
}

/**
 * Result from scanning a PDF page for citations
 */
export interface ScanResult {
  pageIndex: number;
  citations: ParsedCitation[];
  scanTime: number;
}

/**
 * Citation lookup event data (emitted to controller)
 */
export interface CitationLookupEvent {
  /** Parent item ID (the paper being read) */
  parentItemID: number;
  /** Parsed citation from selection */
  citation: ParsedCitation;
  /** Reader tab ID */
  readerTabID?: string;
}

/**
 * Page scan complete event data
 */
export interface PageScanCompleteEvent {
  readerTabID: string;
  results: ScanResult[];
}

/**
 * State tracked for a Reader instance
 */
export interface ReaderState {
  tabID: string;
  itemID: number;
  parentItemID: number;
  scannedPages: Set<number>;
  citations: Map<number, ParsedCitation[]>;
}

