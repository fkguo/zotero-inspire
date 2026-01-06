import { config } from "../../../package.json";
import { cleanMathTitle } from "../../utils/mathTitle";
import { getEnrichmentSettings } from "./enrichConfig";
import { getCachedStrings, formatAuthors } from "./formatters";
import {
  buildDisplayText,
  buildPublicationSummary,
  splitPublicationInfo,
} from "./formatters";
import { extractAuthorNamesFromReference, extractAuthorSearchInfos } from "./authorUtils";
import {
  buildReferenceUrl,
  buildFallbackUrl,
  extractRecidFromRecordRef,
  extractRecidFromUrls,
  extractArxivFromReference,
  extractArxivFromMetadata,
} from "./apiUtils";
import {
  INSPIRE_API_BASE,
  AUTHOR_IDS_EXTRACT_LIMIT,
  API_FIELDS_ENRICHMENT,
  buildFieldsParam,
} from "./constants";
import type { InspireReferenceEntry } from "./types";
import type {
  InspireLiteratureSearchResponse,
  InspireReference,
} from "./apiTypes";
import { inspireFetch } from "./rateLimiter";
import { LRUCache } from "./utils";

// ─────────────────────────────────────────────────────────────────────────────
// PERF-FIX-9: Memory cache for enrichment metadata (recid → metadata)
// Prevents redundant API calls when viewing the same references multiple times
// ─────────────────────────────────────────────────────────────────────────────
const enrichmentMetadataCache = new LRUCache<string, any>(500);

function normalizeTitleToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function isPlaceholderEntryTitle(
  entry: Pick<InspireReferenceEntry, "title" | "authorText" | "year" | "summary">,
  strings: ReturnType<typeof getCachedStrings>,
): boolean {
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  if (!title || title === strings.noTitle) return true;

  const year = typeof entry.year === "string" ? entry.year.trim() : "";
  const authorText =
    typeof entry.authorText === "string" ? entry.authorText.trim() : "";
  if (authorText && year && year !== strings.yearUnknown) {
    const fallback = `${authorText} (${year})`;
    if (title === fallback) return true;
  }

  const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
  if (summary) {
    const nTitle = normalizeTitleToken(title);
    const nSummary = normalizeTitleToken(summary);
    if (nTitle && nSummary.includes(nTitle)) {
      // Heuristic: INSPIRE references API sometimes provides journal/volume/page in `reference.title`.
      // If the title is short and looks like publication info, treat it as a placeholder and prefer metadata.titles.
      if (/\d/.test(title) && title.length <= 80) {
        return true;
      }
    }
  }

  return false;
}

/**
 * PERF-FIX-9: Check if cached metadata is complete enough to skip fetching.
 * Returns true if metadata has title, authors, and citation count.
 */
function isMetadataComplete(metadata: any): boolean {
  if (!metadata) return false;
  // Must have title
  const hasTitle =
    Array.isArray(metadata.titles) &&
    metadata.titles.some(
      (t: any) => typeof t?.title === "string" && t.title.trim(),
    );
  // Must have authors or collaborations
  const hasAuthors =
    (Array.isArray(metadata.authors) && metadata.authors.length > 0) ||
    (Array.isArray(metadata.collaborations) &&
      metadata.collaborations.length > 0);
  // Must have citation count
  const hasCitationCount = typeof metadata.citation_count === "number";
  return hasTitle && hasAuthors && hasCitationCount;
}

interface FetchReferencesOptions {
  signal?: AbortSignal;
  onProgress?: (entries: InspireReferenceEntry[], total: number) => void;
}

/**
 * Fetch references for a given recid and return InspireReferenceEntry array.
 * Shared by UI controller and background cache download.
 */
export async function fetchReferencesEntries(
  recid: string,
  options: FetchReferencesOptions = {},
): Promise<InspireReferenceEntry[]> {
  const { signal, onProgress } = options;
  const strings = getCachedStrings();
  const response = await inspireFetch(
    `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}?fields=metadata.references`,
    signal ? { signal } : undefined,
  ).catch(() => null);
  if (!response || response.status === 404) {
    throw new Error("Reference list not found");
  }
  const payload = (await response.json()) as {
    metadata?: { references?: InspireReference[] };
  };
  const references = payload.metadata?.references ?? [];
  const totalCount = references.length;

  const entries: InspireReferenceEntry[] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < totalCount; i++) {
    if (signal?.aborted) break;
    entries.push(buildReferenceEntry(references[i], i, strings));

    if (
      onProgress &&
      (entries.length % BATCH_SIZE === 0 || i === totalCount - 1)
    ) {
      onProgress(entries, totalCount);
    }
  }

  return entries;
}

