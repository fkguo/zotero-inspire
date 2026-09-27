import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpecDayListing } from "../src/modules/arxiv/listingTypes";

// LocalCacheListingStore on a stand-in for localCache: what it writes under
// which key, what it accepts when reading back, and its in-memory layer.

const cache = vi.hoisted(() => ({
  files: new Map<string, unknown>(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: { get: cache.get, set: cache.set },
}));

import { LocalCacheListingStore } from "../src/modules/arxiv/listingStore";

const listing: SpecDayListing = {
  spec: "hep-ph",
  date: "2026-09-25",
  source: "new",
  total: 1,
  entries: [
    {
      id: "2609.28538",
      title: "T",
      authors: [{ display: "R. Di Vora", family: "Di Vora", given: "R." }],
      abstract: "",
      primaryCategory: "hep-ph",
      categories: ["hep-ph"],
      section: "new",
    },
  ],
  fetchedAt: 1000,
};

beforeEach(() => {
  cache.files.clear();
  cache.get.mockImplementation(async (type: string, key: string) =>
    cache.files.has(`${type}/${key}`)
      ? {
          data: cache.files.get(`${type}/${key}`),
          fromCache: true,
          ageHours: 0,
        }
      : null,
  );
  cache.set.mockImplementation(
    async (type: string, key: string, data: unknown) => {
      cache.files.set(`${type}/${key}`, data);
    },
  );
  vi.stubGlobal("Zotero", { debug: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LocalCacheListingStore", () => {
  it("writes each record as an object under its key", async () => {
    const store = new LocalCacheListingStore();
    await store.putDay(listing);
    await store.putNewMarker("hep-ph", { date: "2026-09-25", fetchedAt: 1000 });
    await store.putRecentIndex("math", {
      dates: ["2026-09-25"],
      fetchedAt: 2000,
    });
    expect([...cache.files.keys()]).toEqual([
      "arxiv_listing/day_hep-ph_2026-09-25",
      "arxiv_listing/new_hep-ph",
      "arxiv_listing/recent_math",
    ]);
    expect(cache.files.get("arxiv_listing/day_hep-ph_2026-09-25")).toEqual({
      format: 1,
      listing,
    });
    expect(cache.files.get("arxiv_listing/new_hep-ph")).toEqual({
      format: 1,
      date: "2026-09-25",
      fetchedAt: 1000,
    });
  });

  it("reads records back in a new session", async () => {
    await new LocalCacheListingStore().putDay(listing);
    await new LocalCacheListingStore().putNewMarker("hep-ph", {
      date: "2026-09-25",
      fetchedAt: 1000,
    });
    const store = new LocalCacheListingStore();
    expect(await store.getDay("hep-ph", "2026-09-25")).toEqual(listing);
    expect(await store.getNewMarker("hep-ph")).toEqual({
      date: "2026-09-25",
      fetchedAt: 1000,
    });
    expect(await store.getDay("hep-ph", "2026-09-24")).toBeNull();
    expect(await store.getRecentIndex("math")).toBeNull();
  });

  it("serves what it has read or written from memory", async () => {
    const store = new LocalCacheListingStore();
    await store.putDay(listing);
    await store.getDay("hep-ph", "2026-09-25");
    await store.getDay("hep-ph", "2026-09-25");
    expect(cache.get).not.toHaveBeenCalled();
  });

  it("works from memory when the local cache is switched off", async () => {
    // localCache.get/set do nothing when local_cache_enable is off
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    const store = new LocalCacheListingStore();
    await store.putDay(listing);
    expect(await store.getDay("hep-ph", "2026-09-25")).toEqual(listing);
  });

  it("ignores records of another shape", async () => {
    cache.files.set("arxiv_listing/day_hep-ph_2026-09-25", {
      format: 2,
      listing,
    });
    cache.files.set("arxiv_listing/new_hep-ph", { format: 1, date: 20260925 });
    cache.files.set("arxiv_listing/recent_math", [{ title: "x", authors: [] }]);
    const store = new LocalCacheListingStore();
    expect(await store.getDay("hep-ph", "2026-09-25")).toBeNull();
    expect(await store.getNewMarker("hep-ph")).toBeNull();
    expect(await store.getRecentIndex("math")).toBeNull();
  });

  it("treats a failing read as a miss", async () => {
    cache.get.mockRejectedValue(new Error("disk"));
    const store = new LocalCacheListingStore();
    expect(await store.getDay("hep-ph", "2026-09-25")).toBeNull();
  });
});
