// ─────────────────────────────────────────────────────────────────────────────
// PDF References Parser
// FTR-PDF-ANNOTATE-MULTI-LABEL: Parse PDF reference list to determine citation boundaries
// FTR-PDF-STRUCTURED-DATA: Support parsing from Zotero's structured page data
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import type { ZoteroChar, ZoteroPageData, StructuredRefEntry } from "./types";
import { MATCH_CONFIG, PARSE_CONFIG } from "./constants";

/**
 * Extended letter character class for author names in PDF parsing.
 * Includes ASCII letters plus common European characters (German, French, Spanish, etc.)
 *
 * Characters included:
 * - ASCII: a-zA-Z
 * - German: ß, ä, ö, ü, Ä, Ö, Ü
 * - French/Spanish/Portuguese: à, á, â, ã, è, é, ê, ë, ì, í, î, ï, ò, ó, ô, õ, ù, ú, û, ñ, ç, etc.
 * - Other European: ł, Ł, ř, č, š, ž, etc.
 */
const AUTHOR_LETTER_LOWER = "a-zßäöüàáâãèéêëìíîïòóôõùúûñçłęąśćźżńřčšžěůığş'\\-";
const AUTHOR_LETTER_UPPER = "A-ZÄÖÜÀÁÂÃÈÉÊËÌÍÎÏÒÓÔÕÙÚÛÑÇŁĘĄŚĆŹŻŃŘČŠŽŮIĞŞ";

/**
 * Extracted bibliographic info from a single paper in PDF text
 */
export interface PDFPaperInfo {
  /** Raw text of this paper entry */
  rawText: string;
  /** Mark if this segment is an erratum/correction */
  isErratum?: boolean;
  /** First author's last name (if detected) */
  firstAuthorLastName?: string;
  /** All author last names extracted from this reference (for disambiguation) */
  allAuthorLastNames?: string[];
  /** Publication year (if detected) */
  year?: string;
  /** Page number (if detected) */
  pageStart?: string;
  /** arXiv ID if detected (e.g., "2004.00024") */
  arxivId?: string;
  /** DOI if detected */
  doi?: string;
  /** Journal abbreviation/title if detected */
  journalAbbrev?: string;
  /** Volume if detected */
  volume?: string;
  /** Issue if detected */
  issue?: string;
}

/**
 * Parsed reference mapping from PDF
 * Maps citation number (e.g., "20") to the count of papers it contains
 */
export interface PDFReferenceMapping {
  /** Parse timestamp */
  parsedAt: number;
  /** PDF citation label -> count of papers in that citation */
  labelCounts: Map<string, number>;
  /** PDF citation label -> paper info for each paper in the citation */
  labelPaperInfos?: Map<string, PDFPaperInfo[]>;
  /** Total number of labels found */
  totalLabels: number;
  /** Parse quality indicator */
  confidence: "high" | "medium" | "low";
}

/**
 * Position of a label in the PDF text
 */
interface LabelPosition {
  label: string;
  index: number;
  textBetween?: string;
}

interface PageText {
  index: number;
  start: number;
  end: number;
  text: string;
}

/**
 * Parser for extracting reference list structure from PDF text.
 * Scans the References/Bibliography section to determine how many
 * papers each citation number contains.
 */
export class PDFReferencesParser {
  /**
   * Keywords that indicate the start of a references section
   */
  private static readonly SECTION_KEYWORDS = [
    "References",
    "REFERENCES",
    "Bibliography",
    "BIBLIOGRAPHY",
    "参考文献",
    "Références",
    "Literatur",
    "Bibliografía",
  ];

