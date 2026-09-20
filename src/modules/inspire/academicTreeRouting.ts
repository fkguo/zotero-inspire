import type { AcademicLayoutNode } from "./academicTreeLayout";
import type { AcademicTreeEdge } from "./academicTreeTypes";
import { academicCorridors } from "./academicTreeCorridors";

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
    const center = node.x + node.width / 2;
    const sources = [...ports.keys()].sort((a, b) => {
      const from = byId.get(a)!,
        other = byId.get(b)!;
      return (
        from.x + from.width / 2 - other.x - other.width / 2 ||
        other.y - from.y ||
        a.localeCompare(b, "en")
      );
    });
    // Reserve the center for a clear vertical connection. Splitting all ports
    // symmetrically would force this aligned advisor into a needless dogleg.
    const aligned = sources.findIndex((id) => {
      const from = byId.get(id)!;
      return (
        from.y + from.height < node.y &&
        Math.abs(from.x + from.width / 2 - center) < 0.001 &&
        !nodes.some(
          (obstacle) =>
            obstacle.id !== id &&
            obstacle.id !== target &&
            obstacle.y < node.y &&
            obstacle.y + obstacle.height > from.y + from.height &&
            center > obstacle.x - 7 &&
            center < obstacle.x + obstacle.width + 7,
        )
      );
    });
    const origin = aligned >= 0 ? aligned : (sources.length - 1) / 2;
    const step = Math.min(
      10,
      (node.width / 2 - 10) / Math.max(1, origin, sources.length - 1 - origin),
    );
    sources.forEach((id, i) => ports.set(id, center + (i - origin) * step));
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
      targetPorts.get(to.id)?.size === 1,
    );
}

/** Straight spines and short orthogonal branches, detouring only around cards. */
export function academicEdgePath(
  from: AcademicLayoutNode,
  to: AcademicLayoutNode,
  nodes: AcademicLayoutNode[],
  laneY?: LaneY,
  targetX?: number,
  flexibleTarget = false,
): string {
  const x1 = from.x + from.width / 2;
  let x2 = targetX ?? to.x + to.width / 2;
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
  const ordered = [...rows].sort((a, b) => a[0] - b[0]);
  const shift = flexibleTarget ? Math.min(12, to.width / 2 - 10) : 0;
  const corridor = academicCorridors(
    ordered.map(([, row]) => row),
    x1,
    x2,
    x2 - shift,
    x2 + shift,
  );
  // Adjacent generations retain centered family branches; flexibility only
  // removes a small final jog after passing intermediate rows.
  if (ordered.length) x2 = corridor.end;
  for (const [i, [top, blocks]] of ordered.entries()) {
    const next = corridor.route[i];
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
