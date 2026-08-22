import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";
import {
  NativeOverlayAdapter,
  type NativeDocumentTuple,
} from "./nativeOverlayProfile";
import { runNativeTokenizationSlice } from "./nativeOverlayTokenizer";
import { readNativeOverlayLabels } from "./nativeOverlayCollection";
import {
  equalNativeTuple as sameTuple,
  getNativeObjectIdentity,
  getOwnDataDescriptor as own,
  readDenseArrayLength as readArrayLength,
  reserveNativeText as reserveText,
  terminateNativeBuild as terminate,
} from "./nativeOverlayBuilderUtils";
import {
  getCompletedNativePackage,
  interruptNativeSignature,
  runNativeSignatureSlice,
} from "./nativeOverlaySignature";
import type {
  NativeBuildSliceBudget,
  NativeBuildSliceResult,
  NativeOverlayBuildState,
} from "./nativeOverlayBuildTypes";
import { advanceNativeOverlay } from "./nativeOverlayReferences";
export type {
  NativeBuildSliceBudget,
  NativeBuildSliceResult,
  NativeOverlayBuildPhase,
  NativeOverlayBuildState,
} from "./nativeOverlayBuildTypes";

export function createNativeOverlayBuildState(
  tuple: NativeDocumentTuple,
  revision: number,
): NativeOverlayBuildState {
  return {
    phase: "signature",
    tuple,
    revision,
    signatureAttempts: 0,
    signatureInterruptions: 0,
    signatureWorkUnits: 0,
    signatureOverlaySlots: 0,
    signatureCursor: 0,
    signatureScratch: [],
    pageCursor: 0,
    pageCharged: false,
    overlayCursor: 0,
    overlaySlots: 0,
    referenceSlots: 0,
    referenceTextWork: 0,
    referenceVerificationTextWork: 0,
    wordSlots: 0,
    wordUnits: 0,
    wordChunks: 0,
    numericOccurrences: 0,
    malformedReferenceSlots: 0,
    durableRecords: 0,
    liveRecords: 0,
    retainedTextUnits: 0,
    dependentOriginTextUnits: 0,
    scannerSteps: 0,
    rawByLabel: new Map(),
    dedupByLabel: new Map(),
    dedupMembershipRecords: 0,
    tokenMap: new Map(),
    labelOrder: [],
    tokenizeLabelCursor: 0,
    tokenizeTextCursor: 0,
    tokenizeScanCursor: 0,
    tokenizeSegmentStart: 0,
    tokenizeHadUseful: false,
    tokenizeSkippingWhitespace: false,
    tokenizeFallbackPending: false,
    tokenizeCurrentRetainsOrigin: false,
  };
}

export function releaseNativeOverlayBuildState(
  state: NativeOverlayBuildState,
): void {
  state.signatureScratch.length = 0;
  state.signatureCandidate = undefined;
  state.acceptedSignature = undefined;
  state.labelScratch = undefined;
  state.scratch = undefined;
  state.rawByLabel.clear();
  state.dedupByLabel.clear();
  state.dedupMembershipRecords = 0;
  state.tokenMap.clear();
  state.labelOrder.length = 0;
  state.liveRecords = 0;
  state.retainedTextUnits = 0;
  state.dependentOriginTextUnits = 0;
  state.referenceVerificationTextWork = 0;
  state.tokenizeCurrentRetainsOrigin = false;
}

