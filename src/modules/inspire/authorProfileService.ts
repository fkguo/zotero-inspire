import { config } from "../../../package.json";
import { inspireFetch } from "./rateLimiter";
import { INSPIRE_API_BASE, AUTHOR_PROFILE_CACHE_TTL_MS } from "./constants";
import { LRUCache } from "./utils";
import { localCache } from "./localCache";
import type { AuthorSearchInfo, InspireAuthorProfile } from "./types";
import type {
  InspireAuthorsSearchResponse,
  InspireAuthorDirectResponse,
  InspireAuthorMetadata,
} from "./apiTypes";

const authorProfileCache = new LRUCache<
  string,
  { profile: InspireAuthorProfile; fetchedAt: number }
>(100);

/**
 * Generate cache key for author profile.
 * Priority: recid > BAI > fullName (lowercase)
 * Using recid as primary key ensures cache hit even when same author
 * is accessed via different entry points (recid vs BAI vs name).
 */
function getAuthorCacheKey(authorInfo: AuthorSearchInfo): string {
  if (authorInfo.recid) {
    return `recid:${authorInfo.recid}`;
  }
  if (authorInfo.bai) {
    return `bai:${authorInfo.bai.trim()}`;
  }
  return `name:${authorInfo.fullName.trim().toLowerCase()}`;
}

function getCachedProfile(key: string): InspireAuthorProfile | null {
  const cached = authorProfileCache.get(key);
  if (!cached) {
    return null;
  }
  const age = Date.now() - cached.fetchedAt;
  if (age > AUTHOR_PROFILE_CACHE_TTL_MS) {
    authorProfileCache.delete(key);
    return null;
  }
  return cached.profile;
}

/**
 * Get author profile from local persistent cache.
 * Used for offline fallback when network is unavailable.
 */
async function getLocalCachedProfile(key: string): Promise<InspireAuthorProfile | null> {
  try {
    const result = await localCache.get<InspireAuthorProfile>(
      "author_profile",
      key,
      undefined,
      { ignoreTTL: true }, // Allow expired cache for offline use
    );
    if (result?.data) {
      Zotero.debug(`[${config.addonName}] Author profile from local cache: ${key}`);
      return result.data;
    }
  } catch (e) {
    Zotero.debug(`[${config.addonName}] Failed to get author profile from local cache: ${e}`);
  }
  return null;
}

/**
 * Store profile in cache with multiple keys for cross-reference.
 * When a profile is fetched, cache it under all available identifiers
 * so subsequent lookups via any identifier hit the cache.
 * Also saves to local persistent cache for offline support.
 */
function cacheProfile(
  primaryKey: string,
  profile: InspireAuthorProfile,
): void {
  const now = Date.now();
  const entry = { profile, fetchedAt: now };

  // Always cache under primary key
  authorProfileCache.set(primaryKey, entry);

  // Also cache under recid if available and different from primary
  if (profile.recid) {
    const recidKey = `recid:${profile.recid}`;
    if (recidKey !== primaryKey) {
      authorProfileCache.set(recidKey, entry);
    }
  }

  // Also cache under BAI if available and different from primary
  if (profile.bai) {
    const baiKey = `bai:${profile.bai}`;
    if (baiKey !== primaryKey) {
      authorProfileCache.set(baiKey, entry);
    }
  }

  // Save to local persistent cache for offline support
  // Keep the local cache readable from *all* entry points:
  // - recid lookup reads `authorInfo.recid` (bare recid)
  // - BAI/name lookup reads the prefixed in-memory cache key (e.g. `bai:...`, `name:...`)
  const localCacheKeys = new Set<string>();
  localCacheKeys.add(primaryKey);
  if (profile.recid) {
    localCacheKeys.add(profile.recid);
  }
  if (profile.bai) {
    localCacheKeys.add(`bai:${profile.bai}`);
  }

  for (const key of localCacheKeys) {
    localCache
      .set<InspireAuthorProfile>("author_profile", key, profile, undefined, undefined)
      .catch((e) => {
        Zotero.debug(
          `[${config.addonName}] Failed to save author profile to local cache (${key}): ${e}`,
        );
      });
  }
}

/**
 * Fetch author profile from INSPIRE Authors API.
 *
 * Query priority (most accurate first):
 * 1. **Direct recid lookup**: `/api/authors/{recid}` - 100% accurate, fastest
 * 2. **BAI search**: `/api/authors?q=ids.value:{bai}` - highly reliable
 * 3. **Name search**: `/api/authors?q=name:{name}` - fallback, may have duplicates
 *
 * @param authorInfo - Author search info containing fullName, bai, and/or recid
 * @param signal - Optional AbortSignal for cancellation
 * @returns Author profile or null if not found
 */
