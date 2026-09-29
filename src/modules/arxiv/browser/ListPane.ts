// ─────────────────────────────────────────────────────────────────────────────
// ListPane: the arXiv browser's list — the index of the loaded days, the page
// controls, and one page of papers under the headers of their days and
// sections (or categories). Rows are the plugin's entry-list rows, built for
// every page (EntryListRenderer without the row pool); when papers arrive,
// the rows already drawn are kept and the rows in view stay in place.
// Abstracts are shown or hidden per paper; their formulas are rendered once
// they come into view. The focused paper moves with j / k across page
// boundaries.
// ─────────────────────────────────────────────────────────────────────────────

import type { FluentMessageId } from "../../../../typings/i10n";
import { getString } from "../../../utils/locale";
import { getPref } from "../../../utils/prefs";
import { renderMathContent } from "../../inspire/mathRenderer";
import {
  EntryListRenderer,
  type EntryRenderContext,
} from "../../inspire/panel/EntryListRenderer";
import { isDarkMode } from "../../inspire/styles";
import { PdfButtonState } from "../../pickerUI";
import { arxivCategory } from "../arxivCategories";
import type { IsoDate } from "../arxivDates";
import type { ListingSection } from "../listingTypes";
import { pdfUrl, type BrowserActions } from "./browserActions";
import {
  pageBlocks,
  pageCount,
  pageOfDay,
  pageOfEntry,
  type ArrangedList,
  type BrowserEntry,
  type ListDay,
  type ListGroup,
  type ListSort,
} from "./browserList";
import { formatDay, formatShortDay, reasonText } from "./browserText";
import { notePaint, noteFormulas, type PaintTime } from "./paintTimes";
import { button, html } from "./dom";
import { SECTION_LABELS } from "./SubscriptionEditor";

/** A paper row in view and its distance from the list's top edge */
interface RowInView {
  key: string;
  offset: number;
}

const SECTION_TAGS: Record<ListingSection, FluentMessageId | null> = {
  new: null,
  cross: "arxiv-browser-section-tag-cross",
  replace: "arxiv-browser-section-tag-replace",
};

/** How the page is placed after the list changed */
export type ListUpdate =
  /**
   * Papers arrived (a day, more of a day's categories) or a day was fetched
   * again: the papers in view stay in place
   */
  | "keep-page"
  /** The order, filter or page size changed: the focused paper's page */
  | "focus";

export interface ListPaneOptions {
  /** The element the pane fills */
  container: HTMLElement;
  actions: BrowserActions;
  pageSize: number;
  abstractsShown: boolean;
  /** The Retry of a day that was not fetched completely */
  onRetryDay(date: IsoDate): void;
  /** The focused paper changed */
  onFocus?(entry: BrowserEntry | null): void;
  /** Show a paper that is in the library there (its item ID) */
  showInLibrary?(itemID: number): void;
  /** The library could not be read and a mark was clicked: try again */
  onLibraryRetry?(): void;
  /** Whether the paper has a PDF in the library (its PDF button is green) */
  hasPdf?(entry: BrowserEntry): boolean;
  /** Open the paper's PDF (default: arXiv's, in the web browser) */
  openPdf?(entry: BrowserEntry): void;
  /** The pointer is on the name of a paper's author (its index) */
  onAuthorHover?(entry: BrowserEntry, index: number, anchor: HTMLElement): void;
  onAuthorLeave?(): void;
  /**
   * The pointer is on the title of a paper whose abstract the row does not
   * show
   */
  onTitleHover?(entry: BrowserEntry, row: HTMLElement): void;
  onTitleLeave?(): void;
}

export class ListPane {
  readonly dayIndex: HTMLElement;
  readonly pager: HTMLElement;
  readonly list: HTMLElement;
  private readonly doc: Document;
  private readonly renderer: EntryListRenderer;
  private arranged: ArrangedList = {
    days: [],
    entries: [],
    sectionOf: new Map(),
  };
  private sort: ListSort = "announcement";
  private page = 0;
  private pageSize: number;
  private abstractsShown: boolean;
  /** Papers whose abstract the user showed or hid, against the default */
  private readonly abstractChoice = new Map<string, boolean>();
  private focusedKey: string | null = null;
  /** Rows of the page shown, by row key */
  private readonly rows = new Map<string, HTMLDivElement>();
  /** The papers of those rows, by row key */
  private readonly rowEntries = new Map<string, BrowserEntry>();
  private observer: IntersectionObserver | null = null;
  private retryEnabled = true;
  private message: string | null = null;

