// ─────────────────────────────────────────────────────────────────────────────
// Memory Monitor - Debug Utility for Tracking Heap Usage and Cache Stats
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../package.json";
import { LRUCache, type CacheStats } from "./utils";

/**
 * Registered cache entry for monitoring.
 */
interface RegisteredCache {
  name: string;
  cache: LRUCache<any, any>;
}

/**
 * Complete cache statistics report.
 */
export interface CacheStatsReport {
  /** Individual cache statistics */
  caches: Record<string, CacheStats>;
  /** Total hits across all caches */
  totalHits: number;
  /** Total misses across all caches */
  totalMisses: number;
  /** Overall hit rate */
  overallHitRate: number;
  /** Timestamp of report generation */
  timestamp: number;
}

/**
 * Debug utility for monitoring memory usage and cache statistics.
 * Enable via preference "debug_memory_monitor".
 *
 * Usage:
 * ```typescript
 * import { MemoryMonitor } from "./modules/inspire";
 *
 * // Register a cache for monitoring
 * MemoryMonitor.getInstance().registerCache("myCache", myLRUCache);
 *
 * // Get cache statistics
 * const stats = MemoryMonitor.getInstance().getCacheStats();
 *
 * // Start periodic monitoring
 * MemoryMonitor.getInstance().start();
 *
 * // Log once immediately
 * MemoryMonitor.getInstance().logMemoryStats();
 *
 * // Stop monitoring
 * MemoryMonitor.getInstance().stop();
 * ```
 */
export class MemoryMonitor {
  private static instance: MemoryMonitor | null = null;
  private intervalId?: ReturnType<typeof setInterval>;
  private registeredCaches: RegisteredCache[] = [];

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get singleton instance of MemoryMonitor.
   */
  static getInstance(): MemoryMonitor {
    if (!this.instance) {
      this.instance = new MemoryMonitor();
    }
    return this.instance;
  }

  /**
   * Register an LRUCache for monitoring.
   * @param name - Display name for the cache
   * @param cache - The LRUCache instance to monitor
   */
  registerCache(name: string, cache: LRUCache<any, any>): void {
    // Avoid duplicate registration
    if (this.registeredCaches.some((r) => r.cache === cache)) {
      return;
    }
    this.registeredCaches.push({ name, cache });
  }

  /**
   * Unregister a cache from monitoring.
   * @param cache - The cache instance to unregister
   */
  unregisterCache(cache: LRUCache<any, any>): void {
    this.registeredCaches = this.registeredCaches.filter(
      (r) => r.cache !== cache,
    );
  }

  /**
   * Get statistics for all registered caches.
   * @returns Cache statistics report
   */
  getCacheStats(): CacheStatsReport {
    const caches: Record<string, CacheStats> = {};
    let totalHits = 0;
    let totalMisses = 0;

    for (const { name, cache } of this.registeredCaches) {
      const stats = cache.getStats();
      caches[name] = stats;
      totalHits += stats.hits;
      totalMisses += stats.misses;
    }

    const total = totalHits + totalMisses;
    return {
      caches,
      totalHits,
      totalMisses,
      overallHitRate: total > 0 ? totalHits / total : 0,
      timestamp: Date.now(),
    };
  }

  /**
   * Reset statistics for all registered caches.
   */
  resetCacheStats(): void {
    for (const { cache } of this.registeredCaches) {
      cache.resetStats();
    }
    Zotero.debug(`[${config.addonName}] Cache statistics reset`);
  }

  /**
   * Log cache statistics to debug output.
   */
  logCacheStats(): void {
    const report = this.getCacheStats();
    const lines: string[] = [`[${config.addonName}] === Cache Statistics ===`];

    for (const [name, stats] of Object.entries(report.caches)) {
      const hitRate = (stats.hitRate * 100).toFixed(1);
      lines.push(
        `  ${name}: ${hitRate}% hit rate (${stats.hits}/${stats.hits + stats.misses}), size: ${stats.size}/${stats.maxSize}`,
      );
    }

    if (Object.keys(report.caches).length > 1) {
      const overallRate = (report.overallHitRate * 100).toFixed(1);
      lines.push(
        `  [Overall]: ${overallRate}% hit rate (${report.totalHits}/${report.totalHits + report.totalMisses})`,
      );
    }

    Zotero.debug(lines.join("\n"));
  }

  /**
   * Start periodic memory and cache logging.
   * @param intervalMs - Logging interval in milliseconds (default 30000 = 30s)
   */
  start(intervalMs: number = 30000): void {
    if (this.intervalId) {
      Zotero.debug(
        `[${config.addonName}] MemoryMonitor already running, call stop() first`,
      );
      return;
    }

    this.intervalId = setInterval(() => {
      this.logMemoryStats();
      this.logCacheStats();
    }, intervalMs);

    Zotero.debug(
      `[${config.addonName}] MemoryMonitor started (interval: ${intervalMs}ms)`,
    );
    // Log immediately on start
    this.logMemoryStats();
    this.logCacheStats();
  }

  /**
   * Stop periodic memory logging.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      Zotero.debug(`[${config.addonName}] MemoryMonitor stopped`);
    }
  }

  /**
   * Log current memory statistics.
   * Uses performance.memory API if available (Chromium-based browsers/Electron).
   */
  logMemoryStats(): void {
    // Note: performance.memory is a non-standard API available in Chromium/Electron
    // but not in Firefox. Zotero 7 uses Firefox ESR, so this may not be available.
    const memInfo = (performance as any).memory;

    if (memInfo) {
      const usedMB = Math.round(memInfo.usedJSHeapSize / 1024 / 1024);
      const totalMB = Math.round(memInfo.totalJSHeapSize / 1024 / 1024);
      const limitMB = Math.round(memInfo.jsHeapSizeLimit / 1024 / 1024);

      Zotero.debug(
        `[${config.addonName}] Memory Stats: ` +
          `used=${usedMB}MB, ` +
          `total=${totalMB}MB, ` +
          `limit=${limitMB}MB`,
      );
    }
    // Note: performance.memory API is Chrome-only, not available in Firefox/Gecko
    // Silently skip memory stats in Zotero (Firefox-based)
  }
}
