import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import { stopLibraryIndex } from "../src/modules/inspire/library/arxivIndex";

// The link button of the References panel relates a paper to the item whose
// list the user is looking at; for a paper not yet in the library it first
// imports the paper, which takes a few seconds. These tests check which item
// the paper is related to when another item is selected meanwhile.

beforeEach(() => {
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Prefs: { get: () => undefined },
    Notifier: {
      registerObserver: () => "observer",
      unregisterObserver: vi.fn(),
    },
    Items: { get: () => null },
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
});
afterEach(() => {
  stopLibraryIndex();
  vi.unstubAllGlobals();
});

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

/** A References-panel entry as the panel builds it for a reference list. */
function paper(
  list: string,
  index: number,
  fields: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  const recid = `${list}${index}`;
  return {
    id: `${index}-${recid}`,
    recid,
    title: `Paper ${recid}`,
    year: "2024",
    authors: [`Author${recid}, A.`],
    authorText: `Author${recid}, A.`,
    displayText: "",
    searchText: "",
    citationCount: index,
    ...fields,
  };
}

/** A Zotero item that keeps its "related" relations, by item key. */
interface FakeItem {
  id: number;
  key: string;
  libraryID: number;
  deleted: boolean;
  relatedItems: string[];
  addRelatedItem(other: FakeItem): boolean;
  removeRelatedItem(other: FakeItem): boolean;
  saveTx(): Promise<void>;
}

/** The library the panel sees through Zotero.Items.get. */
function fakeLibrary() {
  const items = new Map<number, FakeItem>();
  (globalThis as any).Zotero.Items = {
    // Zotero answers false for an item that no longer exists
    get: (id: number) => items.get(id) ?? false,
  };
  return {
    add(id: number): FakeItem {
      const item: FakeItem = {
        id,
        key: `KEY${id}`,
        libraryID: 1,
        deleted: false,
        relatedItems: [],
        addRelatedItem(other) {
          if (this.relatedItems.includes(other.key)) return false;
          this.relatedItems.push(other.key);
          return true;
        },
        removeRelatedItem(other) {
          const index = this.relatedItems.indexOf(other.key);
          if (index < 0) return false;
          this.relatedItems.splice(index, 1);
          return true;
        },
        saveTx: async () => undefined,
      };
      items.set(id, item);
      return item;
    },
    /** Delete an item for good (emptied trash) */
    erase(id: number) {
      items.delete(id);
    },
  };
}

/** A panel built by its constructor on jsdom, showing the list of `itemID`. */
function openPanel(itemID: number) {
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
    ProgressWindow: class {
      win = { changeHeadline: () => undefined };
      createLine() {
        return this;
      }
      show() {
        return this;
      }
      startCloseTimer() {
        return this;
      }
    },
  });
  const controller = new InspireReferencePanelController(
    doc.querySelector(".pane") as HTMLDivElement,
  ) as any;
  controller.currentItemID = itemID;
  const notices = vi.spyOn(controller, "showToast");
  const rows = () =>
    [
      ...controller.listEl.querySelectorAll(".zinspire-ref-entry"),
    ] as HTMLElement[];
  /** Load a list and draw it, as the panel does for the selected item. */
  const show = async (entries: InspireReferenceEntry[]) => {
    controller.allEntries = entries;
    controller.renderReferenceList();
    await vi.waitFor(() =>
      expect(rows().map((row) => row.dataset.entryId)).toEqual(
        entries.map((e) => e.id),
      ),
    );
  };
  /** Another item is selected: the panel takes it as its item, then shows its list. */
  const select = async (id: number, entries: InspireReferenceEntry[]) => {
    controller.currentItemID = id;
    controller.renderMessage("Loading");
    await show(entries);
  };
  return { controller, notices, rows, select, show };
}

/** A promise and the function that fulfils it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** The link button's state in a row. */
const linkState = (row: HTMLElement) =>
  (row.querySelector(".zinspire-ref-entry__link") as HTMLElement).dataset.state;

const notice = (id: string) => `${config.addonRef}-${id}`;

