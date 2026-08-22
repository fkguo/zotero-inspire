// Primitive-only contracts for bounded Zotero 10 native overlay reuse.
// Host Reader/PDF.js objects must never cross a synchronous adapter call.

export const NATIVE_OVERLAY_LIMITS = Object.freeze({
  maxPages: 100,
  maxOverlaySlots: 16_384,
  maxReferencesPerOverlay: 4_096,
  maxReferenceSlots: 65_536,
  maxWordSlots: 256,
  maxWordUnits: 256,
  maxNumericLabelsPerOverlay: 101,
  maxLabelDigits: 6,
  maxReferenceTextUnits: 20_000,
  maxReferenceTextWorkUnits: 8_000_000,
  maxRetainedTextUnits: 2_000_000,
  // Monotone, nonrefundable work charge; live retained records use the
  // separate 32,768 per-state limit and the global memory accountant.
  maxDurableWorkRecords: 65_536,
  maxLiveRecords: 32_768,
  maxScannerSteps: 65_536,
  maxNumericOccurrences: 65_536,
  maxTokensPerLabel: 256,
  maxBatchLabels: 101,
  maxBatchTokens: 2_048,
  maxMatcherSourceEntries: 16_384,
  maxGenericCandidates: 4,
  maxIdentifierUnits: 512,
  maxJournalUnits: 96,
  maxVolumePageUnits: 32,
  reliableLabelMinimum: 3,
  maxReaderStates: 8,
  maxManagerReaders: 64,
  maxWindowSlots: 64,
  maxDocumentEpochs: 3,
  maxPreReadyContextReplacements: 3,
  maxServiceMilliseconds: 10 * 60 * 1_000,
  readyProbeMilliseconds: 250,
  sliceStructuralUnits: 2_048,
  sliceTextUnits: 50_000,
});

export interface NativeGenericJournalToken {
  journal: string;
  volume: string;
  page: string;
}

/** One pre-tokenized reference segment, in original source order. */
export interface NativeOverlayToken {
  arxiv?: string;
  doi?: string;
  exactJournalKey?: string;
  genericJournal?: NativeGenericJournalToken;
}

/**
 * A completed map is Reader/document scoped. It may be supplied only for one
 * synchronous matcher call and must not be stored by LabelMatcher.
 */
export interface NativeOverlayMatchPackage {
  readonly tokenMap: ReadonlyMap<string, readonly NativeOverlayToken[]>;
  readonly revision: number;
}

/** Primitive anchor captured when the citation UI is constructed. */
export type NativeOriginAnchor =
  | {
      readonly kind: "state";
      readonly stateID: number;
      readonly sourceAttachmentItemID: number;
      readonly browsingContextID: string;
    }
  | {
      readonly kind: "pending";
      readonly pendingAdmissionID: number;
      readonly sourceAttachmentItemID: number;
      readonly browsingContextID: string;
    };

/** Opaque scalar authorization for one completed Reader/document revision. */
export type NativeOverlayReadToken = string;

export type NativeCitationFormat = "numeric" | "author-year";

export interface NativeSelectionEvidence {
  format: NativeCitationFormat;
  originAnchor?: NativeOriginAnchor;
}

export interface NativeFormatFingerprint {
  readonly size: number;
  readonly lastModified: number;
}

export interface NativeFormatHint {
  readonly attachmentItemID: number;
  readonly generation: number;
  readonly fingerprint: NativeFormatFingerprint;
  readonly format: NativeCitationFormat;
}
