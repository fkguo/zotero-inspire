import { JSDOM, type DOMWindow } from "jsdom";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import {
  arxivSearchQuery,
  searchArxiv,
  searchUrl,
} from "../src/modules/arxiv/arxivApi";
import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import type { InspireBibtexAnswer } from "../src/modules/arxiv/inspireByArxiv";
import { ListingService } from "../src/modules/arxiv/listingService";
import { MemoryListingStore } from "../src/modules/arxiv/listingStore";
import { ArxivBrowserView } from "../src/modules/arxiv/browser/ArxivBrowserView";
import type { InspireRecordAnswer } from "../src/modules/arxiv/browser/browserActions";
import {
  ReadingState,
  readingStateFile,
} from "../src/modules/arxiv/browser/readingState";
import { servedListingDays } from "../src/modules/arxiv/browser/DayPicker";
import type { ArxivSubscription } from "../src/modules/arxiv/browser/subscriptions";
import {
  formatDay,
  formatMonth,
  formatShortDay,
} from "../src/modules/arxiv/browser/browserText";
import { invalidateDarkModeCache } from "../src/modules/inspire/styles";
import { htmlDocument, readArxivFixture, xmlDocument } from "./arxivFixtures";
import { fakeFiles } from "./fakeFiles";
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
import { flushPromises, VirtualClock } from "./virtualClock";

// The right-click menu's Copy and Copy as LaTeX use the plugin's clipboard
// helper directly
const clipboard = vi.hoisted(() => ({
  copyToClipboard: vi.fn(async (_text: string) => true),
}));
vi.mock("../src/modules/inspire/apiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/inspire/apiUtils")>()),
  ...clipboard,
}));
// The batch import's duplicate check: none of the papers is in the library
vi.mock(
  "../src/modules/inspire/library/localStatus",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/modules/inspire/library/localStatus")
    >()),
    findDuplicates: async () => new Map(),
  }),
);

// The arXiv browser window's content in a jsdom window, loading from a
// simulated arxiv.org on a simulated clock (real hep-ph listing of Friday
// 25 September 2026 where one is needed). getString() returns the message ID
// with its arguments, so texts are checked by message.

// These tests draw pages of up to 200 rows in jsdom and let minutes of arXiv
// requests pass on the simulated clock: a second or two each, more when the
// machine is busy
vi.setConfig({ testTimeout: 20000 });

/** Sunday 27 September 2026, 13:00 in New York: newest listing is Friday 25 */
const NOW = "2026-09-27T17:00:00Z";
const DAYS = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];
const NEXT: Record<string, string> = {
  "2026-09-21": "2026-09-22",
  "2026-09-22": "2026-09-23",
  "2026-09-23": "2026-09-24",
  "2026-09-24": "2026-09-25",
};
const PREFIX = config.prefsPrefix;

let win: DOMWindow;
let prefs: Record<string, unknown>;

beforeEach(() => {
  win = new JSDOM(
    "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
    { url: "https://zotero.test/", pretendToBeVisual: true },
  ).window;
  // jsdom lays nothing out
  win.HTMLElement.prototype.scrollIntoView = () => undefined;
  win.document.documentElement.setAttribute(
    "zotero-platform-darkmode",
    "false",
  );
  invalidateDarkModeCache();
  prefs = {
    [`${PREFIX}.latex_render_mode`]: "unicode",
    [`${PREFIX}.max_authors`]: 3,
  };
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    launchURL: vi.fn(),
    getMainWindow: () => win,
    // Items the tests mark as in the library have no PDF
    Items: { get: () => false, getLibraryAndKeyFromID: () => false },
    Prefs: {
      get: (key: string) => prefs[key],
      set: (key: string, value: unknown) => {
        prefs[key] = value;
      },
    },
  });
  vi.stubGlobal("addon", {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id, args }]: Array<{
            id: string;
            args?: Record<string, unknown>;
          }>) => [{ value: args ? `${id} ${JSON.stringify(args)}` : id }],
        },
      },
    },
  });
});

let view: ArxivBrowserView | null = null;
afterEach(() => {
  view?.dispose();
  view = null;
  // Stops the window's timers and animation frames
  win.close();
  vi.unstubAllGlobals();
});

function msg(key: string, args?: Record<string, unknown>) {
  const id = `${config.addonRef}-${key}`;
  return args ? `${id} ${JSON.stringify(args)}` : id;
}

function subscribe(
  categories: string[],
  sections = { new: true, cross: true, replace: true },
): ArxivSubscription {
  const subscription = { id: "sub-1", name: "Daily", categories, sections };
  prefs[`${PREFIX}.arxiv_subscriptions`] = JSON.stringify([subscription]);
  return subscription;
}

let counter = 20000;
function smallDay(spec: string, count: number): SiteEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `2609.${counter++}`,
    section: i % 3 === 2 ? ("cross" as const) : ("new" as const),
    primary: i % 3 === 2 ? "gr-qc" : spec,
    cross: i % 3 === 2 ? [spec] : [],
    title: `Paper ${i} of ${spec} with $m_\\pi$`,
  }));
}

function environment() {
  const clock = new VirtualClock(Date.parse(NOW));
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
  const launch = vi.fn();
  const copy = vi.fn(async () => true);
  // INSPIRE's BibTeX: none by default (no request to INSPIRE)
  const inspireBibtex = vi.fn(
    async (
      _id: string,
      _recid: string | null,
    ): Promise<InspireBibtexAnswer> => ({ status: "notFound" }),
  );
  // INSPIRE's recid and authors: none by default (no request to INSPIRE)
  const inspireRecord = vi.fn(
    async (_id: string): Promise<InspireRecordAnswer> => ({
      status: "notFound",
    }),
  );
  const root = win.document.getElementById("root")!;
  // Marks of this test only, in memory
  const reading = new ReadingState(null, clock);
  const open = (options: Record<string, unknown> = {}) => {
    view = new ArxivBrowserView(root, {
      listing: service,
      webScheduler: scheduler,
      clock,
      launch,
      copy,
      inspireBibtex,
      inspireRecord,
      confirm: () => true,
      readingState: reading,
      ...options,
    });
    return view;
  };
  /** Let the loading run until it ends */
  const settle = async () => {
    for (let i = 0; i < 400 && view?.loader.running; i++) {
      await clock.advanceBy(1000);
    }
    await flushPromises();
  };
  return {
    clock,
    site,
    scheduler,
    store,
    service,
    launch,
    copy,
    inspireBibtex,
    inspireRecord,
    root,
    reading,
    open,
    settle,
  };
}

/** Serve the real hep-ph /new of 25 Sep and hep-ph catch-up days before it */
function serveHepPh(site: SimulatedArxiv, perDay = 6) {
  site.html(
    LIST_URL("hep-ph"),
    readArxivFixture("list-hep-ph-new-2026-09-25.html"),
  );
  site.html(
    INDEX_URL,
    recentIndexHtml("math", ["2026-09-25", ...[...DAYS].reverse()]),
  );
  for (const date of DAYS) {
    site.html(
      CATCHUP_URL("hep-ph", date),
      catchupPageHtml("hep-ph", date, smallDay("hep-ph", perDay), NEXT[date]),
    );
  }
}

const rows = (root: HTMLElement) =>
  [
    ...root.querySelectorAll(".arxiv-browser__list .zinspire-ref-entry"),
  ] as HTMLElement[];
const headers = (root: HTMLElement) =>
  [...root.querySelectorAll(".arxiv-browser__day, .arxiv-browser__group")].map(
    (header) =>
      header.classList.contains("arxiv-browser__day")
        ? `# ${(header as HTMLElement).dataset.date}${header.querySelector(".arxiv-browser__continued") ? " (cont.)" : ""}`
        : `## ${header.firstChild?.textContent}${header.querySelector(".arxiv-browser__continued") ? " (cont.)" : ""}`,
  );
const statusText = (root: HTMLElement) =>
  root.querySelector(".arxiv-browser__status")!.textContent ?? "";
