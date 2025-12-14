// ─────────────────────────────────────────────────────────────────────────────
// ChartManager - Statistics visualization for References Panel
// Extracted from InspireReferencePanelController as part of controller refactoring
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import { getPref, setPref } from "../../../utils/prefs";
import {
  CHART_THROTTLE_MS,
  CHART_MAX_BAR_WIDTH,
  type ChartBin,
  type InspireReferenceEntry,
} from "../index";
import { CHART_STYLES, toStyleString } from "../styles";

// Local citation ranges for chart (array format for iteration)
const CITATION_RANGES_ARRAY: Array<{
  label: string;
  min: number;
  max: number;
  key: string;
}> = [
  { label: "0", min: 0, max: 0, key: "0" },
  { label: "1-9", min: 1, max: 9, key: "1-9" },
  { label: "10-49", min: 10, max: 49, key: "10-49" },
  { label: "50-99", min: 50, max: 99, key: "50-99" },
  { label: "100-249", min: 100, max: 249, key: "100-249" },
  { label: "250-499", min: 250, max: 499, key: "250-499" },
  { label: "500+", min: 500, max: Infinity, key: "500+" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chart view mode - year distribution or citation distribution.
 */
export type ChartViewMode = "year" | "citation";

/**
 * Chart state for external access.
 */
export interface ChartState {
  viewMode: ChartViewMode;
  collapsed: boolean;
  selectedBins: ReadonlySet<string>;
  excludeSelfCitations: boolean;
}

/**
 * Options for ChartManager initialization.
 */
export interface ChartManagerOptions {
  /** Initial collapsed state (defaults to preference or true) */
  initialCollapsed?: boolean;
  /** Callback when chart selection changes */
  onSelectionChange?: (selectedBins: Set<string>) => void;
  /** Callback to get filtered entries */
  getFilteredEntries: (skipChartFilter: boolean) => InspireReferenceEntry[];
  /** Callback to get citation value for an entry */
  getCitationValue: (entry: InspireReferenceEntry) => number;
  /** Callback when clear all filters is requested */
  onClearAllFilters?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ChartManager Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the chart visualization in the References Panel.
 * Handles chart rendering, view mode toggling, bin selection, and resize handling.
 */
export class ChartManager {
  // DOM Elements
  private container?: HTMLDivElement;
  private svgWrapper?: HTMLDivElement;
  private subHeader?: HTMLDivElement;
  private statsTopLine?: HTMLSpanElement;
  private statsBottomLine?: HTMLSpanElement;

  // State
  private viewMode: ChartViewMode = "year";
  private collapsed: boolean;
  private selectedBins: Set<string> = new Set();
  private lastClickedKey?: string;
  private cachedStats?: { mode: string; stats: ChartBin[] };
  private needsRefresh = true;
  private excludeSelfCitations = false;

  // Rendering
  private lastRenderTime = 0;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private resizeObserver?: ResizeObserver;
  private resizeFrame?: { cancel: (id: number) => void; id: number };
  private lastWidth?: number;

  // Callbacks
  private options: ChartManagerOptions;

  constructor(options: ChartManagerOptions) {
    this.options = options;
    this.collapsed =
      options.initialCollapsed ??
      (getPref("chart_default_collapsed") as boolean) ??
      true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create and return the chart container element.
   */
  createContainer(doc: Document): HTMLDivElement {
    const container = doc.createElement("div");
    container.className = "zinspire-chart-container";
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 6px 10px;
      background: #f8fafc;
      flex-shrink: 0;
      height: auto;
      min-height: auto;
      max-height: auto;
    `;

    // Create header
    const header = this.createHeader(doc);
    container.appendChild(header);

    // Create sub-header
    const subHeader = this.createSubHeader(doc);
    container.appendChild(subHeader);
    this.subHeader = subHeader;

    // Create SVG wrapper
    const svgWrapper = doc.createElement("div");
    svgWrapper.className = "zinspire-chart-svg-wrapper";
    svgWrapper.style.cssText = `
      display: ${this.collapsed ? "none" : "flex"};
      flex-direction: row;
      align-items: flex-end;
      justify-content: space-around;
      height: 80px;
      padding: 4px 0;
      flex-shrink: 0;
    `;
    container.appendChild(svgWrapper);
    this.svgWrapper = svgWrapper;

    this.container = container;
    this.observeResize(container);

    return container;
  }

  /**
   * Get the current chart state.
   */
  getState(): ChartState {
    return {
      viewMode: this.viewMode,
      collapsed: this.collapsed,
      selectedBins: this.selectedBins,
      excludeSelfCitations: this.excludeSelfCitations,
    };
  }

  /**
   * Get selected bin keys.
   */
  getSelectedBins(): ReadonlySet<string> {
    return this.selectedBins;
  }

  /**
   * Check if a chart filter is active.
   */
  hasActiveFilter(): boolean {
    return this.selectedBins.size > 0;
  }

  /**
   * Clear chart bin selection.
   */
  clearSelection(): void {
    this.selectedBins.clear();
    this.lastClickedKey = undefined;
    this.updateClearButton();
    this.options.onSelectionChange?.(this.selectedBins);
  }

  /**
   * Render the chart (throttled).
   */
  render(): void {
    if (!this.svgWrapper) return;
    if (this.collapsed) {
      this.needsRefresh = true;
      return;
    }

    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }

    const now = performance.now();
    const timeSinceLastRender = now - this.lastRenderTime;
    const delay =
      timeSinceLastRender < CHART_THROTTLE_MS
        ? CHART_THROTTLE_MS - timeSinceLastRender
        : 0;

    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      this.lastRenderTime = performance.now();
      this.doRender();
    }, delay);
  }

  /**
   * Render the chart immediately (no throttling).
   */
  renderImmediate(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    if (!this.svgWrapper) return;
    if (this.collapsed) {
      this.needsRefresh = true;
      return;
    }
    this.lastRenderTime = performance.now();
    this.doRender();
    this.needsRefresh = false;
  }

  /**
   * Show loading state in the chart.
   */
  renderLoading(): void {
    if (!this.svgWrapper) return;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    this.svgWrapper.textContent = "";
    const loadingMsg = this.svgWrapper.ownerDocument.createElement("div");
    loadingMsg.className = "zinspire-chart-no-data";
    loadingMsg.style.cssText = toStyleString(CHART_STYLES.noDataItalic);
    loadingMsg.textContent = "Loading...";
    this.svgWrapper.appendChild(loadingMsg);
  }

  /**
   * Invalidate cached stats (call when entries change).
   */
  invalidateCache(): void {
    this.cachedStats = undefined;
  }

  /**
   * Toggle self-citation exclusion.
   */
  setExcludeSelfCitations(exclude: boolean): void {
    this.excludeSelfCitations = exclude;
    this.cachedStats = undefined;
  }

  /**
   * Check if entry matches chart filter.
   */
  matchesFilter(entry: InspireReferenceEntry): boolean {
    if (this.selectedBins.size === 0) return true;

    const stats = this.cachedStats?.stats;
    if (!stats) return true;

    for (const key of this.selectedBins) {
      const bin = stats.find((b) => b.key === key);
      if (!bin) continue;

      // Year-based filter
      if (bin.years?.length) {
        const entryYear = parseInt(entry.year || "0", 10);
        if (bin.years.includes(entryYear)) return true;
      }

      // Citation range filter
      if (bin.range) {
        const citationCount = this.options.getCitationValue(entry);
        if (citationCount >= bin.range[0] && citationCount <= bin.range[1])
          return true;
      }
    }

    return false;
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.clearPendingResize();
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    this.resizeObserver?.disconnect();
    this.cachedStats = undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Header Creation
  // ─────────────────────────────────────────────────────────────────────────────

  private createHeader(doc: Document): HTMLDivElement {
    const header = doc.createElement("div");
    header.className = "zinspire-chart-header";
    header.style.cssText = `
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      margin-bottom: 4px;
      flex-shrink: 0;
    `;

    // Collapse button
    const collapseBtn = this.createCollapseButton(doc);
    header.appendChild(collapseBtn);

    // View toggle buttons
    const yearBtn = this.createToggleButton(doc, "year", true);
    header.appendChild(yearBtn);

    const citationBtn = this.createToggleButton(doc, "citation", false);
    header.appendChild(citationBtn);

    // Clear filter button
    const clearBtn = this.createClearButton(doc);
    header.appendChild(clearBtn);

    // Stats display area
    const statsArea = this.createStatsArea(doc);
    header.appendChild(statsArea);

    return header;
  }

  private createCollapseButton(doc: Document): HTMLButtonElement {
    const btn = doc.createElement("button");
    btn.className = "zinspire-chart-collapse-btn";
    btn.type = "button";
    btn.textContent = this.collapsed ? "▶" : "▼";
    btn.title = getString(
      this.collapsed
        ? "references-panel-chart-expand"
        : "references-panel-chart-collapse",
    );
    btn.style.cssText = `
      border: 1px solid #cbd5e1;
      background: #f1f5f9;
      font-size: 10px;
      cursor: pointer;
      color: #64748b;
      padding: 2px 8px;
      border-radius: 4px;
      flex-shrink: 0;
    `;
    btn.onclick = () => this.toggleCollapse();
    return btn;
  }

  private createToggleButton(
    doc: Document,
    mode: ChartViewMode,
    active: boolean,
  ): HTMLButtonElement {
    const btn = doc.createElement("button");
    btn.className = `zinspire-chart-toggle-btn${active ? " active" : ""}`;
    btn.type = "button";
    btn.textContent = getString(
      mode === "year"
        ? "references-panel-chart-by-year"
        : "references-panel-chart-by-citation",
    );
    btn.dataset.mode = mode;
    btn.style.cssText = `
      border: none;
      border-radius: 5px;
      padding: 3px 10px;
      background: ${active ? "#475569" : "#e2e8f0"};
      font-size: 11px;
      cursor: pointer;
      color: ${active ? "white" : "#475569"};
      flex-shrink: 0;
      font-weight: 500;
    `;
    btn.onclick = () => this.toggleView(mode);
    return btn;
  }

  private createClearButton(doc: Document): HTMLButtonElement {
    const btn = doc.createElement("button");
    btn.className = "zinspire-chart-clear-btn";
    btn.type = "button";
    btn.textContent = "✕";
    btn.title = getString("references-panel-chart-clear-filter");
    btn.style.cssText = `
      border: none;
      background: #fee2e2;
      font-size: 11px;
      cursor: pointer;
      color: #dc2626;
      padding: 3px 8px;
      border-radius: 5px;
      flex-shrink: 0;
      display: none;
      margin-left: 4px;
      font-weight: 500;
    `;
    btn.onclick = () => this.options.onClearAllFilters?.();
    return btn;
  }

  private createStatsArea(doc: Document): HTMLDivElement {
    const area = doc.createElement("div");
    area.className = "zinspire-chart-stats-area";
    area.style.cssText = `
      display: flex;
      flex-direction: column;
      flex: 1;
      align-items: flex-end;
      justify-content: center;
      gap: 1px;
      font-size: 11px;
      color: #64748b;
      overflow: hidden;
      white-space: nowrap;
    `;

    const topLine = doc.createElement("span");
    topLine.className = "zinspire-chart-stats-top";
    area.appendChild(topLine);
    this.statsTopLine = topLine;

    const bottomLine = doc.createElement("span");
    bottomLine.className = "zinspire-chart-stats-bottom";
    area.appendChild(bottomLine);
    this.statsBottomLine = bottomLine;

    return area;
  }

  private createSubHeader(doc: Document): HTMLDivElement {
    const subHeader = doc.createElement("div");
    subHeader.className = "zinspire-chart-subheader";
    subHeader.style.cssText = `
      display: ${this.collapsed ? "none" : "flex"};
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      font-size: 11px;
      margin-bottom: 4px;
      margin-left: 0;
      padding-left: 0;
      width: 100%;
      flex-shrink: 0;
    `;
    return subHeader;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: View Toggle
  // ─────────────────────────────────────────────────────────────────────────────

  private toggleView(mode: ChartViewMode): void {
    if (!this.isEnabled()) {
      this.showDisabledMessage();
      return;
    }
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.cachedStats = undefined;

    // Update button styles
    if (this.container) {
      const buttons = this.container.querySelectorAll(
        ".zinspire-chart-toggle-btn",
      );
      buttons.forEach((btn) => {
        const isActive = (btn as HTMLElement).dataset.mode === mode;
        (btn as HTMLElement).style.background = isActive
          ? "#475569"
          : "#e2e8f0";
        (btn as HTMLElement).style.color = isActive ? "white" : "#475569";
      });
    }

    // Clear selection on mode change
    this.selectedBins.clear();
    this.lastClickedKey = undefined;
    this.updateClearButton();
    this.render();
  }

  private toggleCollapse(): void {
    if (!this.isEnabled() && this.collapsed) {
      this.showDisabledMessage();
      return;
    }

    this.collapsed = !this.collapsed;
    setPref("chart_default_collapsed", this.collapsed);

    if (this.container && this.svgWrapper) {
      const collapseBtn = this.container.querySelector(
        ".zinspire-chart-collapse-btn",
      );

      if (this.collapsed) {
        this.svgWrapper.style.display = "none";
        this.subHeader?.style.setProperty("display", "none");
        this.cachedStats = undefined;
        this.lastClickedKey = undefined;
        this.clearStatsDisplay();
        this.updateClearButton();
        this.container.style.height = "auto";
        this.container.style.minHeight = "auto";
        this.container.style.maxHeight = "auto";
        this.container.style.padding = "6px 10px";
      } else {
        this.svgWrapper.style.display = "flex";
        this.subHeader?.style.setProperty("display", "flex");
        this.container.style.height = "auto";
        this.container.style.minHeight = "auto";
        this.container.style.maxHeight = "auto";
        this.container.style.padding = "10px";
        this.renderImmediate();
      }

      if (collapseBtn) {
        collapseBtn.textContent = this.collapsed ? "▶" : "▼";
        (collapseBtn as HTMLButtonElement).title = getString(
          this.collapsed
            ? "references-panel-chart-expand"
            : "references-panel-chart-collapse",
        );
      }
    }
  }

  private isEnabled(): boolean {
    return getPref("chart_enable") !== false;
  }

  private showDisabledMessage(): void {
    // Use Zotero's alert if available
    if (typeof Zotero !== "undefined" && Zotero.alert) {
      // Get the main window for the alert dialog
      const win = Zotero.getMainWindow?.() ?? undefined;
      Zotero.alert(
        win,
        getString("references-panel-chart-disabled-title") || "Chart Disabled",
        getString("references-panel-chart-disabled-message") ||
          "Enable charts in preferences.",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Resize Handling
  // ─────────────────────────────────────────────────────────────────────────────

  private observeResize(container: HTMLDivElement): void {
    if (typeof ResizeObserver === "undefined") return;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        if (newWidth < 50) continue;
        if (
          this.lastWidth !== undefined &&
          Math.abs(newWidth - this.lastWidth) < 2
        ) {
          continue;
        }
        this.lastWidth = newWidth;

        this.clearPendingResize();
        const cancelFn =
          typeof cancelAnimationFrame !== "undefined"
            ? cancelAnimationFrame
            : clearTimeout;
        const raf =
          typeof requestAnimationFrame !== "undefined"
            ? requestAnimationFrame
            : setTimeout;
        const id = raf(() => this.render()) as number;
        this.resizeFrame = { cancel: cancelFn as (id: number) => void, id };
      }
    });

    this.resizeObserver.observe(container);
  }

  private clearPendingResize(): void {
    if (this.resizeFrame) {
      this.resizeFrame.cancel(this.resizeFrame.id);
      this.resizeFrame = undefined;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Stats Computation
  // ─────────────────────────────────────────────────────────────────────────────

  private computeYearStats(
    entries: InspireReferenceEntry[],
    maxBars: number = 10,
  ): ChartBin[] {
    const yearCounts = new Map<number, number>();
    const MAX_BARS = maxBars;
    const MIN_COUNT_PER_BIN = 3;

    for (const entry of entries) {
      const year = parseInt(entry.year || "0", 10);
      if (year > 0) {
        yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
      }
    }

    if (yearCounts.size === 0) return [];

    const sorted = Array.from(yearCounts.entries()).sort((a, b) => a[0] - b[0]);
    const totalCount = sorted.reduce((sum, [, count]) => sum + count, 0);

    const formatYearLabel = (startYear: number, endYear?: number): string => {
      const startStr = "'" + String(startYear).slice(-2);
      if (endYear === undefined || endYear === startYear) {
        return startStr;
      }
      const endStr = "'" + String(endYear).slice(-2);
      return `${startStr}-${endStr}`;
    };

    const createBin = (years: number[]): ChartBin => {
      const count = years.reduce((sum, y) => sum + (yearCounts.get(y) || 0), 0);
      return {
        label: formatYearLabel(years[0], years[years.length - 1]),
        count,
        years,
        key:
          years.length === 1
            ? String(years[0])
            : `${years[0]}-${years[years.length - 1]}`,
      };
    };

    if (sorted.length <= MAX_BARS) {
      return sorted.map(([year, count]) => ({
        label: formatYearLabel(year),
        count,
        years: [year],
        key: String(year),
      }));
    }

    const targetCountPerBin = Math.max(
      MIN_COUNT_PER_BIN,
      Math.ceil(totalCount / MAX_BARS),
    );
    let bins: ChartBin[] = [];
    let currentYears: number[] = [];
    let currentCount = 0;

    for (let i = 0; i < sorted.length; i++) {
      const [year, count] = sorted[i];
      currentYears.push(year);
      currentCount += count;

      const remainingYears = sorted.length - i - 1;
      const remainingBins = MAX_BARS - bins.length - 1;

      const shouldCreateBin =
        currentCount >= targetCountPerBin ||
        (remainingYears <= remainingBins && currentCount > 0) ||
        i === sorted.length - 1;

      if (shouldCreateBin && currentYears.length > 0) {
        bins.push(createBin(currentYears));
        currentYears = [];
        currentCount = 0;
      }
    }

    while (bins.length > MAX_BARS && bins.length >= 2) {
      let minSum = Infinity;
      let mergeIdx = 0;
      for (let i = 0; i < bins.length - 1; i++) {
        const sum = bins[i].count + bins[i + 1].count;
        if (sum < minSum) {
          minSum = sum;
          mergeIdx = i;
        }
      }
      const allYears = [
        ...(bins[mergeIdx].years || []),
        ...(bins[mergeIdx + 1].years || []),
      ].sort((a, b) => a - b);
      bins = [
        ...bins.slice(0, mergeIdx),
        createBin(allYears),
        ...bins.slice(mergeIdx + 2),
      ];
    }

    while (
      bins.length > 3 &&
      bins[0].count < MIN_COUNT_PER_BIN &&
      bins[0].count + bins[1].count < targetCountPerBin * 1.5
    ) {
      const allYears = [
        ...(bins[0].years || []),
        ...(bins[1].years || []),
      ].sort((a, b) => a - b);
      bins = [createBin(allYears), ...bins.slice(2)];
    }

    return bins;
  }

  private computeCitationStats(entries: InspireReferenceEntry[]): ChartBin[] {
    const counts = new Map<string, number>();
    CITATION_RANGES_ARRAY.forEach((r) => counts.set(r.key, 0));

    for (const entry of entries) {
      const citationCount = this.options.getCitationValue(entry);
      for (const range of CITATION_RANGES_ARRAY) {
        if (citationCount >= range.min && citationCount <= range.max) {
          counts.set(range.key, (counts.get(range.key) || 0) + 1);
          break;
        }
      }
    }

    return CITATION_RANGES_ARRAY.map((r) => ({
      label: r.label,
      count: counts.get(r.key) || 0,
      range: [r.min, r.max === Infinity ? Number.MAX_SAFE_INTEGER : r.max] as [
        number,
        number,
      ],
      key: r.key,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Rendering
  // ─────────────────────────────────────────────────────────────────────────────

  private doRender(): void {
    if (!this.svgWrapper || this.collapsed) return;

    this.svgWrapper.textContent = "";

    const entries = this.options.getFilteredEntries(true);
    if (!entries.length) {
      const noDataMsg = this.svgWrapper.ownerDocument.createElement("div");
      noDataMsg.className = "zinspire-chart-no-data";
      noDataMsg.style.cssText = toStyleString(CHART_STYLES.noData);
      noDataMsg.textContent = getString("references-panel-chart-no-data");
      this.svgWrapper.appendChild(noDataMsg);
      return;
    }

    // Dynamic bar count
    const MAX_BAR_WIDTH = CHART_MAX_BAR_WIDTH;
    const BAR_GAP = 3;
    const PADDING = 16;
    const DEFAULT_MAX_BARS = 10;

    const containerWidth = this.svgWrapper.clientWidth || 400;
    const maxPossibleBars = Math.floor(
      (containerWidth - PADDING + BAR_GAP) / (MAX_BAR_WIDTH + BAR_GAP),
    );
    const dynamicMaxBars = Math.max(
      DEFAULT_MAX_BARS,
      Math.min(maxPossibleBars, 20),
    );

    let stats =
      this.viewMode === "year"
        ? this.computeYearStats(entries, dynamicMaxBars)
        : this.computeCitationStats(entries);

    if (!stats.length && this.viewMode === "year" && entries.length > 0) {
      Zotero.debug(
        `[${config.addonName}] Chart: No year data for ${entries.length} entries, falling back to citation view`,
      );
      stats = this.computeCitationStats(entries);
    }

    if (!stats.length) {
      this.clearStatsDisplay();
      const noDataMsg = this.svgWrapper.ownerDocument.createElement("div");
      noDataMsg.className = "zinspire-chart-no-data";
      noDataMsg.textContent = getString("references-panel-chart-no-data");
      this.svgWrapper.appendChild(noDataMsg);
      return;
    }

    this.cachedStats = { mode: this.viewMode, stats };
    this.updateStatsDisplay(entries);
    this.renderBars(stats);
    this.updateClearButton();
  }

  private renderBars(stats: ChartBin[]): void {
    if (!this.svgWrapper) return;

    const doc = this.svgWrapper.ownerDocument;
    const maxCount = Math.max(...stats.map((s) => s.count), 1);
    const containerWidth = this.svgWrapper.clientWidth || 400;
    const numBars = stats.length;
    const BAR_GAP = 3;
    const PADDING = 16;

    const availableWidth = containerWidth - PADDING;
    const barWidth = Math.min(
      CHART_MAX_BAR_WIDTH,
      Math.max(20, (availableWidth - (numBars - 1) * BAR_GAP) / numBars),
    );

    for (const stat of stats) {
      const barContainer = doc.createElement("div");
      barContainer.className = "zinspire-chart-bar-container";
      barContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        flex: 0 0 ${barWidth}px;
        cursor: pointer;
      `;

      const isSelected = this.selectedBins.has(stat.key);

      // Bar element
      const bar = doc.createElement("div");
      bar.className = "zinspire-chart-bar";
      const heightPercent = Math.max(5, (stat.count / maxCount) * 100);
      bar.style.cssText = `
        width: 100%;
        height: ${heightPercent}%;
        min-height: 4px;
        background: ${isSelected ? "#475569" : "#94a3b8"};
        border-radius: 3px 3px 0 0;
        transition: background 0.15s;
      `;

      // Label
      const label = doc.createElement("div");
      label.className = "zinspire-chart-label";
      label.textContent = stat.label;
      label.style.cssText = `
        font-size: 9px;
        color: ${isSelected ? "#1e293b" : "#64748b"};
        text-align: center;
        margin-top: 2px;
        font-weight: ${isSelected ? "600" : "400"};
      `;

      // Count
      const count = doc.createElement("div");
      count.className = "zinspire-chart-count";
      count.textContent = String(stat.count);
      count.style.cssText = `
        font-size: 9px;
        color: ${isSelected ? "#1e293b" : "#64748b"};
        text-align: center;
        font-weight: ${isSelected ? "600" : "400"};
      `;

      barContainer.appendChild(bar);
      barContainer.appendChild(label);
      barContainer.appendChild(count);

      barContainer.onclick = (event) => this.handleBarClick(stat.key, event);

      this.svgWrapper!.appendChild(barContainer);
    }
  }

  private handleBarClick(key: string, event: MouseEvent): void {
    const isMultiSelect = event.ctrlKey || event.metaKey;
    const isRangeSelect = event.shiftKey;

    if (isRangeSelect && this.lastClickedKey) {
      this.applyShiftSelection(key, isMultiSelect);
    } else if (isMultiSelect) {
      if (this.selectedBins.has(key)) {
        this.selectedBins.delete(key);
      } else {
        this.selectedBins.add(key);
      }
    } else {
      if (this.selectedBins.size === 1 && this.selectedBins.has(key)) {
        this.selectedBins.clear();
      } else {
        this.selectedBins.clear();
        this.selectedBins.add(key);
      }
    }

    this.lastClickedKey = key;
    this.options.onSelectionChange?.(this.selectedBins);
    this.render();
  }

  private applyShiftSelection(key: string, additive: boolean): void {
    const stats = this.cachedStats?.stats;
    if (!stats || !this.lastClickedKey) return;

    const keys = stats.map((s) => s.key);
    const startIdx = keys.indexOf(this.lastClickedKey);
    const endIdx = keys.indexOf(key);

    if (startIdx === -1 || endIdx === -1) return;

    const [from, to] =
      startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const rangeKeys = keys.slice(from, to + 1);

    if (!additive) {
      this.selectedBins.clear();
    }
    for (const k of rangeKeys) {
      this.selectedBins.add(k);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: UI Updates
  // ─────────────────────────────────────────────────────────────────────────────

  private updateClearButton(): void {
    if (!this.container) return;
    const clearBtn = this.container.querySelector(
      ".zinspire-chart-clear-btn",
    ) as HTMLButtonElement;
    if (clearBtn) {
      clearBtn.style.display =
        this.selectedBins.size > 0 ? "inline-block" : "none";
    }
  }

  private updateStatsDisplay(entries: InspireReferenceEntry[]): void {
    if (!this.statsTopLine || !this.statsBottomLine) return;

    const total = entries.length;
    const filtered = this.options.getFilteredEntries(false).length;

    if (this.selectedBins.size > 0 && filtered !== total) {
      this.statsTopLine.textContent = `${filtered} / ${total}`;
      this.statsBottomLine.textContent =
        getString("references-panel-chart-filtered") || "filtered";
    } else {
      this.statsTopLine.textContent = String(total);
      this.statsBottomLine.textContent =
        getString("references-panel-chart-total") || "total";
    }
  }

  private clearStatsDisplay(): void {
    if (this.statsTopLine) this.statsTopLine.textContent = "";
    if (this.statsBottomLine) this.statsBottomLine.textContent = "";
  }
}
