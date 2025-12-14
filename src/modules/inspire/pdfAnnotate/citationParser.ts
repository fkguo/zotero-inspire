// ─────────────────────────────────────────────────────────────────────────────
// Citation Parser
// FTR-PDF-ANNOTATE: Parse citation markers from PDF text
// ─────────────────────────────────────────────────────────────────────────────

import type { CitationType, ParsedCitation } from "./types";

/**
 * Pattern definition for citation detection
 */
interface PatternDef {
  regex: RegExp;
  type: CitationType;
  extractLabels: (match: RegExpExecArray) => string[];
}

/**
 * Extended letter character class for author names.
 * Includes ASCII letters plus common European characters (German, French, Spanish, etc.)
 * Used in regex patterns for author name detection.
 *
 * Characters included:
 * - ASCII: a-zA-Z
 * - German: ß, ä, ö, ü, Ä, Ö, Ü
 * - French/Spanish/Portuguese: à, á, â, ã, è, é, ê, ë, ì, í, î, ï, ò, ó, ô, õ, ù, ú, û, ñ, ç, etc.
 * - Polish: ł, Ł, ę, ą, ś, ć, ź, ż, ń
 * - Czech/Slovak: ř, č, š, ž, ě, ů
 * - Turkish: ı, İ, ğ, Ğ, ş, Ş
 * - Scandinavian: å, Å, ø, Ø, æ, Æ
 */
const AUTHOR_LETTER_LOWER = "a-zßäöüàáâãèéêëìíîïòóôõùúûñçłęąśćźżńřčšžěůığş'\\-";
const AUTHOR_LETTER_UPPER = "A-ZÄÖÜÀÁÂÃÈÉÊËÌÍÎÏÒÓÔÕÙÚÛÑÇŁĘĄŚĆŹŻŃŘČŠŽŮIĞŞ";
const AUTHOR_LETTER = `${AUTHOR_LETTER_UPPER}${AUTHOR_LETTER_LOWER}`;

/**
 * Superscript digit mapping
 */
const SUPERSCRIPT_MAP: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
};

// ─────────────────────────────────────────────────────────────────────────────
// Pre-compiled RegExp patterns (hoisted to module level for performance)
// These patterns are used in hot paths during PDF citation detection
// ─────────────────────────────────────────────────────────────────────────────

// Fuzzy detection patterns (used in detectFuzzyCitations)
const DOC_REF_PATTERN =
  /^\s*(figs?|figures?|tabs?|tables?|secs?|sects?|sections?|eqs?|eqns?|equations?|apps?|appendix|appendices|chs?|chaps?|chapters?|parts?|theorems?|lemmas?|corollar(?:y|ies)|defs?|definitions?|props?|propositions?|examples?|exercises?|problems?|notes?|cases?|steps?)\.?\s*[\d,\s–-]+\s*$/i;
const DOC_REF_INLINE_PATTERN =
  /\b(figs?|figures?|tabs?|tables?|secs?|sects?|sections?|eqs?|eqns?|equations?|apps?|appendix|appendices|chs?|chaps?|chapters?|parts?|theorems?|lemmas?|corollar(?:y|ies)|defs?|definitions?|props?|propositions?|examples?|exercises?|problems?|notes?|cases?|steps?)\.?\s*([\d,\s–-]+)/gi;
const RANGE_REGEX = /\b(\d{1,4})\s*[–-]\s*(\d{1,4})\b/g;
const LIST_REGEX = /\b\d{1,4}(?:\s*,\s*\d{1,4})+\b/g;
const AUTHOR_NUMBER_REGEX = /\b([A-Z][a-z]+)\s+(\d{1,4})\b/g;

// Author-year patterns (used in parseAuthorYearCitations)
const SEMICOLON_SEPARATED_YEARS_REGEX = /;\s*[^()]*\d{4}/;
const SEMICOLON_BEFORE_YEAR_REGEX = /\d{4}[a-z]?\s*;/;
const PARENTHESIZED_YEARS_REGEX = /\([^)]*\d{4}[a-z]?[^)]*\)/;
const COMPLEX_PAREN_REGEX = /\(([^()]+(?:\d{4}[a-z]?)[^()]*)\)/g;
const ET_AL_REGEX = /et\s+al\.?/i;

// Pre-compiled author-year patterns using module constants
// These are reconstructed on every extractAuthorYearMatches() call in original code
const ET_AL_OUTSIDE_REGEX = new RegExp(
  `\\b((?:[${AUTHOR_LETTER_UPPER}]\\.(?:\\s*-?[${AUTHOR_LETTER_UPPER}]\\.)*\\s*)?[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+(?:(?:\\s*,\\s*|\\s+and\\s+|\\s*,\\s+and\\s+)(?:[${AUTHOR_LETTER_UPPER}]\\.(?:\\s*-?[${AUTHOR_LETTER_UPPER}]\\.)*\\s*)?[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)*)\\s+et\\s+al\\.?\\s*\\((\\d{4}[a-z]?(?:\\s*,\\s*\\d{4}[a-z]?)*)\\)`,
  "gi",
);

const ET_AL_INCOMPLETE_REGEX = new RegExp(
  `(?:^|[\\s;])([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)\\s+et\\s+al\\.?(?:\\s|\\.|,|;|$)`,
  "gi",
);

const TWO_AUTHORS_INCOMPLETE_REGEX = new RegExp(
  `(?:^|[\\s;])([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)(?:\\s+(?:and|&)\\s+|\\s*,\\s*)([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)(?:\\s|\\.|,|;|$)`,
  "gi",
);

const MULTI_AUTHOR_OUTSIDE_REGEX = new RegExp(
  `\\b([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+(?:(?:\\s*,\\s*|\\s+and\\s+|\\s*,\\s+and\\s+)[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+){2,})\\s*\\((\\d{4}[a-z]?(?:\\s*,\\s*\\d{4}[a-z]?)*)\\)`,
  "gi",
);

const TWO_AUTHORS_REGEX = new RegExp(
  `\\b([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)\\s+(?:and|&)\\s+([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)\\s*\\((\\d{4}[a-z]?(?:\\s*,\\s*\\d{4}[a-z]?)*)\\)`,
  "gi",
);

const SINGLE_AUTHOR_REGEX = new RegExp(
  `\\b([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)\\s*\\((\\d{4}[a-z]?(?:\\s*,\\s*\\d{4}[a-z]?)*)\\)`,
  "gi",
);

const INITIAL_NAME_PATTERN = new RegExp(
  `^((?:[${AUTHOR_LETTER_UPPER}]\\.(?:\\s*-?[${AUTHOR_LETTER_UPPER}]\\.)*\\s*)?)` + // Optional initials
    `((?:(?:van|von|de|der|del|la|le)\\s+)?` + // Optional lowercase prefix (van der, de la, etc.)
    `[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]*` + // First word of surname (capitalized)
    `(?:\\s+[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]*)*)$`, // Optional additional words in compound surname
);

// ─────────────────────────────────────────────────────────────────────────────
// Debug logging control
// Set to false in production for better performance
// ─────────────────────────────────────────────────────────────────────────────
const DEBUG_CITATION_PARSER = false;

/** Conditional debug logging - only logs when DEBUG_CITATION_PARSER is true */
function debugLog(message: string): void {
  if (DEBUG_CITATION_PARSER) {
    ztoolkit.log(message);
  }
}

/**
 * Convert superscript digits to regular digits
 */
function decodeSuperscript(text: string): string {
  return text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (ch) => SUPERSCRIPT_MAP[ch] || ch);
}

/**
 * Fix common OCR errors where brackets are misrecognized as letters.
 * Common patterns:
 * - "[" → "f" or "{"
 * - "]" → "g" or "}"
 * Examples: "f5g" → "[5]", "f26,30g" → "[26,30]"
 */
function fixOCRBrackets(text: string): string {
  // Pattern: f followed by digits/commas/dashes/spaces, then g
  // This matches OCR errors like "f5g", "f26,30g", "f1-5g"
  return text.replace(/\bf([\d,\s–-]+)g\b/g, "[$1]");
}

/**
 * Expand a numeric range (e.g., "1-5") to array ["1", "2", "3", "4", "5"]
 */
function expandRange(start: number, end: number): string[] {
  if (end < start || end - start > 100) {
    // Safety check: don't expand unreasonably large ranges
    return [String(start), String(end)];
  }
  return Array.from({ length: end - start + 1 }, (_, i) => String(start + i));
}

/**
 * FTR-PDF-MATCHING: Try to parse a large number as a concatenated range.
 *
 * This handles cases where PDF copy loses the dash in ranges:
 * - PDF displays: [62-64]
 * - Copied text:  [6264] (dash lost)
 *
 * Algorithm: Try splitting "ABCD" at each position to find valid range:
 * - "6264" → try "6-264", "62-64", "626-4"
 * - Valid if: start < end, both reasonable, small span (≤50)
 *
 * Two modes:
 * 1. Precise mode (maxKnownLabel provided): Only trigger if num > maxKnownLabel
 * 2. Heuristic mode (maxKnownLabel undefined): Only consider 4-digit numbers
 *    where both parts are < 100, handling common cases like "6264" → "62-64"
 *
 * @param label - The numeric label string (e.g., "6264")
 * @param maxKnownLabel - Maximum valid label from PDF parsing (optional)
 * @returns Expanded range labels, or null if not a valid concatenated range
 */
