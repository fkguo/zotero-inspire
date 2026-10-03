import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The arXiv window, its menus, the snapshot functions and the progress popups,
// recorded by the tests
const mocks = vi.hoisted(() => ({
  openArxivBrowser: vi.fn(),
  showMenu: vi.fn(),
  htmlSnapshotID: vi.fn((): number | null => null),
  saveArxivHtmlVersion: vi.fn(),
  notify: vi.fn(),
  progressClose: vi.fn(),
  startProgress: vi.fn(),
  /** Replaces the library lookup before an add, when set */
  lookup: null as null | ((entries: any[]) => Promise<any[]>),
}));
vi.mock("../src/modules/arxiv/browser/browserWindow", () => ({
  openArxivBrowser: mocks.openArxivBrowser,
}));
vi.mock("../src/modules/arxiv/browser/dom", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/arxiv/browser/dom")
  >()),
  showMenu: mocks.showMenu,
}));
vi.mock("../src/modules/arxiv/arxivHtmlSnapshot", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/arxiv/arxivHtmlSnapshot")
  >()),
  htmlSnapshotID: mocks.htmlSnapshotID,
  saveArxivHtmlVersion: mocks.saveArxivHtmlVersion,
}));
vi.mock(
  "../src/modules/inspire/library/localStatus",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("../src/modules/inspire/library/localStatus")
      >();
    return {
      ...real,
      refreshLocalState: (entries: any[]) =>
        (mocks.lookup ?? real.refreshLocalState)(entries),
    };
  },
);
vi.mock("../src/modules/inspire/panel/reporter", () => ({
  popupReporter: {
    notify: mocks.notify,
    startProgress: mocks.startProgress,
  },
}));

import { config } from "../package.json";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import { stopLibraryIndex } from "../src/modules/inspire/library/arxivIndex";

// "HTML" after a paper's arXiv number in the References panel: a click opens
// the menu of arXiv's HTML version — show it in the arXiv browser, save it as
// a snapshot (a paper not in the library is added first), and open the
// snapshot once saved.

const ITEM = { id: 900, libraryID: 1, getField: () => "Dπ femtoscopy" };

beforeEach(() => {
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Prefs: { get: () => undefined },
    Notifier: {
      registerObserver: () => "observer",
      unregisterObserver: vi.fn(),
    },
    Items: {
      get: (id: number) =>
        id === ITEM.id ? ITEM : id === 901 ? { ...ITEM, id } : null,
    },
    Libraries: { get: () => ({ name: "My Library" }) },
    // An empty library: a paper is looked up there before it is added
    ItemFields: { getID: () => 1 },
    ItemTypes: { getID: () => 2 },
    DB: { queryAsync: async () => [] },
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
  mocks.lookup = null;
  for (const mock of Object.values(mocks)) mock?.mockReset();
  mocks.htmlSnapshotID.mockReturnValue(null);
  mocks.startProgress.mockReturnValue({
    update: vi.fn(),
    close: mocks.progressClose,
  });
  mocks.saveArxivHtmlVersion.mockResolvedValue({
    status: "saved",
    version: 2,
    attachmentID: 77,
  });
});
afterEach(() => {
  panel?.controller.destroy();
  panel = undefined;
  stopLibraryIndex();
  vi.unstubAllGlobals();
});

function msg(key: string, args?: Record<string, unknown>) {
  return `${config.addonRef}-${key}${args ? ` ${JSON.stringify(args)}` : ""}`;
}

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

let panel: ReturnType<typeof openPanel> | undefined;

/** A panel built by its constructor on jsdom, showing `entries`. */
function openPanel() {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><div class='pane'></div></body>",
    { url: "https://zotero.test/" },
  );
  const doc = dom.window.document;
  Object.assign((globalThis as any).Zotero, {
    getMainWindow: () => dom.window,
  });
  vi.stubGlobal("ztoolkit", {
    UI: {
      appendElement: (spec: any, parent: Element) =>
        parent.appendChild(buildElement(doc, spec)),
    },
    getGlobal: (name: string) => (dom.window as any)[name],
  });
  const controller = new InspireReferencePanelController(
    doc.querySelector(".pane") as HTMLDivElement,
  ) as any;
  const show = async (entries: InspireReferenceEntry[]) => {
    controller.allEntries = entries;
    controller.renderReferenceList();
    await vi.waitFor(() =>
      expect(
        controller.listEl.querySelectorAll(".zinspire-ref-entry").length,
      ).toBe(entries.length),
    );
  };
  return { controller, show };
}

function paper(fields: Partial<InspireReferenceEntry> = {}) {
  return {
    id: "0-2001",
    recid: "2001",
    title: "The Dπ and D*π femtoscopy puzzle",
    year: "2026",
    authors: ["Encarnación, Pablo"],
    authorText: "Encarnación, Pablo",
    displayText: "",
    searchText: "",
    arxivDetails: { id: "2609.35133" },
    ...fields,
  } as InspireReferenceEntry;
}

/** Click "HTML" of the panel's (only) row: the menu's entries */
async function openMenu(entry: InspireReferenceEntry) {
  panel?.controller.destroy();
  panel = openPanel();
  await panel.show([entry]);
  const html = panel.controller.listEl.querySelector(
    ".zinspire-ref-entry__html",
  ) as HTMLElement;
  html.click();
  expect(mocks.showMenu).toHaveBeenCalledTimes(1);
  const [anchor, entries] = mocks.showMenu.mock.calls[0];
  expect(anchor).toBe(html);
  return entries as Array<{ label: string; run: () => void }>;
}

