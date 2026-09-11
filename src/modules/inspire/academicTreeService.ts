import type { InspireAuthorProfile } from "./types";
import type {
  AcademicTreeGraph,
  AcademicTreeSource,
  AcademicDirection,
  AcademicDegreeFilter,
  AcademicTreeNode,
} from "./academicTreeTypes";
import {
  ACADEMIC_TREE_MAX_DEPTH,
  ACADEMIC_TREE_MAX_NODES,
} from "./academicTreeTypes";
import {
  academicTreeSource,
  checkAcademicAbort,
} from "./academicTreeDataService";

export interface AcademicTreeOptions {
  upDepth: number;
  downDepth: number;
  maxNodes: number;
  degreeFilter?: AcademicDegreeFilter;
  signal: AbortSignal;
  source?: AcademicTreeSource;
  existing?: AcademicTreeGraph;
  onProgress?: (graph: AcademicTreeGraph) => void;
}

export function clampAcademicDepth(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(ACADEMIC_TREE_MAX_DEPTH, Math.floor(value)))
    : 2;
}

export function matchesAcademicDegree(
  degree: string | undefined,
  filter: AcademicDegreeFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "other")
    return !["phd", "master", "bachelor"].includes(degree || "");
  return degree === filter;
}

/** Bounded breadth-first traversal. Identity is exclusively the INSPIRE author ID. */
export async function buildAcademicTree(
  root: InspireAuthorProfile,
  options: AcademicTreeOptions,
): Promise<AcademicTreeGraph> {
  const { signal, onProgress } = options;
  checkAcademicAbort(signal);
  if (!/^\d+$/.test(root.recid))
    throw new Error("Academic tree needs a resolved author ID");
  const source = options.source ?? academicTreeSource;
  const maxNodes = Math.max(
    options.existing?.nodes.length ?? 1,
    Math.min(
      ACADEMIC_TREE_MAX_NODES,
      Math.max(1, Math.floor(options.maxNodes) || 200),
    ),
  );
  const degreeFilter = options.degreeFilter ?? "all";
  const graph: AcademicTreeGraph = options.existing
    ? JSON.parse(JSON.stringify(options.existing))
    : {
        rootId: root.recid,
        nodes: [],
        edges: [],
        expanded: { up: [], down: [] },
        empty: { up: [], down: [] },
        failures: [],
        limited: false,
      };
  graph.limited = false;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const profiles = new Map<string, InspireAuthorProfile>([[root.recid, root]]);
  const edges = new Map(
    graph.edges.map((edge) => [`${edge.source}|${edge.target}`, edge]),
  );
  const publish = () => {
    graph.nodes = [...nodes.values()];
    graph.edges = [...edges.values()];
    onProgress?.(JSON.parse(JSON.stringify(graph)));
  };
  const addNode = (
    id: string,
    name: string,
    level: number,
    profile?: InspireAuthorProfile,
  ): AcademicTreeNode | undefined => {
    const existing = nodes.get(id);
    if (existing) {
      if (profile) {
        existing.name = profile.name;
        existing.institution = profile.currentPosition?.institution;
      }
      return existing;
    }
    if (Math.abs(level) > ACADEMIC_TREE_MAX_DEPTH) return;
    if (nodes.size >= maxNodes) {
      graph.limited = true;
      return;
    }
    const node = {
      id,
      name,
      recid: /^\d+$/.test(id) ? id : undefined,
      institution: profile?.currentPosition?.institution,
      level,
    };
    nodes.set(id, node);
    return node;
  };
  addNode(root.recid, root.name, 0, root);
  const connect = (mentor: string, student: string, degree?: string) => {
    if (mentor === student || !nodes.has(mentor) || !nodes.has(student)) return;
    const key = `${mentor}|${student}`;
    const edge = edges.get(key) ?? {
      source: mentor,
      target: student,
      degreeTypes: [],
    };
    if (!edge.degreeTypes.includes(degree || "unknown"))
      edge.degreeTypes.push(degree || "unknown");
    edges.set(key, edge);
  };
  type Task = { id: string; direction: AcademicDirection; remaining: number };
  let queue: Task[] = [];
  const visited = new Set<string>();
  const enqueue = (
    id: string,
    direction: AcademicDirection,
    remaining: number,
  ) => {
    const level = nodes.get(id)?.level;
    if (
      level === undefined ||
      (direction === "up" && level <= -ACADEMIC_TREE_MAX_DEPTH) ||
      (direction === "down" && level >= ACADEMIC_TREE_MAX_DEPTH)
    )
      return;
    const key = `${direction}:${id}`;
    if (remaining <= 0 || visited.has(key)) return;
    visited.add(key);
    queue.push({ id, direction, remaining });
  };
  enqueue(root.recid, "up", clampAcademicDepth(options.upDepth));
  enqueue(root.recid, "down", clampAcademicDepth(options.downDepth));
  let requests = 0;
  const budget = () => {
    checkAcademicAbort(signal);
    if (++requests > 500) {
      graph.limited = true;
      return false;
    }
    return true;
  };
  const mark = (direction: AcademicDirection, id: string, empty: boolean) => {
    if (!graph.expanded[direction].includes(id))
      graph.expanded[direction].push(id);
    graph.empty[direction] = graph.empty[direction].filter(
      (value) => value !== id,
    );
    if (empty) graph.empty[direction].push(id);
  };
  const expand = async (task: Task) => {
    const { id, direction, remaining } = task;
    graph.failures = graph.failures.filter(
      (f) => f.id !== id || f.direction !== direction,
    );
    const node = nodes.get(id)!;
    try {
      if (direction === "up") {
        let profile = profiles.get(id);
        if (!profile) {
          if (!budget()) return;
          profile = await source.profile(id, signal);
          checkAcademicAbort(signal);
          profiles.set(id, profile);
          addNode(id, profile.name, node.level, profile);
        }
        const advisors = (profile.advisors ?? []).filter((a) =>
          matchesAcademicDegree(a.degreeType, degreeFilter),
        );
        for (const [index, advisor] of (profile.advisors ?? []).entries()) {
          if (!matchesAcademicDegree(advisor.degreeType, degreeFilter))
            continue;
          const mentorId = advisor.recid || `unlinked:${id}:${index}`;
          if (addNode(mentorId, advisor.name, node.level - 1)) {
            connect(mentorId, id, advisor.degreeType);
            if (advisor.recid) enqueue(mentorId, direction, remaining - 1);
          }
        }
        if (!graph.limited) mark(direction, id, !advisors.length);
      } else {
        let found = false;
        for (let page = 1; page <= 40; page++) {
          if (!budget()) return;
          const result = await source.students(id, page, signal);
          checkAcademicAbort(signal);
          for (const student of result.profiles) {
            // Reverse search is only a candidate list: verify the actual public link.
            const relations = (student.advisors ?? []).filter(
              (a) =>
                a.recid === id &&
                matchesAcademicDegree(a.degreeType, degreeFilter),
            );
            if (!relations.length) continue;
            found = true;
            if (!addNode(student.recid, student.name, node.level + 1, student))
              continue;
            profiles.set(student.recid, student);
            for (const relation of relations)
              connect(id, student.recid, relation.degreeType);
            enqueue(student.recid, direction, remaining - 1);
            // Keep co-advisors visible, without traversing their unrelated branches.
            for (const [index, advisor] of (student.advisors ?? []).entries()) {
              if (!matchesAcademicDegree(advisor.degreeType, degreeFilter))
                continue;
              const mentorId =
                advisor.recid || `unlinked:${student.recid}:${index}`;
              if (addNode(mentorId, advisor.name, node.level))
                connect(mentorId, student.recid, advisor.degreeType);
            }
          }
          if (!result.hasMore) {
            if (!graph.limited) mark(direction, id, !found);
            return;
          }
          if (nodes.size >= maxNodes) {
            graph.limited = true;
            return;
          }
        }
        graph.limited = true;
      }
    } catch (error) {
      checkAcademicAbort(signal);
      graph.failures.push({ id, direction });
    }
  };
  publish();
  while (queue.length) {
    checkAcademicAbort(signal);
    const layer = queue;
    queue = [];
    for (let offset = 0; offset < layer.length; offset += 3) {
      await Promise.all(layer.slice(offset, offset + 3).map(expand));
      publish();
      checkAcademicAbort(signal);
      if (graph.limited) {
        queue = [];
        break;
      }
    }
    if (graph.limited) break;
  }
  publish();
  return graph;
}
