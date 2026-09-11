// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  academicReachable,
  academicRelationshipPath,
  academicTreeCSV,
  projectAcademicTree,
} from "../src/modules/inspire/academicTreeExploration";
import type { AcademicTreeGraph } from "../src/modules/inspire/academicTreeTypes";
import { AcademicTreeCanvas } from "../src/modules/inspire/panel/AcademicTreeCanvas";
import { exportAcademicTree } from "../src/modules/inspire/panel/AcademicTreeExport";
import { AcademicTreeTools } from "../src/modules/inspire/panel/AcademicTreeTools";

vi.mock("../src/utils/locale", () => ({ getString: (key: string) => key }));
const document = globalThis.document;
const state = () => ({
  showCoAdvisors: true,
  collapsed: [] as string[],
  path: [] as string[],
});
// a -> r -> s -> t; c -> s (supplemental co-advisor); a -> cousin -> t.
const graph = (): AcademicTreeGraph => ({
  rootId: "r",
  nodes: ["a", "r", "s", "t", "c", "cousin"].map((id) => ({
    id,
    name: id,
    level: 0,
  })),
  edges: [
    ["a", "r"],
    ["r", "s"],
    ["s", "t"],
    ["c", "s"],
    ["a", "cousin"],
    ["cousin", "t"],
  ].map(([source, target]) => ({ source, target, degreeTypes: ["phd"] })),
  expanded: { up: ["r"], down: ["r", "a", "s"] },
  empty: { up: [], down: [] },
  failures: [],
  limited: false,
});