const key = (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(
    new win.KeyboardEvent("keydown", { key, bubbles: true, ...init }),
  );
/**
 * arXiv's BibTeX as copied for the first paper of 25 Sep (2609.28538, by
 * D. Vattolo et al., "Spectral shaping ..."), in neither the library nor
 * INSPIRE: with the key arxivCitationKey gives it
 */
const keyed = (bibtex: string) =>
  bibtex.replace(/^@(\w+)\{[^,]*,/, "@$1{Vattolo:2026spectral,");
/** The toolbar's lists: subscription, sort, page size */
const TOOLBAR = ["subscription", "sort", "size"];
const select = (root: HTMLElement, name: string) =>
  root.querySelectorAll<HTMLSelectElement>(".arxiv-browser__toolbar select")[
    TOOLBAR.indexOf(name)
  ];

describe("arXiv browser: loading", () => {
  it("opens with the default subscription and shows the newest day", async () => {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    const view = env.open();
    expect(statusText(env.root)).toContain(msg("arxiv-browser-status-loading"));
    await env.settle();

    expect(view.loader.days.map((day) => day.date)).toEqual(["2026-09-25"]);
    // 72 papers: page 1 of 2 with 50
    expect(rows(env.root)).toHaveLength(50);
    expect(headers(env.root)).toEqual([
      "# 2026-09-25",
      `## ${msg("arxiv-browser-section-new")} · 27`,
      `## ${msg("arxiv-browser-section-cross")} · 15`,
      `## ${msg("arxiv-browser-section-replace")} · 30`,
    ]);
    const first = rows(env.root)[0];
    expect(first.dataset.entryId).toBe("arxiv-2609.28538-2026-09-25");
    expect(first.querySelector(".zinspire-ref-entry__meta")!.textContent).toBe(
      "[arXiv:2609.28538] · hep-ph",
    );
    expect(statusText(env.root)).toBe(
      msg("arxiv-browser-status-loaded", { days: 1, papers: 72 }),
    );
  });

  it("shows each recent day as it arrives, with arXiv's request interval in the status", async () => {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "recent";
    const view = env.open();
    // /new first: the newest day is shown at once, while the index waits
    await env.clock.advanceBy(2000);
    expect(rows(env.root).length).toBeGreaterThan(0);
    expect(env.site.count(INDEX_URL)).toBe(0);
    // After the index the newest day is final and the next request waits
    // for its turn
    await env.clock.advanceBy(15000);
    expect(view.loader.days.map((day) => day.date)).toEqual(["2026-09-25"]);
    expect(rows(env.root).length).toBeGreaterThan(0);
    expect(statusText(env.root)).toMatch(
      new RegExp(
        `${msg("arxiv-browser-status-waiting").replace(/[-]/g, "\\-")} \\{"seconds":\\d+\\}`,
      ),
    );
    await env.settle();
    expect(view.loader.days.map((day) => day.date)).toEqual([
      "2026-09-25",
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
    ]);
    // The day index lists them in that order
    const chips = [...env.root.querySelectorAll(".arxiv-browser__day-chip")];
    expect(chips).toHaveLength(5);
  });

  it("cancels a load of this week, keeping the days loaded, and continues it", async () => {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "week";
    const view = env.open();
    // index at 0 s, /new (25 Sep) at 15 s, 24 Sep at 30 s
    await env.clock.advanceBy(35000);
    expect(view.loader.days.map((day) => day.date)).toEqual([
      "2026-09-25",
      "2026-09-24",
    ]);
    const cancel = [
      ...env.root.querySelectorAll<HTMLButtonElement>(
        ".arxiv-browser__bar > button",
      ),
    ].find((b) => b.textContent === msg("arxiv-browser-cancel"))!;
    expect(cancel.hidden).toBe(false);
    cancel.click();
    await env.settle();
    expect(cancel.hidden).toBe(true);
    expect(statusText(env.root)).toContain(
      msg("arxiv-browser-status-cancelled"),
    );
    expect(rows(env.root).length).toBeGreaterThan(0);

    const next = [
      ...env.root.querySelectorAll(".arxiv-browser__status button"),
    ].find((b) => b.textContent === msg("arxiv-browser-continue"))!;
    next.dispatchEvent(new win.MouseEvent("click"));
    await env.settle();
    expect(view.loader.days.map((day) => day.date)).toEqual([
      "2026-09-25",
      ...[...DAYS].reverse(),
    ]);
    expect(
      [...env.root.querySelectorAll(".arxiv-browser__status button")].map(
        (b) => b.textContent,
      ),
    ).not.toContain(msg("arxiv-browser-continue"));
  });

  it("shows a day not fetched completely with the reason and a Retry that fetches it again", async () => {
    const env = environment();
    subscribe(["hep-ph", "hep-lat"]);
    serveHepPh(env.site);
    env.site.html(
      LIST_URL("hep-lat"),
      newPageHtml("hep-lat", "2026-09-25", smallDay("hep-lat", 3)),
    );
    // hep-lat's catch-up page of 23 Sep fails once
    for (const date of DAYS) {
      const html = catchupPageHtml(
        "hep-lat",
        date,
        smallDay("hep-lat", 3),
        NEXT[date],
      );
      env.site.page(CATCHUP_URL("hep-lat", date), (attempt) =>
        date === "2026-09-23" && attempt === 1
          ? { status: 500, text: "error" }
          : { text: html },
      );
    }
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "recent";
    const view = env.open();
    await env.settle();

    const day = () =>
      env.root.querySelector('.arxiv-browser__day[data-date="2026-09-23"]');
    view.listPane.goToDay("2026-09-23");
    expect(day()!.textContent).toContain(msg("arxiv-browser-day-incomplete"));
    expect(day()!.textContent).toContain(
      msg("arxiv-browser-day-spec-failed", {
        spec: "hep-lat",
        reason: msg("arxiv-browser-reason-http"),
      }),
    );
    const chip = [
      ...env.root.querySelectorAll(".arxiv-browser__day-chip"),
    ].find((element) => element.textContent!.includes("⚠"));
    expect(chip).toBeDefined();

    day()!.querySelector<HTMLButtonElement>(".arxiv-browser__retry")!.click();
    await env.settle();
    view.listPane.goToDay("2026-09-23");
    expect(day()!.querySelector(".arxiv-browser__retry")).toBeNull();
    expect(view.loader.days.map((d) => d.status)).toEqual(
      Array(5).fill("complete"),
    );
  });

  it("shows the first category's papers at once, noting the categories still being fetched", async () => {
    const env = environment();
    subscribe(["hep-ph", "hep-lat", "nucl-th"]);
    serveHepPh(env.site);
    for (const spec of ["hep-lat", "nucl-th"]) {
      env.site.html(
        LIST_URL(spec),
        newPageHtml(spec, "2026-09-25", smallDay(spec, 3)),
      );
    }
    const view = env.open();
    // hep-ph's /new has come; hep-lat's waits for its turn
    await env.clock.advanceBy(5000);
    expect(view.loader.running).toBe(true);
    expect(rows(env.root)).toHaveLength(50);
    const header = () => env.root.querySelector(".arxiv-browser__day")!;
    expect(header().textContent).toContain(
      msg("arxiv-browser-day-loading", { specs: "hep-lat, nucl-th" }),
    );
    expect(header().textContent).not.toContain(
      msg("arxiv-browser-day-incomplete"),
    );
    expect(header().querySelector(".arxiv-browser__retry")).toBeNull();
    const chip = () =>
      env.root.querySelector(".arxiv-browser__day-chip")!.textContent!;
    expect(chip()).toMatch(/ …$/);
    await env.clock.advanceBy(15000);
    expect(header().textContent).toContain(
      msg("arxiv-browser-day-loading", { specs: "nucl-th" }),
    );

    await env.settle();
    expect(header().textContent).not.toContain(
      msg("arxiv-browser-day-loading", { specs: "nucl-th" }),
    );
    expect(chip()).not.toMatch(/…|⚠/);
    expect(view.listPane.entries).toHaveLength(78);
  });

  it("keeps the rows in view, their rows and library marks when more categories arrive", async () => {
    const env = environment();
    subscribe(["hep-ph", "hep-lat"]);
    serveHepPh(env.site);
    env.site.html(
      LIST_URL("hep-lat"),
      newPageHtml("hep-lat", "2026-09-25", smallDay("hep-lat", 3)),
    );
    // The library answers the first lookup only
    let lookups = 0;
    const view = env.open({
      inLibrary: (ids: readonly string[]) =>
        lookups++
          ? new Promise(() => undefined)
          : Promise.resolve(
              new Map(
                ids.filter((id) => id === "2609.28544").map((id) => [id, [77]]),
              ),
            ),
    });
    await env.clock.advanceBy(5000);
    await flushPromises();
    const list = env.root.querySelector<HTMLElement>(".arxiv-browser__list")!;
    // jsdom lays nothing out: headers 20 px and rows 40 px high, one below
    // the other, in a list 400 px high at the top of the window
    const top = (element: Element) => {
      let y = 0;
      for (const child of list.children) {
        if (child === element) return y - list.scrollTop;
        y += child.classList.contains("zinspire-ref-entry") ? 40 : 20;
      }
      return NaN;
    };
    vi.spyOn(
      win.HTMLElement.prototype,
      "getBoundingClientRect",
    ).mockImplementation(function (this: HTMLElement) {
      const y = this === list ? 0 : top(this);
      const height = this === list ? 400 : 40;
      return { top: y, bottom: y + height } as DOMRect;
    });
    const byId = (id: string) =>
      rows(env.root).find(
        (row) => row.dataset.entryId === `arxiv-${id}-2026-09-25`,
      )!;
    // The reader is at hep-ph's first cross-list, 10 px into its row
    const reading = byId("2609.22470");
    list.scrollTop = top(reading) + 10;
    const marked = byId("2609.28544");
    const dot = () =>
      byId("2609.28544")
        .querySelector(".zinspire-ref-entry__dot")!
        .getAttribute("data-state");
    expect(dot()).toBe("local");

    await env.settle();
    expect(view.listPane.entries).toHaveLength(75);
    // hep-lat's two new papers came before it: the row stays where it was
    expect(rows(env.root).indexOf(byId("2609.22470"))).toBe(29);
    expect(byId("2609.22470")).toBe(reading);
    expect(reading.getBoundingClientRect().top).toBe(-10);
    // Rows drawn before are kept, with their marks, before the library
    // answers again
    expect(byId("2609.28544")).toBe(marked);
    expect(dot()).toBe("local");
    expect(lookups).toBe(2);
  });

  it("keeps the focused paper in view when more categories push it to the next page", async () => {
    const env = environment();
    subscribe(["hep-ph", "hep-lat"]);
    serveHepPh(env.site);
    env.site.html(
      LIST_URL("hep-lat"),
      newPageHtml("hep-lat", "2026-09-25", smallDay("hep-lat", 3)),
    );
    const view = env.open();
    await env.clock.advanceBy(5000);
    const list = env.root.querySelector<HTMLElement>(".arxiv-browser__list")!;
    // Rows 40 px and headers 20 px high, in a list 400 px high
    const top = (element: Element) => {
      let y = 0;
      for (const child of list.children) {
        if (child === element) return y - list.scrollTop;
        y += child.classList.contains("zinspire-ref-entry") ? 40 : 20;
      }
      return NaN;
    };
    vi.spyOn(
      win.HTMLElement.prototype,
      "getBoundingClientRect",
    ).mockImplementation(function (this: HTMLElement) {
      const y = this === list ? 0 : top(this);
      const height = this === list ? 400 : 40;
      return { top: y, bottom: y + height } as DOMRect;
    });
    // The last paper of page 1 focused, near the bottom of the view
    view.listPane.focusPageEnd("last");
    const focused = view.listPane.focused!;
    const row = () =>
      rows(env.root).find((r) => r.dataset.entryId === focused.id);
    list.scrollTop = top(row()!) - 300;
    expect(top(row()!)).toBe(300);

    await env.settle();
    // hep-lat's papers came before it: page 2, the paper where it was
    expect(view.listPane.currentPage).toBe(1);
    expect(view.listPane.focused).toBe(focused);
    expect(row()!.getBoundingClientRect().top).toBe(300);
    expect(row()!.classList.contains("zinspire-entry-focused")).toBe(true);
  });

  it("says when a day is a cached copy because fetching failed", async () => {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    const first = env.open();
    await env.settle();
    first.dispose();
    // A day later arXiv cannot be reached; the copy from the cache is shown
    env.site.page(LIST_URL("hep-ph"), { status: 0 });
    await env.clock.advanceBy(24 * 3600 * 1000);
    const view = env.open();
    await env.settle();
    expect(view.loader.days.map((day) => day.date)).toEqual(["2026-09-25"]);
    expect(
      env.root.querySelector(".arxiv-browser__day-notes")!.textContent,
    ).toContain(
      msg("arxiv-browser-day-spec-cached", {
        spec: "hep-ph",
        reason: msg("arxiv-browser-reason-network"),
      }),
    );
  });

  it("reloads for another subscription but not for a change of shown sections", async () => {
    const env = environment();
    subscribe(["hep-ph"], { new: true, cross: true, replace: false });
    serveHepPh(env.site);
    const view = env.open();
    await env.settle();
    const sent = env.site.sent.length;
    expect(rows(env.root)).toHaveLength(42);

    const boxes = env.root.querySelectorAll<HTMLInputElement>(
      ".arxiv-browser__sections input",
    );
    boxes[1].click(); // cross-lists off
    expect(rows(env.root)).toHaveLength(27);
    expect(env.site.sent.length).toBe(sent);
    expect(
      JSON.parse(String(prefs[`${PREFIX}.arxiv_subscriptions`]))[0].sections,
    ).toEqual({ new: true, cross: false, replace: false });
    // The last shown section cannot be switched off
    boxes[0].click();
    expect(boxes[0].checked).toBe(true);
    expect(rows(env.root)).toHaveLength(27);
    expect(view.loader.running).toBe(false);
  });
});

describe("arXiv browser: the list", () => {
  async function loaded(perPage?: number) {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site, 30);
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "recent";
    if (perPage) prefs[`${PREFIX}.arxiv_browser_page_size`] = perPage;
    const view = env.open();
    await env.settle();
    return { ...env, view };
  }

  it("keeps only the chosen categories' papers with the chips, each where that category lists it", async () => {
    const env = environment();
    subscribe(["hep-ph", "hep-lat", "hep-ex"]);
    env.site.html(
      LIST_URL("hep-ph"),
      readArxivFixture("list-hep-ph-new-2026-09-25.html"),
    );
    // hep-ex: no paper that day
    env.site.html(LIST_URL("hep-ex"), newPageHtml("hep-ex", "2026-09-25", []));
    // hep-lat: one new paper, and hep-ph's first new paper as a cross-list
    env.site.html(
      LIST_URL("hep-lat"),
      newPageHtml("hep-lat", "2026-09-25", [
        { id: "2609.90001", section: "new", primary: "hep-lat" },
        {
          id: "2609.28538",
          section: "cross",
          primary: "hep-ph",
          cross: ["hep-lat"],
        },
      ]),
    );
    prefs[`${PREFIX}.arxiv_browser_page_size`] = 500;
    env.open();
    await env.settle();
    const chips = () => [
      ...env.root.querySelectorAll<HTMLElement>(".arxiv-browser__chip"),
    ];
    const chosen = () =>
      chips()
        .filter((chip) =>
          chip.classList.contains("arxiv-browser__chip--chosen"),
        )
        .map((chip) => chip.textContent);
    const click = (name: string, init: MouseEventInit = {}) =>
      chips()
        .find((chip) => chip.textContent === name)!
        .dispatchEvent(new win.MouseEvent("click", { bubbles: true, ...init }));
    const shown = () =>
      rows(env.root).map((row) => row.dataset.entryId!.split("-")[1]);
    const all = shown();
    expect(all).toHaveLength(73);

    click("hep-lat");
    expect(chosen()).toEqual(["hep-lat"]);
    expect(shown()).toEqual(["2609.90001", "2609.28538"]);
    expect(headers(env.root)).toEqual([
      "# 2026-09-25",
      `## ${msg("arxiv-browser-section-new")} · 1`,
      `## ${msg("arxiv-browser-section-cross")} · 1`,
    ]);

    // Hiding the cross-lists keeps the choice: hep-lat's new paper only
    const crossBox = env.root.querySelectorAll<HTMLInputElement>(
      ".arxiv-browser__check input",
    )[1];
    crossBox.click();
    expect(chosen()).toEqual(["hep-lat"]);
    expect(shown()).toEqual(["2609.90001"]);
    crossBox.click();
    expect(shown()).toEqual(["2609.90001", "2609.28538"]);

    // Sorted by identifier, a row tells the section of the chosen page:
    // hep-ph's new paper is a cross-list on hep-lat
    const sort = select(env.root, "sort");
    sort.value = "id-asc";
    sort.dispatchEvent(new win.Event("change", { bubbles: true }));
    const rowOf = (id: string) =>
      rows(env.root).find((row) => row.dataset.entryId!.includes(id))!;
    expect(rowOf("2609.28538").textContent).toContain(
      msg("arxiv-browser-section-tag-cross"),
    );
    expect(rowOf("2609.90001").textContent).not.toContain(
      msg("arxiv-browser-section-tag-cross"),
    );
    sort.value = "announcement";
    sort.dispatchEvent(new win.Event("change", { bubbles: true }));

    // A category without papers that day says so
    click("hep-ex");
    expect(shown()).toEqual([]);
    expect(
      env.root.querySelector(".arxiv-browser__day-notes")?.textContent,
    ).toContain(msg("arxiv-browser-day-none-chosen"));
    click("hep-lat");

    // Ctrl/Cmd+click adds hep-ph: all papers again
    click("hep-ph", { ctrlKey: true });
    expect(chosen()).toEqual(["hep-ph", "hep-lat"]);
    expect(shown()).toEqual(all);

    // A click keeps hep-ph alone; clicked again, it shows all
    click("hep-ph");
    expect(chosen()).toEqual(["hep-ph"]);
    expect(shown()).toHaveLength(72);
    expect(shown()).not.toContain("2609.90001");
    click("hep-ph");
    expect(chosen()).toEqual([]);
    expect(shown()).toEqual(all);
  });

  it("does not call a chosen category empty when its page was not fetched", async () => {
    const env = environment();
    subscribe(["hep-ph", "hep-lat"]);
    env.site.html(
      LIST_URL("hep-ph"),
      readArxivFixture("list-hep-ph-new-2026-09-25.html"),
    );
    env.site.page(LIST_URL("hep-lat"), { status: 500 });
    env.open();
    await env.settle();
    [...env.root.querySelectorAll<HTMLElement>(".arxiv-browser__chip")]
      .find((chip) => chip.textContent === "hep-lat")!
      .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(rows(env.root)).toHaveLength(0);
    const notes =
      env.root.querySelector(".arxiv-browser__day-notes")?.textContent ?? "";
    expect(notes).toContain(msg("arxiv-browser-day-incomplete"));
    expect(notes).not.toContain(msg("arxiv-browser-day-none-chosen"));
  });

  it("does not call a day empty when a page that was not fetched may hold its papers", async () => {
    const env = environment();
    subscribe(["hep-ph", "hep-lat"]);
    // hep-ph has no paper that day, hep-lat's page fails
    env.site.html(LIST_URL("hep-ph"), newPageHtml("hep-ph", "2026-09-25", []));
    env.site.page(LIST_URL("hep-lat"), { status: 500 });
    env.open();
    await env.settle();
    const notes = () =>
      env.root.querySelector(".arxiv-browser__day-notes")?.textContent ?? "";
    expect(notes()).toContain(msg("arxiv-browser-day-incomplete"));
    expect(notes()).not.toContain(msg("arxiv-browser-day-empty"));
    // Also with hep-lat chosen
    [...env.root.querySelectorAll<HTMLElement>(".arxiv-browser__chip")]
      .find((chip) => chip.textContent === "hep-lat")!
      .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(notes()).toContain(msg("arxiv-browser-day-incomplete"));
    expect(notes()).not.toContain(msg("arxiv-browser-day-empty"));
  });

  it("does not say that none matches the filter when a page of the day was not fetched", async () => {
    const env = environment();
    subscribe(["hep-ph", "hep-lat"]);
    env.site.html(
      LIST_URL("hep-ph"),
      readArxivFixture("list-hep-ph-new-2026-09-25.html"),
    );
    env.site.page(LIST_URL("hep-lat"), { status: 500 });
    env.open();
    await env.settle();
    const filter = env.root.querySelector<HTMLInputElement>(
      ".arxiv-browser__filter input",
    )!;
    filter.value = "nosuchwordanywhere";
    filter.dispatchEvent(new win.Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(rows(env.root)).toHaveLength(0));
    const notes =
      env.root.querySelector(".arxiv-browser__day-notes")?.textContent ?? "";
    expect(notes).toContain(msg("arxiv-browser-day-incomplete"));
    expect(notes).not.toContain(msg("arxiv-browser-day-no-match"));
  });

  it("repeats the headers on a page that begins inside a day and a section", async () => {
    const { root, view } = await loaded();
    // 72 + 4 × 30 papers
    expect(view.listPane.pages).toBe(4);
    view.listPane.goToPage(1);
    expect(headers(root).slice(0, 2)).toEqual([
      "# 2026-09-25 (cont.)",
      `## ${msg("arxiv-browser-section-replace")} · 30 (cont.)`,
    ]);
    const pager = root.querySelector(".arxiv-browser__pager")!;
    expect(
      pager.querySelector(".arxiv-browser__page--current")!.textContent,
    ).toBe("2");
  });

  it("turns pages with n / p and the buttons, and moves with j / k across pages", async () => {
    const { root, view } = await loaded(10);
    const list = root.querySelector(".arxiv-browser__list")!;
    key(list, "n");
    expect(view.listPane.currentPage).toBe(1);
    key(list, "p");
    expect(view.listPane.currentPage).toBe(0);
    // j from no focus: the first paper; ten times more: the next page
    key(list, "j");
    expect(view.listPane.focused?.listing.id).toBe("2609.28538");
    for (let i = 0; i < 10; i++) key(list, "j");
    expect(view.listPane.currentPage).toBe(1);
    expect(
      root
        .querySelector(".zinspire-entry-focused")
        ?.getAttribute("data-entry-id"),
    ).toBe(view.listPane.focused?.id);
    key(list, "k");
    expect(view.listPane.currentPage).toBe(0);
    expect(view.listPane.focused?.id).toBe(rows(root)[9].dataset.entryId);
    // Not while typing in the filter
    const filter = root.querySelector<HTMLInputElement>(
      ".arxiv-browser__filter input",
    )!;
    key(filter, "n");
    expect(view.listPane.currentPage).toBe(0);
    [
      ...root.querySelectorAll<HTMLButtonElement>(
        ".arxiv-browser__pager button",
      ),
    ]
      .find((b) => b.textContent === msg("arxiv-browser-page-next"))!
      .click();
    expect(view.listPane.currentPage).toBe(1);
  });

  it("jumps to a day from the day index", async () => {
    const { root, view } = await loaded();
    const chips = [
      ...root.querySelectorAll<HTMLButtonElement>(".arxiv-browser__day-chip"),
    ];
    chips[4].click(); // 21 Sep, the last day
    expect(view.listPane.currentPage).toBe(3);
    expect(
      root.querySelector('.arxiv-browser__day[data-date="2026-09-21"]'),
    ).not.toBeNull();
    expect(chips.length).toBe(5);
    expect(view.listPane.focused).toBeNull();
  });

  it("moves the focus to the first paper of the day jumped to", async () => {
    const { root, view } = await loaded();
    const list = root.querySelector(".arxiv-browser__list")!;
    key(list, "j");
    expect(view.listPane.focused?.listing.announceDate).toBe("2026-09-25");
    root
      .querySelectorAll<HTMLButtonElement>(".arxiv-browser__day-chip")[3]
      .click(); // 22 Sep
    const first = view.listPane.focused!;
    expect(first.listing.announceDate).toBe("2026-09-22");
    expect(view.listPane.entries.indexOf(first)).toBe(72 + 30 + 30);
    // Keys go on from there
    key(list, "j");
    expect(view.listPane.entries.indexOf(view.listPane.focused!)).toBe(
      72 + 30 + 30 + 1,
    );
  });

  it("changes the page size and keeps the choice", async () => {
    const { root, view, open, settle } = await loaded();
    const size = select(root, "size");
    size.value = "200";
    size.dispatchEvent(new win.Event("change"));
    expect(view.listPane.pages).toBe(1);
    expect(rows(root)).toHaveLength(192);
    expect(prefs[`${PREFIX}.arxiv_browser_page_size`]).toBe(200);
    // The next window opens with it
    view.dispose();
    const again = open();
    await settle();
    expect(select(root, "size").value).toBe("200");
    expect(again.listPane.pages).toBe(1);
    expect(rows(root)).toHaveLength(192);
  });

  it("hides abstracts by default, shows them all, and toggles one with Space", async () => {
    const { root, view } = await loaded();
    const collapsed = () =>
      rows(root).filter((row) =>
        row.classList.contains("arxiv-browser__row--collapsed"),
      );
    expect(collapsed()).toHaveLength(50);
    const all = [
      ...root.querySelectorAll<HTMLInputElement>(".arxiv-browser__check input"),
    ].pop()!;
    expect(all.checked).toBe(false);
    all.click();
    expect(collapsed()).toHaveLength(0);
    key(root.querySelector(".arxiv-browser__list")!, "j");
    key(root.querySelector(".arxiv-browser__list")!, " ");
    expect(collapsed()).toHaveLength(1);
    expect(
      rows(root)[0].classList.contains("arxiv-browser__row--collapsed"),
    ).toBe(true);
    // The row's own toggle
    rows(root)[1]
      .querySelector<HTMLButtonElement>(".arxiv-browser__abstract-toggle")!
      .click();
    expect(collapsed()).toHaveLength(2);
    expect(view.listPane.focused?.id).toBe(rows(root)[1].dataset.entryId);
  });

  it("shows abstracts in the list when the setting says so", async () => {
    prefs[`${PREFIX}.arxiv_browser_abstracts_expanded`] = true;
    const { root } = await loaded();
    expect(
      rows(root).filter((row) =>
        row.classList.contains("arxiv-browser__row--collapsed"),
      ),
    ).toHaveLength(0);
  });

  it("renders the formulas of an abstract once it comes into view", async () => {
    const observed: Element[] = [];
    let report:
      | ((records: Array<{ target: Element; isIntersecting: boolean }>) => void)
      | null = null;
    (win as any).IntersectionObserver = class {
      constructor(callback: typeof report) {
        report = callback;
      }
      observe(element: Element) {
        observed.push(element);
      }
      unobserve() {}
      disconnect() {
        observed.length = 0;
      }
    };
    prefs[`${PREFIX}.arxiv_browser_abstracts_expanded`] = true;
    const { root } = await loaded();
    expect(observed).toHaveLength(50);
    const [first, second] = observed as HTMLElement[];
    report!([{ target: first, isIntersecting: true }]);
    await flushPromises();
    expect(first.dataset.formulas).toBe("rendered");
    expect(second.dataset.formulas).toBeUndefined();
    expect(rows(root).length).toBe(50);
  });

  it("sorts by arXiv identifier and by primary category", async () => {
    const { root } = await loaded(500);
    const sort = select(root, "sort");
    sort.value = "id-desc";
    sort.dispatchEvent(new win.Event("change"));
    const ids = rows(root).map((row) => row.dataset.entryId!.split("-")[1]);
    const today = ids.slice(0, 72);
    expect([...today].sort().reverse()).toEqual(today);
    // Section tags on the rows instead of section headers
    expect(headers(root).filter((line) => line.startsWith("##"))).toEqual([]);
    expect(
      rows(root).some((row) =>
        row.textContent!.includes(msg("arxiv-browser-section-tag-replace")),
      ),
    ).toBe(true);

    sort.value = "primary";
    sort.dispatchEvent(new win.Event("change"));
    const groups = headers(root).filter((line) => line.startsWith("##"));
    expect(groups[0]).toMatch(
      /^## hep-ph — High Energy Physics - Phenomenology · \d+$/,
    );
  });

  it("filters by the text typed, telling how many of the day's papers are shown", async () => {
    const { root, view } = await loaded(500);
    const filter = root.querySelector<HTMLInputElement>(
      ".arxiv-browser__filter input",
    )!;
    filter.value = "hep-lat";
    filter.dispatchEvent(new win.Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const shown = view.listPane.entries;
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(72);
    expect(
      root.querySelector(
        '.arxiv-browser__day[data-date="2026-09-25"] .arxiv-browser__day-count',
      )!.textContent,
    ).toBe(
      msg("arxiv-browser-day-filtered", {
        shown: shown.filter((e) => e.listing.announceDate === "2026-09-25")
          .length,
        count: 72,
      }),
    );
  });
});

describe("arXiv browser: read-only actions and keys", () => {
  async function loaded(options: Record<string, unknown> = {}) {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    const view = env.open(options);
    await env.settle();
    return { ...env, view };
  }

  it("opens the abstract page and the PDF in the web browser", async () => {
    const { root, launch } = await loaded();
    const row = rows(root)[0];
    const title = row.querySelector<HTMLAnchorElement>(
      ".zinspire-ref-entry__title-link",
    )!;
    const click = new win.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    title.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(launch).toHaveBeenLastCalledWith("https://arxiv.org/abs/2609.28538");
    // Not green: the paper is not in the library
    const pdf = row.querySelector<HTMLButtonElement>(
      ".zinspire-ref-entry__pdf",
    )!;
    expect(pdf.dataset.state).toBe("online");
    expect(pdf.disabled).toBe(false);
    pdf.click();
    expect(launch).toHaveBeenLastCalledWith("https://arxiv.org/pdf/2609.28538");
    key(root.querySelector(".arxiv-browser__list")!, "Enter");
    expect(launch).toHaveBeenLastCalledWith("https://arxiv.org/abs/2609.28538");
  });

  it("opens arXiv's HTML version, offering it unless the listing says there is none", async () => {
    const { root, launch } = await loaded();
    // Oldest first: the replacements without and with an HTML link are on
    // the first page
    const sort = select(root, "sort");
    sort.value = "id-asc";
    sort.dispatchEvent(new win.Event("change"));
    const rowOf = (id: string) =>
      rows(root).find((row) => row.dataset.entryId!.includes(id))!;
    const htmlButton = (row: HTMLElement) =>
      row.querySelector<HTMLButtonElement>(".arxiv-browser__html-button");
    const detailHtml = () =>
      [
        ...root.querySelectorAll<HTMLButtonElement>(
          ".arxiv-browser__detail-actions button",
        ),
      ].find((b) => b.textContent === msg("arxiv-browser-open-html-button"));

    const withHtml = rowOf("2502.20357");
    const button = htmlButton(withHtml)!;
    // Right after the PDF button, with its ▾ menu, and its tooltip
    const split = button.parentElement!;
    expect(split.classList).toContain("arxiv-browser__html");
    expect(split.previousElementSibling?.classList).toContain(
      "zinspire-ref-entry__pdf",
    );
    expect(button.nextElementSibling?.classList).toContain(
      "arxiv-browser__html-more",
    );
    expect(button.title).toBe(msg("arxiv-browser-open-html"));
    button.click();
    expect(launch).toHaveBeenLastCalledWith(
      "https://arxiv.org/html/2502.20357",
    );
    // A click on the row's HTML button also chose the paper
    const detailButton = detailHtml()!;
    expect(detailButton.title).toBe(msg("arxiv-browser-open-html"));
    detailButton.click();
    expect(launch).toHaveBeenLastCalledWith(
      "https://arxiv.org/html/2502.20357",
    );

    // arXiv lists no HTML version of this one
    const withoutHtml = rowOf("2506.21871");
    expect(htmlButton(withoutHtml)).toBeNull();
    expect(
      withoutHtml.querySelector(".zinspire-ref-entry__pdf"),
    ).not.toBeNull();
    withoutHtml.click();
    expect(root.querySelector(".arxiv-browser__detail")!.textContent).toContain(
      "2506.21871",
    );
    expect(detailHtml()).toBeUndefined();
  });

  describe("the detail pane's version chooser", () => {
    const ID = "2508.00226";
    /** Version 2 as the arXiv API gives it */
    const v2 = {
      id: ID,
      version: 2,
      title: "An older title with $x^2$",
      abstract: "The abstract\n  of version 2.",
      authors: ["Ada Older", "Bob Author"],
      published: "2025-07-31T10:00:00Z",
      updated: "2025-08-20T09:30:00Z",
      comments: "12 pages",
      journalRef: "Phys. Rev. D 112 (2025) 014001",
      primaryCategory: "hep-ph",
      categories: ["hep-ph", "hep-ex"],
    };
    async function shown(apiVersion: ReturnType<typeof vi.fn>) {
      const env = await loaded({ apiVersion });
      const sort = select(env.root, "sort");
      sort.value = "id-asc";
      sort.dispatchEvent(new win.Event("change"));
      rows(env.root)
        .find((row) => row.dataset.entryId!.includes(ID))!
        .click();
      const detail = env.root.querySelector<HTMLElement>(
        ".arxiv-browser__detail",
      )!;
      const chooser = () =>
        detail.querySelector<HTMLSelectElement>(".arxiv-browser__version")!;
      const choose = async (version: number) => {
        chooser().value = String(version);
        chooser().dispatchEvent(new win.Event("change"));
        await flushPromises();
      };
      const buttonNamed = (label: string) =>
        [
          ...detail.querySelectorAll<HTMLButtonElement>(
            ".arxiv-browser__detail-actions button",
          ),
        ].find((b) => b.textContent === label)!;
      const notices = () =>
        [...env.root.querySelectorAll(".arxiv-browser__notice")].map(
          (notice) => notice.textContent,
        );
      return { ...env, detail, chooser, choose, buttonNamed, notices };
    }

    it("lists versions 1 to N, shows the newest from the listing, and asks nothing until an older one is chosen", async () => {
      const apiVersion = vi.fn(async () => ({ ok: true, entry: v2 }));
      const { detail, chooser, choose, buttonNamed, launch } =
        await shown(apiVersion);
      expect([...chooser().options].map((o) => o.textContent)).toEqual([
        msg("arxiv-browser-detail-version", { version: 1 }),
        msg("arxiv-browser-detail-version", { version: 2 }),
        msg("arxiv-browser-detail-version", { version: 3 }),
      ]);
      expect(chooser().value).toBe("3");
      const newest = detail.textContent;
      expect(newest).toContain(
        msg("arxiv-browser-detail-announced", {
          date: formatDay("2026-09-25"),
        }),
      );
      buttonNamed(msg("arxiv-browser-open-pdf-button")).click();
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/pdf/${ID}`);
      expect(apiVersion).not.toHaveBeenCalled();

      // Version 2: its title, authors, abstract, comments, categories and
      // submission; PDF and HTML of that version
      await choose(2);
      expect(apiVersion).toHaveBeenCalledTimes(1);
      expect(apiVersion.mock.calls[0].slice(0, 2)).toEqual([ID, 2]);
      expect(chooser().value).toBe("2");
      expect(chooser().disabled).toBe(false);
      const text = detail.textContent!;
      expect(
        detail.querySelector(".arxiv-browser__detail-title")!.textContent,
      ).toContain("An older title");
      expect(
        detail.querySelector(".arxiv-browser__detail-authors")!.textContent,
      ).toBe("Ada Older, Bob Author");
      expect(
        detail.querySelector(".arxiv-browser__detail-abstract")!.textContent,
      ).toBe("The abstract of version 2.");
      expect(text).toContain("12 pages");
      expect(text).toContain("Phys. Rev. D 112 (2025) 014001");
      expect(text).toContain("hep-ex");
      expect(text).toContain(
        msg("arxiv-browser-detail-submitted", {
          date: formatDay("2025-08-20"),
        }),
      );
      expect(text).not.toContain(
        msg("arxiv-browser-detail-announced", {
          date: formatDay("2026-09-25"),
        }),
      );
      buttonNamed(msg("arxiv-browser-open-pdf-button")).click();
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/pdf/${ID}v2`);
      buttonNamed(msg("arxiv-browser-open-html-button")).click();
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/html/${ID}v2`);

      // Back to the newest: the listing's again; version 2 once more asks
      // nothing
      await choose(3);
      expect(detail.textContent).toBe(newest);
      buttonNamed(msg("arxiv-browser-open-pdf-button")).click();
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/pdf/${ID}`);
      await choose(2);
      expect(apiVersion).toHaveBeenCalledTimes(1);
      expect(detail.textContent).toContain("12 pages");
      // Another paper shows its newest version
      rows(view!.listPane.list as HTMLElement)[0].click();
      expect(detail.textContent).not.toContain("12 pages");
    });

    it("stays at the version shown when the chosen one cannot be had, saying why", async () => {
      let answer!: (value: unknown) => void;
      const apiVersion = vi.fn(
        () => new Promise((resolve) => (answer = resolve)),
      );
      const { detail, chooser, choose, notices, buttonNamed, launch } =
        await shown(apiVersion);
      const newest = detail.textContent;
      await choose(1);
      // While arXiv is asked: the choice shown, not changeable, the pane as
      // it was
      expect(chooser().value).toBe("1");
      expect(chooser().disabled).toBe(true);
      // The newest version's text greyed, its date replaced by a note
      expect(
        detail.querySelector(".arxiv-browser__detail-title")!.classList,
      ).toContain("arxiv-browser__detail-stale");
      expect(
        detail.querySelector(".arxiv-browser__detail-abstract")!.classList,
      ).toContain("arxiv-browser__detail-stale");
      expect(detail.textContent).toContain(
        msg("arxiv-browser-detail-version-loading"),
      );
      expect(detail.textContent).not.toContain(
        msg("arxiv-browser-detail-announced", {
          date: formatDay("2026-09-25"),
        }),
      );
      // The buttons already refer to the version chosen
      buttonNamed(msg("arxiv-browser-open-pdf-button")).click();
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/pdf/${ID}v1`);
      answer({ ok: false, reason: "network", message: "down" });
      await flushPromises();
      expect(chooser().value).toBe("3");
      expect(chooser().disabled).toBe(false);
      expect(detail.textContent).toBe(newest);
      expect(detail.querySelector(".arxiv-browser__detail-stale")).toBeNull();
      expect(notices().join()).toContain(
        msg("arxiv-browser-version-failed", {
          id: ID,
          version: 1,
          reason: msg("arxiv-browser-reason-network"),
        }),
      );
      // Asked again the next time
      await choose(1);
      answer({ ok: false, reason: "network", message: "down" });
      await flushPromises();
      expect(apiVersion).toHaveBeenCalledTimes(2);
    });

    it("shows a paper of one version without a chooser", async () => {
      const { root } = await loaded();
      rows(root)[0].click();
      const detail = root.querySelector(".arxiv-browser__detail")!;
      expect(detail.querySelector(".arxiv-browser__version")).toBeNull();
      expect(detail.textContent).toContain(
        msg("arxiv-browser-detail-version", { version: 1 }),
      );
    });
  });

  it("offers the HTML version of papers in a listing cached before it was recorded", async () => {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    env.open();
    await env.settle();
    view!.dispose();
    const cached = (await env.store.getDay("hep-ph", "2026-09-25"))!;
    expect(cached.entries.find((e) => e.id === "2506.21871")?.html).toBe(false);
    for (const entry of cached.entries) delete entry.html;
    // A day later arXiv cannot be reached; the copy from the cache is shown
    env.site.page(LIST_URL("hep-ph"), { status: 0 });
    await env.clock.advanceBy(24 * 3600 * 1000);
    env.open();
    await env.settle();
    const sort = select(env.root, "sort");
    sort.value = "id-asc";
    sort.dispatchEvent(new win.Event("change"));
    const row = rows(env.root).find((r) =>
      r.dataset.entryId!.includes("2506.21871"),
    )!;
    row
      .querySelector<HTMLButtonElement>(".arxiv-browser__html-button")!
      .click();
    expect(env.launch).toHaveBeenLastCalledWith(
      "https://arxiv.org/html/2506.21871",
    );
  });

  it("has no TeX key buttons in its rows (a relate button and a tick box, yes)", async () => {
    const { root } = await loaded();
    expect(rows(root).length).toBeGreaterThan(0);
    for (const row of rows(root)) {
      expect(row.querySelector(".zinspire-ref-entry__link") === null).toBe(
        false,
      );
      expect(row.querySelector(".zinspire-ref-entry__checkbox") === null).toBe(
        false,
      );
      expect(row.querySelector(".zinspire-ref-entry__texkey") === null).toBe(
        true,
      );
      expect(row.querySelector(".zinspire-ref-entry__bibtex")).not.toBeNull();
    }
  });

  it("copies arXiv's BibTeX when INSPIRE has no record, asking each once and arxiv.org in turn", async () => {
    const { root, site, clock, copy, inspireBibtex } = await loaded();
    const bibtex =
      "@misc{pathak2026,\n  title={A paper},\n  eprint={2609.28538}\n}";
    site.html("https://arxiv.org/bibtex/2609.28538", `\n${bibtex}\n`);
    const row = rows(root)[0];
    row
      .querySelector<HTMLButtonElement>(".zinspire-ref-entry__bibtex")!
      .click();
    await clock.advanceBy(20000);
    expect(copy).toHaveBeenLastCalledWith(keyed(bibtex));
    expect(site.count("https://arxiv.org/bibtex/2609.28538")).toBe(1);
    // Again with the keys: from memory
    key(root.querySelector(".arxiv-browser__list")!, "C", {
      ctrlKey: true,
      shiftKey: true,
    });
    await flushPromises();
    expect(copy).toHaveBeenCalledTimes(2);
    expect(site.count("https://arxiv.org/bibtex/2609.28538")).toBe(1);
    expect(
      [...root.querySelectorAll(".arxiv-browser__notice")].map(
        (n) => n.textContent,
      ),
    ).toContain(msg("arxiv-browser-bibtex-copied-arxiv", { id: "2609.28538" }));
    expect(inspireBibtex).toHaveBeenCalledTimes(1);
  });

  const notices = (root: HTMLElement) =>
    [...root.querySelectorAll(".arxiv-browser__notice")].map(
      (n) => n.textContent,
    );

  it("copies INSPIRE's BibTeX when INSPIRE has the paper, asking arXiv nothing", async () => {
    const { root, site, clock, copy, inspireBibtex } = await loaded();
    const bibtex = '@article{Vattolo:2026omw,\n    eprint = "2609.28538"\n}';
    inspireBibtex.mockResolvedValue({ status: "found", bibtex });
    const button = rows(root)[0].querySelector<HTMLButtonElement>(
      ".zinspire-ref-entry__bibtex",
    )!;
    button.click();
    await clock.advanceBy(1000);
    expect(copy).toHaveBeenLastCalledWith(bibtex);
    expect(inspireBibtex.mock.calls[0].slice(0, 2)).toEqual([
      "2609.28538",
      null,
    ]);
    expect(site.count("https://arxiv.org/bibtex/2609.28538")).toBe(0);
    expect(notices(root)).toContain(
      msg("arxiv-browser-bibtex-copied-inspire", { id: "2609.28538" }),
    );
    // Again: from memory
    button.click();
    await flushPromises();
    expect(copy).toHaveBeenCalledTimes(2);
    expect(inspireBibtex).toHaveBeenCalledTimes(1);
  });

  it("copies arXiv's BibTeX when INSPIRE cannot be reached, saying so, and asks INSPIRE again the next time", async () => {
    const { root, site, clock, copy, inspireBibtex } = await loaded();
    inspireBibtex.mockResolvedValue({ status: "failed" });
    const arxiv = "@misc{x,\n  eprint={2609.28538}\n}";
    site.html("https://arxiv.org/bibtex/2609.28538", arxiv);
    const button = rows(root)[0].querySelector<HTMLButtonElement>(
      ".zinspire-ref-entry__bibtex",
    )!;
    button.click();
    await clock.advanceBy(20000);
    expect(copy).toHaveBeenLastCalledWith(keyed(arxiv));
    expect(notices(root)).toContain(
      msg("arxiv-browser-bibtex-copied-arxiv-unreachable", {
        id: "2609.28538",
      }),
    );
    expect(notices(root)).not.toContain(
      msg("arxiv-browser-bibtex-copied-arxiv", { id: "2609.28538" }),
    );
    // INSPIRE answers now: its BibTeX; arXiv's is not asked again
    inspireBibtex.mockResolvedValue({
      status: "found",
      bibtex: "@article{A,\n}",
    });
    button.click();
    await clock.advanceBy(1000);
    expect(copy).toHaveBeenLastCalledWith("@article{A,\n}");
    expect(inspireBibtex).toHaveBeenCalledTimes(2);
    expect(site.count("https://arxiv.org/bibtex/2609.28538")).toBe(1);
  });

  /** The library's answer: item 77 has the first paper */
  const answerFor = (ids: readonly string[]) =>
    new Map(ids.filter((id) => id === "2609.28538").map((id) => [id, [77]]));

  /**
   * The first paper in the library: item 77 with a recid and its own key.
   * `lookup`: the library's lookup (default: answers at once).
   */
  async function inLibrary(
    lookup = async (ids: readonly string[]) => answerFor(ids),
  ) {
    const item = {
      getField: (name: string) =>
        (
          ({
            archive: "INSPIRE",
            archiveLocation: "3071234",
            citationKey: "Vattolo:2026mine",
          }) as Record<string, string>
        )[name] ?? "",
      getAttachments: () => [],
      relatedItems: [],
    };
    vi.stubGlobal("Zotero", {
      ...Zotero,
      Items: {
        get: (id: number) => (id === 77 ? item : false),
        getLibraryAndKeyFromID: () => false,
      },
    });
    const env = await loaded({ inLibrary: lookup });
    await flushPromises();
    const click = async () => {
      rows(env.root)[0]
        .querySelector<HTMLButtonElement>(".zinspire-ref-entry__bibtex")!
        .click();
      await env.clock.advanceBy(20000);
    };
    return { ...env, click };
  }

  it("asks INSPIRE by the recid of the paper's library item, and gives the BibTeX the item's key", async () => {
    const { copy, inspireBibtex, click } = await inLibrary();
    inspireBibtex.mockResolvedValue({
      status: "found",
      bibtex: '@article{Vattolo:2026omw,\n    eprint = "2609.28538"\n}',
    });
    await click();
    expect(inspireBibtex.mock.calls[0].slice(0, 2)).toEqual([
      "2609.28538",
      "3071234",
    ]);
    expect(copy).toHaveBeenLastCalledWith(
      '@article{Vattolo:2026mine,\n    eprint = "2609.28538"\n}',
    );
  });

  it("uses the library item also when copied before the list's marks arrived", async () => {
    const waiting: Array<() => void> = [];
    const { root, clock, copy, inspireBibtex } = await inLibrary(
      (ids) =>
        new Promise((resolve) => waiting.push(() => resolve(answerFor(ids)))),
    );
    inspireBibtex.mockResolvedValue({
      status: "found",
      bibtex: '@article{Vattolo:2026omw,\n    eprint = "2609.28538"\n}',
    });
    const row = rows(root)[0];
    expect(
      row.querySelector(".zinspire-ref-entry__dot")?.getAttribute("data-state"),
    ).not.toBe("local");
    row
      .querySelector<HTMLButtonElement>(".zinspire-ref-entry__bibtex")!
      .click();
    await flushPromises();
    expect(copy).not.toHaveBeenCalled();
    // The library answers
    for (const answer of waiting.splice(0)) answer();
    await clock.advanceBy(1000);
    expect(inspireBibtex.mock.calls[0].slice(0, 2)).toEqual([
      "2609.28538",
      "3071234",
    ]);
    expect(copy).toHaveBeenLastCalledWith(
      '@article{Vattolo:2026mine,\n    eprint = "2609.28538"\n}',
    );
  });

  it("copies nothing when the window closed while the library was asked", async () => {
    const waiting: Array<() => void> = [];
    const { root, clock, copy, view, inspireBibtex } = await inLibrary(
      (ids) =>
        new Promise((resolve) => waiting.push(() => resolve(answerFor(ids)))),
    );
    inspireBibtex.mockResolvedValue({
      status: "found",
      bibtex: '@article{Vattolo:2026omw,\n    eprint = "2609.28538"\n}',
    });
    rows(root)[0]
      .querySelector<HTMLButtonElement>(".zinspire-ref-entry__bibtex")!
      .click();
    view.dispose();
    for (const answer of waiting.splice(0)) answer();
    await clock.advanceBy(1000);
    expect(copy).not.toHaveBeenCalled();
  });

  it("gives arXiv's BibTeX the key of the paper's library item", async () => {
    const { site, copy, click } = await inLibrary();
    site.html(
      "https://arxiv.org/bibtex/2609.28538",
      "@misc{vattolo2026spectral,\n  eprint={2609.28538}\n}",
    );
    await click();
    expect(copy).toHaveBeenLastCalledWith(
      "@misc{Vattolo:2026mine,\n  eprint={2609.28538}\n}",
    );
  });

  it("fetches a BibTeX in turn with the listing's requests, 15 s apart", async () => {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "recent";
    const url = "https://arxiv.org/bibtex/2609.28538";
    env.site.html(url, "@misc{x,\n}");
    const view = env.open();
    // The index at 0 s and /new at 15 s (each answered in 0.8 s): the newest
    // day is listed while the older days wait for their turn
    await env.clock.advanceBy(17000);
    expect(view.loader.running).toBe(true);
    rows(env.root)[0]
      .querySelector<HTMLButtonElement>(".zinspire-ref-entry__bibtex")!
      .click();
    await env.settle();
    const starts = env.site.sent.map((request) => request.start);
    const at = env.site.sent.findIndex((request) => request.url === url);
    expect(at).toBeGreaterThan(1);
    expect(at).toBeLessThan(env.site.sent.length - 1);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(15000);
    }
    expect(env.copy).toHaveBeenCalledWith(keyed("@misc{x,\n}"));
  });

  it("asks arxiv.org once for a BibTeX clicked again while it waits", async () => {
    const { root, site, clock, copy } = await loaded();
    site.html("https://arxiv.org/bibtex/2609.28538", "@misc{x,\n}");
    const bibtex = rows(root)[0].querySelector<HTMLButtonElement>(
      ".zinspire-ref-entry__bibtex",
    )!;
    bibtex.click();
    bibtex.click();
    await clock.advanceBy(40000);
    expect(site.count("https://arxiv.org/bibtex/2609.28538")).toBe(1);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("gives author names no hint of a click that does nothing here", async () => {
    const { root } = await loaded();
    const names = [
      ...rows(root)[0].querySelectorAll<HTMLElement>(
        ".zinspire-ref-entry__author-link",
      ),
    ];
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => !name.hasAttribute("title"))).toBe(true);
  });

  it("tells when the BibTeX could not be had", async () => {
    const { root, site, clock, copy } = await loaded();
    site.page("https://arxiv.org/bibtex/2609.28538", {
      status: 404,
      text: "Not found",
    });
    rows(root)[0]
      .querySelector<HTMLButtonElement>(".zinspire-ref-entry__bibtex")!
      .click();
    await clock.advanceBy(20000);
    expect(copy).not.toHaveBeenCalled();
    expect(
      [...root.querySelectorAll(".arxiv-browser__notice")].map(
        (n) => n.textContent,
      ),
    ).toContain(
      msg("arxiv-browser-bibtex-failed", {
        id: "2609.28538",
        reason: msg("arxiv-browser-reason-http"),
      }),
    );
  });

  it("marks papers in the library and shows them there", async () => {
    const showInLibrary = vi.fn();
    const { root } = await loaded({
      inLibrary: async (ids: readonly string[]) =>
        new Map(
          ids.filter((id) => id === "2609.28544").map((id) => [id, [77]]),
        ),
      showInLibrary,
    });
    await flushPromises();
    const marked = rows(root).filter(
      (row) =>
        row
          .querySelector(".zinspire-ref-entry__dot")
          ?.getAttribute("data-state") === "local",
    );
    expect(marked.map((row) => row.dataset.entryId)).toEqual([
      "arxiv-2609.28544-2026-09-25",
    ]);
    marked[0].querySelector<HTMLElement>(".zinspire-ref-entry__dot")!.click();
    expect(showInLibrary).toHaveBeenCalledWith(77);
  });

  it("closes the window with Ctrl/Cmd+W and stops everything when disposed", async () => {
    const { root, view, site, clock } = await loaded();
    const close = vi.spyOn(win, "close").mockImplementation(() => undefined);
    key(root, "w", { metaKey: true });
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
    view.dispose();
    const sent = site.sent.length;
    key(root.querySelector(".arxiv-browser__list")!, "n");
    expect(view.listPane.currentPage).toBe(0);
    await clock.advanceBy(60000);
    expect(site.sent.length).toBe(sent);
  });
});

describe("arXiv browser: the right-click menu and copying", () => {
  async function loaded(options: Record<string, unknown> = {}) {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    const view = env.open(options);
    await env.settle();
    clipboard.copyToClipboard.mockClear();
    return { ...env, view };
  }

  /** Open the menu on an element: its entries ("-" for a separator) */
  function menuAt(target: Element) {
    const doc = win.document as any;
    doc.createXULElement = (tag: string) => {
      const element = doc.createElement(tag);
      element.openPopupAtScreen = vi.fn();
      return element;
    };
    const event = new win.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const popup = win.document.getElementById(
      "zinspire-abstract-context-popup",
    )!;
    const entries = [...popup.children] as HTMLElement[];
    return {
      labels: entries.map((entry) =>
        entry.tagName.toLowerCase() === "menuseparator"
          ? "-"
          : entry.getAttribute("label"),
      ),
      run(label: string) {
        entries
          .find((entry) => entry.getAttribute("label") === label)!
          .dispatchEvent(new win.Event("command"));
      },
    };
  }

  it("offers Select All, the link's entries and the paper's on a row's title", async () => {
    const { root, launch, copy, site, clock } = await loaded();
    const title = rows(root)[0].querySelector<HTMLAnchorElement>(
      ".zinspire-ref-entry__title-link",
    )!;
    const menu = menuAt(title);
    expect(menu.labels).toEqual([
      msg("arxiv-browser-menu-select-all"),
      "-",
      msg("arxiv-browser-menu-open-link"),
      msg("arxiv-browser-menu-copy-link"),
      "-",
      msg("arxiv-browser-menu-copy-title"),
      msg("arxiv-browser-copy-id"),
      msg("arxiv-browser-menu-copy-abs-link"),
      msg("menuitem-copy-inspire-link"),
      msg("arxiv-browser-copy-bibtex"),
    ]);
    const abs = "https://arxiv.org/abs/2609.28538";
    menu.run(msg("arxiv-browser-menu-open-link"));
    expect(launch).toHaveBeenLastCalledWith(abs);
    menu.run(msg("arxiv-browser-menu-copy-link"));
    await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith(abs));
    menu.run(msg("arxiv-browser-menu-copy-title"));
    await vi.waitFor(() =>
      expect(copy).toHaveBeenLastCalledWith(title.textContent),
    );
    menu.run(msg("arxiv-browser-copy-id"));
    await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("2609.28538"));
    menu.run(msg("arxiv-browser-menu-copy-abs-link"));
    await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith(abs));
    const bibtex = "@misc{x2026,\n  eprint={2609.28538}\n}";
    site.html("https://arxiv.org/bibtex/2609.28538", `\n${bibtex}\n`);
    menu.run(msg("arxiv-browser-copy-bibtex"));
    await clock.advanceBy(20000);
    expect(copy).toHaveBeenLastCalledWith(keyed(bibtex));

    menu.run(msg("arxiv-browser-menu-select-all"));
    const selection = win.getSelection()!;
    expect(selection.toString()).toContain(title.textContent);
    expect(
      root
        .querySelector(".arxiv-browser__list")!
        .contains(selection.anchorNode),
    ).toBe(true);
  });

  it("copies the title shown in the detail pane, an older version's when one is shown", async () => {
    const apiVersion = vi.fn(async () => ({
      ok: true,
      entry: {
        id: "2508.00226",
        version: 1,
        title: "The first title",
        abstract: "A",
        authors: ["A. Author"],
        published: "2025-07-31T10:00:00Z",
        updated: "2025-07-31T10:00:00Z",
        primaryCategory: "hep-ph",
        categories: ["hep-ph"],
      },
    }));
    const { root, copy } = await loaded({ apiVersion });
    const sort = select(root, "sort");
    sort.value = "id-asc";
    sort.dispatchEvent(new win.Event("change"));
    const row = rows(root).find((r) =>
      r.dataset.entryId!.includes("2508.00226"),
    )!;
    row.click();
    const title = () =>
      root.querySelector<HTMLElement>(".arxiv-browser__detail-title")!;
    const newest = title().textContent;
    menuAt(title()).run(msg("arxiv-browser-menu-copy-title"));
    await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith(newest));
    const chooser = root.querySelector<HTMLSelectElement>(
      ".arxiv-browser__version",
    )!;
    chooser.value = "1";
    chooser.dispatchEvent(new win.Event("change"));
    await flushPromises();
    menuAt(title()).run(msg("arxiv-browser-menu-copy-title"));
    await vi.waitFor(() =>
      expect(copy).toHaveBeenLastCalledWith("The first title"),
    );
    // The row's menu: the listing's title
    menuAt(row.querySelector(".zinspire-ref-entry__title-link")!).run(
      msg("arxiv-browser-menu-copy-title"),
    );
    await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith(newest));
  });

  it("copies the paper's arXiv ID from the detail pane", async () => {
    const { root, copy } = await loaded();
    rows(root)[0].click();
    const detail = root.querySelector<HTMLElement>(
      ".arxiv-browser__detail-title",
    )!;
    menuAt(detail).run(msg("arxiv-browser-copy-id"));
    await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("2609.28538"));
  });

  it("copies a selection, and in the detail pane's abstract all of it or, in KaTeX mode, its TeX", async () => {
    const { root, view } = await loaded();
    const title = rows(root)[0].querySelector<HTMLAnchorElement>(
      ".zinspire-ref-entry__title-link",
    )!;
    win.getSelection()!.selectAllChildren(title);
    const withSelection = menuAt(title);
    expect(withSelection.labels[0]).toBe(
      msg("references-panel-abstract-copy-selection"),
    );
    withSelection.run(msg("references-panel-abstract-copy-selection"));
    await vi.waitFor(() =>
      expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith(
        title.textContent,
      ),
    );

    win.getSelection()!.removeAllRanges();
    // The first paper whose abstract has a formula, shown in the detail pane
    rows(root)
      .find((row) =>
        row
          .querySelector<HTMLElement>(".zinspire-ref-entry__abstract")
          ?.dataset.latexSource?.includes("$"),
      )!
      .click();
    const abstract = root.querySelector<HTMLElement>(
      ".arxiv-browser__detail-abstract",
    )!;
    expect(abstract.dataset.latexSource).toContain("$");
    prefs[`${PREFIX}.latex_render_mode`] = "katex";
    const menu = menuAt(abstract);
    expect(menu.labels.slice(0, 3)).toEqual([
      msg("references-panel-abstract-copy"),
      msg("references-panel-abstract-copy-latex"),
      msg("arxiv-browser-menu-select-all"),
    ]);
    menu.run(msg("references-panel-abstract-copy-latex"));
    await vi.waitFor(() =>
      expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith(
        view.listPane.focused!.listing.abstract,
      ),
    );
    // Copy of the whole abstract takes each rendered formula once
    const formula = win.document.createElement("span");
    formula.innerHTML =
      "<span class='katex'><span class='katex-mathml'>m_\\pi</span><span class='katex-html'>mπ</span></span>";
    abstract.replaceChildren("Mass ", formula, " here.");
    menuAt(abstract).run(msg("references-panel-abstract-copy"));
    await vi.waitFor(() =>
      expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith(
        "Mass mπ here.",
      ),
    );
  });

  it("copies the selection with Ctrl/Cmd+C, each formula once, and selects a pane with Ctrl/Cmd+A", async () => {
    const { root, copy } = await loaded();
    const list = root.querySelector<HTMLElement>(".arxiv-browser__list")!;
    const detail = root.querySelector<HTMLElement>(".arxiv-browser__detail")!;
    const title = rows(root)[0].querySelector<HTMLAnchorElement>(
      ".zinspire-ref-entry__title-link",
    )!;
    win.getSelection()!.selectAllChildren(title);
    key(list, "c", { metaKey: true });
    await vi.waitFor(() =>
      expect(copy).toHaveBeenLastCalledWith(title.textContent),
    );
    // A rendered formula: KaTeX keeps a hidden copy of it
    const formula = win.document.createElement("span");
    formula.innerHTML =
      "<span class='katex'><span class='katex-mathml'>m_\\pi</span><span class='katex-html'>mπ</span></span>";
    detail.append(formula);
    win.getSelection()!.selectAllChildren(formula);
    key(detail, "c", { ctrlKey: true });
    await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("mπ"));

    list.focus();
    key(list, "a", { metaKey: true });
    expect(list.contains(win.getSelection()!.anchorNode)).toBe(true);
    expect(win.getSelection()!.toString()).toContain(title.textContent);
    detail.focus();
    key(detail, "a", { ctrlKey: true });
    expect(detail.contains(win.getSelection()!.anchorNode)).toBe(true);
    // In the filter box, Ctrl/Cmd+A is the box's own
    const filter = root.querySelector<HTMLInputElement>(
      ".arxiv-browser__filter input",
    )!;
    const selectAll = new win.KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    filter.dispatchEvent(selectAll);
    expect(selectAll.defaultPrevented).toBe(false);
  });
});

describe("arXiv browser: Copy INSPIRE link", () => {
  const ID = "2609.28538";
  const LINK = "https://inspirehep.net/literature/";

  /**
   * The window with the first paper of 25 Sep (2609.28538); `recid`: that
   * paper is library item 77 with this INSPIRE recid
   */
  async function loaded(recid?: string) {
    if (recid) {
      const item = {
        getField: (name: string) =>
          (
            ({ archive: "INSPIRE", archiveLocation: recid }) as Record<
              string,
              string
            >
          )[name] ?? "",
        getAttachments: () => [],
        relatedItems: [],
      };
      vi.stubGlobal("Zotero", {
        ...Zotero,
        Items: {
          get: (id: number) => (id === 77 ? item : false),
          getLibraryAndKeyFromID: () => false,
        },
      });
    }
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    const view = env.open({
      inLibrary: async (ids: readonly string[]) =>
        new Map(
          recid ? ids.filter((id) => id === ID).map((id) => [id, [77]]) : [],
        ),
    });
    await env.settle();
    /** Run a menu entry of the first row's title, or of `at` */
    const menuRun = (label: string, at?: Element) => {
      const doc = win.document as any;
      doc.createXULElement = (tag: string) => {
        const element = doc.createElement(tag);
        element.openPopupAtScreen = vi.fn();
        return element;
      };
      (
        at ??
        rows(env.root)[0].querySelector(".zinspire-ref-entry__title-link")!
      ).dispatchEvent(
        new win.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        }),
      );
      [
        ...win.document.getElementById("zinspire-abstract-context-popup")!
          .children,
      ]
        .find((entry) => entry.getAttribute("label") === label)!
        .dispatchEvent(new win.Event("command"));
    };
    const copyLink = async (at?: Element) => {
      menuRun(msg("menuitem-copy-inspire-link"), at);
      await env.clock.advanceBy(1000);
    };
    const copyBibtex = async () => {
      menuRun(msg("arxiv-browser-copy-bibtex"));
      await env.clock.advanceBy(20000);
    };
    const notices = () =>
      [...env.root.querySelectorAll(".arxiv-browser__notice")].map(
        (n) => n.textContent,
      );
    return { ...env, view, copyLink, copyBibtex, notices };
  }

  it("copies the link of the library item's recid at once, asking INSPIRE nothing", async () => {
    const { copy, inspireRecord, inspireBibtex, copyLink, notices } =
      await loaded("3071234");
    await copyLink();
    expect(copy).toHaveBeenLastCalledWith(`${LINK}3071234`);
    expect(notices()).toContain(msg("copy-success-inspire-link"));
    expect(inspireRecord).not.toHaveBeenCalled();
    expect(inspireBibtex).not.toHaveBeenCalled();
  });

  it("asks INSPIRE once by the arXiv ID, then copies from memory; Copy BibTeX asks by that recid", async () => {
    const { copy, inspireRecord, inspireBibtex, copyLink, copyBibtex } =
      await loaded();
    inspireRecord.mockResolvedValue({
      status: "found",
      recid: "3071234",
      authors: [],
    });
    await copyLink();
    expect(inspireRecord.mock.calls[0][0]).toBe(ID);
    expect(copy).toHaveBeenLastCalledWith(`${LINK}3071234`);
    await copyLink();
    expect(copy).toHaveBeenCalledTimes(2);
    expect(inspireRecord).toHaveBeenCalledTimes(1);

    const bibtex = `@article{Vattolo:2026omw,\n    eprint = "${ID}"\n}`;
    inspireBibtex.mockResolvedValue({ status: "found", bibtex });
    await copyBibtex();
    expect(inspireBibtex.mock.calls[0].slice(0, 2)).toEqual([ID, "3071234"]);
    expect(copy).toHaveBeenLastCalledWith(bibtex);
    // Both known: neither copy asks again
    await copyLink();
    await copyBibtex();
    expect(inspireRecord).toHaveBeenCalledTimes(1);
    expect(inspireBibtex).toHaveBeenCalledTimes(1);
  });

  it("copies the link from the detail pane too", async () => {
    const { root, copy, inspireRecord, copyLink } = await loaded();
    inspireRecord.mockResolvedValue({
      status: "found",
      recid: "3071234",
      authors: [],
    });
    rows(root)[0].click();
    const detail = root.querySelector(".arxiv-browser__detail")!;
    expect(detail.textContent).toContain(ID);
    await copyLink(detail);
    expect(inspireRecord.mock.calls[0][0]).toBe(ID);
    expect(copy).toHaveBeenLastCalledWith(`${LINK}3071234`);
  });

  it("keeps INSPIRE's BibTeX when the link's lookup adds the recid", async () => {
    const { copy, inspireRecord, inspireBibtex, copyLink, copyBibtex } =
      await loaded();
    const bibtex = `@article{Vattolo:2026omw,\n    eprint = "${ID}"\n}`;
    inspireBibtex.mockResolvedValue({ status: "found", bibtex });
    await copyBibtex();
    inspireRecord.mockResolvedValue({
      status: "found",
      recid: "3071234",
      authors: [],
    });
    await copyLink();
    expect(copy).toHaveBeenLastCalledWith(`${LINK}3071234`);
    await copyBibtex();
    expect(copy).toHaveBeenLastCalledWith(bibtex);
    expect(inspireBibtex).toHaveBeenCalledTimes(1);
    expect(inspireRecord).toHaveBeenCalledTimes(1);
  });

  it("copies nothing when INSPIRE has no record, saying so, and does not ask again", async () => {
    const { copy, inspireRecord, copyLink, notices } = await loaded();
    await copyLink();
    expect(copy).not.toHaveBeenCalled();
    expect(notices()).toContain(
      msg("arxiv-browser-inspire-link-not-found", { id: ID }),
    );
    await copyLink();
    expect(inspireRecord).toHaveBeenCalledTimes(1);
  });

  it("takes Copy BibTeX's answer that INSPIRE has no record", async () => {
    const { site, copy, inspireRecord, copyLink, copyBibtex, notices } =
      await loaded();
    site.html(
      `https://arxiv.org/bibtex/${ID}`,
      `@misc{x,\n  eprint={${ID}}\n}`,
    );
    await copyBibtex();
    copy.mockClear();
    await copyLink();
    expect(inspireRecord).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(notices()).toContain(
      msg("arxiv-browser-inspire-link-not-found", { id: ID }),
    );
  });

  it("says INSPIRE could not be reached, never that it has no record, and asks again the next time", async () => {
    const { copy, inspireRecord, copyLink, notices } = await loaded();
    inspireRecord.mockResolvedValue({ status: "failed" });
    await copyLink();
    expect(copy).not.toHaveBeenCalled();
    expect(notices()).toContain(
      msg("arxiv-browser-inspire-link-unreachable", { id: ID }),
    );
    expect(notices()).not.toContain(
      msg("arxiv-browser-inspire-link-not-found", { id: ID }),
    );
    inspireRecord.mockResolvedValue({
      status: "found",
      recid: "42",
      authors: [],
    });
    await copyLink();
    expect(inspireRecord).toHaveBeenCalledTimes(2);
    expect(copy).toHaveBeenLastCalledWith(`${LINK}42`);
  });
});

describe("arXiv browser: choosing the days", () => {
  function setupDays() {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    for (const date of ["2026-09-17", "2026-09-18"]) {
      env.site.html(
        CATCHUP_URL("hep-ph", date),
        catchupPageHtml(
          "hep-ph",
          date,
          smallDay("hep-ph", 3),
          date === "2026-09-17" ? "2026-09-18" : "2026-09-21",
        ),
      );
    }
    return env;
  }
  const dayButton = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>(".arxiv-browser__days-button")!;
  const picker = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".arxiv-browser__daypicker")!;
  const pickerButton = (root: HTMLElement, label: string) =>
    [...picker(root).querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === label,
    )!;
  const day = (root: HTMLElement, date: string) =>
    picker(root).querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!;
  const click = (target: Element, init: MouseEventInit = {}) =>
    target.dispatchEvent(
      new win.MouseEvent("click", { bubbles: true, ...init }),
    );
  const picked = (root: HTMLElement) =>
    [
      ...picker(root).querySelectorAll<HTMLElement>(
        ".arxiv-browser__daypicker-day--picked",
      ),
    ].map((element) => element.dataset.date);

  it("opens with the newest day, and shows it on the date button", async () => {
    const env = setupDays();
    const view = env.open();
    await env.settle();
    expect(view.days).toEqual({ kind: "newest" });
    expect(dayButton(env.root).textContent).toBe(
      `${msg("arxiv-browser-days-newest")} ▾`,
    );
    expect(view.loader.days.map((item) => item.date)).toEqual(["2026-09-25"]);
  });

  it("loads a preset at once", async () => {
    const env = setupDays();
    const view = env.open();
    await env.settle();
    dayButton(env.root).click();
    expect(picker(env.root).hidden).toBe(false);
    // Each preset tells what a first load of it costs (one category here)
    expect(pickerButton(env.root, msg("arxiv-browser-days-recent")).title).toBe(
      msg("arxiv-browser-days-estimate", {
        requests: 6,
        time: msg("arxiv-browser-duration-seconds", { count: 75 }),
      }),
    );
    expect(pickerButton(env.root, msg("arxiv-browser-days-week")).title).toBe(
      msg("arxiv-browser-days-estimate", {
        requests: 6,
        time: msg("arxiv-browser-duration-seconds", { count: 75 }),
      }),
    );
    pickerButton(env.root, msg("arxiv-browser-days-recent")).click();
    expect(picker(env.root).hidden).toBe(true);
    await env.settle();
    expect(view.days).toEqual({ kind: "recent" });
    expect(dayButton(env.root).textContent).toBe(
      `${msg("arxiv-browser-days-recent")} ▾`,
    );
    expect(view.loader.days.map((item) => item.date)).toEqual([
      "2026-09-25",
      ...[...DAYS].reverse(),
    ]);
  });

  it("picks days with click, Ctrl/Cmd+click and Shift+click, and loads them only on Load", async () => {
    const env = setupDays();
    const view = env.open();
    await env.settle();
    const sent = env.site.sent.length;
    dayButton(env.root).click();
    const summary = () =>
      picker(env.root).querySelector(".arxiv-browser__daypicker-summary")!
        .textContent;
    const load = pickerButton(env.root, msg("arxiv-browser-days-load"));
    expect(summary()).toBe(msg("arxiv-browser-days-none"));
    expect(load.disabled).toBe(true);

    click(day(env.root, "2026-09-17"));
    // Shift+click: the listing days between, across the weekend
    click(day(env.root, "2026-09-22"), { shiftKey: true });
    expect(picked(env.root)).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-21",
      "2026-09-22",
    ]);
    click(day(env.root, "2026-09-18"), { metaKey: true });
    click(day(env.root, "2026-09-21"), { ctrlKey: true });
    expect(picked(env.root)).toEqual(["2026-09-17", "2026-09-22"]);
    expect(summary()).toBe(
      msg("arxiv-browser-days-picked", {
        days: 2,
        requests: 3,
        time: msg("arxiv-browser-duration-seconds", { count: 30 }),
      }),
    );
    // Nothing is fetched while picking
    await env.clock.advanceBy(60000);
    expect(env.site.sent.length).toBe(sent);

    load.click();
    expect(picker(env.root).hidden).toBe(true);
    await env.settle();
    expect(view.loader.days.map((item) => item.date)).toEqual([
      "2026-09-22",
      "2026-09-17",
    ]);
    expect(dayButton(env.root).textContent).toBe(
      `${msg("arxiv-browser-days-range", {
        first: formatShortDay("2026-09-17"),
        last: formatShortDay("2026-09-22"),
        count: 2,
      })} ▾`,
    );
    // Opened again, the calendar shows the days picked
    dayButton(env.root).click();
    expect(picked(env.root)).toEqual(["2026-09-17", "2026-09-22"]);
    // One day: its date on the button
    click(day(env.root, "2026-09-18"));
    pickerButton(env.root, msg("arxiv-browser-days-load")).click();
    expect(dayButton(env.root).textContent).toBe(
      `${formatShortDay("2026-09-18")} ▾`,
    );
  });

  it("offers only the listing days arXiv serves, month by month", async () => {
    const env = setupDays();
    env.open();
    await env.settle();
    dayButton(env.root).click();
    const title = () =>
      picker(env.root).querySelector(".arxiv-browser__daypicker-title")!
        .textContent;
    const september = title();
    // No weekend, nothing after the newest scheduled listing
    expect(day(env.root, "2026-09-26")).toBeNull();
    expect(day(env.root, "2026-09-28")).toBeNull();
    expect(day(env.root, "2026-09-25")).not.toBeNull();
    const previous = pickerButton(env.root, "‹");
    const next = pickerButton(env.root, "›");
    expect(next.disabled).toBe(true);
    previous.click();
    expect(title()).not.toBe(september);
    expect(day(env.root, "2026-08-31")).not.toBeNull();
    previous.click();
    previous.click();
    // Late June: the earliest days arXiv still serves
    expect(previous.disabled).toBe(true);
    expect(day(env.root, "2026-06-26")).toBeNull();
    expect(day(env.root, "2026-06-29")).not.toBeNull();
  });

  it("closes on Escape and on a press outside, loading nothing", async () => {
    const env = setupDays();
    const view = env.open();
    await env.settle();
    dayButton(env.root).click();
    click(day(env.root, "2026-09-17"));
    key(day(env.root, "2026-09-17"), "Escape");
    expect(picker(env.root).hidden).toBe(true);
    // The list's keys work again
    key(env.root.querySelector(".arxiv-browser__list")!, "j");
    expect(view.listPane.focused).not.toBeNull();

    dayButton(env.root).click();
    // While it is open, the list's keys do nothing
    key(env.root.querySelector(".arxiv-browser__list")!, "j");
    expect(view.listPane.entries.indexOf(view.listPane.focused!)).toBe(0);
    // Escape also closes it when the focus has left it
    key(env.root.querySelector(".arxiv-browser__list")!, "Escape");
    expect(picker(env.root).hidden).toBe(true);
    expect(view.listPane.focused).not.toBeNull();
    dayButton(env.root).click();
    env.root
      .querySelector(".arxiv-browser__list")!
      .dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
    expect(picker(env.root).hidden).toBe(true);
    await env.settle();
    expect(view.days).toEqual({ kind: "newest" });
  });

  it("says which chosen days had no announcement", async () => {
    const env = setupDays();
    env.site.html(
      CATCHUP_URL("hep-ph", "2026-09-16"),
      catchupPageHtml("hep-ph", "2026-09-16", [], "2026-09-17"),
    );
    env.site.html(
      "https://arxiv.org/catchup/math/2026-09-16?abs=False",
      catchupPageHtml("math", "2026-09-16", [], "2026-09-17"),
    );
    const view = env.open();
    await env.settle();
    dayButton(env.root).click();
    click(day(env.root, "2026-09-16"));
    click(day(env.root, "2026-09-17"), { shiftKey: true });
    pickerButton(env.root, msg("arxiv-browser-days-load")).click();
    await env.settle();
    expect(view.loader.days.map((item) => item.date)).toEqual(["2026-09-17"]);
    expect(statusText(env.root)).toContain(
      msg("arxiv-browser-status-no-announcement", {
        dates: formatShortDay("2026-09-16"),
      }),
    );
  });

  it("shows a chosen day whose pages failed as not fetched, with a Retry", async () => {
    const env = setupDays();
    env.site.page(CATCHUP_URL("hep-ph", "2026-09-22"), (attempt) =>
      attempt === 1
        ? { status: 500, text: "error" }
        : {
            text: catchupPageHtml(
              "hep-ph",
              "2026-09-22",
              smallDay("hep-ph", 3),
              "2026-09-23",
            ),
          },
    );
    const view = env.open();
    await env.settle();
    dayButton(env.root).click();
    click(day(env.root, "2026-09-22"));
    click(day(env.root, "2026-09-23"), { metaKey: true });
    pickerButton(env.root, msg("arxiv-browser-days-load")).click();
    await env.settle();
    const header = () =>
      env.root.querySelector('.arxiv-browser__day[data-date="2026-09-22"]')!;
    expect(header().textContent).toContain(msg("arxiv-browser-day-failed"));
    header().querySelector<HTMLButtonElement>(".arxiv-browser__retry")!.click();
    await env.settle();
    expect(view.loader.days.map((item) => item.status)).toEqual([
      "complete",
      "complete",
    ]);
  });

  it("stops loading when the window closes during a load", async () => {
    const env = setupDays();
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "recent";
    const view = env.open();
    await env.clock.advanceBy(20000);
    expect(view.loader.running).toBe(true);
    view.dispose();
    const sent = env.site.sent.length;
    await env.clock.advanceBy(120000);
    expect(env.site.sent.length).toBe(sent);
    expect(view.loader.days.length).toBeLessThan(5);
  });
});

