import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import {
  EntryListRenderer,
  panelPdfButton,
  type EntryRenderContext,
  type EntryRowAdapter,
} from "../src/modules/inspire/panel/EntryListRenderer";
import { invalidateDarkModeCache } from "../src/modules/inspire/styles";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

// The row renderer of the References panel: what a row shows for a paper,
// the focus and theme colours, and the reuse of row elements through the
// row pool. "main" stands in for the main Zotero window, where the panel is.
// A list of another origin can make its own per-row choices (an adapter) and
// can draw its rows without the pool; the last two parts check those.

let main: DOMWindow;

beforeEach(() => {
  main = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://zotero.test/",
  }).window;
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    getMainWindow: () => main,
    launchURL: vi.fn(),
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
  setTheme(main, "light");
});
afterEach(() => vi.unstubAllGlobals());

function msg(key: string) {
  return `${config.addonRef}-${key}`;
}

function setTheme(win: DOMWindow, theme: "dark" | "light") {
  win.document.documentElement.setAttribute(
    "zotero-platform-darkmode",
    theme === "dark" ? "true" : "false",
  );
  invalidateDarkModeCache();
}

function css(win: DOMWindow, color: string) {
  const probe = win.document.createElement("div");
  probe.style.color = color;
  return probe.style.color;
}

function paper(
  fields: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id: "3-2001",
    recid: "2001",
    texkey: "Guo:2017jvc",
    title: "Hadronic molecules",
    year: "2018",
    authors: ["Guo, Feng-Kun", "Hanhart, Christoph"],
    authorText: "Guo, Feng-Kun; Hanhart, Christoph",
    displayText: "",
    searchText: "",
    inspireUrl: "https://inspirehep.net/literature/2001",
    publicationInfo: { journal_title: "Rev.Mod.Phys.", journal_volume: "90" },
    arxivDetails: { id: "1705.00141" },
    citationCount: 1500,
    ...fields,
  };
}

function context(fields: Partial<EntryRenderContext> = {}): EntryRenderContext {
  return {
    selectedEntryIDs: new Set<string>(),
    viewMode: "references",
    maxAuthors: 3,
    getCitationValue: (entry) => entry.citationCount ?? 0,
    hasPdf: () => false,
    ...fields,
  };
}

function part(row: Element, name: string) {
  return row.querySelector(`.zinspire-ref-entry__${name}`) as HTMLElement & {
    disabled?: boolean;
    checked?: boolean;
    href?: string;
  };
}