  constructor(private readonly options: ListPaneOptions) {
    const doc = options.container.ownerDocument;
    this.doc = doc;
    this.pageSize = options.pageSize;
    this.abstractsShown = options.abstractsShown;
    this.renderer = new EntryListRenderer({
      document: doc,
      pooled: false,
      adapter: {
        canCopyBibtex: () => true,
        canCopyTexkey: () => false,
        // Green as in the References panel only for a PDF in the library;
        // otherwise arXiv's PDF, opened in the web browser
        pdfButton: (entry, hasPdf) =>
          hasPdf
            ? { state: PdfButtonState.HAS_PDF }
            : {
                state: PdfButtonState.ONLINE,
                title: getString("arxiv-browser-open-pdf"),
                url: pdfUrl((entry as BrowserEntry).listing.id),
              },
        titleSuffix: "",
        abstract: (entry) => entry.abstract || undefined,
        metaSuffix: (entry) => this.metaSuffix(entry as BrowserEntry),
      },
    });

    this.dayIndex = html(doc, "div", "arxiv-browser__days");
    this.pager = html(doc, "div", "arxiv-browser__pager");
    this.list =
      options.container.querySelector(".arxiv-browser__list") ??
      html(doc, "div", "arxiv-browser__list");
    this.list.tabIndex = 0;
    options.container.replaceChildren(this.dayIndex, this.pager, this.list);
    this.list.addEventListener("click", this.onClick);
    this.list.addEventListener("mouseover", this.onMouseOver);
    this.list.addEventListener("mouseout", this.onMouseOut);
  }

  /** The papers shown, in order */
  get entries(): readonly BrowserEntry[] {
    return this.arranged.entries;
  }

  get currentPage(): number {
    return this.page;
  }

  get pages(): number {
    return pageCount(this.arranged, this.pageSize);
  }

  get focused(): BrowserEntry | null {
    return (
      this.arranged.entries.find((entry) => entry.id === this.focusedKey) ??
      null
    );
  }

  /** Show a message instead of the list (no subscription, nothing loaded) */
  showMessage(text: string, extra?: HTMLElement): void {
    this.message = text;
    this.arranged = { days: [], entries: [], sectionOf: new Map() };
    this.page = 0;
    this.setFocus(null, false);
    this.observer?.disconnect();
    this.rows.clear();
    this.rowEntries.clear();
    const empty = html(this.doc, "div", "arxiv-browser__empty", text);
    if (extra) empty.append(html(this.doc, "br"), extra);
    this.list.replaceChildren(empty);
    this.dayIndex.replaceChildren();
    this.pager.replaceChildren();
  }

  /** Show the arranged list */
  setList(arranged: ArrangedList, sort: ListSort, update: ListUpdate): void {
    // Papers arriving before those in view (more of a day's categories) do
    // not move them: the page and scroll follow the paper the reader is at
    const anchor =
      update === "keep-page" && !this.message ? this.rowInView() : null;
    this.message = null;
    this.arranged = arranged;
    this.sort = sort;
    const pages = this.pages;
    if (update === "focus") {
      const page = this.focusedKey
        ? pageOfEntry(arranged, this.focusedKey, this.pageSize)
        : -1;
      if (page < 0) this.setFocus(null, false);
      this.page = page >= 0 ? page : 0;
    } else {
      if (this.focusedKey && !this.focused) this.setFocus(null, false);
      const page = anchor
        ? pageOfEntry(arranged, anchor.key, this.pageSize)
        : -1;
      if (page >= 0) this.page = page;
    }
    this.page = Math.min(this.page, pages - 1);
    this.render(update === "focus" ? "focus" : "keep", anchor);
  }

  setPageSize(size: number): void {
    this.pageSize = size;
    const page = this.focusedKey
      ? pageOfEntry(this.arranged, this.focusedKey, size)
      : -1;
    this.page = page >= 0 ? page : 0;
    this.render("focus");
  }

