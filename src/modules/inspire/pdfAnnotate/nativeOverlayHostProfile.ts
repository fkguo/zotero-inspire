export const AUDITED_ZOTERO_10_BUILD_IDS = new Set([
  "20260817111755",
  "20260817151751",
  "20260817151902",
]);

export type NativeOverlayProfileStatus =
  | "audited-zotero-10"
  | "disabled-by-pref"
  | "unsupported-host";

export interface NativeOverlayProfile {
  readonly status: NativeOverlayProfileStatus;
  readonly version: string;
  readonly buildID: string;
}

export function selectNativeOverlayProfile(
  enabledAtStartup: boolean,
): NativeOverlayProfile {
  const version = readVersion();
  const buildID = readBuildID();
  if (!enabledAtStartup) {
    return { status: "disabled-by-pref", version, buildID };
  }
  if (
    (version === "10.0" || version === "10.0.0") &&
    AUDITED_ZOTERO_10_BUILD_IDS.has(buildID)
  ) {
    return { status: "audited-zotero-10", version, buildID };
  }
  return { status: "unsupported-host", version, buildID };
}

export function isAuditedZotero10Build(profile: NativeOverlayProfile): boolean {
  return (
    profile.status === "audited-zotero-10" ||
    (profile.status === "disabled-by-pref" &&
      (profile.version === "10.0" || profile.version === "10.0.0") &&
      AUDITED_ZOTERO_10_BUILD_IDS.has(profile.buildID))
  );
}

function readVersion(): string {
  try {
    const version = (globalThis as any).Services?.appinfo?.version;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}

function readBuildID(): string {
  try {
    const buildID = (globalThis as any).Services?.appinfo?.appBuildID;
    return typeof buildID === "string" ? buildID : "";
  } catch {
    return "";
  }
}
