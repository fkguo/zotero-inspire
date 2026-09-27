// ─────────────────────────────────────────────────────────────────────────────
// arxivFetch: every request the plugin sends to arXiv goes through one of two
// plugin-wide serial schedulers, one per host:
//   web pages  arxiv.org          at least 15 s apart (robots.txt Crawl-delay)
//   API        export.arxiv.org   at least 3 s apart (API terms of use)
// Each scheduler is a single chain: one request in flight, and the next one is
// sent no earlier than the end of the previous one plus the interval, whoever
// queued it. Requests are anonymous (no cookies) and carry no user data.
//
// 429 / 503 with Retry-After pause the scheduler until that time and retry the
// request once (the retry stays cancellable); a second 429 / 503, a 429 / 503
// without Retry-After, or a 403 fail the request and drop everything queued
// behind it, so a loading run stops instead of pressing on.
// ─────────────────────────────────────────────────────────────────────────────

import { config, homepage, version } from "../../../package.json";

export type ArxivFetchErrorKind =
  /** The caller cancelled the request */
  | "cancelled"
  | "timeout"
  /** Zotero is in offline mode */
  | "offline"
  /** No HTTP response (connection failed) */
  | "network"
  /** 429 / 503: after the one retry, or without Retry-After */
  | "unavailable"
  /** 403 */
  | "forbidden"
  /** Dropped from the queue because an earlier request got 403 / 429 / 503 */
  | "stopped";

export class ArxivFetchError extends Error {
  constructor(
    readonly kind: ArxivFetchErrorKind,
    message: string,
    readonly status?: number,
    /** When arXiv asked to come back (Retry-After), in ms since the epoch */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = "ArxivFetchError";
  }
}

export interface ArxivResponse {
  status: number;
  /** Response body as text ("" when there is none) */
  text: string;
  header(name: string): string | null;
}

export interface ArxivTransportOptions {
  timeoutMs: number;
  headers: Record<string, string>;
  /** Receives the function that aborts the request while it is in flight */
  cancelReceiver: (cancel: () => void) => void;
}

/**
 * Sends one GET request and resolves with any HTTP status; rejects with an
 * ArxivFetchError for timeouts, cancellation, offline mode and failed
 * connections.
 */
export type ArxivTransport = (
  url: string,
  options: ArxivTransportOptions,
) => Promise<ArxivResponse>;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** What a scheduler is doing, for the "N seconds" / "retry at HH:MM" notes */
export type ArxivSchedulerState =
  | { kind: "idle" }
  /** Keeping the interval to the previous request */
  | { kind: "waiting"; until: number }
  /** Paused by Retry-After; a retry is scheduled at `until` */
  | { kind: "paused"; until: number }
  | { kind: "sending"; url: string };

export interface ArxivSchedulerStatus {
  host: string;
  state: ArxivSchedulerState;
  /** Requests waiting in the queue (not counting the one in flight) */
  queued: number;
}

export interface ArxivSchedulerOptions {
  host: string;
  minIntervalMs: number;
  timeoutMs: number;
  transport?: ArxivTransport;
  clock?: Clock;
}

export interface ArxivRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface Job {
  url: string;
  timeoutMs: number;
  signal?: AbortSignal;
  retried: boolean;
  settled: boolean;
  /** Aborts the request while it is in flight */
  cancel?: () => void;
  onAbort?: () => void;
  resolve(response: ArxivResponse): void;
  reject(error: unknown): void;
}

/** Identifies the plugin to arXiv; contains no user data */
export const ARXIV_USER_AGENT = `${config.addonName}/${version} (+${homepage})`;

export class ArxivScheduler {
  readonly host: string;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly transport: ArxivTransport;
  private readonly clock: Clock;
  private readonly queue: Job[] = [];
  private inFlight: Job | null = null;
  private pumping = false;
  /** Ends the pump's current wait early (the queue became empty) */
  private wake: (() => void) | null = null;
  private lastEnd = Number.NEGATIVE_INFINITY;
  private pausedUntil = 0;
  private state: ArxivSchedulerState = { kind: "idle" };
  private readonly listeners = new Set<
    (status: ArxivSchedulerStatus) => void
  >();

  constructor(options: ArxivSchedulerOptions) {
    this.host = options.host;
    this.minIntervalMs = options.minIntervalMs;
    this.timeoutMs = options.timeoutMs;
    this.transport = options.transport ?? zoteroTransport;
    this.clock = options.clock ?? systemClock;
  }

