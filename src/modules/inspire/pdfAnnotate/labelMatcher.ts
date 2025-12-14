// ─────────────────────────────────────────────────────────────────────────────
// Label Matcher
// FTR-PDF-ANNOTATE: Match PDF citation labels to INSPIRE reference entries
// FTR-PDF-ANNOTATE-MULTI-LABEL: Support multiple entries per label
// FTR-REFACTOR: Optimized with pre-computed identifier indexes and shared utilities
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import type { InspireReferenceEntry } from "../types";
import type {
  MatchResult,
  AlignmentIssue,
  AlignmentReport,
  AmbiguousCandidate,
} from "./types";
import type {
  PDFReferenceMapping,
  PDFPaperInfo,
  AuthorYearReferenceMapping,
} from "./pdfReferencesParser";
import type { OverlayReferenceMapping } from "./readerIntegration";
import { getPref } from "../../../utils/prefs";
import {
  SCORE,
  YEAR_DELTA,
  MATCH_CONFIG,
  type MatchConfidence,
} from "./constants";
import { normalizeYear } from "../textUtils";

// Import shared utilities from authorUtils
import {
  RE_YEAR_WITH_SUFFIX,
  buildDifferentInitialsPattern,
  buildInitialsPattern,
  normalizeAuthorName,
  normalizeAuthorCompact,
  authorsMatch,
  extractLastName,
  parseAuthorLabels,
} from "./authorUtils";

// Import shared scoring utilities from matchScoring
import {
  normalizeArxivId,
  normalizeDoi,
  normalizeJournal,
  journalsSimilar,
  isJournalMatch,
  calculateCompositeScore,
  getStrongMatchKind,
  scorePdfPaperInfos,
  selectBestPdfPaperInfo,
} from "./matchScoring";
import { computePublicationPriority } from "./matchScoring";

// Alias for buildDifferentInitialsPattern (used in matchAuthorYear)
const RE_DIFFERENT_INITIALS = buildDifferentInitialsPattern;

/**
 * Matches PDF citation labels to INSPIRE reference entries.
 * Handles INSPIRE label inconsistencies (missing, misaligned) gracefully.
 * FTR-PDF-ANNOTATE-MULTI-LABEL: Now supports one-to-many label→entry mapping.
 * FTR-REFACTOR: Pre-computed identifier indexes for O(1) lookup.
 */
export class LabelMatcher {
  private entries: InspireReferenceEntry[];
  /** Maps INSPIRE label string -> entry array indices (one-to-many) */
  private labelMap: Map<string, number[]>;
  /** Maps 1-based position -> entry array index (for fallback) */
  private indexMap: Map<number, number>;

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-REFACTOR: Pre-computed identifier indexes for O(1) lookup
  // These replace O(n) linear searches through entries
  // ─────────────────────────────────────────────────────────────────────────────

  /** Maps normalized arXiv ID -> entry index (for fast arXiv lookup) */
  private arxivIndex: Map<string, number> = new Map();
  /** Maps normalized DOI -> entry index (for fast DOI lookup) */
  private doiIndex: Map<string, number> = new Map();
  /** Maps "journal:volume" -> entry indices (for fast journal+volume lookup) */
  private journalVolIndex: Map<string, number[]> = new Map();
  /** Maps "journal:volume:page" -> entry index (for exact journal match) */
  private journalVolPageIndex: Map<string, number> = new Map();

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
  /** FTR-PDF-ANNOTATE-AUTHOR-YEAR: Author-year PDF mapping for precise matching */
  private authorYearMapping?: AuthorYearReferenceMapping;
  /** FTR-OVERLAY-REFS: Zotero overlay reference mapping for numeric citations */
  private overlayMapping?: OverlayReferenceMapping;

  constructor(entries: InspireReferenceEntry[]) {
    this.entries = entries;
    this.labelMap = new Map();
    this.indexMap = new Map();
    this.buildMaps();
    this.buildIdentifierIndexes();
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
   * FTR-REFACTOR: Build pre-computed identifier indexes for O(1) lookup.
   * This dramatically speeds up matching when entries have arXiv IDs, DOIs, or journal info.
   */
  private buildIdentifierIndexes(): void {
    this.arxivIndex.clear();
    this.doiIndex.clear();
    this.journalVolIndex.clear();
    this.journalVolPageIndex.clear();

    for (let idx = 0; idx < this.entries.length; idx++) {
      const entry = this.entries[idx];

      // Index by arXiv ID
      const arxiv = normalizeArxivId(entry.arxivDetails);
      if (arxiv && !this.arxivIndex.has(arxiv)) {
        this.arxivIndex.set(arxiv, idx);
      }

      // Index by DOI
      const doi = normalizeDoi(entry.doi);
      if (doi && !this.doiIndex.has(doi)) {
        this.doiIndex.set(doi, idx);
      }

      // Index by journal+volume and journal+volume+page
      if (entry.publicationInfo) {
        const pub = entry.publicationInfo;
        const journal = normalizeJournal(pub.journal_title);
        const volume = pub.journal_volume || pub.volume;
        const page = pub.page_start || pub.artid;

        if (journal && volume) {
          const jvKey = `${journal}:${volume}`;
          const existing = this.journalVolIndex.get(jvKey) || [];
          existing.push(idx);
          this.journalVolIndex.set(jvKey, existing);

          if (page) {
            const jvpKey = `${journal}:${volume}:${page}`;
            if (!this.journalVolPageIndex.has(jvpKey)) {
              this.journalVolPageIndex.set(jvpKey, idx);
            }
          }
        }
      }
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] LabelMatcher: built identifier indexes - ` +
        `arxiv=${this.arxivIndex.size}, doi=${this.doiIndex.size}, ` +
        `journalVol=${this.journalVolIndex.size}, journalVolPage=${this.journalVolPageIndex.size}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-REFACTOR: Fast identifier lookup methods using pre-computed indexes
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find entry by arXiv ID using pre-computed index.
   * @returns Entry index or -1 if not found
   */
  private findByArxiv(arxivId: string | undefined | null): number {
    if (!arxivId) return -1;
    const normalized = normalizeArxivId(arxivId);
    if (!normalized) return -1;
    return this.arxivIndex.get(normalized) ?? -1;
  }

  /**
   * Find entry by DOI using pre-computed index.
   * @returns Entry index or -1 if not found
   */
  private findByDoi(doi: string | undefined | null): number {
    if (!doi) return -1;
    const normalized = normalizeDoi(doi);
    if (!normalized) return -1;
    return this.doiIndex.get(normalized) ?? -1;
  }

  /**
   * Find entries by journal+volume using pre-computed index.
   * @returns Array of entry indices (may be empty)
   */
  private findByJournalVol(
    journal: string | undefined | null,
    volume: string | undefined | null,
  ): number[] {
    if (!journal || !volume) return [];
    const normalizedJournal = normalizeJournal(journal);
    if (!normalizedJournal) return [];
    const key = `${normalizedJournal}:${volume}`;
    return this.journalVolIndex.get(key) || [];
  }

  /**
   * Find entry by journal+volume+page using pre-computed index.
   * @returns Entry index or -1 if not found
   */
  private findByJournalVolPage(
    journal: string | undefined | null,
    volume: string | undefined | null,
    page: string | undefined | null,
  ): number {
    if (!journal || !volume || !page) return -1;
    const normalizedJournal = normalizeJournal(journal);
    if (!normalizedJournal) return -1;
    const key = `${normalizedJournal}:${volume}:${page}`;
    return this.journalVolPageIndex.get(key) ?? -1;
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
    // Prefer PDF mapping only when labels are missing/misaligned, duplicates exist, or strict mode is enabled; if labels are aligned and unique, disable by default
    this.pdfMappingUsable =
      this.pdfMappingStrict ||
      report.recommendation !== "USE_INSPIRE_LABEL" ||
      this.hasDuplicateLabels;
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] LabelMatcher: applied PDF mapping with ${mapping.totalLabels} labels; recommendation=${report.recommendation}; pdfMappingStrict=${this.pdfMappingStrict}; pdfMappingUsable=${this.pdfMappingUsable}; hasDuplicateLabels=${this.hasDuplicateLabels}`,
    );
  }

  /**
   * Set author-year reference mapping from PDF parsing.
   * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Enables precise matching using journal/volume/page info.
   */
  setAuthorYearMapping(mapping: AuthorYearReferenceMapping): void {
    this.authorYearMapping = mapping;
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] LabelMatcher: applied author-year mapping with ${mapping.authorYearMap.size} entries, confidence=${mapping.confidence}`,
    );
  }

