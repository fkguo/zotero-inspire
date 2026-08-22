import {
  NATIVE_OVERLAY_LIMITS,
  type NativeOverlayMatchPackage,
} from "./nativeOverlayTypes";
import type {
  NativeBuildSliceBudget,
  NativeBuildSliceResult,
  NativeOverlayBuildState,
} from "./nativeOverlayBuilder";
import {
  equalNativeSignature as sameSignature,
  getOwnDataDescriptor as own,
  readDenseArrayLength as readArrayLength,
  terminateNativeBuild as terminate,
} from "./nativeOverlayBuilderUtils";

export function runNativeSignatureSlice(
  store: object,
  state: NativeOverlayBuildState,
  budget: NativeBuildSliceBudget,
): NativeBuildSliceResult {
  while (state.signatureCursor < state.tuple.numPages && hasBudget(budget)) {
    const pageIndex = state.signatureCursor++;
    budget.structural--;
    state.signatureWorkUnits++;
    if (state.signatureWorkUnits > 600) {
      return terminate(state, "signature-work-cap");
    }
    const descriptor = own(store, String(pageIndex));
    if (!descriptor) continue;
    if (!("value" in descriptor) || !Array.isArray(descriptor.value)) {
      return terminate(state, "page-array-shape");
    }
    const length = readArrayLength(descriptor.value);
    if (length === undefined) return terminate(state, "page-array-length");
    if (length > NATIVE_OVERLAY_LIMITS.maxOverlaySlots) {
      return terminate(state, "overlay-slot-cap");
    }
    state.signatureScratch.push([pageIndex, length]);
    state.signatureOverlaySlots += length;
    if (state.signatureOverlaySlots > NATIVE_OVERLAY_LIMITS.maxOverlaySlots) {
      return terminate(state, "overlay-slot-cap");
    }
  }
  if (state.signatureCursor < state.tuple.numPages) return { kind: "progress" };

  const completed = state.signatureScratch;
  state.signatureScratch = [];
  state.signatureCursor = 0;
  state.signatureOverlaySlots = 0;
  if (state.phase === "publish-signature") {
    if (
      !state.acceptedSignature ||
      !sameSignature(completed, state.acceptedSignature)
    ) {
      return terminate(state, "publish-signature-changed");
    }
    state.phase = "done";
    state.acceptedSignature = undefined;
    return { kind: "complete", package: getCompletedNativePackage(state) };
  }

  state.signatureAttempts++;
  if (!state.signatureCandidate) {
    state.signatureCandidate = completed;
    return { kind: "progress" };
  }
  if (sameSignature(completed, state.signatureCandidate)) {
    state.acceptedSignature = completed;
    state.signatureCandidate = undefined;
    state.phase = "collect";
    return { kind: "progress" };
  }
  state.signatureCandidate = completed;
  if (state.signatureAttempts >= 4) {
    return terminate(state, "signature-instability-cap");
  }
  return { kind: "progress" };
}

export function interruptNativeSignature(
  state: NativeOverlayBuildState,
): NativeBuildSliceResult {
  if (
    state.signatureCursor === 0 &&
    state.signatureScratch.length === 0 &&
    !state.signatureCandidate
  )
    return { kind: "progress" };
  state.signatureInterruptions++;
  state.signatureCursor = 0;
  state.signatureOverlaySlots = 0;
  state.signatureScratch = [];
  state.signatureCandidate = undefined;
  if (state.signatureInterruptions > 1) {
    return terminate(state, "signature-interruption-cap");
  }
  if (4 - state.signatureAttempts < 2) {
    return terminate(state, "signature-attempts-exhausted-after-interruption");
  }
  return { kind: "progress" };
}

export function getCompletedNativePackage(
  state: NativeOverlayBuildState,
): NativeOverlayMatchPackage | undefined {
  return state.tokenMap.size >= NATIVE_OVERLAY_LIMITS.reliableLabelMinimum
    ? { tokenMap: state.tokenMap, revision: state.revision }
    : undefined;
}

function hasBudget(budget: NativeBuildSliceBudget): boolean {
  return (
    budget.structural > 0 && budget.text > 0 && budget.now() < budget.deadline
  );
}
