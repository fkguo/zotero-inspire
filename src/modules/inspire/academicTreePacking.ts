import type { AcademicTreeNode } from "./academicTreeTypes";

/** Closest ordered card centers, leaving an 18px gap between card edges. */
export function separateAcademicCards(
  desired: number[],
  widths: number[],
  priority: boolean[] = [],
): number[] {
  const distances = widths.map(() => 0);
  for (let i = 1; i < widths.length; i++)
    distances[i] = distances[i - 1] + (widths[i - 1] + widths[i]) / 2 + 18;
  const blocks: Array<{
    sum: number;
    count: number;
    pinnedSum: number;
    pinnedCount: number;
  }> = [];
  const mean = (block: (typeof blocks)[number]) =>
    block.pinnedCount
      ? block.pinnedSum / block.pinnedCount
      : block.sum / block.count;
  desired.forEach((x, i) => {
    blocks.push({
      sum: x - distances[i],
      count: 1,
      pinnedSum: priority[i] ? x - distances[i] : 0,
      pinnedCount: priority[i] ? 1 : 0,
    });
    while (blocks.length > 1) {
      const right = blocks.at(-1)!,
        left = blocks.at(-2)!;
      if (mean(left) <= mean(right)) break;
      left.sum += right.sum;
      left.count += right.count;
      left.pinnedSum += right.pinnedSum;
      left.pinnedCount += right.pinnedCount;
      blocks.pop();
    }
  });
  const result: number[] = [];
  for (const block of blocks)
    for (let i = 0; i < block.count; i++)
      result.push(mean(block) + distances[result.length]);
  return result;
}

/** Pin one card and move collisions outward while preserving the row order. */
export function pinAcademicCardCenters(
  xs: number[],
  widths: number[],
  fixed: number,
  x: number,
) {
  xs[fixed] = x;
  for (let i = fixed - 1; i >= 0; i--)
    xs[i] = Math.min(xs[i], xs[i + 1] - (widths[i] + widths[i + 1]) / 2 - 18);
  for (let i = fixed + 1; i < xs.length; i++)
    xs[i] = Math.max(xs[i], xs[i - 1] + (widths[i] + widths[i - 1]) / 2 + 18);
}

/** Pack ordered peers around a fixed spine, prioritizing co-supervisor alignment. */
export function packPinnedAcademicRow(
  row: AcademicTreeNode[],
  target: (node: AcademicTreeNode) => number,
  width: (node: AcademicTreeNode) => number,
  anchor: number,
  focus: number,
  supplemental: (node: AcademicTreeNode) => boolean,
) {
  const pinned = row[anchor];
  let best = row,
    positions: number[] = [],
    score = Infinity,
    priority = Infinity;
  const consider = (order: AcademicTreeNode[]) => {
    const slot = order.indexOf(pinned);
    const desired = order.map(target),
      widths = order.map(width);
    const priorities = order.map(supplemental);
    const xs = [
      ...separateAcademicCards(
        desired.slice(0, slot),
        widths.slice(0, slot),
        priorities.slice(0, slot),
      ),
      focus,
      ...separateAcademicCards(
        desired.slice(slot + 1),
        widths.slice(slot + 1),
        priorities.slice(slot + 1),
      ),
    ];
    pinAcademicCardCenters(xs, widths, slot, focus);
    const cost = xs.reduce((sum, x, i) => sum + (x - desired[i]) ** 2, 0);
    const near = xs.reduce(
      (sum, x, i) => sum + (supplemental(order[i]) ? (x - desired[i]) ** 2 : 0),
      0,
    );
    if (near < priority || (near === priority && cost < score)) {
      priority = near;
      score = cost;
      best = order;
      positions = xs;
      return true;
    }
    return false;
  };
  consider([...row]);
  // Supplemental supervisors have no incoming ordering constraints. Let them
  // cross adjacent peer cards when doing so brings them closer to their students.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let step = 0; step < best.length - 1; step++) {
      const i = pass % 2 ? best.length - 2 - step : step;
      if (!supplemental(best[i]) && !supplemental(best[i + 1])) continue;
      const order = [...best];
      [order[i], order[i + 1]] = [order[i + 1], order[i]];
      changed = consider(order) || changed;
    }
    if (!changed) break;
  }
  row.splice(0, row.length, ...best);
  return positions;
}
