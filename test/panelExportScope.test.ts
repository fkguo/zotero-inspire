import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { getString } from "../src/utils/locale";

// Which entries the References panel's export menu works on: the checked
// entries if there are any, otherwise every entry that passes the list
// filters -- the entries "Select all" would check -- including those not
// rendered yet.

function entry(
  recid: string,
  displayText: string,
  year: string,
): InspireReferenceEntry {
  return {
    id: `entry-${recid}`,
    recid,
    title: displayText,
    year,
    authors: [],
    authorText: "",
    displayText,
    searchText: "",
  };
}

// The text filter "pentaquark" keeps 1 and 3; the chart bar 2019 keeps 2 and 3.
function createController({
  checked = [] as string[],
  filterText = "",
  chartBins = [] as string[],
} = {}) {
  const controller = Object.create(
    InspireReferencePanelController.prototype,
  ) as any;
  Object.assign(controller, {
    allEntries: [
      entry("1", "Hidden-charm pentaquarks", "2015"),
      entry("2", "Tetraquark candidates", "2019"),
      entry("3", "Pentaquark models", "2019"),
      entry("4", "Glueball spectrum", "2021"),
    ],
    // Only one row is rendered so far; the others wait behind "Load more".
    renderedCount: 1,
    batchImport: {
      getSelectedEntryIDs: () =>
        new Set(checked.map((recid) => `entry-${recid}`)),
    },
    filterText,
    chartViewMode: "year",
    chartSelectionMode: "year",
    chartSelectedBins: new Set(chartBins),
    authorFilterEnabled: false,
    publishedOnlyFilterEnabled: false,
    quickFilters: new Set(),
    excludeSelfCitations: false,
  });
  return controller;
}

const recids = (entries: InspireReferenceEntry[]) =>
  entries.map((e) => e.recid);

// A stand-in for the XUL elements the export menu is built from.
class MenuNode {
  id = "";
  attributes = new Map<string, string>();
  children: MenuNode[] = [];
  commands: Array<() => void> = [];
  openPopup = vi.fn();
  remove = vi.fn();
  constructor(readonly tagName: string) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  appendChild(child: MenuNode) {
    this.children.push(child);
    return child;
  }
  addEventListener(type: string, listener: () => void) {
    if (type === "command") this.commands.push(listener);
  }
}

// Open the export menu and return its items in order (none if it did not
// open).
function openExportMenu(controller: any) {
  let popup: MenuNode | undefined;
  controller.body = {
    ownerDocument: {
      getElementById: () => null,
      querySelectorAll: () => [],
      createXULElement: (tagName: string) => {
        const node = new MenuNode(tagName);
        if (tagName === "menupopup") popup = node;
        return node;
      },
      documentElement: { appendChild: vi.fn() },
    },
  };
  const button = {
    matches: () => true,
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
    parentElement: null,
  };
  controller.showExportMenu({ target: button });
  return (popup?.children ?? [])
    .filter((node) => node.tagName === "menuitem")
    .map((node) => ({
      label: node.attributes.get("label")!,
      disabled: node.attributes.get("disabled") === "true",
      choose: () => node.commands.forEach((command) => command()),
    }));
}

type MenuItem = ReturnType<typeof openExportMenu>[number];

// Section headers are the items that are not indented.
const headers = (items: MenuItem[]) =>
  items.filter((item) => !item.label.startsWith(" ")).map((i) => i.label);
const findItem = (items: MenuItem[], key: string) =>
  items.find((item) => item.label.trim() === getString(key as any))!;
// The BibTeX items: the first copies to the clipboard, the second saves a file.
const bibtexItems = (items: MenuItem[]) =>
  items.filter((item) => item.label.trim() === "BibTeX (.bib)");

// Progress windows opened by the menu and the exports, in order.
let progressWindows: ProgressWindowStub[] = [];

class ProgressWindowStub {
  win = { changeHeadline: vi.fn() };
  createLine = vi.fn();
  changeLine = vi.fn();
  show = vi.fn();
  close = vi.fn();
  constructor() {
    progressWindows.push(this);
  }
}

