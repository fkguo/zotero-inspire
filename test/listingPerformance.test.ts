import { describe, expect, it } from "vitest";
import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import { ListingService } from "../src/modules/arxiv/listingService";
import { MemoryListingStore } from "../src/modules/arxiv/listingStore";
import type { DayListing } from "../src/modules/arxiv/listingTypes";
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

// Design section 14, stage 1: a subscription of 20 categories on a simulated
// arxiv.org and clock (no real requests). Checked: the number of requests of
// a first load, how long it takes at 15 s per request, when each day is
// shown, and that cancelling stops the requests.

const SPECS = [
  "hep-ph",
  "hep-th",
  "hep-ex",
  "hep-lat",
  "gr-qc",
  "nucl-th",
  "nucl-ex",
  "quant-ph",
  "astro-ph.CO",
  "astro-ph.HE",
  "math-ph",
  "cond-mat.str-el",
  "cond-mat.mes-hall",
  "physics.atom-ph",
  "physics.optics",
  "cs.LG",
  "stat.ML",
  "math.AG",
  "math.NT",
  "nlin.CD",
];

/** Announcement days of September 2026 (Monday to Friday) */
const DAYS = [
  "2026-09-10",
  "2026-09-11",
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
  "2026-09-24",
  "2026-09-25",
];
const LATEST = "2026-09-25";
const INDEX = [...DAYS].reverse().slice(0, 5);
/** Sunday 27 September, 13:00 in New York */
const NOW = Date.parse("2026-09-27T17:00:00Z");

let idCounter = 20000;

/** A category's day: sizes between 12 and 100 entries, like real days */
function dayEntries(specIndex: number, dayIndex: number): SiteEntry[] {
  const spec = SPECS[specIndex];
  const size = 12 + ((specIndex * 37 + dayIndex * 11) % 89);
  return Array.from({ length: size }, (_, i) => {
    const section =
      i < size * 0.45 ? "new" : i < size * 0.7 ? "cross" : "replace";
    return {
      id: `2609.${idCounter++}`,
      section,
      primary: section === "cross" ? "hep-ex" : spec,
      cross: section === "cross" ? [spec] : [],
    } as SiteEntry;
  });
}

function buildSite(clock: VirtualClock) {
  // Latency grows with the page: 0.3 s plus 4 ms per entry
  const sizes = new Map<string, number>();
  const site = new SimulatedArxiv(
    clock,
    (url) => 300 + 4 * (sizes.get(url) ?? 5),
  );
  site.html(INDEX_URL, recentIndexHtml("math", INDEX));
  SPECS.forEach((spec, specIndex) => {
    DAYS.forEach((day, dayIndex) => {
      const entries = dayEntries(specIndex, dayIndex);
      const next = DAYS[dayIndex + 1] ?? null;
      const catchup = CATCHUP_URL(spec, day);
      site.html(catchup, catchupPageHtml(spec, day, entries, next));
      sizes.set(catchup, entries.length);
      if (day === LATEST) {
        site.html(LIST_URL(spec), newPageHtml(spec, day, entries));
        sizes.set(LIST_URL(spec), entries.length);
      }
    });
  });
  return site;
}

function setup() {
  const clock = new VirtualClock(NOW);
  const site = buildSite(clock);
  const scheduler = new ArxivScheduler({
    host: "arxiv.org",
    minIntervalMs: 15000,
    timeoutMs: 60000,
    transport: site.transport,
    clock,
  });
  const service = new ListingService({
    scheduler,
    store: new MemoryListingStore(),
    clock,
    parseHtml: htmlDocument,
  });
  return { clock, site, service };
}

const minutes = (ms: number) => Math.round(ms / 600) / 100;

function expectSpacing(site: SimulatedArxiv) {
  for (let i = 1; i < site.sent.length; i++) {
    expect(site.sent[i].start - site.sent[i - 1].end!).toBeGreaterThanOrEqual(
      15000,
    );
  }
}

function report(title: string, rows: [string, string | number][]) {
  console.log(
    [
      `── ${title}`,
      ...rows.map(([name, value]) => `   ${name}: ${value}`),
    ].join("\n"),
  );
}

// The time checked is the simulated clock's; the real-time limit only catches
// a hang. Building and reading the pages of 20 categories takes up to a few
// seconds, more on a busy machine, hence 30 s instead of the default 5 s.
const hangLimit = { timeout: 30_000 };

