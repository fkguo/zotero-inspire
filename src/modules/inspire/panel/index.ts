// ─────────────────────────────────────────────────────────────────────────────
// Panel Module - Unified Exports
// Refactored components extracted from InspireReferencePanelController
// ─────────────────────────────────────────────────────────────────────────────

// Re-export ChartManager
export {
  ChartManager,
  type ChartViewMode,
  type ChartState,
  type ChartManagerOptions,
} from "./ChartManager";

// Re-export FilterManager
export {
  FilterManager,
  type FilterState,
  type FilterManagerOptions,
} from "./FilterManager";

// Re-export NavigationManager
export {
  NavigationManager,
  type NavigationState,
  type NavigationContext,
  type NavigationManagerOptions,
} from "./NavigationManager";

// Re-export ExportManager
export {
  ExportManager,
  type ExportFormat,
  type ExportTarget,
  type ExportFormatConfig,
  type ExportManagerOptions,
  type ExportResult,
  EXPORT_FORMATS,
} from "./ExportManager";

// Re-export BatchImportManager
export {
  BatchImportManager,
  type DuplicateInfo,
  type BatchImportResult,
  type BatchSaveTarget,
  type BatchImportManagerOptions,
  type BatchImportState,
} from "./BatchImportManager";

// Re-export PerformanceMonitor
export {
  PerformanceMonitor,
  getPerformanceMonitor,
  resetPerformanceMonitor,
  wrapWithMonitoring,
  wrapAsyncWithMonitoring,
  type PerformanceMetric,
  type PerformanceStats,
  type PerformanceReport,
  type PerformanceMonitorOptions,
} from "./PerformanceMonitor";

// Re-export RowPoolManager (ListRenderer core component)
export {
  RowPoolManager,
  replaceContainerAsync,
  createRowsFragment,
  type StyleApplicator,
  type RowPoolManagerOptions,
  type PoolStats,
  type ListRenderContext,
  type ListRenderOptions,
} from "./RowPoolManager";
