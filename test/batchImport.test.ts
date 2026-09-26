import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { config } from "../package.json";
import {
  BatchImportManager,
  type BatchImportManagerOptions,
} from "../src/modules/inspire/panel/BatchImportManager";
import { EntryListRenderer } from "../src/modules/inspire/panel/EntryListRenderer";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import type { SaveTargetSelection } from "../src/modules/pickerUI";
import { InspireReferencePanelController } from "../src/modules/zinspire";

// Batch selection, duplicate detection and batch import of the References
// panel, which the panel delegates to BatchImportManager. The library lookups,
// INSPIRE requests, clipboard and progress windows are replaced by fakes; the
// panel's list, rows, toolbar and duplicate dialog are real DOM (jsdom).

const library = vi.hoisted(() => ({
  findItemsByRecids: vi.fn(),
  findItemsByArxivs: vi.fn(),
  findItemsByDOIs: vi.fn(),
}));
const clipboard = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));
vi.mock("../src/modules/inspire/apiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/inspire/apiUtils")>()),
  ...library,
  ...clipboard,
}));
const network = vi.hoisted(() => ({ inspireFetch: vi.fn() }));
vi.mock("../src/modules/inspire/rateLimiter", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/inspire/rateLimiter")
  >()),
  ...network,
}));

interface ProgressLine {
  text: string;
  progress: number;
}
const progressWindows = vi.hoisted(
  () => [] as Array<{ lines: ProgressLine[]; closed: boolean }>,
);
vi.mock("zotero-plugin-toolkit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zotero-plugin-toolkit")>();
  class FakeProgressWindow {
    lines: ProgressLine[] = [];
    closed = false;
    win = { changeHeadline: () => undefined };
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
    close() {
      this.closed = true;
    }
  }
  return { ...actual, ProgressWindowHelper: FakeProgressWindow };
});

/** The text getString() returns for a message under the locale stub below. */
function msg(key: string, args?: Record<string, unknown>): string {
  const id = `${config.addonRef}-${key}`;
  return args ? `${id} ${JSON.stringify(args)}` : id;
}

beforeEach(() => {
  progressWindows.length = 0;
  for (const find of Object.values(library)) {
    find.mockReset().mockResolvedValue(new Map());
  }
  clipboard.copyToClipboard.mockReset().mockResolvedValue(true);
  network.inspireFetch.mockReset();
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Prefs: { get: () => undefined },
  });
  // Toast-style progress windows opened through the global toolkit
  vi.stubGlobal("ztoolkit", {
    ProgressWindow: class {
      win = { changeHeadline: () => undefined };
      createLine() {
        return this;
      }
      changeLine() {
        return this;
      }
      show() {
        return this;
      }
      close() {}
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
afterEach(() => vi.unstubAllGlobals());

function entry(
  id: string,
  fields: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id,
    recid: `rec-${id}`,
    title: `Paper ${id}`,
    year: "2024",
    authors: [],
    authorText: "Guo",
    displayText: "",
    searchText: "",
    ...fields,
  };
}

const TARGET: SaveTargetSelection = {
  libraryID: 1,
  primaryRowID: "C5",
  collectionIDs: [5],
  tags: ["batch"],
  note: "",
};

/**
 * Minimal rows for the tests of the manager alone: a checkbox per entry,
 * keyed by entry ID as in the panel's rows. The panel tests draw real rows.
 */
function renderRows(
  listEl: HTMLElement,
  entries: InspireReferenceEntry[],
  selected: ReadonlySet<string>,
) {
  const doc = listEl.ownerDocument;
  listEl.replaceChildren(
    ...entries.map((e) => {
      const row = doc.createElement("div");
      row.className = "zinspire-ref-entry";
      row.dataset.entryId = e.id;
      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "zinspire-ref-entry__checkbox";
      checkbox.dataset.entryId = e.id;
      checkbox.checked = selected.has(e.id);
      row.append(checkbox, e.title);
      return row;
    }),
  );
}

function checkboxOf(listEl: HTMLElement, id: string) {
  return listEl.querySelector(
    `.zinspire-ref-entry__checkbox[data-entry-id="${id}"]`,
  ) as HTMLInputElement;
}

function tickedIn(listEl: HTMLElement): string[] {
  return [
    ...listEl.querySelectorAll<HTMLInputElement>(
      ".zinspire-ref-entry__checkbox",
    ),
  ]
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.dataset.entryId!);
}

function buttonIn(root: ParentNode, key: string) {
  const button = [...root.querySelectorAll("button")].find(
    (b) => b.textContent === msg(key),
  );
  if (!button) throw new Error(`no button ${key}`);
  return button;
}

/**
 * A BatchImportManager on a jsdom panel whose list shows `visible` (the
 * filtered view) out of `entries`; checkbox clicks reach the manager the way
 * the panel's list click handler passes them on.
 */
function setUpManager(
  entries: InspireReferenceEntry[],
  visible: InspireReferenceEntry[] = entries,
) {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><div class='panel'></div></body>",
    { url: "https://zotero.test/" },
  );
  const doc = dom.window.document;
  const body = doc.querySelector(".panel") as HTMLElement;
  (globalThis as any).Zotero.getMainWindow = () => dom.window;

  let listEl = doc.createElement("div");
  const options = {
    getDocument: () => doc as Document,
    getBody: () => body,
    getListElement: () => listEl,
    getAllEntries: () => entries,
    getFilteredEntries: () => visible,
    importReference: vi.fn<BatchImportManagerOptions["importReference"]>(),
    promptForSaveTarget: vi
      .fn<BatchImportManagerOptions["promptForSaveTarget"]>()
      .mockResolvedValue(TARGET),
    showToast: vi.fn<BatchImportManagerOptions["showToast"]>(),
    updateRowStatus: vi.fn<BatchImportManagerOptions["updateRowStatus"]>(),
    onSelectionChange: vi.fn<(count: number) => void>(),
  };
  const manager = new BatchImportManager(options);

  /** Replace the list element, as the panel does when it re-renders. */
  const rerender = () => {
    const next = doc.createElement("div");
    next.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest(
        ".zinspire-ref-entry",
      ) as HTMLElement;
      const clicked = entries.find((e) => e.id === row.dataset.entryId)!;
      manager.handleCheckboxClick(clicked, event as MouseEvent);
    });
    renderRows(next, visible, manager.getSelectedEntryIDs());
    listEl.remove();
    body.appendChild(next);
    listEl = next;
  };
  rerender();

  const anchor = doc.createElement("button");
  body.appendChild(anchor);

  return {
    dom,
    doc,
    body,
    options,
    manager,
    anchor,
    rerender,
    list: () => listEl,
    click(id: string, { shiftKey = false } = {}) {
      checkboxOf(listEl, id).dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, shiftKey }),
      );
    },
    selected: () => [...manager.getSelectedEntryIDs()].sort(),
    ticked: () => tickedIn(listEl).sort(),
    async dialog() {
      await vi.waitFor(() =>
        expect(body.querySelector(".zinspire-duplicate-dialog")).not.toBeNull(),
      );
      return body.querySelector(".zinspire-duplicate-dialog") as HTMLElement;
    },
  };
}

