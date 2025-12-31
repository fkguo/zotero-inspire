// ─────────────────────────────────────────────────────────────────────────────
// Local Cache Service - Persistent storage for INSPIRE data
// Uses IOUtils and PathUtils (Firefox 115 / Zotero 7)
// Supports gzip compression via pako library
// ─────────────────────────────────────────────────────────────────────────────

import * as pako from "pako";
import { config } from "../../../package.json";
import { getPref } from "../../utils/prefs";
import type {
  InspireReferenceEntry,
  LocalCacheFile,
  LocalCacheType,
} from "./types";

// Toggle verbose performance logging for local cache (default off)
const DEBUG_LOCAL_CACHE = false;

// Cache directory name under Zotero data directory
const CACHE_DIR_NAME = "zoteroinspire-cache";

// Default TTL values (in hours)
const DEFAULT_TTL_REFS = -1; // Permanent (references don't change)
const DEFAULT_TTL_CITED = 24; // 24 hours for cited-by and author papers
const DEFAULT_TTL_AUTHOR_PROFILE = 2; // 2 hours for author profiles (with offline fallback)

// Cache version for format migrations
// v2: Added DOI field to reference entries for journal links
const CACHE_VERSION = 2;

// Write queue delay (ms) - debounce rapid writes
const WRITE_DEBOUNCE_MS = 500;

// Compression settings
const COMPRESSED_EXT = ".json.gz"; // Extension for gzip compressed files

// ─────────────────────────────────────────────────────────────────────────────
// Compression utilities using pako library (gzip)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compress string data to gzip format using pako.
 * @param data - UTF-8 string to compress
 * @returns Compressed data as Uint8Array
 */
function compressData(data: string): Uint8Array {
  return pako.gzip(data);
}

/**
 * Decompress gzip data to string using pako.
 * @param data - Gzip compressed data as Uint8Array
 * @returns Decompressed UTF-8 string
 */
function decompressData(data: Uint8Array): string {
  return pako.ungzip(data, { to: "string" });
}

/**
 * Local cache service for persistent storage of INSPIRE data.
 * Uses IOUtils.readJSON/writeJSON for efficient JSON file operations.
 *
 * Features:
 * - Debounced writes to reduce disk I/O
 * - Custom directory support
 * - Automatic corruption cleanup
 * - TTL-based expiration
 */
