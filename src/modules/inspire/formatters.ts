import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { getJournalAbbreviations } from "../../utils/journalAbbreviations";
import {
  LARGE_COLLABORATION_THRESHOLD,
  FAMILY_NAME_PARTICLES,
  NON_PERSON_AUTHOR_PATTERN,
} from "./constants";
import type { InspireReferenceEntry, InspireArxivDetails } from "./types";
import { buildSearchIndexText } from "./textUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Search Text Regex and Cache
// ─────────────────────────────────────────────────────────────────────────────
const SEARCH_COLLAPSE_REGEX = /[.\s]+/g;

/**
 * WeakMap cache for search text to avoid redundant computation.
 * Uses WeakMap so entries can be garbage collected when no longer referenced.
 */
const searchTextCache = new WeakMap<InspireReferenceEntry, string>();

// ─────────────────────────────────────────────────────────────────────────────
// Cached locale strings for rendering performance
// getString() calls formatMessagesSync() every time, which is slow.
// For static strings used repeatedly in lists, we cache them here.
// ─────────────────────────────────────────────────────────────────────────────
let _cachedStrings: Record<string, string> | null = null;

export function getCachedStrings(): Record<string, string> {
  if (!_cachedStrings) {
    _cachedStrings = {
      // Entry row strings (used in createReferenceRow, updateRowMetadata)
      dotLocal: getString("references-panel-dot-local"),
      dotAdd: getString("references-panel-dot-add"),
      linkExisting: getString("references-panel-link-existing"),
      linkMissing: getString("references-panel-link-missing"),
      yearUnknown: getString("references-panel-year-unknown"),
      citationUnknown: getString("references-panel-citation-count-unknown"),
      unknownAuthor: getString("references-panel-unknown-author"),
      copyBibtex: getString("references-panel-copy-bibtex"),
      noTitle: getString("references-panel-no-title"),
      // Abstract tooltip strings
      noAbstract: getString("references-panel-no-abstract"),
      loadingAbstract: getString("references-panel-loading-abstract"),
      // Status messages (used in status bar updates)
      statusLoading: getString("references-panel-status-loading"),
      statusLoadingCited: getString("references-panel-status-loading-cited"),
      statusLoadingAuthor: getString("references-panel-status-loading-author"),
      statusLoadingEntry: getString("references-panel-status-loading-entry"),
      statusError: getString("references-panel-status-error"),
      statusEmpty: getString("references-panel-status-empty"),
      // Empty list messages
      emptyList: getString("references-panel-empty-list"),
      emptyCited: getString("references-panel-empty-cited"),
      authorEmpty: getString("references-panel-author-empty"),
      entryEmpty: getString("references-panel-entry-empty"),
      noMatch: getString("references-panel-no-match"),
      // Tab labels
      tabReferences: getString("references-panel-tab-references"),
      tabCited: getString("references-panel-tab-cited"),
      tabAuthorPapers: getString("references-panel-tab-author-papers"),
      tabEntryCited: getString("references-panel-tab-entry-cited"),
      // Sort options
      sortDefault: getString("references-panel-sort-default"),
      sortMostrecent: getString("references-panel-sort-mostrecent"),
      sortMostcited: getString("references-panel-sort-mostcited"),
      // Navigation
      entryLabelDefault: getString("references-panel-entry-label-default"),
      selectItem: getString("references-panel-select-item"),
      noRecid: getString("references-panel-no-recid"),
      readerMode: getString("references-panel-reader-mode"),
      entrySelect: getString("references-panel-entry-select"),
      // Batch BibTeX copy
      bibtexFetching: getString("references-panel-bibtex-fetching"),
      bibtexAllFailed: getString("references-panel-bibtex-all-failed"),
      noRecidEntries: getString("references-panel-no-recid-entries"),
    };
  }
  return _cachedStrings;
}

/**
 * Clear cached strings (useful if locale changes at runtime).
 */
export function clearCachedStrings() {
  _cachedStrings = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Author Name Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize consecutive initials like "R.L." to "R. L." for proper parsing.
 */
export function normalizeInitials(name: string): string {
  if (!name) {
    return name;
  }
  return name.replace(/([A-Z])\.([A-Z])/g, "$1. $2");
}

export function buildInitials(given: string): string {
  // Normalize consecutive initials: "R.L." → "R. L."
  const normalizedGiven = normalizeInitials(given);
  const words = normalizedGiven.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "";
  }
  const wordInitials = words
    .map((word) => {
      // Handle already-initialed words like "R." - just keep them
      if (/^[A-Z]\.$/.test(word)) {
        return word;
      }
      const segments = word.split(/-+/).filter(Boolean);
      if (!segments.length) {
        return "";
      }
      const segmentInitials = segments
        .map((segment) => segment.trim()[0])
        .filter((char): char is string => Boolean(char))
        .map((char) => `${char.toUpperCase()}.`);
      return segmentInitials.join("-");
    })
    .filter(Boolean);
  return wordInitials.join(" ");
}

