// ─────────────────────────────────────────────────────────────────────────────
// The arXiv browser's "in library" marks, from the library index as the
// window wires it (itemsWithArxivIds, onLibraryIndexChange): the papers of the
// real hep-ph listing of 25 September 2026 (and of four catch-up days before
// it, a few papers each) looked up in a small library in SQLite
// (fakeLibrary.ts), whose changes reach the window through the notifier as
// they do in Zotero. getString() returns the message ID with its arguments.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import { ListingService } from "../src/modules/arxiv/listingService";
import { MemoryListingStore } from "../src/modules/arxiv/listingStore";
import {
  ArxivBrowserView,
  type ArxivBrowserViewOptions,
} from "../src/modules/arxiv/browser/ArxivBrowserView";
import {
  followItems,
  itemsWithArxivIds,
} from "../src/modules/arxiv/browser/browserLibrary";
import { EntryListRenderer } from "../src/modules/inspire/panel/EntryListRenderer";
import {
  findItemsByArxivs,
  onLibraryIndexChange,
  stopLibraryIndex,
} from "../src/modules/inspire/library/arxivIndex";
import { invalidateDarkModeCache } from "../src/modules/inspire/styles";
import { htmlDocument, readArxivFixture } from "./arxivFixtures";
import {
  CATCHUP_URL,
  catchupPageHtml,
  INDEX_URL,
  LIST_URL,
  recentIndexHtml,
  SimulatedArxiv,
  type SiteEntry,
} from "./arxivSite";
import { FakeLibrary, FEED_LIBRARY, GROUP_LIBRARY } from "./fakeLibrary";
import { flushPromises, VirtualClock } from "./virtualClock";

// These tests draw pages of up to 200 rows in jsdom and let minutes of arXiv
// requests pass on the simulated clock: a second or two each, more when the
// machine is busy
vi.setConfig({ testTimeout: 20000 });

const NOW = "2026-09-27T17:00:00Z";
const PREFIX = config.prefsPrefix;
/** The catch-up days before the newest listing (Friday 25 September) */
const OLDER_DAYS = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];
const NEXT_DAY: Record<string, string> = {
  "2026-09-21": "2026-09-22",
  "2026-09-22": "2026-09-23",
  "2026-09-23": "2026-09-24",
  "2026-09-24": "2026-09-25",
};
/** Three new submissions on day DD: 2609.9DD00, 2609.9DD01, 2609.9DD02 */
const olderPapers = (date: string): SiteEntry[] =>
  [0, 1, 2].map((i) => ({
    id: `2609.9${date.slice(8)}0${i}`,
    section: "new",
    primary: "hep-ph",
    title: `Paper ${i} of ${date}`,
  }));

let win: DOMWindow;
let lib: FakeLibrary;
let prefs: Record<string, unknown>;
let view: ArxivBrowserView | null = null;
let clock: VirtualClock;

