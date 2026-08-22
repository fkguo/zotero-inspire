import { runNativeOverlayBuildSlice } from "./nativeOverlayBuilder";
import { NativeOverlayAdapter } from "./nativeOverlayProfile";
import {
  OverlayLifecycleStore,
  type NativeReaderState,
} from "./overlayLifecycle";
import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";

export function runOverlayStateSlice(
  adapter: NativeOverlayAdapter,
  lifecycle: OverlayLifecycleStore,
  state: NativeReaderState,
  timestamp: number,
  now: () => number,
  buildMilliseconds: number,
): void {
  const reader = state.readerRef.deref();
  if (!reader) return lifecycle.releaseState(state.stateID);
  if (
    lifecycle.getServiceMilliseconds(state, timestamp) >=
    NATIVE_OVERLAY_LIMITS.maxServiceMilliseconds
  ) {
    state.terminalCode = state.tuple
      ? "build-service-cap"
      : "pre-ready-dormant";
    lifecycle.releaseDocument(state, timestamp);
    return;
  }
  const inspection = adapter.inspect(reader, state.tuple);
  if (inspection.kind === "pending") {
    const contextID = contextFromMarker(inspection.marker);
    if (
      contextID &&
      !lifecycle.acceptBrowsingContext(state, contextID, timestamp)
    )
      return;
    state.incompatibleCode = undefined;
    state.incompatibleMarker = undefined;
    state.incompatibleFirstAt = undefined;
    state.incompatibleCount = 0;
    state.nextProbeAt =
      timestamp + NATIVE_OVERLAY_LIMITS.readyProbeMilliseconds;
    return;
  }
  if (inspection.kind === "incompatible") {
    const contextID = contextFromMarker(inspection.marker);
    if (
      contextID &&
      !lifecycle.acceptBrowsingContext(state, contextID, timestamp)
    )
      return;
    if (
      state.incompatibleCode !== inspection.code ||
      state.incompatibleMarker !== inspection.marker
    ) {
      state.incompatibleCode = inspection.code;
      state.incompatibleMarker = inspection.marker;
      state.incompatibleFirstAt = timestamp;
      state.incompatibleCount = 1;
    } else {
      state.incompatibleCount++;
    }
    if (
      state.incompatibleCount >= 2 &&
      timestamp - (state.incompatibleFirstAt ?? timestamp) >= 5_000
    ) {
      state.terminalCode = inspection.code;
      lifecycle.releaseDocument(state, timestamp);
    } else {
      state.nextProbeAt =
        timestamp + NATIVE_OVERLAY_LIMITS.readyProbeMilliseconds;
    }
    return;
  }
  if (inspection.kind !== "ready") {
    state.terminalCode =
      inspection.kind === "native-page-ineligible"
        ? "native-page-ineligible"
        : inspection.code;
    lifecycle.releaseDocument(state, timestamp);
    return;
  }
  state.incompatibleCode = undefined;
  state.incompatibleMarker = undefined;
  state.incompatibleFirstAt = undefined;
  state.incompatibleCount = 0;
  if (
    !lifecycle.acceptBrowsingContext(
      state,
      inspection.tuple.browsingContextID,
      timestamp,
    )
  )
    return;
  if (
    state.tuple &&
    state.tuple.browsingContextID === inspection.tuple.browsingContextID &&
    state.tuple.innerWindowID !== inspection.tuple.innerWindowID
  ) {
    state.terminalCode = "same-context-navigation";
    lifecycle.releaseDocument(state, timestamp);
    return;
  }
  if (
    state.tuple?.documentKey === inspection.tuple.documentKey &&
    state.tuple.numPages !== inspection.tuple.numPages
  ) {
    state.terminalCode = "document-tuple-changed";
    lifecycle.releaseDocument(state, timestamp);
    return;
  }
  if (
    !lifecycle.bindDocument(state, inspection.tuple, timestamp) ||
    !state.build
  )
    return;
  if (buildMilliseconds < 2) {
    state.busyStreakStartedAt ??= timestamp;
    state.busyDeferrals++;
    if (state.busyDeferrals >= 120) {
      state.busySlowProbes++;
      if (
        state.busySlowProbes >= 120 ||
        timestamp - state.busyStreakStartedAt >=
          NATIVE_OVERLAY_LIMITS.maxServiceMilliseconds
      ) {
        state.terminalCode = "busy-dormant";
        lifecycle.pauseServiceForDormancy(state, timestamp);
        return;
      }
      state.nextProbeAt = timestamp + 5_000;
    } else {
      state.nextProbeAt =
        timestamp + NATIVE_OVERLAY_LIMITS.readyProbeMilliseconds;
    }
    return;
  }
  state.busyDeferrals = 0;
  state.busySlowProbes = 0;
  state.busyStreakStartedAt = undefined;
  if (!lifecycle.reserveBuildSlice(state)) {
    state.terminalCode = "global-memory-cap";
    lifecycle.releaseDocument(state, timestamp);
    return;
  }
  state.executing = true;
  try {
    const result = runNativeOverlayBuildSlice(
      adapter,
      reader,
      state.build,
      now,
      timestamp + Math.min(8, buildMilliseconds),
    );
    if (result.kind === "terminal") {
      state.terminalCode = result.code;
      lifecycle.releaseDocument(state, now());
    } else {
      if (!lifecycle.syncBuildMemory(state)) {
        state.terminalCode = "global-memory-cap";
        lifecycle.releaseDocument(state, now());
      } else if (result.kind === "complete") {
        if (!lifecycle.publish(state, result.package, now())) {
          lifecycle.releaseDocument(state, now());
        }
      } else {
        state.nextProbeAt = now();
      }
    }
  } catch {
    state.terminalCode = "native-build-exception";
    lifecycle.releaseDocument(state, now());
  } finally {
    state.executing = false;
  }
}

function contextFromMarker(marker: string | undefined): string | undefined {
  const match = marker?.match(/^(\d+):/);
  return match?.[1];
}
