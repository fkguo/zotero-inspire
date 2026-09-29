import { config } from "../../../package.json";
import { parseRetryAfter } from "../arxiv/arxivFetch";

// ─────────────────────────────────────────────────────────────────────────────
// Every request the plugin sends to INSPIRE goes through inspireFetch, and
// every actual send (first tries and retries after a 429 alike) waits here
// for a place in a sliding window of send times: at most 12 sends in any
// 5 seconds, below INSPIRE's limit of 15 per IP and 5 seconds (requests it
// turns away count too). Requests a user is waiting for (foreground, the
// default) go before background ones (the preprint check at startup);
// within a class, first come first served.
// ─────────────────────────────────────────────────────────────────────────────

/** Sends allowed in any window of SEND_WINDOW_MS */
export const SEND_WINDOW_MAX = 12;
export const SEND_WINDOW_MS = 5000;
/** After a 429: wait at least this long (or longer, as Retry-After asks) */
export const MIN_RETRY_WAIT_MS = 5000;
/** Maximum retries after 429 answers */
export const MAX_RETRY_ATTEMPTS = 3;

/** INSPIRE's own limit, per IP and 5 seconds */
export const RATE_LIMIT_MAX_REQUESTS = 15;
export const RATE_LIMIT_WINDOW_MS = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimiterStatus {
  /** Requests waiting for a place in the window */
  queuedCount: number;
  /** Sends still allowed in the current window */
  availableTokens: number;
  /** Whether requests are being held back (window full or 429 retry wait) */
  isThrottling: boolean;
  /** Time until the window allows the next send (0 when it does now) */
  timeUntilNextToken: number;
}

type InspirePriority = "foreground" | "background";

export interface InspireFetchOptions extends RequestInit {
  signal?: AbortSignal;
  /** Return a 429 response immediately instead of applying the shared retry policy. */
  retryOnRateLimit?: boolean;
  /**
   * A request no user is waiting for (the preprint check at startup): sent
   * only when no foreground request is waiting
   */
  background?: boolean;
}

type StatusChangeCallback = (status: RateLimiterStatus) => void;

interface Waiter {
  priority: InspirePriority;
  signal?: AbortSignal | null;
  onAbort?: () => void;
  resolve(): void;
  reject(error: Error): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// InspireRateLimiter
// ─────────────────────────────────────────────────────────────────────────────

export class InspireRateLimiter {
  private static instance: InspireRateLimiter | null = null;
  private statusCallbacks: Set<StatusChangeCallback> = new Set();
  /** Times of the latest sends, oldest first, at most SEND_WINDOW_MAX */
  private sendTimes: number[] = [];
  private waiting: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeRetries = 0;

  private constructor() {}

  static getInstance(): InspireRateLimiter {
    if (!InspireRateLimiter.instance) {
      InspireRateLimiter.instance = new InspireRateLimiter();
    }
    return InspireRateLimiter.instance;
  }

  /** Forget the window and drop the waiting requests (tests) */
  static reset(): void {
    const limiter = InspireRateLimiter.instance;
    if (!limiter) return;
    if (limiter.timer) clearTimeout(limiter.timer);
    limiter.timer = null;
    for (const waiter of limiter.waiting.splice(0)) {
      waiter.signal?.removeEventListener("abort", waiter.onAbort!);
      waiter.reject(createAbortError());
    }
    limiter.sendTimes = [];
    limiter.activeRetries = 0;
  }

  getStatus(): RateLimiterStatus {
    const wait = this.windowWait(Date.now());
    return {
      queuedCount: this.waiting.length,
      availableTokens: Math.max(
        0,
        SEND_WINDOW_MAX -
          this.sendTimes.filter((t) => Date.now() - t < SEND_WINDOW_MS).length,
      ),
      isThrottling: this.waiting.length > 0 || this.activeRetries > 0,
      timeUntilNextToken: wait,
    };
  }

