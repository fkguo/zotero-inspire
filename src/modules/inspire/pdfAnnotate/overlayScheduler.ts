type SchedulerHandle =
  | {
      kind: "timer";
      id: unknown;
      armToken: number;
      dueAt: number;
      armedAt: number;
    }
  | {
      kind: "idle";
      id: unknown;
      armToken: number;
      dueAt: number;
      armedAt: number;
    };

interface NativeTimerRuntime {
  readonly setTimeout: (...args: any[]) => any;
  readonly clearTimeout: (...args: any[]) => any;
  readonly requestIdleCallback: (...args: any[]) => any;
  readonly cancelIdleCallback: (...args: any[]) => any;
}

export interface OverlayPumpBudget {
  readonly buildMilliseconds: number;
  readonly genuineIdle: boolean;
  readonly didTimeout: boolean;
}

export type OverlayPump = (budget: OverlayPumpBudget) => number | undefined;

/** Owns the coordinator's single timer-or-idle callback. */
export class OverlayScheduler {
  private handle?: SchedulerHandle;
  private nextArmToken = 1;
  private stopped = false;
  private idleUnavailable = false;
  private readonly nativeTimerRuntime = resolveNativeTimerRuntime();

  constructor(
    private readonly pump: OverlayPump,
    private readonly now: () => number = monotonicNow,
    private readonly onIdleUnavailable: () => void = () => undefined,
    private readonly onIdentifierExhausted: () => void = () => undefined,
    private readonly onPumpFailure?: () => void,
  ) {}

  static supportsNativeIdleRuntime(): boolean {
    try {
      return (
        typeof (globalThis as any).WeakRef === "function" &&
        resolveNativeTimerRuntime() !== undefined
      );
    } catch {
      return false;
    }
  }

  ensureScheduled(delayMilliseconds = 0): void {
    if (this.stopped) return;
    const now = this.now();
    const dueAt = now + Math.max(0, delayMilliseconds);
    if (this.handle) {
      const stale = now - this.handle.armedAt > 15_000;
      if (!stale && this.handle.dueAt <= dueAt) return;
      this.cancelHandle();
    }
    const armToken = this.allocateArmToken();
    if (!armToken) return;

    let requestIdle = this.idleUnavailable
      ? undefined
      : this.nativeTimerRuntime?.requestIdleCallback;
    if (typeof requestIdle !== "function") this.markIdleUnavailable();
    if (delayMilliseconds <= 0 && typeof requestIdle === "function") {
      try {
        const id = requestIdle(
          (deadline: unknown) => this.deliverIdle(armToken, deadline),
          { timeout: 50 },
        );
        if (id === undefined || id === null) {
          throw new TypeError("idle callback returned no handle");
        }
        this.handle = { kind: "idle", id, armToken, dueAt, armedAt: now };
        return;
      } catch {
        this.markIdleUnavailable();
        requestIdle = undefined;
      }
    }
    const setTimer =
      this.nativeTimerRuntime?.setTimeout ||
      getFallbackTimerFunction("setTimeout") ||
      setTimeout;
    try {
      const id = setTimer(
        () => this.deliverTimer(armToken, typeof requestIdle === "function"),
        Math.max(0, delayMilliseconds),
      );
      if (id === undefined || id === null) {
        throw new TypeError("timer returned no handle");
      }
      this.handle = { kind: "timer", id, armToken, dueAt, armedAt: now };
    } catch {
      this.markIdleUnavailable();
    }
  }

  cancel(): void {
    this.stopped = true;
    this.cancelHandle();
  }

  clearScheduled(): void {
    if (!this.stopped) this.cancelHandle();
  }

  get hasHandle(): boolean {
    return this.handle !== undefined;
  }

  private deliverTimer(armToken: number, handOffToIdle: boolean): void {
    if (
      this.stopped ||
      this.handle?.kind !== "timer" ||
      this.handle.armToken !== armToken
    )
      return;
    this.handle = undefined;
    if (handOffToIdle) {
      this.ensureScheduled();
      return;
    }
    this.runPump({
      buildMilliseconds: 4,
      genuineIdle: false,
      didTimeout: true,
    });
  }

