import { config } from "../package.json";
import { initLocale, getString } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { ZInsMenu, ZInsUtils, ZInspireReferencePane } from "./modules/zinspire";
import {
  localCache,
  getReaderIntegration,
  recidLookupCache,
  MemoryMonitor,
  findUnpublishedPreprints,
  batchCheckPublicationStatus,
  buildCheckSummary,
  shouldRunBackgroundCheck,
  updateLastCheckTime,
  trackPreprintCandidates,
  cleanupLegacyPreprintFiles,
  createAbortController,
  onRenderModeChange,
  deriveRecidFromItem,
  clearFundingCache,
  registerInspireItemTreeColumns,
  unregisterInspireItemTreeColumns,
  refreshInspireItemTreeColumns,
} from "./modules/inspire";
import {
  ENRICH_BATCH_RANGE,
  ENRICH_PARALLEL_RANGE,
  getEnrichmentSettings,
} from "./modules/inspire/enrichConfig";
import { getPref, setPref } from "./utils/prefs";
import { registerPrefsScripts } from "./modules/prefScript";
import { getExternalToken, ensureExternalToken } from "./utils/externalToken";
import {
  registerZInspirePickSaveTargetEndpoint,
  unregisterZInspirePickSaveTargetEndpoint,
} from "./modules/connectorPickSaveTarget";

// Track background timers for cleanup on shutdown (PERF-FIX-1)
let purgeTimer: ReturnType<typeof setTimeout> | undefined;
let preprintCheckTimer: ReturnType<typeof setTimeout> | undefined;
let preprintCheckController: AbortController | undefined;
let itemTreePrefsObserverID: symbol | undefined;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  initLocale();

  ZInsUtils.registerPrefs();
  ZInsUtils.registerNotifier();

  // Initialize new preference defaults for existing installations (FTR-FUNDING-EXTRACTION)
  if (getPref("funding_china_only") === undefined) {
    setPref("funding_china_only", true);
  }

  await onMainWindowLoad(Zotero.getMainWindow());

  // Register LRU caches for monitoring
  MemoryMonitor.getInstance().registerCache("recidLookup", recidLookupCache);

  // Expose console commands for debugging
  exposeConsoleCommands();

  // External tool integration: token + connector endpoint
  ensureExternalToken();
  registerZInspirePickSaveTargetEndpoint();

  // Purge expired local cache entries in background after startup (PERF-FIX-1: tracked timer)
  purgeTimer = setTimeout(() => {
    localCache.purgeExpired().catch((err) => {
      Zotero.debug(
        `[${config.addonName}] Failed to purge expired cache: ${err}`,
      );
    });
  }, 10000); // Delay 10s to avoid startup contention

  // FTR-PREPRINT-WATCH: Background preprint check on startup/daily (PERF-FIX-1: tracked timer)
  preprintCheckTimer = setTimeout(() => {
    runBackgroundPreprintCheck();
  }, 30000); // Delay 30s to avoid startup contention
}

/**
 * Expose debug commands on Zotero[addonInstance] for console access.
 * Usage in Zotero console:
 *   Zotero.ZoteroInspire.getCacheStats()
 *   Zotero.ZoteroInspire.logCacheStats()
 *   Zotero.ZoteroInspire.resetCacheStats()
 */
function exposeConsoleCommands(): void {
  const instance = (Zotero as any)[config.addonInstance];
  if (instance) {
    instance.getCacheStats = () => MemoryMonitor.getInstance().getCacheStats();
    instance.logCacheStats = () => MemoryMonitor.getInstance().logCacheStats();
    instance.resetCacheStats = () =>
      MemoryMonitor.getInstance().resetCacheStats();
    instance.startMemoryMonitor = (interval?: number) =>
      MemoryMonitor.getInstance().start(interval);
    instance.stopMemoryMonitor = () => MemoryMonitor.getInstance().stop();
    instance.getExternalToken = () => getExternalToken();
  }
}

/**
 * FTR-PREPRINT-WATCH: Run background preprint check based on preferences.
 * Non-interactive, only shows notification if publications found.
 */
