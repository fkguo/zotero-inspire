import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import { ArxivScheduler } from "../src/modules/arxiv/arxivFetch";
import { ListingService } from "../src/modules/arxiv/listingService";
import { MemoryListingStore } from "../src/modules/arxiv/listingStore";
import { readFileSync } from "node:fs";
// Node's own SQLite, where this Node has it: Zotero's tables for the query
const sqlite = await import("node:sqlite").catch(() => null);
import { join } from "node:path";
import {
  ArxivBrowserView,
  openingSetting,
  type ArxivBrowserViewOptions,
} from "../src/modules/arxiv/browser/ArxivBrowserView";
import { OPENING_SELECTIONS } from "../src/modules/arxiv/browser/ListingLoader";
import { countAuthorPapers } from "../src/modules/arxiv/browser/authorCount";
import { initArxivBrowserPrefs } from "../src/modules/arxiv/browser/browserPrefs";
import {
  notePaint,
  noteFormulas,
  paintTimes,
} from "../src/modules/arxiv/browser/paintTimes";
import { HoverPreviewRenderer } from "../src/modules/inspire/panel/HoverPreviewRenderer";
import { invalidateDarkModeCache } from "../src/modules/inspire/styles";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { htmlDocument, readArxivFixture } from "./arxivFixtures";
import { LIST_URL, newPageHtml, SimulatedArxiv } from "./arxivSite";
import { flushPromises, VirtualClock } from "./virtualClock";

// The arXiv browser's detail pane, its cards (the author's local card and the
// paper's card with per-row options), the settings list of subscriptions and
// the record of how long pages take to show. getString() returns the message
// ID with its arguments.

const inspire = vi.hoisted(() => ({ inspireFetch: vi.fn() }));
vi.mock("../src/modules/inspire/rateLimiter", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/inspire/rateLimiter")
  >()),
  ...inspire,
}));

// These tests draw pages of up to 200 rows in jsdom and let minutes of arXiv
// requests pass on the simulated clock: a second or two each, more when the
// machine is busy
vi.setConfig({ testTimeout: 20000 });

const NOW = "2026-09-27T17:00:00Z";
const PREFIX = config.prefsPrefix;

let win: DOMWindow;
let prefs: Record<string, unknown>;
let query: ReturnType<typeof vi.fn>;
let view: ArxivBrowserView | null = null;

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
  prefs = {
    [`${PREFIX}.latex_render_mode`]: "unicode",
    [`${PREFIX}.max_authors`]: 3,
  };
  query = vi.fn(async () => 7);
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    launchURL: vi.fn(),
    getMainWindow: () => win,
    // Items the tests mark as in the library have no PDF
    Items: { get: () => false, getLibraryAndKeyFromID: () => false },
    Libraries: { userLibraryID: 1 },
    DB: { valueQueryAsync: query },
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
  inspire.inspireFetch.mockReset();
});

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

/** The window's view with the real hep-ph listing of 25 September loaded */
async function loaded(
  options: Partial<ArxivBrowserViewOptions> = {},
  /** More categories, and their pages */
  more: { categories: string[]; serve(site: SimulatedArxiv): void } = {
    categories: [],
    serve: () => undefined,
  },
) {
  prefs[`${PREFIX}.arxiv_subscriptions`] = JSON.stringify([
    {
      id: "sub-1",
      name: "Daily",
      categories: ["hep-ph", ...more.categories],
      sections: { new: true, cross: true, replace: true },
    },
  ]);
  const clock = new VirtualClock(Date.parse(NOW));
  const site = new SimulatedArxiv(clock);
  site.html(
    LIST_URL("hep-ph"),
    readArxivFixture("list-hep-ph-new-2026-09-25.html"),
  );
  more.serve(site);
  const scheduler = new ArxivScheduler({
    host: "arxiv.org",
    minIntervalMs: 15000,
    timeoutMs: 60000,
    transport: site.transport,
    clock,
  });
  const launch = vi.fn();
  const copy = vi.fn(async () => true);
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
    launch,
    copy,
    confirm: () => true,
    // INSPIRE has no record: the BibTeX is arXiv's (no request to INSPIRE)
    inspireBibtex: async () => ({ status: "notFound" as const }),
    ...options,
  });
  for (let i = 0; i < 100 && view.loader.running; i++) {
    await clock.advanceBy(1000);
  }
  await flushPromises();
  return { root, view, launch, copy, clock, site };
}