export function formatAuthorName(rawName?: string): string {
  if (!rawName) {
    return "";
  }
  const trimmed = rawName.trim();
  if (!trimmed) {
    return "";
  }
  if (NON_PERSON_AUTHOR_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const hasComma = trimmed.includes(",");
  let family = "";
  let given = "";
  if (hasComma) {
    const [familyPart, givenPart] = trimmed.split(",", 2);
    family = (familyPart || "").trim();
    given = (givenPart || "").trim();
  } else {
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      family = parts[0];
    } else {
      let index = parts.length - 1;
      const familyParts = [parts[index]];
      index -= 1;
      while (index >= 0) {
        const candidate = parts[index];
        const lower = candidate.toLowerCase();
        if (FAMILY_NAME_PARTICLES.has(lower)) {
          familyParts.unshift(candidate);
          index -= 1;
        } else {
          break;
        }
      }
      family = familyParts.join(" ");
      given = parts.slice(0, parts.length - familyParts.length).join(" ");
    }
  }
  if (!given) {
    return family || trimmed;
  }
  const initials = buildInitials(given);
  if (!initials) {
    return `${given} ${family}`.trim();
  }
  return `${initials} ${family}`.trim();
}

/**
 * Format author list for display.
 * - If totalAuthors > displayed authors, show "et al."
 * - If totalAuthors > 50 (large collaboration), show only first author + "et al."
 * - Convert "others" to "et al."
 */
export function formatAuthors(authors: string[], totalAuthors?: number): string {
  if (!authors.length) {
    return getString("references-panel-unknown-author");
  }
  // Filter out "others" and convert to et al. indication
  const hasOthers = authors.some(
    (name) => name.toLowerCase() === "others",
  );
  const filteredAuthors = authors.filter(
    (name) => name.toLowerCase() !== "others",
  );
  const formatted = filteredAuthors
    .map((name) => formatAuthorName(name))
    .filter((name): name is string => Boolean(name));
  if (!formatted.length) {
    return getString("references-panel-unknown-author");
  }
  const maxAuthors = (getPref("max_authors") as number) || 3;
  const actualTotal = totalAuthors ?? authors.length;
  // For large collaborations, always show first author + et al.
  if (actualTotal > LARGE_COLLABORATION_THRESHOLD) {
    return `${formatted[0]} et al.`;
  }
  // If more authors than max, or more authors than displayed, show et al.
  if (formatted.length > maxAuthors || actualTotal > formatted.length || hasOthers) {
    const displayCount = Math.min(formatted.length, maxAuthors);
    return `${formatted.slice(0, displayCount).join(", ")} et al.`;
  }
  return formatted.join(", ");
}

/**
 * Convert full name to INSPIRE search query format.
 * "Guo, Feng-Kun" → "f k guo" (initials of first name + last name, all lowercase)
 */
