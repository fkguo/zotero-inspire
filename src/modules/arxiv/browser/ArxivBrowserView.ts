// ─────────────────────────────────────────────────────────────────────────────
// ArxivBrowserView: the content of the arXiv browser window, built into one
// container element of the window's document. It keeps no reference to the
// main window, so the same view could be placed elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { button, html } from "./dom";
import { SubscriptionBar } from "./SubscriptionBar";
import type { ArxivSubscription } from "./subscriptions";

export interface ArxivBrowserViewOptions {
  /** Asks the user a yes/no question (default: the window's confirm) */
  confirm?: (message: string) => boolean;
}

export class ArxivBrowserView {
  readonly doc: Document;
  /** Subscription and list controls */
  readonly toolbar: HTMLElement;
  readonly subscriptions: SubscriptionBar;
  /** The list pane: day index, pages and the list */
  readonly listPane: HTMLElement;
  readonly list: HTMLElement;
  /** The detail pane of the focused paper */
  readonly detail: HTMLElement;
  private disposed = false;

  constructor(
    readonly root: HTMLElement,
    options: ArxivBrowserViewOptions = {},
  ) {
    const doc = root.ownerDocument;
    this.doc = doc;
    root.replaceChildren();

    this.toolbar = html(doc, "div", "arxiv-browser__toolbar");
    this.subscriptions = new SubscriptionBar({
      host: root,
      confirm:
        options.confirm ??
        ((message) => doc.defaultView?.confirm(message) ?? false),
      onChange: (subscription) => this.showSubscription(subscription),
    });
    this.toolbar.append(this.subscriptions.element);

    const main = html(doc, "div", "arxiv-browser__main");
    this.listPane = html(doc, "div", "arxiv-browser__list-pane");
    this.list = html(doc, "div", "arxiv-browser__list");
    this.list.tabIndex = 0;
    this.listPane.append(this.list);
    this.detail = html(doc, "div", "arxiv-browser__detail");
    main.append(this.listPane, this.detail);
    root.append(this.toolbar, main);

    this.showSubscription(this.subscriptions.current);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscriptions.dispose();
  }

  /** The chosen subscription changed */
  private showSubscription(subscription: ArxivSubscription | undefined): void {
    if (!subscription) {
      this.showEmpty(getString("arxiv-browser-empty"), true);
      return;
    }
    this.list.replaceChildren();
  }

  /** Show a message in place of the list */
  private showEmpty(message: string, offerNew = false): void {
    const empty = html(this.doc, "div", "arxiv-browser__empty", message);
    if (offerNew) {
      empty.append(
        html(this.doc, "br"),
        button(this.doc, getString("arxiv-browser-subscription-new"), () =>
          this.subscriptions.openEditor(undefined),
        ),
      );
    }
    this.list.replaceChildren(empty);
  }
}
