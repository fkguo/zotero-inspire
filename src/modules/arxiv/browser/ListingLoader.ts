// ─────────────────────────────────────────────────────────────────────────────
// ListingLoader: runs the ListingService for the arXiv browser, one run at a
// time — loading the chosen days, retrying one day, or going on with the days
// a run that stopped had not loaded. The days arrive one by one, newest
// first, each shown as soon as its first categories are fetched and filled
// in as the others arrive; a new load cancels the run before it and starts
// from an empty list.
//
//   newest  the newest announcement day (arXiv's /new pages)
//   recent  the last five announcement days
//   week    the announcement days from Monday of the week of the newest
//           scheduled listing up to that listing
//   days    days picked in the calendar
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { createAbortController } from "../../inspire/utils";
import {
  addDays,
  latestScheduledListingDate,
  weekdayOf,
  type IsoDate,
} from "../arxivDates";
import { systemClock, type Clock } from "../arxivFetch";
import type { ListingLoadResult, ListingService } from "../listingService";
import type { DayListing } from "../listingTypes";
import type { ArxivSubscription } from "./subscriptions";

/** The days the window lists */
export type DaySelection =
  | { kind: "newest" }
  | { kind: "recent" }
  | { kind: "week" }
  | { kind: "days"; dates: readonly IsoDate[] };

/** The selections the window can open with (a setting) */
export const OPENING_SELECTIONS = ["newest", "recent", "week"] as const;
export type OpeningSelection = (typeof OPENING_SELECTIONS)[number];

/**
 * The listing days of "this week" at `nowMs`: Monday to Friday of the week
 * of the newest scheduled listing, up to that listing
 */
export function thisWeekDays(nowMs: number): IsoDate[] {
  const newest = latestScheduledListingDate(nowMs);
  const days: IsoDate[] = [];
  for (
    let date = addDays(newest, 1 - weekdayOf(newest));
    date <= newest;
    date = addDays(date, 1)
  ) {
    days.push(date);
  }
  return days;
}

interface Run {
  generation: number;
  controller: AbortController | undefined;
}

export class ListingLoader {
  private subscription: ArxivSubscription | null = null;
  private chosen: DaySelection = { kind: "newest" };
  private loaded: DayListing[] = [];
  private run: Run | null = null;
  private generation = 0;
  /** What the last load or continuation reported */
  private report: ListingLoadResult | undefined;
  /** Chosen days that had no announcement */
  private readonly withoutAnnouncement = new Set<IsoDate>();
  /**
   * The days of the choice still to load, when known: the days chosen (or
   * this week's) until a run names those it had not loaded
   */
  private pending: IsoDate[] | undefined;
  /** The newest announcement day the runs of the choice found */
  private newestDay: IsoDate | undefined;
  /**
   * The place in the list of the day shown while its categories are fetched:
   * the run's next day takes it
   */
  private partial: number | null = null;

  constructor(
    private readonly service: ListingService,
    /** Called whenever days arrive or a run starts or ends */
    private readonly onChange: () => void,
    private readonly clock: Clock = systemClock,
  ) {}

  get selection(): DaySelection {
    return this.chosen;
  }

  /** The days of the listing, in the order they arrived */
  get days(): readonly DayListing[] {
    return this.loaded;
  }

  get running(): boolean {
    return this.run !== null;
  }

  /** What the last load (or continuation) reported, once it has ended */
  get result(): ListingLoadResult | undefined {
    return this.report;
  }

  /** Chosen days that had no announcement (holidays), oldest first */
  get daysWithoutAnnouncement(): IsoDate[] {
    return [...this.withoutAnnouncement].sort();
  }

  /**
   * Whether a run that stopped can go on (Continue): the days of the choice
   * not loaded yet are known and some are left. (Otherwise — the newest day,
   * or the last five days stopped before their dates were settled — Reload
   * loads the choice again.)
   */
  get canContinue(): boolean {
    if (this.run || !this.subscription || !this.report?.stopped) return false;
    return Boolean(this.pending?.length);
  }

  /**
   * Load `selection` for `subscription` from scratch. `refresh`: fetch the
   * newest listing (and the date index) again even when the cached copies
   * are recent enough.
   */
  async load(
    subscription: ArxivSubscription,
    selection: DaySelection,
    options: { refresh?: boolean } = {},
  ): Promise<void> {
    const run = this.begin();
    this.subscription = subscription;
    this.chosen = selection;
    this.loaded = [];
    this.partial = null;
    this.report = undefined;
    this.withoutAnnouncement.clear();
    this.newestDay = undefined;
    this.pending =
      selection.kind === "days"
        ? [...selection.dates]
        : selection.kind === "week"
          ? thisWeekDays(this.clock.now())
          : undefined;
    this.onChange();
    const result = await this.fetch(run, options.refresh);
    this.settle(run, result);
    this.finish(run, result);
  }

  /** Load the chosen days again, fetching the newest listing afresh */
  refresh(): Promise<void> {
    if (!this.subscription) return Promise.resolve();
    return this.load(this.subscription, this.chosen, { refresh: true });
  }

