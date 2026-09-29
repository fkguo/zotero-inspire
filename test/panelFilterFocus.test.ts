import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { FILTER_DEBOUNCE_MS } from "../src/modules/inspire/constants";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { InspireReferencePanelController } from "../src/modules/zinspire";

// Keyboard focus in the References panel when its list is redrawn. The panel
// is built by its constructor on jsdom, with a stand-in for the part of
// zotero-plugin-toolkit's element builder that it uses.

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

function entry(id: string, title: string): InspireReferenceEntry {
  return {
    id,
    recid: `rec-${id}`,
    title,
    year: "2024",
    authors: [],
    authorText: "Guo",
    displayText: `Guo: ${title};`,
    searchText: "",
  };
}

describe("References panel keyboard focus", () => {
  let dom: JSDOM;
  let doc: Document;
  let controller: any;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><body><div class='pane'></div></body>", {
      url: "https://zotero.test/",
    });
    const win = dom.window as any;
    doc = win.document;
    vi.stubGlobal("Zotero", {
      debug: vi.fn(),
      Prefs: { get: () => undefined, set: vi.fn() },
      getMainWindow: () => win,
      Notifier: {
        registerObserver: () => "observer",
        unregisterObserver: vi.fn(),
      },
      Items: { get: () => null },
    });
    vi.stubGlobal("addon", { data: {} });
    vi.stubGlobal("ztoolkit", {
      UI: {
        appendElement: (spec: any, parent: Element) =>
          parent.appendChild(buildElement(doc, spec)),
      },
      getGlobal: (name: string) => win[name],
    });
    controller = new InspireReferencePanelController(
      doc.querySelector(".pane") as HTMLDivElement,
    );
    controller.allEntries = [
      entry("a", "Hidden-charm pentaquarks"),
      entry("b", "Tetraquark candidates"),
      entry("c", "Triangle singularities"),
    ];
    controller.renderReferenceList();
  });

  afterEach(() => {
    controller.destroy();
    vi.unstubAllGlobals();
  });

  /** Click the background of a row, which makes it the focused entry. */
  const clickRow = (id: string) =>
    controller.listEl
      .querySelector(`.zinspire-ref-entry[data-entry-id="${id}"]`)
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  it("keeps the focus in the filter box while typing after a row was clicked", async () => {
    clickRow("a");
    expect(controller.focusedEntryID).toBe("a");
    expect(doc.activeElement === controller.listEl).toBe(true);
    const input = controller.filterInput as HTMLInputElement;
    input.focus();

    const focusInFilter: boolean[] = [];
    for (const typed of ["t", "tr", "tri"]) {
      const list = controller.listEl;
      input.value = typed;
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      // The list is redrawn once the filter's debounce has passed
      await vi.waitFor(() => expect(controller.listEl === list).toBe(false), {
        timeout: FILTER_DEBOUNCE_MS + 1000,
      });
      focusInFilter.push(doc.activeElement === input);
    }

    expect(focusInFilter).toEqual([true, true, true]);
    expect(controller.focusedEntryID).toBe("a");
    // Leaving the box saves its text to the filter history; typing does not
    expect(
      vi
        .mocked(Zotero.Prefs.set)
        .mock.calls.filter(([key]) => String(key).endsWith("FilterHistory")),
    ).toEqual([]);
  });

  it("keeps the focus in the filter box when the filter matches nothing", async () => {
    clickRow("a");
    const input = controller.filterInput as HTMLInputElement;
    input.focus();
    const list = controller.listEl;

    input.value = "xyz";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(controller.listEl === list).toBe(false), {
      timeout: FILTER_DEBOUNCE_MS + 1000,
    });

    expect(controller.listEl.querySelector(".zinspire-ref-entry")).toBeNull();
    expect(doc.activeElement === input).toBe(true);
  });

  it("gives the focus back to the redrawn list when the list had it", () => {
    clickRow("b");
    const list = controller.listEl;
    expect(doc.activeElement === list).toBe(true);

    controller.renderReferenceList();

    expect(controller.listEl === list).toBe(false);
    expect(doc.activeElement === controller.listEl).toBe(true);
  });

  it("keeps the focus on the redrawn list after Escape cleared the focused row", () => {
    clickRow("b");
    controller.listEl.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(controller.focusedEntryID).toBeUndefined();
    expect(doc.activeElement === controller.listEl).toBe(true);

    controller.renderReferenceList();

    expect(doc.activeElement === controller.listEl).toBe(true);
  });

  it("keeps the focus on the list when a redraw leaves it empty", () => {
    clickRow("b");
    controller.allEntries = [];

    controller.renderReferenceList();

    expect(doc.activeElement === controller.listEl).toBe(true);
  });

  it("leaves the focus on another control of the panel during a redraw", () => {
    clickRow("a");
    const tabButton = controller.tabButtons.references as HTMLButtonElement;
    tabButton.focus();

    controller.renderReferenceList();

    expect(doc.activeElement === tabButton).toBe(true);
  });

  it("does not give the redrawn list the focus of a checkbox in a row", () => {
    clickRow("a");
    const checkbox = controller.listEl.querySelector(
      '.zinspire-ref-entry[data-entry-id="b"] .zinspire-ref-entry__checkbox',
    ) as HTMLInputElement;
    checkbox.focus();
    expect(doc.activeElement === checkbox).toBe(true);

    controller.renderReferenceList();

    expect(doc.activeElement === controller.listEl).toBe(false);
  });

  it("leaves the focus alone when nothing had it during a redraw", () => {
    clickRow("a");
    (doc.activeElement as HTMLElement).blur();
    expect(doc.activeElement === doc.body).toBe(true);

    controller.renderReferenceList();

    expect(doc.activeElement === doc.body).toBe(true);
  });
});
