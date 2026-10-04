// ─────────────────────────────────────────────────────────────────────────────
// The divider between the arXiv browser's list and its detail pane. Dragged
// with the mouse, or moved with ← / → while it has the focus, it sets the
// list's share of the width, which the settings keep for the next window.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { getPref, setPref } from "../../../utils/prefs";

/** The list's share of the width, in percent */
const DEFAULT_SHARE = 60;
const MIN_SHARE = 25;
const MAX_SHARE = 80;
/** One press of ← or → */
const KEY_STEP = 2;

const clamp = (share: number) =>
  Math.min(MAX_SHARE, Math.max(MIN_SHARE, Math.round(share)));

/** The list's share of the width from the settings */
export function listShareSetting(): number {
  const value = Number(getPref("arxiv_browser_list_share"));
  return Number.isFinite(value) && value > 0 ? clamp(value) : DEFAULT_SHARE;
}

export class PaneDivider {
  private share: number;
  private dragging = false;

  constructor(
    /** The element holding the list, the divider and the detail pane */
    private readonly main: HTMLElement,
    private readonly list: HTMLElement,
    readonly element: HTMLElement,
  ) {
    element.setAttribute("role", "separator");
    element.setAttribute("aria-orientation", "vertical");
    element.setAttribute("aria-valuemin", String(MIN_SHARE));
    element.setAttribute("aria-valuemax", String(MAX_SHARE));
    element.tabIndex = 0;
    element.title = getString("arxiv-browser-divider");
    this.share = listShareSetting();
    this.apply(this.share);
    element.addEventListener("mousedown", this.onMouseDown);
    element.addEventListener("keydown", this.onKeyDown);
  }

  dispose(): void {
    this.stopDragging();
    this.element.removeEventListener("mousedown", this.onMouseDown);
    this.element.removeEventListener("keydown", this.onKeyDown);
  }

  private apply(share: number): void {
    this.share = share;
    this.list.style.flex = `0 0 ${share}%`;
    this.element.setAttribute("aria-valuenow", String(share));
  }

  private save(): void {
    setPref("arxiv_browser_list_share", this.share);
  }

  private stopDragging(): void {
    if (!this.dragging) return;
    this.dragging = false;
    const doc = this.element.ownerDocument;
    doc.removeEventListener("mousemove", this.onMouseMove);
    doc.removeEventListener("mouseup", this.onMouseUp);
    this.main.classList.remove("arxiv-browser__main--dragging");
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    // No text selection while dragging
    event.preventDefault();
    this.dragging = true;
    const doc = this.element.ownerDocument;
    doc.addEventListener("mousemove", this.onMouseMove);
    doc.addEventListener("mouseup", this.onMouseUp);
    this.main.classList.add("arxiv-browser__main--dragging");
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    const box = this.main.getBoundingClientRect();
    if (box.width <= 0) return;
    this.apply(clamp(((event.clientX - box.left) / box.width) * 100));
  };

  private readonly onMouseUp = (): void => {
    this.stopDragging();
    this.save();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Alt+← / Alt+→ are the window's Back and Forward
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step =
      event.key === "ArrowLeft"
        ? -KEY_STEP
        : event.key === "ArrowRight"
          ? KEY_STEP
          : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    this.apply(clamp(this.share + step));
    this.save();
  };
}
