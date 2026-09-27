import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as pako from "pako";

// localCache for the arXiv listing type: records never expire by the time
// they were written; purgeExpired drops a day's listing once its
// announcement date is more than 100 days old. The file system is a stand-in
// for Zotero's IOUtils.

vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) =>
    ({
      local_cache_enable: true,
      local_cache_custom_dir: "",
      local_cache_compression: true,
      local_cache_ttl_hours: 24,
    })[key],
}));

import { localCache } from "../src/modules/inspire/localCache";

const DIR = "/zotero/zoteroinspire-cache";
const files = new Map<string, Uint8Array | string>();
const removed: string[] = [];

beforeEach(() => {
  files.clear();
  removed.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-09-28T01:00:00Z"));
  vi.stubGlobal("Zotero", {
    debug: () => {},
    DataDirectory: { dir: "/zotero" },
  });
  vi.stubGlobal("PathUtils", { join: (...parts: string[]) => parts.join("/") });
  vi.stubGlobal("IOUtils", {
    exists: async (path: string) => path === DIR || files.has(path),
    makeDirectory: async () => {},
    getChildren: async () => [...files.keys()],
    stat: async () => ({
      size: 1,
      lastModified: Date.parse("2026-09-28T00:00:00Z"),
    }),
    remove: async (path: string) => {
      removed.push(path);
      files.delete(path);
    },
    write: async (path: string, data: Uint8Array) => {
      files.set(path, data);
    },
    writeJSON: async (path: string, data: unknown) => {
      files.set(path, JSON.stringify(data));
    },
    read: async (path: string) => files.get(path),
    readJSON: async (path: string) => JSON.parse(files.get(path) as string),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("localCache type arxiv_listing", () => {
  it("drops listings whose announcement date is more than 100 days old", async () => {
    for (const name of [
      "arxiv_listing_day_hep-ph_2026-06-19.json.gz",
      "arxiv_listing_day_hep-ph_2026-06-20.json.gz",
      "arxiv_listing_day_astro-ph.CO_2026-01-02.json",
      "arxiv_listing_new_hep-ph.json.gz",
      "arxiv_listing_recent_math.json.gz",
      "refs_12345.json.gz",
    ]) {
      files.set(`${DIR}/${name}`, new Uint8Array());
    }
    expect(await localCache.purgeExpired()).toBe(2);
    expect(removed.map((path) => path.slice(DIR.length + 1)).sort()).toEqual([
      "arxiv_listing_day_astro-ph.CO_2026-01-02.json",
      "arxiv_listing_day_hep-ph_2026-06-19.json.gz",
    ]);
  });

  it("writes listings without an expiry and reads them back", async () => {
    const value = { format: 1, listing: { spec: "hep-ph", entries: [] } };
    await localCache.set("arxiv_listing", "day_hep-ph_2026-09-25", value);
    await localCache.flushWrites();
    const path = `${DIR}/arxiv_listing_day_hep-ph_2026-09-25.json.gz`;
    const written = JSON.parse(
      pako.ungzip(files.get(path) as Uint8Array, { to: "string" }),
    );
    expect(written).toMatchObject({ t: "arxiv_listing", ttl: -1, d: value });
    // A year later the record is still returned
    vi.setSystemTime(Date.parse("2027-09-28T01:00:00Z"));
    const read = await localCache.get("arxiv_listing", "day_hep-ph_2026-09-25");
    expect(read?.data).toEqual(value);
  });
});
