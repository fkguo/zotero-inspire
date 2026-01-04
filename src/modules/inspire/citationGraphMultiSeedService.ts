import {
  CITATION_GRAPH_MAX_CITED_BY,
  CITATION_GRAPH_MAX_REFERENCES,
  DEFAULT_CITATION_GRAPH_SORT,
  INSPIRE_API_BASE,
  INSPIRE_LITERATURE_URL,
  buildFieldsParam,
} from "./constants";
import { isInspireLiteratureSearchResponse } from "./apiTypes";
import {
  fetchCitationGraphOneHop,
  getCachedCitationGraphOneHop,
  type CitationGraphOneHopResult,
  type FetchCitationGraphOptions,
} from "./citationGraphService";
import { fetchReferencesEntries } from "./referencesService";
import { inspireFetch } from "./rateLimiter";
import type {
  CitationGraphSortMode,
  InspireReferenceEntry,
  MultiSeedGraphResult,
  SeedEdge,
} from "./types";

export interface MultiSeedCitationGraphCacheSummary {
  /** Seeds that were not available in cache at all. */
  missingSeeds: string[];
  /**
   * Seeds that were available in cache but did not have enough nodes to satisfy
   * the requested max-per-side, i.e. a network enrich could add more.
   */
  partialSeeds: string[];
  requested: { maxReferences: number; maxCitedBy: number };
}

function getCitationValue(entry: InspireReferenceEntry): number {
  const v = entry.citationCountWithoutSelf ?? entry.citationCount ?? -1;
  return typeof v === "number" && Number.isFinite(v) ? v : -1;
}

function getYearValue(entry: InspireReferenceEntry): number {
  const y = Number(entry.year);
  return Number.isFinite(y) ? y : -Infinity;
}

