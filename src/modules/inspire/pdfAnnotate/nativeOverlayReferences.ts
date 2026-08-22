import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";
import { addNativeRawPair, ensureNativeLabel } from "./nativeOverlayCollection";
import type {
  NativeBuildSliceBudget,
  NativeBuildSliceResult,
  NativeOverlayBuildState,
} from "./nativeOverlayBuildTypes";
import {
  getNativeObjectIdentity,
  getOwnDataDescriptor as own,
  readDenseArrayLength as readArrayLength,
  reserveNativeText as reserveText,
  terminateNativeBuild as terminate,
} from "./nativeOverlayBuilderUtils";

type ReacquiredOverlay = {
  kind: "ready";
  word: any[];
  references: any[];
};

type VerificationReference =
  | { kind: "valid"; text: string; index?: number }
  | { kind: "malformed"; textUnits: number }
  | { kind: "terminal"; code: string };

/** Continues one overlay without retaining any host object across slices. */
export function advanceNativeOverlay(
  page: any[],
  state: NativeOverlayBuildState,
  budget: NativeBuildSliceBudget,
): NativeBuildSliceResult | undefined {
  const scratch = state.scratch!;
  const reacquired = reacquireOverlay(page, state);
  if (reacquired.kind !== "ready") return reacquired;

  while (
    scratch.referenceCursor < scratch.referenceLength &&
    hasBudget(budget)
  ) {
    const result = copyReference(
      reacquired.references,
      scratch.referenceCursor++,
      state,
      budget,
    );
    scratch.visitedReferences++;
    if (result) return result;
  }
  if (scratch.referenceCursor < scratch.referenceLength) {
    return { kind: "progress" };
  }
  if (scratch.visitedReferences !== scratch.referenceLength) {
    return terminate(state, "references-reacquire-shape");
  }

  const wordVerification = verifyWord(reacquired.word, state, budget);
  if (wordVerification) return wordVerification;
  const referenceVerification = verifyReferences(
    reacquired.references,
    state,
    budget,
  );
  if (referenceVerification) return referenceVerification;

  while (
    scratch.attachLabelCursor < scratch.labels.length &&
    hasBudget(budget)
  ) {
    const label = scratch.labels[scratch.attachLabelCursor];
    const target = parseInt(label, 10);
    const indexed = scratch.referencesByIndex.get(target) || [];
    const selected = indexed.length
      ? indexed
      : scratch.labels.length === 1
        ? scratch.references
        : [];
    while (
      scratch.attachReferenceCursor < selected.length &&
      hasBudget(budget)
    ) {
      const durableBefore = state.durableRecords;
      if (
        !addNativeRawPair(
          label,
          selected[scratch.attachReferenceCursor++].text,
          state,
        )
      ) {
        return { kind: "terminal", code: state.terminalCode || "raw-pair-cap" };
      }
      budget.structural -= Math.max(1, state.durableRecords - durableBefore);
    }
    if (scratch.attachReferenceCursor < selected.length) {
      return { kind: "progress" };
    }
    const durableBefore = state.durableRecords;
    if (!ensureNativeLabel(label, state)) {
      return { kind: "terminal", code: state.terminalCode || "label-cap" };
    }
    budget.structural -= state.durableRecords - durableBefore;
    scratch.attachLabelCursor++;
    scratch.attachReferenceCursor = 0;
  }
  if (scratch.attachLabelCursor < scratch.labels.length) {
    return { kind: "progress" };
  }
  state.retainedTextUnits = Math.max(
    0,
    state.retainedTextUnits - scratch.retainedTextUnits,
  );
  state.scratch = undefined;
  state.overlayCursor++;
  return undefined;
}