export function runNativeOverlayBuildSlice(
  adapter: NativeOverlayAdapter,
  reader: unknown,
  state: NativeOverlayBuildState,
  now: () => number,
  deadline: number,
): NativeBuildSliceResult {
  if (state.phase === "terminal") {
    return { kind: "terminal", code: state.terminalCode || "terminal" };
  }
  if (state.phase === "done") {
    return { kind: "complete", package: getCompletedNativePackage(state) };
  }
  const budget: NativeBuildSliceBudget = {
    structural: NATIVE_OVERLAY_LIMITS.sliceStructuralUnits,
    text: NATIVE_OVERLAY_LIMITS.sliceTextUnits,
    deadline,
    now,
  };

  if (state.phase === "tokenize") {
    const inspection = adapter.inspect(reader, state.tuple);
    if (inspection.kind === "pending") return { kind: "progress" };
    if (inspection.kind !== "ready") {
      return terminate(
        state,
        inspection.kind === "terminal"
          ? inspection.code
          : "tokenize-reauthorization",
      );
    }
    if (!sameTuple(inspection.tuple, state.tuple)) {
      return terminate(state, "document-tuple-changed");
    }
    return runNativeTokenizationSlice(state, now, deadline);
  }

  const visited = adapter.withReadyStore(reader, state.tuple, (store) => {
    if (state.phase === "signature" || state.phase === "publish-signature") {
      return runNativeSignatureSlice(store, state, budget);
    }
    return collectSlice(store, state, budget);
  });
  if (visited.inspection.kind !== "ready") {
    if (visited.inspection.kind === "pending") {
      if (state.phase === "collect") return { kind: "progress" };
      if (state.phase === "publish-signature") {
        return terminate(state, "publish-signature-interrupted");
      }
      if (state.phase === "signature") return interruptNativeSignature(state);
    }
    return terminate(
      state,
      visited.inspection.kind === "terminal"
        ? visited.inspection.code
        : "store-reauthorization",
    );
  }
  return visited.value || { kind: "progress" };
}

function collectSlice(
  store: object,
  state: NativeOverlayBuildState,
  budget: NativeBuildSliceBudget,
): NativeBuildSliceResult {
  while (state.pageCursor < state.tuple.numPages && hasBudget(budget)) {
    if (!state.pageCharged) {
      budget.structural--;
      state.pageCharged = true;
      if (!hasBudget(budget)) return { kind: "progress" };
    }
    const pageDescriptor = own(store, String(state.pageCursor));
    if (!pageDescriptor) {
      if (state.scratch || state.labelScratch) {
        return terminate(state, "overlay-reacquire-shape");
      }
      state.pageCursor++;
      state.pageCharged = false;
      state.overlayCursor = 0;
      continue;
    }
    if (!("value" in pageDescriptor) || !Array.isArray(pageDescriptor.value)) {
      return terminate(state, "page-array-shape");
    }
    const page = pageDescriptor.value;
    const pageLength = readArrayLength(page);
    if (pageLength === undefined) return terminate(state, "page-array-length");
    if (
      state.scratch &&
      (state.scratch.pageIndex !== state.pageCursor ||
        state.scratch.overlayIndex !== state.overlayCursor ||
        state.scratch.overlayIndex >= pageLength)
    ) {
      return terminate(state, "overlay-reacquire-shape");
    }
    if (
      state.labelScratch &&
      (state.labelScratch.pageIndex !== state.pageCursor ||
        state.labelScratch.overlayIndex !== state.overlayCursor ||
        state.labelScratch.overlayIndex >= pageLength)
    ) {
      return terminate(state, "overlay-reacquire-shape");
    }
    if (state.overlayCursor >= pageLength) {
      state.pageCursor++;
      state.pageCharged = false;
      state.overlayCursor = 0;
      continue;
    }
    if (!state.scratch) {
      if (
        !state.labelScratch &&
        (budget.structural < 145 || budget.text < 256)
      ) {
        return { kind: "progress" };
      }
      const opened = openOverlay(page, state, budget);
      if (opened) return opened;
      if (!state.scratch) continue;
    }
    const advanced = advanceNativeOverlay(page, state, budget);
    if (advanced) return advanced;
  }
  if (state.pageCursor < state.tuple.numPages) return { kind: "progress" };
  if (state.scratch || state.labelScratch) return { kind: "progress" };
  if (
    state.malformedReferenceSlots > 64 ||
    (state.referenceSlots > 0 &&
      state.malformedReferenceSlots / state.referenceSlots > 0.1)
  ) {
    return terminate(state, "malformed-reference-cap");
  }
  state.liveRecords = Math.max(
    0,
    state.liveRecords - state.dedupMembershipRecords,
  );
  state.dedupByLabel.clear();
  state.dedupMembershipRecords = 0;
  state.phase = "tokenize";
  return { kind: "progress" };
}

