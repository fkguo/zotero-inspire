// ─────────────────────────────────────────────────────────────────────────────
// PDF Annotate Module - Unified Exports
// FTR-PDF-ANNOTATE: Citation detection and References Panel integration
// ─────────────────────────────────────────────────────────────────────────────

// Re-export types
export type {
  CitationType,
  ParsedCitation,
  CitationPosition,
  MatchResult,
  AlignmentIssue,
  AlignmentReport,
  ScanResult,
  CitationLookupEvent,
  CitationPreviewEvent,
  PageScanCompleteEvent,
  ReaderState,
  ZoteroOverlayReference,
} from "./types";

// Re-export citation parser
export { CitationParser, getCitationParser } from "./citationParser";

// Re-export label matcher
export { LabelMatcher } from "./labelMatcher";

// Re-export reader integration
export {
  ReaderIntegration,
  getReaderIntegration,
} from "./readerIntegration";
export type { OverlayReferenceMapping } from "./readerIntegration";

// Re-export PDF references parser (FTR-PDF-ANNOTATE-MULTI-LABEL)
export type { PDFReferenceMapping, PDFPaperInfo } from "./pdfReferencesParser";
export {
  PDFReferencesParser,
  getPDFReferencesParser,
} from "./pdfReferencesParser";

// Re-export shared utilities (FTR-REFACTOR: Centralized scoring and author utilities)
export {
  SCORE,
  YEAR_DELTA,
  PARSE_CONFIG,
  MATCH_CONFIG,
} from "./constants";
export type { MatchConfidence, MatchMethod } from "./constants";

export {
  normalizeArxivId,
  normalizeDoi,
  normalizeJournal,
  journalsSimilar,
  isJournalMatch,
  calculateCompositeScore,
  getStrongMatchKind,
  scorePdfPaperInfos,
  selectBestPdfPaperInfo,
  scoreEntryForAuthorYear,
} from "./matchScoring";
export type { CompositeScore, AuthorYearScore } from "./matchScoring";

export {
  normalizeAuthorName,
  normalizeAuthorCompact,
  extractLastName,
  authorsMatch,
  isCollaboration,
  extractCollaborationName,
  buildInitialsPattern,
  buildDifferentInitialsPattern,
  parseAuthorLabels,
} from "./authorUtils";
