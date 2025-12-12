// ─────────────────────────────────────────────────────────────────────────────
// Match Strategies for PDF Citation → INSPIRE Entry Matching
// FTR-PDF-MATCHING: Strategy pattern implementation for LabelMatcher
// ─────────────────────────────────────────────────────────────────────────────

import type { InspireReferenceEntry } from "../types";
import type { MatchResult, AlignmentReport } from "./types";
import type { PDFPaperInfo, PDFReferenceMapping } from "./pdfReferencesParser";
import { SCORE, YEAR_DELTA, type MatchConfidence, type MatchMethod } from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Interface and Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context data available to all match strategies.
 * Encapsulates the shared state and helper functions from LabelMatcher.
 */
export interface MatchContext {
  /** The PDF label being matched */
  pdfLabel: string;
  /** Normalized label (trimmed) */
  normalizedLabel: string;
  /** All INSPIRE reference entries */
  entries: InspireReferenceEntry[];
  /** Maps INSPIRE label string -> entry array indices (one-to-many) */
  labelMap: Map<string, number[]>;
  /** Maps 1-based position -> entry array index (for fallback) */
  indexMap: Map<number, number>;
  /** PDF-parsed label map (if available) */
  pdfLabelMap?: Map<string, number[]>;
  /** PDF paper infos for this label (if available) */
  paperInfos?: PDFPaperInfo[];
  /** Alignment diagnosis report */
  alignmentReport: AlignmentReport;
  /** PDF mapping reference */
  pdfMapping?: PDFReferenceMapping;
  /** Maximum numeric label in INSPIRE entries */
  maxInspireLabel: number;
  /** Flags for matching decisions */
  flags: {
    pdfMappingStrict: boolean;
    pdfOverParsed: boolean;
    pdfOverParsedRatio: number;
    pdfMappingUsable: boolean;
    hasDuplicateLabels: boolean;
    preferPdfMapping: boolean;
    preferSeqMapping: boolean;
    overParsedActive: boolean;
    trustInspireLabels: boolean;
  };
  /** Helper functions */
  helpers: MatchHelpers;
}

/**
 * Helper functions provided to strategies.
 */
export interface MatchHelpers {
  calculateMatchScore(pdfPaper: PDFPaperInfo, entry: InspireReferenceEntry): number;
  getStrongMatchKind(pdfPaper: PDFPaperInfo, entry: InspireReferenceEntry): StrongMatchKind | null;
  normalizeArxivId(id: string | unknown | null | undefined): string | null;
  normalizeDoi(doi: string | null | undefined): string | null;
  getIndexMatchConfidence(): MatchConfidence;
}

/**
 * Result from strong match detection.
 */
export interface StrongMatchKind {
  kind: "arxiv" | "doi" | "journal";
  score: number;
}

/**
 * Match strategy interface.
 * Each strategy handles a specific matching approach.
 */
export interface MatchStrategy {
  /** Strategy name for logging */
  readonly name: string;
  /** Priority (higher = tried first) */
  readonly priority: number;
  /** Check if this strategy can handle the current context */
  canHandle(ctx: MatchContext): boolean;
  /** Execute the strategy and return matches */
  execute(ctx: MatchContext): MatchResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Implementations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strategy: Strong Identifier Match (arXiv/DOI/Journal)
 * Priority: 100 (highest)
 * Tries to find exact matches using arXiv, DOI, or journal+volume+page.
 */
export class StrongIdentifierStrategy implements MatchStrategy {
  readonly name = "StrongIdentifier";
  readonly priority = 100;

  canHandle(ctx: MatchContext): boolean {
    return ctx.paperInfos !== undefined && ctx.paperInfos.length > 0;
  }

