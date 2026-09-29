// ─────────────────────────────────────────────────────────────────────────────
// Data model of arXiv listings: what one listing page shows, one category's
// (or archive's) listing of one announcement day, and the merged day of a
// subscription.
// ─────────────────────────────────────────────────────────────────────────────

import type { IsoDate } from "./arxivDates";

/** Listing sections: New / Cross / Replacement submissions */
export type ListingSection = "new" | "cross" | "replace";

/** Section order on listing pages, also the display preference order */
export const LISTING_SECTIONS: readonly ListingSection[] = [
  "new",
  "cross",
  "replace",
];

export interface ListingAuthor {
  /** Name as the listing shows it (the author link's text) */
  display: string;
  /**
   * Surname from arXiv's own split of the name (the link's `query`
   * parameter). Absent when the displayed name does not end with it; the
   * name is then kept as one field.
   */
  family?: string;
  /** The displayed name without the surname */
  given?: string;
}

/**
 * One paper as a listing page shows it. Title and abstract are the page's
 * text (arXiv has already turned part of the TeX into Unicode; <br> is a
 * line break, links are their text). A listing page shows at most the first
 * 100 authors of a longer author list.
 */
export interface ListingPageEntry {
  /** Canonical arXiv identifier, without version */
  id: string;
  /** Version from the entry's HTML link; only some entries have one */
  version?: number;
  title: string;
  authors: ListingAuthor[];
  abstract: string;
  comments?: string;
  journalRef?: string;
  primaryCategory: string;
  /** All categories of the paper, the primary one first */
  categories: string[];
  /** Section of the page the entry is in */
  section: ListingSection;
}

/** One section as one page shows it: "(… showing X of Y entries)" */
export interface ListingPageSection {
  section: ListingSection;
  /** Entries of the section on this page (X) */
  shown: number;
  /** Entries of the section on the whole day (Y) */
  total: number;
}

export type ListingPageKind = "new" | "catchup";

/** One /list/<x>/new or /catchup/<x>/<date> page, parsed and checked */
export interface ListingPage {
  kind: ListingPageKind;
  /** Listing date from the page header */
  date: IsoDate;
  /** "Total of N entries" of the whole day (0 on an empty page) */
  total: number;
  sections: ListingPageSection[];
  /** Entries in page order */
  entries: ListingPageEntry[];
  /** 1-based position of the page's first entry within the day */
  firstIndex: number;
  /**
   * The following page of the day: its `skip` on /new, its `page` number on
   * /catchup; null on the day's last page
   */
  next: number | null;
  /** /catchup: this page's number (1 when the day has one page) */
  pageNumber?: number;
  /**
   * /catchup: date of "Continue to the next day"; null when the page has no
   * such link (the latest announcement day). Absent on /new pages.
   */
  nextDay?: IsoDate | null;
}

/**
 * The pages of one category or archive for one announcement day, checked as
 * a whole (every page shows the same date, the pages add up to the day's
 * total, identifiers are unique).
 */
export interface SpecDayListing {
  /** Category or archive whose pages these are, e.g. "hep-ph", "math" */
  spec: string;
  date: IsoDate;
  source: ListingPageKind;
  total: number;
  entries: ListingPageEntry[];
  /** From the /catchup pages; absent for /new pages */
  nextDay?: IsoDate | null;
  /** When the pages were fetched (ms since the epoch) */
  fetchedAt: number;
}

/** A reading stream: the papers of one section on one category's pages */
export interface ListingStream {
  category: string;
  section: ListingSection;
  /**
   * Where the paper stands in that category's listing of the day: 0 for its
   * first entry, in page order (sorting in arXiv's order uses it)
   */
  position: number;
}

/**
 * A paper in the merged listing of a subscription for one announcement day
 * (the design's ArxivListingEntry). A paper appearing on several subscribed
 * pages is one entry that belongs to several streams.
 */
export interface ArxivListingEntry {
  id: string;
  version?: number;
  title: string;
  authors: ListingAuthor[];
  abstract: string;
  comments?: string;
  journalRef?: string;
  primaryCategory: string;
  categories: string[];
  /** Subscribed categories (or archives) on whose pages the paper appears */
  matchedCategories: string[];
  /**
   * Section the merged view shows the paper in when all sections are open;
   * `displaySection` gives it for other choices
   */
  section: ListingSection;
  /**
   * Every (category, section) the paper appears in, in the subscription's
   * order of the categories
   */
  streams: ListingStream[];
  announceDate: IsoDate;
}

/** Why a category's listing of a day could not be used */
export type ListingFailureReason =
  | "cancelled"
  | "timeout"
  | "offline"
  | "network"
  | "unavailable"
  | "forbidden"
  | "stopped"
  /** An HTTP status other than 200 */
  | "http"
  /** /catchup refused the date (older than arXiv's 90-day range) */
  | "out-of-range"
  /** The page could not be read or failed its checks */
  | "parse"
  /** The pages of the day do not add up (counts, identifiers, paging) */
  | "check"
  /** The day's pages showed different dates, also after one refetch */
  | "mixed-dates";

/** How one subscribed category (or archive) fared for one day */
export type SpecDayState =
  | {
      state: "complete";
      count: number;
      fromCache: boolean;
      /** Fetching failed; the listing is the copy kept in the cache */
      fetchFailed?: { reason: ListingFailureReason; message: string };
    }
  /**
   * The category's /new page shows another listing date than the day (it
   * has not switched yet, or already switched to a newer listing)
   */
  | { state: "stale"; shownDate: IsoDate }
  | { state: "failed"; reason: ListingFailureReason; message: string }
  /**
   * Not fetched yet: the day is shown while its categories are fetched one
   * after another
   */
  | { state: "loading" };

/** One announcement day of a subscription */
export interface DayListing {
  date: IsoDate;
  /**
   * complete: every subscribed category's pages were fetched and passed the
   * checks; incomplete: some were not (or are still being fetched); failed:
   * none was
   */
  status: "complete" | "incomplete" | "failed";
  /** Merged entries (only from categories whose state is complete) */
  entries: ArxivListingEntry[];
  /** State of each subscribed category, in subscription order */
  specs: { spec: string; state: SpecDayState }[];
  /** The newest announcement day known when the day was loaded */
  latest: boolean;
}

/**
 * The section a merged view shows a paper in, given which sections are
 * open: the first open one of its streams in the order new, cross, replace.
 * Null when none of its streams is open (the paper is not shown).
 */
export function displaySection(
  streams: readonly ListingStream[],
  openSections: ReadonlySet<ListingSection>,
): ListingSection | null {
  for (const section of LISTING_SECTIONS) {
    if (
      openSections.has(section) &&
      streams.some((stream) => stream.section === section)
    ) {
      return section;
    }
  }
  return null;
}