/** importReference calls that stay pending until the test settles them. */
function holdImports(options: ReturnType<typeof setUpManager>["options"]) {
  const calls: Array<{
    recid: string;
    target: SaveTargetSelection;
    settle: (outcome: number | null | Error) => void;
  }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  options.importReference.mockImplementation(
    (recid, target) =>
      new Promise((resolve, reject) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        calls.push({
          recid,
          target,
          settle: (outcome) => {
            inFlight--;
            if (outcome instanceof Error) reject(outcome);
            else resolve(outcome === null ? null : ({ id: outcome } as any));
          },
        });
      }),
  );
  return { calls, maxInFlight: () => maxInFlight };
}

describe("batch selection", () => {
  const entries = ["e1", "e2", "e3", "e4", "e5", "e6"].map((id) => entry(id));
  // A filter hides e3 from the list
  const visible = entries.filter((e) => e.id !== "e3");

  it("ticks single rows and Shift+Click ranges over the rows in view", () => {
    const panel = setUpManager(entries, visible);

    panel.click("e1");
    expect(panel.selected()).toEqual(["e1"]);
    expect(panel.options.onSelectionChange).toHaveBeenLastCalledWith(1);

    panel.click("e5", { shiftKey: true });
    expect(panel.selected()).toEqual(["e1", "e2", "e4", "e5"]);
    expect(panel.ticked()).toEqual(["e1", "e2", "e4", "e5"]);
    expect(panel.options.onSelectionChange).toHaveBeenLastCalledWith(4);

    // Shift+Click on a ticked row unticks the range back to the last click
    panel.click("e2", { shiftKey: true });
    expect(panel.selected()).toEqual(["e1"]);
    expect(panel.ticked()).toEqual(["e1"]);
    expect(panel.options.onSelectionChange).toHaveBeenLastCalledWith(1);

    panel.click("e1");
    expect(panel.selected()).toEqual([]);
    expect(panel.options.onSelectionChange).toHaveBeenLastCalledWith(0);
  });

  it("selects all rows in view, and clearing also restarts Shift+Click", () => {
    const panel = setUpManager(entries, visible);

    panel.manager.selectAll();
    expect(panel.selected()).toEqual(["e1", "e2", "e4", "e5", "e6"]);
    expect(panel.ticked()).toEqual(["e1", "e2", "e4", "e5", "e6"]);
    expect(panel.options.onSelectionChange).toHaveBeenLastCalledWith(5);

    panel.manager.clearSelection();
    expect(panel.selected()).toEqual([]);
    expect(panel.ticked()).toEqual([]);
    expect(panel.options.onSelectionChange).toHaveBeenLastCalledWith(0);

    panel.click("e4", { shiftKey: true });
    expect(panel.selected()).toEqual(["e4"]);
  });

  it("hands out the live selection and ticks the list shown at the time", () => {
    const panel = setUpManager(entries, visible);
    const selection = panel.manager.getSelectedEntryIDs();
    panel.click("e2");
    expect(selection.has("e2")).toBe(true);

    const oldList = panel.list();
    panel.rerender();
    expect(panel.ticked()).toEqual(["e2"]);
    panel.manager.selectAll();
    expect(panel.ticked()).toEqual(["e1", "e2", "e4", "e5", "e6"]);
    expect(tickedIn(oldList)).toEqual(["e2"]);
  });
});

