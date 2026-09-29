// ─────────────────────────────────────────────────────────────────────────────
// DetailPane: the focused paper of the arXiv browser in full — title and
// abstract with their formulas rendered, all authors (with the local author
// card on hover), categories, comments, journal reference, version, the
// sections it was announced in, and the read-only actions.
// ─────────────────────────────────────────────────────────────────────────────

import type { FluentMessageId } from "../../../../typings/i10n";
import { getString } from "../../../utils/locale";
import { renderMathContent } from "../../inspire/mathRenderer";
import { ARXIV_ARCHIVES, arxivCategory } from "../arxivCategories";
import type { ListingSection, ListingStream } from "../listingTypes";
import { abstractPageUrl, type BrowserActions } from "./browserActions";
import type { BrowserEntry } from "./browserList";
import { formatDay } from "./browserText";
import { button, html } from "./dom";

/** The most authors a listing page names (design 2.1) */
const LISTED_AUTHORS = 100;

const SECTION_NAMES: Record<ListingSection, FluentMessageId> = {
  new: "arxiv-browser-detail-section-new",
  cross: "arxiv-browser-detail-section-cross",
  replace: "arxiv-browser-detail-section-replace",
};

export interface DetailPaneOptions {
  container: HTMLElement;
  actions: BrowserActions;
  /** Hover on an author's name: show the author's card */
  onAuthorHover(entry: BrowserEntry, index: number, anchor: HTMLElement): void;
  onAuthorLeave(): void;
  /** Show a paper that is in the library there */
  showInLibrary?(itemID: number): void;
  /** Open the paper's PDF (default: arXiv's, in the web browser) */
  openPdf?(entry: BrowserEntry): void;
  /**
   * The paper's HTML version: open it (default: arXiv's, in the web
   * browser), and its menu (none: no menu)
   */
  html?: HtmlButtonActions;
  /** Adding the paper to the library and relating it (none: no buttons) */
  library?: DetailLibraryActions;
}

/** What the detail pane's library buttons do */
export interface DetailLibraryActions {
  /**
   * Add the paper where the user chooses; `journalVersion`: its journal
   * version when there is one
   */
  add(
    entry: BrowserEntry,
    how: { anchor: HTMLElement; journalVersion?: boolean },
  ): void;
  /** Relate the paper to items chosen in Zotero's Select Items dialog */
  relate(entry: BrowserEntry, anchor: HTMLElement): void;
}

/** What the HTML button and its menu do */
export interface HtmlButtonActions {
  /** Whether the paper's HTML version is saved in the library */
  saved(entry: BrowserEntry): boolean;
  /** Open the saved snapshot, else arXiv's HTML version in the web browser */
  open(entry: BrowserEntry): void;
  /** The ▾ menu, below `anchor` */
  menu(entry: BrowserEntry, anchor: HTMLElement): void;
}

/** The name of a category or archive, if arXiv's table has it */
function categoryName(name: string): string | undefined {
  return (
    arxivCategory(name)?.name ??
    ARXIV_ARCHIVES.find((archive) => archive.id === name)?.name
  );
}

/** Where a paper was announced: its category pages and their sections */
function sectionsText(streams: readonly ListingStream[]): string {
  return streams
    .map((stream) =>
      getString(SECTION_NAMES[stream.section], {
        args: { category: stream.category },
      }),
    )
    .join("; ");
}

export class DetailPane {
  private readonly doc: Document;
  private shown: BrowserEntry | null = null;
  /** The line of the sections the paper shown was announced in */
  private sections: HTMLElement | null = null;

  constructor(private readonly options: DetailPaneOptions) {
    this.doc = options.container.ownerDocument;
    this.show(null);
  }

  /** The paper shown, if any */
  get entry(): BrowserEntry | null {
    return this.shown;
  }

  /**
   * Its sections line again, when more of the day's categories list the
   * paper shown (the rest of the pane, a selection in it, stays)
   */
  refreshSections(): void {
    if (!this.shown || !this.sections) return;
    const text = sectionsText(this.shown.listing.streams);
    if (this.sections.textContent !== text) this.sections.textContent = text;
  }

