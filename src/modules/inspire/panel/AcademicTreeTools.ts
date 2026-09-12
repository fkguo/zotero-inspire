import { GraphMenu, graphButton, styleGraphSelect } from "./graphControls";
import { applyPillButtonStyle, applyPillButtonColors } from "../../pickerUI";
import { isDarkMode } from "../styles";
import { getString } from "../../../utils/locale";
import type { FluentMessageId } from "../../../../typings/i10n";
import type { AcademicTreeGraph } from "../academicTreeTypes";
import {
  academicReachable,
  academicRelationshipPath,
  projectAcademicTree,
  type AcademicTreeViewState,
} from "../academicTreeExploration";

interface Callbacks {
  graph(): AcademicTreeGraph | undefined;
  selected(): string | undefined;
  changed(): void;
  locate(id: string): void;
  fitPath(ids: string[]): void;
  expandAncestors(): void;
  export(format: "svg" | "png" | "json" | "csv", full: boolean): Promise<void>;
}

/** Local exploration controls. State is copied into the view's navigation snapshots. */
export class AcademicTreeTools {
  readonly element: HTMLDivElement;
  state: AcademicTreeViewState = {
    showCoAdvisors: true,
    collapsed: [],
    path: [],
  };
  private menu: GraphMenu;
  private sortSelect: HTMLSelectElement;
  private coButton: HTMLButtonElement;
  private collapse: HTMLButtonElement;
  private expand: HTMLButtonElement;
  private results: HTMLDivElement;
  private pathResult: HTMLDivElement;
  private visibilityNotice: HTMLSpanElement;
  private selectionLabel: HTMLSpanElement;
  private from: HTMLSelectElement;
  private to: HTMLSelectElement;
  private query: HTMLInputElement;
  private graph?: AcademicTreeGraph;
  private projected?: AcademicTreeGraph;
  private projectedSource?: AcademicTreeGraph;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private exportPending = false;
  constructor(
    private doc: Document,
    private callbacks: Callbacks,
  ) {
    this.menu = new GraphMenu(doc);
    this.element = doc.createElement("div");
    this.element.style.cssText =
      "display:flex;align-items:center;gap:6px;flex-wrap:wrap";
    const bar = this.element;
    const menu = (key: FluentMessageId) => {
      const panel = doc.createElement("div");
      panel.hidden = true;
      panel.style.cssText =
        "display:none;align-items:center;gap:8px;flex-wrap:wrap;width:480px";
      const toggle = this.button(key, () => this.menu.toggle(toggle, panel));
      toggle.textContent += " ▾";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-haspopup", "dialog");
      bar.append(toggle, panel);
      return panel;
    };
    this.sortSelect = this.personSelect("academic-tree-sort");
    for (const mode of ["name", "year"] as const) {
      const option = doc.createElement("option");
      option.value = mode;
      option.textContent = getString(
        mode === "name" ? "academic-tree-sort-name" : "academic-tree-sort-year",
      );
      this.sortSelect.append(option);
    }
    this.sortSelect.title = getString("academic-tree-sort-hint");
    this.sortSelect.addEventListener("change", () => {
      this.state.sort = this.sortSelect.value === "year" ? "year" : "name";
      this.change();
    });
    bar.append(this.sortSelect);
    const view = menu("academic-tree-view-menu");
    this.coButton = this.button("academic-tree-co-advisors", () => {
      this.state.showCoAdvisors = !this.state.showCoAdvisors;
      this.state.path = [];
      this.pathResult.textContent = "";
      this.change();
    });
    this.coButton.title = getString("academic-tree-co-advisors-hint");
    bar.prepend(this.coButton);
    this.updateCoButton();
    this.query = doc.createElement("input");
    this.query.type = "search";
    this.query.size = 38;
    this.query.placeholder = getString("academic-tree-find-placeholder");
    this.query.setAttribute("aria-label", this.query.placeholder);
    this.query.style.cssText =
      "font:inherit;color:inherit;background:var(--material-background,#fff);border:1px solid var(--fill-quinary,#cbd5e1);border-radius:4px;padding:4px";
    this.query.addEventListener("input", () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.find(), 180);
    });
    this.query.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        clearTimeout(this.timer);
        this.find();
      }
    });
    this.query.style.maxWidth = "100%";
    this.query.style.boxSizing = "border-box";
    this.visibilityNotice = doc.createElement("span");
    this.visibilityNotice.setAttribute("role", "status");
    this.visibilityNotice.style.cssText =
      "font-size:12px;color:var(--fill-secondary,#64748b)";
    this.results = doc.createElement("div");
    this.results.style.cssText =
      "flex-basis:100%;max-height:130px;overflow:auto";
    view.append(this.query, this.visibilityNotice, this.results);
    this.from = this.personSelect("academic-tree-path-from");
    this.to = this.personSelect("academic-tree-path-to");
    this.pathResult = doc.createElement("div");
    this.pathResult.setAttribute("role", "status");
    this.pathResult.style.cssText =
      "flex-basis:100%;max-height:80px;overflow:auto;color:var(--fill-secondary,#64748b)";
    view.append(
      this.from,
      this.to,
      this.button("academic-tree-show-path", () => this.showPath()),
      this.button("academic-tree-clear-path", () => {
        this.state.path = [];
        this.pathResult.textContent = "";
        this.change();
      }),
      this.pathResult,
    );
    const expansion = menu("academic-tree-expand-menu");
    this.selectionLabel = doc.createElement("span");
    this.selectionLabel.style.color = "var(--fill-secondary,#64748b)";
    expansion.append(this.selectionLabel);
    this.expand = this.button("academic-tree-expand-ancestors", () => {
      this.menu.close();
      callbacks.expandAncestors();
    });
    this.collapse = this.button("academic-tree-collapse", () => {
      const id = callbacks.selected();
      if (!id) return;
      this.state.collapsed = this.state.collapsed.includes(id)
        ? this.state.collapsed.filter((value) => value !== id)
        : [...this.state.collapsed, id];
      this.state.path = [];
      this.pathResult.textContent = "";
      this.change();
    });
    expansion.append(
      this.expand,
      this.collapse,
      this.button("academic-tree-restore-branches", () => {
        this.state.collapsed = [];
        this.change();
      }),
    );
    const exporting = this.button("academic-tree-export", () => {
      this.menu.show(
        exporting,
        ([false, true] as const).flatMap((full) =>
          (["svg", "png", "json", "csv"] as const).map((format) => ({
            label: `${format.toUpperCase()} — ${getString(full ? "academic-tree-export-full" : "academic-tree-export-view")}…`,
            disabled: !callbacks.graph() || this.exportPending,
            onClick: async () => {
              if (this.exportPending || this.disposed) return;
              this.exportPending = true;
              exporting.disabled = true;
              try {
                await callbacks.export(format, full);
              } finally {
                this.exportPending = false;
                if (!this.disposed) exporting.disabled = false;
              }
            },
          })),
        ),
      );
    });
    exporting.textContent = getString("references-panel-citation-graph-export");
    exporting.title = getString("academic-tree-export-hint");
    exporting.setAttribute("aria-haspopup", "menu");
    bar.append(exporting);
  }
  private updateCoButton() {
    applyPillButtonStyle(
      this.coButton,
      this.state.showCoAdvisors,
      isDarkMode(),
    );
    this.coButton.setAttribute(
      "aria-pressed",
      String(this.state.showCoAdvisors),
    );
  }
  private button(key: FluentMessageId, fn: () => void) {
    return graphButton(this.doc, getString(key), fn);
  }
  private styleSelect(select: HTMLSelectElement) {
    styleGraphSelect(select);
  }
  private personSelect(key: FluentMessageId) {
    const select = this.doc.createElement("select");
    select.setAttribute("aria-label", getString(key));
    select.title = getString(key);
    this.styleSelect(select);
    return select;
  }
  private change() {
    this.projected = undefined;
    this.projectedSource = undefined;
    this.updateCoButton();
    this.callbacks.changed();
  }
  project(graph: AcademicTreeGraph) {
    if (this.projectedSource !== graph || !this.projected) {
      this.projectedSource = graph;
      this.projected = projectAcademicTree(graph, this.state);
    }
    return this.projected;
  }
  restore(state?: AcademicTreeViewState) {
    clearTimeout(this.timer);
    this.state = state
      ? { ...state, collapsed: [...state.collapsed], path: [...state.path] }
      : { showCoAdvisors: true, collapsed: [], path: [] };
    this.sortSelect.value = this.state.sort || "name";
    this.query.value = "";
    this.results.replaceChildren();
    this.pathResult.textContent = "";
    this.visibilityNotice.textContent = "";
    this.updateCoButton();
    this.projected = undefined;
    this.projectedSource = undefined;
    this.graph = undefined;
  }
  sync(graph: AcademicTreeGraph | undefined, busy: boolean) {
    this.expand.disabled =
      busy || !graph || academicReachable(graph, graph.rootId, "up").size < 2;
    const id = this.callbacks.selected();
    this.selectionLabel.textContent = getString("academic-tree-selection", {
      args: { name: graph?.nodes.find((node) => node.id === id)?.name || "—" },
    });
    this.collapse.disabled =
      !graph ||
      !id ||
      (id !== graph.rootId &&
        academicReachable(graph, graph.rootId, "up").has(id)) ||
      !graph.edges.some((edge) => edge.source === id);
    const key =
      id && this.state.collapsed.includes(id)
        ? "academic-tree-restore-branch"
        : "academic-tree-collapse";
    this.collapse.textContent = getString(key);
    this.collapse.setAttribute("aria-label", getString(key));
    if (graph === this.graph) return;
    this.graph = graph;
    if (
      graph &&
      this.state.path.some(
        (id, i, ids) =>
          !graph.nodes.some((node) => node.id === id) ||
          (i > 0 &&
            !graph.edges.some(
              (edge) =>
                (edge.source === ids[i - 1] && edge.target === id) ||
                (edge.target === ids[i - 1] && edge.source === id),
            )),
      )
    )
      this.state.path = [];
    this.pathResult.textContent =
      graph && this.state.path.length
        ? this.describePath(graph, this.state.path)
        : "";
    if (this.query.value.trim()) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.find(), 180);
    }
    for (const select of [this.from, this.to]) {
      const value = select.value;
      const fragment = this.doc.createDocumentFragment();
      const placeholder = this.doc.createElement("option");
      placeholder.value = "";
      placeholder.textContent = select.getAttribute("aria-label") || "";
      fragment.append(placeholder);
      for (const node of [...(graph?.nodes || [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const option = this.doc.createElement("option");
        option.value = node.id;
        option.textContent = `${node.name} (${node.recid || "—"})`;
        fragment.append(option);
      }
      select.replaceChildren(fragment);
      select.value = graph?.nodes.some((node) => node.id === value)
        ? value
        : "";
    }
  }
  private reveal(ids: string[]) {
    const graph = this.callbacks.graph();
    this.visibilityNotice.textContent = "";
    if (!graph || !ids.length) return false;
    const missing = (visible: AcademicTreeGraph) =>
      ids.some(
        (id, i) =>
          !visible.nodes.some((node) => node.id === id) ||
          (i > 0 &&
            !visible.edges.some(
              (edge) =>
                (edge.source === ids[i - 1] && edge.target === id) ||
                (edge.target === ids[i - 1] && edge.source === id),
            )),
      );
    if (!missing(this.project(graph))) return true;
    const ancestors = new Set(
      ids.flatMap((id) => [...academicReachable(graph, id, "up")]),
    );
    // A co-advisor can be connected through a shared student, not an up-ancestor.
    // Also restore collapses along a root-to-target relationship route.
    const route = [
      ...academicRelationshipPath(graph, graph.rootId, ids[0]),
      ...ids.slice(1),
    ];
    for (let i = 1; i < route.length; i++) {
      for (const edge of graph.edges)
        if (
          (edge.source === route[i - 1] && edge.target === route[i]) ||
          (edge.target === route[i - 1] && edge.source === route[i])
        )
          ancestors.add(edge.source);
    }
    this.state.collapsed = this.state.collapsed.filter(
      (id) => !ancestors.has(id),
    );
    if (missing(projectAcademicTree(graph, this.state)))
      this.state.showCoAdvisors = true;
    const visible = !missing(projectAcademicTree(graph, this.state));
    this.visibilityNotice.textContent = getString(
      visible ? "academic-tree-revealed" : "academic-tree-path-empty",
    );
    return visible;
  }
  private find() {
    if (this.disposed) return;
    this.results.replaceChildren();
    const query = this.query.value
      .trim()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase();
    if (!query) return;
    const matches =
      this.callbacks
        .graph()
        ?.nodes.filter((node) =>
          `${node.name} ${node.recid || ""} ${node.institution || ""}`
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")
            .toLocaleLowerCase()
            .includes(query),
        ) || [];
    const fragment = this.doc.createDocumentFragment();
    for (const node of matches.slice(0, 50)) {
      const button = this.button("academic-tree-locate", () => {
        if (!this.reveal([node.id])) return;
        this.change();
        this.callbacks.locate(node.id);
      });
      button.textContent = `${node.name}${node.institution ? ` — ${node.institution}` : ""}`;
      button.setAttribute("data-academic-locate", node.id);
      button.setAttribute(
        "aria-label",
        `${getString("academic-tree-locate")}: ${button.textContent}`,
      );
      fragment.append(button);
    }
    this.results.append(fragment);
    if (matches.length > 50) {
      const hint = this.doc.createElement("span");
      hint.textContent = getString("academic-tree-find-more", {
        args: { count: matches.length - 50 },
      });
      this.results.append(hint);
    }
    if (!matches.length)
      this.results.textContent = getString("academic-tree-find-empty");
  }
  private describePath(graph: AcademicTreeGraph, path: string[]) {
    return path
      .map((id, index) => {
        const name = graph.nodes.find((node) => node.id === id)?.name || id;
        if (!index) return name;
        const forward = graph.edges.some(
          (edge) => edge.source === path[index - 1] && edge.target === id,
        );
        return `${forward ? "→" : "←"} ${name}`;
      })
      .join(" ");
  }
  private showPath() {
    const graph = this.callbacks.graph();
    if (!graph) return;
    const path = academicRelationshipPath(
      graph,
      this.from.value,
      this.to.value,
    );
    this.state.path = path;
    this.pathResult.textContent = path.length
      ? this.describePath(graph, path)
      : getString("academic-tree-path-empty");
    const visible = this.reveal(path);
    this.change();
    if (visible && path.length) this.callbacks.fitPath(path);
  }
  closeMenus() {
    this.menu.close();
  }
  refreshAppearance() {
    const root = this.element.closest(".zinspire-academic-tree");
    const buttons = Array.from(
      (root || this.element).querySelectorAll("button"),
    ) as HTMLButtonElement[];
    for (const button of buttons)
      applyPillButtonColors(
        button,
        button.getAttribute("aria-pressed") === "true",
        isDarkMode(),
      );
  }
  dispose() {
    this.disposed = true;
    this.menu.close();
    clearTimeout(this.timer);
    this.element.remove();
  }
}
