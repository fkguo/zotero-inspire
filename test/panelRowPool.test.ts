import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// INSPIRE requests of the row buttons (BibTeX, TeX key), answered by the tests
const mocks = vi.hoisted(() => ({ inspireFetch: vi.fn() }));
vi.mock("../src/modules/inspire/rateLimiter", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/modules/inspire/rateLimiter")
  >()),
  inspireFetch: mocks.inspireFetch,
}));

import { config } from "../package.json";
import { EntryListRenderer } from "../src/modules/inspire/panel/EntryListRenderer";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import { stopLibraryIndex } from "../src/modules/inspire/library/arxivIndex";

// The References panel reuses row elements: when it draws a new list, the rows
// of the old one go back to a pool and are handed to the papers of the new
// list. Row updates that arrive late (INSPIRE details, library status) find
// their row by the paper's entry ID. These tests check that such a late update
// for a paper of the old list does not show up in a row of the list shown now.

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

/** What a row shows. */
function shown(row: Element) {
  const text = (selector: string) =>
    row.querySelector(selector)?.textContent ?? null;
  const marker = row.querySelector(".zinspire-ref-entry__dot") as HTMLElement;
  return {
    entryId: (row as HTMLElement).dataset.entryId,
    marker: marker.textContent,
    markerState: marker.dataset.state,
    authors: text(".zinspire-ref-entry__authors"),
    title: text(".zinspire-ref-entry__title-link"),
    stats: text(".zinspire-ref-entry__stats-button"),
    pdf: (row.querySelector(".zinspire-ref-entry__pdf") as HTMLElement).dataset
      .state,
    link: (row.querySelector(".zinspire-ref-entry__link") as HTMLElement)
      .dataset.state,
  };
}

/**
 * A panel built by its constructor on jsdom. `poolSize` replaces the row
 * renderer by one with a smaller pool, to try lists longer than the pool.
 */
function openPanel(poolSize?: number) {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><div class='pane'></div></body>",
    {
      url: "https://zotero.test/",
    },
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
  if (poolSize !== undefined) {
    controller.entryRenderer = new EntryListRenderer({
      document: doc,
      maxPoolSize: poolSize,
    });
  }
  const rows = () =>
    [
      ...controller.listEl.querySelectorAll(".zinspire-ref-entry"),
    ] as HTMLElement[];
  /** Load a list and draw it, as the panel does for a newly selected item. */
  const show = async (entries: InspireReferenceEntry[]) => {
    controller.allEntries = entries;
    controller.renderReferenceList();
    await vi.waitFor(() =>
      expect(rows().map((row) => row.dataset.entryId)).toEqual(
        entries.map((e) => e.id),
      ),
    );
  };
  return { controller, doc, rows, show };
}

