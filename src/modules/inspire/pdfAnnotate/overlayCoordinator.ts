import { LabelMatcher } from "./labelMatcher";
import { NativeFormatCache, classifyCitationText } from "./nativeFormatCache";
import {
  NativeOverlayAdapter,
  selectNativeOverlayProfile,
} from "./nativeOverlayProfile";
import {
  NATIVE_OVERLAY_LIMITS,
  type NativeOriginAnchor,
  type NativeOverlayReadToken,
  type NativeSelectionEvidence,
} from "./nativeOverlayTypes";
import { OverlayLifecycleStore } from "./overlayLifecycle";
import type { NativeReaderState } from "./overlayLifecycle";
import { OverlayMemoryAccountant } from "./overlayMemory";
import { OverlayScheduler, type OverlayPumpBudget } from "./overlayScheduler";
import { OverlayWindowRegistry } from "./overlayWindowRegistry";
import {
  OverlayPendingAdmissions,
  type ConsumedAdmission,
  type PendingSource,
} from "./overlayPendingAdmissions";
import { runOverlayStateSlice } from "./overlayWorkRunner";
import { authorizeNativeMatch } from "./overlayAuthorization";
import {
  applyNativeFormatCompletion,
  ensureNativeFormat,
} from "./overlayFormatState";
import {
  makeNativeWeakRef,
  monotonicNow as now,
  needsNativeOverlayWork,
  nextNativeOverlayWorkDelay,
  reconcileNativeTabSelection,
  resolveReaderForeground,
  resolveTrackedReaderForeground,
  validateNativeReaderSource,
  validNativeItemID as validItemID,
} from "./overlayCoordinatorUtils";
import type { MatchResult } from "./types";
import { installStandaloneReaderListeners } from "./overlayStandaloneListeners";
import { invalidateNativeAttachment } from "./overlayInvalidation";
import { validateNativeOriginAnchorEvent } from "./overlayEventValidation";
import { NativeLinkedReferenceResolver } from "./nativeLinkedReference";
import type {
  NativeLinkedReferenceCapture,
  NativeLinkedReferenceEvidence,
} from "./nativeOverlayTypes";

export class OverlayCoordinator {
  readonly adapter: NativeOverlayAdapter;
  private readonly memory = new OverlayMemoryAccountant();
  private readonly lifecycle: OverlayLifecycleStore;
  private readonly windows: OverlayWindowRegistry;
  private readonly scheduler: OverlayScheduler;
  private readonly formatCache: NativeFormatCache;
  private readonly pendingAdmissions: OverlayPendingAdmissions;
  private readonly linkedReferences: NativeLinkedReferenceResolver;
  private generation = 1;
  private roundRobinWorkKeys: string[] = [];
  private stopped = false;
  constructor(enabledAtStartup: boolean) {
    const profile = selectNativeOverlayProfile(enabledAtStartup);
    this.adapter = new NativeOverlayAdapter(
      profile,
      OverlayScheduler.supportsNativeIdleRuntime(),
    );
    this.linkedReferences = new NativeLinkedReferenceResolver(
      profile,
      () => this.adapter.enabled,
    );
    if (
      enabledAtStartup &&
      profile.status === "audited-zotero-10" &&
      !this.adapter.enabled
    ) {
      try {
        (globalThis as any).Zotero?.debug?.(
          `[zotero-inspire] Native overlay reuse disabled: ` +
            `status=${profile.status}, version=${profile.version || "unknown"}, ` +
            `buildID=${profile.buildID || "unknown"}, required Timer APIs unavailable`,
        );
      } catch {
        // Native reuse stays fail-closed even if host logging is unavailable.
      }
    }
    this.lifecycle = new OverlayLifecycleStore(
      this.memory,
      () => this.adapter.enabled,
      (attachmentItemID) =>
        this.formatCache?.releaseUnprotectedInterest(attachmentItemID),
      () => this.shutdown(),
    );
    this.windows = new OverlayWindowRegistry(() => this.shutdown());
    this.scheduler = new OverlayScheduler(
      (budget) => this.pump(budget),
      undefined,
      () => this.disableNativeRuntime(),
      () => this.shutdown(),
      () => this.shutdown(),
    );
    this.pendingAdmissions = new OverlayPendingAdmissions(
      () => this.scheduler.ensureScheduled(),
      now,
      () => this.shutdown(),
    );
    this.formatCache = new NativeFormatCache(
      profile,
      (completion) =>
        applyNativeFormatCompletion(
          this.lifecycle.states.values(),
          completion,
          this.generation,
        ),
      (attachmentItemID) =>
        [...this.lifecycle.states.values()].some(
          (state) => state.sourceAttachmentItemID === attachmentItemID,
        ),
      () => this.shutdown(),
    );
  }

