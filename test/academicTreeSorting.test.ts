import { describe, it, expect } from "vitest";
import { parseAuthorProfile } from "../src/modules/inspire/authorProfileService";
import {
  academicEducationYears,
  academicNodeOrder,
  academicSortYears,
} from "../src/modules/inspire/academicTreeSorting";
import { layoutAcademicTree } from "../src/modules/inspire/academicTreeLayout";
import type { AcademicTreeGraph } from "../src/modules/inspire/academicTreeTypes";

const graph: AcademicTreeGraph = {
  rootId: "1",
  nodes: [
    { id: "1", name: "Root", level: 0 },
    {
      id: "2",
      name: "Zoe Alpha",
      canonicalName: "Alpha, Zoe",
      educationYears: { phd: 2012 },
      level: 1,
    },
    {
      id: "3",
      name: "Amy van Buren",
      canonicalName: "van Buren, Amy",
      educationYears: { phd: 2005 },
      level: 1,
    },
    { id: "4", name: "Ben Gamma", canonicalName: "Gamma, Ben", level: 1 },
  ],
  edges: ["2", "3", "4"].map((target) => ({
    source: "1",
    target,
    degreeTypes: ["phd"],
  })),
  expanded: { up: [], down: [] },
  empty: { up: [], down: [] },
  failures: [],
  limited: false,
};
describe("academic genealogy sorting", () => {
  it("resolves contradictory degree-year orders in favor of the nearer advisor", () => {
    const shared: AcademicTreeGraph = {
      ...graph,
      nodes: [
        { id: "1", name: "PhD advisor", level: 0 },
        { id: "9", name: "Master advisor", level: 0 },
        {
          id: "2",
          name: "Alpha",
          level: 1,
          educationYears: { phd: 2002, master: 2000 },
        },
        {
          id: "3",
          name: "Beta",
          level: 1,
          educationYears: { phd: 2001, master: 2001 },
        },
      ],
      edges: ["2", "3"].flatMap((target) => [
        { source: "1", target, degreeTypes: ["phd"] },
        { source: "9", target, degreeTypes: ["master"] },
      ]),
    };
    for (const [rootId, expected] of [
      ["1", ["3", "2"]],
      ["9", ["2", "3"]],
    ] as const)
      expect(
        layoutAcademicTree({ ...shared, rootId }, undefined, "year")
          .nodes.filter((n) => ["2", "3"].includes(n.id))
          .sort((a, b) => a.x - b.x)
          .map((n) => n.id),
      ).toEqual(expected);
  });
  it("uses the degree on the chosen advisor relationship, not other advisors' degrees", () => {
    const mixed = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === "3"
          ? { ...n, educationYears: { phd: 2005, master: 2002 } }
          : n,
      ),
      edges: [
        ...graph.edges,
        { source: "9", target: "3", degreeTypes: ["master"] },
        { source: "10", target: "3", degreeTypes: ["other"] },
      ],
    };
    expect(academicSortYears(mixed, "1").get("3")).toBe(2005);
    expect(academicSortYears(mixed, "9").get("3")).toBe(2002);
    expect(academicSortYears(mixed, "10").has("3")).toBe(false);
  });
  it("sorts final card positions in the public Meissner example, including students with co-advisors", async () => {
    const { default: fixture } =
      await import("./fixtures/academic-tree-sorting.json");
    const live = fixture.graph as AcademicTreeGraph;
    const expected = {
      name: [
        "Bugra Borasoy",
        "De-Chuan Du",
        "Meng-Lin Du",
        "Jing Gao",
        "Feng-Kun Guo",
        "Martin Hoferichter",
        "Maxim Mai",
        "Lucas Platter",
        "Udit Raha",
        "Maral Salajegheh",
        "Gianluca Stellin",
      ],
      year: [
        "Lucas Platter",
        "Udit Raha",
        "Martin Hoferichter",
        "Maxim Mai",
        "Meng-Lin Du",
        "Bugra Borasoy",
        "De-Chuan Du",
        "Jing Gao",
        "Feng-Kun Guo",
        "Maral Salajegheh",
        "Gianluca Stellin",
      ],
    };
    const ids = new Set(
      live.edges.filter((e) => e.source === live.rootId).map((e) => e.target),
    );
    for (const mode of ["name", "year"] as const) {
      const layout = layoutAcademicTree(live, undefined, mode);
      const children = layout.nodes.filter((n) => ids.has(n.id));
      const y = Math.min(...children.map((n) => n.y));
      expect(
        children
          .filter((n) => n.y === y)
          .sort((a, b) => a.x - b.x)
          .map((n) => n.name),
      ).toEqual(expected[mode]);
      expect(
        layoutAcademicTree(
          {
            ...live,
            nodes: [...live.nodes].reverse(),
            edges: [...live.edges].reverse(),
          },
          undefined,
          mode,
        ),
      ).toEqual(layout);
    }
    const years = academicSortYears(live, live.rootId);
    expect(
      live.nodes
        .filter((n) => years.has(n.id))
        .map((n) => [n.name, years.get(n.id)])
        .sort((a, b) => Number(a[1]) - Number(b[1])),
    ).toEqual([
      ["Lucas Platter", 2005],
      ["Udit Raha", 2006],
      ["Martin Hoferichter", 2012],
      ["Maxim Mai", 2013],
      ["Meng-Lin Du", 2017],
      ["Thomas Vonk", 2022],
    ]);
  });
  it("includes the centered person in their mentor's student order while preserving the vertical spine", () => {
    const mixed: AcademicTreeGraph = {
      ...graph,
      rootId: "3",
      nodes: [...graph.nodes, { id: "5", name: "Child", level: 2 }],
      edges: [
        ...graph.edges,
        { source: "3", target: "5", degreeTypes: ["phd"] },
      ],
    };
    for (const [mode, expected] of [
      ["name", ["2", "4", "3"]],
      ["year", ["3", "2", "4"]],
    ] as const) {
      const nodes = layoutAcademicTree(mixed, undefined, mode).nodes;
      expect(
        nodes
          .filter((n) => ["2", "3", "4"].includes(n.id))
          .sort((a, b) => a.x - b.x)
          .map((n) => n.id),
      ).toEqual(expected);
      const root = nodes.find((n) => n.id === "3")!,
        mentor = nodes.find((n) => n.id === "1")!;
      expect(root.x + root.width / 2).toBeCloseTo(mentor.x + mentor.width / 2);
    }
  });
  it("keeps all of one advisor's students ordered despite extra advisors and uneven descendants", () => {
    const mixed: AcademicTreeGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: "9", name: "Co-advisor", level: 0 },
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `leaf${i}`,
          name: `Leaf ${i}`,
          level: 2,
        })),
      ],
      edges: [
        ...graph.edges,
        { source: "9", target: "3", degreeTypes: ["master"] },
        ...Array.from({ length: 6 }, (_, i) => ({
          source: "2",
          target: `leaf${i}`,
          degreeTypes: ["phd"],
        })),
      ],
    };
    for (const [mode, expected] of [
      ["name", ["2", "4", "3"]],
      ["year", ["3", "2", "4"]],
    ] as const) {
      const actual = layoutAcademicTree(mixed, undefined, mode)
        .nodes.filter((n) => ["2", "3", "4"].includes(n.id))
        .sort((a, b) => a.x - b.x)
        .map((n) => n.id);
      expect(actual).toEqual(expected);
    }
  });
  it("retains canonical name and public education dates separately from display and current affiliation", () => {
    const p = parseAuthorProfile(
      {
        name: { value: "Guo, Fengkun", preferred_name: "Feng-Kun Guo" },
        positions: [
          { institution: "Current", current: true, rank: "SENIOR" },
          {
            institution: "IHEP",
            rank: "PHD",
            start_date: "2002",
            end_date: "2007",
          },
          {
            institution: "Hidden",
            rank: "PHD",
            end_date: "2010",
            hidden: true,
          },
        ],
      },
      "1",
    )!;
    expect(p.name).toBe("Feng-Kun Guo");
    expect(p.canonicalName).toBe("Guo, Fengkun");
    expect(p.positions).toHaveLength(2);
    expect(p.currentPosition?.institution).toBe("Current");
    expect(academicEducationYears(p)).toEqual({ phd: 2007 });
  });
  it("does not guess among multiple studies, unfinished studies, malformed or reversed dates", () => {
    const position = {
      institution: "A",
      rank: "PHD",
      startDate: "2002",
      endDate: "2007",
    };
    for (const positions of [
      [position, { ...position, institution: "B" }],
      [{ ...position, current: true }],
      [{ ...position, endDate: undefined }],
      [{ ...position, endDate: "2001" }],
      [{ ...position, endDate: "2007abc" }],
      [{ ...position, endDate: "2007-13-01" }],
      [{ ...position, endDate: "2007-02-30" }],
      [{ ...position, endDate: "9999" }],
    ])
      expect(
        academicEducationYears({ recid: "1", name: "A", positions }),
      ).toEqual({});
  });
  it("uses canonical surnames including compound names, and years with unknown last", () => {
    const children = graph.nodes.slice(1);
    expect(
      [...children].sort(academicNodeOrder(graph)).map((n) => n.id),
    ).toEqual(["2", "4", "3"]);
    expect(
      [...children].sort(academicNodeOrder(graph, "year")).map((n) => n.id),
    ).toEqual(["3", "2", "4"]);
    const mixed = {
      ...graph,
      edges: [
        ...graph.edges,
        { source: "9", target: "3", degreeTypes: ["other"] },
      ],
    };
    expect(academicSortYears(mixed).has("3")).toBe(false);
  });
  it("applies the requested mode to layout while keeping root over the student span", () => {
    for (const [mode, expected] of [
      ["name", ["2", "4", "3"]],
      ["year", ["3", "2", "4"]],
    ] as const) {
      const layout = layoutAcademicTree(graph, undefined, mode);
      const kids = layout.nodes
        .filter((n) => n.id !== "1")
        .sort((a, b) => a.x - b.x);
      expect(kids.map((n) => n.id)).toEqual(expected);
      const root = layout.nodes.find((n) => n.id === "1")!;
      expect(root.x + root.width / 2).toBeCloseTo(
        (kids[0].x + kids[2].x + kids[2].width) / 2,
      );
    }
  });
});