class InspireLocalCache {
  private cacheDir: string | null = null;
  private initPromise: Promise<void> | null = null;
  // Write queue: Map<filePath, {timer, data}>
  private writeQueue = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; data: any }
  >();

  /**
   * Initialize the cache directory (creates if missing).
   * Safe to call multiple times - only initializes once.
   */
  async init(): Promise<void> {
    if (this.cacheDir) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    await this.initPromise;
  }

  /**
   * Reinitialize the cache directory (e.g., after changing custom directory).
   * Clears the current directory reference and re-initializes.
   */
  async reinit(): Promise<void> {
    // Flush any pending writes first
    await this.flushWrites();
    this.cacheDir = null;
    this.initPromise = null;
    await this.init();
  }

  /**
   * Get the current cache directory path.
   * Returns the actual path being used (custom or default).
   */
  async getCacheDir(): Promise<string | null> {
    await this.init();
    return this.cacheDir;
  }

  private async _doInit(): Promise<void> {
    try {
      // Check for custom directory in preferences
      const customDir = getPref("local_cache_custom_dir") as string;

      if (customDir && customDir.trim()) {
        // Use custom directory
        this.cacheDir = customDir.trim();
        Zotero.debug(
          `[${config.addonName}] Using custom cache directory: ${this.cacheDir}`,
        );

        // Validate custom directory (check if writable)
        try {
          const exists = await IOUtils.exists(this.cacheDir);
          if (!exists) {
            await IOUtils.makeDirectory(this.cacheDir, {
              ignoreExisting: true,
            });
          }
          // Test write permission by creating a temp file
          const testFile = PathUtils.join(
            this.cacheDir,
            ".zotero-inspire-test",
          );
          await IOUtils.writeUTF8(testFile, "test");
          await IOUtils.remove(testFile, { ignoreAbsent: true });
          Zotero.debug(
            `[${config.addonName}] Custom directory validated: ${this.cacheDir}`,
          );
        } catch (e) {
          Zotero.debug(
            `[${config.addonName}] Custom directory not writable, falling back to default: ${e}`,
          );
          // Fallback to default
          const dataDir = Zotero.DataDirectory.dir;
          this.cacheDir = PathUtils.join(dataDir, CACHE_DIR_NAME);
        }
      } else {
        // Use default: Zotero Data Directory / zoteroinspire-cache
        const dataDir = Zotero.DataDirectory.dir;
        this.cacheDir = PathUtils.join(dataDir, CACHE_DIR_NAME);
      }

      // Create directory if missing
      const exists = await IOUtils.exists(this.cacheDir);
      if (!exists) {
        await IOUtils.makeDirectory(this.cacheDir, { ignoreExisting: true });
        Zotero.debug(
          `[${config.addonName}] Created cache directory: ${this.cacheDir}`,
        );
      }
    } catch (e) {
      Zotero.debug(
        `[${config.addonName}] Failed to init cache directory: ${e}`,
      );
      this.cacheDir = null;
    }
  }

  /**
   * Check if local cache is enabled in preferences.
   */
  isEnabled(): boolean {
    return getPref("local_cache_enable") === true;
  }

  /**
   * Get configured TTL for cited-by/author data (in hours).
   */
  getTTLHours(): number {
    const ttl = getPref("local_cache_ttl_hours");
    return typeof ttl === "number" && ttl > 0 ? ttl : DEFAULT_TTL_CITED;
  }

  /**
   * Check if compression is enabled in preferences.
   */
  isCompressionEnabled(): boolean {
    return getPref("local_cache_compression") !== false; // Default true
  }

  /**
   * Build cache file path for given type and key.
   * @param compressed - If true, returns path with .json.gz extension
   */
  private getFilePath(
    type: LocalCacheType,
    key: string,
    sort?: string,
    compressed = false,
  ): string | null {
    if (!this.cacheDir) return null;

    // Defensive: ensure key is a string (INSPIRE API may return recid as number)
    const keyStr = String(key);

    // Sanitize key for filename safety
    const safeKey = keyStr.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeSuffix = sort
      ? `_${String(sort).replace(/[^a-zA-Z0-9]/g, "")}`
      : "";
    const ext = compressed ? COMPRESSED_EXT : ".json";

    return PathUtils.join(
      this.cacheDir,
      `${type}_${safeKey}${safeSuffix}${ext}`,
    );
  }

  /**
   * Helper to check if a file path is a cache file (json or json.gz).
   */
  private isCacheFile(filePath: string): boolean {
    return filePath.endsWith(".json") || filePath.endsWith(COMPRESSED_EXT);
  }

  /**
   * Validate cache data and return result if valid.
   * Performs structural checks including random sampling for data integrity.
   * @param ignoreTTL - If true, skip TTL check (for offline fallback)
   * @returns Cache result or null if invalid/expired
   */
  private validateCache<T>(
    cached: LocalCacheFile<T>,
    filePath: string,
    ignoreTTL = false,
  ): {
    data: T;
    fromCache: true;
    ageHours: number;
    total?: number;
    expired?: boolean;
  } | null {
    // Version check
    if (cached.v !== CACHE_VERSION) {
      Zotero.debug(`[${config.addonName}] Cache version mismatch: ${filePath}`);
      return null;
    }

    // Complete flag check - reject incomplete or old-format caches
    if (cached.c !== true) {
      Zotero.debug(`[${config.addonName}] Cache incomplete: ${filePath}`);
      IOUtils.remove(filePath, { ignoreAbsent: true }).catch(() => {});
      return null;
    }

    // Data integrity check: verify array structure and sample entries have titles
    // This catches corrupted data that may have passed the complete flag check
    if (!this.validateDataIntegrity(cached.d, filePath)) {
      IOUtils.remove(filePath, { ignoreAbsent: true }).catch(() => {});
      return null;
    }

    const ageMs = Date.now() - cached.ts;
    const ageHours = Math.round(ageMs / (60 * 60 * 1000));

    // TTL check
    if (cached.ttl > 0) {
      const ttlMs = cached.ttl * 60 * 60 * 1000;
      if (ageMs > ttlMs) {
        if (ignoreTTL) {
          // Return expired cache data with expired flag for offline fallback
          Zotero.debug(
            `[${config.addonName}] Cache expired (${ageHours}h) but returning for offline fallback: ${filePath}`,
          );
          return {
            data: cached.d,
            fromCache: true,
            ageHours,
            total: cached.n,
            expired: true,
          };
        }
        Zotero.debug(
          `[${config.addonName}] Cache expired (${ageHours}h): ${filePath}`,
        );
        return null;
      }
    }

    return { data: cached.d, fromCache: true, ageHours, total: cached.n };
  }

  /**
   * Validate data integrity by checking structure and sampling entries.
   * For array data (references/cited-by), randomly samples entries that have recid
   * to verify they have expected fields (title, authors).
   *
   * IMPORTANT: Only entries with recid are checked for completeness, because:
   * - Entries without recid cannot be enriched from INSPIRE (they don't exist in the database)
   * - For such entries, "Title unavailable" / empty authors is expected, not corruption
   *
   * @returns true if data appears valid, false otherwise
   */
  private validateDataIntegrity<T>(data: T, filePath: string): boolean {
    const validateStart = performance.now();
    const validateLog = (msg: string) => {
      if (DEBUG_LOCAL_CACHE) {
        Zotero.debug(
          `[${config.addonName}] [PERF] validateDataIntegrity: ${msg} (+${(performance.now() - validateStart).toFixed(1)}ms)`,
        );
      }
    };

    // Only validate array data (references, cited-by, author papers)
    if (!Array.isArray(data)) {
      return true; // Non-array data passes (future-proofing)
    }

    const entries = data as unknown[];
    validateLog(`start (${entries.length} entries)`);

    // Empty array is valid (no references)
    if (entries.length === 0) {
      return true;
    }

    // Basic structure check: all entries must be objects with required base fields
    for (let i = 0; i < Math.min(3, entries.length); i++) {
      const entry = entries[i] as Record<string, unknown>;
      if (!entry || typeof entry !== "object") {
        Zotero.debug(
          `[${config.addonName}] Cache invalid: entry[${i}] is not an object: ${filePath}`,
        );
        return false;
      }
      // Must have authors array (even if empty)
      if (!Array.isArray(entry.authors)) {
        Zotero.debug(
          `[${config.addonName}] Cache invalid: entry[${i}] missing authors array: ${filePath}`,
        );
        return false;
      }
      // Must have title string (even if "Title unavailable")
      if (typeof entry.title !== "string") {
        Zotero.debug(
          `[${config.addonName}] Cache invalid: entry[${i}] missing title string: ${filePath}`,
        );
        return false;
      }
    }
    validateLog("basic structure check done");

    // For entries WITH recid, check if they have been enriched properly
    // Only these entries can be enriched from INSPIRE, so only these should have complete data
    // PERF: Use sampling instead of filtering all entries to avoid O(n) operation
    validateLog("checking recid entries (sampling)...");

    // Find first, last, and a random middle entry with recid using early termination
    let firstWithRecid: Record<string, unknown> | null = null;
    let lastWithRecid: Record<string, unknown> | null = null;
    let middleWithRecid: Record<string, unknown> | null = null;
    const middleIdx = Math.floor(entries.length / 2);

    for (let i = 0; i < entries.length && !firstWithRecid; i++) {
      const e = entries[i] as Record<string, unknown>;
      if (e.recid) firstWithRecid = e;
    }
    for (let i = entries.length - 1; i >= 0 && !lastWithRecid; i--) {
      const e = entries[i] as Record<string, unknown>;
      if (e.recid) lastWithRecid = e;
    }
    // Check middle region
    for (
      let i = middleIdx;
      i < Math.min(middleIdx + 100, entries.length) && !middleWithRecid;
      i++
    ) {
      const e = entries[i] as Record<string, unknown>;
      if (e.recid) middleWithRecid = e;
    }

    const sampled = [firstWithRecid, middleWithRecid, lastWithRecid].filter(
      Boolean,
    ) as Record<string, unknown>[];
    validateLog(`found ${sampled.length} sampled entries with recid`);

    if (sampled.length === 0) {
      // No entries have recid - this is valid (some papers have no INSPIRE-linked references)
      validateLog("no entries with recid, returning true");
      return true;
    }

    // Check sampled entries with recid for enriched fields
    for (const entry of sampled) {
      // Entries with recid should have been enriched with title
      // "Title unavailable" or empty title indicates incomplete enrichment
      const noTitleIndicators = ["Title unavailable", "title unavailable", ""];
      if (noTitleIndicators.includes((entry.title as string).trim())) {
        Zotero.debug(
          `[${config.addonName}] Cache incomplete: entry with recid=${entry.recid} has unenriched title: ${filePath}`,
        );
        return false;
      }

      // Entries with recid should have authors (unless it's a collaboration without individual authors)
      const authors = entry.authors as unknown[];
      const unknownAuthorIndicators = ["Unknown author", "unknown author"];
      if (
        authors.length === 0 ||
        (authors.length === 1 &&
          unknownAuthorIndicators.includes(authors[0] as string))
      ) {
        Zotero.debug(
          `[${config.addonName}] Cache incomplete: entry with recid=${entry.recid} has unenriched authors: ${filePath}`,
        );
        return false;
      }
    }

    validateLog("validation complete, returning true");
    return true;
  }

  /**
   * Read cached data from local storage.
   * Returns null if cache miss, expired, or disabled.
   * Returns data with ageHours and total to avoid re-reading the file.
   *
   * Tries compressed file first (.json.gz), then falls back to uncompressed (.json).
   *
   * @param type - Cache type (refs, cited, author)
   * @param key - Cache key (usually recid or author BAI)
   * @param sort - Optional sort parameter
   * @param options - Optional settings
   * @param options.ignoreTTL - If true, return expired cache data (for offline fallback)
   * @returns Object with:
   *   - data: The cached data
   *   - fromCache: Always true (for type discrimination)
   *   - ageHours: Age of cache in hours
   *   - total: Total count from API (if available). Used for smart caching:
   *     - If total <= data.length, data is complete and can be sorted client-side
   *     - If total > data.length or undefined, data may be truncated
   *   - expired: True if cache TTL has expired (only when ignoreTTL=true)
   */
  async get<T = InspireReferenceEntry[]>(
    type: LocalCacheType,
    key: string,
    sort?: string,
    options?: { ignoreTTL?: boolean },
  ): Promise<{
    data: T;
    fromCache: true;
    ageHours: number;
    total?: number;
    expired?: boolean;
    } | null> {
    const getStart = performance.now();
    const getLog = (msg: string) => {
      if (DEBUG_LOCAL_CACHE) {
        Zotero.debug(
          `[${config.addonName}] [PERF] localCache.get: ${msg} (+${(performance.now() - getStart).toFixed(1)}ms)`,
        );
      }
    };
    getLog(`start (${type}/${key})`);

    if (!this.isEnabled()) {
      getLog("disabled, returning null");
      return null;
    }

    await this.init();
    getLog("init done");

    const compressedPath = this.getFilePath(type, key, sort, true);
    const jsonPath = this.getFilePath(type, key, sort, false);
    if (!compressedPath || !jsonPath) return null;

    // Try paths in order: compressed first (preferred), then uncompressed
    const pathsToTry: Array<{ path: string; isCompressed: boolean }> = [
      { path: compressedPath, isCompressed: true },
      { path: jsonPath, isCompressed: false },
    ];

    for (const { path, isCompressed } of pathsToTry) {
      try {
        const exists = await IOUtils.exists(path);
        if (!exists) continue;
        getLog(`file exists (${isCompressed ? "gzip" : "json"}), reading...`);

        const cached = await this.readCacheFile<T>(path);
        getLog(
          `readCacheFile done (${cached ? (cached.d as any)?.length + " entries" : "null"})`,
        );
        if (!cached) {
          // File corrupted, delete it
          await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => {});
          continue;
        }

        getLog("validating cache...");
        const ignoreTTL = options?.ignoreTTL ?? false;
        const result = this.validateCache(cached, path, ignoreTTL);
        getLog(
          `validateCache done (${result ? (result.expired ? "valid-expired" : "valid") : "invalid"})`,
        );
        if (result) {
          const format = isCompressed ? " (gzip)" : "";
          const expiredTag = result.expired ? " [expired]" : "";
          Zotero.debug(
            `[${config.addonName}] Cache hit${format}${expiredTag}: ${type}/${key}${cached.n !== undefined ? ` (total: ${cached.n})` : ""}`,
          );
          getLog("returning result");
          return result;
        }
      } catch (e) {
        Zotero.debug(
          `[${config.addonName}] Cache read error (${isCompressed ? "gzip" : "json"}): ${e}`,
        );
        await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => {});
      }
    }

    getLog("no valid cache found");
    return null;
  }

  /**
   * Write data to local cache (debounced).
   * Async and non-blocking - errors are logged but don't affect caller.
   * Uses debouncing to reduce disk I/O when data is updated multiple times.
   *
   * Automatically compresses files when compression is enabled.
   *
   * @param total - Optional total count from API. Used for smart caching:
   *   - If total <= data.length, data is complete and can be sorted client-side
   *   - If total > data.length, data is truncated by API limits
   */
  async set<T = InspireReferenceEntry[]>(
    type: LocalCacheType,
    key: string,
    data: T,
    sort?: string,
    total?: number,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    await this.init();

    // Determine TTL based on type
    let ttl: number;
    if (type === "refs" || type === "preprintCandidates") {
      ttl = DEFAULT_TTL_REFS; // keep indefinitely for refs and candidate list
    } else if (type === "author_profile") {
      ttl = DEFAULT_TTL_AUTHOR_PROFILE; // 2 hours for author profiles (offline fallback)
    } else {
      ttl = this.getTTLHours();
    }

    const cacheData: LocalCacheFile<T> = {
      v: CACHE_VERSION,
      t: type,
      k: key,
      ts: Date.now(),
      ttl,
      d: data,
      c: true, // Mark as complete (fetch finished successfully)
      n: total, // Total count from API (for smart caching)
    };

    const compressionEnabled = this.isCompressionEnabled();
    const estimatedSize = JSON.stringify(cacheData).length;
    const shouldCompress = compressionEnabled;

    // Debug: log compression decision based on estimated size
    Zotero.debug(
      `[${config.addonName}] Cache set: ${type}/${key}, estimatedSize=${estimatedSize}, compressionEnabled=${compressionEnabled}`,
    );

    const targetPath = this.getFilePath(type, key, sort, shouldCompress);
    const altPath = this.getFilePath(type, key, sort, !shouldCompress);
    if (!targetPath || !altPath) return;

    // Cancel existing timers for both paths
    for (const path of [targetPath, altPath]) {
      const existing = this.writeQueue.get(path);
      if (existing) {
        clearTimeout(existing.timer);
        this.writeQueue.delete(path);
      }
    }

    // Schedule debounced write
    const timer = setTimeout(async () => {
      this.writeQueue.delete(targetPath);
      try {
        // Delete old format file if it exists
        await IOUtils.remove(altPath, { ignoreAbsent: true });

        const latestJsonStr = JSON.stringify(cacheData);
        const latestSize = latestJsonStr.length;
        Zotero.debug(
          `[${config.addonName}] Cache write: ${type}/${key}, latestSize=${latestSize}, compressionEnabled=${compressionEnabled}`,
        );

        if (shouldCompress) {
          const compressed = compressData(latestJsonStr);
          Zotero.debug(
            `[${config.addonName}] Compressed to ${compressed.length} bytes, writing to ${targetPath}`,
          );
          await IOUtils.write(targetPath, compressed);
          const ratio = Math.round((1 - compressed.length / latestSize) * 100);
          Zotero.debug(
            `[${config.addonName}] Cache written (gzip ${ratio}%): ${type}/${key}${total !== undefined ? ` (total: ${total})` : ""}`,
          );
        } else {
          await IOUtils.writeJSON(targetPath, cacheData);
          Zotero.debug(
            `[${config.addonName}] Cache written: ${type}/${key}${total !== undefined ? ` (total: ${total})` : ""}`,
          );
        }
      } catch (e) {
        Zotero.debug(
          `[${config.addonName}] Cache write error for ${targetPath}: ${e}`,
        );
      }
    }, WRITE_DEBOUNCE_MS);

    this.writeQueue.set(targetPath, { timer, data: cacheData });
  }

  /**
   * Flush all pending writes immediately.
   * Useful before shutdown or directory change.
   */
  async flushWrites(): Promise<void> {
    const pending = Array.from(this.writeQueue.entries());
    this.writeQueue.clear();

    const promises = pending.map(async ([filePath, { timer, data }]) => {
      clearTimeout(timer);
      try {
        const jsonStr = JSON.stringify(data);
        const isCompressed = filePath.endsWith(COMPRESSED_EXT);

        if (isCompressed) {
          const compressed = compressData(jsonStr);
          await IOUtils.write(filePath, compressed);
        } else {
          await IOUtils.writeJSON(filePath, data);
        }
        Zotero.debug(`[${config.addonName}] Cache flushed: ${filePath}`);
      } catch (e) {
        Zotero.debug(`[${config.addonName}] Cache flush error: ${e}`);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Delete specific cache entry (both compressed and uncompressed versions).
   */
  async delete(
    type: LocalCacheType,
    key: string,
    sort?: string,
  ): Promise<void> {
    await this.init();

    const compressedPath = this.getFilePath(type, key, sort, true);
    const jsonPath = this.getFilePath(type, key, sort, false);

    try {
      // Delete both formats to ensure complete cleanup
      await Promise.all([
        compressedPath
          ? IOUtils.remove(compressedPath, { ignoreAbsent: true })
          : Promise.resolve(),
        jsonPath
          ? IOUtils.remove(jsonPath, { ignoreAbsent: true })
          : Promise.resolve(),
      ]);
      Zotero.debug(`[${config.addonName}] Cache deleted: ${type}/${key}`);
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Cache delete error: ${e}`);
    }
  }

  /**
   * Clear all cache files (both .json and .json.gz).
   * Returns number of files deleted.
   */
  async clearAll(): Promise<number> {
    await this.init();
    if (!this.cacheDir) return 0;

    try {
      const exists = await IOUtils.exists(this.cacheDir);
      if (!exists) return 0;

      const children = await IOUtils.getChildren(this.cacheDir);

      // Parallel deletion - filter for both .json and .json.gz files
      const promises = children
        .filter((filePath) => this.isCacheFile(filePath))
        .map((filePath) =>
          IOUtils.remove(filePath)
            .then(() => 1)
            .catch(() => 0),
        );

      const results = await Promise.all(promises);
      const deleted = results.reduce((sum: number, count) => sum + count, 0);

      Zotero.debug(`[${config.addonName}] Cache cleared: ${deleted} files`);
      return deleted;
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Cache clear error: ${e}`);
      return 0;
    }
  }

  /**
   * Get cache statistics (includes both .json and .json.gz files).
   * Returns file counts and sizes for both formats.
   */
  async getStats(): Promise<{
    fileCount: number;
    totalSize: number;
    compressedCount: number;
    compressedSize: number;
  }> {
    await this.init();
    const emptyStats = {
      fileCount: 0,
      totalSize: 0,
      compressedCount: 0,
      compressedSize: 0,
    };
    if (!this.cacheDir) return emptyStats;

    try {
      const exists = await IOUtils.exists(this.cacheDir);
      if (!exists) return emptyStats;

      const children = await IOUtils.getChildren(this.cacheDir);

      // Parallel stats gathering - filter for both .json and .json.gz files
      const promises = children
        .filter((filePath) => this.isCacheFile(filePath))
        .map(async (filePath) => {
          try {
            const stat = await IOUtils.stat(filePath);
            const isCompressed = filePath.endsWith(COMPRESSED_EXT);
            return {
              count: 1,
              size: stat.size ?? 0,
              isCompressed,
            };
          } catch {
            return { count: 0, size: 0, isCompressed: false };
          }
        });

      const results = await Promise.all(promises);

      return results.reduce(
        (acc, curr) => ({
          fileCount: acc.fileCount + curr.count,
          totalSize: acc.totalSize + curr.size,
          compressedCount:
            acc.compressedCount + (curr.isCompressed ? curr.count : 0),
          compressedSize:
            acc.compressedSize + (curr.isCompressed ? curr.size : 0),
        }),
        emptyStats,
      );
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Cache stats error: ${e}`);
      return emptyStats;
    }
  }

  /**
   * Read and parse cache file (handles both compressed and uncompressed).
   * @returns Parsed cache data or null if failed
   */
  private async readCacheFile<T>(
    filePath: string,
  ): Promise<LocalCacheFile<T> | null> {
    try {
      if (filePath.endsWith(COMPRESSED_EXT)) {
        const compressedData = await IOUtils.read(filePath);
        Zotero.debug(
          `[${config.addonName}] Reading compressed cache: ${filePath} (${compressedData.length} bytes)`,
        );
        const jsonStr = decompressData(compressedData);
        Zotero.debug(
          `[${config.addonName}] Decompressed cache: ${jsonStr.length} chars`,
        );
        return JSON.parse(jsonStr) as LocalCacheFile<T>;
      } else {
        return (await IOUtils.readJSON(filePath)) as LocalCacheFile<T>;
      }
    } catch (e) {
      Zotero.debug(
        `[${config.addonName}] readCacheFile error for ${filePath}: ${e}`,
      );
      return null;
    }
  }

  /**
   * Purge expired cache files (both .json and .json.gz).
   * Returns number of files deleted.
   */
  async purgeExpired(): Promise<number> {
    if (!this.isEnabled()) return 0;
    await this.init();
    if (!this.cacheDir) return 0;

    try {
      const exists = await IOUtils.exists(this.cacheDir);
      if (!exists) return 0;

      const children = await IOUtils.getChildren(this.cacheDir);

      const promises = children
        .filter((filePath) => this.isCacheFile(filePath))
        .map(async (filePath) => {
          try {
            const cached = await this.readCacheFile(filePath);

            if (!cached) {
              // File is corrupted or unreadable, delete it
              await IOUtils.remove(filePath);
              return 1;
            }

            // Check TTL
            if (cached.ttl > 0) {
              const ttlMs = cached.ttl * 60 * 60 * 1000;
              const age = Date.now() - cached.ts;
              if (age > ttlMs) {
                await IOUtils.remove(filePath);
                return 1;
              }
            }
            return 0;
          } catch {
            // If file is corrupted or unreadable, try to delete it
            try {
              await IOUtils.remove(filePath);
              return 1;
            } catch {
              return 0;
            }
          }
        });

      const results = await Promise.all(promises);
      const deleted = results.reduce((sum: number, count) => sum + count, 0);

      if (deleted > 0) {
        Zotero.debug(
          `[${config.addonName}] Purged ${deleted} expired cache files`,
        );
      }
      return deleted;
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Purge expired error: ${e}`);
      return 0;
    }
  }

  /**
   * Get age of cached data in hours.
   * Returns -1 if not cached or error.
   * Checks both compressed and uncompressed files.
   * Note: get() now returns ageHours directly, so this method is mainly for external use.
   */
  async getAge(
    type: LocalCacheType,
    key: string,
    sort?: string,
  ): Promise<number> {
    if (!this.isEnabled()) return -1;

    await this.init();

    // Check both paths in order
    const paths = [
      this.getFilePath(type, key, sort, true), // compressed first
      this.getFilePath(type, key, sort, false), // then uncompressed
    ].filter((p): p is string => p !== null);

    for (const path of paths) {
      try {
        const exists = await IOUtils.exists(path);
        if (!exists) continue;

        const cached = await this.readCacheFile(path);
        if (cached) {
          const ageMs = Date.now() - cached.ts;
          return Math.round(ageMs / (60 * 60 * 1000));
        }
      } catch {
        // Continue to next path
      }
    }

    return -1;
  }
}

// Singleton instance
export const localCache = new InspireLocalCache();
