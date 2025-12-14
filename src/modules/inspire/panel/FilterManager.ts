// ─────────────────────────────────────────────────────────────────────────────
// FilterManager - Filter logic for References Panel
// Extracted from InspireReferencePanelController as part of controller refactoring
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { getPref, setPref } from "../../../utils/prefs";
import {
  QUICK_FILTER_PREF_KEY,
  QUICK_FILTER_CONFIGS,
  HIGH_CITATIONS_THRESHOLD,
  SMALL_AUTHOR_GROUP_THRESHOLD,
  isQuickFilterType,
  type QuickFilterType,
  type InspireReferenceEntry,
} from "../index";
import {
  parseFilterTokens,
  buildFilterTokenVariants,
  ensureSearchText,
} from "../textUtils";
import {
  createDefaultFilterContext,
  hasJournalInfo,
  hasArxivIdentifier,
  getExcludedFilters,
  type FilterContext,
} from "../filters";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter state for external access.
 */
export interface FilterState {
  textFilter: string;
  quickFilters: ReadonlySet<QuickFilterType>;
  authorFilterEnabled: boolean;
  publishedOnlyFilterEnabled: boolean;
}

/**
 * Options for FilterManager initialization.
 */
export interface FilterManagerOptions {
  /** Callback when filters change */
  onFilterChange?: () => void;
  /** Callback to get citation value for an entry (for self-citation exclusion) */
  getCitationValue?: (entry: InspireReferenceEntry) => number;
  /** Callback to check if entry matches chart filter */
  matchesChartFilter?: (entry: InspireReferenceEntry) => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// FilterManager Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages filtering logic for the References Panel.
 * Handles text filters, quick filters, author filters, and published-only filter.
 */
export class FilterManager {
  // State
  private textFilter = "";
  private quickFilters = new Set<QuickFilterType>();
  private authorFilterEnabled = false;
  private publishedOnlyFilterEnabled = false;

  // Context for filter predicates
  private filterContext: FilterContext;

  // Callbacks
  private options: FilterManagerOptions;