  execute(ctx: MatchContext): MatchResult[] {
    const results: MatchResult[] = [];
    const { entries, paperInfos, pdfLabel, pdfLabelMap, helpers } = ctx;

    if (!paperInfos?.length) return results;

    const nonErrataInfos = paperInfos.filter((p) => !p.isErratum);
    const papersForStrong = nonErrataInfos.length > 0 ? nonErrataInfos : paperInfos;
    const mappedIndices = pdfLabelMap?.get(ctx.normalizedLabel);
    const indicesToCheck =
      mappedIndices && mappedIndices.length
        ? mappedIndices
        : entries.map((_, idx) => idx);

    // Build search buckets (primary indices + window around mapped)
    const searchBuckets: number[][] = [indicesToCheck];
    if (mappedIndices && mappedIndices.length) {
      const min = Math.max(0, Math.min(...mappedIndices) - 1);
      const max = Math.min(entries.length - 1, Math.max(...mappedIndices) + 1);
      const window: number[] = [];
      for (let i = min; i <= max; i++) window.push(i);
      searchBuckets.push(window);
    } else {
      searchBuckets.push(entries.map((_, idx) => idx));
    }

    let best: { idx: number; kind: "arxiv" | "doi" | "journal"; score: number; entry: InspireReferenceEntry } | null = null;

    for (const pdfPaper of papersForStrong) {
      for (const bucket of searchBuckets) {
        for (const i of bucket) {
          const mk = helpers.getStrongMatchKind(pdfPaper, entries[i]);
          if (!mk) continue;

          const priority = mk.kind === "arxiv" ? 3 : mk.kind === "doi" ? 2 : 1;
          const bestPri = best ? (best.kind === "arxiv" ? 3 : best.kind === "doi" ? 2 : 1) : 0;

          if (!best || priority > bestPri || (priority === bestPri && mk.score > best.score)) {
            best = { idx: i, kind: mk.kind, score: mk.score, entry: entries[i] };
          }
        }
      }
    }

    if (best) {
      let matchedIdentifier: MatchResult["matchedIdentifier"] | undefined;
      if (best.kind === "arxiv") {
        const arxivId = helpers.normalizeArxivId(best.entry.arxivDetails);
        if (arxivId) matchedIdentifier = { type: "arxiv", value: arxivId };
      } else if (best.kind === "doi") {
        const doi = helpers.normalizeDoi(best.entry.doi);
        if (doi) matchedIdentifier = { type: "doi", value: doi };
      } else if (best.kind === "journal") {
        const pub = best.entry.publicationInfo;
        if (pub) matchedIdentifier = { type: "journal", value: `${pub.journal_title || ""} ${pub.journal_volume || ""}`.trim() };
      }

      results.push({
        pdfLabel,
        entryIndex: best.idx,
        entryId: best.entry.id,
        confidence: "high",
        matchMethod: "exact",
        matchedIdentifier,
        score: best.score,
      });
    }

    return results;
  }
}

/**
 * Strategy: Version Mismatch Global Search
 * Priority: 95
 * When PDF label exceeds INSPIRE max, search globally by arXiv/DOI.
 */
export class VersionMismatchStrategy implements MatchStrategy {
  readonly name = "VersionMismatch";
  readonly priority = 95;

  canHandle(ctx: MatchContext): boolean {
    const numLabel = parseInt(ctx.normalizedLabel, 10);
    return (
      !isNaN(numLabel) &&
      numLabel > ctx.maxInspireLabel &&
      ctx.paperInfos !== undefined &&
      ctx.paperInfos.length > 0
    );
  }

  execute(ctx: MatchContext): MatchResult[] {
    const results: MatchResult[] = [];
    const { entries, paperInfos, pdfLabel, maxInspireLabel, helpers } = ctx;

    if (!paperInfos?.length) return results;

    for (const pdfPaper of paperInfos) {
      const pdfArxivNorm = helpers.normalizeArxivId(pdfPaper.arxivId);
      const pdfDoiNorm = helpers.normalizeDoi(pdfPaper.doi);

      if (!pdfArxivNorm && !pdfDoiNorm) continue;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const entryArxivNorm = helpers.normalizeArxivId(entry.arxivDetails);
        const entryDoiNorm = helpers.normalizeDoi(entry.doi);

        // arXiv match
        if (pdfArxivNorm && entryArxivNorm && pdfArxivNorm === entryArxivNorm) {
          results.push({
            pdfLabel,
            entryIndex: i,
            entryId: entry.id,
            confidence: "high",
            matchMethod: "exact",
            matchedIdentifier: { type: "arxiv", value: pdfArxivNorm },
            versionMismatchWarning: `PDF label [${pdfLabel}] exceeds INSPIRE max label ${maxInspireLabel}. Matched via arXiv ID.`,
          });
          return results;
        }

        // DOI match
        if (pdfDoiNorm && entryDoiNorm && pdfDoiNorm === entryDoiNorm) {
          results.push({
            pdfLabel,
            entryIndex: i,
            entryId: entry.id,
            confidence: "high",
            matchMethod: "exact",
            matchedIdentifier: { type: "doi", value: pdfDoiNorm },
            versionMismatchWarning: `PDF label [${pdfLabel}] exceeds INSPIRE max label ${maxInspireLabel}. Matched via DOI.`,
          });
          return results;
        }
      }
    }

    return results;
  }
}

/**
 * Strategy: PDF Sequence Mapping
 * Priority: 80
 * Uses the pre-computed PDF label → entry index mapping.
 */
export class PDFSequenceMappingStrategy implements MatchStrategy {
  readonly name = "PDFSequenceMapping";
  readonly priority = 80;

