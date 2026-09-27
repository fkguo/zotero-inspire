import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import { EntryListRenderer } from "../src/modules/inspire/panel/EntryListRenderer";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { InspireReferencePanelController } from "../src/modules/zinspire";

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
    entry.isRelated = true;
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
