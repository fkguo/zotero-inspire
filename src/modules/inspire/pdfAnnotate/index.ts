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
  PageScanCompleteEvent,
  ReaderState,
} from "./types";

// Re-export citation parser
export { CitationParser, getCitationParser } from "./citationParser";

// Re-export label matcher
export { LabelMatcher } from "./labelMatcher";

// Re-export reader integration
export { ReaderIntegration, getReaderIntegration } from "./readerIntegration";

