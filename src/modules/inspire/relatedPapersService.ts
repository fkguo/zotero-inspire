import { config } from "../../../package.json";
import { cleanMathTitle } from "../../utils/mathTitle";
import {
  INSPIRE_API_BASE,
  INSPIRE_LITERATURE_URL,
  API_FIELDS_CONTROL_NUMBER,
  API_FIELDS_LIST_DISPLAY,
  buildFieldsParam,
  RELATED_COCITATION_TOP_N,
} from "./constants";
import { extractArxivFromMetadata, buildFallbackUrlFromMetadata } from "./apiUtils";
import { extractAuthorNamesLimited, extractAuthorSearchInfos } from "./authorUtils";
import {
  getCachedStrings,
  formatAuthors,
  splitPublicationInfo,
  buildPublicationSummary,
  buildDisplayText,
} from "./formatters";
import type {
  InspireLiteratureHit,
} from "./apiTypes";
import { isInspireLiteratureSearchResponse } from "./apiTypes";
import { inspireFetch } from "./rateLimiter";
import type { InspireReferenceEntry } from "./types";
import {
  isReviewArticleEntry,
  isReviewDocumentType,
  isReviewJournal,
  isPdgReviewOfParticlePhysicsTitle,
} from "./reviewUtils";
import {
  computeCoCitationBlendWeight,
  computeNormalizedCoCitation,
} from "./relatedCoCitationUtils";

export const RELATED_PAPERS_ALGORITHM_VERSION = 4;

export interface RelatedPapersParams {
  /** Max number of seed references used as anchors (K) */
  maxAnchors: number;
  /** Max number of citing papers fetched per anchor (N) */
  perAnchor: number;
  /** Max number of results returned to UI (M) */
  maxResults: number;
  /** Exclude review articles from anchors and results */
  excludeReviewArticles: boolean;
  /** Max in-flight INSPIRE requests */
  concurrency: number;
}

export interface RelatedPapersProgress {
  processedAnchors: number;
  totalAnchors: number;
  entries: InspireReferenceEntry[];
}

export interface FetchRelatedPapersOptions {
  signal?: AbortSignal;
  params?: Partial<RelatedPapersParams>;
  onProgress?: (progress: RelatedPapersProgress) => void;
}

export type RelatedAnchor = { recid: string; title: string; weight: number };

const DEFAULT_PARAMS: RelatedPapersParams = {
  maxAnchors: 15,
  perAnchor: 25,
  maxResults: 50,
  excludeReviewArticles: true,
  concurrency: 2,
};

const ANCHOR_CITATIONS_MIN = 5;
const ANCHOR_CITATIONS_MAX = 300;
const ANCHOR_CITATIONS_TOO_HIGH = 1500;
const ANCHOR_SELECTION_TARGET_CITATIONS = 50;

function computeAnchorWeight(citationCount: number | undefined): number {
  if (
    typeof citationCount !== "number" ||
    !Number.isFinite(citationCount) ||
    citationCount < 0
  ) {
    return 0.25;
  }
  const c = Math.max(0, citationCount);
  return 1 / (1 + Math.log1p(c));
}

function getCitationScore(entry: InspireReferenceEntry): number | undefined {
  const raw = entry.citationCountWithoutSelf ?? entry.citationCount;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return undefined;
  }
  return raw;
}

/**
 * Pick anchor references for bibliographic coupling.
 * Heuristic (MVP): prefer entries with recid; rank by citationCount if available.
 */
