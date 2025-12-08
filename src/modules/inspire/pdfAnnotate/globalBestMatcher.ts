// ─────────────────────────────────────────────────────────────────────────────
// Global Best Matcher
// FTR-PDF-MATCHING: Centralized global search logic for PDF-INSPIRE matching
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import type { InspireReferenceEntry, InspireArxivDetails } from "../types";
import type { PDFPaperInfo } from "./pdfReferencesParser";
import { SCORE, YEAR_DELTA, type MatchConfidence, type MatchMethod } from "./constants";

/**
 * Result from global best match search.
 */
export interface GlobalMatchResult {
  /** Index in entries array */
  idx: number;
  /** Match score */
  score: number;
  /** How the match was found */
  method: "arxiv" | "doi" | "journal" | "year" | "score";
  /** Year difference (if applicable) */
  yearDelta: number | null;
  /** Match confidence level */
  confidence: MatchConfidence;
  /** The PDF paper that matched */
  paper: PDFPaperInfo;
  /** The matched INSPIRE entry */
  entry: InspireReferenceEntry;
}

/**
 * Internal candidate during search.
 */
interface MatchCandidate {
  idx: number;
  score: number;
  yearOk: boolean;
  yearDelta: number | null;
  arxivOk: boolean;
  doiOk: boolean;
  paper: PDFPaperInfo;
}

/**
 * Options for GlobalBestMatcher.
 */
export interface GlobalMatcherOptions {
  /** Include DOI in search (default: true) */
  includeDoiSearch?: boolean;
  /** Score calculator function */
  scoreCalculator: (paper: PDFPaperInfo, entry: InspireReferenceEntry) => number;
  /** arXiv ID normalizer function */
  arxivNormalizer: (id: string | InspireArxivDetails | null | undefined) => string | null;
  /** DOI normalizer function */
  doiNormalizer: (doi: string | null | undefined) => string | null;
}

/**
 * Centralized global search for finding best INSPIRE match for PDF papers.
 * Consolidates the repeated search logic from labelMatcher.ts.
 *
 * Search priority:
 * 1. arXiv ID exact match (highest confidence)
 * 2. DOI exact match (high confidence)
 * 3. Year-matched with good score (medium confidence)
 * 4. Best score overall (low confidence)
 */
export class GlobalBestMatcher {
  private entries: InspireReferenceEntry[];
  private options: GlobalMatcherOptions;

  constructor(
    entries: InspireReferenceEntry[],
    options: GlobalMatcherOptions
  ) {
    this.entries = entries;
    this.options = {
      includeDoiSearch: true,
      ...options,
    };
  }

  /**
   * Find the best matching INSPIRE entry for given PDF papers.
   * Searches all entries and returns the best match based on priority:
   * arXiv > DOI > year-matched > highest score.
   *
   * @param paperInfos - Array of PDF paper info to match
   * @param searchIndices - Optional indices to limit search scope
   * @returns Best match result or null if no acceptable match found
   */
  findBest(
    paperInfos: PDFPaperInfo[],
    searchIndices?: number[]
  ): GlobalMatchResult | null {
    let bestAny: MatchCandidate | null = null;
    let bestYearOk: MatchCandidate | null = null;
    let bestArxiv: MatchCandidate | null = null;
    let bestDoi: MatchCandidate | null = null;

    const indicesToSearch = searchIndices ?? this.entries.map((_, i) => i);

    for (const paper of paperInfos) {
      // Skip erratum entries for primary matching
      if (paper.isErratum) continue;

      const pdfArxivNorm = this.options.arxivNormalizer(paper.arxivId);
      const pdfDoiNorm = this.options.includeDoiSearch
        ? this.options.doiNormalizer(paper.doi)
        : null;

      for (const i of indicesToSearch) {
        if (i < 0 || i >= this.entries.length) continue;

        const entry = this.entries[i];
        const candidate = this.evaluateCandidate(
          paper,
          entry,
          i,
          pdfArxivNorm,
          pdfDoiNorm
        );

        // Update best candidates
        if (!bestAny || candidate.score > bestAny.score) {
          bestAny = candidate;
        }
        if (candidate.yearOk && (!bestYearOk || candidate.score > bestYearOk.score)) {
          bestYearOk = candidate;
        }
        if (candidate.arxivOk && (!bestArxiv || candidate.score > bestArxiv.score)) {
          bestArxiv = candidate;
        }
        if (candidate.doiOk && (!bestDoi || candidate.score > bestDoi.score)) {
          bestDoi = candidate;
        }
      }
    }

    // Select best result based on priority
    return this.selectBest(bestArxiv, bestDoi, bestYearOk, bestAny);
  }

