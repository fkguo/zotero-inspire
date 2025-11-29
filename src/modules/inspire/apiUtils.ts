import { config } from "../../../package.json";
import {
  INSPIRE_LITERATURE_URL,
  ARXIV_ABS_URL,
  DOI_ORG_URL,
} from "./constants";
import type { InspireArxivDetails } from "./types";
import { formatArxivDetails } from "./formatters";

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

export function extractRecidFromUrls(urls?: Array<{ value: string }>): string | null {
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

export function buildReferenceUrl(reference: any, recid?: string | null): string | undefined {
  if (recid) {
    return `${INSPIRE_LITERATURE_URL}/${recid}`;
  }
  if (Array.isArray(reference?.urls) && reference.urls.length) {
    return reference.urls[0].value;
  }
  return buildFallbackUrl(reference);
}

export function buildFallbackUrl(
  reference: any,
  arxiv?: InspireArxivDetails | string | null,
): string | undefined {
  if (Array.isArray(reference?.dois) && reference.dois.length) {
    return `${DOI_ORG_URL}/${reference.dois[0]}`;
  }
  const explicit = formatArxivDetails(arxiv);
  if (explicit?.id) {
    return `${ARXIV_ABS_URL}/${explicit.id}`;
  }
  const derived = formatArxivDetails(reference?.arxiv_eprint);
  if (derived?.id) {
    return `${ARXIV_ABS_URL}/${derived.id}`;
  }
  return undefined;
}

export function buildFallbackUrlFromMetadata(
  metadata: any,
  arxiv?: InspireArxivDetails | null,
): string | undefined {
  if (!metadata) {
    return undefined;
  }
  if (Array.isArray(metadata?.dois) && metadata.dois.length) {
    const first = metadata.dois[0];
    const value =
      typeof first === "string" ? first : (first?.value as string | undefined);
    if (value) {
      return `${DOI_ORG_URL}/${value}`;
    }
  }
  const provided = formatArxivDetails(arxiv)?.id;
  if (provided) {
    return `${ARXIV_ABS_URL}/${provided}`;
  }
  const derived = extractArxivFromMetadata(metadata);
  if (derived?.id) {
    return `${ARXIV_ABS_URL}/${derived.id}`;
  }
  return undefined;
}

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
// Database Query Helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function findItemByRecid(recid: string): Promise<Zotero.Item | null> {
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
// Clipboard Utility
// ─────────────────────────────────────────────────────────────────────────────

export async function copyToClipboard(text: string, doc?: Document): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for environments without Clipboard API (Zotero)
    if (doc) {
      const textarea = doc.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
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

export const recidLookupCache = new Map<number, string>();

