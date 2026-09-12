import { inspireFetch } from "./rateLimiter";
import { localCache } from "./localCache";
import { LRUCache, createAbortController } from "./utils";
import { INSPIRE_API_BASE, AUTHOR_PROFILE_CACHE_TTL_MS } from "./constants";
import {
  parseAuthorProfile,
  AUTHOR_PROFILE_VERSION,
} from "./authorProfileParser";
import type { InspireAuthorMetadata } from "./apiTypes";
import type { InspireAuthorProfile } from "./types";

type Entry = { profile: InspireAuthorProfile; fetchedAt: number };
type Pending = {
  controller: AbortController;
  promise: Promise<InspireAuthorProfile>;
  users: number;
  refresh: boolean;
};
const memory = new LRUCache<string, Entry>(200);
// Entries exist only for active requests and are removed on settlement/cancellation.
const pending = new Map<string, Pending>();
const abortError = () =>
  Object.assign(new Error("Aborted"), { name: "AbortError" });
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError();
};
const valid = (entry?: Entry | null, recid?: string): entry is Entry =>
  !!entry &&
  entry.profile?.profileVersion === AUTHOR_PROFILE_VERSION &&
  entry.profile.recid === recid &&
  Date.now() - entry.fetchedAt < AUTHOR_PROFILE_CACHE_TTL_MS;

function store(profile: InspireAuthorProfile) {
  const entry = { profile, fetchedAt: Date.now() };
  memory.set(profile.recid, entry);
  void localCache
    .set("author_profile", `v2:${profile.recid}`, entry)
    .catch(() => {});
}

/** Full unprojected Authors API records can seed the same cache as direct lookups. */
export function retainAuthorRecord(
  value: unknown,
  cache = true,
): InspireAuthorProfile {
  const row = value as {
    id?: string | number;
    metadata?: InspireAuthorMetadata;
  } | null;
  const recid = String(row?.id ?? row?.metadata?.control_number ?? "");
  if (!/^\d+$/.test(recid) || !row?.metadata?.name)
    throw new Error("Invalid author record");
  if (row.metadata.deleted) throw new Error("Author record deleted");
  const profile = parseAuthorProfile(row.metadata, recid);
  if (!profile?.name) throw new Error("Author name missing");
  // A direct/forced request owns the cache while active; don't overwrite it with a page.
  if (cache && !pending.has(recid) && !valid(memory.get(recid), recid))
    store(profile);
  return profile;
}

/** Exact-identity shared lookup. One consumer cancelling must not cancel another. */
export async function fetchAuthorRecord(
  recid: string,
  signal?: AbortSignal,
  refresh = false,
): Promise<InspireAuthorProfile> {
  checkAbort(signal);
  if (!/^\d+$/.test(recid)) throw new Error("Invalid author ID");
  let task = pending.get(recid);
  if (!task && !refresh) {
    const cached = memory.get(recid);
    if (valid(cached, recid)) return cached.profile;
    const disk = await localCache
      .get<Entry>("author_profile", `v2:${recid}`)
      .catch(() => null);
    checkAbort(signal);
    task = pending.get(recid);
    const newest = memory.get(recid);
    if (!task && valid(newest, recid)) return newest.profile;
    if (!task && valid(disk?.data, recid)) {
      memory.set(recid, disk!.data);
      return disk!.data.profile;
    }
  }
  if (!task || (refresh && !task.refresh)) {
    if (pending.size >= 200 && !pending.has(recid))
      throw new Error("Too many author requests");
    const controller = createAbortController();
    if (!controller) throw new Error("AbortController unavailable");
    task = { controller, users: 0, refresh, promise: undefined! };
    const owner = task;
    pending.set(recid, owner);
    owner.promise = (async () => {
      const response = await inspireFetch(
        `${INSPIRE_API_BASE}/authors/${recid}`,
        {
          signal: controller.signal,
          ...(refresh ? { cache: "no-store" as const } : {}),
        },
      );
      checkAbort(controller.signal);
      if (!response.ok) throw new Error(`INSPIRE HTTP ${response.status}`);
      const profile = retainAuthorRecord(await response.json(), false);
      checkAbort(controller.signal);
      if (profile.recid !== recid) throw new Error("Author ID mismatch");
      if (pending.get(recid) === owner) store(profile);
      return profile;
    })().finally(() => {
      if (pending.get(recid) === owner) pending.delete(recid);
    });
  }
  const owner = task!;
  owner.users++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, profile?: InspireAuthorProfile) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      owner.users--;
      if (!owner.users) {
        if (pending.get(recid) === owner) pending.delete(recid);
        owner.controller.abort();
      }
      if (error) reject(error);
      else resolve(profile!);
    };
    const cancel = () => finish(abortError());
    signal?.addEventListener("abort", cancel, { once: true });
    owner.promise.then((profile) => finish(undefined, profile), finish);
    if (signal?.aborted) cancel();
  });
}

export function clearAuthorRecordCache() {
  memory.clear();
  for (const task of pending.values()) task.controller.abort();
  pending.clear();
}
