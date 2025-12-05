import {
  getJournalFullNames,
} from "../../utils/journalAbbreviations";
import type { ParsedFilterToken, InspireReferenceEntry } from "./types";
import { buildEntrySearchText } from "./formatters";

// ─────────────────────────────────────────────────────────────────────────────
// Text Normalization Constants
// ─────────────────────────────────────────────────────────────────────────────
const SPECIAL_CHAR_REPLACEMENTS: Record<string, string> = {
  "ß": "ss",
  "æ": "ae",
  "œ": "oe",
  "ø": "o",
  "đ": "d",
  "ð": "d",
  "þ": "th",
  "ł": "l",
};
const SPECIAL_CHAR_REGEX = /[ßæœøđðþł]/g;
const GERMAN_UMLAUT_REPLACEMENTS: Record<string, string> = {
  "ä": "ae",
  "ö": "oe",
  "ü": "ue",
};
const GERMAN_UMLAUT_REGEX = /[äöü]/g;
const COMBINING_MARKS_REGEX = /[\u0300-\u036f]/g;
const SEARCH_COLLAPSE_REGEX = /[.\s]+/g;

// ─────────────────────────────────────────────────────────────────────────────
// Text Normalization Functions
// ─────────────────────────────────────────────────────────────────────────────

export const normalizeSearchText = (value: string): string => {
  if (!value) {
    return "";
  }
  const lower = value.toLowerCase();
  const replaced = lower.replace(
    SPECIAL_CHAR_REGEX,
    (char) => SPECIAL_CHAR_REPLACEMENTS[char] ?? char,
  );
  return replaced.normalize("NFD").replace(COMBINING_MARKS_REGEX, "");
};

export const buildVariantSet = (value: string): string[] => {
  if (!value) {
    return [];
  }
  const normalized = normalizeSearchText(value);
  const umlautExpanded = normalizeSearchText(
    value
      .toLowerCase()
      .replace(
        GERMAN_UMLAUT_REGEX,
        (char) => GERMAN_UMLAUT_REPLACEMENTS[char] ?? char,
      ),
  );
  const variants = [normalized, umlautExpanded].filter(
    (token): token is string => Boolean(token),
  );
  return Array.from(new Set(variants));
};

export const buildSearchIndexText = (value: string): string =>
  buildVariantSet(value).join(" ");

// ─────────────────────────────────────────────────────────────────────────────
// Filter Token Functions
// ─────────────────────────────────────────────────────────────────────────────

export const buildFilterTokenVariants = (
  value: string,
  options?: { ignoreSpaceDot?: boolean },
): string[] => {
  const variants = buildVariantSet(value);
  const journalFullNames = getJournalFullNames(value);
  if (journalFullNames.length) {
    for (const fullName of journalFullNames) {
      variants.push(...buildVariantSet(fullName));
    }
  }
  let uniqueVariants = Array.from(new Set(variants));
  if (!options?.ignoreSpaceDot) {
    return uniqueVariants;
  }
  const collapsed = uniqueVariants
    .map((token) => token.replace(SEARCH_COLLAPSE_REGEX, ""))
    .filter((token): token is string => Boolean(token));
  if (!collapsed.length) {
    return uniqueVariants;
  }
  uniqueVariants = Array.from(new Set([...uniqueVariants, ...collapsed]));
  return uniqueVariants;
};

const isFilterWhitespace = (char: string): boolean =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";

export const parseFilterTokens = (value: string): ParsedFilterToken[] => {
  if (!value) {
    return [];
  }
  const tokens: ParsedFilterToken[] = [];
  let current = "";
  let inQuotes = false;

  const pushToken = (quoted: boolean) => {
    if (!current) {
      return;
    }
    const trimmed = current.trim();
    if (trimmed) {
      tokens.push({ text: trimmed, quoted });
    }
    current = "";
  };

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      pushToken(inQuotes);
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && isFilterWhitespace(char)) {
      pushToken(false);
      continue;
    }
    current += char;
  }

  pushToken(inQuotes);
  return tokens;
};

// ─────────────────────────────────────────────────────────────────────────────
// Search Text Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lazily compute searchText for an entry if not already computed.
 * This is a performance optimization - searchText is only computed when
 * actually needed for filtering, not during initial data loading.
 */
export function ensureSearchText(entry: InspireReferenceEntry): string {
  if (!entry.searchText) {
    entry.searchText = buildEntrySearchText(entry);
  }
  return entry.searchText;
}