  /**
   * Find all matches above threshold for given PDF papers.
   * Useful for multi-paper citations where multiple entries might match.
   *
   * @param paperInfos - Array of PDF paper info to match
   * @param minScore - Minimum score threshold (default: SCORE.VALIDATION_ACCEPT)
   * @returns Array of matches sorted by score descending
   */
  findAll(
    paperInfos: PDFPaperInfo[],
    minScore: number = SCORE.VALIDATION_ACCEPT
  ): GlobalMatchResult[] {
    const results: GlobalMatchResult[] = [];
    const usedIndices = new Set<number>();

    for (const paper of paperInfos) {
      if (paper.isErratum) continue;

      const pdfArxivNorm = this.options.arxivNormalizer(paper.arxivId);
      const pdfDoiNorm = this.options.includeDoiSearch
        ? this.options.doiNormalizer(paper.doi)
        : null;

      let bestForPaper: { candidate: MatchCandidate; method: GlobalMatchResult["method"] } | null = null;

      for (let i = 0; i < this.entries.length; i++) {
        if (usedIndices.has(i)) continue;

        const entry = this.entries[i];
        const candidate = this.evaluateCandidate(paper, entry, i, pdfArxivNorm, pdfDoiNorm);

        // Determine method for this candidate
        let method: GlobalMatchResult["method"] = "score";
        if (candidate.arxivOk) method = "arxiv";
        else if (candidate.doiOk) method = "doi";
        else if (candidate.yearOk && candidate.score >= SCORE.YEAR_MATCH_ACCEPT) method = "year";

        if (candidate.score >= minScore) {
          if (!bestForPaper || candidate.score > bestForPaper.candidate.score) {
            bestForPaper = { candidate, method };
          }
        }
      }

      if (bestForPaper) {
        const { candidate, method } = bestForPaper;
        usedIndices.add(candidate.idx);
        results.push(this.toResult(candidate, method, this.determineConfidence(candidate, method)));
      }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Evaluate a candidate match between PDF paper and INSPIRE entry.
   */
  private evaluateCandidate(
    paper: PDFPaperInfo,
    entry: InspireReferenceEntry,
    idx: number,
    pdfArxivNorm: string | null,
    pdfDoiNorm: string | null
  ): MatchCandidate {
    const score = this.options.scoreCalculator(paper, entry);

    const entryYear = entry.year;
    const yearDelta =
      paper.year && entryYear
        ? Math.abs(parseInt(paper.year, 10) - parseInt(entryYear, 10))
        : null;
    const yearOk = yearDelta !== null && yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE;

    const entryArxivNorm = this.options.arxivNormalizer(entry.arxivDetails);
    const arxivOk = !!pdfArxivNorm && !!entryArxivNorm && pdfArxivNorm === entryArxivNorm;

    const entryDoiNorm = pdfDoiNorm ? this.options.doiNormalizer(entry.doi) : null;
    const doiOk = !!pdfDoiNorm && !!entryDoiNorm && pdfDoiNorm === entryDoiNorm;

    return { idx, score, yearOk, yearDelta, arxivOk, doiOk, paper };
  }

  /**
   * Select the best match based on priority.
   */
  private selectBest(
    bestArxiv: MatchCandidate | null,
    bestDoi: MatchCandidate | null,
    bestYearOk: MatchCandidate | null,
    bestAny: MatchCandidate | null
  ): GlobalMatchResult | null {
    // Priority: arXiv > DOI > year-matched > highest score
    if (bestArxiv) {
      return this.toResult(bestArxiv, "arxiv", "high");
    }
    if (bestDoi) {
      return this.toResult(bestDoi, "doi", "high");
    }
    if (bestYearOk && bestYearOk.score >= SCORE.YEAR_MATCH_ACCEPT) {
      // Accept year-matched if score is close to best overall
      if (!bestAny || bestYearOk.score >= bestAny.score - 1) {
        return this.toResult(bestYearOk, "year", "medium");
      }
    }
    if (bestAny && bestAny.score >= SCORE.NO_YEAR_ACCEPT) {
      return this.toResult(bestAny, "score", "low");
    }
    return null;
  }

  /**
   * Determine confidence level for a match.
   */
  private determineConfidence(
    candidate: MatchCandidate,
    method: GlobalMatchResult["method"]
  ): MatchConfidence {
    if (method === "arxiv" || method === "doi") return "high";
    if (method === "year" || method === "journal") return "medium";
    if (candidate.score >= SCORE.NO_YEAR_ACCEPT) return "medium";
    return "low";
  }

  /**
   * Convert candidate to result.
   */
  private toResult(
    candidate: MatchCandidate,
    method: GlobalMatchResult["method"],
    confidence: MatchConfidence
  ): GlobalMatchResult {
    return {
      idx: candidate.idx,
      score: candidate.score,
      method,
      yearDelta: candidate.yearDelta,
      confidence,
      paper: candidate.paper,
      entry: this.entries[candidate.idx],
    };
  }
}

/**
 * Create a GlobalBestMatcher with standard options.
 * This is a convenience factory for common use cases.
 *
 * @param entries - INSPIRE reference entries
 * @param scoreCalculator - Score calculation function
 * @param arxivNormalizer - arXiv ID normalization function
 * @param doiNormalizer - DOI normalization function
 */
export function createGlobalMatcher(
  entries: InspireReferenceEntry[],
  scoreCalculator: GlobalMatcherOptions["scoreCalculator"],
  arxivNormalizer: GlobalMatcherOptions["arxivNormalizer"],
  doiNormalizer: GlobalMatcherOptions["doiNormalizer"]
): GlobalBestMatcher {
  return new GlobalBestMatcher(entries, {
    includeDoiSearch: true,
    scoreCalculator,
    arxivNormalizer,
    doiNormalizer,
  });
}
