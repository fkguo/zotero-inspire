import type { CanonicalReaderAdmission } from "./overlayAdmission";
import {
  OverlayLifecycleStore,
  type NativeReaderState,
} from "./overlayLifecycle";

export interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

export function validNativeItemID(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function needsNativeOverlayWork(
  adapterEnabled: boolean,
  state: NativeReaderState,
): boolean {
  return (
    adapterEnabled &&
    state.foreground &&
    state.workToken !== undefined &&
    !state.terminalCode &&
    !state.completedNegative &&
    !state.nativePackage &&
    state.build?.phase !== "done"
  );
}

export function nextNativeOverlayWorkDelay(
  pendingAdmissions: number,
  states: Iterable<NativeReaderState>,
  adapterEnabled: boolean,
  timestamp: number,
): number | undefined {
  if (pendingAdmissions) return 0;
  const dueTimes = [...states]
    .filter((state) => needsNativeOverlayWork(adapterEnabled, state))
    .map((state) => state.nextProbeAt);
  return dueTimes.length
    ? Math.max(0, Math.min(...dueTimes) - timestamp)
    : undefined;
}

export function validateNativeReaderSource(
  lifecycle: OverlayLifecycleStore,
  state: NativeReaderState,
  reader: unknown,
  attachmentItemID: number,
): boolean {
  try {
    if (
      !reader ||
      (typeof reader !== "object" && typeof reader !== "function")
    ) {
      throw new TypeError("reader shape");
    }
    const expectedWindow = state.windowRef?.deref();
    const readerWindow = Object.getOwnPropertyDescriptor(reader, "_window");
    if (
      state.sourceAttachmentItemID === attachmentItemID &&
      (reader as any).itemID === attachmentItemID &&
      !!expectedWindow &&
      !!readerWindow &&
      "value" in readerWindow &&
      readerWindow.value === expectedWindow
    ) {
      return true;
    }
  } catch {
    // Revoke stale source authority below.
  }
  lifecycle.releaseState(state.stateID);
  return false;
}

export function reconcileNativeTabSelection(
  lifecycle: OverlayLifecycleStore,
  timestamp: number,
  onSelected: (state: NativeReaderState) => void,
): void {
  for (const state of lifecycle.states.values()) {
    if (!state.tabID || !state.windowRef) continue;
    const window = state.windowRef.deref() as any;
    let selected = false;
    try {
      selected = String(window?.Zotero_Tabs?.selectedID) === state.tabID;
    } catch {
      selected = false;
    }
    const changed = lifecycle.setForeground(state, selected, timestamp);
    if (changed && selected) {
      state.nextProbeAt = timestamp;
      onSelected(state);
    }
  }
}

export function resolveReaderForeground(
  admission: CanonicalReaderAdmission,
  requested: boolean,
): boolean {
  if (!requested) return false;
  try {
    if (admission.tabID) {
      return (
        String((admission.window as any)?.Zotero_Tabs?.selectedID) ===
          admission.tabID &&
        Zotero.Reader.getByTabID(admission.tabID) === admission.reader
      );
    }
    return (admission.window as any)?.document?.hasFocus?.() === true;
  } catch {
    return false;
  }
}

export function resolveTrackedReaderForeground(
  state: NativeReaderState,
  reader: object,
  requested: boolean,
): boolean {
  if (!requested) return false;
  return resolveReaderForeground(
    {
      reader,
      sourceAttachmentItemID: state.sourceAttachmentItemID,
      tabID: state.tabID,
      window: state.windowRef?.deref(),
    },
    true,
  );
}

export function monotonicNow(): number {
  try {
    return typeof performance?.now === "function"
      ? performance.now()
      : Date.now();
  } catch {
    return Date.now();
  }
}

export function makeNativeWeakRef<T extends object>(
  value: T,
): WeakRefLike<T> | undefined {
  try {
    const Constructor = (globalThis as any).WeakRef;
    return typeof Constructor === "function"
      ? new Constructor(value)
      : undefined;
  } catch {
    return undefined;
  }
}
