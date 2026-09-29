import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { config } from "../package.json";
import {
  FILTER_DEBOUNCE_MS,
  QUICK_FILTER_CONFIGS,
} from "../src/modules/inspire/constants";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { InspireReferencePanelController } from "../src/modules/zinspire";

// The References panel's quick-filter button with its popup, and its filter
// box with the filter history, drawn by the components the arXiv browser
// window shares: they look and behave as the panel's own did. The panel is
// built by its constructor on jsdom, with a stand-in for the part of
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
    displayText: `Guo: Paper ${id};`,
    searchText: "",
    ...fields,
  };
}

const HISTORY = `${config.addonRef}.inspireFilterHistory`;
const QUICK = `${config.prefsPrefix}.quick_filters_last_used`;
const msg = (key: string) => `${config.addonRef}-${key}`;

describe("References panel quick filters and filter history", () => {
  let dom: JSDOM;
  let doc: Document;
  let controller: any;
  let prefs: Record<string, unknown>;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><body><div class='pane'></div></body>", {
      url: "https://zotero.test/",
    });
    const win = dom.window as any;
    doc = win.document;
    prefs = {};
    vi.stubGlobal("Zotero", {
      debug: vi.fn(),
      Prefs: {
        get: (key: string) => prefs[key],
        set: (key: string, value: unknown) => {
          prefs[key] = value;
        },
      },
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
  });

  afterEach(() => {
    controller?.destroy();
    controller = undefined;
    vi.unstubAllGlobals();
  });

  function open() {
    controller = new InspireReferencePanelController(
      doc.querySelector(".pane") as HTMLDivElement,
    );
    controller.allEntries = [
      entry("a", {
        localItemID: 3,
        publicationInfo: { journal_title: "Phys. Rev. D" },
      }),
      entry("b", { arxivDetails: { id: "2401.00002" } }),
      entry("c", { publicationInfo: { journal_title: "Phys. Lett. B" } }),
    ];
    controller.renderReferenceList();
  }
  const shown = () =>
    [...controller.listEl.querySelectorAll(".zinspire-ref-entry")].map(
      (row: HTMLElement) => row.dataset.entryId,
    );
  const button = () =>
    doc.querySelector<HTMLButtonElement>(".zinspire-quick-filter-btn")!;
  const popup = () =>
    doc.querySelector<HTMLElement>(".zinspire-quick-filter-popup")!;
  const toggle = (labelKey: string) => {
    const input = [...popup().querySelectorAll("label")]
      .find(
        (label) =>
          label.querySelector(".zinspire-quick-filter-item-label")!
            .textContent === msg(labelKey),
      )!
      .querySelector("input")!;
    input.checked = !input.checked;
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    return input;
  };

  it("has the ⏳ button left of the filter box, opening the popup of every quick filter under the panel's body", () => {
    open();
    const wrapper = button().closest(".zinspire-quick-filters")!;
    expect(wrapper.parentElement!.classList).toContain("zinspire-filter-group");
    expect(
      wrapper.nextElementSibling!.classList.contains(
        "zinspire-filter-input-wrapper",
      ),
    ).toBe(true);
    expect(popup().parentElement === controller.body).toBe(true);
    expect(popup().hidden).toBe(true);

    button().click();
    expect(popup().style.display).toBe("flex");
    expect(
      [...popup().querySelectorAll(".zinspire-quick-filter-item")].map(
        (item) => [
          item.querySelector(".zinspire-quick-filter-item-emoji")!.textContent,
          item.querySelector(".zinspire-quick-filter-item-label")!.textContent,
          (item as HTMLElement).title,
        ],
      ),
    ).toEqual(
      QUICK_FILTER_CONFIGS.map((config) => [
        config.emoji,
        msg(config.labelKey),
        msg(config.tooltipKey!),
      ]),
    );
    button().click();
    expect(popup().hidden).toBe(true);
  });

  it("filters the list, counts the filters on and keeps them in the preferences", () => {
    open();
    const badge = doc.querySelector<HTMLElement>(
      ".zinspire-quick-filter-badge",
    )!;
    expect(badge.hidden).toBe(true);
    button().click();

    toggle("references-panel-quick-filter-published");
    expect(shown()).toEqual(["a", "c"]);
    expect(badge.textContent).toBe("1");
    expect(button().classList).toContain("active");
    // The chart's "published" button follows
    expect(controller.publishedOnlyFilterEnabled).toBe(true);

    toggle("references-panel-quick-filter-local-items");
    expect(shown()).toEqual(["a"]);
    expect(badge.textContent).toBe("2");
    expect(JSON.parse(prefs[QUICK] as string)).toEqual([
      "publishedOnly",
      "localItems",
    ]);

    // Online excludes local
    const online = toggle("references-panel-quick-filter-online-items");
    expect(online.checked).toBe(true);
    expect(shown()).toEqual(["c"]);
    expect(JSON.parse(prefs[QUICK] as string)).toEqual([
      "publishedOnly",
      "onlineItems",
    ]);

    // Clearing every filter clears the boxes and the badge
    controller.clearAllFilters();
    expect(shown()).toEqual(["a", "b", "c"]);
    expect(badge.hidden).toBe(true);
    expect(
      [...popup().querySelectorAll("input")].some((input) => input.checked),
    ).toBe(false);
  });

  it("opens with the filters kept in the preferences, of two that exclude each other the first", () => {
    prefs[QUICK] = JSON.stringify(["preprintOnly", "publishedOnly"]);
    open();
    expect(shown()).toEqual(["a", "c"]);
    expect(doc.querySelector(".zinspire-quick-filter-badge")!.textContent).toBe(
      "1",
    );
  });

  it("closes the popup on a click elsewhere", async () => {
    open();
    button().click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.listEl.click();
    expect(popup().hidden).toBe(true);
  });

  it("keeps the filter text in the history on Enter and on leaving the box, and completes it with Tab", async () => {
    prefs[HISTORY] = JSON.stringify(["pentaquark"]);
    open();
    const input = controller.filterInput as HTMLInputElement;
    const type = (text: string) => {
      input.value = text;
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    };
    const key = (name: string) =>
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: name,
          bubbles: true,
          cancelable: true,
        }),
      );
    const history = () =>
      JSON.parse(prefs[HISTORY] as string).map(
        (item: { query: string }) => item.query,
      );
    input.focus();
    type("Paper b");
    key("Enter");
    // Stored the old way (texts only): read and kept as entries
    expect(history()).toEqual(["Paper b", "pentaquark"]);
    type("tetra");
    input.blur();
    expect(history()).toEqual(["tetra", "Paper b", "pentaquark"]);

    input.focus();
    type("pent");
    const hint = doc.querySelector<HTMLElement>(
      ".zinspire-filter-inline-hint",
    )!;
    expect(hint.textContent).toBe("aquark");
    key("Tab");
    expect(input.value).toBe("pentaquark");
    expect(history()[0]).toBe("pentaquark");
    await vi.waitFor(() => expect(shown()).toEqual([]), {
      timeout: FILTER_DEBOUNCE_MS + 1000,
    });
  });
});
