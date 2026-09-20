import { describe, it, expect } from "vitest";
import { layoutAcademicTree } from "../src/modules/inspire/academicTreeLayout";
import {
  academicEdgePath,
  createAcademicRouter,
} from "../src/modules/inspire/academicTreeRouting";
import type { AcademicTreeGraph } from "../src/modules/inspire/academicTreeTypes";
import fixture from "./fixtures/academic-tree-expanded.json";

const graph = (
  names: string[],
  edges: string[][],
  rootId = "root",
): AcademicTreeGraph => ({
  rootId,
  nodes: names.map((name) => ({ id: name, name, level: 0 })),
  edges: edges.map(([source, target]) => ({ source, target, degreeTypes: [] })),
  expanded: { up: [], down: [] },
  empty: { up: [], down: [] },
  failures: [],
  limited: false,
});
const center = (n: { x: number; width: number }) => n.x + n.width / 2;
it("keeps every ordinary-layout connector outside non-endpoint cards in the expanded fixture", () => {
  const layout = layoutAcademicTree(fixture.graph as AcademicTreeGraph);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const route = createAcademicRouter(layout.nodes, fixture.graph.edges);
  for (const edge of fixture.graph.edges) {
    const path = route(byId.get(edge.source)!, byId.get(edge.target)!);
    expect(path).not.toMatch(/NaN|Infinity/);
    let x = 0,
      y = 0;
    for (const part of path.matchAll(/([MVH])(-?[\d.]+)(?:,(-?[\d.]+))?/g)) {
      const nx = part[1] === "V" ? x : Number(part[2]);
      const ny =
        part[1] === "H" ? y : Number(part[1] === "M" ? part[3] : part[2]);
      if (part[1] !== "M")
        for (const n of layout.nodes) {
          if (n.id === edge.source || n.id === edge.target) continue;
          const intersects =
            x === nx
              ? x > n.x &&
                x < n.x + n.width &&
                Math.max(y, ny) > n.y &&
                Math.min(y, ny) < n.y + n.height
              : y > n.y &&
                y < n.y + n.height &&
                Math.max(x, nx) > n.x &&
                Math.min(x, nx) < n.x + n.width;
          expect(
            intersects,
            `${edge.source} → ${edge.target} crosses ${n.name}`,
          ).toBe(false);
        }
      x = nx;
      y = ny;
    }
  }
});
const card = (id: string, x: number, y: number, width: number) => ({
  id,
  name: id,
  level: 0,
  x,
  y,
  width,
  height: 30,
});
const endX = (path: string) =>
  [...path.matchAll(/(?:M|H)([-\d.]+)/g)].map((m) => Number(m[1])).at(-1)!;

it("chooses one clear corridor across successive rows instead of a locally short zigzag", () => {
  const nodes = [
    card("source", 50, 0, 100),
    card("upper", 80, 100, 40),
    card("lower", 10, 200, 75),
    card("target", 25, 300, 100),
  ];
  const path = academicEdgePath(nodes[0], nodes[3], nodes);
  expect(path.match(/H/g)).toHaveLength(2);
  // The single detour passes to the right of BOTH obstacles.
  const turns = [...path.matchAll(/H([-\d.]+)/g)].map((m) => Number(m[1]));
  expect(turns[0]).toBeGreaterThan(120);
  expect(turns[1]).toBe(75);
  expect(academicEdgePath(nodes[0], nodes[3], [...nodes].reverse())).toBe(path);
});

