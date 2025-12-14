// ─────────────────────────────────────────────────────────────────────────────
// PerformanceMonitor - Performance monitoring for References Panel
// Part of controller refactoring effort
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Performance metric entry.
 */
export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated performance statistics.
 */
export interface PerformanceStats {
  name: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  lastDuration: number;
}

/**
 * Performance report for export.
 */
export interface PerformanceReport {
  timestamp: string;
  sessionDuration: number;
  metrics: PerformanceStats[];
}

/**
 * Options for PerformanceMonitor.
 */
export interface PerformanceMonitorOptions {
  /** Enable debug logging */
  debugMode?: boolean;
  /** Maximum metrics to keep in history per operation */
  maxHistoryPerOperation?: number;
  /** Callback when slow operation detected (> threshold ms) */
  onSlowOperation?: (name: string, duration: number, threshold: number) => void;
  /** Threshold in ms for slow operation detection */
  slowOperationThreshold?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PerformanceMonitor Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monitors and tracks performance metrics for the References Panel.
 * Provides timing utilities and aggregated statistics.
 */
export class PerformanceMonitor {
  private options: Required<PerformanceMonitorOptions>;
  private metrics = new Map<string, PerformanceMetric[]>();
  private activeTimers = new Map<string, PerformanceMetric>();
  private sessionStart: number;