export function selectRelatedAnchors(
  seedReferences: InspireReferenceEntry[],
  maxAnchors: number,
  options: { excludeReviewArticles?: boolean } = {},
): RelatedAnchor[] {
  const seen = new Set<string>();
  const excludeReviews = options.excludeReviewArticles === true;

  const candidates: Array<{
    recid: string;
    title: string;
    citations?: number;
    weight: number;
    priority: number;
    distance: number;
    index: number;
  }> = [];

  for (let i = 0; i < seedReferences.length; i++) {
    const entry = seedReferences[i];
    // REVIEW-OF-PARTICLE-PHYSICS: skip PDG RPP (too generic, cited by most HEP papers)
    if (isPdgReviewOfParticlePhysicsTitle(entry.title)) continue;
    if (excludeReviews && isReviewArticleEntry(entry)) {
      continue;
    }
    const recid = entry.recid;
    if (!recid) continue;
    if (seen.has(recid)) continue;
    seen.add(recid);

    const citations = getCitationScore(entry);
    const title = entry.title?.trim() ? entry.title : recid;

    // Prefer mid-cited references: enough citing papers to sample, but not too generic.
    // Priority buckets (lower is better):
    // - 0: [MIN..MAX] citations
    // - 1: (MAX..TOO_HIGH] citations
    // - 2: unknown citations
    // - 3: < MIN citations (likely few/no citing papers)
    // - 4: > TOO_HIGH citations (likely too generic)
    const priority =
      citations === undefined
        ? 2
        : citations < ANCHOR_CITATIONS_MIN
          ? 3
          : citations <= ANCHOR_CITATIONS_MAX
            ? 0
            : citations <= ANCHOR_CITATIONS_TOO_HIGH
              ? 1
              : 4;
    const distance =
      citations === undefined
        ? Number.POSITIVE_INFINITY
        : Math.abs(
            Math.log10(citations + 1) -
              Math.log10(ANCHOR_SELECTION_TARGET_CITATIONS + 1),
          );

    candidates.push({
      recid,
      title,
      citations,
      weight: computeAnchorWeight(citations),
      priority,
      distance,
      index: i,
    });
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.index - b.index;
  });

  return candidates
    .slice(0, Math.max(0, maxAnchors))
    .map(({ recid, title, weight }) => ({
      recid,
      title,
      weight,
    }));
}

/**
 * Fetch related papers via bibliographic coupling:
 * - Choose K reference anchors from seedReferences
 * - For each anchor r, fetch top N papers that cite r (refersto:recid:r)
 * - Score by number of shared anchors
 */