  canHandle(ctx: MatchContext): boolean {
    return (
      ctx.pdfLabelMap !== undefined &&
      ctx.flags.preferSeqMapping &&
      !ctx.flags.overParsedActive
    );
  }

  execute(ctx: MatchContext): MatchResult[] {
    const results: MatchResult[] = [];
    const { entries, pdfLabelMap, pdfLabel, normalizedLabel, pdfMapping, flags } = ctx;

    if (!pdfLabelMap) return results;

    const pdfMatches = pdfLabelMap.get(normalizedLabel);
    if (!pdfMatches || pdfMatches.length === 0) return results;

    for (const idx of pdfMatches) {
      const entry = entries[idx];
      results.push({
        pdfLabel,
        entryIndex: idx,
        entryId: entry.id,
        confidence: pdfMapping?.confidence === "high" ? "high" : flags.overParsedActive ? "low" : "medium",
        matchMethod: flags.overParsedActive ? "inferred" : "exact",
      });
    }

    return results;
  }
}

/**
 * Strategy: Global Best Match (Score-based)
 * Priority: 70
 * Searches all entries for best score match using paper info.
 */
export class GlobalBestMatchStrategy implements MatchStrategy {
  readonly name = "GlobalBestMatch";
  readonly priority = 70;

  canHandle(ctx: MatchContext): boolean {
    return (
      ctx.flags.preferPdfMapping &&
      ctx.paperInfos !== undefined &&
      ctx.paperInfos.length > 0
    );
  }

  execute(ctx: MatchContext): MatchResult[] {
    const results: MatchResult[] = [];
    const { entries, paperInfos, pdfLabel, helpers } = ctx;

    if (!paperInfos?.length) return results;

    let bestAny: BestCandidate | null = null;
    let bestYearOk: BestCandidate | null = null;
    let bestArxiv: { idx: number; score: number } | null = null;

    for (const pdfPaper of paperInfos) {
      const pdfArxivNorm = helpers.normalizeArxivId(pdfPaper.arxivId);

      for (let i = 0; i < entries.length; i++) {
        const score = helpers.calculateMatchScore(pdfPaper, entries[i]);
        const entryYear = entries[i].year;
        const yearDelta =
          pdfPaper.year && entryYear
            ? Math.abs(parseInt(pdfPaper.year, 10) - parseInt(entryYear, 10))
            : null;
        const yearOk = yearDelta !== null && yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE;
        const entryArxivNorm = helpers.normalizeArxivId(entries[i].arxivDetails);
        const arxivOk = !!pdfArxivNorm && !!entryArxivNorm && pdfArxivNorm === entryArxivNorm;

        if (!bestAny || score > bestAny.score) {
          bestAny = { idx: i, score, yearOk, yearDelta, arxivOk };
        }
        if (yearOk && (!bestYearOk || score > bestYearOk.score)) {
          bestYearOk = { idx: i, score, yearOk, yearDelta, arxivOk };
        }
        if (arxivOk && (!bestArxiv || score > bestArxiv.score)) {
          bestArxiv = { idx: i, score };
        }
      }
    }

    // Selection priority: arXiv > year-matched > highest score
    let chosenIdx: number | null = null;
    let chosenScore = 0;
    let chosenYearOk = false;
    let chosenArxivOk = false;

    if (bestArxiv) {
      chosenIdx = bestArxiv.idx;
      chosenScore = bestArxiv.score;
      chosenArxivOk = true;
    } else if (bestYearOk && (!bestAny || bestYearOk.score >= bestAny.score - 1)) {
      chosenIdx = bestYearOk.idx;
      chosenScore = bestYearOk.score;
      chosenYearOk = true;
    } else if (bestAny) {
      chosenIdx = bestAny.idx;
      chosenScore = bestAny.score;
      chosenYearOk = bestAny.yearOk;
      chosenArxivOk = bestAny.arxivOk;
    }

    if (chosenIdx !== null) {
      const entry = entries[chosenIdx];
      const accept =
        chosenArxivOk ||
        (chosenYearOk && chosenScore >= SCORE.YEAR_MATCH_ACCEPT) ||
        (!paperInfos[0].year && chosenScore >= SCORE.NO_YEAR_ACCEPT);

      if (accept) {
        results.push({
          pdfLabel,
          entryIndex: chosenIdx,
          entryId: entry.id,
          confidence: chosenArxivOk ? "high" : chosenYearOk ? "high" : "medium",
          matchMethod: "strict-fallback",
        });
      }
    }

    return results;
  }
}

interface BestCandidate {
  idx: number;
  score: number;
  yearOk: boolean;
  yearDelta: number | null;
  arxivOk: boolean;
}

/**
 * Strategy: INSPIRE Label Match
 * Priority: 60
 * Direct match using INSPIRE's label field.
 */
