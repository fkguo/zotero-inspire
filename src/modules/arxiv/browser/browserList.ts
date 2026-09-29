// ─────────────────────────────────────────────────────────────────────────────
// The arXiv browser's list: the papers of the loaded days as entries of the
// plugin's entry list, in the chosen order, filtered, and cut into pages.
// Pure functions of the loaded days and the list's settings; the view draws
// what they return.
//
// Days keep the order in which they were loaded (recent: newest first,
// catch-up: oldest first), so a day that arrives later only adds pages at
// the end. Every sort orders the papers within a day. A page holds a fixed
// number of papers and may begin inside a day or a section; the headers of
// that day and section then open the page again, marked as continued.
// ─────────────────────────────────────────────────────────────────────────────

import type { FluentMessageId } from "../../../../typings/i10n";
import { getJournalAbbreviations } from "../../../utils/journalAbbreviations";
import { cleanMathTitle } from "../../../utils/mathTitle";
import {
  ARXIV_ABS_URL,
  QUICK_FILTER_CONFIGS,
  SMALL_AUTHOR_GROUP_FILTER_CONFIG,
  SMALL_AUTHOR_GROUP_THRESHOLD,
  type QuickFilterConfig,
  type QuickFilterType,
} from "../../inspire/constants";
import { matchesLocalItems, matchesOnlineItems } from "../../inspire/filters";
import { journalNameFromText } from "../../inspire/formatters";
import {
  buildFilterTokenVariants,
  buildSearchIndexText,
  parseFilterTokens,
} from "../../inspire/textUtils";
import type { InspireReferenceEntry } from "../../inspire/types";
import type { IsoDate } from "../arxivDates";
import { arxivSortKey } from "../arxivId";
import {
  displaySection,
  LISTING_SECTIONS,
  type ArxivListingEntry,
  type DayListing,
  type ListingAuthor,
  type ListingSection,
  type ListingStream,
} from "../listingTypes";
import { archivesListing } from "./subscriptions";

/** A paper of the list: the entry list's fields and the listing it shows */
export interface BrowserEntry extends InspireReferenceEntry {
  listing: ArxivListingEntry;
}

/**
 * Key of a paper's row: a paper announced on two days (a new version) has a
 * row on each, which the entry list keeps apart by this key; a search result
 * (no announcement day) has its own
 */
export function rowKey(id: string, date: IsoDate | undefined): string {
  return `arxiv-${id}-${date ?? "search"}`;
}

/** "Family, Given" as the entry list and author cards read names */
function authorName(author: ListingAuthor): string {
  if (!author.family) return author.display;
  return author.given ? `${author.family}, ${author.given}` : author.family;
}

