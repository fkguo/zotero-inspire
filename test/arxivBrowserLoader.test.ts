import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import { ListingService } from "../src/modules/arxiv/listingService";
import { MemoryListingStore } from "../src/modules/arxiv/listingStore";
import {
  ListingLoader,
  thisWeekDays,
} from "../src/modules/arxiv/browser/ListingLoader";
import type { ArxivSubscription } from "../src/modules/arxiv/browser/subscriptions";
import { htmlDocument } from "./arxivFixtures";
import {
  CATCHUP_URL,
  catchupPageHtml,
  INDEX_URL,
  LIST_URL,
  newPageHtml,
  recentIndexHtml,
  SimulatedArxiv,
  type SiteEntry,
} from "./arxivSite";
import { VirtualClock } from "./virtualClock";

// The arXiv browser's runs of the listing service, against a simulated
// arxiv.org on a simulated clock: the days chosen (a preset or days picked
// in the calendar) loaded newest first, one run at a time, days arriving one
// by one, cancel and continue, retry of one day.

/** Sunday 27 September 2026, 13:00 in New York: newest listing is Friday 25 */
const NOW = "2026-09-27T17:00:00Z";
const DAYS = [
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
  "2026-09-24",
  "2026-09-25",
];
const NEXT: Record<string, string> = {
  "2026-09-17": "2026-09-18",
  "2026-09-18": "2026-09-21",
  "2026-09-21": "2026-09-22",
  "2026-09-22": "2026-09-23",
  "2026-09-23": "2026-09-24",
  "2026-09-24": "2026-09-25",
};

let counter = 10000;
function day(spec: string): SiteEntry[] {
  return [
    { id: `2609.${counter++}`, section: "new", primary: spec },
    {
      id: `2609.${counter++}`,
      section: "cross",
      primary: "gr-qc",
      cross: [spec],
    },
  ];
}

const hepPh: ArxivSubscription = {
  id: "sub-1",
  name: "Daily",
  categories: ["hep-ph"],
  sections: { new: true, cross: true, replace: false },
};

function setup(now = NOW) {
  const clock = new VirtualClock(Date.parse(now));
  const site = new SimulatedArxiv(clock);
  const scheduler = new ArxivScheduler({
    host: "arxiv.org",
    minIntervalMs: 15000,
    timeoutMs: 60000,
    transport: site.transport,
    clock,
  });
  const store = new MemoryListingStore();
  const service = new ListingService({
    scheduler,
    store,
    clock,
    parseHtml: htmlDocument,
  });
  // Days 17 Sep to 25 Sep of hep-ph; the index knows 21 to 25
  site.html(INDEX_URL, recentIndexHtml("math", [...DAYS].reverse()));
  for (const date of ["2026-09-17", "2026-09-18", ...DAYS]) {
    site.html(
      CATCHUP_URL("hep-ph", date),
      catchupPageHtml("hep-ph", date, day("hep-ph"), NEXT[date] ?? null),
    );
  }
  site.html(
    LIST_URL("hep-ph"),
    newPageHtml("hep-ph", "2026-09-25", day("hep-ph")),
  );
  const onChange = vi.fn();
  const loader = new ListingLoader(service, onChange, clock);
  return { clock, site, store, service, loader, onChange };
}

const dates = (loader: ListingLoader) => loader.days.map((d) => d.date);

