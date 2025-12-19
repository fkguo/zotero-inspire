// ─────────────────────────────────────────────────────────────────────────────
// Author-Year Matcher - Functions for author-year citation matching
// FTR-REFACTOR: Extracted from labelMatcher.ts for modularity (M-001)
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../../package.json";
import type { InspireReferenceEntry } from "../../types";
import type { MatchResult, AmbiguousCandidate } from "../types";
import type {
  PDFPaperInfo,
  AuthorYearReferenceMapping,
} from "../pdfReferencesParser";
import { SCORE, AUTHOR_SCORE, type MatchConfidence } from "../constants";
import { normalizeYear } from "../../textUtils";
import {
  RE_YEAR_WITH_SUFFIX,
  buildDifferentInitialsPattern,
  buildInitialsPattern,
  extractLastName,
  parseAuthorLabels,
} from "../authorUtils";
import {
  normalizeArxivId,
  normalizeDoi,
  journalsSimilar,
  scorePdfPaperInfos,
  selectBestPdfPaperInfo,
} from "../matchScoring";

/**
 * Find precise match using journal/volume/page information from PDF.
 * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Uses bibliographic data for exact matching.
 *
 * @param entries - INSPIRE reference entries to search
 * @param pdfPaper - Paper info extracted from PDF reference list
 * @param targetAuthors - Author names to match
 * @param targetYearBase - Year without suffix (e.g., "2011" not "2011a")
 * @returns MatchResult if found, null otherwise
 */
