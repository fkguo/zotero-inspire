import { getPref } from "../../utils/prefs";

export const ENRICH_BATCH_PREF = "local_cache_enrich_batch";
export const ENRICH_PARALLEL_PREF = "local_cache_enrich_parallel";

export const ENRICH_BATCH_RANGE = { min: 25, max: 110 };
export const ENRICH_PARALLEL_RANGE = { min: 1, max: 5 };

export const ENRICH_BATCH_DEFAULT = 100;
export const ENRICH_PARALLEL_DEFAULT = 4;

function clamp(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(safeValue, min), max);
}

/**
 * Read enrichment configuration from preferences and normalize to safe ranges.
 */
export function getEnrichmentSettings() {
  const batchPref = Number(getPref(ENRICH_BATCH_PREF));
  const parallelPref = Number(getPref(ENRICH_PARALLEL_PREF));

  const batchSize = clamp(
    batchPref || ENRICH_BATCH_DEFAULT,
    ENRICH_BATCH_RANGE.min,
    ENRICH_BATCH_RANGE.max,
    ENRICH_BATCH_DEFAULT,
  );
  const parallelBatches = clamp(
    parallelPref || ENRICH_PARALLEL_DEFAULT,
    ENRICH_PARALLEL_RANGE.min,
    ENRICH_PARALLEL_RANGE.max,
    ENRICH_PARALLEL_DEFAULT,
  );

  return {
    batchSize,
    parallelBatches,
    defaultBatch: ENRICH_BATCH_DEFAULT,
    defaultParallel: ENRICH_PARALLEL_DEFAULT,
  };
}
