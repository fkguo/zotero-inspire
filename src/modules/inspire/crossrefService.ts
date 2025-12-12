// ─────────────────────────────────────────────────────────────────────────────
// CrossRef API Service
// Provides fetch wrapper with timeout and retry for CrossRef requests
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../package.json";

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
  options: RequestInit = {},
): Promise<Response | null> {
  for (let attempt = 0; attempt <= CROSSREF_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CROSSREF_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
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
