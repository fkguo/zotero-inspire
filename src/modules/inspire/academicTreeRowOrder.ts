import type {
  AcademicTreeGraph,
  AcademicTreeNode,
  AcademicSortMode,
} from "./academicTreeTypes";
import { academicNodeOrder } from "./academicTreeSorting";

/** Enforce a supervisor's student order across overlapping advisor sets.
 * Layout targets only choose between unrelated/otherwise unconstrained cards.
 * Conflicting chronology constraints prefer supervisors nearest the focal person.
 */
export function createAcademicRowOrder(
  graph: AcademicTreeGraph,
  sort: AcademicSortMode,
  ranks: Map<string, number>,
) {
  const adjacent = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    for (const [a, b] of [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ]) {
      const links = adjacent.get(a) || new Set<string>();
      links.add(b);
      adjacent.set(a, links);
    }
    if (
      (ranks.get(edge.source) ?? Infinity) >=
      (ranks.get(edge.target) ?? -Infinity)
    )
      continue;
    const list = children.get(edge.source) || new Set<string>();
    list.add(edge.target);
    children.set(edge.source, list);
  }
  const distance = new Map([[graph.rootId, 0]]),
    queue = [graph.rootId];
  for (let i = 0; i < queue.length; i++)
    for (const next of adjacent.get(queue[i]) || []) {
      if (distance.has(next)) continue;
      distance.set(next, distance.get(queue[i])! + 1);
      queue.push(next);
    }
  const advisors = [...children.keys()].sort(
    (a, b) =>
      (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity) ||
      a.localeCompare(b, "en"),
  );
  const compare = new Map(
    advisors.map((id) => [id, academicNodeOrder(graph, sort, id)]),
  );
  const names = academicNodeOrder(graph, "name");
  return (
    row: AcademicTreeNode[],
    target: (node: AcademicTreeNode) => number,
  ) => {
    const byId = new Map(row.map((n) => [n.id, n]));
    const following = new Map(row.map((n) => [n.id, new Set<string>()]));
    const indegree = new Map(row.map((n) => [n.id, 0]));
    const reaches = (from: string, to: string) => {
      const todo = [from],
        seen = new Set<string>();
      while (todo.length) {
        const id = todo.pop()!;
        if (id === to) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        todo.push(...following.get(id)!);
      }
      return false;
    };
    for (const advisor of advisors) {
      const students = [...children.get(advisor)!]
        .filter((id) => byId.has(id))
        .map((id) => byId.get(id)!)
        .sort(compare.get(advisor)!);
      for (let i = 1; i < students.length; i++) {
        const a = students[i - 1].id,
          b = students[i].id;
        if (following.get(a)!.has(b) || reaches(b, a)) continue;
        following.get(a)!.add(b);
        indegree.set(b, indegree.get(b)! + 1);
      }
    }
    const ready = row.filter((n) => !indegree.get(n.id)),
      ordered: AcademicTreeNode[] = [];
    while (ready.length) {
      ready.sort((a, b) => target(a) - target(b) || names(a, b));
      const node = ready.shift()!;
      ordered.push(node);
      for (const id of following.get(node.id)!) {
        indegree.set(id, indegree.get(id)! - 1);
        if (!indegree.get(id)) ready.push(byId.get(id)!);
      }
    }
    row.splice(0, row.length, ...ordered);
  };
}
