// ─────────────────────────────────────────────────────────────────────────────
// Updating items from INSPIRE when a request does not get an answer: the user
// cancels the update (Escape or the "Cancel update" menu entry), INSPIRE
// cannot be reached, or the server fails. Such an item must be left as it
// is: it is not tagged as having no INSPIRE record and not counted as one. A
// real "not found" answer still tags it. Zotero, INSPIRE (inspireFetch) and
// the progress windows are fakes; overlapping runs and Escape are covered by
// updateCancel.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  prefs: new Map<string, unknown>(),
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

// The run's progress popup: an ordinary fake progress window
vi.mock("../src/modules/inspire/runProgressWindow", () => ({
  openRunProgressWindow: (header: string) =>
    new (globalThis as any).ztoolkit.ProgressWindow(header),
}));

import { ZInspire } from "../src/modules/inspire/itemUpdater";

const NO_RECID_TAG = "No INSPIRE recid found";

interface FakeItem {
  id: number;
  fields: Record<string, string>;
  tags: Set<string>;
  getField: (name: string) => string;
  hasTag: (tag: string) => boolean;
  addTag: (tag: string, type?: number) => boolean;
  removeTag: (tag: string) => boolean;
  saveTx: ReturnType<typeof vi.fn>;
  isRegularItem: () => boolean;
}

let nextID = 1;
function paper(arxivId: string): FakeItem {
  const item: FakeItem = {
    id: nextID++,
    fields: { extra: `arXiv:${arxivId}`, title: `Paper ${arxivId}` },
    tags: new Set(),
    getField: (name) => item.fields[name] ?? "",
    hasTag: (tag) => item.tags.has(tag),
    addTag: (tag) => {
      item.tags.add(tag);
      return true;
    },
    removeTag: (tag) => item.tags.delete(tag),
    saveTx: vi.fn(async () => true),
    isRegularItem: () => true,
  };
  return item;
}

/** A paper known only by its citation key: INSPIRE is searched for it */
function paperByCitationKey(citekey: string): FakeItem {
  const item = paper("");
  item.fields.extra = `Citation Key: ${citekey}`;
  return item;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/**
 * A request to INSPIRE that the test answers, rejecting on an abort of its
 * signal as fetch does.
 */
interface PendingRequest {
  url: string;
  signal?: AbortSignal;
  answer: (value: Response | Error) => void;
}
let pending: PendingRequest[];

function installInspire(): void {
  pending = [];
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(
    (url: string, options?: { signal?: AbortSignal }) =>
      new Promise<Response>((resolve, reject) => {
        const signal = options?.signal;
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener("abort", () => reject(abortError()));
        pending.push({
          url,
          signal,
          answer: (value) =>
            value instanceof Error ? reject(value) : resolve(value),
        });
      }),
  );
}

/** The pending request about a paper, found by its arXiv ID in the URL */
function requestFor(item: FakeItem): PendingRequest {
  const arxivId = item.fields.extra.replace(/^arXiv:/, "");
  const request = pending.find((r) => r.url.includes(`/arxiv/${arxivId}`));
  if (!request) throw new Error(`No request for ${arxivId}`);
  return request;
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

interface ProgressLine {
  text?: string;
  progress?: number;
}
interface ShownWindow {
  headline?: string;
  lines: ProgressLine[];
  closed: boolean;
}
let windows: ShownWindow[];
let selectedItems: FakeItem[];

beforeEach(() => {
  nextID = 1;
  selectedItems = [];
  windows = [];
  mocks.prefs.clear();
  mocks.prefs.set("tag_enable", true);
  mocks.prefs.set("tag_norecid", NO_RECID_TAG);
  installInspire();
  const mainWindow = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    getMainWindow: () => mainWindow,
    getActiveZoteroPane: () => ({
      getSelectedItems: () => selectedItems,
    }),
  });
  class FakeProgressWindow {
    record: ShownWindow = { lines: [], closed: false };
    win = {
      changeHeadline: (text: string) => {
        this.record.headline = text;
      },
    };
    constructor() {
      windows.push(this.record);
    }
    changeHeadline(text: string) {
      this.record.headline = text;
      return this;
    }
    createLine(line: ProgressLine) {
      this.record.lines.push(line);
      return this;
    }
    changeLine(line: ProgressLine) {
      this.record.lines.push(line);
      return this;
    }
    show() {
      return this;
    }
    startCloseTimer() {
      return this;
    }
    close() {
      this.record.closed = true;
    }
  }
  vi.stubGlobal("ztoolkit", { ProgressWindow: FakeProgressWindow });
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
  // A TypeError caught and logged by the plugin would let a test pass without
  // running the code it is about (a failed request is logged with its error,
  // for a network failure a TypeError, as fetch reports it)
  const logged = (Zotero.debug as ReturnType<typeof vi.fn>).mock.calls
    .map(([text]) => String(text))
    .filter((text) => !/INSPIRE request failed/.test(text));
  expect(
    logged.filter((text) => /TypeError|ReferenceError/.test(text)),
  ).toEqual([]);
  vi.unstubAllGlobals();
});

