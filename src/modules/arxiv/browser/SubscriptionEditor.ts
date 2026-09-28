// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionEditor: the panel for making or changing a subscription of the
// arXiv browser. Categories are picked from arXiv's taxonomy, grouped as
// group → archive → category, with a search over names and identifiers. An
// archive with several categories can be taken as a whole (its own listing
// page). Picking an alias selects its canonical category, which is what is
// stored. The panel also tells what a first load costs at arXiv's request
// interval.
// ─────────────────────────────────────────────────────────────────────────────

import type { FluentMessageId } from "../../../../typings/i10n";
import { getString } from "../../../utils/locale";
import {
  ARXIV_ARCHIVES,
  ARXIV_CATEGORIES,
  ARXIV_GROUPS,
  arxivCategory,
  type ArxivArchive,
  type ArxivCategory,
} from "../arxivCategories";
import { estimateListingRequests } from "../listingService";
import { LISTING_SECTIONS, type ListingSection } from "../listingTypes";
import { button, checkbox, html } from "./dom";
import {
  archivesListing,
  DEFAULT_SECTIONS,
  isWholeArchive,
  newSubscriptionId,
  normalizeCategories,
  type ArxivSubscription,
} from "./subscriptions";

/** More categories than this get a note on the cost of a first load */
const MANY_CATEGORIES = 10;

/** Names of the listing sections */
export const SECTION_LABELS: Record<ListingSection, FluentMessageId> = {
  new: "arxiv-browser-section-new",
  cross: "arxiv-browser-section-cross",
  replace: "arxiv-browser-section-replace",
};

export interface SubscriptionEditorOptions {
  /** The subscription to change; absent for a new one */
  subscription?: ArxivSubscription;
  /** Name a new subscription gets unless the user types one */
  defaultName: string;
  onSave(subscription: ArxivSubscription): void;
  onClose?(): void;
}

/** One checkbox of the tree and the name it selects */
interface PickRow {
  row: HTMLElement;
  input: HTMLInputElement;
  /** Category (canonical) or whole archive the box stands for */
  name: string;
  /** Lower-case text the search looks in */
  text: string;
}

/** A duration in seconds, or minutes and seconds (not rounded up) */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 120) {
    return getString("arxiv-browser-duration-seconds", {
      args: { count: seconds },
    });
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest
    ? getString("arxiv-browser-duration-minutes-seconds", {
        args: { minutes, seconds: rest },
      })
    : getString("arxiv-browser-duration-minutes", { args: { count: minutes } });
}

