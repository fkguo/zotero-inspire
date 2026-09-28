// ─────────────────────────────────────────────────────────────────────────────
// ListingService: loads the announcement days of a subscription, day by day,
// in three ways, and the days chosen in the arXiv browser's calendar.
//
//   new      /list/<x>/new of every subscribed category (or archive)
//   recent   the last five announcement days, dated by the index of
//            /list/math/recent (math has papers on every announcement day);
//            the newest day from /new, the others from /catchup
//   catch-up from a start day along the "Continue to the next day" links of
//            /catchup, the newest day from /new
//   days     chosen days, newest first: the newest day from /new, the
//            others from /catchup (loadDays)
//
// A category's pages belong to the day printed in their header. A day is
// complete when every subscribed category's pages show that day and pass the
// checks of listingParser. /new pages that show an older listing than the
// others (the announcement switched while loading) are fetched once more;
// pages of two listings are never joined into one day. Days already fetched
// come from the cache; when a fetch fails, a cached copy is used instead.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../package.json";
import {
  addDays,
  earliestCatchupDate,
  isWithinRetention,
  latestScheduledListingDate,
  nextListingWeekday,
  scheduledAnnouncementBetween,
  type IsoDate,
} from "./arxivDates";
import { subscriptionPageSpecs } from "./arxivCategories";
import {
  ARXIV_WEB_INTERVAL_MS,
  ArxivFetchError,
  getArxivWebScheduler,
  systemClock,
  type ArxivScheduler,
  type Clock,
} from "./arxivFetch";
import {
  assembleSpecDay,
  ListingParseError,
  parseCatchupPage,
  parseNewPage,
  parseRecentIndex,
} from "./listingParser";
import {
  LocalCacheListingStore,
  type ListingStore,
  type NewPageMarker,
} from "./listingStore";
import {
  displaySection,
  LISTING_SECTIONS,
  type ArxivListingEntry,
  type DayListing,
  type ListingFailureReason,
  type ListingPage,
  type ListingPageKind,
  type SpecDayListing,
  type SpecDayState,
} from "./listingTypes";

const ARXIV = "https://arxiv.org";

/** Entries per /new page: the most arXiv shows at once */
const NEW_PAGE_SIZE = 2000;

/**
 * A /new page or recent index that does not show the listing the schedule
 * expects yet (arXiv announcing late) is fetched again after this long
 */
export const NEW_PAGE_REUSE_MS = 10 * 60 * 1000;

/** The archive whose recent index dates the announcement days */
const INDEX_ARCHIVE = "math";

/** Days the recent mode shows */
const RECENT_DAYS = 5;

/** Failures after which no further request of the run is sent */
const STOPPING: ReadonlySet<ListingFailureReason> = new Set([
  "cancelled",
  "forbidden",
  "unavailable",
  "stopped",
]);

const ALL_SECTIONS = new Set(LISTING_SECTIONS);

export interface ListingServiceOptions {
  scheduler?: ArxivScheduler;
  store?: ListingStore;
  clock?: Clock;
  /** Parses a page's HTML (Zotero: DOMParser) */
  parseHtml?: (html: string) => Document;
  /** Entries per /new page (tests use smaller pages) */
  newPageSize?: number;
}

export interface ListingLoadOptions {
  signal?: AbortSignal;
  /** Called with each day as soon as it is loaded */
  onDay?: (day: DayListing) => void;
  /**
   * Fetch the recent index and the /new pages again even when the cached
   * copies are recent enough (the user's "retry", e.g. when the newest
   * listing is still the previous one)
   */
  refresh?: boolean;
}

export interface ListingLoadResult {
  /** The days in the order they were loaded */
  days: DayListing[];
  /**
   * Loading ended early: arXiv refused or was unavailable, the run was
   * cancelled, or (catch-up) every page of a day failed, so the next day is
   * unknown. `date` is the day being loaded.
   */
  stopped?: {
    reason: ListingFailureReason;
    message: string;
    date?: IsoDate;
  };
  /**
   * The newest listing is older than the latest scheduled announcement
   * (arXiv may have postponed it)
   */
  previousIssue?: boolean;
  /**
   * The newest announcement day known (recent index or /new header).
   * Catch-up loads no day when its start is later than this.
   */
  newestDay?: IsoDate;
  /** Catch-up: the start was earlier than arXiv serves and was moved here */
  clampedStart?: IsoDate;
  /**
   * Catch-up: the start day had no announcement (a holiday); loading began
   * with the next announcement day
   */
  noAnnouncementOn?: IsoDate;
  /** Chosen days: those that had no announcement (holidays), not shown */
  noAnnouncementDays?: IsoDate[];
  /**
   * Recent and chosen days, when the run stopped: the days it was to load and
   * had not, newest first (loading them goes on with the run)
   */
  notLoaded?: IsoDate[];
}