/**
 * Transform INSPIRE reference payload into InspireReferenceEntry structure.
 */
export function buildReferenceEntry(
  referenceWrapper: any,
  index: number,
  strings = getCachedStrings(),
): InspireReferenceEntry {
  const reference = referenceWrapper?.reference ?? {};
  const recid =
    extractRecidFromRecordRef(referenceWrapper?.record?.["$ref"]) ||
    extractRecidFromUrls(reference?.urls);

  const { names: authors, total: totalAuthors } =
    extractAuthorNamesFromReference(reference, AUTHOR_IDS_EXTRACT_LIMIT);
  const arxivDetails = extractArxivFromReference(reference);
  const resolvedYear =
    reference?.publication_info?.year?.toString() ??
    (reference?.publication_info?.date
      ? `${reference.publication_info.date}`.slice(0, 4)
      : undefined);
  const { primary: publicationInfo, errata } = splitPublicationInfo(
    reference?.publication_info,
  );
  const summary = buildPublicationSummary(
    publicationInfo,
    arxivDetails,
    resolvedYear,
    errata,
  );
  // Extract primary DOI from reference data
  const doi =
    Array.isArray(reference?.dois) && reference.dois.length
      ? reference.dois[0]
      : undefined;
  const texkey =
    Array.isArray(reference?.texkeys) && reference.texkeys.length
      ? reference.texkeys[0]
      : undefined;

  const rawTitle =
    typeof reference?.title === "string"
      ? reference.title
      : typeof reference?.title?.title === "string"
        ? reference.title.title
        : Array.isArray(reference?.titles) &&
            typeof reference.titles[0]?.title === "string"
          ? reference.titles[0].title
          : undefined;
  const cleanedTitle = cleanMathTitle(rawTitle);

  const entry: InspireReferenceEntry = {
    id: `${index}-${recid ?? reference?.label ?? Date.now()}`,
    label: reference?.label,
    recid: recid ?? undefined,
    inspireUrl: buildReferenceUrl(reference, recid),
    fallbackUrl: buildFallbackUrl(reference, arxivDetails),
    title: cleanedTitle || strings.noTitle,
    titleOriginal: cleanedTitle,
    summary,
    year: resolvedYear ?? strings.yearUnknown,
    authors,
    totalAuthors,
    authorText: formatAuthors(authors, totalAuthors),
    displayText: "",
    searchText: "",
    citationCount:
      typeof reference?.citation_count === "number"
        ? reference.citation_count
        : undefined,
    citationCountWithoutSelf:
      typeof reference?.citation_count_without_self_citations === "number"
        ? reference.citation_count_without_self_citations
        : undefined,
    publicationInfo,
    publicationInfoErrata: errata,
    arxivDetails,
    doi,
    texkey,
  };

  entry.displayText = buildDisplayText(entry);
  return entry;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment - Fetch missing metadata for entries with recid
// ─────────────────────────────────────────────────────────────────────────────

interface EnrichReferencesOptions {
  signal?: AbortSignal;
  onBatchComplete?: (processedRecids: string[]) => void;
}

/**
 * Enrich reference entries by fetching missing metadata from INSPIRE.
 * This function is shared by:
 * - References panel controller (live refresh with UI updates)
 * - Background cache download (prefetchReferencesCache) for complete cache
 *
 * Only entries with recid are enriched (others don't exist in INSPIRE).
 * Fetches: title, authors, citation count, publication info, arXiv details.
 *
 * @param entries - Array of InspireReferenceEntry to enrich (modified in place)
 * @param options - Optional signal for cancellation and progress callback
 */
export async function enrichReferencesEntries(
  entries: InspireReferenceEntry[],
  options: EnrichReferencesOptions = {},
): Promise<void> {
  const { signal, onBatchComplete } = options;
  const strings = getCachedStrings();

  // PERF-FIX-9: Check memory cache before adding to fetch list
  // This prevents redundant API calls for already-cached metadata
  const needsDetails: InspireReferenceEntry[] = [];
  // FIX-ENRICH-CACHE: Track entries that were enriched from cache
  // These need onBatchComplete notification for UI update
  const cacheAppliedRecids: string[] = [];

  for (const entry of entries) {
    if (!entry.recid) continue;

    // Check if entry already has all required data
    // FTR-AUTHOR-PROFILE-FIX: Also require authorSearchInfos for author profile lookup
    const hasAllData =
      typeof entry.citationCount === "number" &&
      entry.title &&
      entry.title !== strings.noTitle &&
      !isPlaceholderEntryTitle(entry, strings) &&
      entry.authors.length > 0 &&
      !(entry.authors.length === 1 && entry.authors[0] === strings.unknownAuthor) &&
      Array.isArray(entry.authorSearchInfos) && entry.authorSearchInfos.length > 0;

    if (hasAllData) continue;

    // PERF-FIX-9: Check memory cache for this recid
    const cachedMetadata = enrichmentMetadataCache.get(entry.recid);
    if (cachedMetadata && isMetadataComplete(cachedMetadata)) {
      // Apply cached data directly without network request
      applyMetadataToEntry(entry, cachedMetadata, strings);
      // FIX-ENRICH-CACHE: Track for UI callback notification
      cacheAppliedRecids.push(entry.recid);
      continue;
    }

    // Need to fetch from network
    needsDetails.push(entry);
  }

  // FIX-ENRICH-CACHE: Notify UI for entries enriched from cache
  // This ensures UI updates even when no network requests are made
  if (cacheAppliedRecids.length && onBatchComplete) {
    onBatchComplete(cacheAppliedRecids);
  }

  if (!needsDetails.length || signal?.aborted) {
    return;
  }

  Zotero.debug(
    `[${config.addonName}] Enriching ${needsDetails.length} reference entries`,
  );

  const { batchSize, parallelBatches } = getEnrichmentSettings();

  // Group entries by recid (some might have the same recid)
  const recidToEntry = new Map<string, InspireReferenceEntry[]>();
  for (const entry of needsDetails) {
    const existing = recidToEntry.get(entry.recid!) || [];
    existing.push(entry);
    recidToEntry.set(entry.recid!, existing);
  }

  const uniqueRecids = Array.from(recidToEntry.keys());

  // Split into batches
  const batches: string[][] = [];
  for (let i = 0; i < uniqueRecids.length; i += batchSize) {
    batches.push(uniqueRecids.slice(i, i + batchSize));
  }

  // Process batches in parallel groups
  for (let i = 0; i < batches.length; i += parallelBatches) {
    if (signal?.aborted) return;

    const parallelBatchGroup = batches.slice(i, i + parallelBatches);
    await Promise.all(
      parallelBatchGroup.map(async (batch) => {
        const processed = await fetchAndApplyBatchMetadata(
          batch,
          recidToEntry,
          strings,
          signal,
        );
        if (processed.length && onBatchComplete) {
          onBatchComplete(processed);
        }
      }),
    );
  }

  Zotero.debug(
    `[${config.addonName}] Enrichment completed for ${needsDetails.length} entries`,
  );
}

/**
 * Fetch metadata for a batch of recids and apply to entries.
 */
async function fetchAndApplyBatchMetadata(
  batchRecids: string[],
  recidToEntry: Map<string, InspireReferenceEntry[]>,
  strings: ReturnType<typeof getCachedStrings>,
  signal?: AbortSignal,
): Promise<string[]> {
  if (signal?.aborted || !batchRecids.length) return [];

  const query = batchRecids.map((r) => `recid:${r}`).join(" OR ");
  // FTR-API-FIELD-OPTIMIZATION: Use centralized field configuration
  const fieldsParam = buildFieldsParam(API_FIELDS_ENRICHMENT);
  const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${batchRecids.length}${fieldsParam}`;

  try {
    const response = await inspireFetch(
      url,
      signal ? { signal } : undefined,
    ).catch(() => null);
    if (!response) {
      Zotero.debug(
        `[${config.addonName}] enrich batch failed: no response (recids=${batchRecids.slice(0, 5).join(",")}${batchRecids.length > 5 ? "..." : ""})`,
      );
      return [];
    }
    if (response.status !== 200) {
      Zotero.debug(
        `[${config.addonName}] enrich batch HTTP ${response.status} (recids=${batchRecids.slice(0, 5).join(",")}${batchRecids.length > 5 ? "..." : ""})`,
      );
      return [];
    }

    const payload = (await response.json()) as unknown as
      | InspireLiteratureSearchResponse
      | null;
    const hits = payload?.hits?.hits ?? [];
    const processedRecids: string[] = [];

    // Map results back to entries
    for (const hit of hits) {
      const recid = String(hit?.metadata?.control_number || hit?.id);
      const metadata = hit?.metadata ?? {};

      if (!recid) continue;

      // PERF-FIX-9: Cache metadata for future lookups
      if (isMetadataComplete(metadata)) {
        enrichmentMetadataCache.set(recid, metadata);
      }

      const matchingEntries = recidToEntry.get(recid);
      if (!matchingEntries) continue;

      for (const entry of matchingEntries) {
        applyMetadataToEntry(entry, metadata, strings);
      }
      processedRecids.push(recid);
    }
    return processedRecids;
  } catch (err) {
    if ((err as any)?.name !== "AbortError") {
      Zotero.debug(
        `[${config.addonName}] Error fetching batch metadata: ${err}`,
      );
    }
  }
  return [];
}

/**
 * Apply INSPIRE metadata to a reference entry.
 * Updates title, authors, citation count, year, arXiv, and publication info.
 */
function applyMetadataToEntry(
  entry: InspireReferenceEntry,
  metadata: any,
  strings: ReturnType<typeof getCachedStrings>,
): void {
  if (!metadata) return;

  // Citation count update
  if (typeof metadata.citation_count === "number") {
    entry.citationCount = metadata.citation_count;
  }
  if (typeof metadata.citation_count_without_self_citations === "number") {
    entry.citationCountWithoutSelf =
      metadata.citation_count_without_self_citations;
  }
  if (Array.isArray(metadata.document_type) && metadata.document_type.length) {
    entry.documentType = metadata.document_type.filter(
      (t: unknown): t is string =>
        typeof t === "string" && t.trim().length > 0,
    );
  }

  // Title update
  // FIX: Also update title if current title appears truncated (ends with space or is very short)
  // INSPIRE's references API truncates titles at LaTeX $ characters
  // Detect truncation by checking:
  // - Title ends with space (common truncation artifact)
  // - Title ends with dash/hyphen (e.g., "high-" before "$p_T$")
  // - Title is very short (< 20 chars)
  const currentTitleTruncated = entry.title &&
    entry.title !== strings.noTitle &&
    (entry.title.endsWith(" ") ||
     entry.title.endsWith("-") ||
     entry.title.endsWith("—") ||
     entry.title.length < 20);
  const shouldUpdateTitle =
    !entry.title ||
    entry.title === strings.noTitle ||
    currentTitleTruncated ||
    isPlaceholderEntryTitle(entry, strings);

  if (shouldUpdateTitle && Array.isArray(metadata.titles)) {
    const titleObj = metadata.titles.find(
      (item: any) => typeof item?.title === "string" && item.title.trim(),
    );
    if (titleObj?.title) {
      const newTitle = cleanMathTitle(titleObj.title);
      entry.title = newTitle;
      entry.titleOriginal = newTitle;
    }
  }

  // Authors update
  const hasUnknownAuthor =
    entry.authors.length === 0 ||
    (entry.authors.length === 1 && entry.authors[0] === strings.unknownAuthor);
  if (hasUnknownAuthor && Array.isArray(metadata.authors)) {
    const authors = metadata.authors
      .map((author: any) => author?.full_name || author?.name || "")
      .filter(Boolean);
    if (authors.length) {
      entry.totalAuthors =
        typeof metadata.author_count === "number"
          ? metadata.author_count
          : authors.length;
      entry.authors = authors.slice(0, AUTHOR_IDS_EXTRACT_LIMIT);
      entry.authorText = formatAuthors(entry.authors, entry.totalAuthors);
    }
  } else if (
    // Fix for large collaborations: INSPIRE API truncates authors in references
    // field, causing totalAuthors to be incorrect. Update when metadata has
    // higher author_count than current totalAuthors (e.g., 67 vs 1).
    typeof metadata.author_count === "number" &&
    metadata.author_count > (entry.totalAuthors ?? 0)
  ) {
    entry.totalAuthors = metadata.author_count;
    entry.authorText = formatAuthors(entry.authors, entry.totalAuthors);
  }

  // Extract authorSearchInfos for author profile lookup (FTR-AUTHOR-PROFILE)
  // This allows References tab authors to have recid/BAI for precise profile queries
  // FTR-AUTHOR-PROFILE-FIX-2: ALWAYS rebuild entry.authors from metadata.authors to ensure
  // index alignment with authorSearchInfos. This is critical because:
  // - Reference data may have different author ordering/naming than literature metadata
  // - extractAuthorNamesFromReference skips authors without names (no placeholders)
  // - extractAuthorSearchInfos pushes placeholders to maintain alignment
  // By rebuilding both from the same source (metadata.authors), we guarantee alignment.
  if (
    !entry.authorSearchInfos &&
    Array.isArray(metadata.authors) &&
    metadata.authors.length > 0
  ) {
    const searchInfos = extractAuthorSearchInfos(
      metadata.authors,
      AUTHOR_IDS_EXTRACT_LIMIT,
    );
    if (searchInfos?.length) {
      entry.authorSearchInfos = searchInfos;
      // FTR-AUTHOR-PROFILE-FIX-2: Rebuild entry.authors from same source to ensure alignment
      // Extract author names from the same metadata.authors array used for searchInfos
      const alignedAuthors: string[] = [];
      const limit = Math.min(metadata.authors.length, AUTHOR_IDS_EXTRACT_LIMIT);
      for (let i = 0; i < limit; i++) {
        const author = metadata.authors[i];
        const name = author?.full_name || author?.full_name_unicode_normalized || "";
        alignedAuthors.push(name); // Push even if empty to maintain alignment
      }
      // Only update if we got meaningful names (not all empty)
      const hasRealNames = alignedAuthors.some((n) => n.trim());
      if (hasRealNames) {
        entry.authors = alignedAuthors;
        entry.totalAuthors =
          typeof metadata.author_count === "number"
            ? metadata.author_count
            : metadata.authors.length;
        entry.authorText = formatAuthors(entry.authors, entry.totalAuthors);
      }
    }
  }

  // Year update
  if (
    (!entry.year || entry.year === strings.yearUnknown) &&
    metadata.earliest_date
  ) {
    entry.year = `${metadata.earliest_date}`.slice(0, 4);
  }
  if (!entry.earliestDate && typeof metadata.earliest_date === "string") {
    entry.earliestDate = metadata.earliest_date;
  }

  // Extract arXiv details from metadata if not already present
  if (!entry.arxivDetails && metadata.arxiv_eprints) {
    const arxiv = extractArxivFromMetadata(metadata);
    if (arxiv) {
      entry.arxivDetails = arxiv;
    }
  }

  // Extract DOI from metadata if not already present
  if (!entry.doi && Array.isArray(metadata.dois) && metadata.dois.length) {
    const doiObj = metadata.dois[0];
    entry.doi = typeof doiObj === "string" ? doiObj : doiObj?.value;
  }

  // Extract texkey from metadata if not already present
  if (!entry.texkey && Array.isArray(metadata.texkeys) && metadata.texkeys.length) {
    entry.texkey = metadata.texkeys[0];
  }

  // Publication summary update
  const { primary: publicationInfo, errata } = splitPublicationInfo(
    metadata.publication_info,
  );
  if (publicationInfo || entry.arxivDetails || errata?.length) {
    entry.publicationInfo = publicationInfo ?? entry.publicationInfo;
    entry.publicationInfoErrata = errata;
    const fallbackYear =
      entry.year && entry.year !== strings.yearUnknown ? entry.year : undefined;
    entry.summary = buildPublicationSummary(
      entry.publicationInfo,
      entry.arxivDetails,
      fallbackYear,
      entry.publicationInfoErrata,
    );
  }

  // Update derived text fields
  entry.displayText = buildDisplayText(entry);
  // Invalidate searchText so it will be recalculated on next filter
  entry.searchText = "";
}
