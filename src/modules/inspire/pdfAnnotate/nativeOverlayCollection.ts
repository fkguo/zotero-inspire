import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";
import type {
  NativeBuildSliceBudget,
  NativeOverlayBuildState,
} from "./nativeOverlayBuilder";
import {
  getNativeObjectIdentity,
  getOwnDataDescriptor as own,
} from "./nativeOverlayBuilderUtils";

export interface NativeOverlayLabelContinuity {
  readonly overlayIdentity: number;
  readonly referencesIdentity: number;
  readonly referenceLength: number;
}

export type NativeOverlayLabelRead =
  | { kind: "progress" }
  | { kind: "skip" }
  | {
      kind: "complete";
      labels: string[];
      wordIdentity: number;
      wordLength: number;
      wordText: string;
    };

export function readNativeOverlayLabels(
  overlay: object,
  state: NativeOverlayBuildState,
  budget: NativeBuildSliceBudget,
  continuity: NativeOverlayLabelContinuity,
): NativeOverlayLabelRead {
  const word = own(overlay, "word");
  if (!word || !("value" in word) || !Array.isArray(word.value)) {
    return state.labelScratch
      ? terminateLabelScan(state, "overlay-reacquire-shape")
      : { kind: "skip" };
  }
  const lengthDescriptor = own(word.value, "length");
  const length =
    lengthDescriptor &&
    "value" in lengthDescriptor &&
    Number.isSafeInteger(lengthDescriptor.value)
      ? lengthDescriptor.value
      : undefined;
  if (
    length === undefined ||
    length < 0 ||
    length > NATIVE_OVERLAY_LIMITS.maxWordSlots
  )
    return state.labelScratch
      ? terminateLabelScan(state, "overlay-reacquire-shape")
      : { kind: "skip" };
  const wordIdentity = getNativeObjectIdentity(word.value);
  if (wordIdentity === undefined) {
    return terminateLabelScan(state, "object-identity-cap");
  }

  let scan = state.labelScratch;
  if (scan) {
    if (
      scan.pageIndex !== state.pageCursor ||
      scan.overlayIndex !== state.overlayCursor ||
      scan.overlayIdentity !== continuity.overlayIdentity ||
      scan.referencesIdentity !== continuity.referencesIdentity ||
      scan.referenceLength !== continuity.referenceLength ||
      scan.wordIdentity !== wordIdentity ||
      scan.wordLength !== length
    ) {
      return terminateLabelScan(state, "overlay-reacquire-shape");
    }
  } else {
    if (state.liveRecords + 1 > NATIVE_OVERLAY_LIMITS.maxLiveRecords) {
      fail(state, "live-record-cap");
      return { kind: "skip" };
    }
    scan = state.labelScratch = {
      pageIndex: state.pageCursor,
      overlayIndex: state.overlayCursor,
      overlayIdentity: continuity.overlayIdentity,
      referencesIdentity: continuity.referencesIdentity,
      referenceLength: continuity.referenceLength,
      wordIdentity,
      wordLength: length,
      cursor: 0,
      chunkEnd: 0,
      joined: "",
    };
    state.liveRecords++;
  }

  while (scan.cursor < length) {
    if (!hasBudget(budget)) return { kind: "progress" };
    if (scan.cursor >= scan.chunkEnd) {
      state.wordChunks++;
      budget.structural--;
      if (state.wordChunks > NATIVE_OVERLAY_LIMITS.maxOverlaySlots) {
        return terminateLabelScan(state, "word-chunk-cap");
      }
      scan.chunkEnd = Math.min(length, scan.cursor + 16);
    }
    if (!hasBudget(budget)) return { kind: "progress" };
    const slot = own(word.value, String(scan.cursor));
    if (
      !slot ||
      !("value" in slot) ||
      !slot.value ||
      typeof slot.value !== "object"
    ) {
      return finishLabelScan(state, { kind: "skip" });
    }
    const char = own(slot.value, "c");
    if (!char || !("value" in char) || typeof char.value !== "string") {
      return finishLabelScan(state, { kind: "skip" });
    }
    if (
      char.value.length >
      NATIVE_OVERLAY_LIMITS.maxWordUnits - scan.joined.length
    ) {
      return finishLabelScan(state, { kind: "skip" });
    }
    if (
      state.wordSlots + 1 > 131_072 ||
      state.wordUnits + char.value.length > 131_072
    ) {
      return terminateLabelScan(state, "word-work-cap");
    }
    if (
      state.retainedTextUnits + char.value.length >
      NATIVE_OVERLAY_LIMITS.maxRetainedTextUnits
    ) {
      return terminateLabelScan(state, "retained-text-cap");
    }
    state.wordSlots++;
    state.wordUnits += char.value.length;
    state.retainedTextUnits += char.value.length;
    budget.text -= char.value.length;
    scan.joined += char.value;
    scan.cursor++;
  }
  if (!hasBudget(budget)) return { kind: "progress" };
  const matches = scan.joined.match(/\d+/g) || [];
  state.numericOccurrences += matches.length;
  budget.structural -= matches.length;
  if (state.numericOccurrences > NATIVE_OVERLAY_LIMITS.maxNumericOccurrences) {
    return terminateLabelScan(state, "numeric-occurrence-cap");
  }
  if (
    matches.length > NATIVE_OVERLAY_LIMITS.maxNumericLabelsPerOverlay ||
    matches.some((value) => value.length > NATIVE_OVERLAY_LIMITS.maxLabelDigits)
  )
    return finishLabelScan(state, { kind: "skip" });
  return finishLabelScan(state, {
    kind: "complete",
    labels: matches,
    wordIdentity,
    wordLength: length,
    wordText: scan.joined,
  });
}