describe("duplicate detection", () => {
  it("takes entries already linked to local items, then recid, arXiv and DOI matches", async () => {
    const entries = [
      entry("local", { localItemID: 11, arxivDetails: { id: "2401.00001" } }),
      entry("byRecid", { recid: "2" }),
      entry("byArxiv", {
        recid: "3",
        arxivDetails: { id: "2403.00003" },
        doi: "10.1/c",
      }),
      entry("byDoi", { recid: "4", doi: "10.1/d" }),
      entry("recidFirst", { recid: "5", arxivDetails: { id: "2405.00005" } }),
      entry("notInLibrary", {
        recid: "6",
        arxivDetails: { id: "2406.00006" },
        doi: "10.1/f",
      }),
    ];
    library.findItemsByRecids.mockResolvedValue(
      new Map([
        ["2", 21],
        ["5", 25],
      ]),
    );
    library.findItemsByArxivs.mockResolvedValue(
      new Map([
        ["2403.00003", 23],
        ["2405.00005", 26],
      ]),
    );
    library.findItemsByDOIs.mockResolvedValue(
      new Map([
        ["10.1/c", 24],
        ["10.1/d", 27],
      ]),
    );
    const { manager } = setUpManager(entries);

    const duplicates = await (manager as any).detectDuplicates(entries);

    expect(Object.fromEntries(duplicates)).toEqual({
      local: { localItemID: 11, matchType: "recid" },
      byRecid: { localItemID: 21, matchType: "recid" },
      byArxiv: { localItemID: 23, matchType: "arxiv" },
      byDoi: { localItemID: 27, matchType: "doi" },
      recidFirst: { localItemID: 25, matchType: "recid" },
    });
    // Entries already linked to a local item are not looked up again
    expect(library.findItemsByRecids).toHaveBeenCalledWith([
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(library.findItemsByArxivs).toHaveBeenCalledWith([
      "2403.00003",
      "2405.00005",
      "2406.00006",
    ]);
    expect(library.findItemsByDOIs).toHaveBeenCalledWith([
      "10.1/c",
      "10.1/d",
      "10.1/f",
    ]);
  });

  it("does not search the library when every entry is already local", async () => {
    const entries = [
      entry("a", { localItemID: 1 }),
      entry("b", { localItemID: 2 }),
    ];
    const { manager } = setUpManager(entries);

    const duplicates = await (manager as any).detectDuplicates(entries);

    expect(Object.fromEntries(duplicates)).toEqual({
      a: { localItemID: 1, matchType: "recid" },
      b: { localItemID: 2, matchType: "recid" },
    });
    expect(library.findItemsByRecids).not.toHaveBeenCalled();
    expect(library.findItemsByArxivs).not.toHaveBeenCalled();
    expect(library.findItemsByDOIs).not.toHaveBeenCalled();
  });
});

describe("duplicate dialog", () => {
  it("lists the duplicates unticked in the panel's dialog style and imports the ticked ones with the rest", async () => {
    const entries = [
      entry("a"),
      entry("b", { localItemID: 12 }),
      entry("c", { doi: "10.1/c" }),
      entry("d"),
    ];
    library.findItemsByDOIs.mockResolvedValue(new Map([["10.1/c", 13]]));
    const panel = setUpManager(entries);
    panel.options.importReference.mockResolvedValue({ id: 100 } as any);
    panel.manager.selectAll();

    const run = panel.manager.handleBatchImport(panel.anchor);
    const dialog = await panel.dialog();

    for (const part of ["content", "title", "message", "list"]) {
      expect(
        dialog.querySelectorAll(`.zinspire-duplicate-dialog__${part}`),
      ).toHaveLength(1);
    }
    expect(
      dialog.querySelector(".zinspire-duplicate-dialog__title")!.textContent,
    ).toBe(msg("references-panel-batch-duplicate-title"));
    expect(
      dialog.querySelector(".zinspire-duplicate-dialog__message")!.textContent,
    ).toBe(msg("references-panel-batch-duplicate-message", { count: 2 }));
    const items = [
      ...dialog.querySelectorAll(
        ".zinspire-duplicate-dialog__list > .zinspire-duplicate-dialog__item",
      ),
    ];
    expect(items.map((item) => item.textContent)).toEqual([
      `Paper b${msg("references-panel-batch-duplicate-match-recid")}`,
      `Paper c${msg("references-panel-batch-duplicate-match-doi")}`,
    ]);
    const boxes = items.map((item) => item.querySelector("input")!);
    expect(boxes.map((box) => [box.type, box.checked])).toEqual([
      ["checkbox", false],
      ["checkbox", false],
    ]);

    boxes[1].click();
    buttonIn(dialog, "references-panel-batch-duplicate-confirm").click();
    const result = await run;

    expect(dialog.isConnected).toBe(false);
    expect(panel.options.promptForSaveTarget).toHaveBeenCalledOnce();
    expect(panel.options.promptForSaveTarget.mock.calls[0][0]).toBe(
      panel.anchor,
    );
    expect(
      panel.options.importReference.mock.calls.map(([recid]) => recid),
    ).toEqual(["rec-a", "rec-c", "rec-d"]);
    expect(result).toEqual({ success: 3, failed: 0, cancelled: false });
  });

  it("ticks or unticks every duplicate at once", async () => {
    const entries = [
      entry("a", { localItemID: 1 }),
      entry("b", { localItemID: 2 }),
    ];
    const panel = setUpManager(entries);
    panel.options.importReference.mockResolvedValue({ id: 100 } as any);
    panel.manager.selectAll();

    const run = panel.manager.handleBatchImport(panel.anchor);
    const dialog = await panel.dialog();
    const boxes = [...dialog.querySelectorAll("input")];
    buttonIn(dialog, "references-panel-batch-duplicate-import-all").click();
    expect(boxes.map((box) => box.checked)).toEqual([true, true]);
    buttonIn(dialog, "references-panel-batch-duplicate-skip-all").click();
    expect(boxes.map((box) => box.checked)).toEqual([false, false]);
    buttonIn(dialog, "references-panel-batch-duplicate-import-all").click();
    buttonIn(dialog, "references-panel-batch-duplicate-confirm").click();

    expect(await run).toEqual({ success: 2, failed: 0, cancelled: false });
  });

  it.each([
    ["the Cancel button", "cancel"],
    ["Escape", "escape"],
    ["a click beside the dialog", "backdrop"],
  ])("closes without importing on %s", async (_label, how) => {
    const entries = [entry("a", { localItemID: 1 }), entry("b")];
    const panel = setUpManager(entries);
    panel.manager.selectAll();

    const run = panel.manager.handleBatchImport(panel.anchor);
    const dialog = await panel.dialog();
    if (how === "cancel") {
      buttonIn(dialog, "references-panel-batch-duplicate-cancel").click();
    } else if (how === "escape") {
      panel.doc.dispatchEvent(
        new panel.dom.window.KeyboardEvent("keydown", { key: "Escape" }),
      );
    } else {
      // A click inside the dialog keeps it open
      dialog
        .querySelector(".zinspire-duplicate-dialog__content")!
        .dispatchEvent(
          new panel.dom.window.MouseEvent("click", { bubbles: true }),
        );
      expect(dialog.isConnected).toBe(true);
      dialog.dispatchEvent(new panel.dom.window.MouseEvent("click"));
    }

    expect(await run).toBeNull();
    expect(dialog.isConnected).toBe(false);
    expect(panel.options.promptForSaveTarget).not.toHaveBeenCalled();
    expect(panel.options.importReference).not.toHaveBeenCalled();
    expect(panel.selected()).toEqual(["a", "b"]);
  });

  it("has nothing to import when every duplicate is skipped", async () => {
    const panel = setUpManager([entry("a", { localItemID: 1 })]);
    panel.manager.selectAll();

    const run = panel.manager.handleBatchImport(panel.anchor);
    const dialog = await panel.dialog();
    buttonIn(dialog, "references-panel-batch-duplicate-confirm").click();

    expect(await run).toBeNull();
    expect(panel.options.showToast).toHaveBeenCalledWith(
      msg("references-panel-batch-no-selection"),
    );
    expect(panel.options.promptForSaveTarget).not.toHaveBeenCalled();
  });
});

describe("batch import", () => {
  it("needs a selected entry with an INSPIRE record", async () => {
    const panel = setUpManager([
      entry("a"),
      entry("noRecord", { recid: undefined }),
    ]);

    expect(await panel.manager.handleBatchImport(panel.anchor)).toBeNull();
    panel.click("noRecord");
    expect(await panel.manager.handleBatchImport(panel.anchor)).toBeNull();

    expect(panel.options.showToast).toHaveBeenCalledTimes(2);
    expect(panel.options.showToast).toHaveBeenLastCalledWith(
      msg("references-panel-batch-no-selection"),
    );
    expect(library.findItemsByRecids).not.toHaveBeenCalled();
    expect(panel.options.promptForSaveTarget).not.toHaveBeenCalled();
  });

  it("imports nothing when no save target is chosen", async () => {
    const panel = setUpManager([entry("a")]);
    panel.options.promptForSaveTarget.mockResolvedValue(null);
    panel.manager.selectAll();

    expect(await panel.manager.handleBatchImport(panel.anchor)).toBeNull();
    expect(panel.options.importReference).not.toHaveBeenCalled();
    expect(progressWindows).toHaveLength(0);
    expect(panel.selected()).toEqual(["a"]);
  });

  it("imports three at a time, counts failures, and reports the outcome", async () => {
    const ids = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"];
    const entries = ids.map((id) =>
      entry(id, { displayText: "stale", searchText: "stale" }),
    );
    // Outcome per entry: the new item's ID, no item, or an error
    const outcomes: Record<string, number | null | Error> = {
      r1: 101,
      r2: null,
      r3: new Error("offline"),
      r4: 104,
      r5: 105,
      r6: null,
      r7: 107,
    };
    const panel = setUpManager(entries);
    const imports = holdImports(panel.options);
    panel.manager.selectAll();

    const run = panel.manager.handleBatchImport(panel.anchor);
    for (let i = 0; i < ids.length; i++) {
      await vi.waitFor(() => expect(imports.calls.length).toBeGreaterThan(i));
      if (i === 0) {
        await vi.waitFor(() => expect(imports.calls).toHaveLength(3));
      }
      imports.calls[i].settle(outcomes[ids[i]]);
    }
    const result = await run;

    expect(result).toEqual({ success: 4, failed: 3, cancelled: false });
    expect(imports.maxInFlight()).toBe(3);
    expect(imports.calls.map((call) => call.recid)).toEqual(
      ids.map((id) => `rec-${id}`),
    );
    expect(imports.calls.every((call) => call.target === TARGET)).toBe(true);

    const imported = entries.filter((e) => typeof outcomes[e.id] === "number");
    for (const e of imported) {
      expect(e.localItemID).toBe(outcomes[e.id]);
      expect(e.displayText).toBe(`Guo: Paper ${e.id};`);
      expect(e.searchText).toBe("");
    }
    expect(
      panel.options.updateRowStatus.mock.calls.map(([e]) => e.id).sort(),
    ).toEqual(["r1", "r4", "r5", "r7"]);
    for (const e of entries.filter((e) => !imported.includes(e))) {
      expect(e.localItemID).toBeUndefined();
      expect(e.displayText).toBe("stale");
    }
    // What failed stays selected, ready for another try
    expect(panel.selected()).toEqual(["r2", "r3", "r6"]);
    expect(panel.ticked()).toEqual(["r2", "r3", "r6"]);
    expect(panel.options.onSelectionChange).toHaveBeenLastCalledWith(3);

    expect(panel.options.showToast).toHaveBeenLastCalledWith(
      msg("references-panel-batch-import-partial", {
        success: 4,
        total: 7,
        failed: 3,
      }),
    );
    expect(progressWindows).toHaveLength(1);
    const [progress] = progressWindows;
    expect(progress.lines).toHaveLength(8);
    expect(progress.lines[0]).toEqual({
      text: msg("references-panel-batch-importing", { done: 0, total: 7 }),
      progress: 0,
    });
    expect(progress.lines[3]).toEqual({
      text: msg("references-panel-batch-importing", { done: 3, total: 7 }),
      progress: 43,
    });
    expect(progress.lines[7]).toEqual({
      text: msg("references-panel-batch-importing", { done: 7, total: 7 }),
      progress: 100,
    });
    expect(progress.closed).toBe(true);
  });

  it("reports how many were imported when all succeed", async () => {
    const panel = setUpManager([entry("a"), entry("b")]);
    panel.options.importReference.mockResolvedValue({ id: 100 } as any);
    panel.manager.selectAll();

    expect(await panel.manager.handleBatchImport(panel.anchor)).toEqual({
      success: 2,
      failed: 0,
      cancelled: false,
    });
    expect(panel.options.showToast).toHaveBeenLastCalledWith(
      msg("references-panel-batch-import-success", { count: 2 }),
    );
    expect(panel.selected()).toEqual([]);
    expect(panel.options.onSelectionChange).toHaveBeenLastCalledWith(0);
  });

  it("stops starting new imports on Escape and says how many were done", async () => {
    const ids = ["r1", "r2", "r3", "r4", "r5"];
    const panel = setUpManager(ids.map((id) => entry(id)));
    const imports = holdImports(panel.options);
    panel.manager.selectAll();
    const escape = () => {
      const event = new panel.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      });
      panel.dom.window.dispatchEvent(event);
      return event;
    };

    const run = panel.manager.handleBatchImport(panel.anchor);
    await vi.waitFor(() => expect(imports.calls).toHaveLength(3));
    expect(escape().defaultPrevented).toBe(true);
    for (const call of imports.calls) call.settle(100);
    const result = await run;

    expect(result).toEqual({ success: 3, failed: 0, cancelled: true });
    expect(imports.calls).toHaveLength(3);
    expect(panel.options.showToast).toHaveBeenLastCalledWith(
      msg("references-panel-batch-import-cancelled", { done: 3, total: 5 }),
    );
    expect(panel.selected()).toEqual(["r4", "r5"]);
    expect(progressWindows[0].closed).toBe(true);
    // Once the import is over, Escape is left to the rest of Zotero
    expect(escape().defaultPrevented).toBe(false);
  });
});

