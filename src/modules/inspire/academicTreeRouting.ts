import type { AcademicLayoutNode } from "./academicTreeLayout";
import type { AcademicTreeEdge } from "./academicTreeTypes";

type LaneY = (source: string, top: number) => number;

/** Give each family's horizontal connectors their own lane within a row gap. */
export function createAcademicRouter(
  nodes: AcademicLayoutNode[],
  edges: AcademicTreeEdge[],
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const targetPorts = new Map<string, Map<string, number>>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const ports = targetPorts.get(edge.target) ?? new Map<string, number>();
    ports.set(edge.source, 0);
    targetPorts.set(edge.target, ports);
  }
  for (const [target, ports] of targetPorts) {
    const node = byId.get(target)!;
    const sources = [...ports.keys()].sort(
      (a, b) => byId.get(a)!.x - byId.get(b)!.x || a.localeCompare(b, "en"),
    );
    const step = Math.min(
      10,
      (node.width - 20) / Math.max(1, sources.length - 1),
    );
    sources.forEach((id, i) =>
      ports.set(
        id,
        node.x + node.width / 2 + (i - (sources.length - 1) / 2) * step,
      ),
    );
  }
  const lanes = new Map<number, Map<string, number>>();
  const laneY: LaneY = (source, top) => {
    if (!lanes.has(top)) {
      const floor = Math.max(
        ...nodes
          .filter((node) => node.y < top)
          .map((node) => node.y + node.height),
      );
      const sources = [
        ...new Set(
          edges
            .filter((edge) => {
              const from = byId.get(edge.source),
                to = byId.get(edge.target);
              return from && to && from.y < top && to.y >= top;
            })
            .map((edge) => edge.source),
        ),
      ].sort((a, b) => a.localeCompare(b, "en"));
      lanes.set(
        top,
        new Map(
          sources.map((id, i) => [
            id,
            floor + 5 + ((top - floor - 10) * (i + 1)) / (sources.length + 1),
          ]),
        ),
      );
    }
    return lanes.get(top)!.get(source)!;
  };
  return (from: AcademicLayoutNode, to: AcademicLayoutNode) =>
    academicEdgePath(
      from,
      to,
      nodes,
      laneY,
      targetPorts.get(to.id)?.get(from.id),
    );
}

/** Straight spines and short orthogonal branches, detouring only around cards. */
export function academicEdgePath(
  from: AcademicLayoutNode,
  to: AcademicLayoutNode,
  nodes: AcademicLayoutNode[],
  laneY?: LaneY,
  targetX?: number,
): string {
  const x1 = from.x + from.width / 2,
    x2 = targetX ?? to.x + to.width / 2;
  const start = from.y + from.height,
    end = to.y;
  if (end <= from.y) {
    // Cyclic data is retained without drawing through another card on the row.
    if (to.y < from.y) {
      const left = Math.min(...nodes.map((node) => node.x)) - 10;
      return `M${x1},${from.y} V${from.y - 14} H${left} V${to.y - 14} H${x2} V${to.y}`;
    }
    const above = from.y - 14;
    return `M${x1},${from.y} V${above} H${x2} V${to.y}`;
  }
  const rows = new Map<number, AcademicLayoutNode[]>();
  for (const node of nodes)
    if (node.y > from.y && node.y < to.y) {
      const row = rows.get(node.y) ?? [];
      row.push(node);
      rows.set(node.y, row);
    }
  let x = x1,
    y = start,
    path = `M${x},${y}`;
  for (const [top, row] of [...rows].sort((a, b) => a[0] - b[0])) {
    const blocks = [...row].sort((a, b) => a.x - b.x);
    const candidates = [
      x,
      x2,
      blocks[0].x - 10,
      ...blocks.map((node) => node.x + node.width + 10),
    ]
      .filter((candidate) =>
        blocks.every(
          (node) =>
            candidate <= node.x - 7 || candidate >= node.x + node.width + 7,
        ),
      )
      .sort(
        (a, b) =>
          Math.abs(a - x) +
            Math.abs(a - x2) -
            (Math.abs(b - x) + Math.abs(b - x2)) ||
          Math.abs(a - x2) - Math.abs(b - x2) ||
          a - b,
      );
    const next = candidates[0];
    if (next !== x)
      path += ` V${laneY?.(from.id, top) ?? (y + top) / 2} H${next}`;
    y = Math.max(...blocks.map((node) => node.y + node.height));
    path += ` V${y}`;
    x = next;
  }
  if (Math.abs(x - x2) < 0.001) return path + ` V${end}`;
  // Shared horizontal buses keep broad sibling groups legible without S-curves.
  return path + ` V${laneY?.(from.id, end) ?? (y + end) / 2} H${x2} V${end}`;
}