  /** Show or hide all abstracts */
  setAbstractsShown(shown: boolean): void {
    this.abstractsShown = shown;
    this.abstractChoice.clear();
    for (const [key, row] of this.rows) this.applyAbstract(row, key);
    this.observeAbstracts();
    // A title's card is for rows that hide the abstract
    if (shown) this.options.onTitleLeave?.();
  }

  /** Retries of days are possible only while nothing else loads */
  setRetryEnabled(enabled: boolean): void {
    this.retryEnabled = enabled;
    this.list
      .querySelectorAll<HTMLButtonElement>(".arxiv-browser__retry")
      .forEach((retry) => {
        retry.disabled = !enabled;
      });
  }

  goToPage(page: number): void {
    const target = Math.max(0, Math.min(page, this.pages - 1));
    if (target === this.page || this.message) return;
    const hadFocus = this.focusedKey !== null;
    this.page = target;
    this.render("top");
    // Keys go on from the top of the new page
    if (hadFocus) {
      const first = this.arranged.entries[target * this.pageSize];
      if (first) this.setFocus(first.id, false);
    }
  }

  /**
   * Show the page with a day's header, the header at the top. A focus moves
   * to the day's first paper, so that keys go on from there (none when the
   * day shows no paper).
   */
  goToDay(date: IsoDate): void {
    const page = pageOfDay(this.arranged, date, this.pageSize);
    if (page < 0) return;
    if (page !== this.page) {
      this.page = page;
      this.render("top");
    }
    if (this.focusedKey !== null) {
      let start = 0;
      for (const day of this.arranged.days) {
        if (day.listing.date === date) break;
        start += day.count;
      }
      const first = this.arranged.entries[start];
      this.setFocus(
        first?.listing.announceDate === date ? first.id : null,
        false,
      );
    }
    this.list
      .querySelector(`.arxiv-browser__day[data-date="${date}"]`)
      ?.scrollIntoView({ block: "start" });
  }

  /**
   * Move the focus by `delta` papers, to the next or previous page when it
   * leaves this one. Without a focus: the first (down) or last (up) paper of
   * the page.
   */
  moveFocus(delta: number): void {
    const entries = this.arranged.entries;
    if (!entries.length) return;
    let index = this.focusedKey
      ? entries.findIndex((entry) => entry.id === this.focusedKey)
      : -1;
    if (index < 0) {
      const first = this.page * this.pageSize;
      const last = Math.min(first + this.pageSize, entries.length) - 1;
      index = delta > 0 ? first : last;
    } else {
      index = Math.max(0, Math.min(index + delta, entries.length - 1));
    }
    const page = Math.floor(index / this.pageSize);
    if (page !== this.page) {
      this.page = page;
      this.render("top");
    }
    this.setFocus(entries[index].id, true);
  }

  /** Focus the first or last paper of the page */
  focusPageEnd(end: "first" | "last"): void {
    const first = this.page * this.pageSize;
    const last =
      Math.min(first + this.pageSize, this.arranged.entries.length) - 1;
    const entry = this.arranged.entries[end === "first" ? first : last];
    if (entry) this.setFocus(entry.id, true);
  }

  clearFocus(): void {
    this.setFocus(null, false);
  }

  /** Show or hide the focused paper's abstract */
  toggleFocusedAbstract(): void {
    if (this.focusedKey) this.toggleAbstract(this.focusedKey);
  }

  /** The in-library marks of these papers changed: redraw their rows shown */
  refreshLibraryMarks(entries: Iterable<BrowserEntry>): void {
    for (const entry of entries) {
      const row = this.rows.get(entry.id);
      if (!row) continue;
      this.renderer.updateLocalState(row, entry);
      this.renderer.updatePdfButton(row, entry, this.hasPdf(entry));
    }
  }

  /**
   * Items of the library changed (a PDF attached, say): redraw the PDF
   * buttons of the papers shown that are in the library
   */
  refreshPdfButtons(): void {
    for (const [key, entry] of this.rowEntries) {
      const row = this.rows.get(key);
      if (row && entry.localItemID) {
        this.renderer.updatePdfButton(row, entry, this.hasPdf(entry));
      }
    }
  }

