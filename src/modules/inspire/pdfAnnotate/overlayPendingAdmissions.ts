import {
  OverlayAdmissionGuard,
  type CanonicalReaderAdmission,
} from "./overlayAdmission";
import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";

export type PendingSource =
  | "tab-select"
  | "toolbar"
  | "interaction"
  | "startup";

interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

interface PendingAdmission {
  pendingID: number;
  readerRef: WeakRefLike<object>;
  sourceAttachmentItemID?: number;
  source: PendingSource;
  foregroundRequested: boolean;
  createdAt: number;
}

export interface ConsumedAdmission {
  pendingID: number;
  admission: CanonicalReaderAdmission;
  foregroundRequested: boolean;
  source: PendingSource;
}

export class OverlayPendingAdmissions {
  private readonly guard = new OverlayAdmissionGuard();
  private pending = new Map<number, PendingAdmission>();
  private pendingByReader = new WeakMap<object, number>();
  private nextPendingID = 1;

  constructor(
    private readonly armPump: () => void,
    private readonly now: () => number,
    private readonly stopAll: () => void,
  ) {}

  get size(): number {
    return this.pending.size;
  }

  peekNextID(): number | undefined {
    return this.nextPending()?.pendingID;
  }

  isManagerRefused(reader: unknown): boolean {
    return this.guard.isManagerRefused(reader);
  }

  startupSweep(): void {
    const readers = this.guard.snapshotForStartup();
    if (!readers) return;
    const ordered = readers
      .map((reader, sourceOrder) => ({
        reader,
        sourceOrder,
        rank: startupReaderRank(reader),
      }))
      .filter((item) => item.rank > 0)
      .sort((a, b) => b.rank - a.rank || a.sourceOrder - b.sourceOrder);
    for (const item of ordered) {
      this.ensure(item.reader, undefined, "startup", true);
    }
  }

  ensure(
    reader: unknown,
    attachmentItemID: number | undefined,
    source: PendingSource,
    foregroundRequested: boolean,
  ): number | undefined {
    if (!isObject(reader) || this.guard.isManagerRefused(reader))
      return undefined;
    const existingID = this.pendingByReader.get(reader);
    const existing = existingID ? this.pending.get(existingID) : undefined;
    if (existing) {
      let changed = false;
      if (sourceRank(source) > sourceRank(existing.source)) {
        existing.source = source;
        changed = true;
      }
      if (foregroundRequested && !existing.foregroundRequested) {
        existing.foregroundRequested = true;
        changed = true;
      }
      if (changed) this.armPump();
      return existing.pendingID;
    }
    if (this.pending.size >= NATIVE_OVERLAY_LIMITS.maxReaderStates) {
      const lower = [...this.pending.values()]
        .filter((item) => sourceRank(item.source) < sourceRank(source))
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!lower) return undefined;
      this.remove(lower.pendingID);
    }
    const readerRef = makeWeakRef(reader);
    const pendingID = this.allocateID();
    if (!readerRef || !pendingID) return undefined;
    this.pending.set(pendingID, {
      pendingID,
      readerRef,
      sourceAttachmentItemID: attachmentItemID,
      source,
      foregroundRequested,
      createdAt: this.now(),
    });
    this.pendingByReader.set(reader, pendingID);
    this.armPump();
    return pendingID;
  }

  consumeNext(expectedPendingID?: number): ConsumedAdmission | undefined {
    const pending = this.nextPending();
    if (!pending) return undefined;
    if (
      expectedPendingID !== undefined &&
      pending.pendingID !== expectedPendingID
    ) {
      return undefined;
    }
    const reader = pending.readerRef.deref();
    if (!reader) {
      this.remove(pending.pendingID);
      return undefined;
    }
    const result = this.guard.validate(reader);
    this.remove(pending.pendingID);
    if (
      result.kind !== "admitted" ||
      (pending.sourceAttachmentItemID !== undefined &&
        result.value.sourceAttachmentItemID !== pending.sourceAttachmentItemID)
    ) {
      return undefined;
    }
    return {
      pendingID: pending.pendingID,
      admission: result.value,
      foregroundRequested: pending.foregroundRequested,
      source: pending.source,
    };
  }

  shutdown(): void {
    for (const id of [...this.pending.keys()]) this.remove(id);
    this.pending.clear();
    this.pendingByReader = new WeakMap();
    this.guard.reset();
  }

  private remove(pendingID: number): void {
    const pending = this.pending.get(pendingID);
    if (!pending) return;
    const reader = pending.readerRef.deref();
    if (reader && this.pendingByReader.get(reader) === pendingID) {
      this.pendingByReader.delete(reader);
    }
    this.pending.delete(pendingID);
  }

  private nextPending(): PendingAdmission | undefined {
    return [...this.pending.values()].sort(
      (a, b) =>
        sourceRank(b.source) - sourceRank(a.source) ||
        a.createdAt - b.createdAt ||
        a.pendingID - b.pendingID,
    )[0];
  }

  private allocateID(): number {
    if (this.nextPendingID > Number.MAX_SAFE_INTEGER) {
      this.stopAll();
      return 0;
    }
    return this.nextPendingID++;
  }
}

function startupReaderRank(reader: object): number {
  const tabID = readOwnData(reader, "tabID");
  const window = readOwnData(reader, "_window");
  if (!isObject(window)) return 0;
  try {
    if (tabID === MISSING_OWN_DATA) return 1;
    if (typeof tabID !== "string" && typeof tabID !== "number") return 0;
    const normalized = String(tabID);
    if (!normalized || normalized.trim() !== normalized) return 0;
    return String((window as any).Zotero_Tabs?.selectedID) === normalized &&
      Zotero.Reader.getByTabID(normalized) === reader
      ? 2
      : 0;
  } catch {
    return 0;
  }
}

const MISSING_OWN_DATA = Symbol("missing-own-data");

function readOwnData(target: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) return MISSING_OWN_DATA;
    return "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function sourceRank(source: PendingSource): number {
  return source === "tab-select"
    ? 4
    : source === "toolbar"
      ? 3
      : source === "startup"
        ? 2
        : 1;
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
