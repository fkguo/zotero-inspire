import { createAbortController } from "../utils";
import {
  AuthorPreviewController,
  type AuthorPreviewCallbacks,
} from "./AuthorPreviewController";
import { getString } from "../../../utils/locale";
import type { FluentMessageId } from "../../../../typings/i10n";
import type { AuthorSearchInfo, InspireAuthorProfile } from "../types";
import type {
  AcademicTreeGraph,
  AcademicTreeNode,
  AcademicDegreeFilter,
  AcademicDirection,
} from "../academicTreeTypes";
import {
  ACADEMIC_TREE_DEFAULT_DEPTH,
  ACADEMIC_TREE_MAX_DEPTH,
  ACADEMIC_TREE_INITIAL_LIMIT,
  ACADEMIC_TREE_MAX_NODES,
} from "../academicTreeTypes";
import {
  academicTreeSource,
  searchAcademicAuthors,
} from "../academicTreeDataService";
import { buildAcademicTree } from "../academicTreeService";
import { AcademicTreeCanvas } from "./AcademicTreeCanvas";
import { NAVIGATION_STACK_LIMIT } from "../constants";

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
}

/** Author genealogy content hosted in the citation graph's resizable window. */
export class AcademicTreeView {
  readonly element: HTMLDivElement;
  private canvas: AcademicTreeCanvas;
  private authorPreview: AuthorPreviewController;
  private status: HTMLDivElement;
  private details: HTMLDivElement;
  private actions: HTMLDivElement;
  private candidates: HTMLDivElement;
  private searchInput: HTMLInputElement;
  private up: HTMLSelectElement;
  private down: HTMLSelectElement;
  private degree: HTMLSelectElement;
  private stop: HTMLButtonElement;
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
      "flex:1;min-width:140px;max-width:280px;background:var(--material-background,#fff);color:inherit;border:1px solid var(--fill-quinary,#ccc);padding:5px;border-radius:4px";
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
    toolbar.append(this.searchInput, search);
    this.up = this.depth(toolbar, "academic-tree-up");
    this.down = this.depth(toolbar, "academic-tree-down");
    this.degree = doc.createElement("select");
    this.degree.setAttribute("aria-label", getString("academic-tree-degree"));
    for (const [value, key] of Object.entries({
      all: "academic-tree-all",
      phd: "academic-tree-phd",
      master: "academic-tree-master",
      bachelor: "academic-tree-bachelor",
      other: "academic-tree-other",
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
      void this.load(this.lastExpansion?.direction, this.lastExpansion?.id);
    });
    this.more.hidden = true;
    controls.append(
      this.button("academic-tree-reload", () => void this.load()),
      this.stop,
      this.more,
    );
    this.status = doc.createElement("div");
    this.status.setAttribute("role", "status");
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
    navigation.append(
      this.button("academic-tree-fit", () => this.canvas.fit()),
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
    note.textContent = getString("academic-tree-source-note");
    note.style.cssText =
      "padding:4px 12px 8px;color:var(--fill-secondary,#64748b);font-size:11px;flex-shrink:0";
    this.element.append(
      toolbar,
      controls,
      this.candidates,
      stage,
      this.details,
      this.actions,
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
    const button = this.doc.createElement("button");
    button.type = "button";
    button.textContent = getString(key);
    button.title = button.textContent;
    button.setAttribute("aria-label", button.textContent);
    button.style.cssText =
      "border:1px solid var(--fill-quinary,#cbd5e1);border-radius:5px;padding:4px 9px;background:var(--material-background,#fff);color:inherit;cursor:pointer";
    button.addEventListener("click", action);
    return button;
  }
  private styleSelect(select: HTMLSelectElement) {
    select.style.cssText =
      "font:inherit;color:inherit;background:var(--material-background,#fff);border:1px solid var(--fill-quinary,#cbd5e1);border-radius:5px;padding:4px 6px;max-width:100%";
  }
  private depth(toolbar: HTMLElement, key: FluentMessageId) {
    const label = this.doc.createElement("label");
    label.textContent = `${getString(key)} `;
    label.style.cssText = "display:flex;align-items:center;gap:5px";
    const select = this.doc.createElement("select");
    select.setAttribute("aria-label", getString(key));
    for (let depth = 0; depth <= ACADEMIC_TREE_MAX_DEPTH; depth++) {
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
    this.selected = entry.selected;
    this.searchInput.value = entry.author.fullName;
    this.up.value = entry.up;
    this.down.value = entry.down;
    this.degree.value = entry.degree;
    this.limit = entry.limit;
    this.lastExpansion = entry.expansion;
    this.actions.replaceChildren();
    this.details.textContent = getString("academic-tree-canvas-help");
    this.canvas.clear();
    this.more.hidden = entry.moreHidden;
    this.updateNavigation();
    if (this.graph) {
      this.canvas.render(this.graph, this.selected);
      const selected = this.graph.nodes.find(
        (node) => node.id === this.selected,
      );
      if (selected) this.select(selected);
      this.canvas.restoreViewport(entry.viewport);
      this.status.textContent = entry.status;
    }
    // A visit interrupted before its first graph snapshot can be retried safely.
    await Promise.all([
      this.graph ? Promise.resolve() : this.load(),
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
    this.selected = undefined;
    this.limit = ACADEMIC_TREE_INITIAL_LIMIT;
    this.candidates.replaceChildren();
    this.updateNavigation();
    await this.load();
  }
  private async load(expansion?: AcademicDirection, anchorId?: string) {
    const anchor = expansion
      ? this.graph?.nodes.find(
          (node) => node.id === (anchorId || this.selected),
        )
      : undefined;
    const recid =
      anchor?.recid || this.root?.recid || this.initialAuthor?.recid;
    this.lastExpansion =
      expansion && anchor ? { id: anchor.id, direction: expansion } : undefined;
    if (!recid) {
      this.status.textContent = getString("academic-tree-choose");
      return;
    }
    this.cancel(false);
    const controller = createAbortController();
    if (!controller) {
      this.status.textContent = getString("academic-tree-load-error");
      return;
    }
    this.abort = controller;
    const seq = ++this.sequence;
    this.busy = true;
    this.stop.disabled = false;
    this.more.hidden = true;
    this.actions.replaceChildren();
    if (!expansion) {
      this.graph = undefined;
      this.selected = undefined;
      this.canvas.clear();
      this.details.textContent = getString("academic-tree-canvas-help");
    }
    this.status.textContent = getString("academic-tree-loading");
    try {
      const profile = await academicTreeSource.profile(
        recid,
        controller.signal,
      );
      if (this.disposed || controller.signal.aborted || seq !== this.sequence)
        return;
      if (!expansion) {
        this.root = profile;
        this.selected = profile.recid;
      }
      await buildAcademicTree(profile, {
        upDepth: expansion ? Number(expansion === "up") : Number(this.up.value),
        downDepth: expansion
          ? Number(expansion === "down")
          : Number(this.down.value),
        maxNodes: this.limit,
        degreeFilter: this.degree.value as AcademicDegreeFilter,
        existing: expansion ? this.graph : undefined,
        signal: controller.signal,
        onProgress: (graph) => {
          if (
            this.disposed ||
            controller.signal.aborted ||
            seq !== this.sequence
          )
            return;
          this.graph = graph;
          this.canvas.render(graph, this.selected);
          this.updateStatus(true);
        },
      });
    } catch {
      if (this.disposed || controller.signal.aborted || seq !== this.sequence)
        return;
      this.status.textContent = getString("academic-tree-load-error");
      return;
    } finally {
      if (!this.disposed && seq === this.sequence) {
        this.busy = false;
        this.stop.disabled = true;
        const node = this.graph?.nodes.find(
          (node) => node.id === this.selected,
        );
        if (node) this.select(node);
      }
    }
    if (!this.disposed && !controller.signal.aborted && seq === this.sequence)
      this.updateStatus(false);
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
    if (loading) parts.push(getString("academic-tree-loading"));
    if (this.graph.failures.length)
      parts.push(
        getString("academic-tree-partial-error", {
          args: { count: this.graph.failures.length },
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
          const key = {
            phd: "academic-tree-phd",
            master: "academic-tree-master",
            bachelor: "academic-tree-bachelor",
            other: "academic-tree-other",
            unknown: "academic-tree-unknown",
          }[degree];
          return key ? getString(key as FluentMessageId) : degree;
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
    if (this.graph) this.canvas.render(this.graph, this.selected);
    if (!node.recid || this.busy) return;
    const expandUp = this.button(
      "academic-tree-expand-up",
      () => void this.load("up"),
    );
    const expandDown = this.button(
      "academic-tree-expand-down",
      () => void this.load("down"),
    );
    expandUp.disabled = node.level <= -ACADEMIC_TREE_MAX_DEPTH;
    expandDown.disabled = node.level >= ACADEMIC_TREE_MAX_DEPTH;
    for (const button of [expandUp, expandDown]) {
      if (button.disabled)
        button.title = getString("academic-tree-depth-limit", {
          args: { count: ACADEMIC_TREE_MAX_DEPTH },
        });
    }
    this.actions.append(
      expandUp,
      expandDown,
      this.button("academic-tree-reroot", () => void this.followName(node)),
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
  cancel(showStatus = true) {
    this.authorPreview?.hide();
    const wasBusy = this.busy;
    this.abort?.abort();
    this.abort = undefined;
    ++this.sequence;
    this.busy = false;
    if (this.stop) this.stop.disabled = true;
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
    this.authorPreview.dispose();
    this.canvas.dispose();
    this.element.remove();
  }
}
