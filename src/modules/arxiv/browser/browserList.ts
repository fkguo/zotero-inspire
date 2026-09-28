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

import { cleanMathTitle } from "../../../utils/mathTitle";
import { ARXIV_ABS_URL } from "../../inspire/constants";
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
} from "../listingTypes";
import { archivesListing } from "./subscriptions";

/** A paper of the list: the entry list's fields and the listing it shows */
export interface BrowserEntry extends InspireReferenceEntry {
  listing: ArxivListingEntry;
}

/**
 * Key of a paper's row: a paper announced on two days (a new version) has a
 * row on each, which the entry list keeps apart by this key
 */
export function rowKey(id: string, date: IsoDate): string {
  return `arxiv-${id}-${date}`;
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
 * comments, journal reference and abstract, normalised as the References
 * panel's filter does (accents, umlauts; short fields also without dots and
 * spaces, for quoted tokens like "Phys.Rev.D")
 */
export function searchTextOf(entry: BrowserEntry): string {
  let text = searchTexts.get(entry);
  if (text === undefined) {
    const { listing } = entry;
    const short = [
      entry.authorText,
      listing.title,
      entry.title,
      listing.id,
      `arXiv:${listing.id}`,
      listing.categories.join(" "),
      listing.comments ?? "",
      listing.journalRef ?? "",
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
  /** The subscription's listing pages (categories, archives) in its order */
  specs: readonly string[];
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
  groups: ListGroup[];
  /** Papers shown, in order */
  count: number;
  /** Papers of the shown sections, before the text filter */
  inSections: number;
}

export interface ArrangedList {
  days: ListDay[];
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
 * in the section it is shown in (a section displaySection chose from its
 * streams, so it has one there)
 */
function announcementKey(
  listing: ArxivListingEntry,
  section: ListingSection,
  specs: readonly string[],
): [number, number, number] {
  let best: [number, number, number] | null = null;
  for (const stream of listing.streams) {
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
): ListDay {
  const placed: Placed[] = [];
  let inSections = 0;
  for (const entry of entries) {
    const section = displaySection(entry.listing.streams, options.sections);
    if (!section) continue;
    inSections++;
    if (!passes(entry, options.filter)) continue;
    placed.push({
      entry,
      section,
      key: announcementKey(entry.listing, section, options.specs),
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
  return { listing, groups, count: placed.length, inSections };
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
  const arranged = days.map((day) => arrangeDay(day, entriesOf(day), options));
  return {
    days: arranged,
    entries: arranged.flatMap((day) =>
      day.groups.flatMap((group) => group.entries),
    ),
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