describe("HTML after the arXiv number in the References panel", () => {
  it("opens a menu: show in the arXiv browser, save; open the snapshot once saved", async () => {
    const entries = await openMenu(paper());
    expect(entries.map((e) => e.label)).toEqual([
      msg("references-panel-arxiv-html-show"),
      msg("arxiv-browser-html-menu-save"),
    ]);
    // The row is not focused by the click
    expect(panel!.controller.focusedEntryID).toBeUndefined();

    entries[0].run();
    expect(mocks.openArxivBrowser).toHaveBeenCalledExactlyOnceWith({
      id: "2609.35133",
      title: "The Dπ and D*π femtoscopy puzzle",
    });

    // A paper with a snapshot among its items
    mocks.showMenu.mockReset();
    mocks.htmlSnapshotID.mockImplementation(((itemID: number) =>
      itemID === 901 ? 77 : null) as any);
    const saved = await openMenu(
      paper({ localItemID: 900, localItemIDs: [900, 901] }),
    );
    expect(saved.map((e) => e.label)).toEqual([
      msg("references-panel-arxiv-html-show"),
      msg("arxiv-browser-html-menu-save"),
      msg("arxiv-browser-html-menu-open"),
    ]);
    expect(mocks.htmlSnapshotID).toHaveBeenCalledWith(900, "2609.35133");
    expect(mocks.htmlSnapshotID).toHaveBeenCalledWith(901, "2609.35133");
  });

  it("saves the newest HTML version of a paper in the library to its item", async () => {
    const entries = await openMenu(paper({ localItemID: ITEM.id }));
    entries[1].run();

    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    expect(mocks.startProgress).toHaveBeenCalledExactlyOnceWith(
      msg("arxiv-browser-html-saving", { id: "2609.35133" }),
    );
    expect(mocks.saveArxivHtmlVersion).toHaveBeenCalledExactlyOnceWith(
      ITEM,
      "2609.35133",
      undefined,
    );
    expect(mocks.progressClose).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(
      msg("arxiv-browser-html-saved", { id: "2609.35133", version: 2 }),
    );
  });

  it("adds a paper not in the library first, where the user chooses, then saves", async () => {
    const entry = paper();
    const entries = await openMenu(entry);
    const { controller } = panel!;
    controller.promptForSaveTarget = vi.fn().mockResolvedValue({
      libraryID: 1,
      primaryRowID: "L1",
      collectionIDs: [],
      tags: [],
      note: "",
    });
    controller.importReference = vi.fn().mockResolvedValue(ITEM);

    entries[1].run();

    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    expect(controller.importReference).toHaveBeenCalledWith(
      "2001",
      expect.objectContaining({ libraryID: 1 }),
    );
    expect(entry.localItemID).toBe(ITEM.id);
    expect(mocks.saveArxivHtmlVersion).toHaveBeenCalledExactlyOnceWith(
      ITEM,
      "2609.35133",
      undefined,
    );
  });

  it("saves to the item the library lookup before the add finds", async () => {
    const entry = paper();
    const entries = await openMenu(entry);
    const { controller } = panel!;
    controller.promptForSaveTarget = vi.fn();
    controller.importReference = vi.fn();
    // Added meanwhile from elsewhere: its mark had not caught up
    mocks.lookup = async (looked) => {
      looked[0].localItemID = ITEM.id;
      return looked;
    };

    entries[1].run();

    await vi.waitFor(() => expect(mocks.saveArxivHtmlVersion).toHaveBeenCalled());
    expect(controller.promptForSaveTarget).not.toHaveBeenCalled();
    expect(controller.importReference).not.toHaveBeenCalled();
    expect(mocks.saveArxivHtmlVersion).toHaveBeenCalledExactlyOnceWith(
      ITEM,
      "2609.35133",
      undefined,
    );
  });

  it("saves nothing when the user chooses no place to add the paper", async () => {
    const entries = await openMenu(paper());
    const { controller } = panel!;
    controller.promptForSaveTarget = vi.fn().mockResolvedValue(null);
    controller.importReference = vi.fn();

    entries[1].run();

    await vi.waitFor(() =>
      expect(controller.promptForSaveTarget).toHaveBeenCalled(),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.importReference).not.toHaveBeenCalled();
    expect(mocks.saveArxivHtmlVersion).not.toHaveBeenCalled();
    expect(mocks.startProgress).not.toHaveBeenCalled();
  });

  it("saves a paper once while its save goes on", async () => {
    let finish!: (outcome: unknown) => void;
    mocks.saveArxivHtmlVersion.mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    const entries = await openMenu(paper({ localItemID: ITEM.id }));
    entries[1].run();
    entries[1].run();
    await vi.waitFor(() =>
      expect(mocks.saveArxivHtmlVersion).toHaveBeenCalled(),
    );
    finish({ status: "there", version: 1, attachmentID: 77 });
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    expect(mocks.saveArxivHtmlVersion).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(
      msg("arxiv-browser-html-there", { id: "2609.35133", version: 1 }),
    );

    // Done: it can be saved again
    entries[1].run();
    await vi.waitFor(() =>
      expect(mocks.saveArxivHtmlVersion).toHaveBeenCalledTimes(2),
    );
  });
});
