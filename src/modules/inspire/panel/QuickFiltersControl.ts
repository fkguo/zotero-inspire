// ─────────────────────────────────────────────────────────────────────────────
// QuickFiltersControl: the References panel's quick-filter button (⏳, with
// the number of filters on) and its popup of check boxes, for any window's
// document. The owner keeps which filters are on and applies them; the
// control shows them and reports a box switched. The popup opens under the
// button and closes on a second click on it or a click elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import type { QuickFilterConfig, QuickFilterType } from "../constants";

export interface QuickFiltersControlOptions {
  /** The filters the popup offers, in its order */
  configs: readonly QuickFilterConfig[];
  /** The filters on */
  active: () => ReadonlySet<QuickFilterType>;
  /** A box was switched in the popup */
  onToggle: (type: QuickFilterType, enabled: boolean) => void;
}

export class QuickFiltersControl {
  /** The button in its wrapper: the element to place */
  readonly element: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly badge: HTMLSpanElement;
  private readonly popup: HTMLDivElement;
  private readonly checkboxes = new Map<QuickFilterType, HTMLInputElement>();
  private visible = false;
  private outsideClickHandler?: (event: MouseEvent) => void;
  private timeoutId?: ReturnType<typeof setTimeout>;

  /**
   * @param popupHost where the popup goes: outside any parent that would
   * clip it
   */
  constructor(
    private readonly popupHost: HTMLElement,
    private readonly options: QuickFiltersControlOptions,
  ) {
    const doc = popupHost.ownerDocument;
    const wrapper = doc.createElement("div");
    wrapper.className = "zinspire-quick-filters";
    // Inline styles to ensure proper flex behavior in Zotero's XUL environment
    wrapper.style.display = "inline-flex";
    wrapper.style.flexShrink = "0";
    wrapper.style.position = "relative";
    this.element = wrapper;

    const button = doc.createElement("button");
    button.className = "zinspire-quick-filter-btn";
    button.type = "button";
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    const filtersLabel = getString("references-panel-quick-filters");
    button.textContent = "⏳";
    button.setAttribute("aria-label", filtersLabel);
    button.setAttribute("title", filtersLabel);
    button.style.cssText = `
      padding: 4px 8px;
      font-size: 14px;
      border: 1px solid var(--fill-quinary, #d1d5db);
      border-radius: 4px;
      background: var(--material-background, #fff);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    `;
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    };

    const badge = doc.createElement("span");
    badge.className = "zinspire-quick-filter-badge";
    badge.hidden = true;
    button.appendChild(badge);

    wrapper.appendChild(button);
    this.button = button;
    this.badge = badge;

    // Fixed positioned dropdown overlay - single column, placed under the
    // button when opened
    const popup = doc.createElement("div");
    popup.className = "zinspire-quick-filter-popup";
    popup.hidden = true;
    popup.style.cssText = `
      display: none;
      flex-direction: column;
      position: fixed;
      z-index: 10000;
      background: var(--material-background, #fff);
      border: 1px solid var(--fill-quinary, #d1d5db);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      padding: 6px 4px;
      gap: 2px;
      min-width: 160px;
    `;
    popupHost.appendChild(popup);
    this.popup = popup;

    this.renderItems();
    this.refresh();
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** Show the filters on: the badge's count and the boxes */
  refresh(): void {
    const active = this.options.active();
    const activeCount = active.size;
    this.button.classList.toggle("active", activeCount > 0);
    this.badge.textContent = activeCount > 0 ? `${activeCount}` : "";
    this.badge.hidden = activeCount === 0;
    for (const [type, checkbox] of this.checkboxes) {
      checkbox.checked = active.has(type);
    }
  }

  toggle(): void {
    if (this.visible) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    const buttonRect = this.button.getBoundingClientRect();
    this.popup.style.top = `${buttonRect.bottom + 4}px`;
    this.popup.style.left = `${buttonRect.left}px`;
    this.popup.hidden = false;
    this.popup.style.display = "flex";
    this.visible = true;
    this.button.setAttribute("aria-expanded", "true");
    this.refresh();

    this.cleanupHandler();
    this.outsideClickHandler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!this.popup.contains(target) && !this.button.contains(target)) {
        this.close();
      }
    };
    // After the click that opened it
    this.timeoutId = setTimeout(() => {
      this.timeoutId = undefined;
      if (this.outsideClickHandler) {
        this.popupHost.ownerDocument.addEventListener(
          "click",
          this.outsideClickHandler,
          true,
        );
      }
    }, 0);
  }

  close(): void {
    this.cleanupHandler();
    this.popup.hidden = true;
    this.popup.style.display = "none";
    this.visible = false;
    this.button.setAttribute("aria-expanded", "false");
  }

  dispose(): void {
    this.close();
    this.popup.remove();
  }

  private cleanupHandler(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    if (this.outsideClickHandler) {
      this.popupHost.ownerDocument.removeEventListener(
        "click",
        this.outsideClickHandler,
        true,
      );
      this.outsideClickHandler = undefined;
    }
  }

  private renderItems(): void {
    const doc = this.popup.ownerDocument;
    for (const config of this.options.configs) {
      const item = doc.createElement("label");
      item.className = "zinspire-quick-filter-item";
      // Compact row style with hover effect - use CSS variables for dark mode
      item.style.cssText = `
        display: flex;
        align-items: center;
        white-space: nowrap;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        color: var(--fill-primary, #1e293b);
        transition: background-color 0.1s ease;
      `;
      const labelText = getString(config.labelKey);
      item.title = config.tooltipKey ? getString(config.tooltipKey) : labelText;
      item.addEventListener("mouseenter", () => {
        item.style.backgroundColor = "var(--fill-quinary, rgba(0, 0, 0, 0.05))";
      });
      item.addEventListener("mouseleave", () => {
        item.style.backgroundColor = "";
      });

      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", (event) => {
        event.stopPropagation();
        this.options.onToggle(config.type, checkbox.checked);
        // Switching one on may switch others off
        this.refresh();
      });

      const emojiSpan = doc.createElement("span");
      emojiSpan.className = "zinspire-quick-filter-item-emoji";
      emojiSpan.textContent = config.emoji;

      const labelSpan = doc.createElement("span");
      labelSpan.className = "zinspire-quick-filter-item-label";
      labelSpan.textContent = labelText;

      item.append(checkbox, emojiSpan, labelSpan);
      this.popup.appendChild(item);
      this.checkboxes.set(config.type, checkbox);
    }
  }
}