it("removes a tiny final jog with a bounded off-center port, retaining separate co-advisor arrows", () => {
  const nodes = [
    card("source", 50, 0, 100),
    card("obstacle", 98, 100, 82),
    card("target", 50, 200, 100),
    card("other", -100, 0, 100),
  ];
  const edge = { source: "source", target: "target", degreeTypes: [] };
  const path = createAcademicRouter(nodes, [edge])(nodes[0], nodes[2]);
  expect(path.match(/H/g)).toHaveLength(1);
  expect(Math.abs(endX(path) - center(nodes[2]))).toBeLessThanOrEqual(12);
  expect(endX(path)).toBeLessThan(98);
  const shared = createAcademicRouter(nodes, [
    edge,
    { ...edge, source: "other" },
  ]);
  expect(
    Math.abs(
      endX(shared(nodes[0], nodes[2])) - endX(shared(nodes[3], nodes[2])),
    ),
  ).toBe(10);
});
describe("compact academic layout and routing", () => {
  it("keeps the focus's single-supervisor chain vertical with many expanded siblings", () => {
    const siblings = Array.from({ length: 32 }, (_, i) => `sibling ${i}`);
    const g = graph(
      ["grand", "mentor", "root", ...siblings, "child1", "child2"],
      [
        ["grand", "mentor"],
        ["mentor", "root"],
        ...siblings.map((s) => ["mentor", s]),
        ["root", "child1"],
        ["root", "child2"],
      ],
    );
    const layout = layoutAcademicTree(g);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const students = [byId.get("child1")!, byId.get("child2")!];
    expect(center(byId.get("root")!)).toBeCloseTo(
      (Math.min(...students.map((n) => n.x)) +
        Math.max(...students.map((n) => n.x + n.width))) /
        2,
      8,
    );
    for (const [parent, child] of [
      ["grand", "mentor"],
      ["mentor", "root"],
    ]) {
      expect(center(byId.get(parent)!)).toBeCloseTo(
        center(byId.get(child)!),
        8,
      );
      expect(
        academicEdgePath(byId.get(parent)!, byId.get(child)!, layout.nodes),
      ).not.toMatch(/[CHQ]/);
    }
    for (const a of layout.nodes)
      for (const b of layout.nodes)
        if (a.id !== b.id)
          expect(
            a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y,
          ).toBe(true);
    const ordered = layout.nodes
      .filter((n) => siblings.includes(n.id))
      .sort((a, b) => a.x - b.x)
      .map((n) => n.name);
    expect(ordered).toEqual(
      [...siblings].sort((a, b) =>
        a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }),
      ),
    );
    expect(
      layoutAcademicTree({
        ...g,
        nodes: [...g.nodes].reverse(),
        edges: [...g.edges].reverse(),
      }),
    ).toEqual(layout);
  });
  it("adapts cards to content while preserving readable names", () => {
    const g = graph(
      ["Li", "A very long name that wraps across lines"],
      [],
      "Li",
    );
    g.nodes.push({
      id: "affiliation",
      name: "Li",
      institution: "Institute",
      level: 0,
    });
    const nodes = layoutAcademicTree(g).nodes;
    const short = nodes.find((n) => n.id === "Li")!,
      long = nodes.find((n) => n.id.includes("long"))!,
      affiliation = nodes.find((n) => n.id === "affiliation")!;
    expect(short.width).toBeLessThan(long.width);
    expect(short.height).toBeLessThan(long.height);
    expect(short.height).toBeLessThan(affiliation.height);
  });
  it("routes a skipped-generation link around intermediate cards and never through them", () => {
    const nodes = [
      { id: "a", name: "a", level: 0, x: 200, y: 24, width: 100, height: 28 },
      {
        id: "obstacle",
        name: "obstacle",
        level: 1,
        x: 170,
        y: 85,
        width: 144,
        height: 55,
      },
      { id: "b", name: "b", level: 2, x: 200, y: 175, width: 100, height: 28 },
    ];
    const path = academicEdgePath(nodes[0], nodes[2], nodes);
    let x = 0,
      y = 0;
    for (const match of path.matchAll(/([MVH])([\d.+-]+)(?:,([\d.+-]+))?/g)) {
      const nx = match[1] === "V" ? x : Number(match[2]);
      const ny = match[1] === "H" ? y : Number(match[3] ?? match[2]);
      if (match[1] !== "M") {
        const obstacle = nodes[1];
        expect(
          Math.max(x, nx) <= obstacle.x ||
            Math.min(x, nx) >= obstacle.x + obstacle.width ||
            Math.max(y, ny) <= obstacle.y ||
            Math.min(y, ny) >= obstacle.y + obstacle.height,
        ).toBe(true);
      }
      x = nx;
      y = ny;
    }
    expect(x).toBe(center(nodes[2]));
    expect(y).toBe(nodes[2].y);
    expect(path).not.toMatch(/[CQ]/);
  });
});

