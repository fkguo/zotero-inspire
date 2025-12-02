import { cleanMathTitle } from "../../utils/mathTitle";
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

