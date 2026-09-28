// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionBar: the arXiv browser's choice of subscription, with the
// buttons to make, change and delete subscriptions and a line naming the
// chosen subscription's categories.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { ARXIV_ARCHIVES, arxivCategory } from "../arxivCategories";
import { button, html } from "./dom";
import { SubscriptionEditor } from "./SubscriptionEditor";
import {
  defaultSubscription,
  isWholeArchive,
  loadSubscriptions,
  saveSubscriptions,
  type ArxivSubscription,
} from "./subscriptions";

export interface SubscriptionBarOptions {
  /** Where the editor panel is shown (the window's content) */
  host: HTMLElement;
  /** The chosen subscription changed (or was edited); undefined: none left */
  onChange(subscription: ArxivSubscription | undefined): void;
  /** Asks the user a yes/no question (the window's confirm) */
  confirm(message: string): boolean;
}

/** Full names of a subscription's categories, for tooltips */
function categoryTitle(name: string): string {
  const title = isWholeArchive(name)
    ? ARXIV_ARCHIVES.find((archive) => archive.id === name)?.name
    : arxivCategory(name)?.name;
  return title ? `${name}: ${title}` : name;
}

export class SubscriptionBar {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly select: HTMLSelectElement;
  private readonly editButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly summary: HTMLElement;
  private subscriptions: ArxivSubscription[];
  private currentId: string | undefined;
  private editor: SubscriptionEditor | null = null;

  constructor(private readonly options: SubscriptionBarOptions) {
    this.doc = options.host.ownerDocument;
    const doc = this.doc;
    this.subscriptions = loadSubscriptions();
    this.currentId = defaultSubscription(this.subscriptions)?.id;

    this.element = html(doc, "div", "arxiv-browser__bar");
    const label = html(
      doc,
      "label",
      "arxiv-browser__label",
      getString("arxiv-browser-subscription"),
    );
    this.select = html(doc, "select", "arxiv-browser__select");
    this.select.addEventListener("change", () => {
      this.currentId = this.select.value;
      this.render();
      this.options.onChange(this.current);
    });
    label.append(this.select);

    this.editButton = button(
      doc,
      getString("arxiv-browser-subscription-edit"),
      () => this.openEditor(this.current),
    );
    this.deleteButton = button(
      doc,
      getString("arxiv-browser-subscription-delete"),
      () => this.deleteCurrent(),
    );
    this.summary = html(doc, "span", "arxiv-browser__summary");
    this.element.append(
      label,
      button(doc, getString("arxiv-browser-subscription-new"), () =>
        this.openEditor(undefined),
      ),
      this.editButton,
      this.deleteButton,
      this.summary,
    );
    this.render();
  }

  /** The chosen subscription */
  get current(): ArxivSubscription | undefined {
    return this.subscriptions.find((item) => item.id === this.currentId);
  }

  /** Open the editor for a new subscription (or `subscription`) */
  openEditor(subscription: ArxivSubscription | undefined): void {
    this.editor?.close();
    this.editor = new SubscriptionEditor(this.options.host, {
      subscription,
      defaultName: this.unusedName(),
      onSave: (saved) => this.store(saved),
      onClose: () => {
        this.editor = null;
      },
    });
  }

  /** "Subscription N" with the smallest N no subscription is named after */
  private unusedName(): string {
    const names = new Set(this.subscriptions.map((item) => item.name));
    for (let number = 1; ; number++) {
      const name = getString("arxiv-browser-subscription-default-name", {
        args: { number },
      });
      if (!names.has(name)) return name;
    }
  }

  /** Change the chosen subscription's shown sections (the list's toggles) */
  updateCurrent(change: Partial<Pick<ArxivSubscription, "sections">>): void {
    const current = this.current;
    if (current) this.store({ ...current, ...change });
  }

  dispose(): void {
    this.editor?.close();
  }

  private store(saved: ArxivSubscription): void {
    const index = this.subscriptions.findIndex((item) => item.id === saved.id);
    if (index >= 0) this.subscriptions[index] = saved;
    else this.subscriptions.push(saved);
    saveSubscriptions(this.subscriptions);
    this.currentId = saved.id;
    this.render();
    this.options.onChange(saved);
  }

  private deleteCurrent(): void {
    const current = this.current;
    if (!current) return;
    const question = getString("arxiv-browser-subscription-delete-confirm", {
      args: { name: current.name },
    });
    if (!this.options.confirm(question)) return;
    const index = this.subscriptions.indexOf(current);
    this.subscriptions.splice(index, 1);
    saveSubscriptions(this.subscriptions);
    this.currentId = (
      this.subscriptions[index] ?? this.subscriptions[index - 1]
    )?.id;
    this.render();
    this.options.onChange(this.current);
  }

  private render(): void {
    const doc = this.doc;
    this.select.replaceChildren(
      ...this.subscriptions.map((subscription) => {
        const option = html(doc, "option", undefined, subscription.name);
        option.value = subscription.id;
        return option;
      }),
    );
    const current = this.current;
    this.select.value = current?.id ?? "";
    this.select.disabled = !current;
    this.editButton.disabled = !current;
    this.deleteButton.disabled = !current;
    this.summary.replaceChildren();
    for (const name of current?.categories ?? []) {
      const chip = html(doc, "span", "arxiv-browser__chip", name);
      chip.title = categoryTitle(name);
      this.summary.append(chip);
    }
  }
}
