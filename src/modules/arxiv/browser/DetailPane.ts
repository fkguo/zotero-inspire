// ─────────────────────────────────────────────────────────────────────────────
// DetailPane: the focused paper of the arXiv browser in full — title and
// abstract with their formulas rendered, all authors (with the local author
// card on hover), categories, comments, journal reference, version, the
// sections it was announced in, and the read-only actions.
// The version is a chooser of versions 1 … N (N: the listing's). Choosing an
// older one asks the arXiv API for it once (BrowserActions.paperVersion); the
// pane then shows that version's title, authors, abstract, comments, journal
// reference, categories and submission date, and its PDF and HTML buttons
// refer to that version (already while it is fetched). The newest version is
// shown as the listing gives it.
// ─────────────────────────────────────────────────────────────────────────────

import type { FluentMessageId } from "../../../../typings/i10n";
import { getString } from "../../../utils/locale";
import { renderMathContent } from "../../inspire/mathRenderer";
import { ARXIV_ARCHIVES, arxivCategory } from "../arxivCategories";
import type { ArxivApiEntry } from "../arxivApi";
import type {
  ListingAuthor,
  ListingSection,
  ListingStream,
} from "../listingTypes";
import { abstractPageUrl, type BrowserActions } from "./browserActions";
import type { BrowserEntry } from "./browserList";
import { formatDay } from "./browserText";
import { button, html } from "./dom";
import { apiAuthor } from "./SearchLoader";

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
  /**
   * Open the paper's PDF (default: arXiv's, in the web browser); `version`:
   * the older version shown (absent: the newest)
   */
  openPdf?(entry: BrowserEntry, version?: number): void;
  /**
   * The paper's HTML version: open it (default: arXiv's, in the web
   * browser), and its menu (none: no menu); `version`: the version shown
   * (the listing's for the newest, when known)
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
  saved(entry: BrowserEntry, version?: number): boolean;
  /** Open the saved snapshot, else arXiv's HTML version in the web browser */
  open(entry: BrowserEntry, version?: number): void;
  /** The ▾ menu, below `anchor` */
  menu(entry: BrowserEntry, anchor: HTMLElement, version?: number): void;
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
  /** The older version shown of the row shown (by its key), if one */
  private older: { row: string; paper: ArxivApiEntry } | null = null;
  /** The version the user chose that is being fetched, and for which row */
  private pending: { row: string; version: number } | null = null;

  constructor(private readonly options: DetailPaneOptions) {
    this.doc = options.container.ownerDocument;
    this.show(null);
  }

  /** The paper shown, if any */
  get entry(): BrowserEntry | null {
    return this.shown;
  }

  /** The title shown: the older version's when one is shown */
  get title(): string | undefined {
    return this.older?.paper.title ?? this.shown?.listing.title;
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
    // Another paper (or another row of it) starts at its newest version
    if (this.older?.row !== entry?.id) this.older = null;
    if (this.pending?.row !== entry?.id) this.pending = null;
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
    const older = this.older?.paper;
    const shown = older ? olderVersion(older) : listing;
    // The author card knows the listing's authors
    const cards =
      !older ||
      shown.authors.map(({ display }) => display).join("\n") ===
        listing.authors.map(({ display }) => display).join("\n");

    const title = html(doc, "h2", "arxiv-browser__detail-title");
    title.textContent = shown.title;
    void renderMathContent(shown.title, title);

    const authors = html(doc, "div", "arxiv-browser__detail-authors");
    shown.authors.forEach((author, index) => {
      if (index) authors.append(doc.createTextNode(", "));
      const name = html(doc, "span", "arxiv-browser__author", author.display);
      if (cards) {
        name.addEventListener("mouseenter", () =>
          this.options.onAuthorHover(entry, index, name),
        );
        name.addEventListener("mouseleave", () => this.options.onAuthorLeave());
      }
      authors.append(name);
    });
    // arXiv's listing pages name at most the first 100 authors (the API
    // names all)
    if (
      !older &&
      listing.section !== "search" &&
      listing.authors.length >= LISTED_AUTHORS
    ) {
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
        doc.createTextNode(" · "),
        this.versionChooser(entry, listing.version, older?.version),
      );
    }
    // A search result: the submission of its first version instead; an
    // older version: its own submission
    const date = older
      ? older.updated.slice(0, 10)
      : (listing.announceDate ?? listing.submitted?.slice(0, 10));
    // While a chosen version is fetched: that instead of the date shown
    if (this.pending) {
      identity.append(
        doc.createTextNode(" · "),
        html(
          doc,
          "span",
          "arxiv-browser__detail-quiet",
          getString("arxiv-browser-detail-version-loading"),
        ),
      );
    } else if (date) {
      identity.append(
        doc.createTextNode(
          ` · ${getString(
            listing.announceDate && !older
              ? "arxiv-browser-detail-announced"
              : "arxiv-browser-detail-submitted",
            { args: { date: formatDay(date) } },
          )}`,
        ),
      );
    }

    const categories = html(doc, "div", "arxiv-browser__detail-line");
    shown.categories.forEach((category, index) => {
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

    const parts: HTMLElement[] = [title, authors, identity, categories];
    /** What the version shown gives (greyed while another is fetched) */
    const ofVersion: HTMLElement[] = [title, authors, categories];
    // A search result was announced in no listing we know of
    if (listing.streams.length) parts.push(where);
    if (shown.comments) {
      const comments = this.labelled(
        "arxiv-browser-detail-comments",
        shown.comments,
      );
      parts.push(comments);
      ofVersion.push(comments);
    }
    if (shown.journalRef) {
      const journalRef = this.labelled(
        "arxiv-browser-detail-journal-ref",
        shown.journalRef,
      );
      parts.push(journalRef);
      ofVersion.push(journalRef);
    }
    const library = this.libraryLine(entry);
    if (library) parts.push(library);

    // The version chosen, also while it is fetched
    const version = this.pending?.version ?? older?.version;
    const buttons = html(doc, "div", "arxiv-browser__detail-actions");
    buttons.append(
      button(doc, getString("arxiv-browser-copy-bibtex"), () => {
        void actions.copyBibtex(listing);
      }),
      button(doc, getString("arxiv-browser-open-pdf-button"), () =>
        this.options.openPdf
          ? this.options.openPdf(entry, version)
          : actions.openPdf(listing.id, version),
      ),
    );
    // Unless the listing says arXiv has no HTML version
    if (listing.html !== false) {
      buttons.append(this.htmlButton(entry, version ?? listing.version));
    }
    parts.push(buttons);

    if (shown.abstract) {
      const abstract = html(doc, "div", "arxiv-browser__detail-abstract");
      // Its TeX, for the right-click menu's Copy as LaTeX
      abstract.dataset.latexSource = shown.abstract;
      abstract.textContent = shown.abstract;
      void renderMathContent(shown.abstract, abstract);
      parts.push(abstract);
      ofVersion.push(abstract);
    }
    if (this.pending) {
      for (const part of ofVersion) {
        part.classList.add("arxiv-browser__detail-stale");
      }
    }
    container.replaceChildren(...parts);
    container.scrollTop = scroll;
  }

  /**
   * The HTML button: the saved snapshot in Zotero, else arXiv's HTML version
   * in the web browser; with its ▾ menu
   */
  private htmlButton(entry: BrowserEntry, version?: number): HTMLElement {
    const doc = this.doc;
    const { actions, html: htmlActions } = this.options;
    const open = button(doc, getString("arxiv-browser-open-html-button"), () =>
      htmlActions
        ? htmlActions.open(entry, version)
        : actions.openHtml(
            entry.listing.id,
            version === entry.listing.version ? undefined : version,
          ),
    );
    open.title = getString("arxiv-browser-open-html");
    if (!htmlActions) return open;
    // The tooltip tells what a click does now (a snapshot may have been
    // saved since the pane was drawn)
    open.addEventListener("mouseenter", () => {
      open.title = getString(
        htmlActions.saved(entry, version)
          ? "arxiv-browser-open-html-snapshot"
          : "arxiv-browser-open-html",
      );
    });
    const more = button(
      doc,
      "▾",
      (event) =>
        htmlActions.menu(
          entry,
          event.currentTarget as HTMLButtonElement,
          version,
        ),
      "arxiv-browser__button arxiv-browser__split-more",
    );
    more.title = getString("arxiv-browser-html-menu");
    const split = html(doc, "span", "arxiv-browser__split");
    split.append(open, more);
    return split;
  }

  /**
   * "version N", or for a paper with several versions a chooser of versions
   * 1 … N (`newest`), showing `older` when given; disabled while a chosen
   * version is fetched
   */
  private versionChooser(
    entry: BrowserEntry,
    newest: number,
    older: number | undefined,
  ): Node {
    const doc = this.doc;
    const label = (version: number) =>
      getString("arxiv-browser-detail-version", { args: { version } });
    if (newest < 2) return doc.createTextNode(label(newest));
    const select = html(
      doc,
      "select",
      "arxiv-browser__select arxiv-browser__version",
    );
    select.title = getString("arxiv-browser-detail-version-choose");
    for (let version = 1; version <= newest; version++) {
      const option = html(doc, "option", undefined, label(version));
      option.value = String(version);
      select.append(option);
    }
    select.value = String(this.pending?.version ?? older ?? newest);
    select.disabled = this.pending !== null;
    select.addEventListener(
      "change",
      () => void this.choose(entry, Number(select.value), newest),
    );
    return select;
  }

  /**
   * Show version `version` of the row's paper: the newest from the listing,
   * an older one once the arXiv API gave it (else the pane stays as it was)
   */
  private async choose(
    entry: BrowserEntry,
    version: number,
    newest: number,
  ): Promise<void> {
    const row = entry.id;
    if (version === newest) {
      this.older = null;
    } else {
      this.pending = { row, version };
    }
    // The row's entry as last shown (its library marks may have changed)
    const redraw = () => this.shown && this.show(this.shown);
    redraw();
    if (version === newest) return;
    const paper = await this.options.actions.paperVersion(
      entry.listing.id,
      version,
    );
    // Another row shown meanwhile (and maybe this one again, with another
    // choice)
    if (this.pending?.row !== row || this.pending.version !== version) return;
    this.pending = null;
    if (paper) this.older = { row, paper };
    redraw();
  }

  /**
   * One line: "In your library" with Show in library, or Add (choosing
   * where) and Add the journal version (for a paper with a journal
   * reference); then Relate. Not known to be in the library (also when the
   * lookup failed): the Add buttons.
   */
  private libraryLine(entry: BrowserEntry): HTMLElement | null {
    const doc = this.doc;
    const library = this.options.library;
    const itemID = entry.localItemID;
    if (!itemID && !library) return null;
    const line = html(doc, "div", "arxiv-browser__detail-actions");
    if (itemID) {
      line.append(
        html(
          doc,
          "span",
          "arxiv-browser__detail-in-library",
          getString("arxiv-browser-detail-in-library"),
        ),
        button(doc, getString("arxiv-browser-show-in-library"), () =>
          this.options.showInLibrary?.(itemID),
        ),
      );
    } else if (library) {
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
      line.append(add(false));
      if (entry.listing.journalRef) line.append(add(true));
    }
    if (library) {
      line.append(
        button(doc, getString("arxiv-browser-link"), (event) =>
          library.relate(entry, event.currentTarget as HTMLElement),
        ),
      );
    }
    return line;
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

/** What the pane shows of an older version, as the listing's fields */
function olderVersion(paper: ArxivApiEntry): {
  title: string;
  authors: ListingAuthor[];
  abstract: string;
  comments?: string;
  journalRef?: string;
  categories: string[];
} {
  return {
    title: paper.title,
    authors: paper.authors.map(apiAuthor),
    abstract: paper.abstract.replace(/\s+/g, " ").trim(),
    comments: paper.comments,
    journalRef: paper.journalRef,
    categories: paper.categories,
  };
}