beforeEach(() => {
  win = new JSDOM(
    "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
    { url: "https://zotero.test/", pretendToBeVisual: true },
  ).window;
  win.HTMLElement.prototype.scrollIntoView = () => undefined;
  win.document.documentElement.setAttribute(
    "zotero-platform-darkmode",
    "false",
  );
  invalidateDarkModeCache();
  lib = new FakeLibrary();
  prefs = {
    [`${PREFIX}.latex_render_mode`]: "unicode",
    [`${PREFIX}.max_authors`]: 3,
    [`${PREFIX}.arxiv_subscriptions`]: JSON.stringify([
      {
        id: "sub-1",
        name: "Daily",
        categories: ["hep-ph"],
        sections: { new: true, cross: true, replace: true },
      },
    ]),
  };
  vi.stubGlobal("Zotero", {
    ...lib.zoteroGlobals(),
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

afterEach(() => {
  view?.dispose();
  view = null;
  // Stops the window's timers and animation frames
  win.close();
  // The index is the plugin's one: the next test has another library
  stopLibraryIndex();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function msg(key: string, args?: Record<string, unknown>) {
  const id = `${config.addonRef}-${key}`;
  return args ? `${id} ${JSON.stringify(args)}` : id;
}

/**
 * The window's view with the days it opens with loaded (the newest one, 25
 * September, unless the settings say otherwise), marking papers as the window
 * does unless `options` say otherwise
 */
async function open(options: Partial<ArxivBrowserViewOptions> = {}) {
  clock = new VirtualClock(Date.parse(NOW));
  const site = new SimulatedArxiv(clock);
  site.html(
    LIST_URL("hep-ph"),
    readArxivFixture("list-hep-ph-new-2026-09-25.html"),
  );
  site.html(
    INDEX_URL,
    recentIndexHtml("math", ["2026-09-25", ...[...OLDER_DAYS].reverse()]),
  );
  for (const date of OLDER_DAYS) {
    site.html(
      CATCHUP_URL("hep-ph", date),
      catchupPageHtml("hep-ph", date, olderPapers(date), NEXT_DAY[date]),
    );
  }
  const scheduler = new ArxivScheduler({
    host: "arxiv.org",
    minIntervalMs: 15000,
    timeoutMs: 60000,
    transport: site.transport,
    clock,
  });
  const root = win.document.getElementById("root")!;
  view = new ArxivBrowserView(root, {
    listing: new ListingService({
      scheduler,
      store: new MemoryListingStore(),
      clock,
      parseHtml: htmlDocument,
    }),
    webScheduler: scheduler,
    clock,
    launch: vi.fn(),
    copy: vi.fn(async () => true),
    confirm: () => true,
    // As browserWindow.ts gives them
    inLibrary: itemsWithArxivIds,
    followLibrary: onLibraryIndexChange,
    followItems,
    ...options,
  });
  await settle();
  return root;
}

/** Let the loading run until it ends */
async function settle() {
  for (let i = 0; i < 400 && view?.loader.running; i++) {
    await clock.advanceBy(1000);
  }
  await flushPromises();
}

const rows = (root: HTMLElement) =>
  [
    ...root.querySelectorAll(".arxiv-browser__list .zinspire-ref-entry"),
  ] as HTMLElement[];
/** The arXiv ID of a row ("arxiv-<id>-<day>") */
const idOf = (row: HTMLElement) => row.dataset.entryId!.split("-")[1];
const dotOf = (root: HTMLElement, id: string) =>
  rows(root)
    .find((row) => idOf(row) === id)!
    .querySelector<HTMLElement>(".zinspire-ref-entry__dot")!;
/** The shown marks by arXiv ID; papers not in the library show none */
function marks(root: HTMLElement): Record<string, string> {
  const shown: Record<string, string> = {};
  for (const row of rows(root)) {
    const dot = row.querySelector<HTMLElement>(".zinspire-ref-entry__dot")!;
    if (dot.dataset.state !== "missing") {
      shown[idOf(row)] = dot.textContent ?? "";
    }
  }
  return shown;
}
const pdfOf = (root: HTMLElement, id: string) =>
  rows(root)
    .find((row) => idOf(row) === id)!
    .querySelector<HTMLButtonElement>(".zinspire-ref-entry__pdf")!;
/** The PDF button's state of each paper listed, by arXiv ID */
const pdfStates = (root: HTMLElement): Record<string, string | undefined> =>
  Object.fromEntries(
    rows(root).map((row) => [idOf(row), pdfOf(root, idOf(row)).dataset.state]),
  );
const states = (root: HTMLElement) =>
  new Set(
    rows(root).map(
      (row) =>
        row.querySelector<HTMLElement>(".zinspire-ref-entry__dot")!.dataset
          .state,
    ),
  );

describe("arXiv browser: in the library", () => {
  it("marks the papers with an item, whatever field holds the arXiv ID, leaving out the trash and feeds", async () => {
    lib.put({
      itemType: "preprint",
      fields: { archiveID: "arXiv:2609.28538" },
    });
    lib.put({ fields: { url: "https://arxiv.org/abs/2609.28544v2" } });
    lib.put({
      libraryID: GROUP_LIBRARY,
      fields: { extra: "arXiv: 2609.28555" },
    });
    lib.put({ fields: { archiveID: "arXiv:2609.28616" }, deleted: true });
    lib.put({
      libraryID: FEED_LIBRARY,
      fields: { url: "https://arxiv.org/abs/2609.28619" },
    });
    const root = await open();
    await vi.waitFor(() =>
      expect(marks(root)).toEqual({
        "2609.28538": "●",
        "2609.28544": "●",
        "2609.28555": "●",
      }),
    );
    expect(dotOf(root, "2609.28538").getAttribute("title")).toBe(
      msg("references-panel-dot-local"),
    );
  });

  it("counts the items of a paper saved twice and lists them, the one with an INSPIRE record first", async () => {
    lib.put({
      fields: {
        title: "Saved from arXiv",
        url: "https://arxiv.org/abs/2609.28544",
      },
    });
    const fromInspire = lib.put({
      libraryID: GROUP_LIBRARY,
      fields: {
        title: "Imported from INSPIRE",
        archiveID: "arXiv:2609.28544",
        archive: "INSPIRE",
        archiveLocation: "3061234",
      },
    });
    const showInLibrary = vi.fn();
    const root = await open({ showInLibrary });
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28544": "②" }));
    const dot = dotOf(root, "2609.28544");
    expect(dot.getAttribute("title")!.split("\n")).toEqual([
      msg("references-panel-dot-local-several-arxiv", { count: 2 }),
      "• Imported from INSPIRE — Group 2",
      "• Saved from arXiv — My Library",
    ]);
    dot.click();
    expect(showInLibrary).toHaveBeenCalledWith(fromInspire.id);
  });

  it("follows the library: a paper saved, edited, trashed, restored and deleted while listed", async () => {
    const root = await open();
    const list = root.querySelector(".arxiv-browser__list")!;
    const detail = root.querySelector(".arxiv-browser__detail")!;
    list.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "j", bubbles: true }),
    );
    expect(detail.textContent).toContain("arXiv:2609.28538");
    expect(marks(root)).toEqual({});

    const item = await lib.add({ fields: { archiveID: "arXiv:2609.28538" } });
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28538": "●" }));
    // The paper in the detail pane too
    expect(detail.textContent).toContain(
      msg("arxiv-browser-detail-in-library"),
    );
    await lib.edit(item, { archiveID: "arXiv:2609.28555" });
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28555": "●" }));
    expect(detail.textContent).not.toContain(
      msg("arxiv-browser-detail-in-library"),
    );
    await lib.trash(item);
    await vi.waitFor(() => expect(marks(root)).toEqual({}));
    await lib.restore(item);
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28555": "●" }));
    await lib.erase(item);
    await vi.waitFor(() => expect(marks(root)).toEqual({}));
  });

  it("marks the papers of each day as it arrives, and of a new choice of days", async () => {
    prefs[`${PREFIX}.arxiv_browser_page_size`] = 500;
    lib.put({ fields: { archiveID: "arXiv:2609.28538" } });
    lib.put({ fields: { url: "https://arxiv.org/abs/2609.92200" } });
    const inLibrary = vi.fn(itemsWithArxivIds);
    const root = await open({ inLibrary });
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28538": "●" }));

    // The last five announcement days, loaded one after the other
    inLibrary.mockClear();
    root
      .querySelector<HTMLButtonElement>(".arxiv-browser__days-button")!
      .click();
    [
      ...root.querySelectorAll<HTMLButtonElement>(
        ".arxiv-browser__daypicker button",
      ),
    ]
      .find(
        (button) => button.textContent === msg("arxiv-browser-days-recent"),
      )!
      .click();
    await settle();
    expect(view!.loader.days.map((day) => day.date)).toEqual([
      "2026-09-25",
      ...[...OLDER_DAYS].reverse(),
    ]);
    await vi.waitFor(() =>
      expect(marks(root)).toEqual({
        "2609.28538": "●",
        "2609.92200": "●",
      }),
    );
    // Every paper listed was looked up
    const asked = new Set(inLibrary.mock.calls.flatMap(([ids]) => ids));
    expect(rows(root).every((row) => asked.has(idOf(row)))).toBe(true);
  });

  it("after a change, looks all the days listed up at once and redraws only the rows whose mark changed", async () => {
    prefs[`${PREFIX}.arxiv_browser_page_size`] = 500;
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "recent";
    const inLibrary = vi.fn(itemsWithArxivIds);
    const root = await open({ inLibrary });
    expect(view!.loader.days).toHaveLength(5);
    await Promise.all(inLibrary.mock.results.map((result) => result.value));
    inLibrary.mockClear();
    const redrawn = vi.spyOn(EntryListRenderer.prototype, "updateLocalState");

    await lib.add({ fields: { archiveID: "arXiv:2609.92300" } });
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.92300": "●" }));
    expect(inLibrary).toHaveBeenCalledTimes(1);
    expect(inLibrary.mock.calls[0][0]).toHaveLength(rows(root).length);
    expect(redrawn).toHaveBeenCalledTimes(1);
  });

  it("shows ? when the library cannot be read, and looks again on a click", async () => {
    lib.put({ fields: { archiveID: "arXiv:2609.28538" } });
    lib.queryError = new Error("database is locked");
    const root = await open();
    await vi.waitFor(() => expect(states(root)).toEqual(new Set(["unknown"])));
    const dot = dotOf(root, "2609.28544");
    expect(dot.textContent).toBe("?");
    expect(dot.getAttribute("title")).toBe(msg("references-panel-dot-unknown"));

    lib.queryError = undefined;
    dot.click();
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28538": "●" }));
  });

  it("looks again by itself once another lookup could read the library", async () => {
    lib.put({ fields: { archiveID: "arXiv:2609.28538" } });
    lib.queryError = new Error("database is locked");
    const root = await open();
    await vi.waitFor(() => expect(states(root)).toEqual(new Set(["unknown"])));

    lib.queryError = undefined;
    // The References panel's lookup, say
    await findItemsByArxivs(["2609.99999"]);
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28538": "●" }));
  });

  it("shows ? when the library can no longer be read after a change", async () => {
    lib.put({ fields: { archiveID: "arXiv:2609.28538" } });
    const root = await open();
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28538": "●" }));
    lib.queryError = new Error("database is locked");
    await lib.add({ fields: { archiveID: "arXiv:2609.28544" } });
    await vi.waitFor(() => expect(states(root)).toEqual(new Set(["unknown"])));
  });

  it("selects the item from the paper's card", async () => {
    const item = lib.put({ fields: { archiveID: "arXiv:2609.28538" } });
    const showInLibrary = vi.fn();
    const root = await open({ showInLibrary });
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28538": "●" }));
    rows(root)[0]
      .querySelector<HTMLElement>(".zinspire-ref-entry__title-link")!
      .dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
    const card = () =>
      root.querySelector(".zinspire-preview-card") as HTMLElement | null;
    await vi.waitFor(() => expect(card()?.style.display).toBe("block"));
    const status = card()!.querySelector<HTMLButtonElement>(
      ".zinspire-preview-card__status",
    )!;
    expect(status.disabled).toBe(false);
    status.click();
    expect(showInLibrary).toHaveBeenCalledWith(item.id);
  });

  it("stops following the library when the window closes", async () => {
    const inLibrary = vi.fn(itemsWithArxivIds);
    const stopped = vi.fn();
    await open({
      inLibrary,
      followLibrary: (listener) => {
        const stop = onLibraryIndexChange(listener);
        return () => {
          stopped();
          stop();
        };
      },
    });
    await vi.waitFor(() => expect(inLibrary).toHaveBeenCalledTimes(1));
    view!.dispose();
    view = null;
    expect(stopped).toHaveBeenCalledTimes(1);
    await lib.add({ fields: { archiveID: "arXiv:2609.28538" } });
    await flushPromises();
    expect(inLibrary).toHaveBeenCalledTimes(1);
  });

  it("draws the PDF button green only for a PDF in the library and opens it in Zotero; other PDFs open on arXiv", async () => {
    const withPdf = lib.put({ fields: { archiveID: "arXiv:2609.28538" } });
    const pdf = lib.put({ itemType: "attachment", parentItemID: withPdf.id });
    lib.put({ fields: { archiveID: "arXiv:2609.28544" } });
    const openReader = vi.fn(async () => ({ focus: vi.fn() }));
    (globalThis as any).Zotero.Reader = { open: openReader };
    const launch = vi.fn();
    const root = await open({ launch });
    await vi.waitFor(() =>
      expect(marks(root)).toEqual({ "2609.28538": "●", "2609.28544": "●" }),
    );
    expect(pdfStates(root)).toMatchObject({
      "2609.28538": "has-pdf",
      "2609.28544": "online",
      "2609.28555": "online",
    });

    pdfOf(root, "2609.28538").click();
    expect(openReader).toHaveBeenLastCalledWith(pdf.id, undefined, {
      allowDuplicate: false,
    });
    pdfOf(root, "2609.28555").click();
    expect(launch).toHaveBeenLastCalledWith("https://arxiv.org/pdf/2609.28555");
    expect(openReader).toHaveBeenCalledTimes(1);
    // The detail pane's PDF button too
    rows(root)[0].click();
    [
      ...root.querySelectorAll<HTMLButtonElement>(
        ".arxiv-browser__detail button",
      ),
    ]
      .find(
        (button) => button.textContent === msg("arxiv-browser-open-pdf-button"),
      )!
      .click();
    await vi.waitFor(() => expect(openReader).toHaveBeenCalledTimes(2));
  });

  it("draws the PDF button green when another of the paper's items has the PDF, and opens that PDF", async () => {
    // The item a click on the mark selects comes first (it has an INSPIRE
    // record); only the other one has a PDF
    lib.put({
      fields: {
        archiveID: "arXiv:2609.28538",
        archive: "INSPIRE",
        archiveLocation: "3061234",
      },
    });
    const second = lib.put({
      fields: { url: "https://arxiv.org/abs/2609.28538" },
    });
    const pdf = lib.put({ itemType: "attachment", parentItemID: second.id });
    const openReader = vi.fn(async () => ({ focus: vi.fn() }));
    (globalThis as any).Zotero.Reader = { open: openReader };
    const root = await open();
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28538": "②" }));
    expect(pdfStates(root)["2609.28538"]).toBe("has-pdf");
    pdfOf(root, "2609.28538").click();
    expect(openReader).toHaveBeenLastCalledWith(pdf.id, undefined, {
      allowDuplicate: false,
    });
  });

  it("turns the PDF button green when a PDF is attached while listed, and grey when it goes to the trash", async () => {
    const paper = lib.put({ fields: { archiveID: "arXiv:2609.28538" } });
    const root = await open();
    await vi.waitFor(() => expect(marks(root)).toEqual({ "2609.28538": "●" }));
    expect(pdfStates(root)["2609.28538"]).toBe("online");
    const pdf = await lib.add({
      itemType: "attachment",
      parentItemID: paper.id,
    });
    await vi.waitFor(() =>
      expect(pdfStates(root)["2609.28538"]).toBe("has-pdf"),
    );
    await lib.trash(pdf);
    await vi.waitFor(() =>
      expect(pdfStates(root)["2609.28538"]).toBe("online"),
    );
  });

  it("keeps the marks of a lookup made after a change when an older one answers later", async () => {
    const answers: Array<
      (found: ReadonlyMap<string, readonly number[]> | null) => void
    > = [];
    let changed!: () => void;
    const root = await open({
      inLibrary: () => new Promise((resolve) => answers.push(resolve)),
      followLibrary: (listener) => {
        changed = listener;
        return () => undefined;
      },
    });
    expect(answers).toHaveLength(1);
    // The library changes while the day is looked up
    changed();
    expect(answers).toHaveLength(2);
    answers[1](new Map([["2609.28544", [5]]]));
    await flushPromises();
    expect(marks(root)).toEqual({ "2609.28544": "●" });
    // The lookup made before the change answers last
    answers[0](new Map());
    await flushPromises();
    expect(marks(root)).toEqual({ "2609.28544": "●" });
  });
});