describe("Link button on a paper not in the library", () => {
  let panel: ReturnType<typeof openPanel> | undefined;
  afterEach(() => {
    panel?.controller.destroy();
    panel = undefined;
  });

  /**
   * Click the link button in `row` and confirm the save target. INSPIRE
   * answers for the paper when the returned function is called with the new
   * library item; it resolves once the panel is done with the answer.
   */
  async function clickLink(row: HTMLElement) {
    const { controller } = panel!;
    controller.promptForSaveTarget = vi.fn().mockResolvedValue({
      libraryID: 1,
      primaryRowID: "L1",
      collectionIDs: [],
      tags: [],
      note: "",
    });
    const imported = deferred<FakeItem>();
    controller.importReference = vi.fn(() => imported.promise);
    const link = vi.spyOn(controller, "handleLinkAction");
    (row.querySelector(".zinspire-ref-entry__link") as HTMLElement).click();
    await vi.waitFor(() =>
      expect(controller.importReference).toHaveBeenCalled(),
    );
    return async (item: FakeItem) => {
      imported.resolve(item);
      await link.mock.results[0].value;
    };
  }

  const listA = () => [0, 1, 2, 3, 4].map((i) => paper("A", i));
  const listB = () => [0, 1, 2, 3, 4].map((i) => paper("B", i));

  it("relates the paper to the item it was clicked for when another item is selected during the import", async () => {
    const library = fakeLibrary();
    const itemA = library.add(42);
    const itemB = library.add(43);
    panel = openPanel(42);
    const { rows, select, show } = panel;
    const entries = listA();
    await show(entries);
    const finish = await clickLink(rows()[2]);

    // Item B is selected while INSPIRE is asked for the paper
    await select(43, listB());
    const added = library.add(901);
    await finish(added);

    expect(itemA.relatedItems).toEqual([added.key]);
    expect(added.relatedItems).toEqual([itemA.key]);
    expect(itemB.relatedItems).toEqual([]);
    expect(entries[2].localItemID).toBe(901);
    // Related to the item it was clicked for, not to the item shown now
    expect(panel.controller.isEntryRelated(entries[2], 42)).toBe(true);
    expect(panel.controller.isEntryRelated(entries[2])).toBe(false);
  });

  it("leaves the list of the item selected meanwhile as it is", async () => {
    const library = fakeLibrary();
    library.add(42);
    library.add(43);
    panel = openPanel(42);
    const { rows, select, show } = panel;
    await show(listA());
    const finish = await clickLink(rows()[2]);
    await select(43, listB());
    const shownRows = rows();

    await finish(library.add(901));

    // The same row elements, in the same order: that list was not redrawn
    const now = rows();
    expect(now.length).toBe(shownRows.length);
    expect(now.every((row, i) => row === shownRows[i])).toBe(true);
    expect(now.map(linkState)).toEqual(Array(5).fill("unlinked"));
  });

  it("relates the paper and shows it linked when no other item is selected", async () => {
    const library = fakeLibrary();
    const itemA = library.add(42);
    panel = openPanel(42);
    const { notices, rows, show } = panel;
    const entries = listA();
    await show(entries);
    const finish = await clickLink(rows()[2]);
    const added = library.add(901);
    await finish(added);

    expect(itemA.relatedItems).toEqual([added.key]);
    expect(added.relatedItems).toEqual([itemA.key]);
    expect(entries[2].localItemID).toBe(901);
    expect(panel.controller.isEntryRelated(entries[2])).toBe(true);
    expect(notices).toHaveBeenCalledWith(
      notice("references-panel-toast-linked"),
    );
    // The list is drawn again with the paper in the library and linked
    expect(linkState(rows()[2])).toBe("linked");
    expect(
      rows()[2].querySelector(".zinspire-ref-entry__dot")!.textContent,
    ).toBe("●");
  });

  it("does not relate the paper, and says so, when the item was deleted during the import", async () => {
    const library = fakeLibrary();
    library.add(42);
    panel = openPanel(42);
    const { notices, rows, show } = panel;
    const entries = listA();
    await show(entries);
    const finish = await clickLink(rows()[2]);
    // The item is deleted for good while INSPIRE is asked
    library.erase(42);
    const added = library.add(901);
    await finish(added);

    expect(added.relatedItems).toEqual([]);
    expect(notices).toHaveBeenCalledWith(
      notice("references-panel-toast-link-target-gone"),
    );
    // The paper was added all the same, but is not linked
    expect(entries[2].localItemID).toBe(901);
    expect(panel.controller.isEntryRelated(entries[2], 42)).toBe(false);
  });

  it("does not relate the paper, and says so, when the item was moved to the trash during the import", async () => {
    const library = fakeLibrary();
    const itemA = library.add(42);
    panel = openPanel(42);
    const { notices, rows, show } = panel;
    const entries = listA();
    await show(entries);
    const finish = await clickLink(rows()[2]);
    itemA.deleted = true;
    const added = library.add(901);
    await finish(added);

    expect(itemA.relatedItems).toEqual([]);
    expect(added.relatedItems).toEqual([]);
    expect(notices).toHaveBeenCalledWith(
      notice("references-panel-toast-link-target-gone"),
    );
    expect(entries[2].localItemID).toBe(901);
    expect(panel.controller.isEntryRelated(entries[2], 42)).toBe(false);
  });

  it("relates the paper as before when the item was already in the trash at the click", async () => {
    const library = fakeLibrary();
    const itemA = library.add(42);
    itemA.deleted = true;
    panel = openPanel(42);
    const { notices, rows, show } = panel;
    await show(listA());
    const finish = await clickLink(rows()[2]);
    const added = library.add(901);
    await finish(added);

    expect(itemA.relatedItems).toEqual([added.key]);
    expect(added.relatedItems).toEqual([itemA.key]);
    expect(notices).not.toHaveBeenCalledWith(
      notice("references-panel-toast-link-target-gone"),
    );
  });
});

describe("Link button on a paper already in the library", () => {
  let panel: ReturnType<typeof openPanel> | undefined;
  afterEach(() => {
    panel?.controller.destroy();
    panel = undefined;
  });

  it("relates and unrelates the paper and the item whose list is shown", async () => {
    const library = fakeLibrary();
    const itemA = library.add(42);
    const inLibrary = library.add(900);
    panel = openPanel(42);
    const { controller, rows, show } = panel;
    const entries = [0, 1, 2, 3, 4].map((i) =>
      paper("A", i, i === 2 ? { localItemID: 900 } : {}),
    );
    await show(entries);
    const link = vi.spyOn(controller, "handleLinkAction");

    (
      rows()[2].querySelector(".zinspire-ref-entry__link") as HTMLElement
    ).click();
    await link.mock.results[0].value;
    expect(itemA.relatedItems).toEqual([inLibrary.key]);
    expect(inLibrary.relatedItems).toEqual([itemA.key]);
    expect(controller.isEntryRelated(entries[2])).toBe(true);
    expect(linkState(rows()[2])).toBe("linked");

    (
      rows()[2].querySelector(".zinspire-ref-entry__link") as HTMLElement
    ).click();
    await link.mock.results[1].value;
    expect(itemA.relatedItems).toEqual([]);
    expect(inLibrary.relatedItems).toEqual([]);
    expect(controller.isEntryRelated(entries[2])).toBe(false);
    expect(linkState(rows()[2])).toBe("unlinked");
  });
});