beforeEach(() => {
  vi.stubGlobal("Zotero", { debug: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("arXiv browser loading", () => {
  it("loads the newest day and reports when it is done", async () => {
    const { clock, loader, onChange } = setup();
    const done = loader.load(hepPh, { kind: "newest" });
    expect(loader.running).toBe(true);
    await clock.run(done);
    expect(loader.running).toBe(false);
    expect(dates(loader)).toEqual(["2026-09-25"]);
    expect(loader.result?.stopped).toBeUndefined();
    // start, the day, the end
    expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("shows each recent day as soon as it is loaded, newest first", async () => {
    const { clock, service } = setup();
    const seen: string[][] = [];
    const listener = new ListingLoader(
      service,
      () => seen.push(dates(listener)),
      clock,
    );
    await clock.run(listener.load(hepPh, { kind: "recent" }));
    expect(dates(listener)).toEqual([...DAYS].reverse());
    // The days came one at a time
    expect(seen.filter((list) => list.length > 0).map((l) => l.length)).toEqual(
      expect.arrayContaining([1, 2, 3, 4, 5]),
    );
  });

  it("loads days picked in the calendar newest first", async () => {
    const { clock, site, loader } = setup();
    await clock.run(
      loader.load(hepPh, {
        kind: "days",
        dates: ["2026-09-17", "2026-09-23", "2026-09-18"],
      }),
    );
    expect(dates(loader)).toEqual(["2026-09-23", "2026-09-18", "2026-09-17"]);
    expect(loader.selection).toEqual({
      kind: "days",
      dates: ["2026-09-17", "2026-09-23", "2026-09-18"],
    });
    expect(site.count(LIST_URL("hep-ph"))).toBe(0);
  });

  it("loads this week: Monday to the newest scheduled listing", async () => {
    const { clock, loader } = setup();
    await clock.run(loader.load(hepPh, { kind: "week" }));
    expect(dates(loader)).toEqual([...DAYS].reverse());
  });

  it("keeps the days loaded when cancelled, and continues with the days not loaded", async () => {
    const { clock, site, loader } = setup();
    const picked = { kind: "days" as const, dates: DAYS.slice(0, 4) };
    const running = loader.load(hepPh, picked);
    // The index, 24 and 23 Sep at 15 s intervals; cancel while 22 Sep waits
    await clock.advanceBy(35000);
    expect(dates(loader)).toEqual(["2026-09-24", "2026-09-23"]);
    loader.cancel();
    await clock.run(running);
    expect(loader.running).toBe(false);
    expect(loader.result?.stopped?.reason).toBe("cancelled");
    expect(loader.canContinue).toBe(true);

    await clock.run(loader.continueLoading());
    expect(dates(loader)).toEqual([...DAYS.slice(0, 4)].reverse());
    expect(loader.result?.stopped).toBeUndefined();
    expect(loader.canContinue).toBe(false);
    // Each day fetched once
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-23"))).toBe(1);
  });

  it("continues recent days after a cancel with the days not loaded", async () => {
    const { clock, site, loader } = setup();
    const running = loader.load(hepPh, { kind: "recent" });
    // The index, /new, then 24 Sep; cancel while 23 Sep waits
    await clock.advanceBy(35000);
    expect(dates(loader)).toEqual(["2026-09-25", "2026-09-24"]);
    loader.cancel();
    await clock.run(running);
    expect(loader.canContinue).toBe(true);
    await clock.run(loader.continueLoading());
    expect(dates(loader)).toEqual([...DAYS].reverse());
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-24"))).toBe(1);
    expect(site.count(INDEX_URL)).toBe(1);
  });

  it("continues the last five days with the days loadRecent chose, after an announcement the index does not show yet", async () => {
    // Sunday 20:30 in New York: /new shows Monday, the index still ends on Friday
    const { clock, site, loader } = setup("2026-09-28T00:30:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", day("hep-ph")),
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-25"),
      catchupPageHtml("hep-ph", "2026-09-25", day("hep-ph"), "2026-09-28"),
    );
    const running = loader.load(hepPh, { kind: "recent" });
    // The index, /new (28 Sep), 25 Sep; cancel while 24 Sep waits
    await clock.advanceBy(35000);
    expect(dates(loader)).toEqual(["2026-09-28", "2026-09-25"]);
    loader.cancel();
    await clock.run(running);
    await clock.run(loader.continueLoading());
    // Five days: 21 Sep dropped for 28 Sep, as the first run chose
    expect(dates(loader)).toEqual([
      "2026-09-28",
      "2026-09-25",
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
    ]);
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-21"))).toBe(0);
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-25"))).toBe(1);
  });

  it("keeps the newest chosen day /new showed when cancelled while the index waits, and continues", async () => {
    const { clock, site, loader } = setup("2026-09-28T00:30:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", day("hep-ph")),
    );
    const running = loader.load(hepPh, {
      kind: "days",
      dates: ["2026-09-28"],
    });
    // /new told that 28 Sep is out; cancelled while the index waits
    await clock.advanceBy(5000);
    loader.cancel();
    await clock.run(running);
    expect(dates(loader)).toEqual(["2026-09-28"]);
    expect(loader.canContinue).toBe(true);
    await clock.run(loader.continueLoading());
    expect(dates(loader)).toEqual(["2026-09-28"]);
    expect(loader.days[0].status).toBe("complete");
    expect(site.count(INDEX_URL)).toBe(1);
    expect(site.count(LIST_URL("hep-ph"))).toBe(1);
  });

  it("continues with the days not loaded, newest first, when a listing was announced between Cancel and Continue", async () => {
    // Thursday 19:00 in New York: this week is Monday to Thursday
    const { clock, site, loader } = setup("2026-09-24T23:00:00Z");
    site.html(
      INDEX_URL,
      recentIndexHtml("math", [
        "2026-09-24",
        "2026-09-23",
        "2026-09-22",
        "2026-09-21",
        "2026-09-18",
      ]),
    );
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-24", day("hep-ph")),
    );
    const running = loader.load(hepPh, { kind: "week" });
    // The index, /new (24 Sep), 23 Sep; cancel while 22 Sep waits
    await clock.advanceBy(35000);
    expect(dates(loader)).toEqual(["2026-09-24", "2026-09-23"]);
    loader.cancel();
    await clock.run(running);
    // Friday's listing is announced at 20:00; Continue two hours later
    await clock.advanceBy(2 * 3600 * 1000);
    site.html(INDEX_URL, recentIndexHtml("math", [...DAYS].reverse()));
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-25", day("hep-ph")),
    );
    const newPages = site.count(LIST_URL("hep-ph"));
    await clock.run(loader.continueLoading());
    expect(dates(loader)).toEqual([
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
    ]);
    // Nothing listed was fetched again
    expect(site.count(LIST_URL("hep-ph"))).toBe(newPages);
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-23"))).toBe(1);
  });

  it("offers no Continue for the last five days cancelled before /new told the newest day; Reload lists them", async () => {
    // Sunday 20:30 in New York: /new shows Monday, the index still ends Friday
    const { clock, site, loader } = setup("2026-09-28T00:30:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", day("hep-ph")),
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-25"),
      catchupPageHtml("hep-ph", "2026-09-25", day("hep-ph"), "2026-09-28"),
    );
    const running = loader.load(hepPh, { kind: "recent" });
    await clock.advanceBy(5000);
    loader.cancel();
    await clock.run(running);
    // Its five days are not known: nothing to go on with
    expect(loader.canContinue).toBe(false);
    await clock.run(loader.refresh());
    expect(dates(loader)).toEqual([
      "2026-09-28",
      "2026-09-25",
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
    ]);
  });

  it("does not fetch the listed newest day again when continuing later", async () => {
    const { clock, site, loader } = setup("2026-09-28T00:30:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", day("hep-ph")),
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-25"),
      catchupPageHtml("hep-ph", "2026-09-25", day("hep-ph"), "2026-09-28"),
    );
    const running = loader.load(hepPh, { kind: "recent" });
    // The index, /new (28 Sep); cancel while 25 Sep waits
    await clock.advanceBy(20000);
    expect(dates(loader)).toEqual(["2026-09-28"]);
    loader.cancel();
    await clock.run(running);
    // A quarter of an hour later, the index still ends on Friday
    await clock.advanceBy(15 * 60 * 1000);
    const newPages = site.count(LIST_URL("hep-ph"));
    await clock.run(loader.continueLoading());
    expect(dates(loader)).toEqual([
      "2026-09-28",
      "2026-09-25",
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
    ]);
    expect(site.count(LIST_URL("hep-ph"))).toBe(newPages);
  });

  it("offers no Continue for the last five days not settled; Reload lists the right five", async () => {
    // The index request fails and the cached index of Wednesday is used; /new
    // shows Friday; Wednesday's page, whose link tells Thursday, fails once
    const { clock, site, store, loader } = setup();
    await store.putRecentIndex("math", {
      dates: [
        "2026-09-23",
        "2026-09-22",
        "2026-09-21",
        "2026-09-18",
        "2026-09-17",
      ],
      fetchedAt: Date.parse("2026-09-23T12:00:00Z"),
    });
    site.page(INDEX_URL, { status: 500 });
    const wednesday = catchupPageHtml(
      "hep-ph",
      "2026-09-23",
      day("hep-ph"),
      "2026-09-24",
    );
    site.page(CATCHUP_URL("hep-ph", "2026-09-23"), (attempt) =>
      attempt === 1 ? { status: 500 } : { text: wednesday },
    );
    await clock.run(loader.load(hepPh, { kind: "recent" }));
    expect(dates(loader)).toEqual(["2026-09-25"]);
    expect(loader.result?.stopped?.date).toBe("2026-09-23");
    expect(loader.canContinue).toBe(false);
    await clock.run(loader.refresh());
    expect(dates(loader)).toEqual([...DAYS].reverse());
  });

  it("keeps the newest day found when continuations stop again, asking /new no more", async () => {
    // Sunday 20:30 in New York: /new shows Monday, the index still ends Friday
    const { clock, site, loader } = setup("2026-09-28T00:30:00Z");
    site.html(
      LIST_URL("hep-ph"),
      newPageHtml("hep-ph", "2026-09-28", day("hep-ph")),
    );
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-25"),
      catchupPageHtml("hep-ph", "2026-09-25", day("hep-ph"), "2026-09-28"),
    );
    const running = loader.load(hepPh, { kind: "recent" });
    await clock.advanceBy(20000);
    expect(dates(loader)).toEqual(["2026-09-28"]);
    loader.cancel();
    await clock.run(running);
    // Later, a Continue is cancelled while the index is asked again
    await clock.advanceBy(11 * 60 * 1000);
    const first = loader.continueLoading();
    await clock.advanceBy(200);
    loader.cancel();
    await clock.run(first);
    const newPages = site.count(LIST_URL("hep-ph"));
    await clock.run(loader.continueLoading());
    expect(dates(loader)).toEqual([
      "2026-09-28",
      "2026-09-25",
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
    ]);
    expect(site.count(LIST_URL("hep-ph"))).toBe(newPages);
  });

  it("keeps the days listed when a continuation stops before its days were known, and goes on with the same days", async () => {
    // Sunday 20:30 in New York: the index still ends Friday, so it is fetched
    // again after 10 minutes
    const { clock, site, loader } = setup("2026-09-28T00:30:00Z");
    const running = loader.load(hepPh, {
      kind: "days",
      dates: ["2026-09-24", "2026-09-23", "2026-09-22"],
    });
    // The index at 0 s, 24 Sep at 15.8 s; cancel while 23 Sep waits
    await clock.advanceBy(20000);
    expect(dates(loader)).toEqual(["2026-09-24"]);
    loader.cancel();
    await clock.run(running);
    // Eleven minutes later the index is fetched again; cancelled meanwhile
    await clock.advanceBy(11 * 60 * 1000);
    const continuing = loader.continueLoading();
    await clock.advanceBy(200);
    loader.cancel();
    await clock.run(continuing);
    expect(dates(loader)).toEqual(["2026-09-24"]);
    expect(loader.canContinue).toBe(true);
    const again = loader.continueLoading();
    // The list stays while the rest loads
    expect(dates(loader)).toEqual(["2026-09-24"]);
    await clock.run(again);
    expect(dates(loader)).toEqual(["2026-09-24", "2026-09-23", "2026-09-22"]);
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-24"))).toBe(1);
  });

  it("offers no Continue when the run that stopped had no days left", async () => {
    const { clock, site, loader } = setup();
    // arXiv refuses the last day's page: the run stops, the day is listed
    // with its Retry
    site.page(CATCHUP_URL("hep-ph", "2026-09-23"), { status: 403 });
    await clock.run(
      loader.load(hepPh, {
        kind: "days",
        dates: ["2026-09-24", "2026-09-23"],
      }),
    );
    expect(loader.result?.stopped?.reason).toBe("forbidden");
    expect(loader.days.map((item) => `${item.date} ${item.status}`)).toEqual([
      "2026-09-24 complete",
      "2026-09-23 failed",
    ]);
    expect(loader.canContinue).toBe(false);
  });

  it("lists the newest day when the index cannot be had, and continues with the others", async () => {
    const { clock, site, loader } = setup();
    site.page(INDEX_URL, { status: 503 });
    await clock.run(loader.load(hepPh, { kind: "week" }));
    // /new came first: Friday is listed
    expect(dates(loader)).toEqual(["2026-09-25"]);
    expect(loader.result?.stopped?.reason).toBe("unavailable");
    expect(loader.canContinue).toBe(true);

    site.html(INDEX_URL, recentIndexHtml("math", [...DAYS].reverse()));
    await clock.advanceBy(60000);
    await clock.run(loader.continueLoading());
    expect(dates(loader)).toEqual([...DAYS].reverse());
  });

  it("puts a newer day continued after a stop above the days listed", async () => {
    // Monday 20:30 in New York: this week is Monday and Tuesday, but arXiv
    // is late and /new still shows Monday
    const { clock, site, loader } = setup("2026-09-29T00:30:00Z");
    site.page(LIST_URL("hep-ph"), (attempt) => ({
      text: newPageHtml(
        "hep-ph",
        attempt === 1 ? "2026-09-28" : "2026-09-29",
        day("hep-ph"),
      ),
    }));
    site.page(INDEX_URL, { status: 503 });
    await clock.run(loader.load(hepPh, { kind: "week" }));
    expect(dates(loader)).toEqual(["2026-09-28"]);
    expect(loader.canContinue).toBe(true);

    // Tuesday is out when the user continues
    site.html(
      INDEX_URL,
      recentIndexHtml("math", [
        "2026-09-29",
        "2026-09-28",
        ...DAYS.slice(1).reverse(),
      ]),
    );
    await clock.advanceBy(60000);
    await clock.run(loader.continueLoading());
    expect(dates(loader)).toEqual(["2026-09-29", "2026-09-28"]);
  });

  it("drops the days of a run that a new load replaced", async () => {
    const { clock, loader } = setup();
    const first = loader.load(hepPh, { kind: "recent" });
    await clock.advanceBy(20000);
    const second = loader.load(hepPh, { kind: "newest" });
    await clock.run(Promise.all([first, second]));
    expect(loader.selection).toEqual({ kind: "newest" });
    expect(dates(loader)).toEqual(["2026-09-25"]);
  });

  it("retries a day that was not complete, in its place", async () => {
    const { clock, site, loader } = setup();
    // hep-lat's page of 23 Sep fails once
    const twoCategories = { ...hepPh, categories: ["hep-ph", "hep-lat"] };
    for (const date of DAYS) {
      const html = catchupPageHtml(
        "hep-lat",
        date,
        day("hep-lat"),
        NEXT[date] ?? null,
      );
      site.page(CATCHUP_URL("hep-lat", date), (attempt) =>
        date === "2026-09-23" && attempt === 1
          ? { status: 500, text: "Server error" }
          : { text: html },
      );
    }
    site.html(
      LIST_URL("hep-lat"),
      newPageHtml("hep-lat", "2026-09-25", day("hep-lat")),
    );
    await clock.run(loader.load(twoCategories, { kind: "recent" }));
    const statuses = () => loader.days.map((d) => `${d.date} ${d.status}`);
    expect(statuses()).toContain("2026-09-23 incomplete");

    await clock.run(loader.retryDay("2026-09-23"));
    expect(statuses()).toEqual([
      "2026-09-25 complete",
      "2026-09-24 complete",
      "2026-09-23 complete",
      "2026-09-22 complete",
      "2026-09-21 complete",
    ]);
    // hep-ph's page of that day came from the cache
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-23"))).toBe(1);
  });

  it("refreshes the days chosen, fetching the newest listing again", async () => {
    const { clock, site, loader } = setup();
    const picked = {
      kind: "days" as const,
      dates: ["2026-09-24", "2026-09-25"],
    };
    await clock.run(loader.load(hepPh, picked));
    expect(site.count(LIST_URL("hep-ph"))).toBe(1);
    await clock.run(loader.refresh());
    expect(loader.selection).toEqual(picked);
    expect(dates(loader)).toEqual(["2026-09-25", "2026-09-24"]);
    expect(site.count(LIST_URL("hep-ph"))).toBe(2);
  });

  it("notes the chosen days that had no announcement", async () => {
    const { clock, site, loader } = setup();
    site.html(
      CATCHUP_URL("hep-ph", "2026-09-16"),
      catchupPageHtml("hep-ph", "2026-09-16", [], "2026-09-17"),
    );
    site.html(
      "https://arxiv.org/catchup/math/2026-09-16?abs=False",
      catchupPageHtml("math", "2026-09-16", [], "2026-09-17"),
    );
    await clock.run(
      loader.load(hepPh, {
        kind: "days",
        dates: ["2026-09-16", "2026-09-17"],
      }),
    );
    expect(dates(loader)).toEqual(["2026-09-17"]);
    expect(loader.daysWithoutAnnouncement).toEqual(["2026-09-16"]);
  });
});

