import {
  graphButton,
  styleGraphSelect,
  styleGraphToolbar,
} from "./graphControls";
import { createAbortController } from "../utils";
import { academicSearchHistory } from "../searchHistory";
import { SearchHistoryInput } from "./SearchHistoryInput";
import {
  AuthorPreviewController,
  type AuthorPreviewCallbacks,
} from "./AuthorPreviewController";
import { getString } from "../../../utils/locale";
import type { FluentMessageId } from "../../../../typings/i10n";
import type { AuthorSearchInfo, InspireAuthorProfile } from "../types";
import {
  ACADEMIC_QUALIFICATIONS,
  academicDegreeLabel,
} from "../academicTreeQualifications";
import type {
  AcademicTreeGraph,
  AcademicTreeNode,
  AcademicDegreeFilter,
  AcademicDirection,
  AcademicTreeSource,
} from "../academicTreeTypes";
import {
  ACADEMIC_TREE_DEFAULT_DEPTH,
  ACADEMIC_TREE_MAX_ANCESTOR_DEPTH,
  ACADEMIC_TREE_MAX_DESCENDANT_DEPTH,
  ACADEMIC_TREE_INITIAL_LIMIT,
  ACADEMIC_TREE_MAX_NODES,
} from "../academicTreeTypes";
import {
  academicTreeSource,
  createAcademicTreeSession,
  searchAcademicAuthors,
} from "../academicTreeDataService";
import { buildAcademicTree } from "../academicTreeService";
import { AcademicTreeCanvas } from "./AcademicTreeCanvas";
import { AcademicTreeTools } from "./AcademicTreeTools";
import { exportAcademicTree } from "./AcademicTreeExport";
import {
  academicReachable,
  academicPrimaryLineage,
  type AcademicTreeViewState,
} from "../academicTreeExploration";
import { NAVIGATION_STACK_LIMIT } from "../constants";
import { applyPillButtonColors } from "../../pickerUI";
import { isDarkMode } from "../styles";

interface AcademicTreeLoad {
  source: AcademicTreeSource;
  recid: string;
  expansion?: AcademicDirection;
  anchorId?: string;
  existing?: AcademicTreeGraph;
  refresh: boolean;
  batch?: boolean;
  expansions?: Array<{
    id: string;
    direction: AcademicDirection;
    remaining?: number;
  }>;
}

interface AcademicTreeSnapshot {
  author: AuthorSearchInfo;
  root?: InspireAuthorProfile;
  graph?: AcademicTreeGraph;
  selected?: string;
  up: string;
  down: string;
  degree: string;
  limit: number;
  expansion?: { id: string; direction: AcademicDirection };
  viewport: ReturnType<AcademicTreeCanvas["captureViewport"]>;
  status: string;
  moreHidden: boolean;
  pending?: AcademicTreeLoad;
  recovery?: "retry" | "continue";
  exploration: AcademicTreeViewState;
}

/** Author genealogy content hosted in the citation graph's resizable window. */
export class AcademicTreeView {
  readonly element: HTMLDivElement;
  private canvas: AcademicTreeCanvas;
  private tools: AcademicTreeTools;
  private authorPreview: AuthorPreviewController;
  private status: HTMLDivElement;
  private details: HTMLDivElement;
  private actions: HTMLDivElement;
  private candidates: HTMLDivElement;
  private searchInput: HTMLInputElement;
  private searchHistory: SearchHistoryInput;
  private up: HTMLSelectElement;
  private down: HTMLSelectElement;
  private degree: HTMLSelectElement;
  private stop: HTMLButtonElement;
  private refresh: HTMLButtonElement;
  private recover: HTMLButtonElement;
  private pending?: AcademicTreeLoad;
  private recovery?: "retry" | "continue";
  private more: HTMLButtonElement;
  private back: HTMLButtonElement;
  private forward: HTMLButtonElement;
  private backStack: AcademicTreeSnapshot[] = [];
  private forwardStack: AcademicTreeSnapshot[] = [];
  private root?: InspireAuthorProfile;
  private graph?: AcademicTreeGraph;
  private selected?: string;
  private abort?: AbortController;
  private searchAbort?: AbortController;
  private sequence = 0;
  private searchSequence = 0;
  private actionAbort?: AbortController;
  private disposed = false;
  private limit = ACADEMIC_TREE_INITIAL_LIMIT;
  private pageButton: HTMLButtonElement;
  private busy = false;
  private lastExpansion?: { id: string; direction: AcademicDirection };
  private cleanup: Array<() => void> = [];

