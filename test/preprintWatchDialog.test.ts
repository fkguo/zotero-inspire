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
import { clearPreprintCache } from "../src/modules/inspire/preprintWatchService";
import {
  FakeZotero,
  abortError,
  deferred,
  inspireAnswers,
  inspireResponse,
  publishedRecord,
  requestedArxivId,
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
    zotero.selectedItems = [preprint("2403.00006"), preprint("2403.00007")];
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    mocks.fetch.mockImplementation(
      (url: string, options?: { signal?: AbortSignal }) => {
        const request = deferred<Response>();
        pending.set(requestedArxivId(url), request);
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