export class SubscriptionEditor {
  readonly panel: HTMLElement;
  private readonly doc: Document;
  private readonly backdrop: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly searchInput: HTMLInputElement;
  private readonly tree: HTMLElement;
  private readonly selectedList: HTMLElement;
  private readonly estimate: HTMLElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly rows: PickRow[] = [];
  /** Parts of the window made unusable while the panel is open */
  private readonly inert: Element[];
  private readonly details: HTMLDetailsElement[] = [];
  private selected: string[];
  private readonly sections: Record<ListingSection, boolean>;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  };

  constructor(
    host: HTMLElement,
    private readonly options: SubscriptionEditorOptions,
  ) {
    this.doc = host.ownerDocument;
    const doc = this.doc;
    const current = options.subscription;
    this.selected = [...(current?.categories ?? [])];
    this.sections = { ...(current?.sections ?? DEFAULT_SECTIONS) };

    this.backdrop = html(doc, "div", "arxiv-browser__backdrop");
    this.panel = html(doc, "div", "arxiv-browser__editor");
    this.panel.setAttribute("role", "dialog");
    this.backdrop.append(this.panel);

    const title = html(
      doc,
      "h2",
      "arxiv-browser__editor-title",
      getString(
        current
          ? "arxiv-browser-editor-title-edit"
          : "arxiv-browser-editor-title-new",
      ),
    );

    const nameLabel = html(
      doc,
      "label",
      "arxiv-browser__field",
      getString("arxiv-browser-editor-name"),
    );
    this.nameInput = html(doc, "input");
    this.nameInput.type = "text";
    this.nameInput.value = current?.name ?? "";
    this.nameInput.placeholder = options.defaultName;
    nameLabel.append(this.nameInput);

    this.searchInput = html(doc, "input", "arxiv-browser__editor-search");
    this.searchInput.type = "search";
    this.searchInput.placeholder = getString("arxiv-browser-editor-search");
    this.searchInput.addEventListener("input", () => this.applySearch());

    this.tree = html(doc, "div", "arxiv-browser__editor-tree");
    this.buildTree();

    const side = html(doc, "div", "arxiv-browser__editor-side");
    side.append(
      html(
        doc,
        "div",
        "arxiv-browser__editor-heading",
        getString("arxiv-browser-editor-selected"),
      ),
    );
    this.selectedList = html(doc, "ol", "arxiv-browser__editor-selected");
    side.append(this.selectedList);

    const columns = html(doc, "div", "arxiv-browser__editor-columns");
    const pick = html(doc, "div", "arxiv-browser__editor-pick");
    pick.append(this.searchInput, this.tree);
    columns.append(pick, side);

    const sections = html(doc, "div", "arxiv-browser__editor-sections");
    sections.append(
      html(doc, "span", undefined, getString("arxiv-browser-editor-sections")),
    );
    for (const section of LISTING_SECTIONS) {
      sections.append(
        checkbox(
          doc,
          getString(SECTION_LABELS[section]),
          this.sections[section],
          (checked) => {
            this.sections[section] = checked;
            this.update();
          },
        ).label,
      );
    }

    this.estimate = html(doc, "div", "arxiv-browser__editor-estimate");

    const actions = html(doc, "div", "arxiv-browser__editor-actions");
    this.saveButton = button(
      doc,
      getString("arxiv-browser-editor-save"),
      () => this.save(),
      "arxiv-browser__button arxiv-browser__button--primary",
    );
    actions.append(
      button(doc, getString("arxiv-browser-editor-cancel"), () => this.close()),
      this.saveButton,
    );

    this.panel.append(
      title,
      nameLabel,
      columns,
      sections,
      this.estimate,
      actions,
    );
    // The rest of the window cannot be used (or reached by Tab) meanwhile
    this.inert = [...host.children].filter(
      (child) => !child.hasAttribute("inert"),
    );
    for (const element of this.inert) element.setAttribute("inert", "");
    host.append(this.backdrop);
    doc.addEventListener("keydown", this.onKeyDown, true);
    this.update();
    this.nameInput.focus();
  }

  /** The selected categories and archives, in order */
  getSelected(): string[] {
    return [...this.selected];
  }

  close(): void {
    if (!this.backdrop.isConnected) return;
    this.doc.removeEventListener("keydown", this.onKeyDown, true);
    for (const element of this.inert) element.removeAttribute("inert");
    this.backdrop.remove();
    this.options.onClose?.();
  }

  private save(): void {
    const categories = normalizeCategories(this.selected);
    if (!categories.length || !this.hasSection()) return;
    const current = this.options.subscription;
    this.options.onSave({
      id: current?.id ?? newSubscriptionId(),
      name: this.nameInput.value.trim() || this.options.defaultName,
      categories,
      sections: { ...this.sections },
    });
    this.close();
  }

  private hasSection(): boolean {
    return LISTING_SECTIONS.some((section) => this.sections[section]);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The category tree
  // ───────────────────────────────────────────────────────────────────────────

  private buildTree(): void {
    for (const group of ARXIV_GROUPS) {
      const groupDetails = this.section(group.name);
      for (const archive of ARXIV_ARCHIVES.filter(
        (item) => item.group === group.id,
      )) {
        const categories = ARXIV_CATEGORIES.filter(
          (category) => category.archive === archive.id,
        );
        if (!isWholeArchive(archive.id)) {
          // An archive of one category (hep-ph) is that category
          for (const category of categories) {
            groupDetails.append(this.categoryRow(category, group.name));
          }
          continue;
        }
        const archiveDetails = this.section(`${archive.name} (${archive.id})`);
        archiveDetails.append(
          this.archiveRow(archive, categories.length, group.name),
        );
        for (const category of categories) {
          archiveDetails.append(
            this.categoryRow(category, `${group.name} ${archive.name}`),
          );
        }
        groupDetails.append(archiveDetails);
      }
      this.tree.append(groupDetails);
    }
  }

  private section(title: string): HTMLDetailsElement {
    const details = html(this.doc, "details", "arxiv-browser__editor-group");
    details.append(html(this.doc, "summary", undefined, title));
    this.details.push(details);
    return details;
  }

  private archiveRow(
    archive: ArxivArchive,
    count: number,
    context: string,
  ): HTMLElement {
    const label = getString("arxiv-browser-editor-whole-archive", {
      args: { archive: archive.id, count },
    });
    return this.pickRow(
      archive.id,
      label,
      `${archive.id} ${archive.name} ${context}`,
    );
  }

  private categoryRow(category: ArxivCategory, context: string): HTMLElement {
    let label = `${category.id} — ${category.name}`;
    if (category.canonical !== category.id) {
      label += ` (${getString("arxiv-browser-editor-alias", {
        args: { canonical: category.canonical },
      })})`;
    }
    return this.pickRow(
      category.canonical,
      label,
      `${category.id} ${category.name} ${context}`,
    );
  }

  private pickRow(name: string, label: string, text: string): HTMLElement {
    const { label: row, input } = checkbox(
      this.doc,
      label,
      false,
      (checked) => this.toggle(name, checked),
      "arxiv-browser__editor-row",
    );
    this.rows.push({ row, input, name, text: text.toLowerCase() });
    return row;
  }

  private toggle(name: string, checked: boolean): void {
    if (checked) {
      if (!this.selected.includes(name)) this.selected.push(name);
    } else {
      this.selected = this.selected.filter((item) => item !== name);
    }
    this.selected = normalizeCategories(this.selected);
    this.update();
  }

  private applySearch(): void {
    const query = this.searchInput.value.trim().toLowerCase();
    for (const pick of this.rows) {
      pick.row.hidden = Boolean(query) && !pick.text.includes(query);
    }
    // Open the groups with matches while searching; close all when cleared
    for (const details of this.details) {
      const rows = this.rows.filter((pick) => details.contains(pick.row));
      details.hidden = rows.every((pick) => pick.row.hidden);
      details.open = Boolean(query) && !details.hidden;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────────────────────

  private update(): void {
    const archives = new Set(this.selected.filter(isWholeArchive));
    for (const pick of this.rows) {
      // Listed on the page of an archive taken as a whole: nothing to choose
      const included =
        !isWholeArchive(pick.name) &&
        archivesListing(pick.name).some((archive) => archives.has(archive));
      pick.input.checked = included || this.selected.includes(pick.name);
      pick.input.disabled = included;
    }
    this.renderSelected();
    this.renderEstimate();
    this.saveButton.disabled = !this.selected.length || !this.hasSection();
  }

  private renderSelected(): void {
    const doc = this.doc;
    this.selectedList.replaceChildren();
    if (!this.selected.length) {
      this.selectedList.append(
        html(
          doc,
          "li",
          "arxiv-browser__editor-none",
          getString("arxiv-browser-editor-none-selected"),
        ),
      );
      return;
    }
    this.selected.forEach((name, index) => {
      const item = html(doc, "li", "arxiv-browser__editor-chosen");
      const title = isWholeArchive(name)
        ? ARXIV_ARCHIVES.find((archive) => archive.id === name)?.name
        : arxivCategory(name)?.name;
      const text = html(doc, "span", undefined, name);
      if (title) text.title = title;
      const up = button(doc, "↑", () => this.move(index, -1));
      up.title = getString("arxiv-browser-editor-move-up");
      up.disabled = index === 0;
      const down = button(doc, "↓", () => this.move(index, 1));
      down.title = getString("arxiv-browser-editor-move-down");
      down.disabled = index === this.selected.length - 1;
      const remove = button(doc, "×", () => this.toggle(name, false));
      remove.title = getString("arxiv-browser-editor-remove");
      item.append(text, up, down, remove);
      this.selectedList.append(item);
    });
  }

  private move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.selected.length) return;
    const names = [...this.selected];
    [names[index], names[target]] = [names[target], names[index]];
    this.selected = names;
    this.update();
  }

  private renderEstimate(): void {
    const count = this.selected.length;
    if (!count) {
      this.estimate.replaceChildren();
      return;
    }
    const fresh = estimateListingRequests("new", count);
    const recent = estimateListingRequests("recent", count);
    const catchup = estimateListingRequests("catchup", count);
    const lines = [
      getString("arxiv-browser-editor-estimate", {
        args: {
          new: fresh.requests,
          newTime: formatDuration(fresh.minimumMs),
          recent: recent.requests,
          recentTime: formatDuration(recent.minimumMs),
          catchup: catchup.requests - 1,
        },
      }),
    ];
    if (count > MANY_CATEGORIES) {
      lines.push(
        getString("arxiv-browser-editor-many", {
          args: { time: formatDuration(recent.minimumMs) },
        }),
      );
    }
    this.estimate.replaceChildren(
      ...lines.map((line, index) =>
        html(
          this.doc,
          "p",
          index ? "arxiv-browser__editor-warning" : undefined,
          line,
        ),
      ),
    );
  }
}
