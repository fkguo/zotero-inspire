import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARXIV_USER_AGENT,
  ArxivFetchError,
  ArxivScheduler,
  parseRetryAfter,
  zoteroTransport,
  type ArxivResponse,
  type ArxivSchedulerStatus,
  type ArxivTransport,
} from "../src/modules/arxiv/arxivFetch";
import { VirtualClock } from "./virtualClock";

// The request schedulers on a simulated clock and network: every request is
// recorded with its start and end, so spacing and "one in flight" are checked
// on exact times.

interface Reply {
  status?: number;
  text?: string;
  headers?: Record<string, string>;
  latencyMs?: number;
  /** Reject instead of answering */
  error?: ArxivFetchError;
}

interface Sent {
  url: string;
  start: number;
  end?: number;
  cancelled?: boolean;
  headers: Record<string, string>;
  timeoutMs: number;
  responseType?: string;
}

function simulatedNetwork(
  clock: VirtualClock,
  reply: (url: string, attempt: number) => Reply = () => ({}),
) {
  const sent: Sent[] = [];
  const attempts = new Map<string, number>();
  const transport: ArxivTransport = (url, options) => {
    const record: Sent = {
      url,
      start: clock.now(),
      headers: options.headers,
      timeoutMs: options.timeoutMs,
      responseType: options.responseType,
    };
    sent.push(record);
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    const answer = reply(url, attempt);
    return new Promise<ArxivResponse>((resolve, reject) => {
      let done = false;
      options.cancelReceiver(() => {
        if (done) return;
        done = true;
        record.cancelled = true;
        record.end = clock.now();
        reject(new ArxivFetchError("cancelled", "cancelled"));
      });
      void clock.sleep(answer.latencyMs ?? 500).then(() => {
        if (done) return;
        done = true;
        record.end = clock.now();
        if (answer.error) {
          reject(answer.error);
          return;
        }
        const headers = new Map(
          Object.entries(answer.headers ?? {}).map(([k, v]) => [
            k.toLowerCase(),
            v,
          ]),
        );
        resolve({
          status: answer.status ?? 200,
          text: answer.text ?? `body of ${url}`,
          header: (name) => headers.get(name.toLowerCase()) ?? null,
        });
      });
    });
  };
  return { sent, transport };
}

/** No two requests overlap, and each starts >= `interval` after the last end */
function expectSerialAndSpaced(sent: Sent[], interval: number) {
  for (let i = 1; i < sent.length; i++) {
    const previousEnd = sent[i - 1].end;
    expect(previousEnd).toBeDefined();
    expect(sent[i].start - previousEnd!).toBeGreaterThanOrEqual(interval);
  }
}

function webScheduler(clock: VirtualClock, transport: ArxivTransport) {
  return new ArxivScheduler({
    host: "arxiv.org",
    minIntervalMs: 15000,
    timeoutMs: 60000,
    transport,
    clock,
  });
}

const page = (n: number) => `https://arxiv.org/list/hep-ph/new?skip=${n}`;

async function rejection(promise: Promise<unknown>): Promise<ArxivFetchError> {
  try {
    await promise;
  } catch (error) {
    return error as ArxivFetchError;
  }
  throw new Error("Expected a rejection");
}