it("keeps overlapping horizontal family connectors in distinct lanes", async () => {
  const { createAcademicRouter } =
    await import("../src/modules/inspire/academicTreeRouting");
  const nodes = [
    { id: "a", name: "a", level: 0, x: 20, y: 24, width: 100, height: 28 },
    { id: "b", name: "b", level: 0, x: 200, y: 24, width: 100, height: 55 },
    { id: "c", name: "c", level: 1, x: 20, y: 109, width: 100, height: 28 },
    { id: "d", name: "d", level: 1, x: 200, y: 109, width: 100, height: 28 },
  ];
  const edges = [
    { source: "a", target: "d", degreeTypes: [] },
    { source: "b", target: "c", degreeTypes: [] },
  ];
  const route = createAcademicRouter(nodes, edges);
  const path1 = route(nodes[0], nodes[3]),
    path2 = route(nodes[1], nodes[2]);
  const busY = (path: string) => Number(path.match(/ V([\d.]+) H/)![1]);
  expect(busY(path1)).not.toBe(busY(path2));
  expect(busY(path1)).toBeGreaterThan(79);
  expect(busY(path1)).toBeLessThan(109);
  expect(
    createAcademicRouter([...nodes].reverse(), [...edges].reverse())(
      nodes[0],
      nodes[3],
    ),
  ).toBe(path1);
});

it("keeps the other supervisor near the shared student after expanding ancestors' students", async () => {
  const { default: fixture } =
    await import("./fixtures/academic-tree-expanded.json");
  const layout = layoutAcademicTree(fixture.graph as AcademicTreeGraph);
  const guo = layout.nodes.find((n) => n.id === "1027513")!,
    shen = layout.nodes.find((n) => n.id === "989070")!;
  const root = layout.nodes.find((n) => n.id === fixture.graph.rootId)!;
  const parentId = fixture.graph.edges.find(
    (e) => e.target === root.id,
  )!.source;
  const mentor = layout.nodes.find((n) => n.id === parentId)!;
  const studentIds = new Set(
    fixture.graph.edges
      .filter((e) => e.source === root.id)
      .map((e) => e.target),
  );
  const students = layout.nodes.filter((n) => studentIds.has(n.id));
  expect(center(root)).toBeCloseTo(
    (Math.min(...students.map((n) => n.x)) +
      Math.max(...students.map((n) => n.x + n.width))) /
      2,
    8,
  );
  expect(Math.abs(center(guo) - center(shen))).toBeLessThan(144);
  expect(center(root)).toBeCloseTo(center(mentor), 8);
  expect(layout.width).toBeLessThan(5000);
});

it("keeps different advisors' arrows separate at a shared student's card", async () => {
  const { createAcademicRouter } =
    await import("../src/modules/inspire/academicTreeRouting");
  const g = graph(
    ["root", "mentor", "student"],
    [
      ["root", "student"],
      ["mentor", "student"],
    ],
  );
  const layout = layoutAcademicTree(g);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const route = createAcademicRouter(layout.nodes, g.edges);
  const ends = ["root", "mentor"].map((id) => {
    const path = route(byId.get(id)!, byId.get("student")!);
    let x = 0;
    for (const m of path.matchAll(/([MH])([\d.+-]+)/g)) x = Number(m[2]);
    return x;
  });
  expect(Math.abs(ends[0] - ends[1])).toBe(10);
  const student = byId.get("student")!;
  for (const x of ends) {
    expect(x).toBeGreaterThan(student.x);
    expect(x).toBeLessThan(student.x + student.width);
  }
});

it.each([-1, 1])(
  "keeps the aligned advisor straight with another advisor on side %s",
  (side) => {
    const shen = card("shen", 90, 0, 120);
    const guo = card("guo", 100, 100, 100);
    const other = card("other", 100 + side * 240, 0, 100);
    const nodes = [shen, guo, other];
    const edges = [shen, other].map((n) => ({
      source: n.id,
      target: guo.id,
      degreeTypes: ["phd"],
    }));
    const route = createAcademicRouter(nodes, edges);
    expect(route(shen, guo)).toBe("M150,30 V100");
    expect(endX(route(other, guo))).toBe(150 + side * 10);
    expect(
      createAcademicRouter([...nodes].reverse(), [...edges].reverse())(
        shen,
        guo,
      ),
    ).toBe(route(shen, guo));
  },
);
