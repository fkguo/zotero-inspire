// ─────────────────────────────────────────────────────────────────────────────
// FilterHistoryInput: the References panel's filter box, for any window's
// document. Its text filters the list as it is typed; the filter history
// completes it inline (Tab or → takes the suggestion) and keeps what was
// filtered for: on Enter, when a suggestion is taken and when the box is
// left. As a search box (onSubmit), Enter runs the search and the history
// keeps what was searched for, on Enter only.
// ─────────────────────────────────────────────────────────────────────────────

import { filterHistory, type SearchHistoryStore } from "../searchHistory";
import {
  configureInlineHintInput,
  InlineHintHelper,
  INLINE_HINT_INPUT_STYLE,
  INLINE_HINT_WRAPPER_STYLE,
} from "./InlineHintHelper";

export interface FilterHistoryInputOptions {
  placeholder: string;
  /** The text changed: typed, or a suggestion taken */
  onInput: (value: string) => void;
  /** Where the history is kept (default: the filter boxes' history) */
  store?: SearchHistoryStore;
  /** Enter: search for the text (the box is a search box) */
  onSubmit?: (value: string) => void;
}

export class FilterHistoryInput {
  /** The box with its suggestion: the element to place */
  readonly wrapper: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly hint: InlineHintHelper;
  private readonly store: SearchHistoryStore;

  constructor(doc: Document, options: FilterHistoryInputOptions) {
    const store = options.store ?? filterHistory;
    this.store = store;
    // A search box keeps only what was searched for
    const keepTyped = !options.onSubmit;
    // The wrapper stays detached until the box is set up
    const wrapper = doc.createElement("div");
    wrapper.className = "zinspire-filter-input-wrapper";
    wrapper.style.cssText =
      INLINE_HINT_WRAPPER_STYLE +
      `min-width: 0; flex: 1 1 120px; max-width: 100%;`;
    this.wrapper = wrapper;

    const input = doc.createElement("input");
    input.type = "text";
    input.className = "zinspire-ref-panel__filter";
    input.placeholder = options.placeholder;
    configureInlineHintInput(input);
    input.style.cssText = INLINE_HINT_INPUT_STYLE;
    this.input = input;

    const hint = new InlineHintHelper({
      input,
      wrapper,
      history: [],
      getHistory: () => store.read(),
    });
    hint.getElement().classList.add("zinspire-filter-inline-hint");
    this.hint = hint;

    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        (event.key === "Tab" || event.key === "ArrowRight") &&
        hint.currentHintText
      ) {
        const cursorAtEnd = input.selectionStart === input.value.length;
        if (cursorAtEnd && hint.accept()) {
          event.preventDefault();
          options.onInput(input.value);
          if (keepTyped) this.remember();
        }
      } else if (event.key === "Escape") {
        hint.hide();
      } else if (event.key === "Enter") {
        this.remember();
        hint.hide();
        options.onSubmit?.(input.value);
      }
    });
    input.addEventListener("input", () => {
      options.onInput(input.value);
      hint.update();
    });
    input.addEventListener("focus", () => hint.update());
    input.addEventListener("blur", () => {
      if (keepTyped) this.remember();
      setTimeout(() => hint.hide(), 150);
    });

    wrapper.appendChild(input);
  }

  get value(): string {
    return this.input.value;
  }

  /** Keep the box's text in the history */
  remember(): void {
    this.store.add(this.input.value);
  }

  /** Empty the box (without reporting a change) */
  clear(): void {
    this.input.value = "";
    this.hint.hide();
  }

  hideHint(): void {
    this.hint.hide();
  }
}