function openOverlay(
  page: any[],
  state: NativeOverlayBuildState,
  budget: NativeBuildSliceBudget,
): NativeBuildSliceResult | undefined {
  const slot = own(page, String(state.overlayCursor));
  const resumingLabelScan = state.labelScratch !== undefined;
  if (!resumingLabelScan) {
    state.overlaySlots++;
    budget.structural--;
    if (state.overlaySlots > NATIVE_OVERLAY_LIMITS.maxOverlaySlots) {
      return terminate(state, "overlay-slot-cap");
    }
  }
  if (
    !slot ||
    !("value" in slot) ||
    !slot.value ||
    typeof slot.value !== "object"
  ) {
    return terminate(state, "overlay-slot-shape");
  }
  const overlay = slot.value;
  const overlayIdentity = getNativeObjectIdentity(overlay);
  if (overlayIdentity === undefined) {
    return terminate(state, "object-identity-cap");
  }
  const type = own(overlay, "type");
  if (!type || !("value" in type) || typeof type.value !== "string") {
    return terminate(state, "overlay-type-shape");
  }
  if (type.value !== "citation") {
    if (resumingLabelScan) {
      return terminate(state, "overlay-reacquire-shape");
    }
    state.overlayCursor++;
    return undefined;
  }
  const refs = own(overlay, "references");
  if (!refs || !("value" in refs) || refs.value == null) {
    if (resumingLabelScan) {
      return terminate(state, "references-reacquire-shape");
    }
    state.overlayCursor++;
    return undefined;
  }
  if (!Array.isArray(refs.value)) return terminate(state, "references-shape");
  const referencesIdentity = getNativeObjectIdentity(refs.value);
  if (referencesIdentity === undefined) {
    return terminate(state, "object-identity-cap");
  }
  const refLength = readArrayLength(refs.value);
  if (refLength === undefined) return terminate(state, "references-length");
  if (refLength === 0) {
    if (resumingLabelScan) {
      return terminate(state, "references-reacquire-shape");
    }
    state.overlayCursor++;
    return undefined;
  }
  if (refLength > NATIVE_OVERLAY_LIMITS.maxReferencesPerOverlay) {
    return terminate(state, "per-overlay-reference-cap");
  }
  const labelRead = readNativeOverlayLabels(overlay, state, budget, {
    overlayIdentity,
    referencesIdentity,
    referenceLength: refLength,
  });
  if (state.phase === "terminal") {
    return { kind: "terminal", code: state.terminalCode || "label-work-cap" };
  }
  if (labelRead.kind === "progress") return { kind: "progress" };
  if (labelRead.kind === "skip") {
    state.overlayCursor++;
    return undefined;
  }
  const labels = labelRead.labels;
  const labelTextUnits =
    labels.reduce((sum, label) => sum + label.length, 0) +
    labelRead.wordText.length;
  const scratchRecords = 3 + labels.length;
  if (
    state.liveRecords + scratchRecords > NATIVE_OVERLAY_LIMITS.maxLiveRecords ||
    !reserveText(state, labelTextUnits)
  ) {
    return terminate(
      state,
      state.liveRecords + scratchRecords > NATIVE_OVERLAY_LIMITS.maxLiveRecords
        ? "live-record-cap"
        : "retained-text-cap",
    );
  }
  state.scratch = {
    pageIndex: state.pageCursor,
    overlayIndex: state.overlayCursor,
    overlayIdentity,
    wordIdentity: labelRead.wordIdentity,
    wordLength: labelRead.wordLength,
    wordText: labelRead.wordText,
    referencesIdentity,
    referenceLength: refLength,
    labels,
    references: [],
    referencesByIndex: new Map(),
    referenceCursor: 0,
    verifyWordCursor: 0,
    verifyWordUnitCursor: 0,
    verifyWordChunkEnd: 0,
    verifyReferenceCursor: 0,
    verifyValidReferenceCursor: 0,
    attachLabelCursor: 0,
    attachReferenceCursor: 0,
    visitedReferences: 0,
    liveRecords: scratchRecords,
    retainedTextUnits: labelTextUnits,
  };
  return undefined;
}

function hasBudget(budget: NativeBuildSliceBudget): boolean {
  return (
    budget.structural > 0 && budget.text > 0 && budget.now() < budget.deadline
  );
}