export async function fetchRelatedPapersEntries(
  seedRecid: string,
  seedReferences: InspireReferenceEntry[],
  options: FetchRelatedPapersOptions = {},
): Promise<InspireReferenceEntry[]> {
  const { signal, onProgress } = options;
  const params = normalizeParams(options.params);
  const strings = getCachedStrings();

  const anchors = selectRelatedAnchors(seedReferences, params.maxAnchors, {
    excludeReviewArticles: params.excludeReviewArticles,
  });
  if (!anchors.length) {
    return [];
  }

  Zotero.debug(
    `[${config.addonName}] Related papers: seed=${seedRecid}, anchors=${anchors.length}, perAnchor=${params.perAnchor}, concurrency=${params.concurrency}`,
  );
  const totalAnchorWeight = Math.max(
    0.0001,
    anchors.reduce((sum, a) => sum + (Number.isFinite(a.weight) ? a.weight : 0), 0),
  );

  type CandidateAgg = {
    entry: InspireReferenceEntry;
    sharedCount: number;
    sharedTitles: string[];
    seenAnchors: Set<string>;
    weightedScore: number;
    coCitationCount?: number;
    coCitationScore?: number;
  };

  const excludedCandidateRecids = new Set<string>();
  excludedCandidateRecids.add(seedRecid);
  for (const ref of seedReferences) {
    if (ref.recid) excludedCandidateRecids.add(ref.recid);
  }

  const candidates = new Map<string, CandidateAgg>();
  const fieldsParam = buildFieldsParam(API_FIELDS_LIST_DISPLAY);
  const concurrency = Math.min(
    Math.max(1, params.concurrency),
    Math.max(1, anchors.length),
  );

  let processed = 0;
  let lastProgressTs = 0;

  const workers = Array.from({ length: concurrency }, async (_, workerIndex) => {
    for (let i = workerIndex; i < anchors.length; i += concurrency) {
      if (signal?.aborted) {
        throw abortError();
      }

      const anchor = anchors[i];
      const hits = await fetchTopCitingHits(anchor.recid, params.perAnchor, fieldsParam, signal);

      for (const hit of hits) {
        const meta = (hit as { metadata?: any })?.metadata ?? (hit as any);
        const recid = String(meta?.control_number ?? "");
        if (!recid) continue;
        if (excludedCandidateRecids.has(recid)) continue;
        const candidateTitle =
          ((meta?.titles as { title?: string }[])?.[0]?.title as string) ?? "";
        if (candidateTitle && isPdgReviewOfParticlePhysicsTitle(candidateTitle)) {
          continue;
        }
        if (params.excludeReviewArticles) {
          if (isReviewDocumentType(meta?.document_type)) continue;
          if (isReviewJournal(meta?.publication_info)) continue;
        }

        let agg = candidates.get(recid);
        if (!agg) {
          const entry = buildEntryFromLiteratureHit(meta, strings);
          // Stable ID for row caching and selection
          entry.id = `related-${seedRecid}-${recid}`;
          agg = {
            entry,
            sharedCount: 0,
            sharedTitles: [],
            seenAnchors: new Set<string>(),
            weightedScore: 0,
          };
          candidates.set(recid, agg);
        }

        if (agg.seenAnchors.has(anchor.recid)) {
          continue;
        }
        agg.seenAnchors.add(anchor.recid);
        agg.sharedCount++;
        agg.weightedScore += anchor.weight;
        if (agg.sharedTitles.length < 3) {
          agg.sharedTitles.push(anchor.title);
        }
      }

      processed++;

      if (onProgress) {
        const now = Date.now();
        // Throttle progress updates to keep UI responsive.
        if (now - lastProgressTs >= 200 || processed === anchors.length) {
          lastProgressTs = now;
          const entries = buildSortedResults(candidates, params.maxResults, {
            totalAnchorWeight,
            coCitationWeight: 0,
          });
          onProgress({
            processedAnchors: processed,
            totalAnchors: anchors.length,
            entries,
          });
        }
      }
    }
  });

  await Promise.all(workers);

  if (signal?.aborted) {
    throw abortError();
  }

  // Phase 2: Co-citation re-ranking (normalized cosine similarity) with budgeted queries.
  // Compute only for top-N coupling candidates to control request volume.
  const seedCitingTotal = await fetchCitingTotal(seedRecid, signal).catch(() => 0);
  const coCitationWeight = computeCoCitationBlendWeight(seedCitingTotal);
  if (coCitationWeight > 0 && candidates.size > 0) {
    const topForCoCitation = buildSortedResults(
      candidates,
      Math.min(RELATED_COCITATION_TOP_N, candidates.size),
      { totalAnchorWeight, coCitationWeight: 0 },
    )
      .map((e) => e.recid)
      .filter((r): r is string => Boolean(r));

    const coConcurrency = Math.min(
      Math.max(1, params.concurrency),
      Math.max(1, topForCoCitation.length),
    );

    const coWorkers = Array.from(
      { length: coConcurrency },
      async (_, workerIndex) => {
        for (let i = workerIndex; i < topForCoCitation.length; i += coConcurrency) {
          if (signal?.aborted) {
            throw abortError();
          }
          const candidateRecid = topForCoCitation[i];
          const agg = candidates.get(candidateRecid);
          if (!agg) continue;

          const candidateCites =
            agg.entry.citationCountWithoutSelf ?? agg.entry.citationCount ?? 0;
          if (!candidateCites || candidateCites <= 0) {
            continue;
          }

          const coCitedCount = await fetchCoCitationTotal(
            seedRecid,
            candidateRecid,
            signal,
          ).catch(() => 0);

          agg.coCitationCount = coCitedCount || undefined;
          agg.coCitationScore = computeNormalizedCoCitation(
            coCitedCount,
            seedCitingTotal,
            candidateCites,
          );
        }
      },
    );

    await Promise.all(coWorkers);
  }

  const finalEntries = buildSortedResults(candidates, params.maxResults, {
    totalAnchorWeight,
    coCitationWeight,
  });
  if (onProgress && processed === anchors.length) {
    onProgress({
      processedAnchors: processed,
      totalAnchors: anchors.length,
      entries: finalEntries,
    });
  }
  return finalEntries;
}

function normalizeParams(
  partial: Partial<RelatedPapersParams> | undefined,
): RelatedPapersParams {
  const maxAnchors =
    typeof partial?.maxAnchors === "number" && partial.maxAnchors > 0
      ? Math.floor(partial.maxAnchors)
      : DEFAULT_PARAMS.maxAnchors;
  const perAnchor =
    typeof partial?.perAnchor === "number" && partial.perAnchor > 0
      ? Math.floor(partial.perAnchor)
      : DEFAULT_PARAMS.perAnchor;
  const maxResults =
    typeof partial?.maxResults === "number" && partial.maxResults > 0
      ? Math.floor(partial.maxResults)
      : DEFAULT_PARAMS.maxResults;
  const excludeReviewArticles =
    typeof partial?.excludeReviewArticles === "boolean"
      ? partial.excludeReviewArticles
      : DEFAULT_PARAMS.excludeReviewArticles;
  const concurrency =
    typeof partial?.concurrency === "number" && partial.concurrency > 0
      ? Math.floor(partial.concurrency)
      : DEFAULT_PARAMS.concurrency;

  return {
    maxAnchors,
    perAnchor,
    maxResults,
    excludeReviewArticles,
    concurrency,
  };
}

