import { config } from "../../../package.json";
import { cleanMathTitle } from "../../utils/mathTitle";
import { getEnrichmentSettings } from "./enrichConfig";
import { getCachedStrings, formatAuthors } from "./formatters";
import {
  buildDisplayText,
  buildPublicationSummary,
  splitPublicationInfo,
} from "./formatters";
import {
  extractAuthorNamesFromReference,
} from "./authorUtils";
import {
  buildReferenceUrl,
  buildFallbackUrl,
  extractRecidFromRecordRef,
  extractRecidFromUrls,
  extractArxivFromReference,
  extractArxivFromMetadata,
} from "./apiUtils";
import { INSPIRE_API_BASE, AUTHOR_IDS_EXTRACT_LIMIT } from "./constants";
import type { InspireReferenceEntry } from "./types";
import { inspireFetch } from "./rateLimiter";

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
  const payload: any = await response.json();
  const references = payload?.metadata?.references ?? [];
  const totalCount = references.length;

  const entries: InspireReferenceEntry[] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < totalCount; i++) {
    if (signal?.aborted) break;
    entries.push(buildReferenceEntry(references[i], i, strings));

    if (onProgress && (entries.length % BATCH_SIZE === 0 || i === totalCount - 1)) {
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

  const { names: authors, total: totalAuthors } = extractAuthorNamesFromReference(
    reference,
    AUTHOR_IDS_EXTRACT_LIMIT,
  );
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
  const entry: InspireReferenceEntry = {
    id: `${index}-${recid ?? reference?.label ?? Date.now()}`,
    label: reference?.label,
    recid: recid ?? undefined,
    inspireUrl: buildReferenceUrl(reference, recid),
    fallbackUrl: buildFallbackUrl(reference, arxivDetails),
    title: cleanMathTitle(reference?.title?.title) || strings.noTitle,
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

  // Filter entries that have recid but are missing essential metadata
  const needsDetails = entries.filter(
    (entry) =>
      entry.recid &&
      (
        typeof entry.citationCount !== "number" ||
        !entry.title ||
        entry.title === strings.noTitle ||
        !entry.authors.length ||
        (entry.authors.length === 1 && entry.authors[0] === strings.unknownAuthor)
      ),
  );

  if (!needsDetails.length || signal?.aborted) {
    return;
  }

  Zotero.debug(
    `[${config.addonName}] Enriching ${needsDetails.length} reference entries`
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
      })
    );
  }

  Zotero.debug(
    `[${config.addonName}] Enrichment completed for ${needsDetails.length} entries`
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

  const query = batchRecids.map(r => `recid:${r}`).join(" OR ");
  const fieldsParam = "&fields=control_number,citation_count,citation_count_without_self_citations,titles.title,authors.full_name,author_count,publication_info,earliest_date,arxiv_eprints";
  const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${batchRecids.length}${fieldsParam}`;

  try {
    const response = await inspireFetch(url, signal ? { signal } : undefined).catch(() => null);
    if (!response) {
      Zotero.debug(`[${config.addonName}] enrich batch failed: no response (recids=${batchRecids.slice(0, 5).join(",")}${batchRecids.length > 5 ? "..." : ""})`);
      return [];
    }
    if (response.status !== 200) {
      Zotero.debug(
        `[${config.addonName}] enrich batch HTTP ${response.status} (recids=${batchRecids.slice(0, 5).join(",")}${batchRecids.length > 5 ? "..." : ""})`
      );
      return [];
    }

    const payload: any = await response.json();
    const hits = payload?.hits?.hits ?? [];
    const processedRecids: string[] = [];

    // Map results back to entries
    for (const hit of hits) {
      const recid = String(hit?.metadata?.control_number || hit?.id);
      const metadata = hit?.metadata ?? {};

      if (!recid) continue;

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
      Zotero.debug(`[${config.addonName}] Error fetching batch metadata: ${err}`);
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
    entry.citationCountWithoutSelf = metadata.citation_count_without_self_citations;
  }

  // Title update
  if (
    (!entry.title || entry.title === strings.noTitle) &&
    Array.isArray(metadata.titles)
  ) {
    const titleObj = metadata.titles.find(
      (item: any) => typeof item?.title === "string" && item.title.trim(),
    );
    if (titleObj?.title) {
      entry.title = cleanMathTitle(titleObj.title);
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
  }

  // Year update
  if (
    (!entry.year || entry.year === strings.yearUnknown) &&
    metadata.earliest_date
  ) {
    entry.year = `${metadata.earliest_date}`.slice(0, 4);
  }

  // Extract arXiv details from metadata if not already present
  if (!entry.arxivDetails && metadata.arxiv_eprints) {
    const arxiv = extractArxivFromMetadata(metadata);
    if (arxiv) {
      entry.arxivDetails = arxiv;
    }
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

