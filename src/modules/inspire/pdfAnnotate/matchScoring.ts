// ─────────────────────────────────────────────────────────────────────────────
// Match Scoring Utilities
// FTR-REFACTOR: Centralized scoring logic for PDF annotation matching
// ─────────────────────────────────────────────────────────────────────────────

import type { InspireReferenceEntry, InspireArxivDetails } from "../types";
import type { PDFPaperInfo } from "./pdfReferencesParser";
import { SCORE, YEAR_DELTA } from "./constants";
import {
  normalizeAuthorName,
  normalizeAuthorCompact,
  extractLastName,
  authorsMatch,
  buildInitialsPattern,
  buildDifferentInitialsPattern,
} from "./authorUtils";
import {
  getJournalAbbreviations,
  getJournalFullNames,
  normalizeJournalName,
} from "../../../utils/journalAbbreviations";

// ─────────────────────────────────────────────────────────────────────────────
// Identifier Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize arXiv ID for matching.
 * Handles various formats:
 * - "2301.12345v2" -> "2301.12345"
 * - "arXiv:2301.12345" -> "2301.12345"
 * - "hep-ph/0101234v1" -> "hep-ph/0101234"
 * - "https://arxiv.org/abs/2301.12345" -> "2301.12345"
 *
 * @param id - arXiv ID string or details object
 * @returns Normalized arXiv ID or null
 */
export function normalizeArxivId(
  id?: string | InspireArxivDetails | null
): string | null {
  if (!id) return null;
  let raw: string | undefined;
  if (typeof id === "string") {
    raw = id;
  } else if (typeof id === "object") {
    raw = id.id;
  }
  if (!raw) return null;

  let normalized = raw.toLowerCase().trim();

  // Remove URL prefix (https://arxiv.org/abs/ or /pdf/)
  normalized = normalized.replace(
    /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i,
    ""
  );

  // Remove arXiv: prefix
  normalized = normalized.replace(/^arxiv\s*:\s*/i, "");

  // Remove version suffix (v1, v2, ..., v99)
  normalized = normalized.replace(/v\d{1,2}$/i, "");

  // Remove trailing .pdf
  normalized = normalized.replace(/\.pdf$/i, "");

  // Validate format
  // New format: YYMM.NNNNN (after April 2007)
  if (/^\d{4}\.\d{4,5}$/.test(normalized)) {
    return normalized;
  }
  // Old format: subject-class/YYMMNNN (before 2007)
  if (/^[a-z-]+\/\d{7}$/.test(normalized)) {
    return normalized;
  }

  // Return as-is if it looks like an arXiv ID but doesn't match strict patterns
  if (/^\d{4}\.\d+/.test(normalized) || /^[a-z-]+\/\d+/.test(normalized)) {
    return normalized;
  }

  return null;
}

/**
 * Normalize DOI for matching.
 *
 * @param doi - DOI string
 * @returns Normalized DOI or null
 */
export function normalizeDoi(doi?: string | null): string | null {
  if (!doi) return null;
  return doi
    .toLowerCase()
    .replace(/[),.;]+$/, "")
    .trim();
}

/**
 * Strip parenthetical content from string.
 *
 * @param input - Input string
 * @returns String with parenthetical content removed
 */
export function stripParenthetical(input: string): string {
  return input.replace(/\s*\([^)]*\)/g, " ").trim();
}

/**
 * Normalize journal name for comparison.
 *
 * @param str - Journal name string
 * @returns Normalized journal name or null
 */