  onStatusChange(callback: StatusChangeCallback): () => void {
    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  private notifyStatusChange(): void {
    if (this.statusCallbacks.size === 0) return;
    const status = this.getStatus();
    for (const callback of this.statusCallbacks) {
      try {
        callback(status);
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] Rate limiter callback error: ${err}`,
        );
      }
    }
  }

  /** How long the window makes the next send wait from `now` */
  private windowWait(now: number): number {
    if (this.sendTimes.length < SEND_WINDOW_MAX) return 0;
    return Math.max(0, this.sendTimes[0] + SEND_WINDOW_MS - now);
  }

  /**
   * Take a place in the window at once if the window has room and nothing
   * waits, so that an unthrottled request is sent without delay (in the same
   * turn as the call); false otherwise
   */
  private takeFreePlace(): boolean {
    const now = Date.now();
    if (this.waiting.length || this.windowWait(now) > 0) return false;
    this.recordSend(now);
    return true;
  }

  private recordSend(now: number): void {
    this.sendTimes.push(now);
    if (this.sendTimes.length > SEND_WINDOW_MAX) this.sendTimes.shift();
  }

  /**
   * Wait for a place in the window. Resolves at the moment the caller may
   * send (the send is counted then); rejects with an AbortError when the
   * signal aborts first.
   */
  private acquire(
    priority: InspirePriority,
    signal?: AbortSignal | null,
  ): Promise<void> {
    if (signal?.aborted) return Promise.reject(createAbortError());
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { priority, signal, resolve, reject };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiting.indexOf(waiter);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          reject(createAbortError());
          this.notifyStatusChange();
        };
        signal.addEventListener("abort", waiter.onAbort);
      }
      this.waiting.push(waiter);
      this.grant();
    });
  }

  /** Let waiting requests send while the window has room */
  private grant(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.waiting.length) {
      const now = Date.now();
      const wait = this.windowWait(now);
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.grant();
        }, wait);
        break;
      }
      const index = this.waiting.findIndex((w) => w.priority === "foreground");
      const [waiter] = this.waiting.splice(index >= 0 ? index : 0, 1);
      this.recordSend(now);
      if (waiter.onAbort) {
        waiter.signal?.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve();
    }
    this.notifyStatusChange();
  }

  /**
   * Send a request when the window allows. A 429 answer is retried (up to 3
   * times) after Retry-After, and at least 5 seconds; each retry queues
   * again, with the request's priority. After the last retry the 429
   * response is returned.
   */
  async fetch(url: string, options?: InspireFetchOptions): Promise<Response> {
    const {
      retryOnRateLimit = true,
      background = false,
      ...fetchOptions
    } = options ?? {};
    const priority: InspirePriority = background ? "background" : "foreground";
    for (let retryCount = 0; ; retryCount++) {
      if (fetchOptions.signal?.aborted) throw createAbortError();
      if (!this.takeFreePlace()) {
        await this.acquire(priority, fetchOptions.signal);
      }
      const response = await fetch(url, fetchOptions);
      if (
        response.status !== 429 ||
        !retryOnRateLimit ||
        retryCount >= MAX_RETRY_ATTEMPTS
      ) {
        if (response.status === 429 && retryOnRateLimit) {
          Zotero.debug(
            `[${config.addonName}] Rate limit: Max retries exceeded for ${url}`,
          );
        }
        return response;
      }

      const now = Date.now();
      const retryAt = parseRetryAfter(
        response.headers.get("Retry-After"),
        now,
      );
      const delay = Math.max((retryAt ?? now) - now, MIN_RETRY_WAIT_MS);
      Zotero.debug(
        `[${config.addonName}] 429 received. Retry ${retryCount + 1}/${MAX_RETRY_ATTEMPTS} after ${Math.round(delay)}ms`,
      );
      this.activeRetries++;
      this.notifyStatusChange();
      await this.sleep(delay, fetchOptions.signal);
      this.activeRetries--;
      this.notifyStatusChange();
      // Aborted while waiting: end now, as the request itself would
      if (fetchOptions.signal?.aborted) {
        throw createAbortError();
      }
    }
  }

  /** Wait `ms`, or less if the signal aborts first */
  private sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done);
    });
  }
}

/**
 * An error named "AbortError", as fetch() rejects with when aborted (made by
 * hand: DOMException may not be available in Zotero's sandbox)
 */
function createAbortError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/** fetch() for the INSPIRE API, within the shared send window */
export function inspireFetch(
  url: string,
  options?: InspireFetchOptions,
): Promise<Response> {
  return InspireRateLimiter.getInstance().fetch(url, options);
}

export function getRateLimiterStatus(): RateLimiterStatus {
  return InspireRateLimiter.getInstance().getStatus();
}

export function onRateLimiterStatusChange(
  callback: StatusChangeCallback,
): () => void {
  return InspireRateLimiter.getInstance().onStatusChange(callback);
}

export function resetRateLimiter(): void {
  InspireRateLimiter.reset();
}
