import { serializeAcademicSVG } from "../academicTreeSVG";
import type { AcademicTreeGraph, AcademicTreeNode } from "../academicTreeTypes";
import {
  layoutAcademicTree,
  wrapAcademicName,
  ACADEMIC_NODE_WIDTH as W,
  ACADEMIC_NODE_HEIGHT as H,
} from "../academicTreeLayout";

const NS = "http://www.w3.org/2000/svg";
/** SVG canvas with mouse/keyboard pan and zoom. All labels are plain text. */
export class AcademicTreeCanvas {
  readonly element: SVGSVGElement;
  private group: SVGGElement;
  private x = 0;
  private y = 0;
  private scale = 1;
  private origin?: { x: number; y: number; panX: number; panY: number };
  private moved = false;
  private layout?: ReturnType<typeof layoutAcademicTree>;
  private rootId = "";
  private renderedGraph?: AcademicTreeGraph;
  private selected?: string;
  private relationshipPath: string[] = [];
  private hovered?: string;
  private focused?: string;
  private cards = new Map<string, SVGRectElement>();
  private links: Array<{
    source: string;
    target: string;
    path: SVGPathElement;
  }> = [];
  private measureName: (text: string) => number;
  private cleanup: Array<() => void> = [];
  private readonly markerId = `academic-arrow-${Math.random().toString(36).slice(2)}`;
  constructor(
    private doc: Document,
    label: string,
    private select: (node: AcademicTreeNode) => void,
    private reRoot: (node: AcademicTreeNode) => void,
    private describe: (node: AcademicTreeNode) => string,
    private hover: (node: AcademicTreeNode, anchor: Element) => void,
    private leave: () => void,
  ) {
    let context: CanvasRenderingContext2D | null = null;
    try {
      const canvas = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "canvas",
      ) as HTMLCanvasElement;
      context = canvas.getContext("2d");
      if (context) context.font = "13px system-ui,sans-serif";
    } catch {
      // Conservative full-width fallback for documents without a canvas context.
    }
    this.measureName = (text) =>
      context?.measureText(text).width || Array.from(text).length * 13;
    this.element = doc.createElementNS(NS, "svg");
    this.element.setAttribute("width", "100%");
    this.element.setAttribute("height", "100%");
    this.element.setAttribute("tabindex", "0");
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", label);
    this.element.style.cssText =
      "display:block;flex:1;min-height:160px;width:100%;cursor:grab;touch-action:none";
    this.group = doc.createElementNS(NS, "g");
    this.element.appendChild(this.group);
    const start = (e: MouseEvent) => {
      this.leave();
      if (e.button !== 0) return;
      this.moved = false;
      this.origin = { x: e.clientX, y: e.clientY, panX: this.x, panY: this.y };
    };
    const move = (e: MouseEvent) => {
      if (!this.origin) return;
      const dx = e.clientX - this.origin.x,
        dy = e.clientY - this.origin.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.moved = true;
      if (!this.moved) return;
      this.x = this.origin.panX + dx;
      this.y = this.origin.panY + dy;
      this.transform();
    };
    const end = () => {
      this.origin = undefined;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.element.getBoundingClientRect();
      this.zoom(
        Math.exp(-e.deltaY * 0.002),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    const key = (e: KeyboardEvent) => {
      if (e.target !== this.element) return;
      if (e.key === "+" || e.key === "=") this.zoom(1.2);
      else if (e.key === "-") this.zoom(1 / 1.2);
      else if (e.key === "0") this.fit();
      else if (e.key.startsWith("Arrow")) {
        this.x += e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0;
        this.y += e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0;
        this.transform();
      } else return;
      e.preventDefault();
    };
    this.element.addEventListener("mousedown", start);
    doc.defaultView?.addEventListener("mousemove", move);
    doc.defaultView?.addEventListener("mouseup", end);
    this.element.addEventListener("wheel", wheel, { passive: false });
    this.element.addEventListener("keydown", key);
    this.cleanup.push(() => {
      this.element.removeEventListener("mousedown", start);
      doc.defaultView?.removeEventListener("mousemove", move);
      doc.defaultView?.removeEventListener("mouseup", end);
      this.element.removeEventListener("wheel", wheel);
      this.element.removeEventListener("keydown", key);
    });
  }
  private transform() {
    this.group.setAttribute(
      "transform",
      `translate(${this.x},${this.y}) scale(${this.scale})`,
    );
  }
  captureViewport() {
    return { x: this.x, y: this.y, scale: this.scale };
  }
  restoreViewport(viewport: ReturnType<AcademicTreeCanvas["captureViewport"]>) {
    this.origin = undefined;
    this.x = viewport.x;
    this.y = viewport.y;
    this.scale = viewport.scale;
    this.transform();
  }
  clear() {
    this.origin = undefined;
    this.layout = undefined;
    this.rootId = "";
    this.renderedGraph = undefined;
    this.cards.clear();
    this.links = [];
    this.hovered = this.focused = undefined;
    this.group.replaceChildren();
    this.element.removeAttribute("data-root-author-id");
  }
  zoom(factor: number, x?: number, y?: number) {
    const rect = this.element.getBoundingClientRect();
    const cx = x ?? rect.width / 2,
      cy = y ?? rect.height / 2;
    const next = Math.max(0.04, Math.min(3, this.scale * factor));
    this.x = cx - ((cx - this.x) * next) / this.scale;
    this.y = cy - ((cy - this.y) * next) / this.scale;
    this.scale = next;
    this.transform();
  }
  fit() {
    if (!this.layout) return;
    const rect = this.element.getBoundingClientRect();
    this.scale = Math.min(
      1,
      (rect.width - 24) / this.layout.width,
      (rect.height - 24) / this.layout.height,
    );
    this.scale = Math.max(0.04, this.scale);
    this.x = (rect.width - this.layout.width * this.scale) / 2;
    this.y = (rect.height - this.layout.height * this.scale) / 2;
    this.transform();
  }
  center(id = this.rootId) {
    const node = this.layout?.nodes.find((node) => node.id === id);
    if (!node) return;
    const rect = this.element.getBoundingClientRect();
    this.x = rect.width / 2 - (node.x + W / 2) * this.scale;
    this.y = rect.height / 2 - (node.y + H / 2) * this.scale;
    this.transform();
  }
  fitPeople(ids: string[]) {
    const nodes = this.layout?.nodes.filter((node) => ids.includes(node.id));
    if (!nodes?.length) return;
    const left = Math.min(...nodes.map((node) => node.x));
    const top = Math.min(...nodes.map((node) => node.y));
    const width = Math.max(...nodes.map((node) => node.x + W)) - left;
    const height = Math.max(...nodes.map((node) => node.y + H)) - top;
    const rect = this.element.getBoundingClientRect();
    this.scale = Math.max(
      0.04,
      Math.min(1.5, (rect.width - 40) / width, (rect.height - 40) / height),
    );
    this.x = (rect.width - width * this.scale) / 2 - left * this.scale;
    this.y = (rect.height - height * this.scale) / 2 - top * this.scale;
    this.transform();
  }
  private emphasize() {
    const active = this.hovered || this.focused || this.selected;
    for (const { source, target, path } of this.links) {
      const highlighted = this.relationshipPath.length
        ? this.relationshipPath.some(
            (id, i, ids) =>
              (id === source && ids[i + 1] === target) ||
              (id === target && ids[i + 1] === source),
          )
        : source === active || target === active;
      path.setAttribute(
        "stroke",
        highlighted
          ? "var(--color-accent,#0060df)"
          : "var(--fill-secondary,#64748b)",
      );
      path.setAttribute(
        "stroke-opacity",
        highlighted ? "0.85" : active ? "0.28" : "0.48",
      );
      path.setAttribute("stroke-width", highlighted ? "1.6" : "1.1");
      path.setAttribute(
        "marker-end",
        `url(#${this.markerId}${highlighted ? "-active" : ""})`,
      );
    }
    for (const [id, rect] of this.cards) {
      const selected = id === this.selected,
        root = id === this.rootId;
      rect.setAttribute(
        "stroke",
        selected || root || id === active || this.relationshipPath.includes(id)
          ? "var(--color-accent,#0060df)"
          : "var(--fill-quaternary,#cbd5e1)",
      );
      rect.parentElement?.setAttribute("aria-pressed", String(selected));
      rect.setAttribute("stroke-width", selected ? "2" : "1");
      rect.setAttribute(
        "fill",
        selected || root
          ? "color-mix(in srgb,var(--color-accent,#0060df) 8%,var(--material-background,#fff))"
          : "var(--material-background,#fff)",
      );
    }
  }
  highlightPath(ids: string[]) {
    this.relationshipPath = [...ids];
    this.emphasize();
  }
  /** Portable light-theme SVG; no Zotero CSS variables or external resources. */
  exportSVG(full: boolean): { svg: string; width: number; height: number } {
    if (!this.layout) throw new Error("No graph");
    const rect = this.element.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.ceil(full ? this.layout.width : rect.width || 800),
    );
    const height = Math.max(
      1,
      Math.ceil(full ? this.layout.height : rect.height || 600),
    );
    return serializeAcademicSVG(this.doc, this.element, full, width, height);
  }
  render(graph: AcademicTreeGraph, selected?: string) {
    this.selected = selected;
    // Selection changes should preserve the focused DOM node and its hover card.
    if (this.renderedGraph === graph) {
      this.emphasize();
      return;
    }
    this.renderedGraph = graph;
    this.cards.clear();
    this.links = [];
    this.hovered = this.focused = undefined;
    const oldRoot = this.layout?.nodes.find((node) => node.id === graph.rootId);
    const rootChanged = this.rootId !== graph.rootId;
    this.rootId = graph.rootId;
    this.element.setAttribute("data-root-author-id", graph.rootId);
    this.layout = layoutAcademicTree(graph);
    const positions = new Map(this.layout.nodes.map((node) => [node.id, node]));
    const fragment = this.doc.createDocumentFragment();
    const defs = this.doc.createElementNS(NS, "defs");
    for (const active of [false, true]) {
      const marker = this.doc.createElementNS(NS, "marker");
      for (const [key, value] of Object.entries({
        id: this.markerId + (active ? "-active" : ""),
        viewBox: "0 0 10 10",
        refX: "9",
        refY: "5",
        markerWidth: "5",
        markerHeight: "5",
        orient: "auto-start-reverse",
      }))
        marker.setAttribute(key, value);
      const tip = this.doc.createElementNS(NS, "path");
      tip.setAttribute("d", "M0 0L10 5L0 10Z");
      tip.setAttribute(
        "fill",
        active
          ? "var(--color-accent,#0060df)"
          : "var(--fill-secondary,#64748b)",
      );
      tip.setAttribute("fill-opacity", active ? "0.85" : "0.48");
      marker.appendChild(tip);
      defs.appendChild(marker);
    }
    fragment.appendChild(defs);
    const ports = new Map<string, number>();
    for (const direction of ["source", "target"] as const) {
      const groups = new Map<string, typeof graph.edges>();
      for (const edge of graph.edges) {
        const group = groups.get(edge[direction]) ?? [];
        group.push(edge);
        groups.set(edge[direction], group);
      }
      const other = direction === "source" ? "target" : "source";
      for (const [id, edges] of groups) {
        const node = positions.get(id);
        if (!node) continue;
        edges.sort(
          (a, b) =>
            (positions.get(a[other])?.x ?? 0) -
              (positions.get(b[other])?.x ?? 0) ||
            a[other].localeCompare(b[other]),
        );
        const span = Math.min(56, (edges.length - 1) * 8);
        edges.forEach((edge, i) =>
          ports.set(
            `${direction}:${edge.source}|${edge.target}`,
            node.x +
              W / 2 +
              (edges.length > 1 ? (i / (edges.length - 1) - 0.5) * span : 0),
          ),
        );
      }
    }
    for (const edge of graph.edges) {
      const from = positions.get(edge.source),
        to = positions.get(edge.target);
      if (!from || !to) continue;
      const path = this.doc.createElementNS(NS, "path");
      const x1 = ports.get(`source:${edge.source}|${edge.target}`)!,
        y1 = from.y + H,
        x2 = ports.get(`target:${edge.source}|${edge.target}`)!,
        y2 = to.y;
      const bend = Math.max(18, Math.abs(y2 - y1) / 2);
      path.setAttribute(
        "d",
        `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`,
      );
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--fill-secondary,#64748b)");
      path.setAttribute("stroke-width", "1.1");
      path.setAttribute("data-source", edge.source);
      path.setAttribute("data-target", edge.target);
      this.links.push({ source: edge.source, target: edge.target, path });
      path.setAttribute("marker-end", `url(#${this.markerId})`);
      const title = this.doc.createElementNS(NS, "title");
      title.textContent = `${from.name} → ${to.name}: ${edge.degreeTypes.join(", ")}`;
      path.appendChild(title);
      fragment.appendChild(path);
    }
    for (const node of this.layout.nodes) {
      const g = this.doc.createElementNS(NS, "g");
      g.setAttribute("transform", `translate(${node.x},${node.y})`);
      g.setAttribute("data-author-id", node.id);
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", this.describe(node));
      g.style.cursor = "pointer";
      const rect = this.doc.createElementNS(NS, "rect");
      rect.setAttribute("width", String(W));
      rect.setAttribute("height", String(H));
      rect.setAttribute("rx", "6");
      this.cards.set(node.id, rect);
      g.addEventListener("mouseenter", () => {
        this.hovered = node.id;
        this.emphasize();
      });
      g.addEventListener("mouseleave", () => {
        this.hovered = undefined;
        this.emphasize();
      });
      g.addEventListener("focusin", () => {
        this.focused = node.id;
        this.emphasize();
      });
      g.addEventListener("focusout", () => {
        this.focused = undefined;
        this.emphasize();
      });
      if (!node.recid) rect.setAttribute("stroke-dasharray", "5 3");
      g.appendChild(rect);
      const title = this.doc.createElementNS(NS, "title");
      title.textContent = this.describe(node);
      g.appendChild(title);
      const text = this.doc.createElementNS(NS, "text");
      text.setAttribute("x", String(W / 2));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "var(--fill-primary,#1e293b)");
      text.setAttribute("font-size", "13");
      text.setAttribute("font-family", "system-ui,sans-serif");
      const lines = wrapAcademicName(node.name, this.measureName);
      text.setAttribute(
        "y",
        String(
          node.institution
            ? lines.length > 1
              ? 15
              : 23
            : H / 2 + 4 - ((lines.length - 1) * 16) / 2,
        ),
      );
      lines.forEach((line, index) => {
        const span = this.doc.createElementNS(NS, "tspan");
        span.setAttribute("x", String(W / 2));
        span.setAttribute("dy", index ? "16" : "0");
        span.textContent = line;
        text.appendChild(span);
      });
      text.style.textDecoration = "none";
      if (node.recid) {
        text.setAttribute("role", "link");
        text.setAttribute("tabindex", "0");
        let over = false,
          focused = false;
        const decoration = () => {
          text.style.textDecoration = over || focused ? "underline" : "none";
        };
        text.addEventListener("mouseenter", () => {
          over = true;
          decoration();
        });
        text.addEventListener("mouseleave", () => {
          over = false;
          decoration();
        });
        text.addEventListener("focus", () => {
          focused = true;
          decoration();
        });
        text.addEventListener("blur", () => {
          focused = false;
          decoration();
        });
      }
      text.setAttribute("aria-label", node.name);
      const follow = (event: Event) => {
        event.stopPropagation();
        if (!this.moved && node.recid) this.reRoot(node);
      };
      text.addEventListener("click", follow);
      text.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.moved = false;
          follow(event);
        }
      });
      text.addEventListener("mouseenter", () => this.hover(node, text));
      text.addEventListener("mouseleave", () => this.leave());
      g.appendChild(text);
      if (node.institution) {
        const affiliation = this.doc.createElementNS(NS, "text");
        affiliation.setAttribute("data-affiliation", node.institution);
        affiliation.setAttribute("x", String(W / 2));
        affiliation.setAttribute("y", "44");
        affiliation.setAttribute("text-anchor", "middle");
        affiliation.setAttribute("font-size", "10");
        affiliation.setAttribute("font-family", "system-ui,sans-serif");
        affiliation.setAttribute("fill", "var(--fill-secondary,#64748b)");
        const chars = Array.from(node.institution.trim().replace(/\s+/g, " "));
        const fits = (label: string) =>
          (this.measureName(label) * 10) / 13 <= W - 24;
        let label = chars.join("");
        if (!fits(label)) {
          while (chars.length && !fits(chars.join("") + "…")) chars.pop();
          label = chars.join("") + "…";
        }
        affiliation.textContent = label;
        const full = this.doc.createElementNS(NS, "title");
        full.textContent = node.institution;
        affiliation.appendChild(full);
        g.appendChild(affiliation);
      }
      const activate = () => {
        if (!this.moved) this.select(node);
      };
      g.addEventListener("click", activate);
      g.addEventListener("dblclick", () => {
        if (!this.moved && node.recid) this.reRoot(node);
      });
      g.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.select(node);
        }
      });
      fragment.appendChild(g);
    }
    this.group.replaceChildren(fragment);
    this.emphasize();
    const root = positions.get(graph.rootId);
    if (rootChanged || !oldRoot) {
      this.scale = 1;
      this.center();
    } else if (root) {
      this.x += (oldRoot.x - root.x) * this.scale;
      this.y += (oldRoot.y - root.y) * this.scale;
      this.transform();
    }
  }
  dispose() {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.clear();
    this.element.remove();
  }
}
