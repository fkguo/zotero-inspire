import { createAcademicRowOrder } from "./academicTreeRowOrder";
import {
  separateAcademicCards as separate,
  pinAcademicCardCenters as pinCardCenters,
  packPinnedAcademicRow as packPinnedRow,
} from "./academicTreePacking";
import { academicNodeOrder } from "./academicTreeSorting";
import {
  wrapAcademicQualifications,
  type AcademicQualificationCard,
} from "./academicTreeQualifications";
import type { AcademicTreeGraph, AcademicTreeNode } from "./academicTreeTypes";

export interface AcademicLayoutNode extends AcademicTreeNode {
  qualificationLines?: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface AcademicTreeLayout {
  nodes: AcademicLayoutNode[];
  width: number;
  height: number;
  rows?: Array<{
    generation: number;
    part: number;
    parts: number;
    y: number;
    height: number;
  }>;
}
export const ACADEMIC_NODE_WIDTH = 144;
export const ACADEMIC_NODE_HEIGHT = 55;
const COLUMN_STEP = ACADEMIC_NODE_WIDTH + 18;

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

/** Discovery depth is not a generation: a student can first appear as a co-advisor.
 * Rank the displayed relationships independently, keeping cycles on one row and
 * retaining the original discovery depths for traversal and expansion limits.
 */
function displayRanks(graph: AcademicTreeGraph): Map<string, number> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(
    graph.nodes.map((node) => [node.id, new Set<string>()]),
  );
  for (const edge of graph.edges)
    if (byId.has(edge.source) && byId.has(edge.target))
      outgoing.get(edge.source)!.add(edge.target);
  const index = new Map<string, number>(),
    low = new Map<string, number>();
  const stack: string[] = [],
    active = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string) => {
    index.set(id, index.size);
    low.set(id, index.get(id)!);
    stack.push(id);
    active.add(id);
    for (const next of [...outgoing.get(id)!].sort()) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (active.has(next))
        low.set(id, Math.min(low.get(id)!, index.get(next)!));
    }
    if (low.get(id) === index.get(id)) {
      const members: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        active.delete(member);
        members.push(member);
      } while (member !== id);
      components.push(members.sort());
    }
  };
  for (const id of [...byId.keys()].sort()) if (!index.has(id)) visit(id);
  const componentOf = new Map<string, number>();
  components.forEach((members, i) =>
    members.forEach((id) => componentOf.set(id, i)),
  );
  const next = components.map(() => new Set<number>());
  const indegree = components.map(() => 0);
  const rank = components.map((members) =>
    Math.min(...members.map((id) => byId.get(id)!.level)),
  );
  for (const [id, children] of outgoing)
    for (const child of children) {
      const from = componentOf.get(id)!,
        to = componentOf.get(child)!;
      if (from !== to && !next[from].has(to)) {
        next[from].add(to);
        indegree[to]++;
      }
    }
  const queue = components.map((_, i) => i).filter((i) => !indegree[i]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const from = queue[cursor];
    for (const to of next[from]) {
      rank[to] = Math.max(rank[to], rank[from] + 1);
      if (--indegree[to] === 0) queue.push(to);
    }
  }
  const root = componentOf.get(graph.rootId);
  const offset = root === undefined ? 0 : rank[root];
  return new Map(
    graph.nodes.map((node) => [
      node.id,
      rank[componentOf.get(node.id)!] - offset,
    ]),
  );
}