describe("20-category subscription on a simulated network", hangLimit, () => {
  it("recent, first load: 1 + 5 x 20 = 101 requests, about 25 minutes, one day every ~5 minutes", async () => {
    const { clock, site, service } = setup();
    const shownAt: [string, number][] = [];
    const result = await clock.run(
      service.loadRecent(SPECS, {
        onDay: (day) => shownAt.push([day.date, clock.now() - NOW]),
      }),
    );
    const duration = clock.now() - NOW;
    expect(site.sent).toHaveLength(101);
    expectSpacing(site);
    expect(result.days.map((day) => `${day.date} ${day.status}`)).toEqual(
      INDEX.map((day) => `${day} complete`),
    );
    // The newest day after 21 requests (> 5 min), then one day per 20
    expect(shownAt[0][1]).toBeGreaterThan(20 * 15000);
    for (let i = 1; i < shownAt.length; i++) {
      const gap = shownAt[i][1] - shownAt[i - 1][1];
      expect(gap).toBeGreaterThanOrEqual(20 * 15000);
      expect(gap).toBeLessThan(20 * 17000);
    }
    expect(duration).toBeGreaterThanOrEqual(100 * 15000);
    expect(duration).toBeLessThan(100 * 17000);
    report("recent, 20 categories, first load", [
      ["requests", site.sent.length],
      ["duration (min)", minutes(duration)],
      ...shownAt.map(([date, at]): [string, string] => [
        `day ${date} shown at (min)`,
        String(minutes(at)),
      ]),
    ]);
  });

  it("recent again: past days from the cache; the index and /new again after 10 minutes or an announcement", async () => {
    const { clock, site, service } = setup();
    await clock.run(service.loadRecent(SPECS));
    const first = site.sent.length;

    // The first load took 26 minutes, so its index and /new pages are older
    // than 10 minutes: those 21 are fetched again, the past days are not
    await clock.advanceBy(5 * 60 * 1000);
    const again = await clock.run(service.loadRecent(SPECS));
    expect(site.sent.length - first).toBe(21);
    expect(again.days).toHaveLength(5);
    const second = site.sent.length;

    // Within 10 minutes of those: nothing is fetched
    await clock.advanceBy(60 * 1000);
    const cached = await clock.run(service.loadRecent(SPECS));
    expect(site.sent.length - second).toBe(0);
    expect(cached.days.map((day) => day.status)).toEqual(
      Array(5).fill("complete"),
    );

    // Monday's listing is announced (Sunday 20:00 New York = 00:00 UTC)
    await clock.advanceTo(Date.parse("2026-09-28T00:30:00Z"));
    site.html(
      INDEX_URL,
      recentIndexHtml("math", ["2026-09-28", ...INDEX.slice(0, 4)]),
    );
    SPECS.forEach((spec, specIndex) => {
      site.html(
        LIST_URL(spec),
        newPageHtml(spec, "2026-09-28", dayEntries(specIndex, 99)),
      );
    });
    const before = site.sent.length;
    const start = clock.now();
    const next = await clock.run(service.loadRecent(SPECS));
    expect(next.days.map((day) => day.date)).toEqual([
      "2026-09-28",
      ...INDEX.slice(0, 4),
    ]);
    expect(next.days.every((day) => day.status === "complete")).toBe(true);
    expect(site.sent.length - before).toBe(21);
    report("recent, 20 categories, after the next announcement", [
      ["requests", site.sent.length - before],
      ["duration (min)", minutes(clock.now() - start)],
    ]);
  });

  it("catch-up over 10 days: 1 + 20 x 10 = 201 requests, about 50 minutes, day by day", async () => {
    const { clock, site, service } = setup();
    const shown: DayListing[] = [];
    const result = await clock.run(
      service.loadCatchup(SPECS, DAYS[2], { onDay: (day) => shown.push(day) }),
    );
    expect(result.days.map((day) => day.date)).toEqual(DAYS.slice(2));
    expect(result.days.every((day) => day.status === "complete")).toBe(true);
    expect(site.sent).toHaveLength(1 + 20 * 10);
    expectSpacing(site);
    const duration = clock.now() - NOW;
    expect(duration).toBeLessThan(200 * 17000);
    report("catch-up, 20 categories, 10 days", [
      ["requests", site.sent.length],
      ["duration (min)", minutes(duration)],
    ]);
  });

  it("new: 20 requests, about 5 minutes", async () => {
    const { clock, site, service } = setup();
    const result = await clock.run(service.loadNew(SPECS));
    expect(site.sent).toHaveLength(20);
    expect(result.days[0]).toMatchObject({ date: LATEST, status: "complete" });
    report("new, 20 categories", [
      ["requests", site.sent.length],
      ["duration (min)", minutes(clock.now() - NOW)],
    ]);
  });

  it("cancelling after two days stops at once: no further request, the one in flight aborted", async () => {
    const { clock, site, service } = setup();
    const controller = new AbortController();
    const shown: string[] = [];
    let cancelledAt = 0;
    const loading = service.loadRecent(SPECS, {
      signal: controller.signal,
      onDay: (day) => {
        shown.push(day.date);
        if (shown.length === 2) {
          // The user closes the window while the next request is in flight
          // (it is sent 15 s after the last one and takes at least 0.3 s)
          void clock.sleep(15100).then(() => {
            cancelledAt = clock.now();
            controller.abort();
          });
        }
      },
    });
    const result = await clock.run(loading);
    expect(shown).toEqual(INDEX.slice(0, 2));
    expect(result.stopped?.reason).toBe("cancelled");
    // 1 index + 20 + 20 requests for two days, then the one cancelled
    expect(site.sent).toHaveLength(42);
    expect(site.sent.at(-1)!.end).toBe(cancelledAt);
    expect(clock.now() - cancelledAt).toBe(0);
    await clock.advanceBy(10 * 60 * 1000);
    expect(site.sent).toHaveLength(42);
    report("cancel after two days", [
      ["requests sent", site.sent.length],
      ["cancelled at (min)", minutes(cancelledAt - NOW)],
    ]);
  });
});
