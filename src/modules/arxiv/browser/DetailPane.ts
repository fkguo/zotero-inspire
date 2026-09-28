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
import type { ListingSection } from "../listingTypes";
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
  onAuthorHover(fullName: string, anchor: HTMLElement): void;
  onAuthorLeave(): void;
  /** Show a paper that is in the library there */
  showInLibrary?(itemID: number): void;
  /** Open the paper's PDF (default: arXiv's, in the web browser) */
  openPdf?(entry: BrowserEntry): void;
}

/** The name of a category or archive, if arXiv's table has it */
function categoryName(name: string): string | undefined {
  return (
    arxivCategory(name)?.name ??
    ARXIV_ARCHIVES.find((archive) => archive.id === name)?.name
  );
}

export class DetailPane {
  private readonly doc: Document;
  private shown: BrowserEntry | null = null;

  constructor(private readonly options: DetailPaneOptions) {
    this.doc = options.container.ownerDocument;
    this.show(null);
  }

  /** The paper shown, if any */
  get entry(): BrowserEntry | null {
    return this.shown;
  }

  show(entry: BrowserEntry | null): void {
    const container = this.options.container;
    // The same paper shown again (a mark arrived) keeps its scroll position
    const scroll =
      entry && this.shown?.id === entry.id ? container.scrollTop : 0;
    this.shown = entry;
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
        this.options.onAuthorHover(entry.authors[index], name),
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
      listing.streams
        .map((stream) =>
          getString(SECTION_NAMES[stream.section], {
            args: { category: stream.category },
          }),
        )
        .join("; "),
    );

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

    const buttons = html(doc, "div", "arxiv-browser__detail-actions");
    buttons.append(
      button(doc, getString("arxiv-browser-copy-id"), () => {
        void actions.copyId(listing.id);
      }),
      button(doc, getString("arxiv-browser-copy-bibtex"), () => {
        void actions.copyBibtex(listing.id);
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
    parts.push(buttons);

    if (listing.abstract) {
      const abstract = html(doc, "div", "arxiv-browser__detail-abstract");
      abstract.textContent = listing.abstract;
      void renderMathContent(listing.abstract, abstract);
      parts.push(abstract);
    }
    container.replaceChildren(...parts);
    container.scrollTop = scroll;
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
