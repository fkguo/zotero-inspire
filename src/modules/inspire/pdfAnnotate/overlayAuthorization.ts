import { LabelMatcher } from "./labelMatcher";
import { NativeOverlayAdapter } from "./nativeOverlayProfile";
import type {
  NativeOverlayMatchPackage,
  NativeOverlayReadToken,
} from "./nativeOverlayTypes";
import { OverlayLifecycleStore } from "./overlayLifecycle";
import { validateNativeReaderSource } from "./overlayCoordinatorUtils";

export function authorizeNativeMatch(
  readToken: NativeOverlayReadToken | undefined,
  matcher: LabelMatcher,
  lifecycle: OverlayLifecycleStore,
  adapter: NativeOverlayAdapter,
): NativeOverlayMatchPackage | undefined {
  if (!readToken) return undefined;
  const stateID = lifecycle.stateByReadToken.get(readToken);
  const state = stateID ? lifecycle.states.get(stateID) : undefined;
  if (
    !state ||
    state.readToken !== readToken ||
    matcher.getSourceAttachmentItemID() !== state.sourceAttachmentItemID ||
    !state.nativePackage ||
    !state.tuple
  )
    return undefined;
  if (readToken !== `native-${state.stateID}-${state.nativePackage.revision}`) {
    lifecycle.releaseDocument(state);
    return undefined;
  }

  const reader = state.readerRef.deref();
  if (!reader) {
    lifecycle.releaseState(state.stateID);
    return undefined;
  }
  if (
    !validateNativeReaderSource(
      lifecycle,
      state,
      reader,
      state.sourceAttachmentItemID,
    )
  ) {
    return undefined;
  }
  const inspection = adapter.inspect(reader, state.tuple);
  if (inspection.kind === "terminal") {
    state.terminalCode = inspection.code;
    lifecycle.releaseDocument(state);
    return undefined;
  }
  if (inspection.kind === "native-page-ineligible") {
    state.terminalCode = "native-page-ineligible";
    lifecycle.releaseDocument(state);
    return undefined;
  }
  if (inspection.kind !== "ready") {
    const contextID = contextFromMarker(inspection.marker);
    if (contextID && contextID !== state.tuple.browsingContextID) {
      lifecycle.acceptBrowsingContext(state, contextID);
    }
    return undefined;
  }
  if (
    inspection.tuple.documentKey === state.tuple.documentKey &&
    inspection.tuple.numPages !== state.tuple.numPages
  ) {
    state.terminalCode = "document-tuple-changed";
    lifecycle.releaseDocument(state);
    return undefined;
  }
  if (inspection.tuple.documentKey !== state.tuple.documentKey) {
    if (inspection.tuple.browsingContextID === state.tuple.browsingContextID) {
      state.terminalCode = "same-context-navigation";
      lifecycle.releaseDocument(state);
    } else {
      lifecycle.acceptBrowsingContext(
        state,
        inspection.tuple.browsingContextID,
      );
    }
    return undefined;
  }
  return state.nativePackage;
}

function contextFromMarker(marker: string | undefined): string | undefined {
  const match = marker?.match(/^(\d+):/);
  return match?.[1];
}