async function runBackgroundPreprintCheck(): Promise<void> {
  // Abort previous background check if still running
  preprintCheckController?.abort();
  preprintCheckController = createAbortController();
  const signal = preprintCheckController?.signal;

  try {
    // Check if preprint watch is enabled
    const enabled = getPref("preprint_watch_enabled" as any) as boolean;
    if (!enabled) {
      Zotero.debug(
        `[${config.addonName}] Preprint watch disabled, skipping background check`,
      );
      return;
    }

    // Check if we should run based on timing preference
    if (!shouldRunBackgroundCheck()) {
      return;
    }

    Zotero.debug(`[${config.addonName}] Starting background preprint check`);

    // Update last check time
    updateLastCheckTime();

    // Find unpublished preprints in library
    const preprints = await findUnpublishedPreprints(undefined, undefined, {
      signal,
    });
    if (signal?.aborted) return;
    if (preprints.length === 0) {
      Zotero.debug(
        `[${config.addonName}] No unpublished preprints found in library`,
      );
      return;
    }

    Zotero.debug(
      `[${config.addonName}] Found ${preprints.length} unpublished preprints, checking INSPIRE...`,
    );

    // Check publication status (updates unified cache internally)
    const results = await batchCheckPublicationStatus(preprints, { signal });
    if (signal?.aborted) return;
    const summary = buildCheckSummary(results);

    // If publications found, show results dialog for user to review and update
    if (summary.published > 0) {
      // Show results dialog through ZInspire instance
      // This allows user to select which items to update
      await _globalThis.inspire.showBackgroundPreprintResults(results);
    }

    Zotero.debug(
      `[${config.addonName}] Background preprint check completed: ${summary.published} published, ${summary.unpublished} unpublished, ${summary.errors} errors`,
    );
  } catch (err) {
    Zotero.debug(
      `[${config.addonName}] Background preprint check failed: ${err}`,
    );
  }
}

async function onMainWindowLoad(_win: Window): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  ZInspireReferencePane.registerPanel();

  ZInsMenu.registerRightClickMenuPopup();
  ZInsMenu.registerRightClickCollectionMenu();
  ZInsMenu.registerToolsMenu();

  // FTR-PDF-ANNOTATE: Initialize Reader integration for citation detection
  getReaderIntegration().initialize();

  // FTR-CUSTOM-COLUMNS: Register custom item tree columns (Cites, arXiv)
  try {
    await registerInspireItemTreeColumns();

    // Refresh item tree cells when Cites column mode changes
    if (!itemTreePrefsObserverID && (Zotero.Prefs as any).registerObserver) {
      const prefName = `${config.prefsPrefix}.cites_column_exclude_self`;
      itemTreePrefsObserverID = (Zotero.Prefs as any).registerObserver(
        prefName,
        () => {
          refreshInspireItemTreeColumns(true);
        },
        true,
      ) as symbol;
    }
  } catch (err) {
    Zotero.debug(
      `[${config.addonName}] Failed to register item tree columns: ${err}`,
    );
  }
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  unregisterZInspirePickSaveTargetEndpoint();

  // PERF-FIX-1: Clear tracked timers before shutdown
  if (purgeTimer) {
    clearTimeout(purgeTimer);
    purgeTimer = undefined;
  }
  if (preprintCheckTimer) {
    clearTimeout(preprintCheckTimer);
    preprintCheckTimer = undefined;
  }
  preprintCheckController?.abort();
  preprintCheckController = undefined;

  // PERF-FIX-2: Stop MemoryMonitor interval if running
  MemoryMonitor.getInstance().stop();

  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  ZInspireReferencePane.unregisterPanel();
  // FTR-PDF-ANNOTATE: Cleanup Reader integration
  getReaderIntegration().cleanup();
  // Flush pending cache writes before shutdown
  localCache.flushWrites().catch(() => {
    // Ignore flush errors during shutdown
  });

  // FTR-CUSTOM-COLUMNS: Unregister custom item tree columns
  unregisterInspireItemTreeColumns();
  if (itemTreePrefsObserverID) {
    try {
      Zotero.Prefs.unregisterObserver(itemTreePrefsObserverID);
    } catch {
      // Ignore unregister errors during shutdown
    }
    itemTreePrefsObserverID = undefined;
  }
  // Remove addon object
  addon.data.alive = false;
  // @ts-ignore - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this funcion clear.
 */
