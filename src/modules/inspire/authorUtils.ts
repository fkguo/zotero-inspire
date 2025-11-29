import {
  LARGE_COLLABORATION_THRESHOLD,
  AUTHOR_IDS_EXTRACT_LIMIT,
} from "./constants";
import type { AuthorSearchInfo } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Author Name Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract author names from a reference object with a limit for performance.
 * Falls back to collaboration names if no authors found.
 * For large collaborations (>50 authors), only extract first author.
 * Returns both author names and total count for "et al." logic.
 */
export function extractAuthorNamesFromReference(
  reference: any,
  limit: number,
): { names: string[]; total: number } {
  if (Array.isArray(reference?.authors) && reference.authors.length) {
    const totalAuthors = reference.authors.length;
    // For large collaborations, only extract first author
    const effectiveLimit = totalAuthors > LARGE_COLLABORATION_THRESHOLD ? 1 : limit;
    const result: string[] = [];
    const maxToProcess = Math.min(totalAuthors, effectiveLimit);
    for (let i = 0; i < maxToProcess; i++) {
      const author = reference.authors[i];
      let name: string | null = null;
      if (author?.full_name) {
        name = author.full_name;
      } else if (author?.name) {
        name = author.name;
      } else if (author?.last_name || author?.first_name) {
        const first = author.first_name ?? "";
        const last = author.last_name ?? "";
        name = `${last}, ${first}`.replace(/^, |, $/, "").trim();
      }
      if (name) {
        result.push(name);
      }
    }
    if (result.length) {
      return { names: result, total: totalAuthors };
    }
  }
  if (
    Array.isArray(reference?.collaborations) &&
    reference.collaborations.length
  ) {
    const maxCollabs = Math.min(reference.collaborations.length, limit);
    const names = reference.collaborations.slice(0, maxCollabs).filter(Boolean);
    return { names, total: reference.collaborations.length };
  }
  return { names: [], total: 0 };
}

/**
 * Extract author names with limit, handling large collaborations.
 * For large collaborations (>50 authors), only extract first author.
 * Returns both author names and total count for "et al." logic.
 */
export function extractAuthorNamesLimited(
  authors: any[] | undefined,
  limit: number,
): { names: string[]; total: number } {
  if (!Array.isArray(authors) || !authors.length) {
    return { names: [], total: 0 };
  }
  const totalAuthors = authors.length;
  // For large collaborations, only extract first author
  const effectiveLimit = totalAuthors > LARGE_COLLABORATION_THRESHOLD ? 1 : limit;
  const result: string[] = [];
  const maxToProcess = Math.min(totalAuthors, effectiveLimit);
  for (let i = 0; i < maxToProcess; i++) {
    const name = authors[i]?.full_name || authors[i]?.full_name_unicode_normalized;
    if (name) {
      result.push(name);
    }
  }
  return { names: result, total: totalAuthors };
}

// ─────────────────────────────────────────────────────────────────────────────
// BAI Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate INSPIRE BAI format.
 * Valid BAI examples: "Feng.Kun.Guo.1", "E.Witten.1", "R.L.Jaffe.1"
 * BAI must contain at least one letter segment and end with a number.
 */
export function isValidBAI(bai: string): boolean {
  if (!bai || typeof bai !== "string") {
    return false;
  }
  // BAI format: Name.Parts.Separated.By.Dots.Number
  // Must have at least 2 parts (name + number), and last part must be a number
  const parts = bai.split(".");
  if (parts.length < 2) {
    return false;
  }
  // Last part should be a number (disambiguation number)
  const lastPart = parts[parts.length - 1];
  if (!/^\d+$/.test(lastPart)) {
    return false;
  }
  // At least one name part should contain letters
  const nameParts = parts.slice(0, -1);
  const hasLetterPart = nameParts.some((part) => /[A-Za-z]/.test(part));
  if (!hasLetterPart) {
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Author Search Info Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract author search info (fullName + BAI/recid) from INSPIRE authors array.
 * BAI (INSPIRE Author ID) like "Feng.Kun.Guo.1" is the most reliable for precise search.
 * For large collaborations (>50 authors), only extract first author's info.
 * See: https://github.com/inspirehep/rest-api-doc
 */
export function extractAuthorSearchInfos(
  authors: any[] | undefined,
  limit: number = AUTHOR_IDS_EXTRACT_LIMIT,
): AuthorSearchInfo[] | undefined {
  if (!Array.isArray(authors) || !authors.length) {
    return undefined;
  }
  // For large collaborations, only extract first author's search info
  const effectiveLimit = authors.length > LARGE_COLLABORATION_THRESHOLD ? 1 : limit;
  const result: AuthorSearchInfo[] = [];
  const maxToProcess = Math.min(authors.length, effectiveLimit);
  for (let i = 0; i < maxToProcess; i++) {
    const author = authors[i];
    const fullName = author?.full_name || author?.full_name_unicode_normalized;
    if (!fullName) {
      continue;
    }

    // Extract BAI from ids array (most reliable for author search)
    // Validate BAI format to avoid false positives
    let bai: string | undefined;
    if (Array.isArray(author.ids)) {
      for (const id of author.ids) {
        if (id?.schema === "INSPIRE BAI" && id?.value && isValidBAI(id.value)) {
          bai = id.value;
          break;
        }
      }
    }

    // Extract recid for display purposes (not used for search anymore)
    let recid: string | undefined;
    if (author.recid) {
      recid = String(author.recid);
    } else if (author.record?.$ref) {
      const match = author.record.$ref.match(/\/authors\/(\d+)$/);
      if (match) {
        recid = match[1];
      }
    }

    result.push({ fullName, bai, recid });
  }
  return result.length > 0 ? result : undefined;
}

// Re-export AUTHOR_IDS_EXTRACT_LIMIT for convenience
export { AUTHOR_IDS_EXTRACT_LIMIT };