/** Texts of all lines of all progress windows and notifications */
const shownTexts = () =>
  windows.flatMap((w) => [
    w.headline ?? "",
    ...w.lines.map((line) => line.text ?? ""),
  ]);

/** The "no INSPIRE record" notifications shown */
const noRecidMessages = () =>
  shownTexts().filter((text) => /No INSPIRE recid/.test(text));

const noRecidMessage = (count: number) =>
  `No INSPIRE recid was found for ${count} ${count === 1 ? "item" : "items"}. Tagged with '${NO_RECID_TAG}'.`;

const notFound = () => response(404, { status: 404, message: "Not found" });

describe("a cancelled update", () => {
  it("leaves the papers whose requests were cancelled untouched (Escape during an update of added papers)", async () => {
    const inspire = new ZInspire();
    const papers = [
      paper("2401.00001"),
      paper("2401.00002"),
      paper("2401.00003"),
    ];
    inspire.updateItems(papers as unknown as Zotero.Item[], "full");
    await flush();
    expect(pending).toHaveLength(3);

    inspire.cancelUpdate();
    await flush();

    for (const item of papers) {
      expect(item.tags.has(NO_RECID_TAG)).toBe(false);
      expect(item.saveTx).not.toHaveBeenCalled();
    }
    // Nothing was updated before the cancellation
    expect(shownTexts()).toContain(
      `zoteroinspire-update-cancelled-stats ${JSON.stringify({ completed: "0", total: "3", updated: "0" })}`,
    );
    expect(noRecidMessages()).toEqual([]);
  });

  it("leaves the papers untouched when the menu update is cancelled", async () => {
    const inspire = new ZInspire();
    const papers = [
      paper("2401.00001"),
      paper("2401.00002"),
      paper("2401.00003"),
      paper("2401.00004"),
    ];
    selectedItems = papers;
    inspire.updateSelectedItems("full");
    await flush();
    expect(pending).toHaveLength(3);
    // The first paper is answered before the user cancels
    requestFor(papers[0]).answer(notFound());
    await flush();
    expect(papers[0].tags.has(NO_RECID_TAG)).toBe(true);

    inspire.cancelUpdate();
    await flush();

    // The requests in flight are cancelled; the fourth was sent after the
    // first answer and is cancelled too
    expect(pending.every((r) => r.signal?.aborted)).toBe(true);
    for (const item of papers.slice(1)) {
      expect(item.tags.has(NO_RECID_TAG)).toBe(false);
      expect(item.saveTx).not.toHaveBeenCalled();
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(shownTexts()).toContain(
      `zoteroinspire-update-cancelled-stats ${JSON.stringify({ completed: "1", total: "4", updated: "0" })}`,
    );
  });

  it("still tells about a request that failed before the cancel", async () => {
    const inspire = new ZInspire();
    const papers = [
      paper("2401.00001"),
      paper("2401.00002"),
      paper("2401.00003"),
      paper("2401.00004"),
    ];
    selectedItems = papers;
    inspire.updateSelectedItems("full");
    await flush();
    requestFor(papers[0]).answer(
      new TypeError("NetworkError when attempting to fetch resource."),
    );
    await flush();

    inspire.cancelUpdate();
    await flush();

    for (const item of papers) {
      expect(item.tags.has(NO_RECID_TAG)).toBe(false);
      expect(item.saveTx).not.toHaveBeenCalled();
    }
    expect(shownTexts()).toContain(
      `zoteroinspire-update-cancelled-stats ${JSON.stringify({ completed: "0", total: "4", updated: "0" })}`,
    );
    expect(shownTexts()).toContain(
      `zoteroinspire-update-request-failed ${JSON.stringify({ count: 1 })}`,
    );
  });

  it("does not cancel the next menu update from the start", async () => {
    const inspire = new ZInspire();
    const first = paper("2401.00001");
    inspire.updateItems([first] as unknown as Zotero.Item[], "full");
    await flush();
    inspire.cancelUpdate();
    await flush();

    const later = [paper("2402.00001"), paper("2402.00002")];
    selectedItems = later;
    inspire.updateSelectedItems("full");
    await flush();

    expect(pending.slice(1).map((r) => r.signal?.aborted ?? false)).toEqual([
      false,
      false,
    ]);
    for (const item of later) requestFor(item).answer(notFound());
    await flush();
    // INSPIRE answered "not found": both are tagged
    for (const item of later) expect(item.tags.has(NO_RECID_TAG)).toBe(true);
    expect(noRecidMessages()).toEqual([noRecidMessage(2)]);
  });
});

describe("a request without an answer from INSPIRE", () => {
  it("leaves the paper untouched when INSPIRE cannot be reached", async () => {
    const inspire = new ZInspire();
    const papers = [paper("2401.00001"), paper("2401.00002")];
    inspire.updateItems(papers as unknown as Zotero.Item[], "full");
    await flush();
    for (const item of papers) {
      requestFor(item).answer(
        new TypeError("NetworkError when attempting to fetch resource."),
      );
    }
    await flush();

    for (const item of papers) {
      expect(item.tags.has(NO_RECID_TAG)).toBe(false);
      expect(item.saveTx).not.toHaveBeenCalled();
    }
    expect(noRecidMessages()).toEqual([]);
    expect(shownTexts()).toContain(
      `zoteroinspire-update-request-failed ${JSON.stringify({ count: 2 })}`,
    );
  });

  it("leaves the paper untouched when the server fails or is overloaded", async () => {
    const inspire = new ZInspire();
    const papers = [
      paper("2401.00001"),
      paper("2401.00002"),
      paper("2401.00003"),
    ];
    inspire.updateItems(papers as unknown as Zotero.Item[], "full");
    await flush();
    requestFor(papers[0]).answer(
      response(503, { status: 503, message: "Service unavailable" }),
    );
    requestFor(papers[1]).answer(
      response(429, { status: 429, message: "Too many requests" }),
    );
    // A gateway error page that is not JSON
    requestFor(papers[2]).answer({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("JSON.parse: unexpected character");
      },
    } as unknown as Response);
    await flush();

    for (const item of papers) {
      expect(item.tags.has(NO_RECID_TAG)).toBe(false);
      expect(item.saveTx).not.toHaveBeenCalled();
    }
    expect(noRecidMessages()).toEqual([]);
    expect(shownTexts()).toContain(
      `zoteroinspire-update-request-failed ${JSON.stringify({ count: 3 })}`,
    );
  });

  it("leaves the paper untouched when the answer breaks off", async () => {
    const inspire = new ZInspire();
    const item = paper("2401.00001");
    inspire.updateItems([item] as unknown as Zotero.Item[], "full");
    await flush();
    requestFor(item).answer({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("JSON.parse: end of data");
      },
    } as unknown as Response);
    await flush();

    expect(item.tags.has(NO_RECID_TAG)).toBe(false);
    expect(noRecidMessages()).toEqual([]);
  });
});

