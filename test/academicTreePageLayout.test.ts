import { describe, expect, it } from "vitest";
import { layoutAcademicTree } from "../src/modules/inspire/academicTreeLayout";
import { pageAcademicTree } from "../src/modules/inspire/academicTreePageLayout";
import { createAcademicRouter } from "../src/modules/inspire/academicTreeRouting";
import type { AcademicTreeGraph } from "../src/modules/inspire/academicTreeTypes";
import fixture from "./fixtures/academic-tree-sorting.json";
import expanded from "./fixtures/academic-tree-expanded.json";

describe("academic page layout", () => {
  it("keeps a shared student below mentors from two different generations in both layouts", () => {
    const graph: AcademicTreeGraph = {
      rootId: "b",
      nodes: [
        { id: "a", name: "Mentor A", level: -1 },
        { id: "b", name: "Mentor B", level: 0 },
        { id: "c", name: "Student C", level: 0 },
      ],
      edges: [
        ["a", "b"],
        ["a", "c"],
        ["b", "c"],
      ].map(([source, target]) => ({ source, target, degreeTypes: [] })),
      expanded: { up: [], down: [] },
      empty: { up: [], down: [] },
      failures: [],
      limited: false,
    };
    const tree = layoutAcademicTree(graph);
    for (const layout of [
      tree,
      pageAcademicTree(tree, graph.rootId, graph.edges, 640),
    ]) {
      const a = layout.nodes.find((node) => node.id === "a")!;
      const b = layout.nodes.find((node) => node.id === "b")!;
      const c = layout.nodes.find((node) => node.id === "c")!;
      expect(a.y + a.height).toBeLessThan(b.y);
      expect(b.y + b.height).toBeLessThan(c.y);
      expect(
        [a, b, c].map(
          (node) => layout.rows!.find((row) => row.y === node.y)!.generation,
        ),
      ).toEqual([-1, 0, 1]);
    }
  });
  for (const graph of [fixture.graph, expanded.graph] as AcademicTreeGraph[])
    for (const sort of ["name", "year"] as const)
      it(`wraps ${graph.nodes.length} people sorted by ${sort} without shrinking, overlaps, or changed reading order`, () => {
        const original = layoutAcademicTree(graph, undefined, sort);
        for (const width of [360, 640, 1024]) {
          const page = pageAcademicTree(
            original,
            graph.rootId,
            graph.edges,
            width,
          );
          const byId = new Map(page.nodes.map((n) => [n.id, n]));
          expect(page.width).toBe(width);
          expect(page.nodes).toHaveLength(graph.nodes.length);
          expect(page.rows!.some((r) => r.parts > 1)).toBe(true);
          for (const n of original.nodes) {
            const p = byId.get(n.id)!;
            expect([p.width, p.height]).toEqual([n.width, n.height]);
            expect(p.x).toBeGreaterThanOrEqual(112);
            expect(p.x + p.width).toBeLessThanOrEqual(width);
            expect(p.y + p.height).toBeLessThan(page.height);
          }
          for (const top of new Set(original.nodes.map((n) => n.y))) {
            const row = original.nodes
              .filter((n) => n.y === top)
              .sort((a, b) => a.x - b.x);
            const ids = new Set(row.map((n) => n.id));
            expect(
              page.nodes
                .filter((n) => ids.has(n.id))
                .sort((a, b) => a.y - b.y || a.x - b.x)
                .map((n) => n.id),
            ).toEqual(row.map((n) => n.id));
          }
          const route = createAcademicRouter(page.nodes, graph.edges);
          for (const e of graph.edges) {
            const from = byId.get(e.source)!,
              to = byId.get(e.target)!;
            const path = route(from, to);
            expect(path).not.toMatch(/NaN|Infinity/);
            let x = 0,
              y = 0;
            for (const part of path.matchAll(
              /([MVH])(-?[\d.]+)(?:,(-?[\d.]+))?/g,
            )) {
              const nx = part[1] === "V" ? x : Number(part[2]);
              const ny =
                part[1] === "H"
                  ? y
                  : Number(part[1] === "M" ? part[3] : part[2]);
              if (part[1] !== "M")
                for (const n of page.nodes) {
                  if (n.id === from.id || n.id === to.id) continue;
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
                    `${from.name} → ${to.name} crosses ${n.name}`,
                  ).toBe(false);
                }
              x = nx;
              y = ny;
            }
          }
        }
      });
});