  /**
   * Parse PDF text to extract reference list structure.
   * Returns mapping of citation labels to paper counts.
   *
   * @param pdfText - Full text extracted from PDF (or last few pages)
   * @returns Mapping or null if parsing fails
   */
  parseReferencesSection(pdfText: string): PDFReferenceMapping | null {
    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE] Starting reference list parsing (${pdfText.length} chars)`,
    );

    // 1. Split into page-like blocks to mimic Zotero pdf-worker flow
    const pages = this.splitIntoPages(pdfText);
    if (!pages.length) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] No pages found after split`,
      );
      return null;
    }

    // 2. Select reference section starting page (tail-first)
    const {
      refText: initialRefText,
      refStartIndex,
      refStartPageIndex,
    } = this.buildReferenceSectionFromPages(pages);

    let refText = initialRefText;
    if (!refText.trim()) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Reference text is empty after page selection`,
      );
      return null;
    }
    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE] Using reference text from page ${refStartPageIndex}/${pages.length - 1}, start=${refStartIndex}, length=${refText.length}`,
    );

    // 3. Extract labels and positions (primary: page-tail ref section; fallback: relaxed multi-page scan)
    let labelPositions = this.extractLabelPositions(refText);
    if (labelPositions.length < 5) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Too few labels (${labelPositions.length}) in page-tail ref text, retrying relaxed scan over last pages`,
      );
      const relaxedPages = pages.slice(Math.max(0, pages.length - 8));
      const relaxedText = relaxedPages.map((p) => p.text).join("\n");
      labelPositions = this.extractLabelPositionsRelaxed(relaxedText);
      if (labelPositions.length < 2) {
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Relaxed scan still found too few labels (${labelPositions.length})`,
        );
        return null;
      }
      // Keep indices consistent with relaxedText for textBetween slicing
      refText = relaxedText;
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE] Found ${labelPositions.length} citation labels`,
    );
    // Filter out obviously invalid labels (0, >MAX_LABEL_NUMBER, or years)
    const filtered = labelPositions.filter((p) => {
      const num = parseInt(p.label, 10);
      return (
        Number.isFinite(num) &&
        num >= 1 &&
        num <= MATCH_CONFIG.MAX_LABEL_NUMBER &&
        !(
          num >= MATCH_CONFIG.YEAR_RANGE_MIN &&
          num <= MATCH_CONFIG.YEAR_RANGE_MAX
        )
      );
    });
    if (filtered.length !== labelPositions.length) {
      labelPositions = filtered;
    }

    // If labels start far from 1, try an extended scan (look back up to 6 pages earlier) to capture earlier labels
    const minLabelNum = Math.min(
      ...labelPositions.map((l) => parseInt(l.label, 10)),
    );
    if (Number.isFinite(minLabelNum) && minLabelNum > 5 && pages.length > 0) {
      const backPages = Math.max(0, refStartPageIndex - 6);
      const extendedPages = pages.slice(backPages);
      const extendedText = extendedPages.map((p) => p.text).join("\n");
      const extendedLabels = this.extractLabelPositionsRelaxed(extendedText);
      if (extendedLabels.length > labelPositions.length) {
        const extMin = Math.min(
          ...extendedLabels.map((l) => parseInt(l.label, 10)),
        );
        const extMax = Math.max(
          ...extendedLabels.map((l) => parseInt(l.label, 10)),
        );
        labelPositions = extendedLabels;
        refText = extendedText;
      } else {
        const extMin = extendedLabels.length
          ? Math.min(...extendedLabels.map((l) => parseInt(l.label, 10)))
          : null;
        const extMax = extendedLabels.length
          ? Math.max(...extendedLabels.map((l) => parseInt(l.label, 10)))
          : null;
      }

      // Fallback: full relaxed scan over entire text if still far from 1
      const fullRelaxed = this.extractLabelPositionsRelaxed(pdfText);
      if (fullRelaxed.length > labelPositions.length) {
        const fullMin = Math.min(
          ...fullRelaxed.map((l) => parseInt(l.label, 10)),
        );
        const fullMax = Math.max(
          ...fullRelaxed.map((l) => parseInt(l.label, 10)),
        );
        labelPositions = fullRelaxed;
        refText = pdfText;
      } else {
        const fullMin = fullRelaxed.length
          ? Math.min(...fullRelaxed.map((l) => parseInt(l.label, 10)))
          : null;
        const fullMax = fullRelaxed.length
          ? Math.max(...fullRelaxed.map((l) => parseInt(l.label, 10)))
          : null;
      }
    }

    // Final sanitization: drop invalid labels (num <1, >MAX_LABEL_NUMBER, or year-like)
    const finalFiltered = labelPositions.filter((p) => {
      const num = parseInt(p.label, 10);
      return (
        Number.isFinite(num) &&
        num >= 1 &&
        num <= MATCH_CONFIG.MAX_LABEL_NUMBER &&
        !(
          num >= MATCH_CONFIG.YEAR_RANGE_MIN &&
          num <= MATCH_CONFIG.YEAR_RANGE_MAX
        )
      );
    });
    labelPositions = finalFiltered;

    // 3. Calculate paper counts and extract paper info for each label
    const { counts: labelCounts, paperInfos: labelPaperInfos } =
      this.calculateLabelCounts(labelPositions, refText);

    // 4. Assess confidence
    const confidence = this.assessConfidence(labelPositions, labelCounts);

    // Log summary
    let multiCiteCount = 0;
    for (const [label, count] of labelCounts) {
      if (count > 1) {
        multiCiteCount++;
        const infos = labelPaperInfos.get(label) || [];
        const infoSummary = infos
          .map((p) => `${p.firstAuthorLastName || "?"} (${p.year || "?"})`)
          .join("; ");
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Label [${label}] contains ${count} papers: ${infoSummary}`,
        );
      }
    }
    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE] Summary: ${labelCounts.size} labels, ${multiCiteCount} multi-paper citations, confidence=${confidence}`,
    );

    return {
      parsedAt: Date.now(),
      labelCounts,
      labelPaperInfos,
      totalLabels: labelPositions.length,
      confidence,
    };
  }

  /**
   * Split fulltext into page-like blocks.
   * - Prefer form-feed (\f) delimiters from Zotero cache.
   * - Fallback: fixed-size chunks (~8k chars) to approximate pages.
   */
  private splitIntoPages(pdfText: string): PageText[] {
    const pages: PageText[] = [];

    const ffParts = pdfText.split("\f");
    if (ffParts.length > 1) {
      let cursor = 0;
      ffParts.forEach((part, idx) => {
        const start = cursor;
        const end = start + part.length;
        pages.push({ index: idx, start, end, text: part });
        // Account for the form-feed separator
        cursor = end + 1;
      });
    } else {
      // Heuristic chunking
      const chunkSize = PARSE_CONFIG.PAGE_CHUNK_SIZE;
      let cursor = 0;
      let pageIndex = 0;
      while (cursor < pdfText.length) {
        const end = Math.min(cursor + chunkSize, pdfText.length);
        pages.push({
          index: pageIndex,
          start: cursor,
          end,
          text: pdfText.slice(cursor, end),
        });
        cursor = end;
        pageIndex++;
      }
    }

    return pages;
  }

  /**
   * Choose a start page for the reference section and build the ref text from that page to the end.
   */
  private buildReferenceSectionFromPages(pages: PageText[]): {
    refText: string;
    refStartIndex: number;
    refStartPageIndex: number;
  } {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = pages.length - 1; i >= 0; i--) {
      const page = pages[i];
      const text = page.text;

      let score = 0;
      // Keyword/header signal
      if (this.findReferencesSectionStart(text) >= 0) {
        score += 3;
      }

      // Bracketed labels
      const bracketHits = (text.match(/\[\d{1,3}\]/g) || []).length;
      if (bracketHits >= 2) {
        score += 3;
      } else if (bracketHits === 1) {
        score += 1;
      }

      // Bare numeric refs
      const bareHits = (text.match(/(?:^|\n)\s*\d{1,3}\s+[A-Z]/g) || []).length;
      if (bareHits >= 2) {
        score += 2;
      } else if (bareHits === 1) {
        score += 1;
      }

      // Prefer tail pages
      if (i >= pages.length - 3) {
        score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    // Fallback: use last 3 pages if no strong signal
    if (bestIndex < 0 || bestScore <= 0) {
      bestIndex = Math.max(0, pages.length - 3);
    }

    const refPages = pages.slice(bestIndex);
    let refText = refPages.map((p) => p.text).join("\n");
    let refStartIndex = refPages[0]?.start ?? 0;

    // Trim to the first detected references header within the chosen tail to avoid inline citations
    const innerStart = this.findReferencesSectionStart(refText);
    if (innerStart >= 0) {
      const beforeLen = refText.length;
      refText = refText.slice(innerStart);
      refStartIndex += innerStart;
    }

    // Further trim to the earliest reference label (prefer label "1", else smallest)
    const labelPositionsForTrim = this.extractLabelPositions(refText);
    if (labelPositionsForTrim.length > 0) {
      let trimOffset = refText.length;
      const labelOne = labelPositionsForTrim.find((p) => p.label === "1");
      if (labelOne) {
        trimOffset = labelOne.index;
      } else {
        const minLabel = Math.min(
          ...labelPositionsForTrim
            .map((p) => parseInt(p.label, 10))
            .filter((n) => !isNaN(n)),
        );
        const minLabelPos = labelPositionsForTrim.find(
          (p) => parseInt(p.label, 10) === minLabel,
        );
        if (minLabelPos) {
          trimOffset = minLabelPos.index;
        }
      }
      if (trimOffset > 0 && trimOffset < refText.length) {
        const beforeLen = refText.length;
        refText = refText.slice(trimOffset);
        refStartIndex += trimOffset;
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Trimmed refText to first label at ${trimOffset} (len ${beforeLen} -> ${refText.length})`,
        );
      }
    }

    return {
      refText,
      refStartIndex,
      refStartPageIndex: refPages[0]?.index ?? bestIndex,
    };
  }

  /**
   * Find the start position of the references section.
   * Handles various formats including:
   * - PDFs without explicit "References" header
   * - Zotero fulltext cache where brackets are removed (e.g., "1 Author" instead of "[1] Author")
   */
  private findReferencesSectionStart(text: string): number {
    // Strategy 1: Look for explicit section header keywords
    for (const keyword of PDFReferencesParser.SECTION_KEYWORDS) {
      // Pattern: keyword at start of line or after section number
      // e.g., "References", "8. References", "VIII. REFERENCES"
      const patterns = [
        new RegExp(
          `(?:^|\\n)\\s*(?:\\d+\\.?|[IVXLC]+\\.?)?\\s*${keyword}\\s*(?:\\n|$)`,
          "im",
        ),
        new RegExp(`(?:^|\\n)\\s*${keyword}\\s*(?:\\n|$)`, "im"),
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match.index !== undefined) {
          Zotero.debug(
            `[${config.addonName}] [PDF-PARSE] Found references section via keyword "${keyword}" at index ${match.index}`,
          );
          return match.index;
        }
      }
    }

    // Strategy 2: Look for ACKNOWLEDGMENTS section (references often follow it)
    const ackMatch = text.match(
      /(?:^|\n)\s*(?:\d+\\.?|[IVXLC]+\\.?)?\s*ACKNOWLEDGM?ENTS?\s*(?:\n|$)/i,
    );
    if (ackMatch && ackMatch.index !== undefined) {
      const afterAck = text.slice(ackMatch.index);
      // Try both bracketed [1] and bare "1 " patterns
      // Zotero fulltext cache often removes brackets
      const ref1Patterns = [
        /(?:^|\n)[-─—_]{3,}[\s\n]*\[1\]\s/, // Separator + [1]
        /(?:^|\n)\s*\[1\]\s+[A-Z]/, // [1] Author
        /(?:^|\n)\s*1\s+[A-Z][a-z]+\s+(Collaboration|et\s+al)/i, // 1 ATLAS Collaboration or 1 Name et al
        /(?:^|\n)\s*1\s+[A-Z]\.\s*[A-Z]/, // 1 A. Name
        /(?:^|\n)\s*1\s+[A-Z][a-z]+,\s*[A-Z]\./, // 1 Name, A.
      ];
      for (const pattern of ref1Patterns) {
        const ref1Match = afterAck.match(pattern);
        if (ref1Match && ref1Match.index !== undefined) {
          const refStart = ackMatch.index + ref1Match.index;
          Zotero.debug(
            `[${config.addonName}] [PDF-PARSE] Found references after ACKNOWLEDGMENTS at index ${refStart} (pattern: ${pattern.source})`,
          );
          return refStart;
        }
      }
    }

    // Strategy 3: Look for pattern of numbered references (bare numbers without brackets)
    // This handles Zotero fulltext cache format: "1 BaBar Collaboration, B. Aubert et al."
    // Look for sequential numbers 1, 2, 3 at line starts followed by author patterns
    const bareNumPattern =
      /(?:^|\n)\s*1\s+[A-Z][a-z]*(?:\s+Collaboration|,|\s+et\s+al|\.\s*[A-Z])/i;
    const bareNumMatch = text.match(bareNumPattern);
    if (bareNumMatch && bareNumMatch.index !== undefined) {
      // Verify this is likely a reference list by checking for "2" nearby
      const after1 = text.slice(bareNumMatch.index, bareNumMatch.index + 500);
      if (/\n\s*2\s+[A-Z]/.test(after1)) {
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Found references via bare number pattern at index ${bareNumMatch.index}`,
        );
        return bareNumMatch.index;
      }
    }

    // Strategy 4: Look for horizontal line separator followed by [1] or bare 1
    const separatorPatterns = [
      /(?:^|\n)[-─—_]{3,}[\s\n]*\[1\]\s+[A-Z]/,
      /(?:^|\n)[-─—_]{3,}[\s\n]*1\s+[A-Z]/,
    ];
    for (const pattern of separatorPatterns) {
      const separatorMatch = text.match(pattern);
      if (separatorMatch && separatorMatch.index !== undefined) {
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Found references after line separator at index ${separatorMatch.index}`,
        );
        return separatorMatch.index;
      }
    }

    // Strategy 5: Fallback - look for first [1] that's likely a reference
    const firstRef = text.match(/(?:^|\n)\s*\[1\]\s+[A-Z][a-z]/);
    if (firstRef && firstRef.index !== undefined) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Found references via [1] pattern at index ${firstRef.index}`,
      );
      return firstRef.index;
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE] Could not find references section start`,
    );
    return -1;
  }

  /**
   * Extract all reference labels and their positions in the text.
   * Handles both bracketed [n] and bare number "n " formats (Zotero fulltext cache).
   */
  private extractLabelPositions(text: string): LabelPosition[] {
    const positions: LabelPosition[] = [];
    const seenLabels = new Set<string>();

    // First, try bracketed format [n] (line-start biased to avoid in-body citations)
    const bracketRegex = /\[(\d+)\]/g;
    let match;

    while ((match = bracketRegex.exec(text)) !== null) {
      const label = match[1];
      const index = match.index;

      // Filter out likely inline citations (not at start of reference)
      const before = text.slice(Math.max(0, index - 30), index);
      const isRefStart = /(?:^|\n)\s*$/.test(before) || positions.length === 0;

      if (!seenLabels.has(label) && (isRefStart || positions.length === 0)) {
        seenLabels.add(label);
        positions.push({ label, index });
      }
    }

    // Expand bracketed ranges like [5–8] or [5-8] into individual labels
    const rangeRegex = /\[(\d+)[-–](\d+)\]/g;
    rangeRegex.lastIndex = 0;
    while ((match = rangeRegex.exec(text)) !== null) {
      const startNum = parseInt(match[1], 10);
      const endNum = parseInt(match[2], 10);
      if (Number.isNaN(startNum) || Number.isNaN(endNum) || endNum < startNum) {
        continue;
      }
      for (let n = startNum; n <= endNum; n++) {
        const label = String(n);
        if (n > 500 || (n >= 1900 && n <= 2099)) continue;
        if (seenLabels.has(label)) continue;
        seenLabels.add(label);
        positions.push({ label, index: match.index });
      }
    }

    // Supplementary inline pass: capture inline bracket labels that appear after the first detected reference
    if (positions.length > 0) {
      const firstRefIndex = positions[0].index;
      bracketRegex.lastIndex = 0;
      while ((match = bracketRegex.exec(text)) !== null) {
        const label = match[1];
        const idx = match.index;
        const num = parseInt(label, 10);
        if (idx < firstRefIndex - 10) continue; // stay within reference region
        if (num > 500 || (num >= 1900 && num <= 2099)) continue;
        if (seenLabels.has(label)) continue;

        // FTR-PDF-ANNOTATE-FIX: Filter out inline citations by checking what follows the bracket
        // Inline citations: "[51]. Therefore" or "[51]," - followed by punctuation
        // Reference entries: "[51] P. del Amo" or "[51]Author" - NOT followed by punctuation
        const afterBracket = text.slice(
          idx + match[0].length,
          idx + match[0].length + 5,
        );
        const isLikelyInlineCitation = /^[.,;:\])–—-]/.test(afterBracket);
        if (isLikelyInlineCitation) {
          continue;
        }

        seenLabels.add(label);
        positions.push({ label, index: idx });
      }
    }

    // If we found too few bracketed labels, retry with a relaxed pass that
    // accepts any bracketed number (useful when refs are in a single line with no newlines).
    if (positions.length < 5) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Few bracketed labels (${positions.length}), retrying with relaxed bracket scan`,
      );
      positions.length = 0;
      seenLabels.clear();

      bracketRegex.lastIndex = 0;
      let lastNum = 0;
      while ((match = bracketRegex.exec(text)) !== null) {
        const label = match[1];
        const num = parseInt(label, 10);
        if (num > 500) continue;
        if (num >= 1900 && num <= 2099) continue; // skip years
        if (seenLabels.has(label)) continue;
        // Allow slight jumps but avoid wildly out-of-order numbers
        if (positions.length > 0 && num < lastNum - 5) continue;

        // FTR-PDF-ANNOTATE-FIX: Filter out inline citations by checking what follows the bracket
        // Inline citations: "[51]. Therefore" or "[51]," - followed by punctuation
        // Reference entries: "[51] P. del Amo" or "[51]Author" - NOT followed by punctuation
        const afterBracket = text.slice(
          match.index + match[0].length,
          match.index + match[0].length + 5,
        );
        const isLikelyInlineCitation = /^[.,;:\])–—-]/.test(afterBracket);
        if (isLikelyInlineCitation) {
          continue;
        }

        seenLabels.add(label);
        positions.push({ label, index: match.index });
        lastNum = num;
      }
      // Sort numerically in case order was off
      positions.sort((a, b) => parseInt(a.label, 10) - parseInt(b.label, 10));
    }

    // If no bracketed labels found, try bare number format
    if (positions.length < 3) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Few bracketed labels (${positions.length}), trying bare number format`,
      );

      // Reset for bare number search
      positions.length = 0;
      seenLabels.clear();

      // In Zotero fulltext cache, references may be continuous without newlines
      // Pattern 1: Start of text or newline + number + space + Capital
      // Pattern 2: Period/space + number + space + Capital (e.g., "2003 . 2 J. Bartelt")
      // Pattern 3: Form feed + number (e.g., "\f1 BaBar")
      const barePatterns = [
        /(?:^|\n|\f)\s*(\d+)\s+([A-Z])/g, // Start/newline/formfeed
        /\.\s+(\d+)\s+([A-Z])/g, // Period + number (continuous refs)
      ];

      for (const bareRegex of barePatterns) {
        bareRegex.lastIndex = 0;
        while ((match = bareRegex.exec(text)) !== null) {
          const label = match[1];
          const num = parseInt(label, 10);

          // Skip if number is too large (likely a year or page number)
          if (num > 500) continue;

          // Skip years (1900-2099)
          if (num >= 1900 && num <= 2099) continue;

          // Skip if we've seen this label
          if (seenLabels.has(label)) continue;

          // For sequential validation, allow some gaps but not too many
          const expectedNum = positions.length + 1;
          if (positions.length > 0) {
            // Allow refs to be slightly out of order or have small gaps
            if (num < expectedNum - 1 || num > expectedNum + 5) continue;
          }

          seenLabels.add(label);
          positions.push({ label, index: match.index });
        }

        // If we found enough with this pattern, stop trying other patterns
        if (positions.length >= 5) break;
      }

      // Fallback 3: inline numeric pattern without newlines (e.g., "78. H. Zhang ... 79. B. Wu ...")
      if (positions.length < 5) {
        const inlineRegex = /(?:^|[\s,])(\d{1,3})\.\s+(?=[A-Z])/g;
        inlineRegex.lastIndex = 0;
        while ((match = inlineRegex.exec(text)) !== null) {
          const label = match[1];
          const num = parseInt(label, 10);
          if (num > 500) continue;
          if (num >= 1900 && num <= 2099) continue;
          if (seenLabels.has(label)) continue;
          seenLabels.add(label);
          positions.push({ label, index: match.index });
        }
      }

      // Re-sort by label number (in case they were found out of order)
      positions.sort((a, b) => parseInt(a.label, 10) - parseInt(b.label, 10));

      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Found ${positions.length} bare number labels: [${positions
          .slice(0, 5)
          .map((p) => p.label)
          .join(", ")}${positions.length > 5 ? "..." : ""}]`,
      );
    }

    // Sort by index
    positions.sort((a, b) => a.index - b.index);

    // Drop any labels that occur before the first "1" (handles ACK/inline noise)
    const firstOne = positions.find((p) => p.label === "1");
    if (firstOne) {
      const cutoff = firstOne.index;
      const filtered = positions.filter((p) => p.index >= cutoff);
      positions.length = 0;
      positions.push(...filtered);
      positions.sort((a, b) => a.index - b.index);
    }

    // Fill in textBetween
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].index;
      let end = Math.min(start + PARSE_CONFIG.MAX_ENTRY_LENGTH, text.length);
      // Find the next position with a strictly larger index
      for (let j = i + 1; j < positions.length; j++) {
        if (positions[j].index > start) {
          end = positions[j].index;
          break;
        }
      }
      positions[i].textBetween = text.slice(start, end);
    }

    return positions;
  }

  /**
   * Relaxed label extraction over a broader text (e.g., full tail).
   * - Accepts bracketed [n] and numeric ranges [a-b]
   * - Also accepts bare numbers followed by capital (likely reference start)
   */
  private extractLabelPositionsRelaxed(text: string): LabelPosition[] {
    const positions: LabelPosition[] = [];
    const seenLabels = new Set<string>();

    // Bracketed + ranges
    const rangeRegex = /\[(\d+)[-–](\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = rangeRegex.exec(text)) !== null) {
      const startNum = parseInt(match[1], 10);
      const endNum = parseInt(match[2], 10);
      if (Number.isNaN(startNum) || Number.isNaN(endNum) || endNum < startNum)
        continue;
      for (let n = startNum; n <= endNum; n++) {
        const label = String(n);
        if (n > 500 || (n >= 1900 && n <= 2099)) continue;
        if (seenLabels.has(label)) continue;
        seenLabels.add(label);
        positions.push({ label, index: match.index });
      }
    }

    const bracketRegex = /\[(\d+)\]/g;
    bracketRegex.lastIndex = 0;
    while ((match = bracketRegex.exec(text)) !== null) {
      const label = match[1];
      const num = parseInt(label, 10);
      if (num > 500 || (num >= 1900 && num <= 2099)) continue;
      if (seenLabels.has(label)) continue;

      // FTR-PDF-ANNOTATE-FIX: Filter out inline citations by checking what follows the bracket
      // Inline citations: "[51]. Therefore" or "[51]," - followed by punctuation
      // Reference entries: "[51] P. del Amo" or "[51]Author" - NOT followed by punctuation
      const afterBracket = text.slice(
        match.index + match[0].length,
        match.index + match[0].length + 5,
      );
      const isLikelyInlineCitation = /^[.,;:\])–—-]/.test(afterBracket);
      if (isLikelyInlineCitation) {
        continue;
      }

      seenLabels.add(label);
      positions.push({ label, index: match.index });
    }

    // Bare numbers (relaxed) for Zotero fulltext without brackets: start of line or inline
    const barePatterns = [
      /(?:^|[\n\r\f])\s*(\d{1,3})[.)]?\s+(?=[A-Z0-9])/g, // line start + number + optional . or ) + space
      /(?:^|[\s,])(\d{1,3})\.\s+(?=[A-Z0-9])/g, // inline "xx. Author"
    ];
    for (const bareRegex of barePatterns) {
      bareRegex.lastIndex = 0;
      while ((match = bareRegex.exec(text)) !== null) {
        const label = match[1];
        const num = parseInt(label, 10);
        if (num > 500 || (num >= 1900 && num <= 2099)) continue;
        if (seenLabels.has(label)) continue;
        seenLabels.add(label);
        positions.push({ label, index: match.index });
      }
    }

    // Sort and fill textBetween
    positions.sort((a, b) => a.index - b.index);
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].index;
      let end = Math.min(start + PARSE_CONFIG.MAX_ENTRY_LENGTH, text.length);
      for (let j = i + 1; j < positions.length; j++) {
        if (positions[j].index > start) {
          end = positions[j].index;
          break;
        }
      }
      positions[i].textBetween = text.slice(start, end);
    }

    return positions;
  }

  /**
   * Calculate how many papers each citation label contains.
   * Also extracts bibliographic info for each paper (for validation).
   */
  private calculateLabelCounts(
    positions: LabelPosition[],
    _fullText: string,
  ): { counts: Map<string, number>; paperInfos: Map<string, PDFPaperInfo[]> } {
    const counts = new Map<string, number>();
    const paperInfos = new Map<string, PDFPaperInfo[]>();

    for (const pos of positions) {
      const text = pos.textBetween || "";
      const { count, papers } = this.parsePapersInText(text);
      counts.set(pos.label, count);
      paperInfos.set(pos.label, papers);
    }

    return { counts, paperInfos };
  }

  /**
   * Parse papers from a reference text block.
   * Returns count and extracted info for each paper.
   */
  private parsePapersInText(text: string): {
    count: number;
    papers: PDFPaperInfo[];
  } {
    // Remove the label itself - handles various formats:
    // - "[20] Author..." (bracketed)
    // - "20 Author..." (bare number with space)
    // - "20. Author..." (bare number with period)
    // - Also handles leading newlines/whitespace from textBetween
    const content = text
      .replace(/^[\s\n\f]*/, "") // Remove leading whitespace/newlines
      .replace(/^\[\d+\]\s*/, "") // Remove [n] format
      .replace(/^\d+\.?\s*/, ""); // Remove bare number (with optional period/space)

    // Split by semicolon or strong delimiters (semicolon or " ; " or " ;\n")
    const semicolonParts = content.split(/;\s*/);
    const papers: PDFPaperInfo[] = [];
    let lastAuthorName: string | undefined;

    for (const part of semicolonParts) {
      const trimmed = part.trim();
      const hasYear = /\b(19|20)\d{2}\b/.test(trimmed);
      const hasDoi = /doi/i.test(trimmed) || /10\.\d{4,9}\//.test(trimmed);
      const hasArxiv =
        /arxiv/i.test(trimmed) || /\bhep-[a-z]+\/\d{7}\b/i.test(trimmed);
      const looksRef = this.looksLikeReference(trimmed);
      if (looksRef || hasYear || hasDoi || hasArxiv) {
        const info = this.extractPaperInfo(trimmed, true);
        if (!info.firstAuthorLastName && lastAuthorName) {
          info.firstAuthorLastName = lastAuthorName;
        }
        if (info.firstAuthorLastName) {
          lastAuthorName = info.firstAuthorLastName;
        }
        papers.push(info);
      }
    }

    // If we found multiple papers via semicolon, use that
    if (papers.length >= 2) {
      return { count: papers.length, papers };
    }

    // Strategy 2: Split by year markers (handles compressed single-line refs)
    const yearSplitParts = content.split(/\b(19|20)\d{2}\b/);
    const yearBasedPapers: PDFPaperInfo[] = [];
    lastAuthorName = undefined;
    for (let i = 0; i < yearSplitParts.length; i++) {
      const segment = yearSplitParts[i];
      if (!segment) continue;
      // If the segment is a year token, combine with surrounding context
      const yearToken = segment.match(/^(19|20)\d{2}$/) ? segment : null;
      if (yearToken && i > 0) {
        const prev = yearSplitParts[i - 1] || "";
        const combined = `${prev} ${yearToken}`.trim();
        if (this.looksLikeReference(combined)) {
          const info = this.extractPaperInfo(combined, true);
          if (!info.firstAuthorLastName && lastAuthorName) {
            info.firstAuthorLastName = lastAuthorName;
          }
          if (info.firstAuthorLastName) {
            lastAuthorName = info.firstAuthorLastName;
          }
          yearBasedPapers.push(info);
        }
      }
    }
    if (yearBasedPapers.length >= 2) {
      return { count: yearBasedPapers.length, papers: yearBasedPapers };
    }

    // Default: single paper (still try to parse fully)
    return {
      count: 1,
      papers: [this.extractPaperInfo(content, true)],
    };
  }

  /**
   * Extract bibliographic info from a single paper text.
   * Used for matching validation.
   */
  private extractPaperInfo(text: string, logExtracted?: boolean): PDFPaperInfo {
    const info: PDFPaperInfo = { rawText: text };
    const isErratum = /\(E\)/i.test(text) || /erratum/i.test(text);
    if (isErratum) {
      info.isErratum = true;
    }
    const textNoParen = text.replace(/\s*\([^)]*\)/g, " ");

    // Extract DOI (robust to spaces and URL forms)
    const doiMatch =
      text.match(/doi\s*:?\s*([^\s;]+\/[^\s;]+)/i) ||
      text.match(/https?:\/\/\s*doi\.org\/\s*([^\s;]+)/i) ||
      text.match(/(10\.\d{4,9}\/[^\s;]+)/i);
    if (doiMatch) {
      info.doi = doiMatch[1].replace(/[),.;\s]+$/g, "").replace(/\s+/g, "");
    }

    // Extract arXiv (modern and legacy, with optional version suffix)
    // Patterns:
    // - arXiv:2301.12345v2 or arXiv: 2301.12345
    // - hep-ph/0101234v1
    // - https://arxiv.org/abs/2301.12345v3
    const arxivPatterns = [
      // Modern format with optional version: arXiv:2301.12345v2
      /arXiv\s*:?\s*([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i,
      // URL format: arxiv.org/abs/2301.12345v2
      /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i,
      // Legacy format: hep-ph/0101234v1
      /\b(hep-[a-z]+\/[0-9]{7})(?:v\d+)?/i,
      // Other legacy categories: astro-ph, cond-mat, gr-qc, math-ph, nucl-ex, nucl-th, quant-ph
      /\b((?:astro-ph|cond-mat|gr-qc|math-ph|nucl-[a-z]+|quant-ph)\/[0-9]{7})(?:v\d+)?/i,
      // Generic old format: subject/YYMMNNN
      /\b([a-z-]+\/[0-9]{7})(?:v\d+)?/i,
    ];
    for (const pattern of arxivPatterns) {
      const arxivMatch = text.match(pattern);
      if (arxivMatch) {
        info.arxivId = arxivMatch[1].toLowerCase();
        break;
      }
    }

    // Extract journal + volume + page/artid (e.g., Phys. Rev. D 69, 074005)
    const jvpMatch = textNoParen.match(
      /([A-Z][A-Za-z.\s]+)\s+([A-Z]?)\s?(\d{1,4})[, ]+\s*([A-Za-z]?\d{1,6})/,
    );
    if (jvpMatch) {
      const journal = jvpMatch[1].trim();
      const maybeIssue = jvpMatch[2]?.trim();
      const vol = jvpMatch[3]?.trim();
      const page = jvpMatch[4]?.trim();
      info.journalAbbrev = journal.replace(/\s+/g, " ");
      if (maybeIssue) info.issue = maybeIssue;
      info.volume = vol;
      info.pageStart = page;
    }

    // Extract first author's last name
    // Common formats in physics papers:
    // - "S. Okubo, Phys.Lett..." -> "Okubo"
    // - "J. Iizuka et al., PTP..." -> "Iizuka"
    // - "BaBar Collaboration, B. Aubert et al." -> "BaBar" or "Aubert"
    // - "CLEO Collaboration, Y. Kubota et al." -> "Kubota" or "CLEO"
    // - "Particle Data Group, K. Hagiwara et al." -> "Hagiwara"
    // - "G. Zweig, CERN Report..." -> "Zweig"
    // - "Name, A., Journal..." -> "Name"
    // - "张三" (Chinese) -> "张"
    // - "山田太郎" (Japanese) -> "山田"

    let match: RegExpMatchArray | null;

    // First, check for CJK names (Chinese, Japanese, Korean)
    // CJK names are typically 2-4 characters with surname first
    const cjkAuthorMatch = text.match(
      /^([\u4e00-\u9fff\u3400-\u4dbf]{1})([\u4e00-\u9fff\u3400-\u4dbf]{1,3})/,
    );
    if (cjkAuthorMatch) {
      info.firstAuthorLastName = cjkAuthorMatch[1]; // First character is surname
    }

    // Japanese names with hiragana/katakana
    if (!info.firstAuthorLastName) {
      const japaneseMatch = text.match(
        /^([\u4e00-\u9fff]{1,3})([\u3040-\u309f\u30a0-\u30ff]|[\u4e00-\u9fff])+/,
      );
      if (japaneseMatch) {
        info.firstAuthorLastName = japaneseMatch[1];
      }
    }

    // Korean names (Hangul)
    if (!info.firstAuthorLastName) {
      const koreanMatch = text.match(
        /^([\uac00-\ud7af]{1,2})([\uac00-\ud7af]{1,3})/,
      );
      if (koreanMatch) {
        info.firstAuthorLastName = koreanMatch[1];
      }
    }

    // First try to extract from "Initials LastName" pattern (most common)
    // Pattern: "A. LastName" or "A.B. LastName" or "A. B. LastName"
    // Support 2-letter surnames like "Li", "Wu", "Xu"
    if (!info.firstAuthorLastName) {
      match = text.match(/^([A-Z]\.?\s*)+([A-Z][a-z]+)/);
      if (match) {
        info.firstAuthorLastName = match[2];
      }
    }

    // Try "LastName, Initials" pattern
    // Support 2-letter surnames like "Li", "Wu", "Xu" (common in Chinese names)
    if (!info.firstAuthorLastName) {
      match = text.match(/^([A-Z][a-z]+(?:-[A-Z][a-z]+)?),\s*[A-Z]\./);
      if (match) {
        info.firstAuthorLastName = match[1];
      }
    }

    // Try to extract from "Collaboration" patterns
    if (!info.firstAuthorLastName) {
      // "CLEO Collaboration, Y. Kubota et al." -> look for author after comma
      match = text.match(/Collaboration,?\s+([A-Z]\.?\s*)+([A-Z][a-z]+)/i);
      if (match) {
        info.firstAuthorLastName = match[2];
      }
    }

    // Try "Data Group, K. Hagiwara..." style (e.g., Particle Data Group)
    if (!info.firstAuthorLastName) {
      match = text.match(/Data\s+Group,?\s+([A-Z]\.?\s*)+([A-Z][a-z]+)/i);
      if (match) {
        info.firstAuthorLastName = match[2];
      }
    }

    // Try Collaboration name itself as fallback
    if (!info.firstAuthorLastName) {
      match = text.match(/^([A-Z][A-Za-z]+)\s+Collaboration/i);
      if (match) {
        info.firstAuthorLastName = match[1];
      }
    }

    // Try "Name et al." pattern
    if (!info.firstAuthorLastName) {
      match = text.match(/^([A-Z][a-z]+)\s+et\s+al/i);
      if (match) {
        info.firstAuthorLastName = match[1];
      }
    }

    // Last resort: try to find any capitalized word that looks like a name
    if (!info.firstAuthorLastName) {
      match = text.match(/([A-Z][a-z]{3,})/);
      if (match) {
        // Exclude common non-name words
        const word = match[1];
        const excludeWords = [
          "Phys",
          "Rev",
          "Lett",
          "Nucl",
          "Part",
          "Theor",
          "Prog",
          "Report",
        ];
        if (!excludeWords.includes(word)) {
          info.firstAuthorLastName = word;
        }
      }
    }

    // Extract year (last 4-digit number that looks like a year)
    const yearMatches = text.match(/\b(19|20)\d{2}\b/g);
    if (yearMatches && yearMatches.length > 0) {
      // Take the last year mentioned (usually the publication year)
      info.year = yearMatches[yearMatches.length - 1];
    }

    // Extract page number
    // Patterns: "123 (1963)", ", 123", "page 123", "p. 123"
    const pagePatterns = [
      /\b(\d{1,5})\s*\(\d{4}\)/, // 165 (1963)
      /,\s*(\d{1,5})\s*\(/, // , 165 (
      /[Pp](?:age|\.?)\s*(\d{1,5})/, // page 165 or p. 165
      /\b(\d{1,5})[-–]\d{1,5}\s*\(\d{4}\)/, // 165-170 (1963)
    ];

    for (const pattern of pagePatterns) {
      const match = text.match(pattern);
      if (match) {
        info.pageStart = match[1];
        break;
      }
    }

    // If not set above, attempt a minimal secondary extraction (legacy)
    if (!info.arxivId) {
      const arxivMatch = text.match(
        /arxiv[:\s]?([0-9]{4}\.[0-9]{4,5}|[a-z-]+\/\d{7})(?:v\d+)?/i,
      );
      if (arxivMatch) {
        info.arxivId = arxivMatch[1].toLowerCase();
      }
    }
    if (!info.doi) {
      const doiMatch = text.match(/10\.\d{4,9}\/[^\s\],)]+/i);
      if (doiMatch) {
        info.doi = doiMatch[0].replace(/[),.;]+$/, "").toLowerCase();
      }
    }
    if (!info.journalAbbrev || !info.volume || !info.pageStart) {
      const jvpMatch = textNoParen.match(
        /([A-Z][-A-Za-z.]{1,}(?:\s+[A-Z][-A-Za-z.]{1,})*)\s+(\d{1,4})[, ]+\s*([A-Za-z]?\d{1,6})/,
      );
      if (jvpMatch) {
        info.journalAbbrev = info.journalAbbrev ?? jvpMatch[1].trim();
        info.volume = info.volume ?? jvpMatch[2];
        if (!info.pageStart) {
          info.pageStart = jvpMatch[3];
        }
      }
    }

    // Previously logged extracted info when debugging; now disabled.

    return info;
  }

  /**
   * Check if text looks like a bibliographic reference
   */
  private looksLikeReference(text: string): boolean {
    if (!text || text.length < 5) return false;

    // Must have a year
    const hasYear = /\b(19|20)\d{2}\b/.test(text);
    if (!hasYear) return false;

    const hasJournalToken = /\b(Phys|Nucl|Ann|Physica|Rev\.?|Lett|J\.)/i.test(
      text,
    );
    const hasVolumePage = /\b[A-Z]?[A-Za-z.]{2,}\s*\d{1,4}[, ]+\d{1,5}\b/.test(
      text,
    );

    // Should have author-like pattern
    // A. Name, Name A., Name et al., collaboration names
    const hasAuthor =
      /[A-Z]\.\s*[A-Z][a-z]+/.test(text) || // A. Smith
      /[A-Z][a-z]+,\s*[A-Z]\./.test(text) || // Smith, A.
      /[A-Z][a-z]+\s+et\s+al\.?/i.test(text) || // Smith et al.
      /Collaboration/i.test(text); // ATLAS Collaboration

    // Accept references that clearly have journal + volume + page even if author is missing (common in continued segments)
    if (hasAuthor) return true;
    if (hasJournalToken && hasVolumePage) return true;
    return false;
  }

  /**
   * Assess confidence of the parsing result
   */
  private assessConfidence(
    positions: LabelPosition[],
    counts: Map<string, number>,
  ): "high" | "medium" | "low" {
    // Check if labels are sequential (1, 2, 3, ...)
    const labels = positions
      .map((p) => parseInt(p.label, 10))
      .filter((n) => !isNaN(n));
    let sequential = true;
    for (let i = 1; i < labels.length; i++) {
      if (labels[i] !== labels[i - 1] + 1) {
        sequential = false;
        break;
      }
    }

    // Check consistency of multi-paper detections
    let multiPaperCount = 0;
    for (const count of counts.values()) {
      if (count > 1) multiPaperCount++;
    }

    // High: sequential labels, reasonable multi-paper ratio
    if (sequential && multiPaperCount <= counts.size * 0.3) {
      return "high";
    }

    // Medium: mostly sequential or reasonable structure
    if (labels.length >= 10) {
      return "medium";
    }

    // Low: few labels or non-sequential
    return "low";
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-PDF-STRUCTURED-DATA: Parse using Zotero's structured page data
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Parse references from Zotero's structured page data.
   * Uses `paragraphBreakAfter` flags for more accurate entry boundary detection.
   *
   * @param pages - Array of ZoteroPageData (typically last 5-10 pages)
   * @returns Mapping or null if parsing fails
   */
  parseReferencesFromStructuredData(
    pages: ZoteroPageData[],
  ): PDFReferenceMapping | null {
    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE] Starting structured data parsing (${pages.length} pages)`,
    );

    if (!pages.length) {
      return null;
    }

    // Combine all chars from all pages
    const allChars: ZoteroChar[] = [];
    for (const page of pages) {
      if (page.chars?.length) {
        allChars.push(...page.chars);
      }
    }

    if (!allChars.length) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] No chars found in structured data`,
      );
      return null;
    }

    // Convert chars to text for section detection
    const fullText = this.charsToText(allChars);

    // Find references section start
    const refStart = this.findReferencesSectionStart(fullText);
    if (refStart < 0) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] References section not found in structured data`,
      );
      return null;
    }

    // Map text position to char index
    const refStartCharIdx = this.textIndexToCharIndex(allChars, refStart);
    if (refStartCharIdx < 0) {
      return null;
    }

    // Extract reference entries using paragraph breaks
    const entries = this.extractEntriesFromChars(
      allChars.slice(refStartCharIdx),
    );

    if (entries.length < 2) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Too few entries (${entries.length}) from structured data`,
      );
      return null;
    }

    // Build mapping from entries
    const labelCounts = new Map<string, number>();
    const labelPaperInfos = new Map<string, PDFPaperInfo[]>();

    for (const entry of entries) {
      if (!entry.label) continue;

      const paperInfo = this.structuredEntryToPaperInfo(entry);
      const existing = labelPaperInfos.get(entry.label) || [];
      existing.push(paperInfo);
      labelPaperInfos.set(entry.label, existing);
      labelCounts.set(entry.label, existing.length);
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE] Structured parsing: ${labelCounts.size} labels, ${entries.length} entries`,
    );

    return {
      parsedAt: Date.now(),
      labelCounts,
      labelPaperInfos,
      totalLabels: labelCounts.size,
      confidence: entries.length >= 10 ? "high" : "medium",
    };
  }

  /**
   * Convert ZoteroChar array to plain text.
   */
  private charsToText(chars: ZoteroChar[]): string {
    const parts: string[] = [];
    for (const char of chars) {
      if (char.ignorable) continue;
      parts.push(char.c);
      if (char.paragraphBreakAfter) {
        parts.push("\n\n");
      } else if (char.lineBreakAfter) {
        parts.push("\n");
      } else if (char.spaceAfter) {
        parts.push(" ");
      }
    }
    return parts.join("");
  }

  /**
   * Map text index to char array index.
   */
  private textIndexToCharIndex(chars: ZoteroChar[], textIndex: number): number {
    let textPos = 0;
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      if (char.ignorable) continue;

      if (textPos >= textIndex) {
        return i;
      }

      textPos++; // for the char itself
      if (char.paragraphBreakAfter) {
        textPos += 2;
      } else if (char.lineBreakAfter || char.spaceAfter) {
        textPos++;
      }
    }
    return -1;
  }

  /**
   * Extract reference entries using paragraph break markers.
   * This is more accurate than regex-based splitting.
   */
  private extractEntriesFromChars(chars: ZoteroChar[]): StructuredRefEntry[] {
    const entries: StructuredRefEntry[] = [];
    let currentEntry: { start: number; chars: ZoteroChar[] } | null = null;

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];

      // Check if this looks like a reference entry start
      if (!currentEntry && this.isRefEntryStartChar(chars, i)) {
        currentEntry = { start: i, chars: [] };
      }

      if (currentEntry) {
        currentEntry.chars.push(char);

        // Entry ends at paragraph break or next entry start
        const isEndOfEntry =
          char.paragraphBreakAfter ||
          (i + 1 < chars.length && this.isRefEntryStartChar(chars, i + 1));

        if (isEndOfEntry) {
          const entry = this.parseStructuredEntry(currentEntry);
          if (entry) {
            entries.push(entry);
          }
          currentEntry = null;
        }
      }
    }

    // Handle last entry
    if (currentEntry && currentEntry.chars.length > 10) {
      const entry = this.parseStructuredEntry(currentEntry);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Check if position starts a reference entry.
   */
  private isRefEntryStartChar(chars: ZoteroChar[], index: number): boolean {
    if (index >= chars.length) return false;

    // Build a small snippet to check
    let snippet = "";
    for (let i = index; i < Math.min(index + 15, chars.length); i++) {
      if (chars[i].ignorable) continue;
      snippet += chars[i].c;
    }

    // Check for numeric label patterns: [1], 1., 1), (1)
    if (/^[[(]?\d{1,3}[\].)]\s*/.test(snippet)) {
      return true;
    }

    // Check for author-start pattern: Capital letter followed by period or lowercase
    if (/^[A-Z][a-z.]+[,\s]/.test(snippet)) {
      // Verify previous char has paragraph break (entry boundary)
      if (index > 0 && chars[index - 1].paragraphBreakAfter) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse a structured entry from collected chars.
   */
  private parseStructuredEntry(entryData: {
    start: number;
    chars: ZoteroChar[];
  }): StructuredRefEntry | null {
    const text = this.charsToText(entryData.chars).trim();
    if (text.length < 10) return null;

    // Extract label
    let label: string | null = null;
    const labelMatch = text.match(/^[[(]?(\d{1,3})[\].)]\s*/);
    if (labelMatch) {
      label = labelMatch[1];
    }

    // Remove label from text for further parsing
    const contentText = labelMatch ? text.slice(labelMatch[0].length) : text;

    // Extract bibliographic info (reuse existing logic)
    const info = this.extractPaperInfo(contentText, false);

    return {
      label,
      text,
      charRange: {
        start: entryData.start,
        end: entryData.start + entryData.chars.length,
      },
      firstAuthor: info.firstAuthorLastName || null,
      year: info.year || null,
      arxivId: info.arxivId || null,
      doi: info.doi || null,
      journal: info.journalAbbrev || null,
      volume: info.volume || null,
      page: info.pageStart || null,
    };
  }

  /**
   * Convert StructuredRefEntry to PDFPaperInfo.
   */
  private structuredEntryToPaperInfo(entry: StructuredRefEntry): PDFPaperInfo {
    return {
      rawText: entry.text,
      firstAuthorLastName: entry.firstAuthor || undefined,
      year: entry.year || undefined,
      pageStart: entry.page || undefined,
      arxivId: entry.arxivId || undefined,
      doi: entry.doi || undefined,
      journalAbbrev: entry.journal || undefined,
      volume: entry.volume || undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Author-Year Format Reference Parsing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Build reference section text for author-year format parsing.
   * Unlike buildReferenceSectionFromPages, this method does NOT trim based on
   * numeric labels, which would incorrectly cut off alphabetically-ordered refs.
   *
   * @param pdfText - Full text extracted from PDF
   * @returns Reference section text from "REFERENCES" header to end of document
   */
  private buildAuthorYearRefSection(pdfText: string): string {
    // Find the REFERENCES header
    const refStart = this.findReferencesSectionStart(pdfText);

    if (refStart < 0) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE-AY] No REFERENCES header found`,
      );
      return "";
    }

    // Extract from REFERENCES header to end of document
    // No numeric label trimming - author-year refs are alphabetically ordered
    const refText = pdfText.slice(refStart);

    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE-AY] Built ref section: start=${refStart}, length=${refText.length}`,
    );

    return refText;
  }

  /**
   * Parse author-year format references section from PDF text.
   * Used for RMP-style references: "Cho, S., et al., 2011a, Phys. Rev. Lett. 106, 212001."
   *
   * @param pdfText - Full text extracted from PDF
   * @returns AuthorYearReferenceMapping or null if parsing fails
   */
  parseAuthorYearReferencesSection(
    pdfText: string,
  ): AuthorYearReferenceMapping | null {
    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE-AY] Starting author-year reference parsing (${pdfText.length} chars)`,
    );

    // 1. Find references section
    // IMPORTANT: For author-year format, we use buildAuthorYearRefSection instead of
    // buildReferenceSectionFromPages, because the latter trims based on numeric labels
    // which would incorrectly cut off content in alphabetically-ordered author-year refs.
    const refText = this.buildAuthorYearRefSection(pdfText);
    if (!refText.trim() || refText.length < 500) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE-AY] Reference section too short or not found`,
      );
      return null;
    }

    // 2. Parse individual references
    const references = this.parseAuthorYearReferences(refText);
    if (references.length < 5) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE-AY] Too few references found (${references.length})`,
      );
      return null;
    }

    // 3. Build author-year map
    // Use array to handle multiple papers with same first author + year
    const authorYearMap = new Map<string, PDFPaperInfo[]>();
    let withJournal = 0;

    for (const ref of references) {
      if (!ref.firstAuthorLastName || !ref.year) continue;

      // Build key: "AuthorLastName YearSuffix" (e.g., "Cho 2011a")
      const key = `${ref.firstAuthorLastName} ${ref.year}`.toLowerCase();
      // Also create a key without diacritics for bidirectional fallback (e.g., "lü 2016" -> "lu 2016")
      const keyNoDiacritics = key
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

      // Only add if we have additional info (journal, DOI, arXiv)
      if (ref.journalAbbrev || ref.doi || ref.arxivId) {
        // Append to array instead of overwriting
        const existing = authorYearMap.get(key) || [];
        existing.push(ref);
        authorYearMap.set(key, existing);

        // Also add under the no-diacritics key for bidirectional fallback
        // This allows "lu 2016" to find entries stored as "lü 2016" and vice versa
        if (keyNoDiacritics !== key) {
          const existingNoDiacritics = authorYearMap.get(keyNoDiacritics) || [];
          existingNoDiacritics.push(ref);
          authorYearMap.set(keyNoDiacritics, existingNoDiacritics);
        }

        if (ref.journalAbbrev) withJournal++;
      }
    }

    if (authorYearMap.size < 5) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE-AY] Too few valid author-year entries (${authorYearMap.size})`,
      );
      return null;
    }

    // 4. Assess confidence
    const confidence: "high" | "medium" | "low" =
      withJournal > authorYearMap.size * 0.7
        ? "high"
        : withJournal > authorYearMap.size * 0.4
          ? "medium"
          : "low";

    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE-AY] Parsed ${authorYearMap.size} author-year keys (${withJournal} with journal), confidence=${confidence}`,
    );

    return {
      parsedAt: Date.now(),
      authorYearMap,
      totalReferences: references.length,
      confidence,
    };
  }

  /**
   * Parse individual author-year references from reference section text.
   * Handles RMP-style: "AuthorLastName, I., et al., YEAR[suffix], Journal Vol, Page."
   */
  private parseAuthorYearReferences(refText: string): PDFPaperInfo[] {
    const results: PDFPaperInfo[] = [];

    // FTR-PDF-ANNOTATE-FIX: Normalize combining diacritics before parsing
    // PDF text extraction often produces broken composed characters like "Lu ̈" (Lu + space + combining umlaut)
    // instead of the correct "Lü". This happens because PDF stores the umlaut separately.
    // Fix: Move combining mark onto the following base character, then normalize to NFC.
    // Example: "Lu ̈, Q.-F." -> "Lü, Q.-F."
    refText = refText
      // Move combining mark onto the following base if it sits between letters (L ̈u -> Lü)
      .replace(/([A-Za-z])\s+([\u0300-\u036f])\s*([A-Za-z])/g, "$1$3$2")
      // Fallback: collapse gaps between letter and combining mark
      .replace(/([A-Za-z])\s+([\u0300-\u036f])/g, "$1$2")
      .normalize("NFC");

    // RMP author-year format pattern:
    // Each reference typically starts with "AuthorLastName, I." at the beginning of a line
    // or after a period from the previous reference.
    //
    // Pattern: AuthorLastName, FirstInitial., [...], YEARsuffix, Journal Volume, Page.
    //
    // Examples:
    // Cho, S., et al. (ExHIC Collaboration), 2011a, Phys. Rev. Lett. 106, 212001.
    // Weinstein, J. D., and N. Isgur, 1982, Phys. Rev. Lett. 48, 659.
    // Albaladejo, M., et al., 2017, Chin. Phys. C 41, 121001.

    // Strategy: Find all year occurrences with the pattern ", YEARx, " and extract
    // the author (before) and journal info (after)
    //
    // Key insight: In RMP format, the year is always preceded by ", " and followed by ", "
    // Format: ..., 2011a, Journal Vol, Page.
    //
    // Important: Journal names contain periods (e.g., "Phys. Rev. Lett."), so we can't use [^.]+
    // Instead, we capture until the final period that ends the reference entry.
    // The end of a reference is marked by: period followed by newline, or period followed by
    // the start of a new author name (capital letter + lowercase + comma).

    // Pattern breakdown:
    // ,\s*           - comma followed by optional whitespace (before year)
    // ((?:19|20)\d{2}[a-z]?) - year with optional suffix (capture group 1)
    // \s*,\s*        - comma with optional whitespace (after year)
    // (.+?)          - journal info, non-greedy (capture group 2)
    // \.             - final period
    // Lookahead options (extended to handle edge cases):
    //   - \s*\n       - period followed by whitespace and newline
    //   - \s*$        - period at end of string
    //   - \s+[A-Z]... - period followed by new author name (standard case)
    //                   NOTE: Use [a-z]+ (not {2,}) to support 2-letter surnames like "Li"
    //   - \s*\n.*\n\s*[A-Z]... - period followed by page header/footer then new author
    //   - \s+"        - period followed by quote (for titles in quotes)
    // Use extended character class to support German ß, umlauts, accents, etc.
    const yearPattern = new RegExp(
      `,\\s*((?:19|20)\\d{2}[a-z]?)\\s*,\\s*(.+?)\\.(?=\\s*\\n|\\s*$|\\s+[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+,|\\s*\\n[^\\n]*\\n\\s*[${AUTHOR_LETTER_UPPER}]|\\s+")`,
      "g",
    );
    let match: RegExpExecArray | null;

    while ((match = yearPattern.exec(refText)) !== null) {
      const yearWithSuffix = match[1];
      const journalPart = match[2].trim();

      // Find the author part: go backwards from the match to find "LastName, I."
      // The author is at the start of the reference line
      const beforeYear = refText.slice(
        Math.max(0, match.index - 300),
        match.index,
      );

      // Find the start of this reference entry.
      // RMP format: "Braaten, E., and M. Kusunoki, 2005a, Phys. Rev. D 71, 074005."
      // We need to find "Braaten" (first author), not "Kusunoki" (last listed author)
      //
      // Key insight for RMP-style author-year references:
      // - Multiple references appear on the same line, separated by "page. Author" pattern
      // - Newlines only occur at page boundaries (for headers/footers)
      // - Therefore, we should ALWAYS use the digit pattern first to find ref boundaries
      // - Only fall back to newline if digit pattern fails
      let refEntryStart = 0;
      const lastNewlineIdx = beforeYear.lastIndexOf("\n");

      // Function to find reference boundary using digit+period pattern
      // This is the PRIMARY method for RMP-style refs where multiple refs are on same line
      const findRefBoundaryByDigitPattern = (text: string): number => {
        const prevRefEndPattern = new RegExp(
          `\\d+\\.\\s+([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+),\\s*[${AUTHOR_LETTER_UPPER}][\\.\\-]`,
          "g",
        );
        const allPrevRefEnds = [...text.matchAll(prevRefEndPattern)];
        if (allPrevRefEnds.length > 0) {
          const lastMatch = allPrevRefEnds[allPrevRefEnds.length - 1];
          const fullMatch = lastMatch[0];
          const nameStartInMatch = fullMatch.indexOf(lastMatch[1]);
          return (lastMatch.index ?? 0) + nameStartInMatch;
        }
        return -1; // Return -1 to indicate no match found
      };

      // Helper: Check if text after newline is a page header/footer (not a reference start)
      // Used only as fallback when digit pattern fails
      const isPageHeader = (text: string): boolean => {
        const trimmed = text.trim();
        if (!trimmed) return true; // Empty line is not a reference start
        // Common page header patterns in physics papers
        const pageHeaderPatterns = [
          /^[A-Z][a-z]+\s+et\s+al\.:/i, // "Guo et al.:" running header
          /^Rev\.\s*Mod\.\s*Phys\./i, // Journal header
          /^Phys\.\s*Rev\./i, // Journal header
          /^\d{6}-\d+\s*$/, // Page number like "015004-52"
          /^Vol\.\s*\d+/i, // Volume header
          /^No\.\s*\d+/i, // Issue header
          /^[A-Z][A-Z\s]+$/, // All caps header
          /^January|February|March|April|May|June|July|August|September|October|November|December/i, // Month in header
        ];
        for (const pattern of pageHeaderPatterns) {
          if (pattern.test(trimmed)) return true;
        }
        return false;
      };

      // ALWAYS try digit pattern first - this is the reliable boundary for RMP-style refs
      const digitBoundary = findRefBoundaryByDigitPattern(beforeYear);

      if (digitBoundary >= 0) {
        // Found a digit pattern boundary - use it
        refEntryStart = digitBoundary;
      } else if (lastNewlineIdx >= 0) {
        // No digit pattern - fall back to newline if it's not a page header
        const afterNewline = beforeYear.slice(lastNewlineIdx + 1);
        if (!isPageHeader(afterNewline)) {
          refEntryStart = lastNewlineIdx + 1;
        }
        // If page header, refEntryStart stays at 0 (start of beforeYear)
      }
      // If no digit pattern and no valid newline, refEntryStart is 0

      // Extract first author from the reference entry start
      // Use extended character class to support German ß, umlauts, etc.
      const refEntryText = beforeYear.slice(refEntryStart);
      const firstAuthorPattern = new RegExp(
        `^\\s*([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+),\\s*[${AUTHOR_LETTER_UPPER}]\\.`,
      );
      const firstAuthorMatch = refEntryText.match(firstAuthorPattern);

      let firstAuthorLastName: string | null = null;
      if (firstAuthorMatch) {
        firstAuthorLastName = firstAuthorMatch[1];
      } else {
        // Fallback: try to find any capitalized name at line start
        const lineStartPattern = new RegExp(
          `^\\s*([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+),`,
        );
        const lineStartAuthor = refEntryText.match(lineStartPattern);
        if (lineStartAuthor) {
          firstAuthorLastName = lineStartAuthor[1];
        }
      }

      if (!firstAuthorLastName) {
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE-AY] Could not extract author for year ${yearWithSuffix}, refEntryText="${refEntryText.slice(0, 80)}..."`,
        );
        continue;
      }

      // Extract all author last names from refEntryText for disambiguation
      // Patterns to handle:
      // - "LastName, I." or "LastName, I.-J." (comma before initial)
      // - "and I. LastName" or "and I.-J. LastName" (after "and")
      // - ", I. LastName" (middle author without "and", e.g., "Artoisenet, P., E. Braaten, and D. Kang")
      //
      // IMPORTANT: Collect authors with their positions and sort by position at the end
      // to preserve the original order from the PDF text. This is critical for
      // selectBestPdfPaperInfo which uses author order to disambiguate papers.
      const authorMatches: Array<{ name: string; index: number }> = [];

      // Pattern 1: "LastName, I." format (e.g., "Guo, F.-K.", "Hidalgo-Duque, C.")
      // FIX: Added compound surname support (?:-[UPPER][lower]+)? to match "Hidalgo-Duque"
      const authorPattern1 = new RegExp(
        `([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+(?:-[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+)?),\\s*[${AUTHOR_LETTER_UPPER}][\\.\\-]`,
        "g",
      );
      let authorMatch;
      while ((authorMatch = authorPattern1.exec(refEntryText)) !== null) {
        const name = authorMatch[1];
        if (!authorMatches.some((m) => m.name === name)) {
          authorMatches.push({ name, index: authorMatch.index });
        }
      }

      // Pattern 2: "and I. LastName" format with any number of initials
      // Examples: "and W. Wang", "and C.-P. Shen", "and M. P. Valderrama", "and A. B. C. Smith"
      // FIX: Use (?:\s*-?[UPPER][.\-])* to handle multiple space-separated or hyphenated initials
      // FIX: Added compound surname support (?:-[UPPER][lower]+)? to match "Hidalgo-Duque"
      const authorPattern2 = new RegExp(
        `and\\s+[${AUTHOR_LETTER_UPPER}][\\.\\-](?:\\s*-?[${AUTHOR_LETTER_UPPER}][\\.\\-])*\\s*([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+(?:-[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+)?)`,
        "gi",
      );
      while ((authorMatch = authorPattern2.exec(refEntryText)) !== null) {
        const name = authorMatch[1];
        if (!authorMatches.some((m) => m.name === name)) {
          authorMatches.push({ name, index: authorMatch.index });
        }
      }

      // Pattern 3: ", I. LastName" (middle author without "and") with any number of initials
      // Examples: ", E. Braaten", ", U.-G. Meißner", ", M. P. Smith", ", A. B. C. Jones"
      // Must be preceded by comma+space and followed by comma or "and"
      // FIX: Use (?:\s*-?[UPPER][.\-])* to handle multiple space-separated or hyphenated initials
      // FIX: Added compound surname support (?:-[UPPER][lower]+)? to match "Hidalgo-Duque"
      const authorPattern3 = new RegExp(
        `,\\s+[${AUTHOR_LETTER_UPPER}][\\.\\-](?:\\s*-?[${AUTHOR_LETTER_UPPER}][\\.\\-])*\\s*([${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+(?:-[${AUTHOR_LETTER_UPPER}][${AUTHOR_LETTER_LOWER}]+)?)(?=,|\\s+and\\b)`,
        "gi",
      );
      while ((authorMatch = authorPattern3.exec(refEntryText)) !== null) {
        const name = authorMatch[1];
        // Skip if this is a partial match of a compound surname already in the list
        // e.g., skip "Duque" if "Hidalgo-Duque" is already present
        // e.g., skip "Soler" if "Fernandez-Soler" is already present
        const isPartOfExisting = authorMatches.some((existing) => {
          const existingLower = existing.name.toLowerCase();
          const nameLower = name.toLowerCase();
          // Check if existing name contains this name as part of a compound (with hyphen)
          return (
            existingLower.includes(`-${nameLower}`) ||
            existingLower.includes(`${nameLower}-`)
          );
        });
        if (!isPartOfExisting && !authorMatches.some((m) => m.name === name)) {
          authorMatches.push({ name, index: authorMatch.index });
        }
      }

      // Sort by position in text to preserve original author order
      authorMatches.sort((a, b) => a.index - b.index);
      const allAuthorLastNames = authorMatches.map((m) => m.name);

      // Build the full reference text for extractPaperInfo
      const fullRefText = refEntryText + match[0].slice(1); // Include ", year, journal."

      // Extract paper info using existing method
      const info = this.extractPaperInfo(fullRefText, false);

      // Override with our more reliable extracted values
      info.firstAuthorLastName = firstAuthorLastName;
      info.year = yearWithSuffix;
      info.allAuthorLastNames =
        allAuthorLastNames.length > 0
          ? allAuthorLastNames
          : [firstAuthorLastName];

      // Parse journal info directly from journalPart: "Phys. Rev. Lett. 106, 212001"
      // Pattern: Journal Name Volume, Page
      const jvpMatch = journalPart.match(/^(.+?)\s+(\d+)\s*,\s*(\d+)/);
      if (jvpMatch) {
        info.journalAbbrev = jvpMatch[1].trim();
        info.volume = jvpMatch[2];
        info.pageStart = jvpMatch[3];
      } else {
        // Try alternative pattern: "Journal Name Volume Page" (no comma)
        const jvpMatch2 = journalPart.match(/^(.+?)\s+(\d+)\s+(\d+)/);
        if (jvpMatch2) {
          info.journalAbbrev = jvpMatch2[1].trim();
          info.volume = jvpMatch2[2];
          info.pageStart = jvpMatch2[3];
        }
      }

      const hasJournal = !!info.journalAbbrev && !!info.volume;
      const hasStrongId = !!info.arxivId || !!info.doi;

      // Skip only if we lack both journal info and any strong identifier
      if (!hasJournal && !hasStrongId) {
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE-AY] Skipping ${firstAuthorLastName} ${yearWithSuffix}: no journal info from "${journalPart}"`,
        );
        continue;
      }

      // Always add - duplicates with same author+year but different co-authors/journals are allowed
      const key = `${firstAuthorLastName} ${yearWithSuffix}`.toLowerCase();
      results.push(info);
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE-AY] Parsed: ${key} -> ${info.journalAbbrev} ${info.volume}, ${info.pageStart} (authors: ${allAuthorLastNames.join(", ")})`,
      );
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE-AY] Extracted ${results.length} references from text`,
    );

    return results;
  }

  /**
   * Get author-year key from PDFPaperInfo.
   * Returns normalized "authorlastname year" for lookup.
   */
  static getAuthorYearKey(info: PDFPaperInfo): string | null {
    if (!info.firstAuthorLastName || !info.year) return null;
    return `${info.firstAuthorLastName} ${info.year}`.toLowerCase();
  }
}

/**
 * Author-year reference mapping from PDF
 * Maps "Author Year" (e.g., "Cho 2011a") -> PDFPaperInfo[]
 * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Enables precise matching for author-year citations
 *
 * Note: Uses array to handle multiple papers with same first author + year but different co-authors
 * e.g., "Guo 2014" -> [{Guo, Meißner, Wang -> Commun. Theor. Phys.}, {Guo, Hidalgo-Duque -> Eur. Phys. J.}]
 */
export interface AuthorYearReferenceMapping {
  /** Parse timestamp */
  parsedAt: number;
  /** "Author Year" -> paper infos array (e.g., "Cho 2011a" -> [{journal: "Phys. Rev. Lett.", ...}]) */
  authorYearMap: Map<string, PDFPaperInfo[]>;
  /** Total references found */
  totalReferences: number;
  /** Parse quality indicator */
  confidence: "high" | "medium" | "low";
}

// Singleton instance
let parserInstance: PDFReferencesParser | null = null;

export function getPDFReferencesParser(): PDFReferencesParser {
  if (!parserInstance) {
    parserInstance = new PDFReferencesParser();
  }
  return parserInstance;
}
