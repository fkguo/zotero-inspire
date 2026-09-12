import { describe, it, expect, vi } from "vitest";
import {
  buildAcademicTree,
  clampAcademicDepth,
} from "../src/modules/inspire/academicTreeService";
import { ACADEMIC_TREE_DEFAULT_DEPTH } from "../src/modules/inspire/academicTreeTypes";
import type {
  AcademicTreeSource,
  AcademicTreeGraph,
} from "../src/modules/inspire/academicTreeTypes";
import type { InspireAuthorProfile } from "../src/modules/inspire/types";
import {
  layoutAcademicTree,
  wrapAcademicName,
  ACADEMIC_NODE_WIDTH,
  ACADEMIC_NODE_HEIGHT,
} from "../src/modules/inspire/academicTreeLayout";
import { parseAuthorProfile } from "../src/modules/inspire/authorProfileService";

const person = (
  id: number,
  advisors: Array<{ recid?: string; name: string; degreeType?: string }> = [],
): InspireAuthorProfile => ({
  recid: String(id),
  name: `Person ${id}`,
  advisors,
});
const advisor = (id: number, degreeType = "phd") => ({
  recid: String(id),
  name: `Person ${id}`,
  degreeType,
});
function sourceFor(profiles: InspireAuthorProfile[]): AcademicTreeSource {
  return {
    profile: vi.fn(async (id) => {
      const p = profiles.find((p) => p.recid === id);
      if (!p) throw new Error("404");
      return p;
    }),
    students: vi.fn(async (id) => {
      const found = profiles.filter((p) =>
        p.advisors?.some((a) => a.recid === id),
      );
      return { profiles: found, total: found.length, hasMore: false };
    }),
  };
}
const opts = (source: AcademicTreeSource) => ({
  source,
  signal: new AbortController().signal,
  upDepth: 2,
  downDepth: 2,
  maxNodes: 200,
});

