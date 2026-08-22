import type { NativeDocumentTuple } from "./nativeOverlayProfile";
import type {
  NativeOverlayMatchPackage,
  NativeOverlayToken,
} from "./nativeOverlayTypes";

export interface PrimitiveNativeReference {
  sourceSlot: number;
  text: string;
  index?: number;
}

export interface NativeOverlayScratch {
  pageIndex: number;
  overlayIndex: number;
  overlayIdentity: number;
  wordIdentity: number;
  wordLength: number;
  wordText: string;
  referencesIdentity: number;
  referenceLength: number;
  labels: string[];
  references: PrimitiveNativeReference[];
  referencesByIndex: Map<number, PrimitiveNativeReference[]>;
  referenceCursor: number;
  verifyWordCursor: number;
  verifyWordUnitCursor: number;
  verifyWordChunkEnd: number;
  verifyReferenceCursor: number;
  verifyValidReferenceCursor: number;
  attachLabelCursor: number;
  attachReferenceCursor: number;
  visitedReferences: number;
  liveRecords: number;
  retainedTextUnits: number;
}

export interface NativeOverlayLabelScratch {
  pageIndex: number;
  overlayIndex: number;
  overlayIdentity: number;
  referencesIdentity: number;
  referenceLength: number;
  wordIdentity: number;
  wordLength: number;
  cursor: number;
  chunkEnd: number;
  joined: string;
}

export type NativeOverlayBuildPhase =
  | "signature"
  | "collect"
  | "tokenize"
  | "publish-signature"
  | "done"
  | "terminal";

export interface NativeOverlayBuildState {
  phase: NativeOverlayBuildPhase;
  tuple: NativeDocumentTuple;
  revision: number;
  signatureAttempts: number;
  signatureInterruptions: number;
  signatureWorkUnits: number;
  signatureOverlaySlots: number;
  signatureCursor: number;
  signatureScratch: Array<[number, number]>;
  signatureCandidate?: Array<[number, number]>;
  acceptedSignature?: Array<[number, number]>;
  pageCursor: number;
  pageCharged: boolean;
  overlayCursor: number;
  overlaySlots: number;
  referenceSlots: number;
  referenceTextWork: number;
  referenceVerificationTextWork: number;
  wordSlots: number;
  wordUnits: number;
  wordChunks: number;
  numericOccurrences: number;
  malformedReferenceSlots: number;
  durableRecords: number;
  liveRecords: number;
  retainedTextUnits: number;
  dependentOriginTextUnits: number;
  scannerSteps: number;
  rawByLabel: Map<string, string[]>;
  dedupByLabel: Map<string, Set<string>>;
  dedupMembershipRecords: number;
  tokenMap: Map<string, NativeOverlayToken[]>;
  labelOrder: string[];
  tokenizeLabelCursor: number;
  tokenizeTextCursor: number;
  tokenizeScanCursor: number;
  tokenizeSegmentStart: number;
  tokenizeHadUseful: boolean;
  tokenizeSkippingWhitespace: boolean;
  tokenizeFallbackPending: boolean;
  tokenizeCurrentRetainsOrigin: boolean;
  labelScratch?: NativeOverlayLabelScratch;
  scratch?: NativeOverlayScratch;
  terminalCode?: string;
}

export type NativeBuildSliceResult =
  | { kind: "progress" }
  | { kind: "complete"; package?: NativeOverlayMatchPackage }
  | { kind: "terminal"; code: string };

export interface NativeBuildSliceBudget {
  structural: number;
  text: number;
  deadline: number;
  now: () => number;
}
