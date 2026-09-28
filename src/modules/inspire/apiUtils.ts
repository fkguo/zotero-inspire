import { config } from "../../../package.json";
import {
  INSPIRE_LITERATURE_URL,
  ARXIV_ABS_URL,
  DOI_ORG_URL,
} from "./constants";
import type { InspireArxivDetails } from "./types";
import { formatArxivDetails } from "./formatters";
import { LRUCache } from "./utils";
import {
  recidFromInspireLink,
  recidFromLinkText,
  resolveItemRecid,
} from "./library/itemRecid";

// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE recid extraction functions
// ─────────────────────────────────────────────────────────────────────────────

/** The INSPIRE recid of a Zotero item (resolveItemRecid), or null */
export function deriveRecidFromItem(item: Zotero.Item): string | null {
  return resolveItemRecid(item);
}

export function extractRecidFromRecordRef(ref?: string): string | null {
  if (typeof ref !== "string") {
    return null;
  }
  // A $ref is INSPIRE's own link to the cited record, so a relative one is
  // resolved against INSPIRE. It can point to another collection (e.g. data),
  // whose numbers are not literature recids.
  return recidFromInspireLink(ref.trim(), "https://inspirehep.net/");
}

export function extractRecidFromUrls(
  urls?: Array<{ value: string }>,
): string | null {
  if (!Array.isArray(urls)) {
    return null;
  }
  for (const entry of urls) {
    const candidate = extractRecidFromUrl(entry?.value);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

/**
 * Recid from a single INSPIRE literature link. A link without a host (a
 * relative path, or a host name without a scheme) cannot be attributed to
 * INSPIRE and gives none.
 */
export function extractRecidFromUrl(url?: string | null): string | null {
  return recidFromLinkText(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// URL Building Functions
// ─────────────────────────────────────────────────────────────────────────────

export function buildReferenceUrl(
  reference: any,
  recid?: string | null,
): string | undefined {
  if (recid) {
    return `${INSPIRE_LITERATURE_URL}/${recid}`;
  }
  if (Array.isArray(reference?.urls) && reference.urls.length) {
    return reference.urls[0].value;
  }
  return buildFallbackUrl(reference);
}

/**
 * Build fallback URL from DOI or arXiv info.
 * FTR-REFACTOR: Unified function that works with both reference and metadata objects.
 *
 * @param source - Source object containing DOI/arXiv info (reference or metadata)
 * @param arxiv - Explicit arXiv details to use (optional)
 * @returns URL string or undefined
 */
export function buildFallbackUrl(
  source: any,
  arxiv?: InspireArxivDetails | string | null,
): string | undefined {
  if (!source) {
    return undefined;
  }

  // Try DOI first (handles both string and {value: string} formats)
  if (Array.isArray(source?.dois) && source.dois.length) {
    const first = source.dois[0];
    const value =
      typeof first === "string" ? first : (first?.value as string | undefined);
    if (value) {
      return `${DOI_ORG_URL}/${value}`;
    }
  }

  // Try explicit arXiv parameter
  const explicit = formatArxivDetails(arxiv);
  if (explicit?.id) {
    return `${ARXIV_ABS_URL}/${explicit.id}`;
  }

  // Try arXiv from source - reference style (arxiv_eprint)
  if (source?.arxiv_eprint) {
    const derived = formatArxivDetails(source.arxiv_eprint);
    if (derived?.id) {
      return `${ARXIV_ABS_URL}/${derived.id}`;
    }
  }

  // Try arXiv from source - metadata style (arxiv_eprints array)
  if (Array.isArray(source?.arxiv_eprints) && source.arxiv_eprints.length) {
    const derived = extractArxivFromMetadata(source);
    if (derived?.id) {
      return `${ARXIV_ABS_URL}/${derived.id}`;
    }
  }

  return undefined;
}

/**
 * @deprecated Use buildFallbackUrl instead. This alias is kept for backward compatibility.
 */
export const buildFallbackUrlFromMetadata = buildFallbackUrl;

// ─────────────────────────────────────────────────────────────────────────────
// arXiv Extraction Functions
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeArxivID, normalizeArxivCategories } from "./formatters";

export function extractArxivFromReference(
  reference: any,
): InspireArxivDetails | undefined {
  if (!reference) {
    return undefined;
  }
  const id = normalizeArxivID(reference?.arxiv_eprint);
  const categoriesRaw =
    reference?.arxiv_categories ??
    reference?.arxiv_category ??
    reference?.arxiv_subject;
  const categories = normalizeArxivCategories(categoriesRaw);
  if (!id && !categories.length) {
    return undefined;
  }
  return {
    id,
    categories,
  };
}

export function extractArxivFromMetadata(
  metadata: any,
): InspireArxivDetails | undefined {
  if (!metadata) {
    return undefined;
  }
  if (Array.isArray(metadata?.arxiv_eprints) && metadata.arxiv_eprints.length) {
    const first = metadata.arxiv_eprints.find(
      (entry: any) => entry?.value || entry?.id,
    );
    if (!first) {
      return undefined;
    }
    const id = normalizeArxivID(
      typeof first === "string" ? first : (first?.value ?? first?.id),
    );
    const categories = normalizeArxivCategories(first?.categories);
    if (!id && !categories.length) {
      return undefined;
    }
    return { id, categories };
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clipboard Utility (Zotero-specific implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Copy text to the system clipboard.
 * This implementation uses Zotero-specific APIs with multiple fallbacks:
 * 1. Zotero.Utilities.Internal.copyTextToClipboard (preferred)
 * 2. Mozilla nsIClipboardHelper service
 * 3. DOM textarea + execCommand fallback
 * Returns true on success, false on failure.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Use Zotero's built-in clipboard utility (preferred in Zotero environment)
    const clipboardService = Zotero.Utilities.Internal?.copyTextToClipboard;
    if (typeof clipboardService === "function") {
      clipboardService(text);
      return true;
    }

    // Fallback: use Mozilla's clipboard helper service
    const componentsAny = Components as any;
    const clipboardHelper = componentsAny?.classes?.[
      "@mozilla.org/widget/clipboardhelper;1"
    ]?.getService(componentsAny?.interfaces?.nsIClipboardHelper);
    if (clipboardHelper) {
      clipboardHelper.copyString(text);
      return true;
    }

    // Fallback: create a temporary textarea and use execCommand
    const doc = Zotero.getMainWindow()?.document;
    if (doc) {
      const textarea = doc.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.left = "-9999px";
      doc.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = doc.execCommand("copy");
      textarea.remove();
      return success;
    }
    return false;
  } catch (_err) {
    Zotero.debug(`[${config.addonName}] Failed to copy to clipboard: ${_err}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recid Lookup Cache
// ─────────────────────────────────────────────────────────────────────────────

// Use LRUCache to prevent unbounded memory growth (max 500 entries)
export const recidLookupCache = new LRUCache<number, string>(500);
