// ─────────────────────────────────────────────────────────────────────────────
// Local Cache Service - Persistent storage for INSPIRE data
// Uses IOUtils and PathUtils (Firefox 115 / Zotero 7)
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../package.json";
import { getPref } from "../../utils/prefs";
import type { InspireReferenceEntry, LocalCacheFile, LocalCacheType } from "./types";

// Cache directory name under Zotero data directory
const CACHE_DIR_NAME = "zoteroinspire-cache";

// Default TTL values (in hours)
const DEFAULT_TTL_REFS = -1;     // Permanent (references don't change)
const DEFAULT_TTL_CITED = 24;    // 24 hours for cited-by and author papers

// Cache version for format migrations
const CACHE_VERSION = 1;

// Write queue delay (ms) - debounce rapid writes
const WRITE_DEBOUNCE_MS = 500;

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
  private writeQueue = new Map<string, { timer: ReturnType<typeof setTimeout>; data: any }>();

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
        Zotero.debug(`[${config.addonName}] Using custom cache directory: ${this.cacheDir}`);
        
        // Validate custom directory (check if writable)
        try {
          const exists = await IOUtils.exists(this.cacheDir);
          if (!exists) {
            await IOUtils.makeDirectory(this.cacheDir, { ignoreExisting: true });
          }
          // Test write permission by creating a temp file
          const testFile = PathUtils.join(this.cacheDir, ".zotero-inspire-test");
          await IOUtils.writeUTF8(testFile, "test");
          await IOUtils.remove(testFile, { ignoreAbsent: true });
          Zotero.debug(`[${config.addonName}] Custom directory validated: ${this.cacheDir}`);
        } catch (e) {
          Zotero.debug(`[${config.addonName}] Custom directory not writable, falling back to default: ${e}`);
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
        Zotero.debug(`[${config.addonName}] Created cache directory: ${this.cacheDir}`);
      }
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Failed to init cache directory: ${e}`);
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
   * Build cache file path for given type and key.
   */
  private getFilePath(type: LocalCacheType, key: string, sort?: string): string | null {
    if (!this.cacheDir) return null;
    
    // Sanitize key for filename safety
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeSuffix = sort ? `_${sort.replace(/[^a-zA-Z0-9]/g, "")}` : "";
    
    return PathUtils.join(this.cacheDir, `${type}_${safeKey}${safeSuffix}.json`);
  }

  /**
   * Read cached data from local storage.
   * Returns null if cache miss, expired, or disabled.
   * Returns data with ageHours and total to avoid re-reading the file.
   * 
   * @returns Object with:
   *   - data: The cached data
   *   - fromCache: Always true (for type discrimination)
   *   - ageHours: Age of cache in hours
   *   - total: Total count from API (if available). Used for smart caching:
   *     - If total <= data.length, data is complete and can be sorted client-side
   *     - If total > data.length or undefined, data may be truncated
   */
  async get<T = InspireReferenceEntry[]>(
    type: LocalCacheType,
    key: string,
    sort?: string,
  ): Promise<{ data: T; fromCache: true; ageHours: number; total?: number } | null> {
    if (!this.isEnabled()) return null;
    
    await this.init();
    const filePath = this.getFilePath(type, key, sort);
    if (!filePath) return null;

    try {
      const exists = await IOUtils.exists(filePath);
      if (!exists) return null;

      const cached = await IOUtils.readJSON(filePath) as LocalCacheFile<T>;
      
      // Version check
      if (cached.v !== CACHE_VERSION) {
        Zotero.debug(`[${config.addonName}] Cache version mismatch, ignoring: ${filePath}`);
        return null;
      }

      // Complete flag check - reject incomplete or old-format caches
      if (cached.c !== true) {
        Zotero.debug(`[${config.addonName}] Cache incomplete (missing complete flag), deleting: ${filePath}`);
        try {
          await IOUtils.remove(filePath, { ignoreAbsent: true });
        } catch {
          // Ignore deletion errors
        }
        return null;
      }

      const ageMs = Date.now() - cached.ts;
      const ageHours = Math.round(ageMs / (60 * 60 * 1000));

      // TTL check
      if (cached.ttl > 0) {
        const ttlMs = cached.ttl * 60 * 60 * 1000;
        if (ageMs > ttlMs) {
          Zotero.debug(`[${config.addonName}] Cache expired (${ageHours}h old): ${filePath}`);
          // Don't delete - might be useful as fallback
          return null;
        }
      }

      Zotero.debug(`[${config.addonName}] Cache hit: ${type}/${key}${cached.n !== undefined ? ` (total: ${cached.n})` : ""}`);
      return { data: cached.d, fromCache: true, ageHours, total: cached.n };
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Cache read error: ${e}`);
      // Delete corrupted file to prevent repeated read errors
      try {
        await IOUtils.remove(filePath, { ignoreAbsent: true });
        Zotero.debug(`[${config.addonName}] Removed corrupted cache file: ${filePath}`);
      } catch {
        // Ignore deletion errors
      }
      return null;
    }
  }

  /**
   * Write data to local cache (debounced).
   * Async and non-blocking - errors are logged but don't affect caller.
   * Uses debouncing to reduce disk I/O when data is updated multiple times.
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
    const filePath = this.getFilePath(type, key, sort);
    if (!filePath) return;

    // Determine TTL based on type
    let ttl: number;
    if (type === "refs") {
      ttl = DEFAULT_TTL_REFS;
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
      c: true,  // Mark as complete (fetch finished successfully)
      n: total, // Total count from API (for smart caching)
    };

    // Cancel existing timer for this file if any
    const existing = this.writeQueue.get(filePath);
    if (existing) {
      clearTimeout(existing.timer);
    }

    // Schedule debounced write
    const timer = setTimeout(async () => {
      this.writeQueue.delete(filePath);
      try {
        await IOUtils.writeJSON(filePath, cacheData);
        Zotero.debug(`[${config.addonName}] Cache written: ${type}/${key}${total !== undefined ? ` (total: ${total})` : ""}`);
      } catch (e) {
        Zotero.debug(`[${config.addonName}] Cache write error: ${e}`);
      }
    }, WRITE_DEBOUNCE_MS);

    this.writeQueue.set(filePath, { timer, data: cacheData });
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
        await IOUtils.writeJSON(filePath, data);
        Zotero.debug(`[${config.addonName}] Cache flushed: ${filePath}`);
      } catch (e) {
        Zotero.debug(`[${config.addonName}] Cache flush error: ${e}`);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Delete specific cache entry.
   */
  async delete(type: LocalCacheType, key: string, sort?: string): Promise<void> {
    await this.init();
    const filePath = this.getFilePath(type, key, sort);
    if (!filePath) return;

    try {
      await IOUtils.remove(filePath, { ignoreAbsent: true });
      Zotero.debug(`[${config.addonName}] Cache deleted: ${type}/${key}`);
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Cache delete error: ${e}`);
    }
  }

  /**
   * Clear all cache files.
   * Returns number of files deleted.
   */
  async clearAll(): Promise<number> {
    await this.init();
    if (!this.cacheDir) return 0;

    try {
      const exists = await IOUtils.exists(this.cacheDir);
      if (!exists) return 0;

      const children = await IOUtils.getChildren(this.cacheDir);
      
      // Parallel deletion
      const promises = children
        .filter(filePath => filePath.endsWith(".json"))
        .map(filePath => IOUtils.remove(filePath).then(() => 1).catch(() => 0));
        
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
   * Get cache statistics.
   */
  async getStats(): Promise<{ fileCount: number; totalSize: number }> {
    await this.init();
    if (!this.cacheDir) return { fileCount: 0, totalSize: 0 };

    try {
      const exists = await IOUtils.exists(this.cacheDir);
      if (!exists) return { fileCount: 0, totalSize: 0 };

      const children = await IOUtils.getChildren(this.cacheDir);
      
      // Parallel stats gathering
      const promises = children
        .filter(filePath => filePath.endsWith(".json"))
        .map(async filePath => {
          try {
            const stat = await IOUtils.stat(filePath);
            return { count: 1, size: stat.size ?? 0 };
          } catch {
            return { count: 0, size: 0 };
          }
        });
        
      const results = await Promise.all(promises);
      
      return results.reduce(
        (acc, curr) => ({
          fileCount: acc.fileCount + curr.count,
          totalSize: acc.totalSize + curr.size
        }),
        { fileCount: 0, totalSize: 0 }
      );
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Cache stats error: ${e}`);
      return { fileCount: 0, totalSize: 0 };
    }
  }

  /**
   * Purge expired cache files.
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
        .filter(filePath => filePath.endsWith(".json"))
        .map(async filePath => {
          try {
            const cached = await IOUtils.readJSON(filePath) as LocalCacheFile<unknown>;
            
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
        Zotero.debug(`[${config.addonName}] Purged ${deleted} expired cache files`);
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
   * Note: get() now returns ageHours directly, so this method is mainly for external use.
   */
  async getAge(type: LocalCacheType, key: string, sort?: string): Promise<number> {
    if (!this.isEnabled()) return -1;
    
    await this.init();
    const filePath = this.getFilePath(type, key, sort);
    if (!filePath) return -1;

    try {
      const exists = await IOUtils.exists(filePath);
      if (!exists) return -1;

      const cached = await IOUtils.readJSON(filePath) as LocalCacheFile<unknown>;
      const ageMs = Date.now() - cached.ts;
      return Math.round(ageMs / (60 * 60 * 1000)); // Convert to hours
    } catch {
      return -1;
    }
  }
}

// Singleton instance
export const localCache = new InspireLocalCache();

