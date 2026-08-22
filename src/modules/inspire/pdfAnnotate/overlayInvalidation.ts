import { NativeFormatCache } from "./nativeFormatCache";
import { OverlayLifecycleStore } from "./overlayLifecycle";

export function invalidateNativeAttachment(
  lifecycle: OverlayLifecycleStore,
  formatCache: NativeFormatCache,
  attachmentItemID: number,
  destructive: boolean,
  coordinatorGeneration: number,
): void {
  let anyForeground = false;
  let hasState = false;
  for (const state of lifecycle.states.values()) {
    if (state.sourceAttachmentItemID !== attachmentItemID) continue;
    hasState = true;
    state.verifiedFormatGeneration = undefined;
    state.verifiedFormatFingerprint = undefined;
    anyForeground ||= state.foreground;
  }
  if (!hasState && !formatCache.hasLineage(attachmentItemID)) return;
  if (destructive) lifecycle.releaseByAttachment(attachmentItemID);
  formatCache.invalidate(
    attachmentItemID,
    coordinatorGeneration,
    anyForeground && !destructive,
  );
}