describe("arXiv browser: days read", () => {
  /**
   * hep-ph days 17 to 25 Sep, and a subscription made on Tuesday 22 Sep
   * (its first listing: Tuesday's), or `sub-1` (any day)
   */
  function setupReading(made = true) {
    const env = environment();
    const id = made
      ? `sub-${Date.parse("2026-09-22T12:00:00Z").toString(36)}-abcdef`
      : "sub-1";
    const subscription: ArxivSubscription = {
      id,
      name: "Daily",
      categories: ["hep-ph"],
      sections: { new: true, cross: true, replace: true },
    };
    prefs[`${PREFIX}.arxiv_subscriptions`] = JSON.stringify([subscription]);
    serveHepPh(env.site);
    for (const date of ["2026-09-17", "2026-09-18"]) {
      env.site.html(
        CATCHUP_URL("hep-ph", date),
        catchupPageHtml(
          "hep-ph",
          date,
          smallDay("hep-ph", 3),
          date === "2026-09-17" ? "2026-09-18" : "2026-09-21",
        ),
      );
    }
    return { ...env, subscription };
  }
  const dayButton = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>(".arxiv-browser__days-button")!;
  const picker = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".arxiv-browser__daypicker")!;
  const pickerButton = (root: HTMLElement, label: string) =>
    [...picker(root).querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === label,
    )!;
  const day = (root: HTMLElement, date: string) =>
    picker(root).querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!;
  const click = (target: Element, init: MouseEventInit = {}) =>
    target.dispatchEvent(
      new win.MouseEvent("click", { bubbles: true, ...init }),
    );
  /** The days with a blue dot in the month shown */
  const dotted = (root: HTMLElement) =>
    [
      ...picker(root).querySelectorAll<HTMLElement>(
        ".arxiv-browser__daypicker-day--unread",
      ),
    ].map((element) => element.dataset.date);
  const markButton = (root: HTMLElement) =>
    picker(root)
      .querySelector<HTMLElement>(".arxiv-browser__daypicker-marks")!
      .querySelectorAll("button")[0];

  it("dots the listing days not read from the subscription's first day on; the newest day, loaded, is read", async () => {
    const env = setupReading();
    const view = env.open();
    await env.settle();
    expect(view.loader.days.map((item) => item.status)).toEqual(["complete"]);
    dayButton(env.root).click();
    // Days never fetched count by weekday; none before Tuesday 22
    expect(dotted(env.root)).toEqual([
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    expect(day(env.root, "2026-09-23").getAttribute("aria-label")).toBe(
      msg("arxiv-browser-days-day-unread", {
        date: formatDay("2026-09-23"),
      }),
    );
    expect(env.reading.isRead(env.subscription.id, "2026-09-25")).toBe(true);
  });

  it("dots every listing day arXiv serves for a subscription whose first day is not known", async () => {
    const env = setupReading(false);
    env.open();
    await env.settle();
    dayButton(env.root).click();
    const september = servedListingDays(env.clock.now()).filter(
      (date) => date.startsWith("2026-09") && date !== "2026-09-25",
    );
    expect(dotted(env.root)).toEqual(september);
  });

  it("marks a day read once loaded completely; a day found without announcement too; a day not fetched completely stays unread", async () => {
    const env = setupReading(false);
    env.site.html(
      CATCHUP_URL("hep-ph", "2026-09-16"),
      catchupPageHtml("hep-ph", "2026-09-16", [], "2026-09-17"),
    );
    env.site.html(
      "https://arxiv.org/catchup/math/2026-09-16?abs=False",
      catchupPageHtml("math", "2026-09-16", [], "2026-09-17"),
    );
    env.site.page(CATCHUP_URL("hep-ph", "2026-09-22"), (attempt) =>
      attempt === 1
        ? { status: 500, text: "error" }
        : {
            text: catchupPageHtml(
              "hep-ph",
              "2026-09-22",
              smallDay("hep-ph", 3),
              "2026-09-23",
            ),
          },
    );
    const view = env.open();
    await env.settle();
    dayButton(env.root).click();
    for (const date of ["2026-09-16", "2026-09-17", "2026-09-22"]) {
      click(day(env.root, date), { metaKey: true });
    }
    pickerButton(env.root, msg("arxiv-browser-days-load")).click();
    await env.settle();
    expect(view.loader.days.map((item) => item.status)).toEqual([
      "failed",
      "complete",
    ]);
    dayButton(env.root).click();
    expect(dotted(env.root)).not.toContain("2026-09-16");
    expect(dotted(env.root)).not.toContain("2026-09-17");
    expect(dotted(env.root)).toContain("2026-09-22");
    dayButton(env.root).click();
    env.root
      .querySelector<HTMLButtonElement>(
        '.arxiv-browser__day[data-date="2026-09-22"] .arxiv-browser__retry',
      )!
      .click();
    await env.settle();
    dayButton(env.root).click();
    expect(dotted(env.root)).not.toContain("2026-09-22");
  });

  it("marks the picked days read, and unread again, by hand", async () => {
    const env = setupReading();
    env.open();
    await env.settle();
    const sent = env.site.sent.length;
    dayButton(env.root).click();
    expect(markButton(env.root).disabled).toBe(true);
    click(day(env.root, "2026-09-23"));
    expect(markButton(env.root).textContent).toBe(
      msg("arxiv-browser-days-mark-read"),
    );
    markButton(env.root).click();
    expect(dotted(env.root)).toEqual(["2026-09-22", "2026-09-24"]);
    expect(env.reading.isRead(env.subscription.id, "2026-09-23")).toBe(true);
    // The calendar stays open with the day picked
    expect(picker(env.root).hidden).toBe(false);
    expect(markButton(env.root).textContent).toBe(
      msg("arxiv-browser-days-mark-unread"),
    );
    markButton(env.root).click();
    expect(dotted(env.root)).toEqual([
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    // A read day (the newest) picked with an unread one: both marked read
    click(day(env.root, "2026-09-25"), { metaKey: true });
    markButton(env.root).click();
    expect(dotted(env.root)).toEqual(["2026-09-22", "2026-09-24"]);
    await env.clock.advanceBy(60000);
    expect(env.site.sent.length).toBe(sent);
  });

  it("marks all dotted days read without a request", async () => {
    const env = setupReading(false);
    env.open();
    await env.settle();
    const sent = env.site.sent.length;
    dayButton(env.root).click();
    pickerButton(env.root, msg("arxiv-browser-days-mark-all-read")).click();
    // Every month, not only the one shown
    for (const date of servedListingDays(env.clock.now())) {
      expect(env.reading.isRead("sub-1", date)).toBe(true);
    }
    expect(dotted(env.root)).toEqual([]);
    const unread = pickerButton(env.root, msg("arxiv-browser-days-unread"));
    expect(unread.disabled).toBe(true);
    expect(unread.title).toBe(msg("arxiv-browser-days-unread-none"));
    expect(
      pickerButton(env.root, msg("arxiv-browser-days-mark-all-read")).disabled,
    ).toBe(true);
    await env.clock.advanceBy(60000);
    expect(env.site.sent.length).toBe(sent);
  });

  it("loads the unread days with the preset, telling what it costs, and marks them read", async () => {
    const env = setupReading();
    const view = env.open();
    await env.settle();
    dayButton(env.root).click();
    const unread = pickerButton(env.root, msg("arxiv-browser-days-unread"));
    expect(unread.disabled).toBe(false);
    expect(unread.title).toBe(
      msg("arxiv-browser-days-estimate", {
        requests: 4,
        time: msg("arxiv-browser-duration-seconds", { count: 45 }),
      }),
    );
    unread.click();
    expect(picker(env.root).hidden).toBe(true);
    expect(view.days).toEqual({
      kind: "days",
      dates: ["2026-09-22", "2026-09-23", "2026-09-24"],
    });
    await env.settle();
    expect(view.loader.days.map((item) => item.date)).toEqual([
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
    ]);
    dayButton(env.root).click();
    expect(dotted(env.root)).toEqual([]);
  });

  it("keeps a subscription's marks when its categories change, and those of two subscriptions apart", async () => {
    const env = setupReading();
    const other: ArxivSubscription = {
      id: "sub-2",
      name: "Other",
      categories: ["hep-th"],
      sections: { new: true, cross: true, replace: true },
    };
    prefs[`${PREFIX}.arxiv_subscriptions`] = JSON.stringify([
      env.subscription,
      other,
    ]);
    env.site.html(
      LIST_URL("hep-th"),
      newPageHtml("hep-th", "2026-09-25", smallDay("hep-th", 3)),
    );
    const view = env.open();
    await env.settle();
    dayButton(env.root).click();
    click(day(env.root, "2026-09-23"));
    markButton(env.root).click();
    dayButton(env.root).click();

    // Another subscription: its own marks (the newest day it loaded)
    const choose = select(env.root, "subscription");
    choose.value = "sub-2";
    choose.dispatchEvent(new win.Event("change"));
    await env.settle();
    expect(view.loader.days.map((item) => item.date)).toEqual(["2026-09-25"]);
    expect(env.reading.isRead("sub-2", "2026-09-23")).toBe(false);
    expect(env.reading.isRead("sub-2", "2026-09-25")).toBe(true);
    dayButton(env.root).click();
    expect(dotted(env.root)).toContain("2026-09-23");
    dayButton(env.root).click();

    // Back, and hep-th added to the first
    choose.value = env.subscription.id;
    choose.dispatchEvent(new win.Event("change"));
    await env.settle();
    [...env.root.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === msg("arxiv-browser-subscription-edit"))!
      .click();
    [...env.root.querySelectorAll(".arxiv-browser__editor-row")]
      .find((row) => row.textContent!.startsWith("hep-th"))!
      .querySelector("input")!
      .click();
    [...env.root.querySelectorAll(".arxiv-browser__editor button")]
      .find((b) => b.textContent === msg("arxiv-browser-editor-save"))!
      .dispatchEvent(new win.MouseEvent("click"));
    await env.settle();
    expect(
      JSON.parse(String(prefs[`${PREFIX}.arxiv_subscriptions`]))[0].categories,
    ).toEqual(["hep-ph", "hep-th"]);
    dayButton(env.root).click();
    expect(dotted(env.root)).toEqual(["2026-09-22", "2026-09-24"]);
  });

  it("tells once that the file of the days read could not be read, and where it was kept", async () => {
    const path = "/data/zoteroinspire/arxiv-reading.json";
    const disk = fakeFiles({ [path]: "{not json" });
    const env = setupReading();
    const alert = vi.fn();
    (Zotero as unknown as { alert: typeof alert }).alert = alert;
    const reading = new ReadingState(readingStateFile(path), env.clock);
    env.open({ readingState: reading });
    await env.settle();
    expect(alert).toHaveBeenCalledTimes(1);
    const keptAs = [...disk.files.keys()].find((name) =>
      name.includes("-unreadable-"),
    )!;
    expect(disk.files.get(keptAs)).toBe("{not json");
    expect(alert.mock.calls[0][2]).toBe(
      msg("arxiv-browser-reading-file-kept", { path: keptAs }),
    );
    // A second window does not tell it again
    view!.dispose();
    env.open({ readingState: reading });
    await env.settle();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("tells that the days marked will not be kept when the file cannot be read at all", async () => {
    const path = "/data/zoteroinspire/arxiv-reading.json";
    const disk = fakeFiles({ [path]: "{}" });
    disk.unreadable(path);
    const env = setupReading();
    const alert = vi.fn();
    (Zotero as unknown as { alert: typeof alert }).alert = alert;
    env.open({
      readingState: new ReadingState(readingStateFile(path), env.clock),
    });
    await env.settle();
    expect(alert.mock.calls.map((call) => call[2])).toEqual([
      msg("arxiv-browser-reading-file-unreadable", { path }),
    ]);
  });
});

describe("arXiv browser: listing days served", () => {
  it("are the weekdays up to the newest scheduled listing, about 90 days back, oldest first", () => {
    const days = servedListingDays(Date.parse(NOW));
    expect(days[days.length - 1]).toBe("2026-09-25");
    expect(days[0]).toBe("2026-06-29");
    expect(
      days.every((date) => ![0, 6].includes(new Date(date).getUTCDay())),
    ).toBe(true);
    expect([...days].sort()).toEqual(days);
  });
});

describe("arXiv browser: adding and relating", () => {
  /** A library item that keeps its relations by key, as Zotero does */
  function libraryItem(id: number) {
    const item = {
      id,
      key: `KEY${id}`,
      libraryID: 1,
      relatedItems: [] as string[],
      isRegularItem: () => true,
      getDisplayTitle: () => `Item ${id}`,
      attachments: [] as number[],
      getAttachments: () => item.attachments,
      addRelatedItem(other: { key: string }) {
        if (item.relatedItems.includes(other.key)) return false;
        item.relatedItems.push(other.key);
        return true;
      },
      async removeRelatedItem(other: { key: string }) {
        const at = item.relatedItems.indexOf(other.key);
        if (at >= 0) item.relatedItems.splice(at, 1);
        return at >= 0;
      },
      save: async () => undefined,
    };
    return item;
  }

  /**
   * `related`: the arXiv ID of a paper in the library, related to the item
   * the Select Items dialog gives (`chosen`); `unloaded`: its library's items
   * are not loaded until the library's waitForDataLoad
   */
  async function loaded({
    related,
    unloaded = false,
    apiVersion,
  }: {
    related?: string;
    unloaded?: boolean;
    apiVersion?: unknown;
  } = {}) {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    const items = new Map<number, ReturnType<typeof libraryItem>>();
    const chosen = libraryItem(42);
    items.set(42, chosen);
    if (related) {
      const paper = libraryItem(77);
      items.set(77, paper);
      paper.addRelatedItem(chosen);
      chosen.addRelatedItem(paper);
    }
    const undo = vi.fn(async () => true);
    const readerOpen = vi.fn(async (_id: number) => ({ focus: vi.fn() }));
    const notLoaded = new Set(unloaded ? [77] : []);
    const pickRelated = vi.fn(async () => [chosen] as unknown as Zotero.Item[]);
    Object.assign((globalThis as any).Zotero, {
      Items: {
        get: (id: number) => {
          if (notLoaded.has(id)) {
            throw Object.assign(new Error("not loaded"), {
              name: "UnloadedDataException",
            });
          }
          return items.get(id) ?? false;
        },
        getLibraryAndKeyFromID: (id: number) =>
          items.has(id) ? { libraryID: 1, key: `KEY${id}` } : false,
        getByLibraryAndKey: (_libraryID: number, key: string) =>
          [...items.values()].find((item) => item.key === key) ?? false,
        getAsync: async (ids: number | number[]) =>
          Array.isArray(ids)
            ? ids.map((id) => items.get(id)).filter(Boolean)
            : (items.get(ids) ?? false),
      },
      Libraries: {
        get: (libraryID: number) => ({
          libraryID,
          name: "My Library",
          editable: true,
          waitForDataLoad: async () => {
            notLoaded.clear();
          },
        }),
        getAll: () => [{ libraryID: 1, name: "My Library", editable: true }],
        userLibrary: { libraryID: 1 },
      },
      Collections: { get: () => false, getByLibrary: () => [] },
      DB: { executeTransaction: async (fn: () => Promise<unknown>) => fn() },
      UndoHistory: { undo, redo: vi.fn(), stageAction: vi.fn() },
      Reader: { open: readerOpen },
    });
    const added = new Map<string, ReturnType<typeof libraryItem>>();
    let nextID = 900;
    const addPapers = vi.fn(async (requests: { arxivId: string }[]) =>
      requests.map((request) => {
        const item = libraryItem(nextID++);
        items.set(item.id, item);
        added.set(request.arxivId, item);
        return { status: "added", route: "arxiv", item, notes: [] };
      }),
    );
    const pickTarget = vi.fn(async () => ({
      libraryID: 1,
      primaryRowID: "L1",
      collectionIDs: [],
      tags: [],
      note: "",
    }));
    const importEntry = vi.fn(async (entry: { arxivDetails?: any }) => {
      const item = libraryItem(nextID++);
      items.set(item.id, item);
      return {
        status: "added" as const,
        route: "arxiv" as const,
        item,
        notes: [],
      };
    });
    /** An HTML attachment of item `parentID` with URL `url` */
    let nextAttachmentID = 5000;
    const attach = (parentID: number, url: string) => {
      const attachment = {
        id: nextAttachmentID++,
        attachmentContentType: "text/html",
        getField: (field: string) => (field === "url" ? url : ""),
      };
      (items as Map<number, any>).set(attachment.id, attachment);
      items.get(parentID)!.attachments.push(attachment.id);
      return attachment;
    };
    const saveHtmlSnapshot = vi.fn(
      async (
        item: { id: number },
        source: { id: string; version: number },
      ) => ({
        status: "saved" as const,
        attachment: attach(
          item.id,
          `https://arxiv.org/html/${source.id}v${source.version}`,
        ) as unknown as Zotero.Item,
      }),
    );
    const view = env.open({
      pickRelated,
      addPapers,
      pickTarget,
      saveHtmlSnapshot,
      batchImport: { canImport: () => true, importEntry },
      ...(apiVersion ? { apiVersion } : {}),
      ...(related
        ? {
            inLibrary: async (ids: readonly string[]) =>
              new Map(
                ids.filter((id) => id === related).map((id) => [id, [77]]),
              ),
          }
        : {}),
    });
    await env.settle();
    const list = env.root.querySelector(".arxiv-browser__list")!;
    const notices = () =>
      [...env.root.querySelectorAll(".arxiv-browser__notice")].map(
        (notice) => notice.textContent,
      );
    return {
      ...env,
      view,
      list,
      pickRelated,
      items,
      added,
      chosen,
      addPapers,
      pickTarget,
      importEntry,
      undo,
      notices,
      libraryItem,
      readerOpen,
      attach,
      saveHtmlSnapshot,
    };
  }

  /** The ▾ menu of a split HTML button: its entries, and running one */
  function htmlMenu(more: HTMLElement) {
    const doc = win.document as any;
    let popup: any = null;
    doc.createXULElement = (tag: string) => {
      const element = doc.createElement(tag);
      if (tag === "menupopup") {
        element.openPopup = vi.fn();
        popup = element;
      }
      return element;
    };
    more.click();
    // Below the ▾ (elements compared by identity: jsdom's cannot be printed)
    const [anchor, ...position] = popup.openPopup.mock.calls[0];
    expect(anchor === more).toBe(true);
    expect(position).toEqual(["after_start", 0, 0]);
    const entries = [...popup.children] as HTMLElement[];
    return {
      labels: entries.map((entry) => entry.getAttribute("label")),
      run(label: string) {
        entries
          .find((entry) => entry.getAttribute("label") === label)!
          .dispatchEvent(new win.Event("command"));
      },
    };
  }
  const htmlParts = (row: HTMLElement) => ({
    open: row.querySelector<HTMLButtonElement>(".arxiv-browser__html-button")!,
    more: row.querySelector<HTMLButtonElement>(".arxiv-browser__html-more")!,
    stroke: () =>
      row
        .querySelector(".arxiv-browser__html-button path")!
        .getAttribute("stroke"),
  });
  const detailHtml = (root: HTMLElement) => {
    const split = root.querySelector<HTMLElement>(
      ".arxiv-browser__detail .arxiv-browser__split",
    )!;
    return {
      open: split.querySelector<HTMLButtonElement>(
        ".arxiv-browser__button:not(.arxiv-browser__split-more)",
      )!,
      more: split.querySelector<HTMLButtonElement>(
        ".arxiv-browser__split-more",
      )!,
    };
  };
  const MENU = {
    browser: msg("arxiv-browser-html-menu-browser"),
    save: msg("arxiv-browser-html-menu-save"),
    open: msg("arxiv-browser-html-menu-open"),
  };

  it("opens a paper's saved HTML snapshot in Zotero, else arXiv's HTML version in the web browser; the translator's abstract snapshot is not one", async () => {
    const { root, launch, readerOpen, attach, view } = await loaded({
      related: "2609.28538",
    });
    await vi.waitFor(() => expect(dot(rows(root)[0])).toBe("●"));
    const row = rows(root)[0];
    const parts = htmlParts(row);
    // Nothing saved: arXiv's page, grey; the menu has no "open snapshot"
    parts.open.click();
    expect(launch).toHaveBeenLastCalledWith(
      "https://arxiv.org/html/2609.28538",
    );
    expect(readerOpen).not.toHaveBeenCalled();
    expect(parts.stroke()).toBe("#9ca3af");
    expect(parts.open.title).toBe(msg("arxiv-browser-open-html"));
    expect(htmlMenu(parts.more).labels).toEqual([MENU.browser, MENU.save]);

    // Zotero's arXiv translator's snapshot of the abstract page, and a PDF
    attach(77, "https://arxiv.org/abs/2609.28538v1");
    view.listPane.refreshPdfButtons();
    parts.open.click();
    expect(launch).toHaveBeenCalledTimes(2);
    expect(readerOpen).not.toHaveBeenCalled();
    expect(htmlMenu(parts.more).labels).toEqual([MENU.browser, MENU.save]);

    // An HTML snapshot saved: green, and it opens in Zotero's reader
    const snapshot = attach(77, "https://arxiv.org/html/2609.28538v1");
    view.listPane.refreshPdfButtons();
    expect(parts.stroke()).toBe("#1a8f4d");
    expect(parts.open.title).toBe(msg("arxiv-browser-open-html-snapshot"));
    parts.open.click();
    expect(readerOpen).toHaveBeenLastCalledWith(snapshot.id, undefined, {
      allowDuplicate: false,
    });
    expect(launch).toHaveBeenCalledTimes(2);
    const menu = htmlMenu(parts.more);
    expect(menu.labels).toEqual([MENU.browser, MENU.save, MENU.open]);
    menu.run(MENU.browser);
    expect(launch).toHaveBeenLastCalledWith(
      "https://arxiv.org/html/2609.28538",
    );
    menu.run(MENU.open);
    expect(readerOpen).toHaveBeenCalledTimes(2);

    // The detail pane's split button does the same
    const detail = detailHtml(root);
    expect(detail.open.textContent).toBe(msg("arxiv-browser-open-html-button"));
    detail.open.dispatchEvent(new win.MouseEvent("mouseenter"));
    expect(detail.open.title).toBe(msg("arxiv-browser-open-html-snapshot"));
    detail.open.click();
    expect(readerOpen).toHaveBeenCalledTimes(3);
    expect(htmlMenu(detail.more).labels).toEqual([
      MENU.browser,
      MENU.save,
      MENU.open,
    ]);
  });

  it("saves the HTML version of a paper in the library to its item, at the listing's version, once", async () => {
    const { root, saveHtmlSnapshot, items, notices, pickTarget, addPapers } =
      await loaded({ related: "2609.28538" });
    await vi.waitFor(() => expect(dot(rows(root)[0])).toBe("●"));
    const parts = htmlParts(rows(root)[0]);
    htmlMenu(parts.more).run(MENU.save);
    await vi.waitFor(() => expect(saveHtmlSnapshot).toHaveBeenCalledTimes(1));
    expect(saveHtmlSnapshot.mock.calls[0][0]).toBe(items.get(77));
    expect(saveHtmlSnapshot.mock.calls[0][1]).toEqual({
      id: "2609.28538",
      version: 1,
    });
    // Not added again
    expect(pickTarget).not.toHaveBeenCalled();
    expect(addPapers).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(notices().join()).toContain(
        msg("arxiv-browser-html-saved", { id: "2609.28538", version: 1 }),
      ),
    );
    // That version is there: not saved again
    htmlMenu(parts.more).run(MENU.save);
    await vi.waitFor(() =>
      expect(notices().join()).toContain(
        msg("arxiv-browser-html-there", { id: "2609.28538", version: 1 }),
      ),
    );
    expect(saveHtmlSnapshot).toHaveBeenCalledTimes(1);
  });

  describe("an older version chosen in the detail pane", () => {
    const ID = "2508.00226";
    const apiVersion = () =>
      vi.fn(async () => ({
        ok: true,
        entry: {
          id: ID,
          version: 2,
          title: "Version 2",
          abstract: "Abstract 2",
          authors: ["A. Author"],
          published: "2025-07-31T10:00:00Z",
          updated: "2025-08-20T09:30:00Z",
          primaryCategory: "hep-ph",
          categories: ["hep-ph"],
        },
      }));
    async function atVersion2(related?: string) {
      const env = await loaded({ related, apiVersion: apiVersion() });
      const sort = select(env.root, "sort");
      sort.value = "id-asc";
      sort.dispatchEvent(new win.Event("change"));
      const row = () =>
        rows(env.root).find((r) => r.dataset.entryId!.includes(ID))!;
      if (related) await vi.waitFor(() => expect(dot(row())).toBe("●"));
      row().click();
      const chooser = env.root.querySelector<HTMLSelectElement>(
        ".arxiv-browser__detail .arxiv-browser__version",
      )!;
      chooser.value = "2";
      chooser.dispatchEvent(new win.Event("change"));
      await flushPromises();
      expect(
        env.root.querySelector(".arxiv-browser__detail-title")!.textContent,
      ).toBe("Version 2");
      const pdf = () =>
        [
          ...env.root.querySelectorAll<HTMLButtonElement>(
            ".arxiv-browser__detail-actions button",
          ),
        ].find((b) => b.textContent === msg("arxiv-browser-open-pdf-button"))!;
      return { ...env, row, pdf };
    }
    /** A PDF attachment of item `parentID` with URL `url` */
    const attachPdf = (
      items: Map<number, any>,
      parentID: number,
      url: string,
      id: number,
      title = "",
    ) => {
      items.set(id, {
        id,
        attachmentContentType: "application/pdf",
        isPDFAttachment: () => true,
        getField: (field: string) =>
          field === "url" ? url : field === "title" ? title : "",
      });
      items.get(parentID)!.attachments.push(id);
    };

    it("opens the library's PDF of that version, else arXiv's of that version", async () => {
      const { items, pdf, launch, readerOpen } = await atVersion2(ID);
      // The library's PDF is of version 3
      attachPdf(items, 77, `http://arxiv.org/pdf/${ID}v3`, 6001);
      pdf().click();
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/pdf/${ID}v2`);
      expect(readerOpen).not.toHaveBeenCalled();
      // One of version 2 (also with ".pdf")
      attachPdf(items, 77, `https://arxiv.org/pdf/${ID}v2.pdf`, 6002);
      pdf().click();
      await flushPromises();
      expect(readerOpen).toHaveBeenLastCalledWith(6002, undefined, {
        allowDuplicate: false,
      });
      expect(launch).toHaveBeenCalledTimes(1);
    });

    it("knows the version of the PDFs the plugin attached by their title (they have no address)", async () => {
      const { items, pdf, launch, readerOpen } = await atVersion2(ID);
      attachPdf(items, 77, "", 6001, "arXiv preprint PDF v3");
      pdf().click();
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/pdf/${ID}v2`);
      attachPdf(items, 77, "", 6002, "arXiv 预印本 PDF v2");
      pdf().click();
      await flushPromises();
      expect(readerOpen).toHaveBeenLastCalledWith(6002, undefined, {
        allowDuplicate: false,
      });
    });

    it("opens for the newest version a library PDF of that version, else one of no known version, never one of another version", async () => {
      const { root, items, pdf, launch, readerOpen, row } =
        await atVersion2(ID);
      // Only version 2 in the library (arXiv's address, and one the plugin
      // attached, known by its title): arXiv's newest
      attachPdf(items, 77, `http://arxiv.org/pdf/${ID}v2`, 6001);
      attachPdf(items, 77, "", 6005, "arXiv preprint PDF v2");
      const chooser = root.querySelector<HTMLSelectElement>(
        ".arxiv-browser__detail .arxiv-browser__version",
      )!;
      chooser.value = "3";
      chooser.dispatchEvent(new win.Event("change"));
      await flushPromises();
      pdf().click();
      await flushPromises();
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/pdf/${ID}`);
      expect(readerOpen).not.toHaveBeenCalled();
      // The row's green button opens the library's first PDF, as before
      row()
        .querySelector<HTMLButtonElement>(".zinspire-ref-entry__pdf")!
        .click();
      await flushPromises();
      expect(readerOpen).toHaveBeenLastCalledWith(6001, undefined, {
        allowDuplicate: false,
      });
      // As in the owner's library: then the journal's PDF (no address),
      // which is opened rather than version 2
      attachPdf(items, 77, "", 6002);
      pdf().click();
      await flushPromises();
      expect(readerOpen).toHaveBeenLastCalledWith(6002, undefined, {
        allowDuplicate: false,
      });
      // One of version 3 comes first
      attachPdf(items, 77, `https://arxiv.org/pdf/${ID}v3`, 6003);
      pdf().click();
      await flushPromises();
      expect(readerOpen).toHaveBeenLastCalledWith(6003, undefined, {
        allowDuplicate: false,
      });
      expect(launch).toHaveBeenCalledTimes(1);
    });

    it("saves the HTML version of that version, and then opens that snapshot", async () => {
      const { root, saveHtmlSnapshot, items, notices, readerOpen, launch } =
        await atVersion2(ID);
      const detail = detailHtml(root);
      expect(htmlMenu(detail.more).labels).toEqual([MENU.browser, MENU.save]);
      htmlMenu(detail.more).run(MENU.browser);
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/html/${ID}v2`);
      htmlMenu(detail.more).run(MENU.save);
      await vi.waitFor(() => expect(saveHtmlSnapshot).toHaveBeenCalledTimes(1));
      expect(saveHtmlSnapshot.mock.calls[0][0]).toBe(items.get(77));
      expect(saveHtmlSnapshot.mock.calls[0][1]).toEqual({ id: ID, version: 2 });
      await vi.waitFor(() =>
        expect(notices().join()).toContain(
          msg("arxiv-browser-html-saved", { id: ID, version: 2 }),
        ),
      );
      detailHtml(root).open.click();
      expect(readerOpen).toHaveBeenCalledTimes(1);
      expect(launch).toHaveBeenCalledTimes(1);
      // The newest version (3) has no snapshot: arXiv's, not version 2's
      const chooser = root.querySelector<HTMLSelectElement>(
        ".arxiv-browser__detail .arxiv-browser__version",
      )!;
      chooser.value = "3";
      chooser.dispatchEvent(new win.Event("change"));
      await flushPromises();
      detailHtml(root).open.click();
      expect(readerOpen).toHaveBeenCalledTimes(1);
      expect(launch).toHaveBeenLastCalledWith(`https://arxiv.org/html/${ID}`);
      expect(htmlMenu(detailHtml(root).more).labels).toEqual([
        MENU.browser,
        MENU.save,
      ]);
      // The row (no version choice) opens any snapshot saved, as before
      htmlParts(
        rows(root).find((r) => r.dataset.entryId!.includes(ID))!,
      ).open.click();
      expect(readerOpen).toHaveBeenCalledTimes(2);
    });

    it("adds a paper not in the library as it is, then saves the HTML version of the version chosen", async () => {
      const { root, saveHtmlSnapshot, added, addPapers } = await atVersion2();
      htmlMenu(detailHtml(root).more).run(MENU.save);
      await vi.waitFor(() => expect(saveHtmlSnapshot).toHaveBeenCalledTimes(1));
      expect(addPapers.mock.calls[0][0]).toMatchObject([{ arxivId: ID }]);
      expect(saveHtmlSnapshot.mock.calls[0][0]).toBe(added.get(ID));
      expect(saveHtmlSnapshot.mock.calls[0][1]).toEqual({ id: ID, version: 2 });
    });
  });

  it("adds a paper not in the library first, where the user chooses, then saves its HTML version to the new item", async () => {
    const {
      root,
      saveHtmlSnapshot,
      added,
      pickTarget,
      addPapers,
      readerOpen,
      launch,
    } = await loaded();
    const row = rows(root)[0];
    expect(dot(row)).not.toBe("●");
    htmlMenu(htmlParts(row).more).run(MENU.save);
    await vi.waitFor(() => expect(saveHtmlSnapshot).toHaveBeenCalledTimes(1));
    expect(pickTarget).toHaveBeenCalledTimes(1);
    expect(addPapers.mock.calls[0][0]).toMatchObject([
      { arxivId: "2609.28538" },
    ]);
    expect(saveHtmlSnapshot.mock.calls[0][0]).toBe(added.get("2609.28538"));
    // The main click now opens it in Zotero
    await vi.waitFor(() => expect(dot(rows(root)[0])).toBe("●"));
    htmlParts(rows(root)[0]).open.click();
    expect(readerOpen).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
  });

  const dot = (row: HTMLElement) =>
    row.querySelector(".zinspire-ref-entry__dot")!.textContent;
  const linkState = (row: HTMLElement) =>
    row.querySelector<HTMLElement>(".zinspire-ref-entry__link")!.dataset.state;

  it("draws the References panel's tick box, add mark and relate button on the rows, and a click on each does what it says", async () => {
    const { root, view, chosen, added, addPapers, pickTarget, pickRelated } =
      await loaded();
    const row = () => rows(root)[0];
    const part = <T extends HTMLElement>(name: string) =>
      row().querySelector<T>(`.zinspire-ref-entry__${name}`)!;
    // Not in the library: ⊕, a click adds it
    expect([part("dot").textContent, part("dot").dataset.state]).toEqual([
      "⊕",
      "missing",
    ]);
    expect(part("dot").title).toBe(msg("arxiv-browser-dot-add"));
    expect(part<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(part("link").dataset.state).toBe("unlinked");
    expect(part("link").title).toBe(msg("arxiv-browser-row-link"));
    // No relation target in the toolbar
    expect(root.querySelector(".arxiv-browser__relation")).toBeNull();

    // The tick box ticks the paper
    part<HTMLInputElement>("checkbox").click();
    expect([...view.batch.getSelectedEntryIDs()]).toEqual([
      row().dataset.entryId,
    ]);
    expect(part<HTMLInputElement>("checkbox").checked).toBe(true);

    // The mark adds the paper (asking where)
    part("dot").click();
    await vi.waitFor(() => expect(addPapers).toHaveBeenCalledTimes(1));
    expect(pickTarget).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(part("dot").textContent).toBe("●"));
    expect(part("dot").title).toBe(msg("arxiv-browser-dot-local"));

    // The relate button asks for the items (Zotero's Select Items dialog,
    // the paper's library) and relates the paper to them
    part("link").click();
    const item = added.get("2609.28538")!;
    await vi.waitFor(() => expect(chosen.relatedItems).toEqual([item.key]));
    expect(pickRelated).toHaveBeenCalledWith(win, 1);
    await vi.waitFor(() => expect(part("link").dataset.state).toBe("linked"));
    expect(part("link").title).toBe(
      [msg("arxiv-browser-row-related", { count: 1 }), "• Item 42"].join("\n"),
    );
  });

  it("shows a paper already related once Zotero has loaded its library's items", async () => {
    const { root } = await loaded({ related: "2609.28538", unloaded: true });
    const link = () =>
      rows(root)[0].querySelector<HTMLElement>(".zinspire-ref-entry__link")!;
    await vi.waitFor(() => expect(link().dataset.state).toBe("linked"));
    expect(link().title).toContain("• Item 42");
  });

  it("shows a paper already related as related once the library marks arrive", async () => {
    const { root } = await loaded({ related: "2609.28538" });
    const part = (name: string) =>
      rows(root)[0].querySelector<HTMLElement>(`.zinspire-ref-entry__${name}`)!;
    await vi.waitFor(() => expect(part("dot").textContent).toBe("●"));
    expect(part("link").dataset.state).toBe("linked");
    expect(part("link").title).toContain("• Item 42");
  });

  it("adds the focused paper with a, asking where every time, and shows it in the library", async () => {
    const { root, list, addPapers, pickTarget, notices } = await loaded();
    key(list, "j");
    key(list, "a");
    await vi.waitFor(() => expect(addPapers).toHaveBeenCalledTimes(1));
    expect(pickTarget).toHaveBeenCalledTimes(1);
    expect(addPapers.mock.calls[0][0]).toMatchObject([
      { arxivId: "2609.28538" },
    ]);
    await vi.waitFor(() => expect(dot(rows(root)[0])).toBe("●"));
    expect(notices().join()).toContain(
      msg("arxiv-browser-added", { id: "2609.28538", target: "My Library" }),
    );
    // The detail pane adds where the user chooses too: no "Add to <target>"
    const detailButtons = () =>
      [
        ...root.querySelectorAll<HTMLButtonElement>(
          ".arxiv-browser__detail-actions button",
        ),
      ].map((button) => button.textContent);
    key(list, "j");
    expect(
      detailButtons().filter((text) =>
        text!.startsWith(msg("arxiv-browser-add")),
      ),
    ).toEqual([msg("arxiv-browser-add"), msg("arxiv-browser-add-journal")]);

    // a again, on the next paper: the picker asks again; t adds nothing
    key(list, "t");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(addPapers).toHaveBeenCalledTimes(1);
    key(list, "a");
    await vi.waitFor(() => expect(addPapers).toHaveBeenCalledTimes(2));
    expect(pickTarget).toHaveBeenCalledTimes(2);
  });

  it("relates the focused paper with l to the items chosen, undoes that with Ctrl+Z, and draws the relate button", async () => {
    const { root, list, chosen, added, undo } = await loaded();
    key(list, "j");
    key(list, "l");
    // Not in the library: added first (asking where), then related
    await vi.waitFor(() => expect(added.size).toBe(1));
    const item = added.get("2609.28538")!;
    await vi.waitFor(() => expect(chosen.relatedItems).toEqual([item.key]));
    expect(item.relatedItems).toEqual([chosen.key]);
    await vi.waitFor(() => expect(linkState(rows(root)[0])).toBe("linked"));
    key(list, "z", { ctrlKey: true });
    expect(undo).toHaveBeenCalled();
  });

  /** The References panel's batch toolbar in the window */
  const batchToolbar = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".zinspire-batch-toolbar")!;
  const toolbarButton = (root: HTMLElement, key: string) =>
    [...batchToolbar(root).querySelectorAll("button")].find(
      (button) => button.textContent === msg(key),
    )!;
  const checkboxes = (root: HTMLElement) =>
    rows(root).map(
      (row) =>
        row.querySelector<HTMLInputElement>(".zinspire-ref-entry__checkbox")!,
    );

  it("with the window's stylesheet, shows the check box and ⊕ on a paper not in the library, and the batch toolbar only while papers are selected", async () => {
    // The stylesheets the window's document loads, from the plugin's files
    const markup = readFileSync(
      new URL("../addon/content/arxivBrowser.xhtml", import.meta.url),
      "utf8",
    );
    const sheets = [
      ...markup.matchAll(
        /<\?xml-stylesheet href="chrome:\/\/__addonRef__\/content\/([^"?]+)/g,
      ),
    ].map(([, file]) => file);
    expect(sheets).toEqual(["arxivBrowser.css"]);
    for (const file of sheets) {
      const style = win.document.createElement("style");
      style.textContent = readFileSync(
        new URL(`../addon/content/${file}`, import.meta.url),
        "utf8",
      );
      win.document.head.append(style);
    }
    const { root, view } = await loaded();
    const row = rows(root)[0];
    const shown = (element: Element) => {
      const style = win.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const dotOf = row.querySelector<HTMLElement>(".zinspire-ref-entry__dot")!;
    expect([dotOf.textContent, dotOf.dataset.state]).toEqual(["⊕", "missing"]);
    expect(shown(dotOf)).toBe(true);
    const checkbox = checkboxes(root)[0];
    expect(shown(checkbox)).toBe(true);

    // Nothing selected: no toolbar
    expect(shown(batchToolbar(root))).toBe(false);
    checkbox.click();
    expect(shown(batchToolbar(root))).toBe(true);
    // At the right of the page's first day header
    expect(
      batchToolbar(root).parentElement ===
        root.querySelector(".arxiv-browser__list .arxiv-browser__day"),
    ).toBe(true);
    expect(
      batchToolbar(root).querySelector(".zinspire-batch-toolbar__badge")!
        .textContent,
    ).toBe(msg("references-panel-batch-selected", { count: 1 }));
    expect(
      [...batchToolbar(root).querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
    ).toEqual([
      msg("references-panel-batch-select-all"),
      msg("references-panel-batch-clear"),
      msg("references-panel-batch-import"),
    ]);
    checkbox.click();
    expect(view.batch.getSelectedEntryIDs().size).toBe(0);
    expect(shown(batchToolbar(root))).toBe(false);
    // The window's own tick bar is gone
    expect(root.querySelector(".arxiv-browser__tickbar")).toBeNull();
  });

  it("selects papers with x, the check box and Shift-click, and imports the selected papers in one batch import", async () => {
    const { root, list, importEntry, pickTarget, notices } = await loaded();
    key(list, "j");
    key(list, "x");
    checkboxes(root)[2].click();
    // Shift-click: the papers from the last one clicked to this one
    checkboxes(root)[5].dispatchEvent(
      new win.MouseEvent("click", { bubbles: true, shiftKey: true }),
    );
    expect(checkboxes(root).map((box) => box.checked)).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
      ...Array(44).fill(false),
    ]);
    expect(
      batchToolbar(root).querySelector(".zinspire-batch-toolbar__badge")!
        .textContent,
    ).toBe(msg("references-panel-batch-selected", { count: 5 }));
    // x again unselects the focused paper
    key(list, "x");
    expect(checkboxes(root)[0].checked).toBe(false);
    toolbarButton(root, "references-panel-batch-import").click();
    await vi.waitFor(() => expect(importEntry).toHaveBeenCalledTimes(4));
    expect(pickTarget).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(notices().join()).toContain(
        msg("arxiv-browser-batch-added", {
          added: 4,
          total: 4,
          target: "My Library",
        }),
      ),
    );
    expect([2, 3, 4, 5].map((index) => dot(rows(root)[index]))).toEqual([
      "●",
      "●",
      "●",
      "●",
    ]);
    expect(batchToolbar(root).style.display).toBe("none");
  });

  it("selects all papers of the listing, on every page, and clears the selection", async () => {
    const { root, view } = await loaded();
    checkboxes(root)[0].click();
    toolbarButton(root, "references-panel-batch-select-all").click();
    expect(view.batch.getSelectedEntryIDs().size).toBe(72);
    expect(checkboxes(root).every((box) => box.checked)).toBe(true);
    toolbarButton(root, "references-panel-batch-clear").click();
    expect(view.batch.getSelectedEntryIDs().size).toBe(0);
    expect(checkboxes(root).some((box) => box.checked)).toBe(false);
    expect(batchToolbar(root).style.display).toBe("none");
  });
});