async function onNotify(
  event: string,
  _type: string,
  ids: Array<any>,
  _extraData: { [key: string]: any },
) {
  // You can add your code to the corresponding notify type
  if (event === "add") {
    // Filter to only regular items - skip annotations, attachments, notes
    // PDF annotations trigger 'add' events but should not initiate INSPIRE lookups
    const allItems = Zotero.Items.get(ids);
    const regularItems = allItems.filter(
      (item: Zotero.Item) => item && item.isRegularItem(),
    );
    if (regularItems.length === 0) {
      return;
    }

    // Track potential preprint candidates to avoid full-library rescans later
    trackPreprintCandidates(regularItems).catch((err) => {
      Zotero.debug(
        `[${config.addonName}] Failed to track preprint candidates: ${err}`,
      );
    });

    // FIX-DUPLICATE-NOTE: Skip items that already have an INSPIRE recid
    // These were just imported from INSPIRE panel and don't need auto-update
    // This prevents duplicate note creation due to race condition between
    // panel import and onNotify auto-update
    const itemsNeedingUpdate = regularItems.filter(
      (item: Zotero.Item) => !deriveRecidFromItem(item),
    );
    if (itemsNeedingUpdate.length === 0) {
      return;
    }

    switch (getPref("meta")) {
      case "full":
        _globalThis.inspire.updateItems(itemsNeedingUpdate, "full");
        break;
      case "noabstract":
        _globalThis.inspire.updateItems(itemsNeedingUpdate, "noabstract");
        break;
      case "citations":
        _globalThis.inspire.updateItems(itemsNeedingUpdate, "citations");
        break;
      default:
        break;
    }
  }

  // Clear funding cache when items are deleted to prevent memory leaks
  if (event === "delete") {
    for (const id of ids) {
      if (typeof id === "number") {
        clearFundingCache(id);
      }
    }
  }
  return;
}

/**
 * Update cache statistics display in preferences panel.
 */
async function updateCacheStatsDisplay(doc: Document) {
  const statsEl = doc.getElementById(
    "zotero-prefpane-zoteroinspire-cache_stats",
  );
  if (statsEl) {
    const stats = await localCache.getStats();
    const sizeStr =
      stats.totalSize < 1024
        ? `${stats.totalSize} B`
        : stats.totalSize < 1024 * 1024
          ? `${(stats.totalSize / 1024).toFixed(1)} KB`
          : `${(stats.totalSize / 1024 / 1024).toFixed(1)} MB`;
    statsEl.textContent = getString("pref-local-cache-stats", {
      args: { count: stats.fileCount, size: sizeStr },
    });
  }
}

function updateEnrichSettingsDisplay(doc: Document, forceValueSync = false) {
  const infoEl = doc.getElementById(
    "zotero-prefpane-zoteroinspire-local_cache_enrich_info",
  );
  if (!infoEl) return;

  const batchInput = doc.getElementById(
    "zotero-prefpane-zoteroinspire-local_cache_enrich_batch",
  ) as HTMLInputElement | null;
  const parallelInput = doc.getElementById(
    "zotero-prefpane-zoteroinspire-local_cache_enrich_parallel",
  ) as HTMLInputElement | null;
  const settings = getEnrichmentSettings();

  if (batchInput && forceValueSync) {
    batchInput.value = String(settings.batchSize);
  }
  if (parallelInput && forceValueSync) {
    parallelInput.value = String(settings.parallelBatches);
  }

  const batchValue = parseInputWithFallback(
    batchInput,
    settings.batchSize,
    ENRICH_BATCH_RANGE.min,
    ENRICH_BATCH_RANGE.max,
  );
  const parallelValue = parseInputWithFallback(
    parallelInput,
    settings.parallelBatches,
    ENRICH_PARALLEL_RANGE.min,
    ENRICH_PARALLEL_RANGE.max,
  );

  infoEl.textContent = getString("pref-local-cache-enrich-info", {
    args: {
      batch: batchValue,
      parallel: parallelValue,
      defaultBatch: settings.defaultBatch,
      defaultParallel: settings.defaultParallel,
    },
  });
}