describe("INSPIRE has no record", () => {
  it("tags the paper when INSPIRE answers 404", async () => {
    const inspire = new ZInspire();
    const item = paper("2401.00001");
    inspire.updateItems([item] as unknown as Zotero.Item[], "full");
    await flush();
    requestFor(item).answer(notFound());
    await flush();

    expect(item.tags.has(NO_RECID_TAG)).toBe(true);
    expect(item.saveTx).toHaveBeenCalledTimes(1);
    expect(noRecidMessages()).toEqual([noRecidMessage(1)]);
  });

  it("tags the paper when a search by citation key finds nothing", async () => {
    const inspire = new ZInspire();
    const item = paperByCitationKey("Nobody:2020abc");
    inspire.updateItems([item] as unknown as Zotero.Item[], "full");
    await flush();
    expect(pending).toHaveLength(1);
    expect(pending[0].url).toContain("texkey");
    pending[0].answer(response(200, { hits: { total: 0, hits: [] } }));
    await flush();

    expect(item.tags.has(NO_RECID_TAG)).toBe(true);
    expect(noRecidMessages()).toEqual([noRecidMessage(1)]);
  });

  it("tags a paper without any identifier, without asking INSPIRE", async () => {
    const inspire = new ZInspire();
    const item = paper("");
    item.fields.extra = "";
    inspire.updateItems([item] as unknown as Zotero.Item[], "full");
    await flush();

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(item.tags.has(NO_RECID_TAG)).toBe(true);
    expect(noRecidMessages()).toEqual([noRecidMessage(1)]);
  });
});
