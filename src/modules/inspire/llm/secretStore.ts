import { config } from "../../../../package.json";

declare const Services: any;
declare const Cc: any;
declare const Ci: any;

const LOGIN_HOSTNAME = "https://zotero-inspire-ai.local";
const LOGIN_REALM = "zotero-inspire-ai";

function sanitizeProviderId(providerId: string): string {
  return String(providerId || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getLoginManager(): any | null {
  try {
    return typeof Services !== "undefined" ? Services.logins : null;
  } catch (_err) {
    return null;
  }
}

function createLoginInfo(username: string, password: string): any | null {
  try {
    const ctor =
      Cc?.["@mozilla.org/login-manager/loginInfo;1"]?.createInstance?.(
        Ci?.nsILoginInfo,
      ) ?? null;
    if (!ctor) {
      return null;
    }
    // (hostname, formSubmitURL, httpRealm, username, password, usernameField, passwordField)
    ctor.init(LOGIN_HOSTNAME, null, LOGIN_REALM, username, password, "", "");
    return ctor;
  } catch (_err) {
    return null;
  }
}

function getFallbackPrefKey(providerId: string): string {
  const safe = sanitizeProviderId(providerId);
  // Do NOT use dotted keys in PluginPrefsMap to avoid accidentally exposing secrets.
  return `${config.prefsPrefix}.ai_api_key_${safe}`;
}

export type AISecretStorageType = "loginManager" | "prefsFallback" | "none";

export async function getAIProviderApiKey(
  providerId: string,
): Promise<{ apiKey: string | null; storage: AISecretStorageType }> {
  const username = sanitizeProviderId(providerId);

  const loginManager = getLoginManager();
  if (loginManager?.findLogins) {
    try {
      const logins: any[] = loginManager.findLogins(
        LOGIN_HOSTNAME,
        null,
        LOGIN_REALM,
      );
      const match = Array.isArray(logins)
        ? logins.find((l) => l?.username === username)
        : null;
      const password = match?.password;
      if (typeof password === "string" && password) {
        return { apiKey: password, storage: "loginManager" };
      }
      return { apiKey: null, storage: "loginManager" };
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] AI secretStore: findLogins failed: ${err}`,
      );
      // Fall through to prefs fallback.
    }
  }

  try {
    const key = getFallbackPrefKey(providerId);
    const value = Zotero.Prefs.get(key, true) as string | undefined;
    if (typeof value === "string" && value.trim()) {
      return { apiKey: value.trim(), storage: "prefsFallback" };
    }
    return { apiKey: null, storage: "prefsFallback" };
  } catch (_err) {
    return { apiKey: null, storage: "none" };
  }
}

export async function setAIProviderApiKey(
  providerId: string,
  apiKey: string,
): Promise<{ ok: boolean; storage: AISecretStorageType }> {
  const username = sanitizeProviderId(providerId);
  const password = String(apiKey || "").trim();
  if (!password) {
    return { ok: false, storage: "none" };
  }

  const loginManager = getLoginManager();
  if (loginManager?.findLogins && (loginManager?.addLogin || loginManager?.modifyLogin)) {
    try {
      const logins: any[] = loginManager.findLogins(
        LOGIN_HOSTNAME,
        null,
        LOGIN_REALM,
      );
      const existing = Array.isArray(logins)
        ? logins.find((l) => l?.username === username)
        : null;
      const next = createLoginInfo(username, password);
      if (!next) {
        throw new Error("loginInfo ctor unavailable");
      }

      if (existing && loginManager.modifyLogin) {
        loginManager.modifyLogin(existing, next);
      } else {
        loginManager.addLogin(next);
      }
      return { ok: true, storage: "loginManager" };
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] AI secretStore: set via LoginManager failed: ${err}`,
      );
      // Fall through to prefs fallback.
    }
  }

  try {
    const key = getFallbackPrefKey(providerId);
    Zotero.Prefs.set(key, password, true);
    Zotero.debug(
      `[${config.addonName}] AI secretStore: stored API key in prefs fallback (${key}).`,
    );
    return { ok: true, storage: "prefsFallback" };
  } catch (err) {
    Zotero.debug(`[${config.addonName}] AI secretStore: prefs set failed: ${err}`);
    return { ok: false, storage: "none" };
  }
}

export async function clearAIProviderApiKey(
  providerId: string,
): Promise<{ ok: boolean; storage: AISecretStorageType }> {
  const username = sanitizeProviderId(providerId);

  const loginManager = getLoginManager();
  if (loginManager?.findLogins && loginManager?.removeLogin) {
    try {
      const logins: any[] = loginManager.findLogins(
        LOGIN_HOSTNAME,
        null,
        LOGIN_REALM,
      );
      const existing = Array.isArray(logins)
        ? logins.find((l) => l?.username === username)
        : null;
      if (existing) {
        loginManager.removeLogin(existing);
      }
      return { ok: true, storage: "loginManager" };
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] AI secretStore: clear via LoginManager failed: ${err}`,
      );
      // Fall through to prefs fallback.
    }
  }

  try {
    const key = getFallbackPrefKey(providerId);
    Zotero.Prefs.clear(key, true);
    return { ok: true, storage: "prefsFallback" };
  } catch (_err) {
    return { ok: false, storage: "none" };
  }
}