describe("academic tree exploration", () => {
  it("reveals only related collapsed branches during local find, and restores hidden path edges", () => {
    const original = graph();
    original.nodes.push(
      { id: "u", name: "u", level: 1 },
      { id: "v", name: "v", level: 2 },
    );
    original.edges.push(
      { source: "r", target: "u", degreeTypes: [] },
      { source: "u", target: "v", degreeTypes: [] },
    );
    const tools = new AcademicTreeTools(document, {
      graph: () => original,
      selected: () => "r",
      changed: vi.fn(),
      locate: vi.fn(),
      fitPath: vi.fn(),
      expandAncestors: vi.fn(),
      export: vi.fn(),
    });
    document.body.append(tools.element);
    tools.sync(original, false);
    tools.restore({ showCoAdvisors: false, collapsed: ["s", "u"], path: [] });
    // t is still visible through cousin, but its direct s -> t edge is collapsed.
    expect(tools.project(original).nodes.some((n) => n.id === "t")).toBe(true);
    const from = tools.element.querySelector<HTMLSelectElement>(
      '[aria-label="academic-tree-path-from"]',
    )!;
    const to = tools.element.querySelector<HTMLSelectElement>(
      '[aria-label="academic-tree-path-to"]',
    )!;
    from.value = "s";
    to.value = "t";
    tools.element
      .querySelector<HTMLButtonElement>(
        '[aria-label="academic-tree-show-path"]',
      )!
      .click();
    expect(tools.state.collapsed).toEqual(["u"]);
    expect(tools.state.showCoAdvisors).toBe(false);
    expect(
      tools
        .project(original)
        .edges.some((e) => e.source === "s" && e.target === "t"),
    ).toBe(true);
    tools.restore({ showCoAdvisors: false, collapsed: ["u"], path: [] });
    const query = tools.element.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    query.value = "v";
    query.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    tools.element
      .querySelector<HTMLButtonElement>("[data-academic-locate]")!
      .click();
    expect(tools.state.collapsed).toEqual([]);
    expect(tools.state.showCoAdvisors).toBe(false);
    // Supplemental c is disconnected when the center's student edge is collapsed.
    original.edges = original.edges.filter(
      (edge) => edge.source !== "cousin" && edge.target !== "cousin",
    );
    tools.restore({ showCoAdvisors: false, collapsed: ["r", "u"], path: [] });
    query.value = "c";
    query.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const result = tools.element.querySelector<HTMLButtonElement>(
      '[data-academic-locate="c"]',
    )!;
    expect(result.getAttribute("aria-label")).toContain(": c");
    result.click();
    expect(tools.state.collapsed).toEqual(["u"]);
    expect(tools.state.showCoAdvisors).toBe(true);
    expect(tools.project(original).nodes.some((node) => node.id === "c")).toBe(
      true,
    );
    tools.dispose();
  });
  it("hides only supplemental co-advisors, preserving own mentors and expanded ancestor students", () => {
    const original = graph(),
      before = structuredClone(original);
    const projected = projectAcademicTree(original, {
      ...state(),
      showCoAdvisors: false,
    });
    expect(projected.nodes.map((n) => n.id)).toEqual([
      "a",
      "r",
      "s",
      "t",
      "cousin",
    ]);
    expect(projected.edges.every((edge) => edge.source !== "c")).toBe(true);
    expect(original).toEqual(before);
  });
  it("collapses exclusive descendants and retains shared descendants connected by another route", () => {
    const original = graph();
    let projected = projectAcademicTree(original, {
      ...state(),
      collapsed: ["s"],
    });
    expect(projected.nodes.map((n) => n.id)).toContain("t");
    expect(projected.edges.some((edge) => edge.source === "s")).toBe(false);
    original.edges = original.edges.filter((edge) => edge.source !== "cousin");
    projected = projectAcademicTree(original, { ...state(), collapsed: ["s"] });
    expect(projected.nodes.map((n) => n.id)).not.toContain("t");
    expect(projectAcademicTree(original, state())).toBe(original);
    // The center's ancestral chain cannot be hidden by a stale collapse state.
    expect(
      projectAcademicTree(original, { ...state(), collapsed: ["a"] }).nodes.map(
        (n) => n.id,
      ),
    ).toContain("a");
  });
  it("finds shortest paths with cycles, missing IDs and disconnected people", () => {
    const original = graph();
    original.edges.push({ source: "s", target: "r", degreeTypes: ["other"] });
    original.nodes.push({ id: "isolated", name: "Isolated", level: 0 });
    expect(academicRelationshipPath(original, "c", "r")).toEqual([
      "c",
      "s",
      "r",
    ]);
    expect(academicRelationshipPath(original, "r", "r")).toEqual(["r"]);
    expect(academicRelationshipPath(original, "r", "missing")).toEqual([]);
    expect(academicRelationshipPath(original, "r", "isolated")).toEqual([]);
    expect([...academicReachable(original, "r", "up")].sort()).toEqual([
      "a",
      "c",
      "r",
      "s",
    ]);
  });
  it("exports both person and relationship CSV rows with quoting and formula protection", () => {
    const original = graph();
    original.nodes[0].name = "  =SUM(1,2)";
    original.nodes[1].name = 'Name "quoted"\nnext';
    const csv = academicTreeCSV(original);
    expect(csv).toContain('"\'  =SUM(1,2)"');
    expect(csv).toContain('"Name ""quoted""\nnext"');
    expect(csv).toContain('"relationship","","","","a","r","phd"');
  });
});