describe("academic tree traversal", () => {
  it("refreshes manually expanded branches from new records without retaining removed relationships", async () => {
    const profiles = [
      person(1),
      person(2, [advisor(1)]),
      person(3, [advisor(2)]),
    ];
    const source = sourceFor(profiles);
    const graph = await buildAcademicTree(profiles[0], {
      ...opts(source),
      upDepth: 0,
      downDepth: 1,
      expansions: [{ id: "2", direction: "down" }],
    });
    expect(graph.nodes.map((n) => n.id)).toContain("3");
    const changed = sourceFor([
      profiles[0],
      profiles[1],
      person(4, [advisor(2)]),
    ]);
    const fresh = await buildAcademicTree(profiles[0], {
      ...opts(changed),
      upDepth: 0,
      downDepth: 1,
      expansions: [{ id: "2", direction: "down" }],
    });
    expect(fresh.nodes.map((n) => n.id)).toContain("4");
    expect(fresh.nodes.map((n) => n.id)).not.toContain("3");
  });
  it("hydrates boundary mentors' current affiliations without expanding past the selected depth", async () => {
    const mentor = {
      ...person(2, [advisor(3)]),
      currentPosition: { institution: "Current Institute" },
    };
    const root = person(1, [advisor(2)]);
    const graph = await buildAcademicTree(root, {
      ...opts(sourceFor([root, mentor, person(3)])),
      upDepth: 1,
      downDepth: 0,
      hydrateProfiles: true,
    });
    expect(graph.nodes.map((n) => n.id)).toEqual(["1", "2"]);
    expect(graph.nodes.find((n) => n.id === "2")?.institution).toBe(
      "Current Institute",
    );
  });
  it("does not rehydrate existing students when expanding a single branch", async () => {
    const profiles = [
      person(1),
      ...Array.from({ length: 150 }, (_, i) => person(i + 2, [advisor(1)])),
      person(152, [advisor(2)]),
    ];
    const source = sourceFor(profiles);
    const initial = await buildAcademicTree(profiles[0], {
      ...opts(source),
      upDepth: 0,
      downDepth: 1,
      hydrateProfiles: true,
    });
    vi.mocked(source.profile).mockClear();
    const expanded = await buildAcademicTree(profiles[1], {
      ...opts(source),
      upDepth: 0,
      downDepth: 1,
      existing: initial,
      hydrateProfiles: true,
    });
    expect(expanded.nodes.some((n) => n.id === "152")).toBe(true);
    expect(source.profile).not.toHaveBeenCalled();
  });
  it("retries hydration budget omissions and excludes completed requests from the next request budget", async () => {
    const root = person(
      1,
      Array.from({ length: 601 }, (_, i) => advisor(i + 2)),
    );
    const completed = new Set<string>();
    const source: AcademicTreeSource = {
      hasProfile: (id) => completed.has(id),
      profile: async (id) => {
        completed.add(id);
        return {
          ...person(Number(id)),
          currentPosition: { institution: "Institute" },
        };
      },
      students: async () => ({ profiles: [], total: 0, hasMore: false }),
    };
    const options = {
      ...opts(source),
      maxNodes: 1000,
      upDepth: 1,
      downDepth: 0,
      hydrateProfiles: true,
    };
    const first = await buildAcademicTree(root, options);
    expect(first.limited).toBe(false);
    expect(first.profileFailures).toHaveLength(101);
    const retry = await buildAcademicTree(root, options);
    expect(retry.profileFailures).toHaveLength(0);
    expect(retry.nodes.find((n) => n.id === "602")?.institution).toBe(
      "Institute",
    );
  });
  it("defaults to two generations and allows only 0–8", () => {
    expect(ACADEMIC_TREE_DEFAULT_DEPTH).toBe(2);
    expect([-3, 0, 2, 6, 8, 20, NaN].map(clampAcademicDepth)).toEqual([
      0, 0, 2, 6, 8, 8, 2,
    ]);
  });
  it("honors independent zero, two and eight generation bounds", async () => {
    const profiles = Array.from({ length: 25 }, (_, i) =>
      person(i + 1, i ? [advisor(i)] : []),
    );
    const source = sourceFor(profiles);
    for (const [up, down] of [
      [0, 0],
      [2, 2],
      [8, 0],
      [0, 8],
      [8, 8],
    ]) {
      const graph = await buildAcademicTree(profiles[12], {
        ...opts(source),
        upDepth: up,
        downDepth: down,
      });
      expect(
        graph.nodes.map((n) => Number(n.id)).sort((a, b) => a - b),
      ).toEqual(Array.from({ length: up + down + 1 }, (_, i) => 13 - up + i));
      expect(graph.nodes.find((n) => n.id === "13")?.level).toBe(0);
    }
  });
  it("prevents local expansion past eight generations, but allows tracing from a new root", async () => {
    const profiles = Array.from({ length: 25 }, (_, i) =>
      person(i + 1, i ? [advisor(i)] : []),
    );
    const source = sourceFor(profiles);
    const initial = await buildAcademicTree(profiles[12], {
      ...opts(source),
      upDepth: 99,
      downDepth: 99,
    });
    expect(
      initial.nodes.map((node) => Number(node.id)).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 17 }, (_, i) => i + 5));
    for (const [id, direction] of [
      [5, "up"],
      [21, "down"],
    ] as const) {
      vi.mocked(source.profile).mockClear();
      vi.mocked(source.students).mockClear();
      const expanded = await buildAcademicTree(profiles[id - 1], {
        ...opts(source),
        existing: initial,
        upDepth: Number(direction === "up"),
        downDepth: Number(direction === "down"),
      });
      expect(expanded.nodes).toEqual(initial.nodes);
      expect(source.profile).not.toHaveBeenCalled();
      expect(source.students).not.toHaveBeenCalled();
      const recentered = await buildAcademicTree(profiles[id - 1], {
        ...opts(source),
        upDepth: 8,
        downDepth: 8,
      });
      expect(
        recentered.nodes.some(
          (node) => node.id === String(id + (direction === "up" ? -1 : 1)),
        ),
      ).toBe(true);
      expect(recentered.nodes.every((node) => Math.abs(node.level) <= 8)).toBe(
        true,
      );
    }
  });
  it("preserves co-advisors and multiple degrees with one node per author", async () => {
    const profiles = [
      person(1),
      person(2),
      person(3, [advisor(1, "master"), advisor(1), advisor(2)]),
    ];
    const graph = await buildAcademicTree(
      profiles[0],
      opts(sourceFor(profiles)),
    );
    expect(graph.nodes).toHaveLength(3);
    expect(
      graph.edges.find((e) => e.source === "1")?.degreeTypes.sort(),
    ).toEqual(["master", "phd"]);
    expect(graph.edges.some((e) => e.source === "2" && e.target === "3")).toBe(
      true,
    );
  });
  it("does not infer unlinked identities, even when their names match", async () => {
    const profiles = [
      person(1, [{ name: "Same Name" }]),
      person(2, [{ name: "Same Name", recid: "1" }]),
    ];
    const graph = await buildAcademicTree(
      profiles[0],
      opts(sourceFor(profiles)),
    );
    const unlinked = graph.nodes.filter((n) => !n.recid);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].id).not.toBe("1");
    expect(graph.nodes.filter((n) => n.recid === "1")).toHaveLength(1);
  });
  it("filters each relationship, without promoting other to PhD", async () => {
    const profiles = [
      person(1),
      person(2, [advisor(1, "other")]),
      person(3, [advisor(1)]),
      person(4, [advisor(1, "master")]),
    ];
    const graph = await buildAcademicTree(profiles[0], {
      ...opts(sourceFor(profiles)),
      degreeFilter: "phd",
    });
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["1", "3"]);
  });
  it("deduplicates cyclic records and terminates eight-generation traversal", async () => {
    const profiles = [person(1, [advisor(2)]), person(2, [advisor(1)])];
    const source = sourceFor(profiles);
    const graph = await buildAcademicTree(profiles[0], {
      ...opts(source),
      upDepth: 8,
      downDepth: 8,
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);
    expect(source.students).toHaveBeenCalledTimes(2);
  });
  it("follows student pages, verifies the reverse link and handles partial failure", async () => {
    const source = sourceFor([person(1)]);
    source.students = vi.fn(async (id, page) => {
      if (page === 2) throw new Error("502");
      return {
        profiles: [person(2, [advisor(1)]), person(3, [advisor(99)])],
        total: 4,
        hasMore: true,
      };
    });
    const graph = await buildAcademicTree(person(1), {
      ...opts(source),
      upDepth: 0,
      downDepth: 1,
    });
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["1", "2"]);
    expect(graph.failures).toEqual([{ id: "1", direction: "down" }]);
    expect(graph.expanded.down).not.toContain("1");
    expect(graph.empty.down).not.toContain("1");
  });
  it("limits nodes, retains partial results and can expand a retained branch", async () => {
    const profiles = [
      person(1),
      ...Array.from({ length: 20 }, (_, i) => person(i + 2, [advisor(1)])),
    ];
    const source = sourceFor(profiles);
    const limited = await buildAcademicTree(profiles[0], {
      ...opts(source),
      maxNodes: 5,
      downDepth: 1,
    });
    expect(limited.nodes).toHaveLength(5);
    expect(limited.limited).toBe(true);
    const resumed = await buildAcademicTree(profiles[0], {
      ...opts(source),
      existing: limited,
      downDepth: 1,
      upDepth: 0,
    });
    expect(resumed.nodes).toHaveLength(21);
    expect(resumed.limited).toBe(false);
  });
  it("keeps missing-data and request-error states distinct", async () => {
    const root = person(1, [advisor(9)]);
    const graph = await buildAcademicTree(root, opts(sourceFor([root])));
    expect(graph.failures).toContainEqual({ id: "9", direction: "up" });
    expect(graph.empty.up).not.toContain("9");
    expect(graph.empty.down).toContain("1");
  });
  it("aborts further traversal while leaving emitted partial results usable", async () => {
    const controller = new AbortController();
    let partial: AcademicTreeGraph | undefined;
    const profiles = [
      person(1),
      person(2, [advisor(1)]),
      person(3, [advisor(2)]),
    ];
    const source = sourceFor(profiles);
    await expect(
      buildAcademicTree(profiles[0], {
        ...opts(source),
        upDepth: 0,
        signal: controller.signal,
        onProgress: (graph) => {
          partial = graph;
          if (graph.nodes.length > 1) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(partial?.nodes.map((n) => n.id)).toEqual(["1", "2"]);
    expect(source.students).toHaveBeenCalledTimes(1);
  });
  it("keeps unresolved node IDs stable across degree-filtered local expansions", async () => {
    const p = person(1, [
      { name: "Master", degreeType: "master" },
      { name: "PhD", degreeType: "phd" },
    ]);
    const source = sourceFor([p]);
    const graph = await buildAcademicTree(p, {
      ...opts(source),
      degreeFilter: "phd",
      downDepth: 0,
    });
    const next = await buildAcademicTree(p, {
      ...opts(source),
      existing: graph,
      degreeFilter: "phd",
      downDepth: 0,
    });
    expect(next.nodes.filter((n) => !n.recid)).toHaveLength(1);
  });
});

describe("academic tree metadata and layout", () => {
  it("excludes hidden advisors and retains degree and identity", () => {
    const profile = parseAuthorProfile(
      {
        name: { value: "Test" },
        advisors: [
          { name: "Hidden", hidden: true },
          {
            name: "Public",
            record: { $ref: "https://inspirehep.net/api/authors/4" },
            degree_type: "master",
          },
        ],
      },
      1,
    );
    expect(profile?.advisors).toEqual([
      { name: "Public", recid: "4", degreeType: "master" },
    ]);
  });
  it("places a co-advisor below their own mentors and keeps the other mentor close to the shared student", async () => {
    const profiles = [
      { ...person(1), name: "Ulf-G. Meissner" },
      { ...person(2, [advisor(1), advisor(3)]), name: "Shared Student" },
      { ...person(3, [advisor(1), advisor(4)]), name: "Feng-Kun Guo" },
      { ...person(4), name: "Peng Nian Shen" },
      ...Array.from({ length: 20 }, (_, i) =>
        person(i + 5, [advisor(i < 10 ? 1 : 3)]),
      ),
    ];
    const graph = await buildAcademicTree(profiles[0], {
      ...opts(sourceFor(profiles)),
      downDepth: 2,
    });
    // Guo is discovered as the co-advisor of person 2 before his own student record.
    expect(graph.nodes.find((node) => node.id === "3")?.level).toBe(0);
    const original = JSON.stringify(graph);
    const layout = layoutAcademicTree(graph);
    const node = (id: string) => layout.nodes.find((node) => node.id === id)!;
    expect(node("3").y).toBeGreaterThan(node("1").y);
    expect(node("3").y).toBeGreaterThan(node("4").y);
    expect(Math.abs(node("3").x - node("4").x)).toBeLessThan(
      ACADEMIC_NODE_WIDTH + 24,
    );
    for (const edge of graph.edges)
      expect(node(edge.source).y).toBeLessThan(node(edge.target).y);
    expect(JSON.stringify(graph)).toBe(original);
    expect(layout.nodes.map((n) => [n.id, n.level]).sort()).toEqual(
      graph.nodes.map((n) => [n.id, n.level]).sort(),
    );
    expect(
      layoutAcademicTree({
        ...graph,
        nodes: [...graph.nodes].reverse(),
        edges: [...graph.edges].reverse(),
      }),
    ).toEqual(layout);
  });
  it("keeps cyclic identities separate while ranking their incoming and outgoing relationships", () => {
    const graph: AcademicTreeGraph = {
      rootId: "b",
      nodes: ["a", "b", "c", "d"].map((id) => ({ id, name: id, level: 0 })),
      edges: [
        ["a", "b"],
        ["b", "c"],
        ["c", "b"],
        ["c", "d"],
      ].map(([source, target]) => ({ source, target, degreeTypes: [] })),
      expanded: { up: [], down: [] },
      empty: { up: [], down: [] },
      failures: [],
      limited: false,
    };
    const nodes = layoutAcademicTree(graph).nodes;
    const node = (id: string) => nodes.find((node) => node.id === id)!;
    expect(nodes).toHaveLength(4);
    expect(node("a").y).toBeLessThan(node("b").y);
    expect(node("b").y).toBe(node("c").y);
    expect(Math.abs(node("b").x - node("c").x)).toBeGreaterThanOrEqual(
      node("b").width,
    );
    expect(node("d").y).toBeGreaterThan(node("c").y);
  });
  it("keeps uneven family branches contiguous and aligns mentors with their students", async () => {
    const profiles = [
      person(1),
      person(2, [advisor(1)]),
      person(3, [advisor(1)]),
      ...Array.from({ length: 12 }, (_, i) =>
        person(i + 4, [advisor(i < 9 ? 2 : 3)]),
      ),
    ];
    // Interleaved surnames would scatter siblings in an alphabetical layout.
    profiles.forEach((p, i) => {
      p.name = `Name ${(i * 7) % 17}`;
    });
    const graph = await buildAcademicTree(profiles[0], {
      ...opts(sourceFor(profiles)),
      downDepth: 2,
    });
    const layout = layoutAcademicTree(graph);
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x;
    const left = Array.from({ length: 9 }, (_, i) => x(String(i + 4)));
    const right = Array.from({ length: 3 }, (_, i) => x(String(i + 13)));
    expect(
      Math.max(...left) < Math.min(...right) ||
        Math.max(...right) < Math.min(...left),
    ).toBe(true);
    for (const [id, children] of [
      ["2", left],
      ["3", right],
    ] as const)
      expect(
        Math.abs(x(id) - children.reduce((a, b) => a + b, 0) / children.length),
      ).toBeLessThan(1);
    expect(graph.nodes.every((n) => !("x" in n))).toBe(true);
    expect(
      layoutAcademicTree({
        ...graph,
        nodes: [...graph.nodes].reverse(),
        edges: [...graph.edges].reverse(),
      }),
    ).toEqual(layout);
  });
  it("retains shared advisors, unlinked names and cyclic edges without overlapping cards", () => {
    const graph: AcademicTreeGraph = {
      rootId: "a",
      nodes: [
        { id: "a", name: "Same Name", recid: "a", level: 0 },
        { id: "b", name: "Same Name", recid: "b", level: 0 },
        { id: "unlinked", name: "Same Name", level: 0 },
        { id: "student", name: "Student", recid: "student", level: 1 },
        { id: "far", name: "Far", recid: "far", level: 3 },
      ],
      edges: [
        ...["a", "b", "unlinked"].map((source) => ({
          source,
          target: "student",
          degreeTypes: ["phd"],
        })),
        { source: "student", target: "a", degreeTypes: ["other"] },
        { source: "student", target: "far", degreeTypes: ["phd"] },
      ],
      expanded: { up: [], down: [] },
      empty: { up: [], down: [] },
      failures: [],
      limited: false,
    };
    const original = JSON.stringify(graph);
    const layout = layoutAcademicTree(graph);
    expect(JSON.stringify(graph)).toBe(original);
    expect(layout.nodes).toHaveLength(5);
    expect(
      layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
    ).toBe(true);
    for (const [i, a] of layout.nodes.entries())
      for (const b of layout.nodes.slice(i + 1))
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
  });
  it("lays out all nodes without overlaps and respects ascending generations", async () => {
    const profiles = Array.from({ length: 60 }, (_, i) =>
      person(i + 1, i ? [advisor(Math.floor((i - 1) / 4) + 1)] : []),
    );
    const graph = await buildAcademicTree(profiles[0], {
      ...opts(sourceFor(profiles)),
      downDepth: 8,
    });
    const layout = layoutAcademicTree(graph);
    for (const [i, a] of layout.nodes.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      for (const b of layout.nodes.slice(i + 1))
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
    }
    for (const edge of graph.edges) {
      const from = layout.nodes.find((n) => n.id === edge.source)!,
        to = layout.nodes.find((n) => n.id === edge.target)!;
      expect(from.y).toBeLessThan(to.y);
    }
    expect(layoutAcademicTree(graph)).toEqual(layout);
  });
});

describe("academic name labels", () => {
  const width = (text: string) =>
    Array.from(text).reduce(
      (sum, char) =>
        sum + (char.codePointAt(0)! > 127 || char === "W" ? 13 : 7),
      0,
    );
  it.each([
    "王".repeat(35),
    "W".repeat(35),
    "😀".repeat(35),
    "Alexandria Elizabeth Montgomery-Wellington Junior",
  ])("keeps a long label within the card's pixel width: %s", (name) => {
    const lines = wrapAcademicName(name, width);
    expect(lines).toHaveLength(2);
    expect(lines.at(-1)).toMatch(/…$/);
    for (const line of lines) {
      expect(width(line)).toBeLessThanOrEqual(ACADEMIC_NODE_WIDTH - 24);
      expect(line).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/u);
    }
  });
  it("preserves short names and wraps at a word boundary when possible", () => {
    expect(wrapAcademicName("  Chen   Ning Yang  ", width)).toEqual([
      "Chen Ning Yang",
    ]);
    expect(wrapAcademicName("Alexandria Montgomery", width, 100)).toEqual([
      "Alexandria",
      "Montgomery",
    ]);
  });
});
