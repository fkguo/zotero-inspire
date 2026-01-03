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
import type {
  CitationGraphNode,
  CitationGraphSortMode,
  InspireReferenceEntry,
} from "./types";
import { isPdgReviewOfParticlePhysicsTitle } from "./reviewUtils";

export type { CitationGraphNode, CitationGraphSortMode } from "./types";

export interface CitationGraphOneHopResult {
  center: CitationGraphNode;
  references: InspireReferenceEntry[];
  citedBy: InspireReferenceEntry[];
  totals: { references: number; citedBy: number };
  shown: { references: number; citedBy: number };
  sort: CitationGraphSortMode;
  // Extra fields for multi-seed graph aggregation and edge detection.
  referencesAllRecids?: string[];
  citedByRecids?: string[];
}

export interface FetchCitationGraphOptions {
  signal?: AbortSignal;
  sort?: CitationGraphSortMode;
  seedTitle?: string;
  maxReferences?: number;
  maxCitedBy?: number;
}

function getCitationValue(entry: InspireReferenceEntry): number {
  const v = entry.citationCountWithoutSelf ?? entry.citationCount ?? -1;
  return typeof v === "number" && Number.isFinite(v) ? v : -1;
}

function getYearValue(entry: InspireReferenceEntry): number {
  const y = Number(entry.year);
  return Number.isFinite(y) ? y : -Infinity;
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

/**
 * Build smart title with fallback logic when title is unavailable.
 * Priority: title > author+year > arXiv > DOI > summary > recid
 */
export function buildSmartTitle(entry: InspireReferenceEntry, strings: ReturnType<typeof getCachedStrings>): string {
  // 1. Use title if available
  if (entry.title && entry.title !== strings.noTitle) {
    return entry.title;
  }

  // 2. Use author + year
  if (entry.authorText && entry.year && entry.year !== strings.yearUnknown) {
    return `${entry.authorText} (${entry.year})`;
  }

  // 3. Use arXiv ID
  if (entry.arxivDetails && typeof entry.arxivDetails !== 'string' && entry.arxivDetails.id) {
    return `arXiv:${entry.arxivDetails.id}`;
  }

  // 4. Use DOI
  if (entry.doi) {
    const shortDoi = entry.doi.length > 25 ? `${entry.doi.slice(0, 25)}...` : entry.doi;
    return `DOI: ${shortDoi}`;
  }

  // 5. Use publication summary
  if (entry.summary) {
    return entry.summary;
  }

  // 6. Last resort: use recid
  return `INSPIRE:${entry.recid}`;
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
    authors: authorNames,
    totalAuthors,
    authorSearchInfos: extractAuthorSearchInfos(authors, 3),
    authorText,
    displayText: "",
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

  // Apply smart title fallback if title is unavailable
  entry.title = buildSmartTitle(entry, strings);

  entry.displayText = buildDisplayText(entry);
  entry.searchText = "";

  return entry;
}

async function fetchCitedByEntriesLimited(
  seedRecid: string,
  maxCitedBy: number,
  sort: CitationGraphSortMode,
  signal?: AbortSignal,
): Promise<{ entries: InspireReferenceEntry[]; total: number }> {
  const strings = getCachedStrings();
  const query = encodeURIComponent(`refersto:recid:${seedRecid}`);
  const sortParam = sort === "relevance" ? "" : `&sort=${sort}`;
  const fieldsParam = buildFieldsParam(API_FIELDS_LIST_DISPLAY);
  const fetchSize =
    sort === "relevance" ? Math.min(200, Math.max(1, maxCitedBy * 3)) : maxCitedBy;
  const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=${Math.max(1, fetchSize)}&page=1${sortParam}${fieldsParam}`;

  const response = await inspireFetch(url, signal ? { signal } : undefined).catch(
    () => null,
  );
  if (!response || response.status === 404 || !response.ok) {
    return { entries: [], total: 0 };
  }
  const payload = (await response.json()) as unknown;
  if (!isInspireLiteratureSearchResponse(payload)) {
    return { entries: [], total: 0 };
  }
  const total = typeof payload.hits?.total === "number" ? payload.hits.total : 0;
  const hits = Array.isArray(payload.hits?.hits) ? payload.hits.hits : [];

  const entries: InspireReferenceEntry[] = [];
  for (let i = 0; i < hits.length; i++) {
    const entry = buildEntryFromSearchHit(hits[i], i, strings);
    if (isPdgReviewOfParticlePhysicsTitle(entry.title)) {
      continue;
    }
    entries.push(entry);
  }
  return { entries, total };
}

export async function fetchCitationGraphOneHop(
  seedRecid: string,
  options: FetchCitationGraphOptions = {},
): Promise<CitationGraphOneHopResult> {
  const { signal } = options;
  const sort = options.sort ?? DEFAULT_CITATION_GRAPH_SORT;
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

  // Fetch seed metadata to get author info
  let seedAuthorLabel: string | undefined;
  let seedYear: string | undefined;
  let seedTitleFromApi: string | undefined;
  let seedCitationCount: number | undefined;
  let seedCitationCountWithoutSelf: number | undefined;
  try {
    const seedUrl = `${INSPIRE_API_BASE}/literature/${seedRecid}?fields=titles.title,authors,earliest_date,citation_count,citation_count_without_self_citations,citation_count_wo_self_citations`;
    const seedResp = await inspireFetch(seedUrl, signal ? { signal } : undefined);
    if (seedResp.ok) {
      const seedData = await seedResp.json() as {
        metadata?: {
          titles?: Array<{ title?: string }>;
          authors?: unknown[];
          earliest_date?: string;
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
      seedYear = seedData?.metadata?.earliest_date?.slice(0, 4);
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
  try {
    const allRefs = await fetchReferencesEntries(seedRecid, { signal });
    // Enrich references to get citation counts
    await enrichReferencesEntries(allRefs, { signal });
    const filtered = allRefs.filter(
      (e) => !isPdgReviewOfParticlePhysicsTitle(e.title),
    );
    referencesTotal = filtered.length;
    referencesAllRecids = filtered
      .map((e) => e.recid)
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0);
    const sorted = [...filtered];
    sortEntries(sorted, sort);
    references = sorted.slice(0, Math.max(0, maxReferences));
  } catch {
    references = [];
    referencesTotal = 0;
  }

  const { entries: citedByRaw, total: citedByTotal } =
    await fetchCitedByEntriesLimited(seedRecid, maxCitedBy, sort, signal);

  const citedBySorted = [...citedByRaw];
  sortEntries(citedBySorted, sort);
  const citedBy = citedBySorted.slice(0, Math.max(0, maxCitedBy));
  const citedByRecids = citedBy
    .map((e) => e.recid)
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0);

  // Enrich entries with localItemID (batch query for performance)
  await enrichWithLocalItems(references);
  await enrichWithLocalItems(citedBy);

  return {
    center,
    references,
    citedBy,
    totals: { references: referencesTotal, citedBy: citedByTotal },
    shown: { references: references.length, citedBy: citedBy.length },
    sort,
    referencesAllRecids,
    citedByRecids,
  };
}
