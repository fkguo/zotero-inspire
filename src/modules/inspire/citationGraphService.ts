import { cleanMathTitle } from "../../utils/mathTitle";
import {
  INSPIRE_API_BASE,
  INSPIRE_LITERATURE_URL,
  API_FIELDS_LIST_DISPLAY,
  CITATION_GRAPH_MAX_CITED_BY,
  CITATION_GRAPH_MAX_REFERENCES,
  DEFAULT_CITATION_GRAPH_SORT,
  buildFieldsParam,
} from "./constants";
import { buildFallbackUrlFromMetadata, extractArxivFromMetadata } from "./apiUtils";
import { extractAuthorNamesLimited, extractAuthorSearchInfos } from "./authorUtils";
import {
  getCachedStrings,
  formatAuthors,
  splitPublicationInfo,
  buildPublicationSummary,
  buildDisplayText,
} from "./formatters";
import { fetchReferencesEntries, enrichReferencesEntries } from "./referencesService";
import { isInspireLiteratureSearchResponse } from "./apiTypes";
import { inspireFetch } from "./rateLimiter";
import { localCache } from "./localCache";
import type {
  CitationGraphNode,
  CitationGraphSortMode,
  InspireReferenceEntry,
} from "./types";
import { isPdgOrReviewArticleEntry } from "./reviewUtils";
import { LRUCache } from "./utils";

export type { CitationGraphNode, CitationGraphSortMode } from "./types";

export interface CitationGraphOneHopResult {
  center: CitationGraphNode;
  references: InspireReferenceEntry[];
  citedBy: InspireReferenceEntry[];
  totals: { references: number; citedBy: number };
  shown: { references: number; citedBy: number };
  sort: CitationGraphSortMode;
  // Extra fields for multi-seed graph aggregation and edge detection.
  /** All reference recids (unfiltered; used for seed-to-seed edge detection). */
  referencesAllRecids?: string[];
  /** Reference recids after applying review filtering (used for union totals/connection counts). */
  referencesFilteredRecids?: string[];
  citedByRecids?: string[];
}

export interface FetchCitationGraphOptions {
  signal?: AbortSignal;
  sort?: CitationGraphSortMode;
  seedTitle?: string;
  maxReferences?: number;
  maxCitedBy?: number;
  /** Ignore local cache and force network refresh (still falls back to cache on failure). */
  forceRefresh?: boolean;
  /** Include review articles (including PDG RPP) in references/cited-by lists. */
  includeReviews?: boolean;
}

function getCitationValue(entry: InspireReferenceEntry): number {
  const v = entry.citationCountWithoutSelf ?? entry.citationCount ?? -1;
  return typeof v === "number" && Number.isFinite(v) ? v : -1;
}

function getYearValue(entry: InspireReferenceEntry): number {
  const y = Number(entry.year);
  return Number.isFinite(y) ? y : -Infinity;
}

const citationGraphResultCache = new LRUCache<string, CitationGraphOneHopResult>(100);

const CITATION_GRAPH_CACHE_MAX_PER_SIDE = 200;
const CITATION_GRAPH_LEGACY_MAX_CANDIDATES = [200, 100, 50, 25] as const;

function isReviewLikeEntry(
  entry: Pick<InspireReferenceEntry, "title" | "documentType" | "publicationInfo">,
): boolean {
  return isPdgOrReviewArticleEntry(entry);
}