describe("References panel batch toolbar and selection", () => {
  /**
   * A panel controller on jsdom with its real toolbar, list click handling
   * and BatchImportManager; the list shows `entries` through the panel's
   * own filter, as rows drawn by the panel's row renderer.
   */
  function setUpPanel(entries: InspireReferenceEntry[]) {
    const dom = new JSDOM(
      "<!DOCTYPE html><body><div class='panel'><div class='list'></div></div></body>",
      { url: "https://zotero.test/" },
    );
    const doc = dom.window.document;
    (globalThis as any).Zotero.getMainWindow = () => dom.window;
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      body: doc.querySelector(".panel"),
      listEl: doc.querySelector(".list"),
      allEntries: entries,
      viewMode: "references",
      filterText: "",
      chartSelectedBins: new Set(),
      authorFilterEnabled: false,
      publishedOnlyFilterEnabled: false,
      quickFilters: new Set(),
      excludeSelfCitations: false,
      entryRenderer: new EntryListRenderer({ document: doc, maxPoolSize: 50 }),
      rowCache: new Map(),
      getFirstPdfAttachmentID: () => null,
    });
    controller.batchImport = new BatchImportManager(
      controller.getBatchImportOptions(),
    );
    controller.createBatchToolbar();

    /** Draw the rows in view into a new list element, as the panel does. */
    const redraw = () => {
      controller.cleanupEventDelegation();
      const next = doc.createElement("div");
      controller.listEl.replaceWith(next);
      controller.listEl = next;
      controller.setupEventDelegation();
      controller.rowCache.clear();
      for (const e of controller.getFilteredEntries(controller.allEntries)) {
        next.appendChild(controller.createReferenceRow(e));
      }
    };
    redraw();

    const toolbar = doc.querySelector(".zinspire-batch-toolbar") as HTMLElement;
    return {
      dom,
      controller,
      toolbar,
      redraw,
      row: (id: string) =>
        controller.listEl.querySelector(
          `.zinspire-ref-entry[data-entry-id="${id}"]`,
        ) as HTMLElement,
      click: (id: string) => checkboxOf(controller.listEl, id).click(),
      ticked: () => tickedIn(controller.listEl).sort(),
      selected: () => [...controller.batchImport.getSelectedEntryIDs()].sort(),
      badge: () =>
        toolbar.querySelector(".zinspire-batch-toolbar__badge")!.textContent,
    };
  }

  it("shows the toolbar with the count while rows are ticked", () => {
    const panel = setUpPanel([entry("a"), entry("b"), entry("c")]);
    expect(panel.toolbar.style.display).toBe("none");
    expect(panel.toolbar.nextElementSibling).toBe(panel.controller.listEl);

    panel.click("b");
    expect(panel.selected()).toEqual(["b"]);
    expect(panel.toolbar.style.display).toBe("flex");
    expect(panel.badge()).toBe(
      msg("references-panel-batch-selected", { count: 1 }),
    );
    // Rows drawn later show the same selection
    panel.redraw();
    expect(panel.ticked()).toEqual(["b"]);

    buttonIn(panel.toolbar, "references-panel-batch-clear").click();
    expect(panel.selected()).toEqual([]);
    expect(panel.ticked()).toEqual([]);
    expect(panel.toolbar.style.display).toBe("none");
  });

  it("selects all rows that pass the panel's filter", () => {
    // The filter searches the text shown for each row
    const panel = setUpPanel([
      entry("a", { displayText: "Guo: Hidden-charm pentaquarks;" }),
      entry("b", { displayText: "Guo: Tetraquark candidates;" }),
      entry("c", { displayText: "Guo: Pentaquark photoproduction;" }),
    ]);
    panel.controller.filterText = "pentaquark";
    panel.redraw();

    buttonIn(panel.toolbar, "references-panel-batch-select-all").click();

    expect(panel.selected()).toEqual(["a", "c"]);
    expect(panel.ticked()).toEqual(["a", "c"]);
    expect(panel.badge()).toBe(
      msg("references-panel-batch-selected", { count: 2 }),
    );
  });

  it("imports the ticked rows into the save target picked at the Import button", async () => {
    const panel = setUpPanel([entry("a"), entry("b")]);
    const { controller } = panel;
    controller.promptForSaveTarget = vi.fn().mockResolvedValue(TARGET);
    controller.importReference = vi.fn().mockResolvedValue({ id: 50 });
    controller.showToast = vi.fn();
    const marker = (id: string) =>
      panel.row(id).querySelector(".zinspire-ref-entry__dot") as HTMLElement;
    expect(marker("a").dataset.state).not.toBe("local");

    panel.click("a");
    buttonIn(panel.toolbar, "references-panel-batch-import").click();
    await vi.waitFor(() =>
      expect(controller.showToast).toHaveBeenCalledWith(
        msg("references-panel-batch-import-success", { count: 1 }),
      ),
    );

    expect(controller.promptForSaveTarget).toHaveBeenCalledOnce();
    expect(controller.promptForSaveTarget.mock.calls[0][0]).toBe(
      buttonIn(panel.toolbar, "references-panel-batch-import"),
    );
    expect(controller.importReference).toHaveBeenCalledWith("rec-a", TARGET);
    expect(controller.allEntries[0].localItemID).toBe(50);
    // The imported row now shows the entry as in the library
    expect(marker("a").dataset.state).toBe("local");
    expect(marker("b").dataset.state).not.toBe("local");
    expect(panel.selected()).toEqual([]);
    expect(panel.ticked()).toEqual([]);
    expect(panel.toolbar.style.display).toBe("none");
  });

  it("lets a running import finish when the panel is closed", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const panel = setUpPanel(ids.map((id) => entry(id)));
    const { controller } = panel;
    // State that destroy() clears
    Object.assign(controller, {
      referencesCache: new Map(),
      citedByCache: new Map(),
      relatedCache: new Map(),
      entryCitedCache: new Map(),
      metadataCache: new Map(),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
    });
    controller.promptForSaveTarget = vi.fn().mockResolvedValue(TARGET);
    controller.showToast = vi.fn();
    const pending: Array<() => void> = [];
    controller.importReference = vi.fn(
      () => new Promise((resolve) => pending.push(() => resolve({ id: 1 }))),
    );

    buttonIn(panel.toolbar, "references-panel-batch-select-all").click();
    buttonIn(panel.toolbar, "references-panel-batch-import").click();
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    controller.destroy();
    for (let i = 0; i < ids.length; i++) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(i));
      pending[i]();
    }

    await vi.waitFor(() =>
      expect(controller.showToast).toHaveBeenCalledWith(
        msg("references-panel-batch-import-success", { count: 5 }),
      ),
    );
    expect(controller.importReference).toHaveBeenCalledTimes(5);
  });

  it("exports the ticked rows, or every row when none is ticked", async () => {
    const panel = setUpPanel([entry("a"), entry("b"), entry("c")]);
    network.inspireFetch.mockResolvedValue({
      ok: true,
      text: async () => "@article{x,\n}",
    });
    /** The INSPIRE query of a BibTeX export to the clipboard. */
    const exportedQuery = async () => {
      network.inspireFetch.mockClear();
      await panel.controller.exportEntries("bibtex", "clipboard");
      expect(network.inspireFetch).toHaveBeenCalledOnce();
      return new URL(network.inspireFetch.mock.calls[0][0]).searchParams.get(
        "q",
      );
    };

    panel.click("a");
    panel.click("c");
    expect(await exportedQuery()).toBe("recid:rec-a OR recid:rec-c");
    buttonIn(panel.toolbar, "references-panel-batch-clear").click();
    expect(await exportedQuery()).toBe(
      "recid:rec-a OR recid:rec-b OR recid:rec-c",
    );
    expect(clipboard.copyToClipboard).toHaveBeenCalledTimes(2);
  });

  it("clears the selection and its ticks when another item is selected", async () => {
    const panel = setUpPanel([entry("a"), entry("b"), entry("c")]);
    const { controller } = panel;
    // In the Search tab the list is kept (not redrawn) when the item changes
    Object.assign(controller, {
      viewMode: "search",
      currentItemID: 7,
      labelMatcherCache: new Map(),
      isFavoritesViewActive: false,
      clearAutoCheckNotification: vi.fn(),
      restoreScrollPositionIfNeeded: vi.fn(),
    });
    panel.click("a");
    panel.click("c");
    expect(panel.toolbar.style.display).toBe("flex");

    const item = { id: 42, isRegularItem: () => true, getField: () => "" };
    await controller.handleItemChange({ tabType: "library", item } as any, {
      loadData: false,
    });

    expect(controller.currentItemID).toBe(42);
    expect(panel.selected()).toEqual([]);
    expect(panel.ticked()).toEqual([]);
    expect(panel.toolbar.style.display).toBe("none");
  });
});

