import { applyPillButtonStyle } from "../../pickerUI";
import { isDarkMode } from "../styles";

/** Shared Connections Graph controls, matching the citation toolbar. */
export function styleGraphToolbar(bar: HTMLElement): void {
  bar.style.cssText =
    "display:flex;align-items:center;gap:6px;padding:10px 12px;flex-shrink:0;background:var(--material-sidepane,#f8fafc);border-bottom:1px solid var(--fill-quinary,#e2e8f0)";
}
export function graphButton(
  doc: Document,
  label: string,
  action: () => void,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = label;
  button.setAttribute("aria-label", label);
  applyPillButtonStyle(button, false, isDarkMode());
  button.addEventListener("click", action);
  return button;
}
export function styleGraphSelect(select: HTMLSelectElement): void {
  select.style.cssText =
    "font:inherit;font-size:12px;color:var(--fill-primary,#1e293b);background:var(--material-background,#fff);border:1px solid var(--fill-quinary,#e2e8f0);border-radius:10px;padding:3px 6px;max-width:220px";
}
export interface GraphMenuItem {
  label: string;
  disabled?: boolean;
  onClick(): void | Promise<void>;
}

/** One keyboard-accessible, viewport-clamped popup for both graph tabs. */
export class GraphMenu {
  private cleanup?: () => void;
  private anchor?: HTMLElement;
  constructor(private doc: Document) {}
  close(restoreFocus = false): void {
    const anchor = this.anchor;
    this.cleanup?.();
    this.cleanup = undefined;
    this.anchor = undefined;
    if (restoreFocus) anchor?.focus();
  }
  toggle(anchor: HTMLElement, content: HTMLElement): void {
    if (this.anchor === anchor) this.close();
    else this.open(anchor, content, "dialog");
  }
  show(anchor: HTMLElement, items: GraphMenuItem[]): void {
    if (this.anchor === anchor) {
      this.close();
      return;
    }
    const menu = this.doc.createElement("div");
    menu.style.flexDirection = "column";
    for (const item of items) {
      const row = this.doc.createElement("button");
      row.type = "button";
      row.setAttribute("role", "menuitem");
      row.textContent = item.label;
      row.disabled = Boolean(item.disabled);
      row.style.cssText =
        "display:block;width:100%;text-align:start;padding:6px 10px;border:0;border-radius:8px;font-size:12px;color:var(--fill-primary,#1e293b);background:transparent;cursor:pointer";
      row.addEventListener("mouseenter", () => {
        row.style.background = "var(--fill-quinary,#f1f5f9)";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
      });
      row.addEventListener("click", () => {
        this.close(true);
        void Promise.resolve()
          .then(() => item.onClick())
          .catch((error) => Zotero.debug(error));
      });
      menu.append(row);
    }
    this.open(anchor, menu, "menu");
  }
  private open(anchor: HTMLElement, content: HTMLElement, role: string): void {
    this.close();
    const parent = content.parentNode,
      next = content.nextSibling;
    const previousStyle = content.style.cssText;
    this.anchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    anchor.setAttribute("aria-haspopup", role);
    content.hidden = false;
    content.setAttribute("role", role);
    content.setAttribute(
      "aria-label",
      anchor.getAttribute("aria-label") || anchor.textContent || "",
    );
    content.style.cssText +=
      ";position:fixed;display:flex;z-index:2147483005;background:var(--material-background,#fff);border:1px solid var(--fill-quinary,#d1d5db);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:8px;gap:6px;min-width:220px;max-width:calc(100vw - 20px);max-height:calc(100vh - 20px);overflow:auto;box-sizing:border-box";
    (this.doc.body || this.doc.documentElement).append(content);
    const rect = anchor.getBoundingClientRect();
    const win = this.doc.defaultView;
    const width =
      this.doc.documentElement.clientWidth || win?.innerWidth || 800;
    const height =
      this.doc.documentElement.clientHeight || win?.innerHeight || 600;
    const bounds = content.getBoundingClientRect();
    content.style.left = `${Math.max(10, Math.min(rect.left, width - bounds.width - 10))}px`;
    content.style.top = `${Math.max(10, Math.min(rect.bottom + 6, height - bounds.height - 10))}px`;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !content.contains(target) && !anchor.contains(target))
        this.close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
      }
      if (
        role === "menu" &&
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        const rows = [
          ...content.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const index = rows.indexOf(this.doc.activeElement as HTMLButtonElement);
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? rows.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
                rows.length;
        (rows[nextIndex] as HTMLButtonElement | undefined)?.focus();
      }
    };
    const resize = () => this.close();
    win?.addEventListener("mousedown", outside, true);
    win?.addEventListener("keydown", keydown, true);
    win?.addEventListener("resize", resize);
    this.cleanup = () => {
      win?.removeEventListener("mousedown", outside, true);
      win?.removeEventListener("keydown", keydown, true);
      win?.removeEventListener("resize", resize);
      anchor.setAttribute("aria-expanded", "false");
      content.hidden = true;
      content.style.cssText = previousStyle;
      if (parent)
        parent.insertBefore(content, next?.parentNode === parent ? next : null);
      else content.remove();
    };
    content
      .querySelector<HTMLElement>("button:not(:disabled),input,select")
      ?.focus();
  }
}