type SpecResult =
  | {
      ok: true;
      listing: SpecDayListing;
      fromCache: boolean;
      /** The fetch failed and this is the copy from the cache */
      fetchFailed?: { reason: ListingFailureReason; message: string };
    }
  | { ok: false; reason: ListingFailureReason; message: string };

type SpecFailure = Extract<SpecResult, { ok: false }>;

interface LatestBatch {
  /** Newest listing date seen (null when nothing is known at all) */
  date: IsoDate | null;
  results: Map<string, SpecResult>;
}

/** The state of one loading run */
class Run {
  readonly days: DayListing[] = [];
  stopped: ListingLoadResult["stopped"];
  previousIssue?: boolean;
  newestDay?: IsoDate;
  clampedStart?: IsoDate;
  noAnnouncementOn?: IsoDate;
  noAnnouncementDays?: IsoDate[];
  /** The days the run is to load (recent, chosen days), newest first */
  planned?: IsoDate[];
  /** Chosen days found not announced yet */
  readonly notAnnounced: IsoDate[] = [];

  constructor(private readonly options: ListingLoadOptions) {}

  get signal(): AbortSignal | undefined {
    return this.options.signal;
  }

  get refresh(): boolean {
    return this.options.refresh === true;
  }

  stop(reason: ListingFailureReason, message: string, date?: IsoDate): void {
    this.stopped ??= date ? { reason, message, date } : { reason, message };
  }

  emit(day: DayListing): void {
    if (this.signal?.aborted || this.stopped?.reason === "cancelled") return;
    this.days.push(day);
    try {
      this.options.onDay?.(day);
    } catch (error) {
      Zotero.debug(`[${config.addonName}] arXiv listing onDay: ${error}`);
    }
  }

  result(): ListingLoadResult {
    const result: ListingLoadResult = { days: this.days };
    if (this.stopped) result.stopped = this.stopped;
    if (this.previousIssue !== undefined) {
      result.previousIssue = this.previousIssue;
    }
    if (this.newestDay) result.newestDay = this.newestDay;
    if (this.clampedStart) result.clampedStart = this.clampedStart;
    if (this.noAnnouncementOn) result.noAnnouncementOn = this.noAnnouncementOn;
    if (this.noAnnouncementDays) {
      result.noAnnouncementDays = this.noAnnouncementDays;
    }
    if (this.stopped && this.planned) {
      const done = new Set([
        ...this.days.map((day) => day.date),
        ...(this.noAnnouncementDays ?? []),
        ...this.notAnnounced,
      ]);
      result.notLoaded = this.planned.filter((date) => !done.has(date));
    }
    return result;
  }
}

function failure(reason: ListingFailureReason, message: string): SpecFailure {
  return { ok: false, reason, message };
}

function fetchFailure(error: unknown): SpecFailure {
  if (error instanceof ArxivFetchError)
    return failure(error.kind, error.message);
  return failure("network", String(error));
}

export class ListingService {
  private readonly scheduler: ArxivScheduler;
  private readonly store: ListingStore;
  private readonly clock: Clock;
  private readonly parseHtml: (html: string) => Document;
  private readonly newPageSize: number;