describe("ArxivScheduler spacing", () => {
  it("sends one request at a time, 15 s after the previous one ended", async () => {
    const clock = new VirtualClock(1_000_000);
    const { sent, transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    const results = [0, 1, 2, 3].map((n) => scheduler.request(page(n)));
    await clock.run(Promise.all(results));
    expect(sent.map((s) => s.start - 1_000_000)).toEqual([
      0, 15500, 31000, 46500,
    ]);
    expectSerialAndSpaced(sent, 15000);
    expect((await results[2]).text).toBe(`body of ${page(2)}`);
  });

  it("keeps the order and spacing when several producers add requests", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock, (url) => ({
      latencyMs: url.includes("pdf") ? 4000 : 300,
    }));
    const scheduler = webScheduler(clock, transport);
    const listing = (async () => {
      for (let n = 0; n < 4; n++) await scheduler.request(page(n));
    })();
    const pdf = (async () => {
      await clock.sleep(20000);
      await scheduler.request("https://arxiv.org/pdf/2609.28538v1");
    })();
    const bibtex = (async () => {
      await clock.sleep(21000);
      await Promise.all([
        scheduler.request("https://arxiv.org/bibtex/2609.28538"),
        scheduler.request("https://arxiv.org/bibtex/2609.28544"),
      ]);
    })();
    await clock.run(Promise.all([listing, pdf, bibtex]));
    expect(sent).toHaveLength(7);
    expectSerialAndSpaced(sent, 15000);
    // Requests are served in the order they were queued: the listing queues
    // its next page when the previous one arrives, after the PDF (t = 20 s)
    // and the two BibTeX requests (t = 21 s) had been queued
    expect(sent.map((s) => new URL(s.url).pathname)).toEqual([
      "/list/hep-ph/new",
      "/list/hep-ph/new",
      "/list/hep-ph/new",
      "/pdf/2609.28538v1",
      "/bibtex/2609.28538",
      "/bibtex/2609.28544",
      "/list/hep-ph/new",
    ]);
  });

  it("does not wait when the previous request ended more than 15 s ago", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    await clock.run(scheduler.request(page(0)));
    await clock.advanceBy(60000);
    await clock.run(scheduler.request(page(1)));
    expect(sent[1].start - sent[0].end!).toBe(60000);
  });

  it("uses the API interval of 3 s on export.arxiv.org", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock);
    const api = new ArxivScheduler({
      host: "export.arxiv.org",
      minIntervalMs: 3000,
      timeoutMs: 30000,
      transport,
      clock,
    });
    const url = (n: number) =>
      `https://export.arxiv.org/api/query?id_list=2609.2853${n}`;
    await clock.run(Promise.all([0, 1, 2].map((n) => api.request(url(n)))));
    expect(sent.map((s) => s.start)).toEqual([0, 3500, 7000]);
  });

  it("sends the plugin's User-Agent and the timeout", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    await clock.run(scheduler.request(page(0)));
    await clock.run(scheduler.request(page(1), { timeoutMs: 120000 }));
    expect(sent[0].headers).toEqual({ "User-Agent": ARXIV_USER_AGENT });
    expect(ARXIV_USER_AGENT).toMatch(
      /^zotero-inspire\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/fkguo\/zotero-inspire#readme\)$/,
    );
    expect(sent.map((s) => s.timeoutMs)).toEqual([60000, 120000]);
  });

  it("asks for the body as bytes when told to (a PDF)", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    await clock.run(
      scheduler.request("https://arxiv.org/pdf/2609.28544v2", {
        responseType: "arraybuffer",
      }),
    );
    await clock.run(scheduler.request(page(1)));
    expect(sent.map((s) => s.responseType)).toEqual(["arraybuffer", undefined]);
  });

  it("refuses URLs of other hosts and plain http", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    await expect(
      scheduler.request("https://export.arxiv.org/api/query?id_list=1"),
    ).rejects.toThrow(/does not belong/);
    await expect(
      scheduler.request("http://arxiv.org/list/hep-ph/new"),
    ).rejects.toThrow(/does not belong/);
    await expect(
      scheduler.request("https://www.arxiv.org/list/hep-ph/new"),
    ).rejects.toThrow(/does not belong/);
    expect(sent).toHaveLength(0);
  });

  it("reports waiting, sending and idle", async () => {
    const clock = new VirtualClock();
    const { transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    const states: ArxivSchedulerStatus[] = [];
    scheduler.onStatus((status) => states.push(status));
    await clock.run(
      Promise.all([scheduler.request(page(0)), scheduler.request(page(1))]),
    );
    const kinds = states.map((s) => s.state.kind);
    expect(kinds).toContain("sending");
    const waiting = states.find((s) => s.state.kind === "waiting");
    expect(waiting?.state).toEqual({ kind: "waiting", until: 15500 });
    expect(kinds.at(-1)).toBe("idle");
  });
});