  /**
   * Check if author-year mapping has been applied.
   */
  hasAuthorYearMapping(): boolean {
    return (
      this.authorYearMapping !== undefined &&
      this.authorYearMapping.authorYearMap.size > 0
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-OVERLAY-REFS: Zotero Overlay Reference Mapping (Numeric Citations Only)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set overlay reference mapping from Zotero's citation overlays.
   * FTR-OVERLAY-REFS: Enables precise matching for numeric citations using
   * Zotero's pre-built citation→reference relationships.
   *
   * IMPORTANT: This is only for NUMERIC citations ([1], [2], etc.).
   * Author-Year citations should use matchAuthorYear() instead.
   */
  setOverlayMapping(mapping: OverlayReferenceMapping): void {
    this.overlayMapping = mapping;
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] LabelMatcher: applied overlay mapping with ${mapping.totalMappedLabels} labels, reliable=${mapping.isReliable}`,
    );
  }

  /**
   * Check if overlay mapping has been applied and is reliable.
   */
  hasReliableOverlayMapping(): boolean {
    return this.overlayMapping?.isReliable === true;
  }

  /**
   * Try to match a numeric label using Zotero's overlay reference data.
   * This extracts identifiers (arXiv, DOI) from the reference text and
   * uses the pre-built identifier indexes for O(1) lookup.
   *
   * FTR-OVERLAY-MULTI-REF: Now returns an array of matches to support
   * citations that contain multiple papers under one label.
   * Example: "[1] Weinberg...; Gasser...; Nucl. Phys. B250..."
   *
   * @param label - Numeric label string (e.g., "1", "2")
   * @returns Array of match results (may be empty if no matches found)
   */
  private tryMatchByOverlay(label: string): MatchResult[] {
    if (!this.overlayMapping?.isReliable) return [];

    const overlayRefs = this.overlayMapping.labelToReference.get(label);
    if (!overlayRefs || overlayRefs.length === 0) return [];

    const results: MatchResult[] = [];
    const seenIndices = new Set<number>();

    // FTR-OVERLAY-MULTI-REF: Process each reference in the overlay
    // Note: A single overlayRef.text may contain multiple papers separated by semicolons
    // Example: "[1] Weinberg, Physica A 96, 327; Gasser, Ann. Phys. 158, 142; Nucl. Phys. B250, 465"
    for (const overlayRef of overlayRefs) {
      if (!overlayRef?.text) continue;

      const refText = overlayRef.text;

      // FTR-OVERLAY-MULTI-REF: Split by semicolons to handle multiple papers in one reference
      // But also try the full text in case semicolons are part of author names
      const textSegments = refText.split(/;\s*/).filter((s) => s.trim().length > 10);
      // If splitting produced nothing useful, use the full text
      if (textSegments.length === 0) {
        textSegments.push(refText);
      }

      Zotero.debug(
        `[${config.addonName}] [OVERLAY-REFS] Processing label [${label}]: ${textSegments.length} text segment(s) from "${refText.substring(0, 100)}..."`,
      );

      // Process each text segment (may be a single paper or multiple)
      for (const segment of textSegments) {
        // FTR-OVERLAY-ERRATUM: Detect and skip erratum segments
        // Erratum citations are abbreviated references to the same paper, not separate papers
        // Examples:
        // - "B602, 641(E) (2001)" - erratum for Nucl. Phys. B paper
        // - "Erratum: ibid. 602, 641 (2001)"
        // - "89, 019903(E) (2014)"
        //
        // Patterns:
        // 1. Contains "(E)" - explicit erratum marker
        // 2. Contains "Erratum" or "erratum"
        // 3. Starts with just volume number without journal name (e.g., "B602" or "89,")
        const isErratum =
          /\(E\)/.test(segment) ||
          /\berratum\b/i.test(segment) ||
          /^\s*[A-Z]?\d+\s*,/.test(segment); // Starts with optional letter + number + comma

        if (isErratum) {
          Zotero.debug(
            `[${config.addonName}] [OVERLAY-REFS] Skipping erratum segment: "${segment.substring(0, 50)}..."`,
          );
          continue; // Skip erratum segments - they're part of the previous paper
        }

        // Try to extract arXiv ID from this segment
        // Common patterns: arXiv:XXXX.XXXXX, arXiv:hep-th/XXXXXXX
        const arxivMatch = segment.match(
          /arXiv[:\s]*([\d.]+|[a-z-]+\/\d+)/i,
        );
        if (arxivMatch) {
          const normalized = normalizeArxivId(arxivMatch[1]);
          if (normalized) {
            const idx = this.arxivIndex.get(normalized);
            if (idx !== undefined && !seenIndices.has(idx)) {
              seenIndices.add(idx);
              Zotero.debug(
                `[${config.addonName}] [OVERLAY-REFS] Matched label [${label}] via arXiv ${normalized}`,
              );
              results.push({
                pdfLabel: label,
                entryIndex: idx,
                entryId: this.entries[idx]?.id,
                confidence: "high",
                matchMethod: "overlay",
                matchedIdentifier: { type: "arxiv", value: normalized },
              });
              continue; // Move to next segment
            }
          }
        }

        // Try to extract DOI from this segment
        // Common pattern: 10.XXXX/...
        const doiMatch = segment.match(/\b(10\.\d{4,}\/[^\s,;]+)/);
        if (doiMatch) {
          const normalized = normalizeDoi(doiMatch[1]);
          if (normalized) {
            const idx = this.doiIndex.get(normalized);
            if (idx !== undefined && !seenIndices.has(idx)) {
              seenIndices.add(idx);
              Zotero.debug(
                `[${config.addonName}] [OVERLAY-REFS] Matched label [${label}] via DOI ${normalized}`,
              );
              results.push({
                pdfLabel: label,
                entryIndex: idx,
                entryId: this.entries[idx]?.id,
                confidence: "high",
                matchMethod: "overlay",
                matchedIdentifier: { type: "doi", value: normalized },
              });
              continue; // Move to next segment
            }
          }
        }

        // Try journal+volume+page matching
        // FTR-OVERLAY-REFS-FIX: Use flexible journal matching with journalsSimilar()
        //
        // Common patterns in reference text:
        // - "Physica A (Amsterdam) 96, 327 (1979)"
        // - "Ann. Phys. (N.Y.) 158, 142 (1984)"
        // - "Phys. Rev. D 96, 054001 (2017)"
        // - "JHEP 05, 123 (2020)"
        // - "Nucl. Phys. B250, 465 (1985)" - note: volume may be attached to journal name

        // Step 1: Try the original specific patterns first (high precision)
        // FTR-OVERLAY-PAGE-SUFFIX: Support alphanumeric page/artid numbers:
        // - "96C" (conference proceedings like Nucl. Phys. A)
        // - "123C01" (PTEP style artid)
        // - "054001" (standard Physical Review artid)
        let journalMatched = false;
        const journalMatch = segment.match(
          /(?:Phys\.?\s*Rev\.?|Nucl\.?\s*Phys\.?|JHEP|JCAP|Eur\.?\s*Phys\.?\s*J\.?|Class\.?\s*Quantum\s*Grav\.?|Phys\.?\s*Lett\.?)[^\d]*(\d+)[^\d]*(\d+[A-Za-z]?\d*)/i,
        );
        if (journalMatch) {
          const journal = normalizeJournal(journalMatch[0].split(/\d/)[0].trim());
          const volume = journalMatch[1];
          const page = journalMatch[2];

          if (journal && volume && page) {
            const key = `${journal}:${volume}:${page}`;
            const idx = this.journalVolPageIndex.get(key);
            if (idx !== undefined && !seenIndices.has(idx)) {
              seenIndices.add(idx);
              Zotero.debug(
                `[${config.addonName}] [OVERLAY-REFS] Matched label [${label}] via journal ${journal}:${volume}:${page}`,
              );
              results.push({
                pdfLabel: label,
                entryIndex: idx,
                entryId: this.entries[idx]?.id,
                confidence: "high",
                matchMethod: "overlay",
                matchedIdentifier: {
                  type: "journal",
                  value: `${journal} ${volume}, ${page}`,
                },
              });
              journalMatched = true;
            }
          }
        }

        // Step 2: Fallback to flexible journal matching using journalsSimilar()
        // Extract generic patterns: "JournalName Volume, Page" or "JournalName Volume (Year) Page"
        // FTR-OVERLAY-PAGE-SUFFIX: Support alphanumeric artid like "96C", "123C01"
        if (!journalMatched) {
          const genericJournalMatch = segment.match(
            /([A-Za-z][A-Za-z.\s()]+?)\s+(\d+)\s*[,:(\s]\s*(\d+[A-Za-z]?\d*)/,
          );
          if (genericJournalMatch) {
            const possibleJournal = genericJournalMatch[1].trim();
            const volume = genericJournalMatch[2];
            const page = genericJournalMatch[3];

            // Search entries with matching volume and page, verify journal with journalsSimilar()
            for (let i = 0; i < this.entries.length; i++) {
              if (seenIndices.has(i)) continue;

              const entry = this.entries[i];
              if (!entry.publicationInfo) continue;

              const pub = entry.publicationInfo;
              const entryVol = pub.journal_volume || pub.volume;
              const entryPage = pub.page_start || pub.artid;

              if (
                entryVol &&
                String(entryVol) === volume &&
                entryPage &&
                String(entryPage) === page
              ) {
                // Volume and page match, now check journal name similarity
                if (journalsSimilar(possibleJournal, pub.journal_title)) {
                  seenIndices.add(i);
                  Zotero.debug(
                    `[${config.addonName}] [OVERLAY-REFS] Matched label [${label}] via flexible journal: "${possibleJournal}" ~ "${pub.journal_title}", vol=${volume}, page=${page}`,
                  );
                  results.push({
                    pdfLabel: label,
                    entryIndex: i,
                    entryId: entry.id,
                    confidence: "high",
                    matchMethod: "overlay",
                    matchedIdentifier: {
                      type: "journal",
                      value: `${pub.journal_title} ${volume}, ${page}`,
                    },
                  });
                  break; // Found match for this segment, move to next
                }
              }
            }
          }
        }
      }
    }

    if (results.length > 0) {
      // FTR-OVERLAY-ERRATUM: Clear any stale "missing" entries for this label
      // The overlay matching correctly handles erratum segments, so the earlier
      // PDF mapping's "missing" data may be incorrect (e.g., reporting erratum as missing)
      this.pdfMissingByLabel.delete(label);

      Zotero.debug(
        `[${config.addonName}] [OVERLAY-REFS] Label [${label}]: matched ${results.length} of ${overlayRefs.length} references`,
      );
    }

    return results;
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
    let pendingStrictDecision: {
      strictPref: boolean;
      mismatchDetected: boolean;
      wellAligned: boolean;
      finalTotal?: number;
      mismatch?: number;
      ratio?: number;
    } | null = null;
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
        const pdfCount =
          nonErrataInfos.length > 0 ? nonErrataInfos.length : pdfCountRaw;

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
        // FTR-MISSING-FIX: Track which PDF paper indices have been matched (not just count)
        const matchedPaperIndices = new Set<number>();

        for (
          let pdfPaperIdx = 0;
          pdfPaperIdx < nonErrataInfos.length;
          pdfPaperIdx++
        ) {
          const pdfPaper = nonErrataInfos[pdfPaperIdx];
          if (pdfPaper.isErratum && matchedCount > 0) {
            // Skip counting erratum entries; they share the base paper
            continue;
          }
          // Try to find a matching INSPIRE entry
          let bestMatchIdx: number | null = null;
          let bestMatchScore = 0;

          for (let j = 0; j < availableInspireEntries.length; j++) {
            if (usedIndices.has(j)) continue; // Skip already matched entries

            const score = this.calculateMatchScore(
              pdfPaper,
              availableInspireEntries[j],
            );
            if (score > bestMatchScore) {
              bestMatchScore = score;
              bestMatchIdx = j;
            }
          }

          // Accept match if score is good enough
          if (
            bestMatchIdx !== null &&
            bestMatchScore >= SCORE.VALIDATION_ACCEPT
          ) {
            usedIndices.add(bestMatchIdx);
            matchedCount++;
            matchedPaperIndices.add(pdfPaperIdx);
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
          for (
            let pdfPaperIdx = 0;
            pdfPaperIdx < paperInfos.length;
            pdfPaperIdx++
          ) {
            const pdfPaper = paperInfos[pdfPaperIdx];
            let bestMatchIdx: number | null = null;
            let bestMatchScore = 0;
            for (let j = 0; j < availableInspireEntries.length; j++) {
              if (usedIndices.has(j)) continue;
              const score = this.calculateMatchScore(
                pdfPaper,
                availableInspireEntries[j],
              );
              if (score > bestMatchScore) {
                bestMatchScore = score;
                bestMatchIdx = j;
              }
            }
            if (
              bestMatchIdx !== null &&
              bestMatchScore >= SCORE.VALIDATION_ACCEPT
            ) {
              usedIndices.add(bestMatchIdx);
              matchedCount++;
              matchedPaperIndices.add(pdfPaperIdx);
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
          effectiveCount = Math.min(
            pdfCount,
            Math.max(1, totalInspire - currentInspireIdx),
          );
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Label [${label}]: validation 0/${pdfCount}, reserving ${effectiveCount} slot(s) to avoid index collapse`,
          );
        }

        adjustedCounts[i] = effectiveCount;

