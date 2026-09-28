// ─────────────────────────────────────────────────────────────────────────────
// A request that waits after an HTTP 429 answer ends as soon as it is
// aborted, instead of sleeping out its backoff (up to 30 s) first.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRateLimiterStatus,
  inspireFetch,
  resetRateLimiter,
} from "../src/modules/inspire/rateLimiter";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  resetRateLimiter();
  vi.stubGlobal("Zotero", { debug: vi.fn() });
  fetchMock = vi.fn(async () => ({
    status: 429,
    headers: { get: (name: string) => (name === "Retry-After" ? "30" : null) },
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("INSPIRE request in a 429 backoff", () => {
  it("ends with an AbortError when aborted", async () => {
    const controller = new AbortController();
    const outcome = inspireFetch("https://inspirehep.net/api/x", {
      signal: controller.signal,
    }).then(
      () => "answered",
      (err) => err?.name,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getRateLimiterStatus().isThrottling).toBe(true);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    let settled: string | undefined;
    void outcome.then((value) => (settled = value));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getRateLimiterStatus().isThrottling).toBe(false);
  });

  it("ends at once when it was aborted before the 429 answer came", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort();
      return {
        status: 429,
        headers: { get: () => "30" },
      };
    });
    let settled: string | undefined;
    void inspireFetch("https://inspirehep.net/api/x", {
      signal: controller.signal,
    }).then(
      () => (settled = "answered"),
      (err) => (settled = err?.name),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getRateLimiterStatus().isThrottling).toBe(false);
  });

  it("still retries after the backoff when not aborted", async () => {
    fetchMock
      .mockImplementationOnce(async () => ({
        status: 429,
        headers: { get: () => "2" },
      }))
      .mockImplementationOnce(async () => ({
        status: 200,
        headers: { get: () => null },
      }));
    const controller = new AbortController();
    const response = inspireFetch("https://inspirehep.net/api/x", {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await response).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getRateLimiterStatus().isThrottling).toBe(false);
  });
});
