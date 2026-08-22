import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";

export interface CanonicalReaderAdmission {
  reader: object;
  sourceAttachmentItemID: number;
  tabID?: string;
  window?: object;
}

export type ReaderAdmissionResult =
  | { kind: "admitted"; value: CanonicalReaderAdmission }
  | { kind: "unavailable"; code: string }
  | { kind: "refused"; code: string };

export class OverlayAdmissionGuard {
  private managerRefusedReaders = new WeakSet<object>();

  isManagerRefused(reader: unknown): boolean {
    return isObject(reader) && this.managerRefusedReaders.has(reader);
  }

  validate(candidate: unknown): ReaderAdmissionResult {
    if (!isObject(candidate)) return { kind: "refused", code: "reader-shape" };
    if (this.managerRefusedReaders.has(candidate)) {
      return { kind: "refused", code: "manager-identity-refused" };
    }
    const snapshot = this.snapshotManagerReaders();
    if (!snapshot) return { kind: "unavailable", code: "manager-unavailable" };
    if (snapshot.length > NATIVE_OVERLAY_LIMITS.maxManagerReaders) {
      return { kind: "refused", code: "manager-reader-cap" };
    }
    let occurrences = 0;
    for (const reader of snapshot) {
      if (reader === candidate) occurrences++;
    }
    if (occurrences !== 1) {
      this.managerRefusedReaders.add(candidate);
      return { kind: "refused", code: "manager-identity-refused" };
    }

    const type = readAllowedGetter(candidate, "type");
    if (type !== "pdf") return { kind: "refused", code: "reader-not-pdf" };
    const itemID = readAllowedGetter(candidate, "itemID");
    if (!Number.isSafeInteger(itemID) || (itemID as number) <= 0) {
      return { kind: "refused", code: "admission-source-id-invalid" };
    }
    const tabIDValue = readOwnData(candidate, "tabID");
    const tabID =
      tabIDValue.kind === "missing"
        ? undefined
        : tabIDValue.kind === "value"
          ? normalizeTabID(tabIDValue.value)
          : undefined;
    if (tabIDValue.kind !== "missing" && tabID === undefined) {
      return { kind: "refused", code: "reader-tab-id-shape" };
    }
    const windowValue = readOwnData(candidate, "_window");
    if (windowValue.kind !== "value" || !isObject(windowValue.value)) {
      return { kind: "refused", code: "reader-window-shape" };
    }
    const window = windowValue.value;
    return {
      kind: "admitted",
      value: {
        reader: candidate,
        sourceAttachmentItemID: itemID as number,
        tabID,
        window,
      },
    };
  }

  snapshotForStartup(): object[] | undefined {
    const snapshot = this.snapshotManagerReaders();
    if (
      !snapshot ||
      snapshot.length > NATIVE_OVERLAY_LIMITS.maxManagerReaders
    ) {
      return undefined;
    }
    return snapshot.filter(isObject);
  }

  reset(): void {
    this.managerRefusedReaders = new WeakSet();
  }

  private snapshotManagerReaders(): unknown[] | undefined {
    try {
      const manager = Zotero?.Reader as unknown;
      if (!isObject(manager)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(manager, "_readers");
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !Array.isArray(descriptor.value)
      ) {
        return undefined;
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(
        descriptor.value,
        "length",
      );
      const length =
        lengthDescriptor && "value" in lengthDescriptor
          ? lengthDescriptor.value
          : undefined;
      if (!Number.isSafeInteger(length) || length < 0) return undefined;
      if (length > NATIVE_OVERLAY_LIMITS.maxManagerReaders) {
        return new Array(NATIVE_OVERLAY_LIMITS.maxManagerReaders + 1);
      }
      const snapshot: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const slot = Object.getOwnPropertyDescriptor(
          descriptor.value,
          String(i),
        );
        if (!slot || !("value" in slot)) return undefined;
        snapshot.push(slot.value);
      }
      return snapshot;
    } catch {
      return undefined;
    }
  }
}

function isObject(value: unknown): value is object {
  return !!value && (typeof value === "object" || typeof value === "function");
}

function readAllowedGetter(target: object, key: string): unknown {
  try {
    return (target as any)[key];
  } catch {
    return undefined;
  }
}

type OwnDataRead =
  | { kind: "value"; value: unknown }
  | { kind: "missing" }
  | { kind: "wrong" };

function readOwnData(target: object, key: string): OwnDataRead {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) return { kind: "missing" };
    return "value" in descriptor
      ? { kind: "value", value: descriptor.value }
      : { kind: "wrong" };
  } catch {
    return { kind: "wrong" };
  }
}

function normalizeTabID(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "number" && !Number.isSafeInteger(value))
    return undefined;
  try {
    const normalized = String(value);
    return normalized && normalized.trim() === normalized
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}
