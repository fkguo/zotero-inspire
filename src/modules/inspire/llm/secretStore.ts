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

async function ensureLoginManagerReady(loginManager: any): Promise<void> {
  try {
    const p = loginManager?.initializationPromise;
    if (p && typeof p.then === "function") {
      await p;
    }
  } catch {
    // ignore
  }
}

async function findLoginPassword(
  loginManager: any,
  username: string,
): Promise<string | null> {
  try {
    await ensureLoginManagerReady(loginManager);

    if (typeof loginManager?.searchLoginsAsync === "function") {
      const logins: any[] = await loginManager.searchLoginsAsync({
        origin: LOGIN_HOSTNAME,
        httpRealm: LOGIN_REALM,
      });
      const match = Array.isArray(logins)
        ? logins.find((l) => l?.username === username)
        : null;
      const password = match?.password;
      return typeof password === "string" && password ? password : null;
    }

    if (typeof loginManager?.findLogins === "function") {
      const logins: any[] = loginManager.findLogins(
        LOGIN_HOSTNAME,
        null,
        LOGIN_REALM,
      );
      const match = Array.isArray(logins)
        ? logins.find((l) => l?.username === username)
        : null;
      const password = match?.password;
      return typeof password === "string" && password ? password : null;
    }
  } catch (err) {
    Zotero.debug(
      `[${config.addonName}] AI secretStore: read via LoginManager failed: ${err}`,
    );
  }
  return null;
}

async function upsertLoginPassword(
  loginManager: any,
  username: string,
  password: string,
): Promise<boolean> {
  try {
    await ensureLoginManagerReady(loginManager);
    const next = createLoginInfo(username, password);
    if (!next) {
      throw new Error("loginInfo ctor unavailable");
    }

    let existing: any | null = null;
    if (typeof loginManager?.searchLoginsAsync === "function") {
      const logins: any[] = await loginManager.searchLoginsAsync({
        origin: LOGIN_HOSTNAME,
        httpRealm: LOGIN_REALM,
      });
      existing = Array.isArray(logins)
        ? logins.find((l) => l?.username === username)
        : null;
    } else if (typeof loginManager?.findLogins === "function") {
      const logins: any[] = loginManager.findLogins(
        LOGIN_HOSTNAME,
        null,
        LOGIN_REALM,
      );
      existing = Array.isArray(logins)
        ? logins.find((l) => l?.username === username)
        : null;
    }

    if (existing && typeof loginManager?.modifyLogin === "function") {
      loginManager.modifyLogin(existing, next);
      return true;
    }

    if (typeof loginManager?.addLoginAsync === "function") {
      await loginManager.addLoginAsync(next);
      return true;
    }

    if (typeof loginManager?.addLogin === "function") {
      loginManager.addLogin(next);
      return true;
    }
  } catch (err) {
    Zotero.debug(
      `[${config.addonName}] AI secretStore: set via LoginManager failed: ${err}`,
    );
  }
  return false;
}

async function removeLoginPassword(loginManager: any, username: string): Promise<boolean> {
  try {
    await ensureLoginManagerReady(loginManager);

    let existing: any | null = null;
    if (typeof loginManager?.searchLoginsAsync === "function") {
      const logins: any[] = await loginManager.searchLoginsAsync({
        origin: LOGIN_HOSTNAME,
        httpRealm: LOGIN_REALM,
      });
      existing = Array.isArray(logins)
        ? logins.find((l) => l?.username === username)
        : null;
    } else if (typeof loginManager?.findLogins === "function") {
      const logins: any[] = loginManager.findLogins(
        LOGIN_HOSTNAME,
        null,
        LOGIN_REALM,
      );
      existing = Array.isArray(logins)
        ? logins.find((l) => l?.username === username)
        : null;
    }

    if (existing && typeof loginManager?.removeLogin === "function") {
      loginManager.removeLogin(existing);
      return true;
    }
  } catch (err) {
    Zotero.debug(
      `[${config.addonName}] AI secretStore: clear via LoginManager failed: ${err}`,
    );
  }
  return false;
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

export function getAIProviderStorageDebugInfo(providerId: string): {
  loginHostname: string;
  loginRealm: string;
  loginUsername: string;
  prefsKey: string;
} {
  return {
    loginHostname: LOGIN_HOSTNAME,
    loginRealm: LOGIN_REALM,
    loginUsername: sanitizeProviderId(providerId),
    prefsKey: getFallbackPrefKey(providerId),
  };
}

export async function getAIProviderApiKey(
  providerId: string,
): Promise<{ apiKey: string | null; storage: AISecretStorageType }> {
  const username = sanitizeProviderId(providerId);

  const loginManager = getLoginManager();
  if (loginManager) {
    const password = await findLoginPassword(loginManager, username);
    if (typeof password === "string" && password) {
      return { apiKey: password, storage: "loginManager" };
    }
  }

  try {
    const key = getFallbackPrefKey(providerId);
    const value = Zotero.Prefs.get(key, true) as string | undefined;
    if (typeof value === "string" && value.trim()) {
      return { apiKey: value.trim(), storage: "prefsFallback" };
    }
    return { apiKey: null, storage: "none" };
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
  if (loginManager) {
    const ok = await upsertLoginPassword(loginManager, username, password);
    if (ok) {
      try {
        Zotero.Prefs.clear(getFallbackPrefKey(providerId), true);
      } catch {
        // ignore
      }
      return { ok: true, storage: "loginManager" };
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
  const okLogin = loginManager
    ? await removeLoginPassword(loginManager, username)
    : false;
  try {
    const key = getFallbackPrefKey(providerId);
    Zotero.Prefs.clear(key, true);
    return {
      ok: true,
      storage: okLogin ? "loginManager" : "prefsFallback",
    };
  } catch (_err) {
    return { ok: okLogin, storage: okLogin ? "loginManager" : "none" };
  }
}