  private hasPdf(entry: BrowserEntry): boolean {
    return Boolean(entry.localItemID) && Boolean(this.options.hasPdf?.(entry));
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.list.removeEventListener("click", this.onClick);
    this.list.removeEventListener("mouseover", this.onMouseOver);
    this.list.removeEventListener("mouseout", this.onMouseOut);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Drawing
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Draw the page. scroll: "top" of the page, the "focus"ed paper, or "keep"
   * the scroll position (papers arriving while the user reads): `anchor`, the
   * paper then first in view, stays where it was. On "keep", the rows of
   * papers drawn before and unchanged are kept (their rendered formulas,
   * their cards).
   */
  private render(
    scroll: "top" | "focus" | "keep",
    anchor?: RowInView | null,
  ): void {
    if (this.message) return;
    const doc = this.doc;
    const win = doc.defaultView;
    const started = win?.performance.now() ?? 0;
    const scrollTop = this.list.scrollTop;
    this.observer?.disconnect();
    const drawn =
      scroll === "keep"
        ? { rows: new Map(this.rows), entries: new Map(this.rowEntries) }
        : null;
    this.rows.clear();
    this.rowEntries.clear();
    const context: EntryRenderContext = {
      selectedEntryIDs: new Set(),
      focusedEntryID: this.focusedKey ?? undefined,
      viewMode: "references",
      maxAuthors: Number(getPref("max_authors")) || 3,
      getCitationValue: () => 0,
      hasPdf: (entry) => this.hasPdf(entry as BrowserEntry),
      darkMode: isDarkMode(doc),
    };
    const fragment = doc.createDocumentFragment();
    const blocks = pageBlocks(this.arranged, this.page, this.pageSize);
    for (const block of blocks) {
      if (block.kind === "day") {
        fragment.append(this.dayHeader(block.day, block.continued));
      } else if (block.kind === "group") {
        fragment.append(this.groupHeader(block.group, block.continued));
      } else {
        const key = block.entry.id;
        const meta = this.metaSuffix(block.entry);
        let row = drawn?.rows.get(key);
        if (
          !row ||
          drawn!.entries.get(key) !== block.entry ||
          row.dataset.meta !== meta
        ) {
          row = this.renderer.createRow(block.entry, context);
          row.dataset.meta = meta;
          this.decorate(row, block.entry);
        }
        this.rows.set(key, row);
        this.rowEntries.set(key, block.entry);
        fragment.append(row);
      }
    }
    if (this.page < this.pages - 1) {
      const next = button(doc, getString("arxiv-browser-page-next"), () =>
        this.goToPage(this.page + 1),
      );
      next.classList.add("arxiv-browser__next-page");
      fragment.append(next);
    }
    this.list.replaceChildren(fragment);
    this.renderPager();
    this.renderDayIndex();
    this.observeAbstracts(
      win
        ? {
            time: notePaint(win, this.rows.size, this.pageSize, started),
            started,
          }
        : undefined,
    );

    if (scroll === "keep") {
      const row = anchor && this.rows.get(anchor.key);
      this.list.scrollTop = row
        ? this.list.scrollTop +
          row.getBoundingClientRect().top -
          this.list.getBoundingClientRect().top -
          anchor.offset
        : scrollTop;
    } else if (scroll === "focus" && this.focusedKey) {
      this.rows.get(this.focusedKey)?.scrollIntoView({ block: "nearest" });
    } else {
      this.list.scrollTop = 0;
    }
  }

  /**
   * The paper row the reader is at, with its distance from the list's top
   * edge: the focused paper's when it is in view, else the first in view;
   * null when no row is in view
   */
  private rowInView(): RowInView | null {
    const view = this.list.getBoundingClientRect();
    const focused = this.focusedKey ? this.rows.get(this.focusedKey) : null;
    const rect = focused?.getBoundingClientRect();
    if (rect && rect.bottom > view.top && rect.top < view.bottom) {
      return { key: this.focusedKey!, offset: rect.top - view.top };
    }
    for (const [key, row] of this.rows) {
      const { top, bottom } = row.getBoundingClientRect();
      if (bottom > view.top) return { key, offset: top - view.top };
    }
    return null;
  }

  private dayHeader(day: ListDay, continued: boolean): HTMLElement {
    const doc = this.doc;
    const header = html(doc, "div", "arxiv-browser__day");
    header.dataset.date = day.listing.date;
    header.append(
      html(
        doc,
        "span",
        "arxiv-browser__day-title",
        formatDay(day.listing.date),
      ),
    );
    const count =
      day.count < day.inSections
        ? getString("arxiv-browser-day-filtered", {
            args: { shown: day.count, count: day.inSections },
          })
        : getString("arxiv-browser-day-count", { args: { count: day.count } });
    header.append(html(doc, "span", "arxiv-browser__day-count", count));
    if (continued) {
      header.append(
        html(
          doc,
          "span",
          "arxiv-browser__continued",
          getString("arxiv-browser-continued"),
        ),
      );
    }

    const notes: string[] = [];
    let retry = false;
    const loading: string[] = [];
    for (const { spec, state } of day.listing.specs) {
      if (state.state === "loading") {
        loading.push(spec);
      } else if (state.state === "failed") {
        retry = true;
        notes.push(
          getString("arxiv-browser-day-spec-failed", {
            args: { spec, reason: reasonText(state.reason) },
          }),
        );
      } else if (state.state === "stale") {
        retry = true;
        notes.push(
          getString("arxiv-browser-day-spec-stale", {
            args: { spec, date: formatDay(state.shownDate) },
          }),
        );
      } else if (state.fetchFailed) {
        notes.push(
          getString("arxiv-browser-day-spec-cached", {
            args: { spec, reason: reasonText(state.fetchFailed.reason) },
          }),
        );
      }
    }
    if (loading.length) {
      // More papers are coming: no "none" or "not complete" yet
      notes.unshift(
        getString("arxiv-browser-day-loading", {
          args: { specs: loading.join(", ") },
        }),
      );
    } else if (day.count === 0) {
      notes.unshift(
        getString(
          day.listing.status === "failed"
            ? "arxiv-browser-day-failed"
            : // Pages not fetched may hold papers: no "none" then
              !day.pagesFetched
              ? "arxiv-browser-day-incomplete"
              : day.inSections > 0
                ? "arxiv-browser-day-no-match"
                : day.listing.entries.length === 0
                  ? "arxiv-browser-day-empty"
                  : day.onChosenPages === 0
                    ? "arxiv-browser-day-none-chosen"
                    : "arxiv-browser-day-none-shown",
        ),
      );
    } else if (day.listing.status !== "complete") {
      notes.unshift(getString("arxiv-browser-day-incomplete"));
    }
    if (notes.length || retry) {
      const box = html(doc, "div", "arxiv-browser__day-notes");
      for (const note of notes) box.append(html(doc, "div", undefined, note));
      if (retry) {
        const again = button(doc, getString("arxiv-browser-retry"), () =>
          this.options.onRetryDay(day.listing.date),
        );
        again.classList.add("arxiv-browser__retry");
        again.disabled = !this.retryEnabled;
        box.append(again);
      }
      header.append(box);
    }
    return header;
  }

  private groupHeader(group: ListGroup, continued: boolean): HTMLElement {
    let title: string;
    if (group.kind === "section") {
      title = getString(SECTION_LABELS[group.key as ListingSection]);
    } else {
      const name = arxivCategory(group.key)?.name;
      title = name ? `${group.key} — ${name}` : group.key;
    }
    const header = html(
      this.doc,
      "div",
      "arxiv-browser__group",
      `${title} · ${group.entries.length}`,
    );
    if (continued) {
      header.append(
        html(
          this.doc,
          "span",
          "arxiv-browser__continued",
          getString("arxiv-browser-continued"),
        ),
      );
    }
    return header;
  }

  /** The row's own parts: the abstract's toggle */
  private decorate(row: HTMLDivElement, entry: BrowserEntry): void {
    row.classList.add("arxiv-browser__row");
    // No relating to the item shown and no TeX keys here (the row keeps the
    // References panel's other buttons)
    row.querySelector(".zinspire-ref-entry__link")?.remove();
    row.querySelector(".zinspire-ref-entry__texkey")?.remove();
    // The References panel's hint ("click to see the author's papers") does
    // not hold here: a click on a name does nothing
    row
      .querySelectorAll(".zinspire-ref-entry__author-link")
      .forEach((link) => link.removeAttribute("title"));
    const abstract = row.querySelector(".zinspire-ref-entry__abstract");
    if (!abstract) return;
    const toggle = html(this.doc, "button", "arxiv-browser__abstract-toggle");
    toggle.type = "button";
    abstract.before(toggle);
    this.applyAbstract(row, entry.id);
  }

  private isAbstractShown(key: string): boolean {
    return this.abstractChoice.get(key) ?? this.abstractsShown;
  }

  private applyAbstract(row: HTMLDivElement, key: string): void {
    const toggle = row.querySelector(".arxiv-browser__abstract-toggle");
    if (!toggle) return;
    const shown = this.isAbstractShown(key);
    row.classList.toggle("arxiv-browser__row--collapsed", !shown);
    toggle.textContent = getString(
      shown ? "arxiv-browser-abstract-hide" : "arxiv-browser-abstract-show",
    );
    toggle.setAttribute("aria-expanded", String(shown));
  }

  private toggleAbstract(key: string): void {
    const row = this.rows.get(key);
    if (!row?.querySelector(".arxiv-browser__abstract-toggle")) return;
    this.abstractChoice.set(key, !this.isAbstractShown(key));
    this.applyAbstract(row, key);
    this.observeAbstracts();
    if (this.isAbstractShown(key)) this.options.onTitleLeave?.();
  }

  /** Render the formulas of shown abstracts once they come into view */
  /**
   * `timing`: the page was just drawn; the formulas of the abstracts first in
   * view complete its record (none when the page shows no abstract)
   */
  private observeAbstracts(timing?: {
    time: PaintTime;
    started: number;
  }): void {
    const Observer = this.doc.defaultView?.IntersectionObserver;
    if (!Observer) return;
    this.observer?.disconnect();
    let pending = timing;
    this.observer = new Observer(
      (records) => {
        const renders: Promise<void>[] = [];
        for (const record of records) {
          if (!record.isIntersecting) continue;
          const element = record.target as HTMLElement;
          this.observer?.unobserve(element);
          if (element.dataset.formulas) continue;
          element.dataset.formulas = "rendered";
          renders.push(
            renderMathContent(element.dataset.latexSource ?? "", element),
          );
        }
        // The first abstracts in view of a newly drawn page: time them
        const first = pending;
        pending = undefined;
        const win = this.doc.defaultView;
        if (first && win && renders.length) {
          void Promise.all(renders).then(() =>
            noteFormulas(win, first.time, first.started, renders.length),
          );
        }
      },
      { root: this.list, rootMargin: "200px 0px" },
    );
    for (const [key, row] of this.rows) {
      if (!this.isAbstractShown(key)) continue;
      const abstract = row.querySelector<HTMLElement>(
        ".zinspire-ref-entry__abstract",
      );
      if (abstract && !abstract.dataset.formulas)
        this.observer.observe(abstract);
    }
  }

  /** Category, section (when not grouped by it) and version on the row */
  private metaSuffix(entry: BrowserEntry): string {
    const { listing } = entry;
    const parts = [listing.primaryCategory];
    if (this.sort !== "announcement") {
      // Where the list stands it (the chosen pages' section, if any chosen)
      const section = this.arranged.sectionOf.get(entry) ?? listing.section;
      const tag = SECTION_TAGS[section];
      if (tag) parts.push(getString(tag));
    }
    if (listing.version && listing.version > 1)
      parts.push(`v${listing.version}`);
    return ` · ${parts.join(" · ")}`;
  }

  private renderPager(): void {
    const doc = this.doc;
    const pages = this.pages;
    this.pager.replaceChildren();
    const previous = button(doc, getString("arxiv-browser-page-previous"), () =>
      this.goToPage(this.page - 1),
    );
    previous.disabled = this.page === 0;
    this.pager.append(previous);
    // First, last, and the pages around this one
    let gap = false;
    for (let page = 0; page < pages; page++) {
      const near = Math.abs(page - this.page) <= 2;
      if (page === 0 || page === pages - 1 || near) {
        const number = button(doc, String(page + 1), () => this.goToPage(page));
        number.classList.add("arxiv-browser__page");
        if (page === this.page) {
          number.classList.add("arxiv-browser__page--current");
          number.setAttribute("aria-current", "page");
        }
        this.pager.append(number);
        gap = false;
      } else if (!gap) {
        this.pager.append(html(doc, "span", "arxiv-browser__gap", "…"));
        gap = true;
      }
    }
    const next = button(doc, getString("arxiv-browser-page-next"), () =>
      this.goToPage(this.page + 1),
    );
    next.disabled = this.page >= pages - 1;
    this.pager.append(
      next,
      html(
        doc,
        "span",
        "arxiv-browser__pager-count",
        getString("arxiv-browser-papers", {
          args: { count: this.arranged.entries.length },
        }),
      ),
    );
  }

  private renderDayIndex(): void {
    const doc = this.doc;
    this.dayIndex.replaceChildren();
    for (const day of this.arranged.days) {
      const date = day.listing.date;
      const chip = button(
        doc,
        `${formatShortDay(date)} · ${day.count}`,
        () => this.goToDay(date),
        "arxiv-browser__day-chip",
      );
      chip.title = formatDay(date);
      if (day.listing.specs.some(({ state }) => state.state === "loading")) {
        chip.textContent = `${chip.textContent} …`;
      } else if (day.listing.status !== "complete") {
        chip.classList.add("arxiv-browser__day-chip--incomplete");
        chip.textContent = `${chip.textContent} ⚠`;
      }
      if (pageOfDay(this.arranged, date, this.pageSize) === this.page) {
        chip.classList.add("arxiv-browser__day-chip--here");
      }
      this.dayIndex.append(chip);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Focus and clicks
  // ───────────────────────────────────────────────────────────────────────────

  private setFocus(key: string | null, scroll: boolean): void {
    if (this.focusedKey === key) {
      if (scroll && key) {
        this.rows.get(key)?.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    const before = this.focusedKey ? this.rows.get(this.focusedKey) : null;
    if (before) this.renderer.updateFocusState(before, false);
    this.focusedKey = key;
    const row = key ? this.rows.get(key) : null;
    if (row) {
      this.renderer.updateFocusState(row, true);
      if (scroll) row.scrollIntoView({ block: "nearest" });
    }
    this.options.onFocus?.(this.focused);
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const row = target?.closest<HTMLDivElement>(".zinspire-ref-entry");
    const key = row?.dataset.entryId;
    const entry = key
      ? this.arranged.entries.find((item) => item.id === key)
      : undefined;
    if (!row || !entry || !target) return;
    const { actions } = this.options;
    const id = entry.listing.id;

    if (target.closest(".arxiv-browser__abstract-toggle")) {
      this.toggleAbstract(entry.id);
    } else if (target.closest(".zinspire-ref-entry__title-link")) {
      // The arXiv page opens in the web browser, not in this window
      event.preventDefault();
      actions.openAbstractPage(id);
    } else if (target.closest(".zinspire-ref-entry__bibtex")) {
      event.preventDefault();
      void actions.copyBibtex(id);
    } else if (target.closest(".zinspire-ref-entry__pdf")) {
      event.preventDefault();
      if (this.options.openPdf) this.options.openPdf(entry);
      else actions.openPdf(id);
    } else if (target.closest(".zinspire-ref-entry__author-link")) {
      event.preventDefault();
    } else if (target.closest(".zinspire-ref-entry__dot")) {
      if (entry.localStatusUnknown) this.options.onLibraryRetry?.();
      else if (entry.localItemID) {
        this.options.showInLibrary?.(entry.localItemID);
      }
    } else if (target.closest("a, button, input")) {
      return;
    }
    this.setFocus(entry.id, false);
  };

  /** The paper of the row an element is in */
  entryOf(target: Element | null): BrowserEntry | undefined {
    const key = target?.closest<HTMLElement>(".zinspire-ref-entry")?.dataset
      .entryId;
    return key
      ? this.arranged.entries.find((item) => item.id === key)
      : undefined;
  }

  private readonly onMouseOver = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const entry = this.entryOf(target);
    if (!target || !entry) return;
    const author = target.closest<HTMLElement>(
      ".zinspire-ref-entry__author-link",
    );
    if (author) {
      const index = Number(author.dataset.authorIndex);
      if (index >= 0) this.options.onAuthorHover?.(entry, index, author);
      return;
    }
    if (
      target.closest(".zinspire-ref-entry__title-link") &&
      !this.isAbstractShown(entry.id)
    ) {
      const row = target.closest<HTMLElement>(".zinspire-ref-entry")!;
      this.options.onTitleHover?.(entry, row);
    }
  };

  private readonly onMouseOut = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest(".zinspire-ref-entry__author-link")) {
      this.options.onAuthorLeave?.();
    } else if (target?.closest(".zinspire-ref-entry__title-link")) {
      this.options.onTitleLeave?.();
    }
  };
}
