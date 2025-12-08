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
function tryParseAsConcatenatedRange(label: string, maxKnownLabel?: number): string[] | null {
  // Must be all digits
  if (!/^\d+$/.test(label)) return null;

  const num = parseInt(label, 10);
  if (isNaN(num)) return null;

  // Need at least 2 digits to split
  if (label.length < 2) return null;

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
    if (endStr.length > 1 && endStr.startsWith('0')) continue;

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
      if (end > maxKnownLabel! || (end - start) > 50) continue;
    } else {
      // Heuristic mode: conservative bounds
      // Only accept splits where both parts are < 100
      // This handles common cases like "6264" -> "62-64"
      if (start >= 100 || end >= 100 || (end - start) > 50) continue;
    }

    // Found a valid split! Expand to range
    const expanded = expandRange(start, end);
    ztoolkit.log(
      `[PDF-ANNOTATE] Concatenated range detected: "${label}" → ${start}-${end} → [${expanded.join(",")}] (mode=${hasValidThreshold ? 'precise' : 'heuristic'}, maxKnownLabel=${maxKnownLabel ?? 'undefined'})`
    );
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
export function postProcessLabels(labels: string[], maxKnownLabel?: number): string[] {
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
        parseInt(rangeMatch[2], 10)
      );
      labels.push(...expanded);
    } else if (/^\d+$/.test(trimmed)) {
      // Single number
      labels.push(trimmed);
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
  "section", "sections", "sec", "sect", "secs", "sects",
  "chapter", "chapters", "chap", "chaps", "ch",
  // Figures & tables
  "figure", "figures", "fig", "figs",
  "table", "tables", "tab", "tabs", "tbl", "tbls",
  // Equations & formulas (including patterns like "Eq. (35)")
  "equation", "equations", "eq", "eqs", "eqn", "eqns",
  "formula", "formulas", "formulae",
  // Note: "Eq." pattern is also handled by parentheses check below
  // Pages & lines
  "page", "pages", "pg", "pgs", "pp",
  "line", "lines", "ln", "lns",
  // Appendices & parts
  "appendix", "appendices", "app", "apps",
  "part", "parts", "pt", "pts",
  // Theorems & proofs (math papers)
  "theorem", "theorems", "thm", "thms",
  "lemma", "lemmas", "lem", "lems",
  "corollary", "corollaries", "cor", "cors",
  "proposition", "propositions", "prop", "props",
  "definition", "definitions", "def", "defs",
  "proof", "proofs", "pf", "pfs",
  "remark", "remarks", "rem", "rems",
  // Examples & exercises
  "example", "examples", "ex", "exs",
  "exercise", "exercises",
  "problem", "problems", "prob", "probs",
  "solution", "solutions", "sol", "sols",
  // Other document elements
  "note", "notes",
  "case", "cases",
  "item", "items",
  "step", "steps",
  "column", "columns", "col", "cols",
  "row", "rows",
  "entry", "entries",
  "index", "indices",
  // Numbering & references
  "number", "numbers", "num", "nums", "no", "nos",
  "version", "versions", "ver", "vers",
  "volume", "volumes", "vol", "vols",
  "issue", "issues", "iss",
  // Time & dates
  "year", "years", "yr", "yrs",
  "day", "days",
  "month", "months",
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  // Physics-specific
  "run", "runs",  // "Run 2" at LHC
  "beam", "beams",
  "event", "events",
  "sample", "samples",
  "generation", "generations", "gen", "gens",  // particle generations
  "order", "orders", "ord",  // perturbative orders
  "loop", "loops",  // loop orders in QFT
  "level", "levels", "lev", "lvl",
  "tier", "tiers",
  "phase", "phases",
  "stage", "stages",
  "class", "classes",
  "type", "types",
  "category", "categories", "cat", "cats",
  "group", "groups", "grp", "grps",
  "set", "sets",
  "series",
  "mode", "modes",
  "channel", "channels", "chan",
  "bin", "bins",  // histogram bins
  "point", "points", "pt", "pts",  // data points (pt already added)
  "degree", "degrees", "deg",
  "dimension", "dimensions", "dim", "dims",
  "component", "components", "comp",
  "parameter", "parameters", "param", "params",
  "model", "models",
  "scenario", "scenarios",
  "configuration", "configurations", "config", "configs",
  "option", "options", "opt", "opts",
  "method", "methods",
  "approach", "approaches",
  "scheme", "schemes",
  "algorithm", "algorithms", "algo", "alg",
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
        extractLabels: (m) => expandRange(parseInt(m[1], 10), parseInt(m[2], 10)),
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
            return text.split(/[·,\s]+/).map(part => decodeSuperscript(part)).filter(Boolean);
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
        regex: /\[((?:hep-[a-z]+|astro-ph|gr-qc|nucl-[a-z]+|cond-mat|quant-ph)\/\d+)\]/gi,
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
   */
  parseSelection(selection: string, enableFuzzy = false, maxKnownLabel?: number): ParsedCitation | null {
    // Clean up selection: trim whitespace
    let trimmed = selection.trim();
    
    // DEBUG: Log raw input to understand what we're parsing
    ztoolkit.log(`[PDF-ANNOTATE] parseSelection raw input (${selection.length} chars): "${selection.slice(0, 150)}..."`);
    ztoolkit.log(`[PDF-ANNOTATE] parseSelection trimmed (${trimmed.length} chars): "${trimmed.slice(0, 150)}..."`);
    
    // FTR-PDF-ANNOTATE-MULTI-LABEL: Fix OCR bracket errors (f5g → [5], f26,30g → [26,30])
    const ocrFixed = fixOCRBrackets(trimmed);
    if (ocrFixed !== trimmed) {
      ztoolkit.log(`[PDF-ANNOTATE] OCR bracket fix: "${trimmed}" → "${ocrFixed}"`);
      trimmed = ocrFixed;
    }
    
    // Smart cleanup: try to find [xxx] pattern ANYWHERE in the text first
    // This handles cases like "SS [25,26,29]." or "text [1,2,3] more text"
    // FTR-PDF-ANNOTATE-MULTI-LABEL: Collect ALL numeric bracket matches, not just the last one
    // This handles cases like "[7] and [9]" -> should return both labels [7, 9]
    const allBracketMatches = [...trimmed.matchAll(/\[([^\[\]]+)\]/g)];
    ztoolkit.log(`[PDF-ANNOTATE] allBracketMatches count: ${allBracketMatches.length}`);
    for (const m of allBracketMatches) {
      ztoolkit.log(`[PDF-ANNOTATE]   bracket match: "[${m[1]}]" at index ${m.index}`);
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
      
      ztoolkit.log(`[PDF-ANNOTATE] Collected labels from bracket matches: [${allCollectedLabels.join(",")}]`);

      if (allCollectedLabels.length > 0) {
        // FTR-PDF-MATCHING: Post-process to detect concatenated ranges
        const processedLabels = postProcessLabels(allCollectedLabels, maxKnownLabel);
        return {
          raw: processedLabels.map(l => `[${l}]`).join(","),
          type: "numeric",
          labels: processedLabels,
          position: null,
        };
      }
      
      // If no numeric matches, try the last bracket match as fallback
      const lastMatch = allBracketMatches[allBracketMatches.length - 1];
      if (lastMatch) {
        const content = lastMatch[1];
        // For non-numeric content (e.g., author-year), return as-is
        return {
          raw: `[${content}]`,
          type: "author-year",  // Assume non-numeric is author-year style
          labels: [content],
          position: null,
        };
      }
    }
    
    // No complete [xxx] found - try cleaning up and parsing
    // Remove common trailing punctuation that might be accidentally selected
    // But be careful not to remove ] if there's an unclosed [
    const hasUnclosedBracket = (trimmed.match(/\[/g) || []).length > 
                               (trimmed.match(/\]/g) || []).length;
    if (hasUnclosedBracket) {
      // Don't strip ] from the end - it might be the closing bracket we need
      trimmed = trimmed.replace(/[.,;:!?)]+$/, "");
    } else {
      trimmed = trimmed.replace(/[.,;:!?)\]]+$/, "");
    }
    // Also remove leading punctuation
    trimmed = trimmed.replace(/^[(\[]+/, "");
    
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
      ztoolkit.log(`[PDF-ANNOTATE] parseText found ${parsed.length} result(s):`);
      for (let i = 0; i < parsed.length; i++) {
        ztoolkit.log(`[PDF-ANNOTATE]   [${i}] raw="${parsed[i].raw}", labels=[${parsed[i].labels.join(",")}]`);
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
          ztoolkit.log(`[PDF-ANNOTATE]   checking label "${label}": inBracket=${inBracket}, standalone=${standalone}`);
          if (inBracket || standalone) {
            if (!allVisibleLabels.includes(label)) {
              allVisibleLabels.push(label);
            }
          }
        }
      }
      ztoolkit.log(`[PDF-ANNOTATE] allVisibleLabels: [${allVisibleLabels.join(",")}]`);
      if (allVisibleLabels.length > 0) {
        // FTR-PDF-MATCHING: Post-process to detect concatenated ranges
        const processedLabels = postProcessLabels(allVisibleLabels, maxKnownLabel);
        return {
          raw: processedLabels.map(l => `[${l}]`).join(","),
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
      return {
        raw: trimmed,
        type: "numeric",
        labels: expandRange(parseInt(bareRange[1], 10), parseInt(bareRange[2], 10)),
        position: null,
      };
    }

    // Try mixed format without brackets "1,2,5-8"
    // DEBUG: Log the trimmed text to understand what's being parsed
    ztoolkit.log(`[PDF-ANNOTATE] parseMixedCitation input (first 200 chars): "${trimmed.slice(0, 200)}"`);
    const mixedLabels = parseMixedCitation(trimmed);
    ztoolkit.log(`[PDF-ANNOTATE] parseMixedCitation result: [${mixedLabels.join(",")}]`);
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
    const docRefPattern = /^\s*(figs?|figures?|tabs?|tables?|secs?|sects?|sections?|eqs?|eqns?|equations?|apps?|appendix|appendices|chs?|chaps?|chapters?|parts?|theorems?|lemmas?|corollar(?:y|ies)|defs?|definitions?|props?|propositions?|examples?|exercises?|problems?|notes?|cases?|steps?)\.?\s*[\d,\s–-]+\s*$/i;
    if (docRefPattern.test(trimmed)) {
      ztoolkit.log(`[PDF-ANNOTATE] Skipping fuzzy: entire text is document reference`);
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
    const docRefInlinePattern = /\b(figs?|figures?|tabs?|tables?|secs?|sects?|sections?|eqs?|eqns?|equations?|apps?|appendix|appendices|chs?|chaps?|chapters?|parts?|theorems?|lemmas?|corollar(?:y|ies)|defs?|definitions?|props?|propositions?|examples?|exercises?|problems?|notes?|cases?|steps?)\.?\s*([\d,\s–-]+)/gi;
    let docMatch;
    while ((docMatch = docRefInlinePattern.exec(trimmed)) !== null) {
      const nums = docMatch[2].match(/\d+/g) || [];
      for (const n of nums) {
        docRefNumbers.add(n);
        ztoolkit.log(`[PDF-ANNOTATE] Excluding "${docMatch[1]}. ${n}" as document reference`);
      }
    }
    
    // Pattern 0: Numeric ranges without brackets (e.g., "12–19") inside OCR text
    // Treated as explicit patterns so exclusion rules are relaxed
    const rangeRegex = /\b(\d{1,4})\s*[–-]\s*(\d{1,4})\b/g;
    let rangeMatch;
    while ((rangeMatch = rangeRegex.exec(trimmed)) !== null) {
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
        ztoolkit.log(`[PDF-ANNOTATE] Fuzzy Pattern 0 (Range): found ${start}–${end} -> [${expanded.join(",")}]`);
      }
    }
    
    // Pattern 0b: Comma-separated numbers without brackets (e.g., "10,11")
    // Treated as explicit to relax exclusion rules; ignore years and doc refs
    const listRegex = /\b\d{1,4}(?:\s*,\s*\d{1,4})+\b/g;
    let listMatch;
    while ((listMatch = listRegex.exec(trimmed)) !== null) {
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
      ztoolkit.log(`[PDF-ANNOTATE] Fuzzy Pattern 0b (List): found [${nums.join(",")}]`);
    }
    
    // Pattern 1: Explicit reference markers (e.g., "Ref. 19", "Refs. 22,23")
    const refMarkerMatch = trimmed.match(
      /\brefs?\.?\s*([\d,\s–-]+)/i
    );
    if (refMarkerMatch) {
      const refLabels = parseMixedCitation(refMarkerMatch[1]);
      for (const label of refLabels) {
        if (!allFuzzyLabels.includes(label)) {
          allFuzzyLabels.push(label);
        }
      }
      ztoolkit.log(`[PDF-ANNOTATE] Fuzzy Pattern 1 (Ref markers): found [${refLabels.join(",")}]`);
    }
    
    // Pattern 2: Find ALL author-number patterns (e.g., "Godfrey 17 and ... Fazio 18")
    // Uses module-level EXCLUDED_PREFIXES to avoid recreation on each call
    const authorNumberRegex = /\b([A-Z][a-z]+)\s+(\d{1,4})\b/g;
    let authorMatch;
    while ((authorMatch = authorNumberRegex.exec(trimmed)) !== null) {
      const prefix = authorMatch[1].toLowerCase();
      // Skip if prefix is a common document structure term
      if (!EXCLUDED_PREFIXES.has(prefix)) {
        const num = parseInt(authorMatch[2], 10);
        // Sanity check: typical citation numbers are 1-1499
        if (num >= 1 && num <= 1499) {
          if (!allFuzzyLabels.includes(authorMatch[2])) {
            allFuzzyLabels.push(authorMatch[2]);
            ztoolkit.log(`[PDF-ANNOTATE] Fuzzy Pattern 2 (Author-number): found "${authorMatch[1]} ${authorMatch[2]}"`);
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
        ztoolkit.log(`[PDF-ANNOTATE] Exclusion Rule 1: parentheses found, skipping standalone detection`);
      }
      
      // Rule 2: Mathematical operators/context
      if (!skipStandaloneDetection && /[=+*/^~]/.test(trimmed)) {
        skipStandaloneDetection = true;
        ztoolkit.log(`[PDF-ANNOTATE] Exclusion Rule 2: math operators found, skipping standalone detection`);
      }
      // Hyphen/minus: only exclude if it's mathematical (before digit or between digits)
      if (!skipStandaloneDetection && /\d\s*-\s*\d|-\s*\d/.test(trimmed)) {
        skipStandaloneDetection = true;
        ztoolkit.log(`[PDF-ANNOTATE] Exclusion Rule 2b: math hyphen found, skipping standalone detection`);
      }
      
      // Rule 3: Greek letters (formula context)
      if (!skipStandaloneDetection && /[αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ]/.test(trimmed)) {
        skipStandaloneDetection = true;
        ztoolkit.log(`[PDF-ANNOTATE] Exclusion Rule 3: Greek letters found, skipping standalone detection`);
      }
      
      // Rule 4: Multiple standalone numbers (data context, e.g., "1267 53 candidates")
      if (!skipStandaloneDetection) {
        const numberMatches = trimmed.match(/\b\d+\b/g) || [];
        const nonYearNumbers = numberMatches.filter(n => {
          const num = parseInt(n, 10);
          return !(num >= 1900 && num <= 2099); // Exclude years
        });
        if (nonYearNumbers.length >= 2) {
          skipStandaloneDetection = true;
          ztoolkit.log(`[PDF-ANNOTATE] Exclusion Rule 4: multiple numbers found (${nonYearNumbers.join(",")}), skipping standalone detection`);
        }
      }
    } else {
      ztoolkit.log(`[PDF-ANNOTATE] Has explicit patterns [${allFuzzyLabels.join(",")}], relaxing exclusion rules`);
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
            if (!docRefNumbers.has(standaloneMatch[1]) && !allFuzzyLabels.includes(standaloneMatch[1])) {
              allFuzzyLabels.push(standaloneMatch[1]);
              ztoolkit.log(`[PDF-ANNOTATE] Fuzzy Pattern 3 (Standalone, relaxed): found "${standaloneMatch[1]}"`);
            } else if (docRefNumbers.has(standaloneMatch[1])) {
              ztoolkit.log(`[PDF-ANNOTATE] Fuzzy Pattern 3: skipping "${standaloneMatch[1]}" (document reference)`);
            }
          }
        }
      } else {
        // Strict mode: find only the first standalone number (that's not a doc ref)
        const standaloneRegex = /\b(\d{1,4})\b/g;
        let standaloneMatch;
        while ((standaloneMatch = standaloneRegex.exec(trimmed)) !== null) {
          const num = parseInt(standaloneMatch[1], 10);
          if (num >= 1 && num <= 1499 && !docRefNumbers.has(standaloneMatch[1])) {
            if (!allFuzzyLabels.includes(standaloneMatch[1])) {
              allFuzzyLabels.push(standaloneMatch[1]);
              ztoolkit.log(`[PDF-ANNOTATE] Fuzzy Pattern 3 (Standalone): found "${standaloneMatch[1]}"`);
              break; // Only first in strict mode
            }
          }
        }
      }
    }

    // Return all collected labels (from Ref markers, author-number, and standalone)
    if (allFuzzyLabels.length > 0) {
      ztoolkit.log(`[PDF-ANNOTATE] Fuzzy detection final result: [${allFuzzyLabels.join(",")}]`);
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
}

// Singleton instance for convenience
let parserInstance: CitationParser | null = null;

export function getCitationParser(): CitationParser {
  if (!parserInstance) {
    parserInstance = new CitationParser();
  }
  return parserInstance;
}