describe("ArxivScheduler cancellation", () => {
  it("never sends a request cancelled while queued", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    const controller = new AbortController();
    const first = scheduler.request(page(0));
    const second = scheduler.request(page(1), { signal: controller.signal });
    const third = scheduler.request(page(2));
    await clock.advanceBy(1000);
    controller.abort();
    expect((await rejection(second)).kind).toBe("cancelled");
    await clock.run(Promise.all([first, third]));
    expect(sent.map((s) => s.url)).toEqual([page(0), page(2)]);
    expect(sent[1].start).toBe(15500);
  });

  it("aborts a request in flight and keeps the interval after it", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock, () => ({
      latencyMs: 10000,
    }));
    const scheduler = webScheduler(clock, transport);
    const controller = new AbortController();
    const first = scheduler.request(page(0), { signal: controller.signal });
    const second = scheduler.request(page(1));
    await clock.advanceBy(2000);
    controller.abort();
    expect((await rejection(first)).kind).toBe("cancelled");
    await clock.run(second);
    expect(sent[0]).toMatchObject({ cancelled: true, end: 2000 });
    expect(sent[1].start).toBe(17000);
  });

  it("rejects a request whose signal is already aborted", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(
      scheduler.request(page(0), { signal: controller.signal }),
    );
    expect(error.kind).toBe("cancelled");
    expect(sent).toHaveLength(0);
  });

  it("cancelAll clears the queue and aborts the request in flight", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock, () => ({
      latencyMs: 5000,
    }));
    const scheduler = webScheduler(clock, transport);
    const requests = [0, 1, 2].map((n) => scheduler.request(page(n)));
    await clock.advanceBy(1000);
    scheduler.cancelAll();
    for (const request of requests) {
      expect((await rejection(request)).kind).toBe("cancelled");
    }
    await clock.advanceBy(60000);
    expect(sent).toHaveLength(1);
    expect(scheduler.getStatus()).toEqual({
      host: "arxiv.org",
      state: { kind: "idle" },
      queued: 0,
    });
  });
});

describe("ArxivScheduler: loads in a request's place (run)", () => {
  const snapshot = "https://arxiv.org/html/2609.28538v1";

  it("starts a load 15 s after the previous request, sends nothing while it runs, and spaces the next request from its end", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    const runs: { start: number; end?: number }[] = [];
    const task = async (latency: number) => {
      const record: { start: number; end?: number } = { start: clock.now() };
      runs.push(record);
      await clock.sleep(latency);
      record.end = clock.now();
      return `captured at ${record.start}`;
    };
    const first = scheduler.request(page(0));
    const load = scheduler.run(snapshot, () => task(20000));
    // A second load waits for the first
    const second = scheduler.run(snapshot, () => task(1000));
    const after = scheduler.request(page(1));
    expect(scheduler.getStatus().queued).toBe(3);
    await clock.run(Promise.all([first, load, second, after]));
    // Request 0-500, load 15500-35500, load 50500-51500, request 66500
    expect(runs).toEqual([
      { start: 15500, end: 35500 },
      { start: 50500, end: 51500 },
    ]);
    expect(sent.map((s) => s.start)).toEqual([0, 66500]);
    expect(await load).toBe("captured at 15500");
  });

  it("gives the load's failure to the caller and keeps the queue going", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    const failure = new Error("capture failed");
    const load = scheduler.run(snapshot, async () => {
      throw failure;
    });
    const next = scheduler.request(page(0));
    await expect(clock.run(load)).rejects.toBe(failure);
    await clock.run(next);
    expect(sent.map((s) => s.start)).toEqual([15000]);
  });

  it("never starts a load cancelled while it waits, and refuses other hosts", async () => {
    const clock = new VirtualClock();
    const { transport } = simulatedNetwork(clock);
    const scheduler = webScheduler(clock, transport);
    const task = vi.fn(async () => "done");
    const controller = new AbortController();
    const first = scheduler.request(page(0));
    const load = scheduler.run(snapshot, task, { signal: controller.signal });
    await clock.advanceBy(1000);
    controller.abort();
    expect((await rejection(load)).kind).toBe("cancelled");
    await clock.run(first);
    await clock.advanceBy(30000);
    expect(task).not.toHaveBeenCalled();
    await expect(
      scheduler.run("https://export.arxiv.org/api/query", task),
    ).rejects.toThrow("does not belong");
  });
});

