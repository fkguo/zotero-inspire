import { INSPIRE_API_BASE } from "./constants";
import { inspireFetch } from "./rateLimiter";
import { localCache } from "./localCache";
import { LRUCache } from "./utils";
import { fetchAuthorRecord, retainAuthorRecord } from "./authorProfileRecords";
import type { InspireAuthorProfile } from "./types";
import type {
  AcademicStudentsPage,
  AcademicTreeSource,
} from "./academicTreeTypes";

const TTL = 2 * 60 * 60 * 1000;
const PAGE_SIZE = 50;
const memory = new LRUCache<string, { data: unknown; at: number }>(200);

export function checkAcademicAbort(signal: AbortSignal): void {
  if (signal.aborted)
    throw Object.assign(new Error("Aborted"), { name: "AbortError" });
}

async function request(
  url: string,
  signal: AbortSignal,
  refresh = false,
): Promise<unknown> {
  checkAcademicAbort(signal);
  const response = await inspireFetch(url, {
    signal,
    ...(refresh ? { cache: "no-store" as const } : {}),
  });
  checkAcademicAbort(signal);
  if (!response.ok) throw new Error(`INSPIRE HTTP ${response.status}`);
  return response.json();
}

async function cached<T>(
  key: string,
  signal: AbortSignal,
  fetch: () => Promise<T>,
  refresh = false,
): Promise<T> {
  checkAcademicAbort(signal);
  const hit = memory.get(key);
  if (!refresh && hit && Date.now() - hit.at < TTL) return hit.data as T;
  // Separate versioned cache: old hover profiles may be incomplete or name-matched.
  const local = refresh
    ? null
    : await localCache
        .get<{ data: T; at: number }>("academic_tree", key)
        .catch(() => null);
  checkAcademicAbort(signal);
  if (local?.data && Date.now() - local.data.at < TTL) {
    memory.set(key, local.data);
    return local.data.data;
  }
  const data = await fetch();
  checkAcademicAbort(signal);
  const entry = { data, at: Date.now() };
  memory.set(key, entry);
  void localCache
    .set("academic_tree", key, entry, undefined, 1)
    .catch(() => {});
  return data;
}

function profileFromRecord(value: unknown): InspireAuthorProfile {
  return treeProfile(retainAuthorRecord(value));
}

function treeProfile(shared: InspireAuthorProfile): InspireAuthorProfile {
  const profile = { ...shared };
  // The shared profile parser falls back to a historical position. Tree subtitles
  // explicitly describe current affiliations, so require INSPIRE's current flag.
  const current = profile.positions?.filter(
    (position) => position.current && position.institution,
  );
  profile.currentPosition = current?.length
    ? {
        institution: [
          ...new Set(current.map((position) => position.institution!)),
        ].join("; "),
      }
    : undefined;
  return profile;
}

function searchRows(value: unknown): { rows: unknown[]; total: number } {
  const hits = (
    value as {
      hits?: {
        hits?: unknown[];
        total?: number | { value?: number; relation?: string };
      };
    }
  )?.hits;
  const total =
    typeof hits?.total === "number" ? hits.total : hits?.total?.value;
  if (!Array.isArray(hits?.hits) || typeof total !== "number" || total < 0)
    throw new Error("Invalid author search response");
  return { rows: hits.hits, total };
}

function makeSource(refresh = false): AcademicTreeSource {
  return {
    async profile(recid, signal) {
      if (!/^\d+$/.test(recid)) throw new Error("Invalid author ID");
      return treeProfile(await fetchAuthorRecord(recid, signal, refresh));
    },
    async students(recid, page, signal): Promise<AcademicStudentsPage> {
      if (!/^\d+$/.test(recid) || !Number.isInteger(page) || page < 1)
        throw new Error("Invalid students query");
      return cached(
        `v3-students-${recid}-${page}`,
        signal,
        async () => {
          const query = encodeURIComponent(`advisors.record.$ref:${recid}`);
          const data = await request(
            `${INSPIRE_API_BASE}/authors?q=${query}&size=${PAGE_SIZE}&page=${page}`,
            signal,
            refresh,
          );
          const { rows, total } = searchRows(data);
          if (
            rows.length <
            Math.min(PAGE_SIZE, Math.max(0, total - (page - 1) * PAGE_SIZE))
          )
            throw new Error("Incomplete students page");
          return {
            profiles: rows.map(profileFromRecord),
            total,
            hasMore: page * PAGE_SIZE < total,
          };
        },
        refresh,
      );
    },
  };
}

export const academicTreeSource = makeSource();

/** Retain successful requests across retries, including retries of a forced refresh. */
export function createAcademicTreeSession(refresh = false): AcademicTreeSource {
  const source = refresh ? makeSource(true) : academicTreeSource;
  const completed = new LRUCache<string, unknown>(1000);
  const get = async <T>(
    key: string,
    signal: AbortSignal,
    request: () => Promise<T>,
  ): Promise<T> => {
    checkAcademicAbort(signal);
    const hit = completed.get(key);
    if (hit !== undefined) return hit as T;
    const value = await request();
    checkAcademicAbort(signal);
    completed.set(key, value);
    return value;
  };
  return {
    hasProfile: (id) => completed.get(`profile:${id}`) !== undefined,
    hasStudentsPage: (id, page) =>
      completed.get(`students:${id}:${page}`) !== undefined,
    profile: (id, signal) =>
      get(`profile:${id}`, signal, () => source.profile(id, signal)),
    students: (id, page, signal) =>
      get(`students:${id}:${page}`, signal, () =>
        source.students(id, page, signal),
      ),
  };
}

/** Return candidates for explicit selection; never resolve an ambiguous name to the first hit. */
export async function searchAcademicAuthors(
  query: string,
  signal: AbortSignal,
): Promise<InspireAuthorProfile[]> {
  if (!query.trim()) return [];
  const data = await request(
    `${INSPIRE_API_BASE}/authors?q=${encodeURIComponent(query.trim())}&size=20`,
    signal,
  );
  return searchRows(data).rows.map(profileFromRecord);
}
