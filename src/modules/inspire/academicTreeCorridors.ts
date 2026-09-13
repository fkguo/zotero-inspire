import type { AcademicLayoutNode } from "./academicTreeLayout";

/** Choose the whole downward route before drawing it: fewest lateral moves,
 * then shortest horizontal travel. Row gaps remain reserved for family buses. */
export function academicCorridors(
  rows: AcademicLayoutNode[][],
  start: number,
  target: number,
  targetMin = target,
  targetMax = target,
) {
  const xs = [
    ...new Set([
      start,
      target,
      targetMin,
      targetMax,
      ...rows.flatMap((row) =>
        row.flatMap((n) => [n.x - 7, n.x + n.width + 7]),
      ),
    ]),
  ].sort((a, b) => a - b);
  type Cost = { moves: number; length: number };
  const better = (a: Cost, b: Cost) =>
    a.moves < b.moves || (a.moves === b.moves && a.length < b.length);
  const unreachable = () => ({ moves: Infinity, length: Infinity });
  let costs = xs.map((x) =>
    x === start ? { moves: 0, length: 0 } : unreachable(),
  );
  const history: number[][] = [];
  for (const row of rows) {
    // Prefix/suffix minima give the best move from either side in linear time.
    const left: number[] = [],
      right: number[] = [];
    for (const direction of [1, -1]) {
      let best = -1;
      const score = (i: number) => ({
        moves: costs[i].moves,
        length: costs[i].length - direction * xs[i],
      });
      for (
        let i = direction === 1 ? 0 : xs.length - 1;
        i >= 0 && i < xs.length;
        i += direction
      ) {
        if (best < 0 || better(score(i), score(best))) best = i;
        (direction === 1 ? left : right)[i] = best;
      }
    }
    const blocks = [...row].sort((a, b) => a.x - b.x);
    let block = 0,
      blockedUntil = -Infinity;
    const previous: number[] = [];
    const next = xs.map((x, i) => {
      while (block < blocks.length && blocks[block].x - 7 < x) {
        blockedUntil = Math.max(
          blockedUntil,
          blocks[block].x + blocks[block].width + 7,
        );
        block++;
      }
      if (x < blockedUntil) return unreachable();
      let cost = costs[i];
      previous[i] = i;
      for (const j of [left[i], right[i]]) {
        const candidate = {
          moves: costs[j].moves + Number(i !== j),
          length: costs[j].length + Math.abs(x - xs[j]),
        };
        if (better(candidate, cost)) {
          cost = candidate;
          previous[i] = j;
        }
      }
      return cost;
    });
    costs = next;
    history.push(previous);
  }
  let best = -1,
    bestCost = unreachable(),
    end = target;
  xs.forEach((x, i) => {
    const port = Math.max(targetMin, Math.min(targetMax, x));
    const candidate = {
      moves: costs[i].moves + Number(x !== port),
      length: costs[i].length + Math.abs(x - port),
    };
    if (
      better(candidate, bestCost) ||
      (candidate.moves === bestCost.moves &&
        candidate.length === bestCost.length &&
        Math.abs(port - target) < Math.abs(end - target))
    ) {
      best = i;
      bestCost = candidate;
      end = port;
    }
  });
  const route = Array<number>(rows.length);
  for (let row = rows.length - 1; row >= 0; row--) {
    route[row] = xs[best];
    best = history[row][best];
  }
  return { route, end };
}