export async function fetchAuthorProfile(
  authorInfo: AuthorSearchInfo,
  signal?: AbortSignal,
): Promise<InspireAuthorProfile | null> {
  const cacheKey = getAuthorCacheKey(authorInfo);

  // Priority 1: Check in-memory cache (fastest)
  const cached = getCachedProfile(cacheKey);
  if (cached) {
    return cached;
  }

  // Validate: need at least one identifier
  if (!authorInfo.recid && !authorInfo.bai && !authorInfo.fullName?.trim()) {
    return null;
  }

  // Priority 2: Check local persistent cache (for offline support)
  // Use recid if available, as it's the primary key for local cache
  const localCacheKey = authorInfo.recid || cacheKey;
  const localCached = await getLocalCachedProfile(localCacheKey);
  if (localCached) {
    // Also populate memory cache for faster subsequent access
    cacheProfile(cacheKey, localCached);
    return localCached;
  }

  try {
    let profile: InspireAuthorProfile | null = null;

    // Priority 1: Direct recid lookup (most accurate, fastest)
    if (authorInfo.recid) {
      profile = await fetchAuthorByRecid(authorInfo.recid, signal);
      if (profile) {
        cacheProfile(cacheKey, profile);
        return profile;
      }
      // recid lookup failed, fall through to BAI/name search
    }

    // Priority 2: BAI search (highly reliable)
    // Priority 3: Name search (fallback, try converted then raw)
    // Note: Search API returns minimal fields, so we extract recid and do direct lookup

    const trySearch = async (query: string) => {
      const url = `${INSPIRE_API_BASE}/authors?q=${encodeURIComponent(query)}&size=1`;
      Zotero.debug(`[${config.addonName}] Author profile search: ${url}`);
      const response = await inspireFetch(
        url,
        signal ? { signal } : undefined,
      ).catch(() => null);
      if (!response || !response.ok) {
        Zotero.debug(`[${config.addonName}] Author profile search failed: ${response?.status} for ${url}`);
        return null;
      }
      const data = (await response.json()) as unknown as InspireAuthorsSearchResponse | null;
      const hit = data?.hits?.hits?.[0];
      if (!hit) {
        Zotero.debug(`[${config.addonName}] Author profile search: no results for query "${query}"`);
        return null;
      }
      // Extract recid from search result and do direct lookup for full data (including email)
      const foundRecid = hit?.id || hit?.metadata?.control_number;
      Zotero.debug(`[${config.addonName}] Author profile search found recid: ${foundRecid}`);
      if (foundRecid) {
        // Direct lookup returns full data including email_addresses
        const fullProfile = await fetchAuthorByRecid(String(foundRecid), signal);
        if (fullProfile) {
          Zotero.debug(`[${config.addonName}] Author profile via direct lookup, email: ${fullProfile.emails?.join(", ") || "none"}`);
          return fullProfile;
        }
      }
      // Fallback: parse from search result (may lack some fields like email)
      Zotero.debug(`[${config.addonName}] Author profile fallback to search result parsing`);
      return parseAuthorProfile(hit?.metadata, hit?.id);
    };

    if (authorInfo.bai) {
      profile = await trySearch(`ids.value:"${authorInfo.bai}"`);
      if (profile) {
        cacheProfile(cacheKey, profile);
        return profile;
      }
    }

    if (authorInfo.fullName?.trim()) {
      const rawName = authorInfo.fullName.trim();

      // FTR-AUTHOR-SEARCH-FIX: Use full name directly for better search accuracy
      // Don't convert to initials - INSPIRE Authors API works better with full names
      // The search returns ranked results; full name matches rank higher

      // Parse the name to extract first name and last name
      let firstName = "";
      let lastName = "";
      if (rawName.includes(",")) {
        // "Last, First" format
        const [lastPart, firstPart] = rawName.split(",", 2);
        lastName = (lastPart || "").trim();
        firstName = (firstPart || "").trim();
      } else {
        // "First Last" format - assume last word is last name
        const parts = rawName.split(/\s+/);
        if (parts.length === 1) {
          lastName = parts[0];
        } else {
          lastName = parts[parts.length - 1];
          firstName = parts.slice(0, -1).join(" ");
        }
      }

      // Build search queries in order of specificity
      const searchQueries: string[] = [];

      // 1. Full name in "First Last" format (most specific)
      if (firstName && lastName) {
        // Check if firstName looks like initials (e.g., "S.L.", "F.-K.")
        const isInitials = /^[A-Z]\.(?:\s*-?[A-Z]\.)*$/.test(firstName.replace(/\s+/g, ""));
        if (!isInitials) {
          // Full first name - use directly
          searchQueries.push(`${firstName} ${lastName}`);
        }
        // Also try "Last, First" format for exact matching
        searchQueries.push(`${lastName}, ${firstName}`);
      }

      // 2. Just last name (broader fallback)
      if (lastName && lastName.length > 1) {
        searchQueries.push(lastName);
      }

      // Try searches in order, stop when we find a result
      for (const query of searchQueries) {
        Zotero.debug(`[${config.addonName}] Author profile search: trying query "${query}"`);
        profile = await trySearch(query);
        if (profile) {
          cacheProfile(cacheKey, profile);
          return profile;
        }
      }

      return null;
    }

    return null;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw err;
    }
    Zotero.debug(`[${config.addonName}] Failed to fetch author profile: ${err}`);
    return null;
  }
}