function sortEntries(entries: InspireReferenceEntry[], sort: CitationGraphSortMode) {
  if (sort === "relevance") {
    const maxCites = entries.reduce((m, e) => Math.max(m, getCitationValue(e)), 0);
    const finiteYears = entries.map(getYearValue).filter((y) => Number.isFinite(y));
    const minYear = finiteYears.length ? Math.min(...finiteYears) : -Infinity;
    const maxYear = finiteYears.length ? Math.max(...finiteYears) : -Infinity;

    const maxLogCites = Math.log1p(Math.max(1, maxCites));
    const yearRange = Number.isFinite(minYear) && Number.isFinite(maxYear) && maxYear > minYear
      ? maxYear - minYear
      : 0;

    const scoreCache = new Map<string, number>();
    const getScore = (e: InspireReferenceEntry) => {
      const key = e.recid || e.id;
      const cached = scoreCache.get(key);
      if (typeof cached === "number") return cached;

      const cites = Math.max(0, getCitationValue(e));
      const normCites = maxLogCites > 0 ? Math.log1p(cites) / maxLogCites : 0;
      const year = getYearValue(e);
      const normYear =
        yearRange > 0 && Number.isFinite(year) ? (year - minYear) / yearRange : 0;
      const localBonus = typeof e.localItemID === "number" ? 0.03 : 0;
      // Balanced (citations + recency) to avoid only "mostcited"/"mostrecent".
      const score = 0.62 * normCites + 0.38 * normYear + localBonus;
      scoreCache.set(key, score);
      return score;
    };

    entries.sort((a, b) => {
      const byScore = getScore(b) - getScore(a);
      if (byScore) return byScore;
      const byCites = getCitationValue(b) - getCitationValue(a);
      if (byCites) return byCites;
      return getYearValue(b) - getYearValue(a);
    });
    return;
  }
  if (sort === "mostrecent") {
    entries.sort((a, b) => {
      const byYear = getYearValue(b) - getYearValue(a);
      if (byYear) return byYear;
      return getCitationValue(b) - getCitationValue(a);
    });
    return;
  }
  entries.sort((a, b) => {
    const byCites = getCitationValue(b) - getCitationValue(a);
    if (byCites) return byCites;
    return getYearValue(b) - getYearValue(a);
  });
}

function buildCitationGraphCacheSuffix(
  sort: CitationGraphSortMode,
  includeReviews: boolean,
): string {
  // NOTE: Intentionally does NOT include max-per-side.
  // The cached payload stores up to the largest max requested so far.
  return `cg_${sort}_rv${includeReviews ? 1 : 0}`;
}

function buildCitationGraphLegacyCacheSuffix(
  sort: CitationGraphSortMode,
  includeReviews: boolean,
  maxReferences: number,
  maxCitedBy: number,
): string {
  return `cg_${sort}_rv${includeReviews ? 1 : 0}_r${maxReferences}_c${maxCitedBy}`;
}

function sliceCitationGraphResult(
  result: CitationGraphOneHopResult,
  maxReferences: number,
  maxCitedBy: number,
): CitationGraphOneHopResult {
  const references = result.references.slice(0, Math.max(0, maxReferences));
  const citedBy = result.citedBy.slice(0, Math.max(0, maxCitedBy));
  const citedByRecids = citedBy
    .map((e) => e.recid)
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0);

  return {
    ...result,
    references,
    citedBy,
    shown: { references: references.length, citedBy: citedBy.length },
    citedByRecids,
  };
}

async function loadCachedCitationGraphOneHopBase(
  seedRecid: string,
  sort: CitationGraphSortMode,
  includeReviews: boolean,
): Promise<CitationGraphOneHopResult | null> {
  const cacheSuffix = buildCitationGraphCacheSuffix(sort, includeReviews);
  const cacheKey = `${seedRecid}|${cacheSuffix}`;

  const mem = citationGraphResultCache.get(cacheKey) ?? null;
  if (mem) {
    return mem;
  }

  const cachedDisk = await localCache.get<CitationGraphOneHopResult>(
    "citation_graph",
    seedRecid,
    cacheSuffix,
  );
  if (cachedDisk) {
    citationGraphResultCache.set(cacheKey, cachedDisk.data);
    return cachedDisk.data;
  }

  // Backward-compatible fallback: try legacy cache suffixes that included max-per-side.
  for (const n of CITATION_GRAPH_LEGACY_MAX_CANDIDATES) {
    const legacySuffix = buildCitationGraphLegacyCacheSuffix(
      sort,
      includeReviews,
      n,
      n,
    );
    const legacyDisk = await localCache.get<CitationGraphOneHopResult>(
      "citation_graph",
      seedRecid,
      legacySuffix,
    );
    if (!legacyDisk) continue;
    const legacy = legacyDisk.data;
    citationGraphResultCache.set(cacheKey, legacy);
    // Opportunistically migrate to the new suffix to avoid repeated legacy lookups.
    void localCache.set("citation_graph", seedRecid, legacy, cacheSuffix);
    return legacy;
  }

  return null;
}

