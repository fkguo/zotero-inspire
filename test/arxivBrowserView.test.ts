import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import { ListingService } from "../src/modules/arxiv/listingService";
import { MemoryListingStore } from "../src/modules/arxiv/listingStore";
import { ArxivBrowserView } from "../src/modules/arxiv/browser/ArxivBrowserView";
import { servedListingDays } from "../src/modules/arxiv/browser/DayPicker";
import type { ArxivSubscription } from "../src/modules/arxiv/browser/subscriptions";
import { formatShortDay } from "../src/modules/arxiv/browser/browserText";
import { invalidateDarkModeCache } from "../src/modules/inspire/styles";
import { htmlDocument, readArxivFixture } from "./arxivFixtures";
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
  const root = win.document.getElementById("root")!;
  const open = (options: Record<string, unknown> = {}) => {
    view = new ArxivBrowserView(root, {
      listing: service,
      webScheduler: scheduler,
      clock,
      launch,
      copy,
      confirm: () => true,
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
    root,
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
    // The index, then /new: after both, the newest day is shown and the next
    // request waits for its turn
    await env.clock.advanceBy(17000);
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
      ".arxiv-browser__filter",
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
      ".arxiv-browser__filter",
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
    row.querySelector<HTMLButtonElement>(".zinspire-ref-entry__pdf")!.click();
    expect(launch).toHaveBeenLastCalledWith("https://arxiv.org/pdf/2609.28538");
    key(root.querySelector(".arxiv-browser__list")!, "Enter");
    expect(launch).toHaveBeenLastCalledWith("https://arxiv.org/abs/2609.28538");
  });

  it("copies arXiv's BibTeX, asking arxiv.org once and in turn", async () => {
    const { root, site, clock, copy } = await loaded();
    const bibtex =
      "@misc{pathak2026,\n  title={A paper},\n  eprint={2609.28538}\n}";
    site.html("https://arxiv.org/bibtex/2609.28538", `\n${bibtex}\n`);
    const row = rows(root)[0];
    row
      .querySelector<HTMLButtonElement>(".zinspire-ref-entry__bibtex")!
      .click();
    await clock.advanceBy(20000);
    expect(copy).toHaveBeenLastCalledWith(bibtex);
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
    ).toContain(msg("arxiv-browser-bibtex-copied", { id: "2609.28538" }));
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
    expect(env.copy).toHaveBeenCalledWith("@misc{x,\n}");
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
        new Map(ids.filter((id) => id === "2609.28544").map((id) => [id, 77])),
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

  it("shows the unread-days preset as not yet available", async () => {
    const env = setupDays();
    env.open();
    await env.settle();
    dayButton(env.root).click();
    expect(
      pickerButton(env.root, msg("arxiv-browser-days-unread")).disabled,
    ).toBe(true);
    expect(picker(env.root).textContent).toContain(
      msg("arxiv-browser-days-unread-note"),
    );
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
