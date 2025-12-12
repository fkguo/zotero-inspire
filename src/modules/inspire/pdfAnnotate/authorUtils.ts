// ─────────────────────────────────────────────────────────────────────────────
// Author Utilities
// FTR-REFACTOR: Centralized author name handling for PDF annotation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extended Latin character classes for author name matching.
 * Includes accented characters common in academic author names.
 */
export const AUTHOR_CHARS = {
  /** Uppercase letters including extended Latin */
  UPPER: "A-ZÀ-ÖØ-ÞĐŁŐŰİĞŞ",
  /** Lowercase letters including extended Latin */
  LOWER: "a-zà-öø-ÿßđłőűığş",
  /** All author name characters (letters, apostrophes, hyphens) */
  ALL: "A-ZÀ-ÖØ-ÞĐŁŐŰİĞŞa-zà-öø-ÿßđłőűığş'''-",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Pre-compiled Regular Expressions
// These patterns are compiled once at module load for better performance
// ─────────────────────────────────────────────────────────────────────────────

/** Pattern: "M.-T. Li" or "G. Li" - initials followed by last name */
export const RE_INITIAL_AUTHOR = new RegExp(
  `^([${AUTHOR_CHARS.UPPER}]\\.(?:\\s*-?[${AUTHOR_CHARS.UPPER}]\\.)*)\\s+([${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+(?:\\s+[${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+)*)$`,
  "iu"
);

/**
 * Pattern: "Author et al. 2020" or "Author 2020"
 * Supports compound surnames with space (e.g., "Hiller Blin et al. 2016")
 */
export const RE_AUTHOR_YEAR_COMBINED = new RegExp(
  `^([${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+(?:\\s+[${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+)*)(?:\\s+et\\s+al\\.)?\\s+(\\d{4}[a-z]?)$`,
  "iu"
);

/**
 * Pattern: "Author and Author 2020"
 * Supports compound surnames with space (e.g., "Hiller Blin and Smith 2016")
 */
export const RE_TWO_AUTHORS_YEAR = new RegExp(
  `^([${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+(?:\\s+[${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+)*)\\s+and\\s+([${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+(?:\\s+[${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+)*)\\s+(\\d{4}[a-z]?)$`,
  "iu"
);

/** Pattern: standalone year with optional suffix */
export const RE_YEAR_STANDALONE = /^\d{4}[a-z]?$/;

/**
 * Pattern: standalone author name
 * Supports compound surnames with space (e.g., "Hiller Blin")
 */
export const RE_AUTHOR_STANDALONE = new RegExp(
  `^[${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+(?:\\s+[${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+)*$`,
  "iu"
);

/** Pattern: comma-separated authors */
export const RE_COMMA_AUTHORS = new RegExp(
  `^[${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+(?:,\\s*[${AUTHOR_CHARS.UPPER}][${AUTHOR_CHARS.ALL}]+)+$`,
  "iu"
);

/** Pattern: year suffix detection */
export const RE_YEAR_WITH_SUFFIX = /\d{4}[a-z]$/i;

/** Pattern: different initials detection - factory function */
export const buildDifferentInitialsPattern = (author: string): RegExp =>
  new RegExp(
    `(?:[A-Z]\\.(?:\\s*-?[A-Z]\\.)*\\s*${author}|${author},\\s*[A-Z]\\.(?:\\s*-?[A-Z]\\.)*)`,
    "i"
  );

// ─────────────────────────────────────────────────────────────────────────────
// Author Name Processing Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a regex pattern to match author initials in text.
 * Matches both "M.-T. Li" and "Li, M.-T." formats.
 *
 * @param author - Author last name
 * @param initials - Initials string (e.g., "M.-T.")
 * @returns RegExp that matches the author with initials
 */
export function buildInitialsPattern(author: string, initials: string): RegExp {
  const escapedInitials = initials.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:${escapedInitials}\\s*${author}|${author},\\s*${escapedInitials})`,
    "i"
  );
}

/**
 * Normalize author name for comparison.
 * Removes diacritics for basic matching.
 *
 * @param name - Author name to normalize
 * @returns Normalized lowercase name without diacritics
 */
export function normalizeAuthorName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Remove diacritics
}

/**
 * Normalize author string by removing dots, spaces, and hyphens.
 * Used for fuzzy author matching.
 *
 * @param str - Author string to normalize
 * @returns Normalized string or null if empty
 */
export function normalizeAuthorCompact(str?: string | null): string | null {
  if (!str) return null;
  return str.toLowerCase().replace(/[.\s-]/g, "").trim();
}

/**
 * Check if two author names match.
 * Handles umlauts, accents, German ß/ss variations, etc.
 *
 * @param name1 - First author name
 * @param name2 - Second author name
 * @returns true if names match
 */
export function authorsMatch(name1: string, name2: string): boolean {
  // Direct match
  if (name1 === name2) return true;

  // Normalized match (without accents)
  const norm1 = normalizeAuthorName(name1);
  const norm2 = normalizeAuthorName(name2);
  if (norm1 === norm2) return true;

  // Handle German umlaut variations (ß -> ss, ä -> ae, etc.)
  const germanize1 = norm1
    .replace(/ss/g, "ß")
    .replace(/ae/g, "ä")
    .replace(/oe/g, "ö")
    .replace(/ue/g, "ü");
  const germanize2 = norm2
    .replace(/ss/g, "ß")
    .replace(/ae/g, "ä")
    .replace(/oe/g, "ö")
    .replace(/ue/g, "ü");
  if (germanize1 === norm2 || norm1 === germanize2) return true;

  return false;
}

/**
 * Extract last name from an author string.
 * Handles formats like:
 * - "S. Okubo", "Okubo, S.", "Okubo" (Western)
 * - "张三", "山田太郎" (CJK - Chinese, Japanese, Korean)
 * - "ATLAS Collaboration" (Collaboration names)
 * - "García-Márquez" (Hyphenated names)
 * - "van der Waals" (Multi-word family names)
 *
 * @param authorStr - Full author string
 * @returns Extracted last name in lowercase
 */
export function extractLastName(authorStr: string): string {
  const author = authorStr.trim();
  if (!author) return "";

  // Check for collaboration names first
  if (isCollaboration(author)) {
    return extractCollaborationName(author);
  }

  // CJK author detection (Chinese, Japanese, Korean)
  // Chinese names: usually 2-4 characters, surname first (1-2 chars)
  const cjkPattern =
    /^([\u4e00-\u9fff\u3400-\u4dbf])([\u4e00-\u9fff\u3400-\u4dbf]{1,3})$/;
  const cjkMatch = author.match(cjkPattern);
  if (cjkMatch) {
    // Return the first character (surname) for Chinese names
    return cjkMatch[1].toLowerCase();
  }

  // Japanese names with hiragana/katakana (family name usually in kanji)
  const japanesePattern =
    /^([\u4e00-\u9fff]{1,3})([\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]+)$/;
  const japaneseMatch = author.match(japanesePattern);
  if (japaneseMatch) {
    return japaneseMatch[1].toLowerCase();
  }

  // Korean names (Hangul)
  const koreanPattern = /^([\uac00-\ud7af]{1,2})([\uac00-\ud7af]{1,3})$/;
  const koreanMatch = author.match(koreanPattern);
  if (koreanMatch) {
    return koreanMatch[1].toLowerCase();
  }

  // "LastName, FirstName" format
  if (author.includes(",")) {
    const lastName = author.split(",")[0].trim();
    return lastName.toLowerCase().replace(/\./g, "");
  }

  // "FirstName LastName" or "F. LastName" format
  // The last word is usually the last name
  const parts = author.split(/\s+/);
  if (parts.length > 1) {
    // Skip initials (single letters or letters with period)
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i].replace(/\./g, "").replace(/[,;]$/, "");
      // Skip single letter initials
      if (part.length > 1 && !/^[A-Z]$/i.test(part)) {
        return part.toLowerCase();
      }
    }
  }

  // Single word - return as is
  return author
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[,;]$/, "");
}

/**
 * Check if the author string represents a collaboration.
 *
 * @param authorStr - Author string to check
 * @returns true if this is a collaboration name
 */
export function isCollaboration(authorStr: string): boolean {
  const lower = authorStr.toLowerCase();
  return /\b(collaboration|collab\.?|group|team|consortium|experiment)\b/i.test(
    lower
  );
}

/**
 * Extract collaboration name from author string.
 * "ATLAS Collaboration" -> "atlas"
 * "Belle II Collaboration" -> "belle ii" or "belle"
 *
 * @param authorStr - Collaboration author string
 * @returns Normalized collaboration name
 */
export function extractCollaborationName(authorStr: string): string {
  // Try to extract the collaboration name before "Collaboration"
  const match = authorStr.match(
    /^([A-Za-z0-9\s-]+?)\s+(?:collaboration|collab\.?|group)/i
  );
  if (match) {
    return match[1].toLowerCase().trim();
  }
  // Return the whole string normalized
  return authorStr
    .toLowerCase()
    .replace(
      /\s+(collaboration|collab\.?|group|team|consortium|experiment).*$/i,
      ""
    )
    .trim();
}

/**
 * Parse author labels from citation text.
 * Extracts individual authors and year from various formats:
 * - "Author et al. 2020"
 * - "Author and Author 2020"
 * - "M.-T. Li 2020" (with initials)
 * - "Author1, Author2, Author3 2020"
 *
 * @param labels - Array of labels from citation parser
 * @returns Parsed author info
 */
export function parseAuthorLabels(labels: string[]): {
  authors: string[];
  authorInitials: Map<string, string>;
  year: string | null;
  isEtAl: boolean;
} {
  const authors: string[] = [];
  const authorInitials = new Map<string, string>();
  let year: string | null = null;
  let isEtAl = false;

  for (const label of labels) {
    // Check for "Initial(s) LastName" format (e.g., "M.-T. Li", "G. Li")
    const initialAuthorMatch = label.match(RE_INITIAL_AUTHOR);
    if (initialAuthorMatch) {
      const initials = initialAuthorMatch[1].replace(/\s+/g, "");
      const author = initialAuthorMatch[2].toLowerCase();
      if (!authors.includes(author)) {
        authors.push(author);
      }
      authorInitials.set(author, initials);
      continue;
    }

    // Check for combined "Author et al. YYYY" or "Author YYYY" format
    const combinedMatch = label.match(RE_AUTHOR_YEAR_COMBINED);
    if (combinedMatch) {
      const author = combinedMatch[1].toLowerCase();
      if (!authors.includes(author)) {
        authors.push(author);
      }
      year = combinedMatch[2];
      isEtAl = /et\s+al\.?/i.test(label);
      continue;
    }

    // Check for "Author and Author YYYY" format
    const twoAuthorsMatch = label.match(RE_TWO_AUTHORS_YEAR);
    if (twoAuthorsMatch) {
      const author1 = twoAuthorsMatch[1].toLowerCase();
      const author2 = twoAuthorsMatch[2].toLowerCase();
      if (!authors.includes(author1)) authors.push(author1);
      if (!authors.includes(author2)) authors.push(author2);
      year = twoAuthorsMatch[3];
      continue;
    }

    // Check for standalone year (with optional suffix like 2017a)
    if (RE_YEAR_STANDALONE.test(label)) {
      year = label;
      continue;
    }

    // Check for standalone author name
    if (RE_AUTHOR_STANDALONE.test(label)) {
      const author = label.toLowerCase();
      if (!authors.includes(author)) {
        authors.push(author);
      }
      continue;
    }

    // Check for comma-separated authors like "Sjostrand, Mrenna, Skands"
    if (RE_COMMA_AUTHORS.test(label)) {
      const parts = label.split(/,\s*/);
      for (const part of parts) {
        const author = part.trim().toLowerCase();
        if (author && !authors.includes(author)) {
          authors.push(author);
        }
      }
    }
  }

  return { authors, authorInitials, year, isEtAl };
}
