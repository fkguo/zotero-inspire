// ─────────────────────────────────────────────────────────────────────────────
// Identifier Index - Pre-computed lookup indexes for fast matching
// FTR-REFACTOR: Extracted from labelMatcher.ts for modularity
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../../package.json";
import type { InspireReferenceEntry } from "../../types";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizeJournal,
} from "../matchScoring";

/**
 * Identifier indexes for O(1) lookup of entries by arXiv, DOI, or journal info.
 */
export interface IdentifierIndexes {
  /** Maps normalized arXiv ID -> entry index */
  arxivIndex: Map<string, number>;
  /** Maps normalized DOI -> entry index */
  doiIndex: Map<string, number>;
  /** Maps "journal:volume" -> entry indices */
  journalVolIndex: Map<string, number[]>;
  /** Maps "journal:volume:page" -> entry index */
  journalVolPageIndex: Map<string, number>;
}

/**
 * Build pre-computed identifier indexes for O(1) lookup.
 * This dramatically speeds up matching when entries have arXiv IDs, DOIs, or journal info.
 *
 * @param entries - INSPIRE reference entries to index
 * @returns IdentifierIndexes object with all lookup maps
 */
export function buildIdentifierIndexes(
  entries: InspireReferenceEntry[],
): IdentifierIndexes {
  const arxivIndex = new Map<string, number>();
  const doiIndex = new Map<string, number>();
  const journalVolIndex = new Map<string, number[]>();
  const journalVolPageIndex = new Map<string, number>();

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];

    // Index by arXiv ID
    const arxiv = normalizeArxivId(entry.arxivDetails);
    if (arxiv && !arxivIndex.has(arxiv)) {
      arxivIndex.set(arxiv, idx);
    }

    // Index by DOI
    const doi = normalizeDoi(entry.doi);
    if (doi && !doiIndex.has(doi)) {
      doiIndex.set(doi, idx);
    }

    // Index by journal+volume and journal+volume+page
    if (entry.publicationInfo) {
      const pub = entry.publicationInfo;
      const journal = normalizeJournal(pub.journal_title);
      const volume = pub.journal_volume || pub.volume;
      const page = pub.page_start || pub.artid;

      if (journal && volume) {
        const jvKey = `${journal}:${volume}`;
        const existing = journalVolIndex.get(jvKey) || [];
        existing.push(idx);
        journalVolIndex.set(jvKey, existing);

        if (page) {
          const jvpKey = `${journal}:${volume}:${page}`;
          if (!journalVolPageIndex.has(jvpKey)) {
            journalVolPageIndex.set(jvpKey, idx);
          }
        }
      }
    }
  }

  Zotero.debug(
    `[${config.addonName}] [PDF-ANNOTATE] Built identifier indexes - ` +
      `arxiv=${arxivIndex.size}, doi=${doiIndex.size}, ` +
      `journalVol=${journalVolIndex.size}, journalVolPage=${journalVolPageIndex.size}`,
  );

  return { arxivIndex, doiIndex, journalVolIndex, journalVolPageIndex };
}

/**
 * Find entry by arXiv ID using pre-computed index.
 * @returns Entry index or -1 if not found
 */
export function findByArxiv(
  indexes: IdentifierIndexes,
  arxivId: string | undefined | null,
): number {
  if (!arxivId) return -1;
  const normalized = normalizeArxivId(arxivId);
  if (!normalized) return -1;
  return indexes.arxivIndex.get(normalized) ?? -1;
}

/**
 * Find entry by DOI using pre-computed index.
 * @returns Entry index or -1 if not found
 */
export function findByDoi(
  indexes: IdentifierIndexes,
  doi: string | undefined | null,
): number {
  if (!doi) return -1;
  const normalized = normalizeDoi(doi);
  if (!normalized) return -1;
  return indexes.doiIndex.get(normalized) ?? -1;
}

/**
 * Find entries by journal+volume using pre-computed index.
 * @returns Array of entry indices (may be empty)
 */
export function findByJournalVol(
  indexes: IdentifierIndexes,
  journal: string | undefined | null,
  volume: string | undefined | null,
): number[] {
  if (!journal || !volume) return [];
  const normalizedJournal = normalizeJournal(journal);
  if (!normalizedJournal) return [];
  const key = `${normalizedJournal}:${volume}`;
  return indexes.journalVolIndex.get(key) || [];
}

/**
 * Find entry by journal+volume+page using pre-computed index.
 * @returns Entry index or -1 if not found
 */
export function findByJournalVolPage(
  indexes: IdentifierIndexes,
  journal: string | undefined | null,
  volume: string | undefined | null,
  page: string | undefined | null,
): number {
  if (!journal || !volume || !page) return -1;
  const normalizedJournal = normalizeJournal(journal);
  if (!normalizedJournal) return -1;
  const key = `${normalizedJournal}:${volume}:${page}`;
  return indexes.journalVolPageIndex.get(key) ?? -1;
}