function parseInputWithFallback(
  input: HTMLInputElement | null,
  fallback: number,
  min: number,
  max: number,
) {
  if (!input) return fallback;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function updateLocalCacheControls(doc: Document, syncCheckbox = true) {
  const enableCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-local_cache_enable",
  ) as HTMLInputElement | null;
  let enabled = getPref("local_cache_enable") as boolean;
  if (enableCheckbox) {
    if (syncCheckbox) {
      enableCheckbox.checked = enabled;
    } else {
      enabled = enableCheckbox.checked;
      setPref("local_cache_enable", enabled);
    }
  }
  const controlIds = [
    "zotero-prefpane-zoteroinspire-local_cache_show_source",
    "zotero-prefpane-zoteroinspire-local_cache_compression",
    "zotero-prefpane-zoteroinspire-local_cache_enrich_batch",
    "zotero-prefpane-zoteroinspire-local_cache_enrich_parallel",
    "zotero-prefpane-zoteroinspire-local_cache_enrich_info",
    "zotero-prefpane-zoteroinspire-local_cache_ttl_hours",
    "zotero-prefpane-zoteroinspire-local_cache_custom_dir",
    "zotero-prefpane-zoteroinspire-browse_cache_dir",
    "zotero-prefpane-zoteroinspire-reset_cache_dir",
    "zotero-prefpane-zoteroinspire-clear_cache",
  ];
  controlIds.forEach((id) => {
    const el = doc.getElementById(id) as
      | (HTMLInputElement | HTMLButtonElement | HTMLElement)
      | null;
    if (!el || el === enableCheckbox) return;
    if ("disabled" in el) {
      (el as HTMLInputElement | HTMLButtonElement).disabled = !enabled;
    } else {
      el.classList.toggle("disabled", !enabled);
    }
  });
}

function updateAIControls(doc: Document, syncFromPref = true) {
  const localCacheEnabled = getPref("local_cache_enable") === true;

  const cacheEnableCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-ai_summary_cache_enable",
  ) as HTMLInputElement | null;
  const cacheTtlInput = doc.getElementById(
    "zotero-prefpane-zoteroinspire-ai_summary_cache_ttl_hours",
  ) as HTMLInputElement | null;

  const aiCacheEnabled = syncFromPref
    ? getPref("ai_summary_cache_enable") === true
    : (cacheEnableCheckbox?.checked ?? false);

  if (cacheEnableCheckbox) {
    if (syncFromPref) {
      cacheEnableCheckbox.checked = aiCacheEnabled;
    }
    // AI cache is implemented on top of Local Cache.
    cacheEnableCheckbox.disabled = !localCacheEnabled;
  }

  if (cacheTtlInput) {
    cacheTtlInput.disabled = !localCacheEnabled || !aiCacheEnabled;
  }
}

function updatePDFParseControls(doc: Document, syncCheckbox = true) {
  const parseCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-pdf_parse_refs_list",
  ) as HTMLInputElement | null;
  const forceCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-pdf_force_mapping_on_mismatch",
  ) as HTMLInputElement | null;

  let parseEnabled = getPref("pdf_parse_refs_list") === true;
  if (parseCheckbox) {
    if (syncCheckbox) {
      parseCheckbox.checked = parseEnabled;
    } else {
      parseEnabled = parseCheckbox.checked;
      setPref("pdf_parse_refs_list", parseEnabled);
    }
  }

  if (forceCheckbox) {
    const forcePref = getPref("pdf_force_mapping_on_mismatch") !== false;
    forceCheckbox.disabled = !parseEnabled;
    if (parseEnabled) {
      forceCheckbox.checked = forcePref;
    } else {
      // keep stored pref, but visually unchecked when disabled
      forceCheckbox.checked = false;
    }
  }
}