  startupSweep(): void {
    if (!this.stopped) this.pendingAdmissions.startupSweep();
  }
  requestPrewarm(
    outerReader: unknown,
    sourceAttachmentItemID: number | undefined,
    foreground: boolean,
    source: PendingSource,
  ): void {
    if (
      this.stopped ||
      (sourceAttachmentItemID !== undefined &&
        !validItemID(sourceAttachmentItemID))
    )
      return;
    const existing = this.lifecycle.getByReader(outerReader);
    if (existing) {
      const expectedSourceAttachmentItemID =
        sourceAttachmentItemID ?? existing.sourceAttachmentItemID;
      if (
        validateNativeReaderSource(
          this.lifecycle,
          existing,
          outerReader,
          expectedSourceAttachmentItemID,
        )
      ) {
        const trackedForeground =
          source === "interaction"
            ? existing.foreground
            : resolveTrackedReaderForeground(
                existing,
                outerReader as object,
                foreground,
              );
        const becameForeground = this.lifecycle.setForeground(
          existing,
          trackedForeground,
          now(),
        );
        if (becameForeground && trackedForeground) this.ensureFormat(existing);
        if (needsNativeOverlayWork(this.adapter.enabled, existing)) {
          if (becameForeground) existing.nextProbeAt = now();
        }
        this.refreshSchedule();
        return;
      }
    }
    this.pendingAdmissions.ensure(
      outerReader,
      sourceAttachmentItemID,
      source,
      foreground,
    );
  }

  reconcileTabSelection(): void {
    reconcileNativeTabSelection(this.lifecycle, now(), (state) =>
      this.ensureFormat(state),
    );
    this.refreshSchedule();
  }

  releaseTab(tabID: string): void {
    this.lifecycle.releaseByTabID(String(tabID));
    this.refreshSchedule();
  }

  invalidateAttachment(attachmentItemID: number, destructive: boolean): void {
    invalidateNativeAttachment(
      this.lifecycle,
      this.formatCache,
      attachmentItemID,
      destructive,
      this.generation,
    );
    this.refreshSchedule();
  }

  classifySelectionWithReadyEvidence(
    outerReader: unknown,
    sourceAttachmentItemID: number,
    selectedText: string,
  ): NativeSelectionEvidence {
    const selectionFormat = classifyCitationText(selectedText);
    if (this.stopped || !validItemID(sourceAttachmentItemID)) {
      return { format: selectionFormat };
    }
    const state = this.lifecycle.getByReader(outerReader);
    if (state) {
      if (
        !validateNativeReaderSource(
          this.lifecycle,
          state,
          outerReader,
          sourceAttachmentItemID,
        )
      ) {
        return { format: selectionFormat };
      }
      const format =
        this.formatCache.getVerifiedHint(
          sourceAttachmentItemID,
          state.verifiedFormatGeneration,
        ) || selectionFormat;
      if (this.lifecycle.hasReaderLifetimeTerminal(state)) return { format };
      const browsingContextID = this.adapter.readOriginViewContext(outerReader);
      if (!browsingContextID) return { format };
      const previousContextID = state.observedBrowsingContextID;
      if (!this.lifecycle.acceptBrowsingContext(state, browsingContextID)) {
        return { format };
      }
      if (
        previousContextID !== undefined &&
        previousContextID !== browsingContextID &&
        state.foreground &&
        needsNativeOverlayWork(this.adapter.enabled, state)
      ) {
        state.nextProbeAt = now();
        this.scheduler.ensureScheduled();
      }
      return {
        format,
        originAnchor: {
          kind: "state",
          stateID: state.stateID,
          sourceAttachmentItemID,
          browsingContextID,
        },
      };
    }
    if (this.pendingAdmissions.isManagerRefused(outerReader)) {
      return { format: selectionFormat };
    }
    const pendingID = this.pendingAdmissions.ensure(
      outerReader,
      sourceAttachmentItemID,
      "interaction",
      false,
    );
    const browsingContextID = this.adapter.readOriginViewContext(outerReader);
    return pendingID && browsingContextID
      ? {
          format: selectionFormat,
          originAnchor: {
            kind: "pending",
            pendingAdmissionID: pendingID,
            sourceAttachmentItemID,
            browsingContextID,
          },
        }
      : { format: selectionFormat };
  }

