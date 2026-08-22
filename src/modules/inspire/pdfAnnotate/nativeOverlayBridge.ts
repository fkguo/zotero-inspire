export type NativeOwnDataResult =
  | { kind: "value"; value: unknown }
  | { kind: "missing" }
  | { kind: "wrong" };

export type NativeWaivedRootRead =
  | {
      kind: "ready";
      waivedRoot: any;
      unwaive: (value: unknown) => any;
    }
  | { kind: "pending"; marker?: string }
  | { kind: "incompatible"; code: string; marker?: string };

export type NativeFrameIdentityRead =
  | {
      kind: "ready";
      browsingContextID: string;
      innerWindowID: string;
      marker: string;
    }
  | { kind: "pending"; marker: string }
  | { kind: "incompatible"; code: string; marker?: string };

export function readNativeOwnData(
  target: unknown,
  key: PropertyKey,
): NativeOwnDataResult {
  if (!isNativeObject(target)) return { kind: "wrong" };
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

export function isNativeObject(value: unknown): value is object {
  return !!value && (typeof value === "object" || typeof value === "function");
}

export function openNativeWaivedRoot(
  outerReader: unknown,
): NativeWaivedRootRead {
  try {
    const internal = readNativeOwnData(outerReader, "_internalReader");
    if (internal.kind === "missing") {
      return { kind: "pending", marker: "internal-reader" };
    }
    if (internal.kind === "value" && internal.value == null) {
      return { kind: "pending", marker: "internal-reader" };
    }
    if (internal.kind !== "value" || !isNativeObject(internal.value)) {
      return { kind: "incompatible", code: "internal-reader-shape" };
    }
    const components =
      (globalThis as any).Cu ?? (globalThis as any).Components?.utils;
    if (
      typeof components?.waiveXrays !== "function" ||
      typeof components?.unwaiveXrays !== "function"
    ) {
      return { kind: "incompatible", code: "xray-bridge-unavailable" };
    }
    const waivedRoot = components.waiveXrays(internal.value);
    if (!isNativeObject(waivedRoot)) {
      return { kind: "incompatible", code: "xray-root-shape" };
    }
    return {
      kind: "ready",
      waivedRoot,
      unwaive: components.unwaiveXrays.bind(components),
    };
  } catch {
    return { kind: "incompatible", code: "xray-bridge-failure" };
  }
}

export function readNativeBrowsingContextID(
  waivedRoot: any,
  unwaive: (value: unknown) => any,
): string | undefined {
  const primary = readNativeOwnData(waivedRoot, "_primaryView");
  if (primary.kind !== "value" || !isNativeObject(primary.value)) {
    return undefined;
  }
  const iframe = readNativeOwnData(primary.value, "_iframe");
  if (iframe.kind !== "value" || !isNativeObject(iframe.value)) {
    return undefined;
  }
  try {
    const id = unwaive(iframe.value)?.browsingContext?.id;
    return Number.isSafeInteger(id) && id > 0 ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

export function readNativeFrameIdentities(
  waivedIframe: object,
  unwaive: (value: unknown) => any,
): NativeFrameIdentityRead {
  try {
    const iframe = unwaive(waivedIframe);
    if (!isNativeObject(iframe)) {
      return { kind: "incompatible", code: "iframe-xray-shape" };
    }
    const context = (iframe as any).browsingContext;
    if (context == null) {
      return { kind: "pending", marker: "frame-identities" };
    }
    const contextID = context.id;
    if (contextID == null || contextID === 0) {
      return { kind: "pending", marker: "frame-identities" };
    }
    if (!Number.isSafeInteger(contextID) || contextID < 0) {
      return { kind: "incompatible", code: "browsing-context-shape" };
    }
    const contextMarker = `${String(contextID)}:frame`;
    const contentWindow = (iframe as any).contentWindow;
    if (contentWindow == null)
      return { kind: "pending", marker: contextMarker };
    const windowGlobalChild = contentWindow.windowGlobalChild;
    if (windowGlobalChild == null) {
      return { kind: "pending", marker: contextMarker };
    }
    const windowID = windowGlobalChild.innerWindowId;
    if (windowID == null || windowID === 0) {
      return { kind: "pending", marker: contextMarker };
    }
    if (!Number.isSafeInteger(windowID) || windowID < 0) {
      return {
        kind: "incompatible",
        code: "inner-window-shape",
        marker: contextMarker,
      };
    }
    return {
      kind: "ready",
      browsingContextID: String(contextID),
      innerWindowID: String(windowID),
      marker: `${String(contextID)}:${String(windowID)}`,
    };
  } catch {
    return { kind: "incompatible", code: "xray-identity-bridge" };
  }
}