describe("References panel row", () => {
  it("shows a paper of the library with its PDF", () => {
    const renderer = new EntryListRenderer({ document: main.document });
    const entry = paper({ localItemID: 55 });

    const row = renderer.createRow(
      entry,
      context({
        selectedEntryIDs: new Set([entry.id]),
        hasPdf: () => true,
        // The paper's item is related to the item shown
        isRelated: (e) => e.localItemID === 55,
      }),
    );

    expect(row.dataset.entryId).toBe("3-2001");
    expect(row.dataset.recid).toBe("2001");
    expect(part(row, "checkbox").checked).toBe(true);
    expect([
      part(row, "dot").textContent,
      part(row, "dot").dataset.state,
    ]).toEqual(["●", "local"]);
    expect(part(row, "link").dataset.state).toBe("linked");
    expect(part(row, "link").getAttribute("title")).toBe(
      msg("references-panel-link-existing"),
    );
    for (const button of ["bibtex", "texkey"]) {
      expect(part(row, button).disabled).toBe(false);
      expect(part(row, button).style.opacity).toBe("1");
    }
    expect(part(row, "pdf").dataset.state).toBe("has-pdf");
    expect(part(row, "pdf").disabled).toBe(false);
    expect(part(row, "title-link").textContent).toBe("Hadronic molecules;");
    expect(part(row, "title-link").href).toBe(
      "https://inspirehep.net/literature/2001",
    );
    expect(part(row, "meta").textContent).toMatch(
      /^Rev\. Mod\. Phys\.\s+90 \(2018\) \[arXiv:1705\.00141\]$/,
    );
    expect(part(row, "stats-button").textContent).toBe(
      `${msg("references-panel-citation-count")} {"count":1500}`,
    );
    // The panel's rows have no abstract
    expect(row.querySelector(".zinspire-ref-entry__abstract")).toBeNull();
  });

  it("offers Find Full Text for a paper of the library without a PDF", () => {
    const renderer = new EntryListRenderer({ document: main.document });
    const row = renderer.createRow(paper({ localItemID: 55 }), context());
    expect(part(row, "pdf").dataset.state).toBe("find-pdf");
    expect(part(row, "pdf").disabled).toBe(false);
  });

  it("disables the PDF button for a paper not in the library", () => {
    const renderer = new EntryListRenderer({ document: main.document });
    const row = renderer.createRow(paper(), context({ hasPdf: () => true }));
    expect([
      part(row, "dot").textContent,
      part(row, "dot").dataset.state,
    ]).toEqual(["⊕", "missing"]);
    expect(part(row, "pdf").dataset.state).toBe("disabled");
    expect(part(row, "pdf").disabled).toBe(true);
  });

  it("disables BibTeX without an INSPIRE record, and the TeX key without either", () => {
    const renderer = new EntryListRenderer({ document: main.document });
    const withKey = renderer.createRow(paper({ recid: undefined }), context());
    expect(part(withKey, "bibtex").disabled).toBe(true);
    expect(part(withKey, "bibtex").style.opacity).toBe("0.3");
    expect(part(withKey, "texkey").disabled).toBe(false);
    expect(withKey.dataset.recid).toBeUndefined();

    const withNeither = renderer.createRow(
      paper({ id: "4-x", recid: undefined, texkey: undefined }),
      context(),
    );
    expect(part(withNeither, "texkey").disabled).toBe(true);
    expect(part(withNeither, "texkey").style.opacity).toBe("0.3");
  });

  it("colours the marker and the focused row by the main window's theme", () => {
    const renderer = new EntryListRenderer({ document: main.document });
    const entry = paper();

    setTheme(main, "dark");
    const dark = renderer.createRow(
      entry,
      context({ focusedEntryID: entry.id }),
    );
    expect(part(dark, "dot").style.color).toBe(css(main, "#ef4444"));
    expect(dark.classList.contains("zinspire-entry-focused")).toBe(true);
    expect(dark.style.boxShadow).toBe("inset 3px 0 0 #3584e4");

    setTheme(main, "light");
    const light = renderer.createRow(
      entry,
      context({ focusedEntryID: entry.id }),
    );
    expect(part(light, "dot").style.color).toBe(css(main, "#d93025"));
    expect(light.style.boxShadow).toBe("inset 3px 0 0 #0060df");
    renderer.updateFocusState(light, false);
    expect(light.classList.contains("zinspire-entry-focused")).toBe(false);
    expect(light.style.boxShadow).toBe("");
  });

  it("reuses the rows of a list it drew before, redrawn for the new papers", () => {
    const renderer = new EntryListRenderer({ document: main.document });
    const list = main.document.createElement("div");
    const first = renderer.createRow(paper({ localItemID: 55 }), context());
    list.appendChild(first);
    expect(renderer.getRowByEntryId("3-2001") === first).toBe(true);

    expect(renderer.recycleRowsFromContainer(list)).toBe(1);
    renderer.clearCache();
    const next = renderer.createRow(
      paper({ id: "0-7", recid: "7", title: "Another paper" }),
      context(),
    );

    expect(next === first).toBe(true);
    expect(next.dataset.entryId).toBe("0-7");
    expect(part(next, "title-link").textContent).toBe("Another paper;");
    expect(part(next, "dot").textContent).toBe("⊕");
    expect(renderer.getRowByEntryId("3-2001")).toBeUndefined();
    expect(renderer.getPoolStats()).toMatchObject({
      hitCount: 1,
      missCount: 1,
    });
  });
});