  validateOriginAnchorForEvent(
    outerReader: unknown,
    sourceAttachmentItemID: number,
    originAnchor: NativeOriginAnchor | undefined,
    _interactionKind: "lookup" | "hover",
  ): NativeOverlayReadToken | undefined {
    return validateNativeOriginAnchorEvent(
      this.lifecycle,
      this.adapter,
      outerReader,
      sourceAttachmentItemID,
      originAnchor,
      () =>
        this.requestPrewarm(
          outerReader,
          sourceAttachmentItemID,
          false,
          "interaction",
        ),
      () => this.scheduler.ensureScheduled(),
    );
  }

  matchLabelWithReadyNative(
    readToken: NativeOverlayReadToken | undefined,
    matcher: LabelMatcher,
    label: string,
  ): MatchResult[] {
    return matcher.match(
      label,
      authorizeNativeMatch(readToken, matcher, this.lifecycle, this.adapter),
    );
  }

  matchLabelsWithReadyNative(
    readToken: NativeOverlayReadToken | undefined,
    matcher: LabelMatcher,
    labels: string[],
  ): MatchResult[] {
    return matcher.matchAll(
      labels,
      authorizeNativeMatch(readToken, matcher, this.lifecycle, this.adapter),
    );
  }

  captureLinkedReference(
    outerReader: unknown,
    sourceAttachmentItemID: number,
    selectionPosition: unknown,
    label: string,
  ): NativeLinkedReferenceCapture | undefined {
    return this.linkedReferences.capture(
      outerReader,
      sourceAttachmentItemID,
      selectionPosition,
      label,
    );
  }