export function findPreciseMatch(
  entries: InspireReferenceEntry[],
  pdfPaper: PDFPaperInfo,
  targetAuthors: string[],
  targetYearBase: string | null,
): MatchResult | null {
  let bestMatch: { idx: number; score: number; method: string } | null = null;

  // PERF-FIX-4: Normalize PDF identifiers once outside the loop
  const pdfArxiv = pdfPaper.arxivId ? normalizeArxivId(pdfPaper.arxivId) : null;
  const pdfDoi = pdfPaper.doi ? normalizeDoi(pdfPaper.doi) : null;

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    let score = 0;
    let matchMethod = "journal";

    // ═══════════════════════════════════════════════════════════════════════════
    // Priority 1: arXiv ID match (strongest identifier)
    // ═══════════════════════════════════════════════════════════════════════════
    if (pdfArxiv) {
      const entryArxiv = normalizeArxivId(entry.arxivDetails);
      if (entryArxiv && pdfArxiv === entryArxiv) {
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
    if (pdfDoi) {
      const entryDoi = normalizeDoi(entry.doi);
      if (entryDoi && pdfDoi === entryDoi) {
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
            const firstAuthor = extractLastName(entry.authors[0]).toLowerCase();
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
    const entry = entries[bestMatch.idx];
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
 * Context object for author-year matching operations.
 * Contains all the state needed to perform matching without class dependency.
 */
export interface AuthorYearMatchContext {
  entries: InspireReferenceEntry[];
  authorYearMapping?: AuthorYearReferenceMapping;
}

/**
 * Match author-year citation to INSPIRE entries.
 * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Matches citations like "Albaladejo et al. (2017)"
 *
 * @param ctx - Context containing entries and optional author-year mapping
 * @param authorLabels - Array of labels from parseAuthorYearCitation, including
 *   combined labels like "Albaladejo et al. 2017", individual author names, and year
 * @returns Matching results sorted by confidence score
 */
export function matchAuthorYear(
  ctx: AuthorYearMatchContext,
  authorLabels: string[],
): MatchResult[] {
  const { entries, authorYearMapping } = ctx;

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
    `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: hasAuthorYearMapping=${authorYearMapping !== undefined}, mapSize=${authorYearMapping?.authorYearMap.size ?? 0}`,
  );
  if (authorYearMapping && targetAuthors.length > 0 && targetYear) {
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
      const infos = authorYearMapping.authorYearMap.get(k);
      if (infos && infos.length > 0) {
        pdfPaperInfos = infos;
        usedKey = k;
        break;
      }
    }
    const chosenKey = usedKey ?? baseKey;

    // FTR-COMPOUND-SURNAME-FIX: If PDF mapping exists but this key has no entries,
    // fall through to fuzzy matching instead of returning empty.
    if (pdfPaperInfos && pdfPaperInfos.length > 0) {
      // ═══════════════════════════════════════════════════════════════════════════
      // FTR-AUTHOR-INITIAL-FIX: When targetAuthorInitials exists and we have multiple
      // PDF candidates, try ALL candidates and filter by INSPIRE authorText initials.
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
          const preciseMatch = findPreciseMatch(
            entries,
            pdfInfo,
            targetAuthors,
            targetYearBase,
          );
          if (preciseMatch) {
            const entry = entries[preciseMatch.entryIndex];
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
                  if (
                    buildDifferentInitialsPattern(author).test(entry.authorText)
                  ) {
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
      // check if selectBestPdfPaperInfo can disambiguate.
      // ═══════════════════════════════════════════════════════════════════════════
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
          const preciseMatch = findPreciseMatch(
            entries,
            pdfInfo,
            targetAuthors,
            targetYearBase,
          );
          if (preciseMatch) {
            const entry = entries[preciseMatch.entryIndex];
            const authorCount = entry.authors?.length || 0;
            const secondAuthor =
              authorCount >= 2 ? extractLastName(entry.authors![1]) : undefined;

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
      const preciseMatch = findPreciseMatch(
        entries,
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
        // Log why precise matching failed
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
          authorYearMapping.authorYearMap.get(lookupKeyBase);
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
          const preciseMatch = findPreciseMatch(
            entries,
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
  const candidatesWithYear = entries.filter((e) => {
    if (!e.year || !targetYearBase) return false;
    const entryYearBase = normalizeYear(e.year);
    return entryYearBase === targetYearBase;
  });
  Zotero.debug(
    `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: ${candidatesWithYear.length} entries with year=${targetYearBase} (from ${targetYear}) out of ${entries.length} total`,
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
  // ═══════════════════════════════════════════════════════════════════════════
  const hasYearSuffix = targetYear && RE_YEAR_WITH_SUFFIX.test(targetYear);
  let pdfPaperInfoForFuzzy: {
    journalAbbrev?: string;
    volume?: string;
    pageStart?: string;
  } | null = null;

  if (hasYearSuffix && authorYearMapping && targetAuthors.length > 0) {
    // Try to get PDF paper info for disambiguation during fuzzy matching
    const baseKeyFuzzy = `${targetAuthors[0]} ${targetYear}`.toLowerCase();
    const fuzzyKeyVariants = new Set<string>([
      baseKeyFuzzy,
      baseKeyFuzzy.replace("ß", "ss"),
    ]);
    for (const k of fuzzyKeyVariants) {
      const pdfPaperInfosForFuzzy = authorYearMapping.authorYearMap.get(k);
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

  // Score each entry using fuzzy matching
  const scoredMatches = scoreFuzzyMatches(
    entries,
    targetAuthors,
    targetYearBase,
    targetAuthorInitials,
    isEtAl,
    pdfPaperInfoForFuzzy,
  );

  // Sort by score (highest first)
  scoredMatches.sort((a, b) => b.score - a.score);

  // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Filter results more strictly
  // If we have year-matched results, only return those
  const yearMatchedResults = scoredMatches.filter((m) => m.yearMatched);
  const resultsToUse =
    yearMatchedResults.length > 0 ? yearMatchedResults : scoredMatches;

  // Build results from top matches
  const topScore = resultsToUse[0]?.score || 0;
  for (const match of resultsToUse) {
    if (seenIndices.has(match.idx)) continue;

    // If year has suffix and we have pdfPaperInfo, trust the score differential
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

/**
 * Score entries using fuzzy matching for author-year citations.
 * Internal helper function for matchAuthorYear.
 */
function scoreFuzzyMatches(
  entries: InspireReferenceEntry[],
  targetAuthors: string[],
  targetYearBase: string | null,
  targetAuthorInitials: Map<string, string>,
  isEtAl: boolean,
  pdfPaperInfoForFuzzy: {
    journalAbbrev?: string;
    volume?: string;
    pageStart?: string;
  } | null,
): Array<{
  idx: number;
  score: number;
  entry: InspireReferenceEntry;
  yearMatched: boolean;
}> {
  const scoredMatches: Array<{
    idx: number;
    score: number;
    entry: InspireReferenceEntry;
    yearMatched: boolean;
  }> = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
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
    if (targetAuthors.length > 0 && entry.authors && entry.authors.length > 0) {
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
        const firstAuthorMatched =
          entryAuthorsLower[0] === targetAuthors[0] ||
          entryAuthorsLower[0]?.includes(targetAuthors[0]) ||
          targetAuthors[0]?.includes(entryAuthorsLower[0]);

        if (firstAuthorMatched) {
          score += AUTHOR_SCORE.FIRST_AUTHOR_MATCH;
        }
        score += Math.min(
          authorMatchCount * AUTHOR_SCORE.ADDITIONAL_MULTIPLIER,
          AUTHOR_SCORE.MAX_ADDITIONAL,
        );
      }
    }

    // Check authorText for broader matching
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
      if (textMatchCount > 0 && score < AUTHOR_SCORE.TEXT_FALLBACK_THRESHOLD) {
        if (firstAuthorInText) {
          score += AUTHOR_SCORE.FIRST_AUTHOR_IN_TEXT;
        }
        score += Math.min(
          textMatchCount * AUTHOR_SCORE.ADDITIONAL_MULTIPLIER,
          AUTHOR_SCORE.MAX_TEXT_MATCH,
        );
      }
    }

    // Author count scoring
    if (entry.authors && entry.authors.length > 0) {
      const entryAuthorCount = entry.authors.length;
      if (!isEtAl && targetAuthors.length <= 2) {
        if (entryAuthorCount === targetAuthors.length) {
          score += AUTHOR_SCORE.COUNT_MATCH_BONUS;
        } else {
          score += AUTHOR_SCORE.COUNT_MISMATCH_PENALTY;
        }
      } else if (isEtAl) {
        if (entryAuthorCount > 2) {
          score += AUTHOR_SCORE.ET_AL_MATCH_BONUS;
        } else {
          score += AUTHOR_SCORE.ET_AL_MISMATCH_PENALTY;
        }
      }
    }

    // Author initials scoring
    if (targetAuthorInitials.size > 0 && entry.authorText) {
      let initialMatchScore = 0;
      let initialMismatchPenalty = 0;

      for (const [author, initials] of targetAuthorInitials) {
        const pattern = buildInitialsPattern(author, initials);

        if (pattern.test(entry.authorText)) {
          initialMatchScore += 15;
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: INITIAL MATCH for idx=${idx}: "${initials} ${author}" found in authorText`,
          );
        } else if (entry.authorText.toLowerCase().includes(author)) {
          if (buildDifferentInitialsPattern(author).test(entry.authorText)) {
            initialMismatchPenalty += 12;
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: INITIAL MISMATCH for idx=${idx}: wanted "${initials} ${author}" but found different initials`,
            );
          }
        }
      }

      score += initialMatchScore;
      score -= initialMismatchPenalty;
    }

    // Journal/volume/page scoring for year suffix disambiguation
    if (pdfPaperInfoForFuzzy && yearMatched && entry.publicationInfo) {
      const pub = entry.publicationInfo;
      let pubMatchScore = 0;

      if (pdfPaperInfoForFuzzy.volume && pub.journal_volume) {
        if (pub.journal_volume === pdfPaperInfoForFuzzy.volume) {
          pubMatchScore += 10;
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: volume match for idx=${idx}: entry vol=${pub.journal_volume} == PDF vol=${pdfPaperInfoForFuzzy.volume}`,
          );
        } else {
          pubMatchScore -= 8;
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] matchAuthorYear: volume MISMATCH for idx=${idx}: entry vol=${pub.journal_volume} != PDF vol=${pdfPaperInfoForFuzzy.volume}`,
          );
        }
      }

      if (pdfPaperInfoForFuzzy.pageStart && pub.page_start) {
        if (pub.page_start === pdfPaperInfoForFuzzy.pageStart) {
          pubMatchScore += 5;
        }
      }

      score += pubMatchScore;
    }

    // Only consider entries with reasonable scores
    if (score >= 4) {
      scoredMatches.push({ idx, score, entry, yearMatched });
    }
  }

  return scoredMatches;
}