  constructor(options: PerformanceMonitorOptions = {}) {
    this.options = {
      debugMode: options.debugMode ?? false,
      maxHistoryPerOperation: options.maxHistoryPerOperation ?? 100,
      onSlowOperation: options.onSlowOperation ?? (() => {}),
      slowOperationThreshold: options.slowOperationThreshold ?? 500,
    };
    this.sessionStart = Date.now();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API: Timing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start timing an operation.
   * @param name Unique name for the operation
   * @param metadata Optional metadata to attach
   * @returns Timer ID for stopping
   */
  start(name: string, metadata?: Record<string, unknown>): string {
    const timerId = `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const metric: PerformanceMetric = {
      name,
      startTime: performance.now(),
      metadata,
    };
    this.activeTimers.set(timerId, metric);

    if (this.options.debugMode) {
      Zotero.debug(`[${config.addonName}] [Perf] Started: ${name}`);
    }

    return timerId;
  }

  /**
   * Stop timing an operation.
   * @param timerId Timer ID from start()
   * @returns Duration in milliseconds, or undefined if timer not found
   */
  stop(timerId: string): number | undefined {
    const metric = this.activeTimers.get(timerId);
    if (!metric) {
      if (this.options.debugMode) {
        Zotero.debug(
          `[${config.addonName}] [Perf] Timer not found: ${timerId}`,
        );
      }
      return undefined;
    }

    this.activeTimers.delete(timerId);
    metric.endTime = performance.now();
    metric.duration = metric.endTime - metric.startTime;

    // Store in history
    this.recordMetric(metric);

    // Check for slow operation
    if (metric.duration > this.options.slowOperationThreshold) {
      this.options.onSlowOperation(
        metric.name,
        metric.duration,
        this.options.slowOperationThreshold,
      );
    }

    if (this.options.debugMode) {
      Zotero.debug(
        `[${config.addonName}] [Perf] Completed: ${metric.name} in ${metric.duration.toFixed(2)}ms`,
      );
    }

    return metric.duration;
  }

  /**
   * Measure an async operation.
   * @param name Operation name
   * @param fn Async function to measure
   * @param metadata Optional metadata
   * @returns Result of the function
   */
  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const timerId = this.start(name, metadata);
    try {
      return await fn();
    } finally {
      this.stop(timerId);
    }
  }

  /**
   * Measure a sync operation.
   * @param name Operation name
   * @param fn Function to measure
   * @param metadata Optional metadata
   * @returns Result of the function
   */
  measure<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    const timerId = this.start(name, metadata);
    try {
      return fn();
    } finally {
      this.stop(timerId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API: Statistics
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get statistics for a specific operation.
   */
  getStats(name: string): PerformanceStats | undefined {
    const history = this.metrics.get(name);
    if (!history || history.length === 0) {
      return undefined;
    }

    const durations = history
      .map((m) => m.duration!)
      .filter((d) => d !== undefined);
    if (durations.length === 0) {
      return undefined;
    }

    return {
      name,
      count: durations.length,
      totalDuration: durations.reduce((a, b) => a + b, 0),
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      lastDuration: durations[durations.length - 1],
    };
  }

  /**
   * Get statistics for all operations.
   */
  getAllStats(): PerformanceStats[] {
    const stats: PerformanceStats[] = [];
    for (const name of this.metrics.keys()) {
      const stat = this.getStats(name);
      if (stat) {
        stats.push(stat);
      }
    }
    return stats.sort((a, b) => b.totalDuration - a.totalDuration);
  }

  /**
   * Generate a full performance report.
   */
  getReport(): PerformanceReport {
    return {
      timestamp: new Date().toISOString(),
      sessionDuration: Date.now() - this.sessionStart,
      metrics: this.getAllStats(),
    };
  }

  /**
   * Log performance summary to console.
   */
  logSummary(): void {
    const stats = this.getAllStats();
    if (stats.length === 0) {
      Zotero.debug(`[${config.addonName}] [Perf] No metrics recorded`);
      return;
    }

    Zotero.debug(`[${config.addonName}] [Perf] ─── Performance Summary ───`);
    for (const stat of stats) {
      Zotero.debug(
        `[${config.addonName}] [Perf] ${stat.name}: ` +
          `count=${stat.count}, ` +
          `avg=${stat.avgDuration.toFixed(2)}ms, ` +
          `min=${stat.minDuration.toFixed(2)}ms, ` +
          `max=${stat.maxDuration.toFixed(2)}ms`,
      );
    }
    Zotero.debug(`[${config.addonName}] [Perf] ────────────────────────────`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API: Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Clear all recorded metrics.
   */
  clear(): void {
    this.metrics.clear();
    this.activeTimers.clear();
    this.sessionStart = Date.now();
  }

  /**
   * Clear metrics for a specific operation.
   */
  clearOperation(name: string): void {
    this.metrics.delete(name);
  }

  /**
   * Get the number of recorded operations.
   */
  getOperationCount(): number {
    return this.metrics.size;
  }

  /**
   * Get the total number of recorded metrics.
   */
  getTotalMetricCount(): number {
    let count = 0;
    for (const history of this.metrics.values()) {
      count += history.length;
    }
    return count;
  }

  /**
   * Enable or disable debug mode.
   */
  setDebugMode(enabled: boolean): void {
    this.options.debugMode = enabled;
  }

  /**
   * Set slow operation threshold.
   */
  setSlowOperationThreshold(ms: number): void {
    this.options.slowOperationThreshold = ms;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Metric Storage
  // ─────────────────────────────────────────────────────────────────────────────

  private recordMetric(metric: PerformanceMetric): void {
    let history = this.metrics.get(metric.name);
    if (!history) {
      history = [];
      this.metrics.set(metric.name, history);
    }

    history.push(metric);

    // Enforce max history limit
    if (history.length > this.options.maxHistoryPerOperation) {
      history.shift();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

/** Global performance monitor instance */
let globalMonitor: PerformanceMonitor | undefined;

/**
 * Get or create the global performance monitor.
 */
export function getPerformanceMonitor(
  options?: PerformanceMonitorOptions,
): PerformanceMonitor {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor(options);
  }
  return globalMonitor;
}

/**
 * Reset the global performance monitor.
 */
export function resetPerformanceMonitor(): void {
  globalMonitor?.clear();
  globalMonitor = undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decorators (for future use with TypeScript 5+ decorators)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper to wrap a method with performance monitoring.
 * Usage: const wrappedFn = wrapWithMonitoring(originalFn, 'operationName');
 */
export function wrapWithMonitoring<T extends (...args: any[]) => any>(
  fn: T,
  name: string,
  monitor?: PerformanceMonitor,
): T {
  const mon = monitor || getPerformanceMonitor();
  return function (this: any, ...args: Parameters<T>): ReturnType<T> {
    const timerId = mon.start(name);
    try {
      const result = fn.apply(this, args);
      if (result instanceof Promise) {
        return result.finally(() => mon.stop(timerId)) as ReturnType<T>;
      }
      mon.stop(timerId);
      return result;
    } catch (e) {
      mon.stop(timerId);
      throw e;
    }
  } as T;
}

/**
 * Helper to wrap an async method with performance monitoring.
 */
export function wrapAsyncWithMonitoring<
  T extends (...args: any[]) => Promise<any>,
>(fn: T, name: string, monitor?: PerformanceMonitor): T {
  const mon = monitor || getPerformanceMonitor();
  return async function (
    this: any,
    ...args: Parameters<T>
  ): Promise<ReturnType<T>> {
    return mon.measureAsync(name, () => fn.apply(this, args));
  } as T;
}