describe("ArxivScheduler on 429, 503 and 403", () => {
  it("pauses for Retry-After and retries once", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock, (url, attempt) =>
      url === page(0) && attempt === 1
        ? { status: 503, headers: { "Retry-After": "300" } }
        : {},
    );
    const scheduler = webScheduler(clock, transport);
    const states: ArxivSchedulerStatus[] = [];
    scheduler.onStatus((status) => states.push(status));
    const first = scheduler.request(page(0));
    const second = scheduler.request(page(1));
    await clock.run(Promise.all([first, second]));
    // The 503 ended at 500; the retry goes out 300 s later, then the rest
    expect(sent.map((s) => [s.url, s.start])).toEqual([
      [page(0), 0],
      [page(0), 300500],
      [page(1), 316000],
    ]);
    expect((await first).status).toBe(200);
    expect(states.map((s) => s.state)).toContainEqual({
      kind: "paused",
      until: 300500,
    });
  });

  it("reads Retry-After as an HTTP date on 429", async () => {
    const clock = new VirtualClock(Date.parse("2026-09-28T01:00:00Z"));
    const { sent, transport } = simulatedNetwork(clock, (url, attempt) =>
      attempt === 1
        ? {
            status: 429,
            headers: { "Retry-After": "Mon, 28 Sep 2026 01:02:00 GMT" },
          }
        : {},
    );
    const scheduler = webScheduler(clock, transport);
    await clock.run(scheduler.request(page(0)));
    expect(sent[1].start).toBe(Date.parse("2026-09-28T01:02:00Z"));
  });

  it("fails after the retry fails and drops the queued requests", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock, () => ({
      status: 503,
      headers: { "Retry-After": "120" },
    }));
    const scheduler = webScheduler(clock, transport);
    const first = scheduler.request(page(0));
    const second = scheduler.request(page(1));
    const settled = Promise.allSettled([first, second]);
    await clock.run(settled);
    const error = await rejection(first);
    expect(error).toMatchObject({ kind: "unavailable", status: 503 });
    // The retry went out at 120500 and ended at 121000 with Retry-After 120
    expect(sent.map((s) => s.start)).toEqual([0, 120500]);
    expect(error.retryAt).toBe(121000 + 120000);
    expect((await rejection(second)).kind).toBe("stopped");

    // A later request still waits until arXiv's Retry-After time
    const later = scheduler.request(page(2));
    await clock.run(later.catch(() => undefined));
    expect(sent[2].start).toBe(241000);
  });

  it("fails at once on 503 without Retry-After", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock, () => ({
      status: 503,
    }));
    const scheduler = webScheduler(clock, transport);
    const first = scheduler.request(page(0));
    const second = scheduler.request(page(1));
    await clock.run(Promise.allSettled([first, second]));
    expect((await rejection(first)).kind).toBe("unavailable");
    expect((await rejection(second)).kind).toBe("stopped");
    expect(sent).toHaveLength(1);
  });

  it("stops on 403", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock, () => ({
      status: 403,
    }));
    const scheduler = webScheduler(clock, transport);
    const requests = [0, 1, 2].map((n) => scheduler.request(page(n)));
    await clock.run(Promise.allSettled(requests));
    expect((await rejection(requests[0])).kind).toBe("forbidden");
    expect((await rejection(requests[1])).kind).toBe("stopped");
    expect((await rejection(requests[2])).kind).toBe("stopped");
    expect(sent).toHaveLength(1);
  });

  it("lets the retry be cancelled during the pause", async () => {
    const clock = new VirtualClock();
    const { sent, transport } = simulatedNetwork(clock, () => ({
      status: 503,
      headers: { "Retry-After": "300" },
    }));
    const scheduler = webScheduler(clock, transport);
    const controller = new AbortController();
    const request = scheduler.request(page(0), { signal: controller.signal });
    await clock.advanceBy(10000);
    expect(scheduler.getStatus().state).toEqual({
      kind: "paused",
      until: 300500,
    });
    controller.abort();
    expect((await rejection(request)).kind).toBe("cancelled");
    await clock.advanceBy(600000);
    expect(sent).toHaveLength(1);
    expect(scheduler.getStatus().state).toEqual({ kind: "idle" });
  });

  it("passes other statuses to the caller", async () => {
    const clock = new VirtualClock();
    const { transport } = simulatedNetwork(clock, () => ({
      status: 400,
      text: "Invalid date",
    }));
    const scheduler = webScheduler(clock, transport);
    const response = await clock.run(scheduler.request(page(0)));
    expect([response.status, response.text]).toEqual([400, "Invalid date"]);
  });
});