export class InspireLabelStrategy implements MatchStrategy {
  readonly name = "InspireLabel";
  readonly priority = 60;

  canHandle(ctx: MatchContext): boolean {
    // Use when not preferring PDF mapping or as fallback
    return !ctx.flags.preferPdfMapping || !ctx.flags.hasDuplicateLabels;
  }

  execute(ctx: MatchContext): MatchResult[] {
    const results: MatchResult[] = [];
    const { labelMap, pdfLabel, normalizedLabel, entries, flags } = ctx;

    // Skip if preferring PDF mapping with duplicate labels
    if (flags.preferPdfMapping && flags.hasDuplicateLabels) {
      return results;
    }

    const labelMatches = labelMap.get(normalizedLabel);
    if (labelMatches && labelMatches.length > 0) {
      for (const idx of labelMatches) {
        results.push({
          pdfLabel,
          entryIndex: idx,
          entryId: entries[idx].id,
          confidence: "high",
          matchMethod: "exact",
        });
      }
    }

    return results;
  }
}

/**
 * Strategy: Index-based Fallback
 * Priority: 40
 * Falls back to numeric index mapping when label match fails.
 */
export class IndexFallbackStrategy implements MatchStrategy {
  readonly name = "IndexFallback";
  readonly priority = 40;

  canHandle(ctx: MatchContext): boolean {
    const numLabel = parseInt(ctx.normalizedLabel, 10);
    return (
      !isNaN(numLabel) &&
      numLabel <= ctx.maxInspireLabel &&
      ctx.indexMap.has(numLabel)
    );
  }

  execute(ctx: MatchContext): MatchResult[] {
    const results: MatchResult[] = [];
    const { indexMap, entries, pdfLabel, normalizedLabel, helpers } = ctx;

    const numLabel = parseInt(normalizedLabel, 10);
    if (isNaN(numLabel) || !indexMap.has(numLabel)) return results;

    const idx = indexMap.get(numLabel)!;
    const entry = entries[idx];
    const inspireLabel = entry.label ? parseInt(entry.label, 10) : null;

    // Higher confidence if INSPIRE label matches the index position
    const confidence =
      inspireLabel === numLabel ? "high" : helpers.getIndexMatchConfidence();

    results.push({
      pdfLabel,
      entryIndex: idx,
      entryId: entry.id,
      confidence,
      matchMethod: inspireLabel === numLabel ? "exact" : "inferred",
    });

    return results;
  }
}

/**
 * Strategy: Fuzzy/Case-insensitive Match
 * Priority: 20 (lowest)
 * Tries case-insensitive matching for author-year styles.
 */
export class FuzzyMatchStrategy implements MatchStrategy {
  readonly name = "FuzzyMatch";
  readonly priority = 20;

  canHandle(_ctx: MatchContext): boolean {
    return true; // Always available as last resort
  }

  execute(ctx: MatchContext): MatchResult[] {
    const results: MatchResult[] = [];
    const { labelMap, entries, pdfLabel, normalizedLabel } = ctx;

    const lowerLabel = normalizedLabel.toLowerCase();

    for (const [label, indices] of labelMap) {
      if (label.toLowerCase() === lowerLabel) {
        for (const idx of indices) {
          results.push({
            pdfLabel,
            entryIndex: idx,
            entryId: entries[idx].id,
            confidence: "medium",
            matchMethod: "fuzzy",
          });
        }
        return results;
      }
    }

    return results;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Coordinator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coordinates multiple match strategies.
 * Strategies are tried in priority order until one returns results.
 */
export class StrategyCoordinator {
  private strategies: MatchStrategy[];

  constructor(strategies?: MatchStrategy[]) {
    this.strategies = strategies ?? [
      new StrongIdentifierStrategy(),
      new VersionMismatchStrategy(),
      new PDFSequenceMappingStrategy(),
      new GlobalBestMatchStrategy(),
      new InspireLabelStrategy(),
      new IndexFallbackStrategy(),
      new FuzzyMatchStrategy(),
    ];
    // Sort by priority descending
    this.strategies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Match a PDF label using registered strategies.
   * Tries strategies in priority order until one returns results.
   */
  match(context: MatchContext): MatchResult[] {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(context)) {
        const results = strategy.execute(context);
        if (results.length > 0) {
          return results;
        }
      }
    }
    return [];
  }

  /**
   * Get all registered strategies (for debugging/testing).
   */
  getStrategies(): readonly MatchStrategy[] {
    return this.strategies;
  }
}

/**
 * Create a default strategy coordinator with all standard strategies.
 */
export function createDefaultCoordinator(): StrategyCoordinator {
  return new StrategyCoordinator();
}
