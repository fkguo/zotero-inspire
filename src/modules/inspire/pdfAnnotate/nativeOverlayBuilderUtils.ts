import { NATIVE_OVERLAY_LIMITS } from "./nativeOverlayTypes";
import type { NativeDocumentTuple } from "./nativeOverlayProfile";
import type {
  NativeBuildSliceResult,
  NativeOverlayBuildState,
} from "./nativeOverlayBuilder";

const nativeObjectIdentities = new WeakMap<object, number>();
let nextNativeObjectIdentity = 1;

/**
 * Returns a scalar continuity token without retaining the host object. The
 * weak-key table may outlive a slice, but only the number crosses into build
 * state and the table cannot keep a Reader/PDF.js object alive.
 */
export function getNativeObjectIdentity(value: unknown): number | undefined {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  try {
    const object = value as object;
    const existing = nativeObjectIdentities.get(object);
    if (existing !== undefined) return existing;
    if (nextNativeObjectIdentity > Number.MAX_SAFE_INTEGER) return undefined;
    const identity = nextNativeObjectIdentity++;
    nativeObjectIdentities.set(object, identity);
    return identity;
  } catch {
    return undefined;
  }
}

export function getOwnDataDescriptor(
  target: unknown,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  try {
    return target &&
      (typeof target === "object" || typeof target === "function")
      ? Object.getOwnPropertyDescriptor(target, key)
      : undefined;
  } catch {
    return undefined;
  }
}

export function readDenseArrayLength(value: any[]): number | undefined {
  const descriptor = getOwnDataDescriptor(value, "length");
  return descriptor &&
    "value" in descriptor &&
    Number.isSafeInteger(descriptor.value) &&
    descriptor.value >= 0
    ? descriptor.value
    : undefined;
}

export function reserveNativeText(
  state: NativeOverlayBuildState,
  units: number,
): boolean {
  if (
    state.retainedTextUnits + units >
    NATIVE_OVERLAY_LIMITS.maxRetainedTextUnits
  ) {
    return false;
  }
  state.retainedTextUnits += units;
  return true;
}

export function equalNativeSignature(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): boolean {
  return (
    a.length === b.length &&
    a.every((pair, index) => pair[0] === b[index][0] && pair[1] === b[index][1])
  );
}

export function equalNativeTuple(
  a: NativeDocumentTuple,
  b: NativeDocumentTuple,
): boolean {
  return a.documentKey === b.documentKey && a.numPages === b.numPages;
}

export function terminateNativeBuild(
  state: NativeOverlayBuildState,
  code: string,
): NativeBuildSliceResult {
  state.phase = "terminal";
  state.terminalCode = code;
  return { kind: "terminal", code };
}
