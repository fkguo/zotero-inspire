// ─────────────────────────────────────────────────────────────────────────────
// Label Matcher
// FTR-PDF-ANNOTATE: Match PDF citation labels to INSPIRE reference entries
// FTR-PDF-ANNOTATE-MULTI-LABEL: Support multiple entries per label
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import type { InspireReferenceEntry, InspireArxivDetails } from "../types";
import type { MatchResult, AlignmentIssue, AlignmentReport } from "./types";
import type { PDFReferenceMapping, PDFPaperInfo } from "./pdfReferencesParser";
import { getPref } from "../../../utils/prefs";
import {
  getJournalAbbreviations,
  getJournalFullNames,
  normalizeJournalName,
} from "../../../utils/journalAbbreviations";
import { SCORE, YEAR_DELTA, MATCH_CONFIG, type MatchConfidence } from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// Types for Global Best Match
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result from findGlobalBestMatch
 */
interface GlobalBestMatchResult {
  idx: number;
  score: number;
  method: "arxiv" | "doi" | "journal" | "year" | "score";
  yearDelta: number | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Matches PDF citation labels to INSPIRE reference entries.
 * Handles INSPIRE label inconsistencies (missing, misaligned) gracefully.
 * FTR-PDF-ANNOTATE-MULTI-LABEL: Now supports one-to-many label→entry mapping.
 */
export class LabelMatcher {
  private entries: InspireReferenceEntry[];
  /** Maps INSPIRE label string -> entry array indices (one-to-many) */
  private labelMap: Map<string, number[]>;
  /** Maps 1-based position -> entry array index (for fallback) */
  private indexMap: Map<number, number>;
  /** Cached alignment diagnosis */
  private alignmentReport?: AlignmentReport;
  /** PDF-parsed mapping (optional, takes precedence over INSPIRE labels) */
  private pdfMapping?: PDFReferenceMapping;
  /** Label map built from PDF parsing */
  private pdfLabelMap?: Map<string, number[]>;
  /** When true, skip index fallback if PDF/INSPIRE diverge */
  private pdfMappingStrict: boolean = false;
  /** When PDF parsing produced more refs than INSPIRE (over-parse), used to distrust seq mapping */
  private pdfOverParsed: boolean = false;
  private pdfOverParsedRatio: number = 1;
  /** When true, PDF mapping can be used even if not strict (e.g., labels missing) */
  private pdfMappingUsable: boolean = false;
  /** Keep PDF paper infos for strict fallback search */
  private pdfPaperInfos?: Map<string, PDFPaperInfo[]>;
  /** Track unmatched PDF papers per label */
  private pdfMissingByLabel: Map<string, PDFPaperInfo[]> = new Map();
  /** True when INSPIRE labels contain duplicates (unreliable to trust directly) */
  private hasDuplicateLabels: boolean = false;

  constructor(entries: InspireReferenceEntry[]) {
    this.entries = entries;
    this.labelMap = new Map();
    this.indexMap = new Map();
    this.buildMaps();
  }

  /**
   * Build lookup maps from entries.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: labelMap now stores arrays of indices.
   */
  private buildMaps(): void {
    this.labelMap.clear();
    this.indexMap.clear();
    this.hasDuplicateLabels = false;

    this.entries.forEach((entry, idx) => {
      // Build label map from INSPIRE's label field - now supports multi-entry per label
      if (entry.label) {
        const normalizedLabel = entry.label.trim();
        if (normalizedLabel) {
          const existing = this.labelMap.get(normalizedLabel) || [];
          existing.push(idx);
          this.labelMap.set(normalizedLabel, existing);
          if (existing.length > 1) {
            this.hasDuplicateLabels = true;
          }
        }
      }

      // Build 1-based index map (PDF references are usually 1-indexed)
      this.indexMap.set(idx + 1, idx);
    });
  }

  /**
   * Set PDF-parsed mapping to override INSPIRE labels.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Used when INSPIRE labels are missing.
   */
  setPDFMapping(mapping: PDFReferenceMapping): void {
    this.pdfMapping = mapping;
    this.pdfPaperInfos = mapping.labelPaperInfos;
    // Alignment diagnosis may depend on PDF mapping; clear cached report
    this.alignmentReport = undefined;
    this.rebuildMapsWithPDFMapping();
    const report = this.diagnoseAlignment();
    // 仅当标签缺失/错位、存在重复标签，或进入 strict 模式时才允许优先用 PDF 映射；标签已对齐且无重复则默认停用
    this.pdfMappingUsable =
      this.pdfMappingStrict ||
      report.recommendation !== "USE_INSPIRE_LABEL" ||
      this.hasDuplicateLabels;
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] LabelMatcher: applied PDF mapping with ${mapping.totalLabels} labels; recommendation=${report.recommendation}; pdfMappingStrict=${this.pdfMappingStrict}; pdfMappingUsable=${this.pdfMappingUsable}; hasDuplicateLabels=${this.hasDuplicateLabels}`,
    );
  }

  /**
   * Rebuild label map using PDF-parsed reference counts.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Uses validation matching to determine
   * which PDF papers are actually in INSPIRE.
   */
  private rebuildMapsWithPDFMapping(): void {
    if (!this.pdfMapping) return;

    this.pdfLabelMap = new Map();
    this.pdfMappingStrict = false;
    this.pdfMissingByLabel.clear();

    // Sort labels numerically
    const sortedLabels = Array.from(this.pdfMapping.labelCounts.keys())
      .map((l) => parseInt(l, 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);

    const totalInspire = this.entries.length;
    let mismatch = 0;
    let ratio = 1;
    let pendingStrictDecision:
      | {
          strictPref: boolean;
          mismatchDetected: boolean;
          wellAligned: boolean;
          finalTotal?: number;
          mismatch?: number;
          ratio?: number;
        }
      | null = null;
    const labelCounts = sortedLabels.map(
      (n) => this.pdfMapping!.labelCounts.get(String(n)) || 1,
    );
    const totalPDFExpected = labelCounts.reduce((a, b) => a + b, 0);
    const finalTotal = totalPDFExpected;

    // Strategy: Use validation matching to determine actual counts for ALL labels
    //
    // For EACH label (not just multi-entry):
    // 1. Get the paper infos extracted from PDF text
    // 2. Compare with INSPIRE entries at the expected positions
    // 3. Count how many PDF papers actually match INSPIRE entries
    // 4. If a label has 0 matches, it means the PDF paper is not in INSPIRE
    //
    // This handles cases like:
    // - [20] has 4 papers in PDF but only 3 in INSPIRE (Zweig not indexed)
    // - [24] has 1 paper in PDF but 0 in INSPIRE (entire reference not indexed)

    const adjustedCounts = [...labelCounts];
    const labelPaperInfos = this.pdfMapping.labelPaperInfos;

    if (labelPaperInfos && labelPaperInfos.size > 0) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Using validation matching for all ${sortedLabels.length} labels`,
      );

      // Track current position in INSPIRE entries
      let currentInspireIdx = 0;

