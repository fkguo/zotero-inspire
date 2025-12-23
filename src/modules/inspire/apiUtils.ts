import { config } from "../../../package.json";
import {
  INSPIRE_LITERATURE_URL,
  ARXIV_ABS_URL,
  DOI_ORG_URL,
} from "./constants";
import type { InspireArxivDetails } from "./types";
import { formatArxivDetails } from "./formatters";
import { LRUCache } from "./utils";

// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE recid extraction functions
// ─────────────────────────────────────────────────────────────────────────────

export function deriveRecidFromItem(item: Zotero.Item): string | null {
  const archiveLocation = (
    item.getField("archiveLocation") as string | undefined
  )?.trim();
  if (archiveLocation && /^\d+$/.test(archiveLocation)) {
    return archiveLocation;
  }
  const url = item.getField("url") as string | undefined;
  const recidFromUrl = extractRecidFromUrl(url);
  if (recidFromUrl) {
    return recidFromUrl;
  }
  const extra = item.getField("extra") as string | undefined;
  if (extra) {
    const match = extra.match(/inspirehep\.net\/(?:record|literature)\/(\d+)/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

export function extractRecidFromRecordRef(ref?: string): string | null {
  if (!ref) {
    return null;
  }
  const match = ref.match(/\/(\d+)(?:\?.*)?$/);
  return match ? match[1] : null;
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

export function extractRecidFromUrl(url?: string | null): string | null {
  if (!url) {
    return null;
  }
  const match = url.match(/(?:literature|record)\/(\d+)/);
  return match ? match[1] : null;
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

/**
 * Extract arXiv ID from item (Extra field, URL, or Archive Location)
 */
export function extractArxivIdFromItem(item: Zotero.Item): string | undefined {
  // Try Extra field
  const extra = item.getField("extra") as string;
  if (extra) {
    const match = extra.match(/arXiv:\s*([0-9.]+|[a-z-]+\/[0-9]+)/i);
    if (match) return match[1];
  }

  // Try URL field
  const url = item.getField("url") as string;
  if (url) {
    const match = url.match(/arxiv\.org\/abs\/([0-9.]+|[a-z-]+\/[0-9]+)/i);
    if (match) return match[1];
  }

  // Try Archive Location (sometimes used for arXiv ID)
  const archiveLoc = item.getField("archiveLocation") as string;
  if (archiveLoc && /^[0-9.]+|[a-z-]+\/[0-9]+$/.test(archiveLoc)) {
    return archiveLoc;
  }

  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database Query Helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function findItemByRecid(
  recid: string,
): Promise<Zotero.Item | null> {
  const fieldID = Zotero.ItemFields.getID("archiveLocation");
  if (!fieldID) {
    return null;
  }
  const sql = `
    SELECT itemID
    FROM itemData
      JOIN itemDataValues USING(valueID)
    WHERE fieldID = ?
      AND value = ?
    LIMIT 1
  `;
  const itemID = await Zotero.DB.valueQueryAsync(sql, [fieldID, recid]);
  if (!itemID) {
    return null;
  }
  return Zotero.Items.get(Number(itemID));
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
// Batch Query Functions for Duplicate Detection (FTR-BATCH-IMPORT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find local items by arXiv IDs in batch.
 * Searches the Extra field for patterns like "arXiv:2305.12345" or "_eprint:2305.12345".
 * @param arxivIds Array of arXiv IDs (e.g., ["2305.12345", "hep-ph/0001234"])
 * @returns Map of arXiv ID → local item ID
 */
export async function findItemsByArxivs(
  arxivIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!arxivIds.length) return result;

  const fieldID = Zotero.ItemFields.getID("extra");
  if (!fieldID) return result;

  const CHUNK_SIZE = 200;
  for (let i = 0; i < arxivIds.length; i += CHUNK_SIZE) {
    const chunk = arxivIds.slice(i, i + CHUNK_SIZE);
    // Build LIKE patterns for arXiv IDs
    const patterns = chunk.flatMap((id) => [
      `%arXiv:${id}%`,
      `%_eprint:${id}%`,
    ]);
    const likeConditions = patterns.map(() => "value LIKE ?").join(" OR ");
    const sql = `
      SELECT itemID, value
      FROM itemData
        JOIN itemDataValues USING(valueID)
      WHERE fieldID = ? AND (${likeConditions})
    `;
    try {
      const rows = await Zotero.DB.queryAsync(sql, [fieldID, ...patterns]);
      if (rows) {
        for (const row of rows) {
          const extra = row.value as string;
          // Match arXiv ID from extra field
          for (const arxivId of chunk) {
            if (
              extra.includes(`arXiv:${arxivId}`) ||
              extra.includes(`_eprint:${arxivId}`)
            ) {
              result.set(arxivId, Number(row.itemID));
              break;
            }
          }
        }
      }
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Error querying items by arXiv: ${e}`);
    }
  }
  return result;
}

/**
 * Find local items by DOIs in batch.
 * Searches the DOI field directly.
 * @param dois Array of DOIs (e.g., ["10.1103/PhysRevD.100.123456"])
 * @returns Map of DOI → local item ID
 */
export async function findItemsByDOIs(
  dois: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!dois.length) return result;

  const fieldID = Zotero.ItemFields.getID("DOI");
  if (!fieldID) return result;

  const CHUNK_SIZE = 500;
  for (let i = 0; i < dois.length; i += CHUNK_SIZE) {
    const chunk = dois.slice(i, i + CHUNK_SIZE);
    // Normalize DOIs for comparison (lowercase)
    const normalizedChunk = chunk.map((d) => d.toLowerCase());
    const placeholders = normalizedChunk
      .map(() => "LOWER(value) = ?")
      .join(" OR ");
    const sql = `
      SELECT itemID, value
      FROM itemData
        JOIN itemDataValues USING(valueID)
      WHERE fieldID = ? AND (${placeholders})
    `;
    try {
      const rows = await Zotero.DB.queryAsync(sql, [
        fieldID,
        ...normalizedChunk,
      ]);
      if (rows) {
        for (const row of rows) {
          const doiValue = (row.value as string).toLowerCase();
          // Find original DOI (case-insensitive match)
          const originalDoi = chunk.find((d) => d.toLowerCase() === doiValue);
          if (originalDoi) {
            result.set(originalDoi, Number(row.itemID));
          }
        }
      }
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Error querying items by DOI: ${e}`);
    }
  }
  return result;
}

/**
 * Find local items by recids in batch.
 * This is a batch version of findItemByRecid for efficiency.
 * @param recids Array of INSPIRE recids
 * @returns Map of recid → local item ID
 */
export async function findItemsByRecids(
  recids: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!recids.length) return result;

  const fieldID = Zotero.ItemFields.getID("archiveLocation");
  if (!fieldID) return result;

  const CHUNK_SIZE = 500;
  for (let i = 0; i < recids.length; i += CHUNK_SIZE) {
    const chunk = recids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const sql = `
      SELECT itemID, value
      FROM itemData
        JOIN itemDataValues USING(valueID)
      WHERE fieldID = ? AND value IN (${placeholders})
    `;
    try {
      const rows = await Zotero.DB.queryAsync(sql, [fieldID, ...chunk]);
      if (rows) {
        for (const row of rows) {
          result.set(row.value as string, Number(row.itemID));
        }
      }
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Error querying items by recid: ${e}`);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recid Lookup Cache
// ─────────────────────────────────────────────────────────────────────────────

// Use LRUCache to prevent unbounded memory growth (max 500 entries)
export const recidLookupCache = new LRUCache<number, string>(500);