const rows = (root: HTMLElement) =>
  [
    ...root.querySelectorAll(".arxiv-browser__list .zinspire-ref-entry"),
  ] as HTMLElement[];
const key = (target: EventTarget, name: string) =>
  target.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: name, bubbles: true }),
  );

describe("detail pane", () => {
  it("shows the focused paper in full and follows the focus", async () => {
    const { root, view } = await loaded();
    const detail = root.querySelector(".arxiv-browser__detail")!;
    expect(detail.textContent).toBe(msg("arxiv-browser-detail-empty"));

    key(root.querySelector(".arxiv-browser__list")!, "j");
    const first = view.listPane.focused!.listing;
    expect(first.id).toBe("2609.28538");
    const text = () => detail.textContent!;
    expect(
      detail.querySelector(".arxiv-browser__detail-title")!.textContent,
    ).toBeTruthy();
    // Every author, not only the first three of the row
    expect(detail.querySelectorAll(".arxiv-browser__author")).toHaveLength(
      first.authors.length,
    );
    expect(text()).toContain(`arXiv:${first.id}`);
    expect(text()).toContain(
      msg("arxiv-browser-detail-version", { version: 1 }),
    );
    expect(text()).toContain(
      msg("arxiv-browser-detail-section-new", { category: "hep-ph" }),
    );
    const primary = detail.querySelector(
      ".arxiv-browser__category--primary",
    ) as HTMLElement;
    expect(primary.textContent).toBe(first.primaryCategory);
    expect(primary.title).toBe("High Energy Physics - Phenomenology");
    expect(
      detail.querySelector(".arxiv-browser__detail-abstract")!.textContent,
    ).toBeTruthy();

    key(root.querySelector(".arxiv-browser__list")!, "j");
    expect(text()).toContain(`arXiv:${view.listPane.focused!.listing.id}`);
  });

  it("shows comments and journal reference where the listing has them", async () => {
    const { root, view } = await loaded();
    const withRef = view.listPane.entries.find(
      (entry) => entry.listing.journalRef && entry.listing.comments,
    )!;
    rows(root)
      .find((row) => row.dataset.entryId === withRef.id)!
      .querySelector<HTMLElement>(".zinspire-ref-entry__content")!
      .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    const text = root.querySelector(".arxiv-browser__detail")!.textContent!;
    expect(text).toContain(msg("arxiv-browser-detail-comments"));
    expect(text).toContain(withRef.listing.comments!);
    expect(text).toContain(msg("arxiv-browser-detail-journal-ref"));
    expect(text).toContain(withRef.listing.journalRef!);
  });

  it("says when the listing names only the first 100 authors", async () => {
    const { root, view } = await loaded();
    const entry = view.listPane.entries[0];
    const many = {
      ...entry,
      listing: {
        ...entry.listing,
        authors: Array.from({ length: 100 }, (_, i) => ({
          display: `A. Author${i}`,
          family: `Author${i}`,
          given: "A.",
        })),
      },
    };
    const detail = root.querySelector(".arxiv-browser__detail")!;
    view.detail.show(many);
    expect(detail.querySelectorAll(".arxiv-browser__author")).toHaveLength(100);
    expect(detail.textContent).toContain(
      msg("arxiv-browser-detail-authors-limit"),
    );
    view.detail.show(entry);
    expect(detail.textContent).not.toContain(
      msg("arxiv-browser-detail-authors-limit"),
    );
  });

  it("keeps the focused paper's entry when its day is fetched again, and shows a mark that comes later", async () => {
    const lookups: Array<
      (found: ReadonlyMap<string, readonly number[]> | null) => void
    > = [];
    const { root, view, clock } = await loaded(
      { inLibrary: () => new Promise((resolve) => lookups.push(resolve)) },
      {
        categories: ["hep-lat"],
        // hep-lat's /new fails the first time: the day is incomplete
        serve: (site) =>
          site.page(LIST_URL("hep-lat"), (attempt) =>
            attempt === 1
              ? { status: 500, text: "error" }
              : {
                  text: newPageHtml("hep-lat", "2026-09-25", [
                    { id: "2609.90001", section: "new", primary: "hep-lat" },
                  ]),
                },
          ),
      },
    );
    const detail = root.querySelector(".arxiv-browser__detail")!;
    key(root.querySelector(".arxiv-browser__list")!, "j");
    const before = view.listPane.focused!;
    const listingBefore = before.listing;
    lookups.shift()!(new Map());
    await flushPromises();

    root.querySelector<HTMLButtonElement>(".arxiv-browser__retry")!.click();
    for (let i = 0; i < 60 && view.loader.running; i++) {
      await clock.advanceBy(1000);
    }
    await flushPromises();
    // The same entry, with the listing fetched again
    const after = view.listPane.focused!;
    expect(after).toBe(before);
    expect(after.listing).not.toBe(listingBefore);
    expect(view.detail.entry).toBe(after);
    // The library answers for the day fetched again
    lookups.shift()!(new Map([[after.listing.id, [42]]]));
    await flushPromises();
    expect(detail.textContent).toContain(
      msg("arxiv-browser-detail-in-library"),
    );
  });

  it("shows an author's local card from the detail pane too", async () => {
    const { root } = await loaded();
    key(root.querySelector(".arxiv-browser__list")!, "j");
    root
      .querySelector<HTMLElement>(
        ".arxiv-browser__detail .arxiv-browser__author",
      )!
      .dispatchEvent(new win.MouseEvent("mouseenter"));
    const card = () =>
      root.querySelector(".zinspire-author-preview-card") as HTMLElement | null;
    await vi.waitFor(() =>
      expect(card()?.textContent).toContain(
        msg("references-panel-author-library-count", { count: 7 }),
      ),
    );
    expect(inspire.inspireFetch).not.toHaveBeenCalled();
  });

  it("offers the read-only actions", async () => {
    const { root, launch, copy } = await loaded();
    key(root.querySelector(".arxiv-browser__list")!, "j");
    const buttons = Object.fromEntries(
      [
        ...root.querySelectorAll<HTMLButtonElement>(
          ".arxiv-browser__detail-actions button",
        ),
      ].map((b) => [b.textContent, b]),
    );
    buttons[msg("arxiv-browser-copy-id")].click();
    await flushPromises();
    expect(copy).toHaveBeenLastCalledWith("2609.28538");
    buttons[msg("arxiv-browser-open-abstract-page")].click();
    expect(launch).toHaveBeenLastCalledWith("https://arxiv.org/abs/2609.28538");
    buttons[msg("arxiv-browser-open-pdf-button")].click();
    expect(launch).toHaveBeenLastCalledWith("https://arxiv.org/pdf/2609.28538");
    buttons[msg("arxiv-browser-open-html-button")].click();
    expect(launch).toHaveBeenLastCalledWith(
      "https://arxiv.org/html/2609.28538",
    );
    expect(buttons[msg("arxiv-browser-copy-bibtex")]).toBeDefined();
  });

  it("says when the paper is in the library, also when that is known after it was chosen", async () => {
    let answer!: (found: ReadonlyMap<string, readonly number[]> | null) => void;
    const showInLibrary = vi.fn();
    const { root } = await loaded({
      inLibrary: () => new Promise((resolve) => (answer = resolve)),
      showInLibrary,
    });
    const detail = root.querySelector(".arxiv-browser__detail")!;
    key(root.querySelector(".arxiv-browser__list")!, "j");
    expect(detail.textContent).toContain("arXiv:2609.28538");
    expect(detail.textContent).not.toContain(
      msg("arxiv-browser-detail-in-library"),
    );
    answer(new Map([["2609.28538", [42]]]));
    await flushPromises();
    expect(detail.textContent).toContain(
      msg("arxiv-browser-detail-in-library"),
    );
    [...detail.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === msg("arxiv-browser-show-in-library"))!
      .click();
    expect(showInLibrary).toHaveBeenCalledWith(42);
    // The next paper is not in the library
    key(root.querySelector(".arxiv-browser__list")!, "j");
    expect(detail.textContent).not.toContain(
      msg("arxiv-browser-detail-in-library"),
    );
  });
});

