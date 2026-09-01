import { config } from "../../package.json";
import { getPref, setPref } from "./prefs";

const EXTERNAL_TOKEN_PREF_KEY = "external_token" as const;
const EXTERNAL_READ_TOKEN_PREF_KEY = "external_read_token" as const;
const SECURE_EXTERNAL_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type ExternalTokenPrefKey =
  | typeof EXTERNAL_TOKEN_PREF_KEY
  | typeof EXTERNAL_READ_TOKEN_PREF_KEY;

function generateSecureExternalToken(): string | null {
  const globalCrypto: Crypto | undefined = (globalThis as any).crypto;
  const windowCrypto: Crypto | undefined = (() => {
    try {
      return (Zotero as any).getMainWindow?.()?.crypto;
    } catch (_err) {
      return undefined;
    }
  })();

  for (const cryptoObj of [globalCrypto, windowCrypto]) {
    if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") continue;
    try {
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
    } catch (_err) {
      // Try the next Web Crypto realm before failing closed.
    }
  }

  return null;
}

function readToken(prefKey: ExternalTokenPrefKey): string | null {
  const existing = getPref(prefKey);
  if (typeof existing === "string" && existing.trim()) {
    return existing.trim();
  }
  return null;
}

function readSecureToken(prefKey: ExternalTokenPrefKey): string | null {
  const token = readToken(prefKey);
  return token && SECURE_EXTERNAL_TOKEN_RE.test(token) ? token : null;
}

function persistToken(prefKey: ExternalTokenPrefKey, token: string): string {
  setPref(prefKey, token);
  Zotero.debug?.(
    `[${config.addonName}] Generated new external token (pref: ${config.prefsPrefix}.${prefKey})`,
  );
  return token;
}

export function ensureExternalToken(): string | null {
  const existing = readSecureToken(EXTERNAL_TOKEN_PREF_KEY);
  if (existing) return existing;

  const token = generateSecureExternalToken();
  if (!token) return null;

  return persistToken(EXTERNAL_TOKEN_PREF_KEY, token);
}

export function getExternalToken(): string | null {
  return ensureExternalToken();
}

/**
 * Ensure the least-privilege token used by read-only connector endpoints.
 * This token is intentionally distinct from `external_token`, which authorizes
 * attachment and deletion operations.
 */
export function ensureExternalReadToken(): string | null {
  const existing = readExternalReadToken();
  if (existing) return existing;

  const token = generateSecureExternalToken();
  if (!token) return null;

  return persistToken(EXTERNAL_READ_TOKEN_PREF_KEY, token);
}

/** Read the existing read-only token without mutating preferences. */
export function readExternalReadToken(): string | null {
  return readSecureToken(EXTERNAL_READ_TOKEN_PREF_KEY);
}

export function getExternalReadToken(): string | null {
  return ensureExternalReadToken();
}