describe("arXiv browser: quick filters and the filter history", () => {
  const HISTORY = `${config.addonRef}.inspireFilterHistory`;

  async function loaded(options: Record<string, unknown> = {}) {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    // Every paper of the day on one page
    prefs[`${PREFIX}.arxiv_browser_page_size`] = 100;
    const view = env.open(options);
    await env.settle();
    return { ...env, view };
  }

  const quickButton = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>(".zinspire-quick-filter-btn")!;
  const popup = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".zinspire-quick-filter-popup")!;
  const box = (root: HTMLElement, labelKey: string) =>
    [...popup(root).querySelectorAll("label")]
      .find(
        (label) =>
          label.querySelector(".zinspire-quick-filter-item-label")!
            .textContent === msg(labelKey),
      )!
      .querySelector("input")!;
  const toggle = (root: HTMLElement, labelKey: string) => {
    const input = box(root, labelKey);
    input.checked = !input.checked;
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  };
  const filterBox = (root: HTMLElement) =>
    root.querySelector<HTMLInputElement>(".arxiv-browser__filter input")!;
  const typeFilter = async (root: HTMLElement, text: string) => {
    filterBox(root).value = text;
    filterBox(root).dispatchEvent(new win.Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 200));
  };
  const shownIds = (view: ArxivBrowserView) =>
    view.listPane.entries.map((entry) => entry.listing.id);

  it("puts the References panel's quick-filter button left of the filter box, with the filters the listing has data for", async () => {
    const { root } = await loaded();
    const button = quickButton(root);
    expect(button.textContent).toBe("⏳");
    expect(
      button.closest(".zinspire-quick-filters")!.nextElementSibling ===
        filterBox(root).parentElement,
    ).toBe(true);
    expect(popup(root).hidden).toBe(true);

    button.click();
    expect(popup(root).hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(
      [
        ...popup(root).querySelectorAll(".zinspire-quick-filter-item-label"),
      ].map((label) => label.textContent),
    ).toEqual(
      [
        "references-panel-quick-filter-local-items",
        "references-panel-quick-filter-online-items",
        "references-panel-chart-author-filter",
        "references-panel-quick-filter-published",
        "references-panel-quick-filter-preprint",
      ].map((key) => msg(key)),
    );
    // Closed by the button, or by a click elsewhere
    button.click();
    expect(popup(root).hidden).toBe(true);
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows(root)[0].click();
    expect(popup(root).hidden).toBe(true);
  });

  it("keeps the papers the filters on ask for, together with the text filter, and counts them on the button", async () => {
    const { root, view } = await loaded();
    const all = view.listPane.entries;
    expect(all).toHaveLength(72);
    const published = all
      .filter((entry) => entry.listing.journalRef)
      .map((entry) => entry.listing.id);
    expect(published).toHaveLength(9);
    const badge = root.querySelector(".zinspire-quick-filter-badge")!;
    expect((badge as HTMLElement).hidden).toBe(true);

    toggle(root, "references-panel-quick-filter-published");
    expect(shownIds(view)).toEqual(published);
    expect(badge.textContent).toBe("1");
    expect(root.querySelector(".arxiv-browser__day-count")!.textContent).toBe(
      msg("arxiv-browser-day-filtered", { shown: 9, count: 72 }),
    );

    // arXiv only excludes published
    toggle(root, "references-panel-quick-filter-preprint");
    expect(box(root, "references-panel-quick-filter-published").checked).toBe(
      false,
    );
    expect(view.listPane.entries).toHaveLength(63);
    expect(badge.textContent).toBe("1");

    toggle(root, "references-panel-chart-author-filter");
    const few = all.filter(
      (entry) =>
        !entry.listing.journalRef && entry.listing.authors.length <= 10,
    );
    expect(shownIds(view)).toEqual(few.map((entry) => entry.listing.id));
    expect(badge.textContent).toBe("2");

    await typeFilter(root, "hep-lat");
    const both = few.filter((entry) =>
      entry.listing.categories.includes("hep-lat"),
    );
    expect(both.length).toBeGreaterThan(0);
    expect(shownIds(view)).toEqual(both.map((entry) => entry.listing.id));
  });

  it("shows papers entering the local and online filters as the library marks arrive", async () => {
    let answer: (found: ReadonlyMap<string, readonly number[]>) => void = () =>
      undefined;
    const lookup = vi.fn(
      () =>
        new Promise<ReadonlyMap<string, readonly number[]>>((resolve) => {
          answer = resolve;
        }),
    );
    const { root, view } = await loaded({ inLibrary: lookup });
    toggle(root, "references-panel-quick-filter-local-items");
    expect(view.listPane.entries).toHaveLength(0);
    answer(new Map([["2609.28538", [7]]]));
    await flushPromises();
    expect(shownIds(view)).toEqual(["2609.28538"]);
    toggle(root, "references-panel-quick-filter-online-items");
    expect(box(root, "references-panel-quick-filter-local-items").checked).toBe(
      false,
    );
    expect(view.listPane.entries).toHaveLength(71);
  });

  it("keeps what was filtered for in the References panel's filter history and completes it", async () => {
    prefs[HISTORY] = JSON.stringify([
      { query: "neutrino mass", timestamp: Date.now() },
    ]);
    const { root, view } = await loaded();
    const input = filterBox(root);
    input.focus();
    await typeFilter(root, "gluon");
    // Typing does not keep it; Enter does
    expect(JSON.parse(prefs[HISTORY] as string)).toHaveLength(1);
    key(input, "Enter");
    expect(
      JSON.parse(prefs[HISTORY] as string).map(
        (item: { query: string }) => item.query,
      ),
    ).toEqual(["gluon", "neutrino mass"]);

    // The history's suggestion, taken with Tab
    await typeFilter(root, "neu");
    const hint = root.querySelector<HTMLElement>(
      ".arxiv-browser__filter .zinspire-filter-inline-hint",
    )!;
    expect(hint.textContent).toBe("trino\u00A0mass");
    key(input, "Tab");
    expect(input.value).toBe("neutrino mass");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(view.listPane.entries.length).toBeLessThan(72);
    for (const entry of view.listPane.entries) {
      expect(
        `${entry.listing.title} ${entry.listing.abstract}`.toLowerCase(),
      ).toMatch(/neutrino/);
    }
  });

  it("keeps the batch toolbar in the first day header of the page shown", async () => {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site, 30);
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "recent";
    prefs[`${PREFIX}.arxiv_browser_page_size`] = 50;
    const view = env.open();
    await env.settle();
    const toolbar = env.root.querySelector<HTMLElement>(
      ".zinspire-batch-toolbar",
    )!;
    rows(env.root)[0]
      .querySelector<HTMLInputElement>(".zinspire-ref-entry__checkbox")!
      .click();
    const firstHeader = () =>
      env.root.querySelector(".arxiv-browser__list .arxiv-browser__day");
    expect(toolbar.parentElement === firstHeader()).toBe(true);
    view.listPane.goToPage(1);
    expect(toolbar.parentElement === firstHeader()).toBe(true);
    expect(toolbar.style.display).toBe("flex");
  });
});