      for (let i = 0; i < sortedLabels.length; i++) {
        const label = String(sortedLabels[i]);
        const pdfCountRaw = labelCounts[i];
        const paperInfos = labelPaperInfos.get(label) || [];
        const nonErrataInfos = paperInfos.filter((p) => !p.isErratum);
        const pdfCount = nonErrataInfos.length > 0 ? nonErrataInfos.length : pdfCountRaw;

        // If no paper info available, use default count
        if (paperInfos.length === 0) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] [DBG] Label [${label}] has no paperInfos, using pdfCount=${pdfCount}, currentInspireIdx=${currentInspireIdx}`,
          );
          currentInspireIdx += pdfCount;
          continue;
        }

        // Get INSPIRE entries at expected positions (with extra buffer for searching)
        let searchBuffer = 3; // Look ahead a few entries for matching
        const startIdx = currentInspireIdx;
        let endIdx = Math.min(startIdx + pdfCount + searchBuffer, totalInspire);
        let availableInspireEntries = this.entries.slice(startIdx, endIdx);
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] [DBG] Label [${label}] window: start=${startIdx}, end=${endIdx}, pdfCount=${pdfCount}, entriesWindow=${availableInspireEntries.length}`,
        );

        // Validate each paper in this label
        let matchedCount = 0;
        const usedIndices = new Set<number>(); // Track which INSPIRE entries we've matched

        for (const pdfPaper of nonErrataInfos) {
          if (pdfPaper.isErratum && matchedCount > 0) {
            // Skip counting erratum entries; they share the base paper
            continue;
          }
          // Try to find a matching INSPIRE entry
          let bestMatchIdx: number | null = null;
          let bestMatchScore = 0;

          for (let j = 0; j < availableInspireEntries.length; j++) {
            if (usedIndices.has(j)) continue; // Skip already matched entries

            const score = this.calculateMatchScore(pdfPaper, availableInspireEntries[j]);
            if (score > bestMatchScore) {
              bestMatchScore = score;
              bestMatchIdx = j;
            }
          }

          // Accept match if score is good enough
          if (bestMatchIdx !== null && bestMatchScore >= SCORE.VALIDATION_ACCEPT) {
            usedIndices.add(bestMatchIdx);
            matchedCount++;
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] [${label}] Matched: PDF "${pdfPaper.firstAuthorLastName || "?"} (${pdfPaper.year || "?"})" -> INSPIRE idx ${startIdx + bestMatchIdx} (score=${bestMatchScore})`,
            );
          } else {
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] [${label}] No match: PDF "${pdfPaper.firstAuthorLastName || "?"} (${pdfPaper.year || "?"})" (best score=${bestMatchScore})`,
            );
          }
        }

        // If nothing matched, try an expanded window once
        if (matchedCount === 0) {
          searchBuffer = 8;
          endIdx = Math.min(startIdx + pdfCount + searchBuffer, totalInspire);
          availableInspireEntries = this.entries.slice(startIdx, endIdx);
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] [DBG] Label [${label}] expanding window: start=${startIdx}, end=${endIdx}, pdfCount=${pdfCount}, entriesWindow=${availableInspireEntries.length}`,
          );
          for (const pdfPaper of paperInfos) {
            let bestMatchIdx: number | null = null;
            let bestMatchScore = 0;
            for (let j = 0; j < availableInspireEntries.length; j++) {
              if (usedIndices.has(j)) continue;
              const score = this.calculateMatchScore(pdfPaper, availableInspireEntries[j]);
              if (score > bestMatchScore) {
                bestMatchScore = score;
                bestMatchIdx = j;
              }
            }
            if (bestMatchIdx !== null && bestMatchScore >= SCORE.VALIDATION_ACCEPT) {
              usedIndices.add(bestMatchIdx);
              matchedCount++;
              Zotero.debug(
                `[${config.addonName}] [PDF-ANNOTATE] [${label}] Matched (expanded): PDF "${pdfPaper.firstAuthorLastName || "?"} (${pdfPaper.year || "?"})" -> INSPIRE idx ${startIdx + bestMatchIdx} (score=${bestMatchScore})`,
              );
            }
          }
        }

        // Update adjusted count:
        // - If we matched something, keep the (non-errata) PDF count to preserve spacing.
        // - If nothing matched, reserve minimal slots to avoid collapse.
        let effectiveCount = matchedCount > 0 ? pdfCount : pdfCount;
        if (matchedCount === 0 && pdfCount > 0) {
          // If validation fails completely, keep at least 1 slot to preserve sequence
          effectiveCount = Math.min(pdfCount, Math.max(1, totalInspire - currentInspireIdx));
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Label [${label}]: validation 0/${pdfCount}, reserving ${effectiveCount} slot(s) to avoid index collapse`,
          );
        }

        adjustedCounts[i] = effectiveCount;

        // Record missing papers (best-effort tail) when there is a gap
        if (paperInfos.length && matchedCount < pdfCount) {
          const missingCount = Math.max(0, pdfCount - matchedCount);
          const tail = paperInfos.slice(-missingCount);
          this.pdfMissingByLabel.set(label, tail);
        }

        // Boundary check: stop if we've exhausted all INSPIRE entries
        if (currentInspireIdx >= totalInspire) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Warning: currentInspireIdx (${currentInspireIdx}) reached totalInspire (${totalInspire}) at label [${label}], stopping mapping`,
          );
          break;
        }

        // Move INSPIRE position by the validated count
        currentInspireIdx += effectiveCount;
      }

      const finalTotal = adjustedCounts.reduce((a, b) => a + b, 0);
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Validation complete: PDF=${totalPDFExpected}, validated=${finalTotal}, INSPIRE=${totalInspire}`,
      );
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] [DBG] Adjusted counts: labels=${sortedLabels.join(",")}, counts=${adjustedCounts.join(",")}`,
      );

      // Detect mismatch between PDF and INSPIRE counts; optionally force PDF-only mapping
      mismatch = Math.abs(finalTotal - totalInspire);
      ratio = totalInspire > 0 ? finalTotal / totalInspire : 1;
      const strictPref = getPref("pdf_force_mapping_on_mismatch") !== false;
      // Allow small parsing drift; only trigger strict mode on clear divergence
      const mismatchDetected = mismatch >= 5 || ratio < 0.85;

      // Guard: if INSPIRE labels are already well aligned (essentially perfect),
      // do NOT enable strict mode even if validation mismatch says so. This avoids
      // blocking lookups on clean PDFs where PDF parsing under-counted a few refs.
      let wellAligned = false;
      if (totalInspire > 0) {
        let aligned = 0;
        let labelAvailable = 0;
        this.entries.forEach((entry, idx) => {
          const expected = idx + 1;
          const actual = entry.label ? parseInt(entry.label, 10) : null;
          if (entry.label && entry.label.trim()) labelAvailable++;
          if (actual === expected) aligned++;
        });
        const alignRate = aligned / totalInspire;
        const labelRate = labelAvailable / totalInspire;
        wellAligned = alignRate >= 0.95 && labelRate >= 0.95;
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] [DBG] Alignment guard: aligned=${aligned}/${totalInspire} (${alignRate.toFixed(3)}), labelRate=${labelRate.toFixed(3)}, wellAligned=${wellAligned}`,
        );
      }

    // Decide strict mode after coverage is known (computed after mapping)
    pendingStrictDecision = {
      strictPref,
      mismatchDetected,
      wellAligned,
      finalTotal,
      mismatch,
      ratio,
    };
    } else if (totalPDFExpected > totalInspire) {
      // No paper infos available, fall back to conservative reduction
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] No paper infos, using conservative reduction`,
      );

      const excess = totalPDFExpected - totalInspire;
      let absorbed = 0;

      for (let i = 0; i < labelCounts.length && absorbed < excess; i++) {
        if (labelCounts[i] > 1) {
          adjustedCounts[i] = labelCounts[i] - 1;
          absorbed++;
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Reduced [${sortedLabels[i]}]: ${labelCounts[i]} -> ${adjustedCounts[i]}`,
          );
        }
      }
    } else {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] PDF/INSPIRE match: PDF=${totalPDFExpected}, INSPIRE=${totalInspire}`,
      );
    }

    // Build the mapping using adjusted counts
    let currentIdx = 0;
    for (let i = 0; i < sortedLabels.length; i++) {
      const label = String(sortedLabels[i]);
      const count = adjustedCounts[i];

      const indices: number[] = [];
      for (let k = 0; k < count && currentIdx < totalInspire; k++) {
        indices.push(currentIdx++);
      }

      if (indices.length > 0) {
        this.pdfLabelMap.set(label, indices);
      }
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Rebuilt PDF label map: ${this.pdfLabelMap.size} labels covering ${currentIdx}/${totalInspire} entries`,
    );
    const preview = Array.from(this.pdfLabelMap.entries())
      .slice(0, 15)
      .map(([lbl, idxs]) => `[${lbl}]->${idxs.join("/")}`)
      .join("; ");
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] [DBG] PDF label map preview (first 15): ${preview || "empty"}`,
    );

    // Now that currentIdx is final, recompute coverage and decide strict mode
    const coverage = totalInspire > 0 ? currentIdx / totalInspire : 0;
    if (pendingStrictDecision) {
      const { strictPref, mismatchDetected, wellAligned } = pendingStrictDecision;
      this.pdfOverParsed = (pendingStrictDecision.finalTotal ?? finalTotal) > totalInspire;
      this.pdfOverParsedRatio =
        totalInspire > 0
          ? (pendingStrictDecision.finalTotal ?? finalTotal) / totalInspire
          : 1;
      this.pdfMappingStrict =
        strictPref &&
        mismatchDetected &&
        !wellAligned &&
        coverage >= 0.5 &&
        !this.pdfOverParsed; // 如果 PDF 解析明显超量，避免进入 strict 阶段的顺序映射
      if (!this.pdfMappingStrict && mismatchDetected) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] [DBG] Strict disabled due to low coverage (${(coverage * 100).toFixed(1)}%) despite mismatch`,
        );
      }
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] [DBG] Mapping diff: pdfValidated=${pendingStrictDecision.finalTotal ?? finalTotal}, inspire=${totalInspire}, mismatch=${pendingStrictDecision.mismatch ?? mismatch}, ratio=${(pendingStrictDecision.ratio ?? ratio).toFixed(3)}, strictPref=${strictPref}, pdfMappingStrict=${this.pdfMappingStrict}, coverage=${coverage.toFixed(3)}`,
      );
    }
  }

  /**
   * Find which INSPIRE entry (if any) matches a PDF paper.
   * Uses author name, year, and page number for validation.
   *
   * @param pdfPaper - Paper info extracted from PDF text
   * @param inspireEntries - Candidate INSPIRE entries to check
   * @returns Index in inspireEntries array if matched, null otherwise
   */
  private findMatchingInspireEntry(
    pdfPaper: PDFPaperInfo,
    inspireEntries: InspireReferenceEntry[],
  ): number | null {
    // We need at least one piece of info to match
    if (!pdfPaper.firstAuthorLastName && !pdfPaper.year && !pdfPaper.pageStart) {
      return null;
    }

    let bestMatch: { idx: number; score: number } | null = null;

    for (let idx = 0; idx < inspireEntries.length; idx++) {
      const entry = inspireEntries[idx];
      let score = 0;
      let checks = 0;

      // Check author match (most important)
      if (pdfPaper.firstAuthorLastName) {
        checks++;
        const pdfAuthor = pdfPaper.firstAuthorLastName.toLowerCase();
        
        // Check against first author in INSPIRE
        if (entry.authors && entry.authors.length > 0) {
          const firstAuthorFull = entry.authors[0].toLowerCase();
          // Extract last name from INSPIRE author (handles "S. Okubo" or "Okubo, S.")
          const inspireLastName = this.extractLastName(firstAuthorFull);
          
          // Exact last name match
          if (pdfAuthor === inspireLastName) {
            score += 4; // Perfect author match
          }
          // Partial match (one contains the other)
          else if (
            inspireLastName.includes(pdfAuthor) ||
            pdfAuthor.includes(inspireLastName)
          ) {
            score += 3; // Good author match
          }
        }
        
        // Also check authorText for broader matching
        if (score < 3 && entry.authorText) {
          const authorText = entry.authorText.toLowerCase();
          if (authorText.includes(pdfAuthor)) {
            score += 2; // Author found in author text
          }
        }
      }

      // Check year match
      if (pdfPaper.year) {
        checks++;
        if (entry.year === pdfPaper.year) {
          score += 2; // Exact year match
        }
      }

      // Check page match (if available in publicationInfo)
      if (pdfPaper.pageStart && entry.publicationInfo) {
        checks++;
        const pubInfo = entry.publicationInfo;
        // publicationInfo might be an array or object
        const pageStart = pubInfo.page_start || pubInfo.artid;
        if (pageStart && String(pageStart) === pdfPaper.pageStart) {
          score += 2; // Page match
        }
      }

      // Need at least some match to be considered
      if (score > 0 && checks > 0) {
        // Normalize score by number of checks
        const normalizedScore = score / checks;
        if (!bestMatch || normalizedScore > bestMatch.score) {
          bestMatch = { idx, score: normalizedScore };
        }
      }
    }

    // Return best match if score is good enough (at least 1.5 means good match on multiple criteria)
    if (bestMatch && bestMatch.score >= 1.5) {
      return bestMatch.idx;
    }

    // If only author was available and matched well, still accept it
    if (bestMatch && bestMatch.score >= 2 && pdfPaper.firstAuthorLastName) {
      return bestMatch.idx;
    }

    return null;
  }

  /**
   * Calculate match score between a PDF paper and an INSPIRE entry.
   * Higher score = better match. Score >= 3 is considered a good match.
   */
  private calculateMatchScore(
    pdfPaper: PDFPaperInfo,
    entry: InspireReferenceEntry,
  ): number {
    let score = 0;
    const pdfAuthorRaw = pdfPaper.firstAuthorLastName?.toLowerCase();
    const pdfAuthor = pdfAuthorRaw ? this.normalizeAuthor(pdfAuthorRaw) : undefined;
    const pdfRaw = pdfPaper.rawText?.toLowerCase() || "";
    const pdfArxiv = this.normalizeArxivId(pdfPaper.arxivId);
    const entryArxiv = this.normalizeArxivId(entry.arxivDetails);
    const pdfDoi = this.normalizeDoi(pdfPaper.doi);
    const entryDoi = this.normalizeDoi(entry.doi);
    const journalMatch = this.isJournalMatch(pdfPaper, entry);

    // arXiv 是最强特征，直接给高分
    if (pdfArxiv && entryArxiv && pdfArxiv === entryArxiv) {
      return 10;
    }

    // DOI 次强
    if (pdfDoi && entryDoi && pdfDoi === entryDoi) {
      return 9;
    }

    // Author match (most important, up to 4 points)
    if (pdfAuthor && entry.authors?.length) {
      const inspireAuthorRaw = this.extractLastName(entry.authors[0].toLowerCase());
      const inspireAuthor = inspireAuthorRaw ? this.normalizeAuthor(inspireAuthorRaw) : "";

      if (pdfAuthor && inspireAuthor && pdfAuthor === inspireAuthor) {
        score += 4; // Perfect match
      } else if (pdfAuthor && inspireAuthor && (inspireAuthor.includes(pdfAuthor) || pdfAuthor.includes(inspireAuthor))) {
        score += 3; // Partial match
      }
    }

    // AuthorText fallback (works even if authors array is empty)
    if (pdfAuthor && score < 3 && entry.authorText?.toLowerCase().includes(pdfAuthor)) {
      score += 2;
    }

    // Phrase-level fallback for "data group" style (e.g., Particle Data Group)
    if (score < 3 && entry.authorText) {
      const at = entry.authorText.toLowerCase();
      if (pdfRaw.includes("data group") && at.includes("data group")) {
        score += 2;
      }
    }

    // Year match (graduated scoring: arXiv and published versions can differ by years)
    if (pdfPaper.year && entry.year) {
      const yearDelta = Math.abs(parseInt(pdfPaper.year, 10) - parseInt(entry.year, 10));
      if (yearDelta === 0) {
        score += 2; // Exact year match
      } else if (yearDelta <= YEAR_DELTA.CLOSE) {
        score += 1.5; // Close match (±1 year)
      } else if (yearDelta <= YEAR_DELTA.REASONABLE) {
        score += 1; // Reasonable match (±2 years, common for arXiv -> journal)
      } else if (yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE) {
        score += 0.5; // Acceptable match (±3 years, some papers take long)
      }
      // Beyond ±3 years: no year score contribution
    }

    // Page match (2 points)
    if (pdfPaper.pageStart && entry.publicationInfo) {
      const pubInfo = entry.publicationInfo;
      const pageStart = pubInfo.page_start || pubInfo.artid;
      if (pageStart && String(pageStart) === pdfPaper.pageStart) {
        score += 2;
      }
    }

    // Journal+Volume match adds weight
    if (journalMatch) {
      score += 4;
    }

    return score;
  }

  /**
   * Normalize arXiv ID for matching.
   * Handles various formats:
   * - "2301.12345v2" -> "2301.12345"
   * - "arXiv:2301.12345" -> "2301.12345"
   * - "hep-ph/0101234v1" -> "hep-ph/0101234"
   * - "https://arxiv.org/abs/2301.12345" -> "2301.12345"
   */
  private normalizeArxivId(id?: string | InspireArxivDetails | null): string | null {
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
      "",
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

  private normalizeDoi(doi?: string | null): string | null {
    if (!doi) return null;
    return doi.toLowerCase().replace(/[),.;]+$/, "").trim();
  }

  private stripParenthetical(input: string): string {
    return input.replace(/\s*\([^)]*\)/g, " ").trim();
  }

  private normalizeJournal(str?: string | null): string | null {
    if (!str) return null;
    const stripped = this.stripParenthetical(str);
    const normalized = normalizeJournalName(stripped);
    if (!normalized) return null;
    return normalized.replace(/\s+/g, "");
  }

  private normalizeAuthor(str?: string | null): string | null {
    if (!str) return null;
    return str.toLowerCase().replace(/[.\s-]/g, "").trim();
  }

  /**
   * 强匹配：优先 arXiv / DOI 精确；其次期刊+卷(+页) 且作者、年份近似。
   * 返回匹配种类及分数；未命中返回 null。
   */
  private getStrongMatchKind(
    pdfPaper: PDFPaperInfo,
    entry: InspireReferenceEntry,
  ): { kind: "arxiv" | "doi" | "journal"; score: number } | null {
    // arXiv 精确
    const pdfArxiv = this.normalizeArxivId(pdfPaper.arxivId);
    const entryArxiv = this.normalizeArxivId(entry.arxivDetails);
    if (pdfArxiv && entryArxiv && pdfArxiv === entryArxiv) {
      return { kind: "arxiv", score: SCORE.ARXIV_EXACT };
    }

    // DOI 精确
    const pdfDoi = this.normalizeDoi(pdfPaper.doi);
    const entryDoi = this.normalizeDoi(entry.doi);
    if (pdfDoi && entryDoi && pdfDoi === entryDoi) {
      return { kind: "doi", score: SCORE.DOI_EXACT };
    }

    // 期刊+卷 (+页) + 作者/年份 近似
    if (pdfPaper.journalAbbrev && pdfPaper.volume && entry.publicationInfo) {
      const pub = entry.publicationInfo;
      const journalClose = this.journalsSimilar(pdfPaper.journalAbbrev, pub.journal_title);
      const entryVol = pub.journal_volume || pub.volume;
      const volOk = entryVol ? String(entryVol) === String(pdfPaper.volume) : false;
      const entryPage = pub.page_start || pub.artid;
      const pageOk =
        pdfPaper.pageStart && entryPage
          ? String(entryPage) === pdfPaper.pageStart
          : false;
      // Year check: allow up to MAX_ACCEPTABLE years difference (arXiv vs published)
      const yearOk =
        pdfPaper.year && entry.year
          ? Math.abs(parseInt(pdfPaper.year, 10) - parseInt(entry.year, 10)) <= YEAR_DELTA.MAX_ACCEPTABLE
          : false;
      let authorOk = false;
      if (pdfPaper.firstAuthorLastName) {
        const pdfAuthor = this.normalizeAuthor(pdfPaper.firstAuthorLastName);
        const inspireAuthorRaw = entry.authors?.[0]?.toLowerCase?.();
        const inspireAuthor = inspireAuthorRaw
          ? this.normalizeAuthor(this.extractLastName(inspireAuthorRaw))
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
          authorOk = entry.authorText.toLowerCase().includes(pdfPaper.firstAuthorLastName.toLowerCase());
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

  private isJournalMatch(pdfPaper: PDFPaperInfo, entry: InspireReferenceEntry): boolean {
    if (!pdfPaper.journalAbbrev || !pdfPaper.volume) return false;
    const pub = entry.publicationInfo;
    if (!pub) return false;
    const journalClose = this.journalsSimilar(pdfPaper.journalAbbrev, pub.journal_title);
    const entryVol = pub.journal_volume || pub.volume;
    const volOk = entryVol ? String(entryVol) === String(pdfPaper.volume) : false;
    const entryPage = pub.page_start || pub.artid;
    const pageOk = pdfPaper.pageStart && entryPage ? String(entryPage) === pdfPaper.pageStart : false;
    if (journalClose && volOk) {
      if (pdfPaper.pageStart && entryPage) {
        return pageOk;
      }
      return true;
    }
    // Accept volume + page alignment even if journal strings differ (allowed by user)
    if (volOk && pageOk) {
      return true;
    }
    return false;
  }

  /**
   * Compare journal strings with normalization and abbreviation expansion.
   * Treats strings equivalent if normalized forms intersect or have long common prefix.
   */
  private journalsSimilar(a?: string | null, b?: string | null): boolean {
    if (!a || !b) return false;
    const variantsA = this.buildJournalVariants(a);
    const variantsB = this.buildJournalVariants(b);
    for (const v of variantsA) {
      if (variantsB.has(v)) {
        return true;
      }
    }

    // Fallback: compact prefix similarity (handles Nucl. Instrum. Methods Phys. Res. A vs Nucl.Instrum.Meth.A)
    const compactA = this.normalizeJournal(a);
    const compactB = this.normalizeJournal(b);
    if (compactA && compactB) {
      const lcp = this.longestCommonPrefixLength(compactA, compactB);
      const minLen = Math.min(compactA.length, compactB.length);
      if (minLen >= 6 && lcp >= minLen - 2) {
        return true;
      }
    }
    return false;
  }

  private buildJournalVariants(name: string): Set<string> {
    const variants = new Set<string>();
    const pushNormalized = (val?: string | null) => {
      if (!val) return;
      const norm = normalizeJournalName(this.stripParenthetical(val));
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

  private longestCommonPrefixLength(a: string, b: string): number {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) {
      i++;
    }
    return i;
  }

  /**
   * Extract last name from an author string.
   * Handles formats like:
   * - "S. Okubo", "Okubo, S.", "Okubo" (Western)
   * - "张三", "山田太郎" (CJK - Chinese, Japanese, Korean)
   * - "ATLAS Collaboration" (Collaboration names)
   * - "García-Márquez" (Hyphenated names)
   * - "van der Waals" (Multi-word family names)
   */
  private extractLastName(authorStr: string): string {
    const author = authorStr.trim();
    if (!author) return "";

    const authorLower = author.toLowerCase();

    // Check for collaboration names first
    if (this.isCollaboration(author)) {
      return this.extractCollaborationName(author);
    }

    // CJK author detection (Chinese, Japanese, Korean)
    // Chinese names: usually 2-4 characters, surname first (1-2 chars)
    // Japanese names: may include hiragana/katakana
    // Korean names: usually 2-4 characters
    const cjkPattern = /^([\u4e00-\u9fff\u3400-\u4dbf])([\u4e00-\u9fff\u3400-\u4dbf]{1,3})$/;
    const cjkMatch = author.match(cjkPattern);
    if (cjkMatch) {
      // Return the first character (surname) for Chinese names
      return cjkMatch[1].toLowerCase();
    }

    // Japanese names with hiragana/katakana (family name usually in kanji)
    const japanesePattern = /^([\u4e00-\u9fff]{1,3})([\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]+)$/;
    const japaneseMatch = author.match(japanesePattern);
    if (japaneseMatch) {
      return japaneseMatch[1].toLowerCase();
    }

    // Korean names (Hangul)
    const koreanPattern = /^([\uac00-\ud7af]{1,2})([\uac00-\ud7af]{1,3})$/;
    const koreanMatch = author.match(koreanPattern);
    if (koreanMatch) {
      return koreanMatch[1].toLowerCase();
    }

    // "LastName, FirstName" format
    if (author.includes(",")) {
      const lastName = author.split(",")[0].trim();
      return lastName.toLowerCase().replace(/\./g, "");
    }

    // "FirstName LastName" or "F. LastName" format
    // The last word is usually the last name
    const parts = author.split(/\s+/);
    if (parts.length > 1) {
      // Skip initials (single letters or letters with period)
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i].replace(/\./g, "").replace(/[,;]$/, "");
        // Skip single letter initials
        if (part.length > 1 && !/^[A-Z]$/i.test(part)) {
          return part.toLowerCase();
        }
      }
    }

    // Single word - return as is
    return authorLower.replace(/\./g, "").replace(/[,;]$/, "");
  }

  /**
   * Check if the author string represents a collaboration
   */
  private isCollaboration(authorStr: string): boolean {
    const lower = authorStr.toLowerCase();
    return /\b(collaboration|collab\.?|group|team|consortium|experiment)\b/i.test(lower);
  }

  /**
   * Extract collaboration name from author string
   * "ATLAS Collaboration" -> "atlas"
   * "Belle II Collaboration" -> "belle ii" or "belle"
   */
  private extractCollaborationName(authorStr: string): string {
    // Try to extract the collaboration name before "Collaboration"
    const match = authorStr.match(/^([A-Za-z0-9\s-]+?)\s+(?:collaboration|collab\.?|group)/i);
    if (match) {
      return match[1].toLowerCase().trim();
    }
    // Return the whole string normalized
    return authorStr.toLowerCase()
      .replace(/\s+(collaboration|collab\.?|group|team|consortium|experiment).*$/i, "")
      .trim();
  }

  /**
   * Match a PDF label to entries.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Now returns array of matches (empty if no match).
   * Tries multiple strategies: PDF mapping, INSPIRE label, index-based, fuzzy.
   */
  match(pdfLabel: string): MatchResult[] {
    const normalizedLabel = pdfLabel.trim();
    const results: MatchResult[] = [];
    const alignment = this.diagnoseAlignment();
    const paperInfosRaw = this.pdfPaperInfos?.get(normalizedLabel);
    const nonErrataInfos = paperInfosRaw?.filter((p) => !p.isErratum) ?? [];
    const paperInfos =
      nonErrataInfos.length > 0
        ? nonErrataInfos
        : paperInfosRaw;
    const expectedCount = paperInfos ? paperInfos.length : 0;
    const overParsedActive = this.pdfOverParsed && this.pdfOverParsedRatio > 1.05;
    const preferPdfMapping =
      this.pdfLabelMap &&
      (this.pdfMappingStrict ||
        this.pdfMappingUsable ||
        this.hasDuplicateLabels ||
        alignment.recommendation !== "USE_INSPIRE_LABEL");
    const preferSeqMapping = this.pdfLabelMap && preferPdfMapping && !overParsedActive;

    // FTR-PDF-MATCHING: Log diagnostic info for version mismatch cases
    const maxInspireLabelForDiag = this.getMaxInspireLabel();
    const numLabelForDiag = parseInt(normalizedLabel, 10);
    if (!isNaN(numLabelForDiag) && numLabelForDiag > maxInspireLabelForDiag) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH] Label [${normalizedLabel}] exceeds INSPIRE max ${maxInspireLabelForDiag}. ` +
        `paperInfos=${paperInfos ? `${paperInfos.length} paper(s)` : 'NONE'}. ` +
        `arXiv=${paperInfos?.[0]?.arxivId || 'N/A'}, DOI=${paperInfos?.[0]?.doi || 'N/A'}`,
      );
    }

    // 强匹配优先：arXiv/DOI/期刊+卷(+页)+作者 年份
    let hasStrong = false;
    if (paperInfos?.length) {
      const nonErrataInfos = paperInfos.filter((p) => !p.isErratum);
      const papersForStrong = nonErrataInfos.length > 0 ? nonErrataInfos : paperInfos;
      const mappedIndices = this.pdfLabelMap?.get(normalizedLabel);
      const indicesToCheckPrimary =
        mappedIndices && mappedIndices.length
          ? mappedIndices
          : this.entries.map((_, idx) => idx);
      const candidateLogs: Array<{
        pdfIdx: number;
        entryIdx: number;
        kind: "arxiv" | "doi" | "journal";
        score: number;
        entryLabel: string | null;
      }> = [];
      let best: { idx: number; kind: "arxiv" | "doi" | "journal"; score: number; entry: InspireReferenceEntry } | null = null;
      const searchBuckets: number[][] = [];
      searchBuckets.push(indicesToCheckPrimary);
      if (mappedIndices && mappedIndices.length) {
        const min = Math.max(0, Math.min(...mappedIndices) - 1);
        const max = Math.min(this.entries.length - 1, Math.max(...mappedIndices) + 1);
        const window: number[] = [];
        for (let i = min; i <= max; i++) window.push(i);
        searchBuckets.push(window);
      } else {
        searchBuckets.push(this.entries.map((_, idx) => idx));
      }

      for (const pdfPaper of papersForStrong) {
        for (const bucket of searchBuckets) {
          for (const i of bucket) {
          const mk = this.getStrongMatchKind(pdfPaper, this.entries[i]);
          if (!mk) continue;
          const priority = mk.kind === "arxiv" ? 3 : mk.kind === "doi" ? 2 : 1;
          const bestPri = best ? (best.kind === "arxiv" ? 3 : best.kind === "doi" ? 2 : 1) : 0;
          candidateLogs.push({
            pdfIdx: paperInfos.indexOf(pdfPaper),
            entryIdx: i,
            kind: mk.kind,
            score: mk.score,
            entryLabel: this.entries[i].label ?? null,
          });
          if (!best || priority > bestPri || (priority === bestPri && mk.score > best.score)) {
            best = { idx: i, kind: mk.kind, score: mk.score, entry: this.entries[i] };
          }
          }
        }
      }
      if (best) {
        hasStrong = true;
        if (expectedCount === 0 || results.length < expectedCount) {
          // FTR-PDF-MATCHING: Build identifier info for diagnostic feedback
          let matchedIdentifier: { type: "arxiv" | "doi" | "journal"; value: string } | undefined;
          if (best.kind === "arxiv") {
            const arxivId = this.normalizeArxivId(best.entry.arxivDetails);
            if (arxivId) matchedIdentifier = { type: "arxiv", value: arxivId };
          } else if (best.kind === "doi") {
            const doi = this.normalizeDoi(best.entry.doi);
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
      }

      // 若已有结果（强匹配），先留着，后续可追加 PDF 映射
      // 未命中强匹配时，若标签缺失/对齐差/解析超量/strict且无其他结果，直接返回空避免错误兜底
      const trustInspireLabels =
        alignment.recommendation === "USE_INSPIRE_LABEL" &&
        !this.pdfMappingStrict &&
        !overParsedActive;

      // FTR-PDF-MATCHING: Before returning empty, check if this is a version mismatch case
      // where PDF label exceeds INSPIRE max - use global arXiv/DOI search
      if (!trustInspireLabels && results.length === 0) {
        const numLabel = parseInt(normalizedLabel, 10);
        const maxInspireLabel = this.getMaxInspireLabel();

        // Version mismatch: PDF has more refs than INSPIRE - try global identifier search
        if (!isNaN(numLabel) && numLabel > maxInspireLabel && paperInfos?.length) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH-SEARCH] Label [${normalizedLabel}] exceeds max ${maxInspireLabel}, trying global arXiv/DOI search`,
          );

          for (const pdfPaper of paperInfos) {
            const pdfArxivNorm = this.normalizeArxivId(pdfPaper.arxivId);
            const pdfDoiNorm = this.normalizeDoi(pdfPaper.doi);

            if (!pdfArxivNorm && !pdfDoiNorm) {
              Zotero.debug(
                `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH-SEARCH] No arXiv/DOI in paperInfo for [${normalizedLabel}]`,
              );
              continue;
            }

            for (let i = 0; i < this.entries.length; i++) {
              const entry = this.entries[i];
              const entryArxivNorm = this.normalizeArxivId(entry.arxivDetails);
              const entryDoiNorm = this.normalizeDoi(entry.doi);

              // arXiv match
              if (pdfArxivNorm && entryArxivNorm && pdfArxivNorm === entryArxivNorm) {
                results.push({
                  pdfLabel,
                  entryIndex: i,
                  entryId: entry.id,
                  confidence: "high",
                  matchMethod: "exact",
                  // FTR-PDF-MATCHING: Enhanced diagnostic info
                  matchedIdentifier: { type: "arxiv", value: pdfArxivNorm },
                  versionMismatchWarning: `PDF label [${pdfLabel}] exceeds INSPIRE max label ${maxInspireLabel}. Matched via arXiv ID.`,
                });
                Zotero.debug(
                  `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH-SEARCH] arXiv match: [${pdfLabel}] -> idx ${i} (INSPIRE label ${entry.label}) via arXiv:${pdfArxivNorm}`,
                );
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
                  // FTR-PDF-MATCHING: Enhanced diagnostic info
                  matchedIdentifier: { type: "doi", value: pdfDoiNorm },
                  versionMismatchWarning: `PDF label [${pdfLabel}] exceeds INSPIRE max label ${maxInspireLabel}. Matched via DOI.`,
                });
                Zotero.debug(
                  `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH-SEARCH] DOI match: [${pdfLabel}] -> idx ${i} (INSPIRE label ${entry.label}) via doi:${pdfDoiNorm}`,
                );
                return results;
              }
            }
          }

          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH-SEARCH] No arXiv/DOI match found for [${normalizedLabel}]`,
          );
        }

        return results;
      }
    }

    // 若存在 PDF 映射，追加所有映射到结果（避免强匹配单条提前返回）
    if (this.pdfLabelMap) {
      const mapped = this.pdfLabelMap.get(normalizedLabel) || [];
      const added: number[] = [];
      for (const idx of mapped) {
        if (expectedCount > 0 && results.length >= expectedCount) break;
        const exists = results.some((r) => r.entryIndex === idx);
        if (!exists) {
          results.push({
            pdfLabel,
            entryIndex: idx,
            entryId: this.entries[idx].id,
            confidence: this.pdfMapping?.confidence === "high" ? "high" : hasStrong ? "medium" : "low",
            matchMethod: hasStrong ? "exact" : "exact",
          });
          added.push(idx);
        }
      }
    }

    // Reconcile missing-map with actual match results
    if (expectedCount > 0 && paperInfos) {
      const missingCount = expectedCount - results.length;
      if (missingCount <= 0) {
        this.pdfMissingByLabel.delete(normalizedLabel);
      } else {
        const tail = paperInfos.slice(-missingCount);
        this.pdfMissingByLabel.set(normalizedLabel, tail);
      }
    }

    if (results.length) {
      return expectedCount > 0 ? results.slice(0, expectedCount) : results;
    }

    // If strict mode is on (PDF/INSPIRE diverged) and we have PDF mapping, do not fall back to index
    if (this.pdfMappingStrict && this.pdfLabelMap) {
      const pdfMatches = this.pdfLabelMap.get(normalizedLabel);
      // 准备全局兜底（即便 pdfLabelMap 有结果，也可用 arXiv 覆盖）
      const paperInfos = this.pdfPaperInfos?.get(normalizedLabel);

      // 如果已有映射，先加入（可被后续兜底覆盖）
      if (pdfMatches && pdfMatches.length > 0) {
        for (const idx of pdfMatches) {
          results.push({
            pdfLabel,
            entryIndex: idx,
            entryId: this.entries[idx].id,
            confidence: this.pdfMapping?.confidence === "high" ? "high" : "medium",
            matchMethod: "exact",
          });
        }
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Match via PDF mapping (strict): [${pdfLabel}] -> ${pdfMatches.length} entries`,
        );
      }

      // 全局兜底搜索（优先 arXiv）；当 PDF 解析明显超量时优先使用
      const shouldForceGlobalFallback = this.pdfOverParsed && this.pdfOverParsedRatio > 1.05;
      if (paperInfos?.length) {
        let bestAny: { idx: number; score: number; paper: PDFPaperInfo; yearOk: boolean; yearDelta: number | null; arxivOk: boolean } | null = null;
        let bestYearOk: { idx: number; score: number; paper: PDFPaperInfo; yearOk: boolean; yearDelta: number | null; arxivOk: boolean } | null = null;
        let bestArxiv: { idx: number; score: number; paper: PDFPaperInfo } | null = null;
        for (const paper of paperInfos) {
          const pdfArxivNorm = this.normalizeArxivId(paper.arxivId);
          for (let i = 0; i < this.entries.length; i++) {
            const score = this.calculateMatchScore(paper, this.entries[i]);
            const entryYear = this.entries[i].year;
            const yearDelta =
              paper.year && entryYear ? Math.abs(parseInt(paper.year, 10) - parseInt(entryYear, 10)) : null;
            const yearOk = yearDelta !== null && yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE; // Accept up to ±3 years (arXiv vs published)
            const entryArxivNorm = this.normalizeArxivId(this.entries[i].arxivDetails);
            const arxivOk = !!pdfArxivNorm && !!entryArxivNorm && pdfArxivNorm === entryArxivNorm;
            if (!bestAny || score > bestAny.score) {
              bestAny = { idx: i, score, paper, yearOk, yearDelta, arxivOk };
            }
            if (yearOk && (!bestYearOk || score > bestYearOk.score)) {
              bestYearOk = { idx: i, score, paper, yearOk, yearDelta, arxivOk };
            }
            if (arxivOk && (!bestArxiv || score > bestArxiv.score)) {
              bestArxiv = { idx: i, score, paper };
            }
          }
        }

        // 选择策略：arXiv > 年匹配(分不低于最高-1) > 全局最高
        let chosenIdx: number | null = null;
        let chosenScore = 0;
        let chosenYearOk = false;
        let chosenYearDelta: number | null = null;
        let chosenArxivOk = false;
        if (bestArxiv) {
          chosenIdx = bestArxiv.idx;
          chosenScore = bestArxiv.score;
          chosenArxivOk = true;
        } else if (bestYearOk && (!bestAny || bestYearOk.score >= bestAny.score - 1)) {
          chosenIdx = bestYearOk.idx;
          chosenScore = bestYearOk.score;
          chosenYearOk = true;
          chosenYearDelta = bestYearOk.yearDelta;
          chosenArxivOk = bestYearOk.arxivOk;
        } else if (bestAny) {
          chosenIdx = bestAny.idx;
          chosenScore = bestAny.score;
          chosenYearOk = bestAny.yearOk;
          chosenYearDelta = bestAny.yearDelta;
          chosenArxivOk = bestAny.arxivOk;
        }

        if (chosenIdx !== null) {
          const entry = this.entries[chosenIdx];
          const accept =
            chosenArxivOk ||
            (chosenYearOk && chosenScore >= SCORE.YEAR_MATCH_ACCEPT) ||
            (!paperInfos[0].year && chosenScore >= SCORE.NO_YEAR_ACCEPT) ||
            shouldForceGlobalFallback;
          if (accept) {
            // 覆盖原有结果，确保 arXiv/年匹配优先；在超量解析时强制覆盖顺序映射
            results.length = 0;
            results.push({
              pdfLabel,
              entryIndex: chosenIdx,
              entryId: entry.id,
              confidence: chosenArxivOk ? "high" : "medium",
              matchMethod: chosenArxivOk ? "exact" : "strict-fallback",
            });
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] Strict global best (override pdf map): [${pdfLabel}] -> idx ${chosenIdx} (score=${chosenScore}, yearOk=${chosenYearOk}, yearDelta=${chosenYearDelta ?? "n/a"}, arxivOk=${chosenArxivOk}, accept=${accept})`,
            );
          } else {
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] Strict global best rejected (score/year), skipping index fallback`,
            );
          }
        }
      }

      // If strict inputs existed (pdf map or paper infos), stop here and return whatever we have.
      // If neither mapping nor paper info exists, allow normal label/index fallback below.
      const hadStrictInputs =
        (pdfMatches && pdfMatches.length > 0) || (paperInfos && paperInfos.length > 0);
      if (!results.length && hadStrictInputs) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Strict PDF mapping enforced; no accepted mapping for [${pdfLabel}], skipping index fallback`,
        );
        return results;
      }
      if (results.length) {
        return results;
      }
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Strict mode had no mapping/paperInfo for [${pdfLabel}], falling back to label/index strategies`,
      );
    }

    // Strategy 0a: If over-parsed, try global best (arXiv/DOI/author/year) before trusting sequence mapping
    if (preferPdfMapping && overParsedActive && paperInfos?.length) {
      let bestAny: { idx: number; score: number; yearOk: boolean; yearDelta: number | null; arxivOk: boolean; doiOk: boolean } | null = null;
      let bestYearOk: { idx: number; score: number; yearOk: boolean; yearDelta: number | null; arxivOk: boolean; doiOk: boolean } | null = null;
      let bestArxiv: { idx: number; score: number } | null = null;
      let bestDoi: { idx: number; score: number } | null = null;
      for (const pdfPaper of paperInfos) {
        const pdfArxivNorm = this.normalizeArxivId(pdfPaper.arxivId);
        const pdfDoiNorm = this.normalizeDoi(pdfPaper.doi);
        for (let i = 0; i < this.entries.length; i++) {
          const score = this.calculateMatchScore(pdfPaper, this.entries[i]);
          const entryYear = this.entries[i].year;
          const yearDelta =
            pdfPaper.year && entryYear ? Math.abs(parseInt(pdfPaper.year, 10) - parseInt(entryYear, 10)) : null;
          const yearOk = yearDelta !== null && yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE;
          const entryArxivNorm = this.normalizeArxivId(this.entries[i].arxivDetails);
          const arxivOk = !!pdfArxivNorm && !!entryArxivNorm && pdfArxivNorm === entryArxivNorm;
          const entryDoiNorm = this.normalizeDoi(this.entries[i].doi);
          const doiOk = !!pdfDoiNorm && !!entryDoiNorm && pdfDoiNorm === entryDoiNorm;
          if (!bestAny || score > bestAny.score) {
            bestAny = { idx: i, score, yearOk, yearDelta, arxivOk, doiOk };
          }
          if (yearOk && (!bestYearOk || score > bestYearOk.score)) {
            bestYearOk = { idx: i, score, yearOk, yearDelta, arxivOk, doiOk };
          }
          if (arxivOk && (!bestArxiv || score > bestArxiv.score)) {
            bestArxiv = { idx: i, score };
          }
          if (doiOk && (!bestDoi || score > bestDoi.score)) {
            bestDoi = { idx: i, score };
          }
        }
      }

      let chosenIdx: number | null = null;
      let chosenScore = 0;
      let chosenYearOk = false;
      let chosenYearDelta: number | null = null;
      let chosenArxivOk = false;
      let chosenDoiOk = false;
      if (bestArxiv) {
        chosenIdx = bestArxiv.idx;
        chosenScore = bestArxiv.score;
        chosenArxivOk = true;
      } else if (bestDoi) {
        chosenIdx = bestDoi.idx;
        chosenScore = bestDoi.score;
        chosenDoiOk = true;
      } else if (bestYearOk && (!bestAny || bestYearOk.score >= bestAny.score - 1)) {
        chosenIdx = bestYearOk.idx;
        chosenScore = bestYearOk.score;
        chosenYearOk = true;
        chosenYearDelta = bestYearOk.yearDelta;
        chosenArxivOk = bestYearOk.arxivOk;
        chosenDoiOk = bestYearOk.doiOk;
      } else if (bestAny) {
        chosenIdx = bestAny.idx;
        chosenScore = bestAny.score;
        chosenYearOk = bestAny.yearOk;
        chosenYearDelta = bestAny.yearDelta;
        chosenArxivOk = bestAny.arxivOk;
        chosenDoiOk = bestAny.doiOk;
      }

      if (chosenIdx !== null) {
        const entry = this.entries[chosenIdx];
        const accept =
          chosenArxivOk ||
          chosenDoiOk ||
          (chosenYearOk && chosenScore >= SCORE.YEAR_MATCH_ACCEPT) ||
          (!paperInfos[0].year && chosenScore >= SCORE.NO_YEAR_ACCEPT);
        if (accept) {
          results.push({
            pdfLabel,
            entryIndex: chosenIdx,
            entryId: entry.id,
            confidence: chosenArxivOk || chosenDoiOk ? "high" : chosenYearOk ? "high" : "medium",
            matchMethod: chosenArxivOk || chosenDoiOk ? "exact" : "strict-fallback",
          });
          return results;
        }
      }
    }

    // Strategy 0b: PDF-parsed mapping (sequence) when allowed (only if not over-parsed)
    if (this.pdfLabelMap && preferSeqMapping) {
      const pdfMatches = this.pdfLabelMap.get(normalizedLabel);
      if (pdfMatches && pdfMatches.length > 0) {
        for (const idx of pdfMatches) {
          const entry = this.entries[idx];
          results.push({
            pdfLabel,
            entryIndex: idx,
            entryId: entry.id,
            confidence:
              this.pdfMapping?.confidence === "high"
                ? "high"
                : overParsedActive
                ? "low"
                : "medium",
            matchMethod: overParsedActive ? "inferred" : "exact", // over-parse 时降级信心
          });
        }
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Match via PDF mapping: [${pdfLabel}] -> ${pdfMatches.length} entries (preferPdfMapping=${preferPdfMapping}, hasDuplicateLabels=${this.hasDuplicateLabels}, recommendation=${alignment.recommendation})`,
        );
        return results;
      }
    }

    // If preferPdfMapping but no direct pdfLabelMap hit, try global best from PDF paperInfos
    if (preferPdfMapping && paperInfos?.length) {
      let bestAny: { idx: number; score: number; yearOk: boolean; yearDelta: number | null; arxivOk: boolean } | null = null;
      let bestYearOk: { idx: number; score: number; yearOk: boolean; yearDelta: number | null; arxivOk: boolean } | null = null;
      let bestArxiv: { idx: number; score: number } | null = null;
      for (const pdfPaper of paperInfos) {
        const pdfArxivNorm = this.normalizeArxivId(pdfPaper.arxivId);
        for (let i = 0; i < this.entries.length; i++) {
          const score = this.calculateMatchScore(pdfPaper, this.entries[i]);
          const entryYear = this.entries[i].year;
          const yearDelta =
            pdfPaper.year && entryYear ? Math.abs(parseInt(pdfPaper.year, 10) - parseInt(entryYear, 10)) : null;
          const yearOk = yearDelta !== null && yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE;
          const entryArxivNorm = this.normalizeArxivId(this.entries[i].arxivDetails);
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

      let chosenIdx: number | null = null;
      let chosenScore = 0;
      let chosenYearOk = false;
      let chosenYearDelta: number | null = null;
      let chosenArxivOk = false;
      if (bestArxiv) {
        chosenIdx = bestArxiv.idx;
        chosenScore = bestArxiv.score;
        chosenArxivOk = true;
      } else if (bestYearOk && (!bestAny || bestYearOk.score >= bestAny.score - 1)) {
        chosenIdx = bestYearOk.idx;
        chosenScore = bestYearOk.score;
        chosenYearOk = true;
        chosenYearDelta = bestYearOk.yearDelta;
        chosenArxivOk = bestYearOk.arxivOk;
      } else if (bestAny) {
        chosenIdx = bestAny.idx;
        chosenScore = bestAny.score;
        chosenYearOk = bestAny.yearOk;
        chosenYearDelta = bestAny.yearDelta;
        chosenArxivOk = bestAny.arxivOk;
      }

      if (chosenIdx !== null) {
        const entry = this.entries[chosenIdx];
        const accept =
          chosenArxivOk ||
          (chosenYearOk && chosenScore >= SCORE.YEAR_MATCH_ACCEPT) ||
          (!paperInfos[0].year && chosenScore >= SCORE.NO_YEAR_ACCEPT);
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Fallback via PDF paperInfos for [${pdfLabel}]: idx=${chosenIdx}, score=${chosenScore}, yearOk=${chosenYearOk}, yearDelta=${chosenYearDelta}, arxivOk=${chosenArxivOk}, accept=${accept}`,
        );
        if (accept) {
          results.push({
            pdfLabel,
            entryIndex: chosenIdx,
            entryId: entry.id,
            confidence: chosenArxivOk ? "high" : chosenYearOk ? "high" : "medium",
            matchMethod: "strict-fallback",
          });
          return results;
        }
      }
    }

    // 如果标签存在重复且优先 PDF，但未找到 PDF 映射或兜底，则避免使用 INSPIRE 重复标签，返回空
    if (preferPdfMapping && this.hasDuplicateLabels) {
      const labelMatches = this.labelMap.get(normalizedLabel);
      if (labelMatches && labelMatches.length > 0) {
        const idx = labelMatches[0];
        const entry = this.entries[idx];
        results.push({
          pdfLabel,
          entryIndex: idx,
          entryId: entry.id,
          confidence: "medium",
          matchMethod: "inferred",
        });
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Duplicate INSPIRE labels; using first entry as last resort for [${pdfLabel}] -> idx=${idx}, totalDup=${labelMatches.length}`,
        );
        return results;
      }
      const numLabel = parseInt(normalizedLabel, 10);
      if (!isNaN(numLabel) && this.indexMap.has(numLabel)) {
        const idx = this.indexMap.get(numLabel)!;
        const entry = this.entries[idx];
        results.push({
          pdfLabel,
          entryIndex: idx,
          entryId: entry.id,
          confidence: "medium",
          matchMethod: "inferred",
        });
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Duplicate labels; falling back to index map for [${pdfLabel}] -> idx=${idx}`,
        );
        return results;
      }
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Skipping INSPIRE label fallback for [${pdfLabel}] due to duplicate labels + preferPdfMapping (no usable fallback)`,
      );
      return results;
    }

    // Strategy 1: Exact match with INSPIRE label (may return multiple entries)
    const labelMatches = this.labelMap.get(normalizedLabel);
    if (labelMatches && labelMatches.length > 0) {
      for (const idx of labelMatches) {
        results.push({
          pdfLabel,
          entryIndex: idx,
          entryId: this.entries[idx].id,
          confidence: "high",
          matchMethod: "exact",
        });
      }
      return results;
    }

    // Strategy 2: Numeric label -> index mapping (single entry fallback)
    // FTR-PDF-MATCHING: Only use index fallback if label is within INSPIRE's label range
    // This prevents wrong matches when PDF has more refs than INSPIRE
    const numLabel = parseInt(normalizedLabel, 10);
    const maxInspireLabel = this.getMaxInspireLabel();

    // If PDF label exceeds INSPIRE's max label, do NOT use index fallback
    // This is a version mismatch case where PDF and INSPIRE have different reference lists
    if (!isNaN(numLabel) && numLabel > maxInspireLabel) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Label [${normalizedLabel}] exceeds INSPIRE max label ${maxInspireLabel}, skipping index fallback to avoid wrong match`,
      );
      // Continue to Strategy 3 (fuzzy match) and Strategy 4 (global arXiv/DOI search)
    } else if (!isNaN(numLabel) && this.indexMap.has(numLabel)) {
      const idx = this.indexMap.get(numLabel)!;
      // Check if there's an INSPIRE label that matches the index
      const entry = this.entries[idx];
      const inspireLabel = entry.label ? parseInt(entry.label, 10) : null;

      // Higher confidence if INSPIRE label matches the index position
      const confidence =
        inspireLabel === numLabel ? "high" : this.getIndexMatchConfidence();

      results.push({
        pdfLabel,
        entryIndex: idx,
        entryId: entry.id,
        confidence,
        matchMethod: inspireLabel === numLabel ? "exact" : "inferred",
      });
      return results;
    }

    // Strategy 3: Try case-insensitive match (for author-year styles, may return multiple)
    const lowerLabel = normalizedLabel.toLowerCase();
    for (const [label, indices] of this.labelMap) {
      if (label.toLowerCase() === lowerLabel) {
        for (const idx of indices) {
          results.push({
            pdfLabel,
            entryIndex: idx,
            entryId: this.entries[idx].id,
            confidence: "medium",
            matchMethod: "fuzzy",
          });
        }
        return results;
      }
    }

    return results;  // Empty array = no match
  }

  /**
   * Match multiple labels, returning all successful matches.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Deduplicates by entryIndex.
   */
  matchAll(pdfLabels: string[]): MatchResult[] {
    const seenIndices = new Set<number>();
    const results: MatchResult[] = [];

    for (const label of pdfLabels) {
      const matches = this.match(label);
      for (const match of matches) {
        if (!seenIndices.has(match.entryIndex)) {
          seenIndices.add(match.entryIndex);
          results.push(match);
        }
      }
    }

    // Sort by entryIndex for consistent display
    const sorted = results.sort((a, b) => a.entryIndex - b.entryIndex);

    return sorted;
  }

  /**
   * Diagnose alignment between INSPIRE labels and expected PDF positions.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Now includes label availability rate.
   * Useful for debugging and determining the best matching strategy.
   */
  diagnoseAlignment(): AlignmentReport {
    if (this.alignmentReport) {
      return this.alignmentReport;
    }

    const issues: AlignmentIssue[] = [];
    let alignedCount = 0;
    let labelAvailableCount = 0;

    this.entries.forEach((entry, idx) => {
      const expectedLabel = idx + 1; // PDF typically 1-indexed
      const actualLabel = entry.label ? parseInt(entry.label, 10) : null;

      // Count entries with any label (for availability rate)
      if (entry.label && entry.label.trim()) {
        labelAvailableCount++;
      }

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

    const recommendation = this.getRecommendation(alignedCount, labelAvailableCount);

    this.alignmentReport = {
      totalEntries: this.entries.length,
      alignedCount,
      labelAvailableCount,
      issues,
      recommendation,
    };

    // FTR-PDF-ANNOTATE-MULTI-LABEL: Log detailed diagnosis for debugging
    const labelRate = this.entries.length > 0
      ? ((labelAvailableCount / this.entries.length) * 100).toFixed(1)
      : "0";
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Label diagnosis: ${labelAvailableCount}/${this.entries.length} (${labelRate}%) labels available, recommendation=${recommendation}`,
    );

    return this.alignmentReport;
  }

  /**
   * Determine confidence for index-based matching based on alignment.
   * Uses MATCH_CONFIG thresholds for consistency.
   */
  private getIndexMatchConfidence(): MatchConfidence {
    const report = this.diagnoseAlignment();
    const alignRate = report.alignedCount / Math.max(report.totalEntries, 1);

    if (alignRate > MATCH_CONFIG.ALIGN_RATE_HIGH) return "high";
    if (alignRate > MATCH_CONFIG.ALIGN_RATE_MEDIUM) return "medium";
    return "low";
  }

  /**
   * Get recommendation based on alignment analysis.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Also considers label availability rate.
   * Uses MATCH_CONFIG thresholds for consistency across the codebase.
   */
  private getRecommendation(
    alignedCount: number,
    labelAvailableCount: number,
  ): AlignmentReport["recommendation"] {
    const total = this.entries.length;
    if (total === 0) return "USE_INDEX_ONLY";

    const alignRate = alignedCount / total;
    const labelRate = labelAvailableCount / total;

    // FTR-PDF-ANNOTATE-MULTI-LABEL: When labels are mostly missing, use index-only
    if (labelRate < MATCH_CONFIG.LABEL_RATE_LOW) {
      return "USE_INDEX_ONLY";
    }

    if (alignRate > MATCH_CONFIG.ALIGN_RATE_HIGH) {
      return "USE_INSPIRE_LABEL";
    } else if (alignRate > MATCH_CONFIG.ALIGN_RATE_MEDIUM || labelRate > MATCH_CONFIG.ALIGN_RATE_MEDIUM) {
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

  /**
   * Get mismatch info for a label: unmatched PDF papers.
   */
  getMismatchForLabel(label: string): { missing: PDFPaperInfo[] } | null {
    const missing = this.pdfMissingByLabel.get(label);
    if (!missing || missing.length === 0) {
      return null;
    }
    // Clone to avoid external mutation
    return { missing: missing.map((m) => ({ ...m })) };
  }

  /**
   * Check if PDF mapping has been applied.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Used to determine if PDF parsing should be triggered.
   */
  hasPDFMapping(): boolean {
    return this.pdfLabelMap !== undefined && this.pdfLabelMap.size > 0;
  }

  /**
   * Get the maximum numeric label from INSPIRE entries.
   * FTR-PDF-MATCHING: Used to detect when PDF labels exceed INSPIRE range.
   */
  private getMaxInspireLabel(): number {
    let maxLabel = 0;
    for (const entry of this.entries) {
      if (entry.label) {
        const num = parseInt(entry.label, 10);
        if (!isNaN(num) && num > maxLabel) {
          maxLabel = num;
        }
      }
    }
    return maxLabel;
  }
}

