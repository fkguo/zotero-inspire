import { INSPIRE_API_BASE } from "./constants";
import { inspireFetch } from "./rateLimiter";
import { localCache } from "./localCache";
import { LRUCache } from "./utils";
import { parseAuthorProfile } from "./authorProfileService";
import type { InspireAuthorMetadata } from "./apiTypes";
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

async function request(url: string, signal: AbortSignal): Promise<unknown> {
  checkAcademicAbort(signal);
  const response = await inspireFetch(url, { signal });
  checkAcademicAbort(signal);
  if (!response.ok) throw new Error(`INSPIRE HTTP ${response.status}`);
  return response.json();
}

async function cached<T>(
  key: string,
  signal: AbortSignal,
  fetch: () => Promise<T>,
): Promise<T> {
  checkAcademicAbort(signal);
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data as T;
  // Separate versioned cache: old hover profiles may be incomplete or name-matched.
  const local = await localCache
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
  const row = value as {
    id?: string | number;
    metadata?: InspireAuthorMetadata;
  } | null;
  const recid = String(row?.id ?? row?.metadata?.control_number ?? "");
  const metadata = row?.metadata;
  if (!/^\d+$/.test(recid) || !metadata?.name)
    throw new Error("Invalid author record");
  // Deleted/merged authors require an explicit new identity selection.
  if ((metadata as { deleted?: boolean }).deleted)
    throw new Error("Author record deleted");
  const profile = parseAuthorProfile(metadata, recid);
  if (!profile?.name) throw new Error("Author name missing");
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

export const academicTreeSource: AcademicTreeSource = {
  async profile(recid, signal) {
    if (!/^\d+$/.test(recid)) throw new Error("Invalid author ID");
    return cached(`v1-profile-${recid}`, signal, async () => {
      const result = profileFromRecord(
        await request(`${INSPIRE_API_BASE}/authors/${recid}`, signal),
      );
      if (result.recid !== recid) throw new Error("Author ID mismatch");
      return result;
    });
  },
  async students(recid, page, signal): Promise<AcademicStudentsPage> {
    if (!/^\d+$/.test(recid) || !Number.isInteger(page) || page < 1)
      throw new Error("Invalid students query");
    return cached(`v1-students-${recid}-${page}`, signal, async () => {
      const query = encodeURIComponent(`advisors.record.$ref:${recid}`);
      const data = await request(
        `${INSPIRE_API_BASE}/authors?q=${query}&size=${PAGE_SIZE}&page=${page}`,
        signal,
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
    });
  },
};

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