        // FTR-MISSING-FIX: Record actually unmatched papers (not just tail slice)
        if (nonErrataInfos.length > 0) {
          const unmatchedPapers = nonErrataInfos.filter(
            (_, idx) => !matchedPaperIndices.has(idx),
          );
          if (unmatchedPapers.length > 0) {
            this.pdfMissingByLabel.set(label, unmatchedPapers);
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] [${label}] Unmatched papers: ${unmatchedPapers.map((p) => `${p.firstAuthorLastName || "?"} ${p.year || "?"}`).join(", ")}`,
            );
          } else {
            this.pdfMissingByLabel.delete(label);
          }
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
      const { strictPref, mismatchDetected, wellAligned } =
        pendingStrictDecision;
      this.pdfOverParsed =
        (pendingStrictDecision.finalTotal ?? finalTotal) > totalInspire;
      this.pdfOverParsedRatio =
        totalInspire > 0
          ? (pendingStrictDecision.finalTotal ?? finalTotal) / totalInspire
          : 1;
      this.pdfMappingStrict =
        strictPref &&
        mismatchDetected &&
        !wellAligned &&
        coverage >= 0.5 &&
        !this.pdfOverParsed; // Avoid strict sequence mapping when PDF parsing clearly over-parses
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
    if (
      !pdfPaper.firstAuthorLastName &&
      !pdfPaper.year &&
      !pdfPaper.pageStart
    ) {
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
          const inspireLastName = extractLastName(firstAuthorFull);

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
   * FTR-REFACTOR: Now uses shared calculateCompositeScore from matchScoring.
   */
  private calculateMatchScore(
    pdfPaper: PDFPaperInfo,
    entry: InspireReferenceEntry,
  ): number {
    const result = calculateCompositeScore(pdfPaper, entry);
    return result.total;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-REFACTOR: The following utility methods have been moved to shared modules:
  // - normalizeArxivId, normalizeDoi, normalizeJournal, stripParenthetical -> matchScoring.ts
  // - normalizeAuthorName, authorsMatch, extractLastName -> authorUtils.ts
  // - getStrongMatchKind, isJournalMatch, journalsSimilar, etc. -> matchScoring.ts
  // Now using imported functions instead of private methods.
  // ─────────────────────────────────────────────────────────────────────────────

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
      nonErrataInfos.length > 0 ? nonErrataInfos : paperInfosRaw;
    const expectedCount = paperInfos ? paperInfos.length : 0;
    const overParsedActive =
      this.pdfOverParsed && this.pdfOverParsedRatio > 1.05;

    // FTR-MISSING-FIX: Track which PDF paper indices have been matched (function-level scope)
    const matchedPaperIndices = new Set<number>();

    // FTR-NO-LABELS-FIX: Calculate noLabelsInInspire early so we can use it throughout the function
    const maxInspireLabel = this.getMaxInspireLabel();
    const noLabelsInInspire = maxInspireLabel === 0;

    // ─────────────────────────────────────────────────────────────────────────────
    // FTR-OVERLAY-REFS: Try overlay matching first for numeric labels
    // Zotero's overlay provides the most accurate citation→reference mapping
    // This is only used for numeric citations - Author-Year uses matchAuthorYear()
    // FTR-OVERLAY-MULTI-REF: Now returns array to support multiple papers per label
    // ─────────────────────────────────────────────────────────────────────────────
    if (this.hasReliableOverlayMapping()) {
      const overlayMatches = this.tryMatchByOverlay(normalizedLabel);
      if (overlayMatches.length > 0) {
        // Overlay matches found - return immediately as this is the most reliable source
        // FTR-OVERLAY-MULTI-REF: Returns all matched papers under this label
        return overlayMatches;
      }
      // No overlay match - continue with other strategies
    }

    const preferPdfMapping =
      this.pdfLabelMap &&
      !noLabelsInInspire && // Don't prefer sequence-based PDF mapping when no labels exist
      (this.pdfMappingStrict ||
        this.pdfMappingUsable ||
        this.hasDuplicateLabels ||
        alignment.recommendation !== "USE_INSPIRE_LABEL");
    const preferSeqMapping =
      this.pdfLabelMap && preferPdfMapping && !overParsedActive;

    // Diagnose where matching label/arXiv might reside in INSPIRE entries and pre-add aligned labels
    if (paperInfos?.length) {
      const firstPaper = paperInfos[0];
      const targetArxiv = normalizeArxivId(firstPaper.arxivId);
      const labelMatches: Array<{
        idx: number;
        entryId: string | undefined;
        inspireLabel: string | null;
        arxiv: string | null;
      }> = [];
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        const entryLabel = entry.label ?? null;
        const entryArxiv = normalizeArxivId(entry.arxivDetails) ?? null;
        if (entryLabel && entryLabel.trim() === normalizedLabel) {
          labelMatches.push({
            idx: i,
            entryId: entry.id,
            inspireLabel: entryLabel,
            arxiv: entryArxiv,
          });
        }
        if (targetArxiv && entryArxiv && entryArxiv === targetArxiv) {
          // keep for potential future use; currently unused
        }
      }

      if (labelMatches.length > 0) {
        for (const m of labelMatches) {
          results.push({
            pdfLabel: normalizedLabel,
            entryIndex: m.idx,
            entryId: m.entryId,
            confidence: "high",
            matchMethod: "exact",
          });
        }
      }
    }

    // FTR-PDF-MATCHING: Log diagnostic info for version mismatch cases
    // NOTE: Only log as VERSION-MISMATCH when labels exist but PDF label exceeds max
    // If maxInspireLabel is 0, it means INSPIRE has no labels (not a version mismatch)
    const numLabelForDiag = parseInt(normalizedLabel, 10);
    if (
      !isNaN(numLabelForDiag) &&
      !noLabelsInInspire &&
      numLabelForDiag > maxInspireLabel
    ) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH] Label [${normalizedLabel}] exceeds INSPIRE max ${maxInspireLabel}. ` +
          `paperInfos=${paperInfos ? `${paperInfos.length} paper(s)` : "NONE"}. ` +
          `arXiv=${paperInfos?.[0]?.arxivId || "N/A"}, DOI=${paperInfos?.[0]?.doi || "N/A"}`,
      );
    }

    // Strong matching first: arXiv/DOI/journal+volume(+page)+author+year
    let hasStrong = false;
    if (paperInfos?.length) {
      const nonErrataInfos = paperInfos.filter((p) => !p.isErratum);
      const papersForStrong =
        nonErrataInfos.length > 0 ? nonErrataInfos : paperInfos;
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
      let best: {
        idx: number;
        kind: "arxiv" | "doi" | "journal";
        score: number;
        entry: InspireReferenceEntry;
      } | null = null;
      const searchBuckets: number[][] = [];
      searchBuckets.push(indicesToCheckPrimary);
      if (mappedIndices && mappedIndices.length) {
        const min = Math.max(0, Math.min(...mappedIndices) - 1);
        const max = Math.min(
          this.entries.length - 1,
          Math.max(...mappedIndices) + 1,
        );
        const window: number[] = [];
        for (let i = min; i <= max; i++) window.push(i);
        searchBuckets.push(window);
      } else {
        searchBuckets.push(this.entries.map((_, idx) => idx));
      }

      for (const pdfPaper of papersForStrong) {
        for (const bucket of searchBuckets) {
          for (const i of bucket) {
            const mk = getStrongMatchKind(pdfPaper, this.entries[i]);
            if (!mk) continue;
            const priority =
              mk.kind === "arxiv" ? 3 : mk.kind === "doi" ? 2 : 1;
            const bestPri = best
              ? best.kind === "arxiv"
                ? 3
                : best.kind === "doi"
                  ? 2
                  : 1
              : 0;
            candidateLogs.push({
              pdfIdx: paperInfos.indexOf(pdfPaper),
              entryIdx: i,
              kind: mk.kind,
              score: mk.score,
              entryLabel: this.entries[i].label ?? null,
            });
            if (
              !best ||
              priority > bestPri ||
              (priority === bestPri && mk.score > best.score)
            ) {
              best = {
                idx: i,
                kind: mk.kind,
                score: mk.score,
                entry: this.entries[i],
              };
            }
          }
        }
      }
      if (best) {
        hasStrong = true;
        if (expectedCount === 0 || results.length < expectedCount) {
          // FTR-PDF-MATCHING: Build identifier info for diagnostic feedback
          let matchedIdentifier:
            | { type: "arxiv" | "doi" | "journal"; value: string }
            | undefined;
          if (best.kind === "arxiv") {
            const arxivId = normalizeArxivId(best.entry.arxivDetails);
            if (arxivId) matchedIdentifier = { type: "arxiv", value: arxivId };
          } else if (best.kind === "doi") {
            const doi = normalizeDoi(best.entry.doi);
            if (doi) matchedIdentifier = { type: "doi", value: doi };
          } else if (best.kind === "journal") {
            const pub = best.entry.publicationInfo;
            if (pub)
              matchedIdentifier = {
                type: "journal",
                value:
                  `${pub.journal_title || ""} ${pub.journal_volume || ""}`.trim(),
              };
          }

          // FTR-MISSING-FIX: Calculate and track the source paper index
          const pdfPaperIdx = paperInfos
            ? paperInfos.indexOf(
                papersForStrong[
                  papersForStrong.findIndex(
                    (p) => getStrongMatchKind(p, best.entry) !== null,
                  )
                ],
              )
            : -1;

          results.push({
            pdfLabel,
            entryIndex: best.idx,
            entryId: best.entry.id,
            confidence: "high",
            matchMethod: "exact",
            matchedIdentifier,
            score: best.score,
            sourcePaperIndex: pdfPaperIdx >= 0 ? pdfPaperIdx : undefined,
          });

          // FTR-MISSING-FIX: Track this paper as matched
          if (pdfPaperIdx >= 0) {
            matchedPaperIndices.add(pdfPaperIdx);
          }
        }
      }

      // Keep strong matches; pdf mapping may still be added later
      // If no strong match and labels are missing/misaligned/over-parsed/strict without other results, avoid risky fallback
      const trustInspireLabels =
        alignment.recommendation === "USE_INSPIRE_LABEL" &&
        !this.pdfMappingStrict &&
        !overParsedActive;

      // FTR-PDF-MATCHING: Before returning empty, check if this is a version mismatch case
      // where PDF label exceeds INSPIRE max - use global arXiv/DOI search
      // NOTE: If maxInspireLabel is 0, it means INSPIRE has no labels at all, not a version mismatch
      if (!trustInspireLabels && results.length === 0) {
        const numLabel = parseInt(normalizedLabel, 10);
        const maxInspireLabel = this.getMaxInspireLabel();
        const noLabelsInInspire = maxInspireLabel === 0;

        // Version mismatch: PDF has more refs than INSPIRE - try global identifier search
        // Don't treat "no labels in INSPIRE" as version mismatch - fall through to index fallback
        if (
          !noLabelsInInspire &&
          !isNaN(numLabel) &&
          numLabel > maxInspireLabel &&
          paperInfos?.length
        ) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH-SEARCH] Label [${normalizedLabel}] exceeds max ${maxInspireLabel}, trying global arXiv/DOI search`,
          );

          for (const pdfPaper of paperInfos) {
            const pdfArxivNorm = normalizeArxivId(pdfPaper.arxivId);
            const pdfDoiNorm = normalizeDoi(pdfPaper.doi);

            if (!pdfArxivNorm && !pdfDoiNorm) {
              Zotero.debug(
                `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH-SEARCH] No arXiv/DOI in paperInfo for [${normalizedLabel}]`,
              );
              continue;
            }

            for (let i = 0; i < this.entries.length; i++) {
              const entry = this.entries[i];
              const entryArxivNorm = normalizeArxivId(entry.arxivDetails);
              const entryDoiNorm = normalizeDoi(entry.doi);

              // arXiv match
              if (
                pdfArxivNorm &&
                entryArxivNorm &&
                pdfArxivNorm === entryArxivNorm
              ) {
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
                // do not return; allow final sorting
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
                // do not return; allow final sorting
              }
            }
          }

          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] [VERSION-MISMATCH-SEARCH] No arXiv/DOI match found for [${normalizedLabel}]`,
          );
          // For actual version mismatch with no arXiv/DOI match, continue to fallback logic
        }

        // If no labels in INSPIRE (not a version mismatch), don't return early
        // Fall through to Strategy 2 (index fallback) instead
        if (noLabelsInInspire) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] No labels in INSPIRE, falling through to index-based matching for [${normalizedLabel}]`,
          );
        }
      }
    }

    // If PDF mapping exists, append all mapped entries (avoid early return with only strong matches)
    // FTR-NO-LABELS-FIX: Skip sequence-based pdfLabelMap when INSPIRE has no labels
    // because sequence mapping assumes PDF order matches INSPIRE order, which may be incorrect
    let pdfMapHasAlignedLabel = false;
    if (this.pdfLabelMap && !noLabelsInInspire) {
      const mapped = this.pdfLabelMap.get(normalizedLabel) || [];
      const added: number[] = [];
      for (const idx of mapped) {
        if (expectedCount > 0 && results.length >= expectedCount) break;
        const exists = results.some((r) => r.entryIndex === idx);
        if (!exists) {
          const inspireLabel = this.entries[idx]?.label ?? null;
          const labelMatchesPdf =
            inspireLabel && inspireLabel.trim() === normalizedLabel;
          if (labelMatchesPdf) {
            pdfMapHasAlignedLabel = true;
          }
          results.push({
            pdfLabel,
            entryIndex: idx,
            entryId: this.entries[idx].id,
            confidence: labelMatchesPdf
              ? this.pdfMapping?.confidence === "high"
                ? "high"
                : hasStrong
                  ? "medium"
                  : "low"
              : "low",
            matchMethod: labelMatchesPdf ? "exact" : "inferred",
          });
          added.push(idx);
        }
      }
    }

    // NOTE: Reconciliation moved to end of match() function, before return statements.
    // This ensures all matching logic has completed before determining unmatched papers.

    // When PDF mapping is misaligned and INSPIRE labels are duplicated, allow continuing to later strategies
    const allowFallbackAfterPdfMap =
      results.length > 0 && this.hasDuplicateLabels && !pdfMapHasAlignedLabel;

    // Do not return early; we will sort and slice at the end

    // If strict mode is on (PDF/INSPIRE diverged) and we have PDF mapping, do not fall back to index
    // FTR-NO-LABELS-FIX: Also skip strict mode sequence mapping when no labels exist
    if (this.pdfMappingStrict && this.pdfLabelMap && !noLabelsInInspire) {
      const pdfMatches = this.pdfLabelMap.get(normalizedLabel);
      // Prepare global fallback (even if pdfLabelMap has results, arXiv can override)
      const paperInfos = this.pdfPaperInfos?.get(normalizedLabel);

      // If mapping exists, add it first (can be overridden by fallback)
      if (pdfMatches && pdfMatches.length > 0) {
        for (const idx of pdfMatches) {
          results.push({
            pdfLabel,
            entryIndex: idx,
            entryId: this.entries[idx].id,
            confidence:
              this.pdfMapping?.confidence === "high" ? "high" : "medium",
            matchMethod: "exact",
          });
        }
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Match via PDF mapping (strict): [${pdfLabel}] -> ${pdfMatches.length} entries`,
        );
      }

      // Global fallback (prioritize arXiv); when PDF parsing over-parses, prefer this path
      const shouldForceGlobalFallback =
        this.pdfOverParsed && this.pdfOverParsedRatio > 1.05;
      if (paperInfos?.length) {
        let bestAny: {
          idx: number;
          score: number;
          paper: PDFPaperInfo;
          yearOk: boolean;
          yearDelta: number | null;
          arxivOk: boolean;
        } | null = null;
        let bestYearOk: {
          idx: number;
          score: number;
          paper: PDFPaperInfo;
          yearOk: boolean;
          yearDelta: number | null;
          arxivOk: boolean;
        } | null = null;
        let bestArxiv: {
          idx: number;
          score: number;
          paper: PDFPaperInfo;
        } | null = null;
        for (const paper of paperInfos) {
          const pdfArxivNorm = normalizeArxivId(paper.arxivId);
          for (let i = 0; i < this.entries.length; i++) {
            const score = this.calculateMatchScore(paper, this.entries[i]);
            const entryYear = this.entries[i].year;
            const yearDelta =
              paper.year && entryYear
                ? Math.abs(parseInt(paper.year, 10) - parseInt(entryYear, 10))
                : null;
            const yearOk =
              yearDelta !== null && yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE; // Accept up to ±3 years (arXiv vs published)
            const entryArxivNorm = normalizeArxivId(
              this.entries[i].arxivDetails,
            );
            const arxivOk =
              !!pdfArxivNorm &&
              !!entryArxivNorm &&
              pdfArxivNorm === entryArxivNorm;
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

        // Selection priority: arXiv > year match (score within 1 of best) > global best
        let chosenIdx: number | null = null;
        let chosenScore = 0;
        let chosenYearOk = false;
        let chosenYearDelta: number | null = null;
        let chosenArxivOk = false;
        if (bestArxiv) {
          chosenIdx = bestArxiv.idx;
          chosenScore = bestArxiv.score;
          chosenArxivOk = true;
        } else if (
          bestYearOk &&
          (!bestAny || bestYearOk.score >= bestAny.score - 1)
        ) {
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
            // Override previous results to prioritize arXiv/year matches; when over-parsed, force override sequence mapping
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
        (pdfMatches && pdfMatches.length > 0) ||
        (paperInfos && paperInfos.length > 0);
      // Do not return here; allow downstream strategies and final sorting
    }

    // Strategy 0a: If over-parsed, try global best (arXiv/DOI/author/year) before trusting sequence mapping
    if (preferPdfMapping && overParsedActive && paperInfos?.length) {
      let bestAny: {
        idx: number;
        score: number;
        yearOk: boolean;
        yearDelta: number | null;
        arxivOk: boolean;
        doiOk: boolean;
      } | null = null;
      let bestYearOk: {
        idx: number;
        score: number;
        yearOk: boolean;
        yearDelta: number | null;
        arxivOk: boolean;
        doiOk: boolean;
      } | null = null;
      let bestArxiv: { idx: number; score: number } | null = null;
      let bestDoi: { idx: number; score: number } | null = null;
      for (const pdfPaper of paperInfos) {
        const pdfArxivNorm = normalizeArxivId(pdfPaper.arxivId);
        const pdfDoiNorm = normalizeDoi(pdfPaper.doi);
        for (let i = 0; i < this.entries.length; i++) {
          const score = this.calculateMatchScore(pdfPaper, this.entries[i]);
          const entryYear = this.entries[i].year;
          const yearDelta =
            pdfPaper.year && entryYear
              ? Math.abs(parseInt(pdfPaper.year, 10) - parseInt(entryYear, 10))
              : null;
          const yearOk =
            yearDelta !== null && yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE;
          const entryArxivNorm = normalizeArxivId(this.entries[i].arxivDetails);
          const arxivOk =
            !!pdfArxivNorm &&
            !!entryArxivNorm &&
            pdfArxivNorm === entryArxivNorm;
          const entryDoiNorm = normalizeDoi(this.entries[i].doi);
          const doiOk =
            !!pdfDoiNorm && !!entryDoiNorm && pdfDoiNorm === entryDoiNorm;
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
      } else if (
        bestYearOk &&
        (!bestAny || bestYearOk.score >= bestAny.score - 1)
      ) {
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
            confidence:
              chosenArxivOk || chosenDoiOk
                ? "high"
                : chosenYearOk
                  ? "high"
                  : "medium",
            matchMethod:
              chosenArxivOk || chosenDoiOk ? "exact" : "strict-fallback",
          });
          // do not return; allow final sorting
        }
      }
    }

    // Special handling: PDF lists multiple papers but INSPIRE has no labels.
    // Pick best match per paper to avoid grouping both into one entry.
    // FTR-POSITION-AWARE: Use label number as hint for expected INSPIRE position.
    // This prevents matching to distant entries when score is marginal (author+year only).
    if (noLabelsInInspire && paperInfos && paperInfos.length > 1) {
      const labelNum = parseInt(normalizedLabel, 10);
      // Calculate expected position range based on label number
      // Label N should correspond to entries roughly around N-1 (0-indexed)
      // Allow slack for multi-paper labels: search [N-2, N*2+8]
      const expectedMinIdx = isNaN(labelNum) ? 0 : Math.max(0, labelNum - 2);
      const expectedMaxIdx = isNaN(labelNum)
        ? this.entries.length - 1
        : Math.min(this.entries.length - 1, labelNum * 2 + 8);

      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Multi-paper handling for [${normalizedLabel}]: ${paperInfos.length} papers, ` +
          `searching ${this.entries.length} entries (expected range: ${expectedMinIdx}-${expectedMaxIdx})`,
      );

      const used = new Set<number>();
      for (let pIdx = 0; pIdx < paperInfos.length; pIdx++) {
        const pdfPaper = paperInfos[pIdx];

        // Phase 1: Search in expected local window first
        let bestLocalIdx = -1;
        let bestLocalScore = 0;
        for (let i = expectedMinIdx; i <= expectedMaxIdx; i++) {
          if (used.has(i)) continue;
          const score = this.calculateMatchScore(pdfPaper, this.entries[i]);
          if (score > bestLocalScore) {
            bestLocalScore = score;
            bestLocalIdx = i;
          }
        }

        // Phase 2: If local match is weak, try global search
        // But only accept global match if score is high (has journal/DOI/arXiv match)
        let bestIdx = bestLocalIdx;
        let bestScore = bestLocalScore;

        if (
          bestLocalScore < SCORE.VALIDATION_ACCEPT ||
          bestLocalScore <= SCORE.MARGINAL_THRESHOLD
        ) {
          // Local match is weak, try global search
          let bestGlobalIdx = -1;
          let bestGlobalScore = 0;
          for (let i = 0; i < this.entries.length; i++) {
            if (used.has(i)) continue;
            if (i >= expectedMinIdx && i <= expectedMaxIdx) continue; // Skip local range (already searched)
            const score = this.calculateMatchScore(pdfPaper, this.entries[i]);
            if (score > bestGlobalScore) {
              bestGlobalScore = score;
              bestGlobalIdx = i;
            }
          }

          // Only accept global match if it's significantly better AND has strong identifier
          // (score > 8 means likely has journal/DOI/arXiv match)
          if (
            bestGlobalScore > bestLocalScore &&
            bestGlobalScore > SCORE.MARGINAL_THRESHOLD
          ) {
            bestIdx = bestGlobalIdx;
            bestScore = bestGlobalScore;
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] Multi-paper[${pIdx}] using global match idx=${bestGlobalIdx} (score=${bestGlobalScore}) over local idx=${bestLocalIdx} (score=${bestLocalScore})`,
            );
          } else if (bestGlobalScore > bestLocalScore) {
            // Global has higher score but it's marginal - log warning and use local if available
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] Multi-paper[${pIdx}] rejecting distant global match idx=${bestGlobalIdx} (score=${bestGlobalScore}, marginal) - preferring local idx=${bestLocalIdx} (score=${bestLocalScore})`,
            );
          }
        }

        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Multi-paper[${pIdx}] "${pdfPaper.firstAuthorLastName || "?"} ${pdfPaper.year || "?"} ${pdfPaper.journalAbbrev || ""} ${pdfPaper.volume || ""}": bestIdx=${bestIdx}, bestScore=${bestScore}, threshold=${SCORE.VALIDATION_ACCEPT}`,
        );
        if (bestIdx >= 0 && bestScore >= SCORE.VALIDATION_ACCEPT) {
          used.add(bestIdx);
          const entry = this.entries[bestIdx];
          const confidence =
            bestScore >= SCORE.NO_YEAR_ACCEPT
              ? "high"
              : bestScore >= SCORE.YEAR_MATCH_ACCEPT
                ? "medium"
                : "low";
          results.push({
            pdfLabel,
            entryIndex: bestIdx,
            entryId: entry.id,
            confidence: confidence as MatchConfidence,
            matchMethod:
              bestScore >= SCORE.JOURNAL_EXACT ? "exact" : "strict-fallback",
            matchedIdentifier: undefined,
            score: bestScore,
          });
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
            matchMethod: overParsedActive ? "inferred" : "exact", // downgrade confidence when over-parsed
          });
        }
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Match via PDF mapping: [${pdfLabel}] -> ${pdfMatches.length} entries (preferPdfMapping=${preferPdfMapping}, hasDuplicateLabels=${this.hasDuplicateLabels}, recommendation=${alignment.recommendation})`,
        );
        // do not return; allow final sorting
      }
    }

    // If preferPdfMapping but no direct pdfLabelMap hit, try global best from PDF paperInfos
    // FTR-POSITION-AWARE: Use position-aware matching to prevent wrong distant matches
    if (preferPdfMapping && paperInfos?.length) {
      // Calculate expected position range based on label number
      const labelNumForPos = parseInt(normalizedLabel, 10);
      const expectedMinIdx = isNaN(labelNumForPos)
        ? 0
        : Math.max(0, labelNumForPos - 2);
      const expectedMaxIdx = isNaN(labelNumForPos)
        ? this.entries.length - 1
        : Math.min(this.entries.length - 1, labelNumForPos * 2 + 8);

      // Track both local and global best matches
      type BestMatch = {
        idx: number;
        score: number;
        yearOk: boolean;
        yearDelta: number | null;
        arxivOk: boolean;
      };
      let bestLocalAny: BestMatch | null = null;
      let bestLocalYearOk: BestMatch | null = null;
      let bestLocalArxiv: { idx: number; score: number } | null = null;
      let bestGlobalAny: BestMatch | null = null;
      let bestGlobalYearOk: BestMatch | null = null;
      let bestGlobalArxiv: { idx: number; score: number } | null = null;

      for (const pdfPaper of paperInfos) {
        const pdfArxivNorm = normalizeArxivId(pdfPaper.arxivId);
        for (let i = 0; i < this.entries.length; i++) {
          const score = this.calculateMatchScore(pdfPaper, this.entries[i]);
          const entryYear = this.entries[i].year;
          const yearDelta =
            pdfPaper.year && entryYear
              ? Math.abs(parseInt(pdfPaper.year, 10) - parseInt(entryYear, 10))
              : null;
          const yearOk =
            yearDelta !== null && yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE;
          const entryArxivNorm = normalizeArxivId(this.entries[i].arxivDetails);
          const arxivOk =
            !!pdfArxivNorm &&
            !!entryArxivNorm &&
            pdfArxivNorm === entryArxivNorm;
          const matchData: BestMatch = {
            idx: i,
            score,
            yearOk,
            yearDelta,
            arxivOk,
          };

          // Determine if this entry is in the expected local range
          const isLocal = i >= expectedMinIdx && i <= expectedMaxIdx;

          if (isLocal) {
            if (!bestLocalAny || score > bestLocalAny.score)
              bestLocalAny = matchData;
            if (yearOk && (!bestLocalYearOk || score > bestLocalYearOk.score))
              bestLocalYearOk = matchData;
            if (arxivOk && (!bestLocalArxiv || score > bestLocalArxiv.score))
              bestLocalArxiv = { idx: i, score };
          } else {
            if (!bestGlobalAny || score > bestGlobalAny.score)
              bestGlobalAny = matchData;
            if (yearOk && (!bestGlobalYearOk || score > bestGlobalYearOk.score))
              bestGlobalYearOk = matchData;
            if (arxivOk && (!bestGlobalArxiv || score > bestGlobalArxiv.score))
              bestGlobalArxiv = { idx: i, score };
          }
        }
      }

      // Decision: Prefer local matches, only use global if it has strong identifier or high score
      let chosenIdx: number | null = null;
      let chosenScore = 0;
      let chosenYearOk = false;
      let chosenYearDelta: number | null = null;
      let chosenArxivOk = false;
      let chosenPubPri = 0;

      // Priority 1: arXiv match (local first, then global)
      if (bestLocalArxiv) {
        chosenIdx = bestLocalArxiv.idx;
        chosenScore = bestLocalArxiv.score;
        chosenArxivOk = true;
      } else if (bestGlobalArxiv) {
        chosenIdx = bestGlobalArxiv.idx;
        chosenScore = bestGlobalArxiv.score;
        chosenArxivOk = true;
      }
      // Priority 2: Year-matched with good score (local first)
      else if (
        bestLocalYearOk &&
        bestLocalYearOk.score >= SCORE.YEAR_MATCH_ACCEPT
      ) {
        chosenIdx = bestLocalYearOk.idx;
        chosenScore = bestLocalYearOk.score;
        chosenYearOk = true;
        chosenYearDelta = bestLocalYearOk.yearDelta;
        chosenArxivOk = bestLocalYearOk.arxivOk;
      }
      // Priority 3: Global year-matched only if score is high (not marginal)
      else if (
        bestGlobalYearOk &&
        bestGlobalYearOk.score > SCORE.MARGINAL_THRESHOLD
      ) {
        chosenIdx = bestGlobalYearOk.idx;
        chosenScore = bestGlobalYearOk.score;
        chosenYearOk = true;
        chosenYearDelta = bestGlobalYearOk.yearDelta;
        chosenArxivOk = bestGlobalYearOk.arxivOk;
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] [POSITION-AWARE] Accepting global match idx=${chosenIdx} (score=${chosenScore} > ${SCORE.MARGINAL_THRESHOLD})`,
        );
      }
      // Priority 4: Local best match
      else if (bestLocalAny && bestLocalAny.score >= SCORE.VALIDATION_ACCEPT) {
        chosenIdx = bestLocalAny.idx;
        chosenScore = bestLocalAny.score;
        chosenYearOk = bestLocalAny.yearOk;
        chosenYearDelta = bestLocalAny.yearDelta;
        chosenArxivOk = bestLocalAny.arxivOk;
      }
      // Priority 5: Global best only if score is high (reject marginal distant matches)
      else if (
        bestGlobalAny &&
        bestGlobalAny.score > SCORE.MARGINAL_THRESHOLD
      ) {
        chosenIdx = bestGlobalAny.idx;
        chosenScore = bestGlobalAny.score;
        chosenYearOk = bestGlobalAny.yearOk;
        chosenYearDelta = bestGlobalAny.yearDelta;
        chosenArxivOk = bestGlobalAny.arxivOk;
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] [POSITION-AWARE] Accepting global match idx=${chosenIdx} (score=${chosenScore} > ${SCORE.MARGINAL_THRESHOLD})`,
        );
      } else if (bestGlobalAny) {
        // Log rejection of marginal distant match
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] [POSITION-AWARE] Rejecting distant global match idx=${bestGlobalAny.idx} (score=${bestGlobalAny.score} <= ${SCORE.MARGINAL_THRESHOLD}, expected range [${expectedMinIdx}-${expectedMaxIdx}])`,
        );
      }

      if (chosenIdx !== null) {
        const entry = this.entries[chosenIdx];
        chosenPubPri = computePublicationPriority(paperInfos?.[0], entry);
        const accept =
          chosenArxivOk ||
          (chosenYearOk && chosenScore >= SCORE.YEAR_MATCH_ACCEPT) ||
          (!paperInfos[0].year && chosenScore >= SCORE.NO_YEAR_ACCEPT);
        const acceptWithPub = accept; // relax again: allow when score ok even without pub/identifier for single
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Fallback via PDF paperInfos for [${pdfLabel}]: idx=${chosenIdx}, score=${chosenScore}, yearOk=${chosenYearOk}, yearDelta=${chosenYearDelta}, arxivOk=${chosenArxivOk}, pubPri=${chosenPubPri}, accept=${acceptWithPub}, range=[${expectedMinIdx}-${expectedMaxIdx}]`,
        );
        if (acceptWithPub) {
          results.push({
            pdfLabel,
            entryIndex: chosenIdx,
            entryId: entry.id,
            confidence: chosenArxivOk
              ? "high"
              : chosenYearOk
                ? "high"
                : "medium",
            matchMethod: "strict-fallback",
            matchedIdentifier: chosenArxivOk
              ? {
                  type: "arxiv",
                  value: normalizeArxivId(paperInfos[0].arxivId) ?? "arxiv",
                }
              : undefined,
          });
        }
      }
    }

    // When labels are duplicated and we prefer PDF mapping, allow downstream strategies instead of early-returning
    if (preferPdfMapping && this.hasDuplicateLabels) {
      const labelMatchesDup = this.labelMap.get(normalizedLabel);
      if (labelMatchesDup && labelMatchesDup.length > 0) {
        const idx = labelMatchesDup[0];
        const entry = this.entries[idx];
        results.push({
          pdfLabel,
          entryIndex: idx,
          entryId: entry.id,
          confidence: "medium",
          matchMethod: "inferred",
        });
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Duplicate INSPIRE labels; using first entry as last resort for [${pdfLabel}] -> idx=${idx}, totalDup=${labelMatchesDup.length}`,
        );
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
      }
      // Continue to later strategies; do not return early
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
      // Do NOT return; continue to allow combined results sorting
    }

    // If labelMatches exist and no aligned result yet, force-add a highest-priority label match
    if (labelMatches && labelMatches.length > 0) {
      const hasAligned = results.some((r) => {
        const lab = this.entries[r.entryIndex]?.label ?? null;
        return lab && lab.trim() === normalizedLabel;
      });
      if (!hasAligned) {
        const idx = labelMatches[0];
        results.push({
          pdfLabel: normalizedLabel,
          entryIndex: idx,
          entryId: this.entries[idx]?.id,
          confidence: "high",
          matchMethod: "exact",
          // Add match source to mark forced addition
          matchedIdentifier: { type: "journal", value: "forced-label-match" },
        });
      }
    }

    // Strategy 2: Numeric label -> index mapping (single entry fallback)
    // FTR-PDF-MATCHING: Only use index fallback if label is within INSPIRE's label range
    // This prevents wrong matches when PDF has more refs than INSPIRE
    const numLabel = parseInt(normalizedLabel, 10);

    // If PDF label exceeds INSPIRE's max label, do NOT use index fallback
    // This is a version mismatch case where PDF and INSPIRE have different reference lists
    // EXCEPTION: If maxInspireLabel is 0 (no labels in INSPIRE data), try scoring-based match first
    // Note: noLabelsInInspire and maxInspireLabel are calculated at function start
    const isVersionMismatch =
      !noLabelsInInspire && !isNaN(numLabel) && numLabel > maxInspireLabel;

    // FTR-NO-LABELS-FIX: When INSPIRE has no labels, use scoring-based matching with paperInfos
    // instead of blind index fallback (which assumes PDF order matches INSPIRE order)
    if (noLabelsInInspire && paperInfos?.length) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] No INSPIRE labels, trying scoring-based match for [${normalizedLabel}] with ${paperInfos.length} paperInfo(s)`,
      );

      let bestAny: {
        idx: number;
        score: number;
        yearOk: boolean;
        yearDelta: number | null;
        arxivOk: boolean;
        doiOk: boolean;
      } | null = null;
      let bestYearOk: {
        idx: number;
        score: number;
        yearOk: boolean;
        yearDelta: number | null;
        arxivOk: boolean;
        doiOk: boolean;
      } | null = null;
      let bestArxiv: { idx: number; score: number } | null = null;
      let bestDoi: { idx: number; score: number } | null = null;

      for (const pdfPaper of paperInfos) {
        const pdfArxivNorm = normalizeArxivId(pdfPaper.arxivId);
        const pdfDoiNorm = normalizeDoi(pdfPaper.doi);

        for (let i = 0; i < this.entries.length; i++) {
          const score = this.calculateMatchScore(pdfPaper, this.entries[i]);
          const entryYear = this.entries[i].year;
          const yearDelta =
            pdfPaper.year && entryYear
              ? Math.abs(parseInt(pdfPaper.year, 10) - parseInt(entryYear, 10))
              : null;
          const yearOk =
            yearDelta !== null && yearDelta <= YEAR_DELTA.MAX_ACCEPTABLE;
          const entryArxivNorm = normalizeArxivId(this.entries[i].arxivDetails);
          const arxivOk =
            !!pdfArxivNorm &&
            !!entryArxivNorm &&
            pdfArxivNorm === entryArxivNorm;
          const entryDoiNorm = normalizeDoi(this.entries[i].doi);
          const doiOk =
            !!pdfDoiNorm && !!entryDoiNorm && pdfDoiNorm === entryDoiNorm;

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

      // Selection priority: arXiv > DOI > year-matched > highest score
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
      } else if (
        bestYearOk &&
        (!bestAny || bestYearOk.score >= bestAny.score - 1)
      ) {
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
        // Accept if: arXiv/DOI match, or year matches with decent score, or high score without year
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
            confidence:
              chosenArxivOk || chosenDoiOk
                ? "high"
                : chosenYearOk
                  ? "medium"
                  : "low",
            matchMethod: chosenArxivOk || chosenDoiOk ? "exact" : "inferred",
          });
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] No-labels scoring match: [${pdfLabel}] -> idx ${chosenIdx} (score=${chosenScore}, yearOk=${chosenYearOk}, yearDelta=${chosenYearDelta ?? "n/a"}, arxivOk=${chosenArxivOk}, doiOk=${chosenDoiOk})`,
          );
        } else {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] No-labels scoring match rejected (score=${chosenScore}, yearOk=${chosenYearOk}), skipping index fallback`,
          );
        }
      }

      // If scoring-based match failed, do not return; allow index/fuzzy/global search and final sorting
    }

    // FTR-MISSING-FIX: Skip index fallback when INSPIRE has no labels
    // Index-based matching assumes PDF order = INSPIRE order, which is unreliable without labels
    if (isVersionMismatch) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Label [${normalizedLabel}] exceeds INSPIRE max label ${maxInspireLabel}, skipping index fallback to avoid wrong match`,
      );
      // Continue to Strategy 3 (fuzzy match) and Strategy 4 (global arXiv/DOI search)
    } else if (noLabelsInInspire) {
      // When INSPIRE has no labels, don't use index fallback - rely on content-based matching only
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] No INSPIRE labels, skipping index fallback for [${normalizedLabel}]`,
      );
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

      // do not return; allow final sorting
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
        // Do NOT return; will sort combined results below
      }
    }

    // Sort and return (single exit)
    if (results.length) {
      // Ensure aligned labelMatches are present even if earlier steps cleared results
      const labelMatchesForMerge = this.labelMap.get(normalizedLabel);
      if (labelMatchesForMerge && labelMatchesForMerge.length > 0) {
        for (const idx of labelMatchesForMerge) {
          const exists = results.some((r) => r.entryIndex === idx);
          if (!exists) {
            results.push({
              pdfLabel: normalizedLabel,
              entryIndex: idx,
              entryId: this.entries[idx]?.id,
              confidence: "high",
              matchMethod: "exact",
            });
          }
        }
      }

      const methodPriority: Record<string, number> = {
        exact: 5,
        label: 4,
        index: 3,
        "strict-fallback": 2,
        inferred: 1,
        fuzzy: 0,
      };
      const sorted = results
        .map((r) => {
          const entryLabel = this.entries[r.entryIndex]?.label ?? null;
          const matchesPdf =
            entryLabel && entryLabel.trim() === normalizedLabel;
          const idPri =
            r.matchedIdentifier?.type === "arxiv"
              ? 3
              : r.matchedIdentifier?.type === "doi"
                ? 2
                : r.matchedIdentifier
                  ? 1
                  : 0;
          // Compute publication match strength for scoring tie-breaker
          const pubPri = computePublicationPriority(
            paperInfos?.[0],
            this.entries[r.entryIndex],
          );
          return {
            ...r,
            __matchesPdf: !!matchesPdf,
            __methodPri: methodPriority[r.matchMethod] ?? 0,
            __confPri:
              r.confidence === "high" ? 2 : r.confidence === "medium" ? 1 : 0,
            __idPri: idPri,
            __pubPri: pubPri,
          };
        })
        .sort((a, b) => {
          if (a.__idPri !== b.__idPri) return b.__idPri - a.__idPri; // Prefer identifier matches (arXiv/DOI) over labels
          if (a.__pubPri !== b.__pubPri) return b.__pubPri - a.__pubPri; // Prefer volume/page matches
          if (a.__matchesPdf !== b.__matchesPdf) return a.__matchesPdf ? -1 : 1;
          if (a.__confPri !== b.__confPri) return b.__confPri - a.__confPri;
          if (a.__methodPri !== b.__methodPri)
            return b.__methodPri - a.__methodPri;
          return a.entryIndex - b.entryIndex;
        })
        .map(({ __matchesPdf, __methodPri, __confPri, ...r }) => r);

      // Prefer aligned results when available
      const alignedSorted = sorted.filter((r) => {
        const entryLabel = this.entries[r.entryIndex]?.label ?? null;
        return entryLabel && entryLabel.trim() === normalizedLabel;
      });
      // Deduplicate to avoid repeated label entries and keep highest-ranked instance
      const seen = new Set<number>();
      const dedupedSorted = sorted.filter((r) => {
        if (seen.has(r.entryIndex)) return false;
        seen.add(r.entryIndex);
        return true;
      });
      const hasStrongIdentifierLead =
        dedupedSorted[0]?.matchedIdentifier !== undefined;
      let finalList: MatchResult[];
      if (expectedCount > 0) {
        if (hasStrongIdentifierLead) {
          finalList = dedupedSorted.slice(0, expectedCount);
        } else if (dedupedSorted.length) {
          // Single expected: return best only to avoid duplicate “found 2 entries”
          if (expectedCount === 1) {
            finalList = dedupedSorted.slice(0, 1);
          } else {
            const count = Math.max(
              1,
              Math.min(expectedCount, dedupedSorted.length),
            );
            finalList = dedupedSorted.slice(0, count);
          }
        } else if (alignedSorted.length > 0) {
          finalList = alignedSorted.slice(0, expectedCount);
        } else {
          finalList = dedupedSorted.slice(0, expectedCount);
        }
      } else {
        finalList = dedupedSorted;
      }

      // If there is a high-confidence exact/label match, suppress fallback noise (e.g., inferred)
      const best = sorted[0];
      if (
        expectedCount === 0 &&
        best &&
        best.confidence === "high" &&
        (best.matchMethod === "exact" || best.matchMethod === "label")
      ) {
        finalList = [best];
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // FTR-MISSING-FIX: Final reconciliation - determine which PDF papers are truly unmatched
      // This runs AFTER all matching logic completes, using actual returned results.
      //
      // IMPORTANT: Uses ONE-TO-ONE matching - each INSPIRE entry can only match ONE PDF paper.
      // This prevents cases like: one Dobado entry incorrectly "covering" two different Dobado papers.
      //
      // Algorithm (greedy by score):
      // 1. Calculate all (paper, entry, score) pairs
      // 2. Sort by score descending
      // 3. Greedily assign: if both paper and entry are unassigned, match them
      // 4. Unassigned PDF papers are "missing in INSPIRE"
      // ═══════════════════════════════════════════════════════════════════════════
      if (paperInfos && paperInfos.length > 0 && finalList.length > 0) {
        const returnedEntries = finalList.map(
          (r) => this.entries[r.entryIndex],
        );

        // Build all pairwise scores
        const scorePairs: Array<{ pIdx: number; eIdx: number; score: number }> =
          [];
        for (let pIdx = 0; pIdx < paperInfos.length; pIdx++) {
          const pdfPaper = paperInfos[pIdx];
          for (let eIdx = 0; eIdx < returnedEntries.length; eIdx++) {
            const score = this.calculateMatchScore(
              pdfPaper,
              returnedEntries[eIdx],
            );
            if (score >= SCORE.VALIDATION_ACCEPT) {
              scorePairs.push({ pIdx, eIdx, score });
            }
          }
        }

        // Sort by score descending (best matches first)
        scorePairs.sort((a, b) => b.score - a.score);

        // Greedy one-to-one assignment
        const matchedPaperIndices = new Set<number>();
        const usedEntryIndices = new Set<number>();
        const assignments: Array<{
          pIdx: number;
          eIdx: number;
          score: number;
        }> = [];

        // FTR-MISSING-FIX: Higher threshold for reconciliation when PDF has journal info
        // A score of 5-6 (just author+year) is NOT enough to confirm a match
        // when the PDF paper has specific journal/volume that should be verified
        const RECONCILIATION_THRESHOLD_WITH_JOURNAL = 7;

        for (const { pIdx, eIdx, score } of scorePairs) {
          if (matchedPaperIndices.has(pIdx) || usedEntryIndices.has(eIdx)) {
            continue; // Already assigned
          }

          const pdfPaper = paperInfos[pIdx];
          const entry = returnedEntries[eIdx];

          // FTR-MISSING-FIX: For marginal scores, verify journal/volume if PDF has this info
          // This prevents false matches where author+year match but journal is different
          if (
            score < RECONCILIATION_THRESHOLD_WITH_JOURNAL &&
            pdfPaper.journalAbbrev &&
            pdfPaper.volume
          ) {
            // PDF has specific journal info - verify it matches the entry
            const entryPub = entry.publicationInfo;
            if (entryPub) {
              const entryVol = entryPub.journal_volume || entryPub.volume;
              // If entry has volume info and it doesn't match PDF volume, reject
              if (entryVol && String(entryVol) !== String(pdfPaper.volume)) {
                Zotero.debug(
                  `[${config.addonName}] [PDF-ANNOTATE] [MISSING-FINAL] Rejecting marginal match: ` +
                    `PDF[${pIdx}] "${pdfPaper.firstAuthorLastName}" vol=${pdfPaper.volume} != Entry[${eIdx}] vol=${entryVol} (score=${score})`,
                );
                continue; // Skip this pair - volume mismatch
              }
            } else {
              // Entry has no publication info but PDF does - be cautious with marginal scores
              if (score < SCORE.NO_YEAR_ACCEPT) {
                Zotero.debug(
                  `[${config.addonName}] [PDF-ANNOTATE] [MISSING-FINAL] Rejecting marginal match: ` +
                    `PDF[${pIdx}] has journal info but Entry[${eIdx}] has none (score=${score})`,
                );
                continue;
              }
            }
          }

          matchedPaperIndices.add(pIdx);
          usedEntryIndices.add(eIdx);
          assignments.push({ pIdx, eIdx, score });
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] [MISSING-FINAL] Matched: PDF[${pIdx}] "${paperInfos[pIdx].firstAuthorLastName || "?"}" <-> Entry[${eIdx}] (score=${score})`,
          );
        }

        // FTR-MISSING-FIX: Filter finalList to only include verified matches
        // Entries that don't match any PDF paper should not be returned
        //
        // Build entryIndex -> paperIdx mapping from assignments BEFORE filtering
        // eIdx is the index into returnedEntries (which was finalList.map(r => entries[r.entryIndex]))
        // So finalList[eIdx].entryIndex gives us the INSPIRE entry index
        const entryIndexToPaperIdx = new Map<number, number>();
        for (const { pIdx, eIdx } of assignments) {
          const entryIndex = finalList[eIdx]?.entryIndex;
          if (entryIndex !== undefined) {
            entryIndexToPaperIdx.set(entryIndex, pIdx);
          }
        }

        // Filter: only keep entries that were verified matched
        const verifiedEntryIndices = new Set(
          assignments
            .map((a) => finalList[a.eIdx]?.entryIndex)
            .filter((x) => x !== undefined),
        );
        const filteredFinalList = finalList.filter((r) =>
          verifiedEntryIndices.has(r.entryIndex),
        );
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] [MISSING-FINAL] Filtered: ${finalList.length} -> ${filteredFinalList.length} verified entries`,
        );

        // Re-sort by PDF paper order (first PDF paper in PDF = first in list)
        // This ensures scrolling focuses on the first paper, not the highest-confidence match
        const sortedFinalList = [...filteredFinalList].sort((a, b) => {
          const aPaperIdx = entryIndexToPaperIdx.get(a.entryIndex) ?? Infinity;
          const bPaperIdx = entryIndexToPaperIdx.get(b.entryIndex) ?? Infinity;
          return aPaperIdx - bPaperIdx;
        });

        finalList = sortedFinalList;
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] [MISSING-FINAL] Re-sorted finalList by PDF paper order: ` +
            `${finalList.map((r, i) => `[${i}]=${r.entryIndex}`).join(", ")}`,
        );

        const unmatchedPapers = paperInfos.filter(
          (_, idx) => !matchedPaperIndices.has(idx),
        );
        if (unmatchedPapers.length > 0) {
          this.pdfMissingByLabel.set(normalizedLabel, unmatchedPapers);
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] [MISSING-FINAL] Label [${normalizedLabel}]: ` +
              `${finalList.length} returned, ${unmatchedPapers.length} truly unmatched: ` +
              `${unmatchedPapers.map((p) => `${p.firstAuthorLastName || "?"} ${p.year || "?"} ${p.journalAbbrev || ""} ${p.volume || ""}`).join(", ")}`,
          );
        } else {
          // All PDF papers matched returned entries - clear any stale missing record
          this.pdfMissingByLabel.delete(normalizedLabel);
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] [MISSING-FINAL] Label [${normalizedLabel}]: ` +
              `all ${paperInfos.length} PDF paper(s) matched to ${finalList.length} returned entries (one-to-one)`,
          );
        }
      }

      return finalList;
    }

    return results; // Empty array = no match
  }

  /**
   * Match multiple labels, returning all successful matches.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Deduplicates by entryIndex.
   * FTR-MISSING-FIX: Preserves PDF paper order from match() as primary sort key.
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

    // FTR-MISSING-FIX: Preserve PDF paper order from match() as primary key
    // The match() function already sorts by PDF paper order (first PDF paper = first in list)
    // We only use confidence/method as secondary sort within the same order position
    // __order captures the order from match(), which is PDF paper order
    const methodPriority: Record<string, number> = {
      exact: 5,
      label: 4,
      index: 3,
      "strict-fallback": 2,
      inferred: 1,
      fuzzy: 0,
    };
    const sorted = results
      .map((r, idx) => ({
        ...r,
        __order: idx,
        __methodPri: methodPriority[r.matchMethod] ?? 0,
        __confPri:
          r.confidence === "high" ? 2 : r.confidence === "medium" ? 1 : 0,
      }))
      .sort((a, b) => {
        // Primary: preserve insertion order (which is PDF paper order from match())
        if (a.__order !== b.__order) return a.__order - b.__order;
        // Secondary: method priority
        if (a.__methodPri !== b.__methodPri)
          return b.__methodPri - a.__methodPri;
        // Tertiary: confidence
        return b.__confPri - a.__confPri;
      })
      .map(({ __order, __methodPri, __confPri, ...r }) => r);

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

    const recommendation = this.getRecommendation(
      alignedCount,
      labelAvailableCount,
    );

    this.alignmentReport = {
      totalEntries: this.entries.length,
      alignedCount,
      labelAvailableCount,
      issues,
      recommendation,
    };

    // FTR-PDF-ANNOTATE-MULTI-LABEL: Log detailed diagnosis for debugging
    const labelRate =
      this.entries.length > 0
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
    } else if (
      alignRate > MATCH_CONFIG.ALIGN_RATE_MEDIUM ||
      labelRate > MATCH_CONFIG.ALIGN_RATE_MEDIUM
    ) {
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

  /**
   * Find precise match using journal/volume/page information from PDF.
   * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Uses bibliographic data for exact matching.
   *
   * @param pdfPaper - Paper info extracted from PDF reference list
   * @param targetAuthors - Author names to match
   * @param targetYearBase - Year without suffix (e.g., "2011" not "2011a")
   * @returns MatchResult if found, null otherwise
   */
  private findPreciseMatch(
    pdfPaper: PDFPaperInfo,
    targetAuthors: string[],
    targetYearBase: string | null,
  ): MatchResult | null {
    let bestMatch: { idx: number; score: number; method: string } | null = null;

    for (let idx = 0; idx < this.entries.length; idx++) {
      const entry = this.entries[idx];
      let score = 0;
      let matchMethod = "journal";

      // ═══════════════════════════════════════════════════════════════════════════
      // Priority 1: arXiv ID match (strongest identifier)
      // ═══════════════════════════════════════════════════════════════════════════
      if (pdfPaper.arxivId) {
        const pdfArxiv = normalizeArxivId(pdfPaper.arxivId);
        const entryArxiv = normalizeArxivId(entry.arxivDetails);
        if (pdfArxiv && entryArxiv && pdfArxiv === entryArxiv) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] findPreciseMatch: arXiv match ${pdfArxiv} -> idx ${idx}`,
          );
          return {
            pdfLabel: `${targetAuthors[0] || "?"} ${targetYearBase || "?"}`,
            entryIndex: idx,
            entryId: entry.id,
            confidence: "high",
            matchMethod: "exact",
            score: SCORE.ARXIV_EXACT,
          };
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // Priority 2: DOI match (second strongest identifier)
      // ═══════════════════════════════════════════════════════════════════════════
      if (pdfPaper.doi) {
        const pdfDoi = normalizeDoi(pdfPaper.doi);
        const entryDoi = normalizeDoi(entry.doi);
        if (pdfDoi && entryDoi && pdfDoi === entryDoi) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] findPreciseMatch: DOI match ${pdfDoi} -> idx ${idx}`,
          );
          return {
            pdfLabel: `${targetAuthors[0] || "?"} ${targetYearBase || "?"}`,
            entryIndex: idx,
            entryId: entry.id,
            confidence: "high",
            matchMethod: "exact",
            score: SCORE.DOI_EXACT,
          };
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // Priority 3: Journal + Volume + Page match
      // This is the key for distinguishing 2011a vs 2011b by same author
      // ═══════════════════════════════════════════════════════════════════════════
      if (pdfPaper.journalAbbrev && pdfPaper.volume && entry.publicationInfo) {
        const pub = entry.publicationInfo;
        const journalMatches = journalsSimilar(
          pdfPaper.journalAbbrev,
          pub.journal_title,
        );
        const entryVol = pub.journal_volume || pub.volume;
        const volumeMatches =
          entryVol && String(entryVol) === String(pdfPaper.volume);

        if (journalMatches && volumeMatches) {
          score += 4; // Journal + volume match

          // Check page/article ID for extra confidence
          const entryPage = pub.page_start || pub.artid;
          if (
            pdfPaper.pageStart &&
            entryPage &&
            String(entryPage) === pdfPaper.pageStart
          ) {
            score += 3; // Page also matches - very high confidence
            matchMethod = "journal-vol-page";
          } else {
            matchMethod = "journal-vol";
          }

          // Verify author matches (sanity check)
          let authorVerified = false;
          if (targetAuthors.length > 0) {
            const targetAuthor = targetAuthors[0];
            if (entry.authors?.length) {
              const firstAuthor = extractLastName(
                entry.authors[0],
              ).toLowerCase();
              if (
                firstAuthor === targetAuthor ||
                firstAuthor.includes(targetAuthor) ||
                targetAuthor.includes(firstAuthor)
              ) {
                authorVerified = true;
                score += 2;
              }
            }
            if (!authorVerified && entry.authorText) {
              if (entry.authorText.toLowerCase().includes(targetAuthor)) {
                authorVerified = true;
                score += 1;
              }
            }
          }

          // Verify year matches (sanity check)
          if (targetYearBase && entry.year) {
            const entryYearBase = normalizeYear(entry.year);
            if (entryYearBase === targetYearBase) {
              score += 1;
            }
          }

          if (score > (bestMatch?.score || 0)) {
            bestMatch = { idx, score, method: matchMethod };
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // Priority 4: Volume + Page match (when journal name might differ)
      // Some papers cite abbreviated journal differently
      // Only try if no match found yet (bestMatch is null)
      // ═══════════════════════════════════════════════════════════════════════════
      if (
        bestMatch === null &&
        pdfPaper.volume &&
        pdfPaper.pageStart &&
        entry.publicationInfo
      ) {
        const pub = entry.publicationInfo;
        const entryVol = pub.journal_volume || pub.volume;
        const entryPage = pub.page_start || pub.artid;

        if (
          entryVol &&
          entryPage &&
          String(entryVol) === String(pdfPaper.volume) &&
          String(entryPage) === pdfPaper.pageStart
        ) {
          // Volume + page match without journal name verification
          let tempScore = 3;

          // Must verify at least author or year
          let verified = false;
          if (targetAuthors.length > 0 && entry.authors?.length) {
            const firstAuthor = extractLastName(entry.authors[0]).toLowerCase();
            if (
              firstAuthor === targetAuthors[0] ||
              firstAuthor.includes(targetAuthors[0])
            ) {
              verified = true;
              tempScore += 2;
            }
          }
          if (!verified && targetYearBase && entry.year) {
            const entryYearBase = normalizeYear(entry.year);
            if (entryYearBase === targetYearBase) {
              verified = true;
              tempScore += 1;
            }
          }

          if (verified) {
            bestMatch = { idx, score: tempScore, method: "vol-page" };
          }
        }
      }
    }

    // Return best match if score is high enough
    if (bestMatch && bestMatch.score >= 5) {
      const entry = this.entries[bestMatch.idx];
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] findPreciseMatch: ${bestMatch.method} match score=${bestMatch.score} -> idx ${bestMatch.idx}`,
      );
      return {
        pdfLabel: `${targetAuthors[0] || "?"} ${targetYearBase || "?"}`,
        entryIndex: bestMatch.idx,
        entryId: entry.id,
        confidence: bestMatch.score >= 7 ? "high" : "medium",
        matchMethod: "exact",
        score: bestMatch.score,
      };
    }

    // Log why no match was found (score too low or no entries with matching journal/volume)
    if (bestMatch) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] findPreciseMatch: best score ${bestMatch.score} < threshold 5, no match returned`,
      );
    } else {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] findPreciseMatch: no entry matched journal/volume criteria for ${pdfPaper.journalAbbrev} ${pdfPaper.volume}`,
      );
    }

    return null;
  }

  /**
   * Match author-year citation to INSPIRE entries.
   * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Matches citations like "Albaladejo et al. (2017)"
   *
   * @param authorLabels - Array of labels from parseAuthorYearCitation, including
   *   combined labels like "Albaladejo et al. 2017", individual author names, and year
   * @returns Matching results sorted by confidence score
   */
  matchAuthorYear(authorLabels: string[]): MatchResult[] {
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: ENTRY with labels=[${authorLabels.join("; ")}]`,
    );
    const results: MatchResult[] = [];
    const seenIndices = new Set<number>();

    // FTR-FIX: Preprocess labels to handle parenthesized years like "Guo et al. (2015)"
    // Convert "(YYYY)" to "YYYY" for proper matching
    const preprocessedLabels = authorLabels.map((label) =>
      label.replace(/\((\d{4}[a-z]?)\)/g, "$1"),
    );

    // FTR-REFACTOR: Use shared parseAuthorLabels function to extract author/year info
    const {
      authors: targetAuthors,
      authorInitials: targetAuthorInitials,
      year: targetYear,
      isEtAl,
    } = parseAuthorLabels(preprocessedLabels);

    if (targetAuthors.length === 0 && !targetYear) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: no valid author/year extracted from labels`,
      );
      return results;
    }

    // Log initials if present for debugging
    if (targetAuthorInitials.size > 0) {
      const initialsStr = Array.from(targetAuthorInitials.entries())
        .map(([author, initials]) => `${initials} ${author}`)
        .join(", ");
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: author initials for disambiguation: ${initialsStr}`,
      );
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: searching for authors=[${targetAuthors.join(",")}], year="${targetYear}", isEtAl=${isEtAl}`,
    );

    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Strip year suffix for matching (2011a -> 2011)
    const targetYearBase = normalizeYear(targetYear);

    // ═══════════════════════════════════════════════════════════════════════════
    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Try precise matching via PDF mapping first
    // This uses journal/volume/page info parsed from PDF reference list
    // ═══════════════════════════════════════════════════════════════════════════
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: hasAuthorYearMapping=${this.authorYearMapping !== undefined}, mapSize=${this.authorYearMapping?.authorYearMap.size ?? 0}`,
    );
    if (this.authorYearMapping && targetAuthors.length > 0 && targetYear) {
      // Build key and variants: handle ß -> ss and diacritics fallback
      const baseKey = `${targetAuthors[0]} ${targetYear}`.toLowerCase();
      const keyVariants = new Set<string>([baseKey]);
      keyVariants.add(baseKey.replace("ß", "ss"));
      // Also try without diacritics for fallback (e.g., "lü" -> "lu")
      const keyNoDiacritics = baseKey
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      keyVariants.add(keyNoDiacritics);

      // FTR-COMPOUND-SURNAME: For compound surnames like "Hiller Blin", PDF parser may only
      // extract first word "Hiller". Add first-word-only variant as fallback.
      // This handles: "Hiller Blin 2016" -> try "hiller 2016" if "hiller blin 2016" fails
      const firstWord = targetAuthors[0].split(/\s+/)[0];
      if (firstWord !== targetAuthors[0]) {
        const firstWordKey = `${firstWord} ${targetYear}`.toLowerCase();
        keyVariants.add(firstWordKey);
        keyVariants.add(
          firstWordKey.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        );
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: compound surname detected, adding first-word key "${firstWordKey}"`,
        );
      }

      let pdfPaperInfos: PDFPaperInfo[] | undefined;
      let usedKey: string | null = null;
      for (const k of keyVariants) {
        const infos = this.authorYearMapping.authorYearMap.get(k);
        if (infos && infos.length > 0) {
          pdfPaperInfos = infos;
          usedKey = k;
          break;
        }
      }
      const chosenKey = usedKey ?? baseKey;

      // FTR-COMPOUND-SURNAME-FIX: If PDF mapping exists but this key has no entries,
      // fall through to fuzzy matching instead of returning empty.
      // This handles cases where PDF parser extracted only part of compound surname
      // (e.g., "Hiller" instead of "Hiller Blin") and we need INSPIRE author matching.
      if (pdfPaperInfos && pdfPaperInfos.length > 0) {
        // ═══════════════════════════════════════════════════════════════════════════
        // FTR-AUTHOR-INITIAL-FIX: When targetAuthorInitials exists and we have multiple
        // PDF candidates, try ALL candidates and filter by INSPIRE authorText initials.
        // This handles cases where PDF rawText doesn't have enough info to distinguish
        // "M.-T. Li" from "G. Li", but INSPIRE entries do.
        // ═══════════════════════════════════════════════════════════════════════════
        if (targetAuthorInitials.size > 0 && pdfPaperInfos.length > 1) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: trying all ${pdfPaperInfos.length} PDF candidates with initials filtering on INSPIRE entries`,
          );

          // Debug: log each PDF candidate's details
          for (let i = 0; i < pdfPaperInfos.length; i++) {
            const p = pdfPaperInfos[i];
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: PDF candidate[${i}]: arxiv=${p.arxivId || "none"}, journal=${p.journalAbbrev || "none"}, vol=${p.volume || "none"}, page=${p.pageStart || "none"}`,
            );
          }

          // Collect all precise matches from all candidates
          const allPreciseMatches: Array<{
            match: MatchResult;
            entry: InspireReferenceEntry;
            pdfInfo: PDFPaperInfo;
          }> = [];
          for (const pdfInfo of pdfPaperInfos) {
            const preciseMatch = this.findPreciseMatch(
              pdfInfo,
              targetAuthors,
              targetYearBase,
            );
            if (preciseMatch) {
              const entry = this.entries[preciseMatch.entryIndex];
              allPreciseMatches.push({ match: preciseMatch, entry, pdfInfo });
            }
          }

          if (allPreciseMatches.length > 0) {
            // Filter by initials on INSPIRE authorText
            let bestMatch: {
              match: MatchResult;
              entry: InspireReferenceEntry;
              initialScore: number;
            } | null = null;

            for (const { match, entry } of allPreciseMatches) {
              let initialScore = 0;

              if (entry.authorText) {
                for (const [author, initials] of targetAuthorInitials) {
                  const pattern = buildInitialsPattern(author, initials);

                  if (pattern.test(entry.authorText)) {
                    initialScore += 20;
                    Zotero.debug(
                      `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: INSPIRE entry idx=${match.entryIndex} matches initials "${initials} ${author}" in authorText`,
                    );
                  } else if (entry.authorText.toLowerCase().includes(author)) {
                    // Check for different initials (penalty)
                    if (RE_DIFFERENT_INITIALS(author).test(entry.authorText)) {
                      initialScore -= 15;
                      Zotero.debug(
                        `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: INSPIRE entry idx=${match.entryIndex} has WRONG initials (wanted "${initials} ${author}")`,
                      );
                    }
                  }
                }
              }

              if (!bestMatch || initialScore > bestMatch.initialScore) {
                bestMatch = { match, entry, initialScore };
              }
            }

            if (bestMatch && bestMatch.initialScore >= 0) {
              results.push(bestMatch.match);
              Zotero.debug(
                `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: selected INSPIRE entry idx=${bestMatch.match.entryIndex} with initialScore=${bestMatch.initialScore}`,
              );
              return results;
            }
          }
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // FTR-AMBIGUOUS-AUTHOR-YEAR: When multiple PDF paper infos exist for same author+year,
        // check if selectBestPdfPaperInfo can disambiguate. If candidates have tied scores,
        // we cannot reliably determine which paper the user meant.
        //
        // Example: "Guo et al. (2016)" with two papers:
        // - Phys. Rev. D 93 (8 authors, cited as "Guo, Hanhart et al.")
        // - Eur. Phys. J. A 52 (4 authors, cited as "Guo, Meißner et al.")
        //
        // Resolution: Return first candidate but mark as ambiguous with all candidates,
        // allowing UI to show a picker for user to choose the correct paper.
        // ═══════════════════════════════════════════════════════════════════════════

        // Calculate scores for all candidates to detect ties
        const candidatesWithScores = scorePdfPaperInfos(
          pdfPaperInfos,
          targetAuthors,
          isEtAl,
          targetAuthorInitials,
        );
        const topScore = candidatesWithScores[0]?.score ?? -Infinity;
        const tiedCandidates = candidatesWithScores.filter(
          (c) => c.score === topScore,
        );

        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: found ${pdfPaperInfos.length} PDF paper info(s) for "${chosenKey}", top score=${topScore}, tied=${tiedCandidates.length}`,
        );

        if (tiedCandidates.length > 1) {
          // Multiple candidates with same score - collect all precise matches for user selection
          const tiedJournals = tiedCandidates
            .map((c) => `${c.pdfInfo.journalAbbrev} ${c.pdfInfo.volume}`)
            .join(", ");
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: ⚠️ AMBIGUOUS - ${tiedCandidates.length} candidates tied with score=${topScore}: [${tiedJournals}]. Returning with ambiguous candidates for user selection.`,
          );

          // Collect all precise matches for ambiguous candidates
          const ambiguousCandidates: AmbiguousCandidate[] = [];
          let firstMatch: MatchResult | null = null;

          for (const { pdfInfo } of tiedCandidates) {
            const preciseMatch = this.findPreciseMatch(
              pdfInfo,
              targetAuthors,
              targetYearBase,
            );
            if (preciseMatch) {
              const entry = this.entries[preciseMatch.entryIndex];
              const authorCount = entry.authors?.length || 0;
              const secondAuthor =
                authorCount >= 2
                  ? extractLastName(entry.authors![1])
                  : undefined;

              // Build display text: "Journal Vol, Page (N authors)"
              const pub = entry.publicationInfo;
              let displayText = "";
              if (pub?.journal_title) {
                displayText = pub.journal_title;
                if (pub.journal_volume) displayText += ` ${pub.journal_volume}`;
                if (pub.page_start) displayText += `, ${pub.page_start}`;
              } else if (pdfInfo.journalAbbrev) {
                displayText = pdfInfo.journalAbbrev;
                if (pdfInfo.volume) displayText += ` ${pdfInfo.volume}`;
                if (pdfInfo.pageStart) displayText += `, ${pdfInfo.pageStart}`;
              }
              if (authorCount > 0) {
                displayText += ` (${authorCount} author${authorCount > 1 ? "s" : ""})`;
              }
              if (secondAuthor) {
                displayText += ` - ${secondAuthor}`;
              }

              // Get title (truncate if too long)
              const title = entry.title || undefined;

              ambiguousCandidates.push({
                entryIndex: preciseMatch.entryIndex,
                entryId: preciseMatch.entryId,
                displayText,
                title,
                journal: pdfInfo.journalAbbrev,
                volume: pdfInfo.volume,
                page: pdfInfo.pageStart,
                authorCount,
                secondAuthor,
              });

              if (!firstMatch) {
                firstMatch = preciseMatch;
              }
            }
          }

          // Return first match with ambiguous candidates attached
          if (firstMatch && ambiguousCandidates.length > 1) {
            firstMatch.isAmbiguous = true;
            firstMatch.ambiguousCandidates = ambiguousCandidates;
            firstMatch.confidence = "medium"; // Downgrade confidence for ambiguous match
            results.push(firstMatch);
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: returning ambiguous match with ${ambiguousCandidates.length} candidates for user selection`,
            );
            return results;
          } else if (firstMatch) {
            // Only one precise match succeeded - return it as non-ambiguous
            results.push(firstMatch);
            return results;
          }
        }

        // Single best candidate or no tied candidates - use the normal flow
        const pdfPaperInfo = tiedCandidates[0]?.pdfInfo ?? pdfPaperInfos[0];

        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: selected: journal=${pdfPaperInfo.journalAbbrev}, vol=${pdfPaperInfo.volume}, page=${pdfPaperInfo.pageStart}`,
        );

        // Use precise matching with journal/volume/page
        const preciseMatch = this.findPreciseMatch(
          pdfPaperInfo,
          targetAuthors,
          targetYearBase,
        );
        if (preciseMatch) {
          results.push(preciseMatch);
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: precise match found via PDF mapping: idx=${preciseMatch.entryIndex}, confidence=${preciseMatch.confidence}`,
          );
          return results;
        } else {
          // Log why precise matching failed - this helps debug Braaten 2005a/2005b issues
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: findPreciseMatch returned null for "${chosenKey}" (journal=${pdfPaperInfo.journalAbbrev}, vol=${pdfPaperInfo.volume}, page=${pdfPaperInfo.pageStart}). Possible causes: no entry with matching journal/volume/page, or score too low.`,
          );
        }
      } else {
        // Try without suffix (e.g., "cho 2011" when looking for "cho 2011a")
        const lookupKeyBase =
          `${targetAuthors[0]} ${targetYearBase}`.toLowerCase();
        if (lookupKeyBase !== chosenKey) {
          const pdfPaperInfosBase =
            this.authorYearMapping.authorYearMap.get(lookupKeyBase);
          if (pdfPaperInfosBase && pdfPaperInfosBase.length > 0) {
            const pdfPaperInfoBase = selectBestPdfPaperInfo(
              pdfPaperInfosBase,
              targetAuthors,
              isEtAl,
              targetAuthorInitials,
            );
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: found PDF paper info for base "${lookupKeyBase}"`,
            );
            const preciseMatch = this.findPreciseMatch(
              pdfPaperInfoBase,
              targetAuthors,
              targetYearBase,
            );
            if (preciseMatch) {
              results.push(preciseMatch);
              return results;
            }
          }
        }
      }

      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: no PDF paper info for "${chosenKey}", falling back to fuzzy matching`,
      );
    }

    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Log candidate entries for debugging
    // This helps diagnose why matches fail (e.g., missing author data in INSPIRE)
    const candidatesWithYear = this.entries.filter((e) => {
      if (!e.year || !targetYearBase) return false;
      const entryYearBase = normalizeYear(e.year);
      return entryYearBase === targetYearBase;
    });
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: ${candidatesWithYear.length} entries with year=${targetYearBase} (from ${targetYear}) out of ${this.entries.length} total`,
    );
    for (const cand of candidatesWithYear.slice(0, 5)) {
      const candAuthors =
        cand.authors
          ?.slice(0, 2)
          .map((a) => extractLastName(a))
          .join(", ") || "(no authors)";
      const candPubInfo = cand.publicationInfo
        ? `vol=${cand.publicationInfo.journal_volume || "?"}, page=${cand.publicationInfo.page_start || "?"}`
        : "(no pubInfo)";
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: candidate year=${cand.year}: ${candAuthors}... (id=${cand.id}, label=${cand.label}, ${candPubInfo})`,
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Special handling for year suffix disambiguation
    // When targetYear has a suffix (e.g., "2005b"), and we have authorYearMapping,
    // use journal/volume/page from the mapping to distinguish between entries
    // ═══════════════════════════════════════════════════════════════════════════
    const hasYearSuffix = targetYear && RE_YEAR_WITH_SUFFIX.test(targetYear);
    let pdfPaperInfoForFuzzy: {
      journalAbbrev?: string;
      volume?: string;
      pageStart?: string;
    } | null = null;

    if (hasYearSuffix && this.authorYearMapping && targetAuthors.length > 0) {
      // Try to get PDF paper info for disambiguation during fuzzy matching
      const baseKeyFuzzy = `${targetAuthors[0]} ${targetYear}`.toLowerCase();
      const fuzzyKeyVariants = new Set<string>([
        baseKeyFuzzy,
        baseKeyFuzzy.replace("ß", "ss"),
      ]);
      for (const k of fuzzyKeyVariants) {
        const pdfPaperInfosForFuzzy =
          this.authorYearMapping.authorYearMap.get(k);
        if (pdfPaperInfosForFuzzy && pdfPaperInfosForFuzzy.length > 0) {
          pdfPaperInfoForFuzzy = selectBestPdfPaperInfo(
            pdfPaperInfosForFuzzy,
            targetAuthors,
            isEtAl,
            targetAuthorInitials,
          );
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: using PDF paper info for fuzzy disambiguation (key=${k}): vol=${pdfPaperInfoForFuzzy.volume}, page=${pdfPaperInfoForFuzzy.pageStart}`,
          );
          break;
        }
      }
    }

    // Score each entry
    const scoredMatches: Array<{
      idx: number;
      score: number;
      entry: InspireReferenceEntry;
      yearMatched: boolean;
    }> = [];

    for (let idx = 0; idx < this.entries.length; idx++) {
      const entry = this.entries[idx];
      let score = 0;
      let yearMatched = false;

      // Check year match (required for high confidence)
      if (targetYearBase && entry.year) {
        const entryYear = normalizeYear(entry.year);
        if (entryYear === targetYearBase) {
          score += 3;
          yearMatched = true;
        } else if (
          entryYear &&
          Math.abs(parseInt(entryYear, 10) - parseInt(targetYearBase, 10)) === 1
        ) {
          score += 1; // Off by one year (possible preprint vs published)
        }
      }

      // Check author matches - score based on how many target authors match
      if (
        targetAuthors.length > 0 &&
        entry.authors &&
        entry.authors.length > 0
      ) {
        let authorMatchCount = 0;
        const entryAuthorsLower = entry.authors.map((a) =>
          extractLastName(a).toLowerCase(),
        );

        for (const targetAuthor of targetAuthors) {
          // Check for exact match with any entry author
          if (entryAuthorsLower.some((ea) => ea === targetAuthor)) {
            authorMatchCount++;
            continue;
          }
          // Check for partial match
          if (
            entryAuthorsLower.some(
              (ea) => ea.includes(targetAuthor) || targetAuthor.includes(ea),
            )
          ) {
            authorMatchCount += 0.5;
          }
        }

        if (authorMatchCount > 0) {
          // Scale score: more matching authors = higher score
          // First author match is most important
          const firstAuthorMatched =
            entryAuthorsLower[0] === targetAuthors[0] ||
            entryAuthorsLower[0]?.includes(targetAuthors[0]) ||
            targetAuthors[0]?.includes(entryAuthorsLower[0]);

          if (firstAuthorMatched) {
            score += 5; // First author match is critical
          }
          // Additional authors add more confidence
          score += Math.min(authorMatchCount * 1.5, 4); // Cap at +4 for additional authors
        }
      }

      // Check authorText for broader matching (fallback if authors array is sparse or empty)
      // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Increase authorText score to allow matching when authors array is missing
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
        // Only add authorText score if we didn't already match via authors array
        if (textMatchCount > 0 && score < 5) {
          // If first author matches in authorText, give higher score
          if (firstAuthorInText) {
            score += 4; // High confidence for first author in authorText
          }
          score += Math.min(textMatchCount * 1.5, 3);
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // AUTHOR COUNT SCORING: Use citation style rules to score candidates
      // Academic citation conventions:
      // - "Author (2020)" → exactly 1 author
      // - "Author and Author (2020)" → exactly 2 authors
      // - "Author et al. (2020)" → 3+ authors
      // ═══════════════════════════════════════════════════════════════════════════
      if (entry.authors && entry.authors.length > 0) {
        const entryAuthorCount = entry.authors.length;
        if (!isEtAl && targetAuthors.length <= 2) {
          // Citation has 1-2 authors without "et al." → paper should have exactly that many
          if (entryAuthorCount === targetAuthors.length) {
            score += 3; // Bonus for exact author count match
          } else {
            score -= 5; // Strong penalty for wrong author count
          }
        } else if (isEtAl) {
          // Citation uses "et al." → paper should have 3+ authors
          if (entryAuthorCount > 2) {
            score += 1; // Bonus for multi-author entry
          } else {
            score -= 3; // Penalty for too few authors when "et al." is used
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // FTR-AUTHOR-INITIAL: Use author initials for disambiguation
      // This is critical for distinguishing "M.-T. Li" from "G. Li" when both have same year
      // Check if the entry's authorText contains the specific initial+lastName pattern
      // ═══════════════════════════════════════════════════════════════════════════
      if (targetAuthorInitials.size > 0 && entry.authorText) {
        const authorTextLower = entry.authorText.toLowerCase();
        let initialMatchScore = 0;
        let initialMismatchPenalty = 0;

        for (const [author, initials] of targetAuthorInitials) {
          const pattern = buildInitialsPattern(author, initials);

          if (pattern.test(entry.authorText)) {
            // This entry has the matching initials - strong positive signal
            initialMatchScore += 15; // Very high weight for initial match
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: INITIAL MATCH for idx=${idx}: "${initials} ${author}" found in authorText`,
            );
          } else if (authorTextLower.includes(author)) {
            // Entry has the last name but WRONG initials - strong negative signal
            if (RE_DIFFERENT_INITIALS(author).test(entry.authorText)) {
              initialMismatchPenalty += 12; // Strong penalty for wrong initials
              Zotero.debug(
                `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: INITIAL MISMATCH for idx=${idx}: wanted "${initials} ${author}" but found different initials`,
              );
            }
          }
        }

        score += initialMatchScore;
        score -= initialMismatchPenalty;
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Use journal/volume/page for year suffix disambiguation
      // This is critical for distinguishing Braaten 2005a from 2005b when both have same author/year
      // ═══════════════════════════════════════════════════════════════════════════
      if (pdfPaperInfoForFuzzy && yearMatched && entry.publicationInfo) {
        const pub = entry.publicationInfo;
        let pubMatchScore = 0;

        // Volume match: critical for disambiguation
        if (pdfPaperInfoForFuzzy.volume && pub.journal_volume) {
          if (pub.journal_volume === pdfPaperInfoForFuzzy.volume) {
            pubMatchScore += 10; // Very high weight - volume is key for disambiguation
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: volume match for idx=${idx}: entry vol=${pub.journal_volume} == PDF vol=${pdfPaperInfoForFuzzy.volume}`,
            );
          } else {
            // Volume mismatch with same author/year strongly indicates wrong entry
            pubMatchScore -= 8; // Penalize mismatched volumes
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: volume MISMATCH for idx=${idx}: entry vol=${pub.journal_volume} != PDF vol=${pdfPaperInfoForFuzzy.volume}`,
            );
          }
        }

        // Page match: additional confirmation
        if (pdfPaperInfoForFuzzy.pageStart && pub.page_start) {
          if (pub.page_start === pdfPaperInfoForFuzzy.pageStart) {
            pubMatchScore += 5; // Page match adds confidence
          }
        }

        score += pubMatchScore;
      }

      // Only consider entries with reasonable scores
      // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Require year match for high-confidence results
      if (score >= 4) {
        scoredMatches.push({ idx, score, entry, yearMatched });
      }
    }

    // Sort by score (highest first)
    scoredMatches.sort((a, b) => b.score - a.score);

    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Filter results more strictly
    // If we have year-matched results, only return those (filter out year-mismatched)
    const yearMatchedResults = scoredMatches.filter((m) => m.yearMatched);
    const resultsToUse =
      yearMatchedResults.length > 0 ? yearMatchedResults : scoredMatches;

    // Build results from top matches
    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Only return multiple if scores are close AND no year suffix
    const topScore = resultsToUse[0]?.score || 0;
    for (const match of resultsToUse) {
      if (seenIndices.has(match.idx)) continue;

      // If year has suffix and we have pdfPaperInfo, trust the score differential
      // Otherwise, only return the best match (can't distinguish without PDF mapping)
      if (hasYearSuffix && results.length >= 1 && !pdfPaperInfoForFuzzy) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: year has suffix "${targetYear}" but no PDF info, returning only top match`,
        );
        break;
      }

      // Only include matches within 2 points of top score
      if (match.score < topScore - 2) break;
      seenIndices.add(match.idx);

      const confidence: MatchConfidence =
        match.score >= 7 ? "high" : match.score >= 5 ? "medium" : "low";

      results.push({
        pdfLabel: `${targetAuthors[0] || "?"} ${targetYear || "?"}`,
        entryIndex: match.idx,
        entryId: match.entry.id,
        confidence,
        matchMethod: "fuzzy",
        score: match.score,
      });

      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: found match idx=${match.idx}, score=${match.score}, yearMatched=${match.yearMatched}, ` +
          `entry="${match.entry.authors?.[0] || "?"} (${match.entry.year || "?"})"`,
      );

      // Only return top matches (limit to avoid noise)
      if (results.length >= 3) break;
    }

    return results;
  }
}
