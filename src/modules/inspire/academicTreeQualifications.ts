import type { FluentMessageId } from "../../../typings/i10n";
import type { AcademicTreeGraph } from "./academicTreeTypes";

export const ACADEMIC_QUALIFICATIONS = {
  phd: "academic-tree-phd",
  diploma: "academic-tree-diploma",
  bachelor: "academic-tree-bachelor",
  master: "academic-tree-master",
  habilitation: "academic-tree-habilitation",
  laurea: "academic-tree-laurea",
  other: "academic-tree-other",
  unknown: "academic-tree-unknown",
} as const;

export function normalizeAcademicDegree(degree?: string) {
  return degree?.trim().toLowerCase() || "unknown";
}

export function academicDegreeLabel(
  degree: string,
  translate: (key: FluentMessageId) => string,
) {
  const key = Object.hasOwn(
    ACADEMIC_QUALIFICATIONS,
    normalizeAcademicDegree(degree),
  )
    ? ACADEMIC_QUALIFICATIONS[
        normalizeAcademicDegree(degree) as keyof typeof ACADEMIC_QUALIFICATIONS
      ]
    : undefined;
  return key ? translate(key) : degree;
}

export interface AcademicQualificationCard {
  labels: string[];
  description: string;
}

/** Only incoming relationships in the displayed graph contribute card labels. */
export function academicQualificationCards(
  graph: AcademicTreeGraph,
  label: (degree: string) => string,
) {
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const incoming = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    if (!names.has(edge.source) || !names.has(edge.target)) continue;
    const edges = incoming.get(edge.target) || [];
    edges.push(edge);
    incoming.set(edge.target, edges);
  }
  const cards = new Map<string, AcademicQualificationCard>();
  const order = Object.keys(ACADEMIC_QUALIFICATIONS);
  for (const [id, edges] of incoming) {
    const types = (edge: (typeof edges)[number]) =>
      (edge.degreeTypes.length ? edge.degreeTypes : ["unknown"]).map(
        normalizeAcademicDegree,
      );
    const degrees = [...new Set(edges.flatMap(types))].sort(
      (a, b) =>
        (order.indexOf(a) < 0 ? order.length : order.indexOf(a)) -
          (order.indexOf(b) < 0 ? order.length : order.indexOf(b)) ||
        a.localeCompare(b, "en"),
    );
    cards.set(id, {
      labels: degrees.map(label),
      description: [...edges]
        .sort((a, b) => a.source.localeCompare(b.source, "en"))
        .map(
          (edge) =>
            `${names.get(edge.source)} → ${names.get(id)}: ${[...new Set(types(edge))].map(label).join(" / ")}`,
        )
        .join("\n"),
    });
  }
  return cards;
}

export function wrapAcademicQualifications(
  labels: string[],
  measure: (text: string) => number,
  width: number,
) {
  const lines: string[] = [];
  for (const label of labels) {
    const index = lines.length - 1;
    const combined = index < 0 ? label : `${lines[index]} · ${label}`;
    if (index < 0 || measure(combined) > width) lines.push(label);
    else lines[index] = combined;
  }
  return lines;
}
