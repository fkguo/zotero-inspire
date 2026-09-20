import { expect, it } from "vitest";
import { academicQualificationCards } from "../src/modules/inspire/academicTreeQualifications";
import { layoutAcademicTree } from "../src/modules/inspire/academicTreeLayout";
import type { AcademicTreeGraph } from "../src/modules/inspire/academicTreeTypes";

it("deduplicates visible relation types, preserves missing types, and fits their lines below the name and affiliation", () => {
  const graph: AcademicTreeGraph = {
    rootId: "student",
    nodes: ["a", "b", "student"].map((id) => ({
      id,
      name: id,
      level: id === "student" ? 0 : -1,
      institution: "Institute",
    })),
    edges: [
      {
        source: "a",
        target: "student",
        degreeTypes: [
          "phd",
          "diploma",
          "bachelor",
          "master",
          "habilitation",
          "laurea",
          "other",
        ],
      },
      { source: "b", target: "student", degreeTypes: ["phd", ""] },
    ],
    expanded: { up: [], down: [] },
    empty: { up: [], down: [] },
    failures: [],
    limited: false,
  };
  const labels = academicQualificationCards(graph, (x) => x);
  expect(labels.get("student")!.labels).toHaveLength(8);
  expect(labels.get("student")!.labels).toContain("unknown");
  expect(labels.has("a")).toBe(false);
  expect(labels.get("student")!.description).toContain(
    "b → student: phd / unknown",
  );
  const measure = (text: string) => text.length * 7;
  const ordinary = layoutAcademicTree(graph, measure);
  const layout = layoutAcademicTree(graph, measure, "name", labels);
  const node = layout.nodes.find((n) => n.id === "student")!;
  const old = ordinary.nodes.find((n) => n.id === node.id)!;
  expect(node.width).toBe(old.width);
  expect(node.height - old.height).toBe(node.qualificationLines!.length * 12);
  for (const line of node.qualificationLines!)
    expect((measure(line) * 10) / 13).toBeLessThanOrEqual(node.width - 20);
  expect(graph.nodes.some((n) => "qualificationLines" in n)).toBe(false);
});
