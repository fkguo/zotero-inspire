import type { AcademicTreeGraph } from "./academicTreeTypes";

export interface AcademicTreeViewState {
  showCoAdvisors: boolean;
  collapsed: string[];
  path: string[];
}

export function academicReachable(
  graph: AcademicTreeGraph,
  start: string,
  direction: "up" | "down",
): Set<string> {
  const adjacent = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const a = direction === "up" ? edge.target : edge.source;
    const b = direction === "up" ? edge.source : edge.target;
    adjacent.set(a, [...(adjacent.get(a) || []), b]);
  }
  const seen = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++)
    for (const id of adjacent.get(queue[i]) || [])
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
  return seen;
}

/** Display-only projection. Shared branches survive if another visible route exists. */
export function projectAcademicTree(
  graph: AcademicTreeGraph,
  state: AcademicTreeViewState,
): AcademicTreeGraph {
  if (state.showCoAdvisors && !state.collapsed.length) return graph;
  const ancestors = academicReachable(graph, graph.rootId, "up");
  const allowed = state.showCoAdvisors
    ? new Set(graph.nodes.map((node) => node.id))
    : new Set([
        ...ancestors,
        ...academicReachable(graph, graph.rootId, "down"),
      ]);
  if (!state.showCoAdvisors)
    for (const id of graph.expanded.down)
      if (ancestors.has(id))
        for (const child of academicReachable(graph, id, "down"))
          allowed.add(child);
  const collapsed = new Set(state.collapsed);
  // Never cut the center's own ancestral chain, including after history restoration.
  const edges = graph.edges.filter(
    (edge) =>
      allowed.has(edge.source) &&
      allowed.has(edge.target) &&
      (!collapsed.has(edge.source) ||
        (ancestors.has(edge.source) && edge.source !== graph.rootId)),
  );
  const connected = new Set([graph.rootId]);
  const adjacent = new Map<string, string[]>();
  for (const edge of edges) {
    adjacent.set(edge.source, [
      ...(adjacent.get(edge.source) || []),
      edge.target,
    ]);
    adjacent.set(edge.target, [
      ...(adjacent.get(edge.target) || []),
      edge.source,
    ]);
  }
  const queue = [graph.rootId];
  for (let i = 0; i < queue.length; i++)
    for (const id of adjacent.get(queue[i]) || [])
      if (!connected.has(id)) {
        connected.add(id);
        queue.push(id);
      }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => connected.has(node.id)),
    edges: edges.filter(
      (edge) => connected.has(edge.source) && connected.has(edge.target),
    ),
  };
}

/** Shortest relationship path, with original advisor-to-student directions retained in the graph. */
export function academicRelationshipPath(
  graph: AcademicTreeGraph,
  from: string,
  to: string,
): string[] {
  const adjacent = new Map(
    graph.nodes.map((node) => [node.id, [] as string[]]),
  );
  if (!adjacent.has(from) || !adjacent.has(to)) return [];
  for (const edge of graph.edges) {
    adjacent.get(edge.source)?.push(edge.target);
    adjacent.get(edge.target)?.push(edge.source);
  }
  const previous = new Map<string, string | undefined>([[from, undefined]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    if (queue[i] === to) {
      const path: string[] = [];
      for (
        let id: string | undefined = to;
        id !== undefined;
        id = previous.get(id)
      )
        path.unshift(id);
      return path;
    }
    for (const id of (adjacent.get(queue[i]) || []).sort())
      if (!previous.has(id)) {
        previous.set(id, queue[i]);
        queue.push(id);
      }
  }
  return [];
}

export function academicTreeCSV(graph: AcademicTreeGraph): string {
  const cell = (value: string) => {
    // Spreadsheet formula protection also covers user-supplied INSPIRE labels.
    const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [
    [
      "record_type",
      "id",
      "name",
      "affiliation",
      "source",
      "target",
      "degree_types",
    ],
  ];
  for (const node of graph.nodes)
    rows.push([
      "person",
      node.id,
      node.name,
      node.institution || "",
      "",
      "",
      "",
    ]);
  for (const edge of graph.edges)
    rows.push([
      "relationship",
      "",
      "",
      "",
      edge.source,
      edge.target,
      edge.degreeTypes.join(";"),
    ]);
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
