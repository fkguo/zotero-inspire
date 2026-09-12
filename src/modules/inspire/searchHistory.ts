import { config } from "../../../package.json";
import {
  SEARCH_HISTORY_PREF_KEY,
  ACADEMIC_SEARCH_HISTORY_PREF_KEY,
  SEARCH_HISTORY_MAX_ENTRIES,
  SEARCH_HISTORY_DAYS_PREF_KEY,
  SEARCH_HISTORY_DAYS_DEFAULT,
} from "./constants";
import type { SearchHistoryItem } from "./types";

/** Shared persistent history, with separate namespaces for different searches. */
export class SearchHistoryStore {
  constructor(private key: string) {}

  read(): SearchHistoryItem[] {
    try {
      const stored = Zotero.Prefs.get(`${config.addonRef}.${this.key}`, true);
      if (!stored || typeof stored !== "string") return [];
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      const now = Date.now();
      const configured = Zotero.Prefs.get(
        `${config.prefsPrefix}.${SEARCH_HISTORY_DAYS_PREF_KEY}`,
        true,
      );
      const days =
        typeof configured === "number" &&
        configured > 0 &&
        Number.isFinite(configured)
          ? configured
          : SEARCH_HISTORY_DAYS_DEFAULT;
      const cutoff = now - days * 86400000;
      const result: SearchHistoryItem[] = [];
      const seen = new Set<string>();
      for (const value of parsed) {
        const item =
          typeof value === "string" ? { query: value, timestamp: now } : value;
        if (
          !item ||
          typeof item.query !== "string" ||
          typeof item.timestamp !== "number" ||
          !Number.isFinite(item.timestamp) ||
          item.timestamp < cutoff
        )
          continue;
        const query = item.query.trim();
        if (!query || seen.has(query)) continue;
        seen.add(query);
        result.push({ query, timestamp: item.timestamp });
        if (result.length === SEARCH_HISTORY_MAX_ENTRIES) break;
      }
      if (JSON.stringify(parsed) !== JSON.stringify(result)) this.save(result);
      return result;
    } catch (error) {
      Zotero.debug(
        `[${config.addonName}] Failed to read search history: ${error}`,
      );
      return [];
    }
  }

  add(query: string): SearchHistoryItem[] {
    query = query.trim();
    const current = this.read();
    if (!query) return current;
    const result = [
      { query, timestamp: Date.now() },
      ...current.filter((item) => item.query !== query),
    ].slice(0, SEARCH_HISTORY_MAX_ENTRIES);
    this.save(result);
    return result;
  }

  clear(): void {
    this.save([]);
  }

  private save(items: SearchHistoryItem[]): void {
    try {
      Zotero.Prefs.set(
        `${config.addonRef}.${this.key}`,
        JSON.stringify(items),
        true,
      );
    } catch (error) {
      Zotero.debug(
        `[${config.addonName}] Failed to save search history: ${error}`,
      );
    }
  }
}

export const literatureSearchHistory = new SearchHistoryStore(
  SEARCH_HISTORY_PREF_KEY,
);
export const academicSearchHistory = new SearchHistoryStore(
  ACADEMIC_SEARCH_HISTORY_PREF_KEY,
);
