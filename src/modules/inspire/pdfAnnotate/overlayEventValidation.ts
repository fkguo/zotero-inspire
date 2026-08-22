import type { NativeOverlayAdapter } from "./nativeOverlayProfile";
import type {
  NativeOriginAnchor,
  NativeOverlayReadToken,
} from "./nativeOverlayTypes";
import type { OverlayLifecycleStore } from "./overlayLifecycle";
import {
  monotonicNow,
  needsNativeOverlayWork,
  validateNativeReaderSource,
  validNativeItemID,
} from "./overlayCoordinatorUtils";

export function validateNativeOriginAnchorEvent(
  lifecycle: OverlayLifecycleStore,
  adapter: NativeOverlayAdapter,
  outerReader: unknown,
  sourceAttachmentItemID: number,
  originAnchor: NativeOriginAnchor | undefined,
  requestPrewarm: () => void,
  schedule: () => void,
): NativeOverlayReadToken | undefined {
  if (!originAnchor || !validNativeItemID(sourceAttachmentItemID)) {
    return undefined;
  }
  const state = lifecycle.getByReader(outerReader);
  if (!state) {
    requestPrewarm();
    return undefined;
  }
  if (lifecycle.hasReaderLifetimeTerminal(state)) return undefined;
  const anchorMatches =
    (originAnchor.kind === "state" && originAnchor.stateID === state.stateID) ||
    (originAnchor.kind === "pending" &&
      originAnchor.pendingAdmissionID === state.admittedFromPendingID);
  if (
    !anchorMatches ||
    originAnchor.sourceAttachmentItemID !== sourceAttachmentItemID ||
    !validateNativeReaderSource(
      lifecycle,
      state,
      outerReader,
      sourceAttachmentItemID,
    )
  ) {
    return undefined;
  }
  const context = adapter.readOriginViewContext(outerReader);
  if (!context) return undefined;
  if (context !== originAnchor.browsingContextID) {
    lifecycle.acceptBrowsingContext(state, context);
    if (needsNativeOverlayWork(adapter.enabled, state)) schedule();
    return undefined;
  }
  const inspection = adapter.inspect(outerReader, state.tuple);
  if (
    inspection.kind === "ready" &&
    state.tuple &&
    inspection.tuple.browsingContextID === state.tuple.browsingContextID &&
    inspection.tuple.innerWindowID !== state.tuple.innerWindowID
  ) {
    state.terminalCode = "same-context-navigation";
    lifecycle.releaseDocument(state);
    return undefined;
  }
  if (
    inspection.kind === "ready" &&
    state.tuple?.documentKey === inspection.tuple.documentKey &&
    state.tuple.numPages !== inspection.tuple.numPages
  ) {
    state.terminalCode = "document-tuple-changed";
    lifecycle.releaseDocument(state);
    return undefined;
  }
  if (
    inspection.kind !== "ready" ||
    !state.tuple ||
    inspection.tuple.documentKey !== state.tuple.documentKey
  ) {
    if (inspection.kind === "terminal") {
      state.terminalCode = inspection.code;
      lifecycle.releaseDocument(state);
    } else if (inspection.kind === "native-page-ineligible") {
      state.terminalCode = "native-page-ineligible";
      lifecycle.releaseDocument(state);
    } else if (inspection.kind !== "ready") {
      const changedContext = contextFromMarker(inspection.marker);
      if (changedContext && changedContext !== state.tuple?.browsingContextID) {
        lifecycle.acceptBrowsingContext(state, changedContext);
        if (needsNativeOverlayWork(adapter.enabled, state)) schedule();
      }
    } else if (inspection.kind === "ready") {
      lifecycle.releaseDocument(state);
      if (state.foreground && !state.terminalCode) {
        state.nextProbeAt = monotonicNow();
        schedule();
      }
    }
    return undefined;
  }
  return state.readToken;
}

function contextFromMarker(marker: string | undefined): string | undefined {
  return marker?.match(/^(\d+):/)?.[1];
}
