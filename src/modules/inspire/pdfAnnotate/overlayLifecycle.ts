import type { CanonicalReaderAdmission } from "./overlayAdmission";
import {
  createNativeOverlayBuildState,
  releaseNativeOverlayBuildState,
  type NativeOverlayBuildState,
} from "./nativeOverlayBuilder";
import type { NativeDocumentTuple } from "./nativeOverlayProfile";
import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";
import type {
  NativeFormatFingerprint,
  NativeOverlayMatchPackage,
  NativeOverlayReadToken,
} from "./nativeOverlayTypes";
import {
  OverlayMemoryAccountant,
  type OverlayMemoryCharge,
} from "./overlayMemory";

interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

export interface NativeReaderState {
  stateID: number;
  readerRef: WeakRefLike<object>;
  sourceAttachmentItemID: number;
  tabID?: string;
  windowKey?: number;
  windowRef?: WeakRefLike<object>;
  cleanup?: () => void;
  admittedFromPendingID?: number;
  foreground: boolean;
  workToken?: number;
  readToken?: NativeOverlayReadToken;
  tuple?: NativeDocumentTuple;
  build?: NativeOverlayBuildState;
  nativePackage?: NativeOverlayMatchPackage;
  completedNegative: boolean;
  memoryCharge?: OverlayMemoryCharge;
  terminalCode?: string;
  serviceStartedAt?: number;
  serviceElapsedMilliseconds: number;
  nextProbeAt: number;
  lastForegroundAt: number;
  observedBrowsingContextID?: string;
  lastBoundBrowsingContextID?: string;
  preReadyContextReplacements: number;
  documentEpochs: number;
  incompatibleCode?: string;
  incompatibleMarker?: string;
  incompatibleFirstAt?: number;
  incompatibleCount: number;
  executing: boolean;
  busyDeferrals: number;
  busySlowProbes: number;
  busyStreakStartedAt?: number;
  formatAttemptedGeneration: number;
  verifiedFormatGeneration?: number;
  verifiedFormatFingerprint?: NativeFormatFingerprint;
}

export class OverlayLifecycleStore {
  readonly states = new Map<number, NativeReaderState>();
  readonly stateByReader = new WeakMap<object, number>();
  readonly stateByReadToken = new Map<NativeOverlayReadToken, number>();
  private nextStateID = 1;
  private nextWorkToken = 1;
  private nextReadToken = 1;

  constructor(
    private readonly memory: OverlayMemoryAccountant,
    private readonly workTokensEnabled: () => boolean = () => true,
    private readonly onStateReleased: (attachmentItemID: number) => void = () =>
      undefined,
    private readonly onIdentifierExhausted?: () => void,
  ) {}

  getByReader(reader: unknown): NativeReaderState | undefined {
    if (
      !reader ||
      (typeof reader !== "object" && typeof reader !== "function")
    ) {
      return undefined;
    }
    const stateID = this.stateByReader.get(reader as object);
    const state = stateID ? this.states.get(stateID) : undefined;
    if (!state && stateID) this.stateByReader.delete(reader as object);
    return state;
  }

  admit(
    admission: CanonicalReaderAdmission,
    pendingID: number | undefined,
    foreground: boolean,
    now: number,
    allowInertEviction = foreground,
  ): NativeReaderState | undefined {
    const existing = this.getByReader(admission.reader);
    if (existing) {
      if (foreground) this.setForeground(existing, true, now);
      return existing;
    }
    const readerRef = makeWeakRef(admission.reader);
    const windowRef = admission.window
      ? makeWeakRef(admission.window)
      : undefined;
    if (!readerRef || (admission.window && !windowRef)) return undefined;
    if (
      this.states.size >= NATIVE_OVERLAY_LIMITS.maxReaderStates &&
      (!allowInertEviction || !this.evictOneInert())
    )
      return undefined;
    const stateID = this.allocate("state");
    if (!stateID) return undefined;
    const state: NativeReaderState = {
      stateID,
      readerRef,
      sourceAttachmentItemID: admission.sourceAttachmentItemID,
      tabID: admission.tabID,
      windowRef,
      admittedFromPendingID: pendingID,
      foreground: false,
      lastForegroundAt: now,
      nextProbeAt: now,
      preReadyContextReplacements: 0,
      documentEpochs: 0,
      incompatibleCount: 0,
      executing: false,
      busyDeferrals: 0,
      busySlowProbes: 0,
      completedNegative: false,
      formatAttemptedGeneration: 0,
      serviceElapsedMilliseconds: 0,
    };
    this.states.set(stateID, state);
    this.stateByReader.set(admission.reader, stateID);
    if (foreground && !this.setForeground(state, true, now)) {
      this.releaseState(stateID);
      return undefined;
    }
    return state;
  }