  private deliverIdle(armToken: number, deadline: unknown): void {
    if (
      this.stopped ||
      this.handle?.kind !== "idle" ||
      this.handle.armToken !== armToken
    )
      return;
    this.handle = undefined;
    this.runPump(toPumpBudget(deadline));
  }

  private runPump(budget: OverlayPumpBudget): void {
    let nextDelay: number | undefined;
    try {
      nextDelay = this.pump(budget);
    } catch {
      // A coordinator exception must revoke the private-source path instead of
      // escaping from a host callback with stale work still authorized.
      if (this.onPumpFailure) {
        try {
          this.onPumpFailure();
        } catch {
          this.markIdleUnavailable();
        }
      } else {
        this.markIdleUnavailable();
      }
    } finally {
      if (nextDelay !== undefined && !this.stopped) {
        this.ensureScheduled(nextDelay);
      }
    }
  }

  private cancelHandle(): void {
    const handle = this.handle;
    this.handle = undefined;
    if (!handle) return;
    try {
      if (handle.kind === "idle") {
        const cancelIdle = this.nativeTimerRuntime?.cancelIdleCallback;
        if (typeof cancelIdle === "function") cancelIdle(handle.id);
      } else {
        const clearTimer =
          this.nativeTimerRuntime?.clearTimeout ||
          getFallbackTimerFunction("clearTimeout") ||
          clearTimeout;
        clearTimer(handle.id as ReturnType<typeof setTimeout>);
      }
    } catch {
      // A stale callback is also rejected by its monotonic arm token.
    }
  }

  private allocateArmToken(): number {
    if (this.nextArmToken > Number.MAX_SAFE_INTEGER) {
      this.cancel();
      this.onIdentifierExhausted();
      return 0;
    }
    return this.nextArmToken++;
  }

  private markIdleUnavailable(): void {
    if (this.idleUnavailable) return;
    this.idleUnavailable = true;
    try {
      this.onIdleUnavailable();
    } catch {
      // The fallback timer still services non-overlay admission work.
    }
  }
}

function toPumpBudget(deadline: any): OverlayPumpBudget {
  if (!deadline) {
    return { buildMilliseconds: 4, genuineIdle: false, didTimeout: true };
  }
  if (deadline.didTimeout === true) {
    return { buildMilliseconds: 4, genuineIdle: false, didTimeout: true };
  }
  let remaining = 0;
  try {
    remaining = Number(deadline.timeRemaining?.()) || 0;
  } catch {
    remaining = 0;
  }
  return {
    buildMilliseconds: Math.min(8, Math.max(0, remaining)),
    genuineIdle: true,
    didTimeout: false,
  };
}

function resolveNativeTimerRuntime(): NativeTimerRuntime | undefined {
  try {
    return (
      bindNativeTimerRuntime((globalThis as any).Zotero) ||
      bindNativeTimerRuntime(globalThis)
    );
  } catch {
    return undefined;
  }
}

function bindNativeTimerRuntime(provider: any): NativeTimerRuntime | undefined {
  if (
    !provider ||
    typeof provider.setTimeout !== "function" ||
    typeof provider.clearTimeout !== "function" ||
    typeof provider.requestIdleCallback !== "function" ||
    typeof provider.cancelIdleCallback !== "function"
  ) {
    return undefined;
  }
  return {
    setTimeout: provider.setTimeout.bind(provider),
    clearTimeout: provider.clearTimeout.bind(provider),
    requestIdleCallback: provider.requestIdleCallback.bind(provider),
    cancelIdleCallback: provider.cancelIdleCallback.bind(provider),
  };
}

function getFallbackTimerFunction(
  name: "setTimeout" | "clearTimeout",
): ((...args: any[]) => any) | undefined {
  try {
    const zotero = (globalThis as any).Zotero;
    const zoteroFunction = zotero?.[name];
    if (typeof zoteroFunction === "function") {
      return zoteroFunction.bind(zotero);
    }
    const globalFunction = (globalThis as any)[name];
    return typeof globalFunction === "function"
      ? globalFunction.bind(globalThis)
      : undefined;
  } catch {
    return undefined;
  }
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