describe("rows of a list with its own choices", () => {
  /** Choices a list of arXiv papers would make. */
  const arxivList: EntryRowAdapter = {
    canCopyBibtex: () => true,
    canCopyTexkey: (entry) => Boolean(entry.texkey),
    pdfButton: (entry, hasPdf) =>
      entry.localItemID
        ? panelPdfButton(entry, hasPdf)
        : {
            state: "has-pdf",
            title: "Open on arXiv",
            url: `https://arxiv.org/abs/${(entry.arxivDetails as { id: string }).id}`,
          },
    titleSuffix: "",
    abstract: (entry) => entry.abstract,
  };
  const newPaper = (fields: Partial<InspireReferenceEntry> = {}) =>
    paper({
      id: "2609.28544@2026-09-28",
      recid: undefined,
      texkey: undefined,
      inspireUrl: undefined,
      arxivDetails: { id: "2609.28544" },
      publicationInfo: undefined,
      citationCount: undefined,
      abstract: "The mass $m_\\pi$ of the lightest meson.",
      ...fields,
    });

  it("uses the list's choices for the buttons, the title and the abstract", () => {
    const renderer = new EntryListRenderer({
      document: main.document,
      adapter: arxivList,
    });

    const row = renderer.createRow(newPaper(), context());

    expect(part(row, "bibtex").disabled).toBe(false);
    expect(part(row, "texkey").disabled).toBe(true);
    expect(part(row, "pdf").dataset.state).toBe("has-pdf");
    expect(part(row, "pdf").disabled).toBe(false);
    expect(part(row, "pdf").getAttribute("title")).toBe("Open on arXiv");
    expect(part(row, "pdf").dataset.url).toBe(
      "https://arxiv.org/abs/2609.28544",
    );
    expect(part(row, "title-link").textContent).toBe("Hadronic molecules");
    const abstract = part(row, "abstract");
    expect(abstract.textContent).toBe(
      "The mass $m_\\pi$ of the lightest meson.",
    );
    expect(abstract.style.display).toBe("");
    // Below the paper's other lines
    expect(abstract.parentElement === part(row, "content")).toBe(true);
    expect(abstract.previousElementSibling === part(row, "stats-button")).toBe(
      true,
    );

    // Once the paper is in the library, its PDF button is the panel's
    renderer.updateRow(row, newPaper({ localItemID: 9 }), context());
    expect(part(row, "pdf").dataset.state).toBe("find-pdf");
    expect(part(row, "pdf").getAttribute("title")).toBe(
      msg("references-panel-pdf-find"),
    );
    expect(part(row, "pdf").dataset.url).toBeUndefined();
  });

  it("writes the list's text after the paper's links", () => {
    const suffixes: Record<string, string> = {
      "2609.28544@2026-09-28": " · hep-ph · Cross-list",
    };
    const renderer = new EntryListRenderer({
      document: main.document,
      adapter: { titleSuffix: "", metaSuffix: (entry) => suffixes[entry.id] },
    });
    const row = renderer.createRow(newPaper(), context());
    expect(part(row, "meta").textContent).toBe(
      "[arXiv:2609.28544] · hep-ph · Cross-list",
    );

    // Shown also for a paper without links, gone when the list has none
    suffixes["2609.28544@2026-09-28"] = " · hep-ph";
    renderer.updateRow(row, newPaper({ arxivDetails: undefined }), context());
    expect(part(row, "meta").style.display).toBe("");
    expect(part(row, "meta").textContent).toBe(" · hep-ph");
    delete suffixes["2609.28544@2026-09-28"];
    renderer.updateRow(row, newPaper(), context());
    expect(part(row, "meta").textContent).toBe("[arXiv:2609.28544]");

    // The References panel's rows have none
    const panel = new EntryListRenderer({ document: main.document });
    const panelRow = panel.createRow(paper(), context());
    expect(
      part(panelRow, "meta").querySelector(".zinspire-ref-entry__meta-suffix"),
    ).toBeNull();
  });

  it("keeps the panel's choices that the list leaves out", () => {
    const renderer = new EntryListRenderer({
      document: main.document,
      adapter: { titleSuffix: "" },
    });

    const row = renderer.createRow(
      paper({ recid: undefined, texkey: undefined, localItemID: 3 }),
      context(),
    );

    expect(part(row, "title-link").textContent).toBe("Hadronic molecules");
    expect(part(row, "bibtex").disabled).toBe(true);
    expect(part(row, "texkey").disabled).toBe(true);
    expect(part(row, "pdf").dataset.state).toBe("find-pdf");
    expect(row.querySelector(".zinspire-ref-entry__abstract")).toBeNull();
  });

  it("keeps formulas rendered into the abstract while its text stays the same", () => {
    const renderer = new EntryListRenderer({
      document: main.document,
      adapter: arxivList,
    });
    const entry = newPaper();
    const row = renderer.createRow(entry, context());
    // The list renders the formulas once the row is in view
    const abstract = part(row, "abstract");
    abstract.innerHTML =
      'The mass <span class="katex">m</span> of the lightest meson.';

    entry.localItemID = 9;
    renderer.updateRow(row, entry, context());
    expect(abstract.querySelector(".katex")).not.toBeNull();

    entry.abstract = "A revised abstract.";
    renderer.updateRow(row, entry, context());
    expect(abstract.querySelector(".katex")).toBeNull();
    expect(abstract.textContent).toBe("A revised abstract.");
  });

  it("hides the abstract line when a reused row shows a paper without one", () => {
    const renderer = new EntryListRenderer({
      document: main.document,
      adapter: arxivList,
    });
    const list = main.document.createElement("div");
    const row = renderer.createRow(newPaper(), context());
    list.appendChild(row);

    renderer.recycleRowsFromContainer(list);
    const reused = renderer.createRow(
      newPaper({ id: "2609.00001@2026-09-28", abstract: undefined }),
      context(),
    );

    expect(reused === row).toBe(true);
    const abstract = part(reused, "abstract");
    expect(abstract.style.display).toBe("none");
    expect(abstract.textContent).toBe("");
    expect(abstract.dataset.latexSource).toBeUndefined();
  });
});