describe("cards", () => {
  it("shows an author's local card with the papers in the library, asking INSPIRE nothing", async () => {
    const { root } = await loaded();
    const author = rows(root)[0].querySelector<HTMLElement>(
      ".zinspire-ref-entry__author-link",
    )!;
    author.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
    const card = () =>
      root.querySelector(".zinspire-author-preview-card") as HTMLElement | null;
    await vi.waitFor(() => expect(card()?.style.display).toBe("block"));
    await vi.waitFor(() =>
      expect(card()!.textContent).toContain(
        msg("references-panel-author-library-count", { count: 7 }),
      ),
    );
    // Surname and first letter in the personal library, not in the trash
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("deletedItems");
    expect(params[0]).toBe(1);
    expect(params[2]).toMatch(/^.%$/);
    // Asked once per name while the window is open
    author.dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true }));
    await vi.waitFor(() => expect(card()!.style.display).toBe("none"));
    author.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
    await vi.waitFor(() =>
      expect(card()!.textContent).toContain(
        msg("references-panel-author-library-count", { count: 7 }),
      ),
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(inspire.inspireFetch).not.toHaveBeenCalled();
  });

  it.skipIf(!sqlite)(
    "counts an author's papers in the personal library, with names in two fields or one",
    async () => {
      // Zotero's tables, as its database defines them (the columns used)
      const db = new sqlite!.DatabaseSync(":memory:");
      db.exec(`
        CREATE TABLE items (itemID INTEGER PRIMARY KEY, libraryID INT NOT NULL);
        CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT,
          lastName TEXT, fieldMode INT);
        CREATE TABLE itemCreators (itemID INT NOT NULL, creatorID INT NOT NULL,
          creatorTypeID INT NOT NULL DEFAULT 1, orderIndex INT NOT NULL DEFAULT 0);
        CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
      `);
      const creators: Array<[number, string, string, number]> = [
        [1, "Krishna Kingkar", "Pathak", 0],
        [2, "K.", "pathak", 0],
        [3, "Anil", "Pathak", 0],
        [4, "", "Krishna Kingkar Pathak", 1],
        [5, "", "K. K. Pathak", 1],
        [6, "", "Kishore Pathakji", 1],
        [7, "", "CMS Collaboration", 1],
        [8, "Jia-Jun", "Wu", 0],
      ];
      for (const row of creators) {
        db.prepare("INSERT INTO creators VALUES (?, ?, ?, ?)").run(...row);
      }
      // item, library, creator
      const links: Array<[number, number, number]> = [
        [10, 1, 1],
        [11, 1, 2],
        [11, 1, 8], // a second author of the same paper
        [12, 1, 3], // another Pathak
        [13, 1, 4],
        [14, 1, 5],
        [15, 1, 6], // not the surname
        [16, 1, 1], // in the trash
        [17, 2, 1], // in a group library
        [18, 1, 7],
      ];
      for (const [item, library, creator] of links) {
        db.prepare("INSERT OR IGNORE INTO items VALUES (?, ?)").run(
          item,
          library,
        );
        db.prepare("INSERT INTO itemCreators VALUES (?, ?, 1, ?)").run(
          item,
          creator,
          creator,
        );
      }
      db.prepare("INSERT INTO deletedItems VALUES (16)").run();
      query.mockImplementation(async (sql: string, params: unknown[]) => {
        const row = db.prepare(sql).get(...(params as never[])) as Record<
          string,
          number
        >;
        return Object.values(row)[0];
      });

      // 10, 11 (two fields), 13, 14 (one field)
      expect(await countAuthorPapers("Pathak, Krishna Kingkar", 1)).toBe(4);
      expect(await countAuthorPapers("Pathak, Anil", 1)).toBe(1);
      expect(await countAuthorPapers("Pathak, Krishna Kingkar", 2)).toBe(1);
      // A name kept in one field in the listing too
      expect(await countAuthorPapers("CMS Collaboration", 1)).toBe(1);
      expect(await countAuthorPapers("Nobody, N.", 1)).toBe(0);
    },
  );

  it("shows the paper's card on the title only while the row hides the abstract", async () => {
    const { root } = await loaded();
    const title = () =>
      rows(root)[0].querySelector<HTMLElement>(
        ".zinspire-ref-entry__title-link",
      )!;
    const card = () =>
      root.querySelector(".zinspire-preview-card") as HTMLElement | null;
    // Abstracts are folded in the list by default
    title().dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
    await vi.waitFor(() => expect(card()?.style.display).toBe("block"));
    const labels = [...card()!.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    // arXiv's BibTeX; no TeX key and no adding in the read-only browser
    expect(labels).toContain(msg("references-panel-copy-bibtex"));
    expect(labels).not.toContain("T");
    expect(labels).not.toContain(msg("references-panel-button-add"));
    expect(inspire.inspireFetch).not.toHaveBeenCalled();

    title().dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true }));
    await vi.waitFor(() => expect(card()!.style.display).toBe("none"));
    // Shown again, then the row's abstract opened with Space: the card goes
    title().dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
    await vi.waitFor(() => expect(card()!.style.display).toBe("block"));
    key(root.querySelector(".arxiv-browser__list")!, "j");
    key(root.querySelector(".arxiv-browser__list")!, " ");
    await vi.waitFor(() => expect(card()!.style.display).toBe("none"));
    title().dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(card()!.style.display).toBe("none");
  });

  it("copies arXiv's BibTeX from the paper's card, through the arxiv.org queue", async () => {
    const { root, site, clock, copy } = await loaded();
    const bibtex = "@misc{x2026,\n  eprint={2609.28538}\n}";
    site.html("https://arxiv.org/bibtex/2609.28538", `\n${bibtex}\n`);
    rows(root)[0]
      .querySelector<HTMLElement>(".zinspire-ref-entry__title-link")!
      .dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
    const card = () =>
      root.querySelector(".zinspire-preview-card") as HTMLElement | null;
    await vi.waitFor(() => expect(card()?.style.display).toBe("block"));
    [...card()!.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === msg("references-panel-copy-bibtex"))!
      .click();
    await clock.advanceBy(20000);
    // The key is the one a paper in neither the library nor INSPIRE gets
    expect(copy).toHaveBeenLastCalledWith(
      bibtex.replace("x2026", "Vattolo:2026spectral"),
    );
    expect(site.count("https://arxiv.org/bibtex/2609.28538")).toBe(1);
  });

  it("keeps the References panel's card as it was", () => {
    const renderer = new HoverPreviewRenderer({ document: win.document });
    const entry: InspireReferenceEntry = {
      id: "e1",
      title: "A paper",
      year: "2026",
      authors: ["Author, A."],
      authorText: "Author, A.",
      displayText: "",
      searchText: "",
    };
    const labels = (options?: Record<string, (e: unknown) => boolean>) => {
      const card = renderer.createCard();
      renderer.buildContent(card, {
        entry,
        onAdd: vi.fn(),
        onCopyBibtex: vi.fn(),
        onCopyTexkey: vi.fn(),
        entryOptions: options,
      });
      return [...card.querySelectorAll("button")].map((b) => b.textContent);
    };
    const panel = labels();
    expect(panel).not.toContain(msg("references-panel-copy-bibtex"));
    expect(panel).not.toContain(msg("references-panel-button-add"));
    // With an INSPIRE record: add, BibTeX and TeX key, as before
    entry.recid = "2891234";
    expect(labels()).toEqual(
      expect.arrayContaining([
        msg("references-panel-button-add"),
        msg("references-panel-copy-bibtex"),
        "T",
      ]),
    );
    delete entry.recid;
    const browser = labels({
      canAdd: () => false,
      canCopyBibtex: () => true,
      canCopyTexkey: () => false,
    });
    expect(browser).toContain(msg("references-panel-copy-bibtex"));
    expect(browser).not.toContain("T");
  });
});