function tryParseAsConcatenatedRange(
  label: string,
  maxKnownLabel?: number,
): string[] | null {
  // Must be all digits
  if (!/^\d+$/.test(label)) return null;

  const num = parseInt(label, 10);
  if (isNaN(num)) return null;

  // Need at least 3 digits to split - 2-digit numbers like "15" should NEVER be treated
  // as concatenated ranges. "15" is always label 15, not "1-5".
  // FTR-CONCAT-FIX: Changed from < 2 to < 3 to prevent "15" → "1-5" bug
  if (label.length < 3) return null;

  // Determine if we have a valid threshold
  const hasValidThreshold = maxKnownLabel !== undefined && maxKnownLabel > 0;

  if (hasValidThreshold) {
    // Precise mode: only trigger if num exceeds maxKnownLabel
    // This is the key heuristic: if PDF has refs 1-79, then "6264" is clearly invalid
    if (num <= maxKnownLabel!) return null;
  } else {
    // Heuristic mode: only consider 4-digit numbers that are clearly too large
    // Common papers have < 100 refs, so 4-digit numbers like "6264" are likely concatenations
    // But we can't be sure about 3-digit numbers, so be conservative
    if (label.length < 4 || num < 1000) return null;
  }

  // Try splitting at each position
  for (let i = 1; i < label.length; i++) {
    const startStr = label.substring(0, i);
    const endStr = label.substring(i);

    // Skip if end part has leading zeros (invalid number format)
    if (endStr.length > 1 && endStr.startsWith("0")) continue;

    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);

    // Validate as a reasonable range:
    // 1. start < end (valid range direction)
    // 2. start >= 1 (valid starting point)
    if (start < 1 || start >= end) continue;

    // 3. end within bounds
    // 4. span not too large (≤50)
    if (hasValidThreshold) {
      // Precise mode: use maxKnownLabel as upper bound
      if (end > maxKnownLabel! || end - start > 50) continue;
    } else {
      // Heuristic mode: conservative bounds
      // Only accept splits where both parts are < 100
      // This handles common cases like "6264" -> "62-64"
      if (start >= 100 || end >= 100 || end - start > 50) continue;
    }

    // Found a valid split! Expand to range
    const expanded = expandRange(start, end);
    return expanded;
  }

  return null;
}

/**
 * Post-process extracted labels to detect concatenated ranges.
 * FTR-PDF-MATCHING: Exported for use in readerIntegration.ts when parseText is used.
 *
 * Now works in two modes:
 * 1. Precise mode (maxKnownLabel provided): Uses threshold for accurate detection
 * 2. Heuristic mode (maxKnownLabel undefined): Conservative detection for 4-digit
 *    numbers where both parts are < 100 (e.g., "6264" → "62-64")
 *
 * @param labels - Array of extracted label strings
 * @param maxKnownLabel - Maximum valid label from PDF (optional)
 * @returns Processed labels with concatenated ranges expanded
 */
export function postProcessLabels(
  labels: string[],
  maxKnownLabel?: number,
): string[] {
  const result: string[] = [];

  for (const label of labels) {
    // Try to parse as concatenated range
    // tryParseAsConcatenatedRange handles the decision logic:
    // - Precise mode if maxKnownLabel is set
    // - Heuristic mode if maxKnownLabel is undefined (4-digit numbers with parts < 100)
    const expanded = tryParseAsConcatenatedRange(label, maxKnownLabel);
    if (expanded) {
      // Add expanded labels (avoiding duplicates)
      for (const exp of expanded) {
        if (!result.includes(exp)) {
          result.push(exp);
        }
      }
      continue;
    }

    // Keep original label
    if (!result.includes(label)) {
      result.push(label);
    }
  }

  return result;
}

/**
 * Parse a mixed citation content like "25,26,29,30,32,33,38–41"
 * Handles both comma-separated numbers and ranges (using - or –)
 */
function parseMixedCitation(content: string): string[] {
  const labels: string[] = [];
  // Split by comma, then check each part for ranges
  const parts = content.split(/\s*,\s*/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check if it's a range (e.g., "38-41" or "38–41")
    const rangeMatch = trimmed.match(/^(\d+)[-–](\d+)$/);
    if (rangeMatch) {
      const expanded = expandRange(
        parseInt(rangeMatch[1], 10),
        parseInt(rangeMatch[2], 10),
      );
      labels.push(...expanded);
    } else if (/^\d+$/.test(trimmed)) {
      // Single number
      labels.push(trimmed);
    } else {
      // Handle superscript/letter-attached numbers like "as18" or "term89–91"
      const supers = detectSuperscriptStyleCitations(trimmed);
      if (supers.length > 0) {
        labels.push(...supers);
      }
    }
  }

  return labels;
}

/**
 * Detect Nature/Science superscript style citations in text.
 *
 * These journals use superscript numbers without brackets: "factors72" "term89–91" "factors84,86"
 * When copied from PDF, superscripts become regular digits attached to words.
 *
 * Pattern: word (ending with letter) followed immediately by citation numbers
 * - Matches: "factors72", "term89–91", "factors84,86", "the72,73"
 * - Excludes: numbers > 500 (too large for most reference lists)
 * - Excludes: years (1900-2099)
 *
 * @param text - The text to scan for superscript-style citations
 * @returns Array of citation labels found
 */
function detectSuperscriptStyleCitations(text: string): string[] {
  const labels: string[] = [];

  // Pattern: letter followed immediately by citation number(s)
  // Captures the number part including ranges and comma-separated lists
  // Examples: "s72" from "factors72", "m89–91" from "term89–91", "s84,86" from "factors84,86"
  const superscriptStyleRegex =
    /[a-zA-Z](\d{1,3}(?:[–,-]\d{1,3})*(?:,\d{1,3}(?:[–,-]\d{1,3})*)*)/g;

  let match;
  while ((match = superscriptStyleRegex.exec(text)) !== null) {
    const citationPart = match[1]; // e.g., "72" or "89–91" or "84,86"
    const citationLabels = parseMixedCitation(citationPart);

    for (const label of citationLabels) {
      const num = parseInt(label, 10);
      // Skip years and out-of-range numbers
      // Use stricter range (1-500) for superscript style to avoid false positives
      if (num >= 1 && num <= 500 && !(num >= 1900 && num <= 2099)) {
        if (!labels.includes(label)) {
          labels.push(label);
        }
      }
    }
  }

  return labels;
}

/**
 * Excluded prefixes for fuzzy citation detection.
 * These are common document structure terms that should NOT be treated as author names
 * in author-number patterns (e.g., "Figure 1", "Section 2").
 * Defined at module level to avoid recreation on each parseSelection() call.
 */
const EXCLUDED_PREFIXES = new Set([
  // Sections & chapters
  "section",
  "sections",
  "sec",
  "sect",
  "secs",
  "sects",
  "chapter",
  "chapters",
  "chap",
  "chaps",
  "ch",
  // Figures & tables
  "figure",
  "figures",
  "fig",
  "figs",
  "table",
  "tables",
  "tab",
  "tabs",
  "tbl",
  "tbls",
  // Equations & formulas (including patterns like "Eq. (35)")
  "equation",
  "equations",
  "eq",
  "eqs",
  "eqn",
  "eqns",
  "formula",
  "formulas",
  "formulae",
  // Note: "Eq." pattern is also handled by parentheses check below
  // Pages & lines
  "page",
  "pages",
  "pg",
  "pgs",
  "pp",
  "line",
  "lines",
  "ln",
  "lns",
  // Appendices & parts
  "appendix",
  "appendices",
  "app",
  "apps",
  "part",
  "parts",
  "pt",
  "pts",
  // Theorems & proofs (math papers)
  "theorem",
  "theorems",
  "thm",
  "thms",
  "lemma",
  "lemmas",
  "lem",
  "lems",
  "corollary",
  "corollaries",
  "cor",
  "cors",
  "proposition",
  "propositions",
  "prop",
  "props",
  "definition",
  "definitions",
  "def",
  "defs",
  "proof",
  "proofs",
  "pf",
  "pfs",
  "remark",
  "remarks",
  "rem",
  "rems",
  // Examples & exercises
  "example",
  "examples",
  "ex",
  "exs",
  "exercise",
  "exercises",
  "problem",
  "problems",
  "prob",
  "probs",
  "solution",
  "solutions",
  "sol",
  "sols",
  // Other document elements
  "note",
  "notes",
  "case",
  "cases",
  "item",
  "items",
  "step",
  "steps",
  "column",
  "columns",
  "col",
  "cols",
  "row",
  "rows",
  "entry",
  "entries",
  "index",
  "indices",
  // Numbering & references
  "number",
  "numbers",
  "num",
  "nums",
  "no",
  "nos",
  "version",
  "versions",
  "ver",
  "vers",
  "volume",
  "volumes",
  "vol",
  "vols",
  "issue",
  "issues",
  "iss",
  // Time & dates
  "year",
  "years",
  "yr",
  "yrs",
  "day",
  "days",
  "month",
  "months",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  // Physics-specific
  "run",
  "runs", // "Run 2" at LHC
  "beam",
  "beams",
  "event",
  "events",
  "sample",
  "samples",
  "generation",
  "generations",
  "gen",
  "gens", // particle generations
  "order",
  "orders",
  "ord", // perturbative orders
  "loop",
  "loops", // loop orders in QFT
  "level",
  "levels",
  "lev",
  "lvl",
  "tier",
  "tiers",
  "phase",
  "phases",
  "stage",
  "stages",
  "class",
  "classes",
  "type",
  "types",
  "category",
  "categories",
  "cat",
  "cats",
  "group",
  "groups",
  "grp",
  "grps",
  "set",
  "sets",
  "series",
  "mode",
  "modes",
  "channel",
  "channels",
  "chan",
  "bin",
  "bins", // histogram bins
  "point",
  "points",
  "pt",
  "pts", // data points (pt already added)
  "degree",
  "degrees",
  "deg",
  "dimension",
  "dimensions",
  "dim",
  "dims",
  "component",
  "components",
  "comp",
  "parameter",
  "parameters",
  "param",
  "params",
  "model",
  "models",
  "scenario",
  "scenarios",
  "configuration",
  "configurations",
  "config",
  "configs",
  "option",
  "options",
  "opt",
  "opts",
  "method",
  "methods",
  "approach",
  "approaches",
  "scheme",
  "schemes",
  "algorithm",
  "algorithms",
  "algo",
  "alg",
]);