describe("rows without the row pool", () => {
  it("builds every row anew and keeps none of them", () => {
    const renderer = new EntryListRenderer({
      document: main.document,
      pooled: false,
    });
    const page = main.document.createElement("div");
    const entries = Array.from({ length: 500 }, (_, i) =>
      paper({ id: `${i}-p${i}`, recid: `p${i}`, title: `Paper ${i}` }),
    );

    page.appendChild(renderer.createRows(entries, context()));

    const rows = [...page.children] as HTMLElement[];
    expect(new Set(rows).size).toBe(500);
    expect(rows.map((row) => row.dataset.entryId)).toEqual(
      entries.map((e) => e.id),
    );
    expect(renderer.getRowByEntryId("0-p0")).toBeUndefined();
    expect(renderer.getPoolStats()).toBeUndefined();
    // Nothing goes back to a pool; the next page gets new rows
    expect(renderer.recycleRowsFromContainer(page)).toBe(0);
    const next = renderer.createRow(entries[0], context());
    expect(rows.includes(next)).toBe(false);
    expect(next.parentElement).toBeNull();
  });

  it("draws the same row as the pooled renderer", () => {
    const entry = paper({ localItemID: 55 });
    const ctx = context({
      hasPdf: () => true,
      focusedEntryID: entry.id,
      isRelated: () => true,
    });

    const pooled = new EntryListRenderer({ document: main.document });
    const unpooled = new EntryListRenderer({
      document: main.document,
      pooled: false,
    });

    expect(unpooled.createRow(entry, ctx).outerHTML).toBe(
      pooled.createRow(entry, ctx).outerHTML,
    );
    // The two rows came from different paths: only one renderer has a pool
    expect(pooled.getPoolStats()).toMatchObject({ missCount: 1 });
    expect(unpooled.getPoolStats()).toBeUndefined();
  });
});
