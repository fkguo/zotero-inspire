import type { SearchHistoryItem } from "../types";

/** Configure input element for inline hint usage (disable browser autocomplete) */
export function configureInlineHintInput(input: HTMLInputElement): void {
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");
}

interface InlineHintConfig {
  input: HTMLInputElement;
  wrapper: HTMLElement;
  history: SearchHistoryItem[];
}

/**
 * Helper class for managing inline hint (autocomplete suggestion) in input fields.
 * Used by both Filter input and Search input for consistent behavior.
 */
export class InlineHintHelper {
  private input: HTMLInputElement;
  private wrapper: HTMLElement;
  private hintEl: HTMLSpanElement;
  private getHistory: () => SearchHistoryItem[];
  private _currentHintText = "";

  get currentHintText(): string {
    return this._currentHintText;
  }

  constructor(
    config: InlineHintConfig & { getHistory?: () => SearchHistoryItem[] },
  ) {
    this.input = config.input;
    this.wrapper = config.wrapper;
    this.getHistory = config.getHistory || (() => config.history);

    // Create hint element using native DOM with cssText (required for Zotero)
    const doc = this.wrapper.ownerDocument;
    this.hintEl = doc.createElement("span");
    this.hintEl.className = "zinspire-inline-hint";
    this.hintEl.style.cssText = `
      position: absolute;
      left: 9px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--fill-secondary, #888);
      font-size: 12px;
      pointer-events: none;
      white-space: pre;
      overflow: hidden;
      z-index: 3;
      display: none;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1;
    `;
    this.wrapper.appendChild(this.hintEl);
  }

  /** Update hint based on current input value */
  update(): void {
    const inputValue = this.input.value;
    const history = this.getHistory();

    // Always hide first, then show only if there's a match
    this.hintEl.textContent = "";
    this.hintEl.hidden = true;
    this.hintEl.style.display = "none";

    // No input or no history: stay hidden
    if (!inputValue || history.length === 0) {
      this._currentHintText = "";
      return;
    }

    // Find matching history entry
    const lowerValue = inputValue.toLowerCase();
    let matchingHint = "";
    for (const item of history) {
      // Defensive check: skip items with invalid query
      if (!item.query || typeof item.query !== "string") {
        continue;
      }
      if (
        item.query.toLowerCase().startsWith(lowerValue) &&
        item.query.length > inputValue.length
      ) {
        matchingHint = item.query;
        break;
      }
    }

    // No match found: stay hidden
    if (!matchingHint) {
      this._currentHintText = "";
      return;
    }

    // Show hint: display only the remaining suggestion after what user typed
    const hintSuffix = matchingHint
      .slice(inputValue.length)
      .replace(/ /g, "\u00A0");
    this._currentHintText = matchingHint;

    // Calculate position based on input text width
    const doc = this.wrapper.ownerDocument;
    const computedStyle = doc.defaultView?.getComputedStyle(this.input);

    if (computedStyle) {
      // Use a hidden span for accurate text width measurement
      const measureSpan = doc.createElement("span");
      measureSpan.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: pre;
        font: ${computedStyle.font};
        font-size: ${computedStyle.fontSize};
        font-family: ${computedStyle.fontFamily};
        font-weight: ${computedStyle.fontWeight};
        font-style: ${computedStyle.fontStyle};
        font-variant: ${computedStyle.fontVariant};
        font-stretch: ${computedStyle.fontStretch};
        letter-spacing: ${computedStyle.letterSpacing};
        word-spacing: ${computedStyle.wordSpacing};
        text-transform: ${computedStyle.textTransform};
        text-rendering: ${computedStyle.textRendering};
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      `;
      measureSpan.textContent = inputValue.replace(/ /g, "\u00A0");
      this.wrapper.appendChild(measureSpan);
      const textWidth = measureSpan.offsetWidth;
      this.wrapper.removeChild(measureSpan);

      // Get spacing
      const paddingLeft = parseFloat(computedStyle.paddingLeft) || 8;
      const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
      const paddingTop = parseFloat(computedStyle.paddingTop) || 4;
      const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;

      // Calculate position relative to wrapper
      const inputRect = this.input.getBoundingClientRect();
      const wrapperRect = this.wrapper.getBoundingClientRect();
      const inputLeftOffset = inputRect.left - wrapperRect.left;
      const inputTopOffset = inputRect.top - wrapperRect.top;

      const finalLeft = inputLeftOffset + borderLeft + paddingLeft + textWidth;
      const finalTop = inputTopOffset + borderTop + paddingTop;

      // Update hint element - show it
      this.hintEl.textContent = hintSuffix;
      this.hintEl.style.left = `${finalLeft}px`;
      this.hintEl.style.top = `${finalTop}px`;
      this.hintEl.style.transform = "none";
      this.hintEl.hidden = false;
      this.hintEl.style.display = "block";

      // Match font style of input
      this.hintEl.style.font = computedStyle.font;
      this.hintEl.style.fontSize = computedStyle.fontSize;
      this.hintEl.style.fontFamily = computedStyle.fontFamily;
      this.hintEl.style.lineHeight = computedStyle.lineHeight;
      this.hintEl.style.letterSpacing = computedStyle.letterSpacing;
    } else {
      // Fallback: approximate character width
      const textWidth = inputValue.length * 7;
      this.hintEl.textContent = hintSuffix;
      this.hintEl.style.left = `${9 + textWidth}px`;
      this.hintEl.hidden = false;
      this.hintEl.style.display = "block";
    }
  }

  /** Hide hint and clear current hint text */
  hide(): void {
    this.hintEl.textContent = "";
    this.hintEl.hidden = true;
    this.hintEl.style.display = "none";
    this._currentHintText = "";
  }

  /** Accept current hint (for Tab/ArrowRight completion) */
  accept(): boolean {
    if (this._currentHintText) {
      this.input.value = this._currentHintText;
      this.hide();
      return true;
    }
    return false;
  }

  /** Get the hint element (for adding custom classes) */
  getElement(): HTMLSpanElement {
    return this.hintEl;
  }

  /** Destroy and remove hint element */
  destroy(): void {
    this.hintEl.remove();
  }
}
