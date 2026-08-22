import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";

interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

interface WindowSlot {
  key: number;
  windowRef: WeakRefLike<object>;
  cleanup: () => void;
  onClosed: () => void;
}

/** Weak chrome-window registry shared by tab and standalone Reader states. */
export class OverlayWindowRegistry {
  private keyByWindow = new WeakMap<object, number>();
  private slots = new Map<number, WindowSlot>();
  private nextKey = 1;
  private observerRegistered = false;
  private readonly windowObserver = {
    observe: (subject: unknown, topic: string) => {
      if (topic !== "domwindowclosed" || !isObject(subject)) return;
      const key = this.keyByWindow.get(subject);
      this.slots.get(key || 0)?.onClosed();
    },
  };

  constructor(
    private readonly onIdentifierExhausted: () => void = () => undefined,
  ) {
    try {
      const watcher = (globalThis as any).Services?.ww;
      if (typeof watcher?.registerNotification === "function") {
        watcher.registerNotification(this.windowObserver);
        this.observerRegistered = true;
      }
    } catch {
      this.observerRegistered = false;
    }
  }

  ensure(
    chromeWindow: unknown,
    onUnload: (windowKey: number) => void,
  ): number | undefined {
    if (!isObject(chromeWindow)) return undefined;
    const existing = this.keyByWindow.get(chromeWindow);
    if (existing && this.slots.has(existing)) return existing;
    this.reap();
    if (this.slots.size >= NATIVE_OVERLAY_LIMITS.maxWindowSlots) {
      return undefined;
    }
    if (this.nextKey > Number.MAX_SAFE_INTEGER) {
      this.onIdentifierExhausted();
      return undefined;
    }
    const windowRef = makeWeakRef(chromeWindow);
    if (!windowRef) return undefined;
    const key = this.nextKey++;
    const listener = () => onUnload(key);
    try {
      (chromeWindow as any).addEventListener("unload", listener, {
        once: true,
      });
    } catch {
      return undefined;
    }
    const cleanup = () => {
      const live = windowRef.deref();
      try {
        (live as any)?.removeEventListener?.("unload", listener);
      } catch {
        // The weak window may already be gone.
      }
    };
    this.keyByWindow.set(chromeWindow, key);
    this.slots.set(key, { key, windowRef, cleanup, onClosed: listener });
    return key;
  }

  getWindow(windowKey: number): object | undefined {
    return this.slots.get(windowKey)?.windowRef.deref();
  }

  getKey(chromeWindow: object): number | undefined {
    const key = this.keyByWindow.get(chromeWindow);
    return key && this.slots.has(key) ? key : undefined;
  }

  close(windowKey: number): void {
    const slot = this.slots.get(windowKey);
    if (!slot) return;
    const window = slot.windowRef.deref();
    if (window && this.keyByWindow.get(window) === windowKey) {
      this.keyByWindow.delete(window);
    }
    this.slots.delete(windowKey);
    slot.cleanup();
  }

  reap(): void {
    for (const [key, slot] of this.slots) {
      if (!slot.windowRef.deref()) this.close(key);
    }
  }

  shutdown(): void {
    for (const key of [...this.slots.keys()]) this.close(key);
    if (this.observerRegistered) {
      try {
        (globalThis as any).Services?.ww?.unregisterNotification?.(
          this.windowObserver,
        );
      } catch {
        // Per-window listeners have already been removed.
      }
    }
    this.observerRegistered = false;
    this.keyByWindow = new WeakMap();
  }
}

function isObject(value: unknown): value is object {
  return !!value && (typeof value === "object" || typeof value === "function");
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
