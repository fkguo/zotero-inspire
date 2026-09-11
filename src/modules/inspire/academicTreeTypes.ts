import type { InspireAuthorProfile } from "./types";

export type AcademicDirection = "up" | "down";
export type AcademicDegreeFilter =
  | "all"
  | "phd"
  | "master"
  | "bachelor"
  | "other";
export interface AcademicTreeNode {
  id: string;
  name: string;
  recid?: string;
  institution?: string;
  level: number;
}
export interface AcademicTreeEdge {
  source: string;
  target: string;
  degreeTypes: string[];
}
export interface AcademicTreeGraph {
  rootId: string;
  nodes: AcademicTreeNode[];
  edges: AcademicTreeEdge[];
  expanded: Record<AcademicDirection, string[]>;
  empty: Record<AcademicDirection, string[]>;
  failures: Array<{ id: string; direction: AcademicDirection }>;
  profileFailures?: string[];
  limited: boolean;
}
export interface AcademicStudentsPage {
  profiles: InspireAuthorProfile[];
  total: number;
  hasMore: boolean;
}
export interface AcademicTreeSource {
  hasProfile?(recid: string): boolean;
  hasStudentsPage?(recid: string, page: number): boolean;
  profile(recid: string, signal: AbortSignal): Promise<InspireAuthorProfile>;
  students(
    recid: string,
    page: number,
    signal: AbortSignal,
  ): Promise<AcademicStudentsPage>;
}
export const ACADEMIC_TREE_DEFAULT_DEPTH = 2;
export const ACADEMIC_TREE_MAX_DEPTH = 8;
export const ACADEMIC_TREE_INITIAL_LIMIT = 200;
export const ACADEMIC_TREE_MAX_NODES = 1000;