function updateSmartUpdateControls(doc: Document, syncCheckbox = true) {
  const enableCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-smart_update_enable",
  ) as HTMLInputElement | null;

  let enabled = getPref("smart_update_enable") as boolean;
  if (enableCheckbox) {
    if (syncCheckbox) {
      enableCheckbox.checked = enabled;
    } else {
      enabled = enableCheckbox.checked;
      setPref("smart_update_enable", enabled);
    }
  }

  // Sub-options that should be disabled when smart update is off
  const subControlIds = [
    "zotero-prefpane-zoteroinspire-smart_update_show_preview",
    "zotero-prefpane-zoteroinspire-smart_update_protect_title",
    "zotero-prefpane-zoteroinspire-smart_update_protect_authors",
    "zotero-prefpane-zoteroinspire-smart_update_protect_abstract",
    "zotero-prefpane-zoteroinspire-smart_update_protect_journal",
    "zotero-prefpane-zoteroinspire-smart_update_always_citations",
    "zotero-prefpane-zoteroinspire-smart_update_always_arxiv",
  ];

  subControlIds.forEach((id) => {
    const el = doc.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.disabled = !enabled;
  });
}

/**
 * Update Collaboration Tags controls.
 * - collab_tag_enable: main toggle (must be on for sub-options to work)
 * - collab_tag_auto: auto-apply toggle
 * - collab_tag_template: template input
 *
 * When disabled, sub-options are grayed out and non-interactive.
 * Template input shows placeholder when empty (not "undefined").
 */
function updateCollabTagControls(doc: Document, syncCheckbox = true) {
  const enableCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-collab_tag_enable",
  ) as HTMLInputElement | null;

  // Read current state - either from pref (on load) or from checkbox (on user click)
  // Note: Zotero's preference binding auto-syncs checkbox to pref on user click,
  // so we just need to read the current state, not set it again
  const enabled = syncCheckbox
    ? (getPref("collab_tag_enable") as boolean)
    : (enableCheckbox?.checked ?? false);

  if (enableCheckbox && syncCheckbox) {
    enableCheckbox.checked = enabled;
  }

  // Sub-options that should be disabled when collab tags is off
  const subControlIds = [
    "zotero-prefpane-zoteroinspire-collab_tag_auto",
    "zotero-prefpane-zoteroinspire-collab_tag_template",
  ];

  subControlIds.forEach((id) => {
    const el = doc.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.disabled = !enabled;
  });

  // Handle template input: ensure "undefined" is not displayed, show placeholder instead
  const templateInput = doc.getElementById(
    "zotero-prefpane-zoteroinspire-collab_tag_template",
  ) as HTMLInputElement | null;
  if (templateInput) {
    const templateValue = getPref("collab_tag_template") as string;
    // If value is undefined, null, or "undefined" string, clear it and show placeholder
    if (
      templateValue === undefined ||
      templateValue === null ||
      templateValue === "undefined"
    ) {
      templateInput.value = "";
    }
  }
}

/**
 * Update LaTeX sub-option visibility based on meta preference.
 * LaTeX rendering is only meaningful when fetching abstracts ("full").
 */
function updateLatexOptionsVisibility(doc: Document) {
  const latexContainer = doc.getElementById(
    "zotero-prefpane-zoteroinspire-latex_options",
  ) as HTMLElement | null;
  const metaRadiogroup = doc.getElementById(
    "zotero-prefpane-zoteroinspire-meta",
  ) as any;

  if (!latexContainer) return;

  // Get current meta preference value
  const metaValue = metaRadiogroup?.value ?? getPref("meta");
  const showLatex = metaValue === "full";

  // Show/hide the LaTeX options container
  latexContainer.style.display = showLatex ? "" : "none";

  // Also disable the menulist when hidden to prevent accidental changes
  const latexMenulist = doc.getElementById(
    "zotero-prefpane-zoteroinspire-latex_render_mode",
  ) as HTMLSelectElement | null;
  if (latexMenulist) {
    latexMenulist.disabled = !showLatex;
  }
}

