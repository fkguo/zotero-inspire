import { getString } from "../../../utils/locale";
import { getPref, setPref } from "../../../utils/prefs";
import {
  applyPillButtonStyle,
  showTargetPickerUI,
  type SaveTargetRow,
  type SaveTargetSelection,
} from "../../pickerUI";
import { invalidateDarkModeCache, isDarkMode } from "../styles";
import type { CitationGraphSortMode } from "../citationGraphService";
import {
  fetchMultiSeedCitationGraph,
  fetchMultiSeedCitationGraphCached,
} from "../citationGraphMultiSeedService";
import {
  DEFAULT_CITATION_GRAPH_SORT,
  INSPIRE_LITERATURE_URL,
  INSPIRE_API_BASE,
  buildFieldsParam,
} from "../constants";
import { createAbortControllerWithSignal, ReaderTabHelper } from "../utils";
import { copyToClipboard, deriveRecidFromItem, findItemByRecid } from "../apiUtils";
import { fetchReferencesEntries } from "../referencesService";
import type {
  CitationGraphEdgeData,
  CitationGraphNodeData,
  CitationGraphSaveData,
  FavoritePaper,
  FavoritePresentation,
  InspireReferenceEntry,
  MultiSeedGraphResult,
} from "../types";
import { inspireFetch } from "../rateLimiter";
import {
  fetchBibTeX,
  fetchInspireMetaByRecid,
  fetchInspireTexkey,
} from "../metadataService";
import { localCache } from "../localCache";
import { saveItemWithPendingInspireNote, setInspireMeta } from "../itemUpdater";
import { HoverPreviewController } from "./HoverPreviewController";

type RecidSnapshot = { recid: string; title?: string; authorLabel?: string };
type NavSnapshot = { seeds: RecidSnapshot[]; currentRecid: string };
type TimeZoomDomain = { fullMin: number; fullMax: number; zoomMin: number; zoomMax: number };

const SVG_NS = "http://www.w3.org/2000/svg";
const ICON_SVG_NS = "http://www.w3.org/2000/svg";

function buildCitationGraphIconSvg(isDark: boolean): string {
  const green = isDark ? "#059669" : "#10b981";
  const purple = isDark ? "#7c3aed" : "#8b5cf6";
  const gray = isDark ? "#64748b" : "#94a3b8";
  const alpha = isDark ? "0.85" : "1";
  return `
<svg xmlns="${ICON_SVG_NS}" viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" focusable="false">
  <rect x="5" y="3" width="6" height="2" fill="currentColor" rx="1" />
  <rect x="11" y="5" width="2" height="6" fill="currentColor" rx="1" />
  <circle cx="4" cy="4" r="2.2" fill="${green}" fill-opacity="${alpha}" />
  <circle cx="12" cy="4" r="2.2" fill="${purple}" fill-opacity="${alpha}" />
  <polygon points="12,9.59 14.3,11.25 13.41,13.96 10.59,13.96 9.7,11.25" fill="${gray}" fill-opacity="${alpha}" />
</svg>
`.trim();
}

const REFRESH_ICON_SVG = `
<svg xmlns="${ICON_SVG_NS}" viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" focusable="false">
  <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M13 3.10102C11.7295 1.80447 9.95869 1 8 1C4.47353 1 1.55612 3.60771 1.07089 7H2.08296C2.55904 4.16229 5.02701 2 8 2C9.777 2 11.3736 2.7725 12.4722 4L10 4V5L14 5V1H13V3.10102ZM8.00001 15C6.04132 15 4.27052 14.1955 3 12.899V15H2V11H6V12H3.52779C4.62643 13.2275 6.223 14 8.00001 14C10.973 14 13.441 11.8377 13.917 9.00001L14.9291 9.00001C14.4439 12.3923 11.5265 15 8.00001 15Z" />
</svg>
`.trim();

export class CitationGraphDialog {
  private static readonly SPINNER_STYLE_ID =
    "zinspire-citation-graph-spinner-styles";

  private readonly doc: Document;
  private readonly onDispose?: () => void;

  private backdropEl?: HTMLDivElement;
  private dialogEl?: HTMLDivElement;
  private titleEl?: HTMLSpanElement;
  private statusEl?: HTMLSpanElement;
  private svgEl?: SVGSVGElement;
  private svgGroupEl?: SVGGElement;

  private backBtn?: HTMLButtonElement;
  private forwardBtn?: HTMLButtonElement;
  private refreshBtn?: HTMLButtonElement;
  private reviewsBtn?: HTMLButtonElement;
  private relevanceBtn?: HTMLButtonElement;
  private mostCitedBtn?: HTMLButtonElement;
  private mostRecentBtn?: HTMLButtonElement;
  private closeBtn?: HTMLButtonElement;
  private maxResultsInput?: HTMLInputElement;
  private maxResultsValueEl?: HTMLSpanElement;
  private logoEl?: HTMLDivElement;

  private disposed = false;
  private abort?: AbortController;
  private loadSeq = 0;

  private navBack: NavSnapshot[] = [];
  private navForward: NavSnapshot[] = [];
  private current: RecidSnapshot;
  private seeds: RecidSnapshot[] = [];
  private sort: CitationGraphSortMode = DEFAULT_CITATION_GRAPH_SORT;
  private includeReviews = false;
  private refreshLoading = false;

  private addSeedBtn?: HTMLButtonElement;
  private saveBtn?: HTMLButtonElement;
  private exportBtn?: HTMLButtonElement;
  private loadBtn?: HTMLButtonElement;
  private connectionsBtn?: HTMLButtonElement;
  private toolbarMenuEl?: HTMLDivElement;
  private toolbarMenuCleanup?: () => void;
  private seedsPanelEl?: HTMLDivElement;
  private graphResult?: MultiSeedGraphResult;
  private showAllConnections = false;
  private allConnectionEdges: Array<{ source: string; target: string }> = [];
  private allConnectionsGraphKey?: string;
  private connectionsAbort?: AbortController;
  private connectionsLoading = false;

  private addSeedOverlayEl?: HTMLDivElement;
  private addSeedSearchAbort?: AbortController;
  private addSeedSearchTimer?: number;
  private addSeedSearchResultsEl?: HTMLDivElement;
  private addSeedZoteroSearchTimer?: number;
  private addSeedZoteroSearchResultsEl?: HTMLDivElement;
  private addSeedSearchSeq = 0;
  private addSeedZoteroSearchSeq = 0;

  private hoverPreview?: HoverPreviewController;
  private entryByRecid = new Map<string, InspireReferenceEntry>();
  private nodeLabelByRecid = new Map<string, string>();

  private dialogDragCleanup?: () => void;
  private resizeObserver?: ResizeObserver;
  private resizeRenderTimeout?: number;
  private themeCleanup?: () => void;
  private lastDarkMode = false;

  private refsTimeZoom?: TimeZoomDomain;
  private citedTimeZoom?: TimeZoomDomain;
  private timeZoomSeedsKey?: string;

  // Pan/zoom state (applied to svgGroupEl)
  private panX = 0;
  private panY = 0;
  private scale = 1;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private readonly domIdPrefix = `zinspire-citation-graph-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  constructor(
    doc: Document,
    seed: RecidSnapshot | RecidSnapshot[],
    options?: { onDispose?: () => void },
  ) {
    this.doc = doc;
    this.onDispose = options?.onDispose;
    try {
      this.includeReviews = getPref("citation_graph_include_reviews") === true;
    } catch {
      this.includeReviews = false;
    }
    const seeds = Array.isArray(seed) ? seed : [seed];
    this.seeds = this.normalizeSeeds(seeds);
    this.current = this.seeds[0] ?? { recid: "" };
    this.buildUI();
    void this.loadSeeds(this.seeds);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.themeCleanup?.();
    this.themeCleanup = undefined;
    this.abort?.abort();
    this.abort = undefined;
    this.connectionsAbort?.abort();
    this.connectionsAbort = undefined;
    this.addSeedSearchAbort?.abort();
    this.addSeedSearchAbort = undefined;
    if (this.addSeedSearchTimer) {
      clearTimeout(this.addSeedSearchTimer);
      this.addSeedSearchTimer = undefined;
    }
    if (this.addSeedZoteroSearchTimer) {
      clearTimeout(this.addSeedZoteroSearchTimer);
      this.addSeedZoteroSearchTimer = undefined;
    }
    if (this.resizeRenderTimeout) {
      clearTimeout(this.resizeRenderTimeout);
      this.resizeRenderTimeout = undefined;
    }
    this.dialogDragCleanup?.();
    this.dialogDragCleanup = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.hoverPreview?.dispose();
    this.hoverPreview = undefined;

    this.backdropEl?.remove();
    this.backdropEl = undefined;
    this.dialogEl = undefined;
    this.titleEl = undefined;
    this.statusEl = undefined;
    this.svgEl = undefined;
    this.svgGroupEl = undefined;
    this.addSeedOverlayEl = undefined;
    this.addSeedSearchResultsEl = undefined;
    this.addSeedZoteroSearchResultsEl = undefined;
    this.entryByRecid.clear();
    this.nodeLabelByRecid.clear();
    this.graphResult = undefined;
    this.seedsPanelEl = undefined;
    this.addSeedBtn = undefined;
    this.relevanceBtn = undefined;
    this.connectionsBtn = undefined;
    this.logoEl = undefined;
    this.saveBtn = undefined;
    this.exportBtn = undefined;
    this.loadBtn = undefined;
    this.toolbarMenuCleanup?.();
    this.toolbarMenuCleanup = undefined;
    this.toolbarMenuEl?.remove();
    this.toolbarMenuEl = undefined;

    try {
      this.onDispose?.();
    } catch {
      // Ignore dispose callback errors
    }
  }

  private buildUI(): void {
    const dark = isDarkMode();

    const backdrop = this.doc.createElement("div");
    backdrop.className = "zinspire-citation-graph-backdrop";
    backdrop.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      background: rgba(0, 0, 0, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
    `;

