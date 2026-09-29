// ─────────────────────────────────────────────────────────────────────────────
// Preprint watch as the user sees it: the three menu entries (selected items,
// a collection, all preprints), their progress window, the results dialog and
// the final notification. Zotero, INSPIRE and the progress windows are fakes;
// the dialog is real DOM (jsdom).
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { config } from "../package.json";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  prefs: new Map<string, unknown>(),
  fetchInspireMetaByRecid: vi.fn(),
}));
vi.mock("../src/modules/inspire/rateLimiter", () => ({
  inspireFetch: mocks.fetch,
}));
vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: { getCacheDir: async () => "/cache" },
}));
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  setPref: (key: string, value: unknown) => mocks.prefs.set(key, value),
}));
vi.mock("../src/modules/inspire/metadataService", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/inspire/metadataService")
  >()),
  fetchInspireMetaByRecid: mocks.fetchInspireMetaByRecid,
}));

interface ProgressLine {
  text: string;
  progress?: number;
  type?: string;
}
const progressWindows = vi.hoisted(
  () =>
    [] as Array<{
      lines: ProgressLine[];
      closed: boolean;
      closeTimer?: number;
    }>,
);
vi.mock("zotero-plugin-toolkit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zotero-plugin-toolkit")>();
  class FakeProgressWindow {
    lines: ProgressLine[] = [];
    closed = false;
    closeTimer?: number;
    constructor() {
      progressWindows.push(this);
    }
    createLine(line: ProgressLine) {
      this.lines.push(line);
      return this;
    }
    changeLine(line: ProgressLine) {
      this.lines.push(line);
      return this;
    }
    show() {
      return this;
    }
    startCloseTimer(ms: number) {
      this.closeTimer = ms;
      return this;
    }
    close() {
      this.closed = true;
    }
  }
  return { ...actual, ProgressWindowHelper: FakeProgressWindow };
});

import { ZInspire } from "../src/modules/inspire/itemUpdater";
import {
  clearPreprintCache,
  startBackgroundCheck,
  stopBackgroundCheck,
} from "../src/modules/inspire/preprintWatchService";
import {
  CACHE_FILE,
  FakeZotero,
  abortError,
  deferred,
  inspireAnswers,
  inspireResponse,
  publishedRecord,
  requestedArxivIds,
  unpublishedRecord,
  type InspireMetadata,
} from "./preprintWatchFakes";

/** The text getString() returns for a message under the locale stub below */
function msg(key: string, args?: Record<string, unknown>): string {
  const id = `${config.addonRef}-${key}`;
  return args ? `${id} ${JSON.stringify(args)}` : id;
}

let zotero: FakeZotero;
let answers: Map<string, InspireMetadata[] | number | Error>;
let dom: JSDOM;

beforeEach(() => {
  clearPreprintCache();
  progressWindows.length = 0;
  mocks.prefs.clear();
  mocks.fetchInspireMetaByRecid.mockReset().mockResolvedValue(-1);
  zotero = new FakeZotero();
  zotero.install();
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://example.org/",
  });
  zotero.mainWindow = dom.window;
  answers = new Map();
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(inspireAnswers(answers));
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
  stopBackgroundCheck();
  dom.window.close();
  // A TypeError caught and logged by the plugin would let a test pass without
  // running the code it is about
  const logged = (Zotero.debug as ReturnType<typeof vi.fn>).mock.calls.map(
    ([text]) => String(text),
  );
  expect(
    logged.filter((text) => /TypeError|ReferenceError/.test(text)),
  ).toEqual([]);
});

function preprint(arxivId: string, libraryID = 1) {
  return zotero.addItem(
    "preprint",
    { extra: `arXiv:${arxivId} [hep-ph]`, title: `Paper ${arxivId}` },
    { libraryID },
  );
}