async function fetchTopCitingHits(
  anchorRecid: string,
  perAnchor: number,
  fieldsParam: string,
  signal?: AbortSignal,
): Promise<InspireLiteratureHit[]> {
  const query = encodeURIComponent(`refersto:recid:${anchorRecid}`);
  const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=${perAnchor}&page=1&sort=mostcited${fieldsParam}`;
  const response = await inspireFetch(url, signal ? { signal } : undefined).catch(
    () => null,
  );
  if (!response || response.status === 404 || !response.ok) {
    return [];
  }
  const payload = (await response.json()) as unknown;
  if (!isInspireLiteratureSearchResponse(payload)) {
    return [];
  }
  return Array.isArray(payload.hits?.hits) ? payload.hits.hits : [];
}

async function fetchCitingTotal(recid: string, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) {
    throw abortError();
  }
  const query = encodeURIComponent(`refersto:recid:${recid}`);
  const fieldsParam = buildFieldsParam(API_FIELDS_CONTROL_NUMBER);
  const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=1&page=1${fieldsParam}`;
  const response = await inspireFetch(url, signal ? { signal } : undefined).catch(
    () => null,
  );
  if (!response || response.status === 404 || !response.ok) {
    return 0;
  }
  const payload = (await response.json()) as unknown;
  if (!isInspireLiteratureSearchResponse(payload)) {
    return 0;
  }
  return typeof payload.hits?.total === "number" ? payload.hits.total : 0;
}