/**
 * Citation parser for detecting and extracting citation markers from text.
 * Supports various formats common in HEP papers.
 */
export class CitationParser {
  private patterns: PatternDef[];

  constructor() {
    this.patterns = [
      // [1] - single numeric
      {
        regex: /\[(\d+)\]/g,
        type: "numeric",
        extractLabels: (m) => [m[1]],
      },
      // Mixed format: [1,2,5-8,10] - comma-separated with optional ranges
      // This pattern is more general and should match before simpler patterns
      {
        regex: /\[([\d,\s–-]+)\]/g,
        type: "numeric",
        extractLabels: (m) => parseMixedCitation(m[1]),
      },
      // [1-5] or [1–5] - simple range (kept for backwards compatibility)
      {
        regex: /\[(\d+)[-–](\d+)\]/g,
        type: "numeric",
        extractLabels: (m) =>
          expandRange(parseInt(m[1], 10), parseInt(m[2], 10)),
      },
      // Superscript digits: ¹²³ (single reference) or ¹·²·³ / ¹,²,³ (multiple)
      // Note: consecutive superscripts like ¹²³ are treated as single reference [123]
      // Separated superscripts like ¹·² or ¹,² are multiple references [1, 2]
      {
        regex: /([⁰¹²³⁴⁵⁶⁷⁸⁹]+(?:[·,\s][⁰¹²³⁴⁵⁶⁷⁸⁹]+)*)/g,
        type: "numeric",
        extractLabels: (m) => {
          const text = m[1];
          // Check if there are separators (·, comma, space between superscripts)
          if (/[·,\s]/.test(text)) {
            // Multiple references separated by ·, comma, or space
            return text
              .split(/[·,\s]+/)
              .map((part) => decodeSuperscript(part))
              .filter(Boolean);
          }
          // Single consecutive superscript sequence = single reference number
          const decoded = decodeSuperscript(text);
          return [decoded];
        },
      },
      // [Author Year] - author-year style
      {
        regex: /\[([A-Z][a-z]+(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)\]/gi,
        type: "author-year",
        extractLabels: (m) => [m[1]],
      },
      // [W95] or [WGR17] - abbreviated author
      {
        regex: /\[([A-Z]+\d{2,4})\]/g,
        type: "author-year",
        extractLabels: (m) => [m[1]],
      },
      // [arXiv:2301.12345] or [hep-th/9802109]
      {
        regex: /\[(?:arXiv:)?(\d{4}\.\d{4,5})\]/gi,
        type: "arxiv",
        extractLabels: (m) => [m[1]],
      },
      {
        regex:
          /\[((?:hep-[a-z]+|astro-ph|gr-qc|nucl-[a-z]+|cond-mat|quant-ph)\/\d+)\]/gi,
        type: "arxiv",
        extractLabels: (m) => [m[1]],
      },
    ];
  }

  /**
   * Parse all citation markers from text.
   * Returns unique citations (deduped by raw text).
   */
  parseText(text: string): ParsedCitation[] {
    const seen = new Set<string>();
    const citations: ParsedCitation[] = [];

    for (const patternDef of this.patterns) {
      // Reset regex lastIndex for each run
      patternDef.regex.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = patternDef.regex.exec(text)) !== null) {
        const raw = match[0];

        // Dedupe by raw text
        if (seen.has(raw)) {
          continue;
        }
        seen.add(raw);

        citations.push({
          raw,
          type: patternDef.type,
          labels: patternDef.extractLabels(match),
          position: null,
        });
      }
    }