  resolveLinkedReference(
    outerReader: unknown,
    capture: NativeLinkedReferenceCapture,
  ): Promise<NativeLinkedReferenceEvidence> {
    return this.linkedReferences.resolve(outerReader, capture);
  }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.generation++;
    this.scheduler.cancel();
    this.lifecycle.reset();
    this.windows.shutdown();
    this.formatCache.shutdown();
    this.pendingAdmissions.shutdown();
    this.linkedReferences.shutdown();
    this.roundRobinWorkKeys.length = 0;
    this.memory.reset();
  }

  private pump(budget: OverlayPumpBudget): number | undefined {
    if (this.stopped) return undefined;
    this.lifecycle.reapDead();
    const timestamp = now();
    reconcileNativeTabSelection(this.lifecycle, timestamp, (state) =>
      this.ensureFormat(state),
    );
    const eligible = [...this.lifecycle.states.values()]
      .filter((state) => needsNativeOverlayWork(this.adapter.enabled, state))
      .sort((a, b) => a.workToken! - b.workToken!);
    const due = eligible.filter((state) => state.nextProbeAt <= timestamp);
    const pendingID = this.pendingAdmissions.peekNextID();
    if (!pendingID && !due.length) {
      this.syncRoundRobinWork([]);
      if (!eligible.length) return undefined;
      return Math.max(
        0,
        Math.min(...eligible.map((state) => state.nextProbeAt)) - timestamp,
      );
    }
    const pendingKey = pendingID ? `pending:${pendingID}` : undefined;
    const statesByKey = new Map<string, NativeReaderState>();
    const candidateKeys = pendingKey ? [pendingKey] : [];
    for (const state of due) {
      const key = `state:${state.workToken!}`;
      candidateKeys.push(key);
      statesByKey.set(key, state);
    }
    this.syncRoundRobinWork(candidateKeys);
    const selectedKey = this.roundRobinWorkKeys.shift();
    if (!selectedKey) return this.nextWorkDelay();
    this.roundRobinWorkKeys.push(selectedKey);
    if (selectedKey === pendingKey) {
      const consumed = this.pendingAdmissions.consumeNext(pendingID);
      if (consumed) this.admitConsumed(consumed);
      return this.nextWorkDelay();
    }
    const state = statesByKey.get(selectedKey);
    if (!state) return this.nextWorkDelay();
    runOverlayStateSlice(
      this.adapter,
      this.lifecycle,
      state,
      timestamp,
      now,
      budget.buildMilliseconds,
    );
    return this.nextWorkDelay();
  }

  private syncRoundRobinWork(candidateKeys: string[]): void {
    const active = new Set(candidateKeys);
    this.roundRobinWorkKeys = this.roundRobinWorkKeys.filter((key) =>
      active.has(key),
    );
    for (const key of candidateKeys) {
      if (!this.roundRobinWorkKeys.includes(key)) {
        this.roundRobinWorkKeys.push(key);
      }
    }
  }

  private admitConsumed(pending: ConsumedAdmission): void {
    const admission = pending.admission;
    const existingWindowKey = admission.window
      ? this.windows.getKey(admission.window)
      : undefined;
    const selfRef = makeNativeWeakRef(this);
    if (!selfRef) return;
    const windowKey = admission.window
      ? this.windows.ensure(admission.window, (key) =>
          selfRef.deref()?.releaseWindow(key),
        )
      : undefined;
    if (admission.window && !windowKey) return;
    const observedForeground = resolveReaderForeground(
      admission,
      pending.foregroundRequested,
    );
    if (
      admission.tabID &&
      pending.source !== "interaction" &&
      !observedForeground
    ) {
      if (!existingWindowKey && windowKey) this.windows.close(windowKey);
      return;
    }
    const state = this.lifecycle.admit(
      admission,
      pending.pendingID,
      admission.tabID ? observedForeground : false,
      now(),
      pending.source !== "interaction" && observedForeground,
    );
    if (!state) {
      if (!existingWindowKey && windowKey) this.windows.close(windowKey);
      return;
    }
    state.windowKey = windowKey;
    if (!state.tabID && admission.window) {
      if (!this.installStandaloneListeners(state, admission.window)) {
        this.lifecycle.releaseState(state.stateID);
        if (!existingWindowKey && windowKey) this.windows.close(windowKey);
        return;
      }
      this.lifecycle.setForeground(
        state,
        resolveReaderForeground(admission, pending.foregroundRequested),
        now(),
      );
    }
    if (state.foreground) this.ensureFormat(state);
    state.nextProbeAt = now();
  }

  private installStandaloneListeners(
    state: NativeReaderState,
    window: object,
  ): boolean {
    const stateID = state.stateID;
    const selfRef = makeNativeWeakRef(this);
    if (!selfRef) return false;
    state.cleanup = installStandaloneReaderListeners(
      window,
      state.windowRef,
      (foreground) =>
        selfRef.deref()?.setStandaloneForeground(stateID, foreground),
    );
    return state.cleanup !== undefined;
  }

  private setStandaloneForeground(stateID: number, foreground: boolean): void {
    const state = this.lifecycle.states.get(stateID);
    if (!state || state.tabID) return;
    const changed = this.lifecycle.setForeground(state, foreground, now());
    if (changed && foreground) this.ensureFormat(state);
    this.refreshSchedule();
  }

  private ensureFormat(state: NativeReaderState): void {
    ensureNativeFormat(this.formatCache, state, this.generation);
  }

  private releaseWindow(windowKey: number): void {
    this.lifecycle.releaseByWindowKey(windowKey);
    this.windows.close(windowKey);
    this.refreshSchedule();
  }

  private disableNativeRuntime(): void {
    this.adapter.disableRuntime();
    this.lifecycle.revokeOverlayWorkTokens();
    for (const state of this.lifecycle.states.values()) {
      this.lifecycle.releaseDocument(state);
    }
  }

  private nextWorkDelay(): number | undefined {
    return nextNativeOverlayWorkDelay(
      this.pendingAdmissions.size,
      this.lifecycle.states.values(),
      this.adapter.enabled,
      now(),
    );
  }

  private refreshSchedule(): void {
    const delay = this.nextWorkDelay();
    if (delay === undefined) this.scheduler.clearScheduled();
    else this.scheduler.ensureScheduled(delay);
  }
}