describe("ArxivScheduler on failed connections", () => {
  it("reports timeouts, offline mode and missing responses", async () => {
    const clock = new VirtualClock();
    const { transport } = simulatedNetwork(clock, (url) => {
      if (url === page(0)) {
        return { error: new ArxivFetchError("timeout", "Timed out") };
      }
      if (url === page(1)) {
        return { error: new ArxivFetchError("offline", "Zotero is offline") };
      }
      return { status: 0 };
    });
    const scheduler = webScheduler(clock, transport);
    const requests = [0, 1, 2].map((n) => scheduler.request(page(n)));
    await clock.run(Promise.allSettled(requests));
    const kinds = await Promise.all(requests.map(rejection));
    expect(kinds.map((error) => error.kind)).toEqual([
      "timeout",
      "offline",
      "network",
    ]);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("300", 1000)).toBe(301000);
    expect(parseRetryAfter(" 0 ", 1000)).toBe(1000);
    const now = Date.parse("2026-09-28T01:00:00Z");
    expect(parseRetryAfter("Mon, 28 Sep 2026 01:05:00 GMT", now)).toBe(
      now + 300000,
    );
    // A date already past means "now"
    expect(parseRetryAfter("Mon, 28 Sep 2026 00:05:00 GMT", now)).toBe(now);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
  });
});

describe("zoteroTransport", () => {
  class TimeoutException extends Error {}
  class CancelledException extends Error {}
  class BrowserOfflineException extends Error {}

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubZotero(request: (...args: any[]) => Promise<any>) {
    const mock = vi.fn(request);
    vi.stubGlobal("Zotero", {
      HTTP: {
        request: mock,
        TimeoutException,
        CancelledException,
        BrowserOfflineException,
      },
    });
    return mock;
  }

  it("asks Zotero for an anonymous request that returns every status", async () => {
    const request = stubZotero(async () => ({
      status: 503,
      responseText: "down",
      getResponseHeader: (name: string) =>
        name === "Retry-After" ? "300" : null,
    }));
    const receiver = vi.fn();
    const response = await zoteroTransport("https://arxiv.org/list/x/new", {
      timeoutMs: 60000,
      headers: { "User-Agent": ARXIV_USER_AGENT },
      cancelReceiver: receiver,
    });
    expect(request).toHaveBeenCalledWith(
      "GET",
      "https://arxiv.org/list/x/new",
      {
        successCodes: false,
        anon: true,
        followRedirects: false,
        timeout: 60000,
        headers: { "User-Agent": ARXIV_USER_AGENT },
        cancellerReceiver: receiver,
      },
    );
    expect([response.status, response.text]).toEqual([503, "down"]);
    expect(response.header("Retry-After")).toBe("300");
  });

  it("returns the body as bytes when asked to", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
    const request = stubZotero(async () => ({
      status: 200,
      response: bytes,
      getResponseHeader: () => "application/pdf",
    }));
    const response = await zoteroTransport("https://arxiv.org/pdf/1", {
      timeoutMs: 1000,
      headers: {},
      cancelReceiver: () => {},
      responseType: "arraybuffer",
    });
    expect(request.mock.calls[0][2]).toMatchObject({
      responseType: "arraybuffer",
      followRedirects: false,
      anon: true,
    });
    expect(response.body).toBe(bytes);
    expect(response.text).toBe("");
  });

  it("reads an unfollowed redirect without body", async () => {
    stubZotero(async () => ({
      status: 301,
      getResponseHeader: () => "https://arxiv.org/elsewhere",
    }));
    const response = await zoteroTransport("https://arxiv.org/a", {
      timeoutMs: 1000,
      headers: {},
      cancelReceiver: () => {},
    });
    expect([response.status, response.text]).toEqual([301, ""]);
  });

  it("turns Zotero's exceptions into fetch errors", async () => {
    const cases: [Error, string][] = [
      [new TimeoutException(), "timeout"],
      [new CancelledException(), "cancelled"],
      [new BrowserOfflineException(), "offline"],
      [new Error("NS_ERROR_UNKNOWN_HOST"), "network"],
    ];
    for (const [thrown, kind] of cases) {
      stubZotero(async () => {
        throw thrown;
      });
      const error = await rejection(
        zoteroTransport("https://arxiv.org/a", {
          timeoutMs: 1000,
          headers: {},
          cancelReceiver: () => {},
        }),
      );
      expect(error).toBeInstanceOf(ArxivFetchError);
      expect(error.kind).toBe(kind);
    }
  });
});