  constructor(options: FilterManagerOptions = {}) {
    this.options = options;
    this.filterContext = createDefaultFilterContext(
      options.getCitationValue ?? ((entry) => entry.citationCount ?? 0),
    );

    // Load saved quick filters from preferences
    this.loadQuickFiltersFromPrefs();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the current filter state.
   */
  getState(): FilterState {
    return {
      textFilter: this.textFilter,
      quickFilters: this.quickFilters,
      authorFilterEnabled: this.authorFilterEnabled,
      publishedOnlyFilterEnabled: this.publishedOnlyFilterEnabled,
    };
  }

  /**
   * Check if any filter is active.
   */
  hasActiveFilters(): boolean {
    return (
      this.textFilter.length > 0 ||
      this.quickFilters.size > 0 ||
      this.authorFilterEnabled ||
      this.publishedOnlyFilterEnabled
    );
  }

  /**
   * Get the number of active quick filters.
   */
  getQuickFilterCount(): number {
    return this.quickFilters.size;
  }

  /**
   * Set the text filter value.
   */
  setTextFilter(text: string): void {
    this.textFilter = text;
    this.options.onFilterChange?.();
  }

  /**
   * Get the current text filter value.
   */
  getTextFilter(): string {
    return this.textFilter;
  }

  /**
   * Toggle a quick filter on/off.
   */
  toggleQuickFilter(type: QuickFilterType): boolean {
    const shouldEnable = !this.quickFilters.has(type);

    if (shouldEnable) {
      // Handle mutual exclusivity
      const excluded = getExcludedFilters(type);
      for (const ex of excluded) {
        this.quickFilters.delete(ex);
      }
      this.quickFilters.add(type);
    } else {
      this.quickFilters.delete(type);
    }

    // Sync published filter state
    this.publishedOnlyFilterEnabled = this.quickFilters.has("publishedOnly");

    // Save to preferences
    this.saveQuickFiltersToPrefs();
    this.options.onFilterChange?.();

    return shouldEnable;
  }

  /**
   * Check if a quick filter is enabled.
   */
  isQuickFilterEnabled(type: QuickFilterType): boolean {
    return this.quickFilters.has(type);
  }

  /**
   * Toggle the author filter (papers with <= 10 authors).
   */
  toggleAuthorFilter(): boolean {
    this.authorFilterEnabled = !this.authorFilterEnabled;
    this.options.onFilterChange?.();
    return this.authorFilterEnabled;
  }

  /**
   * Set the author filter state.
   */
  setAuthorFilter(enabled: boolean): void {
    this.authorFilterEnabled = enabled;
    this.options.onFilterChange?.();
  }

  /**
   * Check if author filter is enabled.
   */
  isAuthorFilterEnabled(): boolean {
    return this.authorFilterEnabled;
  }

  /**
   * Clear all filters.
   */
  clearAll(): void {
    this.textFilter = "";
    this.quickFilters.clear();
    this.authorFilterEnabled = false;
    this.publishedOnlyFilterEnabled = false;
    this.saveQuickFiltersToPrefs();
    this.options.onFilterChange?.();
  }

  /**
   * Clear only the text filter.
   */
  clearTextFilter(): void {
    this.textFilter = "";
    this.options.onFilterChange?.();
  }

  /**
   * Clear only quick filters.
   */
  clearQuickFilters(): void {
    this.quickFilters.clear();
    this.publishedOnlyFilterEnabled = false;
    this.saveQuickFiltersToPrefs();
    this.options.onFilterChange?.();
  }

  /**
   * Apply all filters to a list of entries.
   */
  filter(
    entries: InspireReferenceEntry[],
    options: { skipChartFilter?: boolean } = {},
  ): InspireReferenceEntry[] {
    const { skipChartFilter = false } = options;

    // Parse and apply text filter
    const filterGroups = parseFilterTokens(this.textFilter)
      .map(({ text, quoted }) =>
        buildFilterTokenVariants(text, { ignoreSpaceDot: quoted }),
      )
      .filter((variants) => variants.length);

    const textFiltered = filterGroups.length
      ? entries.filter((entry) =>
          filterGroups.every((variants) =>
            variants.some((token) => ensureSearchText(entry).includes(token)),
          ),
        )
      : entries;

    // Apply chart filter (if callback provided and not skipped)
    const chartFiltered =
      !skipChartFilter && this.options.matchesChartFilter
        ? textFiltered.filter((entry) =>
            this.options.matchesChartFilter!(entry),
          )
        : textFiltered;

    // Apply author count filter
    const authorFiltered = this.authorFilterEnabled
      ? chartFiltered.filter((entry) => this.matchesAuthorFilter(entry))
      : chartFiltered;

    // Apply published only filter
    const publishedFiltered = this.publishedOnlyFilterEnabled
      ? authorFiltered.filter((entry) => this.matchesPublishedOnlyFilter(entry))
      : authorFiltered;

    // Apply quick filters
    return this.applyQuickFilters(publishedFiltered);
  }

  /**
   * Get tooltip text describing active quick filters.
   */
  getQuickFiltersTooltip(): string {
    if (!this.quickFilters.size) {
      return "";
    }

    const lines: string[] = [];
    for (const filter of this.quickFilters) {
      const config = QUICK_FILTER_CONFIGS.find((c) => c.type === filter);
      if (config) {
        const label = getString(config.labelKey) || config.type;
        lines.push(`${config.emoji} ${label}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * Update the filter context (e.g., when citation value calculation changes).
   */
  updateContext(
    getCitationValue: (entry: InspireReferenceEntry) => number,
  ): void {
    this.filterContext = createDefaultFilterContext(getCitationValue);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Filter Predicates
  // ─────────────────────────────────────────────────────────────────────────────

  private matchesAuthorFilter(entry: InspireReferenceEntry): boolean {
    const authorCount = entry.totalAuthors ?? entry.authors?.length ?? 0;
    return authorCount > 0 && authorCount <= SMALL_AUTHOR_GROUP_THRESHOLD;
  }

  private matchesPublishedOnlyFilter(entry: InspireReferenceEntry): boolean {
    return hasJournalInfo(entry);
  }

  private matchesHighCitationsFilter(entry: InspireReferenceEntry): boolean {
    const citationCount = this.filterContext.getCitationValue(entry);
    return citationCount > HIGH_CITATIONS_THRESHOLD;
  }

  private matchesRecentYearsFilter(
    entry: InspireReferenceEntry,
    years: number,
  ): boolean {
    const currentYear = this.filterContext.currentYear;
    const entryYear = parseInt(entry.year || "", 10);
    if (isNaN(entryYear)) return false;
    return entryYear >= currentYear - (years - 1);
  }

  private matchesPreprintOnlyFilter(entry: InspireReferenceEntry): boolean {
    return hasArxivIdentifier(entry) && !hasJournalInfo(entry);
  }

  private matchesRelatedOnlyFilter(entry: InspireReferenceEntry): boolean {
    return entry.isRelated === true;
  }

  private matchesLocalItemsFilter(entry: InspireReferenceEntry): boolean {
    return typeof entry.localItemID === "number" && entry.localItemID > 0;
  }

  private matchesOnlineItemsFilter(entry: InspireReferenceEntry): boolean {
    return typeof entry.localItemID !== "number" || entry.localItemID <= 0;
  }

  private applyQuickFilters(
    entries: InspireReferenceEntry[],
  ): InspireReferenceEntry[] {
    if (this.quickFilters.size === 0) return entries;

    return entries.filter((entry) => {
      // High citations filter
      if (
        this.quickFilters.has("highCitations") &&
        !this.matchesHighCitationsFilter(entry)
      ) {
        return false;
      }

      // Recent 5 years filter
      if (
        this.quickFilters.has("recent5Years") &&
        !this.matchesRecentYearsFilter(entry, 5)
      ) {
        return false;
      }

      // Recent 1 year filter
      if (
        this.quickFilters.has("recent1Year") &&
        !this.matchesRecentYearsFilter(entry, 1)
      ) {
        return false;
      }

      // Note: publishedOnly is handled by publishedOnlyFilterEnabled before applyQuickFilters
      // to avoid double-filtering (publishedOnlyFilterEnabled syncs with quickFilters.has("publishedOnly"))

      // Preprint only filter
      if (
        this.quickFilters.has("preprintOnly") &&
        !this.matchesPreprintOnlyFilter(entry)
      ) {
        return false;
      }

      // Related only filter
      if (
        this.quickFilters.has("relatedOnly") &&
        !this.matchesRelatedOnlyFilter(entry)
      ) {
        return false;
      }

      // Local items filter
      if (
        this.quickFilters.has("localItems") &&
        !this.matchesLocalItemsFilter(entry)
      ) {
        return false;
      }

      // Online items filter
      if (
        this.quickFilters.has("onlineItems") &&
        !this.matchesOnlineItemsFilter(entry)
      ) {
        return false;
      }

      return true;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Preferences
  // ─────────────────────────────────────────────────────────────────────────────

  private loadQuickFiltersFromPrefs(): void {
    this.quickFilters.clear();
    try {
      const stored = getPref(QUICK_FILTER_PREF_KEY);
      if (typeof stored === "string" && stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          for (const value of parsed) {
            if (isQuickFilterType(value)) {
              this.quickFilters.add(value);
            }
          }
        }
      }
    } catch (e) {
      // Ignore invalid preference data
    }

    // Handle mutual exclusivity on load
    this.enforceMutualExclusivity();

    // Sync published filter state
    this.publishedOnlyFilterEnabled = this.quickFilters.has("publishedOnly");
  }

  private saveQuickFiltersToPrefs(): void {
    try {
      setPref(
        QUICK_FILTER_PREF_KEY,
        JSON.stringify(Array.from(this.quickFilters)),
      );
    } catch (e) {
      // Ignore save errors
    }
  }

  private enforceMutualExclusivity(): void {
    // publishedOnly vs preprintOnly
    if (
      this.quickFilters.has("publishedOnly") &&
      this.quickFilters.has("preprintOnly")
    ) {
      this.quickFilters.delete("preprintOnly");
    }

    // recent1Year vs recent5Years
    if (
      this.quickFilters.has("recent1Year") &&
      this.quickFilters.has("recent5Years")
    ) {
      this.quickFilters.delete("recent5Years");
    }

    // localItems vs onlineItems
    if (
      this.quickFilters.has("localItems") &&
      this.quickFilters.has("onlineItems")
    ) {
      this.quickFilters.delete("onlineItems");
    }
  }
}