describe("divider", () => {
  it("sets the widths of the list and the detail pane by dragging or with ← →, and keeps them", async () => {
    const first = await loaded();
    const parts = (root: HTMLElement) => ({
      main: root.querySelector<HTMLElement>(".arxiv-browser__main")!,
      list: root.querySelector<HTMLElement>(".arxiv-browser__list-pane")!,
      divider: root.querySelector<HTMLElement>(".arxiv-browser__divider")!,
    });
    const { main, list, divider } = parts(first.root);
    main.getBoundingClientRect = () => ({ left: 100, width: 1000 }) as DOMRect;
    const doc = win.document;
    const move = (clientX: number) =>
      doc.dispatchEvent(new win.MouseEvent("mousemove", { clientX }));
    expect(list.style.flex).toBe("0 0 60%");

    divider.dispatchEvent(
      new win.MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    move(500);
    expect(list.style.flex).toBe("0 0 40%");
    // The list keeps at least a quarter of the width, the detail pane a fifth
    move(120);
    expect(list.style.flex).toBe("0 0 25%");
    move(1080);
    expect(list.style.flex).toBe("0 0 80%");
    move(550);
    doc.dispatchEvent(new win.MouseEvent("mouseup"));
    expect(prefs[`${PREFIX}.arxiv_browser_list_share`]).toBe(45);
    // After the drag the pointer moves freely
    move(1000);
    expect(list.style.flex).toBe("0 0 45%");

    divider.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(list.style.flex).toBe("0 0 47%");
    expect(prefs[`${PREFIX}.arxiv_browser_list_share`]).toBe(47);

    // The next window opens with it
    first.view.dispose();
    const second = await loaded();
    expect(parts(second.root).list.style.flex).toBe("0 0 47%");
  });
});

describe("settings", () => {
  /** The section's list and note as the settings pane has them */
  function pane() {
    const doc = win.document;
    (doc as any).createXULElement = (tag: string) => doc.createElement(tag);
    const menulist = doc.createElement("menulist") as any;
    menulist.id = `zotero-prefpane-${config.addonRef}-arxiv_browser_default_subscription`;
    menulist.append(doc.createElement("menupopup"));
    // A XUL menulist's value: that of its chosen item
    let value = "";
    Object.defineProperty(menulist, "value", {
      get: () => value,
      set: (next: string) => (value = next),
    });
    const note = doc.createElement("p");
    note.id = `zotero-prefpane-${config.addonRef}-arxiv_browser_no_subscription`;
    doc.body.replaceChildren(menulist, note);
    return { doc, menulist };
  }

  it("lists the subscriptions to open with, after 'the first one'", () => {
    prefs[`${PREFIX}.arxiv_subscriptions`] = JSON.stringify([
      { id: "sub-1", name: "Daily", categories: ["hep-ph"], sections: {} },
      { id: "sub-2", name: "Maths", categories: ["math"], sections: {} },
    ]);
    prefs[`${PREFIX}.arxiv_browser_default_subscription`] = "sub-2";
    const { doc, menulist } = pane();
    initArxivBrowserPrefs(doc);
    const items = [...menulist.querySelectorAll("menuitem")] as Element[];
    expect(items.map((item) => item.getAttribute("value"))).toEqual([
      "",
      "sub-1",
      "sub-2",
    ]);
    expect(items[0].getAttribute("data-l10n-id")).toBe(
      `${config.addonRef}-pref-arxiv-browser-first-subscription`,
    );
    expect(items[2].getAttribute("label")).toBe("Maths");
    expect(menulist.value).toBe("sub-2");
    expect(
      doc.getElementById(
        `zotero-prefpane-${config.addonRef}-arxiv_browser_no_subscription`,
      )!.hidden,
    ).toBe(true);

    menulist.value = "sub-1";
    menulist.dispatchEvent(new win.Event("command"));
    expect(prefs[`${PREFIX}.arxiv_browser_default_subscription`]).toBe("sub-1");
  });

  it("shows 'the first one' when the subscription kept in the settings was deleted", () => {
    prefs[`${PREFIX}.arxiv_subscriptions`] = JSON.stringify([
      { id: "sub-1", name: "Daily", categories: ["hep-ph"], sections: {} },
    ]);
    prefs[`${PREFIX}.arxiv_browser_default_subscription`] = "sub-gone";
    const { doc, menulist } = pane();
    initArxivBrowserPrefs(doc);
    expect(menulist.value).toBe("");
  });

  it("offers the days to open with that the window knows, the newest day otherwise", () => {
    const markup = readFileSync(
      join(__dirname, "../addon/content/preferences.xhtml"),
      "utf8",
    );
    const start = markup.indexOf(
      'id="zotero-prefpane-__addonRef__-arxiv_browser_open_days"',
    );
    const group = markup.slice(start, markup.indexOf("</radiogroup>", start));
    expect([...group.matchAll(/value="([a-z]+)"/g)].map((m) => m[1])).toEqual([
      ...OPENING_SELECTIONS,
    ]);
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "week";
    expect(openingSetting()).toBe("week");
    prefs[`${PREFIX}.arxiv_browser_open_days`] = "catchup";
    expect(openingSetting()).toBe("newest");
  });

  it("without subscriptions says how to make one", () => {
    const { doc, menulist } = pane();
    initArxivBrowserPrefs(doc);
    expect(menulist.disabled).toBe(true);
    expect(
      doc.getElementById(
        `zotero-prefpane-${config.addonRef}-arxiv_browser_no_subscription`,
      )!.hidden,
    ).toBe(false);
  });
});

describe("time to show a page", () => {
  it("notes the building, the first paint two frames later, and the formulas in view", () => {
    let now = 1000;
    const frames: Array<() => void> = [];
    const fake = {
      performance: { now: () => now },
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
    } as unknown as Window;
    const started = 1000;
    now = 1012.34;
    const time = notePaint(fake, 50, 50, started);
    expect(time).toMatchObject({ papers: 50, pageSize: 50, buildMs: 12.3 });
    expect(Number.isNaN(time.paintMs)).toBe(true);
    now = 1030;
    frames.shift()!();
    now = 1047;
    frames.shift()!();
    expect(time.paintMs).toBe(47);
    now = 1120;
    noteFormulas(fake, time, started, 9);
    expect(time.formulasMs).toBe(120);
    expect(paintTimes().at(-1)).toMatchObject({
      papers: 50,
      buildMs: 12.3,
      paintMs: 47,
      formulasMs: 120,
    });
    // A copy: the record is not changed from outside
    paintTimes().at(-1)!.paintMs = 0;
    expect(paintTimes().at(-1)!.paintMs).toBe(47);
  });

  it("times the formulas only of abstracts in view when a page is drawn", async () => {
    let report:
      | ((records: Array<{ target: Element; isIntersecting: boolean }>) => void)
      | null = null;
    const observed: Element[] = [];
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
    const before = paintTimes().length;
    const { root } = await loaded();
    // Abstracts are folded: none observed, the page's record has no formulas
    expect(observed).toHaveLength(0);
    const page = () => paintTimes()[paintTimes().length - 1];
    expect(paintTimes().length).toBeGreaterThan(before);
    // One abstract opened later: its formulas are not the page's
    rows(root)[0]
      .querySelector<HTMLButtonElement>(".arxiv-browser__abstract-toggle")!
      .click();
    expect(observed).toHaveLength(1);
    report!([{ target: observed[0], isIntersecting: true }]);
    await flushPromises();
    expect(page().formulasMs).toBeUndefined();
  });

  it("is noted for every page the list draws", async () => {
    const before = paintTimes().length;
    const { view } = await loaded();
    view.listPane.goToPage(1);
    const times = paintTimes().slice(before);
    expect(times.map((time) => [time.papers, time.pageSize])).toEqual(
      expect.arrayContaining([
        [50, 50],
        [22, 50],
      ]),
    );
  });
});