function reacquireOverlay(
  page: any[],
  state: NativeOverlayBuildState,
): ReacquiredOverlay | NativeBuildSliceResult {
  const scratch = state.scratch!;
  const overlaySlot = own(page, String(scratch.overlayIndex));
  if (
    !overlaySlot ||
    !("value" in overlaySlot) ||
    !overlaySlot.value ||
    typeof overlaySlot.value !== "object"
  ) {
    return terminate(state, "overlay-reacquire-shape");
  }
  const overlay = overlaySlot.value;
  const overlayIdentity = getNativeObjectIdentity(overlay);
  if (overlayIdentity === undefined) {
    return terminate(state, "object-identity-cap");
  }
  const type = own(overlay, "type");
  if (
    overlayIdentity !== scratch.overlayIdentity ||
    !type ||
    !("value" in type) ||
    type.value !== "citation"
  ) {
    return terminate(state, "overlay-reacquire-shape");
  }

  const wordDescriptor = own(overlay, "word");
  if (
    !wordDescriptor ||
    !("value" in wordDescriptor) ||
    !Array.isArray(wordDescriptor.value)
  ) {
    return terminate(state, "word-reacquire-shape");
  }
  const wordIdentity = getNativeObjectIdentity(wordDescriptor.value);
  const wordLength = readArrayLength(wordDescriptor.value);
  if (
    wordIdentity === undefined ||
    wordIdentity !== scratch.wordIdentity ||
    wordLength !== scratch.wordLength
  ) {
    return terminate(state, "word-reacquire-shape");
  }

  const refsDescriptor = own(overlay, "references");
  if (
    !refsDescriptor ||
    !("value" in refsDescriptor) ||
    !Array.isArray(refsDescriptor.value)
  ) {
    return terminate(state, "references-reacquire-shape");
  }
  const referencesIdentity = getNativeObjectIdentity(refsDescriptor.value);
  const referenceLength = readArrayLength(refsDescriptor.value);
  if (
    referencesIdentity === undefined ||
    referencesIdentity !== scratch.referencesIdentity ||
    referenceLength !== scratch.referenceLength
  ) {
    return terminate(state, "references-reacquire-shape");
  }
  return {
    kind: "ready",
    word: wordDescriptor.value,
    references: refsDescriptor.value,
  };
}

function verifyWord(
  word: any[],
  state: NativeOverlayBuildState,
  budget: NativeBuildSliceBudget,
): NativeBuildSliceResult | undefined {
  const scratch = state.scratch!;
  while (scratch.verifyWordCursor < scratch.wordLength) {
    if (!hasBudget(budget)) return { kind: "progress" };
    if (scratch.verifyWordCursor >= scratch.verifyWordChunkEnd) {
      budget.structural--;
      scratch.verifyWordChunkEnd = Math.min(
        scratch.wordLength,
        scratch.verifyWordCursor + 16,
      );
    }
    if (!hasBudget(budget)) return { kind: "progress" };
    const slot = own(word, String(scratch.verifyWordCursor));
    if (
      !slot ||
      !("value" in slot) ||
      !slot.value ||
      typeof slot.value !== "object"
    ) {
      return terminate(state, "word-reacquire-shape");
    }
    const char = own(slot.value, "c");
    if (!char || !("value" in char) || typeof char.value !== "string") {
      return terminate(state, "word-reacquire-shape");
    }
    const end = scratch.verifyWordUnitCursor + char.value.length;
    if (
      end > scratch.wordText.length ||
      scratch.wordText.slice(scratch.verifyWordUnitCursor, end) !== char.value
    ) {
      return terminate(state, "word-reacquire-shape");
    }
    budget.text -= char.value.length;
    scratch.verifyWordUnitCursor = end;
    scratch.verifyWordCursor++;
  }
  return scratch.verifyWordUnitCursor === scratch.wordText.length
    ? undefined
    : terminate(state, "word-reacquire-shape");
}

function verifyReferences(
  refs: any[],
  state: NativeOverlayBuildState,
  budget: NativeBuildSliceBudget,
): NativeBuildSliceResult | undefined {
  const scratch = state.scratch!;
  while (
    scratch.verifyReferenceCursor < scratch.referenceLength &&
    hasBudget(budget)
  ) {
    const sourceSlot = scratch.verifyReferenceCursor++;
    budget.structural--;
    const current = readVerificationReference(refs, sourceSlot);
    if (current.kind === "terminal") {
      return terminate(state, current.code);
    }
    const textUnits =
      current.kind === "valid" ? current.text.length : current.textUnits;
    state.referenceVerificationTextWork += textUnits;
    budget.text -= textUnits;
    if (
      state.referenceVerificationTextWork >
      NATIVE_OVERLAY_LIMITS.maxReferenceTextWorkUnits
    ) {
      return terminate(state, "reference-verification-text-work-cap");
    }
    const expected = scratch.references[scratch.verifyValidReferenceCursor];
    if (current.kind === "malformed") {
      if (expected && expected.sourceSlot <= sourceSlot) {
        return terminate(state, "references-reacquire-shape");
      }
      continue;
    }
    if (
      !expected ||
      expected.sourceSlot !== sourceSlot ||
      expected.text !== current.text ||
      expected.index !== current.index
    ) {
      return terminate(state, "references-reacquire-shape");
    }
    scratch.verifyValidReferenceCursor++;
  }
  if (scratch.verifyReferenceCursor < scratch.referenceLength) {
    return { kind: "progress" };
  }
  return scratch.verifyValidReferenceCursor === scratch.references.length
    ? undefined
    : terminate(state, "references-reacquire-shape");
}