export function normalizeJournal(str?: string | null): string | null {
  if (!str) return null;
  const stripped = stripParenthetical(str);
  const normalized = normalizeJournalName(stripped);
  if (!normalized) return null;
  return normalized.replace(/\s+/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Journal Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build journal name variants for matching.
 * Includes abbreviations and full names.
 *
 * @param name - Journal name
 * @returns Set of normalized variants
 */
export function buildJournalVariants(name: string): Set<string> {
  const variants = new Set<string>();
  const pushNormalized = (val?: string | null) => {
    if (!val) return;
    const norm = normalizeJournalName(stripParenthetical(val));
    if (norm) {
      variants.add(norm);
      variants.add(norm.replace(/\s+/g, ""));
    }
  };

  pushNormalized(name);
  // From abbreviation list of this name
  for (const abbr of getJournalAbbreviations(name)) {
    pushNormalized(abbr);
    for (const full of getJournalFullNames(abbr)) {
      pushNormalized(full);
    }
  }
  // If the input itself is an abbreviation, expand to full names
  for (const full of getJournalFullNames(name)) {
    pushNormalized(full);
  }
  return variants;
}

/**
 * Get longest common prefix length between two strings.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Length of longest common prefix
 */
export function longestCommonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) {
    i++;
  }
  return i;
}

/**
 * Compare journal strings with normalization and abbreviation expansion.
 * Treats strings equivalent if normalized forms intersect or have long common prefix.
 *
 * @param a - First journal string
 * @param b - Second journal string
 * @returns true if journals are similar
 */
export function journalsSimilar(
  a?: string | null,
  b?: string | null
): boolean {
  if (!a || !b) return false;
  const variantsA = buildJournalVariants(a);
  const variantsB = buildJournalVariants(b);
  for (const v of variantsA) {
    if (variantsB.has(v)) {
      return true;
    }
  }

  // Fallback: compact prefix similarity
  const compactA = normalizeJournal(a);
  const compactB = normalizeJournal(b);
  if (compactA && compactB) {
    const lcp = longestCommonPrefixLength(compactA, compactB);
    const minLen = Math.min(compactA.length, compactB.length);
    if (minLen >= 6 && lcp >= minLen - 2) {
      return true;
    }
  }
  return false;
}

/**
 * Check if journal + volume + page match between PDF paper and INSPIRE entry.
 *
 * @param pdfPaper - PDF paper info
 * @param entry - INSPIRE entry
 * @returns true if journal info matches
 */
export function isJournalMatch(
  pdfPaper: PDFPaperInfo,
  entry: InspireReferenceEntry
): boolean {
  if (!pdfPaper.journalAbbrev || !pdfPaper.volume) return false;
  const pub = entry.publicationInfo;
  if (!pub) return false;
  const journalClose = journalsSimilar(pdfPaper.journalAbbrev, pub.journal_title);
  const entryVol = pub.journal_volume || pub.volume;
  const volOk = entryVol ? String(entryVol) === String(pdfPaper.volume) : false;
  const entryPage = pub.page_start || pub.artid;
  const pageOk =
    pdfPaper.pageStart && entryPage
      ? String(entryPage) === pdfPaper.pageStart
      : false;
  if (journalClose && volOk) {
    if (pdfPaper.pageStart && entryPage) {
      return pageOk;
    }
    return true;
  }
  // Accept volume + page alignment even if journal strings differ
  if (volOk && pageOk) {
    return true;
  }
  return false;
}

/**
 * Compute publication match priority score for sorting (volume/page emphasis).
 * Higher = better match.
 */
