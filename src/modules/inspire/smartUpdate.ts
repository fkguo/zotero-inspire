import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import type { jsobject } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Smart Update Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Field categories for smart update
 */
export type FieldCategory =
  | "bibliographic"
  | "identifiers"
  | "citations"
  | "extra";

/**
 * Individual field change detected during comparison
 */
export interface FieldChange {
  field: string;
  category: FieldCategory;
  localValue: string | number | null;
  inspireValue: string | number | null;
  isSignificant: boolean; // True if this is a meaningful change (not just formatting)
}

/**
 * Result of comparing local item with INSPIRE metadata
 */
export interface SmartUpdateDiff {
  itemId: number;
  itemTitle: string;
  hasChanges: boolean;
  changes: FieldChange[];
  // Grouped by category for display
  bibliographicChanges: FieldChange[];
  identifierChanges: FieldChange[];
  citationChanges: FieldChange[];
  extraChanges: FieldChange[];
}

/**
 * User's field protection preferences
 */
export interface FieldProtectionConfig {
  protectTitle: boolean;
  protectAuthors: boolean;
  protectAbstract: boolean;
  protectDate: boolean;
  protectJournal: boolean;
  protectVolume: boolean;
  protectPages: boolean;
  protectDOI: boolean;
  protectedNames: string[]; // List of author names to always preserve
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_FIELD_PROTECTION: FieldProtectionConfig = {
  protectTitle: true, // Don't overwrite if user edited title
  protectAuthors: true, // Don't overwrite if user edited authors
  protectAbstract: false, // Usually safe to update
  protectDate: false, // Usually safe to update
  protectJournal: false, // Usually want INSPIRE's journal info
  protectVolume: false,
  protectPages: false,
  protectDOI: false, // Usually want to add DOI
  protectedNames: [], // No protected names by default
};

// ─────────────────────────────────────────────────────────────────────────────
// Field Protection Logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse protected names from preference string
 */
function parseProtectedNames(namesString: string): string[] {
  if (!namesString || namesString.trim() === "") {
    return [];
  }
  return namesString
    .split(/[,;]/)
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
}

/**
 * Get current field protection configuration from preferences
 */
export function getFieldProtectionConfig(): FieldProtectionConfig {
  const protectedNamesStr =
    (getPref("smart_update_protected_names") as string) ?? "";
  return {
    protectTitle:
      (getPref("smart_update_protect_title") as boolean) ??
      DEFAULT_FIELD_PROTECTION.protectTitle,
    protectAuthors:
      (getPref("smart_update_protect_authors") as boolean) ??
      DEFAULT_FIELD_PROTECTION.protectAuthors,
    protectAbstract:
      (getPref("smart_update_protect_abstract") as boolean) ??
      DEFAULT_FIELD_PROTECTION.protectAbstract,
    protectDate: DEFAULT_FIELD_PROTECTION.protectDate,
    protectJournal:
      (getPref("smart_update_protect_journal") as boolean) ??
      DEFAULT_FIELD_PROTECTION.protectJournal,
    protectVolume: DEFAULT_FIELD_PROTECTION.protectVolume,
    protectPages: DEFAULT_FIELD_PROTECTION.protectPages,
    protectDOI: DEFAULT_FIELD_PROTECTION.protectDOI,
    protectedNames: parseProtectedNames(protectedNamesStr),
  };
}

/**
 * Check if a field is protected based on current configuration
 */
export function isFieldProtected(
  field: string,
  config: FieldProtectionConfig,
): boolean {
  switch (field) {
    case "title":
      return config.protectTitle;
    case "creators":
      return config.protectAuthors;
    case "abstractNote":
      return config.protectAbstract;
    case "date":
      return config.protectDate;
    case "journalAbbreviation":
    case "publicationTitle":
    case "series":
      return config.protectJournal;
    case "volume":
    case "seriesNumber":
      return config.protectVolume;
    case "pages":
      return config.protectPages;
    case "DOI":
    case "url":
      return config.protectDOI;
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Umlaut / Diacritic Equivalence Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Character equivalence map for diacritics/umlauts (German-style expansion)
 * Maps special characters to their traditional ASCII equivalents
 */
const DIACRITIC_EQUIVALENTS: Record<string, string> = {
  // German umlauts (expanded form)
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
  // French/Spanish accents
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  É: "E",
  È: "E",
  Ê: "E",
  Ë: "E",
  á: "a",
  à: "a",
  â: "a",
  ã: "a",
  Á: "A",
  À: "A",
  Â: "A",
  Ã: "A",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  Í: "I",
  Ì: "I",
  Î: "I",
  Ï: "I",
  ó: "o",
  ò: "o",
  ô: "o",
  õ: "o",
  Ó: "O",
  Ò: "O",
  Ô: "O",
  Õ: "O",
  ú: "u",
  ù: "u",
  û: "u",
  Ú: "U",
  Ù: "U",
  Û: "U",
  ñ: "n",
  Ñ: "N",
  ç: "c",
  Ç: "C",
  // Nordic characters
  å: "a",
  Å: "A",
  æ: "ae",
  Æ: "Ae",
  ø: "o",
  Ø: "O",
  // Polish/Czech/etc
  ł: "l",
  Ł: "L",
  ś: "s",
  Ś: "S",
  ź: "z",
  Ź: "Z",
  ż: "z",
  Ż: "Z",
  ć: "c",
  Ć: "C",
  ń: "n",
  Ń: "N",
  ř: "r",
  Ř: "R",
  š: "s",
  Š: "S",
  ž: "z",
  Ž: "Z",
  č: "c",
  Č: "C",
  ě: "e",
  Ě: "E",
  ů: "u",
  Ů: "U",
  ý: "y",
  Ý: "Y",
  // Turkish
  ğ: "g",
  Ğ: "G",
  ı: "i",
  İ: "I",
  ş: "s",
  Ş: "S",
};

/**
 * Simple diacritic stripping map (just removes accents, no expansion)
 * Used for matching against databases that simply strip accents (e.g., Döring → Doring)
 */
const DIACRITIC_STRIP: Record<string, string> = {
  // German umlauts (simple strip)
  ä: "a",
  ö: "o",
  ü: "u",
  Ä: "A",
  Ö: "O",
  Ü: "U",
  ß: "s", // Sometimes stripped to single s
  // All accented vowels
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  É: "E",
  È: "E",
  Ê: "E",
  Ë: "E",
  á: "a",
  à: "a",
  â: "a",
  ã: "a",
  Á: "A",
  À: "A",
  Â: "A",
  Ã: "A",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  Í: "I",
  Ì: "I",
  Î: "I",
  Ï: "I",
  ó: "o",
  ò: "o",
  ô: "o",
  õ: "o",
  Ó: "O",
  Ò: "O",
  Ô: "O",
  Õ: "O",
  ú: "u",
  ù: "u",
  û: "u",
  Ú: "U",
  Ù: "U",
  Û: "U",
  ñ: "n",
  Ñ: "N",
  ç: "c",
  Ç: "C",
  // Nordic
  å: "a",
  Å: "A",
  æ: "a",
  Æ: "A", // Simple strip (vs ae expansion)
  ø: "o",
  Ø: "O",
  // Polish/Czech/etc
  ł: "l",
  Ł: "L",
  ś: "s",
  Ś: "S",
  ź: "z",
  Ź: "Z",
  ż: "z",
  Ż: "Z",
  ć: "c",
  Ć: "C",
  ń: "n",
  Ń: "N",
  ř: "r",
  Ř: "R",
  š: "s",
  Š: "S",
  ž: "z",
  Ž: "Z",
  č: "c",
  Č: "C",
  ě: "e",
  Ě: "E",
  ů: "u",
  Ů: "U",
  ý: "y",
  Ý: "Y",
  // Turkish
  ğ: "g",
  Ğ: "G",
  ı: "i",
  İ: "I",
  ş: "s",
  Ş: "S",
};

/**
 * Normalize a string by replacing diacritics with ASCII equivalents (German-style)
 */
function normalizeDiacritics(str: string): string {
  let result = str;
  for (const [diacritic, replacement] of Object.entries(
    DIACRITIC_EQUIVALENTS,
  )) {
    result = result.split(diacritic).join(replacement);
  }
  return result;
}

/**
 * Strip diacritics from a string (simple removal, no expansion)
 */
function stripDiacritics(str: string): string {
  let result = str;
  for (const [diacritic, replacement] of Object.entries(DIACRITIC_STRIP)) {
    result = result.split(diacritic).join(replacement);
  }
  return result;
}

/**
 * Check if the difference between two strings is only diacritics/umlauts
 * Returns true if the strings are equivalent after normalizing diacritics
 * Checks both German-style expansion (ö→oe) and simple stripping (ö→o)
 */
export function isDiacriticEquivalent(str1: string, str2: string): boolean {
  if (str1 === str2) return true;
  if (!str1 || !str2) return false;

  const s1Lower = str1.toLowerCase();
  const s2Lower = str2.toLowerCase();

  // Check German-style expansion (Meißner → Meissner)
  const expanded1 = normalizeDiacritics(s1Lower);
  const expanded2 = normalizeDiacritics(s2Lower);
  if (expanded1 === expanded2) return true;

  // Check simple stripping (Döring → Doring)
  const stripped1 = stripDiacritics(s1Lower);
  const stripped2 = stripDiacritics(s2Lower);
  if (stripped1 === stripped2) return true;

  return false;
}

/**
 * Check if a name contains diacritics that should be preserved
 */
function hasDiacritics(str: string): boolean {
  for (const diacritic of Object.keys(DIACRITIC_EQUIVALENTS)) {
    if (str.includes(diacritic)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a creator name matches any protected name
 */
function isNameProtected(
  creator: _ZoteroTypes.Item.Creator,
  protectedNames: string[],
): boolean {
  if (protectedNames.length === 0) return false;

  const lastName = (creator.lastName || "").toLowerCase();
  const firstName = (creator.firstName || "").toLowerCase();
  const fullName = `${firstName} ${lastName}`.trim();
  const reverseName = `${lastName} ${firstName}`.trim();

  for (const protectedName of protectedNames) {
    // Match against lastName, firstName, fullName, or reversed fullName
    // Also check partial matches (e.g., "Ulf-G." should match firstName "Ulf-G.")
    if (
      lastName === protectedName ||
      firstName === protectedName ||
      fullName === protectedName ||
      reverseName === protectedName ||
      lastName.includes(protectedName) ||
      firstName.includes(protectedName) ||
      protectedName.includes(lastName) ||
      protectedName.includes(firstName)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if local creators contain any protected names
 * Returns the list of protected names found
 */
export function findProtectedCreatorNames(
  localCreators: _ZoteroTypes.Item.Creator[],
  protectedNames: string[],
): string[] {
  if (
    !localCreators ||
    localCreators.length === 0 ||
    protectedNames.length === 0
  ) {
    return [];
  }

  const found: string[] = [];
  for (const creator of localCreators) {
    if (isNameProtected(creator, protectedNames)) {
      const name = creator.lastName || creator.firstName || "";
      if (name && !found.includes(name)) {
        found.push(name);
      }
    }
  }
  return found;
}

/**
 * Merge creators: use INSPIRE data but preserve local names in these cases:
 * 1. Name is in the protected names list
 * 2. Local name has diacritics and INSPIRE has ASCII equivalent (auto-detect)
 *
 * Returns merged creators array, or null if no merge needed (use INSPIRE as-is)
 */
export function mergeCreatorsWithProtectedNames(
  localCreators: _ZoteroTypes.Item.Creator[],
  inspireCreators: _ZoteroTypes.Item.Creator[],
  protectedNames: string[],
): _ZoteroTypes.Item.Creator[] | null {
  if (!localCreators || localCreators.length === 0) {
    return null; // No local creators, use INSPIRE as-is
  }

  // Build a map of local creators by normalized (diacritic-free) lastName for matching
  const localByNormalized = new Map<string, _ZoteroTypes.Item.Creator>();
  for (const creator of localCreators) {
    const lastName = creator.lastName || "";
    if (lastName) {
      const normalizedKey = normalizeDiacritics(lastName).toLowerCase();
      localByNormalized.set(normalizedKey, creator);
    }
  }

  let hasPreservations = false;
  const merged: _ZoteroTypes.Item.Creator[] = [];

  for (const inspireCreator of inspireCreators) {
    const inspireLastName = inspireCreator.lastName || "";
    const inspireFirstName = inspireCreator.firstName || "";
    const normalizedKey = normalizeDiacritics(inspireLastName).toLowerCase();
    const localCreator = localByNormalized.get(normalizedKey);

    let shouldPreserveLocal = false;
    let reason = "";

    if (localCreator) {
      const localLastName = localCreator.lastName || "";
      const localFirstName = localCreator.firstName || "";

      // Check 1: Is this name in the protected names list?
      if (isNameProtected(localCreator, protectedNames)) {
        shouldPreserveLocal = true;
        reason = "protected name";
      }
      // Check 2: Does local have diacritics that INSPIRE lacks?
      // Only preserve if local has diacritics AND names are diacritic-equivalent
      else if (
        hasDiacritics(localLastName) &&
        isDiacriticEquivalent(localLastName, inspireLastName)
      ) {
        shouldPreserveLocal = true;
        reason = "diacritic preservation";
      } else if (
        hasDiacritics(localFirstName) &&
        isDiacriticEquivalent(localFirstName, inspireFirstName)
      ) {
        shouldPreserveLocal = true;
        reason = "diacritic preservation (first name)";
      }
    }

    if (shouldPreserveLocal && localCreator) {
      merged.push(localCreator);
      hasPreservations = true;
      Zotero.debug(
        `[zotero-inspire] Preserving local author name (${reason}): ${localCreator.lastName}, ${localCreator.firstName}`,
      );
    } else {
      merged.push(inspireCreator);
    }
  }

  return hasPreservations ? merged : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field Comparison Logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize string for comparison (trim, lowercase, remove extra spaces, Unicode normalize)
 */
function normalizeForComparison(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toString()
    .normalize("NFC") // Unicode normalization to avoid false positives
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " "); // Replace special spaces
}

/**
 * Check if two values are effectively the same
 */
function valuesAreEqual(local: any, inspire: any): boolean {
  // Both empty
  if (!local && !inspire) return true;
  // One empty
  if (!local || !inspire) return false;
  // Normalize and compare strings
  return (
    normalizeForComparison(String(local)) ===
    normalizeForComparison(String(inspire))
  );
}

/**
 * Check if local value is "empty" (should be filled)
 */
function isEmptyValue(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Normalize a name string for comparison:
 * - Trim leading/trailing whitespace
 * - Collapse multiple spaces to single space
 * - Remove spaces around dots (J. R. → J.R.)
 */
function normalizeNameForComparison(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .replace(/\s*\.\s*/g, ".") // Remove spaces around dots: "J. R." → "J.R."
    .replace(/\s*-\s*/g, "-"); // Remove spaces around hyphens
}

/**
 * Compare two creator arrays
 *
 * Special handling for truncated author lists:
 * - If local has fewer authors than INSPIRE, only compare the overlapping authors
 * - This prevents false positives when user intentionally kept only first N authors
 * - Example: Local has 3 authors, INSPIRE has 100+ → only compare first 3
 *
 * Also uses diacritic equivalence to avoid false positives when local has diacritics
 * that INSPIRE normalizes (e.g., Meißner vs Meissner)
 *
 * Also normalizes whitespace differences (e.g., "J. R." vs "J.R.")
 *
 * Special case: "others" or "et al." entries are treated as list terminators
 * - If local ends with "others"/"et al.", it means the list was truncated
 * - We should only compare authors before the terminator
 */
function creatorsAreEqual(
  local: _ZoteroTypes.Item.Creator[],
  inspire: _ZoteroTypes.Item.Creator[],
): boolean {
  if (!local || local.length === 0) {
    return !inspire || inspire.length === 0;
  }
  if (!inspire || inspire.length === 0) {
    return false;
  }

  // Check if local list ends with a terminator like "others" or "et al."
  // These indicate the user intentionally truncated the author list
  const terminators = [
    "others",
    "et al.",
    "et al",
    "and others",
    "collaboration",
  ];
  const localEffective = local.filter((c) => {
    const name = ((c as any).name || c.lastName || "").toLowerCase().trim();
    return !terminators.some((t) => name === t || name.includes(t));
  });

  // If local only has terminators (no real authors), consider it empty
  if (localEffective.length === 0) {
    return true; // Don't flag as change - user wants minimal author info
  }

  // Only compare the overlapping portion (first N authors where N = localEffective.length)
  const compareCount = Math.min(localEffective.length, inspire.length);

  for (let i = 0; i < compareCount; i++) {
    const l = localEffective[i];
    const r = inspire[i];
    // Normalize names to handle whitespace differences like "J. R." vs "J.R."
    const localFirst = normalizeNameForComparison(l.firstName || "");
    const inspireFirst = normalizeNameForComparison(r.firstName || "");
    const localLast = normalizeNameForComparison(
      (l as any).name || l.lastName || "",
    );
    const inspireLast = normalizeNameForComparison(
      (r as any).name || r.lastName || "",
    );

    // Check firstName: either exact match (case-insensitive) or diacritic equivalent
    if (
      localFirst.toLowerCase() !== inspireFirst.toLowerCase() &&
      !isDiacriticEquivalent(localFirst, inspireFirst)
    ) {
      return false;
    }
    // Check lastName: either exact match (case-insensitive) or diacritic equivalent
    if (
      localLast.toLowerCase() !== inspireLast.toLowerCase() &&
      !isDiacriticEquivalent(localLast, inspireLast)
    ) {
      return false;
    }
  }

  // If we get here, the overlapping authors match
  // Consider them "equal" even if INSPIRE has more authors
  // (user intentionally kept truncated list)
  return true;
}

/**
 * Format creators array for display in preview dialog
 */
function formatCreatorsForDisplay(
  creators: _ZoteroTypes.Item.Creator[],
): string {
  if (!creators || creators.length === 0) {
    return "";
  }
  const names = creators.slice(0, 3).map((c) => {
    if (c.firstName && c.lastName) {
      return `${c.lastName}, ${c.firstName}`;
    }
    return c.lastName || c.firstName || "";
  });
  if (creators.length > 3) {
    return `${names.join("; ")} et al. (${creators.length} authors)`;
  }
  return names.join("; ");
}

/**
 * Compare a single field between local item and INSPIRE metadata
 */
function compareField(
  field: string,
  category: FieldCategory,
  localValue: any,
  inspireValue: any,
): FieldChange | null {
  // Skip if INSPIRE has no value
  if (isEmptyValue(inspireValue)) {
    return null;
  }

  // Check if values are different
  const areEqual = valuesAreEqual(localValue, inspireValue);
  if (areEqual) {
    return null;
  }

  // Determine if this is a significant change
  const localEmpty = isEmptyValue(localValue);
  const isSignificant = localEmpty || !areEqual;

  return {
    field,
    category,
    localValue: localValue ?? null,
    inspireValue: inspireValue ?? null,
    isSignificant,
  };
}

/**
 * Extract citation counts from Extra field
 */
function extractCitationsFromExtra(extra: string): {
  total: number | null;
  withoutSelf: number | null;
} {
  const result = {
    total: null as number | null,
    withoutSelf: null as number | null,
  };

  const totalMatch = extra.match(/^(\d+)\s+citations\s+\(INSPIRE/m);
  if (totalMatch) {
    result.total = parseInt(totalMatch[1], 10);
  }

  const withoutSelfMatch = extra.match(/^(\d+)\s+citations\s+w\/o\s+self/m);
  if (withoutSelfMatch) {
    result.withoutSelf = parseInt(withoutSelfMatch[1], 10);
  }

  return result;
}

/**
 * Extract arXiv ID from Extra field
 */
function extractArxivFromExtra(extra: string): string | null {
  const match = extra.match(/arXiv:([^\s\]]+)/i);
  return match ? match[1] : null;
}

/**
 * Build arXiv info string (matches setInspireMeta logic)
 */
function buildArxivInfoString(arxiv: {
  value: string;
  categories?: string[];
}): string {
  const arxivId = arxiv.value;
  if (/^\d/.test(arxivId) && arxiv.categories?.[0]) {
    return `arXiv:${arxivId} [${arxiv.categories[0]}]`;
  }
  return `arXiv:${arxivId}`;
}

/**
 * Compare local Zotero item with INSPIRE metadata
 */
export function compareItemWithInspire(
  item: Zotero.Item,
  metaInspire: jsobject,
): SmartUpdateDiff {
  const changes: FieldChange[] = [];
  const extra = (item.getField("extra") as string) || "";

  // Determine effective journalAbbreviation value from INSPIRE
  // If no journal info but has arXiv, use arXiv as fallback (matches setInspireMeta logic)
  let effectiveJournalAbbr = metaInspire.journalAbbreviation;
  if (
    !effectiveJournalAbbr &&
    metaInspire.arxiv?.value &&
    item.itemType === "journalArticle"
  ) {
    effectiveJournalAbbr = buildArxivInfoString(metaInspire.arxiv);
  }

  // Bibliographic fields
  const bibliographicFields: Array<{
    field: string;
    localGetter: () => any;
    inspireValue: any;
  }> = [
    {
      field: "title",
      localGetter: () => item.getField("title"),
      inspireValue: metaInspire.title,
    },
    {
      field: "date",
      localGetter: () => item.getField("date"),
      inspireValue: metaInspire.date,
    },
    {
      field: "journalAbbreviation",
      localGetter: () => item.getField("journalAbbreviation"),
      inspireValue: effectiveJournalAbbr,
    },
    {
      field: "volume",
      localGetter: () => item.getField("volume"),
      inspireValue: metaInspire.volume,
    },
    {
      field: "pages",
      localGetter: () => item.getField("pages"),
      inspireValue: metaInspire.pages,
    },
    {
      field: "issue",
      localGetter: () => item.getField("issue"),
      inspireValue: metaInspire.issue,
    },
    {
      field: "abstractNote",
      localGetter: () => item.getField("abstractNote"),
      inspireValue: metaInspire.abstractNote,
    },
  ];

  for (const { field, localGetter, inspireValue } of bibliographicFields) {
    const change = compareField(
      field,
      "bibliographic",
      localGetter(),
      inspireValue,
    );
    if (change) changes.push(change);
  }

  // Identifier fields
  const identifierFields: Array<{
    field: string;
    localGetter: () => any;
    inspireKey: string;
  }> = [
    {
      field: "DOI",
      localGetter: () => item.getField("DOI"),
      inspireKey: "DOI",
    },
  ];

  for (const { field, localGetter, inspireKey } of identifierFields) {
    const change = compareField(
      field,
      "identifiers",
      localGetter(),
      metaInspire[inspireKey],
    );
    if (change) changes.push(change);
  }

  // arXiv comparison
  if (metaInspire.arxiv?.value) {
    const localArxiv = extractArxivFromExtra(extra);
    const inspireArxiv = metaInspire.arxiv.value;
    if (!valuesAreEqual(localArxiv, inspireArxiv)) {
      changes.push({
        field: "arXiv",
        category: "identifiers",
        localValue: localArxiv,
        inspireValue: inspireArxiv,
        isSignificant: true,
      });
    }
  }

  // Citation counts
  const localCitations = extractCitationsFromExtra(extra);
  if (metaInspire.citation_count !== undefined) {
    if (localCitations.total !== metaInspire.citation_count) {
      changes.push({
        field: "citations",
        category: "citations",
        localValue: localCitations.total,
        inspireValue: metaInspire.citation_count,
        isSignificant: true,
      });
    }
  }
  if (metaInspire.citation_count_wo_self_citations !== undefined) {
    if (
      localCitations.withoutSelf !==
      metaInspire.citation_count_wo_self_citations
    ) {
      changes.push({
        field: "citationsWithoutSelf",
        category: "citations",
        localValue: localCitations.withoutSelf,
        inspireValue: metaInspire.citation_count_wo_self_citations,
        isSignificant: true,
      });
    }
  }

  // Citation key comparison
  if (metaInspire.citekey) {
    const localCitekey = extra.match(/Citation Key:\s*(\S+)/)?.[1] || null;
    if (!valuesAreEqual(localCitekey, metaInspire.citekey)) {
      changes.push({
        field: "citekey",
        category: "extra",
        localValue: localCitekey,
        inspireValue: metaInspire.citekey,
        isSignificant: isEmptyValue(localCitekey),
      });
    }
  }

  // Creators comparison
  if (metaInspire.creators && metaInspire.creators.length > 0) {
    const localCreators = item.getCreators();
    if (!creatorsAreEqual(localCreators, metaInspire.creators)) {
      // Debug: log the actual difference
      const compareCount = Math.min(
        localCreators.length,
        metaInspire.creators.length,
      );
      for (let i = 0; i < compareCount; i++) {
        const l = localCreators[i];
        const r = metaInspire.creators[i];
        const localFirst = (l.firstName || "").trim();
        const inspireFirst = (r.firstName || "").trim();
        const localLast = (l.lastName || "").trim();
        const inspireLast = (r.lastName || "").trim();
        if (
          localFirst.toLowerCase() !== inspireFirst.toLowerCase() ||
          localLast.toLowerCase() !== inspireLast.toLowerCase()
        ) {
          Zotero.debug(`[zotero-inspire] Creator diff at index ${i}:`);
          Zotero.debug(
            `  Local: "${localLast}", "${localFirst}" (${JSON.stringify(l)})`,
          );
          Zotero.debug(
            `  INSPIRE: "${inspireLast}", "${inspireFirst}" (${JSON.stringify(r)})`,
          );
        }
      }
      changes.push({
        field: "creators",
        category: "bibliographic",
        localValue: formatCreatorsForDisplay(localCreators),
        inspireValue: formatCreatorsForDisplay(metaInspire.creators),
        isSignificant: true,
      });
    }
  }

  // Collaboration comparison
  if (metaInspire.collaborations?.length) {
    const localCollab = extra.match(/tex\.collaboration:\s*(.+)/)?.[1] || null;
    const inspireCollab = metaInspire.collaborations.join(", ");
    if (!valuesAreEqual(localCollab, inspireCollab)) {
      changes.push({
        field: "collaboration",
        category: "extra",
        localValue: localCollab,
        inspireValue: inspireCollab,
        isSignificant: isEmptyValue(localCollab),
      });
    }
  }

  // Group changes by category
  const bibliographicChanges = changes.filter(
    (c) => c.category === "bibliographic",
  );
  const identifierChanges = changes.filter((c) => c.category === "identifiers");
  const citationChanges = changes.filter((c) => c.category === "citations");
  const extraChanges = changes.filter((c) => c.category === "extra");

  return {
    itemId: item.id,
    itemTitle:
      (item.getField("title") as string) || getString("smart-update-untitled"),
    hasChanges: changes.length > 0,
    changes,
    bibliographicChanges,
    identifierChanges,
    citationChanges,
    extraChanges,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Selective Update Logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter changes based on protection settings
 * Returns only the changes that should be applied
 */
export function filterProtectedChanges(
  diff: SmartUpdateDiff,
  config: FieldProtectionConfig,
): FieldChange[] {
  return diff.changes.filter((change) => {
    // Check field protection
    if (isFieldProtected(change.field, config)) {
      // Only skip if local value is non-empty (user has data)
      if (!isEmptyValue(change.localValue)) {
        Zotero.debug(
          `[zotero-inspire] Skipping protected field: ${change.field} (local value exists)`,
        );
        return false;
      }
    }

    return true;
  });
}

/**
 * Get human-readable field name for display
 */
export function getFieldDisplayName(field: string): string {
  const fieldNames: Record<string, string> = {
    title: getString("smart-update-field-title"),
    date: getString("smart-update-field-date"),
    journalAbbreviation: getString("smart-update-field-journal"),
    volume: getString("smart-update-field-volume"),
    pages: getString("smart-update-field-pages"),
    issue: getString("smart-update-field-issue"),
    abstractNote: getString("smart-update-field-abstract"),
    DOI: getString("smart-update-field-doi"),
    arXiv: getString("smart-update-field-arxiv"),
    citations: getString("smart-update-field-citations"),
    citationsWithoutSelf: getString("smart-update-field-citations-wo-self"),
    citekey: getString("smart-update-field-citekey"),
    collaboration: getString("smart-update-field-collaboration"),
    creators: getString("smart-update-field-authors"),
  };
  return fieldNames[field] || field;
}

/**
 * Format a value for display (truncate long strings)
 */
export function formatValueForDisplay(
  value: any,
  maxLength: number = 50,
): string {
  if (value === null || value === undefined) {
    return getString("smart-update-value-empty");
  }
  const str = String(value);
  if (str.length > maxLength) {
    return str.substring(0, maxLength - 3) + "...";
  }
  return str;
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart Update Mode Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if smart update mode is enabled
 */
export function isSmartUpdateEnabled(): boolean {
  return (getPref("smart_update_enable") as boolean) ?? false;
}

/**
 * Check if preview dialog should be shown
 */
export function shouldShowPreview(): boolean {
  return (getPref("smart_update_show_preview") as boolean) ?? true;
}

/**
 * Check if auto-check on item select is enabled
 */
export function isAutoCheckEnabled(): boolean {
  return (getPref("smart_update_auto_check") as boolean) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview Dialog
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of the preview dialog
 */
export interface PreviewDialogResult {
  confirmed: boolean;
  selectedFields: string[]; // Field names user chose to update
}

/**
 * Show a preview dialog for smart update changes
 * Uses HTML overlay pattern (like ambiguous citation picker)
 * Returns the fields the user selected to update, or null if cancelled
 */
export async function showSmartUpdatePreviewDialog(
  diff: SmartUpdateDiff,
  allowedChanges: FieldChange[],
): Promise<PreviewDialogResult> {
  return new Promise((resolve) => {
    Zotero.debug(
      `[zotero-inspire] showSmartUpdatePreviewDialog: starting with ${allowedChanges.length} changes`,
    );

    const win = Zotero.getMainWindow();
    if (!win) {
      Zotero.debug(
        `[zotero-inspire] showSmartUpdatePreviewDialog: ERROR - no main window, auto-confirming`,
      );
      resolve({
        confirmed: true,
        selectedFields: allowedChanges.map((c) => c.field),
      });
      return;
    }

    const doc = win.document;
    Zotero.debug(
      `[zotero-inspire] showSmartUpdatePreviewDialog: got document, creating overlay`,
    );

    // Remove any existing overlay first (in case of stale state)
    const existingOverlay = doc.getElementById("zinspire-smart-update-overlay");
    if (existingOverlay) {
      Zotero.debug(
        `[zotero-inspire] showSmartUpdatePreviewDialog: removing existing overlay`,
      );
      existingOverlay.remove();
    }

    // Track selected fields (all selected by default)
    const selectedFields = new Set<string>(allowedChanges.map((c) => c.field));

    // Create overlay
    const overlay = doc.createElement("div");
    overlay.id = "zinspire-smart-update-overlay";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.zIndex = "10000";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    // Create panel
    const panel = doc.createElement("div");
    panel.style.backgroundColor = "var(--material-background, #fff)";
    panel.style.color = "var(--fill-primary, #000)";
    panel.style.border = "1px solid var(--fill-quinary, #ccc)";
    panel.style.borderRadius = "8px";
    panel.style.boxShadow = "0 4px 24px rgba(0, 0, 0, 0.25)";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.fontSize = "13px";
    panel.style.maxWidth = "520px";
    panel.style.width = "90%";
    panel.style.maxHeight = "70vh";
    panel.style.overflow = "hidden";
    overlay.appendChild(panel);

    // Header
    const header = doc.createElement("div");
    header.style.padding = "12px 16px";
    header.style.fontWeight = "600";
    header.style.fontSize = "14px";
    header.style.borderBottom = "1px solid var(--fill-quinary, #eee)";
    header.style.backgroundColor = "var(--material-sidepane, #f5f5f5)";
    header.style.borderRadius = "8px 8px 0 0";
    header.textContent = getString("smart-update-preview-title");
    panel.appendChild(header);

    // Item title
    const titleRow = doc.createElement("div");
    titleRow.style.padding = "10px 16px";
    titleRow.style.fontSize = "13px";
    titleRow.style.color = "var(--fill-secondary, #666)";
    titleRow.style.borderBottom = "1px solid var(--fill-quinary, #eee)";
    // Use escapeHtml to prevent syntax errors from HTML tags in titles (e.g., <span class="nocase">)
    const cleanTitle = escapeHtml(stripHtmlTags(diff.itemTitle));
    titleRow.innerHTML = `<strong>${getString("smart-update-preview-header", { args: { title: "" } }).replace(": ", ":")}</strong> ${truncateText(cleanTitle, 60)}`;
    panel.appendChild(titleRow);

    // Info text
    const infoRow = doc.createElement("div");
    infoRow.style.padding = "10px 16px";
    infoRow.style.fontSize = "12px";
    infoRow.style.color = "var(--fill-secondary, #888)";
    infoRow.textContent = getString("smart-update-preview-info");
    panel.appendChild(infoRow);

    // Changes list container
    const listContainer = doc.createElement("div");
    listContainer.style.flex = "1";
    listContainer.style.overflowY = "auto";
    listContainer.style.padding = "8px 16px";
    panel.appendChild(listContainer);

    // Create checkbox rows for each change
    for (const change of allowedChanges) {
      const row = createChangeRowHTML(doc, change, selectedFields);
      listContainer.appendChild(row);
    }

    // Actions bar
    const actions = doc.createElement("div");
    actions.style.padding = "12px 16px";
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.borderTop = "1px solid var(--fill-quinary, #eee)";
    actions.style.backgroundColor = "var(--material-sidepane, #f5f5f5)";
    actions.style.borderRadius = "0 0 8px 8px";

    // Cancel button
    const cancelBtn = doc.createElement("button");
    cancelBtn.textContent = getString("smart-update-preview-cancel");
    cancelBtn.style.padding = "6px 16px";
    cancelBtn.style.minWidth = "80px";
    cancelBtn.style.border = "1px solid var(--fill-quinary, #ccc)";
    cancelBtn.style.borderRadius = "4px";
    cancelBtn.style.backgroundColor = "var(--material-background, #fff)";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.fontSize = "13px";
    actions.appendChild(cancelBtn);

    // Apply button
    const applyBtn = doc.createElement("button");
    applyBtn.textContent = getString("smart-update-preview-apply");
    applyBtn.style.padding = "6px 16px";
    applyBtn.style.minWidth = "80px";
    applyBtn.style.border = "none";
    applyBtn.style.borderRadius = "4px";
    applyBtn.style.backgroundColor = "#0066cc";
    applyBtn.style.color = "#fff";
    applyBtn.style.cursor = "pointer";
    applyBtn.style.fontSize = "13px";
    applyBtn.style.fontWeight = "500";
    actions.appendChild(applyBtn);

    panel.appendChild(actions);

    // Add to document
    doc.documentElement.appendChild(overlay);

    let isFinished = false;

    const finish = (confirmed: boolean) => {
      if (isFinished) return;
      isFinished = true;
      overlay.remove();
      doc.removeEventListener("keydown", onKeyDown, true);
      resolve({
        confirmed,
        selectedFields: confirmed ? Array.from(selectedFields) : [],
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    };

    cancelBtn.addEventListener("click", () => finish(false));
    applyBtn.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
    doc.addEventListener("keydown", onKeyDown, true);
  });
}

/**
 * Create a row for a single field change (HTML version)
 */
function createChangeRowHTML(
  doc: Document,
  change: FieldChange,
  selectedFields: Set<string>,
): HTMLElement {
  const row = doc.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "flex-start";
  row.style.padding = "10px";
  row.style.marginBottom = "8px";
  row.style.borderRadius = "6px";
  row.style.backgroundColor = "var(--material-background, #fafafa)";
  row.style.border = "1px solid var(--fill-quinary, #e0e0e0)";

  // Checkbox
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.style.marginRight = "10px";
  checkbox.style.marginTop = "3px";
  checkbox.style.cursor = "pointer";
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      selectedFields.add(change.field);
    } else {
      selectedFields.delete(change.field);
    }
  });
  row.appendChild(checkbox);

  // Content container
  const content = doc.createElement("div");
  content.style.flex = "1";
  content.style.minWidth = "0";

  // Field name
  const fieldName = doc.createElement("div");
  fieldName.style.fontWeight = "600";
  fieldName.style.marginBottom = "4px";
  fieldName.style.color = "var(--fill-primary, #333)";
  fieldName.textContent = getFieldDisplayName(change.field);
  content.appendChild(fieldName);

  // Values container
  const valuesBox = doc.createElement("div");
  valuesBox.style.fontSize = "12px";

  // Current value (if exists)
  if (
    change.localValue !== null &&
    change.localValue !== undefined &&
    String(change.localValue).trim() !== ""
  ) {
    const currentRow = doc.createElement("div");
    currentRow.style.marginBottom = "2px";
    currentRow.style.display = "flex";
    currentRow.style.gap = "6px";

    const currentLabel = doc.createElement("span");
    currentLabel.style.color = "var(--fill-secondary, #888)";
    currentLabel.style.minWidth = "55px";
    currentLabel.textContent = getString("smart-update-preview-current") + ":";
    currentRow.appendChild(currentLabel);

    const currentValue = doc.createElement("span");
    currentValue.style.color = "#dc2626";
    currentValue.style.textDecoration = "line-through";
    currentValue.style.wordBreak = "break-word";
    currentValue.textContent = formatValueForDisplay(change.localValue, 50);
    currentValue.title = String(change.localValue);
    currentRow.appendChild(currentValue);

    valuesBox.appendChild(currentRow);
  }

  // New value
  const newRow = doc.createElement("div");
  newRow.style.display = "flex";
  newRow.style.gap = "6px";

  const newLabel = doc.createElement("span");
  newLabel.style.color = "var(--fill-secondary, #888)";
  newLabel.style.minWidth = "55px";
  newLabel.textContent = getString("smart-update-preview-new") + ":";
  newRow.appendChild(newLabel);

  const newValue = doc.createElement("span");
  newValue.style.color = "#16a34a";
  newValue.style.fontWeight = "500";
  newValue.style.wordBreak = "break-word";
  newValue.textContent = formatValueForDisplay(change.inspireValue, 50);
  newValue.title = String(change.inspireValue ?? "");
  newRow.appendChild(newValue);

  valuesBox.appendChild(newRow);
  content.appendChild(valuesBox);
  row.appendChild(content);

  return row;
}

/**
 * Truncate text with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Escape HTML special characters to prevent XSS and parsing errors
 * Used when inserting user content into innerHTML
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Strip HTML tags from text, keeping only text content
 * Useful for displaying titles that may contain formatting tags
 */
function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-check Update Notification (FTR-SMART-UPDATE-AUTO-CHECK)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show a notification bar for available updates
 * Returns a promise that resolves with user's choice
 */
export function showUpdateNotification(
  container: HTMLElement,
  diff: SmartUpdateDiff,
  allowedChanges: FieldChange[],
  onViewChanges: () => void,
  onDismiss: () => void,
): HTMLElement {
  const doc = container.ownerDocument;

  // Create notification bar
  const notification = doc.createElement("div");
  notification.className = "zinspire-update-notification";
  notification.style.display = "flex";
  notification.style.alignItems = "center";
  notification.style.justifyContent = "space-between";
  notification.style.padding = "8px 12px";
  notification.style.marginBottom = "8px";
  notification.style.backgroundColor = "#e0f2fe";
  notification.style.border = "1px solid #7dd3fc";
  notification.style.borderRadius = "6px";
  notification.style.fontSize = "13px";
  notification.style.color = "#0369a1";
  notification.style.gap = "12px";

  // Left side: icon and text
  const leftSide = doc.createElement("div");
  leftSide.style.display = "flex";
  leftSide.style.alignItems = "center";
  leftSide.style.gap = "8px";
  leftSide.style.flex = "1";
  leftSide.style.minWidth = "0";

  // Icon
  const icon = doc.createElement("span");
  icon.textContent = "🔄";
  icon.style.fontSize = "14px";
  leftSide.appendChild(icon);

  // Text
  const text = doc.createElement("span");
  text.style.overflow = "hidden";
  text.style.textOverflow = "ellipsis";
  text.style.whiteSpace = "nowrap";
  text.textContent = getString("smart-update-auto-check-changes", {
    args: { count: allowedChanges.length },
  });
  leftSide.appendChild(text);

  notification.appendChild(leftSide);

  // Right side: buttons
  const buttonContainer = doc.createElement("div");
  buttonContainer.style.display = "flex";
  buttonContainer.style.gap = "8px";
  buttonContainer.style.flexShrink = "0";

  // View Changes button
  const viewBtn = doc.createElement("button");
  viewBtn.textContent = getString("smart-update-auto-check-view");
  viewBtn.style.padding = "4px 10px";
  viewBtn.style.fontSize = "12px";
  viewBtn.style.border = "none";
  viewBtn.style.borderRadius = "4px";
  viewBtn.style.backgroundColor = "#0284c7";
  viewBtn.style.color = "#fff";
  viewBtn.style.cursor = "pointer";
  viewBtn.style.fontWeight = "500";
  viewBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onViewChanges();
  });
  buttonContainer.appendChild(viewBtn);

  // Dismiss button
  const dismissBtn = doc.createElement("button");
  dismissBtn.textContent = getString("smart-update-auto-check-dismiss");
  dismissBtn.style.padding = "4px 10px";
  dismissBtn.style.fontSize = "12px";
  dismissBtn.style.border = "1px solid #7dd3fc";
  dismissBtn.style.borderRadius = "4px";
  dismissBtn.style.backgroundColor = "transparent";
  dismissBtn.style.color = "#0369a1";
  dismissBtn.style.cursor = "pointer";
  dismissBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDismiss();
  });
  buttonContainer.appendChild(dismissBtn);

  notification.appendChild(buttonContainer);

  return notification;
}