export function convertFullNameToSearchQuery(fullName: string): string {
  if (!fullName?.trim()) {
    return "";
  }
  const trimmed = fullName.trim();
  let lastName = "";
  let firstName = "";

  // Handle "Last, First" format (common in bibliographic data)
  if (trimmed.includes(",")) {
    const [lastPart, firstPart] = trimmed.split(",", 2);
    lastName = (lastPart || "").trim();
    firstName = (firstPart || "").trim();
  } else {
    // Handle "First Last" format
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].toLowerCase();
    }
    // Last word is last name, everything before is first name(s)
    lastName = parts[parts.length - 1];
    firstName = parts.slice(0, -1).join(" ");
  }

  if (!lastName) {
    return "";
  }

  // Normalize consecutive initials: "R.L." → "R. L."
  const normalizedFirstName = normalizeInitials(firstName);

  // Convert first name to initials
  const initials = normalizedFirstName
    .split(/[\s\-.]+/)
    .map((part) => part.charAt(0)?.toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (initials) {
    return `${initials} ${lastName.toLowerCase()}`;
  }
  return lastName.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Publication Info Formatting
// ─────────────────────────────────────────────────────────────────────────────

export function splitPublicationInfo(
  raw?: any | any[],
): { primary?: any; errata?: Array<{ info: any; label: string }> } {
  if (!raw) {
    return {};
  }
  const list = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  if (!list.length) {
    return {};
  }
  let primary = list.find((info) => !getPublicationNoteLabel(info));
  if (!primary) {
    primary = list[0];
  }
  const errata = list
    .filter((info) => info && info !== primary)
    .map((info) => {
      const label = getPublicationNoteLabel(info);
      return label ? { info, label } : undefined;
    })
    .filter((note): note is { info: any; label: string } => Boolean(note));
  return {
    primary,
    errata: errata.length ? errata : undefined,
  };
}

export function getPublicationNoteLabel(info: any): string | undefined {
  if (!info || typeof info !== "object") {
    return undefined;
  }
  const collectValues = (value: any): string[] => {
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap(collectValues);
    }
    return [];
  };
  const values: string[] = [];
  if (info.material !== undefined) values.push(...collectValues(info.material));
  if (info.note !== undefined) values.push(...collectValues(info.note));
  if (info.pubinfo_freetext !== undefined) {
    values.push(...collectValues(info.pubinfo_freetext));
  }
  if (info.additional_info !== undefined) {
    values.push(...collectValues(info.additional_info));
  }
  const labelRegexes: Array<{ regex: RegExp; label: string }> = [
    { regex: /erratum/i, label: "Erratum" },
    { regex: /addendum/i, label: "Addendum" },
  ];
  for (const value of values) {
    for (const { regex, label } of labelRegexes) {
      if (regex.test(value)) {
        return label;
      }
    }
  }
  return undefined;
}

export function formatPublicationInfo(
  info?: any,
  fallbackYear?: string,
  options?: { omitJournal?: boolean },
): string {
  if (!info) {
    return "";
  }
  const parts: string[] = [];
  const journal = options?.omitJournal
    ? ""
    : info.journal_title || info.journal_title_abbrev || "";
  const volume = info.journal_volume || info.volume || "";
  const artid = info.artid || info.article_number || info.eprintid;
  const pageStart =
    info.page_start ||
    info.pagination ||
    (Array.isArray(info.pages) ? info.pages[0] : undefined);
  const pageEnd =
    info.page_end ||
    (Array.isArray(info.pages) ? info.pages[1] : undefined);
  if (journal) {
    parts.push(journal);
  }
  if (volume) {
    parts.push(volume);
  }
  const normalizedFallbackYear =
    fallbackYear && typeof fallbackYear === "string"
      ? fallbackYear.match(/\d{4}/)?.[0] ?? fallbackYear
      : undefined;
  const resolvedYear =
    info.year ??
    (info.date ? String(info.date).slice(0, 4) : undefined) ??
    normalizedFallbackYear;
  const yearPart = resolvedYear ? `(${resolvedYear})` : undefined;
  let yearInserted = false;
  const insertYearIfNeeded = () => {
    if (!yearInserted && yearPart) {
      parts.push(yearPart);
      yearInserted = true;
    }
  };
  if (artid) {
    insertYearIfNeeded();
    parts.push(artid);
  } else if (pageStart) {
    insertYearIfNeeded();
    const range =
      pageEnd && pageEnd !== pageStart ? `${pageStart}-${pageEnd}` : pageStart;
    parts.push(range);
  } else {
    insertYearIfNeeded();
  }
  if (!parts.length && info.publication_info) {
    const fallback = [
      options?.omitJournal ? undefined : info.publication_info.title,
      info.publication_info.volume,
      info.publication_info.year
        ? `(${info.publication_info.year})`
        : normalizedFallbackYear
          ? `(${normalizedFallbackYear})`
          : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    if (fallback) {
      parts.push(fallback);
    }
  }
  return parts.join(" ").trim();
}

export function buildPublicationSummary(
  info?: any,
  arxiv?: InspireArxivDetails | string | null,
  fallbackYear?: string,
  errata?: any[],
): string {
  const mainSummary = formatPublicationInfo(info, fallbackYear);
  const arxivTag = formatArxivTag(arxiv);
  // Show both journal information and arXiv information when both are available
  const baseSummary = [mainSummary, arxivTag].filter(Boolean).join(" ");

  const errataSummaries = (errata ?? [])
    .map((entry) => {
      const text = formatPublicationInfo(entry.info, fallbackYear, {
        omitJournal: true,
      });
      return text ? `${entry.label}: ${text}` : null;
    })
    .filter((text): text is string => Boolean(text));

  if (errataSummaries.length) {
    const errataText = `[${errataSummaries.join("; ")}]`;
    return baseSummary ? `${baseSummary} ${errataText}` : errataText;
  }

  return baseSummary;
}

// ─────────────────────────────────────────────────────────────────────────────
// arXiv Formatting
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeArxivID(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^arxiv\s*:/i, "").trim();
}