/** Layered layout with crossing reduction and parent/child alignment. Never merges identities. */
export function layoutAcademicTree(
  graph: AcademicTreeGraph,
  measure: (text: string) => number = (text) => Array.from(text).length * 7,
  sort: import("./academicTreeTypes").AcademicSortMode = "name",
  qualifications?: Map<string, AcademicQualificationCard>,
): AcademicTreeLayout {
  const layers = new Map<number, AcademicTreeNode[]>();
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const ranks = displayRanks(graph);
  const dimensions = new Map(
    graph.nodes.map((node) => {
      const width = Math.max(
        100,
        Math.min(ACADEMIC_NODE_WIDTH, measure(node.name) + 20),
      );
      const lines =
        wrapAcademicName(node.name, measure, width - 20).length || 1;
      const qualificationLines = wrapAcademicQualifications(
        qualifications?.get(node.id)?.labels || [],
        (text) => (measure(text) * 10) / 13,
        width - 20,
      );
      return [
        node.id,
        {
          width,
          height:
            lines * 16 +
            (node.institution ? 11 : 0) +
            qualificationLines.length * 12 +
            12,
          ...(qualificationLines.length ? { qualificationLines } : {}),
        },
      ];
    }),
  );
  const nameOrder = academicNodeOrder(graph, sort);
  const incoming = new Map<string, string[]>(),
    outgoing = new Map<string, string[]>();
  const bands = new Map<number, typeof graph.edges>();
  for (const node of graph.nodes) {
    const level = ranks.get(node.id)!;
    const layer = layers.get(level) ?? [];
    layer.push(node);
    layers.set(level, layer);
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const from = byId.get(edge.source),
      to = byId.get(edge.target);
    // Only relationships inside a cycle remain on one row.
    if (!from || !to || ranks.get(from.id)! >= ranks.get(to.id)!) continue;
    outgoing.get(from.id)!.push(to.id);
    incoming.get(to.id)!.push(from.id);
    if (ranks.get(to.id)! === ranks.get(from.id)! + 1) {
      const band = bands.get(ranks.get(from.id)!) ?? [];
      band.push(edge);
      bands.set(ranks.get(from.id)!, band);
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
    layer.sort(nameOrder);
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
    const level = ranks.get(id)! + (direction === "up" ? -1 : 1);
    return (direction === "up" ? incoming : outgoing)
      .get(id)!
      .filter((other) => ranks.get(other)! === level);
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
  // Preserve the focus's unambiguous supervisor chain as a vertical spine.
  // Multiple supervisors stay distinct and are arranged around their student.
  const spine = new Set([graph.rootId]);
  let current = graph.rootId;
  while (incoming.get(current)?.length === 1) {
    const parent = incoming.get(current)![0];
    if (spine.has(parent)) break;
    spine.add(parent);
    current = parent;
  }
  const orderRow = createAcademicRowOrder(graph, sort, ranks);
  // Reserve room for exclusive co-supervisors above a shared student. Otherwise
  // two supervisors of one compact card push the neighbouring families sideways.
  const packingWidth = (node: AcademicTreeNode) => {
    const parents = incoming
      .get(node.id)!
      .filter(
        (id) =>
          !spine.has(id) &&
          !incoming.get(id)!.length &&
          outgoing.get(id)!.length === 1,
      );
    return Math.max(
      dimensions.get(node.id)!.width,
      parents.reduce((sum, id) => sum + dimensions.get(id)!.width, 0) +
        Math.max(0, parents.length - 1) * 18,
    );
  };
  let focusX: number | undefined;
  for (const level of [...levels].reverse()) {
    const row = layers.get(level)!;
    const compact = separate(
      row.map(() => 0),
      row.map((node) => dimensions.get(node.id)!.width),
    );
    const targets = new Map(
      row.map((node, i) => [
        node.id,
        average(outgoing.get(node.id)!, compact[i]),
      ]),
    );
    orderRow(row, (node) => targets.get(node.id)!);
    const widths = row.map(packingWidth);
    const desired = row.map((node) => targets.get(node.id)!);
    const coordinates = separate(desired, widths);
    // Anchor the focus over the extent of its direct students BEFORE resolving
    // collisions with its siblings. Otherwise alphabetical sibling order can
    // push only the focus sideways while all its students stay behind.
    if (row.some((node) => node.id === graph.rootId)) {
      const students = outgoing.get(graph.rootId)!;
      focusX = students.length
        ? (Math.min(
            ...students.map(
              (id) => positions.get(id)! - dimensions.get(id)!.width / 2,
            ),
          ) +
            Math.max(
              ...students.map(
                (id) => positions.get(id)! + dimensions.get(id)!.width / 2,
              ),
            )) /
          2
        : coordinates[row.findIndex((node) => node.id === graph.rootId)];
    }
    const fixed =
      focusX === undefined ? -1 : row.findIndex((node) => spine.has(node.id));
    if (fixed >= 0) pinCardCenters(coordinates, widths, fixed, focusX!);
    row.forEach((node, i) => positions.set(node.id, coordinates[i]));
    if (fixed >= 0) {
      // Root anchoring moves its alphabetically ordered siblings. Reinsert
      // supplemental supervisors against those FINAL positions so they do not
      // get dragged away from their shared students with the sibling row.
      const target = (node: AcademicTreeNode) =>
        !incoming.get(node.id)!.length && !spine.has(node.id)
          ? targets.get(node.id)!
          : positions.get(node.id)!;
      orderRow(row, target);
      const anchor = row.findIndex((node) => spine.has(node.id));
      const packed = packPinnedRow(
        row,
        (node) =>
          !incoming.get(node.id)!.length && !spine.has(node.id)
            ? target(node)
            : focusX!,
        (node) => dimensions.get(node.id)!.width,
        anchor,
        focusX!,
        (node) => !incoming.get(node.id)!.length && !spine.has(node.id),
      );
      row.forEach((node, i) => positions.set(node.id, packed[i]));
    }
    if (row.some((node) => node.id === graph.rootId))
      focusX = positions.get(graph.rootId);
  }
  const left = Math.min(
    0,
    ...graph.nodes.map(
      (node) => positions.get(node.id)! - dimensions.get(node.id)!.width / 2,
    ),
  );
  const right = Math.max(
    0,
    ...graph.nodes.map(
      (node) => positions.get(node.id)! + dimensions.get(node.id)!.width / 2,
    ),
  );
  const width = Math.max(240, right - left + 32);
  const offset = (width - (right - left)) / 2 - left;
  const rowY = new Map<number, number>();
  let height = 24;
  for (const level of levels) {
    rowY.set(level, height);
    const sources = new Set(
      graph.edges
        .filter(
          (edge) =>
            ranks.get(edge.source)! <= level && ranks.get(edge.target)! > level,
        )
        .map((edge) => edge.source),
    );
    height +=
      Math.max(
        ...layers.get(level)!.map((node) => dimensions.get(node.id)!.height),
      ) + Math.max(30, 10 + 4 * (sources.size + 1));
  }
  return {
    width,
    height: Math.max(100, height - 6),
    rows: levels.map((level) => ({
      generation: level,
      part: 1,
      parts: 1,
      y: rowY.get(level)!,
      height: Math.max(
        ...layers.get(level)!.map((node) => dimensions.get(node.id)!.height),
      ),
    })),
    nodes: levels.flatMap((level) =>
      layers.get(level)!.map((node) => ({
        ...node,
        ...dimensions.get(node.id)!,
        x:
          positions.get(node.id)! + offset - dimensions.get(node.id)!.width / 2,
        y: rowY.get(level)!,
      })),
    ),
  };
}