export async function getCachedCitationGraphOneHop(
  seedRecid: string,
  options: FetchCitationGraphOptions = {},
): Promise<CitationGraphOneHopResult | null> {
  const sort = options.sort ?? DEFAULT_CITATION_GRAPH_SORT;
  const includeReviews = options.includeReviews === true;
  const seedTitleOverride =
    typeof options.seedTitle === "string" && options.seedTitle.trim()
      ? options.seedTitle.trim()
      : undefined;
  const maxReferences =
    typeof options.maxReferences === "number" && options.maxReferences > 0
      ? Math.floor(options.maxReferences)
      : CITATION_GRAPH_MAX_REFERENCES;
  const maxCitedBy =
    typeof options.maxCitedBy === "number" && options.maxCitedBy > 0
      ? Math.floor(options.maxCitedBy)
      : CITATION_GRAPH_MAX_CITED_BY;

  const cached = await loadCachedCitationGraphOneHopBase(
    seedRecid,
    sort,
    includeReviews,
  );
  if (!cached) return null;

  if (seedTitleOverride) {
    cached.center.title = cleanMathTitle(seedTitleOverride) || seedTitleOverride;
  }

  cached.center.localItemID = await getLocalItemIDForRecid(seedRecid);
  await enrichWithLocalItems(cached.references);
  await enrichWithLocalItems(cached.citedBy);

  return sliceCitationGraphResult(cached, maxReferences, maxCitedBy);
}

/**
 * Enrich entries with localItemID by batch querying Zotero database.
 * Reuses the same SQL query pattern as References panel for consistency.
 */
async function enrichWithLocalItems(entries: InspireReferenceEntry[]): Promise<void> {
  // Extract all recids
  const recids = entries.map(e => e.recid).filter((r): r is string => Boolean(r));
  if (recids.length === 0) {
    return;
  }

  // Query archiveLocation field directly (same as References panel)
  const fieldID = Zotero.ItemFields.getID("archiveLocation");
  if (!fieldID) {
    return;
  }

  const recidMap = new Map<string, number>();
  const CHUNK_SIZE = 500;

  for (let i = 0; i < recids.length; i += CHUNK_SIZE) {
    const chunk = recids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const sql = `SELECT itemID, value FROM itemData JOIN itemDataValues USING(valueID) WHERE fieldID = ? AND value IN (${placeholders})`;
    try {
      const rows = await Zotero.DB.queryAsync(sql, [fieldID, ...chunk]);
      if (rows) {
        for (const row of rows) {
          recidMap.set(row.value as string, Number(row.itemID));
        }
      }
    } catch (e) {
      // Silently ignore errors
    }
  }

  // Update entries with localItemID
  let foundCount = 0;
  for (const entry of entries) {
    if (entry.recid && recidMap.has(entry.recid)) {
      entry.localItemID = recidMap.get(entry.recid);
      foundCount++;
    }
  }
}

