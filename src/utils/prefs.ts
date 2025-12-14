import { config } from "../../package.json";

type PrefKey = string & keyof _ZoteroTypes.Prefs["PluginPrefsMap"];
type PrefMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

/**
 * Get preference value.
 * Wrapper of `Zotero.Prefs.get`.
 * @param key
 */
export function getPref<K extends PrefKey>(key: K): PrefMap[K] {
  return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true) as PrefMap[K];
}

/**
 * Set preference value.
 * Wrapper of `Zotero.Prefs.set`.
 * @param key
 * @param value
 */
export function setPref<K extends PrefKey>(key: K, value: PrefMap[K]) {
  return Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
}

/**
 * Clear preference value.
 * Wrapper of `Zotero.Prefs.clear`.
 * @param key
 */
export function clearPref<K extends PrefKey>(key: K) {
  return Zotero.Prefs.clear(`${config.prefsPrefix}.${key}`, true);
}