export function normalizeArxivCategories(input?: any): string[] {
  if (!input) {
    return [];
  }
  const values = Array.isArray(input) ? input : [input];
  return values
    .map((value) =>
      typeof value === "string" ? value.trim() : undefined,
    )
    .filter((value): value is string => Boolean(value));
}

export function formatArxivDetails(
  raw?: InspireArxivDetails | string | null,
): { id?: string; categories: string[] } | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw === "string") {
    const id = normalizeArxivID(raw);
    return id ? { id, categories: [] } : undefined;
  }
  const id = normalizeArxivID(raw.id);
  const categories = normalizeArxivCategories(raw.categories);
  if (!id && !categories.length) {
    return undefined;
  }
  return { id, categories };
}

export function formatArxivTag(
  raw?: InspireArxivDetails | string | null,
): string | undefined {
  const details = formatArxivDetails(raw);
  if (!details?.id) {
    return undefined;
  }
  return `[arXiv:${details.id}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Display Text Building
// ─────────────────────────────────────────────────────────────────────────────

export function buildDisplayText(entry: InspireReferenceEntry): string {
  const label = entry.label ? `[${entry.label}] ` : "";
  // Use cached string for performance (this function is called in loops)
  const yearUnknown = getCachedStrings().yearUnknown;
  const normalizedYear =
    entry.year && entry.year !== yearUnknown ? entry.year : "";
  const summaryContainsYear =
    normalizedYear &&
    entry.summary &&
    entry.summary.includes(`(${normalizedYear})`);
  const shouldShowYearInline = Boolean(normalizedYear && !summaryContainsYear);
  const yearPart = shouldShowYearInline ? ` (${normalizedYear})` : "";
  return `${label}${entry.authorText}${yearPart}: ${entry.title};`;
}

export function extractJournalName(entry: InspireReferenceEntry): string | undefined {
  const info = entry.publicationInfo;
  if (info?.journal_title) {
    return info.journal_title;
  }
  if (info?.journal_title_abbrev) {
    return info.journal_title_abbrev;
  }
  if (entry.summary) {
    const match = entry.summary.match(/^([^0-9(]+?)(?:\s+\d+|\(|$)/);
    if (match) {
      const journal = match[1].trim();
      if (journal.length > 2) {
        return journal;
      }
    }
  }
  return undefined;
}

export function buildEntrySearchText(entry: InspireReferenceEntry): string {
  // Check cache first to avoid redundant computation
  const cached = searchTextCache.get(entry);
  if (cached !== undefined) {
    return cached;
  }

  const segments: string[] = [];
  const collapsedSegments: string[] = [];

  const addSegment = (text?: string) => {
    if (!text) {
      return;
    }
    segments.push(text);
    const collapsed = text.replace(SEARCH_COLLAPSE_REGEX, "");
    if (collapsed && collapsed !== text) {
      collapsedSegments.push(collapsed);
    }
  };

  addSegment(entry.displayText);
  addSegment(entry.summary);

  const journalName = extractJournalName(entry);
  if (journalName) {
    for (const abbr of getJournalAbbreviations(journalName)) {
      addSegment(abbr);
    }
  }

  const arxivDetails = formatArxivDetails(entry.arxivDetails);
  if (arxivDetails?.id) {
    const arxivTag = `[arXiv:${arxivDetails.id}]`;
    // Avoid duplicating the tag if it's already part of the summary text
    if (!entry.summary || !entry.summary.includes(arxivTag)) {
      addSegment(arxivTag);
    }
    if (!entry.summary || !entry.summary.includes(arxivDetails.id)) {
      addSegment(arxivDetails.id);
    }
  }

  const allSegments = collapsedSegments.length
    ? [...segments, ...collapsedSegments]
    : segments;
  const result = buildSearchIndexText(allSegments.join(" "));

  // Cache the result for future lookups
  searchTextCache.set(entry, result);
  return result;
}