describe("References panel built by its constructor", () => {
  /** The part of zotero-plugin-toolkit's UI.appendElement the panel uses. */
  function buildElement(doc: Document, spec: any): Element {
    const el =
      spec.namespace === "svg"
        ? doc.createElementNS("http://www.w3.org/2000/svg", spec.tag)
        : doc.createElement(spec.tag);
    if (spec.id) el.id = spec.id;
    for (const name of spec.classList ?? []) el.classList.add(name);
    for (const [key, value] of Object.entries(spec.attributes ?? {})) {
      if (value !== undefined) el.setAttribute(key, String(value));
    }
    for (const [key, value] of Object.entries(spec.properties ?? {})) {
      (el as any)[key] = value;
    }
    for (const [key, value] of Object.entries(spec.styles ?? {})) {
      (el as any).style[key] = value;
    }
    for (const { type, listener, options } of spec.listeners ?? []) {
      el.addEventListener(type, listener, options);
    }
    for (const child of spec.children ?? []) {
      el.appendChild(buildElement(doc, child));
    }
    return el;
  }

  it("selects from the list shown now and imports what is ticked", async () => {
    const dom = new JSDOM(
      "<!DOCTYPE html><body><div class='pane'></div></body>",
      { url: "https://zotero.test/" },
    );
    const doc = dom.window.document;
    Object.assign((globalThis as any).Zotero, {
      getMainWindow: () => dom.window,
      Notifier: {
        registerObserver: () => "observer",
        unregisterObserver: vi.fn(),
      },
      Items: { get: () => null },
    });
    Object.assign((globalThis as any).ztoolkit, {
      UI: {
        appendElement: (spec: any, parent: Element) =>
          parent.appendChild(buildElement(doc, spec)),
      },
      getGlobal: (name: string) => (dom.window as any)[name],
    });
    const controller = new InspireReferencePanelController(
      doc.querySelector(".pane") as HTMLDivElement,
    ) as any;
    try {
      controller.promptForSaveTarget = vi.fn().mockResolvedValue(TARGET);
      controller.importReference = vi.fn(async () => ({ id: 60 }));
      controller.showToast = vi.fn();
      const toolbar = doc.querySelector(
        ".zinspire-batch-toolbar",
      ) as HTMLElement;
      const rows = () =>
        [...controller.listEl.querySelectorAll(".zinspire-ref-entry")].map(
          (row: HTMLElement) => row.dataset.entryId,
        );
      /** Load entries and draw them, as the panel does for a new list. */
      const show = async (ids: string[]) => {
        controller.allEntries = ids.map((id) => entry(id));
        controller.renderReferenceList();
        await vi.waitFor(() => expect(rows()).toEqual(ids));
      };

      // The constructor already swaps in a new list element (for its empty
      // message); the toolbar sits right before it once the old one is gone.
      await vi.waitFor(() =>
        expect(toolbar.nextElementSibling === controller.listEl).toBe(true),
      );
      await show(["a", "b"]);
      checkboxOf(controller.listEl, "a").click();
      expect(toolbar.style.display).toBe("flex");
      buttonIn(toolbar, "references-panel-batch-clear").click();
      expect(toolbar.style.display).toBe("none");

      // Another list replaces both the entries and the list element
      const firstList = controller.listEl;
      await show(["c", "d", "e"]);
      // (Compared by identity: vitest would walk two jsdom elements)
      expect(controller.listEl === firstList).toBe(false);
      buttonIn(toolbar, "references-panel-batch-select-all").click();
      expect(tickedIn(controller.listEl).sort()).toEqual(["c", "d", "e"]);
      expect(
        toolbar.querySelector(".zinspire-batch-toolbar__badge")!.textContent,
      ).toBe(msg("references-panel-batch-selected", { count: 3 }));

      buttonIn(toolbar, "references-panel-batch-import").click();
      await vi.waitFor(() =>
        expect(controller.showToast).toHaveBeenCalledWith(
          msg("references-panel-batch-import-success", { count: 3 }),
        ),
      );
      expect(
        controller.importReference.mock.calls.map(([recid]: [string]) => recid),
      ).toEqual(["rec-c", "rec-d", "rec-e"]);
      expect(tickedIn(controller.listEl)).toEqual([]);
      expect(toolbar.style.display).toBe("none");
    } finally {
      controller.destroy();
    }
  });
});
