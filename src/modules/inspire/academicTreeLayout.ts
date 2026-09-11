import type { AcademicTreeGraph, AcademicTreeNode } from "./academicTreeTypes";

export interface AcademicLayoutNode extends AcademicTreeNode {
  x: number;
  y: number;
}
export interface AcademicTreeLayout {
  nodes: AcademicLayoutNode[];
  width: number;
  height: number;
}
export const ACADEMIC_NODE_WIDTH = 148;
export const ACADEMIC_NODE_HEIGHT = 54;
const COLUMN_STEP = ACADEMIC_NODE_WIDTH + 24;
const ROW_STEP = ACADEMIC_NODE_HEIGHT + 38;

/** Fit a label to two lines, preferring word boundaries and keeping Unicode code points intact. */
export function wrapAcademicName(
  name: string,
  measure: (text: string) => number,
  width = ACADEMIC_NODE_WIDTH - 24,
): string[] {
  let rest = Array.from(name.trim().replace(/\s+/g, " "));
  const lines: string[] = [];
  for (let line = 0; line < 2 && rest.length; line++) {
    let end = 0;
    while (
      end < rest.length &&
      measure(rest.slice(0, end + 1).join("")) <= width
    )
      end++;
    if (end === rest.length) {
      lines.push(rest.join(""));
      break;
    }
    if (line === 1 || end === 0) {
      while (
        end > 0 &&
        measure(rest.slice(0, end).join("").trimEnd() + "…") > width
      )
        end--;
      lines.push(rest.slice(0, end).join("").trimEnd() + "…");
      break;
    }
    const boundary = rest
      .slice(0, end)
      .findLastIndex((char) => char === " " || char === "-");
    const take = boundary > 0 ? boundary + 1 : end;
    lines.push(rest.slice(0, take).join("").trimEnd());
    rest = rest.slice(take);
    while (rest[0] === " ") rest.shift();
  }
  return lines;
}

/** Closest ordered coordinates with a full card's width between neighbours. */
function separate(desired: number[]): number[] {
  const blocks: Array<{ sum: number; count: number }> = [];
  desired.forEach((x, i) => {
    blocks.push({ sum: x - i * COLUMN_STEP, count: 1 });
    while (blocks.length > 1) {
      const right = blocks.at(-1)!,
        left = blocks.at(-2)!;
      if (left.sum / left.count <= right.sum / right.count) break;
      left.sum += right.sum;
      left.count += right.count;
      blocks.pop();
    }
  });
  const result: number[] = [];
  for (const block of blocks)
    for (let i = 0; i < block.count; i++)
      result.push(block.sum / block.count + result.length * COLUMN_STEP);
  return result;
}

/** Count edge crossings in O(E log E), excluding shared endpoints. */
function inversions(values: number[]): number {
  if (values.length < 2) return 0;
  const middle = Math.floor(values.length / 2);
  const left = values.slice(0, middle),
    right = values.slice(middle);
  let count = inversions(left) + inversions(right),
    i = 0,
    j = 0;
  while (i < left.length || j < right.length) {
    if (j === right.length || (i < left.length && left[i] <= right[j]))
      values[i + j] = left[i++];
    else {
      values[i + j] = right[j++];
      count += left.length - i;
    }
  }
  return count;
}