describe("a day shown while its categories are fetched", () => {
  const three = { ...hepPh, categories: ["hep-ph", "hep-th", "hep-lat"] };
  const states = (loader: ListingLoader) =>
    loader.days.map((d) =>
      d.specs.map(({ spec, state }) => `${spec} ${state.state}`).join(", "),
    );

  /** hep-th and hep-lat like hep-ph: /new of 25 Sep and the days before */
  function serveOthers(site: ReturnType<typeof setup>["site"]) {
    for (const spec of ["hep-th", "hep-lat"]) {
      site.html(LIST_URL(spec), newPageHtml(spec, "2026-09-25", day(spec)));
      for (const date of DAYS) {
        site.html(
          CATCHUP_URL(spec, date),
          catchupPageHtml(spec, date, day(spec), NEXT[date] ?? null),
        );
      }
    }
  }

  it("fills the day in its place as its categories arrive", async () => {
    const { clock, site, loader } = setup();
    serveOthers(site);
    const done = loader.load(three, { kind: "newest" });
    // hep-ph's /new has come; hep-th's waits for its turn
    await clock.advanceBy(5000);
    expect(dates(loader)).toEqual(["2026-09-25"]);
    expect(states(loader)).toEqual([
      "hep-ph complete, hep-th loading, hep-lat loading",
    ]);
    expect(loader.days[0].entries).toHaveLength(2);
    await clock.advanceBy(15000);
    expect(states(loader)).toEqual([
      "hep-ph complete, hep-th complete, hep-lat loading",
    ]);
    await clock.run(done);
    expect(dates(loader)).toEqual(["2026-09-25"]);
    expect(loader.days[0].status).toBe("complete");
    expect(loader.days[0].entries).toHaveLength(6);
  });

  it("keeps a day cut short by Cancel, the categories not fetched marked, and a retry fetches them", async () => {
    const { clock, site, loader } = setup();
    serveOthers(site);
    const done = loader.load(three, { kind: "newest" });
    await clock.advanceBy(5000);
    loader.cancel();
    await clock.run(done);
    expect(loader.running).toBe(false);
    expect(loader.days.map((d) => d.status)).toEqual(["incomplete"]);
    expect(states(loader)).toEqual([
      "hep-ph complete, hep-th failed, hep-lat failed",
    ]);
    expect(loader.days[0].specs[1].state).toMatchObject({
      state: "failed",
      reason: "cancelled",
    });
    expect(loader.days[0].entries).toHaveLength(2);

    await clock.run(loader.retryDay("2026-09-25"));
    expect(states(loader)).toEqual([
      "hep-ph complete, hep-th complete, hep-lat complete",
    ]);
    expect(site.count(LIST_URL("hep-ph"))).toBe(1);
  });

  it("puts the newer day in place of the day shown when an announcement comes while loading", async () => {
    // Sunday 20:10 in New York: Monday's listing is being announced
    const { clock, site, loader } = setup("2026-09-28T00:10:00Z");
    serveOthers(site);
    site.page(LIST_URL("hep-ph"), (attempt) => ({
      text:
        attempt === 1
          ? newPageHtml("hep-ph", "2026-09-25", day("hep-ph"))
          : newPageHtml("hep-ph", "2026-09-28", day("hep-ph")),
    }));
    for (const spec of ["hep-th", "hep-lat"]) {
      site.html(LIST_URL(spec), newPageHtml(spec, "2026-09-28", day(spec)));
    }
    const done = loader.load(three, { kind: "newest" });
    await clock.advanceBy(5000);
    expect(dates(loader)).toEqual(["2026-09-25"]);
    await clock.run(done);
    expect(dates(loader)).toEqual(["2026-09-28"]);
    expect(loader.days[0].status).toBe("complete");
  });

  it("shows the newer day while a category is fetched again after an announcement, also when cancelled then", async () => {
    // Sunday 20:10 in New York: Monday's listing is being announced
    const { clock, site, loader } = setup("2026-09-28T00:10:00Z");
    site.page(LIST_URL("hep-ph"), (attempt) => ({
      text:
        attempt === 1
          ? newPageHtml("hep-ph", "2026-09-25", day("hep-ph"))
          : newPageHtml("hep-ph", "2026-09-28", day("hep-ph")),
    }));
    site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-28", day("hep-th")),
    );
    const two = { ...hepPh, categories: ["hep-ph", "hep-th"] };
    const done = loader.load(two, { kind: "newest" });
    await clock.advanceBy(5000);
    expect(dates(loader)).toEqual(["2026-09-25"]);
    // hep-th showed Monday; hep-ph waits to be fetched again
    await clock.advanceBy(15000);
    expect(dates(loader)).toEqual(["2026-09-28"]);
    expect(states(loader)).toEqual(["hep-ph loading, hep-th complete"]);
    loader.cancel();
    await clock.run(done);
    expect(dates(loader)).toEqual(["2026-09-28"]);
    expect(states(loader)).toEqual(["hep-ph failed, hep-th complete"]);
    expect(site.count(LIST_URL("hep-ph"))).toBe(1);
  });

  it("shows the newer day when cancelled while a category is fetched again, also when the newer day has no papers yet", async () => {
    const { clock, site, loader } = setup("2026-09-28T00:10:00Z");
    site.page(LIST_URL("hep-ph"), (attempt) => ({
      text:
        attempt === 1
          ? newPageHtml("hep-ph", "2026-09-25", day("hep-ph"))
          : newPageHtml("hep-ph", "2026-09-28", day("hep-ph")),
    }));
    site.html(LIST_URL("cs.GL"), newPageHtml("cs.GL", "2026-09-28", []));
    const done = loader.load(
      { ...hepPh, categories: ["hep-ph", "cs.GL"] },
      { kind: "newest" },
    );
    await clock.advanceBy(20000);
    expect(dates(loader)).toEqual(["2026-09-28"]);
    loader.cancel();
    await clock.run(done);
    expect(dates(loader)).toEqual(["2026-09-28"]);
    expect(states(loader)).toEqual(["hep-ph failed, cs.GL complete"]);
    expect(loader.days[0].entries).toEqual([]);
  });

  it("continues a chosen day cut short by Cancel in its place", async () => {
    const { clock, site, loader } = setup();
    serveOthers(site);
    const two = { ...hepPh, categories: ["hep-ph", "hep-th"] };
    const picked = {
      kind: "days" as const,
      dates: ["2026-09-23", "2026-09-24"],
    };
    const done = loader.load(two, picked);
    // The index at 0 s, 24 Sep at 15 and 30 s, hep-ph of 23 Sep at 45 s
    await clock.advanceBy(50000);
    expect(states(loader)).toEqual([
      "hep-ph complete, hep-th complete",
      "hep-ph complete, hep-th loading",
    ]);
    loader.cancel();
    await clock.run(done);
    expect(loader.canContinue).toBe(true);
    await clock.run(loader.continueLoading());
    expect(dates(loader)).toEqual(["2026-09-24", "2026-09-23"]);
    expect(loader.days.map((d) => d.status)).toEqual(["complete", "complete"]);
    expect(site.count(CATCHUP_URL("hep-ph", "2026-09-23"))).toBe(1);
  });
});