function updateRelatedPapersControls(doc: Document, syncFromPref = true) {
  const enableCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-related_papers_enable",
  ) as HTMLInputElement | null;
  const excludeReviewsCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-related_papers_exclude_reviews",
  ) as HTMLInputElement | null;
  const maxResultsInput = doc.getElementById(
    "zotero-prefpane-zoteroinspire-related_papers_max_results",
  ) as HTMLInputElement | null;

  const maxResultsDefault = 50;
  const maxResultsMin = 10;
  const maxResultsMax = 200;

  const normalizeMaxResults = (value: unknown) => {
    const raw =
      typeof value === "number" && Number.isFinite(value)
        ? Math.floor(value)
        : maxResultsDefault;
    return Math.min(maxResultsMax, Math.max(maxResultsMin, raw));
  };

  if (syncFromPref) {
    const enabled = getPref("related_papers_enable") !== false;
    const excludeReviews = getPref("related_papers_exclude_reviews") !== false;
    const maxResults = normalizeMaxResults(
      getPref("related_papers_max_results"),
    );

    if (enableCheckbox) {
      enableCheckbox.checked = enabled;
    }
    if (excludeReviewsCheckbox) {
      excludeReviewsCheckbox.checked = excludeReviews;
    }
    if (maxResultsInput) {
      maxResultsInput.value = String(maxResults);
    }
  } else {
    const enabled = enableCheckbox?.checked ?? false;
    setPref("related_papers_enable", enabled);

    if (excludeReviewsCheckbox) {
      setPref("related_papers_exclude_reviews", excludeReviewsCheckbox.checked);
    }

    if (maxResultsInput) {
      const parsed = Number(maxResultsInput.value);
      if (Number.isFinite(parsed)) {
        const clamped = normalizeMaxResults(parsed);
        maxResultsInput.value = String(clamped);
        setPref("related_papers_max_results", clamped);
      } else {
        // Restore current pref value if the input is empty/invalid.
        maxResultsInput.value = String(
          normalizeMaxResults(getPref("related_papers_max_results")),
        );
      }
    }
  }

  const enabled =
    enableCheckbox?.checked ?? getPref("related_papers_enable") !== false;
  const disabled = !enabled;
  if (excludeReviewsCheckbox) {
    excludeReviewsCheckbox.disabled = disabled;
  }
  if (maxResultsInput) {
    maxResultsInput.disabled = disabled;
  }
}

/**
 * Update Preprint Watch controls.
 * - preprint_watch_enabled: main toggle (must be on for sub-options to work)
 * - on_startup checkbox: whether to check on startup (once per day)
 * - notify checkbox: whether to show notification
 *
 * Mapping for auto_check:
 * - checkbox checked → pref = "daily" (check once per day on first startup)
 * - checkbox unchecked → pref = "never" (manual only)
 */
