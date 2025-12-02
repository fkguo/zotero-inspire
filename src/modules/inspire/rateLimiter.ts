import { config } from "../../../package.json";

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Base delay for exponential backoff (1 second) */
export const BACKOFF_BASE_DELAY_MS = 1000;
/** Maximum delay for exponential backoff (30 seconds) */
export const BACKOFF_MAX_DELAY_MS = 30000;
/** Maximum retry attempts for 429 errors */
export const MAX_RETRY_ATTEMPTS = 3;

// Legacy exports for compatibility
export const RATE_LIMIT_MAX_REQUESTS = 15;
export const RATE_LIMIT_WINDOW_MS = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimiterStatus {
  /** Number of requests currently queued (always 0 in passive mode) */
  queuedCount: number;
  /** Number of tokens available (always max in passive mode) */
  availableTokens: number;
  /** Whether rate limiting is active */
  isThrottling: boolean;
  /** Time until next token is available (always 0 in passive mode) */
  timeUntilNextToken: number;
}

type StatusChangeCallback = (status: RateLimiterStatus) => void;

// ─────────────────────────────────────────────────────────────────────────────
// InspireRateLimiter - Passive Rate Limiter (429 Retry Only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Passive Rate Limiter for INSPIRE API requests.
 * 
 * Design philosophy: ZERO overhead for normal requests.
 * Only handles 429 responses with exponential backoff retry.
 * 
 * This is the most performant approach:
 * - No pre-emptive rate limiting (no delays before requests)
 * - No request queueing
 * - No sliding window tracking
 * - Just pass-through with 429 retry logic
 */
export class InspireRateLimiter {
  private static instance: InspireRateLimiter | null = null;
  private statusCallbacks: Set<StatusChangeCallback> = new Set();
  private activeRetries = 0;

  private constructor() {}

  static getInstance(): InspireRateLimiter {
    if (!InspireRateLimiter.instance) {
      InspireRateLimiter.instance = new InspireRateLimiter();
    }
    return InspireRateLimiter.instance;
  }

  static reset(): void {
    if (InspireRateLimiter.instance) {
      InspireRateLimiter.instance.activeRetries = 0;
    }
  }

  getStatus(): RateLimiterStatus {
    return {
      queuedCount: 0,
      availableTokens: RATE_LIMIT_MAX_REQUESTS,
      isThrottling: this.activeRetries > 0,
      timeUntilNextToken: 0,
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
        Zotero.debug(`[${config.addonName}] Rate limiter callback error: ${err}`);
      }
    }
  }

  private calculateBackoffDelay(retryCount: number): number {
    const delay = BACKOFF_BASE_DELAY_MS * Math.pow(2, retryCount);
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, BACKOFF_MAX_DELAY_MS);
  }

  /**
   * Execute a fetch request. 
   * ZERO overhead - just passes through to native fetch.
   * Only adds logic on 429 responses.
   */
  async fetch(
    url: string,
    options?: RequestInit & { signal?: AbortSignal },
  ): Promise<Response> {
    // Direct pass-through to native fetch with retry on 429
    return this.executeWithRetry(url, options, 0);
  }

  private async executeWithRetry(
    url: string,
    options: RequestInit | undefined,
    retryCount: number,
  ): Promise<Response> {
    try {
      const response = await fetch(url, options);

      // Only handle 429 rate limit responses
      if (response.status === 429) {
        if (retryCount >= MAX_RETRY_ATTEMPTS) {
          Zotero.debug(`[${config.addonName}] Rate limit: Max retries exceeded for ${url}`);
          return response;
        }

        this.activeRetries++;
        this.notifyStatusChange();

        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000 || this.calculateBackoffDelay(retryCount)
          : this.calculateBackoffDelay(retryCount);

        Zotero.debug(`[${config.addonName}] 429 received. Retry ${retryCount + 1}/${MAX_RETRY_ATTEMPTS} after ${Math.round(delay)}ms`);

        await this.sleep(delay);
        
        this.activeRetries--;
        this.notifyStatusChange();
        
        return this.executeWithRetry(url, options, retryCount + 1);
      }

      return response;
    } catch (err) {
      // Re-throw abort errors immediately
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      throw err;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch wrapper for INSPIRE API with 429 retry.
 * 
 * ZERO OVERHEAD for normal requests - direct pass-through to native fetch.
 * Only adds retry logic when receiving 429 responses.
 */
export function inspireFetch(
  url: string,
  options?: RequestInit & { signal?: AbortSignal },
): Promise<Response> {
  return InspireRateLimiter.getInstance().fetch(url, options);
}

export function getRateLimiterStatus(): RateLimiterStatus {
  return InspireRateLimiter.getInstance().getStatus();
}

export function onRateLimiterStatusChange(callback: StatusChangeCallback): () => void {
  return InspireRateLimiter.getInstance().onStatusChange(callback);
}

export function resetRateLimiter(): void {
  InspireRateLimiter.reset();
}

