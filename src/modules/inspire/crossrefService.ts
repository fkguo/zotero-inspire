// ─────────────────────────────────────────────────────────────────────────────
// CrossRef API Service
// Provides fetch wrapper with timeout and retry for CrossRef requests
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../package.json";
import { createAbortController, createMockSignal } from "./utils";

/**
 * Merge multiple AbortSignals into one.
 * FTR-ABORT-CONTROLLER-FIX: Uses createAbortController utility with fallback
 */
function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = createAbortController();
  if (!controller) {
    // Fallback: if no AbortController available, return mock signal
    return createMockSignal();
  }
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

const CROSSREF_TIMEOUT_MS = 10000;
const CROSSREF_MAX_RETRIES = 2;

/**
 * Fetch from CrossRef API with timeout and retry.
 * Similar to inspireFetch but tailored for CrossRef's API characteristics.
 *
 * @param url - The URL to fetch
 * @param options - Optional fetch options
 * @returns Response or null if all attempts failed
 */
export async function crossrefFetch(
  url: string,
  options: RequestInit & { signal?: AbortSignal } = {},
): Promise<Response | null> {
  for (let attempt = 0; attempt <= CROSSREF_MAX_RETRIES; attempt++) {
    if (options.signal?.aborted) {
      return null;
    }
    // FTR-ABORT-CONTROLLER-FIX: Use utility with fallback
    const controller = createAbortController();
    if (!controller) {
      // If AbortController not available, skip timeout mechanism
      try {
        return await fetch(url, options);
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] CrossRef fetch error (attempt ${attempt + 1}/${CROSSREF_MAX_RETRIES + 1}): ${err}`,
        );
        if (attempt === CROSSREF_MAX_RETRIES) {
          return null;
        }
        continue;
      }
    }

    const timeoutId = setTimeout(() => controller.abort(), CROSSREF_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: mergeAbortSignals(controller.signal, options.signal),
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);

      // Check if aborted due to timeout
      if (controller.signal.aborted) {
        Zotero.debug(
          `[${config.addonName}] CrossRef fetch timeout (attempt ${attempt + 1}/${CROSSREF_MAX_RETRIES + 1}): ${url}`,
        );
      } else {
        Zotero.debug(
          `[${config.addonName}] CrossRef fetch error (attempt ${attempt + 1}/${CROSSREF_MAX_RETRIES + 1}): ${err}`,
        );
      }

      // Return null if all retries exhausted
      if (attempt === CROSSREF_MAX_RETRIES) {
        Zotero.debug(
          `[${config.addonName}] CrossRef fetch failed after ${CROSSREF_MAX_RETRIES + 1} attempts: ${url}`,
        );
        return null;
      }

      // Wait before retry (exponential backoff: 1s, 2s)
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}