/**
 * Fetch author profile directly by recid.
 * Uses `/api/authors/{recid}` endpoint for exact match.
 *
 * @param recid - INSPIRE author recid
 * @param signal - Optional AbortSignal for cancellation
 * @returns Author profile or null if not found
 */
async function fetchAuthorByRecid(
  recid: string,
  signal?: AbortSignal,
): Promise<InspireAuthorProfile | null> {
  try {
    // Direct lookup: /api/authors/{recid}
    // Note: Don't use fields parameter for Authors API - get full response
    // Author profiles are small (~2KB) and we need all fields including email_addresses
    const url = `${INSPIRE_API_BASE}/authors/${recid}`;
    const response = await inspireFetch(
      url,
      signal ? { signal } : undefined,
    ).catch(() => null);

    if (!response || !response.ok) {
      return null;
    }

    const data = (await response.json()) as unknown as InspireAuthorDirectResponse | null;
    // Direct lookup response: { "id": "...", "metadata": { ... } }
    const record = data?.metadata;
    if (!record) {
      return null;
    }
    const recordId = data?.id || record?.control_number;
    return parseAuthorProfile(record, recordId);
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw err;
    }
    Zotero.debug(
      `[${config.addonName}] Failed to fetch author by recid ${recid}: ${err}`,
    );
    return null;
  }
}

export function parseAuthorProfile(
  metadata: InspireAuthorMetadata | undefined,
  recid?: string | number,
): InspireAuthorProfile | null {
  if (!metadata?.name) {
    return null;
  }

  const profile: InspireAuthorProfile = {
    recid: recid ? String(recid) : String(metadata.control_number || ""),
    name: metadata.name.preferred_name || metadata.name.value || "",
  };

  if (Array.isArray(metadata.positions) && metadata.positions.length) {
    const current =
      metadata.positions.find((p: any) => p.current) || metadata.positions[0];
    if (current) {
      profile.currentPosition = {
        institution: current.institution || "",
        rank: current.rank,
      };
    }
  }

  if (Array.isArray(metadata.ids)) {
    for (const id of metadata.ids) {
      if (id?.schema === "ORCID") {
        profile.orcid = id.value;
      } else if (id?.schema === "INSPIRE BAI") {
        profile.bai = id.value;
      } else if (id?.schema === "INSPIRE ID") {
        profile.inspireId = id.value;
      }
    }
  }

  if (Array.isArray(metadata.arxiv_categories)) {
    profile.arxivCategories = metadata.arxiv_categories;
  }

  if (Array.isArray(metadata.urls) && metadata.urls.length) {
    const url = metadata.urls.find((u: any) => u?.value)?.value;
    if (url) {
      profile.homepageUrl = url;
    }
  }

  if (Array.isArray(metadata.email_addresses)) {
    const currentEmails = metadata.email_addresses
      .filter((e: any) => e?.current)
      .map((e: any) => e?.value)
      .filter((e: any) => typeof e === "string" && e.trim());
    const allEmails = metadata.email_addresses
      .map((e: any) => e?.value)
      .filter((e: any) => typeof e === "string" && e.trim());
    const emails = currentEmails.length ? currentEmails : allEmails;
    if (emails.length) {
      profile.emails = emails;
    }
  }

  if (Array.isArray(metadata.advisors)) {
    profile.advisors = metadata.advisors
      .map((advisor: any) => {
        // Extract recid from record.$ref (e.g., "https://inspirehep.net/api/authors/1011904")
        let recid: string | undefined;
        const ref = advisor?.record?.$ref;
        if (typeof ref === "string") {
          const match = ref.match(/\/authors\/(\d+)$/);
          if (match) {
            recid = match[1];
          }
        }
        return {
          name: advisor?.name || "",
          degreeType: advisor?.degree_type,
          recid,
        };
      })
      .filter((advisor: any) => advisor.name);
  }

  if (metadata.status) {
    profile.status = metadata.status;
  }

  return profile;
}

export function clearAuthorProfileCache() {
  authorProfileCache.clear();
}
