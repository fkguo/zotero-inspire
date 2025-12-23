import { AcknowledgmentSection } from "./types";

const FOOTNOTE_SEARCH_LIMIT = 2000;

const SECTION_START_PATTERNS: Array<{ 
  pattern: RegExp;
  source: AcknowledgmentSection["source"];
}> = [
  // English standard sections
  // Allow Acknowledgments to be followed by colon, dot, hyphen, or just space/text
  // e.g. "Acknowledgements We are grateful..."
  {
    pattern: /(?:^|\n)\s*ACKNOWLEDGM?ENTS?(?:\s*[:.\-–—]|\s+)/i,
    source: "acknowledgments",
  },
  {
    pattern:
      /(?:^|\n)\s*FUNDING(?:\s+(?:AND\s+)?ACKNOWLEDGM?ENTS?)?(?:\s*[:.\-–—]|\s+)/i,
    source: "funding",
  },
  {
    pattern: /(?:^|\n)\s*FINANCIAL\s+SUPPORT(?:\s*[:.\-–—]|\s+)/i,
    source: "funding",
  },
  {
    pattern: /(?:^|\n)\s*GRANT\s+(?:SUPPORT|INFORMATION)(?:\s*[:.\-–—]|\s+)/i,
    source: "funding",
  },
  {
    pattern: /(?:^|\n)\s*SUPPORT(?:ING)?\s+INFORMATION(?:\s*[:.\-–—]|\s+)/i,
    source: "funding",
  },
  // Chinese sections
  { pattern: /(?:^|\n)\s*致\s*谢(?:\s*[:.\-–—]|\s+)/, source: "acknowledgments" },
  {
    pattern: /(?:^|\n)\s*基金(?:资助)?项目(?:\s*[:.\-–—]|\s+)/,
    source: "funding",
  },
  {
    pattern: /(?:^|\n)\s*(?:项目)?资助(?:信息)?(?:\s*[:.\-–—]|\s+)/,
    source: "funding",
  },
  // Footnote markers (need special handling)
  { pattern: /(?:收稿日期|基金项目|资助项目)[：:]\s*/m, source: "footnote" },
];

const SECTION_END_PATTERNS = [
  /(?:^|\n)\s*REFERENCES?\s*(?:\n|$)/i,
  /(?:^|\n)\s*BIBLIOGRAPHY\s*(?:\n|$)/i,
  /(?:^|\n)\s*参考文献\s*(?:\n|$)/,
  /(?:^|\n)\s*APPENDIX/i,
  /(?:^|\n)\s*附录\s*(?:\n|$)/,
  /(?:^|\n)\s*AUTHOR\s+CONTRIBUTIONS?\s*(?:\n|$)/i,
  /(?:^|\n)\s*(?:DECLARATION\s+OF\s+)?CONFLICT(?:S)?\s+OF\s+INTEREST/i,
  /(?:^|\n)\s*DATA\s+AVAILABILITY/i,
  /(?:^|\n)\s*ORCID/i,
];

export function extractAcknowledgmentSection(
  pdfText: string,
): AcknowledgmentSection | null {
  // Try to match various start patterns by priority
  let bestMatch: { 
    startIndex: number;
    source: AcknowledgmentSection["source"];
    matchLength: number;
  } | null = null;

  for (const { pattern, source } of SECTION_START_PATTERNS) {
    const match = pdfText.match(pattern);
    if (match && match.index !== undefined) {
      // Prioritize acknowledgments and funding sections
      const priority = 
        source === "acknowledgments" ? 3 : source === "funding" ? 2 : 1;
      const currentBestPriority = bestMatch
        ? bestMatch.source === "acknowledgments"
          ? 3
          : bestMatch.source === "funding"
            ? 2
            : 1
        : 0;

      if (!bestMatch || priority > currentBestPriority) {
        bestMatch = {
          startIndex: match.index + match[0].length,
          source,
          matchLength: match[0].length,
        };
      }
    }
  }

  if (!bestMatch) {
    // Fallback: Search in full text
    return {
      startIndex: 0,
      endIndex: pdfText.length,
      text: pdfText,
      language: detectLanguage(pdfText),
      source: "full_text",
    };
  }

  // Determine end position
  const remaining = pdfText.slice(bestMatch.startIndex);
  let endOffset = remaining.length;

  for (const pattern of SECTION_END_PATTERNS) {
    const match = remaining.match(pattern);
    if (match && match.index !== undefined && match.index < endOffset) {
      endOffset = match.index;
    }
  }

  // For footnotes, limit search range
  if (bestMatch.source === "footnote") {
    endOffset = Math.min(endOffset, FOOTNOTE_SEARCH_LIMIT);
  }

  const text = remaining.slice(0, endOffset).trim();

  return {
    startIndex: bestMatch.startIndex,
    endIndex: bestMatch.startIndex + endOffset,
    text,
    language: detectLanguage(text),
    source: bestMatch.source,
  };
}

function detectLanguage(text: string): "en" | "zh" | "mixed" {
  const hasChinese = /[一-鿿]/.test(text);
  const hasEnglish = /[a-zA-Z]{3,}/.test(text);
  if (hasChinese && hasEnglish) return "mixed";
  if (hasChinese) return "zh";
  return "en";
}