  /**
   * Queue a GET request for `url` (an https URL on this scheduler's host).
   * Resolves with the response for any status other than 403, 429 and 503.
   */
  request(
    url: string,
    options: ArxivRequestOptions = {},
  ): Promise<ArxivResponse> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return Promise.reject(new Error(`Not a URL: ${url}`));
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== this.host) {
      return Promise.reject(
        new Error(`${url} does not belong to the ${this.host} scheduler`),
      );
    }
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.reject(cancelledError());
    }
    return new Promise<ArxivResponse>((resolve, reject) => {
      const job: Job = {
        url,
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
        signal,
        retried: false,
        settled: false,
        resolve,
        reject,
      };
      if (signal) {
        job.onAbort = () => this.abort(job);
        signal.addEventListener("abort", job.onAbort);
      }
      this.queue.push(job);
      this.notify();
      void this.pump();
    });
  }

  /** Cancel everything queued and in flight (window closed, plugin shutdown) */
  cancelAll(): void {
    for (const job of this.queue.splice(0)) {
      this.settle(job, cancelledError());
    }
    this.inFlight?.cancel?.();
    this.wake?.();
    this.notify();
  }

  /** Follow the scheduler's state; returns the function that unsubscribes */
  onStatus(listener: (status: ArxivSchedulerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): ArxivSchedulerStatus {
    return { host: this.host, state: this.state, queued: this.queue.length };
  }

  private abort(job: Job): void {
    const index = this.queue.indexOf(job);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.settle(job, cancelledError());
      if (this.queue.length === 0) this.wake?.();
      this.notify();
    } else if (this.inFlight === job) {
      job.cancel?.();
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const job = this.queue[0];
        if (!job) break;
        const intervalEnd = this.lastEnd + this.minIntervalMs;
        const readyAt = Math.max(intervalEnd, this.pausedUntil);
        const now = this.clock.now();
        if (now < readyAt) {
          this.setState(
            this.pausedUntil > intervalEnd
              ? { kind: "paused", until: readyAt }
              : { kind: "waiting", until: readyAt },
          );
          await Promise.race([
            this.clock.sleep(readyAt - now),
            new Promise<void>((resolve) => {
              this.wake = resolve;
            }),
          ]);
          this.wake = null;
          continue;
        }
        this.queue.shift();
        await this.send(job);
      }
    } finally {
      this.pumping = false;
      this.setState({ kind: "idle" });
    }
  }

  private async send(job: Job): Promise<void> {
    this.inFlight = job;
    this.setState({ kind: "sending", url: job.url });
    let response: ArxivResponse | null = null;
    let failure: unknown = null;
    try {
      response = await this.transport(job.url, {
        timeoutMs: job.timeoutMs,
        headers: { "User-Agent": ARXIV_USER_AGENT },
        cancelReceiver: (cancel) => {
          job.cancel = cancel;
        },
      });
    } catch (error) {
      failure = error;
    }
    this.lastEnd = this.clock.now();
    this.inFlight = null;
    job.cancel = undefined;

    if (job.signal?.aborted) {
      this.settle(job, cancelledError());
      return;
    }
    if (!response) {
      this.settle(job, asFetchError(failure));
      return;
    }
    const { status } = response;
    if (status === 403) {
      this.settle(
        job,
        new ArxivFetchError("forbidden", `arXiv refused ${job.url} (403)`, 403),
      );
      this.dropQueue(status);
    } else if (status === 429 || status === 503) {
      const retryAt = parseRetryAfter(
        response.header("Retry-After"),
        this.lastEnd,
      );
      if (retryAt !== null) {
        this.pausedUntil = Math.max(this.pausedUntil, retryAt);
      }
      if (retryAt === null || job.retried) {
        this.settle(
          job,
          new ArxivFetchError(
            "unavailable",
            `arXiv is unavailable (${status}) for ${job.url}`,
            status,
            retryAt ?? undefined,
          ),
        );
        this.dropQueue(status);
      } else {
        job.retried = true;
        this.queue.unshift(job);
      }
    } else if (status === 0) {
      this.settle(
        job,
        new ArxivFetchError("network", `No response from ${job.url}`),
      );
    } else {
      this.settle(job, null, response);
    }
    this.notify();
  }

  /** Fail everything queued after a 403 / 429 / 503 ended a request */
  private dropQueue(status: number): void {
    for (const job of this.queue.splice(0)) {
      this.settle(
        job,
        new ArxivFetchError(
          "stopped",
          `Not sent: arXiv answered ${status} to an earlier request`,
          status,
        ),
      );
    }
  }

  private settle(job: Job, error: unknown, response?: ArxivResponse): void {
    if (job.settled) return;
    job.settled = true;
    if (job.signal && job.onAbort) {
      job.signal.removeEventListener("abort", job.onAbort);
    }
    if (response) job.resolve(response);
    else job.reject(error);
  }

  private setState(state: ArxivSchedulerState): void {
    this.state = state;
    this.notify();
  }

  private notify(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        Zotero.debug(`[${config.addonName}] arXiv status listener: ${error}`);
      }
    }
  }
}