describe("this week", () => {
  it("is Monday to the newest scheduled listing, in New York's announcement calendar", () => {
    // Sunday 13:00 in New York: Friday's listing is the newest
    expect(thisWeekDays(Date.parse("2026-09-27T17:00:00Z"))).toEqual(DAYS);
    // Sunday 21:00 in New York: Monday's listing is out
    expect(thisWeekDays(Date.parse("2026-09-28T01:00:00Z"))).toEqual([
      "2026-09-28",
    ]);
    // Wednesday 19:00 in New York: Tuesday and Wednesday are out
    expect(thisWeekDays(Date.parse("2026-09-30T23:00:00Z"))).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
    ]);
  });
});

describe("days read", () => {
  /** A loader that records the days it tells as read */
  function reading(env: ReturnType<typeof setup>) {
    const read: string[] = [];
    const loader = new ListingLoader(
      env.service,
      () => undefined,
      env.clock,
      (subscription, days) =>
        read.push(...days.map((date) => `${subscription.id} ${date}`)),
    );
    return { loader, read };
  }

  it("marks a day read once its listing arrived complete, not a day with a category missing", async () => {
    const env = setup();
    const { loader, read } = reading(env);
    const twoCategories = { ...hepPh, categories: ["hep-ph", "hep-lat"] };
    for (const date of DAYS) {
      const html = catchupPageHtml(
        "hep-lat",
        date,
        day("hep-lat"),
        NEXT[date] ?? null,
      );
      env.site.page(CATCHUP_URL("hep-lat", date), (attempt) =>
        date === "2026-09-23" && attempt === 1
          ? { status: 500, text: "Server error" }
          : { text: html },
      );
    }
    env.site.html(
      LIST_URL("hep-lat"),
      newPageHtml("hep-lat", "2026-09-25", day("hep-lat")),
    );
    // The newest day is shown once hep-ph's /new has come, before hep-lat's
    const done = loader.load(twoCategories, { kind: "recent" });
    await env.clock.advanceBy(5000);
    expect(dates(loader)).toEqual(["2026-09-25"]);
    expect(read).toEqual([]);
    await env.clock.run(done);
    expect(read).toEqual([
      "sub-1 2026-09-25",
      "sub-1 2026-09-24",
      "sub-1 2026-09-22",
      "sub-1 2026-09-21",
    ]);
    // Complete once retried
    await env.clock.run(loader.retryDay("2026-09-23"));
    expect(read).toContain("sub-1 2026-09-23");
  });

  it("does not mark a day cut short by Cancel", async () => {
    const env = setup();
    const { loader, read } = reading(env);
    env.site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-25", day("hep-th")),
    );
    const done = loader.load(
      { ...hepPh, categories: ["hep-ph", "hep-th"] },
      { kind: "newest" },
    );
    await env.clock.advanceBy(5000);
    loader.cancel();
    await env.clock.run(done);
    expect(loader.days.map((d) => d.status)).toEqual(["incomplete"]);
    expect(read).toEqual([]);
    await env.clock.run(loader.retryDay("2026-09-25"));
    expect(read).toEqual(["sub-1 2026-09-25"]);
  });

  it("marks a chosen day that had no announcement read", async () => {
    const env = setup();
    const { loader, read } = reading(env);
    env.site.html(
      CATCHUP_URL("hep-ph", "2026-09-16"),
      catchupPageHtml("hep-ph", "2026-09-16", [], "2026-09-17"),
    );
    env.site.html(
      "https://arxiv.org/catchup/math/2026-09-16?abs=False",
      catchupPageHtml("math", "2026-09-16", [], "2026-09-17"),
    );
    await env.clock.run(
      loader.load(hepPh, { kind: "days", dates: ["2026-09-16", "2026-09-17"] }),
    );
    expect(dates(loader)).toEqual(["2026-09-17"]);
    expect(read.sort()).toEqual(["sub-1 2026-09-16", "sub-1 2026-09-17"]);
  });
});