  setForeground(
    state: NativeReaderState,
    foreground: boolean,
    now: number,
  ): boolean {
    if (state.foreground === foreground) return false;
    if (foreground) {
      const requiresToken = this.workTokensEnabled();
      const token = requiresToken ? this.allocate("work") : undefined;
      if (requiresToken && !token) return false;
      state.foreground = true;
      state.workToken = token;
      state.lastForegroundAt = now;
      state.busyDeferrals = 0;
      state.busySlowProbes = 0;
      state.busyStreakStartedAt = undefined;
      if (state.terminalCode === "busy-dormant") state.terminalCode = undefined;
      if (token && state.serviceStartedAt === undefined) {
        state.serviceStartedAt = now;
      }
    } else {
      state.foreground = false;
      if (state.serviceStartedAt !== undefined) {
        state.serviceElapsedMilliseconds += Math.max(
          0,
          now - state.serviceStartedAt,
        );
      }
      state.workToken = undefined;
      state.serviceStartedAt = undefined;
    }
    return true;
  }

  bindDocument(
    state: NativeReaderState,
    tuple: NativeDocumentTuple,
    now: number = monotonicNow(),
  ): boolean {
    if (state.tuple?.documentKey === tuple.documentKey) return true;
    this.releaseDocument(state);
    state.documentEpochs++;
    if (state.documentEpochs > NATIVE_OVERLAY_LIMITS.maxDocumentEpochs) {
      state.terminalCode = "document-epoch-cap";
      return false;
    }
    const token = this.allocate("read");
    if (!token) return false;
    state.tuple = tuple;
    state.lastBoundBrowsingContextID = tuple.browsingContextID;
    state.readToken = `native-${state.stateID}-${token}`;
    this.stateByReadToken.set(state.readToken, state.stateID);
    state.build = createNativeOverlayBuildState(tuple, token);
    state.serviceElapsedMilliseconds = 0;
    state.serviceStartedAt =
      state.foreground && this.workTokensEnabled() ? now : undefined;
    return true;
  }

  publish(
    state: NativeReaderState,
    nativePackage: NativeOverlayMatchPackage | undefined,
    now: number = monotonicNow(),
  ): boolean {
    state.build = undefined;
    this.pauseService(state, now);
    state.completedNegative = !nativePackage;
    if (!nativePackage) {
      this.memory.release(state.memoryCharge);
      state.memoryCharge = undefined;
      return true;
    }
    const charge =
      state.memoryCharge || this.memory.reserveCompletedMap(nativePackage);
    if (!charge) {
      state.terminalCode = "global-memory-cap";
      this.memory.release(state.memoryCharge);
      state.memoryCharge = undefined;
      return false;
    }
    state.nativePackage = nativePackage;
    state.memoryCharge = charge;
    return true;
  }

  syncBuildMemory(state: NativeReaderState): boolean {
    const build = state.build;
    if (!build) return true;
    const measured = measureBuildCharge(build);
    const charge = this.memory.reserveBuild(
      state.memoryCharge,
      measured.records,
      measured.textUnits,
    );
    if (!charge) return false;
    state.memoryCharge = charge;
    return true;
  }

  reserveBuildSlice(state: NativeReaderState): boolean {
    const build = state.build;
    if (!build) return true;
    const current = measureBuildCharge(build);
    const recordCeiling = NATIVE_OVERLAY_LIMITS.maxLiveRecords + 200;
    const reserved = {
      records: Math.max(current.records, recordCeiling),
      textUnits: Math.max(
        current.textUnits,
        NATIVE_OVERLAY_LIMITS.maxRetainedTextUnits,
      ),
    };
    let charge = this.memory.reserveBuild(
      state.memoryCharge,
      reserved.records,
      reserved.textUnits,
    );
    if (!charge && state.foreground && this.evictOneInert()) {
      charge = this.memory.reserveBuild(
        state.memoryCharge,
        reserved.records,
        reserved.textUnits,
      );
    }
    if (!charge) return false;
    state.memoryCharge = charge;
    return true;
  }

  releaseDocument(
    state: NativeReaderState,
    now: number = monotonicNow(),
  ): void {
    if (state.readToken) this.stateByReadToken.delete(state.readToken);
    state.readToken = undefined;
    state.tuple = undefined;
    if (state.build) releaseNativeOverlayBuildState(state.build);
    state.build = undefined;
    this.memory.release(state.memoryCharge);
    state.memoryCharge = undefined;
    state.nativePackage = undefined;
    state.completedNegative = false;
    state.serviceElapsedMilliseconds = 0;
    state.serviceStartedAt =
      state.foreground && this.workTokensEnabled() ? now : undefined;
  }

  releaseState(stateID: number): void {
    const state = this.states.get(stateID);
    if (!state) return;
    const reader = state.readerRef.deref();
    if (reader && this.stateByReader.get(reader) === stateID) {
      this.stateByReader.delete(reader);
    }
    this.releaseDocument(state);
    try {
      state.cleanup?.();
    } catch {
      // Listener cleanup is best effort and idempotent.
    }
    state.cleanup = undefined;
    this.states.delete(stateID);
    try {
      this.onStateReleased(state.sourceAttachmentItemID);
    } catch {
      // State authority is already gone; format interest cleanup is best effort.
    }
  }