  show(entry: BrowserEntry | null): void {
    const container = this.options.container;
    // The same paper shown again (a mark arrived) keeps its scroll position
    const scroll =
      entry && this.shown?.id === entry.id ? container.scrollTop : 0;
    this.shown = entry;
    this.sections = null;
    const doc = this.doc;
    if (!entry) {
      container.replaceChildren(
        html(
          doc,
          "div",
          "arxiv-browser__empty",
          getString("arxiv-browser-detail-empty"),
        ),
      );
      return;
    }
    const { listing } = entry;
    const { actions } = this.options;

    const title = html(doc, "h2", "arxiv-browser__detail-title");
    title.textContent = listing.title;
    void renderMathContent(listing.title, title);

    const authors = html(doc, "div", "arxiv-browser__detail-authors");
    listing.authors.forEach((author, index) => {
      if (index) authors.append(doc.createTextNode(", "));
      const name = html(doc, "span", "arxiv-browser__author", author.display);
      name.addEventListener("mouseenter", () =>
        this.options.onAuthorHover(entry, index, name),
      );
      name.addEventListener("mouseleave", () => this.options.onAuthorLeave());
      authors.append(name);
    });
    // arXiv's listing pages name at most the first 100 authors
    if (listing.authors.length >= LISTED_AUTHORS) {
      authors.append(
        html(
          doc,
          "div",
          "arxiv-browser__detail-quiet",
          getString("arxiv-browser-detail-authors-limit"),
        ),
      );
    }

    const identity = html(doc, "div", "arxiv-browser__detail-line");
    const link = html(doc, "a", undefined, `arXiv:${listing.id}`);
    link.href = abstractPageUrl(listing.id);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      actions.openAbstractPage(listing.id);
    });
    identity.append(link);
    if (listing.version) {
      identity.append(
        doc.createTextNode(
          ` · ${getString("arxiv-browser-detail-version", {
            args: { version: listing.version },
          })}`,
        ),
      );
    }
    identity.append(
      doc.createTextNode(
        ` · ${getString("arxiv-browser-detail-announced", {
          args: { date: formatDay(listing.announceDate) },
        })}`,
      ),
    );

    const categories = html(doc, "div", "arxiv-browser__detail-line");
    listing.categories.forEach((category, index) => {
      if (index) categories.append(doc.createTextNode(" · "));
      const chip = html(
        doc,
        "span",
        index
          ? "arxiv-browser__category"
          : "arxiv-browser__category arxiv-browser__category--primary",
        category,
      );
      const name = categoryName(category);
      if (name) chip.title = name;
      categories.append(chip);
    });

    const where = html(
      doc,
      "div",
      "arxiv-browser__detail-line arxiv-browser__detail-quiet",
      sectionsText(listing.streams),
    );
    this.sections = where;

    const parts: HTMLElement[] = [title, authors, identity, categories, where];
    if (listing.comments) {
      parts.push(
        this.labelled("arxiv-browser-detail-comments", listing.comments),
      );
    }
    if (listing.journalRef) {
      parts.push(
        this.labelled("arxiv-browser-detail-journal-ref", listing.journalRef),
      );
    }
    if (entry.localItemID) {
      const inLibrary = html(
        doc,
        "div",
        "arxiv-browser__detail-line",
        getString("arxiv-browser-detail-in-library"),
      );
      const itemID = entry.localItemID;
      inLibrary.append(
        doc.createTextNode(" "),
        button(doc, getString("arxiv-browser-show-in-library"), () =>
          this.options.showInLibrary?.(itemID),
        ),
      );
      parts.push(inLibrary);
    }

    const library = this.options.library;
    if (library) parts.push(this.libraryButtons(entry, library));

    const buttons = html(doc, "div", "arxiv-browser__detail-actions");
    buttons.append(
      button(doc, getString("arxiv-browser-copy-id"), () => {
        void actions.copyId(listing.id);
      }),
      button(doc, getString("arxiv-browser-copy-bibtex"), () => {
        void actions.copyBibtex(listing);
      }),
      button(doc, getString("arxiv-browser-open-abstract-page"), () =>
        actions.openAbstractPage(listing.id),
      ),
      button(doc, getString("arxiv-browser-open-pdf-button"), () =>
        this.options.openPdf
          ? this.options.openPdf(entry)
          : actions.openPdf(listing.id),
      ),
    );
    // Unless the listing says arXiv has no HTML version
    if (listing.html !== false) buttons.append(this.htmlButton(entry));
    parts.push(buttons);

    if (listing.abstract) {
      const abstract = html(doc, "div", "arxiv-browser__detail-abstract");
      // Its TeX, for the right-click menu's Copy as LaTeX
      abstract.dataset.latexSource = listing.abstract;
      abstract.textContent = listing.abstract;
      void renderMathContent(listing.abstract, abstract);
      parts.push(abstract);
    }
    container.replaceChildren(...parts);
    container.scrollTop = scroll;
  }

  /**
   * The HTML button: the saved snapshot in Zotero, else arXiv's HTML version
   * in the web browser; with its ▾ menu
   */
  private htmlButton(entry: BrowserEntry): HTMLElement {
    const doc = this.doc;
    const { actions, html: htmlActions } = this.options;
    const open = button(doc, getString("arxiv-browser-open-html-button"), () =>
      htmlActions
        ? htmlActions.open(entry)
        : actions.openHtml(entry.listing.id),
    );
    open.title = getString("arxiv-browser-open-html");
    if (!htmlActions) return open;
    // The tooltip tells what a click does now (a snapshot may have been
    // saved since the pane was drawn)
    open.addEventListener("mouseenter", () => {
      open.title = getString(
        htmlActions.saved(entry)
          ? "arxiv-browser-open-html-snapshot"
          : "arxiv-browser-open-html",
      );
    });
    const more = button(
      doc,
      "▾",
      (event) =>
        htmlActions.menu(entry, event.currentTarget as HTMLButtonElement),
      "arxiv-browser__button arxiv-browser__split-more",
    );
    more.title = getString("arxiv-browser-html-menu");
    const split = html(doc, "span", "arxiv-browser__split");
    split.append(open, more);
    return split;
  }

  /**
   * Add (choosing where), add the journal version (for a paper with a
   * journal reference), relate
   */
  private libraryButtons(
    entry: BrowserEntry,
    library: DetailLibraryActions,
  ): HTMLElement {
    const doc = this.doc;
    const buttons = html(doc, "div", "arxiv-browser__detail-actions");
    const add = (journalVersion: boolean) =>
      button(
        doc,
        getString(
          journalVersion ? "arxiv-browser-add-journal" : "arxiv-browser-add",
        ),
        (event) =>
          library.add(entry, {
            anchor: event.currentTarget as HTMLElement,
            ...(journalVersion ? { journalVersion } : {}),
          }),
      );
    buttons.append(add(false));
    if (entry.listing.journalRef) buttons.append(add(true));
    buttons.append(
      button(doc, getString("arxiv-browser-link"), (event) =>
        library.relate(entry, event.currentTarget as HTMLElement),
      ),
    );
    return buttons;
  }

  private labelled(key: FluentMessageId, text: string): HTMLElement {
    const line = html(this.doc, "div", "arxiv-browser__detail-line");
    line.append(
      html(this.doc, "span", "arxiv-browser__detail-label", getString(key)),
      this.doc.createTextNode(` ${text}`),
    );
    return line;
  }
}
