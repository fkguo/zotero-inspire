/**
 * Preprint Watch Service (FTR-PREPRINT-WATCH)
 *
 * Detects unpublished arXiv preprints in Zotero library and checks INSPIRE
 * for publication status. Updates metadata when preprints are published.
 *
 * Key design principles:
 * - Reuses existing functions from metadataService.ts
 * - Three-layer caching (memory -> disk -> network)
 * - Worker pattern for concurrent API calls (max 3)
 * - Incremental library scanning to avoid UI freezing
 */

import { config } from "../../../package.json";
import { getPref, setPref } from "../../utils/prefs";
import {
  INSPIRE_API_BASE,
  API_FIELDS_PREPRINT_CHECK,
  buildFieldsParam,
} from "./constants";
import { inspireFetch } from "./rateLimiter";
import { localCache } from "./localCache";
import { LRUCache } from "./utils";
import { fetchInspireMetaByRecid } from "./metadataService";
import type { jsobject } from "./types";
import type { InspireLiteratureSearchResponse } from "./apiTypes";
import type {
  PublicationInfo,
  PreprintCheckResult,
  PreprintCheckSummary,
  PreprintUpdateOptions,
  PreprintWatchCache,
  PreprintWatchEntry,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** arXiv DOI prefix for identification */
export const ARXIV_DOI_PREFIX = "10.48550/arXiv";

/** Regex to match arXiv info in journalAbbreviation field */
const ARXIV_JOURNAL_ABBREV_REGEX = /^arXiv:/i;

/** Regex to extract arXiv ID from various formats */
const ARXIV_ID_EXTRACT_REGEX = /arXiv:([\d.]+|[a-z-]+\/\d{7})/i;

/** Regex to extract arXiv ID from URL */
const ARXIV_URL_REGEX = /arxiv\.org\/abs\/([\d.]+|[a-z-]+\/\d{7})/i;

/** Regex to extract arXiv ID from arXiv DOI */
const ARXIV_DOI_REGEX = /10\.48550\/arXiv\.([\d.]+)/i;

/** Concurrent API request limit */
const CONCURRENCY = 3;

/** Batch size for library scanning (to avoid UI freezing) */
const SCAN_BATCH_SIZE = 100;

/** Unified preprint watch cache version */
const PREPRINT_WATCH_CACHE_VERSION = 1;

/** Cache file name (without extension) */
const PREPRINT_WATCH_CACHE_FILE = "preprintWatch";

// ─────────────────────────────────────────────────────────────────────────────
// Caching (Unified single-file cache)
// ─────────────────────────────────────────────────────────────────────────────

/** Memory cache: arXiv ID -> publication status (session-only) */
const publicationStatusCache = new LRUCache<string, PublicationInfo | null>(
  500,
);

/** In-memory cache of the unified preprint watch data */
let preprintWatchCacheMemory: PreprintWatchCache | null = null;

/**
 * Get cache directory path from localCache.
 */
async function getCacheDir(): Promise<string | null> {
  return localCache.getCacheDir();
}

/**
 * Get full path to the unified preprint watch cache file.
 */
async function getPreprintWatchCachePath(): Promise<string | null> {
  const cacheDir = await getCacheDir();
  if (!cacheDir) return null;
  return PathUtils.join(cacheDir, `${PREPRINT_WATCH_CACHE_FILE}.json`);
}

/**
 * Load the unified preprint watch cache from disk.
 */
async function loadPreprintWatchCache(): Promise<PreprintWatchCache | null> {
  // Return memory cache if available
  if (preprintWatchCacheMemory) {
    return preprintWatchCacheMemory;
  }

  const filePath = await getPreprintWatchCachePath();
  if (!filePath) return null;

  try {
    const exists = await IOUtils.exists(filePath);
    if (!exists) return null;

    const cached = (await IOUtils.readJSON(filePath)) as PreprintWatchCache;

    // Version check
    if (cached.version !== PREPRINT_WATCH_CACHE_VERSION) {
      Zotero.debug(
        `[${config.addonName}] Preprint watch cache version mismatch, discarding`,
      );
      await IOUtils.remove(filePath, { ignoreAbsent: true });
      return null;
    }

    preprintWatchCacheMemory = cached;
    return cached;
  } catch (e) {
    Zotero.debug(`[${config.addonName}] Failed to load preprint watch cache: ${e}`);
    return null;
  }
}

/**
 * Save the unified preprint watch cache to disk.
 */
async function savePreprintWatchCache(cache: PreprintWatchCache): Promise<void> {
  const filePath = await getPreprintWatchCachePath();
  if (!filePath) return;

  try {
    // Update memory cache
    preprintWatchCacheMemory = cache;

    await IOUtils.writeJSON(filePath, cache);
    Zotero.debug(
      `[${config.addonName}] Saved preprint watch cache (${cache.entries.length} entries)`,
    );
  } catch (e) {
    Zotero.debug(`[${config.addonName}] Failed to save preprint watch cache: ${e}`);
  }
}

/**
 * Create empty preprint watch cache.
 */
function createEmptyCache(): PreprintWatchCache {
  return {
    version: PREPRINT_WATCH_CACHE_VERSION,
    lastFullScan: 0,
    lastCheck: 0,
    entries: [],
  };
}

/**
 * Get entry from cache by arXiv ID.
 */
function getCacheEntry(
  cache: PreprintWatchCache,
  arxivId: string,
): PreprintWatchEntry | undefined {
  return cache.entries.find((e) => e.arxivId === arxivId);
}

/**
 * Update or add entry in cache.
 */
function updateCacheEntry(
  cache: PreprintWatchCache,
  entry: PreprintWatchEntry,
): void {
  const idx = cache.entries.findIndex((e) => e.arxivId === entry.arxivId);
  if (idx >= 0) {
    cache.entries[idx] = entry;
  } else {
    cache.entries.push(entry);
  }
}

/**
 * Remove published/not-found entries from cache.
 * Keep unpublished and error entries for future checks.
 */
function prunePublishedEntries(cache: PreprintWatchCache): void {
  cache.entries = cache.entries.filter((e) => e.status !== "published");
}

/**
 * Cleanup legacy per-arxivId cache files (preprint_*.json.gz).
 * Call this on startup to migrate to the new unified cache.
 */
export async function cleanupLegacyPreprintFiles(): Promise<number> {
  const cacheDir = await getCacheDir();
  if (!cacheDir) return 0;

  try {
    const children = await IOUtils.getChildren(cacheDir);
    const legacyFiles = children.filter(
      (path) =>
        path.includes("/preprint_") &&
        !path.includes("preprintWatch") &&
        !path.includes("preprintCandidates") &&
        (path.endsWith(".json") || path.endsWith(".json.gz")),
    );

    if (legacyFiles.length === 0) return 0;

    let deleted = 0;
    for (const filePath of legacyFiles) {
      try {
        await IOUtils.remove(filePath);
        deleted++;
      } catch {
        // Ignore individual file deletion errors
      }
    }

    if (deleted > 0) {
      Zotero.debug(
        `[${config.addonName}] Cleaned up ${deleted} legacy preprint cache files`,
      );
    }
    return deleted;
  } catch (e) {
    Zotero.debug(`[${config.addonName}] Failed to cleanup legacy files: ${e}`);
    return 0;
  }
}

/**
 * Also cleanup the old preprintCandidates file during migration.
 */
async function cleanupOldCandidatesFile(): Promise<void> {
  const cacheDir = await getCacheDir();
  if (!cacheDir) return;

  const oldFile = PathUtils.join(cacheDir, "preprintCandidates_global.json.gz");
  const oldFileJson = PathUtils.join(cacheDir, "preprintCandidates_global.json");

  try {
    await IOUtils.remove(oldFile, { ignoreAbsent: true });
    await IOUtils.remove(oldFileJson, { ignoreAbsent: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Fetch Zotero items by IDs in batches, respecting AbortSignal.
 */
async function getItemsInBatches(
  itemIDs: number[],
  signal?: AbortSignal,
  batchSize = 500,
): Promise<Zotero.Item[]> {
  const items: Zotero.Item[] = [];
  for (let i = 0; i < itemIDs.length; i += batchSize) {
    if (signal?.aborted) break;
    const batch = itemIDs.slice(i, i + batchSize);
    const batchItems = await Zotero.Items.getAsync(batch);
    items.push(...batchItems);
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Detection Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a DOI is an arXiv DOI.
 */
export function isArxivDoi(doi: string | null | undefined): boolean {
  return doi?.startsWith(ARXIV_DOI_PREFIX) ?? false;
}

/**
 * Check if a Zotero item is an unpublished arXiv preprint or needs metadata update.
 * Uses multiple signals: journalAbbreviation, DOI, Extra field, volume, pages.
 *
 * This plugin stores arXiv papers as journalArticle with:
 * - journalAbbreviation: "arXiv:2301.12345 [hep-ph]"
 * - DOI: may be arXiv DOI "10.48550/arXiv.2301.12345"
 *
 * A paper is considered needing update if ANY of these:
 * 1. journalAbbreviation starts with "arXiv:" (pure preprint)
 * 2. Has non-arXiv DOI but missing volume/pages (incomplete publication info)
 * 3. No journal info but has arXiv in Extra
 * 4. Only has arXiv DOI
 */
export function isUnpublishedPreprint(item: Zotero.Item): boolean {
  // Skip non-journal articles
  if (item.itemType !== "journalArticle") return false;

  const journalAbbrev = item.getField("journalAbbreviation") as string;
  const doi = item.getField("DOI") as string;
  const extra = item.getField("extra") as string;
  const volume = item.getField("volume") as string;
  const pages = item.getField("pages") as string;

  // Case 1: journalAbbreviation starts with "arXiv:"
  if (journalAbbrev && ARXIV_JOURNAL_ABBREV_REGEX.test(journalAbbrev)) {
    // Even if has journal DOI, still needs update if missing volume/pages
    if (doi && !isArxivDoi(doi)) {
      // Has journal DOI - check if publication info is complete
      if (volume && pages) {
        return false; // Fully published with complete info
      }
      // Has DOI but missing volume or pages - needs update
      return true;
    }
    return true; // Pure preprint (no journal DOI)
  }

  // Case 2: No journal info but has arXiv in Extra
  if (!journalAbbrev && extra?.includes("arXiv:")) {
    return true;
  }

  // Case 3: Only has arXiv DOI
  if (doi && isArxivDoi(doi) && !journalAbbrev) {
    return true;
  }

  return false;
}

/**
 * Extract arXiv ID from a Zotero item.
 * Priority: journalAbbreviation > Extra > URL > DOI
 */
export function extractArxivIdFromItem(item: Zotero.Item): string | null {
  // Try journalAbbreviation first (most reliable for our plugin)
  const journalAbbrev = item.getField("journalAbbreviation") as string;
  if (journalAbbrev) {
    const match = journalAbbrev.match(ARXIV_ID_EXTRACT_REGEX);
    if (match) return match[1];
  }

  // Try Extra field
  const extra = item.getField("extra") as string;
  if (extra) {
    const match = extra.match(ARXIV_ID_EXTRACT_REGEX);
    if (match) return match[1];
  }

  // Try URL
  const url = item.getField("url") as string;
  if (url?.includes("arxiv.org")) {
    const match = url.match(ARXIV_URL_REGEX);
    if (match) return match[1];
  }

  // Try DOI (arXiv DOI format: 10.48550/arXiv.2301.12345)
  const doi = item.getField("DOI") as string;
  if (doi && isArxivDoi(doi)) {
    const match = doi.match(ARXIV_DOI_REGEX);
    if (match) return match[1];
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Library Scanning (Optimized for performance)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find Zotero item by arXiv ID.
 * Returns null if not found or deleted.
 */
async function findItemByArxivId(arxivId: string): Promise<Zotero.Item | null> {
  // Search in journalAbbreviation (most common case for this plugin)
  const search = new Zotero.Search({ libraryID: Zotero.Libraries.userLibraryID });
  search.addCondition("itemType", "is", "journalArticle");
  search.addCondition("journalAbbreviation", "contains", `arXiv:${arxivId}`);
  const ids = await search.search();

  if (ids.length > 0) {
    const items = await Zotero.Items.getAsync(ids);
    for (const item of items) {
      if (!item.deleted && extractArxivIdFromItem(item) === arxivId) {
        return item;
      }
    }
  }

  return null;
}

/**
 * Scan library for all unpublished arXiv preprints.
 * Uses batched loading to avoid UI freezing.
 * Now uses unified cache with arXiv IDs for stability.
 */
export async function findUnpublishedPreprints(
  libraryID?: number,
  collectionID?: number,
  options?: {
    signal?: AbortSignal;
    onProgress?: (found: number, scanned: number) => void;
    /** Force full rescan even if cache exists */
    forceRefresh?: boolean;
    /** Disable cache usage */
    useCache?: boolean;
  },
): Promise<Zotero.Item[]> {
  const targetLibraryID = libraryID ?? Zotero.Libraries.userLibraryID;
  const preprints: Zotero.Item[] = [];
  const seen = new Set<number>();
  const useCache = options?.useCache !== false;
  const forceRefresh = options?.forceRefresh === true;

  // Collection mode: small scope, always do full scan
  if (collectionID) {
    const collection = await Zotero.Collections.getAsync(collectionID);
    if (!collection) {
      Zotero.debug(
        `[zotero-inspire] findUnpublishedPreprints: collection ${collectionID} not found`,
      );
      return [];
    }
    const allItems = collection
      .getChildItems()
      .filter((item) => item.itemType === "journalArticle");
    const total = allItems.length;

    for (let i = 0; i < total; i += SCAN_BATCH_SIZE) {
      if (options?.signal?.aborted) break;
      const batchEnd = Math.min(i + SCAN_BATCH_SIZE, total);
      const batchItems = allItems.slice(i, batchEnd);
      for (const item of batchItems) {
        if (!item.deleted && isUnpublishedPreprint(item)) {
          if (!seen.has(item.id)) {
            preprints.push(item);
            seen.add(item.id);
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      options?.onProgress?.(preprints.length, batchEnd);
    }
    return preprints;
  }

  // Library mode: try to use cached arXiv IDs for fast lookup
  let scanned = 0;
  if (useCache && !forceRefresh) {
    const cache = await loadPreprintWatchCache();
    if (cache && cache.entries.length > 0) {
      // Filter to only unpublished entries
      const unpublishedEntries = cache.entries.filter(
        (e) => e.status === "unpublished" || e.status === "error",
      );

      // Try to find items by arXiv ID (stable) or itemId (fast fallback)
      for (const entry of unpublishedEntries) {
        if (options?.signal?.aborted) break;
        scanned++;

        let item: Zotero.Item | null = null;

        // Try itemId first (fast) if available
        if (entry.itemId) {
          const items = await Zotero.Items.getAsync([entry.itemId]);
          if (items.length > 0 && !items[0].deleted) {
            // Verify arXiv ID matches
            const foundArxivId = extractArxivIdFromItem(items[0]);
            if (foundArxivId === entry.arxivId) {
              item = items[0];
            }
          }
        }

        // Fallback: search by arXiv ID
        if (!item) {
          item = await findItemByArxivId(entry.arxivId);
        }

        if (item && !item.deleted && isUnpublishedPreprint(item)) {
          if (!seen.has(item.id)) {
            preprints.push(item);
            seen.add(item.id);
          }
        }

        options?.onProgress?.(preprints.length, scanned);
      }

      // Update cache with current item IDs and return
      await updateCacheFromItems(preprints);
      return preprints;
    }
  }

  // Full library scan (first run or forced refresh)
  const search = new Zotero.Search({ libraryID: targetLibraryID });
  search.addCondition("itemType", "is", "journalArticle");
  const itemIDs = await search.search();

  for (let i = 0; i < itemIDs.length; i += SCAN_BATCH_SIZE) {
    if (options?.signal?.aborted) break;
    const batchIDs = itemIDs.slice(i, i + SCAN_BATCH_SIZE);
    const batchItems = await Zotero.Items.getAsync(batchIDs);

    for (const item of batchItems) {
      if (options?.signal?.aborted) break;
      scanned++;
      if (!item.deleted && isUnpublishedPreprint(item)) {
        if (!seen.has(item.id)) {
          preprints.push(item);
          seen.add(item.id);
        }
      }
    }

    // Yield main thread to avoid UI freezing
    await new Promise((resolve) => setTimeout(resolve, 0));
    options?.onProgress?.(preprints.length, scanned);
  }

  // Save to unified cache
  if (useCache) {
    await updateCacheFromItems(preprints);

    // Cleanup legacy files on first full scan
    await cleanupLegacyPreprintFiles();
    await cleanupOldCandidatesFile();
  }

  return preprints;
}

/**
 * Update cache entries from found preprint items.
 * Creates entries with status "unpublished" for items not yet checked.
 */
async function updateCacheFromItems(items: Zotero.Item[]): Promise<void> {
  let cache = await loadPreprintWatchCache();
  if (!cache) {
    cache = createEmptyCache();
  }

  const now = Date.now();
  const seenArxivIds = new Set<string>();

  for (const item of items) {
    const arxivId = extractArxivIdFromItem(item);
    if (!arxivId) continue;
    seenArxivIds.add(arxivId);

    const existing = getCacheEntry(cache, arxivId);
    if (existing) {
      // Update itemId if changed
      existing.itemId = item.id;
    } else {
      // New entry - not yet checked
      cache.entries.push({
        arxivId,
        itemId: item.id,
        lastChecked: 0,
        status: "unpublished",
      });
    }
  }

  // Remove entries for arXiv IDs no longer in library
  cache.entries = cache.entries.filter(
    (e) => seenArxivIds.has(e.arxivId) || e.status === "published",
  );

  cache.lastFullScan = now;
  await savePreprintWatchCache(cache);
}

// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE API Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check publication status via INSPIRE API.
 * Returns publication info if published, null if still preprint.
 */
async function checkPublicationStatus(
  arxivId: string,
  signal?: AbortSignal,
): Promise<PublicationInfo | null> {
  const url = `${INSPIRE_API_BASE}/literature?q=eprint:${encodeURIComponent(arxivId)}&${buildFieldsParam(API_FIELDS_PREPRINT_CHECK).slice(1)}`;

  const response = await inspireFetch(url, { signal });
  if (!response.ok) return null;

  const data = (await response.json()) as unknown as InspireLiteratureSearchResponse | null;
  const hits = data?.hits?.hits;
  if (!hits?.length) return null;

  const metadata = hits[0].metadata;

  // Check for journal publication info
  // Find the primary publication (first with journal_title that's not erratum)
  // Some INSPIRE records have pubinfo_freetext in [0] and structured data in [1]
  const pubInfo = metadata.publication_info;
  if (pubInfo?.length) {
    const primary = pubInfo.find(
      (p) => p.journal_title && p.material !== "erratum",
    );
    if (primary?.journal_title) {
      // Found journal publication!
      // Also check for non-arXiv DOI
      const journalDoi = extractPublishedDoi(metadata.dois);

      // Format journal title consistently (add spaces after dots)
      // This matches the formatting in metadataService.ts buildMetaFromMetadata
      const formattedJournalTitle = primary.journal_title.replace(/\.\s|\./g, ". ");

      return {
        journalTitle: formattedJournalTitle,
        volume: primary.journal_volume,
        pageStart: primary.page_start || primary.artid,
        year: primary.year,
        doi: journalDoi ?? undefined,
        recid: metadata.control_number?.toString(),
        preprintDate: metadata.preprint_date,
      };
    }
  }

  return null; // Still a preprint
}

/**
 * Extract non-arXiv DOI from INSPIRE dois array.
 */
function extractPublishedDoi(
  dois: Array<{ value: string }> | undefined,
): string | null {
  if (!dois?.length) return null;
  for (const doi of dois) {
    if (doi.value && !isArxivDoi(doi.value)) {
      return doi.value;
    }
  }
  return null;
}

/**
 * Check publication status with caching (memory + unified disk cache).
 * The unified cache stores all preprint check results in a single file.
 */
async function checkPublicationStatusCached(
  arxivId: string,
  signal?: AbortSignal,
  forceRefresh = false,
): Promise<PublicationInfo | null> {
  // 1. Memory cache (fastest)
  if (!forceRefresh && publicationStatusCache.has(arxivId)) {
    return publicationStatusCache.get(arxivId) ?? null;
  }

  // 2. Unified disk cache
  if (!forceRefresh) {
    const cache = await loadPreprintWatchCache();
    if (cache) {
      const entry = getCacheEntry(cache, arxivId);
      if (entry && entry.lastChecked > 0) {
        // Check if cache is still fresh (24 hours)
        const ageHours = (Date.now() - entry.lastChecked) / (60 * 60 * 1000);
        if (ageHours < 24) {
          const result = entry.publicationInfo ?? null;
          publicationStatusCache.set(arxivId, result);
          return result;
        }
      }
    }
  }

  // 3. Network request
  const result = await checkPublicationStatus(arxivId, signal);

  // Update memory cache
  publicationStatusCache.set(arxivId, result);

  // Note: Disk cache is updated in batch by batchCheckPublicationStatus
  // to avoid frequent writes during batch operations

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Check Functions (Worker Pattern)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Batch check publication status for multiple items using worker pattern.
 * Fixed concurrency to avoid API overload.
 * Updates the unified cache after all checks complete.
 */
export async function batchCheckPublicationStatus(
  items: Zotero.Item[],
  options?: {
    signal?: AbortSignal;
    onProgress?: (current: number, total: number, found: number) => void;
    forceRefresh?: boolean;
  },
): Promise<PreprintCheckResult[]> {
  const results: PreprintCheckResult[] = new Array(items.length);
  let index = 0;
  let foundCount = 0;
  const total = items.length;

  const worker = async () => {
    while (index < items.length && !options?.signal?.aborted) {
      const currentIndex = index++;
      const item = items[currentIndex];

      const arxivId = extractArxivIdFromItem(item);
      if (!arxivId) {
        results[currentIndex] = {
          itemID: item.id,
          arxivId: "",
          title: item.getField("title") as string,
          status: "error",
          error: "Could not extract arXiv ID",
        };
        continue;
      }

      try {
        const pubInfo = await checkPublicationStatusCached(
          arxivId,
          options?.signal,
          options?.forceRefresh,
        );

        const isPublished = pubInfo !== null;
        if (isPublished) foundCount++;

        results[currentIndex] = {
          itemID: item.id,
          arxivId,
          title: item.getField("title") as string,
          status: isPublished ? "published" : "unpublished",
          publicationInfo: pubInfo ?? undefined,
        };
      } catch (error: any) {
        if (error.name === "AbortError") throw error;
        results[currentIndex] = {
          itemID: item.id,
          arxivId,
          title: item.getField("title") as string,
          status: "error",
          error: error.message || "Unknown error",
        };
      }

      options?.onProgress?.(index, total, foundCount);
    }
  };

  // Start worker pool
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const filteredResults = results.filter(Boolean);

  // Update unified cache with all results
  await updateCacheFromResults(filteredResults);

  return filteredResults;
}

/**
 * Update unified cache from batch check results.
 */
async function updateCacheFromResults(
  results: PreprintCheckResult[],
): Promise<void> {
  if (!results.length) return;

  let cache = await loadPreprintWatchCache();
  if (!cache) {
    cache = createEmptyCache();
  }

  const now = Date.now();

  for (const result of results) {
    if (!result.arxivId) continue;

    const entry: PreprintWatchEntry = {
      arxivId: result.arxivId,
      itemId: result.itemID,
      lastChecked: now,
      status: result.status === "published" ? "published" :
              result.status === "error" ? "error" : "unpublished",
      publicationInfo: result.publicationInfo,
    };

    updateCacheEntry(cache, entry);
  }

  cache.lastCheck = now;
  await savePreprintWatchCache(cache);
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a single preprint item with publication info from INSPIRE.
 *
 * FTR-REFACTOR: Now uses full metadata fetch when recid is available,
 * ensuring consistency with right-click update and smart update modes.
 * This provides complete field updates including:
 * - Title, creators, abstract
 * - Page ranges (start-end), issue, erratum notes
 * - Citation counts, citation key
 * - Collaboration tags
 *
 * Preserves arXiv info in Extra field.
 */
export async function updatePreprintWithPublicationInfo(
  item: Zotero.Item,
  pubInfo: PublicationInfo,
  options?: PreprintUpdateOptions,
): Promise<void> {
  const opts: Required<PreprintUpdateOptions> = {
    updateDoi: true,
    updateJournal: true,
    updateVolume: true,
    updatePages: true,
    updateDate: true,
    preserveArxivInExtra: true,
    ...options,
  };

  // Preserve arXiv info before any updates
  const currentJournalAbbrev = item.getField("journalAbbreviation") as string;
  const currentDoi = item.getField("DOI") as string;
  let extra = item.getField("extra") as string;

  // Preserve arXiv info in Extra if needed
  if (opts.preserveArxivInExtra) {
    // Add arXiv ID if not already present
    if (
      currentJournalAbbrev?.startsWith("arXiv:") &&
      !extra.includes("arXiv:")
    ) {
      const arxivLine = currentJournalAbbrev.split(" ")[0]; // e.g., "arXiv:2301.12345"
      extra = extra ? `${extra}\n${arxivLine}` : arxivLine;
    }

    // Add old arXiv DOI as note if being replaced
    if (
      currentDoi &&
      isArxivDoi(currentDoi) &&
      pubInfo.doi &&
      !extra.includes(currentDoi)
    ) {
      extra = extra
        ? `${extra}\nOriginal arXiv DOI: ${currentDoi}`
        : `Original arXiv DOI: ${currentDoi}`;
    }

    if (extra !== (item.getField("extra") as string)) {
      item.setField("extra", extra);
    }
  }

  // FTR-REFACTOR: If recid is available, fetch full metadata and do complete update
  // This ensures consistency with setInspireMeta() used by right-click and smart update
  if (pubInfo.recid) {
    const fullMeta = await fetchInspireMetaByRecid(pubInfo.recid, undefined, "full");
    if (fullMeta !== -1 && typeof fullMeta === "object") {
      await updatePreprintWithFullMetadata(item, fullMeta as jsobject, opts);
      return;
    }
    // If full metadata fetch failed, fall through to minimal update
    Zotero.debug(
      `[${config.addonName}] Full metadata fetch failed for recid ${pubInfo.recid}, using minimal update`,
    );
  }

  // Fallback: Minimal update using only PublicationInfo fields
  // This path is used when recid is not available or full fetch failed
  await updatePreprintMinimal(item, pubInfo, opts);
}

/**
 * Full metadata update for preprint-to-published conversion.
 * Reuses the same logic as setInspireMeta() for consistency.
 */
async function updatePreprintWithFullMetadata(
  item: Zotero.Item,
  meta: jsobject,
  opts: Required<PreprintUpdateOptions>,
): Promise<void> {
  const publication = item.getField("publicationTitle") as string;

  // Ensure item type is normalized to journalArticle for published papers
  if (item.itemType !== "journalArticle") {
    if (meta.document_type?.[0] === "book") {
      item.setType(Zotero.ItemTypes.getID("book") as number);
    } else {
      item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
    }
  }

  // Set archive info
  item.setField("archive", "INSPIRE");
  item.setField("archiveLocation", meta.recid);

  // Journal / Publication info
  if (opts.updateJournal && meta.journalAbbreviation) {
    if (item.itemType === "journalArticle") {
      item.setField("journalAbbreviation", meta.journalAbbreviation);
      // Also update publicationTitle for better display
      if (
        !publication ||
        publication.startsWith("arXiv:") ||
        publication.toLowerCase().includes("arxiv")
      ) {
        item.setField("publicationTitle", meta.journalAbbreviation);
      }
    } else if (meta.document_type?.[0] === "book" && item.itemType === "book") {
      item.setField("series", meta.journalAbbreviation);
    } else {
      item.setField("publicationTitle", meta.journalAbbreviation);
    }
  }

  // Volume
  if (opts.updateVolume && meta.volume) {
    if (meta.document_type?.[0] === "book") {
      item.setField("seriesNumber", meta.volume);
    } else {
      item.setField("volume", meta.volume);
    }
  }

  // Pages (with full range support, unlike minimal update)
  if (opts.updatePages && meta.pages && meta.document_type?.[0] !== "book") {
    item.setField("pages", meta.pages);
  }

  // Date
  if (opts.updateDate && meta.date) {
    item.setField("date", meta.date);
  }

  // Issue (not available in minimal update)
  if (meta.issue) {
    item.setField("issue", meta.issue);
  }

  // DOI
  if (opts.updateDoi && meta.DOI) {
    if (item.itemType === "journalArticle" || item.itemType === "preprint") {
      item.setField("DOI", meta.DOI);
    }
  }

  // ISBN (only if empty)
  if (meta.isbns && !item.getField("ISBN")) {
    item.setField("ISBN", meta.isbns);
  }

  // Publisher (only if empty)
  if (
    meta.publisher &&
    !item.getField("publisher") &&
    (item.itemType === "book" || item.itemType === "bookSection")
  ) {
    item.setField("publisher", meta.publisher);
  }

  // Title (update if INSPIRE has a different/better title)
  if (meta.title) {
    const currentTitle = item.getField("title") as string;
    // Only update if title is meaningfully different
    if (!currentTitle || currentTitle.trim() !== meta.title.trim()) {
      item.setField("title", meta.title);
    }
  }

  // Creators
  if (meta.creators) {
    item.setCreators(meta.creators);
  }

  // Abstract
  if (meta.abstractNote) {
    item.setField("abstractNote", meta.abstractNote);
  }

  // Extra field updates
  let extra = item.getField("extra") as string;

  // arXiv info
  if (meta.arxiv) {
    const arxivId = meta.arxiv.value;
    let arXivInfo = "";
    if (/^\d/.test(arxivId)) {
      const arxivPrimaryCategory = meta.arxiv.categories?.[0];
      arXivInfo = arxivPrimaryCategory
        ? `arXiv:${arxivId} [${arxivPrimaryCategory}]`
        : `arXiv:${arxivId}`;
    } else {
      arXivInfo = "arXiv:" + arxivId;
    }
    const numberOfArxiv = (extra.match(/^.*(arXiv:|_eprint:).*$(\n|)/gim) || "").length;
    if (numberOfArxiv !== 1) {
      extra = extra.replace(/^.*(arXiv:|_eprint:).*$(\n|)/gim, "");
      if (extra.endsWith("\n")) {
        extra += arXivInfo;
      } else {
        extra += "\n" + arXivInfo;
      }
    } else {
      extra = extra.replace(/^.*(arXiv:|_eprint:).*$/gim, arXivInfo);
    }

    // Set URL if empty
    const url = item.getField("url");
    if (meta.urlArxiv && !url) {
      item.setField("url", meta.urlArxiv);
    }
  }

  extra = extra.replace(/^.*type: article.*$\n/gm, "");

  // Collaboration
  if (meta.collaborations && !extra.includes("tex.collaboration")) {
    extra = extra + "\n" + "tex.collaboration: " + meta.collaborations.join(", ");
  }

  // Citations
  if (meta.citation_count !== undefined) {
    extra = setCitationsInExtra(
      extra,
      meta.citation_count,
      meta.citation_count_wo_self_citations,
    );
  }

  // Citation key
  const citekey_pref = getPref("citekey");
  if (citekey_pref === "inspire" && meta.citekey) {
    if (extra.includes("Citation Key")) {
      const initialCiteKey = (extra.match(/^.*Citation\sKey:.*$/gm) || "")[0]?.split(": ")[1];
      if (initialCiteKey !== meta.citekey) {
        extra = extra.replace(/^.*Citation\sKey.*$/gm, `Citation Key: ${meta.citekey}`);
      }
    } else {
      extra += "\nCitation Key: " + meta.citekey;
    }
  }

  extra = extra.replace(/\n\n/gm, "\n");
  extra = reorderExtraFieldsPreprint(extra);
  item.setField("extra", extra);

  // arXiv category tag
  setArxivCategoryTagPreprint(item, extra);

  await item.saveTx();
}

/**
 * Minimal update using only PublicationInfo fields.
 * Used as fallback when full metadata is not available.
 */
async function updatePreprintMinimal(
  item: Zotero.Item,
  pubInfo: PublicationInfo,
  opts: Required<PreprintUpdateOptions>,
): Promise<void> {
  // Ensure item type is normalized to journalArticle for published papers
  if (item.itemType !== "journalArticle") {
    item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
  }

  // Update DOI (replace arXiv DOI with journal DOI)
  if (opts.updateDoi && pubInfo.doi) {
    item.setField("DOI", pubInfo.doi);
  }

  // Update journal abbreviation and publicationTitle
  if (opts.updateJournal && pubInfo.journalTitle) {
    item.setField("journalAbbreviation", pubInfo.journalTitle);
    const currentPubTitle = item.getField("publicationTitle") as string;
    if (
      !currentPubTitle ||
      currentPubTitle.startsWith("arXiv:") ||
      currentPubTitle.toLowerCase().includes("arxiv")
    ) {
      item.setField("publicationTitle", pubInfo.journalTitle);
    }
  }

  // Update volume
  if (opts.updateVolume && pubInfo.volume) {
    item.setField("volume", pubInfo.volume);
  }

  // Update pages
  if (opts.updatePages && pubInfo.pageStart) {
    item.setField("pages", pubInfo.pageStart);
  }

  // Update date to publication year
  if (opts.updateDate && pubInfo.year) {
    item.setField("date", String(pubInfo.year));
  }

  await item.saveTx();
}

/**
 * Set citation counts in Extra field.
 * Duplicated from itemUpdater.ts to avoid circular dependency.
 */
function setCitationsInExtra(
  extra: string,
  citation_count: number,
  citation_count_wo_self_citations?: number,
): string {
  const today = new Date(Date.now()).toLocaleDateString("zh-CN");

  // Check if citations are unchanged
  const topLinesMatch = extra.match(
    /^(\d+)\scitations\s\(INSPIRE\s[\d/-]+\)\n(\d+)\scitations\sw\/o\sself\s\(INSPIRE\s[\d/-]+\)\n/,
  );
  if (topLinesMatch) {
    const topCitation = Number(topLinesMatch[1]);
    const topCitationWoSelf = Number(topLinesMatch[2]);
    if (
      citation_count === topCitation &&
      citation_count_wo_self_citations === topCitationWoSelf
    ) {
      return extra;
    }
  }

  // Get existing citation values
  const temp = extra.match(/^\d+\scitations/gm);
  let existingCitations: number[] = [0, 0];
  if (temp !== null && temp.length >= 2) {
    existingCitations = temp.map((e: any) => Number(e.replace(" citations", "")));
  }

  const dateMatch = extra.match(/INSPIRE\s([\d/-]+)/);
  const existingDate = dateMatch ? dateMatch[1] : today;

  extra = extra.replace(/^.*citations.*$\n?/gm, "");
  extra = extra.replace(/^\n+/, "");

  const woSelf = citation_count_wo_self_citations ?? 0;

  if (
    citation_count === existingCitations[0] &&
    woSelf === existingCitations[1]
  ) {
    extra =
      `${citation_count} citations (INSPIRE ${existingDate})\n` +
      `${woSelf} citations w/o self (INSPIRE ${existingDate})\n` +
      extra;
  } else {
    extra =
      `${citation_count} citations (INSPIRE ${today})\n` +
      `${woSelf} citations w/o self (INSPIRE ${today})\n` +
      extra;
  }

  return extra;
}

/**
 * Reorder Extra fields for consistency.
 * Duplicated from itemUpdater.ts to avoid circular dependency.
 */
function reorderExtraFieldsPreprint(extra: string): string {
  const order_pref = getPref("extra_order");

  if (order_pref === "citations_first") {
    return extra;
  }

  const citationLines: string[] = [];
  const arxivLines: string[] = [];
  const otherLines: string[] = [];

  const lines = extra.split("\n");
  for (const line of lines) {
    if (line.match(/^\d+\scitations/)) {
      citationLines.push(line);
    } else if (line.match(/^(arXiv:|_eprint:)/i)) {
      arxivLines.push(line);
    } else if (line.trim() !== "") {
      otherLines.push(line);
    }
  }

  const reordered = [...arxivLines, ...otherLines, ...citationLines];
  return reordered.join("\n");
}

/**
 * Set arXiv category tag based on Extra field content.
 * Duplicated from itemUpdater.ts to avoid circular dependency.
 */
function setArxivCategoryTagPreprint(item: Zotero.Item, extra: string): void {
  const arxiv_tag_pref = getPref("arxiv_tag_enable");
  if (!arxiv_tag_pref) {
    return;
  }

  let primaryCategory = "";

  const newFormatMatch = extra.match(/arXiv:\d{4}\.\d{4,5}\s*\[([^\]]+)\]/i);
  if (newFormatMatch) {
    primaryCategory = newFormatMatch[1];
  } else {
    const oldFormatMatch = extra.match(/arXiv:([a-z-]+)\/\d{7}/i);
    if (oldFormatMatch) {
      primaryCategory = oldFormatMatch[1];
    }
  }

  if (primaryCategory) {
    if (!item.hasTag(primaryCategory)) {
      item.addTag(primaryCategory);
    }
  }
}

/**
 * Batch update multiple preprints with their publication info.
 */
export async function batchUpdatePreprints(
  results: PreprintCheckResult[],
  options?: {
    signal?: AbortSignal;
    onProgress?: (current: number, total: number) => void;
    updateOptions?: PreprintUpdateOptions;
  },
): Promise<{ success: number; failed: number }> {
  const publishedResults = results.filter(
    (r) => r.status === "published" && r.publicationInfo,
  );
  const total = publishedResults.length;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    if (options?.signal?.aborted) break;

    const result = publishedResults[i];
    try {
      const item = await Zotero.Items.getAsync(result.itemID);
      if (item && result.publicationInfo) {
        await updatePreprintWithPublicationInfo(
          item,
          result.publicationInfo,
          options?.updateOptions,
        );
        success++;
      }
    } catch (error) {
      Zotero.debug(
        `[${config.addonName}] Failed to update item ${result.itemID}: ${error}`,
      );
      failed++;
    }

    options?.onProgress?.(i + 1, total);
  }

  return { success, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build summary from check results.
 */
export function buildCheckSummary(
  results: PreprintCheckResult[],
): PreprintCheckSummary {
  return {
    total: results.length,
    published: results.filter((r) => r.status === "published").length,
    unpublished: results.filter((r) => r.status === "unpublished").length,
    errors: results.filter((r) => r.status === "error").length,
    notInInspire: results.filter((r) => r.status === "not_in_inspire").length,
    results,
  };
}

/**
 * Clear preprint status cache (memory only).
 * Unified disk cache is managed separately.
 */
export function clearPreprintCache(): void {
  publicationStatusCache.clear();
  preprintWatchCacheMemory = null;
}

/**
 * Add newly detected preprint candidates to the unified cache.
 * Used by notifier hooks to track new preprints without full-library rescans.
 */
export async function trackPreprintCandidates(
  items: Zotero.Item[],
): Promise<void> {
  if (!items?.length) return;

  const candidates = items.filter(
    (item) => item && !item.deleted && isUnpublishedPreprint(item),
  );
  if (!candidates.length) return;

  let cache = await loadPreprintWatchCache();
  if (!cache) {
    cache = createEmptyCache();
  }

  for (const item of candidates) {
    const arxivId = extractArxivIdFromItem(item);
    if (!arxivId) continue;

    const existing = getCacheEntry(cache, arxivId);
    if (!existing) {
      cache.entries.push({
        arxivId,
        itemId: item.id,
        lastChecked: 0,
        status: "unpublished",
      });
    } else {
      // Update itemId if changed
      existing.itemId = item.id;
    }
  }

  await savePreprintWatchCache(cache);
}

/**
 * Remove published entries from unified cache after batch updates.
 * Called after batchUpdatePreprints to clean up successfully updated items.
 */
export async function removePreprintFromCache(arxivId: string): Promise<void> {
  const cache = await loadPreprintWatchCache();
  if (!cache) return;

  cache.entries = cache.entries.filter((e) => e.arxivId !== arxivId);
  await savePreprintWatchCache(cache);
}

// ─────────────────────────────────────────────────────────────────────────────
// Background Check Support
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if background preprint check should run based on last check time.
 */
export function shouldRunBackgroundCheck(): boolean {
  // Cast to any to handle type generation timing - these prefs are defined in prefs.js
  const autoCheckMode = getPref("preprint_watch_auto_check" as any) as string;
  if (autoCheckMode === "never") return false;

  const lastCheck = getPref("preprint_watch_last_check" as any) as number;
  const now = Date.now();

  if (autoCheckMode === "daily") {
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (now - lastCheck < oneDayMs) {
      Zotero.debug(
        `[${config.addonName}] Skipping daily preprint check (already checked today)`,
      );
      return false;
    }
  }

  return true;
}

/**
 * Update last check timestamp.
 */
export function updateLastCheckTime(): void {
  // Cast to any to handle type generation timing
  setPref("preprint_watch_last_check" as any, Date.now());
}

// Re-export types for convenience
export type {
  PublicationInfo,
  PreprintCheckResult,
  PreprintCheckSummary,
  PreprintUpdateOptions,
  PreprintWatchCache,
  PreprintWatchEntry,
} from "./types";