export function computePublicationPriority(
  pdfPaper: PDFPaperInfo | undefined,
  entry: InspireReferenceEntry,
): number {
  if (!pdfPaper || !entry.publicationInfo) return 0;
  const pub = entry.publicationInfo;
  let score = 0;
  const journalMatch =
    pdfPaper.journalAbbrev && journalsSimilar(pdfPaper.journalAbbrev, pub.journal_title);
  if (journalMatch) score += 1;
  const volMatch =
    pdfPaper.volume && pub.journal_volume && String(pdfPaper.volume) === String(pub.journal_volume);
  const pageMatch =
    pdfPaper.pageStart && pub.page_start && String(pdfPaper.pageStart) === String(pub.page_start);
  if (volMatch) score += 2;
  if (pageMatch) score += 2;
  if (volMatch && pageMatch) score += 1; // bonus for both
  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite Score Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result from composite scoring.
 */
export interface CompositeScore {
  /** Total score */
  total: number;
  /** Whether arXiv matched */
  arxivMatch: boolean;
  /** Whether DOI matched */
  doiMatch: boolean;
  /** Whether journal matched */
  journalMatch: boolean;
  /** Whether author matched */
  authorMatch: boolean;
  /** Year difference (null if no year info) */
  yearDelta: number | null;
  /** Breakdown of score components */
  breakdown: {
    arxiv: number;
    doi: number;
    author: number;
    year: number;
    page: number;
    journal: number;
  };
}

/**
 * Calculate composite match score between a PDF paper and an INSPIRE entry.
 * This is the main scoring function used for matching.
 *
 * @param pdfPaper - PDF paper info
 * @param entry - INSPIRE entry to match against
 * @returns Composite score with breakdown
 */
export function calculateCompositeScore(
  pdfPaper: PDFPaperInfo,
  entry: InspireReferenceEntry
): CompositeScore {
  const breakdown = {
    arxiv: 0,
    doi: 0,
    author: 0,
    year: 0,
    page: 0,
    journal: 0,
  };

  let arxivMatch = false;
  let doiMatch = false;
  let journalMatch = false;
  let authorMatch = false;
  let yearDelta: number | null = null;

  // arXiv exact match - highest priority
  const pdfArxiv = normalizeArxivId(pdfPaper.arxivId);
  const entryArxiv = normalizeArxivId(entry.arxivDetails);
  if (pdfArxiv && entryArxiv && pdfArxiv === entryArxiv) {
    breakdown.arxiv = SCORE.ARXIV_EXACT;
    arxivMatch = true;
    return {
      total: SCORE.ARXIV_EXACT,
      arxivMatch,
      doiMatch,
      journalMatch,
      authorMatch,
      yearDelta,
      breakdown,
    };
  }

  // DOI exact match
  const pdfDoi = normalizeDoi(pdfPaper.doi);
  const entryDoi = normalizeDoi(entry.doi);
  if (pdfDoi && entryDoi && pdfDoi === entryDoi) {
    breakdown.doi = SCORE.DOI_EXACT;
    doiMatch = true;
    return {
      total: SCORE.DOI_EXACT,
      arxivMatch,
      doiMatch,
      journalMatch,
      authorMatch,
      yearDelta,
      breakdown,
    };
  }

  const pdfAuthorRaw = pdfPaper.firstAuthorLastName?.toLowerCase();
  const pdfAuthor = pdfAuthorRaw ? normalizeAuthorCompact(pdfAuthorRaw) : undefined;
  const pdfRaw = pdfPaper.rawText?.toLowerCase() || "";

  // Author match
  if (pdfAuthor && entry.authors?.length) {
    const inspireAuthorRaw = extractLastName(entry.authors[0].toLowerCase());
    const inspireAuthor = inspireAuthorRaw
      ? normalizeAuthorCompact(inspireAuthorRaw)
      : "";

    if (pdfAuthor && inspireAuthor && pdfAuthor === inspireAuthor) {
      breakdown.author = SCORE.AUTHOR_EXACT;
      authorMatch = true;
    } else if (
      pdfAuthor &&
      inspireAuthor &&
      (inspireAuthor.includes(pdfAuthor) || pdfAuthor.includes(inspireAuthor))
    ) {
      breakdown.author = SCORE.AUTHOR_PARTIAL;
      authorMatch = true;
    }
  }

  // AuthorText fallback
  if (pdfAuthor && breakdown.author < SCORE.AUTHOR_PARTIAL && entry.authorText) {
    if (entry.authorText.toLowerCase().includes(pdfAuthor)) {
      breakdown.author = SCORE.AUTHOR_IN_TEXT;
      authorMatch = true;
    }
  }

  // Phrase-level fallback for "data group" style
  if (breakdown.author < SCORE.AUTHOR_PARTIAL && entry.authorText) {
    const at = entry.authorText.toLowerCase();
    if (pdfRaw.includes("data group") && at.includes("data group")) {
      breakdown.author = SCORE.AUTHOR_IN_TEXT;
      authorMatch = true;
    }
  }

  // Year match (graduated scoring)
  if (pdfPaper.year && entry.year) {
    yearDelta = Math.abs(
      parseInt(pdfPaper.year, 10) - parseInt(entry.year, 10)
    );
    if (yearDelta === 0) {
      breakdown.year = SCORE.YEAR_EXACT;
    } else if (yearDelta <= YEAR_DELTA.CLOSE) {
      breakdown.year = SCORE.YEAR_CLOSE;
    } else if (yearDelta <= YEAR_DELTA.REASONABLE) {
      breakdown.year = SCORE.YEAR_REASONABLE;
    } else if (yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE) {
      breakdown.year = SCORE.YEAR_ACCEPTABLE;
    }
  }

  // Page match
  if (pdfPaper.pageStart && entry.publicationInfo) {
    const pubInfo = entry.publicationInfo;
    const pageStart = pubInfo.page_start || pubInfo.artid;
    if (pageStart && String(pageStart) === pdfPaper.pageStart) {
      breakdown.page = SCORE.PAGE_MATCH;
    }
  }

  // Journal + volume match
  journalMatch = isJournalMatch(pdfPaper, entry);
  if (journalMatch) {
    breakdown.journal = SCORE.JOURNAL_MATCH;
  }

  const total =
    breakdown.arxiv +
    breakdown.doi +
    breakdown.author +
    breakdown.year +
    breakdown.page +
    breakdown.journal;

  return {
    total,
    arxivMatch,
    doiMatch,
    journalMatch,
    authorMatch,
    yearDelta,
    breakdown,
  };
}

/**
 * Get strong match kind (arXiv/DOI/journal) between PDF paper and INSPIRE entry.
 * Returns null if no strong match found.
 *
 * @param pdfPaper - PDF paper info
 * @param entry - INSPIRE entry
 * @returns Strong match info or null
 */
export function getStrongMatchKind(
  pdfPaper: PDFPaperInfo,
  entry: InspireReferenceEntry
): { kind: "arxiv" | "doi" | "journal"; score: number } | null {
  // arXiv exact
  const pdfArxiv = normalizeArxivId(pdfPaper.arxivId);
  const entryArxiv = normalizeArxivId(entry.arxivDetails);
  if (pdfArxiv && entryArxiv && pdfArxiv === entryArxiv) {
    return { kind: "arxiv", score: SCORE.ARXIV_EXACT };
  }

  // DOI exact
  const pdfDoi = normalizeDoi(pdfPaper.doi);
  const entryDoi = normalizeDoi(entry.doi);
  if (pdfDoi && entryDoi && pdfDoi === entryDoi) {
    return { kind: "doi", score: SCORE.DOI_EXACT };
  }

  // Journal + volume (+page) + author/year
  if (pdfPaper.journalAbbrev && pdfPaper.volume && entry.publicationInfo) {
    const pub = entry.publicationInfo;
    const journalClose = journalsSimilar(pdfPaper.journalAbbrev, pub.journal_title);
    const entryVol = pub.journal_volume || pub.volume;
    const volOk = entryVol ? String(entryVol) === String(pdfPaper.volume) : false;
    const entryPage = pub.page_start || pub.artid;
    const pageOk =
      pdfPaper.pageStart && entryPage
        ? String(entryPage) === pdfPaper.pageStart
        : false;
    const yearOk =
      pdfPaper.year && entry.year
        ? Math.abs(parseInt(pdfPaper.year, 10) - parseInt(entry.year, 10)) <=
          YEAR_DELTA.MAX_ACCEPTABLE
        : false;

    let authorOk = false;
    if (pdfPaper.firstAuthorLastName) {
      const pdfAuthor = normalizeAuthorCompact(pdfPaper.firstAuthorLastName);
      const inspireAuthorRaw = entry.authors?.[0]?.toLowerCase?.();
      const inspireAuthor = inspireAuthorRaw
        ? normalizeAuthorCompact(extractLastName(inspireAuthorRaw))
        : null;
      if (
        pdfAuthor &&
        inspireAuthor &&
        (pdfAuthor === inspireAuthor ||
          inspireAuthor.includes(pdfAuthor) ||
          pdfAuthor.includes(inspireAuthor))
      ) {
        authorOk = true;
      }
      if (!authorOk && entry.authorText) {
        authorOk = entry.authorText
          .toLowerCase()
          .includes(pdfPaper.firstAuthorLastName.toLowerCase());
      }
    }

    if (volOk && (pageOk || yearOk) && authorOk) {
      let score = 6;
      if (journalClose) score += 2;
      if (pageOk) score += 2;
      if (yearOk) score += 1;
      return { kind: "journal", score };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Author-Year Specific Scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score PDF paper info candidates for author-year matching.
 * Returns sorted array of candidates with their scores for tie detection.
 *
 * @param candidates - PDF paper info candidates
 * @param targetAuthors - Author names from citation
 * @param isEtAl - Whether citation uses "et al."
 * @param targetAuthorInitials - Optional author initials for disambiguation
 * @returns Array of {pdfInfo, score} sorted by score descending
 */
export function scorePdfPaperInfos(
  candidates: PDFPaperInfo[],
  targetAuthors: string[],
  isEtAl: boolean = false,
  targetAuthorInitials?: Map<string, string>
): Array<{ pdfInfo: PDFPaperInfo; score: number }> {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    return [{ pdfInfo: candidates[0], score: 0 }];
  }

  // Apply author count filter first
  let filteredCandidates = candidates;

  if (!isEtAl && targetAuthors.length <= 2) {
    const expectedAuthorCount = targetAuthors.length;
    const filtered = candidates.filter((c) => {
      const authorCount = c.allAuthorLastNames?.length || 0;
      return authorCount === 0 || authorCount === expectedAuthorCount;
    });
    if (filtered.length > 0) {
      filteredCandidates = filtered;
    }
  } else if (isEtAl && targetAuthors.length === 1) {
    const filtered = candidates.filter(
      (c) =>
        (c.allAuthorLastNames?.length || 0) === 0 ||
        (c.allAuthorLastNames?.length || 0) > 3
    );
    if (filtered.length > 0) {
      filteredCandidates = filtered;
    }
  }

  // Apply initials filter if provided
  if (targetAuthorInitials && targetAuthorInitials.size > 0) {
    const initialPatterns: Array<{
      author: string;
      initials: string;
      pattern: RegExp;
    }> = [];
    for (const [author, initials] of targetAuthorInitials) {
      const pattern = buildInitialsPattern(author, initials);
      initialPatterns.push({ author, initials, pattern });
    }

    if (initialPatterns.length > 0) {
      const matchingCandidates = filteredCandidates.filter((c) => {
        for (const { pattern } of initialPatterns) {
          if (pattern.test(c.rawText)) return true;
        }
        return false;
      });
      if (matchingCandidates.length > 0) {
        filteredCandidates = matchingCandidates;
      }
    }
  }

  // Pre-sort by second author alphabetically (RMP style)
  if (targetAuthors.length === 1) {
    filteredCandidates = [...filteredCandidates].sort((a, b) => {
      const aSecond = a.allAuthorLastNames?.[1]?.toLowerCase() || "";
      const bSecond = b.allAuthorLastNames?.[1]?.toLowerCase() || "";
      return aSecond.localeCompare(bSecond);
    });
  }

  // Calculate scores for each candidate
  const normalizedTargetAuthors = targetAuthors.map((a) =>
    normalizeAuthorName(a)
  );
  const scored: Array<{ pdfInfo: PDFPaperInfo; score: number }> = [];

  for (const candidate of filteredCandidates) {
    let score = 0;

    if (candidate.allAuthorLastNames && candidate.allAuthorLastNames.length > 0) {
      const candidateAuthors = candidate.allAuthorLastNames.map((a) =>
        normalizeAuthorName(a)
      );

      // Count matching authors
      let matchedTargetCount = 0;
      for (const targetAuthor of normalizedTargetAuthors) {
        for (const candAuthor of candidateAuthors) {
          if (authorsMatch(targetAuthor, candAuthor)) {
            matchedTargetCount++;
            break;
          }
        }
      }

      let matchedCandCount = 0;
      for (const candAuthor of candidateAuthors) {
        for (const targetAuthor of normalizedTargetAuthors) {
          if (authorsMatch(targetAuthor, candAuthor)) {
            matchedCandCount++;
            break;
          }
        }
      }

      // Author order bonus
      let orderBonus = 0;
      if (normalizedTargetAuthors.length >= 2) {
        let positionsMatch = true;
        for (
          let i = 0;
          i < normalizedTargetAuthors.length && i < candidateAuthors.length;
          i++
        ) {
          if (!authorsMatch(normalizedTargetAuthors[i], candidateAuthors[i])) {
            positionsMatch = false;
            break;
          }
        }
        if (positionsMatch) {
          orderBonus = 10;
        }
      }

      const extraUnmatchedInCandidate = candidateAuthors.length - matchedCandCount;
      const unmatchedTargets = normalizedTargetAuthors.length - matchedTargetCount;
      const extraPenalty =
        normalizedTargetAuthors.length === 1 ? 0 : extraUnmatchedInCandidate;

      score = matchedTargetCount - extraPenalty - unmatchedTargets + orderBonus;
    } else {
      // Fallback: check rawText
      const rawTextLower = candidate.rawText.toLowerCase();
      for (const targetAuthor of normalizedTargetAuthors) {
        if (rawTextLower.includes(targetAuthor)) {
          score++;
        }
      }
    }

    scored.push({ pdfInfo: candidate, score });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Select the best matching PDFPaperInfo from multiple candidates based on co-authors.
 *
 * @param candidates - Array of PDFPaperInfo with same first author + year
 * @param targetAuthors - Author names from the citation
 * @param isEtAl - Whether citation uses "et al."
 * @param targetAuthorInitials - Optional author initials for disambiguation
 * @returns Best matching PDFPaperInfo
 */
export function selectBestPdfPaperInfo(
  candidates: PDFPaperInfo[],
  targetAuthors: string[],
  isEtAl: boolean = false,
  targetAuthorInitials?: Map<string, string>
): PDFPaperInfo {
  if (candidates.length === 1) {
    return candidates[0];
  }

  const scored = scorePdfPaperInfos(
    candidates,
    targetAuthors,
    isEtAl,
    targetAuthorInitials
  );
  return scored[0]?.pdfInfo ?? candidates[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Score Entry for Fuzzy Author-Year Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result from scoring an entry for author-year matching.
 */
export interface AuthorYearScore {
  /** Entry index */
  idx: number;
  /** Total score */
  score: number;
  /** Whether year matched */
  yearMatched: boolean;
  /** Entry reference */
  entry: InspireReferenceEntry;
}

/**
 * Score an INSPIRE entry for author-year matching.
 *
 * @param entry - INSPIRE entry
 * @param idx - Entry index
 * @param targetAuthors - Target author names (normalized)
 * @param targetYearBase - Target year without suffix
 * @param isEtAl - Whether citation uses "et al."
 * @param targetAuthorInitials - Optional author initials
 * @param pdfPaperInfo - Optional PDF paper info for volume/page disambiguation
 * @returns Score result
 */
export function scoreEntryForAuthorYear(
  entry: InspireReferenceEntry,
  idx: number,
  targetAuthors: string[],
  targetYearBase: string | null,
  isEtAl: boolean,
  targetAuthorInitials?: Map<string, string>,
  pdfPaperInfo?: { volume?: string; pageStart?: string } | null
): AuthorYearScore {
  let score = 0;
  let yearMatched = false;

  // Year match
  if (targetYearBase && entry.year) {
    const entryYear = entry.year.replace(/[a-z]$/i, "");
    if (entryYear === targetYearBase) {
      score += 3;
      yearMatched = true;
    } else if (
      Math.abs(parseInt(entryYear, 10) - parseInt(targetYearBase, 10)) === 1
    ) {
      score += 1;
    }
  }

  // Author match
  if (targetAuthors.length > 0 && entry.authors && entry.authors.length > 0) {
    let authorMatchCount = 0;
    const entryAuthorsLower = entry.authors.map((a) =>
      extractLastName(a).toLowerCase()
    );

    for (const targetAuthor of targetAuthors) {
      if (entryAuthorsLower.some((ea) => ea === targetAuthor)) {
        authorMatchCount++;
        continue;
      }
      if (
        entryAuthorsLower.some(
          (ea) => ea.includes(targetAuthor) || targetAuthor.includes(ea)
        )
      ) {
        authorMatchCount += 0.5;
      }
    }

    if (authorMatchCount > 0) {
      const firstAuthorMatched =
        entryAuthorsLower[0] === targetAuthors[0] ||
        entryAuthorsLower[0]?.includes(targetAuthors[0]) ||
        targetAuthors[0]?.includes(entryAuthorsLower[0]);

      if (firstAuthorMatched) {
        score += 5;
      }
      score += Math.min(authorMatchCount * 1.5, 4);
    }
  }

  // AuthorText fallback
  if (targetAuthors.length > 0 && entry.authorText) {
    const authorText = entry.authorText.toLowerCase();
    let textMatchCount = 0;
    let firstAuthorInText = false;
    for (let i = 0; i < targetAuthors.length; i++) {
      if (authorText.includes(targetAuthors[i])) {
        textMatchCount++;
        if (i === 0) firstAuthorInText = true;
      }
    }
    if (textMatchCount > 0 && score < 5) {
      if (firstAuthorInText) {
        score += 4;
      }
      score += Math.min(textMatchCount * 1.5, 3);
    }
  }

  // Author count scoring
  if (entry.authors && entry.authors.length > 0) {
    const entryAuthorCount = entry.authors.length;
    if (!isEtAl && targetAuthors.length <= 2) {
      if (entryAuthorCount === targetAuthors.length) {
        score += 3;
      } else {
        score -= 5;
      }
    } else if (isEtAl) {
      if (entryAuthorCount > 2) {
        score += 1;
      } else {
        score -= 3;
      }
    }
  }

  // Author initials scoring
  if (targetAuthorInitials && targetAuthorInitials.size > 0 && entry.authorText) {
    let initialMatchScore = 0;
    let initialMismatchPenalty = 0;

    for (const [author, initials] of targetAuthorInitials) {
      const pattern = buildInitialsPattern(author, initials);

      if (pattern.test(entry.authorText)) {
        initialMatchScore += 15;
      } else if (entry.authorText.toLowerCase().includes(author)) {
        if (buildDifferentInitialsPattern(author).test(entry.authorText)) {
          initialMismatchPenalty += 12;
        }
      }
    }

    score += initialMatchScore;
    score -= initialMismatchPenalty;
  }

  // Volume/page disambiguation for year suffix
  if (pdfPaperInfo && yearMatched && entry.publicationInfo) {
    const pub = entry.publicationInfo;
    let pubMatchScore = 0;

    if (pdfPaperInfo.volume && pub.journal_volume) {
      if (pub.journal_volume === pdfPaperInfo.volume) {
        pubMatchScore += 10;
      } else {
        pubMatchScore -= 8;
      }
    }

    if (pdfPaperInfo.pageStart && pub.page_start) {
      if (pub.page_start === pdfPaperInfo.pageStart) {
        pubMatchScore += 5;
      }
    }

    score += pubMatchScore;
  }

  return { idx, score, yearMatched, entry };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic Best Match Utilities
// FTR-REFACTOR: Higher-order functions to reduce repetitive for-loops
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result from findBestMatch or findAllMatches.
 */
export interface ScoredMatch<T> {
  /** Entry index in the entries array */
  index: number;
  /** The matched entry */
  entry: InspireReferenceEntry;
  /** Match score */
  score: number;
  /** Additional data from the scoring function */
  data: T;
}

/**
 * Find the best matching entry using a scoring function.
 * Reduces repetitive for-loops throughout labelMatcher.
 *
 * @param entries - Array of INSPIRE entries to search
 * @param scoreFn - Function that scores each entry, returns null to skip
 * @param options - Optional configuration (minScore, excludeIndices)
 * @returns Best match or null if none found
 *
 * @example
 * ```typescript
 * const best = findBestMatch(entries, (entry, idx) => {
 *   const score = calculateMatchScore(pdfPaper, entry);
 *   if (score < 3) return null;
 *   return { score, data: { yearOk: score > 5 } };
 * }, { minScore: 4 });
 * ```
 */
export function findBestMatch<T>(
  entries: InspireReferenceEntry[],
  scoreFn: (entry: InspireReferenceEntry, index: number) => { score: number; data: T } | null,
  options: {
    minScore?: number;
    excludeIndices?: Set<number>;
  } = {},
): ScoredMatch<T> | null {
  const { minScore = 0, excludeIndices } = options;
  let best: ScoredMatch<T> | null = null;

  for (let i = 0; i < entries.length; i++) {
    if (excludeIndices?.has(i)) continue;

    const result = scoreFn(entries[i], i);
    if (!result || result.score < minScore) continue;

    if (!best || result.score > best.score) {
      best = {
        index: i,
        entry: entries[i],
        score: result.score,
        data: result.data,
      };
    }
  }
  return best;
}

/**
 * Find all matching entries using a scoring function.
 * Returns results sorted by score descending.
 *
 * @param entries - Array of INSPIRE entries to search
 * @param scoreFn - Function that scores each entry, returns null to skip
 * @param options - Optional configuration (minScore, maxResults, excludeIndices)
 * @returns Array of matches sorted by score descending
 *
 * @example
 * ```typescript
 * const matches = findAllMatches(entries, (entry, idx) => {
 *   const score = calculateMatchScore(pdfPaper, entry);
 *   return score >= 3 ? { score, data: { idx } } : null;
 * }, { maxResults: 5 });
 * ```
 */
export function findAllMatches<T>(
  entries: InspireReferenceEntry[],
  scoreFn: (entry: InspireReferenceEntry, index: number) => { score: number; data: T } | null,
  options: {
    minScore?: number;
    maxResults?: number;
    excludeIndices?: Set<number>;
  } = {},
): ScoredMatch<T>[] {
  const { minScore = 0, maxResults, excludeIndices } = options;
  const results: ScoredMatch<T>[] = [];

  for (let i = 0; i < entries.length; i++) {
    if (excludeIndices?.has(i)) continue;

    const result = scoreFn(entries[i], i);
    if (!result || result.score < minScore) continue;

    results.push({
      index: i,
      entry: entries[i],
      score: result.score,
      data: result.data,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return maxResults ? results.slice(0, maxResults) : results;
}
