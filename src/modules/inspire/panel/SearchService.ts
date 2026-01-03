// ─────────────────────────────────────────────────────────────────────────────
// SearchService - INSPIRE Search API logic for References Panel
// Extracted from InspireReferencePanelController (Phase 0.2 of zinspire.ts refactor)
//
// Responsibilities:
// - Fetch search results from INSPIRE API with pagination
// - Build entry objects from search hit results
// - Progress reporting during multi-page fetches
//
// NOT responsible for:
// - Cache management (searchCache owned by controller)
// - UI updates (rendering, status messages)
// - State management (currentSearchQuery, allEntries)
// - Abort controller management
// ─────────────────────────────────────────────────────────────────────────────

import { cleanMathTitle } from "../../../utils/mathTitle";
import {
  INSPIRE_API_BASE,
  INSPIRE_LITERATURE_URL,
  CITED_BY_PAGE_SIZE,
  CITED_BY_MAX_RESULTS,
  CITED_BY_PARALLEL_BATCH_SIZE,
  API_FIELDS_LIST_DISPLAY,
  type InspireReferenceEntry,
  type InspireSortOption,
  type InspireLiteratureSearchResponse,
  inspireFetch,
  buildFieldsParam,
  getCachedStrings,
  formatAuthors,
  extractAuthorNamesLimited,
  extractAuthorSearchInfos,
  splitPublicationInfo,
  buildPublicationSummary,
  buildFallbackUrlFromMetadata,
  extractArxivFromMetadata,
  buildDisplayText,
} from "../index";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Progress callback for search fetching.
 * Called after each page/batch is processed.
 */
export type SearchProgressCallback = (
  entries: InspireReferenceEntry[],
  total: number | null,
) => void;

/**
 * Options for search fetching.
 */
export interface SearchFetchOptions {
  /** Search query string */
  query: string;
  /** Sort option */
  sort: InspireSortOption;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Progress callback */
  onProgress?: SearchProgressCallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Search Service Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch search results from INSPIRE API with pagination support.
 *
 * Features:
 * - Fetches first page to get total count
 * - Fetches remaining pages in parallel batches
 * - Reports progress after each batch
 * - Respects abort signal for cancellation
 *
 * @param options - Search options
 * @returns Array of reference entries
 */
export async function fetchInspireSearch(
  options: SearchFetchOptions,
): Promise<InspireReferenceEntry[]> {
  const { query, sort, signal, onProgress } = options;
  const entries: InspireReferenceEntry[] = [];
  const encodedQuery = encodeURIComponent(query);
  const sortParam = `&sort=${sort}`;
  const fieldsParam = buildFieldsParam(API_FIELDS_LIST_DISPLAY);

  // Fetch first page to get total count
  const firstUrl = `${INSPIRE_API_BASE}/literature?q=${encodedQuery}&size=${CITED_BY_PAGE_SIZE}&page=1${sortParam}${fieldsParam}`;
  let fetchError: Error | undefined;
  const firstResponse = await inspireFetch(
    firstUrl,
    signal ? { signal } : undefined,
  ).catch((err) => {
    fetchError = err instanceof Error ? err : new Error(String(err));
    Zotero.debug(`[SearchService] First page fetch failed: ${err}`);
    return null;
  });

  if (!firstResponse) {
    // Preserve original error message for debugging
    throw fetchError || new Error("Search failed: no response");
  }
  if (!firstResponse.ok) {
    throw new Error(`Search failed: HTTP ${firstResponse.status}`);
  }

  const firstPayload: unknown = await firstResponse.json();
  const totalHits =
    (firstPayload as { hits?: { total?: number } })?.hits?.total ?? 0;
  const firstHits = Array.isArray(
    (firstPayload as { hits?: { hits?: unknown[] } })?.hits?.hits,
  )
    ? (firstPayload as { hits: { hits: unknown[] } }).hits.hits
    : [];

  if (totalHits === 0) {
    return [];
  }

  // Process first page
  const strings = getCachedStrings();
  for (let i = 0; i < firstHits.length; i++) {
    if (signal?.aborted) break;
    entries.push(buildEntryFromSearchHit(firstHits[i], i, strings));
  }

  // Report progress for first page
  if (onProgress) {
    onProgress(entries, totalHits);
  }

  // Calculate total pages
  const totalPages = Math.ceil(
    Math.min(totalHits, CITED_BY_MAX_RESULTS) / CITED_BY_PAGE_SIZE,
  );
  if (totalPages <= 1) {
    return entries;
  }

  // Fetch remaining pages in parallel batches
  for (
    let batchStart = 2;
    batchStart <= totalPages;
    batchStart += CITED_BY_PARALLEL_BATCH_SIZE
  ) {
    if (signal?.aborted) break;

    const batchPages: number[] = [];
    for (
      let p = batchStart;
      p < batchStart + CITED_BY_PARALLEL_BATCH_SIZE && p <= totalPages;
      p++
    ) {
      batchPages.push(p);
    }

    const batchResults = await Promise.all(
      batchPages.map(async (pageNum) => {
        const url = `${INSPIRE_API_BASE}/literature?q=${encodedQuery}&size=${CITED_BY_PAGE_SIZE}&page=${pageNum}${sortParam}${fieldsParam}`;
        const response = await inspireFetch(
          url,
          signal ? { signal } : undefined,
        ).catch(() => null);
        if (!response || !response.ok) return [];
        const payload = (await response.json()) as unknown as
          | InspireLiteratureSearchResponse
          | null;
        return Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
      }),
    );

    // Process batch results
    for (const pageHits of batchResults) {
      for (const hit of pageHits) {
        if (signal?.aborted) break;
        entries.push(buildEntryFromSearchHit(hit, entries.length, strings));
      }
    }

    // Report progress
    if (onProgress && !signal?.aborted) {
      onProgress(entries, totalHits);
    }
  }

  return entries;
}

/**
 * Build an entry from a search hit result.
 *
 * @param hit - Raw hit object from INSPIRE API
 * @param index - Index for generating unique ID
 * @param strings - Cached localized strings
 * @returns Reference entry object
 */
export function buildEntryFromSearchHit(
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
  const year = earliestDate
    ? earliestDate.slice(0, 4)
    : (publicationInfo?.year ?? "");

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
    id: `search-${index}-${recid || Date.now()}`,
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

  // Build displayText for proper filtering
  entry.displayText = buildDisplayText(entry);
  // Defer searchText calculation for better initial load performance
  entry.searchText = "";

  return entry;
}