describe("References panel export scope", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let copyText: ReturnType<typeof vi.fn>;
  let saveFile: ReturnType<typeof vi.fn>;
  let HEADERS: string[];

  beforeEach(() => {
    // Progress windows close themselves after a delay; keep those timers
    // from outliving the test.
    vi.useFakeTimers();
    progressWindows = [];
    fetchMock = vi.fn(async () => new Response("@article{x,}"));
    copyText = vi.fn();
    saveFile = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("addon", { data: {} });
    vi.stubGlobal("ztoolkit", { ProgressWindow: ProgressWindowStub });
    vi.stubGlobal("Zotero", {
      debug: vi.fn(),
      File: { putContentsAsync: saveFile },
      Utilities: { Internal: { copyTextToClipboard: copyText } },
    });
    HEADERS = [
      getString("references-panel-export-copy-header"),
      getString("references-panel-export-file-header"),
      getString("references-panel-export-citation-header"),
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // The recids asked from INSPIRE, in order.
  const requestedRecids = () =>
    fetchMock.mock.calls.flatMap(([url]) =>
      [...decodeURIComponent(String(url)).matchAll(/recid:(\d+)/g)].map(
        (match) => match[1],
      ),
    );

  // Choose a BibTeX item of the menu and wait until the export has finished.
  async function exportBibTeX(controller: any, items: MenuItem[], nth = 0) {
    const exported = vi.spyOn(controller, "exportEntries");
    bibtexItems(items)[nth].choose();
    await exported.mock.results[0].value;
  }

  it.each([
    ["no filter", {}, ["1", "2", "3", "4"]],
    ["a text filter", { filterText: "pentaquark" }, ["1", "3"]],
    ["a chart selection", { chartBins: ["2019"] }, ["2", "3"]],
    [
      "checked entries, whatever the filter",
      { checked: ["2", "4"], filterText: "pentaquark" },
      ["2", "4"],
    ],
  ] as const)("copies the entries in scope with %s", async (_, scope, ids) => {
    const controller = createController(scope);
    await exportBibTeX(controller, openExportMenu(controller));
    expect(requestedRecids()).toEqual(ids);
    expect(copyText).toHaveBeenCalledOnce();
  });

  it("saves the filtered entries to a file", async () => {
    const controller = createController({ filterText: "pentaquark" });
    controller.promptSaveFile = vi.fn(async () => "references.bib");
    await exportBibTeX(controller, openExportMenu(controller), 1);
    expect(requestedRecids()).toEqual(["1", "3"]);
    expect(saveFile).toHaveBeenCalledOnce();
  });

  it("shows no counts when the menu works on the whole list", () => {
    const items = openExportMenu(createController());
    expect(headers(items)).toEqual(HEADERS);
    expect(
      findItem(items, "references-panel-export-copy-texkey").disabled,
    ).toBe(true);
  });

  it.each([
    ["a text filter", { filterText: "pentaquark" }, ["1", "3"]],
    ["a chart selection", { chartBins: ["2019"] }, ["2", "3"]],
  ] as const)(
    "counts the filtered entries with %s and nothing checked",
    (_, scope, ids) => {
      const controller = createController(scope);
      controller.handleCitationStyleExport = vi.fn();
      const items = openExportMenu(controller);
      expect(headers(items)).toEqual(HEADERS.map((header) => `${header} (2)`));
      // Copying TeX keys still needs checked entries.
      expect(
        findItem(items, "references-panel-export-copy-texkey").disabled,
      ).toBe(true);
      findItem(items, "references-panel-export-citation-select-style").choose();
      expect(
        recids(controller.handleCitationStyleExport.mock.calls[0][0]),
      ).toEqual(ids);
    },
  );

  it("counts and exports the checked entries", () => {
    const controller = createController({
      checked: ["2", "4"],
      filterText: "pentaquark",
    });
    controller.copyCitationKeys = vi.fn();
    controller.handleCitationStyleExport = vi.fn();
    const items = openExportMenu(controller);
    expect(headers(items)).toEqual(HEADERS.map((header) => `${header} (2)`));
    findItem(items, "references-panel-export-copy-texkey").choose();
    expect(recids(controller.copyCitationKeys.mock.calls[0][0])).toEqual([
      "2",
      "4",
    ]);
    findItem(items, "references-panel-export-citation-select-style").choose();
    expect(
      recids(controller.handleCitationStyleExport.mock.calls[0][0]),
    ).toEqual(["2", "4"]);
  });

  it.each([
    ["a text filter", { filterText: "pentaquark" }, ["1", "3"]],
    ["no filter", {}, ["1", "2", "3", "4"]],
  ] as const)(
    "exports what the menu offered when more entries arrive meanwhile, with %s",
    async (_, scope, ids) => {
      const controller = createController(scope);
      controller.handleCitationStyleExport = vi.fn();
      const items = openExportMenu(controller);
      // The list is still loading: the next page is appended to the same
      // array, as the loader does, with another matching entry.
      controller.allEntries.push(entry("5", "Pentaquark decays", "2023"));
      await exportBibTeX(controller, items);
      expect(requestedRecids()).toEqual(ids);
      findItem(items, "references-panel-export-citation-select-style").choose();
      expect(
        recids(controller.handleCitationStyleExport.mock.calls[0][0]),
      ).toEqual(ids);
    },
  );

  it("opens no menu when the filter matches no entry", () => {
    const items = openExportMenu(createController({ filterText: "axion" }));
    expect(items).toEqual([]);
    expect(progressWindows[0].createLine).toHaveBeenCalledWith(
      expect.objectContaining({
        text: getString("references-panel-no-recid-entries"),
      }),
    );
  });
});