describe("academic tree exports", () => {
  let canvas: AcademicTreeCanvas;
  let saved: ReturnType<typeof vi.fn>;
  let result: number;
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 500,
    } as DOMRect);
    canvas = new AcademicTreeCanvas(
      document,
      "Tree",
      () => {},
      () => {},
      (n) => n.name,
      () => {},
      () => {},
    );
    document.body.append(canvas.element);
    canvas.render(graph(), "r");
    result = 0;
    saved = vi.fn();
    class Picker {
      modeSave = 1;
      returnOK = 0;
      returnReplace = 2;
      filterAll = 0;
      file = "/test/tree";
      defaultString = "";
      init() {}
      appendFilter() {}
      appendFilters() {}
      async show() {
        return result;
      }
    }
    vi.stubGlobal("Zotero", {
      getMainWindow: () => ({ FilePicker: Picker }),
      File: { putContentsAsync: saved },
    });
  });
  afterEach(() => {
    canvas.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("creates valid portable SVG with the current viewport or full bounds, without changing pan/zoom", () => {
    const original = graph();
    original.nodes[0].name = "A & B <C>\u00a0D";
    canvas.render(original);
    canvas.zoom(1.3);
    const viewport = canvas.captureViewport();
    for (const full of [false, true]) {
      const picture = canvas.exportSVG(full);
      const parsed = new DOMParser().parseFromString(
        picture.svg,
        "image/svg+xml",
      );
      expect(parsed.querySelector("parsererror")).toBeNull();
      expect(picture.svg).not.toMatch(/var\(|color-mix\(/);
      expect(
        parsed.querySelector('g[data-author-id="a"] title')?.textContent,
      ).toBe("A & B <C>\u00a0D");
      expect(parsed.querySelector("svg > g")?.hasAttribute("transform")).toBe(
        !full,
      );
    }
    expect(canvas.captureViewport()).toEqual(viewport);
  });
  it("exports JSON with graph identity and settings, CSV relations and full SVG despite a filtered canvas", async () => {
    const original = graph();
    const hidden = { ...state(), showCoAdvisors: false };
    const projected = projectAcademicTree(original, hidden);
    canvas.render(projected);
    await exportAcademicTree(
      document,
      projected,
      canvas,
      hidden,
      { up: 2, down: 8 },
      "json",
      false,
    );
    const json = JSON.parse(saved.mock.calls[0][1]);
    expect(json.scope).toBe("visible-tree");
    expect(json.graph.nodes.some((n: { id: string }) => n.id === "c")).toBe(
      false,
    );
    expect(json.settings).toEqual({ up: 2, down: 8 });
    expect(json.view.showCoAdvisors).toBe(false);
    await exportAcademicTree(
      document,
      original,
      canvas,
      hidden,
      {},
      "svg",
      true,
    );
    expect(saved.mock.calls[1][1]).toContain('data-author-id="c"');
    expect(canvas.element.querySelector('[data-author-id="c"]')).toBeNull();
    await exportAcademicTree(
      document,
      original,
      canvas,
      hidden,
      {},
      "csv",
      true,
    );
    expect(saved.mock.calls[2][1]).toContain('"relationship"');
  });
  it("does not write on native picker cancellation and propagates write failures", async () => {
    result = 1;
    expect(
      await exportAcademicTree(
        document,
        graph(),
        canvas,
        state(),
        {},
        "json",
        true,
      ),
    ).toBe(false);
    expect(saved).not.toHaveBeenCalled();
    result = 0;
    saved.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      exportAcademicTree(document, graph(), canvas, state(), {}, "json", true),
    ).rejects.toThrow("disk full");
  });
  it("writes bounded PNG bytes and releases the image URL on success and decode failure", async () => {
    const createURL = vi.fn(() => "blob:test"),
      revokeURL = vi.fn(),
      write = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: createURL,
      revokeObjectURL: revokeURL,
    });
    vi.stubGlobal("IOUtils", { write });
    const create = document.createElementNS.bind(document);
    let fail = false;
    vi.spyOn(document, "createElementNS").mockImplementation(((
      ns: string,
      tag: string,
    ) => {
      const el = create(ns, tag);
      if (tag === "img")
        queueMicrotask(() =>
          el.dispatchEvent(new Event(fail ? "error" : "load")),
        );
      return el;
    }) as typeof document.createElementNS);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (callback) {
        expect(this.width).toBeLessThanOrEqual(8192);
        expect(this.height).toBeLessThanOrEqual(8192);
        expect(this.width * this.height).toBeLessThanOrEqual(16_000_000);
        callback({
          arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
        } as Blob);
      },
    );
    vi.spyOn(canvas, "exportSVG").mockReturnValue({
      width: 100_000,
      height: 100_000,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000" viewBox="0 0 100000 100000"/>',
    });
    await exportAcademicTree(
      document,
      graph(),
      canvas,
      state(),
      {},
      "png",
      false,
    );
    expect(write).toHaveBeenCalledWith(
      "/test/tree",
      new Uint8Array([137, 80, 78, 71]),
    );
    expect(revokeURL).toHaveBeenCalledTimes(1);
    fail = true;
    await expect(
      exportAcademicTree(document, graph(), canvas, state(), {}, "png", false),
    ).rejects.toThrow("SVG decode failed");
    expect(write).toHaveBeenCalledTimes(1);
    expect(revokeURL).toHaveBeenCalledTimes(2);
  });
});