function cancelledError(): ArxivFetchError {
  return new ArxivFetchError("cancelled", "Request cancelled");
}

function asFetchError(error: unknown): ArxivFetchError {
  if (error instanceof ArxivFetchError) return error;
  return new ArxivFetchError("network", String(error));
}

/**
 * The time Retry-After names, in ms since the epoch: delay-seconds or an
 * HTTP date; a time already past means "now". Null when absent or invalid.
 */
export function parseRetryAfter(
  value: string | null,
  nowMs: number,
): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return nowMs + Number(text) * 1000;
  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  return Math.max(date, nowMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Zotero transport
// ─────────────────────────────────────────────────────────────────────────────

/** Zotero.HTTP.request options this module uses beyond zotero-types' list */
type ZoteroRequestOptions = Parameters<typeof Zotero.HTTP.request>[2] & {
  anon?: boolean;
};

interface ZoteroHttpExceptions {
  TimeoutException: new (...args: any[]) => Error;
  CancelledException: new (...args: any[]) => Error;
  BrowserOfflineException: new (...args: any[]) => Error;
}

/**
 * Zotero.HTTP.request with every status returned as is (`successCodes:
 * false`: no exception, no waiting or retrying inside Zotero), without
 * cookies (`anon: true`), without following redirects, with a timeout and a
 * canceller.
 */
export const zoteroTransport: ArxivTransport = async (url, options) => {
  const requestOptions: ZoteroRequestOptions = {
    successCodes: false,
    anon: true,
    followRedirects: false,
    timeout: options.timeoutMs,
    headers: options.headers,
    cancellerReceiver: options.cancelReceiver,
  };
  try {
    const xhr = await Zotero.HTTP.request("GET", url, requestOptions);
    return {
      status: xhr.status,
      // An unfollowed redirect resolves with a stand-in object without text
      text: typeof xhr.responseText === "string" ? xhr.responseText : "",
      header: (name) => xhr.getResponseHeader(name),
    };
  } catch (error) {
    const http = Zotero.HTTP as unknown as ZoteroHttpExceptions;
    if (error instanceof http.TimeoutException) {
      throw new ArxivFetchError("timeout", `Timed out: ${url}`);
    }
    if (error instanceof http.CancelledException) {
      throw cancelledError();
    }
    if (error instanceof http.BrowserOfflineException) {
      throw new ArxivFetchError("offline", "Zotero is offline");
    }
    throw new ArxivFetchError("network", `${url}: ${error}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// The two plugin-wide schedulers
// ─────────────────────────────────────────────────────────────────────────────

export const ARXIV_WEB_HOST = "arxiv.org";
export const ARXIV_API_HOST = "export.arxiv.org";
export const ARXIV_WEB_INTERVAL_MS = 15000;
export const ARXIV_API_INTERVAL_MS = 3000;

let webScheduler: ArxivScheduler | null = null;
let apiScheduler: ArxivScheduler | null = null;

/** Scheduler for arxiv.org pages (/list, /catchup, /pdf, /bibtex) */
export function getArxivWebScheduler(): ArxivScheduler {
  webScheduler ??= new ArxivScheduler({
    host: ARXIV_WEB_HOST,
    minIntervalMs: ARXIV_WEB_INTERVAL_MS,
    timeoutMs: 60000,
  });
  return webScheduler;
}

/** Scheduler for the arXiv API on export.arxiv.org */
export function getArxivApiScheduler(): ArxivScheduler {
  apiScheduler ??= new ArxivScheduler({
    host: ARXIV_API_HOST,
    minIntervalMs: ARXIV_API_INTERVAL_MS,
    timeoutMs: 30000,
  });
  return apiScheduler;
}
