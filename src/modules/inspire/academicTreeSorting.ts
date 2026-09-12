import type { InspireAuthorProfile } from "./types";
import type {
  AcademicTreeGraph,
  AcademicTreeNode,
  AcademicSortMode,
} from "./academicTreeTypes";

const ranks: Record<string, string> = {
  phd: "PHD",
  master: "MASTER",
  bachelor: "UNDERGRADUATE",
};
function educationDate(value?: string): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value))
    return;
  const [year, month = 1, day = 1] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return;
  return date;
}
/** Only an unambiguous completed education record supplies a year, never a guess. */
export function academicEducationYears(
  profile: InspireAuthorProfile,
): Record<string, number> {
  const years: Record<string, number> = {};
  for (const [degree, rank] of Object.entries(ranks)) {
    const positions = profile.positions?.filter((p) => p.rank === rank) || [];
    if (positions.length !== 1) continue;
    const p = positions[0];
    const end = educationDate(p.endDate);
    const start = educationDate(p.startDate);
    if (
      p.current ||
      !end ||
      end.getTime() > Date.now() ||
      (p.startDate && !start) ||
      (start && start > end)
    )
      continue;
    years[degree] = end.getUTCFullYear();
  }
  return years;
}

/** Conflicting typed relationships cannot silently select one degree's year. */
export function academicSortYears(
  graph: AcademicTreeGraph,
  advisorId?: string,
): Map<string, number> {
  const types = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (advisorId && edge.source !== advisorId) continue;
    const known = types.get(edge.target) || new Set<string>();
    for (const degree of edge.degreeTypes) known.add(degree);
    types.set(edge.target, known);
  }
  const years = new Map<string, number>();
  for (const node of graph.nodes) {
    const degrees = [...(types.get(node.id) || [])];
    const values = degrees.map((degree) => node.educationYears?.[degree]);
    if (
      values.length &&
      values.every((year) => year !== undefined && year === values[0])
    )
      years.set(node.id, values[0]!);
  }
  return years;
}

export function academicNodeOrder(
  graph: AcademicTreeGraph,
  sort: AcademicSortMode = "name",
  advisorId?: string,
) {
  const years =
    sort === "year"
      ? academicSortYears(graph, advisorId)
      : new Map<string, number>();
  const key = (node: AcademicTreeNode) =>
    (node.canonicalName || node.name).trim().normalize("NFKC");
  return (a: AcademicTreeNode, b: AcademicTreeNode): number =>
    (sort === "year"
      ? (years.get(a.id) ?? Infinity) - (years.get(b.id) ?? Infinity)
      : 0) ||
    key(a).localeCompare(key(b), "en", {
      sensitivity: "base",
      numeric: true,
    }) ||
    a.id.localeCompare(b.id, "en");
}
