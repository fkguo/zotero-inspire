// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// In-library marks on the nodes of the citation graph, drawn by the dialog
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graphs = vi.hoisted(() => ({
  fetchMultiSeedCitationGraphCached: vi.fn(),
  fetchMultiSeedCitationGraph: vi.fn(),
}));
vi.mock(
  "../src/modules/inspire/citationGraphMultiSeedService",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/modules/inspire/citationGraphMultiSeedService")
    >()),
    ...graphs,
  }),
);
vi.mock("../src/utils/locale", () => ({
  getString: (key: string) => key,
  getLocaleID: () => "en-US",
  initLocale: vi.fn(),
}));
vi.mock("../src/utils/prefs", () => ({ getPref: vi.fn(), setPref: vi.fn() }));

import { CitationGraphDialog } from "../src/modules/inspire/panel/CitationGraphDialog";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

const doc = globalThis.document;
const win = globalThis.window;
let dialog: CitationGraphDialog | undefined;

beforeEach(() => {
  vi.spyOn(win.HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(win.Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 800,
    width: 1200,
    height: 800,
    toJSON: () => ({}),
  });
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    getMainWindow: () => win,
    launchURL: vi.fn(),
    Prefs: { get: vi.fn(), set: vi.fn() },
    getActiveZoteroPane: () => ({ getSelectedItems: () => [] }),
  });
  vi.stubGlobal("addon", { data: {} });
  vi.stubGlobal("ztoolkit", {
    getGlobal: (name: string) => (win as any)[name],
  });
});
afterEach(() => {
  dialog?.dispose();
  dialog = undefined;
  doc.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function reference(
  recid: string,
  fields: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id: `graph-${recid}`,
    recid,
    title: `Paper ${recid}`,
    year: "2020",
    authors: [`Author${recid}, A.`],
    authorText: `Author${recid}, A.`,
    displayText: "",
    searchText: "",
    citationCount: 10,
    ...fields,
  };
}

/** Open a graph whose references are `references`, as loaded from cache */
async function openGraph(references: InspireReferenceEntry[]) {
  graphs.fetchMultiSeedCitationGraphCached.mockResolvedValue({
    result: {
      seeds: [{ recid: "1", title: "Seed", inspireUrl: "", isSeed: true }],
      seedEdges: [],
      references,
      citedBy: [],
      totals: { references: references.length, citedBy: 0 },
      shown: { references: references.length, citedBy: 0 },
      sort: "mostrecent",
    },
    cache: { missingSeeds: [], partialSeeds: [] },
  });
  dialog = new CitationGraphDialog(doc, [{ recid: "1", title: "Seed" }]);
  await vi.waitFor(() =>
    expect(doc.querySelector('[data-recid="100"]')).toBeTruthy(),
  );
}

const node = (recid: string) =>
  doc.querySelector(`[data-recid="${recid}"]`) as SVGGElement;
const legend = () =>
  [...doc.querySelectorAll("text")].map((t) => t.textContent);

describe("citation graph: node marks", () => {
  // Intentional change: before, a paper whose library state was unknown
  // was drawn like a paper not in the library ("Online")
  it("draws papers whose library state is unknown as an outline, with a legend", async () => {
    await openGraph([
      reference("100", { localStatusUnknown: true }),
      reference("200"),
    ]);
    const unknown = node("100").querySelector("circle")!;
    expect(unknown.getAttribute("fill")).toBe("none");
    expect(unknown.getAttribute("stroke-dasharray")).toBe("2 2");
    const online = node("200").querySelector("circle")!;
    expect(online.getAttribute("fill")).not.toBe("none");
    expect(legend()).toContain("Library unknown");
  });

  it("has no legend row for an unknown library when every state is known", async () => {
    await openGraph([reference("100", { localItemID: 5 }), reference("200")]);
    expect(legend()).not.toContain("Library unknown");
  });

  // Intentional change: before, a paper in the library twice looked like
  // one in the library once
  it("shows how many items a paper has in the library on its node", async () => {
    await openGraph([
      reference("100", { localItemID: 5, localItemIDs: [5, 9] }),
      reference("200", { localItemID: 6, localItemIDs: [6] }),
    ]);
    expect(node("100").querySelector("text")!.textContent).toMatch(/ ②$/);
    expect(node("200").querySelector("text")!.textContent).not.toMatch(/②/);
  });
});
