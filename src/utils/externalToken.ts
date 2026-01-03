import { config } from "../../package.json";
import { getPref, setPref } from "./prefs";

const EXTERNAL_TOKEN_PREF_KEY = "external_token" as const;

function generateExternalToken(): string {
  try {
    const cryptoObj: Crypto | undefined = (globalThis as any).crypto;
    if (cryptoObj?.getRandomValues) {
      const bytes = new Uint8Array(32);
      cryptoObj.getRandomValues(bytes);
      let binary = "";
      for (const b of bytes) {
        binary += String.fromCharCode(b);
      }
      // base64url without padding
      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }
  } catch (_err) {
    // Fall through to Math.random-based token
  }

  const a = Math.random().toString(36).slice(2);
  const b = Math.random().toString(36).slice(2);
  const c = Date.now().toString(36);
  return `${c}.${a}.${b}`;
}

export function ensureExternalToken(): string {
  const existing = getPref(EXTERNAL_TOKEN_PREF_KEY);
  if (typeof existing === "string" && existing.trim()) {
    return existing.trim();
  }
  const token = generateExternalToken();
  setPref(EXTERNAL_TOKEN_PREF_KEY, token);
  Zotero.debug?.(
    `[${config.addonName}] Generated new external token (pref: ${config.prefsPrefix}.${EXTERNAL_TOKEN_PREF_KEY})`,
  );
  return token;
}

export function getExternalToken(): string {
  return ensureExternalToken();
}