describe("References panel rows reused for another list", () => {
  let panel: ReturnType<typeof openPanel> | undefined;
  afterEach(() => {
    panel?.controller.destroy();
    panel = undefined;
  });

  /** The late updates the panel makes after INSPIRE and library lookups. */
  function lateUpdates(controller: any, entry: InspireReferenceEntry) {
    // Library lookup (enrichLocalStatus): the paper turns out to be local
    entry.localItemID = 900;
    controller.updateRowStatus(entry);
    // INSPIRE details (enrichReferencesEntries / runMetadataWorker)
    entry.title = `Late title of ${entry.recid}`;
    entry.authors = ["Late, A."];
    entry.citationCount = 777;
    controller.updateRowMetadata(entry);
    controller.updateRowCitationCount(entry);
  }

  it("does not write an old list's late updates into the rows of the new list", async () => {
    panel = openPanel();
    const { controller, rows, show } = panel;
    const oldList = [0, 1, 2, 3, 4].map((i) => paper("A", i));
    const newList = [0, 1, 2, 3, 4].map((i) => paper("B", i));

    await show(oldList);
    const oldRows = rows();
    // Another item is selected: a loading message, then its list
    controller.renderMessage("Loading");
    await show(newList);
    // The new list is drawn with the old list's row elements
    const newRows = rows();
    expect(newRows.every((row) => oldRows.includes(row))).toBe(true);
    const before = newRows.map(shown);

    for (const entry of oldList) lateUpdates(controller, entry);

    expect(rows().map(shown)).toEqual(before);
    expect(before.map((row) => row.title)).toEqual(
      newList.map((e) => `${e.title};`),
    );
    expect(before.every((row) => row.marker === "⊕")).toBe(true);
  });

  it("does not show late updates that arrive while the loading message is shown", async () => {
    panel = openPanel();
    const { controller, rows, show } = panel;
    const oldList = [0, 1, 2, 3, 4].map((i) => paper("A", i));
    const newList = [0, 1, 2, 3, 4].map((i) => paper("B", i));

    await show(oldList);
    const oldRows = rows();
    controller.renderMessage("Loading");
    // Updates for the old list land while nothing but the message is shown
    for (const entry of oldList) lateUpdates(controller, entry);
    await show(newList);

    // The new list reuses the old rows, and shows its own papers only
    expect(rows().every((row) => oldRows.includes(row))).toBe(true);
    expect(rows().map(shown)).toEqual(
      newList.map((e) => ({
        entryId: e.id,
        marker: "⊕",
        markerState: "missing",
        authors: `A. Author${e.recid}`,
        title: `${e.title};`,
        stats: `${config.addonRef}-references-panel-citation-count {"count":${e.citationCount}}`,
        pdf: "disabled",
        link: "unlinked",
      })),
    );
  });

  it("does not show late updates of a list longer than the row pool", async () => {
    // Rows beyond the pool's capacity are dropped rather than reused
    panel = openPanel(3);
    const { controller, rows, show } = panel;
    const oldList = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => paper("A", i));
    const newList = [0, 1, 2, 3, 4, 5].map((i) => paper("B", i));

    await show(oldList);
    controller.renderMessage("Loading");
    await show(newList);
    const before = rows().map(shown);

    for (const entry of oldList) lateUpdates(controller, entry);

    expect(rows().map(shown)).toEqual(before);
    expect(before.every((row) => row.marker === "⊕")).toBe(true);
  });
});