  releaseByTabID(tabID: string): void {
    for (const state of [...this.states.values()]) {
      if (state.tabID === tabID) this.releaseState(state.stateID);
    }
  }

  releaseByWindowKey(windowKey: number): void {
    for (const state of [...this.states.values()]) {
      if (state.windowKey === windowKey) this.releaseState(state.stateID);
    }
  }

  releaseByAttachment(attachmentItemID: number): void {
    for (const state of [...this.states.values()]) {
      if (state.sourceAttachmentItemID === attachmentItemID) {
        this.releaseState(state.stateID);
      }
    }
  }

  reapDead(): void {
    for (const state of [...this.states.values()]) {
      if (!state.readerRef.deref()) this.releaseState(state.stateID);
    }
  }

  reset(): void {
    for (const stateID of [...this.states.keys()]) this.releaseState(stateID);
    this.stateByReadToken.clear();
  }

  revokeOverlayWorkTokens(now: number = monotonicNow()): void {
    for (const state of this.states.values()) {
      this.pauseService(state, now);
      state.workToken = undefined;
    }
  }

  getServiceMilliseconds(state: NativeReaderState, now: number): number {
    return (
      state.serviceElapsedMilliseconds +
      (state.serviceStartedAt === undefined
        ? 0
        : Math.max(0, now - state.serviceStartedAt))
    );
  }

  pauseServiceForDormancy(state: NativeReaderState, now: number): void {
    this.pauseService(state, now);
  }

  acceptBrowsingContext(
    state: NativeReaderState,
    browsingContextID: string,
    now: number = monotonicNow(),
  ): boolean {
    if (!state.observedBrowsingContextID) {
      state.observedBrowsingContextID = browsingContextID;
      return true;
    }
    if (state.observedBrowsingContextID === browsingContextID) return true;
    if (this.hasReaderLifetimeTerminal(state)) return false;
    const previousContextID = state.observedBrowsingContextID;
    const previousContextHadBoundDocument =
      state.lastBoundBrowsingContextID === previousContextID;
    this.releaseDocument(state, now);
    if (!previousContextHadBoundDocument) {
      state.preReadyContextReplacements++;
      if (
        state.preReadyContextReplacements >
        NATIVE_OVERLAY_LIMITS.maxPreReadyContextReplacements
      ) {
        state.terminalCode = "pre-ready-context-churn-cap";
        return false;
      }
    }
    state.observedBrowsingContextID = browsingContextID;
    state.incompatibleCode = undefined;
    state.incompatibleMarker = undefined;
    state.incompatibleFirstAt = undefined;
    state.incompatibleCount = 0;
    state.terminalCode = undefined;
    state.nextProbeAt = now;
    return true;
  }

  hasReaderLifetimeTerminal(state: NativeReaderState): boolean {
    return (
      state.terminalCode === "document-epoch-cap" ||
      state.terminalCode === "pre-ready-context-churn-cap" ||
      state.terminalCode === "same-context-navigation" ||
      state.terminalCode === "same-view-second-document"
    );
  }

  private pauseService(state: NativeReaderState, now: number): void {
    if (state.serviceStartedAt === undefined) return;
    state.serviceElapsedMilliseconds += Math.max(
      0,
      now - state.serviceStartedAt,
    );
    state.serviceStartedAt = undefined;
  }

  private evictOneInert(): boolean {
    const candidates = [...this.states.values()]
      .filter((state) => !state.foreground && !state.executing)
      .sort(
        (a, b) =>
          Number(!a.tabID) - Number(!b.tabID) ||
          a.lastForegroundAt - b.lastForegroundAt,
      );
    if (!candidates.length) return false;
    this.releaseState(candidates[0].stateID);
    return true;
  }

  private allocate(kind: "state" | "work" | "read"): number {
    const key =
      kind === "state"
        ? "nextStateID"
        : kind === "work"
          ? "nextWorkToken"
          : "nextReadToken";
    const value = this[key];
    if (value > Number.MAX_SAFE_INTEGER) {
      if (this.onIdentifierExhausted) this.onIdentifierExhausted();
      else this.reset();
      return 0;
    }
    this[key] = value + 1;
    return value;
  }
}

function measureBuildCharge(
  build: NativeOverlayBuildState,
): OverlayMemoryCharge {
  return {
    records:
      build.liveRecords +
      (build.scratch?.liveRecords || 0) +
      build.signatureScratch.length +
      (build.signatureCandidate?.length || 0) +
      (build.acceptedSignature?.length || 0),
    textUnits: build.retainedTextUnits,
  };
}

function monotonicNow(): number {
  try {
    return typeof performance?.now === "function"
      ? performance.now()
      : Date.now();
  } catch {
    return Date.now();
  }
}

function makeWeakRef<T extends object>(value: T): WeakRefLike<T> | undefined {
  try {
    const Constructor = (globalThis as any).WeakRef;
    return typeof Constructor === "function"
      ? new Constructor(value)
      : undefined;
  } catch {
    return undefined;
  }
}