async function fetchCoCitationTotal(
  seedRecid: string,
  candidateRecid: string,
  signal?: AbortSignal,
): Promise<number> {
  if (signal?.aborted) {
    throw abortError();
  }
  const query = encodeURIComponent(
    `refersto:recid:${seedRecid} AND refersto:recid:${candidateRecid}`,
  );
  const fieldsParam = buildFieldsParam(API_FIELDS_CONTROL_NUMBER);
  const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=1&page=1${fieldsParam}`;
  const response = await inspireFetch(url, signal ? { signal } : undefined).catch(
    () => null,
  );
  if (!response || response.status === 404 || !response.ok) {
    return 0;
  }
  const payload = (await response.json()) as unknown;
  if (!isInspireLiteratureSearchResponse(payload)) {
    return 0;
  }
  return typeof payload.hits?.total === "number" ? payload.hits.total : 0;
}

function buildSortedResults(
  candidates: Map<
    string,
    {
      entry: InspireReferenceEntry;
      sharedCount: number;
      sharedTitles: string[];
      weightedScore: number;
      coCitationCount?: number;
      coCitationScore?: number;
    }
  >,
  maxResults: number,
  options: { totalAnchorWeight: number; coCitationWeight: number },
): InspireReferenceEntry[] {
  const totalAnchorWeight = Math.max(0.0001, options.totalAnchorWeight);
  const coCitationWeight = Math.max(0, Math.min(0.5, options.coCitationWeight));
  const entries: Array<{
    entry: InspireReferenceEntry;
    sharedCount: number;
    weightedScore: number;
    couplingScore: number;
    coCitationScore: number;
    combinedScore: number;
  }> = [];
  for (const {
    entry,
    sharedCount,
    sharedTitles,
    weightedScore,
    coCitationCount,
    coCitationScore: rawCoCitationScore,
  } of candidates.values()) {
    entry.relatedSharedRefCount = sharedCount;
    entry.relatedSharedRefTitles = sharedTitles.length ? [...sharedTitles] : undefined;
    const couplingScore = Math.max(0, weightedScore) / totalAnchorWeight;
    const coCitationScore = Math.max(0, rawCoCitationScore ?? 0);
    const combinedScore =
      (1 - coCitationWeight) * couplingScore + coCitationWeight * coCitationScore;

    entry.relatedCoCitationCount = coCitationCount;
    entry.relatedCoCitationScore = coCitationScore || undefined;
    entry.relatedCouplingScore = couplingScore || undefined;
    entry.relatedCombinedScore = combinedScore || undefined;

    entries.push({
      entry,
      sharedCount,
      weightedScore,
      couplingScore,
      coCitationScore,
      combinedScore,
    });
  }

  entries.sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) {
      return b.combinedScore - a.combinedScore;
    }
    if (b.sharedCount !== a.sharedCount) {
      return b.sharedCount - a.sharedCount;
    }

    const aEntry = a.entry;
    const bEntry = b.entry;

    const aCites = aEntry.citationCountWithoutSelf ?? aEntry.citationCount ?? -1;
    const bCites = bEntry.citationCountWithoutSelf ?? bEntry.citationCount ?? -1;
    if (bCites !== aCites) return bCites - aCites;

    const aYear = Number(aEntry.year);
    const bYear = Number(bEntry.year);
    const safeA = Number.isFinite(aYear) ? aYear : -Infinity;
    const safeB = Number.isFinite(bYear) ? bYear : -Infinity;
    if (safeB !== safeA) return safeB - safeA;

    return String(aEntry.recid ?? "").localeCompare(String(bEntry.recid ?? ""));
  });

  return entries
    .slice(0, Math.max(0, maxResults))
    .map((r) => r.entry);
}

function buildEntryFromLiteratureHit(
  metaObj: Record<string, unknown>,
  strings: ReturnType<typeof getCachedStrings>,
): InspireReferenceEntry {
  const recid = String(metaObj?.control_number ?? "");

  const rawTitle =
    ((metaObj?.titles as { title?: string }[])?.[0]?.title as string) ??
    strings.noTitle;
  const title = cleanMathTitle(rawTitle);
  const authors = (metaObj?.authors as unknown[]) ?? [];

  const { primary: publicationInfo, errata } = splitPublicationInfo(
    metaObj?.publication_info as unknown[],
  );
  const arxivDetails = extractArxivFromMetadata(metaObj);
  const earliestDate = (metaObj?.earliest_date as string) ?? "";
  const year = earliestDate ? earliestDate.slice(0, 4) : (publicationInfo?.year ?? "");

  const citationCount =
    typeof metaObj?.citation_count === "number"
      ? (metaObj.citation_count as number)
      : undefined;
  const citationCountWithoutSelf =
    typeof metaObj?.citation_count_without_self_citations === "number"
      ? (metaObj.citation_count_without_self_citations as number)
      : typeof metaObj?.citation_count_wo_self_citations === "number"
        ? (metaObj.citation_count_wo_self_citations as number)
        : undefined;
  const documentType = Array.isArray(metaObj?.document_type)
    ? (metaObj.document_type as string[])
    : undefined;

  const { names: authorNames, total: totalAuthors } = extractAuthorNamesLimited(
    authors,
    3,
  );
  const authorText = formatAuthors(authorNames, totalAuthors);
  const fallbackYear = year ? String(year) : undefined;
  const summary = buildPublicationSummary(
    publicationInfo,
    arxivDetails,
    fallbackYear,
    errata,
  );

  const inspireUrl = recid ? `${INSPIRE_LITERATURE_URL}/${recid}` : "";
  const fallbackUrl = buildFallbackUrlFromMetadata(metaObj, arxivDetails);

  const dois = metaObj?.dois as Array<string | { value?: string }> | undefined;
  const doi =
    Array.isArray(dois) && dois.length
      ? typeof dois[0] === "string"
        ? dois[0]
        : dois[0]?.value
      : undefined;

  const entry: InspireReferenceEntry = {
    id: `related-${recid || Date.now()}`,
    recid,
    title,
    authors: authorNames,
    totalAuthors,
    authorSearchInfos: extractAuthorSearchInfos(authors, 3),
    authorText,
    displayText: "",
    year: year ? String(year) : strings.yearUnknown,
    summary,
    citationCount,
    citationCountWithoutSelf,
    documentType,
    inspireUrl,
    fallbackUrl,
    searchText: "",
    localItemID: undefined,
    isRelated: false,
    publicationInfo,
    publicationInfoErrata: errata,
    arxivDetails,
    doi,
  };

  entry.displayText = buildDisplayText(entry);
  entry.searchText = "";

  return entry;
}

function abortError(): Error {
  const err = new Error("Aborted");
  (err as any).name = "AbortError";
  return err;
}
