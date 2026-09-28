// ─────────────────────────────────────────────────────────────────────────────
// ArxivBrowserView: the content of the arXiv browser window, built into one
// container element of the window's document. It keeps no reference to the
// main window, so the same view could be placed elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";

export class ArxivBrowserView {
  readonly doc: Document;
  /** The list pane: day index, pages and the list */
  readonly listPane: HTMLElement;
  readonly list: HTMLElement;
  /** The detail pane of the focused paper */
  readonly detail: HTMLElement;
  private disposed = false;

  constructor(readonly root: HTMLElement) {
    this.doc = root.ownerDocument;
    root.replaceChildren();

    const main = this.element("div", "arxiv-browser__main");
    this.listPane = this.element("div", "arxiv-browser__list-pane");
    this.list = this.element("div", "arxiv-browser__list");
    this.list.tabIndex = 0;
    this.listPane.append(this.list);
    this.detail = this.element("div", "arxiv-browser__detail");
    main.append(this.listPane, this.detail);
    root.append(main);

    this.showEmpty(getString("arxiv-browser-empty"));
  }

  /** Show a message in place of the list */
  showEmpty(message: string): void {
    const empty = this.element("div", "arxiv-browser__empty");
    empty.textContent = message;
    this.list.replaceChildren(empty);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
  }

  private element(tag: string, className: string): HTMLElement {
    const element = this.doc.createElement(tag);
    element.className = className;
    return element;
  }
}
