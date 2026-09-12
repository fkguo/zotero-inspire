import { getString } from "../../../utils/locale";
import type { SearchHistoryStore } from "../searchHistory";
import { configureInlineHintInput, InlineHintHelper } from "./InlineHintHelper";
import { GraphMenu } from "./graphControls";

/** Attach persistent history and the sidebar's inline completion to an input. */
export class SearchHistoryInput {
  private hint: InlineHintHelper;
  private menu: GraphMenu;
  private cleanup: Array<() => void> = [];

  constructor(
    private input: HTMLInputElement,
    wrapper: HTMLElement,
    private button: HTMLButtonElement,
    private store: SearchHistoryStore,
    search: (query: string) => void,
  ) {
    configureInlineHintInput(input);
    this.menu = new GraphMenu(input.ownerDocument);
    this.hint = new InlineHintHelper({
      input,
      wrapper,
      history: [],
      getHistory: () => store.read(),
    });
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    const show = () => {
      const history = store.read();
      this.hint.hide();
      if (!history.length) {
        this.menu.close();
        return;
      }
      this.menu.show(button, [
        ...history.map(({ query }) => ({
          label: query,
          onClick: () => {
            input.value = query;
            search(query);
          },
        })),
        {
          label: getString("references-panel-search-clear-history"),
          onClick: () => {
            store.clear();
            this.hint.hide();
            input.focus();
          },
        },
      ]);
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.key === "Tab" || event.key === "ArrowRight") &&
        input.selectionStart === input.value.length &&
        this.hint.accept()
      ) {
        event.preventDefault();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        show();
      } else if (event.key === "Escape" || event.key === "Enter") this.close();
    };
    const update = () => {
      this.menu.close();
      this.hint.update();
    };
    const focus = () => this.hint.update();
    const blur = () => this.hint.hide();
    input.addEventListener("keydown", keydown);
    input.addEventListener("input", update);
    input.addEventListener("focus", focus);
    input.addEventListener("blur", blur);
    button.addEventListener("click", show);
    this.cleanup.push(() => {
      input.removeEventListener("keydown", keydown);
      input.removeEventListener("input", update);
      input.removeEventListener("focus", focus);
      input.removeEventListener("blur", blur);
      button.removeEventListener("click", show);
    });
  }

  remember(query: string): void {
    this.store.add(query);
    this.close();
  }
  close(): void {
    this.menu.close();
    this.hint.hide();
  }
  dispose(): void {
    this.close();
    this.cleanup.forEach((fn) => fn());
    this.hint.destroy();
  }
}