function readVerificationReference(
  refs: any[],
  sourceSlot: number,
): VerificationReference {
  const slot = own(refs, String(sourceSlot));
  if (
    !slot ||
    !("value" in slot) ||
    !slot.value ||
    typeof slot.value !== "object"
  ) {
    return { kind: "malformed", textUnits: 0 };
  }
  const text = own(slot.value, "text");
  if (!text) return { kind: "malformed", textUnits: 0 };
  if (!("value" in text) || typeof text.value !== "string") {
    return { kind: "terminal", code: "reference-text-shape" };
  }
  if (text.value.length > NATIVE_OVERLAY_LIMITS.maxReferenceTextUnits) {
    return { kind: "terminal", code: "reference-text-cap" };
  }
  const indexDescriptor = own(slot.value, "index");
  let nativeIndex: number | undefined;
  if (indexDescriptor) {
    if (
      !("value" in indexDescriptor) ||
      typeof indexDescriptor.value !== "number" ||
      !Number.isSafeInteger(indexDescriptor.value)
    ) {
      return { kind: "terminal", code: "reference-index-shape" };
    }
    if (indexDescriptor.value <= 0) {
      return { kind: "malformed", textUnits: text.value.length };
    }
    nativeIndex = indexDescriptor.value;
  }
  return { kind: "valid", text: text.value, index: nativeIndex };
}

function copyReference(
  refs: any[],
  sourceSlot: number,
  state: NativeOverlayBuildState,
  budget: NativeBuildSliceBudget,
): NativeBuildSliceResult | undefined {
  state.referenceSlots++;
  budget.structural--;
  if (state.referenceSlots > NATIVE_OVERLAY_LIMITS.maxReferenceSlots) {
    return terminate(state, "reference-slot-cap");
  }
  const slot = own(refs, String(sourceSlot));
  if (
    !slot ||
    !("value" in slot) ||
    !slot.value ||
    typeof slot.value !== "object"
  ) {
    state.malformedReferenceSlots++;
    return undefined;
  }
  const text = own(slot.value, "text");
  if (!text) {
    state.malformedReferenceSlots++;
    return undefined;
  }
  if (!("value" in text) || typeof text.value !== "string") {
    return terminate(state, "reference-text-shape");
  }
  if (text.value.length > NATIVE_OVERLAY_LIMITS.maxReferenceTextUnits) {
    return terminate(state, "reference-text-cap");
  }
  state.referenceTextWork += text.value.length;
  budget.text -= text.value.length;
  if (
    state.referenceTextWork > NATIVE_OVERLAY_LIMITS.maxReferenceTextWorkUnits
  ) {
    return terminate(state, "reference-text-work-cap");
  }
  const indexDescriptor = own(slot.value, "index");
  let nativeIndex: number | undefined;
  if (indexDescriptor) {
    if (
      !("value" in indexDescriptor) ||
      typeof indexDescriptor.value !== "number" ||
      !Number.isSafeInteger(indexDescriptor.value)
    ) {
      return terminate(state, "reference-index-shape");
    }
    if (indexDescriptor.value <= 0) {
      state.malformedReferenceSlots++;
      return undefined;
    }
    nativeIndex = indexDescriptor.value;
  }
  if (!reserveText(state, text.value.length)) {
    return terminate(state, "retained-text-cap");
  }
  const existingBucket =
    nativeIndex === undefined
      ? undefined
      : state.scratch!.referencesByIndex.get(nativeIndex);
  const addedScratchRecords =
    3 + (nativeIndex !== undefined && !existingBucket ? 1 : 0);
  if (
    state.liveRecords + state.scratch!.liveRecords + addedScratchRecords >
    NATIVE_OVERLAY_LIMITS.maxLiveRecords
  ) {
    state.retainedTextUnits -= text.value.length;
    return terminate(state, "live-record-cap");
  }
  const primitive = { sourceSlot, text: text.value, index: nativeIndex };
  state.scratch!.references.push(primitive);
  state.scratch!.liveRecords += addedScratchRecords;
  state.scratch!.retainedTextUnits += text.value.length;
  if (nativeIndex !== undefined) {
    const bucket = existingBucket || [];
    bucket.push(primitive);
    state.scratch!.referencesByIndex.set(nativeIndex, bucket);
  }
  return undefined;
}

function hasBudget(budget: NativeBuildSliceBudget): boolean {
  return (
    budget.structural > 0 && budget.text > 0 && budget.now() < budget.deadline
  );
}