    const dialog = this.doc.createElement("div");
    dialog.className = "zinspire-citation-graph-dialog";
    dialog.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(1100px, 92vw);
      height: min(720px, 82vh);
      min-width: 560px;
      min-height: 420px;
      max-width: 96vw;
      max-height: 92vh;
      background: var(--material-background, #ffffff);
      border: 1px solid var(--fill-quinary, #d1d5db);
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: both;
    `;

    const header = this.doc.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--fill-quinary, #e2e8f0);
      background: var(--material-sidepane, #f8fafc);
      cursor: move;
      user-select: none;
    `;

    // Make dialog draggable by the header (ResearchRabbit-like floating window).
    const win = this.doc.defaultView;
    const isDragBlocked = (target: EventTarget | null) => {
      const el = target as Element | null;
      if (!el) return false;
      return Boolean(el.closest("button, input, textarea, select, a"));
    };
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dialogStartLeft = 0;
    let dialogStartTop = 0;

    const onDragMove = (e: MouseEvent) => {
      if (!dragging || this.disposed) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const rect = dialog.getBoundingClientRect();
      const viewportW = this.doc.documentElement?.clientWidth || 800;
      const viewportH = this.doc.documentElement?.clientHeight || 600;
      const maxLeft = Math.max(10, viewportW - rect.width - 10);
      const maxTop = Math.max(10, viewportH - rect.height - 10);
      const nextLeft = Math.max(10, Math.min(dialogStartLeft + dx, maxLeft));
      const nextTop = Math.max(10, Math.min(dialogStartTop + dy, maxTop));
      dialog.style.left = `${nextLeft}px`;
      dialog.style.top = `${nextTop}px`;
      dialog.style.transform = "none";
    };

    const onDragEnd = () => {
      if (!dragging) return;
      dragging = false;
      win?.removeEventListener("mousemove", onDragMove, true);
      win?.removeEventListener("mouseup", onDragEnd, true);
    };

    const onDragStart = (e: MouseEvent) => {
      if (e.button !== 0 || this.disposed) return;
      if (isDragBlocked(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = dialog.getBoundingClientRect();
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dialogStartLeft = rect.left;
      dialogStartTop = rect.top;
      dialog.style.left = `${rect.left}px`;
      dialog.style.top = `${rect.top}px`;
      dialog.style.transform = "none";
      dragging = true;
      win?.addEventListener("mousemove", onDragMove, true);
      win?.addEventListener("mouseup", onDragEnd, true);
    };

    header.addEventListener("mousedown", onDragStart);
    this.dialogDragCleanup = () => {
      header.removeEventListener("mousedown", onDragStart);
      onDragEnd();
    };

    const headerLeft = this.doc.createElement("div");
    headerLeft.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    `;

    const logo = this.doc.createElement("div");
    logo.title =
      getString("references-panel-citation-graph-title") || "Citation Graph";
    logo.innerHTML = buildCitationGraphIconSvg(dark);
    logo.style.cssText = `
      width: 28px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      background: ${dark ? "#2d2d30" : "#e2e8f0"};
      color: ${dark ? "#9ca3af" : "#475569"};
      flex: 0 0 auto;
    `;
    this.logoEl = logo;

    const backBtn = this.doc.createElement("button");
    backBtn.type = "button";
    backBtn.textContent = "←";
    backBtn.title =
      getString("references-panel-citation-graph-back-tooltip") ||
      "Go back to the previous citation graph";
    backBtn.setAttribute(
      "aria-label",
      getString("references-panel-citation-graph-back") ||
        "Previous citation graph",
    );
    applyPillButtonStyle(backBtn, false, dark);
    backBtn.style.padding = "3px 6px";
    backBtn.style.minWidth = "28px";
    backBtn.style.fontWeight = "700";
    backBtn.style.fontSize = "14px";
    backBtn.disabled = true;
    backBtn.addEventListener("click", () => this.goBack());
    this.backBtn = backBtn;

    const forwardBtn = this.doc.createElement("button");
    forwardBtn.type = "button";
    forwardBtn.textContent = "→";
    forwardBtn.title =
      getString("references-panel-citation-graph-forward-tooltip") ||
      "Go forward to the next citation graph";
    forwardBtn.setAttribute(
      "aria-label",
      getString("references-panel-citation-graph-forward") ||
        "Next citation graph",
    );
    applyPillButtonStyle(forwardBtn, false, dark);
    forwardBtn.style.padding = "3px 6px";
    forwardBtn.style.minWidth = "28px";
    forwardBtn.style.fontWeight = "700";
    forwardBtn.style.fontSize = "14px";
    forwardBtn.disabled = true;
    forwardBtn.addEventListener("click", () => this.goForward());
    this.forwardBtn = forwardBtn;

    const headerRight = this.doc.createElement("div");
    headerRight.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    `;

    const refreshBtn = this.doc.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.innerHTML = REFRESH_ICON_SVG;
    const refreshLabel = getString("references-panel-refresh") || "Refresh";
    refreshBtn.title = refreshLabel;
    refreshBtn.setAttribute("aria-label", refreshLabel);
    refreshBtn.classList.add("zinspire-citation-graph-refresh");
    applyPillButtonStyle(refreshBtn, false, dark);
    refreshBtn.style.padding = "3px 6px";
    refreshBtn.style.display = "inline-flex";
    refreshBtn.style.alignItems = "center";
    refreshBtn.style.justifyContent = "center";
    refreshBtn.style.minWidth = "28px";
    refreshBtn.addEventListener("click", () => this.refreshGraph());
    this.refreshBtn = refreshBtn;

    const maxResultsWrap = this.doc.createElement("div");
    maxResultsWrap.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 6px;
      border: 1px solid var(--fill-quinary, #e2e8f0);
      border-radius: 10px;
      background: var(--material-background, #ffffff);
      height: 26px;
      box-sizing: border-box;
    `;

    const maxResultsLabel = this.doc.createElement("span");
    maxResultsLabel.textContent =
      getString("references-panel-citation-graph-nodes-label") || "Nodes";
    maxResultsLabel.style.cssText = `
      font-size: 11px;
      color: var(--fill-secondary, #64748b);
      user-select: none;
      white-space: nowrap;
    `;

    const maxResultsValue = this.doc.createElement("span");
    maxResultsValue.style.cssText = `
      font-size: 11px;
      color: var(--fill-primary, #1e293b);
      font-weight: 600;
      user-select: none;
      min-width: 20px;
      text-align: right;
    `;
    this.maxResultsValueEl = maxResultsValue;

    const maxResultsInput = this.doc.createElement("input");
    maxResultsInput.type = "range";
    maxResultsInput.min = "5";
    maxResultsInput.max = "200";
    maxResultsInput.step = "5";
    maxResultsInput.value = String(this.getMaxResultsPerSide());
    maxResultsInput.style.cssText = `
      width: 110px;
      accent-color: ${dark ? "#a78bfa" : "#6d28d9"};
    `;
    maxResultsInput.addEventListener("input", () => {
      if (!this.maxResultsValueEl) return;
      this.maxResultsValueEl.textContent = String(maxResultsInput.value);
    });
    maxResultsInput.addEventListener("change", () => {
      const next = Number(maxResultsInput.value);
      if (Number.isFinite(next) && next > 0) {
        setPref("citation_graph_max_results", next);
      }
      void this.navigateToSeeds(this.seeds, { pushHistory: false });
    });
    this.maxResultsInput = maxResultsInput;

    maxResultsWrap.appendChild(maxResultsLabel);
    maxResultsWrap.appendChild(maxResultsValue);
    maxResultsWrap.appendChild(maxResultsInput);

    const connectionsBtn = this.doc.createElement("button");
    connectionsBtn.type = "button";
    connectionsBtn.textContent =
      getString("references-panel-citation-graph-toggle-connections") ||
      "Connections";
    connectionsBtn.title = connectionsBtn.textContent;
    applyPillButtonStyle(connectionsBtn, false, dark);
    connectionsBtn.style.padding = "3px 8px";
    connectionsBtn.addEventListener("click", () => {
      this.toggleAllConnections();
    });
    this.connectionsBtn = connectionsBtn;

    const reviewsBtn = this.doc.createElement("button");
    reviewsBtn.type = "button";
    this.reviewsBtn = reviewsBtn;
    this.updateReviewsButton();
    reviewsBtn.title =
      getString("references-panel-citation-graph-toggle-reviews-tooltip") ||
      "Include review articles (including PDG)";
    applyPillButtonStyle(reviewsBtn, this.includeReviews, dark);
    reviewsBtn.style.padding = "3px 8px";
    reviewsBtn.addEventListener("click", () => {
      this.includeReviews = !this.includeReviews;
      this.updateReviewsButton();
      try {
        setPref("citation_graph_include_reviews", this.includeReviews);
      } catch {
        // ignore
      }
      void this.navigateToSeeds(this.seeds, {
        pushHistory: false,
        preferredCurrentRecid: this.current?.recid,
        forceRefresh: true,
      });
    });

    const relevanceBtn = this.doc.createElement("button");
    relevanceBtn.type = "button";
    relevanceBtn.textContent =
      getString("references-panel-sort-related") || "Relevance";
    relevanceBtn.title = relevanceBtn.textContent;
    relevanceBtn.addEventListener("click", () => {
      this.setSort("relevance");
    });
    this.relevanceBtn = relevanceBtn;

    const mostCitedBtn = this.doc.createElement("button");
    mostCitedBtn.type = "button";
    mostCitedBtn.textContent = getString("references-panel-sort-mostcited") || "Most cited";
    mostCitedBtn.title = mostCitedBtn.textContent;
    mostCitedBtn.addEventListener("click", () => {
      this.setSort("mostcited");
    });
    this.mostCitedBtn = mostCitedBtn;

    const mostRecentBtn = this.doc.createElement("button");
    mostRecentBtn.type = "button";
    mostRecentBtn.textContent = getString("references-panel-sort-mostrecent") || "Most recent";
    mostRecentBtn.title = mostRecentBtn.textContent;
    mostRecentBtn.addEventListener("click", () => {
      this.setSort("mostrecent");
    });
    this.mostRecentBtn = mostRecentBtn;

    const addSeedBtn = this.doc.createElement("button");
    addSeedBtn.type = "button";
    addSeedBtn.textContent =
      getString("references-panel-citation-graph-add-seed") || "+ Add Seed";
    addSeedBtn.title = addSeedBtn.textContent;
    applyPillButtonStyle(addSeedBtn, false, dark);
    addSeedBtn.style.padding = "3px 8px";
    addSeedBtn.addEventListener("click", () => this.openAddSeedDialog());
    this.addSeedBtn = addSeedBtn;

    const saveBtn = this.doc.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "💾▾";
    saveBtn.title =
      getString("references-panel-citation-graph-save-file-title") ||
      "Save Citation Graph";
    saveBtn.setAttribute("aria-label", saveBtn.title);
    applyPillButtonStyle(saveBtn, false, dark);
    saveBtn.style.padding = "3px 6px";
    saveBtn.style.minWidth = "28px";
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showSaveMenu(saveBtn);
    });
    this.saveBtn = saveBtn;

    const exportBtn = this.doc.createElement("button");
    exportBtn.type = "button";
    exportBtn.textContent =
      getString("references-panel-citation-graph-export") || "📤 Export▼";
    exportBtn.title = exportBtn.textContent;
    applyPillButtonStyle(exportBtn, false, dark);
    exportBtn.style.padding = "3px 8px";
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showExportMenu(exportBtn);
    });
    this.exportBtn = exportBtn;

    const loadBtn = this.doc.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent =
      getString("references-panel-citation-graph-load") || "📥 Load";
    loadBtn.title = loadBtn.textContent;
    applyPillButtonStyle(loadBtn, false, dark);
    loadBtn.style.padding = "3px 8px";
    loadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.showLoadMenu(loadBtn);
    });
    this.loadBtn = loadBtn;

    const closeBtn = this.doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.title =
      getString("references-panel-citation-graph-close") || "Close";
    closeBtn.style.cssText = `
      width: 28px;
      height: 24px;
      border: 1px solid var(--fill-quinary, #d1d5db);
      background: var(--material-background, #fff);
      color: var(--fill-primary, #1e293b);
      border-radius: 6px;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      user-select: none;
    `;
    closeBtn.addEventListener("click", () => this.dispose());
    this.closeBtn = closeBtn;

    // Sort toggle styles (per-button accent tint for easier scanning)
    this.applySortButtonStyle(relevanceBtn, "relevance");
    this.applySortButtonStyle(mostCitedBtn, "mostcited");
    this.applySortButtonStyle(mostRecentBtn, "mostrecent");

    headerLeft.appendChild(logo);
    headerLeft.appendChild(refreshBtn);
    headerLeft.appendChild(backBtn);
    headerLeft.appendChild(forwardBtn);

    headerRight.appendChild(maxResultsWrap);
    headerRight.appendChild(connectionsBtn);
    headerRight.appendChild(reviewsBtn);
    headerRight.appendChild(relevanceBtn);
    headerRight.appendChild(mostCitedBtn);
    headerRight.appendChild(mostRecentBtn);
    headerRight.appendChild(addSeedBtn);
    headerRight.appendChild(saveBtn);
    headerRight.appendChild(exportBtn);
    headerRight.appendChild(loadBtn);
    headerRight.appendChild(closeBtn);

    header.appendChild(headerLeft);
    header.appendChild(headerRight);

    const body = this.doc.createElement("div");
    body.style.cssText = `
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      background: var(--material-background, #ffffff);
      display: flex;
      flex-direction: column;
    `;

    const graphArea = this.doc.createElement("div");
    graphArea.style.cssText = `
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      background: var(--material-background, #ffffff);
    `;

    const svg = this.doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.display = "block";
    svg.style.cursor = "grab";
    this.svgEl = svg;

    const g = this.doc.createElementNS(SVG_NS, "g");
    this.svgGroupEl = g;
    svg.appendChild(g);

    // Click: open URL. Right-click: expand (re-root).
    svg.addEventListener("click", (e) => this.handleSvgClick(e));
    svg.addEventListener("contextmenu", (e) => this.handleSvgContextMenu(e));

    // Pan/zoom
    svg.addEventListener("mousedown", (e) => this.handlePanStart(e));
    svg.addEventListener("mousemove", (e) => this.handlePanMove(e));
    svg.addEventListener("mouseup", () => this.handlePanEnd());
    svg.addEventListener("mouseleave", () => this.handlePanEnd());
    svg.addEventListener("wheel", (e) => this.handleWheelZoom(e), {
      passive: false,
    });

    // Close on Esc
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.dispose();
      }
    };
    win?.addEventListener("keydown", escHandler);
    const originalDispose = this.dispose.bind(this);
    this.dispose = () => {
      win?.removeEventListener("keydown", escHandler);
      originalDispose();
    };

    graphArea.appendChild(svg);

    const seedsPanel = this.doc.createElement("div");
    seedsPanel.className = "zinspire-citation-graph-seeds";
    seedsPanel.style.cssText = `
      flex: 0 0 auto;
      border-top: 1px solid var(--fill-quinary, #e2e8f0);
      background: var(--material-sidepane, #f8fafc);
      padding: 8px 10px;
      max-height: 132px;
      overflow: auto;
    `;
    this.seedsPanelEl = seedsPanel;

    body.appendChild(graphArea);
    body.appendChild(seedsPanel);

    dialog.appendChild(header);
    dialog.appendChild(body);
    backdrop.appendChild(dialog);
    (this.doc.body || this.doc.documentElement).appendChild(backdrop);

    this.backdropEl = backdrop;
    this.dialogEl = dialog;

    this.ensureSpinnerStyles();
    this.setupResizeObserver();
    this.updateHeader();
    this.startThemeWatcher();
  }

  private startThemeWatcher(): void {
    if (this.themeCleanup) return;

    const win = this.doc.defaultView;
    const mainWin = Zotero.getMainWindow?.();
    const root = mainWin?.document?.documentElement || this.doc.documentElement;
    if (!win || !root) return;

    this.lastDarkMode = isDarkMode();

    const applyIfChanged = () => {
      if (this.disposed) return;
      invalidateDarkModeCache();
      const next = isDarkMode();
      if (next === this.lastDarkMode) return;
      this.lastDarkMode = next;

      // Re-apply inline styles that depend on the dark/light palette.
      this.updateHeader(this.graphResult);
      if (this.graphResult) {
        this.renderGraph(this.graphResult);
      }
    };

    let observer: MutationObserver | undefined;
    const MutationObserverCtor = win.MutationObserver;
    if (MutationObserverCtor) {
      observer = new MutationObserverCtor(() => applyIfChanged());
      observer.observe(root, {
        attributes: true,
        attributeFilter: ["zotero-platform-darkmode", "data-color-scheme"],
      });
    }

    const mq = mainWin?.matchMedia?.("(prefers-color-scheme: dark)");
    let mqCleanup: (() => void) | undefined;
    if (mq) {
      const onChange = () => applyIfChanged();
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onChange);
        mqCleanup = () => mq.removeEventListener("change", onChange);
      } else if (typeof (mq as any).addListener === "function") {
        (mq as any).addListener(onChange);
        mqCleanup = () => (mq as any).removeListener(onChange);
      }
    }

    // Fallback polling (covers cases where Zotero doesn't update attributes)
    const interval = win.setInterval(() => applyIfChanged(), 400);

    this.themeCleanup = () => {
      try {
        observer?.disconnect();
      } catch {
        // ignore
      }
      try {
        mqCleanup?.();
      } catch {
        // ignore
      }
      try {
        win.clearInterval(interval);
      } catch {
        // ignore
      }
    };
  }

  private updateReviewsButton(): void {
    if (!this.reviewsBtn) return;
    const label = this.includeReviews
      ? getString("references-panel-citation-graph-toggle-reviews") || "Incl. reviews"
      : getString("references-panel-citation-graph-toggle-reviews-exclude") ||
        "Excl. reviews";
    this.reviewsBtn.textContent = label;
    this.reviewsBtn.setAttribute("aria-label", label);
  }

  private setupResizeObserver(): void {
    const win = this.doc.defaultView;
    const ResizeObserverCtor = win?.ResizeObserver;
    if (!ResizeObserverCtor || !this.svgEl) {
      return;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserverCtor(() => {
      if (this.disposed || !this.graphResult) {
        return;
      }
      if (this.resizeRenderTimeout) {
        clearTimeout(this.resizeRenderTimeout);
        this.resizeRenderTimeout = undefined;
      }
      this.resizeRenderTimeout = win?.setTimeout(() => {
        this.resizeRenderTimeout = undefined;
        if (this.disposed || !this.graphResult) {
          return;
        }
        this.renderGraph(this.graphResult);
      }, 80);
    });

    this.resizeObserver.observe(this.svgEl);
  }

  private ensureSpinnerStyles(): void {
    try {
      const root = this.doc.head || this.doc.documentElement || this.doc.body;
      if (!root) return;
      if (this.doc.getElementById(CitationGraphDialog.SPINNER_STYLE_ID)) {
        return;
      }
      const style = this.doc.createElement("style");
      style.id = CitationGraphDialog.SPINNER_STYLE_ID;
      style.textContent = `
@keyframes zinspire-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
button.zinspire-citation-graph-refresh.zinspire-citation-graph-refresh--loading svg {
  animation: zinspire-spin 0.9s linear infinite;
  transform-origin: 50% 50%;
  transform-box: fill-box;
  will-change: transform;
}
      `.trim();
      root.appendChild(style);
    } catch {
      // ignore style injection failures
    }
  }

  private setRefreshButtonLoading(loading: boolean): void {
    this.refreshLoading = loading;
    if (!this.refreshBtn) return;
    this.ensureSpinnerStyles();
    this.refreshBtn.classList.toggle(
      "zinspire-citation-graph-refresh--loading",
      loading,
    );
    // Soft-disable: keep layout stable and avoid platform-specific disabled styles.
    this.refreshBtn.style.pointerEvents = loading ? "none" : "";
    this.refreshBtn.style.cursor = loading ? "progress" : "pointer";
    this.refreshBtn.style.opacity = loading ? "0.85" : "";
    this.refreshBtn.setAttribute("aria-busy", loading ? "true" : "false");
  }

  private hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace("#", "").trim();
    const full =
      normalized.length === 3
        ? normalized
            .split("")
            .map((c) => c + c)
            .join("")
        : normalized;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private applySortButtonStyle(
    el: HTMLElement,
    mode: CitationGraphSortMode,
  ): void {
    const dark = isDarkMode();
    const isActive = this.sort === mode;
    applyPillButtonStyle(el, isActive, dark);

    const accent =
      mode === "relevance"
        ? "#8b5cf6"
        : mode === "mostcited"
          ? "#10b981"
          : "#3b82f6";
    const overlayAlpha = isActive ? (dark ? 0.28 : 0.22) : dark ? 0.18 : 0.12;
    const borderAlpha = isActive ? (dark ? 0.55 : 0.45) : dark ? 0.28 : 0.22;

    const baseBg = isActive
      ? dark
        ? "#6b7280"
        : "#475569"
      : dark
        ? "#2d2d30"
        : "#e2e8f0";
    el.style.background = `linear-gradient(0deg, ${this.hexToRgba(
      accent,
      overlayAlpha,
    )}, ${this.hexToRgba(accent, overlayAlpha)}), ${baseBg}`;
    el.style.boxShadow = `inset 0 0 0 1px ${this.hexToRgba(accent, borderAlpha)}`;
  }

  private updateHeader(result?: MultiSeedGraphResult): void {
    if (this.titleEl) {
      // Keep header compact (buttons take most space); details are shown in Seeds panel.
      this.titleEl.textContent =
        getString("references-panel-citation-graph-title") || "Citation Graph";
    }

    if (this.statusEl) {
      const hint =
        getString(
          this.seeds.length > 1
            ? "references-panel-citation-graph-hint-multi"
            : "references-panel-citation-graph-hint",
        ) || "Click to open · Right-click to expand · Cmd/Ctrl+click to add seed";

      if (!result) {
        this.statusEl.textContent = hint;
      } else {
        const connectionsHint = this.showAllConnections
          ? this.connectionsLoading
            ? ` · ${
                getString("references-panel-citation-graph-connections-loading") ||
                "Connections: loading…"
              }`
            : ` · ${
                getString("references-panel-citation-graph-connections-count", {
                  args: { count: this.allConnectionEdges.length },
                }) || `Connections: ${this.allConnectionEdges.length}`
              }`
          : "";
        this.statusEl.textContent = `Refs ${result.shown.references}/${result.totals.references} · Cited-by ${result.shown.citedBy}/${result.totals.citedBy}${connectionsHint} · ${hint}`;
      }
    }

    const dark = isDarkMode();
    if (this.logoEl) {
      this.logoEl.innerHTML = buildCitationGraphIconSvg(dark);
      this.logoEl.style.background = dark ? "#2d2d30" : "#e2e8f0";
      this.logoEl.style.color = dark ? "#9ca3af" : "#475569";
    }
    if (this.relevanceBtn) {
      this.applySortButtonStyle(this.relevanceBtn, "relevance");
    }
    if (this.mostCitedBtn) {
      this.applySortButtonStyle(this.mostCitedBtn, "mostcited");
    }
    if (this.mostRecentBtn) {
      this.applySortButtonStyle(this.mostRecentBtn, "mostrecent");
    }
    if (this.addSeedBtn) {
      applyPillButtonStyle(this.addSeedBtn, false, dark);
    }
    if (this.connectionsBtn) {
      applyPillButtonStyle(this.connectionsBtn, this.showAllConnections, dark);
    }
    if (this.reviewsBtn) {
      this.updateReviewsButton();
      applyPillButtonStyle(this.reviewsBtn, this.includeReviews, dark);
    }
    if (this.saveBtn) {
      applyPillButtonStyle(this.saveBtn, false, dark);
    }
    if (this.exportBtn) {
      applyPillButtonStyle(this.exportBtn, false, dark);
    }
    if (this.loadBtn) {
      applyPillButtonStyle(this.loadBtn, false, dark);
    }
    if (this.backBtn) {
      const enabled = this.navBack.length > 0;
      this.backBtn.disabled = !enabled;
      applyPillButtonStyle(this.backBtn, false, dark);
      this.backBtn.style.opacity = enabled ? "1" : dark ? "0.45" : "0.4";
      this.backBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    }
    if (this.forwardBtn) {
      const enabled = this.navForward.length > 0;
      this.forwardBtn.disabled = !enabled;
      applyPillButtonStyle(this.forwardBtn, false, dark);
      this.forwardBtn.style.opacity = enabled ? "1" : dark ? "0.45" : "0.4";
      this.forwardBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    }
    if (this.refreshBtn) {
      applyPillButtonStyle(this.refreshBtn, false, dark);
      // Keep spinner/disabled state stable across style refreshes.
      this.setRefreshButtonLoading(this.refreshLoading);
    }
    if (this.maxResultsInput) {
      this.maxResultsInput.style.accentColor = dark ? "#a78bfa" : "#6d28d9";
      const value = String(this.getMaxResultsPerSide());
      if (this.maxResultsInput.value !== value) {
        this.maxResultsInput.value = value;
      }
      if (this.maxResultsValueEl) {
        this.maxResultsValueEl.textContent = value;
      }
    }
  }

  private setSort(sort: CitationGraphSortMode): void {
    if (this.sort === sort) {
      return;
    }
    this.sort = sort;
    void this.navigateToSeeds(this.seeds, { pushHistory: false });
  }

  private getMaxResultsPerSide(): number {
    try {
      const raw = getPref("citation_graph_max_results");
      const parsed = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(parsed)) {
        return 25;
      }
      const clamped = Math.max(5, Math.min(200, Math.floor(parsed)));
      return clamped > 0 ? clamped : 25;
    } catch {
      return 25;
    }
  }

  private captureNavSnapshot(): NavSnapshot {
    const seeds = this.normalizeSeeds(this.seeds.map((s) => ({ ...s })));
    const currentRecid = this.current?.recid || seeds[0]?.recid || "";
    return { seeds, currentRecid };
  }

  private async navigateToSeeds(
    seeds: RecidSnapshot[],
    options: { pushHistory: boolean; preferredCurrentRecid?: string; forceRefresh?: boolean },
  ): Promise<void> {
    const nextSeeds = this.normalizeSeeds(seeds);
    if (options.pushHistory) {
      const snapshot = this.captureNavSnapshot();
      const sameRecids =
        snapshot.seeds.length === nextSeeds.length &&
        snapshot.seeds.every((s, i) => s.recid === nextSeeds[i]?.recid);
      if (!sameRecids) {
        this.navBack.push(snapshot);
        if (this.navBack.length > 30) {
          this.navBack.shift();
        }
        this.navForward = [];
      }
    }

    this.resetViewTransform();
    await this.loadSeeds(nextSeeds, {
      preferredCurrentRecid: options.preferredCurrentRecid,
      forceRefresh: options.forceRefresh,
    });
  }

  private goBack(): void {
    const prev = this.navBack.pop();
    if (!prev) return;
    this.navForward.push(this.captureNavSnapshot());
    this.resetViewTransform();
    void this.loadSeeds(prev.seeds, {
      preferredCurrentRecid: prev.currentRecid,
      forceRefresh: false,
    });
  }

  private goForward(): void {
    const next = this.navForward.pop();
    if (!next) return;
    this.navBack.push(this.captureNavSnapshot());
    this.resetViewTransform();
    void this.loadSeeds(next.seeds, {
      preferredCurrentRecid: next.currentRecid,
      forceRefresh: false,
    });
  }

  private refreshGraph(): void {
    void this.navigateToSeeds(this.seeds, {
      pushHistory: false,
      preferredCurrentRecid: this.current?.recid,
      forceRefresh: true,
    });
  }

  private getConnectionsGraphKey(): string {
    const maxPerSide = this.getMaxResultsPerSide();
    const seedsKey = [...this.seeds].map((s) => s.recid).sort().join(",");
    return `${seedsKey}|${this.sort}|${maxPerSide}|rv${this.includeReviews ? 1 : 0}`;
  }

  private toggleAllConnections(): void {
    if (!this.graphResult) {
      this.showToast(
        getString("references-panel-citation-graph-no-graph") || "No graph loaded",
      );
      return;
    }

    const next = !this.showAllConnections;
    this.showAllConnections = next;

    if (!next) {
      this.connectionsAbort?.abort();
      this.connectionsAbort = undefined;
      this.connectionsLoading = false;
      this.updateHeader(this.graphResult);
      this.renderGraph(this.graphResult);
      return;
    }

    const graphKey = this.getConnectionsGraphKey();
    if (this.allConnectionsGraphKey === graphKey && this.allConnectionEdges.length) {
      this.updateHeader(this.graphResult);
      this.renderGraph(this.graphResult);
      return;
    }

    void this.computeAllConnectionsEdges(graphKey);
    this.updateHeader(this.graphResult);
    this.renderGraph(this.graphResult);
  }

  private async computeAllConnectionsEdges(graphKey: string): Promise<void> {
    const graph = this.graphResult;
    if (!graph || this.disposed) return;

    this.connectionsAbort?.abort();
    const { controller, signal } = createAbortControllerWithSignal();
    this.connectionsAbort = controller;
    this.connectionsLoading = true;
    this.allConnectionsGraphKey = graphKey;
    this.allConnectionEdges = [];
    this.updateHeader(graph);

    const displayed = new Set<string>();
    for (const seed of graph.seeds) {
      if (seed?.recid) displayed.add(seed.recid);
    }
    for (const entry of graph.references) {
      if (typeof entry.recid === "string" && entry.recid.trim()) {
        displayed.add(entry.recid.trim());
      }
    }
    for (const entry of graph.citedBy) {
      if (typeof entry.recid === "string" && entry.recid.trim()) {
        displayed.add(entry.recid.trim());
      }
    }

    // Budget guard: avoid hammering the API when too many nodes are shown.
    // (Each displayed node may trigger an INSPIRE refs fetch if not cached.)
    const CONNECTIONS_NODE_LIMIT = 120;
    if (displayed.size > CONNECTIONS_NODE_LIMIT) {
      this.connectionsLoading = false;
      this.showAllConnections = false;
      this.showToast(
        getString("references-panel-citation-graph-connections-too-many") ||
          "Too many nodes for connections. Reduce the Nodes slider and try again.",
      );
      this.updateHeader(graph);
      this.renderGraph(graph);
      return;
    }

    const recids = Array.from(displayed);
    const refsBySource = new Map<string, string[]>();

    const fetchRefRecids = async (recid: string): Promise<void> => {
      if (signal.aborted) return;

      const cached = await localCache.get<InspireReferenceEntry[]>(
        "refs",
        recid,
        undefined,
        { ignoreTTL: true },
      );
      if (cached?.data) {
        refsBySource.set(
          recid,
          cached.data
            .map((e) => e.recid)
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            .map((v) => v.trim()),
        );
        return;
      }

      const entries = await fetchReferencesEntries(recid, { signal }).catch(() => []);
      if (signal.aborted) return;

      refsBySource.set(
        recid,
        entries
          .map((e) => e.recid)
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map((v) => v.trim()),
      );
      void localCache.set("refs", recid, entries, undefined, entries.length);
    };

    // Concurrency-limited fetch to respect INSPIRE rate limits.
    const concurrency = 3;
    let idx = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (!signal.aborted) {
        const currentIdx = idx++;
        if (currentIdx >= recids.length) break;
        await fetchRefRecids(recids[currentIdx]!);
      }
    });
    await Promise.all(workers);

    if (this.disposed || signal.aborted) return;
    if (!this.showAllConnections || this.allConnectionsGraphKey !== graphKey) return;

    const edges: Array<{ source: string; target: string }> = [];
    const seen = new Set<string>();
    for (const source of recids) {
      const targets = refsBySource.get(source) || [];
      for (const target of targets) {
        if (!displayed.has(target)) continue;
        if (target === source) continue;
        const key = `${source}->${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source, target });
      }
    }

    this.allConnectionEdges = edges;
    this.connectionsLoading = false;
    this.updateHeader(graph);
    this.renderGraph(graph);
  }

  private normalizeSeeds(seeds: RecidSnapshot[]): RecidSnapshot[] {
    const seen = new Set<string>();
    const result: RecidSnapshot[] = [];
    for (const seed of seeds) {
      const recid = String(seed?.recid || "").trim();
      if (!recid || seen.has(recid)) continue;
      seen.add(recid);
      result.push({
        recid,
        title: typeof seed.title === "string" ? seed.title : undefined,
        authorLabel:
          typeof seed.authorLabel === "string" ? seed.authorLabel : undefined,
      });
    }
    return result;
  }

  private syncSeedsFromResult(result: MultiSeedGraphResult): void {
    const byRecid = new Map(result.seeds.map((s) => [s.recid, s] as const));
    const next = this.normalizeSeeds(
      this.seeds.map((s) => {
        const info = byRecid.get(s.recid);
        return {
          recid: s.recid,
          title: info?.title || s.title,
          authorLabel: info?.authorLabel || s.authorLabel,
        };
      }),
    );
    // In case seeds were added via import/load in the future.
    for (const seed of result.seeds) {
      if (!next.some((s) => s.recid === seed.recid)) {
        next.push({
          recid: seed.recid,
          title: seed.title,
          authorLabel: seed.authorLabel,
        });
      }
    }
    const currentRecid = this.current?.recid;
    this.seeds = next;
    if (!this.seeds.length) {
      this.seeds = [{ recid: this.current?.recid || "" }];
    }
    this.current =
      (currentRecid && this.seeds.find((s) => s.recid === currentRecid)) ||
      this.seeds[0]!;
  }

  private async loadSeeds(
    seeds: RecidSnapshot[],
    options: { preferredCurrentRecid?: string; forceRefresh?: boolean } = {},
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    const requestId = ++this.loadSeq;

    // Abort any in-flight load (if supported in this environment)
    this.abort?.abort();
    this.abort = undefined;
    // Abort any in-flight connections expansion (depends on current graph set).
    this.connectionsAbort?.abort();
    this.connectionsAbort = undefined;
    this.connectionsLoading = false;
    this.allConnectionEdges = [];
    this.allConnectionsGraphKey = undefined;

    const nextSeeds = this.normalizeSeeds(seeds);
    if (!nextSeeds.length) {
      this.seeds = [];
      this.current = { recid: "" };
      this.graphResult = undefined;
      this.setRefreshButtonLoading(false);
      this.updateHeader(undefined);
      this.renderEmpty();
      this.renderSeedsPanel(undefined);
      return;
    }

    this.seeds = nextSeeds;

    // Keep current seed when possible (for consistency with existing behavior).
    const preferredCurrentRecid =
      typeof options.preferredCurrentRecid === "string" &&
      options.preferredCurrentRecid.trim()
        ? options.preferredCurrentRecid.trim()
        : undefined;
    const currentRecid = preferredCurrentRecid ?? this.current?.recid;
    this.current =
      (currentRecid && this.seeds.find((s) => s.recid === currentRecid)) ||
      this.seeds[0]!;

    const title = this.current.title?.trim()
      ? this.current.title.trim()
      : this.current.recid;
    const { controller, signal } = createAbortControllerWithSignal();
    this.abort = controller;
    this.updateHeader(undefined);
    this.setRefreshButtonLoading(true);

    try {
      const maxPerSide = this.getMaxResultsPerSide();
      const cached = await fetchMultiSeedCitationGraphCached(
        this.seeds.map((s) => s.recid),
        {
          sort: this.sort,
          maxReferences: maxPerSide,
          maxCitedBy: maxPerSide,
          includeReviews: this.includeReviews,
        },
      ).catch(() => null);

      if (this.disposed || requestId !== this.loadSeq || signal.aborted) {
        return;
      }

      const needsEnrich =
        !!cached &&
        (cached.cache.missingSeeds.length > 0 ||
          cached.cache.partialSeeds.length > 0);

      if (cached) {
        this.graphResult = cached.result;
        this.syncSeedsFromResult(cached.result);
        this.updateHeader(cached.result);
        this.renderSeedsPanel(cached.result);
        this.renderGraph(cached.result);

        if (!needsEnrich && options.forceRefresh !== true) {
          // Cached graph fully satisfies the request; avoid unnecessary network calls.
          return;
        }
      } else {
        this.renderLoading();
        this.renderSeedsPanel(undefined);
      }

      const result = await fetchMultiSeedCitationGraph(
        this.seeds.map((s) => s.recid),
        {
          signal,
          sort: this.sort,
          maxReferences: maxPerSide,
          maxCitedBy: maxPerSide,
          forceRefresh: options.forceRefresh === true,
          includeReviews: this.includeReviews,
        },
      );
      if (this.disposed || requestId !== this.loadSeq || signal.aborted) {
        return;
      }
      this.graphResult = result;
      this.syncSeedsFromResult(result);
      this.updateHeader(result);
      this.renderSeedsPanel(result);
      this.renderGraph(result);
      if (this.showAllConnections) {
        void this.computeAllConnectionsEdges(this.getConnectionsGraphKey());
      }
    } catch (err) {
      if (this.disposed || requestId !== this.loadSeq) {
        return;
      }
      if ((err as any)?.name === "AbortError") {
        return;
      }
      // If we already rendered a cached graph, keep it and show a gentle hint.
      if (this.graphResult) {
        this.showToast(
          getString("references-panel-citation-graph-enrich-network-needed") ||
            "Network needed to enrich citation graph. Showing cached results.",
        );
        return;
      }
      this.renderError(String(err));
    } finally {
      if (!this.disposed && requestId === this.loadSeq) {
        this.setRefreshButtonLoading(false);
      }
    }
  }

  private showToast(message: string): void {
    try {
      const pw = new Zotero.ProgressWindow({ closeOnClick: true });
      pw.changeHeadline(
        getString("references-panel-citation-graph-title") || "Citation Graph",
      );
      pw.addDescription(message);
      pw.show();
      setTimeout(() => pw.close(), 2500);
    } catch {
      console.log(`[Citation Graph] ${message}`);
    }
  }

  private getRecentTargets(): { ids: Set<string>; ordered: string[] } {
    const ids = new Set<string>();
    const ordered: string[] = [];
    try {
      const raw = Zotero.Prefs.get("recentSaveTargets") as string | undefined;
      if (!raw) {
        return { ids, ordered };
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry?.id && typeof entry.id === "string") {
            ids.add(entry.id);
            ordered.push(entry.id);
          }
        }
      }
    } catch (_err) {
      Zotero.Prefs.clear("recentSaveTargets");
    }
    return { ids, ordered };
  }

  private rememberRecentTarget(targetID: string): void {
    try {
      const raw = Zotero.Prefs.get("recentSaveTargets") as string | undefined;
      let entries: Array<{ id: string }> = [];
      if (raw) {
        entries = JSON.parse(raw);
      }
      if (!Array.isArray(entries)) {
        entries = [];
      }
      entries = entries.filter((entry) => entry?.id !== targetID);
      entries.unshift({ id: targetID });
      Zotero.Prefs.set("recentSaveTargets", JSON.stringify(entries.slice(0, 5)));
    } catch (_err) {
      Zotero.Prefs.clear("recentSaveTargets");
    }
  }

  private getDefaultTargetID(): string | null {
    const pane = Zotero.getActiveZoteroPane?.();
    if (pane?.getSelectedCollection?.()) {
      const selected = pane.getSelectedCollection();
      if (selected) {
        return `C${selected.id}`;
      }
    }
    const libraryID =
      pane?.getSelectedLibraryID?.() ??
      (Zotero.Libraries as any)?.userLibrary?.libraryID;
    return libraryID ? `L${libraryID}` : null;
  }

  private buildSaveTargets(recentIDs: Set<string>): SaveTargetRow[] {
    const targets: SaveTargetRow[] = [];
    for (const library of Zotero.Libraries.getAll()) {
      if (!library?.editable) {
        continue;
      }
      const libraryID = library.libraryID;
      targets.push({
        id: `L${libraryID}`,
        name: library.name,
        level: 0,
        type: "library",
        libraryID,
        filesEditable: library.filesEditable,
        recent: recentIDs.has(`L${libraryID}`),
      });
      const collections = Zotero.Collections.getByLibrary(libraryID, true) || [];
      for (const collection of collections) {
        const rawLevel = (collection as any)?.level;
        const level = typeof rawLevel === "number" ? rawLevel + 1 : 1;
        targets.push({
          id: collection.treeViewID,
          name: collection.name,
          level,
          type: "collection",
          libraryID,
          collectionID: collection.id,
          filesEditable: library.filesEditable,
          parentID: collection.parentID
            ? `C${collection.parentID}`
            : `L${libraryID}`,
          recent: recentIDs.has(collection.treeViewID),
        });
      }
    }
    return targets;
  }

  private async promptForSaveTarget(): Promise<SaveTargetSelection | null> {
    const recentTargets = this.getRecentTargets();
    const targets = this.buildSaveTargets(recentTargets.ids);
    if (!targets.length) {
      this.showToast(
        getString("references-panel-picker-empty") || "No writable libraries",
      );
      return null;
    }

    let defaultID = this.getDefaultTargetID();
    if (!defaultID) {
      defaultID = recentTargets.ordered[0] || targets[0]?.id || null;
    }

    const mainWindow = Zotero.getMainWindow?.();
    const doc = mainWindow?.document || this.doc;
    const container =
      (doc.getElementById("browser") as HTMLElement | null) ||
      (doc.documentElement as HTMLElement | null) ||
      (doc.body as HTMLElement | null);
    if (!container) {
      this.showToast("Main window container not available");
      return null;
    }

    // Use an invisible fixed anchor so the picker appears in a stable location.
    const anchor = doc.createElement("div");
    anchor.style.position = "fixed";
    anchor.style.left = "50%";
    anchor.style.top = "25%";
    anchor.style.width = "10px";
    anchor.style.height = "10px";
    anchor.style.pointerEvents = "none";
    anchor.style.opacity = "0";
    container.appendChild(anchor);

    try {
      const selection = await showTargetPickerUI(
        targets,
        defaultID,
        anchor,
        container,
        container,
      );
      if (selection?.primaryRowID) {
        this.rememberRecentTarget(selection.primaryRowID);
      }
      return selection;
    } finally {
      anchor.remove();
    }
  }

  private applyLocalItemId(recid: string, itemID: number): void {
    const graph = this.graphResult;
    if (!graph) return;

    for (const seed of graph.seeds) {
      if (seed.recid === recid) {
        seed.localItemID = itemID;
      }
    }
    for (const entry of graph.references) {
      if (entry.recid === recid) {
        entry.localItemID = itemID;
      }
    }
    for (const entry of graph.citedBy) {
      if (entry.recid === recid) {
        entry.localItemID = itemID;
      }
    }

    const mapped = this.entryByRecid.get(recid);
    if (mapped) {
      mapped.localItemID = itemID;
    }
  }

  private async importEntryToLibrary(entry: InspireReferenceEntry): Promise<void> {
    if (this.disposed) return;

    const recid = typeof entry.recid === "string" ? entry.recid.trim() : "";
    if (!recid) {
      this.showToast(getString("references-panel-toast-missing") || "Missing recid");
      return;
    }

    const existing = await findItemByRecid(recid).catch(() => null);
    if (existing?.id) {
      entry.localItemID = existing.id;
      this.applyLocalItemId(recid, existing.id);
      if (this.graphResult) {
        this.updateHeader(this.graphResult);
        this.renderGraph(this.graphResult);
      }
      return;
    }

    const target = await this.promptForSaveTarget();
    if (!target) {
      return;
    }

    const meta = await fetchInspireMetaByRecid(recid);
    if (meta === -1) {
      this.showToast(getString("references-panel-toast-missing") || "Record not found");
      return;
    }

    const newItem = new Zotero.Item("journalArticle");
    newItem.libraryID = target.libraryID;
    const collectionIDs = Array.from(new Set(target.collectionIDs)).filter(
      (id): id is number => typeof id === "number",
    );
    newItem.setField("extra", "");
    newItem.setCollections(collectionIDs.length ? collectionIDs : []);

    if (Array.isArray(target.tags) && target.tags.length) {
      for (const tag of target.tags) {
        if (typeof tag === "string" && tag.trim()) {
          newItem.addTag(tag.trim());
        }
      }
    }

    await setInspireMeta(newItem, meta as any, "full");
    await saveItemWithPendingInspireNote(newItem);

    if (target.note) {
      const note = new Zotero.Item("note");
      note.setNote(target.note);
      note.parentID = newItem.id;
      note.libraryID = newItem.libraryID;
      await note.saveTx();
    }

    entry.localItemID = newItem.id;
    this.applyLocalItemId(recid, newItem.id);

    this.showToast(getString("references-panel-toast-added") || "Added to Zotero");
    if (this.graphResult) {
      this.updateHeader(this.graphResult);
      this.renderGraph(this.graphResult);
    }
  }

  private getFavoritePapers(): FavoritePaper[] {
    try {
      const json = getPref("favorite_papers") as string;
      const parsed = JSON.parse(json || "[]") as unknown;
      return Array.isArray(parsed) ? (parsed as FavoritePaper[]) : [];
    } catch {
      return [];
    }
  }

  private saveFavoritePapers(favorites: FavoritePaper[]): void {
    try {
      setPref("favorite_papers", JSON.stringify(favorites));
    } catch {
      // ignore
    }
  }

  private getFavoritePresentations(): FavoritePresentation[] {
    try {
      const json = getPref("favorite_presentations") as string;
      const parsed = JSON.parse(json || "[]") as unknown;
      return Array.isArray(parsed) ? (parsed as FavoritePresentation[]) : [];
    } catch {
      return [];
    }
  }

  private saveFavoritePresentations(favorites: FavoritePresentation[]): void {
    try {
      setPref("favorite_presentations", JSON.stringify(favorites));
    } catch {
      // ignore
    }
  }

  private isEntryFavorite(recid?: string, itemID?: number): boolean {
    const papers = this.getFavoritePapers();
    const presentations = this.getFavoritePresentations();

    const check = (f: FavoritePaper | FavoritePresentation) => {
      if (itemID && f.itemID) {
        return f.itemID === itemID;
      }
      return !!recid && !!f.recid && f.recid === recid;
    };

    return papers.some(check) || presentations.some(check);
  }

  private toggleEntryFavorite(entry: InspireReferenceEntry): void {
    if (!entry.recid && !entry.localItemID) {
      return;
    }

    let isPresentation = false;
    if (entry.localItemID) {
      const item = Zotero.Items.get(entry.localItemID);
      if (item?.itemType === "presentation") {
        isPresentation = true;
      }
    }

    const favorites = isPresentation
      ? this.getFavoritePresentations()
      : this.getFavoritePapers();

    const existingIndex = favorites.findIndex((f) => {
      if (entry.localItemID && f.itemID) {
        return f.itemID === entry.localItemID;
      }
      return !!entry.recid && !!f.recid && f.recid === entry.recid;
    });

    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1);
      this.showToast(
        getString(
          isPresentation
            ? "references-panel-favorite-presentation-removed"
            : "references-panel-favorite-paper-removed",
        ),
      );
    } else {
      const firstAuthorFull = entry.authors?.[0];
      let authorSurname: string | undefined;
      if (firstAuthorFull) {
        const commaIdx = firstAuthorFull.indexOf(",");
        authorSurname =
          commaIdx > 0
            ? firstAuthorFull.substring(0, commaIdx).trim()
            : firstAuthorFull.trim();
      }
      const authors = authorSurname
        ? entry.authors && entry.authors.length > 1
          ? `${authorSurname} et al.`
          : authorSurname
        : undefined;
      const year = entry.year ? parseInt(entry.year, 10) : undefined;
      const title =
        entry.titleOriginal?.trim() ||
        entry.title?.trim() ||
        entry.displayText?.trim() ||
        "Untitled";

      favorites.push({
        recid: entry.recid || undefined,
        itemID: entry.localItemID,
        title,
        authors,
        year: Number.isFinite(year) ? year : undefined,
        addedAt: Date.now(),
      });
      this.showToast(
        getString(
          isPresentation
            ? "references-panel-favorite-presentation-added"
            : "references-panel-favorite-paper-added",
        ),
      );
    }

    if (isPresentation) {
      this.saveFavoritePresentations(favorites as FavoritePresentation[]);
    } else {
      this.saveFavoritePapers(favorites as FavoritePaper[]);
    }
  }

  private ensureHoverPreview(): HoverPreviewController | null {
    if (this.hoverPreview) {
      return this.hoverPreview;
    }

    const container =
      this.backdropEl || this.dialogEl || this.doc.body || this.doc.documentElement;
    if (!container) {
      return null;
    }

    this.hoverPreview = new HoverPreviewController({
      document: this.doc,
      container,
      clickThrough: true,
      callbacks: {
        onAdd: async (entry) => {
          await this.importEntryToLibrary(entry);
        },
        onSelectInLibrary: (entry) => {
          const itemID = entry.localItemID;
          if (typeof itemID !== "number") return;
          try {
            const pane = Zotero.getActiveZoteroPane();
            void pane?.selectItems?.([itemID]);
          } catch {
            // ignore
          }
        },
        onCopyBibtex: async (entry) => {
          const recid = entry.recid;
          if (!recid) return;
          const bibtex = await fetchBibTeX(recid).catch(() => null);
          if (!bibtex) {
            this.showToast(
              getString("copy-error-bibtex-failed") || "Failed to fetch BibTeX",
            );
            return;
          }
          await copyToClipboard(bibtex);
          this.showToast(getString("references-panel-bibtex-copied") || "BibTeX copied to clipboard");
        },
        onCopyTexkey: async (entry) => {
          const resolved =
            (typeof entry.texkey === "string" ? entry.texkey.trim() : "") ||
            (entry.recid
              ? await fetchInspireTexkey(entry.recid).catch(() => null)
              : null);
          if (!resolved) {
            this.showToast(
              getString("copy-error-no-citation-key") || "No citation key",
            );
            return;
          }
          await copyToClipboard(resolved);
          this.showToast(
            getString("references-panel-texkey-copied") ||
              "TeX key copied to clipboard",
          );
        },
        isFavorite: (entry) =>
          this.isEntryFavorite(entry.recid, entry.localItemID),
        onToggleFavorite: (entry) => {
          this.toggleEntryFavorite(entry);
        },
      },
    });

    return this.hoverPreview;
  }

  private closeToolbarMenu(): void {
    this.toolbarMenuCleanup?.();
    this.toolbarMenuCleanup = undefined;
    this.toolbarMenuEl?.remove();
    this.toolbarMenuEl = undefined;
  }

  private showToolbarMenu(
    anchor: HTMLElement,
    items: Array<{
      label: string;
      disabled?: boolean;
      onClick: () => void | Promise<void>;
    }>,
  ): void {
    this.closeToolbarMenu();

    const menu = this.doc.createElement("div");
    menu.style.cssText = `
      position: fixed;
      z-index: 2147483005;
      background: var(--material-background, #ffffff);
      border: 1px solid var(--fill-quinary, #d1d5db);
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
      padding: 6px;
      min-width: 220px;
    `;

    const rect = anchor.getBoundingClientRect();
    const viewportWidth = this.doc.documentElement?.clientWidth || 800;
    const viewportHeight = this.doc.documentElement?.clientHeight || 600;
    const left = Math.min(Math.max(10, rect.left), viewportWidth - 240);
    const top = Math.min(Math.max(10, rect.bottom + 6), viewportHeight - 260);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    for (const item of items) {
      const row = this.doc.createElement("div");
      row.textContent = item.label;
      row.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 6px 10px;
        border-radius: 8px;
        font-size: 12px;
        color: var(--fill-primary, #1e293b);
        cursor: ${item.disabled ? "default" : "pointer"};
        opacity: ${item.disabled ? "0.55" : "1"};
        user-select: none;
      `;

      if (!item.disabled) {
        row.addEventListener("mouseenter", () => {
          row.style.background = "var(--fill-quinary, #f1f5f9)";
        });
        row.addEventListener("mouseleave", () => {
          row.style.background = "transparent";
        });
      }

      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (item.disabled) {
          return;
        }
        this.closeToolbarMenu();
        try {
          void Promise.resolve(item.onClick());
        } catch {
          // Ignore menu action errors
        }
      });

      menu.appendChild(row);
    }

    (this.doc.body || this.doc.documentElement).appendChild(menu);
    this.toolbarMenuEl = menu;

    const win = this.doc.defaultView;
    const onGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && menu.contains(target)) {
        return;
      }
      this.closeToolbarMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.closeToolbarMenu();
      }
    };
    win?.addEventListener("mousedown", onGlobalMouseDown, true);
    win?.addEventListener("keydown", onKeyDown, true);
    this.toolbarMenuCleanup = () => {
      win?.removeEventListener("mousedown", onGlobalMouseDown, true);
      win?.removeEventListener("keydown", onKeyDown, true);
    };
  }

  private showSaveMenu(anchor: HTMLElement): void {
    const hasGraph = Boolean(this.graphResult);
    this.showToolbarMenu(anchor, [
      {
        label:
          getString("references-panel-citation-graph-save-to-data-dir") ||
          "Save to Zotero data directory",
        disabled: !hasGraph,
        onClick: async () => this.saveToDataDirectory(),
      },
      {
        label:
          getString("references-panel-citation-graph-save-as") ||
          "Save as…",
        disabled: !hasGraph,
        onClick: async () => this.saveAs(),
      },
    ]);
  }

  private showExportMenu(anchor: HTMLElement): void {
    const hasGraph = Boolean(this.graphResult);
    this.showToolbarMenu(anchor, [
      {
        label:
          getString("references-panel-citation-graph-export-json") ||
          "Export JSON (full data)…",
        disabled: !hasGraph,
        onClick: async () => this.exportJSON(),
      },
      {
        label:
          getString("references-panel-citation-graph-export-csv") ||
          "Export CSV (nodes)…",
        disabled: !hasGraph,
        onClick: async () => this.exportCSV(),
      },
      {
        label:
          getString("references-panel-citation-graph-export-svg") ||
          "Export SVG…",
        disabled: !this.svgEl,
        onClick: async () => this.exportSVG(),
      },
      {
        label:
          getString("references-panel-citation-graph-export-png") ||
          "Export PNG…",
        disabled: !this.svgEl,
        onClick: async () => this.exportPNG(),
      },
      {
        label:
          getString("references-panel-citation-graph-export-bibtex") ||
          "Export BibTeX…",
        disabled: !hasGraph,
        onClick: async () => this.exportBibTeX(),
      },
    ]);
  }

  private async showLoadMenu(anchor: HTMLElement): Promise<void> {
    const recent = await this.listRecentSavedGraphs(8);
    const items: Array<{ label: string; disabled?: boolean; onClick: () => void | Promise<void> }> = [
      {
        label:
          getString("references-panel-citation-graph-load-from-file") ||
          "Load from file…",
        onClick: async () => this.loadFromFilePicker(),
      },
    ];
    if (recent.length) {
      items.push({
        label:
          getString("references-panel-citation-graph-load-recent") ||
          "Recent saves",
        disabled: true,
        onClick: () => undefined,
      });
      for (const f of recent) {
        items.push({
          label: f.displayName,
          onClick: async () => this.loadFromPath(f.path),
        });
      }
    }
    this.showToolbarMenu(anchor, items);
  }

  private buildSaveData(): CitationGraphSaveData | null {
    const graph = this.graphResult;
    if (!graph) {
      return null;
    }

    const createdAt = new Date().toISOString();
    const version = "1";

    const nodes: CitationGraphNodeData[] = [];
    const nodeSeen = new Set<string>();

    for (const seed of graph.seeds) {
      if (!seed?.recid || nodeSeen.has(seed.recid)) continue;
      nodeSeen.add(seed.recid);
      nodes.push({
        recid: seed.recid,
        kind: "seed",
        title: seed.title,
        authorLabel: seed.authorLabel,
        year: seed.year,
        citationCount: seed.citationCount,
        localItemID: seed.localItemID,
        inspireUrl: seed.inspireUrl,
      });
    }

    const toNodeData = (
      entry: InspireReferenceEntry,
      kind: CitationGraphNodeData["kind"],
    ): CitationGraphNodeData | null => {
      const recid = entry.recid;
      if (!recid || nodeSeen.has(recid)) return null;
      nodeSeen.add(recid);
      const arxivId =
        typeof entry.arxivDetails === "string"
          ? entry.arxivDetails
          : entry.arxivDetails?.id;
      return {
        recid,
        kind,
        title: entry.title || recid,
        authorLabel: entry.authorText || undefined,
        year: entry.year,
        citationCount: entry.citationCount,
        localItemID: entry.localItemID,
        inspireUrl: entry.inspireUrl,
        arxivId,
        doi: entry.doi,
      };
    };

    for (const entry of graph.references) {
      const node = toNodeData(entry, "reference");
      if (node) nodes.push(node);
    }
    for (const entry of graph.citedBy) {
      const node = toNodeData(entry, "citedBy");
      if (node) nodes.push(node);
    }

    const edges: CitationGraphEdgeData[] = [];
    const edgeSeen = new Set<string>();
    const pushEdge = (edge: CitationGraphEdgeData) => {
      const key = `${edge.type}:${edge.source}->${edge.target}`;
      if (edgeSeen.has(key)) return;
      edgeSeen.add(key);
      edges.push(edge);
    };

    for (const edge of graph.seedEdges) {
      pushEdge({ source: edge.source, target: edge.target, type: "seed-to-seed" });
    }
    const bySeed = graph.bySeed || {};
    for (const [seedRecid, detail] of Object.entries(bySeed)) {
      for (const refRecid of detail.references) {
        pushEdge({ source: seedRecid, target: refRecid, type: "seed-to-reference" });
      }
      for (const citedRecid of detail.citedBy) {
        pushEdge({ source: citedRecid, target: seedRecid, type: "cited-by-to-seed" });
      }
    }

    return {
      version,
      createdAt,
      seeds: graph.seeds.map((s) => ({
        recid: s.recid,
        title: s.title,
        localItemID: s.localItemID,
      })),
      graph: { nodes, edges },
      viewState: { panX: this.panX, panY: this.panY, scale: this.scale },
      settings: { sort: this.sort },
    };
  }

  private buildDefaultSaveFilename(ext: string): string {
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const firstSeed = this.seeds[0]?.recid || "graph";
    const count = this.seeds.length;
    const seedPart = count > 1 ? `${firstSeed}_and_${count - 1}_more` : firstSeed;
    return `citation-graph_${seedPart}_${stamp}${ext}`;
  }

  private async getCitationGraphsDir(): Promise<string | null> {
    try {
      const dataDir = Zotero.DataDirectory?.dir;
      if (!dataDir) return null;
      const dir = PathUtils.join(dataDir, "citation-graphs");
      const exists = await IOUtils.exists(dir);
      if (!exists) {
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
      }
      return dir;
    } catch {
      return null;
    }
  }

  private async listRecentSavedGraphs(limit: number): Promise<Array<{ path: string; displayName: string; lastModified: number }>> {
    const dir = await this.getCitationGraphsDir();
    if (!dir) return [];

    try {
      const exists = await IOUtils.exists(dir);
      if (!exists) return [];

      const children = await IOUtils.getChildren(dir);
      const jsonFiles = children.filter((p) => String(p).toLowerCase().endsWith(".json"));

      const stats = await Promise.all(
        jsonFiles.map(async (path) => {
          try {
            const stat = await IOUtils.stat(path);
            const lastModified = (stat as any)?.lastModified as number | undefined;
            return {
              path,
              lastModified: typeof lastModified === "number" ? lastModified : 0,
            };
          } catch {
            return null;
          }
        }),
      );

      const list = stats
        .filter((v): v is { path: string; lastModified: number } => Boolean(v))
        .sort((a, b) => b.lastModified - a.lastModified)
        .slice(0, Math.max(0, limit))
        .map((f) => ({
          path: f.path,
          displayName: String(f.path).split(/[\\/]/).pop() || f.path,
          lastModified: f.lastModified,
        }));

      return list;
    } catch {
      return [];
    }
  }

  private async promptSaveFile(
    defaultFilename: string,
    title: string,
    filters: Array<{ label: string; pattern: string }>,
  ): Promise<string | null> {
    const win = Zotero.getMainWindow();
    const FilePickerCtor = win && (win as any).FilePicker;
    if (!win || !FilePickerCtor) {
      return null;
    }
    const fp = new FilePickerCtor();
    fp.init(win, title, fp.modeSave);
    for (const f of filters) {
      fp.appendFilter(f.label, f.pattern);
    }
    fp.appendFilters(fp.filterAll);
    fp.defaultString = defaultFilename;
    const result = await fp.show();
    if (result === fp.returnOK || result === fp.returnReplace) {
      return fp.file;
    }
    return null;
  }

  private async promptOpenFile(
    title: string,
    filters: Array<{ label: string; pattern: string }>,
  ): Promise<string | null> {
    const win = Zotero.getMainWindow();
    const FilePickerCtor = win && (win as any).FilePicker;
    if (!win || !FilePickerCtor) {
      return null;
    }
    const fp = new FilePickerCtor();
    fp.init(win, title, fp.modeOpen);
    for (const f of filters) {
      fp.appendFilter(f.label, f.pattern);
    }
    fp.appendFilters(fp.filterAll);
    const result = await fp.show();
    if (result === fp.returnOK) {
      return fp.file;
    }
    return null;
  }

  private async saveToDataDirectory(): Promise<void> {
    const saveData = this.buildSaveData();
    if (!saveData) {
      this.showToast(
        getString("references-panel-citation-graph-save-no-data") ||
          "Nothing to save yet",
      );
      return;
    }

    const dir = await this.getCitationGraphsDir();
    if (!dir) {
      this.showToast(
        getString("references-panel-citation-graph-save-dir-failed") ||
          "Unable to access Zotero data directory",
      );
      return;
    }

    const filename = this.buildDefaultSaveFilename(".json");
    const path = PathUtils.join(dir, filename);
    await IOUtils.writeUTF8(path, JSON.stringify(saveData, null, 2));
    this.showToast(
      getString("references-panel-citation-graph-save-success") || `Saved: ${filename}`,
    );
  }

  private async saveAs(): Promise<void> {
    const saveData = this.buildSaveData();
    if (!saveData) {
      this.showToast(
        getString("references-panel-citation-graph-save-no-data") ||
          "Nothing to save yet",
      );
      return;
    }

    const filePath = await this.promptSaveFile(
      this.buildDefaultSaveFilename(".json"),
      getString("references-panel-citation-graph-save-file-title") || "Save Citation Graph",
      [{ label: "JSON", pattern: "*.json" }],
    );
    if (!filePath) return;

    await Zotero.File.putContentsAsync(filePath, JSON.stringify(saveData, null, 2));
    this.showToast(
      getString("references-panel-citation-graph-save-success") || "Saved",
    );
  }

  private async exportJSON(): Promise<void> {
    await this.saveAs();
  }

  private buildCsv(nodes: CitationGraphNodeData[]): string {
    const escapeCell = (value: unknown) => {
      const s = value === null || value === undefined ? "" : String(value);
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, "\"\"")}"`;
      }
      return s;
    };

    const header = [
      "recid",
      "kind",
      "title",
      "year",
      "citationCount",
      "localItemID",
      "inspireUrl",
      "doi",
      "arxivId",
    ];
    const lines = [header.join(",")];
    for (const n of nodes) {
      lines.push(
        [
          escapeCell(n.recid),
          escapeCell(n.kind),
          escapeCell(n.title || ""),
          escapeCell(n.year || ""),
          escapeCell(typeof n.citationCount === "number" ? n.citationCount : ""),
          escapeCell(typeof n.localItemID === "number" ? n.localItemID : ""),
          escapeCell(n.inspireUrl || ""),
          escapeCell(n.doi || ""),
          escapeCell(n.arxivId || ""),
        ].join(","),
      );
    }
    return lines.join("\n");
  }

  private async exportCSV(): Promise<void> {
    const saveData = this.buildSaveData();
    if (!saveData) {
      this.showToast(
        getString("references-panel-citation-graph-save-no-data") ||
          "Nothing to export yet",
      );
      return;
    }

    const csv = this.buildCsv(saveData.graph.nodes);
    const filePath = await this.promptSaveFile(
      this.buildDefaultSaveFilename(".csv"),
      getString("references-panel-citation-graph-export-file-title") || "Export Citation Graph",
      [{ label: "CSV", pattern: "*.csv" }],
    );
    if (!filePath) return;
    await Zotero.File.putContentsAsync(filePath, csv);
    this.showToast(
      getString("references-panel-citation-graph-export-success") || "Exported",
    );
  }

  private buildStandaloneSvgString(): string | null {
    if (!this.svgEl) return null;
    try {
      const rect = this.svgEl.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const clone = this.svgEl.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", SVG_NS);
      clone.setAttribute("width", String(w));
      clone.setAttribute("height", String(h));
      clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
      const xml = new XMLSerializer().serializeToString(clone);
      return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    } catch {
      return null;
    }
  }

  private async exportSVG(): Promise<void> {
    const svg = this.buildStandaloneSvgString();
    if (!svg) {
      this.showToast(
        getString("references-panel-citation-graph-export-failed") || "Export failed",
      );
      return;
    }

    const filePath = await this.promptSaveFile(
      this.buildDefaultSaveFilename(".svg"),
      getString("references-panel-citation-graph-export-file-title") || "Export Citation Graph",
      [{ label: "SVG", pattern: "*.svg" }],
    );
    if (!filePath) return;
    await Zotero.File.putContentsAsync(filePath, svg);
    this.showToast(
      getString("references-panel-citation-graph-export-success") || "Exported",
    );
  }

  private async exportPNG(): Promise<void> {
    const svg = this.buildStandaloneSvgString();
    if (!svg) {
      this.showToast(
        getString("references-panel-citation-graph-export-failed") || "Export failed",
      );
      return;
    }

    const filePath = await this.promptSaveFile(
      this.buildDefaultSaveFilename(".png"),
      getString("references-panel-citation-graph-export-file-title") || "Export Citation Graph",
      [{ label: "PNG", pattern: "*.png" }],
    );
    if (!filePath) return;

    const rect = this.svgEl?.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect?.width || 800));
    const h = Math.max(1, Math.round(rect?.height || 600));

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = url;
      });

      const scale = 2;
      const canvas = this.doc.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available");
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0, w, h);

      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
      });
      const bytes = new Uint8Array(await pngBlob.arrayBuffer());
      await IOUtils.write(filePath, bytes);
      this.showToast(
        getString("references-panel-citation-graph-export-success") || "Exported",
      );
    } catch (e) {
      this.showToast(
        getString("references-panel-citation-graph-export-failed") || `Export failed: ${e}`,
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private async exportBibTeX(): Promise<void> {
    const saveData = this.buildSaveData();
    if (!saveData) {
      this.showToast(
        getString("references-panel-citation-graph-save-no-data") ||
          "Nothing to export yet",
      );
      return;
    }

    const recids = Array.from(
      new Set(
        saveData.graph.nodes
          .map((n) => n.recid)
          .filter((r) => typeof r === "string" && /^[0-9]+$/.test(r)),
      ),
    );
    if (!recids.length) {
      this.showToast(
        getString("references-panel-citation-graph-export-bibtex-no-recid") ||
          "No INSPIRE recids to export",
      );
      return;
    }

    const filePath = await this.promptSaveFile(
      this.buildDefaultSaveFilename(".bib"),
      getString("references-panel-citation-graph-export-file-title") || "Export Citation Graph",
      [{ label: "BibTeX", pattern: "*.bib" }],
    );
    if (!filePath) return;

    const { controller, signal } = createAbortControllerWithSignal();
    // Reuse dialog-level abort when possible.
    this.abort?.abort();
    this.abort = controller;

    const BATCH_SIZE = 50;
    const chunks: string[] = [];
    for (let i = 0; i < recids.length; i += BATCH_SIZE) {
      if (signal.aborted) break;
      const batch = recids.slice(i, i + BATCH_SIZE);
      const query = batch.map((r) => `recid:${r}`).join(" OR ");
      const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${batch.length}&format=bibtex`;
      const response = await inspireFetch(url, { signal }).catch(() => null);
      if (!response || !response.ok) continue;
      const bib = await response.text();
      if (bib?.trim()) {
        chunks.push(bib.trim());
      }
    }

    await Zotero.File.putContentsAsync(filePath, chunks.join("\n\n"));
    this.showToast(
      getString("references-panel-citation-graph-export-success") || "Exported",
    );
  }

  private buildGraphResultFromSaveData(saveData: CitationGraphSaveData): MultiSeedGraphResult {
    const nodes = Array.isArray(saveData.graph?.nodes) ? saveData.graph.nodes : [];
    const edges = Array.isArray(saveData.graph?.edges) ? saveData.graph.edges : [];

    const seedNodes = nodes
      .filter((n) => n.kind === "seed" && n.recid)
      .map((n) => ({
        recid: n.recid,
        title: n.title || n.recid,
        inspireUrl: n.inspireUrl || `${INSPIRE_LITERATURE_URL}/${n.recid}`,
        authorLabel: n.authorLabel,
        year: n.year,
        citationCount: n.citationCount,
        localItemID: n.localItemID,
        isSeed: true,
      }));

    const makeEntry = (n: CitationGraphNodeData): InspireReferenceEntry => ({
      id: `graph-${n.kind}-${n.recid}`,
      recid: n.recid,
      inspireUrl: n.inspireUrl || `${INSPIRE_LITERATURE_URL}/${n.recid}`,
      title: n.title || n.recid,
      year: n.year || "Unknown",
      authors: [],
      authorText: n.authorLabel || "",
      displayText: n.title || n.recid,
      searchText: "",
      localItemID: n.localItemID,
      citationCount: n.citationCount,
      arxivDetails: n.arxivId || undefined,
      doi: n.doi,
    });

    const references = nodes
      .filter((n) => n.kind === "reference" && n.recid)
      .map(makeEntry);
    const citedBy = nodes
      .filter((n) => n.kind === "citedBy" && n.recid)
      .map(makeEntry);

    const seedEdges = edges
      .filter((e) => e.type === "seed-to-seed" && e.source && e.target)
      .map((e) => ({ source: e.source, target: e.target, type: "seed-to-seed" as const }));

    const bySeed: NonNullable<MultiSeedGraphResult["bySeed"]> = {};
    for (const seed of seedNodes) {
      bySeed[seed.recid] = {
        references: [],
        citedBy: [],
        totals: { references: 0, citedBy: 0 },
        shown: { references: 0, citedBy: 0 },
      };
    }

    for (const e of edges) {
      if (e.type === "seed-to-reference") {
        const bucket = bySeed[e.source];
        if (bucket) bucket.references.push(e.target);
      } else if (e.type === "cited-by-to-seed") {
        const bucket = bySeed[e.target];
        if (bucket) bucket.citedBy.push(e.source);
      }
    }

    for (const seedRecid of Object.keys(bySeed)) {
      const bucket = bySeed[seedRecid]!;
      bucket.totals = {
        references: bucket.references.length,
        citedBy: bucket.citedBy.length,
      };
      bucket.shown = { ...bucket.totals };
    }

    return {
      seeds: seedNodes,
      seedEdges,
      references,
      citedBy,
      totals: { references: references.length, citedBy: citedBy.length },
      shown: { references: references.length, citedBy: citedBy.length },
      sort:
        saveData.settings?.sort === "relevance" ||
        saveData.settings?.sort === "mostrecent" ||
        saveData.settings?.sort === "mostcited"
          ? saveData.settings.sort
          : "mostcited",
      bySeed,
    };
  }

  private applySaveData(saveData: CitationGraphSaveData): void {
    const sort = saveData.settings?.sort;
    if (sort === "relevance" || sort === "mostcited" || sort === "mostrecent") {
      this.sort = sort;
    }

    const view = saveData.viewState;
    if (view && typeof view.panX === "number" && typeof view.panY === "number" && typeof view.scale === "number") {
      this.panX = view.panX;
      this.panY = view.panY;
      this.scale = view.scale;
    } else {
      this.resetViewTransform();
    }

    const seedSnapshots = Array.isArray(saveData.seeds)
      ? saveData.seeds.map((s) => ({ recid: s.recid, title: s.title }))
      : [];
    this.seeds = this.normalizeSeeds(seedSnapshots);
    this.current = this.seeds[0] || { recid: "" };

    const graph = this.buildGraphResultFromSaveData(saveData);
    if (!this.seeds.length) {
      this.seeds = this.normalizeSeeds(
        graph.seeds.map((s) => ({ recid: s.recid, title: s.title, authorLabel: s.authorLabel })),
      );
      this.current = this.seeds[0] || { recid: "" };
    }

    this.graphResult = graph;
    this.syncSeedsFromResult(graph);

    this.updateHeader(graph);
    this.renderSeedsPanel(graph);
    this.renderGraph(graph);
  }

  private async loadFromFilePicker(): Promise<void> {
    const filePath = await this.promptOpenFile(
      getString("references-panel-citation-graph-load-file-title") || "Load Citation Graph",
      [{ label: "JSON", pattern: "*.json" }],
    );
    if (!filePath) return;
    await this.loadFromPath(filePath);
  }

  private async loadFromPath(filePath: string): Promise<void> {
    try {
      // Cancel any in-flight network load.
      this.abort?.abort();
      this.abort = undefined;
      this.loadSeq++;
      this.closeToolbarMenu();
      this.closeAddSeedDialog();

      const saveData = (await IOUtils.readJSON(filePath)) as CitationGraphSaveData;
      if (!saveData || typeof saveData !== "object") {
        this.showToast(
          getString("references-panel-citation-graph-load-failed") ||
            "Invalid file",
        );
        return;
      }
      this.applySaveData(saveData);
      this.showToast(
        getString("references-panel-citation-graph-load-success") || "Loaded",
      );
    } catch (e) {
      this.showToast(
        getString("references-panel-citation-graph-load-failed") || `Load failed: ${e}`,
      );
    }
  }

  private renderSeedsPanel(result?: MultiSeedGraphResult): void {
    if (!this.seedsPanelEl) return;
    this.seedsPanelEl.replaceChildren();

    const seedInfoByRecid = new Map(
      (result?.seeds ?? []).map((s) => [s.recid, s] as const),
    );
    const bySeed = result?.bySeed ?? {};

    const header = this.doc.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    `;

    const title = this.doc.createElement("div");
    title.style.cssText = `
      font-size: 12px;
      font-weight: 600;
      color: var(--fill-primary, #1e293b);
      flex: 0 0 auto;
    `;
    const count = this.seeds.length;
    title.textContent =
      getString("references-panel-citation-graph-seeds-title", {
        args: { count },
      }) || `Seeds (${count})`;

    const hint = this.doc.createElement("div");
    hint.style.cssText = `
      font-size: 11px;
      color: var(--fill-secondary, #64748b);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: right;
      flex: 1 1 auto;
      min-width: 0;
    `;
    hint.textContent =
      getString("references-panel-citation-graph-seeds-hint") ||
      "Click × to remove · Cmd/Ctrl+click node to add seed · Right-click node to open new graph";
    hint.title = hint.textContent;

    header.appendChild(title);
    header.appendChild(hint);
    this.seedsPanelEl.appendChild(header);

    const list = this.doc.createElement("div");
    list.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
      gap: 6px 10px;
    `;

    for (const seed of this.seeds) {
      const info = seedInfoByRecid.get(seed.recid);
      const seedTitle = info?.title || seed.title || seed.recid;
      const authorLabel = info?.authorLabel || seed.authorLabel;
      const seedYear =
        typeof info?.year === "string" && info.year.trim() ? info.year.trim() : "";
      const authorWithYear = (() => {
        const raw = typeof authorLabel === "string" ? authorLabel.trim() : "";
        if (!raw) return seedYear;
        if (seedYear && !/\(\s*\d{4}\s*\)\s*$/.test(raw)) {
          return `${raw} (${seedYear})`;
        }
        return raw;
      })();
      const seedStats = bySeed[seed.recid];

      const row = this.doc.createElement("div");
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border: 1px solid var(--fill-quinary, #e2e8f0);
        border-radius: 8px;
        background: var(--material-background, #ffffff);
      `;

      const dot = this.doc.createElement("span");
      dot.textContent = "⬤";
      dot.style.cssText = `
        color: rgba(139, 92, 246, 0.6);
        font-size: 10px;
        line-height: 1;
        flex: 0 0 auto;
      `;

      const text = this.doc.createElement("div");
      text.style.cssText = `
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      `;

      const line1 = this.doc.createElement("div");
      line1.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: var(--fill-primary, #1e293b);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      line1.textContent = authorWithYear ? `${authorWithYear}: ${seedTitle}` : seedTitle;

      const line2 = this.doc.createElement("div");
      line2.style.cssText = `
        font-size: 11px;
        color: var(--fill-primary, #1e293b);
        opacity: 0.78;
        line-height: 13px;
        min-height: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      const meta: string[] = [];
      if (typeof info?.citationCount === "number") {
        meta.push(`${info.citationCount} citations`);
      }
      if (seedStats) {
        meta.push(`refs: ${seedStats.totals.references}`);
        meta.push(`cited-by: ${seedStats.totals.citedBy}`);
      }
      line2.textContent = meta.join(" · ");

      text.appendChild(line1);
      text.appendChild(line2);

      const removeBtn = this.doc.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.title =
        getString("references-panel-citation-graph-seed-remove") ||
        "Remove seed";
      removeBtn.style.cssText = `
        width: 26px;
        height: 24px;
        border: 1px solid var(--fill-quinary, #d1d5db);
        background: var(--material-background, #fff);
        color: var(--fill-secondary, #64748b);
        border-radius: 6px;
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        user-select: none;
        flex: 0 0 auto;
      `;
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeSeed(seed.recid);
      });

      row.appendChild(dot);
      row.appendChild(text);
      row.appendChild(removeBtn);
      list.appendChild(row);
    }

    this.seedsPanelEl.appendChild(list);
  }

  private addSeed(seed: RecidSnapshot): void {
    const recid = String(seed?.recid || "").trim();
    if (!recid) return;
    if (!/^[0-9]+$/.test(recid)) {
      this.showToast("Invalid INSPIRE recid");
      return;
    }
    if (this.seeds.some((s) => s.recid === recid)) {
      this.showToast(
        getString("references-panel-citation-graph-seed-already-added") ||
          "Seed already added",
      );
      return;
    }
    const next = this.normalizeSeeds([...this.seeds, seed]);
    void this.navigateToSeeds(next, { pushHistory: true });
  }

  private removeSeed(recid: string): void {
    const next = this.seeds.filter((s) => s.recid !== recid);
    void this.navigateToSeeds(next, { pushHistory: true });
  }

  private closeAddSeedDialog(): void {
    this.addSeedSearchAbort?.abort();
    this.addSeedSearchAbort = undefined;
    if (this.addSeedSearchTimer) {
      clearTimeout(this.addSeedSearchTimer);
      this.addSeedSearchTimer = undefined;
    }
    if (this.addSeedZoteroSearchTimer) {
      clearTimeout(this.addSeedZoteroSearchTimer);
      this.addSeedZoteroSearchTimer = undefined;
    }
    this.addSeedSearchResultsEl = undefined;
    this.addSeedZoteroSearchResultsEl = undefined;
    this.addSeedOverlayEl?.remove();
    this.addSeedOverlayEl = undefined;
  }

  private applyAddSeedActionButtonStyle(
    btn: HTMLButtonElement,
    isSeed: boolean,
  ): void {
    const dark = isDarkMode();
    if (isSeed) {
      const label =
        getString("references-panel-citation-graph-add-seed-remove") || "Remove";
      btn.textContent = label;
      btn.title =
        getString("references-panel-citation-graph-seed-remove") ||
        "Remove seed";
      btn.style.cssText = `
        padding: 3px 8px;
        border-radius: 12px;
        border: 1px solid var(--accent-red, #ef4444);
        background: var(--material-background, #fff);
        color: var(--accent-red, #ef4444);
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
      `;
      btn.onmouseenter = () => {
        btn.style.background = "rgba(239, 68, 68, 0.08)";
      };
      btn.onmouseleave = () => {
        btn.style.background = "var(--material-background, #fff)";
      };
      return;
    }

    btn.onmouseenter = null;
    btn.onmouseleave = null;
    const label =
      getString("references-panel-citation-graph-add-seed-add") || "Add";
    btn.textContent = label;
    btn.title = label;
    applyPillButtonStyle(btn, false, dark);
    btn.style.padding = "3px 8px";
    btn.style.whiteSpace = "nowrap";
  }

  private refreshAddSeedDialogButtons(): void {
    const overlay = this.addSeedOverlayEl;
    if (!overlay) return;
    const buttons = overlay.querySelectorAll("button[data-seed-recid]");
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i] as unknown as HTMLButtonElement;
      const recid = btn?.dataset?.seedRecid;
      if (!recid) continue;
      const isSeed = this.seeds.some((s) => s.recid === recid);
      this.applyAddSeedActionButtonStyle(btn, isSeed);
    }
  }

  private scheduleAddSeedSearch(query: string): void {
    if (this.addSeedSearchTimer) {
      clearTimeout(this.addSeedSearchTimer);
      this.addSeedSearchTimer = undefined;
    }
    const win = this.doc.defaultView;
    const cb = () => {
      void this.performAddSeedSearch(query);
    };
    const timer = win ? win.setTimeout(cb, 200) : setTimeout(cb, 200);
    this.addSeedSearchTimer = timer as unknown as number;
  }

  private async performAddSeedSearch(query: string): Promise<void> {
    const targetEl = this.addSeedSearchResultsEl;
    if (!targetEl) return;

    const seq = ++this.addSeedSearchSeq;
    const q = query.trim();
    targetEl.replaceChildren();
    if (q.length < 2) {
      const tip = this.doc.createElement("div");
      tip.style.cssText = `
        font-size: 12px;
        color: var(--fill-secondary, #64748b);
        padding: 10px 0;
      `;
      tip.textContent =
        getString("references-panel-citation-graph-add-seed-search-hint") ||
        "Type to search INSPIRE...";
      targetEl.appendChild(tip);
      return;
    }

    this.addSeedSearchAbort?.abort();
    const { controller, signal } = createAbortControllerWithSignal();
    this.addSeedSearchAbort = controller;

    const fields = buildFieldsParam(
      "control_number,titles.title,authors.full_name,author_count,earliest_date,citation_count",
    );
    const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(q)}&size=20&page=1&sort=mostrecent${fields}`;

    const response = await inspireFetch(url, { signal }).catch(() => null);
    if (!response || !response.ok || signal.aborted) {
      return;
    }
    if (seq !== this.addSeedSearchSeq || this.addSeedSearchResultsEl !== targetEl) {
      return;
    }
    const payload = (await response.json()) as any;
    if (seq !== this.addSeedSearchSeq || this.addSeedSearchResultsEl !== targetEl) {
      return;
    }
    const hits: any[] = Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];

    if (!hits.length) {
      const empty = this.doc.createElement("div");
      empty.style.cssText = `
        font-size: 12px;
        color: var(--fill-secondary, #64748b);
        padding: 10px 0;
      `;
      empty.textContent =
        getString("references-panel-citation-graph-add-seed-no-results") ||
        "No results";
      targetEl.appendChild(empty);
      return;
    }

    const list = this.doc.createElement("div");
    list.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;

    const seenRecids = new Set<string>();
    for (const hit of hits) {
      if (seq !== this.addSeedSearchSeq || this.addSeedSearchResultsEl !== targetEl) {
        return;
      }
      const meta = hit?.metadata || hit || {};
      const recid = String(meta?.control_number || meta?.id || "").trim();
      if (!recid) continue;
      if (seenRecids.has(recid)) continue;
      seenRecids.add(recid);
      const rawTitle = meta?.titles?.[0]?.title;
      const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : `INSPIRE:${recid}`;
      const year = typeof meta?.earliest_date === "string" ? meta.earliest_date.slice(0, 4) : undefined;
      const authors = Array.isArray(meta?.authors)
        ? meta.authors
            .map((a: any) => a?.full_name)
            .filter((v: any): v is string => typeof v === "string" && v.trim().length > 0)
        : [];

      const authorLabel = (() => {
        if (!authors.length) return year || "";
        const first = authors[0];
        const last = first.includes(",")
          ? first.split(",")[0].trim()
          : first.split(" ").pop() || first;
        const a = authors.length > 1 ? `${last} et al.` : last;
        return year ? `${a} (${year})` : a;
      })();

      const row = this.doc.createElement("div");
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border: 1px solid var(--fill-quinary, #e2e8f0);
        border-radius: 8px;
        background: var(--material-background, #ffffff);
      `;

      const text = this.doc.createElement("div");
      text.style.cssText = `
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      `;

      const t1 = this.doc.createElement("div");
      t1.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: var(--fill-primary, #1e293b);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      t1.textContent = authorLabel ? `${authorLabel}: ${title}` : title;

      const t2 = this.doc.createElement("div");
      t2.style.cssText = `
        font-size: 11px;
        color: var(--fill-secondary, #64748b);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      t2.textContent = `${authorLabel} · INSPIRE:${recid}`;

      text.appendChild(t1);
      text.appendChild(t2);

      const addBtn = this.doc.createElement("button");
      addBtn.type = "button";
      addBtn.dataset.seedRecid = recid;
      const isAlreadySeed = this.seeds.some((s) => s.recid === recid);
      this.applyAddSeedActionButtonStyle(addBtn, isAlreadySeed);
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const nextIsSeed = !this.seeds.some((s) => s.recid === recid);
        if (nextIsSeed) {
          this.addSeed({ recid, title, authorLabel });
        } else {
          this.removeSeed(recid);
        }
        this.refreshAddSeedDialogButtons();
      });

      row.appendChild(text);
      row.appendChild(addBtn);
      list.appendChild(row);
    }

    targetEl.appendChild(list);
  }

  private scheduleAddSeedZoteroSearch(query: string): void {
    if (this.addSeedZoteroSearchTimer) {
      clearTimeout(this.addSeedZoteroSearchTimer);
      this.addSeedZoteroSearchTimer = undefined;
    }
    const win = this.doc.defaultView;
    const cb = () => {
      void this.performAddSeedZoteroSearch(query);
    };
    const timer = win ? win.setTimeout(cb, 200) : setTimeout(cb, 200);
    this.addSeedZoteroSearchTimer = timer as unknown as number;
  }

  private async performAddSeedZoteroSearch(query: string): Promise<void> {
    const targetEl = this.addSeedZoteroSearchResultsEl;
    if (!targetEl) return;

    const seq = ++this.addSeedZoteroSearchSeq;
    const q = query.trim();
    targetEl.replaceChildren();
    if (q.length < 2) {
      const tip = this.doc.createElement("div");
      tip.style.cssText = `
        font-size: 12px;
        color: var(--fill-secondary, #64748b);
        padding: 6px 0;
      `;
      tip.textContent =
        getString(
          "references-panel-citation-graph-add-seed-zotero-search-hint",
        ) || "Type to search Zotero...";
      targetEl.appendChild(tip);
      return;
    }

    const isStale = () =>
      seq !== this.addSeedZoteroSearchSeq || this.addSeedZoteroSearchResultsEl !== targetEl;

    let libraryID: number | undefined;
    try {
      const pane = Zotero.getActiveZoteroPane?.();
      const userLibrary =
        (Zotero.Libraries as any)?.userLibrary?.libraryID ??
        (Zotero.Libraries as any)?.userLibraryID;
      libraryID = pane?.getSelectedLibraryID?.() ?? userLibrary;
    } catch {
      libraryID =
        (Zotero.Libraries as any)?.userLibrary?.libraryID ??
        (Zotero.Libraries as any)?.userLibraryID;
    }

    if (!libraryID) {
      return;
    }

    let ids: number[] = [];
    try {
      const search = new Zotero.Search({ libraryID });
      let added = false;
      try {
        search.addCondition("quicksearch-titleCreatorYear", "contains", q);
        added = true;
      } catch {
        // ignored
      }
      if (!added) {
        try {
          search.addCondition("title", "contains", q);
          added = true;
        } catch {
          // ignored
        }
      }
      if (!added) {
        return;
      }
      ids = await search.search();
    } catch {
      ids = [];
    }
    if (isStale()) return;

    const limited = ids.slice(0, 40);
    if (!limited.length) {
      const empty = this.doc.createElement("div");
      empty.style.cssText = `
        font-size: 12px;
        color: var(--fill-secondary, #64748b);
        padding: 6px 0;
      `;
      empty.textContent =
        getString(
          "references-panel-citation-graph-add-seed-zotero-no-results",
        ) || "No Zotero items with INSPIRE IDs found.";
      targetEl.appendChild(empty);
      return;
    }

    const items = await Zotero.Items.getAsync(limited);
    if (isStale()) return;
    const rows: HTMLDivElement[] = [];
    const seenRecids = new Set<string>();

    // Avoid duplicating items already shown in the "current selection" section.
    try {
      const pane: any =
        Zotero.getActiveZoteroPane?.() || (globalThis as any).ZoteroPane;
      const selectedItems = pane?.getSelectedItems?.();
      if (Array.isArray(selectedItems)) {
        for (const item of selectedItems as Zotero.Item[]) {
          if (!item || item.deleted || !item.isRegularItem?.()) continue;
          const recid = deriveRecidFromItem(item)?.trim();
          if (recid) {
            seenRecids.add(recid);
          }
        }
      }
    } catch {
      // ignore
    }

    const buildAuthorLabelFromItem = (item: Zotero.Item): string => {
      try {
        const creators: any[] = (item as any)?.getCreators?.() ?? [];
        const primary = Array.isArray(creators) ? creators[0] : undefined;
        const lastNameRaw =
          (primary?.lastName as string | undefined) ??
          (primary?.name as string | undefined) ??
          "";
        const lastName = typeof lastNameRaw === "string" ? lastNameRaw.trim() : "";
        const authorPart = lastName
          ? creators.length > 1
            ? `${lastName} et al.`
            : lastName
          : "";
        const dateRaw = item.getField?.("date");
        const match =
          typeof dateRaw === "string"
            ? dateRaw.match(/(19|20)\d{2}/)
            : null;
        const year = match ? match[0] : "";
        if (year) {
          return authorPart ? `${authorPart} (${year})` : year;
        }
        return authorPart;
      } catch {
        return "";
      }
    };

    for (const item of items) {
      if (isStale()) return;
      if (!item || item.deleted || !item.isRegularItem?.()) continue;
      const recid = deriveRecidFromItem(item)?.trim();
      if (!recid) continue;
      if (seenRecids.has(recid)) continue;
      seenRecids.add(recid);

      const rawTitle = item.getField("title");
      const title =
        typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : recid;
      const authorLabel = buildAuthorLabelFromItem(item);

      const row = this.doc.createElement("div");
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border: 1px solid var(--fill-quinary, #e2e8f0);
        border-radius: 8px;
        background: var(--material-background, #ffffff);
      `;

      const text = this.doc.createElement("div");
      text.style.cssText = `
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      `;

      const t1 = this.doc.createElement("div");
      t1.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: var(--fill-primary, #1e293b);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      t1.textContent = authorLabel ? `${authorLabel}: ${title}` : title;

      const t2 = this.doc.createElement("div");
      t2.style.cssText = `
        font-size: 11px;
        color: var(--fill-secondary, #64748b);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      t2.textContent = `${authorLabel ? `${authorLabel} · ` : ""}INSPIRE:${recid}`;

      text.appendChild(t1);
      text.appendChild(t2);

      const addBtn = this.doc.createElement("button");
      addBtn.type = "button";
      addBtn.dataset.seedRecid = recid;
      const isAlreadySeed = this.seeds.some((s) => s.recid === recid);
      this.applyAddSeedActionButtonStyle(addBtn, isAlreadySeed);
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const nextIsSeed = !this.seeds.some((s) => s.recid === recid);
        if (nextIsSeed) {
          this.addSeed({ recid, title, authorLabel });
        } else {
          this.removeSeed(recid);
        }
        this.refreshAddSeedDialogButtons();
      });

      row.appendChild(text);
      row.appendChild(addBtn);
      rows.push(row);
    }

    if (!rows.length) {
      const empty = this.doc.createElement("div");
      empty.style.cssText = `
        font-size: 12px;
        color: var(--fill-secondary, #64748b);
        padding: 6px 0;
      `;
      empty.textContent =
        getString(
          "references-panel-citation-graph-add-seed-zotero-no-results",
        ) || "No Zotero items with INSPIRE IDs found.";
      targetEl.appendChild(empty);
      return;
    }

    const list = this.doc.createElement("div");
    list.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;
    for (const row of rows.slice(0, 12)) {
      list.appendChild(row);
    }
    targetEl.appendChild(list);
  }

  private openAddSeedDialog(): void {
    if (!this.dialogEl || this.disposed) return;
    if (this.addSeedOverlayEl) {
      this.closeAddSeedDialog();
      return;
    }

    const overlay = this.doc.createElement("div");
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 20;
      background: rgba(0, 0, 0, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
    `;
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        this.closeAddSeedDialog();
      }
    });

    const panel = this.doc.createElement("div");
    panel.style.cssText = `
      width: min(900px, 94%);
      height: min(560px, 92%);
      background: var(--material-background, #ffffff);
      border: 1px solid var(--fill-quinary, #d1d5db);
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;

    const header = this.doc.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--fill-quinary, #e2e8f0);
      background: var(--material-sidepane, #f8fafc);
    `;

    const title = this.doc.createElement("div");
    title.style.cssText = `
      font-size: 13px;
      font-weight: 700;
      color: var(--fill-primary, #1e293b);
    `;
    title.textContent =
      getString("references-panel-citation-graph-add-seed-title") ||
      "Add Seed Paper";

    const closeBtn = this.doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.title =
      getString("references-panel-citation-graph-close") || "Close";
    closeBtn.style.cssText = `
      width: 28px;
      height: 24px;
      border: 1px solid var(--fill-quinary, #d1d5db);
      background: var(--material-background, #fff);
      color: var(--fill-primary, #1e293b);
      border-radius: 6px;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      user-select: none;
    `;
    closeBtn.addEventListener("click", () => this.closeAddSeedDialog());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const content = this.doc.createElement("div");
    content.style.cssText = `
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: var(--material-background, #ffffff);
    `;

    // Zotero selection section
    const selectionSection = this.doc.createElement("div");
    const selectionTitle = this.doc.createElement("div");
    selectionTitle.style.cssText = `
      font-size: 12px;
      font-weight: 700;
      color: var(--fill-primary, #1e293b);
      margin-bottom: 8px;
    `;
    selectionTitle.textContent =
      getString("references-panel-citation-graph-add-seed-from-zotero") ||
      "From Zotero selection";
    selectionSection.appendChild(selectionTitle);

    const zoteroSearchRow = this.doc.createElement("div");
    zoteroSearchRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    `;

    const zoteroSearchInput = this.doc.createElement("input");
    zoteroSearchInput.type = "text";
    zoteroSearchInput.placeholder =
      getString(
        "references-panel-citation-graph-add-seed-zotero-search-placeholder",
      ) || "Search Zotero...";
    zoteroSearchInput.style.cssText = `
      flex: 1 1 auto;
      min-width: 0;
      border: 1px solid var(--fill-quinary, #d1d5db);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 12px;
      background: var(--material-background, #ffffff);
      color: var(--fill-primary, #1e293b);
    `;
    zoteroSearchInput.addEventListener("input", () => {
      this.scheduleAddSeedZoteroSearch(zoteroSearchInput.value);
    });
    zoteroSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (this.addSeedZoteroSearchTimer) {
          clearTimeout(this.addSeedZoteroSearchTimer);
          this.addSeedZoteroSearchTimer = undefined;
        }
        void this.performAddSeedZoteroSearch(zoteroSearchInput.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeAddSeedDialog();
      }
    });

    const zoteroSearchBtn = this.doc.createElement("button");
    zoteroSearchBtn.type = "button";
    zoteroSearchBtn.textContent =
      getString("references-panel-citation-graph-add-seed-search") || "Search";
    applyPillButtonStyle(zoteroSearchBtn, false, isDarkMode());
    zoteroSearchBtn.style.padding = "3px 8px";
    zoteroSearchBtn.addEventListener("click", () => {
      if (this.addSeedZoteroSearchTimer) {
        clearTimeout(this.addSeedZoteroSearchTimer);
        this.addSeedZoteroSearchTimer = undefined;
      }
      void this.performAddSeedZoteroSearch(zoteroSearchInput.value);
    });

    zoteroSearchRow.appendChild(zoteroSearchInput);
    zoteroSearchRow.appendChild(zoteroSearchBtn);
    selectionSection.appendChild(zoteroSearchRow);

    const zoteroResults = this.doc.createElement("div");
    selectionSection.appendChild(zoteroResults);
    this.addSeedZoteroSearchResultsEl = zoteroResults;
    void this.performAddSeedZoteroSearch("");

    const selectedList = this.doc.createElement("div");
    selectedList.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;

    const selectedItems: Zotero.Item[] = (() => {
      try {
        const pane: any =
          Zotero.getActiveZoteroPane?.() || (globalThis as any).ZoteroPane;
        const items = pane?.getSelectedItems?.();
        return Array.isArray(items) ? (items as Zotero.Item[]) : [];
      } catch {
        return [];
      }
    })();

    const regularItems = selectedItems.filter((item) => item?.isRegularItem?.());
    const rows: HTMLDivElement[] = [];
    const seenRecids = new Set<string>();

    for (const item of regularItems) {
      const recid = deriveRecidFromItem(item)?.trim();
      if (!recid) continue;
      if (seenRecids.has(recid)) continue;
      seenRecids.add(recid);
      const rawTitle = item.getField("title");
      const title =
        typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : recid;
      let authorLabel = "";
      try {
        const creators: any[] = (item as any)?.getCreators?.() ?? [];
        const primary = Array.isArray(creators) ? creators[0] : undefined;
        const lastNameRaw =
          (primary?.lastName as string | undefined) ??
          (primary?.name as string | undefined) ??
          "";
        const lastName = typeof lastNameRaw === "string" ? lastNameRaw.trim() : "";
        const authorPart = lastName
          ? creators.length > 1
            ? `${lastName} et al.`
            : lastName
          : "";
        const dateRaw = item.getField?.("date");
        const match =
          typeof dateRaw === "string"
            ? dateRaw.match(/(19|20)\d{2}/)
            : null;
        const year = match ? match[0] : "";
        authorLabel = year ? (authorPart ? `${authorPart} (${year})` : year) : authorPart;
      } catch {
        authorLabel = "";
      }

      const row = this.doc.createElement("div");
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border: 1px solid var(--fill-quinary, #e2e8f0);
        border-radius: 8px;
        background: var(--material-background, #ffffff);
      `;

      const text = this.doc.createElement("div");
      text.style.cssText = `
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      `;

      const t1 = this.doc.createElement("div");
      t1.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: var(--fill-primary, #1e293b);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      t1.textContent = authorLabel ? `${authorLabel}: ${title}` : title;

      const t2 = this.doc.createElement("div");
      t2.style.cssText = `
        font-size: 11px;
        color: var(--fill-secondary, #64748b);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      t2.textContent = `${authorLabel ? `${authorLabel} · ` : ""}INSPIRE:${recid}`;

      text.appendChild(t1);
      text.appendChild(t2);

      const addBtn = this.doc.createElement("button");
      addBtn.type = "button";
      addBtn.dataset.seedRecid = recid;
      const isAlreadySeed = this.seeds.some((s) => s.recid === recid);
      this.applyAddSeedActionButtonStyle(addBtn, isAlreadySeed);
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const nextIsSeed = !this.seeds.some((s) => s.recid === recid);
        if (nextIsSeed) {
          this.addSeed({ recid, title, authorLabel: authorLabel || undefined });
        } else {
          this.removeSeed(recid);
        }
        this.refreshAddSeedDialogButtons();
      });

      row.appendChild(text);
      row.appendChild(addBtn);
      rows.push(row);
    }

    if (!rows.length) {
      const empty = this.doc.createElement("div");
      empty.style.cssText = `
        font-size: 12px;
        color: var(--fill-secondary, #64748b);
        padding: 6px 0;
      `;
      empty.textContent =
        getString("references-panel-citation-graph-add-seed-no-zotero") ||
        "Select Zotero items with INSPIRE IDs to add them as seeds.";
      selectedList.appendChild(empty);
    } else {
      for (const row of rows.slice(0, 8)) {
        selectedList.appendChild(row);
      }
    }

    selectionSection.appendChild(selectedList);

    // INSPIRE search results section
    const inspireSection = this.doc.createElement("div");
    const inspireTitle = this.doc.createElement("div");
    inspireTitle.style.cssText = `
      font-size: 12px;
      font-weight: 700;
      color: var(--fill-primary, #1e293b);
      margin-bottom: 8px;
    `;
    inspireTitle.textContent =
      getString("references-panel-citation-graph-add-seed-from-inspire") ||
      "From INSPIRE search";
    inspireSection.appendChild(inspireTitle);

    const inspireSearchRow = this.doc.createElement("div");
    inspireSearchRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    `;

    const inspireSearchInput = this.doc.createElement("input");
    inspireSearchInput.type = "text";
    inspireSearchInput.placeholder =
      getString("references-panel-citation-graph-add-seed-search-placeholder") ||
      "Search INSPIRE...";
    inspireSearchInput.style.cssText = `
      flex: 1 1 auto;
      min-width: 0;
      border: 1px solid var(--fill-quinary, #d1d5db);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 12px;
      background: var(--material-background, #ffffff);
      color: var(--fill-primary, #1e293b);
    `;
    const scrollToInspireSection = () => {
      try {
        // Keep INSPIRE search row near the top so results stay visible below.
        content.scrollTop = Math.max(0, inspireSection.offsetTop - 10);
      } catch {
        // ignore
      }
    };
    const scrollToInspireSectionAsync = () => {
      const win = this.doc.defaultView;
      if (typeof win?.requestAnimationFrame === "function") {
        win.requestAnimationFrame(() => scrollToInspireSection());
      } else {
        setTimeout(() => scrollToInspireSection(), 0);
      }
    };
    inspireSearchInput.addEventListener("input", () => {
      scrollToInspireSectionAsync();
      this.scheduleAddSeedSearch(inspireSearchInput.value);
    });
    inspireSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (this.addSeedSearchTimer) {
          clearTimeout(this.addSeedSearchTimer);
          this.addSeedSearchTimer = undefined;
        }
        scrollToInspireSectionAsync();
        void this.performAddSeedSearch(inspireSearchInput.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeAddSeedDialog();
      }
    });

    const inspireSearchBtn = this.doc.createElement("button");
    inspireSearchBtn.type = "button";
    inspireSearchBtn.textContent =
      getString("references-panel-citation-graph-add-seed-search") || "Search";
    applyPillButtonStyle(inspireSearchBtn, false, isDarkMode());
    inspireSearchBtn.style.padding = "3px 8px";
    inspireSearchBtn.addEventListener("click", () => {
      if (this.addSeedSearchTimer) {
        clearTimeout(this.addSeedSearchTimer);
        this.addSeedSearchTimer = undefined;
      }
      scrollToInspireSectionAsync();
      void this.performAddSeedSearch(inspireSearchInput.value);
    });

    inspireSearchRow.appendChild(inspireSearchInput);
    inspireSearchRow.appendChild(inspireSearchBtn);
    inspireSection.appendChild(inspireSearchRow);

    const resultsEl = this.doc.createElement("div");
    inspireSection.appendChild(resultsEl);
    this.addSeedSearchResultsEl = resultsEl;
    void this.performAddSeedSearch("");

    content.appendChild(selectionSection);
    content.appendChild(inspireSection);

    panel.appendChild(header);
    panel.appendChild(content);
    overlay.appendChild(panel);
    this.dialogEl.appendChild(overlay);

    this.addSeedOverlayEl = overlay;
    setTimeout(() => {
      try {
        (inspireSearchInput as any)?.focus?.({ preventScroll: true });
      } catch {
        // Older platforms: avoid auto-scroll-to-bottom by focusing the Zotero input instead.
        zoteroSearchInput.focus();
      }
    }, 0);
  }

  private getNodeTargetFromEventTarget(target: EventTarget | null): string | null {
    const el = target as Element | null;
    if (!el) return null;
    const node = el.closest?.("[data-recid]") as HTMLElement | null;
    return node?.dataset?.recid ?? null;
  }

  private handleSvgClick(e: MouseEvent): void {
    if (this.disposed) return;
    const recid = this.getNodeTargetFromEventTarget(e.target);
    if (!recid) return;

    // Handle click asynchronously
    void this.handleNodeClick(recid, e);
  }

  private async handleNodeClick(recid: string, e: MouseEvent): Promise<void> {
    // Cmd/Ctrl+click: add as additional seed (multi-seed graph).
    if (e.ctrlKey || e.metaKey) {
      const entry = this.entryByRecid.get(recid);
      const title = entry?.title;
      const authorLabel = this.nodeLabelByRecid.get(recid);
      this.addSeed({ recid, title, authorLabel });
      return;
    }

    // Try to find the item in Zotero
    const item = await findItemByRecid(recid);

    if (item) {
      // Item exists in Zotero - jump to it
      const pane = Zotero.getActiveZoteroPane();
      if (pane) {
        await pane.selectItems([item.id]);
        // Close the dialog after successful navigation
        this.dispose();
      }
    } else {
      // Item not in Zotero
      // Normal click: show notification that item is not in Zotero
      const entry = this.entryByRecid.get(recid);
      const title = entry?.title || recid;
      const message =
        getString("references-panel-citation-graph-not-in-library", {
          args: { title },
        }) ||
        `Paper "${title}" is not in your Zotero library. Use the hover preview to open in INSPIRE.`;

      // Show a brief notification
      try {
        const pw = new Zotero.ProgressWindow({ closeOnClick: true });
        pw.changeHeadline(getString("references-panel-citation-graph-title") || "Citation Graph");
        pw.addDescription(message);
        pw.show();
        setTimeout(() => {
          pw.close();
        }, 3000);
      } catch {
        // Fallback: just log to console
        console.log(`[Citation Graph] ${message}`);
      }
    }
  }

  private handleSvgContextMenu(e: MouseEvent): void {
    if (this.disposed) return;
    const recid = this.getNodeTargetFromEventTarget(e.target);
    if (!recid) return;
    e.preventDefault();
    if (this.seeds.length === 1 && recid === this.current.recid) {
      return;
    }
    const entry = this.entryByRecid.get(recid);
    const title = entry?.title;
    const authorLabel = this.nodeLabelByRecid.get(recid);
    void this.navigateToSeeds([{ recid, title, authorLabel }], {
      pushHistory: true,
      preferredCurrentRecid: recid,
    });
  }

  private handlePanStart(e: MouseEvent): void {
    if (!this.svgEl) return;
    const recid = this.getNodeTargetFromEventTarget(e.target);
    // Do not start panning when interacting with a node.
    if (recid) return;
    if (e.button !== 0) return;
    this.hoverPreview?.hide();
    this.isPanning = true;
    this.panStartX = e.clientX;
    this.panStartY = e.clientY;
    this.panOriginX = this.panX;
    this.panOriginY = this.panY;
    this.svgEl.style.cursor = "grabbing";
  }

  private handlePanMove(e: MouseEvent): void {
    if (!this.isPanning) return;
    const dx = e.clientX - this.panStartX;
    const dy = e.clientY - this.panStartY;
    this.panX = this.panOriginX + dx;
    this.panY = this.panOriginY + dy;
    this.applyViewTransform();
  }

  private handlePanEnd(): void {
    if (!this.isPanning) return;
    this.isPanning = false;
    if (this.svgEl) {
      this.svgEl.style.cursor = "grab";
    }
  }

  private handleWheelZoom(e: WheelEvent): void {
    // Use Ctrl/Cmd + wheel to zoom, keep normal scrolling otherwise.
    if (!e.ctrlKey && !e.metaKey) {
      return;
    }
    e.preventDefault();
    const delta = e.deltaY;
    const factor = delta > 0 ? 0.92 : 1.08;
    const nextScale = Math.max(0.4, Math.min(2.5, this.scale * factor));
    if (nextScale === this.scale) return;

    // Zoom around pointer position
    const rect = this.svgEl?.getBoundingClientRect();
    if (!rect) {
      this.scale = nextScale;
      this.applyViewTransform();
      return;
    }
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dx = px - this.panX;
    const dy = py - this.panY;

    const ratio = nextScale / this.scale;
    this.panX = px - dx * ratio;
    this.panY = py - dy * ratio;
    this.scale = nextScale;
    this.applyViewTransform();
  }

  private applyViewTransform(): void {
    if (!this.svgGroupEl) return;
    this.svgGroupEl.setAttribute(
      "transform",
      `translate(${this.panX},${this.panY}) scale(${this.scale})`,
    );
  }

  private resetViewTransform(): void {
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;
    this.applyViewTransform();
  }

  private scheduleHoverPreview(
    recid: string,
    anchorEl: Element,
    fallbackPoint: { x: number; y: number },
  ): void {
    const entry = this.entryByRecid.get(recid);
    if (!entry) {
      return;
    }
    const rect = (anchorEl as unknown as { getBoundingClientRect?: () => DOMRect })
      .getBoundingClientRect?.();
    const buttonRect = rect
      ? { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }
      : {
          top: fallbackPoint.y,
          left: fallbackPoint.x,
          bottom: fallbackPoint.y,
          right: fallbackPoint.x,
        };

    const preview = this.ensureHoverPreview();
    preview?.scheduleShowMulti([entry], { buttonRect });
  }

  private renderLoading(): void {
    if (!this.svgGroupEl) return;
    this.entryByRecid.clear();
    this.nodeLabelByRecid.clear();
    this.hoverPreview?.hide();
    this.svgGroupEl.replaceChildren();
    const text = this.doc.createElementNS(SVG_NS, "text");
    text.textContent = getString("references-panel-status-loading") || "Loading...";
    text.setAttribute("x", "20");
    text.setAttribute("y", "28");
    text.setAttribute("fill", "var(--fill-secondary, #64748b)");
    text.setAttribute("font-size", "13");
    this.svgGroupEl.appendChild(text);
  }

  private renderError(message: string): void {
    if (!this.svgGroupEl) return;
    this.entryByRecid.clear();
    this.nodeLabelByRecid.clear();
    this.hoverPreview?.hide();
    this.svgGroupEl.replaceChildren();
    const text = this.doc.createElementNS(SVG_NS, "text");
    text.textContent = message || (getString("references-panel-status-error") || "Error");
    text.setAttribute("x", "20");
    text.setAttribute("y", "28");
    text.setAttribute("fill", "var(--fill-secondary, #64748b)");
    text.setAttribute("font-size", "13");
    this.svgGroupEl.appendChild(text);
  }

  private renderEmpty(): void {
    if (!this.svgGroupEl) return;
    this.entryByRecid.clear();
    this.nodeLabelByRecid.clear();
    this.hoverPreview?.hide();
    this.svgGroupEl.replaceChildren();
    const text = this.doc.createElementNS(SVG_NS, "text");
    text.textContent = getString("references-panel-empty-list") || "No data";
    text.setAttribute("x", "20");
    text.setAttribute("y", "28");
    text.setAttribute("fill", "var(--fill-secondary, #64748b)");
    text.setAttribute("font-size", "13");
    this.svgGroupEl.appendChild(text);
  }

  /**
   * Calculate X position based on publication date (coordinate axis layout)
   * Supports fractional years for month-level precision
   */
  private getXPosition(yearFraction: number, minYear: number, maxYear: number, width: number, padX: number): number {
    const availableWidth = width - padX * 2;
    const yearRange = maxYear - minYear || 1;
    return padX + ((yearFraction - minYear) / yearRange) * availableWidth;
  }

  /**
   * Calculate X position within a specific region (for split layout)
   */
  private getXPositionInRegion(yearFraction: number, minYear: number, maxYear: number, regionMinX: number, regionMaxX: number): number {
    const availableWidth = regionMaxX - regionMinX;
    const yearRange = maxYear - minYear || 1;
    return regionMinX + ((yearFraction - minYear) / yearRange) * availableWidth;
  }

  /**
   * Parse date string to fractional year (e.g., "2020-06" -> 2020.458)
   */
  private parseDateToFractionalYear(dateStr: string): number | null {
    if (!dateStr) return null;
    // Try to parse YYYY-MM-DD or YYYY-MM or YYYY format
    const match = dateStr.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    if (!match[2]) {
      // Year-only: default to mid-year for neutral placement.
      return year + 0.5;
    }
    const monthRaw = parseInt(match[2], 10);
    const month = Number.isFinite(monthRaw) ? Math.max(1, Math.min(12, monthRaw)) : 1;
    const dayRaw = match[3] ? parseInt(match[3], 10) : 15; // Default to mid-month
    const day = Number.isFinite(dayRaw) ? Math.max(1, Math.min(31, dayRaw)) : 15;
    // Calculate fractional year
    const daysInYear = 365;
    const dayOfYear = (month - 1) * 30.44 + day; // Approximate
    return year + dayOfYear / daysInYear;
  }

  private getEntryTimeValue(
    entry: Pick<InspireReferenceEntry, "earliestDate" | "year">,
  ): number | null {
    const raw =
      typeof entry.earliestDate === "string" && entry.earliestDate.trim()
        ? entry.earliestDate
        : entry.year;
    return this.parseDateToFractionalYear(raw);
  }

  private normalizeTimeZoom(
    prev: { zoomMin: number; zoomMax: number } | undefined,
    fullMin: number,
    fullMax: number,
  ): TimeZoomDomain {
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, v));
    let nextFullMin = fullMin;
    let nextFullMax = fullMax;
    const fullSpanRaw = fullMax - fullMin;
    if (!Number.isFinite(fullSpanRaw) || fullSpanRaw <= 0) {
      const center = Number.isFinite(fullMin) ? fullMin : 0;
      nextFullMin = center - 0.5;
      nextFullMax = center + 0.5;
    }
    const fullSpan = nextFullMax - nextFullMin;

    const minSpan = Math.min(fullSpan, 1 / 365);

    let zoomMin = prev?.zoomMin ?? nextFullMin;
    let zoomMax = prev?.zoomMax ?? nextFullMax;
    if (!Number.isFinite(zoomMin) || !Number.isFinite(zoomMax)) {
      zoomMin = nextFullMin;
      zoomMax = nextFullMax;
    }
    if (zoomMin > zoomMax) {
      [zoomMin, zoomMax] = [zoomMax, zoomMin];
    }
    zoomMin = clamp(zoomMin, nextFullMin, nextFullMax);
    zoomMax = clamp(zoomMax, nextFullMin, nextFullMax);

    if (zoomMax - zoomMin < minSpan && nextFullMax > nextFullMin) {
      const center = (zoomMin + zoomMax) / 2;
      const nextMin = clamp(
        center - minSpan / 2,
        nextFullMin,
        nextFullMax - minSpan,
      );
      zoomMin = nextMin;
      zoomMax = nextMin + minSpan;
    }

    if (!Number.isFinite(zoomMin) || !Number.isFinite(zoomMax) || zoomMax <= zoomMin) {
      zoomMin = nextFullMin;
      zoomMax = nextFullMax;
    }

    return { fullMin: nextFullMin, fullMax: nextFullMax, zoomMin, zoomMax };
  }

  private formatFractionalYearTick(value: number, span: number): string {
    const year = Math.floor(value);
    const frac = value - year;
    const dayOffset = Math.round(frac * 365);
    const date = new Date(Date.UTC(year, 0, 1 + dayOffset));
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");

    if (span >= 4) return String(yyyy);
    if (span >= 1) return `${yyyy}-${mm}`;
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Calculate Y position based on citation count (log scale, adaptive range)
   */
  private getYPosition(citations: number, minCitations: number, maxCitations: number, height: number, padY: number): number {
    const availableHeight = height - padY * 2;
    // Use log scale with adaptive min
    const logCitations = Math.log10(Math.max(minCitations, citations));
    const logMin = Math.log10(Math.max(1, minCitations));
    const logMax = Math.log10(Math.max(1, maxCitations));
    const logRange = logMax - logMin || 1;
    // Invert Y axis (higher citations = higher position)
    return height - padY - ((logCitations - logMin) / logRange) * availableHeight;
  }

  /**
   * Get node radius based on citation count
   */
  private getNodeRadius(citations: number): number {
    if (citations < 10) return 6;
    if (citations < 50) return 7;
    if (citations < 100) return 8;
    if (citations < 500) return 10;
    if (citations < 2000) return 12;
    return 14;
  }

  private getCitationAxisTicks(minCitations: number, maxCitations: number): number[] {
    const min = Math.max(1, Math.floor(minCitations));
    const max = Math.max(min, Math.ceil(maxCitations));

    if (min === max) {
      return [max];
    }

    const logMin = Math.floor(Math.log10(Math.max(1, minCitations)));
    const logMax = Math.ceil(Math.log10(Math.max(1, maxCitations)));
    const candidates: number[] = [];
    for (let exp = logMin; exp <= logMax; exp++) {
      const base = Math.pow(10, exp);
      for (const m of [1, 2, 5]) {
        const v = m * base;
        if (v < min) continue;
        if (v > max) continue;
        candidates.push(v);
      }
    }

    const sorted = Array.from(new Set(candidates)).sort((a, b) => a - b);
    if (!sorted.length) {
      return [min, max];
    }
    if (sorted.length <= 6) {
      return sorted;
    }

    // Thin out ticks to keep labels readable.
    const keep: number[] = [sorted[0]];
    const middle = sorted.slice(1, -1);
    const desiredMiddle = 4;
    const step = Math.max(1, Math.ceil(middle.length / desiredMiddle));
    for (let i = 0; i < middle.length; i += step) {
      keep.push(middle[i]);
      if (keep.length >= 1 + desiredMiddle) break;
    }
    keep.push(sorted[sorted.length - 1]);
    return Array.from(new Set(keep)).sort((a, b) => a - b);
  }

  /**
   * Generate pentagon polygon points
   */
  private getPentagonPoints(cx: number, cy: number, r: number): string {
    const result: string[] = [];
    for (let i = 0; i < 5; i++) {
      const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      result.push(`${x},${y}`);
    }
    return result.join(" ");
  }

  /**
   * Get node color based on Zotero status and year (ResearchRabbit style)
   * Green = in Zotero, Blue = not in Zotero
   * Color intensity = year (darker = more recent)
   */
  private getNodeColor(localItemID: number | undefined, year: string): string {
    const yearNum = parseInt(year, 10);
    const currentYear = new Date().getFullYear();
    const inZotero = typeof localItemID === "number";

    if (inZotero) {
      // Green color for items in Zotero
      if (isNaN(yearNum)) return "#10b981";  // Standard green
      const age = currentYear - yearNum;
      if (age <= 1) return "#047857";  // Dark green (most recent)
      if (age <= 3) return "#10b981";  // Standard green
      if (age <= 5) return "#34d399";  // Light green
      return "#6ee7b7";  // Lightest green (older)
    } else {
      // Blue color for items not in Zotero
      if (isNaN(yearNum)) return "#3b82f6";  // Standard blue
      const age = currentYear - yearNum;
      if (age <= 1) return "#1d4ed8";  // Dark blue (most recent)
      if (age <= 3) return "#3b82f6";  // Standard blue
      if (age <= 5) return "#60a5fa";  // Light blue
      return "#93c5fd";  // Lightest blue (older)
    }
  }

  /**
   * Label position info for collision detection
   */
  private calculateLabelBounds(
    x: number, y: number, text: string, anchor: "start" | "end", fontSize = 10
  ): { x1: number; y1: number; x2: number; y2: number } {
    const charWidth = fontSize * 0.6;
    const textWidth = text.length * charWidth;
    const textHeight = fontSize * 1.2;

    if (anchor === "start") {
      return { x1: x, y1: y - textHeight / 2, x2: x + textWidth, y2: y + textHeight / 2 };
    } else {
      return { x1: x - textWidth, y1: y - textHeight / 2, x2: x, y2: y + textHeight / 2 };
    }
  }

  /**
   * Check if two rectangles overlap
   */
  private rectsOverlap(
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number },
    margin = 2
  ): boolean {
    return !(a.x2 + margin < b.x1 || b.x2 + margin < a.x1 ||
             a.y2 + margin < b.y1 || b.y2 + margin < a.y1);
  }

  /**
   * Resolve label positions to avoid overlaps
   */
  private resolveLabelPositions(
    nodes: Array<{
      x: number; y: number; r: number;
      label: string; regionMinX: number; regionMaxX: number;
    }>
  ): Array<{ labelX: number; labelY: number; anchor: "start" | "end" }> {
    const results: Array<{ labelX: number; labelY: number; anchor: "start" | "end" }> = [];
    const placedBounds: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

    for (const node of nodes) {
      const { x, y, r, label, regionMinX, regionMaxX } = node;
      const gap = 4;

      // Try positions in order: right, left, above-right, below-right, above-left, below-left
      const candidates: Array<{ lx: number; ly: number; anchor: "start" | "end" }> = [
        { lx: x + r + gap, ly: y, anchor: "start" },
        { lx: x - r - gap, ly: y, anchor: "end" },
        { lx: x + r + gap, ly: y - 12, anchor: "start" },
        { lx: x + r + gap, ly: y + 12, anchor: "start" },
        { lx: x - r - gap, ly: y - 12, anchor: "end" },
        { lx: x - r - gap, ly: y + 12, anchor: "end" },
      ];

      let bestCandidate = candidates[0];
      let foundNoOverlap = false;

      for (const cand of candidates) {
        const bounds = this.calculateLabelBounds(cand.lx, cand.ly, label, cand.anchor);

        // Check if within region bounds
        if (bounds.x1 < regionMinX - 10 || bounds.x2 > regionMaxX + 10) continue;

        // Check overlap with placed labels
        let hasOverlap = false;
        for (const placed of placedBounds) {
          if (this.rectsOverlap(bounds, placed)) {
            hasOverlap = true;
            break;
          }
        }

        if (!hasOverlap) {
          bestCandidate = cand;
          foundNoOverlap = true;
          break;
        }
      }

      const finalBounds = this.calculateLabelBounds(
        bestCandidate.lx, bestCandidate.ly, label, bestCandidate.anchor
      );
      placedBounds.push(finalBounds);
      results.push({ labelX: bestCandidate.lx, labelY: bestCandidate.ly, anchor: bestCandidate.anchor });
    }

    return results;
  }

  private renderAxes(
    width: number,
    height: number,
    padX: number,
    padY: number,
    minYear: number,
    maxYear: number,
    minCitations: number,
    maxCitations: number,
    textColor: string,
  ): void {
    if (!this.svgGroupEl) return;

    const axisColor = "var(--fill-quinary, #d1d5db)";

    // X-axis line
    const xAxis = this.doc.createElementNS(SVG_NS, "line");
    xAxis.setAttribute("x1", String(padX));
    xAxis.setAttribute("y1", String(height - padY));
    xAxis.setAttribute("x2", String(width - padX));
    xAxis.setAttribute("y2", String(height - padY));
    xAxis.setAttribute("stroke", axisColor);
    xAxis.setAttribute("stroke-width", "1");
    this.svgGroupEl.appendChild(xAxis);

    // Y-axis line
    const yAxis = this.doc.createElementNS(SVG_NS, "line");
    yAxis.setAttribute("x1", String(padX));
    yAxis.setAttribute("y1", String(padY));
    yAxis.setAttribute("x2", String(padX));
    yAxis.setAttribute("y2", String(height - padY));
    yAxis.setAttribute("stroke", axisColor);
    yAxis.setAttribute("stroke-width", "1");
    this.svgGroupEl.appendChild(yAxis);

    // X-axis labels (years)
    const yearRange = maxYear - minYear;
    const yearStep = yearRange <= 10 ? 1 : yearRange <= 20 ? 2 : 5;
    for (let year = minYear; year <= maxYear; year += yearStep) {
      const x = this.getXPosition(year, minYear, maxYear, width, padX);
      const label = this.doc.createElementNS(SVG_NS, "text");
      label.textContent = String(year);
      label.setAttribute("x", String(x));
      label.setAttribute("y", String(height - padY + 16));
      label.setAttribute("fill", textColor);
      label.setAttribute("font-size", "10");
      label.setAttribute("text-anchor", "middle");
      this.svgGroupEl.appendChild(label);

      // Tick mark
      const tick = this.doc.createElementNS(SVG_NS, "line");
      tick.setAttribute("x1", String(x));
      tick.setAttribute("y1", String(height - padY));
      tick.setAttribute("x2", String(x));
      tick.setAttribute("y2", String(height - padY + 4));
      tick.setAttribute("stroke", axisColor);
      this.svgGroupEl.appendChild(tick);
    }

    // X-axis title
    const xTitle = this.doc.createElementNS(SVG_NS, "text");
    xTitle.textContent = "Year";
    xTitle.setAttribute("x", String(width / 2));
    xTitle.setAttribute("y", String(height - 10));
    xTitle.setAttribute("fill", textColor);
    xTitle.setAttribute("font-size", "11");
    xTitle.setAttribute("text-anchor", "middle");
    this.svgGroupEl.appendChild(xTitle);

    // Y-axis labels (citations - log scale, adaptive range)
    const citationLabels = [1, 10, 100, 1000, 10000].filter(
      c => c >= minCitations && c <= maxCitations * 1.5
    );
    for (const citations of citationLabels) {
      const y = this.getYPosition(citations, minCitations, maxCitations, height, padY);
      if (y < padY - 10 || y > height - padY + 10) continue;

      const label = this.doc.createElementNS(SVG_NS, "text");
      label.textContent = citations >= 1000 ? `${citations / 1000}k` : String(citations);
      label.setAttribute("x", String(padX - 8));
      label.setAttribute("y", String(y + 3));
      label.setAttribute("fill", textColor);
      label.setAttribute("font-size", "10");
      label.setAttribute("text-anchor", "end");
      this.svgGroupEl.appendChild(label);

      // Grid line
      const grid = this.doc.createElementNS(SVG_NS, "line");
      grid.setAttribute("x1", String(padX));
      grid.setAttribute("y1", String(y));
      grid.setAttribute("x2", String(width - padX));
      grid.setAttribute("y2", String(y));
      grid.setAttribute("stroke", axisColor);
      grid.setAttribute("stroke-width", "0.5");
      grid.setAttribute("stroke-dasharray", "4,4");
      grid.setAttribute("opacity", "0.5");
      this.svgGroupEl.appendChild(grid);
    }

    // Y-axis title
    const yTitle = this.doc.createElementNS(SVG_NS, "text");
    yTitle.textContent = "Citations";
    yTitle.setAttribute("x", String(15));
    yTitle.setAttribute("y", String(height / 2));
    yTitle.setAttribute("fill", textColor);
    yTitle.setAttribute("font-size", "11");
    yTitle.setAttribute("text-anchor", "middle");
    yTitle.setAttribute("transform", `rotate(-90, 15, ${height / 2})`);
    this.svgGroupEl.appendChild(yTitle);
  }

  private renderSplitLayout(
    width: number, height: number, padX: number, padY: number, midGap: number,
    leftMinX: number, leftMaxX: number, rightMinX: number, rightMaxX: number,
    refsTime: TimeZoomDomain, citedTime: TimeZoomDomain,
    refsMinCitations: number, refsMaxCitations: number,
    citedMinCitations: number, citedMaxCitations: number,
    textColor: string,
    refsCount: number, citedCount: number
  ): void {
    if (!this.svgGroupEl) return;

    const axisColor = "var(--fill-quinary, #d1d5db)";
    const dark = isDarkMode();

    // Create gradient definitions for more elegant backgrounds
    const defs = this.doc.createElementNS(SVG_NS, "defs");

    // Left region gradient (References - subtle blue)
    const leftGradient = this.doc.createElementNS(SVG_NS, "linearGradient");
    leftGradient.setAttribute("id", "refs-bg-gradient");
    leftGradient.setAttribute("x1", "0%");
    leftGradient.setAttribute("y1", "0%");
    leftGradient.setAttribute("x2", "100%");
    leftGradient.setAttribute("y2", "100%");
    const leftStop1 = this.doc.createElementNS(SVG_NS, "stop");
    leftStop1.setAttribute("offset", "0%");
    leftStop1.setAttribute("stop-color", dark ? "rgba(59, 130, 246, 0.08)" : "rgba(59, 130, 246, 0.04)");
    const leftStop2 = this.doc.createElementNS(SVG_NS, "stop");
    leftStop2.setAttribute("offset", "100%");
    leftStop2.setAttribute("stop-color", dark ? "rgba(59, 130, 246, 0.02)" : "rgba(59, 130, 246, 0.01)");
    leftGradient.appendChild(leftStop1);
    leftGradient.appendChild(leftStop2);
    defs.appendChild(leftGradient);

    // Right region gradient (Cited-by - subtle amber)
    const rightGradient = this.doc.createElementNS(SVG_NS, "linearGradient");
    rightGradient.setAttribute("id", "cited-bg-gradient");
    rightGradient.setAttribute("x1", "0%");
    rightGradient.setAttribute("y1", "0%");
    rightGradient.setAttribute("x2", "100%");
    rightGradient.setAttribute("y2", "100%");
    const rightStop1 = this.doc.createElementNS(SVG_NS, "stop");
    rightStop1.setAttribute("offset", "0%");
    rightStop1.setAttribute("stop-color", dark ? "rgba(245, 158, 11, 0.08)" : "rgba(245, 158, 11, 0.04)");
    const rightStop2 = this.doc.createElementNS(SVG_NS, "stop");
    rightStop2.setAttribute("offset", "100%");
    rightStop2.setAttribute("stop-color", dark ? "rgba(245, 158, 11, 0.02)" : "rgba(245, 158, 11, 0.01)");
    rightGradient.appendChild(rightStop1);
    rightGradient.appendChild(rightStop2);
    defs.appendChild(rightGradient);

    this.svgGroupEl.appendChild(defs);

    // Left region background (References)
    const leftBg = this.doc.createElementNS(SVG_NS, "rect");
    leftBg.setAttribute("x", String(leftMinX - 5));
    leftBg.setAttribute("y", String(padY - 10));
    leftBg.setAttribute("width", String(leftMaxX - leftMinX + 10));
    // Keep the bottom border aligned with the x-axis to avoid a "double axis" line.
    leftBg.setAttribute("height", String(height - padY * 2 + 10));
    leftBg.setAttribute("fill", "url(#refs-bg-gradient)");
    leftBg.setAttribute("stroke", dark ? "rgba(59, 130, 246, 0.15)" : "rgba(59, 130, 246, 0.1)");
    leftBg.setAttribute("stroke-width", "1");
    leftBg.setAttribute("rx", "6");
    this.svgGroupEl.appendChild(leftBg);

    // Right region background (Cited-by)
    const rightBg = this.doc.createElementNS(SVG_NS, "rect");
    rightBg.setAttribute("x", String(rightMinX - 5));
    rightBg.setAttribute("y", String(padY - 10));
    rightBg.setAttribute("width", String(rightMaxX - rightMinX + 10));
    // Keep the bottom border aligned with the x-axis to avoid a "double axis" line.
    rightBg.setAttribute("height", String(height - padY * 2 + 10));
    rightBg.setAttribute("fill", "url(#cited-bg-gradient)");
    rightBg.setAttribute("stroke", dark ? "rgba(245, 158, 11, 0.15)" : "rgba(245, 158, 11, 0.1)");
    rightBg.setAttribute("stroke-width", "1");
    rightBg.setAttribute("rx", "6");
    this.svgGroupEl.appendChild(rightBg);

    // Region labels
    const leftLabel = this.doc.createElementNS(SVG_NS, "text");
    leftLabel.textContent = `References (${refsCount})`;
    leftLabel.setAttribute("x", String((leftMinX + leftMaxX) / 2));
    leftLabel.setAttribute("y", String(padY - 20));
    leftLabel.setAttribute("fill", textColor);
    leftLabel.setAttribute("font-size", "11");
    leftLabel.setAttribute("font-weight", "600");
    leftLabel.setAttribute("text-anchor", "middle");
    this.svgGroupEl.appendChild(leftLabel);

    const rightLabel = this.doc.createElementNS(SVG_NS, "text");
    rightLabel.textContent = `Cited-by (${citedCount})`;
    rightLabel.setAttribute("x", String((rightMinX + rightMaxX) / 2));
    rightLabel.setAttribute("y", String(padY - 20));
    rightLabel.setAttribute("fill", textColor);
    rightLabel.setAttribute("font-size", "11");
    rightLabel.setAttribute("font-weight", "600");
    rightLabel.setAttribute("text-anchor", "middle");
    this.svgGroupEl.appendChild(rightLabel);

    // Render Y axes (per-region, for better distribution when ranges differ)
    this.renderRegionYAxis(
      leftMinX,
      leftMaxX,
      height,
      padY,
      refsMinCitations,
      refsMaxCitations,
      textColor,
      axisColor,
      "left",
    );
    this.renderRegionYAxis(
      rightMinX,
      rightMaxX,
      height,
      padY,
      citedMinCitations,
      citedMaxCitations,
      textColor,
      axisColor,
      "right",
    );

    // Render X axes for each region
    this.renderRegionXAxis(
      leftMinX,
      leftMaxX,
      height,
      padY,
      refsTime.zoomMin,
      refsTime.zoomMax,
      textColor,
      axisColor,
    );
    this.renderRegionXAxis(
      rightMinX,
      rightMaxX,
      height,
      padY,
      citedTime.zoomMin,
      citedTime.zoomMax,
      textColor,
      axisColor,
    );

    // Time zoom slider (shows full domain + current zoom window)
    this.renderRegionTimeZoomSlider({
      region: "refs",
      minX: leftMinX,
      maxX: leftMaxX,
      height,
      padY,
      domain: refsTime,
    });
    this.renderRegionTimeZoomSlider({
      region: "cited",
      minX: rightMinX,
      maxX: rightMaxX,
      height,
      padY,
      domain: citedTime,
    });
  }

  private renderRegionYAxis(
    regionMinX: number,
    regionMaxX: number,
    height: number,
    padY: number,
    minCitations: number,
    maxCitations: number,
    textColor: string,
    axisColor: string,
    side: "left" | "right",
  ): void {
    if (!this.svgGroupEl) return;

    const yAxisX =
      side === "left"
        ? Math.max(18, regionMinX - 14)
        : regionMaxX + 14;
    const tickDir = side === "left" ? -1 : 1;
    const labelX = yAxisX + tickDir * 6;
    const labelAnchor = side === "left" ? "end" : "start";

    // Y-axis line
    const yAxis = this.doc.createElementNS(SVG_NS, "line");
    yAxis.setAttribute("x1", String(yAxisX));
    yAxis.setAttribute("y1", String(padY));
    yAxis.setAttribute("x2", String(yAxisX));
    yAxis.setAttribute("y2", String(height - padY));
    yAxis.setAttribute("stroke", axisColor);
    yAxis.setAttribute("stroke-width", "1");
    this.svgGroupEl.appendChild(yAxis);

    // Y-axis tick labels: only "nice" ticks (1/2/5 × 10^n) to avoid irregular labels.
    const citationLabels = this.getCitationAxisTicks(minCitations, maxCitations);
    for (const citations of citationLabels) {
      const y = this.getYPosition(citations, minCitations, maxCitations, height, padY);
      if (y < padY - 10 || y > height - padY + 10) continue;

      const label = this.doc.createElementNS(SVG_NS, "text");
      label.textContent =
        citations >= 1000000 && citations % 1000000 === 0
          ? `${citations / 1000000}M`
          : citations >= 1000 && citations % 1000 === 0
            ? `${citations / 1000}k`
            : String(citations);
      label.setAttribute("x", String(labelX));
      label.setAttribute("y", String(y + 3));
      label.setAttribute("fill", textColor);
      label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "600");
      label.setAttribute("text-anchor", labelAnchor);
      label.setAttribute("opacity", "0.92");
      this.svgGroupEl.appendChild(label);
    }
  }

  private renderRegionXAxis(
    minX: number, maxX: number, height: number, padY: number,
    minYear: number, maxYear: number,
    textColor: string, axisColor: string
  ): void {
    if (!this.svgGroupEl) return;

    const y = height - padY;
    // Keep enough room for the time zoom slider and place tick labels under it.
    const tickLabelY = y + 34;

    // X-axis line
    const xAxis = this.doc.createElementNS(SVG_NS, "line");
    xAxis.setAttribute("x1", String(minX));
    xAxis.setAttribute("y1", String(y));
    xAxis.setAttribute("x2", String(maxX));
    xAxis.setAttribute("y2", String(y));
    xAxis.setAttribute("stroke", axisColor);
    xAxis.setAttribute("stroke-width", "1");
    this.svgGroupEl.appendChild(xAxis);

    // X-axis labels (adaptive: year / year-month / full date)
    const spanRaw = maxYear - minYear;
    const span = Number.isFinite(spanRaw) && spanRaw > 0 ? spanRaw : 1;
    const tickCount = 5;
    for (let i = 0; i < tickCount; i++) {
      const t = i / (tickCount - 1);
      const value = minYear + span * t;
      const x = this.getXPositionInRegion(value, minYear, maxYear, minX, maxX);

      const tick = this.doc.createElementNS(SVG_NS, "line");
      tick.setAttribute("x1", String(x));
      tick.setAttribute("y1", String(y));
      tick.setAttribute("x2", String(x));
      tick.setAttribute("y2", String(y + 4));
      tick.setAttribute("stroke", axisColor);
      tick.setAttribute("stroke-width", "1");
      this.svgGroupEl.appendChild(tick);

      const label = this.doc.createElementNS(SVG_NS, "text");
      label.textContent = this.formatFractionalYearTick(value, span);
      label.setAttribute("x", String(x));
      label.setAttribute("y", String(tickLabelY));
      label.setAttribute("fill", textColor);
      label.setAttribute("font-size", "9");
      label.setAttribute("text-anchor", "middle");
      this.svgGroupEl.appendChild(label);
    }
  }

  private renderRegionTimeZoomSlider(opts: {
    region: "refs" | "cited";
    minX: number;
    maxX: number;
    height: number;
    padY: number;
    domain: TimeZoomDomain;
  }): void {
    if (!this.svgGroupEl) return;

    const { region, minX, maxX, height, padY, domain } = opts;
    const regionW = maxX - minX;
    if (!Number.isFinite(regionW) || regionW <= 0) return;
    const fullSpan = domain.fullMax - domain.fullMin;
    if (!Number.isFinite(fullSpan) || fullSpan <= 0) return;

    const dark = isDarkMode();
    const axisY = height - padY;
    const trackY = axisY + 10;
    const trackH = 5;
    const handleW = 8;
    const handleH = 14;

    const selectionFill =
      region === "refs"
        ? dark
          ? "rgba(59, 130, 246, 0.28)"
          : "rgba(59, 130, 246, 0.22)"
        : dark
          ? "rgba(245, 158, 11, 0.28)"
          : "rgba(245, 158, 11, 0.22)";
    const handleStroke =
      region === "refs"
        ? dark
          ? "rgba(59, 130, 246, 0.65)"
          : "rgba(59, 130, 246, 0.55)"
        : dark
          ? "rgba(245, 158, 11, 0.65)"
          : "rgba(245, 158, 11, 0.55)";

    const valueToX = (v: number) =>
      minX + ((v - domain.fullMin) / fullSpan) * regionW;
    const clampX = (x: number) => Math.max(minX, Math.min(maxX, x));
    const clampValue = (v: number) =>
      Math.max(domain.fullMin, Math.min(domain.fullMax, v));

    const group = this.doc.createElementNS(SVG_NS, "g");
    group.setAttribute("data-zoom-region", region);

    const track = this.doc.createElementNS(SVG_NS, "rect");
    track.setAttribute("x", String(minX));
    track.setAttribute("y", String(trackY));
    track.setAttribute("width", String(regionW));
    track.setAttribute("height", String(trackH));
    track.setAttribute("rx", "3");
    track.setAttribute("fill", "var(--fill-quinary, #e2e8f0)");
    track.setAttribute("opacity", dark ? "0.35" : "0.6");
    group.appendChild(track);

    const selection = this.doc.createElementNS(SVG_NS, "rect");
    selection.setAttribute("y", String(trackY));
    selection.setAttribute("height", String(trackH));
    selection.setAttribute("rx", "3");
    selection.setAttribute("fill", selectionFill);
    group.appendChild(selection);

    const selectionHit = this.doc.createElementNS(SVG_NS, "rect");
    // Keep the grab area below the plot boundary to avoid blocking nodes near the x-axis.
    selectionHit.setAttribute("y", String(trackY + trackH / 2 - handleH / 2));
    selectionHit.setAttribute("height", String(handleH + 12));
    selectionHit.setAttribute("fill", "transparent");
    selectionHit.style.cursor = "grab";
    group.appendChild(selectionHit);

    const leftHandle = this.doc.createElementNS(SVG_NS, "rect");
    leftHandle.setAttribute("y", String(trackY + trackH / 2 - handleH / 2));
    leftHandle.setAttribute("width", String(handleW));
    leftHandle.setAttribute("height", String(handleH));
    leftHandle.setAttribute("rx", "3");
    leftHandle.setAttribute("fill", "var(--material-background, #ffffff)");
    leftHandle.setAttribute("stroke", handleStroke);
    leftHandle.setAttribute("stroke-width", "1");
    leftHandle.style.cursor = "ew-resize";
    group.appendChild(leftHandle);

    const rightHandle = this.doc.createElementNS(SVG_NS, "rect");
    rightHandle.setAttribute("y", String(trackY + trackH / 2 - handleH / 2));
    rightHandle.setAttribute("width", String(handleW));
    rightHandle.setAttribute("height", String(handleH));
    rightHandle.setAttribute("rx", "3");
    rightHandle.setAttribute("fill", "var(--material-background, #ffffff)");
    rightHandle.setAttribute("stroke", handleStroke);
    rightHandle.setAttribute("stroke-width", "1");
    rightHandle.style.cursor = "ew-resize";
    group.appendChild(rightHandle);

    let draftMin = domain.zoomMin;
    let draftMax = domain.zoomMax;

    const updateVisual = () => {
      const x1 = clampX(valueToX(draftMin));
      const x2 = clampX(valueToX(draftMax));
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      selection.setAttribute("x", String(left));
      selection.setAttribute("width", String(Math.max(0, right - left)));
      selectionHit.setAttribute("x", String(left));
      selectionHit.setAttribute("width", String(Math.max(0, right - left)));
      leftHandle.setAttribute("x", String(left - handleW / 2));
      rightHandle.setAttribute("x", String(right - handleW / 2));
    };

    updateVisual();

    const win = this.doc.defaultView;
    const minSpan = Math.min(fullSpan, 1 / 365);

    type DragMode = "min" | "max" | "window";
    let drag: {
      mode: DragMode;
      startClientX: number;
      startMin: number;
      startMax: number;
    } | null = null;

    const setDraft = (nextMin: number, nextMax: number) => {
      let a = nextMin;
      let b = nextMax;
      if (a > b) [a, b] = [b, a];
      a = clampValue(a);
      b = clampValue(b);
      if (b - a < minSpan) {
        const center = (a + b) / 2;
        const minAllowed = domain.fullMin;
        const maxAllowed = domain.fullMax - minSpan;
        const nextA = clampValue(Math.max(minAllowed, Math.min(maxAllowed, center - minSpan / 2)));
        a = nextA;
        b = nextA + minSpan;
      }
      draftMin = a;
      draftMax = b;
      updateVisual();
    };

    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      e.stopPropagation();
      e.preventDefault();
      const dxPx = e.clientX - drag.startClientX;
      const dv = (dxPx / (regionW * this.scale)) * fullSpan;
      if (drag.mode === "min") {
        setDraft(drag.startMin + dv, drag.startMax);
      } else if (drag.mode === "max") {
        setDraft(drag.startMin, drag.startMax + dv);
      } else {
        const span = drag.startMax - drag.startMin;
        let nextMin = drag.startMin + dv;
        let nextMax = drag.startMax + dv;
        if (nextMin < domain.fullMin) {
          nextMin = domain.fullMin;
          nextMax = domain.fullMin + span;
        }
        if (nextMax > domain.fullMax) {
          nextMax = domain.fullMax;
          nextMin = domain.fullMax - span;
        }
        setDraft(nextMin, nextMax);
      }
    };

    const applyDraft = () => {
      const next: TimeZoomDomain = {
        fullMin: domain.fullMin,
        fullMax: domain.fullMax,
        zoomMin: draftMin,
        zoomMax: draftMax,
      };
      if (region === "refs") {
        this.refsTimeZoom = next;
      } else {
        this.citedTimeZoom = next;
      }
    };

    const onUp = (e?: MouseEvent) => {
      if (!drag) return;
      e?.stopPropagation();
      e?.preventDefault();
      drag = null;
      win?.removeEventListener("mousemove", onMove, true);
      win?.removeEventListener("mouseup", onUp, true);
      applyDraft();
      if (this.graphResult) {
        this.renderGraph(this.graphResult);
      }
    };

    const startDrag = (e: MouseEvent, mode: DragMode) => {
      e.stopPropagation();
      e.preventDefault();
      drag = {
        mode,
        startClientX: e.clientX,
        startMin: draftMin,
        startMax: draftMax,
      };
      win?.addEventListener("mousemove", onMove, true);
      win?.addEventListener("mouseup", onUp, true);
    };

    leftHandle.addEventListener("mousedown", (e) => startDrag(e, "min"));
    rightHandle.addEventListener("mousedown", (e) => startDrag(e, "max"));
    selection.addEventListener("mousedown", (e) => startDrag(e, "window"));
    selectionHit.addEventListener("mousedown", (e) => startDrag(e, "window"));

    group.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    group.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      setDraft(domain.fullMin, domain.fullMax);
      applyDraft();
      if (this.graphResult) {
        this.renderGraph(this.graphResult);
      }
    });

    this.svgGroupEl.appendChild(group);
  }

  private renderLegend(
    width: number, padX: number, textFill: string, textSecondary: string,
    nodePositions?: Array<{x: number; y: number; r: number}>
  ): void {
    if (!this.svgGroupEl) return;

    const dark = isDarkMode();
    const localColor = dark ? "#22c55e" : "#1a8f4d";
    const onlineColor = dark ? "#6b7280" : "#9ca3af";

    const legendLabels = ["In library", "Online", "Ref", "Cited-by", "Seed"];
    const fontSize = 9;
    const charWidth = fontSize * 0.6;
    const maxLabelWidth = Math.max(
      ...legendLabels.map((label) => label.length * charWidth),
    );
    const pad = 5;
    const iconR = 4;
    const gap = 4;
    const rowGap = 11;

    const legendW = Math.ceil(pad + iconR * 2 + gap + maxLabelWidth + pad);
    const legendH = Math.ceil(pad * 2 + iconR * 2 + rowGap * (legendLabels.length - 1));

    // Find best position for legend (avoid overlapping with nodes)
    const candidates = [
      { x: width / 2 - legendW / 2, y: 45 },  // Top center
      { x: width - padX - legendW - 10, y: 45 },  // Top right
      { x: padX + 10, y: 45 },  // Top left
    ];

    let bestPos = candidates[0];
    if (nodePositions && nodePositions.length > 0) {
      let minOverlap = Infinity;
      for (const pos of candidates) {
        let overlap = 0;
        for (const node of nodePositions) {
          const dx = Math.abs(node.x - (pos.x + legendW / 2));
          const dy = Math.abs(node.y - (pos.y + legendH / 2));
          if (dx < legendW / 2 + node.r + 10 && dy < legendH / 2 + node.r + 10) {
            overlap++;
          }
        }
        if (overlap < minOverlap) {
          minOverlap = overlap;
          bestPos = pos;
        }
      }
    }

    const legendX = bestPos.x;
    const legendY = bestPos.y;

    // Compact legend background
    const bg = this.doc.createElementNS(SVG_NS, "rect");
    bg.setAttribute("x", String(legendX));
    bg.setAttribute("y", String(legendY));
    bg.setAttribute("width", String(legendW));
    bg.setAttribute("height", String(legendH));
    bg.setAttribute("fill", "var(--material-background, #ffffff)");
    bg.setAttribute("stroke", "var(--fill-quinary, #d1d5db)");
    bg.setAttribute("stroke-width", "1");
    bg.setAttribute("rx", "4");
    bg.setAttribute("opacity", "0.95");
    this.svgGroupEl.appendChild(bg);

    const itemX = legendX + pad;
    const itemY = legendY + pad;
    const iconX = itemX + iconR;
    const labelX = itemX + iconR * 2 + gap;
    const rowY = (index: number) => itemY + iconR + index * rowGap;
    const labelBaselineY = (index: number) => rowY(index) + 3;

    // In library (green circle)
    const greenCircle = this.doc.createElementNS(SVG_NS, "circle");
    greenCircle.setAttribute("cx", String(iconX));
    greenCircle.setAttribute("cy", String(rowY(0)));
    greenCircle.setAttribute("r", String(iconR));
    greenCircle.setAttribute("fill", localColor);
    greenCircle.setAttribute("fill-opacity", "0.75");
    this.svgGroupEl.appendChild(greenCircle);

    const greenLabel = this.doc.createElementNS(SVG_NS, "text");
    greenLabel.textContent = "In library";
    greenLabel.setAttribute("x", String(labelX));
    greenLabel.setAttribute("y", String(labelBaselineY(0)));
    greenLabel.setAttribute("fill", textFill);
    greenLabel.setAttribute("font-size", String(fontSize));
    this.svgGroupEl.appendChild(greenLabel);

    // Online (gray circle)
    const grayCircle = this.doc.createElementNS(SVG_NS, "circle");
    grayCircle.setAttribute("cx", String(iconX));
    grayCircle.setAttribute("cy", String(rowY(1)));
    grayCircle.setAttribute("r", String(iconR));
    grayCircle.setAttribute("fill", onlineColor);
    grayCircle.setAttribute("fill-opacity", "0.75");
    this.svgGroupEl.appendChild(grayCircle);

    const grayLabel = this.doc.createElementNS(SVG_NS, "text");
    grayLabel.textContent = "Online";
    grayLabel.setAttribute("x", String(labelX));
    grayLabel.setAttribute("y", String(labelBaselineY(1)));
    grayLabel.setAttribute("fill", textFill);
    grayLabel.setAttribute("font-size", String(fontSize));
    this.svgGroupEl.appendChild(grayLabel);

    // Reference (circle shape)
    const refCircle = this.doc.createElementNS(SVG_NS, "circle");
    refCircle.setAttribute("cx", String(iconX));
    refCircle.setAttribute("cy", String(rowY(2)));
    refCircle.setAttribute("r", String(iconR));
    refCircle.setAttribute("fill", "#94a3b8");
    refCircle.setAttribute("fill-opacity", "0.75");
    this.svgGroupEl.appendChild(refCircle);

    const refLabel = this.doc.createElementNS(SVG_NS, "text");
    refLabel.textContent = "Ref";
    refLabel.setAttribute("x", String(labelX));
    refLabel.setAttribute("y", String(labelBaselineY(2)));
    refLabel.setAttribute("fill", textFill);
    refLabel.setAttribute("font-size", String(fontSize));
    this.svgGroupEl.appendChild(refLabel);

    // Cited-by (pentagon shape)
    const citedPentagon = this.doc.createElementNS(SVG_NS, "polygon");
    const pentagonPoints = this.getPentagonPoints(iconX, rowY(3), iconR);
    citedPentagon.setAttribute("points", pentagonPoints);
    citedPentagon.setAttribute("fill", "#94a3b8");
    citedPentagon.setAttribute("fill-opacity", "0.75");
    this.svgGroupEl.appendChild(citedPentagon);

    const citedLabel = this.doc.createElementNS(SVG_NS, "text");
    citedLabel.textContent = "Cited-by";
    citedLabel.setAttribute("x", String(labelX));
    citedLabel.setAttribute("y", String(labelBaselineY(3)));
    citedLabel.setAttribute("fill", textFill);
    citedLabel.setAttribute("font-size", String(fontSize));
    this.svgGroupEl.appendChild(citedLabel);

    // Seed (purple circle)
    const seedCircle = this.doc.createElementNS(SVG_NS, "circle");
    seedCircle.setAttribute("cx", String(iconX));
    seedCircle.setAttribute("cy", String(rowY(4)));
    seedCircle.setAttribute("r", String(iconR));
    seedCircle.setAttribute("fill", "#8b5cf6");
    seedCircle.setAttribute("fill-opacity", "0.75");
    seedCircle.setAttribute("stroke", dark ? "#a78bfa" : "#6d28d9");
    seedCircle.setAttribute("stroke-width", "1.4");
    seedCircle.setAttribute("stroke-opacity", "0.9");
    this.svgGroupEl.appendChild(seedCircle);

    const seedLabel = this.doc.createElementNS(SVG_NS, "text");
    seedLabel.textContent = "Seed";
    seedLabel.setAttribute("x", String(labelX));
    seedLabel.setAttribute("y", String(labelBaselineY(4)));
    seedLabel.setAttribute("fill", textFill);
    seedLabel.setAttribute("font-size", String(fontSize));
    this.svgGroupEl.appendChild(seedLabel);
  }

  private renderGraph(result: MultiSeedGraphResult): void {
    if (!this.svgEl || !this.svgGroupEl) return;
    this.entryByRecid.clear();
    this.nodeLabelByRecid.clear();
    this.hoverPreview?.hide();
    this.svgGroupEl.replaceChildren();

    const rect = this.svgEl.getBoundingClientRect();
    // Round to avoid tiny layout jitter causing visible reflows on repeated renders.
    const width = Math.max(200, Math.round(rect.width));
    const height = Math.max(200, Math.round(rect.height));

    const padX = 60;
    const padY = 60;
    const seedCount = Math.max(1, result.seeds.length);
    let midGap = seedCount <= 1 ? 40 : Math.min(220, 40 + seedCount * 22);
    const maxMidGap = Math.max(40, width - padX * 2 - 240);
    midGap = Math.min(midGap, maxMidGap);

    const refs = result.references;
    const cited = result.citedBy;
    const seeds = result.seeds;

    // Calculate left region (References) boundaries
    const leftWidth = (width - midGap) / 2;
    const leftMinX = padX;
    const leftMaxX = leftWidth - 10;

    // Calculate right region (Cited-by) boundaries
    const rightMinX = leftWidth + midGap;
    const rightMaxX = width - padX;

    // Center region (Seeds)
    const centerMinX = leftMaxX + 8;
    const centerMaxX = rightMinX - 8;

    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value));
    const stableHash = (value: string) => {
      let hash = 2166136261;
      for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    };
    const stableUnit = (value: string, salt: string) => {
      const hash = stableHash(`${salt}:${value}`);
      return (hash % 1_000_000) / 1_000_000;
    };
    const stableJitter = (value: string, maxAbs: number, salt: string) =>
      (stableUnit(value, salt) - 0.5) * 2 * maxAbs;

    const refsJitterMax = Math.min(14, Math.max(4, (leftMaxX - leftMinX) / 70));
    const citedJitterMax = Math.min(
      14,
      Math.max(4, (rightMaxX - rightMinX) / 70),
    );
    const seedJitterMax = Math.min(
      10,
      Math.max(2, (centerMaxX - centerMinX) / 30),
    );
    const availableHeight = Math.max(1, height - padY * 2);
    const refsYJitterMax = Math.min(55, Math.max(10, availableHeight / 22));
    const baseCitedYJitterMax = Math.min(
      140,
      Math.max(18, availableHeight / 8),
    );
    const seedYJitterMax = Math.min(12, Math.max(2, availableHeight / 220));

    const seedsKey = [...seeds].map((s) => s.recid).sort().join(",");
    if (this.timeZoomSeedsKey !== seedsKey) {
      this.timeZoomSeedsKey = seedsKey;
      this.refsTimeZoom = undefined;
      this.citedTimeZoom = undefined;
    }

    const currentYear = new Date().getFullYear();
    const now = currentYear + 0.5;

    const refsTimeValues = refs
      .map((e) => this.getEntryTimeValue(e))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const citedTimeValues = cited
      .map((e) => this.getEntryTimeValue(e))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const refsFullMin = refsTimeValues.length ? Math.min(...refsTimeValues) : now - 10;
    const refsFullMax = refsTimeValues.length ? Math.max(...refsTimeValues, now) : now;
    const citedFullMin = citedTimeValues.length ? Math.min(...citedTimeValues) : now - 5;
    const citedFullMax = citedTimeValues.length ? Math.max(...citedTimeValues, now) : now;

    const refsTime = this.normalizeTimeZoom(this.refsTimeZoom, refsFullMin, refsFullMax);
    const citedTime = this.normalizeTimeZoom(this.citedTimeZoom, citedFullMin, citedFullMax);
    this.refsTimeZoom = refsTime;
    this.citedTimeZoom = citedTime;

    const timeEps = 1 / 365;
    const isInRefsZoom = (v: number | null) =>
      v === null || (v >= refsTime.zoomMin && v <= refsTime.zoomMax);
    const isInCitedZoom = (v: number | null) =>
      v === null || (v >= citedTime.zoomMin && v <= citedTime.zoomMax);

    const refsVisibleEntries = refs.filter((e) =>
      isInRefsZoom(this.getEntryTimeValue(e)),
    );
    const citedVisibleEntries = cited.filter((e) =>
      isInCitedZoom(this.getEntryTimeValue(e)),
    );

    const computeAdaptiveCitationRange = (values: number[]) => {
      const filtered = values.filter(
        (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
      );
      if (!filtered.length) {
        return { min: 1, max: 100 };
      }
      const sorted = [...filtered].sort((a, b) => a - b);
      const n = sorted.length;
      const pick = (p: number) =>
        sorted[Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)))]!;
      const minCitations = sorted[0]!;
      const maxRaw = sorted[n - 1]!;
      // Use a robust max to avoid one outlier collapsing most nodes near the bottom.
      const maxCitations = n >= 10 ? pick(0.95) : maxRaw;

      const logMax = Math.log10(Math.max(1, maxCitations));
      const logMin = Math.log10(Math.max(1, minCitations));
      const logRange = logMax - logMin || 1;
      const logPadding = logRange * 0.1;
      const min = Math.max(1, Math.pow(10, logMin - logPadding));
      const max = Math.pow(10, logMax + logPadding);
      return { min, max: Math.max(min, max) };
    };

    const getEntryCitations = (entry: {
      citationCountWithoutSelf?: number;
      citationCount?: number;
    }): number => {
      const raw = entry.citationCountWithoutSelf ?? entry.citationCount ?? 0;
      return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
    };

    const refsCitations = refsVisibleEntries.map((e) => getEntryCitations(e));
    const citedCitations = citedVisibleEntries.map((e) => getEntryCitations(e));
    const seedCitations = seeds.map((s) =>
      typeof s.citationCount === "number" && Number.isFinite(s.citationCount) && s.citationCount > 0
        ? s.citationCount
        : 0,
    );

    const citedMinAll = citedCitations.length ? Math.min(...citedCitations) : 0;
    const citedMaxAll = citedCitations.length ? Math.max(...citedCitations) : 0;
    let citedMinCount = 0;
    for (const v of citedCitations) {
      if (v === citedMinAll) {
        citedMinCount++;
      }
    }
    const citedFullSpan = citedTime.fullMax - citedTime.fullMin;
    const citedZoomSpan = citedTime.zoomMax - citedTime.zoomMin;
    const citedZoomRatio =
      Number.isFinite(citedFullSpan) &&
      citedFullSpan > 0 &&
      Number.isFinite(citedZoomSpan) &&
      citedZoomSpan > 0
        ? citedFullSpan / citedZoomSpan
        : 1;
    const citedNonZeroSorted = citedCitations
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const citedMedian =
      citedNonZeroSorted.length > 0
        ? citedNonZeroSorted[Math.floor(citedNonZeroSorted.length * 0.5)]!
        : 0;
    const citedSkew =
      citedNonZeroSorted.length > 0 && citedMedian > 0
        ? Math.log10(1 + citedMaxAll) - Math.log10(1 + citedMedian)
        : 0;
    const citedLogRange =
      Math.log10(1 + citedMaxAll) - Math.log10(1 + citedMinAll);
    // When citation counts are extremely compressed (e.g. many 0/1), spread nodes to
    // better utilize the region (coordinates become indicative rather than exact).
    const enableCitedSpread =
      citedCitations.length >= 10 &&
      (citedMinCount >= Math.max(6, Math.ceil(citedCitations.length * 0.45)) ||
        citedLogRange < 0.25 ||
        citedSkew > 1.1 ||
        (citedZoomRatio > 1.25 && citedCitations.length >= 14));

    const citedYJitterMax = enableCitedSpread
      ? Math.min(24, baseCitedYJitterMax)
      : baseCitedYJitterMax;
    const refsCitationRange = computeAdaptiveCitationRange(refsCitations);
    const citedCitationRange = computeAdaptiveCitationRange(citedCitations);
    const seedCitationRange = computeAdaptiveCitationRange(seedCitations);

    const seedFill = "#8b5cf6";
    const nodeFill = "var(--material-background, #ffffff)";
    const textFill = "var(--fill-primary, #1e293b)";
    const textSecondary = "var(--fill-secondary, #64748b)";

    // Render split layout with two regions
    this.renderSplitLayout(
      width, height, padX, padY, midGap,
      leftMinX, leftMaxX, rightMinX, rightMaxX,
      refsTime, citedTime,
      refsCitationRange.min, refsCitationRange.max,
      citedCitationRange.min, citedCitationRange.max,
      textSecondary,
      refs.length, cited.length
    );

    const dark = isDarkMode();

    // Arrow markers (unique per dialog instance to avoid DOM id collisions)
    const arrowId = `${this.domIdPrefix}-arrow`;
    const seedOutArrowId = `${this.domIdPrefix}-seed-out-arrow`;
    const seedArrowId = `${this.domIdPrefix}-seed-arrow`;
    const defs = this.doc.createElementNS(SVG_NS, "defs");

    const makeArrowMarker = (id: string, fill: string) => {
      const marker = this.doc.createElementNS(SVG_NS, "marker");
      marker.setAttribute("id", id);
      marker.setAttribute("markerWidth", "7");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("refX", "6");
      marker.setAttribute("refY", "3.5");
      marker.setAttribute("orient", "auto");
      marker.setAttribute("markerUnits", "strokeWidth");
      const path = this.doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", "M0,0 L7,3.5 L0,7 Z");
      path.setAttribute("fill", fill);
      marker.appendChild(path);
      return marker;
    };

    const makeSeedArrowMarker = (id: string, fill: string) => {
      const marker = this.doc.createElementNS(SVG_NS, "marker");
      marker.setAttribute("id", id);
      marker.setAttribute("markerWidth", "5");
      marker.setAttribute("markerHeight", "5");
      marker.setAttribute("refX", "4");
      marker.setAttribute("refY", "2.5");
      marker.setAttribute("orient", "auto");
      marker.setAttribute("markerUnits", "strokeWidth");
      const path = this.doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", "M0,0 L5,2.5 L0,5 Z");
      path.setAttribute("fill", fill);
      marker.appendChild(path);
      return marker;
    };

    const normalMarkerFill = dark
      ? "rgba(148, 163, 184, 0.28)"
      : "rgba(100, 116, 139, 0.22)";
    const seedOutMarkerFill = dark
      ? "rgba(196, 181, 253, 0.32)"
      : "rgba(139, 92, 246, 0.26)";
    const seedMarkerFill = dark
      ? "rgba(167, 139, 250, 0.55)"
      : "rgba(139, 92, 246, 0.55)";
    defs.appendChild(makeArrowMarker(arrowId, normalMarkerFill));
    defs.appendChild(makeArrowMarker(seedOutArrowId, seedOutMarkerFill));
    defs.appendChild(makeSeedArrowMarker(seedArrowId, seedMarkerFill));
    this.svgGroupEl.appendChild(defs);

    const edgesLayer = this.doc.createElementNS(SVG_NS, "g");
    edgesLayer.style.pointerEvents = "none";
    const nodesLayer = this.doc.createElementNS(SVG_NS, "g");
    this.svgGroupEl.appendChild(edgesLayer);
    this.svgGroupEl.appendChild(nodesLayer);

    // Collect node positions for legend placement (will be populated during node rendering)
    const nodePositions: Array<{x: number; y: number; r: number}> = [];

    const makeNode = (opts: {
      recid: string;
      title: string;
      authorLabel: string;  // "Author et al. (Year)" format
      x: number;
      y: number;
      r: number;
      textAnchor: "start" | "end";
      labelX: number;
      labelY: number;
      isSeed?: boolean;
      localItemID?: number;
      year?: string;
      kind: "seed" | "reference" | "citedBy";
    }) => {
      const group = this.doc.createElementNS(SVG_NS, "g");
      group.setAttribute("data-recid", opts.recid);
      group.style.cursor = "pointer";

      // Determine fill color based on Zotero status
      // Green for in library, gray for online (consistent with References panel marker concept)
      const seedLabelColor = dark ? "#a78bfa" : "#6d28d9";
      const inLibrary = typeof opts.localItemID === "number";
      const localColor = dark ? "#22c55e" : "#1a8f4d";  // Green
      const onlineColor = dark ? "#6b7280" : "#9ca3af";  // Gray
      const fillColor = opts.isSeed
        ? seedFill
        : inLibrary ? localColor : onlineColor;

      // Use circle for references/seeds, pentagon for cited-by
      if (opts.kind === "citedBy" && !opts.isSeed) {
        // Draw a pentagon for cited-by
        const pentagon = this.doc.createElementNS(SVG_NS, "polygon");
        const points = this.getPentagonPoints(opts.x, opts.y, opts.r);
        pentagon.setAttribute("points", points);
        pentagon.setAttribute("fill", fillColor);
        pentagon.setAttribute("fill-opacity", "0.75");
        group.appendChild(pentagon);
      } else {
        // Circle for references and seed
        const circle = this.doc.createElementNS(SVG_NS, "circle");
        circle.setAttribute("cx", String(opts.x));
        circle.setAttribute("cy", String(opts.y));
        circle.setAttribute("r", String(opts.r));
        circle.setAttribute("fill", fillColor);
        circle.setAttribute("fill-opacity", "0.75");
        if (opts.isSeed) {
          circle.setAttribute("stroke", seedLabelColor);
          circle.setAttribute("stroke-width", "1.5");
          circle.setAttribute("stroke-opacity", "0.9");
        }
        group.appendChild(circle);
      }

      // Show "Author et al. (Year)" label only
      const label = this.doc.createElementNS(SVG_NS, "text");
      label.textContent = opts.authorLabel;
      label.setAttribute("x", String(opts.labelX));
      label.setAttribute("y", String(opts.labelY));
      label.setAttribute("fill", opts.isSeed ? seedLabelColor : textFill);
      label.setAttribute("font-size", "10");
      label.setAttribute("text-anchor", opts.textAnchor);
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("opacity", "0.9");
      group.appendChild(label);

      // Hover handlers: reuse HoverPreviewController (same as PDF annotate / panel).
      group.addEventListener("mouseenter", (e: MouseEvent) => {
        this.scheduleHoverPreview(
          opts.recid,
          e.currentTarget as Element,
          { x: e.clientX, y: e.clientY },
        );
      });
      group.addEventListener("mouseleave", () => {
        this.hoverPreview?.cancelShow();
        this.hoverPreview?.scheduleHide();
      });

      return group;
    };

    const buildAuthorLabel = (entry: {
      authors?: string[];
      authorText?: string;
      year?: string;
    }) => {
      let authorPart = "";
      if (entry.authors && entry.authors.length > 0) {
        const firstAuthor = entry.authors[0];
        const isNonPerson =
          typeof firstAuthor === "string" &&
          /collaboration|group|team|consortium|project|experiment/i.test(
            firstAuthor,
          );
        if (isNonPerson) {
          authorPart = firstAuthor.trim();
        } else {
          const parts = firstAuthor.includes(",")
            ? firstAuthor.split(",")[0].trim()
            : firstAuthor.split(" ").pop() || firstAuthor;
          authorPart = entry.authors.length > 1 ? `${parts} et al.` : parts;
        }
      } else if (entry.authorText) {
        const raw = entry.authorText.trim();
        const isNonPerson =
          /collaboration|group|team|consortium|project|experiment/i.test(raw);
        if (isNonPerson) {
          authorPart = raw;
        } else {
          const etAlMatch = raw.match(/^(.*?)\s+et\s+al\.?$/i);
          if (etAlMatch) {
            const before = etAlMatch[1].trim();
            const base = before.includes(",")
              ? before.split(",")[0].trim()
              : before;
            const last = base.split(/\s+/).filter(Boolean).pop() || base;
            if (!last || /^al\.?$/i.test(last) || /^et\.?$/i.test(last)) {
              authorPart = raw;
            } else {
              authorPart = `${last} et al.`;
            }
          } else if (raw.includes(",")) {
            const firstSeg = raw.split(",")[0].trim();
            const last = firstSeg.split(/\s+/).filter(Boolean).pop() || firstSeg;
            if (!last || /^al\.?$/i.test(last) || /^et\.?$/i.test(last)) {
              authorPart = firstSeg || raw;
            } else {
              authorPart = `${last} et al.`;
            }
          } else {
            // Use last token as a compact display label (e.g., "David J. Gross" → "Gross").
            const last = raw.split(/\s+/).filter(Boolean).pop() || raw;
            authorPart = last;
          }
        }
      }

      const yearValue =
        entry.year && entry.year !== "Unknown" ? entry.year.trim() : "";
      const yearPart = yearValue ? ` (${yearValue})` : "";
      return authorPart ? `${authorPart}${yearPart}` : yearValue || "";
    };

    type NodeData = {
      kind: "seed" | "reference" | "citedBy";
      recid: string;
      x: number;
      y: number;
      baseX: number;
      baseY: number;
      maxXShift: number;
      maxYShift: number;
      r: number;
      label: string;
      regionMinX: number;
      regionMaxX: number;
      localItemID?: number;
      year?: string;
      title: string;
      entry?: InspireReferenceEntry;
    };

    const allNodes: NodeData[] = [];
    const refsRegionWidth = Math.max(1, leftMaxX - leftMinX);
    const citedRegionWidth = Math.max(1, rightMaxX - rightMinX);
    const refsMaxXShift = Math.max(26, Math.min(refsRegionWidth * 0.28, 160));
    const citedMaxXShift = enableCitedSpread
      ? Math.max(120, Math.min(citedRegionWidth, 520))
      : Math.max(80, Math.min(citedRegionWidth * 0.55, 320));
    const refsMaxYShift = Math.max(50, Math.min(availableHeight * 0.3, 220));
    const citedMaxYShift = enableCitedSpread
      ? Math.max(220, Math.min(availableHeight, 720))
      : Math.max(140, Math.min(availableHeight * 0.6, 380));
    const citedSpreadMaxY = enableCitedSpread ? availableHeight * 0.85 : 0;
    const citedSpreadLogMin = Math.log1p(Math.max(0, citedMinAll));
    const citedSpreadLogMax = Math.log1p(Math.max(0, citedMaxAll));
    const citedSpreadLogRange = citedSpreadLogMax - citedSpreadLogMin || 1;

    const refsVisibleRecids = refsVisibleEntries
      .map((e) => (typeof e.recid === "string" ? e.recid.trim() : ""))
      .filter((r): r is string => r.length > 0);
    const refsVisibleTimes = refsVisibleEntries
      .map((e) => this.getEntryTimeValue(e))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const citedVisibleRecids = citedVisibleEntries
      .map((e) => (typeof e.recid === "string" ? e.recid.trim() : ""))
      .filter((r): r is string => r.length > 0);
    const citedVisibleTimes = citedVisibleEntries
      .map((e) => this.getEntryTimeValue(e))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const refsTimeRange = refsVisibleTimes.length
      ? Math.max(...refsVisibleTimes) - Math.min(...refsVisibleTimes)
      : 0;
    const citedTimeRange = citedVisibleTimes.length
      ? Math.max(...citedVisibleTimes) - Math.min(...citedVisibleTimes)
      : 0;
    const useRefsTimeAxis = refsTimeRange > timeEps;
    const useCitedTimeAxis = citedTimeRange > timeEps;

    let refsBaseXByRecid: Map<string, number> | undefined;
    if (!useRefsTimeAxis) {
      const recids = Array.from(
        new Set(
          refsVisibleRecids
            .filter((r) => typeof r === "string" && r.trim().length > 0)
            .map((r) => r.trim()),
        ),
      );
      recids.sort((a, b) => stableUnit(a, "ref-x-order") - stableUnit(b, "ref-x-order"));
      const span = Math.max(1, leftMaxX - leftMinX);
      const denom = Math.max(1, recids.length);
      refsBaseXByRecid = new Map<string, number>();
      for (let i = 0; i < recids.length; i++) {
        const x = leftMinX + ((i + 0.5) / denom) * span;
        refsBaseXByRecid.set(recids[i]!, x);
      }
    }

    let citedBaseXByRecid: Map<string, number> | undefined;
    if (!useCitedTimeAxis) {
      const recids = Array.from(
        new Set(
          citedVisibleRecids
            .filter((r) => typeof r === "string" && r.trim().length > 0)
            .map((r) => r.trim()),
        ),
      );
      recids.sort((a, b) => stableUnit(a, "cited-x-order") - stableUnit(b, "cited-x-order"));
      const span = Math.max(1, rightMaxX - rightMinX);
      const denom = Math.max(1, recids.length);
      citedBaseXByRecid = new Map<string, number>();
      for (let i = 0; i < recids.length; i++) {
        const x = rightMinX + ((i + 0.5) / denom) * span;
        citedBaseXByRecid.set(recids[i]!, x);
      }
    }

    // Seeds nodes
    const seedYears = seeds
      .map((s) => parseInt(s.year || "", 10))
      .filter((y) => !isNaN(y));
    const seedMinYear = seedYears.length
      ? Math.min(...seedYears)
      : currentYear - 5;
    const seedMaxYear = seedYears.length
      ? Math.max(...seedYears, currentYear)
      : currentYear;
    const centerWidth = Math.max(1, centerMaxX - centerMinX);
    const seedFallbackStep = Math.min(14, Math.max(10, centerWidth / (seedCount + 1)));
    const seedMaxXShift = Math.max(12, Math.min(centerWidth * 0.35, 90));

    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const yearFraction = this.parseDateToFractionalYear(seed.year || "");
      const citations = seed.citationCount ?? 0;
      let x = (centerMinX + centerMaxX) / 2;
      if (centerMaxX > centerMinX + 20) {
        x = yearFraction === null
          ? centerMinX + seedFallbackStep * (i + 1)
          : this.getXPositionInRegion(yearFraction, seedMinYear, seedMaxYear, centerMinX, centerMaxX);
      }
      if (seedCount > 1) {
        x = clamp(
          x + stableJitter(seed.recid, seedJitterMax, "seed-x"),
          centerMinX,
          centerMaxX,
        );
      }
      const baseY = this.getYPosition(
        citations > 0 ? citations : seedCitationRange.min,
        seedCitationRange.min,
        seedCitationRange.max,
        height,
        padY,
      );
      const y =
        seedCount > 1
          ? clamp(
              baseY + stableJitter(seed.recid, seedYJitterMax, "seed-y"),
              padY,
              height - padY,
            )
          : baseY;
      const seedYear =
        typeof seed.year === "string" && seed.year.trim() ? seed.year.trim() : "";
      const seedAuthorLabel =
        typeof seed.authorLabel === "string" && seed.authorLabel.trim()
          ? seed.authorLabel.trim()
          : "";
      const label = (() => {
        if (seedAuthorLabel) {
          if (seedYear && !/\(\s*\d{4}\s*\)\s*$/.test(seedAuthorLabel)) {
            return `${seedAuthorLabel} (${seedYear})`;
          }
          return seedAuthorLabel;
        }
        return seedYear || seed.title || seed.recid;
      })();
      const seedAuthorText =
        typeof seed.authorLabel === "string"
          ? seed.authorLabel.replace(/\s*\(\d{4}\)\s*$/, "").trim()
          : "";
      const seedEntry: InspireReferenceEntry = {
        id: `seed-${seed.recid}`,
        recid: seed.recid,
        inspireUrl: seed.inspireUrl,
        fallbackUrl: seed.inspireUrl,
        title: seed.title || seed.recid,
        titleOriginal: seed.title || seed.recid,
        summary: undefined,
        year: seed.year || "Unknown",
        authors: seedAuthorText ? [seedAuthorText] : [],
        totalAuthors: undefined,
        authorText: seedAuthorText,
        displayText: "",
        searchText: "",
        localItemID: seed.localItemID,
        isRelated: false,
        citationCount: seed.citationCount,
        citationCountWithoutSelf: seed.citationCount,
        publicationInfo: seed.year ? { year: seed.year } : undefined,
      };
      allNodes.push({
        kind: "seed",
        recid: seed.recid,
        x,
        y,
        baseX: x,
        baseY,
        maxXShift: seedMaxXShift,
        maxYShift: Math.max(10, seedYJitterMax + 8),
        r: 6,
        label,
        regionMinX: centerMinX,
        regionMaxX: centerMaxX,
        localItemID: seed.localItemID,
        year: seed.year,
        title: seed.title || seed.recid,
        entry: seedEntry,
      });
    }

    // Collect References data
    for (const entry of refs) {
      const recid = entry.recid || "";
      if (!recid) continue;
      const yearFraction = this.getEntryTimeValue(entry);
      if (!isInRefsZoom(yearFraction)) {
        continue;
      }
      const citations = entry.citationCountWithoutSelf ?? entry.citationCount ?? 0;
      const baseX =
        yearFraction === null || !useRefsTimeAxis
          ? (refsBaseXByRecid?.get(recid) ??
            leftMinX + stableUnit(recid, "ref-x-base") * (leftMaxX - leftMinX))
          : this.getXPositionInRegion(
              yearFraction,
              refsTime.zoomMin,
              refsTime.zoomMax,
              leftMinX,
              leftMaxX,
            );
      const x = clamp(
        baseX + stableJitter(recid, refsJitterMax, "ref-x-jitter"),
        leftMinX,
        leftMaxX,
      );
      const baseY = this.getYPosition(
        citations > 0 ? citations : refsCitationRange.min,
        refsCitationRange.min,
        refsCitationRange.max,
        height,
        padY,
      );
      const y = clamp(
        baseY + stableJitter(recid, refsYJitterMax, "ref-y-jitter"),
        padY,
        height - padY,
      );
      const r = this.getNodeRadius(citations);
      const authorLabel = buildAuthorLabel(entry);
      allNodes.push({
        kind: "reference",
        entry,
        recid,
        x,
        y,
        baseX,
        baseY,
        maxXShift: refsMaxXShift,
        maxYShift: refsMaxYShift,
        r,
        label: authorLabel,
        regionMinX: leftMinX,
        regionMaxX: leftMaxX,
        localItemID: entry.localItemID,
        year: entry.year,
        title: entry.title || recid,
      });
    }

    // Collect Cited-by data
    for (const entry of cited) {
      const recid = entry.recid || "";
      if (!recid) continue;
      const yearFraction = this.getEntryTimeValue(entry);
      if (!isInCitedZoom(yearFraction)) {
        continue;
      }
      const citations = entry.citationCountWithoutSelf ?? entry.citationCount ?? 0;
      const baseX =
        yearFraction === null || !useCitedTimeAxis
          ? (citedBaseXByRecid?.get(recid) ??
            rightMinX +
              stableUnit(recid, "cited-x-base") * (rightMaxX - rightMinX))
          : this.getXPositionInRegion(
              yearFraction,
              citedTime.zoomMin,
              citedTime.zoomMax,
              rightMinX,
              rightMaxX,
            );
      const x = clamp(
        baseX + stableJitter(recid, citedJitterMax, "cited-x-jitter"),
        rightMinX,
        rightMaxX,
      );
      const axisBaseY = this.getYPosition(
        citations > 0 ? citations : citedCitationRange.min,
        citedCitationRange.min,
        citedCitationRange.max,
        height,
        padY,
      );
      const baseY = (() => {
        if (!enableCitedSpread || !citedSpreadMaxY) {
          return axisBaseY;
        }
        const normRaw =
          (Math.log1p(Math.max(0, citations)) - citedSpreadLogMin) /
          citedSpreadLogRange;
        const norm = clamp(normRaw, 0, 1);
        const strength = 1 - norm;
        // Bias the spread upward to avoid a dense "bottom row" when low-citation nodes dominate.
        const unit = stableUnit(recid, "cited-y-spread");
        const offset = -unit * citedSpreadMaxY * strength;
        return clamp(axisBaseY + offset, padY, height - padY);
      })();
      const y = clamp(
        baseY + stableJitter(recid, citedYJitterMax, "cited-y-jitter"),
        padY,
        height - padY,
      );
      const r = this.getNodeRadius(citations);
      const authorLabel = buildAuthorLabel(entry);
      allNodes.push({
        kind: "citedBy",
        entry,
        recid,
        x,
        y,
        baseX,
        baseY,
        maxXShift: citedMaxXShift,
        maxYShift: citedMaxYShift,
        r,
        label: authorLabel,
        regionMinX: rightMinX,
        regionMaxX: rightMaxX,
        localItemID: entry.localItemID,
        year: entry.year,
        title: entry.title || recid,
      });
    }

    // Nudge nodes apart within each region to reduce overlaps.
    // Allow small Y drift around the log-citation axis mapping to avoid exact overlaps.
    const relaxNodes = (
      nodes: NodeData[],
      options?: { padding?: number; iterations?: number },
    ) => {
      const padding = options?.padding ?? 3;
      const iterations = options?.iterations ?? 28;
      const ordered = [...nodes].sort((a, b) => a.recid.localeCompare(b.recid));
      for (let iter = 0; iter < iterations; iter++) {
        let moved = false;
        for (let i = 0; i < ordered.length; i++) {
          const a = ordered[i];
          for (let j = i + 1; j < ordered.length; j++) {
            const b = ordered[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = a.r + b.r + padding;
            if (dist >= minDist) continue;

            const overlap = minDist - (dist || 0);
            let ux = 0;
            let uy = 0;
            if (!dist) {
              const theta =
                stableUnit(`${a.recid}|${b.recid}`, "relax-angle") * Math.PI * 2;
              ux = Math.cos(theta);
              uy = Math.sin(theta);
              // Prefer horizontal dispersion for dense "bottom row" clusters.
              if (Math.abs(uy) > 0.85) {
                uy *= 0.35;
                const norm = Math.sqrt(ux * ux + uy * uy) || 1;
                ux /= norm;
                uy /= norm;
              }
            } else {
              ux = dx / dist;
              uy = dy / dist;
            }

            const push = overlap * 0.5;
            const aMinX = clamp(a.baseX - a.maxXShift, a.regionMinX, a.regionMaxX);
            const aMaxX = clamp(a.baseX + a.maxXShift, a.regionMinX, a.regionMaxX);
            const bMinX = clamp(b.baseX - b.maxXShift, b.regionMinX, b.regionMaxX);
            const bMaxX = clamp(b.baseX + b.maxXShift, b.regionMinX, b.regionMaxX);
            a.x = clamp(a.x - ux * push, aMinX, aMaxX);
            b.x = clamp(b.x + ux * push, bMinX, bMaxX);

            const aMinY = clamp(a.baseY - a.maxYShift, padY, height - padY);
            const aMaxY = clamp(a.baseY + a.maxYShift, padY, height - padY);
            const bMinY = clamp(b.baseY - b.maxYShift, padY, height - padY);
            const bMaxY = clamp(b.baseY + b.maxYShift, padY, height - padY);
            a.y = clamp(a.y - uy * push, aMinY, aMaxY);
            b.y = clamp(b.y + uy * push, bMinY, bMaxY);

            moved = true;
          }
        }
        if (!moved) break;
      }
    };

    relaxNodes(allNodes.filter((n) => n.kind === "seed"), {
      padding: 2,
      iterations: 18,
    });
    relaxNodes(allNodes.filter((n) => n.kind === "reference"), {
      padding: 3,
      iterations: 28,
    });
    relaxNodes(allNodes.filter((n) => n.kind === "citedBy"), {
      padding: enableCitedSpread ? 5 : 3,
      iterations: enableCitedSpread ? 64 : 34,
    });

    // Second pass: resolve label positions to avoid overlaps
    const labelPositions = this.resolveLabelPositions(
      allNodes.map((n) => ({
        x: n.x,
        y: n.y,
        r: n.r,
        label: n.label,
        regionMinX: n.regionMinX,
        regionMaxX: n.regionMaxX,
      }))
    );

    // Build position map before drawing edges/nodes.
    const posByRecid = new Map<string, { x: number; y: number; r: number; kind: NodeData["kind"] }>();
    for (let i = 0; i < allNodes.length; i++) {
      const n = allNodes[i];
      posByRecid.set(n.recid, { x: n.x, y: n.y, r: n.r, kind: n.kind });
    }

    // Draw edges first (behind nodes).
    const edgeList: Array<{
      source: string;
      target: string;
      type: "seed-to-seed" | "seed-to-reference" | "cited-by-to-seed" | "node-to-node";
    }> = [];
    const pairSeen = new Set<string>();
    const pushEdge = (edge: {
      source: string;
      target: string;
      type: "seed-to-seed" | "seed-to-reference" | "cited-by-to-seed" | "node-to-node";
    }) => {
      const key = `${edge.source}->${edge.target}`;
      if (pairSeen.has(key)) return;
      pairSeen.add(key);
      edgeList.push(edge);
    };

    const seedRecidSet = new Set(
      this.seeds.map((s) => s.recid).filter((r) => typeof r === "string" && r.length > 0),
    );

    for (const edge of result.seedEdges) {
      pushEdge({ source: edge.source, target: edge.target, type: "seed-to-seed" });
    }
    const bySeed = result.bySeed || {};
    for (const [seedRecid, detail] of Object.entries(bySeed)) {
      for (const refRecid of detail.references) {
        pushEdge({ source: seedRecid, target: refRecid, type: "seed-to-reference" });
      }
      for (const citedRecid of detail.citedBy) {
        pushEdge({ source: citedRecid, target: seedRecid, type: "cited-by-to-seed" });
      }
    }
    const currentKey = this.getConnectionsGraphKey();
    if (
      this.showAllConnections &&
      !this.connectionsLoading &&
      this.allConnectionsGraphKey === currentKey
    ) {
      for (const edge of this.allConnectionEdges) {
        const type =
          seedRecidSet.has(edge.source) && seedRecidSet.has(edge.target)
            ? "seed-to-seed"
            : "node-to-node";
        pushEdge({ source: edge.source, target: edge.target, type });
      }
    }

    const drawEdge = (
      source: { x: number; y: number; r: number },
      target: { x: number; y: number; r: number },
      style: {
        stroke: string;
        width: number;
        markerId: string;
        opacity: number;
        dasharray?: string;
      },
    ) => {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ux = dx / len;
      const uy = dy / len;
      const x1 = source.x + ux * source.r;
      const y1 = source.y + uy * source.r;
      const x2 = target.x - ux * target.r;
      const y2 = target.y - uy * target.r;

      const line = this.doc.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", style.stroke);
      line.setAttribute("stroke-width", String(style.width));
      line.setAttribute("opacity", String(style.opacity));
      line.setAttribute("marker-end", `url(#${style.markerId})`);
      if (style.dasharray) {
        line.setAttribute("stroke-dasharray", style.dasharray);
        line.setAttribute("stroke-linecap", "round");
      }
      edgesLayer.appendChild(line);
    };

    const normalEdgeStyle = {
      stroke: dark ? "rgba(148, 163, 184, 0.22)" : "rgba(100, 116, 139, 0.18)",
      width: 1.0,
      markerId: arrowId,
      opacity: 1,
    };
    const connectionsEdgeStyle = {
      stroke: dark ? "rgba(148, 163, 184, 0.26)" : "rgba(100, 116, 139, 0.22)",
      width: 0.8,
      markerId: arrowId,
      opacity: 0.75,
      dasharray: "5 4",
    };
    const seedOutEdgeStyle = {
      stroke: dark ? "rgba(196, 181, 253, 0.25)" : "rgba(139, 92, 246, 0.20)",
      width: 1.1,
      markerId: seedOutArrowId,
      opacity: 1,
    };
    const seedEdgeStyle = {
      stroke: dark ? "rgba(167, 139, 250, 0.55)" : "rgba(139, 92, 246, 0.55)",
      width: 1.4,
      markerId: seedArrowId,
      opacity: 1,
    };

    for (const edge of edgeList) {
      const source = posByRecid.get(edge.source);
      const target = posByRecid.get(edge.target);
      if (!source || !target) continue;
      const style =
        edge.type === "seed-to-seed"
          ? seedEdgeStyle
          : edge.type === "seed-to-reference" || edge.type === "cited-by-to-seed"
            ? seedOutEdgeStyle
            : edge.type === "node-to-node"
              ? connectionsEdgeStyle
              : normalEdgeStyle;
      drawEdge(source, target, style);
    }

    // Third pass: render nodes with adjusted label positions
    for (let i = 0; i < allNodes.length; i++) {
      const n = allNodes[i];
      const { labelX, labelY, anchor } = labelPositions[i];

      if (n.entry) {
        this.entryByRecid.set(n.recid, n.entry);
      }
      this.nodeLabelByRecid.set(n.recid, n.label);

      const node = makeNode({
        recid: n.recid,
        title: n.title,
        authorLabel: n.label,
        x: n.x,
        y: n.y,
        r: n.r,
        textAnchor: anchor,
        labelX,
        labelY,
        isSeed: n.kind === "seed",
        localItemID: n.localItemID,
        year: n.year,
        kind: n.kind,
      });
      nodesLayer.appendChild(node);
      nodePositions.push({ x: n.x, y: n.y, r: n.r });
    }

    // Render legend after nodes (to find best position)
    this.renderLegend(width, padX, textFill, textSecondary, nodePositions);

    this.applyViewTransform();
  }
}