function sortEntries(
  entries: InspireReferenceEntry[],
  sort: CitationGraphSortMode,
  options?: {
    connectionCounts?: Map<string, number>;
  },
) {
  if (sort === "relevance") {
    const counts = options?.connectionCounts;
    const maxCites = entries.reduce((m, e) => Math.max(m, getCitationValue(e)), 0);
    const finiteYears = entries.map(getYearValue).filter((y) => Number.isFinite(y));
    const minYear = finiteYears.length ? Math.min(...finiteYears) : -Infinity;
    const maxYear = finiteYears.length ? Math.max(...finiteYears) : -Infinity;

    const maxLogCites = Math.log1p(Math.max(1, maxCites));
    const yearRange =
      Number.isFinite(minYear) && Number.isFinite(maxYear) && maxYear > minYear
        ? maxYear - minYear
        : 0;

    const scoreCache = new Map<string, { conn: number; score: number }>();
    const getMetrics = (e: InspireReferenceEntry) => {
      const recid = e.recid || e.id;
      const cached = scoreCache.get(recid);
      if (cached) return cached;

      const conn =
        typeof e.recid === "string" && counts ? counts.get(e.recid) ?? 1 : 1;
      const cites = Math.max(0, getCitationValue(e));
      const normCites = maxLogCites > 0 ? Math.log1p(cites) / maxLogCites : 0;
      const year = getYearValue(e);
      const normYear =
        yearRange > 0 && Number.isFinite(year) ? (year - minYear) / yearRange : 0;
      const localBonus = typeof e.localItemID === "number" ? 0.03 : 0;
      const score = 0.62 * normCites + 0.38 * normYear + localBonus;
      const result = { conn, score };
      scoreCache.set(recid, result);
      return result;
    };

    entries.sort((a, b) => {
      const ma = getMetrics(a);
      const mb = getMetrics(b);
      const byConn = mb.conn - ma.conn;
      if (byConn) return byConn;
      const byScore = mb.score - ma.score;
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
 * Detect citation relations among seed papers:
 * A══▶B means A references B.
 */
export async function detectSeedEdges(
  seeds: string[],
  options: { signal?: AbortSignal } = {},
): Promise<SeedEdge[]> {
  const { signal } = options;
  const uniqueSeeds = Array.from(
    new Set(seeds.map((s) => String(s).trim()).filter(Boolean)),
  );
  if (uniqueSeeds.length < 2) {
    return [];
  }

  const perSeed = await Promise.all(
    uniqueSeeds.map(async (recid) => {
      const refs = await fetchReferencesEntries(recid, { signal }).catch(() => []);
      const refRecids = refs
        .map((r) => r.recid)
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      return { recid, refs: new Set(refRecids) };
    }),
  );

  const refsBySeed = new Map(perSeed.map((s) => [s.recid, s.refs] as const));
  const edges: SeedEdge[] = [];
  for (const source of uniqueSeeds) {
    const refs = refsBySeed.get(source);
    if (!refs) continue;
    for (const target of uniqueSeeds) {
      if (target === source) continue;
      if (refs.has(target)) {
        edges.push({ source, target, type: "seed-to-seed" });
      }
    }
  }
  return edges;
}

function buildPlaceholderOneHop(
  seedRecid: string,
  sort: CitationGraphSortMode,
): CitationGraphOneHopResult {
  return {
    center: {
      recid: seedRecid,
      title: seedRecid,
      inspireUrl: `${INSPIRE_LITERATURE_URL}/${seedRecid}`,
      isSeed: true,
    },
    references: [],
    citedBy: [],
    totals: { references: 0, citedBy: 0 },
    shown: { references: 0, citedBy: 0 },
    sort,
    referencesAllRecids: [],
    referencesFilteredRecids: [],
    citedByRecids: [],
  };
}

export async function fetchMultiSeedCitationGraphCached(
  seedRecids: string[],
  options: FetchCitationGraphOptions = {},
): Promise<
  | {
      result: MultiSeedGraphResult;
      cache: MultiSeedCitationGraphCacheSummary;
    }
  | null
> {
  const sort = options.sort ?? DEFAULT_CITATION_GRAPH_SORT;
  const maxReferences =
    typeof options.maxReferences === "number" && options.maxReferences > 0
      ? Math.floor(options.maxReferences)
      : CITATION_GRAPH_MAX_REFERENCES;
  const maxCitedBy =
    typeof options.maxCitedBy === "number" && options.maxCitedBy > 0
      ? Math.floor(options.maxCitedBy)
      : CITATION_GRAPH_MAX_CITED_BY;

  const seeds = Array.from(
    new Set(seedRecids.map((s) => String(s).trim()).filter(Boolean)),
  );
  if (!seeds.length) {
    return null;
  }
  const seedRecidSet = new Set(seeds);

  const cachedResults = await Promise.all(
    seeds.map(async (recid) => {
      const cached = await getCachedCitationGraphOneHop(recid, {
        sort,
        maxReferences,
        maxCitedBy,
        includeReviews: options.includeReviews,
      }).catch(() => null);
      return { recid, cached };
    }),
  );

  const missingSeeds: string[] = [];
  const partialSeeds: string[] = [];

  const perSeedResults = cachedResults.map(({ recid, cached }) => {
    if (!cached) {
      missingSeeds.push(recid);
      return buildPlaceholderOneHop(recid, sort);
    }
    const refsPartial =
      cached.references.length < maxReferences &&
      (cached.totals.references ?? 0) > cached.references.length;
    const citedPartial =
      cached.citedBy.length < maxCitedBy &&
      (cached.totals.citedBy ?? 0) > cached.citedBy.length;
    if (refsPartial || citedPartial) {
      partialSeeds.push(recid);
    }
    return cached;
  });

  const usedCount = perSeedResults.filter(
    (r) => r.references.length > 0 || r.citedBy.length > 0,
  ).length;
  if (usedCount === 0) {
    return null;
  }

  // Seed-to-seed edges: use full reference recid sets from cached one-hop results when available.
  const refsAllBySeed = new Map<string, Set<string>>();
  for (const r of perSeedResults) {
    const recids = Array.isArray(r.referencesAllRecids)
      ? r.referencesAllRecids
      : [];
    refsAllBySeed.set(r.center.recid, new Set(recids));
  }
  const seedEdges: SeedEdge[] = [];
  const seedNodes = perSeedResults.map((r) => r.center);
  for (const source of seedNodes) {
    const refs = refsAllBySeed.get(source.recid);
    if (!refs) continue;
    for (const target of seedNodes) {
      if (target.recid === source.recid) continue;
      if (refs.has(target.recid)) {
        seedEdges.push({ source: source.recid, target: target.recid, type: "seed-to-seed" });
      }
    }
  }

  // Merge/dedupe references/cited-by.
  const referencesByRecid = new Map<string, InspireReferenceEntry>();
  const citedByByRecid = new Map<string, InspireReferenceEntry>();
  const bySeed: NonNullable<MultiSeedGraphResult["bySeed"]> = {};

  for (const r of perSeedResults) {
    const seedRecid = r.center.recid;
    const refsShown = r.references
      .map((e) => e.recid)
      .filter(
        (v): v is string =>
          typeof v === "string" && v.trim().length > 0 && !seedRecidSet.has(v),
      );
    const citedShown = r.citedBy
      .map((e) => e.recid)
      .filter(
        (v): v is string =>
          typeof v === "string" && v.trim().length > 0 && !seedRecidSet.has(v),
      );

    bySeed[seedRecid] = {
      references: refsShown,
      citedBy: citedShown,
      totals: r.totals,
      shown: r.shown,
    };

    for (const entry of r.references) {
      const recid = entry.recid;
      if (!recid || seedRecidSet.has(recid)) continue;
      const existing = referencesByRecid.get(recid);
      if (!existing) {
        referencesByRecid.set(recid, entry);
        continue;
      }
      const better =
        getCitationValue(entry) > getCitationValue(existing) ? entry : existing;
      if (better === existing && typeof entry.localItemID === "number") {
        existing.localItemID = entry.localItemID;
      }
      referencesByRecid.set(recid, better);
    }

    for (const entry of r.citedBy) {
      const recid = entry.recid;
      if (!recid || seedRecidSet.has(recid)) continue;
      const existing = citedByByRecid.get(recid);
      if (!existing) {
        citedByByRecid.set(recid, entry);
        continue;
      }
      const better =
        getCitationValue(entry) > getCitationValue(existing) ? entry : existing;
      if (better === existing && typeof entry.localItemID === "number") {
        existing.localItemID = entry.localItemID;
      }
      citedByByRecid.set(recid, better);
    }
  }

  const references = Array.from(referencesByRecid.values());
  const citedBy = Array.from(citedByByRecid.values());

  const referenceConnCounts = new Map<string, number>();
  const citedByConnCounts = new Map<string, number>();
  for (const r of perSeedResults) {
    const unique = new Set<string>();
    const pool = Array.isArray(r.referencesFilteredRecids)
      ? r.referencesFilteredRecids
      : r.referencesAllRecids ?? [];
    for (const recid of pool) {
      const normalized = String(recid || "").trim();
      if (!normalized || seedRecidSet.has(normalized) || unique.has(normalized)) {
        continue;
      }
      unique.add(normalized);
    }
    for (const recid of unique) {
      referenceConnCounts.set(recid, (referenceConnCounts.get(recid) ?? 0) + 1);
    }
  }
  for (const detail of Object.values(bySeed)) {
    for (const recid of detail.citedBy) {
      citedByConnCounts.set(recid, (citedByConnCounts.get(recid) ?? 0) + 1);
    }
  }

  sortEntries(references, sort, { connectionCounts: referenceConnCounts });
  sortEntries(citedBy, sort, { connectionCounts: citedByConnCounts });

  const referencesShown = references.slice(0, Math.max(0, maxReferences));
  const citedByShown = citedBy.slice(0, Math.max(0, maxCitedBy));
  const shownReferenceRecids = new Set(
    referencesShown
      .map((e) => e.recid)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0),
  );
  const shownCitedByRecids = new Set(
    citedByShown
      .map((e) => e.recid)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0),
  );
  for (const detail of Object.values(bySeed)) {
    detail.references = detail.references.filter((r) => shownReferenceRecids.has(r));
    detail.citedBy = detail.citedBy.filter((r) => shownCitedByRecids.has(r));
    detail.shown = {
      references: detail.references.length,
      citedBy: detail.citedBy.length,
    };
  }

  const referencesUnion = new Set<string>();
  for (const r of perSeedResults) {
    const pool = Array.isArray(r.referencesFilteredRecids)
      ? r.referencesFilteredRecids
      : r.referencesAllRecids ?? [];
    for (const recid of pool) {
      if (!seedRecidSet.has(recid)) {
        referencesUnion.add(recid);
      }
    }
  }

  const citedByTotalRaw = perSeedResults.reduce(
    (sum, r) => sum + (r.totals.citedBy || 0),
    0,
  );
  const citedBySeeds = new Set(seedEdges.map((e) => e.source));
  const citedByTotal = Math.max(0, citedByTotalRaw - citedBySeeds.size);

  return {
    result: {
      seeds: seedNodes,
      seedEdges,
      references: referencesShown,
      citedBy: citedByShown,
      totals: { references: referencesUnion.size, citedBy: citedByTotal },
      shown: { references: referencesShown.length, citedBy: citedByShown.length },
      sort,
      bySeed,
    },
    cache: {
      missingSeeds,
      partialSeeds,
      requested: { maxReferences, maxCitedBy },
    },
  };
}

async function fetchCitedByTotalUnion(
  seeds: string[],
  options: { signal?: AbortSignal },
): Promise<number | null> {
  const { signal } = options;
  const uniqueSeeds = Array.from(new Set(seeds));
  if (!uniqueSeeds.length) return 0;

  const query = uniqueSeeds.map((r) => `refersto:recid:${r}`).join(" OR ");
  const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=1&page=1${buildFieldsParam("control_number")}`;
  const response = await inspireFetch(url, signal ? { signal } : undefined).catch(
    () => null,
  );
  if (!response || !response.ok) {
    return null;
  }
  const payload = (await response.json()) as unknown;
  if (!isInspireLiteratureSearchResponse(payload)) {
    return null;
  }
  const total = typeof payload.hits?.total === "number" ? payload.hits.total : 0;
  return total;
}

export async function fetchMultiSeedCitationGraph(
  seedRecids: string[],
  options: FetchCitationGraphOptions = {},
): Promise<MultiSeedGraphResult> {
  const sort = options.sort ?? DEFAULT_CITATION_GRAPH_SORT;
  const maxReferences =
    typeof options.maxReferences === "number" && options.maxReferences > 0
      ? Math.floor(options.maxReferences)
      : CITATION_GRAPH_MAX_REFERENCES;
  const maxCitedBy =
    typeof options.maxCitedBy === "number" && options.maxCitedBy > 0
      ? Math.floor(options.maxCitedBy)
      : CITATION_GRAPH_MAX_CITED_BY;

  const seeds = Array.from(
    new Set(seedRecids.map((s) => String(s).trim()).filter(Boolean)),
  );
  if (!seeds.length) {
    throw new Error("No seed papers provided");
  }
  const seedRecidSet = new Set(seeds);

  // Fetch each seed graph in parallel (inspireFetch is rate-limited).
  const perSeedResults = await Promise.all(
    seeds.map((recid) =>
      fetchCitationGraphOneHop(recid, {
        signal: options.signal,
        sort,
        maxReferences,
        maxCitedBy,
        forceRefresh: options.forceRefresh,
        includeReviews: options.includeReviews,
      }),
    ),
  );

  const seedNodes = perSeedResults.map((r) => r.center);

  // Seed-to-seed edges: use full reference recid sets from one-hop results.
  const refsAllBySeed = new Map<string, Set<string>>();
  for (const r of perSeedResults) {
    const recids = Array.isArray(r.referencesAllRecids)
      ? r.referencesAllRecids
      : [];
    refsAllBySeed.set(r.center.recid, new Set(recids));
  }
  const seedEdges: SeedEdge[] = [];
  for (const source of seedNodes) {
    const refs = refsAllBySeed.get(source.recid);
    if (!refs) continue;
    for (const target of seedNodes) {
      if (target.recid === source.recid) continue;
      if (refs.has(target.recid)) {
        seedEdges.push({ source: source.recid, target: target.recid, type: "seed-to-seed" });
      }
    }
  }

  // Merge/dedupe references/cited-by (per-seed lists already limited).
  const referencesByRecid = new Map<string, InspireReferenceEntry>();
  const citedByByRecid = new Map<string, InspireReferenceEntry>();

  const bySeed: NonNullable<MultiSeedGraphResult["bySeed"]> = {};

  for (const r of perSeedResults) {
    const seedRecid = r.center.recid;
    const refsShown = r.references
      .map((e) => e.recid)
      .filter(
        (v): v is string =>
          typeof v === "string" && v.trim().length > 0 && !seedRecidSet.has(v),
      );
    const citedShown = r.citedBy
      .map((e) => e.recid)
      .filter(
        (v): v is string =>
          typeof v === "string" && v.trim().length > 0 && !seedRecidSet.has(v),
      );

    bySeed[seedRecid] = {
      references: refsShown,
      citedBy: citedShown,
      totals: r.totals,
      shown: r.shown,
    };

    for (const entry of r.references) {
      const recid = entry.recid;
      if (!recid || seedRecidSet.has(recid)) continue;
      const existing = referencesByRecid.get(recid);
      if (!existing) {
        referencesByRecid.set(recid, entry);
        continue;
      }
      // Prefer entry with higher citation count; preserve localItemID if present.
      const better =
        getCitationValue(entry) > getCitationValue(existing) ? entry : existing;
      if (better === existing && typeof entry.localItemID === "number") {
        existing.localItemID = entry.localItemID;
      }
      referencesByRecid.set(recid, better);
    }

    for (const entry of r.citedBy) {
      const recid = entry.recid;
      if (!recid || seedRecidSet.has(recid)) continue;
      const existing = citedByByRecid.get(recid);
      if (!existing) {
        citedByByRecid.set(recid, entry);
        continue;
      }
      const better =
        getCitationValue(entry) > getCitationValue(existing) ? entry : existing;
      if (better === existing && typeof entry.localItemID === "number") {
        existing.localItemID = entry.localItemID;
      }
      citedByByRecid.set(recid, better);
    }
  }

  const references = Array.from(referencesByRecid.values());
  const citedBy = Array.from(citedByByRecid.values());

  const referenceConnCounts = new Map<string, number>();
  const citedByConnCounts = new Map<string, number>();
  // References: count connections using full reference recid sets (not limited by per-seed max),
  // so multi-seed "relevance" can prioritize papers referenced by multiple seeds.
  for (const r of perSeedResults) {
    const unique = new Set<string>();
    const pool = Array.isArray(r.referencesFilteredRecids)
      ? r.referencesFilteredRecids
      : r.referencesAllRecids ?? [];
    for (const recid of pool) {
      const normalized = String(recid || "").trim();
      if (!normalized || seedRecidSet.has(normalized) || unique.has(normalized)) {
        continue;
      }
      unique.add(normalized);
    }
    for (const recid of unique) {
      referenceConnCounts.set(recid, (referenceConnCounts.get(recid) ?? 0) + 1);
    }
  }

  // Cited-by: we only have per-seed limited lists, so connection counts are best-effort.
  for (const detail of Object.values(bySeed)) {
    for (const recid of detail.citedBy) {
      citedByConnCounts.set(recid, (citedByConnCounts.get(recid) ?? 0) + 1);
    }
  }

  sortEntries(references, sort, { connectionCounts: referenceConnCounts });
  sortEntries(citedBy, sort, { connectionCounts: citedByConnCounts });

  // Apply global "max per side" to the merged/deduped lists.
  const referencesShown = references.slice(0, Math.max(0, maxReferences));
  const citedByShown = citedBy.slice(0, Math.max(0, maxCitedBy));
  const shownReferenceRecids = new Set(
    referencesShown
      .map((e) => e.recid)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0),
  );
  const shownCitedByRecids = new Set(
    citedByShown
      .map((e) => e.recid)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0),
  );
  for (const detail of Object.values(bySeed)) {
    detail.references = detail.references.filter((r) => shownReferenceRecids.has(r));
    detail.citedBy = detail.citedBy.filter((r) => shownCitedByRecids.has(r));
    detail.shown = {
      references: detail.references.length,
      citedBy: detail.citedBy.length,
    };
  }

  // Totals (deduped across seeds where possible).
  const referencesUnion = new Set<string>();
  for (const r of perSeedResults) {
    const pool = Array.isArray(r.referencesFilteredRecids)
      ? r.referencesFilteredRecids
      : r.referencesAllRecids ?? [];
    for (const recid of pool) {
      if (!seedRecidSet.has(recid)) {
        referencesUnion.add(recid);
      }
    }
  }

  const citedByTotalRaw =
    (await fetchCitedByTotalUnion(seeds, { signal: options.signal })) ??
    perSeedResults.reduce((sum, r) => sum + (r.totals.citedBy || 0), 0);
  // Exclude seed papers from the union cited-by count when possible.
  const citedBySeeds = new Set(seedEdges.map((e) => e.source));
  const citedByTotal = Math.max(0, citedByTotalRaw - citedBySeeds.size);

  return {
    seeds: seedNodes,
    seedEdges,
    references: referencesShown,
    citedBy: citedByShown,
    totals: { references: referencesUnion.size, citedBy: citedByTotal },
    shown: { references: referencesShown.length, citedBy: citedByShown.length },
    sort,
    bySeed,
  };
}