describe("Row actions that show their result after a wait", () => {
  // Adding a paper, Find Full Text and the copy buttons wait for INSPIRE or
  // Zotero before they show their result in the row they were started from.
  // Selecting another item meanwhile draws its list with the same row
  // elements: the result must not show up in the row of a paper of that list.
  let panel: ReturnType<typeof openPanel> | undefined;
  afterEach(() => {
    vi.useRealTimers();
    mocks.inspireFetch.mockReset();
    panel?.controller.destroy();
    panel = undefined;
  });

  /** A promise and the function that fulfils it. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  /** What the rows show, with the state of their buttons. */
  function look(rows: HTMLElement[]) {
    const button = (row: HTMLElement, selector: string) => {
      const el = row.querySelector(selector) as HTMLButtonElement;
      return `${el.textContent}|${el.dataset.state ?? ""}|${el.disabled ? "off" : "on"}`;
    };
    return rows.map((row) => ({
      ...shown(row),
      pdfButton: button(row, ".zinspire-ref-entry__pdf"),
      bibtex: button(row, ".zinspire-ref-entry__bibtex"),
      texkey: button(row, ".zinspire-ref-entry__texkey"),
    }));
  }

  /** Another item is selected: a loading message, then its list. */
  async function switchTo(entries: InspireReferenceEntry[]) {
    panel!.controller.renderMessage("Loading");
    await panel!.show(entries);
  }

  /**
   * Click ⊕ in `row` and confirm the save target. INSPIRE answers for the
   * paper when the returned function is called, which resolves once the
   * panel is done with the answer.
   */
  async function clickAdd(row: HTMLElement) {
    const { controller } = panel!;
    controller.promptForSaveTarget = vi.fn().mockResolvedValue({
      libraryID: 1,
      primaryRowID: "L1",
      collectionIDs: [],
      tags: [],
      note: "",
    });
    const imported = deferred<{ id: number }>();
    controller.importReference = vi.fn(() => imported.promise);
    const add = vi.spyOn(controller, "handleAddAction");
    (row.querySelector(".zinspire-ref-entry__dot") as HTMLElement).click();
    await vi.waitFor(() =>
      expect(controller.importReference).toHaveBeenCalled(),
    );
    return async (item: { id: number }) => {
      imported.resolve(item);
      await add.mock.results[0].value;
    };
  }

  /**
   * Library items for Find Full Text: `parentID` without attachments until
   * `pdfFound` is called, which also ends Zotero's search.
   */
  function libraryWithFullTextSearch(parentID: number) {
    const search = deferred<void>();
    let attachments: number[] = [];
    const addAvailableFiles = vi.fn(() => search.promise);
    Object.assign((globalThis as any).Zotero, {
      Items: {
        get: (id: number) =>
          id === parentID
            ? { id, getAttachments: () => attachments }
            : id === 801
              ? { id, isPDFAttachment: () => true }
              : null,
      },
      Attachments: { addAvailableFiles },
    });
    return {
      addAvailableFiles,
      pdfFound: () => {
        attachments = [801];
        search.resolve();
      },
    };
  }

  it("does not mark a paper of the new list when an add finishes after the switch", async () => {
    panel = openPanel();
    const { rows, show } = panel;
    const oldList = [0, 1, 2, 3, 4].map((i) => paper("A", i));
    const newList = [0, 1, 2, 3, 4].map((i) => paper("B", i));
    await show(oldList);
    const clicked = rows()[2];
    const finish = await clickAdd(clicked);

    // Another item is selected while INSPIRE is asked for the paper
    await switchTo(newList);
    expect(rows().includes(clicked)).toBe(true);
    const before = look(rows());
    await finish({ id: 901 });

    expect(oldList[2].localItemID).toBe(901);
    expect(look(rows())).toEqual(before);
  });

  it("marks the clicked row when no other list is drawn meanwhile", async () => {
    panel = openPanel();
    const { rows, show } = panel;
    await show([0, 1, 2, 3, 4].map((i) => paper("A", i)));
    const before = look(rows());
    const finish = await clickAdd(rows()[2]);
    await finish({ id: 901 });

    const expected = [...before];
    expected[2] = {
      ...before[2],
      marker: "●",
      markerState: "local",
      pdf: "find-pdf",
      pdfButton: "|find-pdf|on",
    };
    expect(look(rows())).toEqual(expected);
  });

  it("does not show the PDF of an automatic Find Full Text in a row of the new list", async () => {
    panel = openPanel();
    const { controller, rows, show } = panel;
    const library = libraryWithFullTextSearch(901);
    (globalThis as any).Zotero.Prefs = {
      get: (key: string) =>
        key === `${config.prefsPrefix}.auto_find_fulltext_on_import`
          ? true
          : undefined,
    };
    const autoFind = vi.spyOn(controller, "maybeAutoFindFullText");
    const oldList = [0, 1, 2, 3, 4].map((i) => paper("A", i));
    const newList = [0, 1, 2, 3, 4].map((i) => paper("B", i));
    await show(oldList);
    const finish = await clickAdd(rows()[2]);
    await switchTo(newList);
    const before = look(rows());
    await finish({ id: 901 });

    // Zotero then finds a PDF for the added paper
    expect(library.addAvailableFiles).toHaveBeenCalled();
    library.pdfFound();
    await autoFind.mock.results[0].value;

    expect(look(rows())).toEqual(before);
  });

  it("does not show the result of Find Full Text in a row of the new list", async () => {
    panel = openPanel();
    const { controller, rows, show } = panel;
    const library = libraryWithFullTextSearch(700);
    const oldList = [0, 1, 2, 3, 4].map((i) =>
      paper("A", i, i === 2 ? { localItemID: 700 } : {}),
    );
    const newList = [0, 1, 2, 3, 4].map((i) => paper("B", i));
    await show(oldList);
    const clicked = rows()[2];
    expect(look([clicked])[0].pdfButton).toBe("|find-pdf|on");
    const findFullText = vi.spyOn(controller, "handlePdfAction");
    (clicked.querySelector(".zinspire-ref-entry__pdf") as HTMLElement).click();
    expect(library.addAvailableFiles).toHaveBeenCalled();

    // Another item is selected while Zotero looks for the PDF
    await switchTo(newList);
    expect(rows().includes(clicked)).toBe(true);
    const before = look(rows());
    library.pdfFound();
    await findFullText.mock.results[0].value;

    expect(look(rows())).toEqual(before);
  });

  it("shows the result of Find Full Text in the clicked row", async () => {
    panel = openPanel();
    const { controller, rows, show } = panel;
    const library = libraryWithFullTextSearch(700);
    await show(
      [0, 1, 2, 3, 4].map((i) =>
        paper("A", i, i === 2 ? { localItemID: 700 } : {}),
      ),
    );
    const before = look(rows());
    const findFullText = vi.spyOn(controller, "handlePdfAction");
    (
      rows()[2].querySelector(".zinspire-ref-entry__pdf") as HTMLElement
    ).click();
    expect(look(rows())[2].pdfButton).toBe("⏳|find-pdf|off");
    library.pdfFound();
    await findFullText.mock.results[0].value;

    const expected = [...before];
    expected[2] = { ...before[2], pdf: "has-pdf", pdfButton: "|has-pdf|on" };
    expect(look(rows())).toEqual(expected);
  });

  /** The copy buttons and the INSPIRE answer each of them waits for. */
  const copyButtons = [
    {
      name: "BibTeX",
      button: "bibtex",
      handler: "handleBibTeXCopy",
      idle: "📋",
      answer: { ok: true, text: async () => "@article{A2}" },
    },
    {
      name: "TeX key",
      button: "texkey",
      handler: "handleTexkeyCopy",
      idle: "T",
      answer: {
        ok: true,
        json: async () => ({ metadata: { texkeys: ["AuthorA2:2024ab"] } }),
      },
    },
  ] as const;

  /**
   * Click a copy button in `row`. INSPIRE answers when the returned function
   * is called, which resolves once the panel shows the result.
   */
  function clickCopy(row: HTMLElement, copy: (typeof copyButtons)[number]) {
    const { controller } = panel!;
    (globalThis as any).Zotero.Utilities = {
      Internal: { copyTextToClipboard: vi.fn() },
    };
    const inspire = deferred<unknown>();
    mocks.inspireFetch.mockReturnValue(inspire.promise);
    const handler = vi.spyOn(controller, copy.handler);
    (
      row.querySelector(`.zinspire-ref-entry__${copy.button}`) as HTMLElement
    ).click();
    expect(mocks.inspireFetch).toHaveBeenCalled();
    return async () => {
      inspire.resolve(copy.answer);
      await handler.mock.results[0].value;
    };
  }

  it.each(copyButtons)(
    "does not show the $name copy result in a row of the new list",
    async (copy) => {
      panel = openPanel();
      const { rows, show } = panel;
      // The new list's papers have no INSPIRE record: nothing to copy
      const newList = [0, 1, 2, 3, 4].map((i) =>
        paper("B", i, { recid: undefined }),
      );
      await show([0, 1, 2, 3, 4].map((i) => paper("A", i)));
      const clicked = rows()[2];
      const answer = clickCopy(clicked, copy);

      // Another item is selected while INSPIRE is asked
      await switchTo(newList);
      expect(rows().includes(clicked)).toBe(true);
      const before = look(rows());
      expect(before[2][copy.button]).toBe(`${copy.idle}||off`);
      vi.useFakeTimers();
      await answer();
      expect(look(rows())).toEqual(before);
      // The button would be set back after a moment
      vi.advanceTimersByTime(1500);
      expect(look(rows())).toEqual(before);
    },
  );

  it.each(copyButtons)(
    "shows the $name copy result in the clicked row",
    async (copy) => {
      panel = openPanel();
      const { rows, show } = panel;
      await show([0, 1, 2, 3, 4].map((i) => paper("A", i)));
      const before = look(rows());
      const answer = clickCopy(rows()[2], copy);
      expect(look(rows())[2][copy.button]).toBe("⏳||off");
      vi.useFakeTimers();
      await answer();
      expect(look(rows())[2][copy.button]).toBe("✓||off");
      vi.advanceTimersByTime(1500);
      expect(look(rows())).toEqual(before);
    },
  );
});