function updatePreprintWatchControls(doc: Document, syncFromPref = true) {
  const enabledCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-preprint_watch_enabled",
  ) as HTMLInputElement | null;
  const onStartupCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-preprint_watch_on_startup",
  ) as HTMLInputElement | null;
  const notifyCheckbox = doc.getElementById(
    "zotero-prefpane-zoteroinspire-preprint_watch_notify",
  ) as HTMLInputElement | null;

  if (!enabledCheckbox || !onStartupCheckbox) return;

  // Get main toggle state
  const mainEnabled = enabledCheckbox.checked;

  // Disable sub-options when main toggle is off
  onStartupCheckbox.disabled = !mainEnabled;
  if (notifyCheckbox) {
    notifyCheckbox.disabled = !mainEnabled;
  }

  if (syncFromPref) {
    // Initialize checkbox from pref value
    const autoCheck = getPref("preprint_watch_auto_check" as any) as string;
    // Both "startup" and "daily" mean the checkbox should be checked
    // We treat them the same now (always limit to once per day)
    onStartupCheckbox.checked = autoCheck !== "never";
  } else {
    // Update pref from checkbox state
    const newValue = onStartupCheckbox.checked ? "daily" : "never";
    setPref("preprint_watch_auto_check" as any, newValue);
  }
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      // Update cache stats and directory display
      if (data.window) {
        const doc = data.window.document;
        updateCacheStatsDisplay(doc);
        updateEnrichSettingsDisplay(doc, true);
        setTimeout(() => updateEnrichSettingsDisplay(doc, true), 50);
        updateLocalCacheControls(doc);
        updatePDFParseControls(doc);
        updateSmartUpdateControls(doc);
        updatePreprintWatchControls(doc);
        updateCollabTagControls(doc);
        updateAIControls(doc);
        updateLatexOptionsVisibility(doc);
        updateRelatedPapersControls(doc);
        setTimeout(() => updateRelatedPapersControls(doc), 50);
        const enableCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-local_cache_enable",
        ) as HTMLInputElement | null;
        enableCheckbox?.addEventListener("command", () => {
          updateLocalCacheControls(doc, false);
          updateEnrichSettingsDisplay(doc, true);
          updateAIControls(doc);
        });
        const aiCacheCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-ai_summary_cache_enable",
        ) as HTMLInputElement | null;
        aiCacheCheckbox?.addEventListener("command", () => {
          updateAIControls(doc, false);
        });
        const relatedEnableCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-related_papers_enable",
        ) as HTMLInputElement | null;
        relatedEnableCheckbox?.addEventListener("command", () => {
          updateRelatedPapersControls(doc, false);
        });
        const relatedExcludeReviewsCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-related_papers_exclude_reviews",
        ) as HTMLInputElement | null;
        relatedExcludeReviewsCheckbox?.addEventListener("command", () => {
          updateRelatedPapersControls(doc, false);
        });
        const relatedMaxResultsInput = doc.getElementById(
          "zotero-prefpane-zoteroinspire-related_papers_max_results",
        ) as HTMLInputElement | null;
        relatedMaxResultsInput?.addEventListener("change", () => {
          updateRelatedPapersControls(doc, false);
        });
        const parseCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-pdf_parse_refs_list",
        ) as HTMLInputElement | null;
        parseCheckbox?.addEventListener("command", () => {
          updatePDFParseControls(doc, false);
        });
        // Meta radiogroup listener - update LaTeX options visibility
        const metaRadiogroup = doc.getElementById(
          "zotero-prefpane-zoteroinspire-meta",
        );
        metaRadiogroup?.addEventListener("command", () => {
          updateLatexOptionsVisibility(doc);
        });
        const latexModeRadio = doc.getElementById(
          "zotero-prefpane-zoteroinspire-latex_render_mode",
        );
        latexModeRadio?.addEventListener("command", () => {
          onRenderModeChange();
        });
        const forceCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-pdf_force_mapping_on_mismatch",
        ) as HTMLInputElement | null;
        forceCheckbox?.addEventListener("command", (e) => {
          const cb = e.target as HTMLInputElement;
          setPref("pdf_force_mapping_on_mismatch", cb.checked);
        });
        // Smart Update enable checkbox listener
        const smartUpdateCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-smart_update_enable",
        ) as HTMLInputElement | null;
        smartUpdateCheckbox?.addEventListener("command", () => {
          updateSmartUpdateControls(doc, false);
        });
        // Preprint Watch checkbox listeners
        const preprintEnabledCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-preprint_watch_enabled",
        ) as HTMLInputElement | null;
        const preprintOnStartupCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-preprint_watch_on_startup",
        ) as HTMLInputElement | null;
        preprintEnabledCheckbox?.addEventListener("command", () => {
          updatePreprintWatchControls(doc, true); // sync from pref, update disabled state
        });
        preprintOnStartupCheckbox?.addEventListener("command", () => {
          updatePreprintWatchControls(doc, false);
        });
        // Collab Tags enable checkbox listener
        const collabTagCheckbox = doc.getElementById(
          "zotero-prefpane-zoteroinspire-collab_tag_enable",
        ) as HTMLInputElement | null;
        collabTagCheckbox?.addEventListener("command", () => {
          updateCollabTagControls(doc, false);
        });
        const batchInput = doc.getElementById(
          "zotero-prefpane-zoteroinspire-local_cache_enrich_batch",
        ) as HTMLInputElement | null;
        const parallelInput = doc.getElementById(
          "zotero-prefpane-zoteroinspire-local_cache_enrich_parallel",
        ) as HTMLInputElement | null;
        const refresh = () => updateEnrichSettingsDisplay(doc);
        batchInput?.addEventListener("input", refresh);
        parallelInput?.addEventListener("input", refresh);
        // Show current cache directory (actual path being used)
        localCache.getCacheDir().then((dir) => {
          const input = doc.getElementById(
            "zotero-prefpane-zoteroinspire-local_cache_custom_dir",
          ) as HTMLInputElement;
          if (input && dir) {
            const customDir = getPref("local_cache_custom_dir") as string;
            input.value = customDir || "";
            input.placeholder = dir; // Show actual path being used
            input.title = dir; // Full path in tooltip
          }
        });
      }
      break;
    case "clearHistory":
      ZInspireReferencePane.clearAllHistory();
      // Show confirmation
      if (data.window) {
        const win = data.window as Window;
        const doc = win.document;
        const button = doc.getElementById(
          "zotero-prefpane-zoteroinspire-clear_history",
        );
        if (button) {
          const originalLabel = button.getAttribute("data-l10n-id");
          button.setAttribute("data-l10n-id", "pref-search-history-cleared");
          setTimeout(() => {
            button.setAttribute(
              "data-l10n-id",
              originalLabel || "pref-search-history-clear",
            );
          }, 2000);
        }
      }
      break;
    case "clearCache":
      // Clear local cache and show confirmation
      localCache.clearAll().then((count) => {
        if (data.window) {
          const win = data.window as Window;
          const doc = win.document;
          const button = doc.getElementById(
            "zotero-prefpane-zoteroinspire-clear_cache",
          );
          if (button) {
            const originalLabel = button.getAttribute("data-l10n-id");
            // Use fluent for the cleared message
            button.textContent = getString("pref-local-cache-cleared", {
              args: { count },
            });
            setTimeout(() => {
              button.setAttribute(
                "data-l10n-id",
                originalLabel || "pref-local-cache-clear",
              );
              button.textContent = ""; // Let fluent handle the text
            }, 2000);
          }
          // Update stats display
          updateCacheStatsDisplay(doc);
        }
      });
      break;
    case "browseCacheDir":
      // Browse for custom cache directory
      (async () => {
        const prefWin = data.window as Window | undefined;
        const pickerOwner = Zotero.getMainWindow() as Window | null;
        const FilePickerCtor = pickerOwner && (pickerOwner as any).FilePicker;

        if (!pickerOwner || !FilePickerCtor) {
          const alertHost = prefWin ?? pickerOwner;
          if (alertHost && typeof Services !== "undefined") {
            Services.prompt.alert(
              alertHost as unknown as mozIDOMWindowProxy,
              "File Picker Unavailable",
              "Unable to open the directory picker. Please try again from the main Zotero window.",
            );
          }
          Zotero.debug(
            `[${config.addonName}] FilePicker is not available in browseCacheDir handler.`,
          );
          return;
        }

        const fp = new FilePickerCtor();
        const parentForPicker = prefWin ?? pickerOwner;
        fp.init(parentForPicker, "Select Cache Directory", fp.modeGetFolder);

        const result = await fp.show();
        if (result === fp.returnOK && fp.file) {
          // Validate directory is writable before saving
          try {
            const testFile = PathUtils.join(fp.file, ".zotero-inspire-test");
            await IOUtils.writeUTF8(testFile, "test");
            await IOUtils.remove(testFile, { ignoreAbsent: true });

            // Directory is writable, save preference
            setPref("local_cache_custom_dir", fp.file);
            // Reinitialize cache with new directory
            await localCache.reinit();
            // Update UI
            const doc = prefWin?.document;
            if (doc) {
              const input = doc.getElementById(
                "zotero-prefpane-zoteroinspire-local_cache_custom_dir",
              ) as HTMLInputElement;
              if (input) {
                input.value = fp.file;
                input.placeholder = fp.file;
                input.title = fp.file;
              }
              updateCacheStatsDisplay(doc);
            }
          } catch (err) {
            // Directory not writable, show error
            const alertHost = prefWin ?? pickerOwner;
            if (alertHost && typeof Services !== "undefined") {
              Services.prompt.alert(
                alertHost as unknown as mozIDOMWindowProxy,
                "Invalid Directory",
                `Selected directory is not writable. Please choose a different location.\n\nError: ${err}`,
              );
            }
          }
        }
      })();
      break;
    case "resetCacheDir":
      // Reset to default directory
      setPref("local_cache_custom_dir", "");
      // Reinitialize cache with default directory
      localCache.reinit().then(() => {
        if (data.window) {
          const doc = (data.window as Window).document;
          localCache.getCacheDir().then((dir) => {
            const input = doc.getElementById(
              "zotero-prefpane-zoteroinspire-local_cache_custom_dir",
            ) as HTMLInputElement;
            if (input && dir) {
              input.value = "";
              input.placeholder = dir; // Show default path
              input.title = dir;
            }
            updateCacheStatsDisplay(doc);
          });
        }
      });
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
