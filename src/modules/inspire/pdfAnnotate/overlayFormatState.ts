import {
  NativeFormatCache,
  type NativeFormatCompletion,
} from "./nativeFormatCache";
import type { NativeReaderState } from "./overlayLifecycle";

export function ensureNativeFormat(
  cache: NativeFormatCache,
  state: NativeReaderState,
  coordinatorGeneration: number,
): void {
  const generation = cache.getCurrentGeneration(state.sourceAttachmentItemID);
  if (
    generation &&
    state.verifiedFormatGeneration !== generation &&
    state.formatAttemptedGeneration < generation
  )
    cache.enqueue(state.sourceAttachmentItemID, coordinatorGeneration);
}

export function applyNativeFormatCompletion(
  states: Iterable<NativeReaderState>,
  completion: NativeFormatCompletion,
  coordinatorGeneration: number,
): void {
  if (completion.coordinatorGeneration !== coordinatorGeneration) return;
  for (const state of states) {
    if (state.sourceAttachmentItemID !== completion.attachmentItemID) continue;
    if (completion.invalidateVerified) {
      state.verifiedFormatGeneration = undefined;
      state.verifiedFormatFingerprint = undefined;
      continue;
    }
    state.formatAttemptedGeneration = completion.generation;
    if (completion.fingerprint) {
      state.verifiedFormatGeneration = completion.generation;
      state.verifiedFormatFingerprint = completion.fingerprint;
    }
  }
}