  constructor(
    private doc: Document,
    private initialAuthor?: AuthorSearchInfo,
    private onViewPapers?: (author: AuthorSearchInfo) => void,
    previewContainer?: HTMLElement,
    previewCallbacks?: AuthorPreviewCallbacks,
  ) {
    this.element = doc.createElement("div");
    this.element.className = "zinspire-academic-tree";
    this.element.style.cssText =
      "display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;color:var(--fill-primary,#1e293b);font:13px system-ui,sans-serif";
    this.authorPreview = new AuthorPreviewController({
      document: doc,
      container: previewContainer || this.element,
      callbacks: {
        ...previewCallbacks,
        onViewPapers: async (author) => {
          this.authorPreview.hide();
          if (author.recid)
            await this.viewPapers({
              id: author.recid,
              recid: author.recid,
              name: author.fullName,
              level: 0,
            });
        },
        onAcademicTree: (author) => {
          this.authorPreview.hide();
          if (author.recid)
            void this.followName({
              id: author.recid,
              recid: author.recid,
              name: author.fullName,
              level: 0,
            });
        },
      },
    });
    const toolbar = this.row();
    styleGraphToolbar(toolbar);
    toolbar.style.flexWrap = "wrap";
    this.back = this.button(
      "academic-tree-back",
      () => void this.navigate("back"),
    );
    this.forward = this.button(
      "academic-tree-forward",
      () => void this.navigate("forward"),
    );
    this.back.textContent = "←";
    this.forward.textContent = "→";
    this.updateNavigation();
    toolbar.append(this.back, this.forward);
    this.searchInput = doc.createElement("input");
    this.searchInput.type = "search";
    this.searchInput.placeholder = getString(
      "academic-tree-search-placeholder",
    );
    this.searchInput.setAttribute("aria-label", this.searchInput.placeholder);
    this.searchInput.value = initialAuthor?.fullName || "";
    this.searchInput.style.cssText =
      "flex:1;min-width:140px;max-width:210px;background:var(--material-background,#fff);color:inherit;border:1px solid var(--fill-quinary,#ccc);padding:4px 9px;border-radius:12px;font-size:12px";
    const search = this.button(
      "academic-tree-search",
      () => void this.search(),
    );
    this.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.search();
      }
    });
    const searchWrapper = doc.createElement("div");
    searchWrapper.style.cssText =
      "position:relative;display:flex;flex:1;min-width:140px;max-width:210px;overflow:hidden";
    this.searchInput.style.width = "100%";
    this.searchInput.style.boxSizing = "border-box";
    searchWrapper.append(this.searchInput);
    const historyButton = this.button(
      "references-panel-search-history-tooltip",
      () => {},
    );
    historyButton.textContent = "▾";
    this.searchHistory = new SearchHistoryInput(
      this.searchInput,
      searchWrapper,
      historyButton,
      academicSearchHistory,
      (query) => void this.search(query),
    );
    toolbar.append(searchWrapper, historyButton, search);
    this.up = this.depth(
      toolbar,
      "academic-tree-up",
      ACADEMIC_TREE_MAX_ANCESTOR_DEPTH,
    );
    this.down = this.depth(
      toolbar,
      "academic-tree-down",
      ACADEMIC_TREE_MAX_DESCENDANT_DEPTH,
    );
    this.degree = doc.createElement("select");
    this.degree.setAttribute("aria-label", getString("academic-tree-degree"));
    for (const [value, key] of Object.entries({
      all: "academic-tree-all",
      specified: "academic-tree-specified",
      ...ACADEMIC_QUALIFICATIONS,
    })) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = getString(key as FluentMessageId);
      this.degree.appendChild(option);
    }
    this.styleSelect(this.degree);
    this.degree.addEventListener("change", () => {
      this.limit = ACADEMIC_TREE_INITIAL_LIMIT;
      void this.load();
    });
    toolbar.appendChild(this.degree);
    const controls = this.row();
    this.stop = this.button("academic-tree-stop", () => this.cancel());
    this.stop.disabled = true;
    this.more = this.button("academic-tree-more", () => {
      this.limit = Math.min(ACADEMIC_TREE_MAX_NODES, this.limit + 200);
      void this.load(undefined, undefined, "resume");
    });
    this.more.hidden = true;
    this.refresh = this.button(
      "academic-tree-refresh",
      () => void this.load(undefined, undefined, "refresh"),
    );
    this.refresh.title = getString("academic-tree-refresh-hint");
    this.refresh.textContent = "↻";
    this.refresh.style.fontSize = "18px";
    this.refresh.style.padding = "0 8px";
    this.recover = this.button(
      "academic-tree-retry",
      () => void this.load(undefined, undefined, "resume"),
    );
    toolbar.prepend(this.refresh);
    controls.append(this.recover, this.stop, this.more);
    this.updateLoadControls();
    this.status = doc.createElement("div");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("data-academic-status", "");
    this.status.style.cssText =
      "color:var(--fill-secondary,#64748b);flex:1;min-width:180px;font-size:12px";
    this.status.textContent = getString("academic-tree-choose");
    controls.prepend(this.status);
    controls.style.borderBottom = "1px solid var(--fill-quinary,#e2e8f0)";
    this.candidates = doc.createElement("div");
    this.candidates.style.cssText =
      "max-height:170px;overflow:auto;padding:0 12px;flex-shrink:0";
    this.canvas = new AcademicTreeCanvas(
      doc,
      getString("academic-tree-canvas-help"),
      (node) => this.select(node),
      (node) => void this.followName(node),
      (node) => this.describe(node),
      (node, anchor) => {
        if (!node.recid) return;
        this.authorPreview.scheduleAuthor(
          { recid: node.recid, fullName: node.name },
          anchor,
          (author, signal) =>
            signal
              ? academicTreeSource.profile(author.recid!, signal)
              : Promise.resolve(null),
        );
      },
      () => this.authorPreview.scheduleHide(),
    );
    this.tools = new AcademicTreeTools(doc, {
      graph: () => this.graph,
      selected: () => this.selected,
      changed: () => {
        this.renderGraph();
        this.updateStatus(this.busy);
      },
      locate: (id) => {
        const node = this.graph?.nodes.find((node) => node.id === id);
        if (node) {
          this.select(node);
          this.canvas.center(id);
        }
      },
      fitPath: (ids) => this.canvas.fitPeople(ids),
      expandAncestors: () => {
        if (!this.graph || this.busy) return;
        const ancestors = academicReachable(
          this.tools.project(this.graph),
          this.graph.rootId,
          "up",
        );
        ancestors.delete(this.graph.rootId);
        const previous = this.tools.state.ancestorStudents;
        const tasks = [...ancestors]
          .filter((id) => !previous?.anchors.includes(id))
          .filter((id) =>
            this.graph!.nodes.some((node) => node.id === id && node.recid),
          )
          // Snapshot all currently shown ancestors; never recurse into new peers.
          .map((id) => ({ id, direction: "down" as const, remaining: 1 }));
        if (tasks.length) {
          this.tools.state.ancestorStudents = {
            open: true,
            anchors: [
              ...(previous?.anchors || []),
              ...tasks.map((task) => task.id),
            ],
            originalNodes:
              previous?.originalNodes ||
              this.graph.nodes.map((node) => node.id),
          };
          void this.load("down", this.graph.rootId, "normal", tasks);
        }
      },
      export: async (format, full) => {
        if (!this.graph) return;
        try {
          const saved = await exportAcademicTree(
            this.doc,
            full ? this.graph : this.tools.project(this.graph),
            this.canvas,
            this.tools.state,
            {
              up: Number(this.up.value),
              down: Number(this.down.value),
              degree: this.degree.value,
            },
            format,
            full,
          );
          if (saved && !this.disposed)
            this.status.textContent = getString("academic-tree-export-success");
        } catch {
          if (!this.disposed)
            this.status.textContent = getString("academic-tree-export-error");
        }
      },
    });
    toolbar.append(this.tools.element);
    const stage = doc.createElement("div");
    stage.style.cssText =
      "position:relative;display:flex;flex:1;min-height:200px;overflow:hidden";
    const navigation = this.row();
    navigation.style.cssText +=
      ";position:absolute;right:12px;bottom:10px;max-width:calc(100% - 24px);box-sizing:border-box;padding:4px;gap:4px;border:1px solid var(--fill-quinary,#e2e8f0);border-radius:6px;background:var(--material-background,#fff)";
    const zoomOut = this.button("academic-tree-zoom-out", () =>
      this.canvas.zoom(0.8),
    );
    const zoomIn = this.button("academic-tree-zoom-in", () =>
      this.canvas.zoom(1.25),
    );
    zoomOut.textContent = "−";
    zoomIn.textContent = "+";
    this.pageButton = this.button("academic-tree-fit-page", () => {
      this.tools.state.fitPage = !this.tools.state.fitPage;
      this.renderGraph();
    });
    this.pageButton.title = getString("academic-tree-fit-page-hint");
    this.updatePageButton();
    navigation.append(
      this.button("academic-tree-fit", () => this.canvas.fit()),
      this.pageButton,
      this.button("academic-tree-center", () => this.canvas.center()),
      zoomOut,
      zoomIn,
    );
    stage.append(this.canvas.element, navigation);
    this.details = doc.createElement("div");
    this.details.style.cssText =
      "padding:8px 12px;white-space:pre-line;border-top:1px solid var(--fill-quinary,#ddd);max-height:110px;overflow:auto;flex-shrink:0";
    this.details.textContent = getString("academic-tree-canvas-help");
    this.actions = this.row();
    const note = doc.createElement("div");
    note.textContent = getString("academic-tree-legend");
    note.title = getString("academic-tree-source-note");
    note.style.cssText =
      "padding:4px 12px 8px;color:var(--fill-secondary,#64748b);font-size:11px;flex-shrink:0";
    const footer = this.row();
    footer.style.borderTop = "1px solid var(--fill-quinary,#e2e8f0)";
    this.details.style.cssText =
      "white-space:pre-line;font-size:12px;flex:1;min-width:200px;max-height:64px;overflow:auto";
    this.actions.style.padding = "0";
    footer.append(this.details, this.actions);
    this.element.append(
      toolbar,
      controls,
      this.candidates,
      stage,
      footer,
      note,
    );
    const unload = () => this.dispose();
    doc.defaultView?.addEventListener("unload", unload);
    this.cleanup.push(() =>
      doc.defaultView?.removeEventListener("unload", unload),
    );
    void Promise.resolve().then(async () => {
      if (this.disposed) return;
      if (initialAuthor?.recid) await this.load();
      else if (initialAuthor?.bai)
        await this.search(
          `ids.value:"${initialAuthor.bai.replace(/["\\]/g, "")}"`,
        );
      else if (initialAuthor?.fullName) await this.search();
    });
  }
  private row() {
    const row = this.doc.createElement("div");
    row.style.cssText =
      "display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 12px;flex-shrink:0";
    return row;
  }
  private button(key: FluentMessageId, action: () => void) {
    return graphButton(this.doc, getString(key), action);
  }
  private styleSelect(select: HTMLSelectElement) {
    styleGraphSelect(select);
  }
  private depth(toolbar: HTMLElement, key: FluentMessageId, maximum: number) {
    const label = this.doc.createElement("label");
    label.textContent = `${getString(key)} `;
    label.style.cssText =
      "display:flex;align-items:center;gap:4px;font-size:12px;color:var(--fill-secondary,#64748b)";
    const select = this.doc.createElement("select");
    select.setAttribute("aria-label", getString(key));
    for (let depth = 0; depth <= maximum; depth++) {
      const option = this.doc.createElement("option");
      option.value = String(depth);
      option.textContent = String(depth);
      select.appendChild(option);
    }
    this.styleSelect(select);
    select.value = String(ACADEMIC_TREE_DEFAULT_DEPTH);
    select.addEventListener("change", () => {
      this.limit = ACADEMIC_TREE_INITIAL_LIMIT;
      void this.load();
    });
    label.appendChild(select);
    toolbar.appendChild(label);
    return select;
  }
  private async search(query = this.searchInput.value) {
    query = query.trim();
    if (!query || this.disposed) return;
    this.searchHistory.remember(query);
    this.searchAbort?.abort();
    const controller = createAbortController();
    if (!controller) {
      this.status.textContent = getString("academic-tree-load-error");
      return;
    }
    this.searchAbort = controller;
    const seq = ++this.searchSequence;
    this.status.textContent = getString("academic-tree-searching");
    this.candidates.replaceChildren();
    try {
      const authors = await searchAcademicAuthors(query, controller.signal);
      if (
        this.disposed ||
        seq !== this.searchSequence ||
        controller.signal.aborted
      )
        return;
      this.status.textContent = getString(
        authors.length ? "academic-tree-choose" : "academic-tree-no-authors",
      );
      const fragment = this.doc.createDocumentFragment();
      for (const author of authors) {
        const button = this.button(
          "academic-tree-select",
          () =>
            void this.followName({
              id: author.recid,
              recid: author.recid,
              name: author.name,
              level: 0,
            }),
        );
        button.textContent = `${author.name} — ${author.currentPosition?.institution || author.bai || author.recid}`;
        button.style.margin = "3px";
        fragment.appendChild(button);
      }
      this.candidates.appendChild(fragment);
    } catch {
      if (
        !controller.signal.aborted &&
        !this.disposed &&
        seq === this.searchSequence
      )
        this.status.textContent = getString("academic-tree-search-error");
    }
  }
  private async followName(node: AcademicTreeNode) {
    this.authorPreview.hide();
    // Both consumers resolve the same author ID; the floating tree stays open.
    await Promise.all([this.setRoot(node), this.viewPapers(node)]);
  }
  private snapshot(): AcademicTreeSnapshot | undefined {
    if (!this.initialAuthor?.recid) return;
    return {
      author: this.initialAuthor,
      root: this.root,
      graph: this.graph,
      selected: this.selected,
      up: this.up.value,
      down: this.down.value,
      degree: this.degree.value,
      limit: this.limit,
      expansion: this.lastExpansion,
      viewport: this.canvas.captureViewport(),
      status: this.busy
        ? getString("academic-tree-stopped")
        : this.status.textContent || "",
      moreHidden: this.more.hidden,
      pending: this.pending,
      recovery: this.busy ? "continue" : this.recovery,
      exploration: {
        ...this.tools.state,
        collapsed: [...this.tools.state.collapsed],
        path: [...this.tools.state.path],
      },
    };
  }
  private pushHistory(
    stack: AcademicTreeSnapshot[],
    entry: AcademicTreeSnapshot,
  ) {
    stack.push(entry);
    if (stack.length > NAVIGATION_STACK_LIMIT) stack.shift();
  }
  private updateNavigation() {
    this.back.disabled = this.backStack.length === 0;
    this.forward.disabled = this.forwardStack.length === 0;
  }
  private clearNavigationRequests() {
    this.cancel(false);
    this.actionAbort?.abort();
    this.searchAbort?.abort();
    ++this.searchSequence;
    this.candidates.replaceChildren();
  }
  private async navigate(direction: "back" | "forward") {
    const from = direction === "back" ? this.backStack : this.forwardStack;
    const to = direction === "back" ? this.forwardStack : this.backStack;
    const entry = from.pop();
    if (!entry || this.disposed) return;
    const current = this.snapshot();
    if (current) this.pushHistory(to, current);
    this.clearNavigationRequests();
    this.initialAuthor = entry.author;
    this.root = entry.root;
    this.graph = entry.graph;
    this.tools.restore(entry.exploration);
    this.selected = entry.selected;
    this.searchInput.value = entry.author.fullName;
    this.up.value = entry.up;
    this.down.value = entry.down;
    this.degree.value = entry.degree;
    this.limit = entry.limit;
    this.lastExpansion = entry.expansion;
    this.pending = entry.pending;
    this.recovery = entry.recovery;
    this.updateLoadControls();
    this.actions.replaceChildren();
    this.details.textContent = getString("academic-tree-canvas-help");
    this.canvas.clear();
    this.more.hidden = entry.moreHidden;
    this.updateNavigation();
    if (this.graph) {
      this.renderGraph();
      const selected = this.graph.nodes.find(
        (node) => node.id === this.selected,
      );
      if (selected) this.select(selected);
      this.canvas.restoreViewport(entry.viewport);
      this.status.textContent = entry.status;
    }
    // A visit interrupted before its first graph snapshot can be retried safely.
    await Promise.all([
      this.graph
        ? Promise.resolve()
        : this.load(undefined, undefined, "resume"),
      this.viewPapers({
        id: entry.author.recid!,
        recid: entry.author.recid,
        name: entry.author.fullName,
        level: 0,
      }),
    ]);
  }
  private async setRoot(node: AcademicTreeNode) {
    if (!node.recid) return;
    if (node.recid === this.initialAuthor?.recid) {
      this.searchAbort?.abort();
      ++this.searchSequence;
      this.candidates.replaceChildren();
      this.searchInput.value = this.root?.name || node.name;
      this.updateStatus(this.busy);
      return;
    }
    const current = this.snapshot();
    if (current) this.pushHistory(this.backStack, current);
    this.forwardStack = [];
    this.clearNavigationRequests();
    this.initialAuthor = { fullName: node.name, recid: node.recid };
    this.searchInput.value = node.name;
    this.root = undefined;
    this.graph = undefined;
    this.tools.restore();
    this.selected = undefined;
    this.limit = ACADEMIC_TREE_INITIAL_LIMIT;
    this.pending = undefined;
    this.recovery = undefined;
    this.candidates.replaceChildren();
    this.updateNavigation();
    await this.load();
  }
  private updateLoadControls() {
    this.tools?.sync(this.graph, this.busy);
    this.updatePageButton();
    this.refresh.disabled = this.busy || !this.initialAuthor?.recid;
    this.stop.hidden = !this.busy;
    this.stop.disabled = !this.busy;
    this.recover.hidden = this.busy || !this.recovery;
    const key =
      this.recovery === "continue"
        ? "academic-tree-continue"
        : "academic-tree-retry";
    this.recover.textContent = getString(key);
    this.recover.setAttribute("aria-label", getString(key));
    this.recover.title = getString(key);
  }
  private async load(
    expansion?: AcademicDirection,
    anchorId?: string,
    mode: "normal" | "refresh" | "resume" = "normal",
    batch?: AcademicTreeLoad["expansions"],
  ) {
    const anchor = expansion
      ? this.graph?.nodes.find(
          (node) => node.id === (anchorId || this.selected),
        )
      : undefined;
    const recid =
      anchor?.recid || this.root?.recid || this.initialAuthor?.recid;
    if (!recid) {
      this.status.textContent = getString("academic-tree-choose");
      return;
    }
    const priorExpansion = this.lastExpansion;
    const failedBranches =
      this.graph?.failures.map((task) => {
        const level =
          this.graph!.nodes.find((node) => node.id === task.id)?.level || 0;
        return {
          ...task,
          remaining: Math.max(
            1,
            task.direction === "up"
              ? Number(this.up.value) + level
              : Number(this.down.value) - level,
          ),
        };
      }) ?? [];
    // Explicit Retry may recover failures outside the last batch. Preserve each
    // batch task's original depth so retrying an ancestor never opens grandchildren.
    const retryOtherBranches =
      mode === "resume" && this.recovery === "retry" && this.pending?.batch
        ? failedBranches.filter(
            (task) =>
              !this.pending!.expansions?.some(
                (prior) =>
                  prior.id === task.id && prior.direction === task.direction,
              ),
          )
        : [];
    const operation: AcademicTreeLoad =
      mode === "resume" && this.pending
        ? retryOtherBranches.length
          ? {
              ...this.pending,
              expansions: [
                ...(this.pending.expansions || []),
                ...retryOtherBranches,
              ],
            }
          : this.pending
        : {
            source: createAcademicTreeSession(mode === "refresh"),
            recid,
            expansion,
            batch: !!batch,
            anchorId: anchor?.id,
            existing: expansion ? this.graph : undefined,
            refresh: mode === "refresh",
            expansions:
              mode === "refresh" && this.graph
                ? [
                    ...this.graph.expanded.up.map((id) => ({
                      id,
                      direction: "up" as const,
                    })),
                    ...this.graph.expanded.down.map((id) => ({
                      id,
                      direction: "down" as const,
                    })),
                    ...failedBranches,
                    ...(priorExpansion ? [priorExpansion] : []),
                  ]
                : expansion
                  ? (batch ?? failedBranches)
                  : undefined,
          };
    this.cancel(false);
    this.pending = operation;
    this.lastExpansion =
      !operation.batch && operation.expansion && operation.anchorId
        ? { id: operation.anchorId, direction: operation.expansion }
        : undefined;
    const controller = createAbortController();
    if (!controller) {
      this.recovery = "retry";
      this.updateLoadControls();
      this.status.textContent = getString("academic-tree-load-error");
      return;
    }
    const keepGraph = operation.refresh || mode === "resume";
    const viewport = this.graph ? this.canvas.captureViewport() : undefined;
    this.abort = controller;
    const seq = ++this.sequence;
    this.busy = true;
    this.recovery = undefined;
    this.updateLoadControls();
    this.more.hidden = true;
    if (!keepGraph) this.actions.replaceChildren();
    if (!operation.expansion && !keepGraph) {
      this.graph = undefined;
      this.selected = undefined;
      this.canvas.clear();
      this.details.textContent = getString("academic-tree-canvas-help");
    }
    this.status.textContent = getString(
      operation.refresh ? "academic-tree-refreshing" : "academic-tree-loading",
    );
    const current = () =>
      !this.disposed && !controller.signal.aborted && seq === this.sequence;
    try {
      const profile = await operation.source.profile(
        operation.recid,
        controller.signal,
      );
      if (!current()) return;
      const graph = await buildAcademicTree(profile, {
        upDepth: operation.batch
          ? 0
          : operation.expansion
            ? Number(operation.expansion === "up")
            : Number(this.up.value),
        downDepth: operation.batch
          ? 0
          : operation.expansion
            ? Number(operation.expansion === "down")
            : Number(this.down.value),
        maxNodes: this.limit,
        degreeFilter: this.degree.value as AcademicDegreeFilter,
        existing: operation.existing,
        expansions: operation.expansions,
        source: operation.source,
        hydrateProfiles: true,
        signal: controller.signal,
        onProgress: (graph) => {
          if (!current() || keepGraph) return;
          if (!operation.expansion) this.root = profile;
          this.selected ||= graph.rootId;
          this.graph = graph;
          this.renderGraph();
          this.updateStatus(true);
        },
      });
      if (!current()) return;
      const failures =
        graph.failures.length + (graph.profileFailures?.length || 0);
      if (failures) this.recovery = "retry";
      // A failed refresh must not replace the previously usable tree with an incomplete one.
      if (operation.refresh && failures && this.graph) {
        this.status.textContent = getString("academic-tree-refresh-error", {
          args: { count: failures },
        });
        return;
      }
      if (!operation.expansion) {
        this.root = profile;
        this.initialAuthor = {
          ...this.initialAuthor,
          recid: profile.recid,
          fullName: profile.name,
        };
        this.searchInput.value = profile.name;
      }
      this.graph = graph;
      if (!graph.nodes.some((node) => node.id === this.selected))
        this.selected = graph.rootId;
      this.renderGraph();
      if (keepGraph && viewport) this.canvas.restoreViewport(viewport);
      this.updateStatus(false);
    } catch {
      if (!current()) return;
      this.recovery = "retry";
      this.status.textContent = getString("academic-tree-load-error");
    } finally {
      if (current()) {
        this.busy = false;
        this.abort = undefined;
        this.updateLoadControls();
        const node = this.graph?.nodes.find(
          (node) => node.id === this.selected,
        );
        if (node) this.select(node);
      }
    }
  }
  private renderGraph() {
    this.updatePageButton();
    if (!this.graph) return;
    const visible = this.tools.project(this.graph);
    if (!visible.nodes.some((node) => node.id === this.selected)) {
      this.selected = visible.rootId;
      const node = visible.nodes.find((node) => node.id === this.selected);
      if (node) {
        this.select(node);
        return;
      }
    }
    this.tools.sync(this.graph, this.busy);
    this.canvas.render(
      visible,
      this.selected,
      academicPrimaryLineage(this.graph),
      this.tools.state.sort || "name",
      !!this.tools.state.fitPage,
    );
    this.canvas.highlightPath(this.tools.state.path);
  }
  private updatePageButton() {
    if (!this.pageButton) return;
    this.pageButton.setAttribute(
      "aria-pressed",
      String(!!this.tools.state.fitPage),
    );
    applyPillButtonColors(
      this.pageButton,
      !!this.tools.state.fitPage,
      isDarkMode(),
    );
  }
  private updateStatus(loading: boolean) {
    if (!this.graph) return;
    const parts = [
      getString("academic-tree-count", {
        args: {
          count: this.graph.nodes.length,
          links: this.graph.edges.length,
        },
      }),
    ];
    const visible = this.tools.project(this.graph);
    if (visible.nodes.length !== this.graph.nodes.length)
      parts.push(
        getString("academic-tree-visible-count", {
          args: { count: visible.nodes.length },
        }),
      );
    if (loading) parts.push(getString("academic-tree-loading"));
    if (this.graph.failures.length)
      parts.push(
        getString("academic-tree-partial-error", {
          args: { count: this.graph.failures.length },
        }),
      );
    if (this.graph.profileFailures?.length)
      parts.push(
        getString("academic-tree-profile-error", {
          args: { count: this.graph.profileFailures.length },
        }),
      );
    if (this.graph.limited)
      parts.push(
        getString("academic-tree-limit", { args: { count: this.limit } }),
      );
    this.status.textContent = parts.join(" · ");
    this.more.hidden =
      loading || !this.graph.limited || this.limit >= ACADEMIC_TREE_MAX_NODES;
  }
  private describe(node: AcademicTreeNode) {
    const lines = [node.name];
    if (node.institution) lines.push(node.institution);
    if (!node.recid) lines.push(getString("academic-tree-unlinked"));
    if (this.graph) {
      for (const edge of this.graph.edges.filter(
        (edge) => edge.target === node.id,
      )) {
        const mentor = this.graph.nodes.find(
          (person) => person.id === edge.source,
        );
        const degrees = edge.degreeTypes.map((degree) => {
          const label = academicDegreeLabel(degree, getString);
          const year = node.educationYears?.[degree];
          return year === undefined
            ? label
            : `${label} — ${getString("academic-tree-education-year", { args: { year } })}`;
        });
        lines.push(`${mentor?.name} → ${node.name}: ${degrees.join(" / ")}`);
      }
      if (this.graph.empty.up.includes(node.id))
        lines.push(getString("academic-tree-no-advisors"));
      if (this.graph.empty.down.includes(node.id))
        lines.push(getString("academic-tree-no-students"));
      if (this.graph.failures.some((f) => f.id === node.id))
        lines.push(getString("academic-tree-node-error"));
    }
    return lines.join("\n");
  }
  private select(node: AcademicTreeNode) {
    this.selected = node.id;
    this.details.textContent = this.describe(node);
    this.actions.replaceChildren();
    if (this.graph) this.renderGraph();
    if (!node.recid || this.busy) return;
    const expandUp = this.button(
      "academic-tree-expand-up",
      () => void this.load("up"),
    );
    const expandDown = this.button(
      "academic-tree-expand-down",
      () => void this.load("down"),
    );
    expandUp.disabled = node.level <= -ACADEMIC_TREE_MAX_ANCESTOR_DEPTH;
    expandDown.disabled = node.level >= ACADEMIC_TREE_MAX_DESCENDANT_DEPTH;
    for (const [button, maximum] of [
      [expandUp, ACADEMIC_TREE_MAX_ANCESTOR_DEPTH],
      [expandDown, ACADEMIC_TREE_MAX_DESCENDANT_DEPTH],
    ] as const) {
      if (button.disabled)
        button.title = getString("academic-tree-depth-limit", {
          args: { count: maximum },
        });
    }
    this.actions.append(
      expandUp,
      expandDown,
      this.button("academic-tree-reroot", () => {
        if (node.id === this.graph?.rootId) this.canvas.center(node.id);
        else void this.followName(node);
      }),
      this.button("academic-tree-inspire", () =>
        Zotero.launchURL(`https://inspirehep.net/authors/${node.recid}`),
      ),
      this.button("academic-tree-papers", () => void this.viewPapers(node)),
    );
  }
  private async viewPapers(node: AcademicTreeNode) {
    if (!node.recid) return;
    if (!this.onViewPapers) {
      Zotero.launchURL(`https://inspirehep.net/authors/${node.recid}`);
      return;
    }
    this.actionAbort?.abort();
    const controller = createAbortController();
    if (!controller) {
      this.status.textContent = getString("academic-tree-load-error");
      return;
    }
    this.actionAbort = controller;
    try {
      const profile =
        this.root?.recid === node.recid
          ? this.root
          : await academicTreeSource.profile(node.recid, controller.signal);
      if (!controller.signal.aborted && !this.disposed)
        this.onViewPapers({
          recid: profile.recid,
          bai: profile.bai,
          fullName: profile.name,
        });
    } catch {
      if (!controller.signal.aborted && !this.disposed)
        this.status.textContent = getString("academic-tree-load-error");
    }
  }
  closeMenus() {
    this.searchHistory.close();
    this.tools.closeMenus();
  }
  refreshAppearance() {
    this.tools.refreshAppearance();
    this.updatePageButton();
  }
  cancel(showStatus = true) {
    this.authorPreview?.hide();
    const wasBusy = this.busy;
    this.abort?.abort();
    this.abort = undefined;
    ++this.sequence;
    this.busy = false;
    if (showStatus && wasBusy) this.recovery = "continue";
    this.updateLoadControls();
    if (showStatus && wasBusy && !this.disposed) {
      this.status.textContent = getString("academic-tree-stopped");
      const node = this.graph?.nodes.find((node) => node.id === this.selected);
      if (node) this.select(node);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel(false);
    this.actionAbort?.abort();
    this.searchAbort?.abort();
    ++this.searchSequence;
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.backStack = [];
    this.forwardStack = [];
    this.tools.dispose();
    this.searchHistory.dispose();
    this.authorPreview.dispose();
    this.canvas.dispose();
    this.element.remove();
  }
}