/** Layered layout with crossing reduction and parent/child alignment. Never merges identities. */
export function layoutAcademicTree(
  graph: AcademicTreeGraph,
): AcademicTreeLayout {
  const layers = new Map<number, AcademicTreeNode[]>();
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>(),
    outgoing = new Map<string, string[]>();
  const bands = new Map<number, typeof graph.edges>();
  for (const node of graph.nodes) {
    const layer = layers.get(node.level) ?? [];
    layer.push(node);
    layers.set(node.level, layer);
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const from = byId.get(edge.source),
      to = byId.get(edge.target);
    // Cyclic or same-generation relationships remain in the graph, but cannot order a DAG.
    if (!from || !to || from.level >= to.level) continue;
    outgoing.get(from.id)!.push(to.id);
    incoming.get(to.id)!.push(from.id);
    if (to.level === from.level + 1) {
      const band = bands.get(from.level) ?? [];
      band.push(edge);
      bands.set(from.level, band);
    }
  }
  for (const neighbours of [incoming, outgoing])
    for (const ids of neighbours.values()) ids.sort();
  const levels = [...layers.keys()].sort((a, b) => a - b);
  const positions = new Map<string, number>();
  const assign = (layer: AcademicTreeNode[]) =>
    layer.forEach((node, i) =>
      positions.set(node.id, (i - (layer.length - 1) / 2) * COLUMN_STEP),
    );
  for (const layer of layers.values()) {
    layer.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    assign(layer);
  }
  const crossings = () =>
    [...bands.values()].reduce((sum, band) => {
      const ordered = [...band].sort(
        (a, b) =>
          positions.get(a.source)! - positions.get(b.source)! ||
          positions.get(a.target)! - positions.get(b.target)!,
      );
      return (
        sum + inversions(ordered.map((edge) => positions.get(edge.target)!))
      );
    }, 0);
  let best = new Map([...layers].map(([level, row]) => [level, [...row]]));
  let bestScore = crossings();
  const average = (ids: string[], fallback: number) =>
    ids.length
      ? ids.reduce((sum, id) => sum + positions.get(id)!, 0) / ids.length
      : fallback;
  for (let sweep = 0; sweep < 8; sweep++) {
    const neighbours = sweep % 2 ? outgoing : incoming;
    for (const level of sweep % 2 ? [...levels].reverse() : levels) {
      const layer = layers.get(level)!;
      const weights = new Map(
        layer.map((node) => [
          node.id,
          average(neighbours.get(node.id)!, positions.get(node.id)!),
        ]),
      );
      layer.sort(
        (a, b) =>
          weights.get(a.id)! - weights.get(b.id)! ||
          positions.get(a.id)! - positions.get(b.id)!,
      );
      assign(layer);
    }
    const score = crossings();
    if (score < bestScore) {
      bestScore = score;
      best = new Map([...layers].map(([level, row]) => [level, [...row]]));
    }
  }
  for (const [level, row] of best) {
    layers.set(level, row);
    assign(row);
  }
  // Barycentric sorting can leave small groups inverted around shared advisors.
  // Swap adjacent cards only when the total number of crossings strictly falls.
  const adjacent = (id: string, direction: "up" | "down") => {
    const level = byId.get(id)!.level + (direction === "up" ? -1 : 1);
    return (direction === "up" ? incoming : outgoing)
      .get(id)!
      .filter((other) => byId.get(other)!.level === level);
  };
  const above = new Map(
    graph.nodes.map((node) => [node.id, adjacent(node.id, "up")]),
  );
  const below = new Map(
    graph.nodes.map((node) => [node.id, adjacent(node.id, "down")]),
  );
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const level of pass % 2 ? [...levels].reverse() : levels) {
      const row = layers.get(level)!;
      for (let step = 0; step < row.length - 1; step++) {
        const i = pass % 2 ? row.length - 2 - step : step;
        const a = row[i],
          b = row[i + 1];
        let improvement = 0;
        for (const neighbours of [above, below])
          for (const left of neighbours.get(a.id)!)
            for (const right of neighbours.get(b.id)!)
              improvement += Math.sign(
                positions.get(left)! - positions.get(right)!,
              );
        if (improvement <= 0) continue;
        const x = positions.get(a.id)!;
        positions.set(a.id, positions.get(b.id)!);
        positions.set(b.id, x);
        [row[i], row[i + 1]] = [b, a];
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Align actual x coordinates, not ordinal row indices. Constrained projection
  // keeps the crossing-minimizing order while letting sparse generations spread
  // over the denser student branches beneath them.
  for (let sweep = 0; sweep < 13; sweep++) {
    const neighbours = sweep % 2 ? incoming : outgoing;
    for (const level of sweep % 2 ? levels : [...levels].reverse()) {
      const row = layers.get(level)!;
      const coordinates = separate(
        row.map((node) =>
          average(neighbours.get(node.id)!, positions.get(node.id)!),
        ),
      );
      row.forEach((node, i) => positions.set(node.id, coordinates[i]));
    }
  }
  const left = Math.min(0, ...positions.values());
  const right = Math.max(0, ...positions.values()) + ACADEMIC_NODE_WIDTH;
  const width = Math.max(650, right - left + 48);
  const offset = (width - (right - left)) / 2 - left;
  return {
    width,
    height: Math.max(
      200,
      ((levels.at(-1) ?? 0) - (levels[0] ?? 0)) * ROW_STEP +
        ACADEMIC_NODE_HEIGHT +
        48,
    ),
    nodes: levels.flatMap((level) =>
      layers.get(level)!.map((node) => ({
        ...node,
        x: positions.get(node.id)! + offset,
        y: (level - levels[0]) * ROW_STEP + 24,
      })),
    ),
  };
}
