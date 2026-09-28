// ─────────────────────────────────────────────────────────────────────────────
// The shared INSPIRE send window: at most 12 actual sends in any 5 seconds,
// counting retries after 429 answers; foreground requests before background
// ones; a request cancelled while it waits is never sent.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRateLimiterStatus,
  inspireFetch,
  resetRateLimiter,
} from "../src/modules/inspire/rateLimiter";

/** Send times (fake clock) and URLs, in order */
let sends: { t: number; url: string }[];
let fetchMock: ReturnType<typeof vi.fn>;
let start: number;

function ok() {
  return { status: 200, headers: { get: () => null } };
}

function tooMany(retryAfter: string | null) {
  return {
    status: 429,
    headers: {
      get: (name: string) => (name === "Retry-After" ? retryAfter : null),
    },
  };
}

/** Largest number of sends within any window of `ms` */
function maxInWindow(ms: number): number {
  let max = 0;
  for (const first of sends) {
    max = Math.max(
      max,
      sends.filter((s) => s.t >= first.t && s.t < first.t + ms).length,
    );
  }
  return max;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetRateLimiter();
  start = Date.now();
  sends = [];
  vi.stubGlobal("Zotero", { debug: vi.fn() });
  fetchMock = vi.fn(async (url: string) => {
    sends.push({ t: Date.now() - start, url });
    return ok();
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  resetRateLimiter();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("INSPIRE send window", () => {
  it("sends a burst of 30 requests at most 12 in any 5 seconds", async () => {
    const all = Array.from({ length: 30 }, (_, i) =>
      inspireFetch(`https://inspirehep.net/api/r${i}`),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(sends).toHaveLength(12);
    await vi.advanceTimersByTimeAsync(4999);
    expect(sends).toHaveLength(12);
    await vi.advanceTimersByTimeAsync(1);
    expect(sends).toHaveLength(24);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sends).toHaveLength(30);
    await Promise.all(all);
    expect(maxInWindow(5000)).toBe(12);
    // In the order they came
    expect(sends.map((s) => s.url)).toEqual(
      Array.from({ length: 30 }, (_, i) => `https://inspirehep.net/api/r${i}`),
    );
  });

  it("counts from the actual send times: a spread-out series is not delayed", async () => {
    for (let i = 0; i < 20; i++) {
      void inspireFetch(`https://inspirehep.net/api/r${i}`);
      await vi.advanceTimersByTimeAsync(500);
    }
    // One every 0.5 s is 10 per 5 s: never held back
    expect(sends.map((s) => s.t)).toEqual(
      Array.from({ length: 20 }, (_, i) => i * 500),
    );
  });

  it("reports the requests held back while the window is full", async () => {
    for (let i = 0; i < 15; i++) {
      void inspireFetch(`https://inspirehep.net/api/r${i}`);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(getRateLimiterStatus()).toMatchObject({
      queuedCount: 3,
      isThrottling: true,
      timeUntilNextToken: 5000,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(getRateLimiterStatus()).toMatchObject({
      queuedCount: 0,
      isThrottling: false,
    });
  });

  it("sends waiting foreground requests before background ones", async () => {
    for (let i = 0; i < 12; i++) {
      void inspireFetch(`https://inspirehep.net/api/fill${i}`);
    }
    for (let i = 0; i < 3; i++) {
      void inspireFetch(`https://inspirehep.net/api/back${i}`, {
        background: true,
      });
    }
    for (let i = 0; i < 2; i++) {
      void inspireFetch(`https://inspirehep.net/api/front${i}`);
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(sends.slice(12).map((s) => s.url.split("/").pop())).toEqual([
      "front0",
      "front1",
      "back0",
      "back1",
      "back2",
    ]);
  });

  it("never sends a request cancelled while it waits", async () => {
    for (let i = 0; i < 12; i++) {
      void inspireFetch(`https://inspirehep.net/api/fill${i}`);
    }
    const controller = new AbortController();
    const cancelled = inspireFetch("https://inspirehep.net/api/cancelled", {
      signal: controller.signal,
    }).then(
      () => "sent",
      (err) => err.name,
    );
    const after = inspireFetch("https://inspirehep.net/api/after");
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    expect(await cancelled).toBe("AbortError");
    await vi.advanceTimersByTimeAsync(4000);
    await after;
    expect(sends.map((s) => s.url)).not.toContain(
      "https://inspirehep.net/api/cancelled",
    );
    expect(sends[12]).toEqual({
      t: 5000,
      url: "https://inspirehep.net/api/after",
    });
  });
});

describe("INSPIRE retries after 429", () => {
  it("waits at least 5 seconds, even when Retry-After asks for less", async () => {
    fetchMock.mockImplementationOnce(async (url: string) => {
      sends.push({ t: Date.now() - start, url });
      return tooMany("1");
    });
    const response = inspireFetch("https://inspirehep.net/api/x");
    await vi.advanceTimersByTimeAsync(4999);
    expect(sends).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await response).status).toBe(200);
    expect(sends.map((s) => s.t)).toEqual([0, 5000]);
  });

  it("waits as long as Retry-After asks when that is longer", async () => {
    fetchMock.mockImplementationOnce(async (url: string) => {
      sends.push({ t: Date.now() - start, url });
      return tooMany("30");
    });
    const response = inspireFetch("https://inspirehep.net/api/x");
    await vi.advanceTimersByTimeAsync(30000);
    expect((await response).status).toBe(200);
    expect(sends.map((s) => s.t)).toEqual([0, 30000]);
  });

  it("retries three times, then returns the 429 answer", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      sends.push({ t: Date.now() - start, url });
      return tooMany(null);
    });
    const response = inspireFetch("https://inspirehep.net/api/x");
    await vi.advanceTimersByTimeAsync(20000);
    expect((await response).status).toBe(429);
    expect(sends.map((s) => s.t)).toEqual([0, 5000, 10000, 15000]);
  });

  it("queues a retry in the window like any send, keeping its priority", async () => {
    // A background request gets 429; meanwhile a foreground burst fills the
    // window: the retry waits for room and goes after the foreground ones
    fetchMock.mockImplementationOnce(async (url: string) => {
      sends.push({ t: Date.now() - start, url });
      return tooMany(null);
    });
    const background = inspireFetch("https://inspirehep.net/api/back", {
      background: true,
    });
    await vi.advanceTimersByTimeAsync(4000);
    for (let i = 0; i < 20; i++) {
      void inspireFetch(`https://inspirehep.net/api/front${i}`);
    }
    await vi.advanceTimersByTimeAsync(20000);
    expect((await background).status).toBe(200);
    expect(maxInWindow(5000)).toBeLessThanOrEqual(12);
    const urls = sends.map((s) => s.url.split("/").pop());
    expect(urls.indexOf("back", 1)).toBe(urls.length - 1);
  });

  it("returns a 429 at once for callers with their own policy", async () => {
    fetchMock.mockImplementationOnce(async (url: string) => {
      sends.push({ t: Date.now() - start, url });
      return tooMany("30");
    });
    const response = await inspireFetch("https://inspirehep.net/api/x", {
      retryOnRateLimit: false,
    });
    expect(response.status).toBe(429);
    expect(sends).toHaveLength(1);
  });

  it("keeps at most 12 sends in any 5 s with bursts and retries from several callers", async () => {
    let n = 0;
    fetchMock.mockImplementation(async (url: string) => {
      sends.push({ t: Date.now() - start, url });
      // Every fifth send is turned away
      return ++n % 5 === 0 ? tooMany("1") : ok();
    });
    const all: Promise<Response>[] = [];
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 10; i++) {
        all.push(inspireFetch(`https://inspirehep.net/api/f${round}-${i}`));
        all.push(
          inspireFetch(`https://inspirehep.net/api/b${round}-${i}`, {
            background: true,
          }),
        );
      }
      await vi.advanceTimersByTimeAsync(1500);
    }
    await vi.advanceTimersByTimeAsync(120000);
    const statuses = (await Promise.all(all)).map((r) => r.status);
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(maxInWindow(5000)).toBe(12);
  });
});
