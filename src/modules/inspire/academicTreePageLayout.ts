import type {
  AcademicTreeLayout,
  AcademicLayoutNode,
} from "./academicTreeLayout";
import type { AcademicTreeEdge } from "./academicTreeTypes";

/** Reflow sorted generations into readable rows without scaling or changing identities. */
export function pageAcademicTree(
  layout: AcademicTreeLayout,
  rootId: string,
  edges: AcademicTreeEdge[],
  pageWidth: number,
): AcademicTreeLayout {
  const width = Math.max(300, Number.isFinite(pageWidth) ? pageWidth : 800);
  const gutter = 112,
    margin = 20,
    gap = 18;
  const available = width - gutter - 2 * margin;
  const generations = new Map<number, AcademicLayoutNode[]>();
  for (const node of layout.nodes) {
    const row = generations.get(node.y) || [];
    row.push(node);
    generations.set(node.y, row);
  }
  const levels = [...generations.keys()].sort((a, b) => a - b);
  const root = layout.nodes.find((n) => n.id === rootId);
  const zero = levels.indexOf(root?.y ?? levels[0]);
  const generationByY = new Map(
    layout.rows?.map((row) => [row.y, row.generation]),
  );
  const nodes: AcademicLayoutNode[] = [],
    rows: NonNullable<AcademicTreeLayout["rows"]> = [];
  let y = 24;
  for (const [index, top] of levels.entries()) {
    const ordered = generations
      .get(top)!
      .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id, "en"));
    const chunks: AcademicLayoutNode[][] = [];
    let used = 0;
    for (const node of ordered) {
      if (!chunks.length || (used && used + gap + node.width > available)) {
        chunks.push([]);
        used = 0;
      }
      const chunk = chunks[chunks.length - 1];
      used += (chunk.length ? gap : 0) + node.width;
      chunk.push(node);
    }
    for (const [part, chunk] of chunks.entries()) {
      const occupied =
        chunk.reduce((sum, n) => sum + n.width, 0) + (chunk.length - 1) * gap;
      let x = gutter + margin + (available - occupied) / 2;
      const height = Math.max(...chunk.map((n) => n.height));
      for (const node of chunk) {
        nodes.push({ ...node, x, y });
        x += node.width + gap;
      }
      rows.push({
        generation: generationByY.get(top) ?? index - zero,
        part: part + 1,
        parts: chunks.length,
        y,
        height,
      });
      y += height + 36;
    }
  }
  // Keep an unambiguous mentor chain vertical wherever the wrapped row has room.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let child = byId.get(rootId);
  while (child && !seen.has(child.id)) {
    seen.add(child.id);
    const parents = [
      ...new Set(
        edges.filter((e) => e.target === child!.id).map((e) => e.source),
      ),
    ];
    if (parents.length !== 1) break;
    const parent = byId.get(parents[0]);
    if (!parent || seen.has(parent.id)) break;
    const peers = nodes
      .filter((n) => n.y === parent.y)
      .sort((a, b) => a.x - b.x);
    const index = peers.indexOf(parent);
    const x = child.x + child.width / 2 - parent.width / 2;
    const left = index
      ? peers[index - 1].x + peers[index - 1].width + gap
      : gutter + margin;
    const right =
      index + 1 < peers.length ? peers[index + 1].x - gap : width - margin;
    if (x >= left && x + parent.width <= right) parent.x = x;
    child = parent;
  }
  // Reuse the same family-lane spacing as the unwrapped graph, now for each
  // physical row so links to later parts have room to detour around intervening cards.
  const rowById = new Map(nodes.map((n) => [n.id, n.y]));
  let shift = 0;
  for (const row of rows) {
    const oldY = row.y;
    row.y += shift;
    for (const node of nodes)
      if (rowById.get(node.id) === oldY) node.y += shift;
    const sources = new Set(
      edges
        .filter(
          (e) =>
            (rowById.get(e.source) ?? Infinity) <= oldY &&
            (rowById.get(e.target) ?? -Infinity) > oldY,
        )
        .map((e) => e.source),
    );
    shift += Math.max(0, 10 + 4 * (sources.size + 1) - 36);
  }
  return { nodes, rows, width, height: Math.max(100, y + shift - 12) };
}