/** Preprints of `count` papers from `first` on (2410.00001, ...) */
function preprints(count: number, prefix = "2410", first = 1) {
  return Array.from({ length: count }, (_, i) =>
    preprint(`${prefix}.${String(first + i).padStart(5, "0")}`),
  );
}

const overlay = () =>
  dom.window.document.getElementById("zinspire-preprint-results-overlay");

function button(label: string): HTMLButtonElement {
  const found = [...overlay()!.querySelectorAll("button")].find(
    (b) => b.textContent === msg(label),
  );
  if (!found) throw new Error(`No button ${label}`);
  return found as HTMLButtonElement;
}

/** Texts of the notifications (progress windows with a close timer) */
const notifications = () =>
  progressWindows
    .filter((w) => w.closeTimer !== undefined)
    .map((w) => w.lines[0]);

describe("checking the selected items", () => {
  it("lists the published preprints and updates only the ticked ones", async () => {
    const a = preprint("2403.00001");
    const b = preprint("2403.00002");
    const c = preprint("2403.00003");
    zotero.selectedItems = [a, b, c];
    answers.set("2403.00001", [publishedRecord("2403.00001", 101)]);
    answers.set("2403.00002", [publishedRecord("2403.00002", 102)]);
    answers.set("2403.00003", [unpublishedRecord("2403.00003", 103)]);

    const run = new ZInspire().checkSelectedItemsPreprints();
    await vi.waitFor(() => expect(overlay()).not.toBeNull());

    const panel = overlay()!;
    expect(panel.textContent).toContain(
      msg("preprint-found-published", { count: 2 }),
    );
    const boxes = [
      ...panel.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-item-id]',
      ),
    ];
    expect(boxes.map((box) => Number(box.dataset.itemId))).toEqual([
      a.id,
      b.id,
    ]);
    expect(panel.textContent).toContain("Paper 2403.00001");
    expect(panel.textContent).toContain("Phys. Rev. D 110 014001 (2025)");
    expect(panel.textContent).toContain("DOI: 10.1103/PhysRevD.110.101");

    boxes[1].checked = false;
    boxes[1].dispatchEvent(new dom.window.Event("change"));
    button("preprint-update-selected").click();
    await run;

    expect(overlay()).toBeNull();
    expect(a.saveTx).toHaveBeenCalledTimes(1);
    expect(a.itemType).toBe("journalArticle");
    expect(a.fields.journalAbbreviation).toBe("Phys. Rev. D");
    expect(a.fields.volume).toBe("110");
    expect(a.fields.pages).toBe("014001");
    expect(b.saveTx).not.toHaveBeenCalled();
    expect(c.saveTx).not.toHaveBeenCalled();
    expect(notifications().at(-1)?.text).toBe(
      msg("preprint-update-success", { count: 1 }),
    );
  });

  it("updates nothing when the dialog is cancelled", async () => {
    const a = preprint("2403.00004");
    zotero.selectedItems = [a];
    answers.set("2403.00004", [publishedRecord("2403.00004", 104)]);

    const run = new ZInspire().checkSelectedItemsPreprints();
    await vi.waitFor(() => expect(overlay()).not.toBeNull());
    button("preprint-cancel").click();
    await run;

    expect(overlay()).toBeNull();
    expect(a.saveTx).not.toHaveBeenCalled();
  });

  it("says so when no selected item is an unpublished preprint", async () => {
    zotero.selectedItems = [
      zotero.addItem("book", { title: "A book", extra: "arXiv:2403.00005" }),
    ];

    await new ZInspire().checkSelectedItemsPreprints();

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(notifications().map((line) => line.text)).toEqual([
      msg("preprint-no-preprints"),
    ]);
  });

  it("stops when Escape is pressed during the check", async () => {
    zotero.selectedItems = preprints(51, "2403", 6);
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    mocks.fetch.mockImplementation(
      (url: string, options?: { signal?: AbortSignal }) => {
        const request = deferred<Response>();
        pending.set(requestedArxivIds(url)[0], request);
        options?.signal?.addEventListener("abort", () =>
          request.reject(abortError()),
        );
        return request.promise;
      },
    );

    const run = new ZInspire().checkSelectedItemsPreprints();
    await vi.waitFor(() => expect(pending.size).toBe(2));
    pending
      .get("2403.00006")!
      .resolve(inspireResponse([unpublishedRecord("2403.00006", 106)]));
    dom.window.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape" }),
    );
    await run;

    expect(overlay()).toBeNull();
    expect(notifications().at(-1)).toMatchObject({
      text: msg("preprint-check-cancelled"),
      type: "fail",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Counts per outcome, and the scope of the collection and "all" entries
// ─────────────────────────────────────────────────────────────────────────────

/** Texts of the lines of the check's progress window */
function progressTexts(): string[] {
  const window = progressWindows.find((w) =>
    w.lines.some((line) => line.text.includes("preprint-check-progress")),
  );
  return window ? window.lines.map((line) => line.text) : [];
}

describe("the result of a check", () => {
  it("shows how many preprints had each outcome when none is published", async () => {
    // two requests: 50 papers answered, the 51st and 52nd not
    zotero.selectedItems = preprints(52);
    answers.set("2410.00001", [unpublishedRecord("2410.00001", 1)]);
    answers.set("2410.00002", [unpublishedRecord("2410.00002", 2)]);
    answers.set("2410.00051", 502);
    answers.set("2410.00052", 502);

    await new ZInspire().checkSelectedItemsPreprints();

    expect(overlay()).toBeNull();
    expect(notifications()).toEqual([
      expect.objectContaining({
        text: msg("preprint-check-summary", {
          total: 52,
          published: 0,
          unpublished: 2,
          notInInspire: 48,
          errors: 2,
        }),
        type: "fail",
      }),
    ]);
    expect(
      progressWindows.find((w) => w.closeTimer !== undefined)?.closeTimer,
    ).toBe(10000);
  });

  it("shows the counts without the failure mark when every request was answered", async () => {
    zotero.selectedItems = [preprint("2410.00006"), preprint("2410.00007")];
    answers.set("2410.00006", [unpublishedRecord("2410.00006", 6)]);
    answers.set("2410.00007", []);

    await new ZInspire().checkSelectedItemsPreprints();

    expect(notifications()).toEqual([
      expect.objectContaining({
        text: msg("preprint-check-summary", {
          total: 2,
          published: 0,
          unpublished: 1,
          notInInspire: 1,
          errors: 0,
        }),
        type: "success",
      }),
    ]);
  });

  it("shows the counts of all four outcomes above the published preprints", async () => {
    // two requests: 50 papers answered, the 51st not
    zotero.selectedItems = preprints(51, "2410", 8);
    answers.set("2410.00008", [publishedRecord("2410.00008", 8)]);
    answers.set("2410.00009", [unpublishedRecord("2410.00009", 9)]);
    answers.set("2410.00058", 503);

    const run = new ZInspire().checkSelectedItemsPreprints();
    await vi.waitFor(() => expect(overlay()).not.toBeNull());
    const counts = [...overlay()!.querySelectorAll("span")].map(
      (span) => span.textContent,
    );
    button("preprint-cancel").click();
    await run;

    expect(counts).toEqual([
      `${msg("preprint-results-published")}: 1`,
      `${msg("preprint-results-unpublished")}: 1`,
      `${msg("preprint-results-not-in-inspire")}: 48`,
      `${msg("preprint-results-errors")}: 1`,
    ]);
  });
});

describe("checking all preprints", () => {
  it("checks the preprints of every editable library with INSPIRE, whatever the cache holds", async () => {
    zotero.libraries.push(
      { libraryID: 2, libraryType: "group", editable: true, name: "Group" },
      {
        libraryID: 3,
        libraryType: "group",
        editable: false,
        name: "Read-only",
      },
    );
    const now = Date.now();
    zotero.files.set(CACHE_FILE, {
      version: 1,
      lastFullScan: now,
      lastCheck: now,
      entries: [
        {
          arxivId: "2411.00001",
          itemId: 1,
          lastChecked: now,
          status: "unpublished",
        },
      ],
    });
    const cached = preprint("2411.00001");
    const neverCached = preprint("2411.00002");
    const inGroup = preprint("2411.00003", 2);
    preprint("2411.00004", 3);
    answers.set("2411.00001", [publishedRecord("2411.00001", 1)]);
    answers.set("2411.00002", [unpublishedRecord("2411.00002", 2)]);
    answers.set("2411.00003", [publishedRecord("2411.00003", 3)]);

    const run = new ZInspire().checkAllPreprintsInLibrary();
    await vi.waitFor(() => expect(overlay()).not.toBeNull());
    const boxes = [
      ...overlay()!.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-item-id]',
      ),
    ];
    button("preprint-cancel").click();
    await run;

    expect(
      mocks.fetch.mock.calls.flatMap(([url]) => requestedArxivIds(url)).sort(),
    ).toEqual(["2411.00001", "2411.00002", "2411.00003"]);
    expect(boxes.map((box) => Number(box.dataset.itemId))).toEqual([
      cached.id,
      inGroup.id,
    ]);
    expect(progressTexts()[0]).toBe(
      msg("preprint-check-progress", { current: 0, total: 3 }),
    );
    expect(progressTexts().at(-1)).toBe(
      msg("preprint-check-progress", { current: 3, total: 3 }),
    );
    expect(neverCached.saveTx).not.toHaveBeenCalled();
  });
});

describe("checking a collection", () => {
  it("asks INSPIRE even about preprints answered earlier in the session", async () => {
    const a = preprint("2412.00001");
    zotero.addCollection(5, [a]);
    zotero.selectedCollectionID = 5;
    answers.set("2412.00001", [unpublishedRecord("2412.00001", 1)]);
    await new ZInspire().checkPreprintsInCollection();
    answers.set("2412.00001", [publishedRecord("2412.00001", 1)]);

    const run = new ZInspire().checkPreprintsInCollection();
    await vi.waitFor(() => expect(overlay()).not.toBeNull());
    button("preprint-cancel").click();
    await run;

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("manual checks and the background check", () => {
  it("stops a background check in progress", async () => {
    const signal = startBackgroundCheck()!;
    zotero.selectedItems = [preprint("2408.10001")];
    answers.set("2408.10001", [unpublishedRecord("2408.10001", 1)]);

    await new ZInspire().checkSelectedItemsPreprints();

    expect(signal.aborted).toBe(true);
  });

  it("stops a background check before scanning for all preprints", async () => {
    const signal = startBackgroundCheck()!;
    preprint("2408.10003");
    answers.set("2408.10003", [unpublishedRecord("2408.10003", 3)]);
    const stoppedAtScan: boolean[] = [];
    const Search = (Zotero as any).Search;
    const search = Search.prototype.search;
    Search.prototype.search = function (this: unknown) {
      stoppedAtScan.push(signal.aborted);
      return search.call(this);
    };

    await new ZInspire().checkAllPreprintsInLibrary();

    expect(stoppedAtScan.length).toBeGreaterThan(0);
    expect(stoppedAtScan.every(Boolean)).toBe(true);
  });

  it("keeps a background check from starting until its results dialog is closed", async () => {
    zotero.selectedItems = [preprint("2408.10002")];
    answers.set("2408.10002", [publishedRecord("2408.10002", 2)]);

    const run = new ZInspire().checkSelectedItemsPreprints();
    await vi.waitFor(() => expect(overlay()).not.toBeNull());
    expect(startBackgroundCheck()).toBeNull();
    button("preprint-cancel").click();
    await run;

    expect(startBackgroundCheck()).not.toBeNull();
  });
});