  constructor(options: ListingServiceOptions = {}) {
    this.scheduler = options.scheduler ?? getArxivWebScheduler();
    this.store = options.store ?? new LocalCacheListingStore();
    this.clock = options.clock ?? systemClock;
    this.parseHtml =
      options.parseHtml ??
      ((html) => new DOMParser().parseFromString(html, "text/html"));
    this.newPageSize = options.newPageSize ?? NEW_PAGE_SIZE;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The three modes
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The newest announcement day of a subscription. In all modes the
   * subscription is a list of categories and whole archives; an alias counts
   * as its canonical category (`subscriptionPageSpecs`).
   */
  async loadNew(
    subscription: readonly string[],
    options: ListingLoadOptions = {},
  ): Promise<ListingLoadResult> {
    const specs = subscriptionPageSpecs(subscription);
    const run = new Run(options);
    const batch = await this.latestBatch(run, specs, null);
    if (batch.date) {
      run.emit(this.dayFromBatch(batch, batch.date, specs));
      this.notePreviousIssue(run, batch.date);
    } else {
      run.stop(
        this.firstFailure(batch)?.reason ?? "network",
        "No listing could be fetched",
      );
    }
    return run.result();
  }

  /** The last five announcement days, newest first */
  async loadRecent(
    subscription: readonly string[],
    options: ListingLoadOptions = {},
  ): Promise<ListingLoadResult> {
    const specs = subscriptionPageSpecs(subscription);
    const run = new Run(options);
    const index = await this.recentIndex(run);
    if (!index.ok) {
      run.stop(index.reason, index.message);
      return run.result();
    }
    let dates = index.dates.slice(0, RECENT_DAYS);
    const batch = await this.latestBatch(run, specs, dates[0]);
    const latest = batch.date ?? dates[0];
    if (latest > dates[0] && !run.stopped) {
      // A newer listing appeared than the index knows: the days in between
      // come from the "next day" links, starting from the index's newest day
      const between = await this.daysBetween(run, specs, dates[0], latest);
      dates = [latest, ...between.reverse(), ...dates].slice(0, RECENT_DAYS);
    }
    // The five days are settled only when /new told the newest day (a page
    // answered) and the links between answered
    const told = [...batch.results.values()].some(
      (result) => result.ok && !result.fetchFailed,
    );
    if (told && !run.stopped) run.planned = dates;
    run.emit(this.dayFromBatch(batch, latest, specs));
    this.notePreviousIssue(run, latest);

    for (let i = 1; i < dates.length && !run.stopped; i++) {
      const { day } = await this.loadPastDay(run, specs, dates[i], {
        batch,
        expectedNextDay: dates[i - 1],
      });
      run.emit(day);
    }
    return run.result();
  }

  /**
   * Day by day from `start` to the newest announcement day. Loading stops
   * when every page of a day fails (the next day is then unknown).
   */
  async loadCatchup(
    subscription: readonly string[],
    start: IsoDate,
    options: ListingLoadOptions = {},
  ): Promise<ListingLoadResult> {
    const specs = subscriptionPageSpecs(subscription);
    const run = new Run(options);
    const index = await this.recentIndex(run);
    if (!index.ok) {
      run.stop(index.reason, index.message);
      return run.result();
    }
    let latest = index.dates[0];
    run.newestDay = latest;

    let date = start;
    const earliest = earliestCatchupDate(this.clock.now());
    if (date < earliest) {
      date = earliest;
      run.clampedStart = earliest;
    }
    date = nextListingWeekday(date);

    let batch: LatestBatch | null = null;
    if (date > latest && date <= latestScheduledListingDate(this.clock.now())) {
      // The start day's announcement is due, but right after an
      // announcement the recent index can still show the previous day while
      // /new already shows the start day. A cached /new page answers this
      // only when it is recent enough and shows the start day or later.
      const startDay = date;
      batch = await this.latestBatch(
        run,
        specs,
        latest,
        (marker) =>
          !run.refresh &&
          this.isFresh(marker.fetchedAt, marker.date) &&
          marker.date >= startDay,
      );
      if (batch.date) latest = batch.date;
      run.newestDay = latest;
      // "Not announced yet" needs every category's /new page
      const unanswered = this.firstFailure(batch);
      if (date > latest && unanswered && !run.stopped) {
        run.stop(
          unanswered.reason,
          `Could not check whether ${date} has been announced: ${unanswered.message}`,
          date,
        );
      }
    }
    let first = true;
    while (!run.stopped && date <= latest) {
      if (date === latest) {
        if (batch?.date !== latest) {
          batch = await this.latestBatch(run, specs, latest);
        }
        if (!batch.date || batch.date === latest) {
          run.emit(this.dayFromBatch(batch, latest, specs));
          break;
        }
        // /new moved on to a newer listing while loading: `date` is now a
        // past day, and the newer one is the last day to load
        latest = batch.date;
        run.newestDay = latest;
      }
      const { day, listings } = await this.loadPastDay(run, specs, date, {
        batch,
      });
      // Days reached by next-day links or from the index are announcement
      // days; the start day may be a holiday
      const check = first
        ? await this.checkEmptyDay(run, day, listings, index.dates)
        : { shown: true as const };
      first = false;
      if (check.shown === "stop") break;
      if (!check.shown) {
        if (!check.nextDay || check.nextDay <= date) break;
        date = check.nextDay > latest ? latest : check.nextDay;
        continue;
      }
      run.emit(day);
      if (run.stopped) break;
      if (day.status === "failed") {
        const failed = day.specs.find((item) => item.state.state === "failed");
        run.stop(
          failed?.state.state === "failed" ? failed.state.reason : "network",
          "No page of this day could be fetched; later days wait for a retry",
          date,
        );
        break;
      }
      const next = await this.nextDayAfter(
        run,
        specs,
        date,
        listings,
        index.dates,
      );
      if (!next || next <= date) break;
      // A link past the newest day known is not followed
      date = next > latest ? latest : next;
    }
    // Also when no day was loaded (the start is later than the newest day)
    this.notePreviousIssue(run, latest);
    return run.result();
  }

  /**
   * Chosen days, newest first (the days picked in the arXiv browser's
   * calendar): the newest announcement day from /new, the others from
   * /catchup. A chosen day that had no announcement (a holiday) is not shown
   * and is listed in `noAnnouncementDays`; a day not announced yet is left
   * out (`previousIssue` tells when the newest listing is late). The days
   * are independent: one whose pages all fail is shown as failed and the
   * others are still loaded.
   */
  async loadDays(
    subscription: readonly string[],
    dates: readonly IsoDate[],
    options: ListingLoadOptions & {
      /**
       * The newest announcement day a run before this one found (/new
       * showed it): chosen days older than it need no /new
       */
      newestDay?: IsoDate;
    } = {},
  ): Promise<ListingLoadResult> {
    const specs = subscriptionPageSpecs(subscription);
    const run = new Run(options);
    const chosen = [...new Set(dates)].sort().reverse();
    if (!chosen.length) return run.result();
    const index = await this.recentIndex(run);
    if (!index.ok) {
      run.stop(index.reason, index.message);
      return run.result();
    }
    run.planned = chosen;
    let latest = index.dates[0];
    if (options.newestDay && options.newestDay > latest) {
      latest = options.newestDay;
    }
    // /new tells whether a chosen day is the newest one (it can be newer
    // than the index right after an announcement)
    let batch: LatestBatch | null = null;
    if (chosen[0] >= latest) {
      batch = await this.latestBatch(run, specs, latest);
      if (batch.date) latest = batch.date;
    }
    this.notePreviousIssue(run, latest);
    for (const date of chosen) {
      if (run.signal?.aborted) run.stop("cancelled", "Loading cancelled");
      if (run.stopped) break;
      if (date > latest) {
        run.notAnnounced.push(date);
        continue;
      }
      if (date === latest && batch) {
        run.emit(this.dayFromBatch(batch, latest, specs));
        continue;
      }
      const { day, listings } = await this.loadPastDay(run, specs, date, {
        batch,
      });
      const check = await this.checkEmptyDay(run, day, listings, index.dates);
      if (check.shown === "stop") break;
      if (check.shown) run.emit(day);
      else (run.noAnnouncementDays ??= []).push(date);
    }
    return run.result();
  }

  /**
   * Load one day again (the "retry" of a day that was not complete):
   * complete categories come from the cache, the others are fetched.
   * `latest`: the day was the newest announcement day (loaded from /new).
   */
  async reloadDay(
    subscription: readonly string[],
    date: IsoDate,
    options: ListingLoadOptions & { latest?: boolean } = {},
  ): Promise<ListingLoadResult> {
    const specs = subscriptionPageSpecs(subscription);
    const run = new Run(options);
    if (options.latest) {
      // A category whose /new already showed this day keeps its copy; the
      // others are fetched again
      const batch = await this.latestBatch(
        run,
        specs,
        date,
        (marker) => marker.date === date,
      );
      if (!batch.date || batch.date === date) {
        run.emit(this.dayFromBatch(batch, date, specs));
        return run.result();
      }
      run.emit((await this.loadPastDay(run, specs, date, { batch })).day);
    } else {
      const { day, listings } = await this.loadPastDay(run, specs, date, {});
      const index = await this.store.getRecentIndex(INDEX_ARCHIVE);
      const check = await this.checkEmptyDay(
        run,
        day,
        listings,
        index?.dates ?? [],
      );
      if (check.shown === true) run.emit(day);
    }
    return run.result();
  }

  /**
   * A past day on which no subscribed category shows a paper might be a day
   * without announcement (a holiday looks the same), unless it is one of the
   * recent index's days. The math archive, which has papers on every
   * announcement day, tells: from its page when the subscription has it,
   * else from one request. A day without announcement is not shown
   * (`shown: false`, with the next announcement day); when the question
   * cannot be answered, loading stops without showing the day.
   */
  private async checkEmptyDay(
    run: Run,
    day: DayListing,
    listings: readonly SpecDayListing[],
    indexDates: readonly IsoDate[],
  ): Promise<
    | { shown: true }
    | { shown: false; nextDay: IsoDate | null }
    | { shown: "stop" }
  > {
    if (
      day.status === "failed" ||
      day.entries.length > 0 ||
      indexDates.includes(day.date)
    ) {
      return { shown: true };
    }
    const ownMath = listings.find(
      (listing) =>
        listing.spec === INDEX_ARCHIVE && listing.source === "catchup",
    );
    const math = ownMath
      ? {
          ok: true as const,
          announced: ownMath.total > 0,
          nextDay: ownMath.nextDay ?? null,
        }
      : await this.announcementOn(run, day.date);
    if (!math.ok) {
      run.stop(
        math.reason,
        `Could not tell whether ${day.date} had an announcement: ${math.message}`,
        day.date,
      );
      return { shown: "stop" };
    }
    if (math.announced) return { shown: true };
    run.noAnnouncementOn = day.date;
    return { shown: false, nextDay: math.nextDay };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Days
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * /new of every spec. Specs whose page shows an older listing than the
   * newest one seen (or whose pages changed listing while paging) are fetched
   * once more.
   */
  private async latestBatch(
    run: Run,
    specs: readonly string[],
    knownLatest: IsoDate | null,
    reuse: (marker: NewPageMarker) => boolean = (marker) =>
      !run.refresh && this.isFresh(marker.fetchedAt, marker.date),
  ): Promise<LatestBatch> {
    const results = new Map<string, SpecResult>();
    for (const spec of specs) {
      results.set(
        spec,
        await this.guarded(run, () => this.fetchNew(run, spec, reuse)),
      );
    }
    const newest = () => {
      let date = knownLatest;
      for (const result of results.values()) {
        if (result.ok && (!date || result.listing.date > date)) {
          date = result.listing.date;
        }
      }
      return date;
    };

    const date = newest();
    for (const spec of specs) {
      const result = results.get(spec)!;
      const behind =
        (result.ok && date !== null && result.listing.date < date) ||
        (!result.ok && result.reason === "mixed-dates");
      if (behind && !run.stopped) {
        results.set(
          spec,
          await this.guarded(run, () => this.fetchNew(run, spec, () => false)),
        );
      }
    }
    return { date: newest(), results };
  }

  /** The day `date` from a batch of /new results */
  private dayFromBatch(
    batch: LatestBatch,
    date: IsoDate,
    specs: readonly string[],
  ): DayListing {
    const states = specs.map((spec): DayState => {
      const result = batch.results.get(spec)!;
      if (result.ok && result.listing.date !== date) {
        // A cached copy of another day stood in for a failed fetch
        if (result.fetchFailed)
          return { spec, result: { ok: false, ...result.fetchFailed } };
        return {
          spec,
          state: { state: "stale", shownDate: result.listing.date },
        };
      }
      return { spec, result };
    });
    return this.buildDay(date, states, true);
  }

  /**
   * A day older than the newest one: each spec from the batch of /new pages
   * when its page shows this day, else from the cache, else from /catchup.
   */
  private async loadPastDay(
    run: Run,
    specs: readonly string[],
    date: IsoDate,
    context: { batch?: LatestBatch | null; expectedNextDay?: IsoDate },
  ): Promise<{ day: DayListing; listings: SpecDayListing[] }> {
    const states: DayState[] = [];
    const listings: SpecDayListing[] = [];
    for (const spec of specs) {
      const fromBatch = context.batch?.results.get(spec);
      let result: SpecResult =
        fromBatch?.ok && fromBatch.listing.date === date
          ? fromBatch
          : await this.guarded(run, () =>
              this.fetchCatchup(run, spec, date, true),
            );
      const nextDay = result.ok ? result.listing.nextDay : undefined;
      if (
        result.ok &&
        nextDay &&
        context.expectedNextDay &&
        nextDay !== context.expectedNextDay
      ) {
        result = failure(
          "check",
          `The page's next day is ${nextDay}, the date index says ${context.expectedNextDay}`,
        );
      }
      if (result.ok) listings.push(result.listing);
      states.push({ spec, result });
    }
    return { day: this.buildDay(date, states, false), listings };
  }

  /** Merge the specs' listings of one day */
  private buildDay(
    date: IsoDate,
    states: DayState[],
    latest: boolean,
  ): DayListing {
    const entries = new Map<string, ArxivListingEntry>();
    const specStates: DayListing["specs"] = [];
    for (const item of states) {
      if ("state" in item) {
        specStates.push({ spec: item.spec, state: item.state });
        continue;
      }
      const { spec, result } = item;
      if (!result.ok) {
        specStates.push({
          spec,
          state: {
            state: "failed",
            reason: result.reason,
            message: result.message,
          },
        });
        continue;
      }
      const complete: SpecDayState = {
        state: "complete",
        count: result.listing.entries.length,
        fromCache: result.fromCache,
      };
      if (result.fetchFailed) complete.fetchFailed = result.fetchFailed;
      specStates.push({ spec, state: complete });

      for (const [position, pageEntry] of result.listing.entries.entries()) {
        const stream = { category: spec, section: pageEntry.section, position };
        const entry = entries.get(pageEntry.id);
        if (!entry) {
          const { section, ...fields } = pageEntry;
          entries.set(pageEntry.id, {
            ...fields,
            matchedCategories: [spec],
            section,
            streams: [stream],
            announceDate: date,
          });
          continue;
        }
        if (
          !entry.streams.some(
            (known) =>
              known.category === spec && known.section === stream.section,
          )
        ) {
          entry.streams.push(stream);
        }
        if (!entry.matchedCategories.includes(spec)) {
          entry.matchedCategories.push(spec);
        }
        entry.section = displaySection(entry.streams, ALL_SECTIONS)!;
      }
    }

    const completeCount = specStates.filter(
      (item) => item.state.state === "complete",
    ).length;
    const failedCount = specStates.filter(
      (item) => item.state.state === "failed",
    ).length;
    return {
      date,
      status:
        completeCount === specStates.length
          ? "complete"
          : failedCount === specStates.length
            ? "failed"
            : "incomplete",
      entries: Array.from(entries.values()),
      specs: specStates,
      latest,
    };
  }

  /**
   * The announcement day after `date`: from the day's /catchup pages, else
   * from the recent index when `date` is one of its days (the index lists
   * consecutive announcement days, newest first), else from one more
   * /catchup page.
   */
  private async nextDayAfter(
    run: Run,
    specs: readonly string[],
    date: IsoDate,
    listings: readonly SpecDayListing[],
    indexDates: readonly IsoDate[],
  ): Promise<IsoDate | null> {
    const linked = listings.find((listing) => listing.nextDay)?.nextDay;
    if (linked) return linked;
    const position = indexDates.indexOf(date);
    if (position > 0) return indexDates[position - 1];
    let lastFailure: SpecFailure | null = null;
    for (const spec of specs) {
      if (run.stopped) return null;
      const result = await this.guarded(run, () =>
        this.fetchCatchup(run, spec, date, false),
      );
      // Only a page just fetched shows the current link
      if (result.ok && !result.fetchFailed)
        return result.listing.nextDay ?? null;
      lastFailure = result.ok
        ? failure(result.fetchFailed!.reason, result.fetchFailed!.message)
        : result;
    }
    if (lastFailure) {
      run.stop(
        lastFailure.reason,
        `The announcement day after ${date} could not be found: ${lastFailure.message}`,
        date,
      );
    }
    return null;
  }

  /** The announcement days strictly between `from` and `to`, oldest first */
  private async daysBetween(
    run: Run,
    specs: readonly string[],
    from: IsoDate,
    to: IsoDate,
  ): Promise<IsoDate[]> {
    const days: IsoDate[] = [];
    let date = from;
    // Only when a weekday lies between can a listing lie between (Friday
    // to Monday, Thursday to Friday need no link)
    while (!run.stopped && nextListingWeekday(addDays(date, 1)) < to) {
      let next: IsoDate | null = null;
      let found = false;
      let lastFailure: SpecFailure | null = null;
      for (const spec of specs) {
        const cached = await this.store.getDay(spec, date);
        if (cached?.source === "catchup" && cached.nextDay) {
          next = cached.nextDay;
          found = true;
          break;
        }
        const result = await this.guarded(run, () =>
          this.fetchCatchup(run, spec, date, false),
        );
        // Only a page just fetched shows the current link
        if (result.ok && !result.fetchFailed) {
          next = result.listing.nextDay ?? null;
          found = true;
          break;
        }
        lastFailure = result.ok
          ? failure(result.fetchFailed!.reason, result.fetchFailed!.message)
          : result;
        if (run.stopped) break;
      }
      if (!found) {
        // Without the link the days up to `to` are unknown: no date list
        // with a gap
        if (lastFailure) {
          run.stop(
            lastFailure.reason,
            `The announcement day after ${date} could not be found: ${lastFailure.message}`,
            date,
          );
        }
        break;
      }
      if (!next || next >= to || next <= date) break;
      days.push(next);
      date = next;
    }
    return days;
  }

  private notePreviousIssue(run: Run, latest: IsoDate): void {
    run.newestDay = latest;
    run.previousIssue = latest < latestScheduledListingDate(this.clock.now());
  }

  /** The first failed fetch of a batch (also one a cached copy stood in for) */
  private firstFailure(batch: LatestBatch): SpecFailure | null {
    for (const result of batch.results.values()) {
      if (!result.ok) return result;
      if (result.fetchFailed)
        return failure(result.fetchFailed.reason, result.fetchFailed.message);
    }
    return null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // One spec's pages
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Runs `fetch` unless the run has stopped; a failure that ends the run
   * stops it
   */
  private async guarded(
    run: Run,
    fetch: () => Promise<SpecResult>,
  ): Promise<SpecResult> {
    if (run.signal?.aborted) run.stop("cancelled", "Loading cancelled");
    if (run.stopped) {
      return failure(run.stopped.reason, "Not requested: loading stopped");
    }
    const result = await fetch();
    // Also when a cached copy stands in for the failed fetch
    const failed = result.ok ? result.fetchFailed : result;
    if (failed && STOPPING.has(failed.reason)) {
      run.stop(failed.reason, failed.message);
    }
    return result;
  }

  /**
   * Whether a cached /new page or recent index, fetched at `fetchedAt` and
   * showing the listing of `date` as its newest, will do: not once a
   * scheduled announcement time has passed since; until then always when it
   * shows the listing the schedule expects (it cannot change before the next
   * announcement), otherwise for NEW_PAGE_REUSE_MS
   */
  private isFresh(fetchedAt: number, date: IsoDate | undefined): boolean {
    const now = this.clock.now();
    if (scheduledAnnouncementBetween(fetchedAt, now)) return false;
    if (date !== undefined && date >= latestScheduledListingDate(now)) {
      return true;
    }
    return now - fetchedAt < NEW_PAGE_REUSE_MS;
  }

  /**
   * A spec's /new pages; the cached copy is used instead when `reuse` says
   * the time and date it was fetched with are good enough
   */
  private async fetchNew(
    run: Run,
    spec: string,
    reuse: (marker: NewPageMarker) => boolean,
  ): Promise<SpecResult> {
    const marker = await this.store.getNewMarker(spec);
    const cached =
      marker && isWithinRetention(marker.date, this.clock.now())
        ? await this.store.getDay(spec, marker.date)
        : null;
    if (cached && marker && reuse(marker)) {
      return { ok: true, listing: cached, fromCache: true };
    }
    const fetched = await this.fetchPages(run, spec, { kind: "new" });
    if (fetched.ok) {
      await this.store.putDay(fetched.listing);
      await this.store.putNewMarker(spec, {
        date: fetched.listing.date,
        fetchedAt: fetched.listing.fetchedAt,
      });
      return fetched;
    }
    if (cached && fetched.reason !== "cancelled") {
      return {
        ok: true,
        listing: cached,
        fromCache: true,
        fetchFailed: { reason: fetched.reason, message: fetched.message },
      };
    }
    return fetched;
  }

  /** A spec's /catchup pages of `date`; `reuse`: a cached copy will do */
  private async fetchCatchup(
    run: Run,
    spec: string,
    date: IsoDate,
    reuse: boolean,
  ): Promise<SpecResult> {
    const cached = isWithinRetention(date, this.clock.now())
      ? await this.store.getDay(spec, date)
      : null;
    if (reuse && cached) return { ok: true, listing: cached, fromCache: true };
    const fetched = await this.fetchPages(run, spec, { kind: "catchup", date });
    if (fetched.ok) {
      await this.store.putDay(fetched.listing);
      return fetched;
    }
    if (cached && fetched.reason !== "cancelled") {
      return {
        ok: true,
        listing: cached,
        fromCache: true,
        fetchFailed: { reason: fetched.reason, message: fetched.message },
      };
    }
    return fetched;
  }

  /** Fetch, parse and check all pages of a spec for one day */
  private async fetchPages(
    run: Run,
    spec: string,
    target: { kind: "new" } | { kind: "catchup"; date: IsoDate },
  ): Promise<SpecResult> {
    const fetchedAt = this.clock.now();
    const pages: ListingPage[] = [];
    let next: number | null = target.kind === "new" ? 0 : 1;
    while (next !== null) {
      const url =
        target.kind === "new"
          ? `${ARXIV}/list/${spec}/new?skip=${next}&show=${this.newPageSize}`
          : `${ARXIV}/catchup/${spec}/${target.date}?abs=True${next > 1 ? `&page=${next}` : ""}`;
      let text: string;
      try {
        const response = await this.scheduler.request(url, {
          signal: run.signal,
        });
        if (response.status !== 200) {
          if (
            target.kind === "catchup" &&
            response.status === 400 &&
            /only allowed for past \d+ days/.test(response.text)
          ) {
            return failure(
              "out-of-range",
              `arXiv serves no catch-up for ${target.date}`,
            );
          }
          return failure("http", `HTTP ${response.status} for ${url}`);
        }
        text = response.text;
      } catch (error) {
        return fetchFailure(error);
      }

      let page: ListingPage;
      try {
        const doc = this.parseHtml(text);
        page =
          target.kind === "new" ? parseNewPage(doc) : parseCatchupPage(doc);
      } catch (error) {
        return failure("parse", `${url}: ${messageOf(error)}`);
      }
      if (target.kind === "catchup" && page.date !== target.date) {
        return failure("parse", `${url} shows ${page.date}`);
      }
      if (pages.length > 0 && page.date !== pages[0].date) {
        return failure(
          "mixed-dates",
          `${spec}: pages of ${pages[0].date} and ${page.date}`,
        );
      }
      if (page.next !== null && page.next <= next) {
        return failure("parse", `${url}: the next page does not follow`);
      }
      pages.push(page);
      next = page.next;
    }
    try {
      return {
        ok: true,
        listing: assembleSpecDay(spec, pages, fetchedAt),
        fromCache: false,
      };
    } catch (error) {
      return failure("check", `${spec}: ${messageOf(error)}`);
    }
  }

  /**
   * Whether `date` was an announcement day, from the catch-up page of the
   * math archive (without abstracts), and the next announcement day
   */
  private async announcementOn(
    run: Run,
    date: IsoDate,
  ): Promise<
    { ok: true; announced: boolean; nextDay: IsoDate | null } | SpecFailure
  > {
    if (run.signal?.aborted) run.stop("cancelled", "Loading cancelled");
    if (run.stopped) {
      return failure(run.stopped.reason, "Not requested: loading stopped");
    }
    const url = `${ARXIV}/catchup/${INDEX_ARCHIVE}/${date}?abs=False`;
    try {
      const response = await this.scheduler.request(url, {
        signal: run.signal,
      });
      if (response.status !== 200) {
        return failure("http", `HTTP ${response.status} for ${url}`);
      }
      const page = parseCatchupPage(this.parseHtml(response.text));
      if (page.date !== date) {
        return failure("parse", `${url} shows ${page.date}`);
      }
      return {
        ok: true,
        announced: page.total > 0,
        nextDay: page.nextDay ?? null,
      };
    } catch (error) {
      if (error instanceof ListingParseError) {
        return failure("parse", `${url}: ${error.message}`);
      }
      const failed = fetchFailure(error);
      if (STOPPING.has(failed.reason)) run.stop(failed.reason, failed.message);
      return failed;
    }
  }

  /** The dates of the recent index (newest first), cached like /new */
  private async recentIndex(
    run: Run,
  ): Promise<{ ok: true; dates: IsoDate[] } | SpecFailure> {
    const cached = await this.store.getRecentIndex(INDEX_ARCHIVE);
    if (
      cached &&
      !run.refresh &&
      this.isFresh(cached.fetchedAt, cached.dates[0])
    ) {
      return { ok: true, dates: cached.dates };
    }
    const fetchedAt = this.clock.now();
    const url = `${ARXIV}/list/${INDEX_ARCHIVE}/recent?show=25`;
    let fetched: { ok: true; dates: IsoDate[] } | SpecFailure;
    try {
      const response = await this.scheduler.request(url, {
        signal: run.signal,
      });
      if (response.status !== 200) {
        fetched = failure("http", `HTTP ${response.status} for ${url}`);
      } else {
        fetched = {
          ok: true,
          dates: parseRecentIndex(this.parseHtml(response.text)),
        };
      }
    } catch (error) {
      fetched =
        error instanceof ListingParseError
          ? failure("parse", `${url}: ${error.message}`)
          : fetchFailure(error);
    }
    if (fetched.ok) {
      await this.store.putRecentIndex(INDEX_ARCHIVE, {
        dates: fetched.dates,
        fetchedAt,
      });
      return fetched;
    }
    if (STOPPING.has(fetched.reason)) {
      run.stop(fetched.reason, fetched.message);
    }
    if (cached && fetched.reason !== "cancelled") {
      return { ok: true, dates: cached.dates };
    }
    return fetched;
  }
}

/** A spec's state for buildDay: fetched (or not), or a stale /new page */
type DayState =
  | { spec: string; result: SpecResult }
  | { spec: string; state: SpecDayState };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─────────────────────────────────────────────────────────────────────────────
// Request estimate (shown when a subscription is set up or changed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Requests to arxiv.org a first load needs and the shortest time it can take
 * at 15 s per request: new N, recent 1 + 5N, catch-up 1 + N per day
 * (N = subscribed categories or archives, days of the catch-up).
 */
export function estimateListingRequests(
  mode: ListingPageKind | "recent",
  specCount: number,
  catchupDays = 1,
): { requests: number; minimumMs: number } {
  const requests =
    mode === "new"
      ? specCount
      : mode === "recent"
        ? 1 + RECENT_DAYS * specCount
        : 1 + catchupDays * specCount;
  return {
    requests,
    minimumMs: Math.max(0, requests - 1) * ARXIV_WEB_INTERVAL_MS,
  };
}
