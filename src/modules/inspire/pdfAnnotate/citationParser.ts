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
      // Superscript digits: ¹²³
      {
        regex: /([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g,
        type: "numeric",
        extractLabels: (m) => {
          const decoded = decodeSuperscript(m[1]);
          // Split if it's a sequence like "123" -> ["1", "2", "3"]
          return decoded.split("");
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
   */
  parseSelection(selection: string, enableFuzzy = false): ParsedCitation | null {
    // Clean up selection: trim whitespace
    let trimmed = selection.trim();
    
    // DEBUG: Log raw input to understand what we're parsing
    ztoolkit.log(`[PDF-ANNOTATE] parseSelection raw input (${selection.length} chars): "${selection.slice(0, 150)}..."`);
    ztoolkit.log(`[PDF-ANNOTATE] parseSelection trimmed (${trimmed.length} chars): "${trimmed.slice(0, 150)}..."`);
    
    // Smart cleanup: try to find [xxx] pattern ANYWHERE in the text first
    // This handles cases like "SS [25,26,29]." or "text [1,2,3] more text"
    // Use a global search to find the LAST complete [xxx] pattern
    // (to prefer "[25,26,29]" in "SS [25,26,29]." over any earlier partial match)
    const allBracketMatches = [...trimmed.matchAll(/\[([^\[\]]+)\]/g)];
    ztoolkit.log(`[PDF-ANNOTATE] allBracketMatches count: ${allBracketMatches.length}`);
    for (const m of allBracketMatches) {
      ztoolkit.log(`[PDF-ANNOTATE]   bracket match: "[${m[1]}]" at index ${m.index}`);
    }
    if (allBracketMatches.length > 0) {
      // Take the last match (most likely to be the intended citation)
      // But prefer the match that contains only citation-like content
      let bestMatch: RegExpMatchArray | null = null;
      for (const match of allBracketMatches) {
        const content = match[1];
        // Check if content looks like a numeric citation (digits, commas, dashes)
        if (/^[\d,\s–-]+$/.test(content)) {
          bestMatch = match;
        }
      }
      // If no numeric match found, try any match
      if (!bestMatch && allBracketMatches.length > 0) {
        bestMatch = allBracketMatches[allBracketMatches.length - 1];
      }
      
      if (bestMatch) {
        const content = bestMatch[1];
        const labels = parseMixedCitation(content);
        if (labels.length > 0) {
          return {
            raw: `[${content}]`,
            type: "numeric",
            labels,
            position: null,
          };
        }
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
        return {
          raw: allVisibleLabels.map(l => `[${l}]`).join(","),
          type: "numeric",
          labels: allVisibleLabels,
          position: null,
        };
      }
      // If no visible label, continue to other detection methods
    }

    // Try bare number (user selected "1" without brackets)
    const bareNumber = trimmed.match(/^(\d+)$/);
    if (bareNumber) {
      return {
        raw: trimmed,
        type: "numeric",
        labels: [bareNumber[1]],
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
      return {
        raw: trimmed,
        type: "numeric",
        labels: mixedLabels,
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
      return {
        raw: `[${allFuzzyLabels.join(",")}]`,
        type: "numeric",
        labels: allFuzzyLabels,
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