/** The entry of the list for a paper of a day's listing */
export function toBrowserEntry(listing: ArxivListingEntry): BrowserEntry {
  const authors = listing.authors.map(authorName);
  const title = cleanMathTitle(listing.title) || listing.title;
  const authorText = listing.authors.map((author) => author.display).join(", ");
  return {
    id: rowKey(listing.id, listing.announceDate),
    title,
    titleOriginal: listing.title,
    // The year of the first version, from the identifier
    year: arxivSortKey(listing.id).slice(0, 4),
    authors,
    totalAuthors: authors.length,
    authorText,
    displayText: `${authorText}: ${title};`,
    searchText: "",
    fallbackUrl: `${ARXIV_ABS_URL}/${listing.id}`,
    arxivDetails: { id: listing.id, categories: listing.categories },
    // Known from the listing: the hover card does not ask INSPIRE for it
    abstract: listing.abstract,
    listing,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Text filter
// ─────────────────────────────────────────────────────────────────────────────

const searchTexts = new WeakMap<BrowserEntry, string>();
const COLLAPSE = /[.\s]+/g;

/**
 * What the text filter looks in: authors, title, identifier, categories,
 * comments, journal reference with its journal's abbreviations (PRL, JHEP)
 * and abstract, normalised as the References panel's filter does (accents,
 * umlauts; short fields also without dots and spaces, for quoted tokens like
 * "Phys.Rev.D")
 */
export function searchTextOf(entry: BrowserEntry): string {
  let text = searchTexts.get(entry);
  if (text === undefined) {
    const { listing } = entry;
    const journal = listing.journalRef
      ? journalNameFromText(listing.journalRef)
      : undefined;
    const short = [
      entry.authorText,
      listing.title,
      entry.title,
      listing.id,
      `arXiv:${listing.id}`,
      listing.categories.join(" "),
      listing.comments ?? "",
      listing.journalRef ?? "",
      ...(journal ? getJournalAbbreviations(journal) : []),
    ];
    text = buildSearchIndexText(
      [
        ...short,
        ...short.map((segment) => segment.replace(COLLAPSE, "")),
        listing.abstract,
      ].join(" "),
    );
    searchTexts.set(entry, text);
  }
  return text;
}

/**
 * The filter text as groups of variants: a paper passes when every group
 * has a variant in its text (the References panel's filter syntax: words,
 * and "quoted phrases")
 */
export function filterGroups(text: string): string[][] {
  return parseFilterTokens(text)
    .map(({ text: token, quoted }) =>
      buildFilterTokenVariants(token, { ignoreSpaceDot: quoted }),
    )
    .filter((variants) => variants.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick filters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The References panel's quick filters whose data the listing has (the others
 * need INSPIRE's citations, dates or document types), and "≤10 authors"
 */
const ARXIV_TOOLTIPS: Partial<Record<QuickFilterType, FluentMessageId>> = {
  localItems: "arxiv-browser-quick-filter-local-tooltip",
  onlineItems: "arxiv-browser-quick-filter-online-tooltip",
  relatedOnly: "arxiv-browser-quick-filter-related-tooltip",
};

export const ARXIV_QUICK_FILTER_CONFIGS: readonly QuickFilterConfig[] = [
  ...(["localItems", "onlineItems", "relatedOnly"] as const).map(
    (type) => QUICK_FILTER_CONFIGS.find((config) => config.type === type)!,
  ),
  SMALL_AUTHOR_GROUP_FILTER_CONFIG,
  ...(["publishedOnly", "preprintOnly"] as const).map(
    (type) => QUICK_FILTER_CONFIGS.find((config) => config.type === type)!,
  ),
].map((config) => {
  // In the window's words: papers, and related to any item (no item is
  // shown here)
  const tooltipKey = ARXIV_TOOLTIPS[config.type];
  return tooltipKey ? { ...config, tooltipKey } : config;
});

/** A collaboration's name among the authors ("ALICE Collaboration") */
export const COLLABORATION = /\bcollaborations?\b/i;

/**
 * At most ten authors, a collaboration's name not counted: a paper signed
 * "ALICE Collaboration" alone is a large group's, "BESIII Collaboration: M.
 * Ablikim, …" lists its members, "T. Vami, for the CMS Collaboration" has
 * one author
 */
function fewAuthors(entry: BrowserEntry): boolean {
  const persons = entry.listing.authors.filter(
    (author) => !COLLABORATION.test(author.display),
  ).length;
  return persons > 0 && persons <= SMALL_AUTHOR_GROUP_THRESHOLD;
}

/**
 * Whether a paper passes the quick filters on; journal status is the
 * listing's journal reference. `isRelated`: its item has related items.
 */
export function passesQuickFilters(
  entry: BrowserEntry,
  active: ReadonlySet<QuickFilterType>,
  isRelated: (entry: BrowserEntry) => boolean,
): boolean {
  for (const type of active) {
    let pass: boolean;
    switch (type) {
      case "localItems":
        pass = matchesLocalItems(entry);
        break;
      case "onlineItems":
        pass = matchesOnlineItems(entry);
        break;
      case "relatedOnly":
        pass = isRelated(entry);
        break;
      case "smallAuthorGroup":
        pass = fewAuthors(entry);
        break;
      case "publishedOnly":
        pass = Boolean(entry.listing.journalRef);
        break;
      case "preprintOnly":
        pass = !entry.listing.journalRef;
        break;
      default:
        // Not offered here
        pass = true;
    }
    if (!pass) return false;
  }
  return true;
}

function passes(entry: BrowserEntry, groups: readonly string[][]): boolean {
  if (!groups.length) return true;
  const text = searchTextOf(entry);
  return groups.every((variants) =>
    variants.some((variant) => text.includes(variant)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Order and groups
// ─────────────────────────────────────────────────────────────────────────────

/**
 * announcement: as arXiv's pages — new, cross-lists, replacements, each by
 * the subscription's order of the categories and the page order;
 * id-asc / id-desc: by arXiv identifier; primary: grouped by primary
 * category (the subscription's first), each in announcement order
 */
export type ListSort = "announcement" | "id-asc" | "id-desc" | "primary";

export const LIST_SORTS: readonly ListSort[] = [
  "announcement",
  "id-asc",
  "id-desc",
  "primary",
];

export interface ListOptions {
  sort: ListSort;
  /** The sections the subscription shows */
  sections: ReadonlySet<ListingSection>;
  /** From filterGroups; empty for no filter */
  filter: readonly string[][];
  /** The quick filters: whether a paper passes them (default: all do) */
  quick?: (entry: BrowserEntry) => boolean;
  /** The subscription's listing pages (categories, archives) in its order */
  specs: readonly string[];
  /**
   * Pages chosen with the subscription's category chips: only the papers
   * they list are shown, each where they list it; empty or absent for all
   */
  categories?: ReadonlySet<string>;
}

/** Papers under one header within a day */
export interface ListGroup {
  /**
   * section: a section of the listing (announcement order); category: a
   * primary category; all: every paper of the day, without a header
   */
  kind: "section" | "category" | "all";
  /** The section or the category */
  key: string;
  entries: BrowserEntry[];
}

export interface ListDay {
  listing: DayListing;
  /**
   * Search results: the month of submission ("2026-09") whose papers these
   * are; `listing` then stands in for a day (its date is the month's first)
   */
  month?: string;
  groups: ListGroup[];
  /** Papers shown, in order */
  count: number;
  /** Papers of the shown sections, before the text and quick filters */
  inSections: number;
  /** Papers the chosen category pages list (all when none is chosen) */
  onChosenPages: number;
  /**
   * Every page the day's papers are taken from (the chosen category pages,
   * or all of the subscription's) was fetched completely
   */
  pagesFetched: boolean;
}

export interface ArrangedList {
  days: ListDay[];
  /** The section each paper shown stands in (where the chosen pages list it) */
  sectionOf: ReadonlyMap<BrowserEntry, ListingSection>;
  /** Every paper shown, in order */
  entries: BrowserEntry[];
}

const SECTION_RANK: Record<ListingSection, number> = {
  new: 0,
  cross: 1,
  replace: 2,
};

/**
 * Where a paper stands in announcement order within its day: its first place
 * in the section it is shown in (a section displaySection chose from these
 * streams, so it has one there)
 */
function announcementKey(
  streams: readonly ListingStream[],
  section: ListingSection,
  specs: readonly string[],
): [number, number, number] {
  let best: [number, number, number] | null = null;
  for (const stream of streams) {
    if (stream.section !== section) continue;
    const spec = specs.indexOf(stream.category);
    const key: [number, number, number] = [
      SECTION_RANK[section],
      spec < 0 ? specs.length : spec,
      stream.position,
    ];
    if (!best || compareKeys(key, best) < 0) best = key;
  }
  return best!;
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function compareIds(a: string, b: string): number {
  const keyA = arxivSortKey(a);
  const keyB = arxivSortKey(b);
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rank of a primary category among the groups: the subscription's pages in
 * its order (a whole archive's page with the categories it lists), then the
 * others
 */
function categoryRank(category: string, specs: readonly string[]): number {
  const archives = archivesListing(category);
  const index = specs.findIndex(
    (spec) => spec === category || archives.includes(spec),
  );
  return index < 0 ? specs.length : index;
}

interface Placed {
  entry: BrowserEntry;
  section: ListingSection;
  key: [number, number, number];
}

function arrangeDay(
  listing: DayListing,
  entries: readonly BrowserEntry[],
  options: ListOptions,
  sectionOf: Map<BrowserEntry, ListingSection>,
): ListDay {
  const placed: Placed[] = [];
  let inSections = 0;
  const chosen = options.categories;
  let onChosenPages = 0;
  for (const entry of entries) {
    // With pages chosen, a paper stands where those pages list it
    const streams = chosen?.size
      ? entry.listing.streams.filter((stream) => chosen.has(stream.category))
      : entry.listing.streams;
    if (streams.length) onChosenPages++;
    const section = displaySection(streams, options.sections);
    if (!section) continue;
    inSections++;
    if (!passes(entry, options.filter)) continue;
    if (options.quick && !options.quick(entry)) continue;
    placed.push({
      entry,
      section,
      key: announcementKey(streams, section, options.specs),
    });
  }
  const byAnnouncement = (a: Placed, b: Placed) =>
    compareKeys(a.key, b.key) ||
    compareIds(a.entry.listing.id, b.entry.listing.id);

  let groups: ListGroup[];
  if (options.sort === "announcement") {
    placed.sort(byAnnouncement);
    groups = LISTING_SECTIONS.map((section) => ({
      kind: "section" as const,
      key: section,
      entries: placed
        .filter((item) => item.section === section)
        .map((item) => item.entry),
    }));
  } else if (options.sort === "primary") {
    placed.sort(byAnnouncement);
    const categories = [
      ...new Set(placed.map((item) => item.entry.listing.primaryCategory)),
    ].sort(
      (a, b) =>
        categoryRank(a, options.specs) - categoryRank(b, options.specs) ||
        (a < b ? -1 : a > b ? 1 : 0),
    );
    groups = categories.map((category) => ({
      kind: "category" as const,
      key: category,
      entries: placed
        .filter((item) => item.entry.listing.primaryCategory === category)
        .map((item) => item.entry),
    }));
  } else {
    const sign = options.sort === "id-desc" ? -1 : 1;
    placed.sort(
      (a, b) => sign * compareIds(a.entry.listing.id, b.entry.listing.id),
    );
    groups = [
      { kind: "all", key: "all", entries: placed.map((item) => item.entry) },
    ];
  }
  groups = groups.filter((group) => group.entries.length > 0);
  for (const item of placed) sectionOf.set(item.entry, item.section);
  const pagesFetched = listing.specs.every(
    ({ spec, state }) =>
      state.state === "complete" ||
      (Boolean(chosen?.size) && !chosen!.has(spec)),
  );
  return {
    listing,
    groups,
    count: placed.length,
    inSections,
    onChosenPages,
    pagesFetched,
  };
}

/**
 * The list of the loaded days. `entriesOf` gives a day's entries (built once
 * per day by the caller, so that filter texts and row states are kept).
 */
export function arrangeList(
  days: readonly DayListing[],
  entriesOf: (day: DayListing) => readonly BrowserEntry[],
  options: ListOptions,
): ArrangedList {
  const sectionOf = new Map<BrowserEntry, ListingSection>();
  const arranged = days.map((day) =>
    arrangeDay(day, entriesOf(day), options, sectionOf),
  );
  return {
    days: arranged,
    sectionOf,
    entries: arranged.flatMap((day) =>
      day.groups.flatMap((group) => group.entries),
    ),
  };
}

/**
 * The results of a search as a list: in arXiv's order (newest submission
 * first) under the months of their submission, through the text and quick
 * filters as the days are; months without a paper shown are left out
 */
export function arrangeResults(
  entries: readonly BrowserEntry[],
  options: Pick<ListOptions, "filter" | "quick">,
): ArrangedList {
  const months = new Map<string, { all: number; shown: BrowserEntry[] }>();
  for (const entry of entries) {
    const month = (entry.listing.submitted ?? "").slice(0, 7);
    let group = months.get(month);
    if (!group) months.set(month, (group = { all: 0, shown: [] }));
    group.all++;
    if (!passes(entry, options.filter)) continue;
    if (options.quick && !options.quick(entry)) continue;
    group.shown.push(entry);
  }
  const days: ListDay[] = [];
  for (const [month, { all, shown }] of months) {
    if (!shown.length) continue;
    days.push({
      listing: {
        date: `${month}-01`,
        status: "complete",
        entries: [],
        specs: [],
        latest: false,
      },
      month,
      groups: [{ kind: "all", key: "all", entries: shown }],
      count: shown.length,
      inSections: all,
      onChosenPages: all,
      pagesFetched: true,
    });
  }
  return {
    days,
    sectionOf: new Map(),
    entries: days.flatMap((day) => day.groups[0].entries),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────────────────────

export type PageBlock =
  /** A day's header; continued: the day began on an earlier page */
  | { kind: "day"; day: ListDay; continued: boolean }
  /** A section's or category's header within the day */
  | { kind: "group"; day: ListDay; group: ListGroup; continued: boolean }
  /** A paper; index: its place in the whole list */
  | { kind: "entry"; day: ListDay; entry: BrowserEntry; index: number };

/** Number of pages (at least one, also for an empty list) */
export function pageCount(list: ArrangedList, pageSize: number): number {
  return Math.max(1, Math.ceil(list.entries.length / pageSize));
}

/**
 * The page a day's header is on: the page of its first paper. A day without
 * papers shown (not fetched, nothing that day, nothing passes the filter)
 * goes with the paper before it, so that days loaded later never move it.
 */
function dayPage(start: number, count: number, pageSize: number): number {
  const anchor = count > 0 ? start : Math.max(start - 1, 0);
  return Math.floor(anchor / pageSize);
}

/** The headers and papers of page `page` (0-based), in order */
export function pageBlocks(
  list: ArrangedList,
  page: number,
  pageSize: number,
): PageBlock[] {
  const from = page * pageSize;
  const to = Math.min(from + pageSize, list.entries.length);
  const blocks: PageBlock[] = [];
  let start = 0;
  for (const day of list.days) {
    const end = start + day.count;
    if (day.count === 0) {
      if (dayPage(start, 0, pageSize) === page) {
        blocks.push({ kind: "day", day, continued: false });
      }
    } else if (start < to && end > from) {
      blocks.push({ kind: "day", day, continued: start < from });
      let groupStart = start;
      for (const group of day.groups) {
        const groupEnd = groupStart + group.entries.length;
        if (groupStart < to && groupEnd > from) {
          if (group.kind !== "all") {
            blocks.push({
              kind: "group",
              day,
              group,
              continued: groupStart < from,
            });
          }
          for (
            let index = Math.max(groupStart, from);
            index < Math.min(groupEnd, to);
            index++
          ) {
            blocks.push({
              kind: "entry",
              day,
              entry: group.entries[index - groupStart],
              index,
            });
          }
        }
        groupStart = groupEnd;
      }
    }
    start = end;
  }
  return blocks;
}

/** The page a paper is on, or -1 when it is not shown */
export function pageOfEntry(
  list: ArrangedList,
  key: string,
  pageSize: number,
): number {
  const index = list.entries.findIndex((entry) => entry.id === key);
  return index < 0 ? -1 : Math.floor(index / pageSize);
}

/** The page a day's header is on, or -1 when the day is not loaded */
export function pageOfDay(
  list: ArrangedList,
  date: IsoDate,
  pageSize: number,
): number {
  let start = 0;
  for (const day of list.days) {
    if (day.listing.date === date) {
      return dayPage(start, day.count, pageSize);
    }
    start += day.count;
  }
  return -1;
}