function hasBudget(budget: NativeBuildSliceBudget): boolean {
  return (
    budget.structural > 0 && budget.text > 0 && budget.now() < budget.deadline
  );
}

function finishLabelScan<T extends NativeOverlayLabelRead>(
  state: NativeOverlayBuildState,
  result: T,
): T {
  const scan = state.labelScratch;
  if (scan) {
    state.retainedTextUnits = Math.max(
      0,
      state.retainedTextUnits - scan.joined.length,
    );
    state.liveRecords = Math.max(0, state.liveRecords - 1);
    state.labelScratch = undefined;
  }
  return result;
}

function terminateLabelScan(
  state: NativeOverlayBuildState,
  code: string,
): NativeOverlayLabelRead {
  fail(state, code);
  return finishLabelScan(state, { kind: "skip" });
}

export function ensureNativeLabel(
  label: string,
  state: NativeOverlayBuildState,
): boolean {
  if (state.rawByLabel.has(label)) return true;
  const scratchRecords = state.scratch?.liveRecords || 0;
  if (
    state.durableRecords + 2 > NATIVE_OVERLAY_LIMITS.maxDurableWorkRecords ||
    state.liveRecords + scratchRecords + 2 >
      NATIVE_OVERLAY_LIMITS.maxLiveRecords ||
    state.retainedTextUnits + label.length >
      NATIVE_OVERLAY_LIMITS.maxRetainedTextUnits
  ) {
    fail(
      state,
      state.durableRecords + 2 > NATIVE_OVERLAY_LIMITS.maxDurableWorkRecords
        ? "durable-record-cap"
        : state.liveRecords + scratchRecords + 2 >
            NATIVE_OVERLAY_LIMITS.maxLiveRecords
          ? "live-record-cap"
          : "retained-text-cap",
    );
    return false;
  }
  state.rawByLabel.set(label, []);
  state.dedupByLabel.set(label, new Set());
  state.tokenMap.set(label, []);
  state.labelOrder.push(label);
  state.durableRecords += 2;
  state.liveRecords += 2;
  state.retainedTextUnits += label.length;
  return true;
}

export function addNativeRawPair(
  label: string,
  text: string,
  state: NativeOverlayBuildState,
): boolean {
  if (!ensureNativeLabel(label, state)) return false;
  const seen = state.dedupByLabel.get(label)!;
  if (seen.has(text)) return true;
  const scratchRecords = state.scratch?.liveRecords || 0;
  const removesEmptyMarker = state.rawByLabel.get(label)!.length === 0 ? 1 : 0;
  if (
    state.durableRecords + 3 > NATIVE_OVERLAY_LIMITS.maxDurableWorkRecords ||
    state.liveRecords + scratchRecords + 3 - removesEmptyMarker >
      NATIVE_OVERLAY_LIMITS.maxLiveRecords ||
    state.retainedTextUnits + text.length >
      NATIVE_OVERLAY_LIMITS.maxRetainedTextUnits
  ) {
    fail(
      state,
      state.durableRecords + 3 > NATIVE_OVERLAY_LIMITS.maxDurableWorkRecords
        ? "durable-record-cap"
        : state.liveRecords + scratchRecords + 3 - removesEmptyMarker >
            NATIVE_OVERLAY_LIMITS.maxLiveRecords
          ? "live-record-cap"
          : "retained-text-cap",
    );
    return false;
  }
  state.retainedTextUnits += text.length;
  state.liveRecords += 3 - removesEmptyMarker;
  seen.add(text);
  state.dedupMembershipRecords++;
  state.rawByLabel.get(label)!.push(text);
  state.durableRecords += 3;
  return true;
}

function fail(state: NativeOverlayBuildState, code: string): void {
  state.phase = "terminal";
  state.terminalCode = code;
}