describe("arXiv browser: searching arXiv", () => {
  /** The window on the hep-ph day, searching through an API scheduler */
  async function searching(options: Record<string, unknown> = {}) {
    const env = environment();
    subscribe(["hep-ph"]);
    serveHepPh(env.site);
    const api = new ArxivScheduler({
      host: "export.arxiv.org",
      minIntervalMs: 3000,
      timeoutMs: 30000,
      transport: env.site.transport,
      clock: env.clock,
    });
    const setRead = vi.spyOn(env.reading, "setRead");
    const view = env.open({
      apiScheduler: api,
      searchArxiv: (
        query: string,
        start: number,
        count: number,
        signal?: AbortSignal,
      ) =>
        searchArxiv(query, start, count, {
          scheduler: api,
          parseXml: xmlDocument,
          signal,
        }),
      ...options,
    });
    await env.settle();
    setRead.mockClear();
    /** Let the search's request run until it ends */
    const settleSearch = async () => {
      for (let i = 0; i < 60 && view.search.running; i++) {
        await env.clock.advanceBy(1000);
      }
      await flushPromises();
    };
    return { ...env, view, api, setRead, settleSearch };
  }

  /**
   * An answer of the API: `count` papers from `first` on (2609.3xxxx), of
   * `total`, submitted one a day back from 29 September 2026; the first
   * (2609.30000) has a version 2, submitted on 2 October
   */
  function results(first: number, count: number, total: number): string {
    const entries = Array.from({ length: count }, (_, i) => {
      const n = first + i;
      const date = new Date(Date.parse("2026-09-29T12:00:00Z") - n * 86400000)
        .toISOString()
        .replace(/\.\d+Z$/, "Z");
      const updated = n ? date : "2026-10-02T08:00:00Z";
      return `<entry><id>http://arxiv.org/abs/2609.${30000 + n}v${n ? 1 : 2}</id>
        <title>Result ${n} on $m_\\pi$</title><summary>Abstract
        ${n}</summary><published>${date}</published><updated>${updated}</updated>
        <author><name>A. Author</name></author><author><name>Feng-Kun Guo</name></author>
        ${n % 2 ? "<arxiv:journal_ref>Phys. Rev. D 1 (2026) 1</arxiv:journal_ref>" : ""}
        <arxiv:primary_category term="hep-ph"/><category term="hep-ph"/></entry>`;
    }).join("");
    return `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
<opensearch:totalResults>${total}</opensearch:totalResults>${entries}</feed>`;
  }

  const searchBox = (root: HTMLElement) =>
    root.querySelector<HTMLInputElement>(".arxiv-browser__search input")!;
  const clearButton = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>(".arxiv-browser__search-clear")!;
  const runSearch = (root: HTMLElement, text: string) => {
    const input = searchBox(root);
    input.focus();
    input.value = text;
    input.dispatchEvent(new win.Event("input"));
    key(input, "Enter");
  };
  /** A button of the bar of the date button and the search box */
  const barButton = (root: HTMLElement, label: string) =>
    [...clearButton(root).parentElement!.children].find(
      (element) => element.textContent === msg(label),
    ) as HTMLButtonElement;
  const apiRequests = (site: SimulatedArxiv) =>
    site.sent.filter((request) => request.url.includes("export.arxiv.org"));

  it("searches arXiv from the box next to the date button and lists the results with the row controls", async () => {
    const { root, site, view, settleSearch, launch } = await searching();
    const box = searchBox(root);
    expect(
      root.querySelector(".arxiv-browser__day-choice")!.nextElementSibling ===
        box.parentElement,
    ).toBe(true);
    expect(clearButton(root).hidden).toBe(true);

    site.html(searchUrl("all:pion AND all:mass", 0, 50), results(0, 3, 3));
    runSearch(root, "pion mass");
    expect(view.search.active).toBe(true);
    // The API scheduler's state, as for the days
    expect(statusText(root)).toBe(msg("arxiv-browser-status-sending"));
    expect(root.querySelector(".arxiv-browser__list")!.textContent).toBe(
      msg("arxiv-browser-search-running"),
    );
    await settleSearch();

    expect(apiRequests(site).map((request) => request.url)).toEqual([
      searchUrl("all:pion AND all:mass", 0, 50),
    ]);
    expect(rows(root).map((row) => row.dataset.entryId)).toEqual([
      "arxiv-2609.30000-search",
      "arxiv-2609.30001-search",
      "arxiv-2609.30002-search",
    ]);
    // Under the months of their submission (29 September and back)
    expect(headers(root)).toEqual(["# 2026-09-01"]);
    expect(
      root.querySelector(".arxiv-browser__list .arxiv-browser__day-title")!
        .textContent,
    ).toBe(formatMonth("2026-09"));
    expect(statusText(root)).toBe(
      msg("arxiv-browser-search-found", { total: 3, fetched: 3 }),
    );
    expect(clearButton(root).hidden).toBe(false);

    const row = rows(root)[0];
    for (const control of [
      ".zinspire-ref-entry__checkbox",
      ".zinspire-ref-entry__dot",
      ".zinspire-ref-entry__link",
      ".zinspire-ref-entry__bibtex",
      ".zinspire-ref-entry__pdf",
      ".arxiv-browser__abstract-toggle",
    ]) {
      expect(row.querySelector(control), control).not.toBeNull();
    }
    // Whether arXiv has an HTML version is not known: the button is there
    row
      .querySelector<HTMLButtonElement>(".arxiv-browser__html-button")!
      .click();
    expect(launch).toHaveBeenLastCalledWith(
      "https://arxiv.org/html/2609.30000",
    );
    // The detail pane gives the submission of the version shown (2) instead
    // of an announcement; the list groups by the first version's month
    const detail = root.querySelector(".arxiv-browser__detail")!.textContent;
    expect(detail).toContain(
      msg("arxiv-browser-detail-submitted", { date: formatDay("2026-10-02") }),
    );
    expect(detail).not.toContain(msg("arxiv-browser-detail-announced"));
    // The order and sections are the days': hidden, as is the day index
    const sortLabel = select(root, "sort").parentElement!;
    const sections = root.querySelector<HTMLElement>(
      ".arxiv-browser__sections",
    )!;
    expect(sortLabel.hidden).toBe(true);
    expect(sections.hidden).toBe(true);
    expect(
      root.querySelector<HTMLElement>(".arxiv-browser__days")!.hidden,
    ).toBe(true);
    expect(root.querySelector(".arxiv-browser__day-chip")).toBeNull();
    // The other controls of the bar stay: filters, page size, abstracts
    const bar = sections.parentElement!;
    expect(
      [...bar.children]
        .filter((control) => !(control as HTMLElement).hidden)
        .map((control) => control.className),
    ).toEqual([
      expect.stringContaining("quick"),
      expect.stringContaining("arxiv-browser__filter"),
      "arxiv-browser__label",
      "arxiv-browser__check",
    ]);
  });

  it("fetches the next page only when the reader turns past the results fetched", async () => {
    const { root, site, view, settleSearch } = await searching();
    const query = "au:guo";
    site.html(searchUrl(query, 0, 50), results(0, 50, 120));
    site.html(searchUrl(query, 50, 50), results(50, 50, 120));
    site.html(searchUrl(query, 100, 50), results(100, 20, 120));
    runSearch(root, query);
    await settleSearch();
    expect(apiRequests(site)).toHaveLength(1);
    expect(view.listPane.pages).toBe(1);
    expect(statusText(root)).toBe(
      msg("arxiv-browser-search-found", { total: 120, fetched: 50 }),
    );
    // Next is offered on the last page fetched
    const next = () =>
      [
        ...root.querySelectorAll<HTMLButtonElement>(
          ".arxiv-browser__pager button",
        ),
      ].at(-1)!;
    expect(next().disabled).toBe(false);

    next().click();
    expect(view.listPane.currentPage).toBe(0);
    await settleSearch();
    expect(apiRequests(site).map((request) => request.url)).toEqual([
      searchUrl(query, 0, 50),
      searchUrl(query, 50, 50),
    ]);
    // At arXiv's interval, and on the page turned to
    const [first, second] = apiRequests(site);
    expect(second.start - first.end!).toBeGreaterThanOrEqual(3000);
    expect(view.listPane.currentPage).toBe(1);
    expect(rows(root)[0].dataset.entryId).toBe("arxiv-2609.30050-search");

    // Going back and forth asks for nothing
    key(root.querySelector(".arxiv-browser__list")!, "p");
    key(root.querySelector(".arxiv-browser__list")!, "n");
    await settleSearch();
    expect(apiRequests(site)).toHaveLength(2);

    // The last 20
    key(root.querySelector(".arxiv-browser__list")!, "n");
    await settleSearch();
    expect(apiRequests(site)).toHaveLength(3);
    expect(view.listPane.currentPage).toBe(2);
    expect(view.listPane.entries).toHaveLength(120);
    expect(next().disabled).toBe(true);
    expect(root.querySelector(".arxiv-browser__next-page")).toBeNull();
    // No chips of the months: the list's month headers show where the
    // reader is, without counts (those would be of the pages fetched)
    expect(root.querySelector(".arxiv-browser__day-chip")).toBeNull();
    expect(
      root.querySelector<HTMLElement>(".arxiv-browser__days")!.hidden,
    ).toBe(true);
    expect(headers(root)).toEqual(["# 2026-06-01 (cont.)"]);
    expect(
      [
        ...root.querySelectorAll(
          ".arxiv-browser__list .arxiv-browser__day-title",
        ),
      ].map((title) => title.textContent),
    ).toEqual([formatMonth("2026-06")]);
    expect(
      root.querySelector(".arxiv-browser__list .arxiv-browser__day-count"),
    ).toBeNull();
  });

  it("after a change of page size, shows the page of the first paper fetched", async () => {
    const { root, site, view, settleSearch } = await searching();
    const query = "au:guo";
    site.html(searchUrl(query, 0, 50), results(0, 50, 300));
    site.html(searchUrl(query, 50, 100), results(50, 100, 300));
    runSearch(root, query);
    // Enter again while the first page is on its way: no second request
    key(searchBox(root), "Enter");
    await settleSearch();
    expect(apiRequests(site)).toHaveLength(1);
    const size = select(root, "size");
    size.value = "100";
    size.dispatchEvent(new win.Event("change"));
    view.listPane.goToPage(1);
    await settleSearch();
    expect(apiRequests(site).map((request) => request.url)).toEqual([
      searchUrl(query, 0, 50),
      searchUrl(query, 50, 100),
    ]);
    // Papers 51-100 are on the first page of 100: it is shown
    expect(view.listPane.currentPage).toBe(0);
    expect(rows(root)[50].dataset.entryId).toBe("arxiv-2609.30050-search");
  });

  it("goes back to the offer to make a subscription when there is none", async () => {
    const env = environment();
    const api = new ArxivScheduler({
      host: "export.arxiv.org",
      minIntervalMs: 3000,
      timeoutMs: 30000,
      transport: env.site.transport,
      clock: env.clock,
    });
    const view = env.open({
      apiScheduler: api,
      searchArxiv: (q: string, s: number, c: number, signal?: AbortSignal) =>
        searchArxiv(q, s, c, { scheduler: api, parseXml: xmlDocument, signal }),
    });
    env.site.html(searchUrl("all:pion", 0, 50), results(0, 3, 3));
    runSearch(env.root, "pion");
    for (let i = 0; i < 10 && view.search.running; i++) {
      await env.clock.advanceBy(1000);
    }
    await flushPromises();
    expect(rows(env.root).length).toBe(3);
    clearButton(env.root).click();
    expect(rows(env.root).length).toBe(0);
    expect(
      env.root.querySelector(".arxiv-browser__list")!.textContent,
    ).toContain(msg("arxiv-browser-empty"));
  });

  it("returns to the day listing where the reader was, and leaves the reading state alone", async () => {
    const { root, site, view, settleSearch, setRead } = await searching();
    // 72 papers of 25 September: page 2 of 2, its third paper focused
    view.listPane.goToPage(1);
    const list = root.querySelector(".arxiv-browser__list")!;
    key(list, "j");
    key(list, "j");
    key(list, "j");
    const focused = view.listPane.focused!.id;
    const day = view.loader.days[0];

    site.html(searchUrl("all:pion", 0, 50), results(0, 3, 3));
    runSearch(root, "pion");
    await settleSearch();
    expect(view.listPane.focused).toBeNull();
    key(list, "j");
    expect(view.listPane.focused!.id).toBe("arxiv-2609.30000-search");

    clearButton(root).click();
    expect(view.search.active).toBe(false);
    expect(searchBox(root).value).toBe("");
    expect(clearButton(root).hidden).toBe(true);
    expect(view.loader.days[0]).toBe(day);
    expect(view.listPane.currentPage).toBe(1);
    expect(view.listPane.focused!.id).toBe(focused);
    expect(view.detail.entry!.id).toBe(focused);
    expect(statusText(root)).toBe(
      msg("arxiv-browser-status-loaded", { days: 1, papers: 72 }),
    );
    // The order, sections and day chips are back
    expect(select(root, "sort").closest("[hidden]")).toBeNull();
    expect(
      root.querySelector<HTMLElement>(".arxiv-browser__sections")!.hidden,
    ).toBe(false);
    expect(
      root.querySelector<HTMLElement>(".arxiv-browser__days")!.hidden,
    ).toBe(false);
    expect(
      [...root.querySelectorAll(".arxiv-browser__day-chip")].map(
        (chip) => chip.textContent,
      ),
    ).toEqual([`${formatShortDay(day.date)} · 72`]);
    // Only the day listing's own requests went to arxiv.org
    expect(apiRequests(site)).toHaveLength(1);
    expect(setRead).not.toHaveBeenCalled();

    // Enter in the empty box leaves a search too
    runSearch(root, "pion");
    await settleSearch();
    expect(view.search.active).toBe(true);
    runSearch(root, "  ");
    expect(view.search.active).toBe(false);
    expect(view.listPane.focused!.id).toBe(focused);
  });

  it("keeps each search's results for the window's session; Reload fetches them again", async () => {
    const { root, site, view, settleSearch } = await searching();
    site.html(searchUrl("all:pion", 0, 50), results(0, 3, 3));
    site.html(searchUrl("all:kaon", 0, 50), results(10, 2, 2));
    runSearch(root, "pion");
    await settleSearch();
    runSearch(root, "kaon");
    await settleSearch();
    expect(rows(root)).toHaveLength(2);
    runSearch(root, "pion");
    // At once, without a request
    expect(rows(root)).toHaveLength(3);
    expect(apiRequests(site)).toHaveLength(2);

    barButton(root, "arxiv-browser-reload").click();
    // The results stay shown until the new ones arrive
    expect(rows(root)).toHaveLength(3);
    await settleSearch();
    expect(apiRequests(site)).toHaveLength(3);
    expect(rows(root)).toHaveLength(3);
  });

  it("can be cancelled, and a search arXiv refuses gives a notice", async () => {
    const { root, site, view, settleSearch, clock } = await searching();
    site.html(searchUrl("all:pion", 0, 50), results(0, 3, 3));
    runSearch(root, "pion");
    const cancel = barButton(root, "arxiv-browser-cancel");
    expect(cancel.hidden).toBe(false);
    cancel.click();
    await flushPromises();
    await clock.advanceBy(5000);
    expect(view.search.running).toBe(false);
    expect(rows(root).length).toBe(0);
    expect(statusText(root)).toBe("");
    expect(root.querySelector(".arxiv-browser__list")!.textContent).toBe(
      msg("arxiv-browser-status-cancelled"),
    );
    expect(cancel.hidden).toBe(true);

    // arXiv's answer to a query it cannot read
    site.page(searchUrl(arxivSearchQuery("ti:("), 0, 50), {
      status: 400,
      text: readArxivFixture("api-search-error-400.xml"),
    });
    runSearch(root, "ti:(");
    await settleSearch();
    const refused = msg("arxiv-browser-search-refused", {
      message: "Invalid query string: '('",
    });
    expect(
      [...root.querySelectorAll(".arxiv-browser__notice")].map(
        (notice) => notice.textContent,
      ),
    ).toEqual([refused]);
    expect(root.querySelector(".arxiv-browser__list")!.textContent).toBe(
      refused,
    );
  });

  it("filters, quick-filters, selects and adds the results as it does the days", async () => {
    const { root, site, view, settleSearch } = await searching();
    site.html(searchUrl("all:pion", 0, 50), results(0, 6, 6));
    runSearch(root, "pion");
    await settleSearch();
    // Papers with a journal reference: the odd ones
    root
      .querySelector<HTMLButtonElement>(".zinspire-quick-filter-btn")!
      .click();
    const published = [
      ...root.querySelectorAll<HTMLLabelElement>(
        ".zinspire-quick-filter-popup label",
      ),
    ]
      .find(
        (label) =>
          label.querySelector(".zinspire-quick-filter-item-label")!
            .textContent === msg("references-panel-quick-filter-published"),
      )!
      .querySelector("input")!;
    published.checked = true;
    published.dispatchEvent(new win.Event("change", { bubbles: true }));
    expect(view.listPane.entries.map((entry) => entry.listing.id)).toEqual([
      "2609.30001",
      "2609.30003",
      "2609.30005",
    ]);
    const filter = root.querySelector<HTMLInputElement>(
      ".arxiv-browser__filter input",
    )!;
    filter.value = '"Result 3"';
    filter.dispatchEvent(new win.Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(view.listPane.entries.map((entry) => entry.listing.id)).toEqual([
      "2609.30003",
    ]);

    rows(root)[0]
      .querySelector<HTMLInputElement>(".zinspire-ref-entry__checkbox")!
      .click();
    expect([...view.batch.getSelectedEntryIDs()]).toEqual([
      "arxiv-2609.30003-search",
    ]);
    // Leaving the results drops their selection
    clearButton(root).click();
    expect(view.batch.getSelectedEntryIDs().size).toBe(0);
  });

  it("keeps what was searched for in its own history, with the search histories' age limit", async () => {
    const { root, site, settleSearch } = await searching();
    prefs[`${config.addonRef}.arxivSearchHistory`] = JSON.stringify([
      { query: "au:witten", timestamp: Date.now() },
      { query: "cat:hep-lat", timestamp: Date.now() - 40 * 86400000 },
    ]);
    const input = searchBox(root);
    input.focus();
    input.value = "au:w";
    input.dispatchEvent(new win.Event("input"));
    const hint = root.querySelector<HTMLElement>(
      ".arxiv-browser__search .zinspire-filter-inline-hint",
    )!;
    expect(hint.textContent).toBe("itten");
    // Typed and left: not kept
    input.value = "gluon";
    input.dispatchEvent(new win.Event("blur"));
    const kept = () =>
      JSON.parse(prefs[`${config.addonRef}.arxivSearchHistory`] as string).map(
        (item: { query: string }) => item.query,
      );
    expect(kept()).toEqual(["au:witten"]);

    site.html(searchUrl("all:pion", 0, 50), results(0, 3, 3));
    runSearch(root, "pion");
    await settleSearch();
    expect(kept()).toEqual(["pion", "au:witten"]);
    // Not in the filter boxes' history
    expect(prefs[`${config.addonRef}.inspireFilterHistory`]).toBeUndefined();
  });
});