  /**
   * Fetch a day that was not complete again; the day is replaced in place.
   * Nothing happens while another run is going on.
   */
  async retryDay(date: IsoDate): Promise<void> {
    const day = this.loaded.find((item) => item.date === date);
    if (!day || !this.subscription || this.run) return;
    const run = this.begin();
    this.onChange();
    try {
      await this.service.reloadDay(this.subscription.categories, date, {
        latest: day.latest,
        signal: run.controller?.signal,
        onDay: (reloaded) => this.receive(run, reloaded),
      });
    } catch (error) {
      Zotero.debug(`[${config.addonName}] arXiv day retry: ${error}`);
    }
    // The notes of the load stay; the day shows how the retry went
    this.finish(run, this.report);
  }

  /**
   * Go on after a run stopped (cancelled, or arXiv refused): the days of the
   * choice not loaded yet are loaded and added after those listed
   */
  async continueLoading(): Promise<void> {
    const subscription = this.subscription;
    const left = this.pending;
    if (!subscription || !left || !this.canContinue) return;
    const newestDay = this.newestDay;
    const run = this.begin();
    this.report = undefined;
    this.onChange();
    let result: ListingLoadResult;
    try {
      result = await this.service.loadDays(subscription.categories, left, {
        signal: run.controller?.signal,
        newestDay,
        onDay: (day) => this.receive(run, day),
        onPartialDay: (day) => this.receive(run, day, true),
      });
    } catch (error) {
      result = this.failed(error);
    }
    this.settle(run, result);
    this.finish(run, result);
  }

  /** Stop the run going on; the days loaded so far stay */
  cancel(): void {
    this.run?.controller?.abort();
  }

  dispose(): void {
    this.cancel();
    this.generation++;
    this.run = null;
  }

  /** The chosen days, through the service; days arrive at `receive` */
  private async fetch(
    run: Run,
    refresh: boolean | undefined,
  ): Promise<ListingLoadResult> {
    const categories = this.subscription!.categories;
    const options = {
      signal: run.controller?.signal,
      refresh,
      onDay: (day: DayListing) => this.receive(run, day),
      onPartialDay: (day: DayListing) => this.receive(run, day, true),
    };
    try {
      if (this.chosen.kind === "newest") {
        return await this.service.loadNew(categories, options);
      }
      if (this.chosen.kind === "recent") {
        return await this.service.loadRecent(categories, options);
      }
      return await this.service.loadDays(categories, this.pending!, options);
    } catch (error) {
      return this.failed(error);
    }
  }

  /**
   * After a run: the days still to load are those it names as not loaded,
   * or, when it named none (it stopped before it knew its days), those it
   * was given; none when it was not stopped
   */
  private settle(run: Run, result: ListingLoadResult): void {
    if (run.generation !== this.generation) return;
    this.pending = result.stopped ? (result.notLoaded ?? this.pending) : [];
    if (
      result.newestDay &&
      (!this.newestDay || result.newestDay > this.newestDay)
    ) {
      this.newestDay = result.newestDay;
    }
  }

  private begin(): Run {
    this.run?.controller?.abort();
    const run: Run = {
      generation: ++this.generation,
      controller: createAbortController(),
    };
    this.run = run;
    return run;
  }

  /**
   * A day of the current run arrived (`partial`: as far as fetched). It takes
   * the place of the day shown while its categories were fetched, or of the
   * listed day of its date (a retry, a continuation), or is added; the list
   * stays newest first (a continuation can bring a day announced after the
   * run that stopped).
   */
  private receive(run: Run, day: DayListing, partial = false): void {
    if (run.generation !== this.generation) return;
    if (this.partial !== null) this.loaded.splice(this.partial, 1);
    let index = this.loaded.findIndex((item) => item.date <= day.date);
    if (index < 0) index = this.loaded.length;
    this.loaded.splice(
      index,
      this.loaded[index]?.date === day.date ? 1 : 0,
      day,
    );
    this.partial = partial ? index : null;
    this.onChange();
  }

  private finish(run: Run, result: ListingLoadResult | undefined): void {
    if (run.generation !== this.generation) return;
    this.run = null;
    if (this.partial !== null) {
      // The run ended while the day's categories were fetched: those not
      // fetched are marked as such, and a retry fetches them
      const day = this.loaded[this.partial];
      const reason = result?.stopped?.reason ?? "cancelled";
      this.loaded[this.partial] = {
        ...day,
        specs: day.specs.map((item) =>
          item.state.state === "loading"
            ? {
                spec: item.spec,
                state: {
                  state: "failed",
                  reason,
                  message: "Not requested: loading stopped",
                },
              }
            : item,
        ),
      };
      this.partial = null;
    }
    for (const date of result?.noAnnouncementDays ?? []) {
      this.withoutAnnouncement.add(date);
    }
    this.report = result;
    this.onChange();
  }

  /** The service reports failures in its result; anything thrown is a bug */
  private failed(error: unknown): ListingLoadResult {
    Zotero.debug(`[${config.addonName}] arXiv listing load: ${error}`);
    return {
      days: [],
      stopped: { reason: "network", message: String(error) },
    };
  }
}
