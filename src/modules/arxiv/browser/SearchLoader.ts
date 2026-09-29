// ─────────────────────────────────────────────────────────────────────────────
// SearchLoader: searches of arXiv (its API) for the arXiv browser window. A
// search fetches one page of results, newest submission first; the pages
// after it are fetched when the reader turns to them, one request each. The
// results of each search are kept for the window's session: a search run
// again shows them at once, and Reload fetches them again (the results kept
// stay shown until the new ones arrive). Requests go through the plugin's
// API scheduler; a new search, Cancel, leaving the results and closing the
// window cancel the one going on.
// ─────────────────────────────────────────────────────────────────────────────

import { createAbortController } from "../../inspire/utils";
import {
  arxivSearchQuery,
  SEARCH_RESULT_LIMIT,
  searchArxiv,
  type ArxivApiEntry,
  type ArxivSearchAnswer,
} from "../arxivApi";
import type { ArxivListingEntry, ListingAuthor } from "../listingTypes";
import { COLLABORATION } from "./browserList";

export type SearchFailure = Extract<ArxivSearchAnswer, { ok: false }>;

/** Results start … start + count - 1 of a search_query */
export type FetchSearchPage = (
  query: string,
  start: number,
  count: number,
  signal?: AbortSignal,
) => Promise<ArxivSearchAnswer>;

/** A search's results as fetched so far */
interface SearchResults {
  query: string;
  entries: ArxivListingEntry[];
  /** Their identifiers: a paper is listed once */
  ids: Set<string>;
  /** Papers matching the search; undefined until the first page arrived */
  total?: number;
  /** Where the next page starts: results arXiv has sent */
  next: number;
  /** arXiv sent an empty page before reaching the total */
  exhausted: boolean;
}

/**
 * An author as the API names them (a whole name), in the listing's form: the
 * family name is the last word with the lower-case particles before it, as
 * BibTeX reads "First von Last" (Ids van der Werf: van der Werf), the given
 * names are the words before it. A single word and a collaboration's name
 * stay whole.
 */
export function apiAuthor(name: string): ListingAuthor {
  const display = name.trim();
  const words = display.split(/\s+/);
  if (words.length < 2 || COLLABORATION.test(display)) return { display };
  let start = words.length - 1;
  while (start > 1 && /^\p{Ll}/u.test(words[start - 1])) start--;
  return {
    display,
    family: words.slice(start).join(" "),
    given: words.slice(0, start).join(" "),
  };
}

/** A paper of a search's results, as the list shows papers of a day */
export function searchResultEntry(entry: ArxivApiEntry): ArxivListingEntry {
  return {
    id: entry.id,
    version: entry.version,
    title: entry.title,
    authors: entry.authors.map(apiAuthor),
    abstract: entry.abstract.replace(/\s+/g, " ").trim(),
    ...(entry.comments ? { comments: entry.comments } : {}),
    ...(entry.journalRef ? { journalRef: entry.journalRef } : {}),
    primaryCategory: entry.primaryCategory,
    categories: entry.categories,
    matchedCategories: [],
    section: "search",
    streams: [],
    submitted: entry.published,
  };
}

interface Run {
  controller: AbortController | undefined;
}

export class SearchLoader {
  /** The results of this window's searches, by search_query */
  private readonly kept = new Map<string, SearchResults>();
  private shown: SearchResults | null = null;
  private text = "";
  private run: Run | null = null;
  private lastFailure: SearchFailure | undefined;

  constructor(
    /** Called whenever results arrive or a request starts or ends */
    private readonly onChange: () => void,
    private readonly fetchPage: FetchSearchPage = (
      query,
      start,
      count,
      signal,
    ) => searchArxiv(query, start, count, { signal }),
  ) {}

  /** Whether the results of a search are shown (rather than the days) */
  get active(): boolean {
    return this.shown !== null;
  }

  /** What was typed for the search shown */
  get query(): string {
    return this.text;
  }

  /** The papers fetched, in arXiv's order */
  get entries(): readonly ArxivListingEntry[] {
    return this.shown?.entries ?? [];
  }

  /** Papers matching the search; undefined until its first page arrived */
  get total(): number | undefined {
    return this.shown?.total;
  }

  get running(): boolean {
    return this.run !== null;
  }

  /** Why the last request failed (cancelled, refused, …) */
  get failure(): SearchFailure | undefined {
    return this.lastFailure;
  }

  /** Whether results after those fetched can be fetched */
  get canFetchMore(): boolean {
    const results = this.shown;
    return Boolean(
      results &&
      results.total !== undefined &&
      !results.exhausted &&
      results.next < Math.min(results.total, SEARCH_RESULT_LIMIT),
    );
  }

  /**
   * Search arXiv for `text` (as typed in the search box): its first `count`
   * results, or those kept from this search before. `refresh`: fetched
   * again. Nothing to search for ends the search.
   */
  async search(text: string, count: number, refresh = false): Promise<void> {
    const query = arxivSearchQuery(text);
    if (!query) {
      this.clear();
      return;
    }
    // Enter again while its first page is on its way
    if (this.run && this.shown?.query === query && !refresh) return;
    this.text = text.trim();
    const kept = this.kept.get(query);
    if (kept && !refresh) {
      this.stop();
      this.lastFailure = undefined;
      this.shown = kept;
      this.onChange();
      return;
    }
    const results: SearchResults = {
      query,
      entries: [],
      ids: new Set(),
      next: 0,
      exhausted: false,
    };
    // Fetched again: the results kept stay until the new ones arrive
    if (!kept || this.shown !== kept) this.shown = results;
    await this.fetch(results, count);
  }

  /** The search shown, fetched again */
  refresh(count: number): Promise<void> {
    return this.shown ? this.search(this.text, count, true) : Promise.resolve();
  }

  /** The `count` results after those fetched */
  async more(count: number): Promise<void> {
    const results = this.shown;
    if (!results || this.run || !this.canFetchMore) return;
    await this.fetch(results, count);
  }

  /** Stop the request going on; the results fetched stay */
  cancel(): void {
    this.run?.controller?.abort();
  }

  /** Leave the results (back to the days) */
  clear(): void {
    this.stop();
    this.shown = null;
    this.text = "";
    this.lastFailure = undefined;
    this.onChange();
  }

  dispose(): void {
    this.stop();
  }

  /** Abandon the request going on: its answer is not used */
  private stop(): void {
    this.run?.controller?.abort();
    this.run = null;
  }

  private async fetch(results: SearchResults, count: number): Promise<void> {
    this.stop();
    const run: Run = { controller: createAbortController() };
    this.run = run;
    this.lastFailure = undefined;
    this.onChange();
    const start = results.next;
    let answer: ArxivSearchAnswer;
    try {
      answer = await this.fetchPage(
        results.query,
        start,
        Math.min(count, SEARCH_RESULT_LIMIT - start),
        run.controller?.signal,
      );
    } catch (error) {
      answer = { ok: false, reason: "network", message: String(error) };
    }
    if (this.run !== run) return;
    this.run = null;
    if (answer.ok) {
      results.total = answer.total;
      results.next = start + answer.entries.length;
      results.exhausted = answer.entries.length === 0;
      for (const entry of answer.entries) {
        // Pages move by a paper submitted meanwhile: listed once
        if (results.ids.has(entry.id)) continue;
        results.ids.add(entry.id);
        results.entries.push(searchResultEntry(entry));
      }
      this.kept.set(results.query, results);
      this.shown = results;
    } else {
      this.lastFailure = answer;
    }
    this.onChange();
  }
}
