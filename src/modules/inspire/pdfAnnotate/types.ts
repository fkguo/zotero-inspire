// ─────────────────────────────────────────────────────────────────────────────
// PDF Annotate Types
// FTR-PDF-ANNOTATE: Citation detection and References Panel integration
// ─────────────────────────────────────────────────────────────────────────────

import type { MatchConfidence, MatchMethod } from "./constants";

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
  /**
   * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Sub-citations for complex author-year formats.
   * When a single selection contains multiple distinct citations (e.g., "Bignamini et al. (2009, 2010)"
   * represents 2 separate papers), each sub-citation is stored here with its own display text and labels.
   */
  subCitations?: Array<{
    /** Display text for this citation (e.g., "Bignamini et al. (2009)") */
    displayText: string;
    /** Labels for matching this specific citation */
    labels: string[];
  }>;
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
 * FTR-PDF-MATCHING: Extended with diagnostic fields for user feedback
 * FTR-AMBIGUOUS-AUTHOR-YEAR: Extended with ambiguous candidate support
 */
export interface MatchResult {
  /** The PDF label that was matched */
  pdfLabel: string;
  /** Index in the entries array */
  entryIndex: number;
  /** The matched entry (optional, for convenience) */
  entryId?: string;
  /** Confidence level of the match */
  confidence: MatchConfidence;
  /** How the match was determined */
  matchMethod: MatchMethod;

  // ─────────────────────────────────────────────────────────────────────────
  // FTR-PDF-MATCHING: Extended diagnostic fields for user feedback
  // ─────────────────────────────────────────────────────────────────────────

  /** Identifier that produced the match (if applicable) */
  matchedIdentifier?: {
    type: "arxiv" | "doi" | "journal";
    value: string;
  };
  /** Year difference between PDF and INSPIRE (for year-based matches) */
  yearDelta?: number;
  /** Warning if PDF version differs from INSPIRE version */
  versionMismatchWarning?: string;
  /** Match score (for debugging) */
  score?: number;
  /** FTR-MISSING-FIX: Index of the PDF paper in paperInfos array that this result came from */
  sourcePaperIndex?: number;

  // ─────────────────────────────────────────────────────────────────────────
  // FTR-AMBIGUOUS-AUTHOR-YEAR: Support for ambiguous author-year matches
  // When same first author has multiple papers in the same year, user needs
  // to choose the correct one.
  // ─────────────────────────────────────────────────────────────────────────

  /** True if this match is ambiguous (multiple candidates with same score) */
  isAmbiguous?: boolean;
  /** All candidate matches when ambiguous - user should choose one */
  ambiguousCandidates?: AmbiguousCandidate[];
}

/**
 * FTR-AMBIGUOUS-AUTHOR-YEAR: Candidate for ambiguous author-year match.
 * Contains enough info to display to user for selection.
 */
export interface AmbiguousCandidate {
  /** Index in the entries array */
  entryIndex: number;
  /** Entry ID */
  entryId?: string;
  /** Display text for user (e.g., "Phys. Rev. D 93, 074031 (8 authors)") */
  displayText: string;
  /** Paper title (truncated if too long) */
  title?: string;
  /** Journal abbreviation */
  journal?: string;
  /** Volume */
  volume?: string;
  /** Page start */
  page?: string;
  /** Number of authors */
  authorCount?: number;
  /** Second author's last name (for disambiguation) */
  secondAuthor?: string;
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
 * FTR-PDF-ANNOTATE-MULTI-LABEL: Added labelAvailableCount for availability rate
 */
export interface AlignmentReport {
  totalEntries: number;
  alignedCount: number;
  /** Number of entries with any label (for availability rate calculation) */
  labelAvailableCount?: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// Zotero Structured Page Data Types
// FTR-PDF-STRUCTURED-DATA: Types for Zotero's internal PDF page data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Character data from Zotero's PDF processing
 * Reference: tmp/zotero/reader/src/pdf/selection.js
 */
export interface ZoteroChar {
  /** The character content */
  c: string;
  /** Unicode representation */
  u: string;
  /** Bounding box [x1, y1, x2, y2] */
  rect: [number, number, number, number];
  /** Rotation angle in degrees */
  rotation: number;
  /** Space character follows this char */
  spaceAfter: boolean;
  /** Line break follows this char */
  lineBreakAfter: boolean;
  /** Paragraph break follows this char */
  paragraphBreakAfter: boolean;
  /** Word boundary follows this char */
  wordBreakAfter: boolean;
  /** Character can be ignored (e.g., control chars) */
  ignorable: boolean;
  /** Character is isolated (not part of normal flow) */
  isolated: boolean;
  /** Inline bounding box for rendering */
  inlineRect: [number, number, number, number];
  /** Page index (0-based) */
  pageIndex: number;
  /** Character offset in the page text */
  offset: number;
}

/**
 * Overlay element detected by Zotero in PDF
 * These include citations, links, footnotes, etc.
 */
export interface ZoteroOverlay {
  /** Type of overlay element */
  type: "reference" | "citation" | "internal-link" | "external-link" | "footnote";
  /** Position information */
  position: {
    pageIndex: number;
    rects: [number, number, number, number][];
  };
  /** Referenced items (for citation/reference types) */
  references?: unknown[];
}

/**
 * Structured page data from Zotero's PDF processing
 * Obtained via pdfDocument.getPageData({ pageIndex })
 */
export interface ZoteroPageData {
  /** Character-level data with position and formatting info */
  chars: ZoteroChar[];
  /** Detected overlay elements (citations, links, etc.) */
  overlays: ZoteroOverlay[];
  /** Page viewport [x1, y1, x2, y2] */
  viewBox: [number, number, number, number];
}

/**
 * Processed data for the entire PDF document
 * Obtained via pdfDocument.getProcessedData()
 */
export interface ZoteroProcessedData {
  /** Map of page index to page data */
  pages: Record<number, ZoteroPageData>;
  /** Total page count */
  pageCount?: number;
}

/**
 * Reference entry parsed from structured char data
 * More accurate than text-only parsing
 */
export interface StructuredRefEntry {
  /** Citation label (e.g., "1", "2") */
  label: string | null;
  /** Full text of the reference entry */
  text: string;
  /** Character range in the page */
  charRange: { start: number; end: number };
  /** First author's last name */
  firstAuthor: string | null;
  /** Publication year */
  year: string | null;
  /** arXiv ID if detected */
  arxivId: string | null;
  /** DOI if detected */
  doi: string | null;
  /** Journal name/abbreviation */
  journal: string | null;
  /** Volume number */
  volume: string | null;
  /** Starting page number */
  page: string | null;
}

