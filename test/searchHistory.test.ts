import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { config } from "../package.json";
import {
  SearchHistoryStore,
  academicSearchHistory,
  literatureSearchHistory,
} from "../src/modules/inspire/searchHistory";
import { clearAllHistoryPrefs } from "../src/modules/inspire/utils";

const prefs = new Map<string, unknown>();
beforeEach(() => {
  prefs.clear();
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Prefs: {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: unknown) => prefs.set(key, value),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("shared persistent search history", () => {
  it("persists across instances, moves repeated queries to the top, and isolates author searches", () => {
    academicSearchHistory.add("  Feng-Kun Guo  ");
    academicSearchHistory.add("Ulf Meissner");
    academicSearchHistory.add("Feng-Kun Guo");
    literatureSearchHistory.add("find a guo and date 2026");
    expect(
      new SearchHistoryStore("academicAuthorSearchHistory")
        .read()
        .map((x) => x.query),
    ).toEqual(["Feng-Kun Guo", "Ulf Meissner"]);
    academicSearchHistory.clear();
    expect(academicSearchHistory.read()).toEqual([]);
    expect(literatureSearchHistory.read()).toHaveLength(1);
    academicSearchHistory.add("new author");
    clearAllHistoryPrefs();
    expect(academicSearchHistory.read()).toEqual([]);
    expect(literatureSearchHistory.read()).toEqual([]);
  });
  it("shares retention settings, migrates old arrays, and tolerates malformed entries", () => {
    const key = `${config.addonRef}.testHistory`;
    const store = new SearchHistoryStore("testHistory");
    prefs.set(
      key,
      JSON.stringify([
        "legacy",
        "legacy",
        null,
        { query: 9 },
        { query: "old", timestamp: Date.now() - 3 * 86400000 },
        { query: "recent", timestamp: Date.now() },
      ]),
    );
    prefs.set(`${config.prefsPrefix}.search_history_days`, 2);
    expect(store.read().map((x) => x.query)).toEqual(["legacy", "recent"]);
    expect(JSON.parse(prefs.get(key) as string)[0].timestamp).toEqual(
      expect.any(Number),
    );
    prefs.set(key, "broken json");
    expect(store.read()).toEqual([]);
    prefs.set(key, JSON.stringify({ query: "bad shape" }));
    expect(store.read()).toEqual([]);
  });
  it("retains at most fifty entries without overwriting another instance's new query", () => {
    const first = new SearchHistoryStore("bounded"),
      second = new SearchHistoryStore("bounded");
    for (let i = 0; i < 55; i++) first.add(`author ${i}`);
    second.add("another window");
    first.add("latest");
    expect(first.read()).toHaveLength(50);
    expect(
      first
        .read()
        .slice(0, 2)
        .map((x) => x.query),
    ).toEqual(["latest", "another window"]);
  });
});