async function getLocalItemIDForRecid(recid: string): Promise<number | undefined> {
  const fieldID = Zotero.ItemFields.getID("archiveLocation");
  if (!fieldID) {
    return undefined;
  }
  try {
    const sql =
      "SELECT itemID FROM itemData JOIN itemDataValues USING(valueID) WHERE fieldID = ? AND value = ? LIMIT 1";
    const rows = await Zotero.DB.queryAsync(sql, [fieldID, recid]);
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const itemID = row?.itemID;
    const parsed = typeof itemID === "number" ? itemID : Number(itemID);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function buildEntryFromSearchHit(
  hit: unknown,
  index: number,
  strings: ReturnType<typeof getCachedStrings>,
): InspireReferenceEntry {
  const meta = (hit as { metadata?: unknown })?.metadata || hit;
  const metaObj = meta as Record<string, unknown>;

  const recid = String(metaObj?.control_number ?? "");
  const rawTitle =
    ((metaObj?.titles as { title?: string }[])?.[0]?.title as string) || undefined;
  const cleanedTitle = cleanMathTitle(rawTitle);
  const title = cleanedTitle || strings.noTitle;
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

  const { names: authorNames, total: totalAuthors } = extractAuthorNamesLimited(
    authors,
    3,
  );
  const authorText = formatAuthors(authorNames, totalAuthors);
  const fallbackYear = year || undefined;
  const summary = buildPublicationSummary(
    publicationInfo,
    arxivDetails,
    fallbackYear,
    errata,
  );

  const inspireUrl = recid ? `${INSPIRE_LITERATURE_URL}/${recid}` : "";
  const fallbackUrl = buildFallbackUrlFromMetadata(metaObj, arxivDetails);

  // Extract primary DOI from metadata
  const dois = metaObj?.dois as Array<string | { value?: string }> | undefined;
  const doi =
    Array.isArray(dois) && dois.length
      ? typeof dois[0] === "string"
        ? dois[0]
        : dois[0]?.value
      : undefined;

  const entry: InspireReferenceEntry = {
    id: `graph-${index}-${recid || Date.now()}`,
    recid,
    title,
    titleOriginal: cleanedTitle,
    authors: authorNames,
    totalAuthors,
    authorSearchInfos: extractAuthorSearchInfos(authors, 3),
    authorText,
    displayText: "",
    earliestDate: earliestDate || undefined,
    year: year || strings.yearUnknown,
    summary,
    citationCount,
    citationCountWithoutSelf,
    inspireUrl,
    fallbackUrl,
    searchText: "",
    localItemID: undefined,
    isRelated: false,
    publicationInfo,
    publicationInfoErrata: errata,
    arxivDetails,
    doi,
    documentType: Array.isArray(metaObj?.document_type)
      ? (metaObj.document_type as string[])
      : undefined,
  };

  entry.displayText = buildDisplayText(entry);
  entry.searchText = "";

  return entry;
}

async function fetchCitedByEntriesLimited(
  seedRecid: string,
  maxCitedBy: number,
  sort: CitationGraphSortMode,
  includeReviews: boolean,
  signal?: AbortSignal,
): Promise<{ entries: InspireReferenceEntry[]; total: number; ok: boolean }> {
  const strings = getCachedStrings();
  const query = encodeURIComponent(`refersto:recid:${seedRecid}`);
  const sortParam = sort === "relevance" ? "" : `&sort=${sort}`;
  const fieldsParam = buildFieldsParam(API_FIELDS_LIST_DISPLAY);
  const fetchSize =
    sort === "relevance"
      ? Math.min(200, Math.max(1, maxCitedBy * 3))
      : includeReviews
        ? maxCitedBy
        : Math.min(200, Math.max(1, maxCitedBy * 5));
  const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=${Math.max(1, fetchSize)}&page=1${sortParam}${fieldsParam}`;

  const response = await inspireFetch(url, signal ? { signal } : undefined).catch(
    () => null,
  );
  if (!response || response.status === 404 || !response.ok) {
    return { entries: [], total: 0, ok: false };
  }
  const payload = (await response.json()) as unknown;
  if (!isInspireLiteratureSearchResponse(payload)) {
    return { entries: [], total: 0, ok: false };
  }
  const total = typeof payload.hits?.total === "number" ? payload.hits.total : 0;
  const hits = Array.isArray(payload.hits?.hits) ? payload.hits.hits : [];

  const entries: InspireReferenceEntry[] = [];
  for (let i = 0; i < hits.length; i++) {
    const entry = buildEntryFromSearchHit(hits[i], i, strings);
    if (!includeReviews && isReviewLikeEntry(entry)) {
      continue;
    }
    entries.push(entry);
  }
  return { entries, total, ok: true };
}

export async function fetchCitationGraphOneHop(
  seedRecid: string,
  options: FetchCitationGraphOptions = {},
): Promise<CitationGraphOneHopResult> {
  const { signal } = options;
  const sort = options.sort ?? DEFAULT_CITATION_GRAPH_SORT;
  const forceRefresh = options.forceRefresh === true;
  const includeReviews = options.includeReviews === true;
  const maxReferences =
    typeof options.maxReferences === "number" && options.maxReferences > 0
      ? Math.floor(options.maxReferences)
      : CITATION_GRAPH_MAX_REFERENCES;
  const maxCitedBy =
    typeof options.maxCitedBy === "number" && options.maxCitedBy > 0
      ? Math.floor(options.maxCitedBy)
      : CITATION_GRAPH_MAX_CITED_BY;

  const seedTitleOverride =
    typeof options.seedTitle === "string" && options.seedTitle.trim()
      ? options.seedTitle.trim()
      : undefined;

  const cacheSuffix = buildCitationGraphCacheSuffix(sort, includeReviews);
  const cacheKey = `${seedRecid}|${cacheSuffix}`;
  const applySeedTitleOverride = (result: CitationGraphOneHopResult) => {
    if (seedTitleOverride) {
      result.center.title = cleanMathTitle(seedTitleOverride) || seedTitleOverride;
    }
  };
  const refreshLocalStatus = async (result: CitationGraphOneHopResult) => {
    result.center.localItemID = await getLocalItemIDForRecid(seedRecid);
    await enrichWithLocalItems(result.references);
    await enrichWithLocalItems(result.citedBy);
  };

  const cachedFallback = await loadCachedCitationGraphOneHopBase(
    seedRecid,
    sort,
    includeReviews,
  );

  if (cachedFallback && !forceRefresh) {
    applySeedTitleOverride(cachedFallback);
    await refreshLocalStatus(cachedFallback);
    const refsEnough = cachedFallback.references.length >= maxReferences;
    const citedEnough = cachedFallback.citedBy.length >= maxCitedBy;
    if (refsEnough && citedEnough) {
      return sliceCitationGraphResult(cachedFallback, maxReferences, maxCitedBy);
    }
  }

  // Fetch seed metadata to get author info
  let seedAuthorLabel: string | undefined;
  let seedYear: string | undefined;
  let seedTitleFromApi: string | undefined;
  let seedCitationCount: number | undefined;
  let seedCitationCountWithoutSelf: number | undefined;
  let refsOk = false;
  let citedOk = false;
  try {
    const seedUrl = `${INSPIRE_API_BASE}/literature/${seedRecid}?fields=titles.title,authors,earliest_date,publication_info.year,citation_count,citation_count_without_self_citations,citation_count_wo_self_citations`;
    const seedResp = await inspireFetch(seedUrl, signal ? { signal } : undefined);
    if (seedResp.ok) {
      const seedData = await seedResp.json() as {
        metadata?: {
          titles?: Array<{ title?: string }>;
          authors?: unknown[];
          earliest_date?: string;
          publication_info?: Array<{ year?: number | string }>;
          citation_count?: number;
          citation_count_without_self_citations?: number;
          citation_count_wo_self_citations?: number;
        };
      };
      const rawSeedTitle = seedData?.metadata?.titles?.[0]?.title;
      if (typeof rawSeedTitle === "string" && rawSeedTitle.trim()) {
        seedTitleFromApi = cleanMathTitle(rawSeedTitle.trim());
      }
      const authors = seedData?.metadata?.authors;
      if (Array.isArray(authors) && authors.length > 0) {
        const { names, total } = extractAuthorNamesLimited(authors, 1);
        if (names.length > 0) {
          const lastName = names[0].includes(",")
            ? names[0].split(",")[0].trim()
            : names[0].split(" ").pop() || names[0];
          seedAuthorLabel = total > 1 ? `${lastName} et al.` : lastName;
        }
      }
      seedYear =
        seedData?.metadata?.earliest_date?.slice(0, 4) ||
        (Array.isArray(seedData?.metadata?.publication_info) &&
        seedData.metadata!.publication_info!.length
          ? String(seedData.metadata!.publication_info![0]?.year ?? "").slice(0, 4)
          : undefined);
      seedCitationCount =
        typeof seedData?.metadata?.citation_count === "number"
          ? seedData.metadata.citation_count
          : undefined;
      seedCitationCountWithoutSelf =
        typeof seedData?.metadata?.citation_count_without_self_citations ===
        "number"
          ? seedData.metadata.citation_count_without_self_citations
          : typeof seedData?.metadata?.citation_count_wo_self_citations ===
              "number"
            ? seedData.metadata.citation_count_wo_self_citations
            : undefined;
      if (seedAuthorLabel && seedYear) {
        seedAuthorLabel = `${seedAuthorLabel} (${seedYear})`;
      }
    }
  } catch {
    // Ignore errors fetching seed metadata
  }

  const seedLocalItemID = await getLocalItemIDForRecid(seedRecid);
  const resolvedSeedTitle =
    cleanMathTitle(seedTitleOverride || seedTitleFromApi || seedRecid) ||
    seedRecid;

  const center: CitationGraphNode = {
    recid: seedRecid,
    title: resolvedSeedTitle,
    inspireUrl: `${INSPIRE_LITERATURE_URL}/${seedRecid}`,
    authorLabel: seedAuthorLabel,
    year: seedYear,
    citationCount: seedCitationCountWithoutSelf ?? seedCitationCount,
    localItemID: seedLocalItemID,
    isSeed: true,
  };

  // References: INSPIRE returns the full embedded list; truncate client-side.
  let references: InspireReferenceEntry[] = [];
  let referencesTotal = 0;
  let referencesAllRecids: string[] = [];
  let referencesFilteredRecids: string[] = [];
  try {
    const allRefs = await fetchReferencesEntries(seedRecid, { signal });
    refsOk = true;
    // Enrich references to get citation counts
    await enrichReferencesEntries(allRefs, { signal });
    referencesAllRecids = allRefs
      .map((e) => e.recid)
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0);

    const filtered = includeReviews ? allRefs : allRefs.filter((e) => !isReviewLikeEntry(e));
    referencesTotal = filtered.length;
    referencesFilteredRecids = filtered
      .map((e) => e.recid)
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0);
    const sorted = [...filtered];
    sortEntries(sorted, sort);
    const cachedTarget = Math.min(
      CITATION_GRAPH_CACHE_MAX_PER_SIDE,
      Math.max(maxReferences, cachedFallback?.references.length ?? 0),
    );
    references = sorted.slice(0, Math.max(0, cachedTarget));
  } catch {
    references = [];
    referencesTotal = 0;
  }

  const cachedCitedByTarget = Math.min(
    CITATION_GRAPH_CACHE_MAX_PER_SIDE,
    Math.max(maxCitedBy, cachedFallback?.citedBy.length ?? 0),
  );
  const citedByResponse = await fetchCitedByEntriesLimited(
    seedRecid,
    cachedCitedByTarget,
    sort,
    includeReviews,
    signal,
  );
  citedOk = citedByResponse.ok;
  const { entries: citedByRaw, total: citedByTotal } = citedByResponse;

  const citedBySorted = [...citedByRaw];
  sortEntries(citedBySorted, sort);
  const citedBy = citedBySorted.slice(0, Math.max(0, cachedCitedByTarget));
  const citedByRecids = citedBy
    .map((e) => e.recid)
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0);

  // Enrich entries with localItemID (batch query for performance)
  await enrichWithLocalItems(references);
  await enrichWithLocalItems(citedBy);

  const resultBase: CitationGraphOneHopResult = {
    center,
    references,
    citedBy,
    totals: { references: referencesTotal, citedBy: citedByTotal },
    shown: { references: references.length, citedBy: citedBy.length },
    sort,
    referencesAllRecids,
    referencesFilteredRecids,
    citedByRecids,
  };
  if ((!refsOk || !citedOk) && cachedFallback) {
    // Prefer cached data over partially failed fetches to avoid sticky empty sides.
    applySeedTitleOverride(cachedFallback);
    await refreshLocalStatus(cachedFallback);
    return sliceCitationGraphResult(cachedFallback, maxReferences, maxCitedBy);
  }
  if (!refsOk || !citedOk) {
    // Don't cache partial/failed results; they cause sticky empty graphs.
    return sliceCitationGraphResult(resultBase, maxReferences, maxCitedBy);
  }
  citationGraphResultCache.set(cacheKey, resultBase);
  void localCache.set("citation_graph", seedRecid, resultBase, cacheSuffix);
  return sliceCitationGraphResult(resultBase, maxReferences, maxCitedBy);
}
