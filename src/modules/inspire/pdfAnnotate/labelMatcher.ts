// ─────────────────────────────────────────────────────────────────────────────
// Label Matcher
// FTR-PDF-ANNOTATE: Match PDF citation labels to INSPIRE reference entries
// ─────────────────────────────────────────────────────────────────────────────

import type { InspireReferenceEntry } from "../types";
import type { MatchResult, AlignmentIssue, AlignmentReport } from "./types";

/**
 * Matches PDF citation labels to INSPIRE reference entries.
 * Handles INSPIRE label inconsistencies (missing, misaligned) gracefully.
 */
export class LabelMatcher {
  private entries: InspireReferenceEntry[];
  /** Maps INSPIRE label string -> entry array index */
  private labelMap: Map<string, number>;
  /** Maps 1-based position -> entry array index */
  private indexMap: Map<number, number>;
  /** Cached alignment diagnosis */
  private alignmentReport?: AlignmentReport;

  constructor(entries: InspireReferenceEntry[]) {
    this.entries = entries;
    this.labelMap = new Map();
    this.indexMap = new Map();
    this.buildMaps();
  }

  /**
   * Build lookup maps from entries
   */
  private buildMaps(): void {
    this.labelMap.clear();
    this.indexMap.clear();

    this.entries.forEach((entry, idx) => {
      // Build label map from INSPIRE's label field
      if (entry.label) {
        const normalizedLabel = entry.label.trim();
        if (normalizedLabel && !this.labelMap.has(normalizedLabel)) {
          this.labelMap.set(normalizedLabel, idx);
        }
      }

      // Build 1-based index map (PDF references are usually 1-indexed)
      this.indexMap.set(idx + 1, idx);
    });
  }

  /**
   * Match a PDF label to an entry.
   * Tries multiple strategies: exact label, index-based, fuzzy.
   */
  match(pdfLabel: string): MatchResult | null {
    const normalizedLabel = pdfLabel.trim();

    // Strategy 1: Exact match with INSPIRE label
    if (this.labelMap.has(normalizedLabel)) {
      const idx = this.labelMap.get(normalizedLabel)!;
      return {
        pdfLabel,
        entryIndex: idx,
        entryId: this.entries[idx].id,
        confidence: "high",
        matchMethod: "exact",
      };
    }

    // Strategy 2: Numeric label -> index mapping
    const numLabel = parseInt(normalizedLabel, 10);
    if (!isNaN(numLabel) && this.indexMap.has(numLabel)) {
      const idx = this.indexMap.get(numLabel)!;
      // Check if there's an INSPIRE label that matches the index
      const entry = this.entries[idx];
      const inspireLabel = entry.label ? parseInt(entry.label, 10) : null;

      // Higher confidence if INSPIRE label matches the index position
      const confidence =
        inspireLabel === numLabel ? "high" : this.getIndexMatchConfidence();

      return {
        pdfLabel,
        entryIndex: idx,
        entryId: entry.id,
        confidence,
        matchMethod: inspireLabel === numLabel ? "exact" : "inferred",
      };
    }

    // Strategy 3: Try case-insensitive match (for author-year styles)
    const lowerLabel = normalizedLabel.toLowerCase();
    for (const [label, idx] of this.labelMap) {
      if (label.toLowerCase() === lowerLabel) {
        return {
          pdfLabel,
          entryIndex: idx,
          entryId: this.entries[idx].id,
          confidence: "medium",
          matchMethod: "fuzzy",
        };
      }
    }

    return null;
  }

  /**
   * Match multiple labels, returning all successful matches.
   */
  matchAll(pdfLabels: string[]): Map<string, MatchResult> {
    const results = new Map<string, MatchResult>();
    for (const label of pdfLabels) {
      const result = this.match(label);
      if (result) {
        results.set(label, result);
      }
    }
    return results;
  }

  /**
   * Diagnose alignment between INSPIRE labels and expected PDF positions.
   * Useful for debugging and determining the best matching strategy.
   */
  diagnoseAlignment(): AlignmentReport {
    if (this.alignmentReport) {
      return this.alignmentReport;
    }

    const issues: AlignmentIssue[] = [];
    let alignedCount = 0;

    this.entries.forEach((entry, idx) => {
      const expectedLabel = idx + 1; // PDF typically 1-indexed
      const actualLabel = entry.label ? parseInt(entry.label, 10) : null;

      if (actualLabel === null || isNaN(actualLabel)) {
        issues.push({
          index: idx,
          type: "missing",
          expected: String(expectedLabel),
          actual: entry.label ?? null,
        });
      } else if (actualLabel === expectedLabel) {
        alignedCount++;
      } else {
        issues.push({
          index: idx,
          type: "misaligned",
          expected: String(expectedLabel),
          actual: entry.label!,
        });
      }
    });

    const recommendation = this.getRecommendation(alignedCount);

    this.alignmentReport = {
      totalEntries: this.entries.length,
      alignedCount,
      issues,
      recommendation,
    };

    return this.alignmentReport;
  }

  /**
   * Determine confidence for index-based matching based on alignment.
   */
  private getIndexMatchConfidence(): "high" | "medium" | "low" {
    const report = this.diagnoseAlignment();
    const alignRate = report.alignedCount / Math.max(report.totalEntries, 1);

    if (alignRate > 0.95) return "high";
    if (alignRate > 0.7) return "medium";
    return "low";
  }

  /**
   * Get recommendation based on alignment analysis.
   */
  private getRecommendation(
    alignedCount: number,
  ): AlignmentReport["recommendation"] {
    const total = this.entries.length;
    if (total === 0) return "USE_INDEX_ONLY";

    const alignRate = alignedCount / total;

    if (alignRate > 0.95) {
      return "USE_INSPIRE_LABEL";
    } else if (alignRate > 0.7) {
      return "USE_INDEX_WITH_FALLBACK";
    } else {
      return "USE_INDEX_ONLY";
    }
  }

  /**
   * Get an entry by index (0-based).
   */
  getEntry(index: number): InspireReferenceEntry | undefined {
    return this.entries[index];
  }

  /**
   * Get total entry count.
   */
  get length(): number {
    return this.entries.length;
  }
}

