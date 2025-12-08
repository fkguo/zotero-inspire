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

// Re-export PDF references parser (FTR-PDF-ANNOTATE-MULTI-LABEL)
export type { PDFReferenceMapping, PDFPaperInfo } from "./pdfReferencesParser";
export {
  PDFReferencesParser,
  getPDFReferencesParser,
  buildLabelToIndicesMap,
} from "./pdfReferencesParser";

// Re-export match strategies (FTR-PDF-MATCHING: Strategy pattern)
export type {
  MatchContext,
  MatchHelpers,
  MatchStrategy,
  StrongMatchKind,
} from "./matchStrategies";
export {
  StrategyCoordinator,
  StrongIdentifierStrategy,
  VersionMismatchStrategy,
  PDFSequenceMappingStrategy,
  GlobalBestMatchStrategy,
  InspireLabelStrategy,
  IndexFallbackStrategy,
  FuzzyMatchStrategy,
  createDefaultCoordinator,
} from "./matchStrategies";

