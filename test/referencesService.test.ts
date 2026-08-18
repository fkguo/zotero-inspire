import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/inspire/rateLimiter", () => ({
  inspireFetch: vi.fn(),
}));

vi.mock("../src/utils/prefs", () => ({
  getPref: vi.fn(),
}));

vi.mock("../src/utils/locale", () => ({
  getString: (key: string) => {
    const strings: Record<string, string> = {
      "references-panel-no-title": "Title unavailable",
      "references-panel-year-unknown": "Unknown year",
      "references-panel-unknown-author": "Unknown author",
    };
    return strings[key] ?? key;
  },
}));

import { getPref } from "../src/utils/prefs";
import { inspireFetch } from "../src/modules/inspire/rateLimiter";
import { enrichReferencesEntries } from "../src/modules/inspire/referencesService";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

const inspireFetchMock = vi.mocked(inspireFetch);
const getPrefMock = vi.mocked(getPref);

let batchPreference: number | undefined;

function createEntries(
  count: number,
  startRecid: number,
): InspireReferenceEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const recid = String(startRecid + index);
    return {
      id: `entry-${recid}`,
      recid,
      title: "Title unavailable",
      authors: ["Original Author"],
      totalAuthors: 1,
      authorText: "Original Author",
      year: "2020",
      displayText: "",
      searchText: "",
    };
  });
}

function getRequestedRecids(url: string): string[] {
  const query = new URL(url).searchParams.get("q") ?? "";
  return Array.from(query.matchAll(/recid:(\d+)/g), (match) => match[1]);
}

function successResponse(recids: string[]): Response {
  return new Response(
    JSON.stringify({
      hits: {
        hits: recids.map((recid) => ({
          id: recid,
          metadata: {
            control_number: Number(recid),
            titles: [{ title: `Resolved title ${recid}` }],
            authors: [{ full_name: `Author ${recid}` }],
            author_count: 1,
            citation_count: 1,
            earliest_date: "2020-01-01",
          },
        })),
      },
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  batchPreference = undefined;
  getPrefMock.mockImplementation((key) => {
    if (key === "local_cache_enrich_batch") return batchPreference;
    if (key === "local_cache_enrich_parallel") return 1;
    return undefined;
  });
  inspireFetchMock.mockReset();
  vi.stubGlobal("Zotero", { debug: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reference metadata enrichment batching", () => {
  it("uses the empirically verified default batch size of 87", async () => {
    const entries = createEntries(87, 1000);
    inspireFetchMock.mockImplementation(async (url) =>
      successResponse(getRequestedRecids(String(url))),
    );

    const result = await enrichReferencesEntries(entries);

    expect(inspireFetchMock).toHaveBeenCalledTimes(1);
    expect(
      getRequestedRecids(String(inspireFetchMock.mock.calls[0][0])),
    ).toHaveLength(87);
    expect(result.complete).toBe(true);
    expect(result.processedRecids).toHaveLength(87);
    expect(
      entries.every((entry) => entry.title.startsWith("Resolved title")),
    ).toBe(true);
  });

  it("adaptively splits an oversized 502 batch and applies both halves", async () => {
    batchPreference = 88;
    const entries = createEntries(88, 2000);
    inspireFetchMock.mockImplementation(async (url) => {
      const recids = getRequestedRecids(String(url));
      return recids.length > 44
        ? new Response("Bad Gateway", { status: 502 })
        : successResponse(recids);
    });

    const result = await enrichReferencesEntries(entries);

    expect(inspireFetchMock).toHaveBeenCalledTimes(3);
    expect(
      inspireFetchMock.mock.calls.map(
        (call) => getRequestedRecids(String(call[0])).length,
      ),
    ).toEqual([88, 44, 44]);
    expect(result.complete).toBe(true);
    expect(result.failedRecids).toEqual([]);
    expect(result.processedRecids).toHaveLength(88);
  });

  it("reports failed recids when adaptive sub-batches still fail", async () => {
    batchPreference = 30;
    const entries = createEntries(30, 3000);
    inspireFetchMock.mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );

    const result = await enrichReferencesEntries(entries);

    expect(inspireFetchMock).toHaveBeenCalledTimes(3);
    expect(result.complete).toBe(false);
    expect(result.failedRecids).toHaveLength(30);
    expect(result.processedRecids).toEqual([]);
  });

  it("retries a network exception once without multiplying requests", async () => {
    batchPreference = 25;
    const entries = createEntries(10, 4000);
    inspireFetchMock
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockImplementationOnce(async (url) =>
        successResponse(getRequestedRecids(String(url))),
      );

    const result = await enrichReferencesEntries(entries);

    expect(inspireFetchMock).toHaveBeenCalledTimes(2);
    expect(result.complete).toBe(true);
    expect(result.processedRecids).toHaveLength(10);
  });
});