    return citations;
  }

  /**
   * Check if text appears to contain citation markers.
   * Quick check without full parsing.
   */
  hasCitations(text: string): boolean {
    // Quick pattern check
    return (
      /\[\d+\]/.test(text) ||
      /\[\d+[-–]\d+\]/.test(text) ||
      /\[\d+(?:\s*,\s*\d+)+\]/.test(text) ||
      /[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(text) ||
      /\[[A-Z][a-z]+\s+\d{4}\]/.test(text) ||
      /\[(?:arXiv:)?\d{4}\.\d{4,5}\]/i.test(text)
    );
  }

  /**
   * Parse a simple selection that might be just "[1]" or "1".
   * More lenient than parseText for direct user selections.
   *
   * @param selection - The selected text
   * @param enableFuzzy - Enable aggressive/fuzzy matching for broken PDF text layers
   *                      (e.g., when brackets are truncated). Default: false
   * @param maxKnownLabel - Maximum valid label from PDF parsing (optional).
   *                        Used to detect concatenated ranges where dash is lost
   *                        (e.g., [62-64] copied as [6264])
   * @param preferAuthorYear - When true, prioritize author-year detection over numeric.
   *                           Used when document format is known to be author-year style.
   */
  parseSelection(
    selection: string,
    enableFuzzy = false,
    maxKnownLabel?: number,
    preferAuthorYear = false,
  ): ParsedCitation | null {
    // Clean up selection: trim whitespace
    let trimmed = selection.trim();

    // DEBUG: Log raw input to understand what we're parsing
    debugLog(
      `[PDF-ANNOTATE] parseSelection raw input (${selection.length} chars): "${selection.slice(0, 150)}..."`,
    );
    debugLog(
      `[PDF-ANNOTATE] parseSelection trimmed (${trimmed.length} chars): "${trimmed.slice(0, 150)}..."`,
    );

    // FTR-PDF-ANNOTATE-MULTI-LABEL: Fix OCR bracket errors (f5g → [5], f26,30g → [26,30])
    const ocrFixed = fixOCRBrackets(trimmed);
    if (ocrFixed !== trimmed) {
      debugLog(`[PDF-ANNOTATE] OCR bracket fix: "${trimmed}" → "${ocrFixed}"`);
      trimmed = ocrFixed;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FTR-CITATION-FORMAT-DETECT: When document is known to be author-year format,
    // prioritize author-year detection BEFORE numeric bracket detection.
    // This prevents "Author et al. (2017)" being missed in favor of stray [xxx] patterns.
    // ─────────────────────────────────────────────────────────────────────────
    if (preferAuthorYear) {
      debugLog(
        `[PDF-ANNOTATE] preferAuthorYear=true, trying author-year detection first`,
      );
      const authorYearResult = this.parseAuthorYearCitation(trimmed);
      if (authorYearResult) {
        debugLog(
          `[PDF-ANNOTATE] Author-year citation detected (priority): "${authorYearResult.raw}"`,
        );
        return authorYearResult;
      }
      debugLog(
        `[PDF-ANNOTATE] No author-year citation found, falling back to numeric detection`,
      );
    }

    // Smart cleanup: try to find [xxx] pattern ANYWHERE in the text first
    // This handles cases like "SS [25,26,29]." or "text [1,2,3] more text"
    // FTR-PDF-ANNOTATE-MULTI-LABEL: Collect ALL numeric bracket matches, not just the last one
    // This handles cases like "[7] and [9]" -> should return both labels [7, 9]
    const allBracketMatches = [...trimmed.matchAll(/\[([^[\]]+)\]/g)];
    debugLog(
      `[PDF-ANNOTATE] allBracketMatches count: ${allBracketMatches.length}`,
    );
    for (const m of allBracketMatches) {
      debugLog(
        `[PDF-ANNOTATE]   bracket match: "[${m[1]}]" at index ${m.index}`,
      );
    }
    if (allBracketMatches.length > 0) {
      // FTR-PDF-ANNOTATE-MULTI-LABEL: Collect ALL labels from ALL numeric bracket matches
      const allCollectedLabels: string[] = [];
      for (const match of allBracketMatches) {
        const content = match[1];
        // Check if content looks like a numeric citation (digits, commas, dashes)
        if (/^[\d,\s–-]+$/.test(content)) {
          const matchLabels = parseMixedCitation(content);
          for (const label of matchLabels) {
            if (!allCollectedLabels.includes(label)) {
              allCollectedLabels.push(label);
            }
          }
        }
      }

      debugLog(
        `[PDF-ANNOTATE] Collected labels from bracket matches: [${allCollectedLabels.join(",")}]`,
      );

      if (allCollectedLabels.length > 0) {
        // FTR-PDF-MATCHING: Post-process to detect concatenated ranges
        const processedLabels = postProcessLabels(
          allCollectedLabels,
          maxKnownLabel,
        );
        return {
          raw: processedLabels.map((l) => `[${l}]`).join(","),
          type: "numeric",
          labels: processedLabels,
          position: null,
        };
      }

      // If no numeric matches from brackets, DON'T return early - continue to author-year detection
      // This allows text like "see [some note] and Guo et al. (2011)" to still find the author-year citation
      debugLog(
        `[PDF-ANNOTATE] No numeric bracket matches, continuing to author-year detection`,
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Author-year citation format detection (e.g., "Author et al. (2017)")
    // Common in journals like Rev. Mod. Phys.
    // IMPORTANT: Check BEFORE stripping parentheses to preserve (Author, Year) format
    // ─────────────────────────────────────────────────────────────────────────
    const authorYearResult = this.parseAuthorYearCitation(trimmed);
    if (authorYearResult) {
      debugLog(
        `[PDF-ANNOTATE] Author-year citation detected: "${authorYearResult.raw}"`,
      );
      return authorYearResult;
    }

    // No complete [xxx] found - try cleaning up and parsing
    // Remove common trailing punctuation that might be accidentally selected
    // But be careful not to remove ] if there's an unclosed [
    const hasUnclosedBracket =
      (trimmed.match(/\[/g) || []).length > (trimmed.match(/\]/g) || []).length;
    if (hasUnclosedBracket) {
      // Don't strip ] from the end - it might be the closing bracket we need
      trimmed = trimmed.replace(/[.,;:!?)]+$/, "");
    } else {
      trimmed = trimmed.replace(/[.,;:!?)\]]+$/, "");
    }
    // Also remove leading punctuation
    trimmed = trimmed.replace(/^[([]+/, "");

    // Re-add brackets if they were stripped but content looks like citation
    if (/^[\d,\s–-]+$/.test(trimmed)) {
      // Content is just numbers, commas, and dashes - try parsing as-is first
      const labels = parseMixedCitation(trimmed);
      if (labels.length > 0) {
        return {
          raw: `[${trimmed}]`,
          type: "numeric",
          labels,
          position: null,
        };
      }
    }

    // First try normal parsing (for explicit bracket patterns like [20])
    const parsed = this.parseText(trimmed);

    // Debug: log all parsed results to understand detection order
    if (parsed.length > 0) {
      debugLog(`[PDF-ANNOTATE] parseText found ${parsed.length} result(s):`);
      for (let i = 0; i < parsed.length; i++) {
        debugLog(
          `[PDF-ANNOTATE]   [${i}] raw="${parsed[i].raw}", labels=[${parsed[i].labels.join(",")}]`,
        );
      }
    }

    if (parsed.length > 0) {
      // Collect ALL labels from ALL parsed results that appear in visible text
      // This handles cases where selection contains multiple citations like [15] and [20]
      const allVisibleLabels: string[] = [];
      for (const result of parsed) {
        for (const label of result.labels) {
          // Check if label appears as [n] or just as standalone number
          const bracketPattern = new RegExp(`\\[${label}\\]`);
          const standalonePattern = new RegExp(`\\b${label}\\b`);
          const inBracket = bracketPattern.test(trimmed);
          const standalone = standalonePattern.test(trimmed);
          debugLog(
            `[PDF-ANNOTATE]   checking label "${label}": inBracket=${inBracket}, standalone=${standalone}`,
          );
          if (inBracket || standalone) {
            if (!allVisibleLabels.includes(label)) {
              allVisibleLabels.push(label);
            }
          }
        }
      }
      debugLog(
        `[PDF-ANNOTATE] allVisibleLabels: [${allVisibleLabels.join(",")}]`,
      );
      if (allVisibleLabels.length > 0) {
        // FTR-PDF-MATCHING: Post-process to detect concatenated ranges
        const processedLabels = postProcessLabels(
          allVisibleLabels,
          maxKnownLabel,
        );
        return {
          raw: processedLabels.map((l) => `[${l}]`).join(","),
          type: "numeric",
          labels: processedLabels,
          position: null,
        };
      }
      // If no visible label, continue to other detection methods
    }

    // Try bare number (user selected "1" without brackets)
    const bareNumber = trimmed.match(/^(\d+)$/);
    if (bareNumber) {
      // FTR-PDF-MATCHING: Post-process to detect concatenated ranges
      const processedLabels = postProcessLabels([bareNumber[1]], maxKnownLabel);
      return {
        raw: trimmed,
        type: "numeric",
        labels: processedLabels,
        position: null,
      };
    }

    // Try bare range "1-5" without brackets
    const bareRange = trimmed.match(/^(\d+)[-–](\d+)$/);
    if (bareRange) {
      const rangeLabels = expandRange(
        parseInt(bareRange[1], 10),
        parseInt(bareRange[2], 10),
      );
      return {
        raw: trimmed,
        type: "numeric",
        labels: rangeLabels,
        position: null,
      };
    }

    // Try mixed format without brackets "1,2,5-8"
    // DEBUG: Log the trimmed text to understand what's being parsed
    debugLog(
      `[PDF-ANNOTATE] parseMixedCitation input (first 200 chars): "${trimmed.slice(0, 200)}"`,
    );
    const mixedLabels = parseMixedCitation(trimmed);
    debugLog(
      `[PDF-ANNOTATE] parseMixedCitation result: [${mixedLabels.join(",")}]`,
    );
    if (mixedLabels.length > 0) {
      // FTR-PDF-MATCHING: Post-process to detect concatenated ranges
      const processedLabels = postProcessLabels(mixedLabels, maxKnownLabel);
      return {
        raw: trimmed,
        type: "numeric",
        labels: processedLabels,
        position: null,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nature/Science superscript style citations (non-fuzzy detection)
    // These journals use superscript numbers without brackets: "factors72" "term89–91"
    // When copied, superscripts become regular digits attached to words.
    // Pattern: word ending with letter followed immediately by citation numbers
    // This is NOT fuzzy - it's a distinct citation style used by major journals
    // ─────────────────────────────────────────────────────────────────────────
    const superscriptStyleLabels = detectSuperscriptStyleCitations(trimmed);
    if (superscriptStyleLabels.length > 0) {
      debugLog(
        `[PDF-ANNOTATE] Superscript style citations detected: [${superscriptStyleLabels.join(",")}]`,
      );
      const processedLabels = postProcessLabels(
        superscriptStyleLabels,
        maxKnownLabel,
      );
      return {
        raw: trimmed,
        type: "numeric",
        labels: processedLabels,
        position: null,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzzy matching: Extract citation numbers from mixed text
    // Handles cases like "t. Bali 19 rep" where brackets are truncated
    // Only enabled when enableFuzzy is true (user preference)
    //
    // DESIGN: Check explicit patterns first, then apply exclusion rules
    // for the standalone number fallback only.
    // ─────────────────────────────────────────────────────────────────────────

    if (!enableFuzzy) {
      return null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRE-CHECK: Exclude document structure references
    // These patterns indicate the text is NOT a citation reference
    // ═══════════════════════════════════════════════════════════════════════

    // Pattern: "Fig. 1", "Figure 1,2", "Figs. 1-3", "Tab. 1", "Table 2", etc.
    // If the ENTIRE selection looks like a document reference, skip fuzzy detection
    // Document reference patterns: Fig(s)., Tab(s)., Eq(s)., Sec(s)., etc.
    if (DOC_REF_PATTERN.test(trimmed)) {
      debugLog(
        `[PDF-ANNOTATE] Skipping fuzzy: entire text is document reference`,
      );
      return null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // COLLECT ALL MATCHES from multiple patterns (don't return early!)
    // This ensures we detect both "Ref. 15" AND "suppressed 20" in same text
    // ═══════════════════════════════════════════════════════════════════════
    const allFuzzyLabels: string[] = [];

    // Track numbers that are part of document references (to exclude later)
    const docRefNumbers = new Set<string>();

    // Find all document reference patterns and mark their numbers as excluded
    // Same patterns for inline detection within mixed text
    let docMatch;
    while ((docMatch = DOC_REF_INLINE_PATTERN.exec(trimmed)) !== null) {
      const nums = docMatch[2].match(/\d+/g) || [];
      for (const n of nums) {
        docRefNumbers.add(n);
        debugLog(
          `[PDF-ANNOTATE] Excluding "${docMatch[1]}. ${n}" as document reference`,
        );
      }
    }

    // Pattern 0: Numeric ranges without brackets (e.g., "12–19") inside OCR text
    // Treated as explicit patterns so exclusion rules are relaxed
    let rangeMatch;
    while ((rangeMatch = RANGE_REGEX.exec(trimmed)) !== null) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 1 &&
        end >= start &&
        end <= 1499
      ) {
        const expanded = expandRange(start, end);
        for (const label of expanded) {
          if (!docRefNumbers.has(label) && !allFuzzyLabels.includes(label)) {
            allFuzzyLabels.push(label);
          }
        }
        debugLog(
          `[PDF-ANNOTATE] Fuzzy Pattern 0 (Range): found ${start}–${end} -> [${expanded.join(",")}]`,
        );
      }
    }

    // Pattern 0b: Comma-separated numbers without brackets (e.g., "10,11")
    // Treated as explicit to relax exclusion rules; ignore years and doc refs
    let listMatch;
    while ((listMatch = LIST_REGEX.exec(trimmed)) !== null) {
      const nums = (listMatch[0].match(/\d{1,4}/g) || [])
        .map((n) => parseInt(n, 10))
        .filter((n) => n >= 1 && n <= 1499 && !(n >= 1900 && n <= 2099));
      if (nums.length === 0) continue;
      for (const n of nums) {
        const label = String(n);
        if (!docRefNumbers.has(label) && !allFuzzyLabels.includes(label)) {
          allFuzzyLabels.push(label);
        }
      }
      debugLog(
        `[PDF-ANNOTATE] Fuzzy Pattern 0b (List): found [${nums.join(",")}]`,
      );
    }

    // Note: Pattern 0c (Nature/Science superscript style) is now handled in non-fuzzy detection
    // See detectSuperscriptStyleCitations() function called before fuzzy section

    // Pattern 1: Explicit reference markers (e.g., "Ref. 19", "Refs. 22,23")
    const refMarkerMatch = trimmed.match(/\brefs?\.?\s*([\d,\s–-]+)/i);
    if (refMarkerMatch) {
      const refLabels = parseMixedCitation(refMarkerMatch[1]);
      for (const label of refLabels) {
        if (!allFuzzyLabels.includes(label)) {
          allFuzzyLabels.push(label);
        }
      }
      debugLog(
        `[PDF-ANNOTATE] Fuzzy Pattern 1 (Ref markers): found [${refLabels.join(",")}]`,
      );
    }

    // Pattern 2: Find ALL author-number patterns (e.g., "Godfrey 17 and ... Fazio 18")
    // Uses module-level EXCLUDED_PREFIXES to avoid recreation on each call
    let authorMatch;
    while ((authorMatch = AUTHOR_NUMBER_REGEX.exec(trimmed)) !== null) {
      const prefix = authorMatch[1].toLowerCase();
      // Skip if prefix is a common document structure term
      if (!EXCLUDED_PREFIXES.has(prefix)) {
        const num = parseInt(authorMatch[2], 10);
        // Sanity check: typical citation numbers are 1-1499
        if (num >= 1 && num <= 1499) {
          if (!allFuzzyLabels.includes(authorMatch[2])) {
            allFuzzyLabels.push(authorMatch[2]);
            debugLog(
              `[PDF-ANNOTATE] Fuzzy Pattern 2 (Author-number): found "${authorMatch[1]} ${authorMatch[2]}"`,
            );
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EXCLUSION RULES (apply only when we have NO explicit patterns yet)
    // If we already found explicit references (Ref. X, Author Y), we should
    // still try to find standalone numbers - they're likely citations too
    // ═══════════════════════════════════════════════════════════════════════

    const hasExplicitPatterns = allFuzzyLabels.length > 0;
    let skipStandaloneDetection = false;

    // Only apply strict exclusion rules if we have NO explicit patterns
    if (!hasExplicitPatterns) {
      // Rule 1: Parentheses - citations use [], not ()
      if (/[()]/.test(trimmed)) {
        skipStandaloneDetection = true;
        debugLog(
          `[PDF-ANNOTATE] Exclusion Rule 1: parentheses found, skipping standalone detection`,
        );
      }

      // Rule 2: Mathematical operators/context
      if (!skipStandaloneDetection && /[=+*/^~]/.test(trimmed)) {
        skipStandaloneDetection = true;
        debugLog(
          `[PDF-ANNOTATE] Exclusion Rule 2: math operators found, skipping standalone detection`,
        );
      }
      // Hyphen/minus: only exclude if it's mathematical (before digit or between digits)
      if (!skipStandaloneDetection && /\d\s*-\s*\d|-\s*\d/.test(trimmed)) {
        skipStandaloneDetection = true;
        debugLog(
          `[PDF-ANNOTATE] Exclusion Rule 2b: math hyphen found, skipping standalone detection`,
        );
      }

      // Rule 3: Greek letters (formula context)
      if (
        !skipStandaloneDetection &&
        /[αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ]/.test(trimmed)
      ) {
        skipStandaloneDetection = true;
        debugLog(
          `[PDF-ANNOTATE] Exclusion Rule 3: Greek letters found, skipping standalone detection`,
        );
      }

      // Rule 4: Multiple standalone numbers (data context, e.g., "1267 53 candidates")
      if (!skipStandaloneDetection) {
        const numberMatches = trimmed.match(/\b\d+\b/g) || [];
        const nonYearNumbers = numberMatches.filter((n) => {
          const num = parseInt(n, 10);
          return !(num >= 1900 && num <= 2099); // Exclude years
        });
        if (nonYearNumbers.length >= 2) {
          skipStandaloneDetection = true;
          debugLog(
            `[PDF-ANNOTATE] Exclusion Rule 4: multiple numbers found (${nonYearNumbers.join(",")}), skipping standalone detection`,
          );
        }
      }
    } else {
      debugLog(
        `[PDF-ANNOTATE] Has explicit patterns [${allFuzzyLabels.join(",")}], relaxing exclusion rules`,
      );
    }

    // Pattern 3: Standalone numbers
    // - If no exclusion rules triggered: find first standalone number
    // - If has explicit patterns: find ALL standalone numbers (relaxed mode)
    // - Always skip numbers that are part of document references (Fig. 1, etc.)
    if (!skipStandaloneDetection) {
      if (hasExplicitPatterns) {
        // Relaxed mode: find ALL standalone 1-4 digit numbers (up to 1499)
        const standaloneRegex = /\b(\d{1,4})\b/g;
        let standaloneMatch;
        while ((standaloneMatch = standaloneRegex.exec(trimmed)) !== null) {
          const num = parseInt(standaloneMatch[1], 10);
          // Skip numbers that are likely not citations:
          // - Years (1900-2099)
          // - Numbers in parentheses context (already handled by extraction)
          // - Very large numbers (>1499)
          // - Numbers that are part of document references (Fig. 1, etc.)
          if (num >= 1 && num <= 1499 && !(num >= 1900 && num <= 2099)) {
            if (
              !docRefNumbers.has(standaloneMatch[1]) &&
              !allFuzzyLabels.includes(standaloneMatch[1])
            ) {
              allFuzzyLabels.push(standaloneMatch[1]);
              debugLog(
                `[PDF-ANNOTATE] Fuzzy Pattern 3 (Standalone, relaxed): found "${standaloneMatch[1]}"`,
              );
            } else if (docRefNumbers.has(standaloneMatch[1])) {
              debugLog(
                `[PDF-ANNOTATE] Fuzzy Pattern 3: skipping "${standaloneMatch[1]}" (document reference)`,
              );
            }
          }
        }
      } else {
        // Strict mode: find only the first standalone number (that's not a doc ref)
        const standaloneRegex = /\b(\d{1,4})\b/g;
        let standaloneMatch;
        while ((standaloneMatch = standaloneRegex.exec(trimmed)) !== null) {
          const num = parseInt(standaloneMatch[1], 10);
          if (
            num >= 1 &&
            num <= 1499 &&
            !docRefNumbers.has(standaloneMatch[1])
          ) {
            if (!allFuzzyLabels.includes(standaloneMatch[1])) {
              allFuzzyLabels.push(standaloneMatch[1]);
              debugLog(
                `[PDF-ANNOTATE] Fuzzy Pattern 3 (Standalone): found "${standaloneMatch[1]}"`,
              );
              break; // Only first in strict mode
            }
          }
        }
      }
    }

    // Return all collected labels (from Ref markers, author-number, and standalone)
    if (allFuzzyLabels.length > 0) {
      debugLog(
        `[PDF-ANNOTATE] Fuzzy detection final result: [${allFuzzyLabels.join(",")}]`,
      );
      // FTR-PDF-MATCHING: Post-process to detect concatenated ranges
      const processedLabels = postProcessLabels(allFuzzyLabels, maxKnownLabel);
      return {
        raw: `[${processedLabels.join(",")}]`,
        type: "numeric",
        labels: processedLabels,
        position: null,
      };
    }

    return null;
  }

  /**
   * Parse author-year citation format common in journals like Rev. Mod. Phys.
   *
   * Supported formats:
   * - "(Author, YYYY)" - single author in parentheses
   * - "(Author and Author, YYYY)" - two authors in parentheses
   * - "(Author, Author, and Author, YYYY)" - multiple authors in parentheses
   * - "(Author et al., YYYY)" - et al. format in parentheses
   * - "Author et al. (YYYY)" - et al. with year in parentheses
   * - "Author (YYYY)" - single author with year in parentheses
   * - Year suffixes: 2017a, 2017b, etc. for same author/year disambiguation
   *
   * Key rule: Year must be either:
   * - Inside parentheses: (Author, 2017) or (2017)
   * - Following "et al." with parentheses: et al. (2017)
   * - Preceded by comma inside parentheses: Author, 2017
   *
   * Complex RMP patterns (Rev. Mod. Phys.):
   * - Same author multiple years: "(Cho et al., 2011a, 2011b)" → 2 citations
   * - Semicolon separated: "(A et al., 2011; B et al., 2015)" → multiple citations
   * - Consecutive years: "Bignamini et al. (2009, 2010)" → 2 citations
   * - Multi-author outside paren: "Larionov, Strikman, and Bleicher (2015)"
   *
   * Returns a ParsedCitation with type "author-year" and labels containing
   * normalized author-year information for matching.
   */
  private parseAuthorYearCitation(text: string): ParsedCitation | null {
    // Normalize combining marks and fix broken composed characters (e.g., "L ̈u" -> "Lü")
    const cleanedText = text
      // Move combining mark onto the following base if it sits between letters (L ̈u -> Lü)
      .replace(/([A-Za-z])\s+([\u0300-\u036f])\s*([A-Za-z])/g, "$1$3$2")
      // Fallback: collapse gaps between letter and combining mark
      .replace(/([A-Za-z])\s+([\u0300-\u036f])/g, "$1$2");
    const normalizedText = cleanedText.normalize("NFC");
    text = normalizedText;

    const matches: Array<{
      full: string;
      authors: string[];
      year: string;
      isEtAl: boolean;
      authorInitials?: string[];
    }> = [];

    // Preprocess: If text has unbalanced parentheses, try to fix them
    // This handles cases like "des (Author, 2004; Author, 2005" where closing paren is missing
    let processedText = text;
    const openParens = (text.match(/\(/g) || []).length;
    const closeParens = (text.match(/\)/g) || []).length;
    if (openParens > closeParens) {
      // Add missing closing parentheses at the end
      processedText = text + ")".repeat(openParens - closeParens);
      debugLog(
        `[PDF-ANNOTATE] parseAuthorYearCitation: added ${openParens - closeParens} closing paren(s) to fix unbalanced text`,
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Pattern 0a: Semicolon-separated citations WITHOUT parentheses
    // Handles: "Ding, 2009; G. Li and Liu, 2013; M.-T. Li et al., 2013;"
    // This is common when selecting multiple author-year citations from RMP papers
    // ═══════════════════════════════════════════════════════════════════════════
    // Check if text contains semicolon-separated year patterns but NO parentheses around years
    // Key distinction: "(Cho et al., 2011; Song et al., 2015)" has enclosing parentheses,
    // while "Ding, 2009; G. Li and Liu, 2013;" has no enclosing parentheses
    const hasSemicolonSeparatedYears =
      SEMICOLON_SEPARATED_YEARS_REGEX.test(text) ||
      SEMICOLON_BEFORE_YEAR_REGEX.test(text);
    // Check for enclosing parentheses that wrap the citation(s)
    const trimmedText = text.trim();
    const hasEnclosingParens =
      trimmedText.startsWith("(") && trimmedText.includes(")");
    // Check for "(Author, Year)" or "(Author et al., Year)" pattern - year is inside parens
    const hasParenthesizedYears = PARENTHESIZED_YEARS_REGEX.test(text);

    if (hasSemicolonSeparatedYears && !hasParenthesizedYears) {
      debugLog(
        `[PDF-ANNOTATE] parseAuthorYearCitation: detected semicolon-separated citations without parentheses`,
      );
      // Split by semicolon and parse each part
      const parts = text.split(/\s*;\s*/);
      for (const part of parts) {
        // Strip leading/trailing parentheses and whitespace
        // Handles cases like "(Kubarovsky and Voloshin, 2015, 2016;" where opening paren is included
        const trimmedPart = part
          .trim()
          .replace(/^[(]+|[)]+$/g, "")
          .trim();
        if (!trimmedPart || !/\d{4}/.test(trimmedPart)) continue;

        const parsed = this.parseAuthorYearGroup(trimmedPart);
        for (const p of parsed) {
          // Check for duplicate - must consider initials for disambiguation
          // "G. Li, 2013" and "M.-T. Li et al., 2013" are DIFFERENT citations
          const isDuplicate = matches.some((m) => {
            // Same first author and year
            if (m.authors[0] !== p.authors[0] || m.year !== p.year)
              return false;
            // If both have initials, compare them
            const mInitial = m.authorInitials?.[0];
            const pInitial = p.authorInitials?.[0];
            if (mInitial && pInitial) {
              return mInitial === pInitial; // Same initials = duplicate
            }
            // If one has initials and other doesn't, they're different
            if (mInitial || pInitial) return false;
            // Neither has initials - check if isEtAl differs
            if (m.isEtAl !== p.isEtAl) return false;
            // Otherwise consider duplicate
            return true;
          });
          if (!isDuplicate) {
            matches.push({ ...p, full: trimmedPart });
            debugLog(
              `[PDF-ANNOTATE] Author-year Pattern 0a match: "${p.authors.join(", ")} (${p.year})" from "${trimmedPart}", initials=[${p.authorInitials?.join(",") || ""}]`,
            );
          }
        }
      }

      // If we found matches with Pattern 0a, return early (don't continue with other patterns)
      if (matches.length > 0) {
        return this.buildAuthorYearResult(matches);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Pattern 0: Complex parenthesized citations with semicolons and multiple years
    // Handles: (Cho et al., 2011a, 2011b; Cho, Song, and Lee, 2015)
    // ═══════════════════════════════════════════════════════════════════════════
    let complexMatch;
    COMPLEX_PAREN_REGEX.lastIndex = 0;
    while ((complexMatch = COMPLEX_PAREN_REGEX.exec(processedText)) !== null) {
      const content = complexMatch[0];
      const inner = complexMatch[1];

      // Check if this looks like a citation (contains year pattern)
      if (!/\d{4}[a-z]?/.test(inner)) continue;

      // Skip if it looks like a numeric citation or equation
      if (/^\s*\d+\s*$/.test(inner) || /[=+*/^]/.test(inner)) continue;

      // Split by semicolon first (separate citation groups)
      const groups = inner.split(/\s*;\s*/);

      for (const group of groups) {
        const trimmedGroup = group.trim();

        const parsed = this.parseAuthorYearGroup(trimmedGroup);
        for (const p of parsed) {
          // Check for duplicate
          if (
            !matches.some(
              (m) => m.authors[0] === p.authors[0] && m.year === p.year,
            )
          ) {
            matches.push({ ...p, full: content });
            debugLog(
              `[PDF-ANNOTATE] Author-year Pattern 0 match: "${p.authors.join(", ")} (${p.year})" from "${group}"`,
            );
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Pattern 1: "Author et al. (YYYY)" or "Author et al. (YYYY, YYYY)"
    // Outside parentheses, year(s) in parentheses
    // Handles: Bignamini et al. (2009, 2010), Weinstein et al. (1982)
    // Also handles: M.-T. Li et al. (2013) with initials before last name
    // ═══════════════════════════════════════════════════════════════════════════
    // FTR-AUTHOR-INITIAL: Updated to capture optional initials before each author name
    let match: RegExpExecArray | null;
    ET_AL_OUTSIDE_REGEX.lastIndex = 0;
    while ((match = ET_AL_OUTSIDE_REGEX.exec(text)) !== null) {
      const authorsStr = match[1].trim();
      const yearsStr = match[2];
      const authorInfos = this.extractAllAuthorNamesWithInitials(authorsStr);
      const authors = authorInfos.map((a) => a.lastName);
      const authorInitials = authorInfos
        .map((a) => a.initials)
        .filter((i): i is string => i !== undefined);

      // Parse multiple years (e.g., "2009, 2010")
      const years = yearsStr
        .split(/\s*,\s*/)
        .map((y) => y.trim())
        .filter((y) => /^\d{4}[a-z]?$/.test(y));

      if (authors.length > 0 && years.length > 0) {
        for (const year of years) {
          if (
            !matches.some((m) => m.authors[0] === authors[0] && m.year === year)
          ) {
            matches.push({
              full: match[0],
              authors,
              year,
              isEtAl: true,
              authorInitials:
                authorInitials.length > 0 ? authorInitials : undefined,
            });
            debugLog(
              `[PDF-ANNOTATE] Author-year Pattern 1 match: "${match[0]}" -> authors=[${authors.join(",")}], year=${year}, initials=[${authorInitials.join(",")}]`,
            );
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Pattern 1b: "Author et al., YYYY)" - incomplete selection (missing opening paren)
    // Handles: "Guo, Hidalgo-Duque et al., 2014)." where user didn't select "("
    // Also handles: "M.-T. Li et al., 2013;" with initials before last name
    // This is a common case when double-clicking or dragging to select citation text
    // ═══════════════════════════════════════════════════════════════════════════
    // FTR-AUTHOR-INITIAL: Updated to capture optional initials before each author name
    // Pattern captures: (optional initials + lastName)(, optional initials + lastName)*
    const etAlIncompleteRegex = new RegExp(
      `\\b((?:[${AUTHOR_LETTER_UPPER}]\\.(?:\\s*-?[${AUTHOR_LETTER_UPPER}]\\.)*\\s*)?[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+(?:(?:\\s*,\\s*|\\s+and\\s+|\\s*,\\s+and\\s+)(?:[${AUTHOR_LETTER_UPPER}]\\.(?:\\s*-?[${AUTHOR_LETTER_UPPER}]\\.)*\\s*)?[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)*)\\s+et\\s+al\\.?\\s*,?\\s*(\\d{4}[a-z]?)\\)?`,
      "gi",
    );

    etAlIncompleteRegex.lastIndex = 0;
    while ((match = etAlIncompleteRegex.exec(text)) !== null) {
      const authorsStr = match[1].trim();
      const year = match[2];
      const authorInfos = this.extractAllAuthorNamesWithInitials(authorsStr);
      const authors = authorInfos.map((a) => a.lastName);
      const authorInitials = authorInfos
        .map((a) => a.initials)
        .filter((i): i is string => i !== undefined);

      // Skip if already matched by Pattern 1 (complete parentheses version)
      if (matches.some((m) => m.authors[0] === authors[0] && m.year === year))
        continue;

      if (authors.length > 0) {
        matches.push({
          full: match[0],
          authors,
          year,
          isEtAl: true,
          authorInitials:
            authorInitials.length > 0 ? authorInitials : undefined,
        });
        debugLog(
          `[PDF-ANNOTATE] Author-year Pattern 1b match (incomplete): "${match[0]}" -> authors=[${authors.join(",")}], year=${year}, initials=[${authorInitials.join(",")}]`,
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Pattern 1c: "Author and Author, YYYY" - two authors, year WITHOUT parentheses
    // Handles: "G. Li and Liu, 2013;" - incomplete selection (missing opening paren)
    // Also handles initials: "G. Li and X.-H. Liu, 2015"
    // ═══════════════════════════════════════════════════════════════════════════
    // FTR-AUTHOR-INITIAL: Capture optional initials before each author name
    const twoAuthorsIncompleteRegex = new RegExp(
      `\\b((?:[${AUTHOR_LETTER_UPPER}]\\.(?:\\s*-?[${AUTHOR_LETTER_UPPER}]\\.)*\\s*)?[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)\\s+and\\s+((?:[${AUTHOR_LETTER_UPPER}]\\.(?:\\s*-?[${AUTHOR_LETTER_UPPER}]\\.)*\\s*)?[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)\\s*,\\s*(\\d{4}[a-z]?)(?:[;,)]|$)`,
      "gi",
    );

    twoAuthorsIncompleteRegex.lastIndex = 0;
    while ((match = twoAuthorsIncompleteRegex.exec(text)) !== null) {
      const author1Str = match[1].trim();
      const author2Str = match[2].trim();
      const year = match[3];

      // Extract author info with initials
      const author1Info = this.extractAllAuthorNamesWithInitials(author1Str);
      const author2Info = this.extractAllAuthorNamesWithInitials(author2Str);
      const authors = [
        ...author1Info.map((a) => a.lastName),
        ...author2Info.map((a) => a.lastName),
      ];
      const authorInitials = [
        ...author1Info
          .map((a) => a.initials)
          .filter((i): i is string => i !== undefined),
        ...author2Info
          .map((a) => a.initials)
          .filter((i): i is string => i !== undefined),
      ];

      // Skip if already matched by previous patterns
      if (matches.some((m) => m.authors[0] === authors[0] && m.year === year))
        continue;

      if (authors.length >= 2) {
        matches.push({
          full: match[0],
          authors,
          year,
          isEtAl: false,
          authorInitials:
            authorInitials.length > 0 ? authorInitials : undefined,
        });
        debugLog(
          `[PDF-ANNOTATE] Author-year Pattern 1c match (two authors, incomplete): "${match[0]}" -> authors=[${authors.join(",")}], year=${year}, initials=[${authorInitials.join(",")}]`,
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Pattern 2: "Author, Author, and Author (YYYY)" - multiple authors, year in paren
    // Handles: Larionov, Strikman, and Bleicher (2015)
    // ═══════════════════════════════════════════════════════════════════════════
    // Use extended character class to support German ß, umlauts, etc.
    const multiAuthorOutsideRegex = new RegExp(
      `\\b([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+(?:\\s*,\\s*[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)*(?:\\s*,?\\s+and\\s+[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+))\\s*\\((\\d{4}[a-z]?(?:\\s*,\\s*\\d{4}[a-z]?)*)\\)`,
      "gi",
    );

    multiAuthorOutsideRegex.lastIndex = 0;
    while ((match = multiAuthorOutsideRegex.exec(text)) !== null) {
      const fullMatch = match[0];
      const authorsStr = match[1].trim();
      const yearsStr = match[2];

      // Skip if already matched by et al. pattern
      if (matches.some((m) => m.full === fullMatch)) continue;

      const authors = this.extractAllAuthorNames(authorsStr);
      const years = yearsStr
        .split(/\s*,\s*/)
        .map((y) => y.trim())
        .filter((y) => /^\d{4}[a-z]?$/.test(y));

      if (authors.length >= 2 && years.length > 0) {
        for (const year of years) {
          if (
            !matches.some((m) => m.authors[0] === authors[0] && m.year === year)
          ) {
            matches.push({ full: fullMatch, authors, year, isEtAl: false });
            debugLog(
              `[PDF-ANNOTATE] Author-year Pattern 2 match: "${fullMatch}" -> authors=[${authors.join(",")}], year=${year}`,
            );
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Pattern 3: "Author and Author (YYYY)" - two authors with year in parentheses
    // Matches: Weinstein and Isgur (1982), Artoisenet and Braaten (2010)
    // ═══════════════════════════════════════════════════════════════════════════
    // Use extended character class to support German ß, umlauts, etc.
    const twoAuthorsRegex = new RegExp(
      `\\b([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)\\s+and\\s+([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]+)\\s*\\((\\d{4}[a-z]?)\\)`,
      "gi",
    );

    twoAuthorsRegex.lastIndex = 0;
    while ((match = twoAuthorsRegex.exec(text)) !== null) {
      const full = match[0];
      // Check if already matched by previous patterns
      if (matches.some((m) => m.full.includes(full) || full.includes(m.full)))
        continue;

      const authors = [match[1], match[2]];
      const year = match[3];

      if (
        !matches.some((m) => m.authors[0] === authors[0] && m.year === year)
      ) {
        matches.push({ full, authors, year, isEtAl: false });
        debugLog(
          `[PDF-ANNOTATE] Author-year Pattern 3 match: "${full}" -> authors=[${authors.join(",")}], year=${year}`,
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Pattern 4: "Author (YYYY)" - single author with year in parentheses
    // Only match if it looks like a citation (not part of regular text)
    // ═══════════════════════════════════════════════════════════════════════════
    // Use extended character class to support German ß, umlauts, etc.
    // Note: negative lookbehind uses fixed strings, not dynamic patterns
    const singleAuthorRegex = new RegExp(
      `(?<![Ss]ection\\s|[Ff]igure\\s|[Tt]able\\s|[Ee]quation\\s|[Rr]ef\\.?\\s)\\b([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]{2,})\\s*\\((\\d{4}[a-z]?)\\)`,
      "gi",
    );

    singleAuthorRegex.lastIndex = 0;
    while ((match = singleAuthorRegex.exec(text)) !== null) {
      const full = match[0];
      // Check if already matched by previous patterns
      if (matches.some((m) => m.full.includes(full) || full.includes(m.full)))
        continue;

      const author = match[1];
      const year = match[2];

      // Skip common non-author words
      const skipWords = new Set([
        "Section",
        "Figure",
        "Table",
        "Equation",
        "Chapter",
        "Appendix",
        "Part",
        "Volume",
        "Issue",
      ]);
      if (skipWords.has(author)) continue;

      if (!matches.some((m) => m.authors[0] === author && m.year === year)) {
        matches.push({ full, authors: [author], year, isEtAl: false });
        debugLog(
          `[PDF-ANNOTATE] Author-year Pattern 4 match: "${full}" -> authors=[${author}], year=${year}`,
        );
      }
    }

    if (matches.length === 0) {
      return null;
    }

    return this.buildAuthorYearResult(matches);
  }

  /**
   * Build ParsedCitation result from parsed author-year matches.
   * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Extracted as helper to allow early return from Pattern 0a.
   */
  private buildAuthorYearResult(
    matches: Array<{
      full: string;
      authors: string[];
      year: string;
      isEtAl: boolean;
      authorInitials?: string[];
    }>,
  ): ParsedCitation {
    // ═══════════════════════════════════════════════════════════════════════════
    // FTR-COMPOUND-SURNAME-DEDUP: Filter out partial matches from compound surnames
    // When "Hiller Blin et al., 2016" is parsed, the regex may also match "Blin et al., 2016"
    // as a separate entry (due to \b word boundary). We filter these out by checking if
    // one author's name is a suffix of another's with the same year.
    // Example: "Blin" is suffix of "Hiller Blin" → remove the "Blin" match
    // ═══════════════════════════════════════════════════════════════════════════
    const filteredMatches = matches.filter((m, idx) => {
      const firstAuthor = m.authors[0]?.toLowerCase() || "";
      const year = m.year;

      // Check if this match's first author is a suffix/substring of another match's author
      for (let i = 0; i < matches.length; i++) {
        if (i === idx) continue;
        const otherFirstAuthor = matches[i].authors[0]?.toLowerCase() || "";
        const otherYear = matches[i].year;

        // Same year and this author is a proper suffix of the other (compound surname case)
        // "Blin" is suffix of "Hiller Blin" → filter out "Blin"
        if (
          year === otherYear &&
          otherFirstAuthor.length > firstAuthor.length &&
          otherFirstAuthor.endsWith(" " + firstAuthor)
        ) {
          debugLog(
            `[PDF-ANNOTATE] Filtering duplicate compound surname match: "${m.authors[0]}" is suffix of "${matches[i].authors[0]}"`,
          );
          return false;
        }
      }
      return true;
    });

    // Build labels for matching
    // Include multiple formats to improve matching chances
    const labels: string[] = [];
    const seenLabels = new Set<string>();

    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Build subCitations for UI display
    // Each match becomes a separate sub-citation with its own display text and labels
    const subCitations: Array<{ displayText: string; labels: string[] }> = [];

    for (const m of filteredMatches) {
      const firstAuthor = m.authors[0];
      const allAuthors = m.authors.join(", ");

      // Primary label: "FirstAuthor et al. YYYY" or "FirstAuthor YYYY"
      const primaryLabel =
        m.isEtAl || m.authors.length > 2
          ? `${firstAuthor} et al. ${m.year}`
          : m.authors.length === 2
            ? `${m.authors[0]} and ${m.authors[1]} ${m.year}`
            : `${firstAuthor} ${m.year}`;

      if (!seenLabels.has(primaryLabel)) {
        seenLabels.add(primaryLabel);
        labels.push(primaryLabel);
      }

      // Add individual author names for matching
      for (const author of m.authors) {
        if (!seenLabels.has(author)) {
          seenLabels.add(author);
          labels.push(author);
        }
      }

      // FTR-AUTHOR-INITIAL: Add "Initial LastName" format for disambiguation
      // This helps distinguish "M.-T. Li" from "G. Li" when both are cited
      // The initials array corresponds to authors array by position
      if (m.authorInitials && m.authorInitials.length > 0) {
        for (
          let i = 0;
          i < m.authors.length && i < m.authorInitials.length;
          i++
        ) {
          if (m.authorInitials[i]) {
            const initialName = `${m.authorInitials[i]} ${m.authors[i]}`;
            if (!seenLabels.has(initialName)) {
              seenLabels.add(initialName);
              labels.push(initialName);
            }
          }
        }
      }

      // Add year with suffix for disambiguation
      if (!seenLabels.has(m.year)) {
        seenLabels.add(m.year);
        labels.push(m.year);
      }

      // Add all authors combined for multi-author matching
      if (m.authors.length > 1 && !seenLabels.has(allAuthors)) {
        seenLabels.add(allAuthors);
        labels.push(allAuthors);
      }

      // Build sub-citation for this match
      const displayText =
        m.isEtAl || m.authors.length > 2
          ? `${m.authors[0]} et al. (${m.year})`
          : m.authors.length === 2
            ? `${m.authors[0]} and ${m.authors[1]} (${m.year})`
            : `${m.authors[0]} (${m.year})`;

      // Build labels specific to this sub-citation
      const subLabels: string[] = [primaryLabel];
      for (const author of m.authors) {
        if (!subLabels.includes(author)) {
          subLabels.push(author);
        }
      }
      // Add "Initial LastName" format to subLabels for disambiguation
      if (m.authorInitials && m.authorInitials.length > 0) {
        for (
          let i = 0;
          i < m.authors.length && i < m.authorInitials.length;
          i++
        ) {
          if (m.authorInitials[i]) {
            const initialName = `${m.authorInitials[i]} ${m.authors[i]}`;
            if (!subLabels.includes(initialName)) {
              subLabels.push(initialName);
            }
          }
        }
      }
      if (!subLabels.includes(m.year)) {
        subLabels.push(m.year);
      }
      if (m.authors.length > 1 && !subLabels.includes(allAuthors)) {
        subLabels.push(allAuthors);
      }

      subCitations.push({ displayText, labels: subLabels });
    }

    // Build display text: show each unique citation
    const displayParts: string[] = [];
    const seenDisplay = new Set<string>();
    for (const m of filteredMatches) {
      const displayText =
        m.isEtAl || m.authors.length > 2
          ? `${m.authors[0]} et al. (${m.year})`
          : m.authors.length === 2
            ? `${m.authors[0]} and ${m.authors[1]} (${m.year})`
            : `${m.authors[0]} (${m.year})`;
      if (!seenDisplay.has(displayText)) {
        seenDisplay.add(displayText);
        displayParts.push(displayText);
      }
    }
    const raw = displayParts.join("; ");

    debugLog(
      `[PDF-ANNOTATE] Author-year final result: raw="${raw}", labels=[${labels.join("; ")}], ${filteredMatches.length} citation(s), subCitations=${subCitations.length}`,
    );

    return {
      raw,
      type: "author-year",
      labels,
      position: null,
      subCitations: subCitations.length > 1 ? subCitations : undefined,
    };
  }

  /**
   * Parse a single author-year group (part of a complex citation).
   * Handles formats like:
   * - "Cho et al., 2011a, 2011b" → [{Cho, 2011a}, {Cho, 2011b}]
   * - "Cho, Song, and Lee, 2015" → [{Cho, Song, Lee, 2015}]
   * - "Smith, 2020" → [{Smith, 2020}]
   */
  private parseAuthorYearGroup(group: string): Array<{
    authors: string[];
    year: string;
    isEtAl: boolean;
    authorInitials?: string[];
  }> {
    const results: Array<{
      authors: string[];
      year: string;
      isEtAl: boolean;
      authorInitials?: string[];
    }> = [];

    // Normalize combining marks inside group
    const normalizedGroup = group
      .replace(/([A-Za-z])\s+([\u0300-\u036f])\s*([A-Za-z])/g, "$1$3$2")
      .replace(/([A-Za-z])\s+([\u0300-\u036f])/g, "$1$2")
      .normalize("NFC");
    group = normalizedGroup;

    // Extract all years from the group
    const yearMatches = group.match(/\d{4}[a-z]?/g);
    if (!yearMatches || yearMatches.length === 0) return results;

    // Check for "et al." pattern
    const isEtAl = /et\s+al\.?/i.test(group);

    // Extract authors (everything before the first year)
    const firstYearPos = group.search(/\d{4}[a-z]?/);
    if (firstYearPos < 0) return results;

    let authorsPart = group.substring(0, firstYearPos).trim();
    // Remove trailing comma and "et al."
    authorsPart = authorsPart.replace(/,?\s*et\s+al\.?\s*,?\s*$/i, "").trim();
    authorsPart = authorsPart.replace(/,\s*$/, "").trim();

    // Extract authors with initials for disambiguation
    const authorInfos = this.extractAllAuthorNamesWithInitials(authorsPart);
    const authors = authorInfos.map((a) => a.lastName);
    const authorInitials = authorInfos
      .map((a) => a.initials)
      .filter((i): i is string => i !== undefined);

    if (authors.length === 0) return results;

    // Create a citation entry for each year
    for (const year of yearMatches) {
      results.push({
        authors,
        year,
        isEtAl,
        authorInitials: authorInitials.length > 0 ? authorInitials : undefined,
      });
    }

    return results;
  }

  /**
   * Extract all author last names from an author string.
   * Handles various formats: "Smith", "Smith and Jones", "Smith, Jones, and Brown"
   * Also handles initials before last name: "G. Li", "X.-H. Liu"
   * Supports extended character sets (German ß, umlauts, etc.)
   *
   * Returns array of objects with lastName and optional initials for disambiguation.
   * The initials are preserved to help distinguish authors with the same last name
   * (e.g., "M.-T. Li" vs "G. Li" in RMP citations).
   */
  private extractAllAuthorNames(authorsStr: string): string[] {
    const authorInfos = this.extractAllAuthorNamesWithInitials(authorsStr);
    return authorInfos.map((a) => a.lastName);
  }

  /**
   * Extract all author names with their initials from an author string.
   * Returns both lastName and initials for precise disambiguation.
   *
   * Supports:
   * - Simple names: "Gryniuk", "Smith"
   * - Compound surnames with space: "Hiller Blin", "van der Waals"
   * - Names with initials: "G. Li", "M.-T. Li"
   * - Two authors: "Author and Author"
   * - Multiple authors: "Author, Author, and Author"
   */
  private extractAllAuthorNamesWithInitials(
    authorsStr: string,
  ): Array<{ lastName: string; initials?: string }> {
    // Remove "et al." suffix if present
    const cleaned = authorsStr.replace(/\s+et\s+al\.?$/i, "").trim();

    // Split by " and " or ", and " or "," BUT NOT spaces within compound surnames
    // Key insight: " and " separates authors, but space within "Hiller Blin" doesn't
    const parts = cleaned.split(/\s*,\s+and\s+|\s+and\s+|\s*,\s*/);

    const authors: Array<{ lastName: string; initials?: string }> = [];

    // Pattern: Optional initial(s) + Last name (may have space for compound surnames)
    // Captures: group 1 = initials (e.g., "M.-T.", "G.", "X.-H.")
    //           group 2 = lastName (e.g., "Li", "Hiller Blin", "van der Waals")
    // Compound surnames: allow space between capitalized words (Hiller Blin)
    // Also allow lowercase prefixes like "van", "de", "von" followed by space and capitalized word
    const initialNamePattern = new RegExp(
      `^((?:[${AUTHOR_LETTER_UPPER}]\\.(?:\\s*-?[${AUTHOR_LETTER_UPPER}]\\.)*\\s*)?)` + // Optional initials
        `((?:(?:van|von|de|der|del|la|le)\\s+)?` + // Optional lowercase prefix (van der, de la, etc.)
        `[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]*` + // First word of surname (capitalized)
        `(?:\\s+[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER}]*)*)$`, // Optional additional words in compound surname
    );

    for (const part of parts) {
      const trimmed = part.trim();
      const nameMatch = trimmed.match(initialNamePattern);
      if (nameMatch) {
        const initials = nameMatch[1]?.trim().replace(/\s+/g, "") || undefined;
        const lastName = nameMatch[2];
        authors.push({ lastName, initials: initials || undefined });
      }
    }

    return authors;
  }
}

// Singleton instance for convenience
let parserInstance: CitationParser | null = null;

export function getCitationParser(): CitationParser {
  if (!parserInstance) {
    parserInstance = new CitationParser();
  }
  return parserInstance;
}
