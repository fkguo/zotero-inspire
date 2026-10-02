// ─────────────────────────────────────────────────────────────────────────────
// ArxivBrowserView: the content of the arXiv browser window, built into one
// container element of the window's document: the subscription, the days
// listed (chosen in a calendar) with the loading status, the search of
// arXiv, the list's controls, the list and the detail pane. A search's
// results take the days' place in the list (the same rows and controls,
// under the months of their submission) until the search is cleared. It
// keeps no reference to the main window, so the same view could be placed
// elsewhere.
//
// Keys (outside text fields): j / k or ↓ / ↑ move between papers across page
// boundaries, n / p turn pages, Home / End go to the first / last paper of the
// page, Space shows or hides the abstract, Enter opens the arXiv page,
// Ctrl/Cmd+Shift+C copies the BibTeX, Escape clears the focus, Ctrl/Cmd+W
// closes the window; a adds the focused paper (choosing where), l relates it
// to items chosen in Zotero's Select Items dialog, x selects it for the batch
// import (or unselects it), Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo
// (Zotero's Edit → Undo: relations, not adding).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import type { FluentMessageId } from "../../../../typings/i10n";
import { getString } from "../../../utils/locale";
import { getPref, setPref } from "../../../utils/prefs";
import { arxivSearchQuery, SEARCH_RESULT_LIMIT } from "../arxivApi";
import {
  getArxivApiScheduler,
  getArxivWebScheduler,
  systemClock,
  type ArxivScheduler,
  type ArxivSchedulerStatus,
  type Clock,
} from "../arxivFetch";
import { subscriptionPageSpecs } from "../arxivCategories";
import { ListingService } from "../listingService";
import {
  LISTING_SECTIONS,
  type ArxivListingEntry,
  type DayListing,
  type ListingSection,
} from "../listingTypes";
import {
  abstractPageUrl,
  htmlUrl,
  BrowserActions,
  windowReporter,
  type BrowserActionsOptions,
  type WindowReporter,
} from "./browserActions";
import {
  ARXIV_QUICK_FILTER_CONFIGS,
  arrangeList,
  arrangeResults,
  filterGroups,
  LIST_SORTS,
  passesQuickFilters,
  rowKey,
  toBrowserEntry,
  type BrowserEntry,
  type ListSort,
} from "./browserList";
import { formatShortDay, reasonText, schedulerText } from "./browserText";
import { DayPicker, selectionLabel } from "./DayPicker";
import { button, checkbox, html, showMenu } from "./dom";
import {
  ListingLoader,
  OPENING_SELECTIONS,
  type DaySelection,
  type OpeningSelection,
} from "./ListingLoader";
import { ListPane, type ListPosition, type ListUpdate } from "./ListPane";
import { SearchLoader, type FetchSearchPage } from "./SearchLoader";
import { AuthorPreviewController } from "../../inspire/panel/AuthorPreviewController";
import { HoverPreviewController } from "../../inspire/panel/HoverPreviewController";
import {
  selectedTextIn,
  showAbstractContextMenu,
  type ContextMenuItem,
} from "../../inspire/panel/abstractContextMenu";
import {
  loadedItem,
  writeMarks,
  type LocalPaper,
} from "../../inspire/library/localStatus";
import {
  BatchImportManager,
  type BatchImportManagerOptions,
} from "../../inspire/panel/BatchImportManager";
import { BatchToolbar } from "../../inspire/panel/BatchToolbar";
import { FilterHistoryInput } from "../../inspire/panel/FilterHistoryInput";
import { arxivSearchHistory } from "../../inspire/searchHistory";
import { QuickFiltersControl } from "../../inspire/panel/QuickFiltersControl";
import type { QuickFilterType } from "../../inspire/constants";
import { setQuickFilter } from "../../inspire/filters";
import { arxivBatchImport } from "../batchAdd";
import { LibraryActions, type LibraryActionsOptions } from "./libraryActions";
import { CompletionLine, type CompletionLineOptions } from "./completionLine";
import { selectItemsDialog, type PickRelatedItems } from "./relatedItemsDialog";
import {
  firstAttachmentID,
  firstPdfAttachmentID,
  openAttachment,
  openLocalPdf,
} from "../../inspire/library/localPdf";
import { htmlSnapshotID } from "../arxivHtmlSnapshot";
import { arxivPdfVersion } from "../arxivPdf";
import { countAuthorPapers } from "../../inspire/library/authorCount";
import { DetailPane } from "./DetailPane";
import { HtmlPane, type HtmlPaneOptions } from "./HtmlPane";
import { PaneDivider } from "./PaneDivider";
import {
  firstUnreadDay,
  sharedReadingState,
  type ReadingState,
} from "./readingState";
import { SubscriptionBar } from "./SubscriptionBar";
import { SECTION_LABELS } from "./SubscriptionEditor";
import { openSections, type ArxivSubscription } from "./subscriptions";

/** Papers per page the list offers */
export const PAGE_SIZES = [10, 20, 50, 100, 200, 500];
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 500;
/** Delay of the text filter after the last key */
const FILTER_DELAY_MS = 150;

const SORT_LABELS: Record<ListSort, FluentMessageId> = {
  announcement: "arxiv-browser-sort-announcement",
  "id-asc": "arxiv-browser-sort-id-asc",
  "id-desc": "arxiv-browser-sort-id-desc",
  primary: "arxiv-browser-sort-primary",
};

export interface ArxivBrowserViewOptions {
  /** Asks the user a yes/no question (default: the window's confirm) */
  confirm?: (message: string) => boolean;
  /** Loads the listings (default: the plugin's, through its schedulers) */
  listing?: ListingService;
  /** The arxiv.org scheduler whose waits the status line shows */
  webScheduler?: ArxivScheduler;
  /** The API scheduler whose waits the status line shows while searching */
  apiScheduler?: ArxivScheduler;
  /** Searches arXiv (default: its API, through the plugin's API scheduler) */
  searchArxiv?: FetchSearchPage;
  /** Time for the status line's countdown */
  clock?: Clock;
  /** Opens a page in the system's web browser (default: Zotero.launchURL) */
  launch?: (url: string) => void;
  /** Copies text (default: the plugin's clipboard helper) */
  copy?: (text: string) => Promise<boolean>;
  /** INSPIRE's BibTeX of a paper (default: from INSPIRE, inspireBibtexOf) */
  inspireBibtex?: BrowserActionsOptions["inspireBibtex"];
  /**
   * INSPIRE's recid and authors of a paper (default: from INSPIRE,
   * inspireRecordOf)
   */
  inspireRecord?: BrowserActionsOptions["inspireRecord"];
  /** One version of a paper from the arXiv API (default: from the API) */
  apiVersion?: BrowserActionsOptions["apiVersion"];
  /**
   * The items with each of these arXiv identifiers, the one a click selects
   * first, for the "in library" marks (wired to the library index); null
   * when the library cannot be read
   */
  inLibrary?: (
    ids: readonly string[],
  ) => Promise<ReadonlyMap<string, readonly number[]> | null>;
  /**
   * Follow the library: `listener` is called when items' identifiers change,
   * and the marks of the days listed are looked up again. Returns the
   * function that stops following.
   */
  followLibrary?: (listener: () => void) => () => void;
  /**
   * Follow the library's items: `listener` is called after items are added,
   * changed, moved to the trash or deleted (a PDF attached to a paper, say).
   * Returns the function that stops following.
   */
  followItems?: (listener: () => void) => () => void;
  /** Show an item in the main window's library */
  showInLibrary?: (itemID: number) => void;
  /** The days marked read (default: the plugin's, sharedReadingState) */
  readingState?: ReadingState;
  /**
   * Asks for the items to relate a paper to (default: Zotero's Select Items
   * dialog)
   */
  pickRelated?: PickRelatedItems;
  /** Adds papers (default: the router, addArxivPapers) */
  addPapers?: LibraryActionsOptions["addPapers"];
  /** Asks for a save target (default: the save-target picker) */
  pickTarget?: LibraryActionsOptions["pickTarget"];
  /** Saves an HTML snapshot (default: saveArxivHtmlSnapshot) */
  saveHtmlSnapshot?: LibraryActionsOptions["saveHtmlSnapshot"];
  /** Loads a page in the HTML pane (default: Zotero's loadURI) */
  loadHtmlPage?: HtmlPaneOptions["load"];
  /** The INSPIRE completion entry's library, INSPIRE and dialog */
  completion?: Omit<CompletionLineOptions, "reporter">;
  /** The batch import's callbacks (default: arxivBatchImport) */
  batchImport?: Pick<
    BatchImportManagerOptions,
    "canImport" | "prepareImport" | "importEntry"
  >;
}

/** Page size from the settings, kept within 10–500 */
export function pageSizeSetting(): number {
  const value = Math.round(Number(getPref("arxiv_browser_page_size")));
  if (!Number.isFinite(value)) return 50;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, value));
}

/** The days the window opens with, from the settings */
export function openingSetting(): OpeningSelection {
  const value = getPref("arxiv_browser_open_days");
  return OPENING_SELECTIONS.includes(value as OpeningSelection)
    ? (value as OpeningSelection)
    : "newest";
}

/** What a loaded listing is for: the subscription and its categories */
const loadedFor = (subscription: ArxivSubscription) =>
  `${subscription.id} ${subscription.categories.join(" ")}`;

/** The panes whose text can be selected and copied */
const PANES = ".arxiv-browser__list, .arxiv-browser__detail";

export class ArxivBrowserView {
  readonly doc: Document;
  readonly toolbar: HTMLElement;
  readonly subscriptions: SubscriptionBar;
  readonly listPane: ListPane;
  /** The detail pane of the focused paper */
  readonly detail: DetailPane;
  /**
   * A paper's HTML version in the detail pane's place (none in a window
   * that cannot show pages)
   */
  readonly htmlPane: HtmlPane | null;
  private readonly divider: PaneDivider;
  private readonly authorCard: AuthorPreviewController;
  private readonly paperCard: HoverPreviewController;
  /** Papers of authors in the library, by name, counted once per window */
  private readonly authorCounts = new Map<string, Promise<number>>();
  readonly loader: ListingLoader;
  /** The search of arXiv whose results the list shows instead of the days */
  readonly search: SearchLoader;
  /** The search box, with the search history */
  private readonly searchBox: FilterHistoryInput;
  private readonly searchClear: HTMLButtonElement;
  /** The results the list shows (null: the days) */
  private shownResults: readonly ArxivListingEntry[] | null = null;
  /** The rows of search results, by result */
  private readonly entryOfResult = new WeakMap<
    ArxivListingEntry,
    BrowserEntry
  >();
  /** Where the reader was in the days when the search began */
  private daysPosition: ListPosition | null = null;
  /**
   * Next past the results fetched: the place in the list of the first
   * paper to come, whose page is shown once they arrive
   */
  private wantedIndex: number | null = null;
  /** The days marked read, of every subscription */
  private readonly reading: ReadingState;
  readonly actions: BrowserActions;
  /** Adding papers and relating them */
  readonly library: LibraryActions;
  /** The papers selected and their batch import */
  readonly batch: BatchImportManager;
  /** The References panel's batch toolbar, shown while papers are selected */
  private readonly batchToolbar: BatchToolbar;
  /** The INSPIRE completion entry of the status area */
  private readonly completion: CompletionLine;
  /** The window's notices */
  private readonly reporter: WindowReporter;
  private readonly clock: Clock;
  /** The days listed: a preset or days picked in the calendar */
  private selection: DaySelection;
  private readonly dayButton: HTMLButtonElement;
  readonly dayPicker: DayPicker;
  private readonly reloadButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  /** The order and the sections: the days' only, hidden during a search */
  private readonly dayControls: HTMLElement[];
  private readonly sectionBoxes = new Map<ListingSection, HTMLInputElement>();
  /** The filter box, with the filter history */
  private readonly filterBox: FilterHistoryInput;
  /** The quick filters on (for this window only) */
  private readonly quickFilters = new Set<QuickFilterType>();
  private readonly quickFiltersControl: QuickFiltersControl;
  private subscription: ArxivSubscription | undefined;
  /** The subscription and categories the listing was loaded for */
  private loadedFor: string | null = null;
  private sort: ListSort = "announcement";
  private filterText = "";
  /** Categories chosen with the subscription's chips (none: all) */
  private categories: ReadonlySet<string> = new Set();
  private filterTimer: number | undefined;
  private schedulerStatus: ArxivSchedulerStatus | null = null;
  private apiStatus: ArxivSchedulerStatus | null = null;
  private countdown: number | undefined;
  private readonly stopFollowing: () => void;
  private readonly stopFollowingApi: () => void;
  private readonly entriesOfDay = new WeakMap<DayListing, BrowserEntry[]>();
  /** The papers of the listing loaded and of the search, by row key */
  private readonly entryByKey = new Map<string, BrowserEntry>();
  /** Days whose papers were looked up in the library since it last changed */
  private checkedDays = new WeakSet<DayListing>();
  /** Search results looked up in the library since it last changed */
  private checkedResults = new WeakSet<BrowserEntry>();
  /** Counts the library's changes: a lookup older than one is not written */
  private libraryChanges = 0;
  private readonly stopFollowingLibrary: (() => void) | undefined;
  private readonly stopFollowingItems: (() => void) | undefined;
  private disposed = false;

  constructor(
    readonly root: HTMLElement,
    private readonly options: ArxivBrowserViewOptions = {},
  ) {
    const doc = root.ownerDocument;
    this.doc = doc;
    this.clock = options.clock ?? systemClock;
    root.replaceChildren();

    const notices = html(doc, "div", "arxiv-browser__notices");
    this.reporter = windowReporter(notices);
    this.actions = new BrowserActions({
      reporter: this.reporter,
      scheduler: options.webScheduler,
      launch: options.launch,
      copy: options.copy,
      inspireBibtex: options.inspireBibtex,
      inspireRecord: options.inspireRecord,
      apiVersion: options.apiVersion,
      inLibrary: options.inLibrary,
    });
    this.reading = options.readingState ?? sharedReadingState();
    this.loader = new ListingLoader(
      options.listing ?? new ListingService(),
      () => this.onLoaderChange(),
      this.clock,
      (subscription, dates) => {
        this.reading.setRead(subscription.id, dates, true);
        this.dayPicker.refreshMarks();
      },
    );

    // Subscription
    this.toolbar = html(doc, "div", "arxiv-browser__toolbar");
    this.subscriptions = new SubscriptionBar({
      host: root,
      confirm:
        options.confirm ??
        ((message) => doc.defaultView?.confirm(message) ?? false),
      onChange: (subscription) => this.onSubscriptionChange(subscription),
      onCategories: (chosen) => {
        this.categories = chosen;
        this.arrange("focus");
      },
    });

    // Days (the calendar), reload / cancel, status
    const daysBar = html(doc, "div", "arxiv-browser__bar");
    const days = html(doc, "span", "arxiv-browser__day-choice");
    this.selection = { kind: openingSetting() };
    this.dayButton = button(doc, "", () => {
      if (this.dayPicker.isOpen) this.dayPicker.close();
      else this.dayPicker.open(this.selection);
    });
    this.dayButton.classList.add("arxiv-browser__days-button");
    this.dayButton.title = getString("arxiv-browser-days");
    this.dayButton.setAttribute("aria-haspopup", "dialog");
    this.dayButton.setAttribute("aria-expanded", "false");
    days.append(this.dayButton);
    this.dayPicker = new DayPicker({
      anchor: this.dayButton,
      container: days,
      clock: this.clock,
      specCount: () =>
        subscriptionPageSpecs(this.subscription?.categories ?? []).length,
      marks: () => {
        const subscription = this.subscription;
        if (!subscription) return null;
        return {
          since: firstUnreadDay(subscription),
          isRead: (date) => this.reading.isRead(subscription.id, date),
          setRead: (dates, read) =>
            this.reading.setRead(subscription.id, dates, read),
        };
      },
      onChoose: (selection) => {
        this.selection = selection;
        this.showSelection();
        this.load();
      },
    });
    this.showSelection();
    // Searching arXiv: its results take the days' place until cleared
    this.search = new SearchLoader(
      () => this.onSearchChange(),
      options.searchArxiv,
    );
    this.searchBox = new FilterHistoryInput(doc, {
      placeholder: getString("arxiv-browser-search"),
      store: arxivSearchHistory,
      onInput: () => this.showSearchClear(),
      onSubmit: (text) => this.runSearch(text),
    });
    this.searchBox.wrapper.classList.add("arxiv-browser__search");
    this.searchBox.input.title = getString("arxiv-browser-search-tooltip");
    this.searchClear = button(
      doc,
      "×",
      () => this.endSearch(),
      "arxiv-browser__search-clear",
    );
    this.searchClear.title = getString("arxiv-browser-search-clear");
    this.searchClear.hidden = true;
    this.reloadButton = button(doc, getString("arxiv-browser-reload"), () => {
      if (this.search.active) void this.search.refresh(this.listPane.size);
      else void this.loader.refresh();
    });
    this.reloadButton.title = getString("arxiv-browser-reload-tooltip");
    this.cancelButton = button(doc, getString("arxiv-browser-cancel"), () => {
      if (this.search.active) this.search.cancel();
      else this.loader.cancel();
    });
    this.status = html(doc, "span", "arxiv-browser__status");
    this.status.setAttribute("role", "status");
    this.completion = new CompletionLine(doc, {
      reporter: this.reporter,
      ...options.completion,
    });
    daysBar.append(
      days,
      this.searchBox.wrapper,
      this.searchClear,
      this.reloadButton,
      this.cancelButton,
      this.status,
      this.completion.element,
    );

    // Sort, sections, filter, page size, abstracts
    const listBar = html(doc, "div", "arxiv-browser__bar");
    const sortSelect = html(doc, "select", "arxiv-browser__select");
    for (const sort of LIST_SORTS) {
      const option = html(
        doc,
        "option",
        undefined,
        getString(SORT_LABELS[sort]),
      );
      option.value = sort;
      sortSelect.append(option);
    }
    sortSelect.addEventListener("change", () => {
      this.sort = sortSelect.value as ListSort;
      this.arrange("focus");
    });
    const sections = html(doc, "span", "arxiv-browser__sections");
    for (const section of LISTING_SECTIONS) {
      const box = checkbox(
        doc,
        getString(SECTION_LABELS[section]),
        true,
        (checked) => this.setSection(section, checked),
      );
      this.sectionBoxes.set(section, box.input);
      sections.append(box.label);
    }
    // The References panel's quick filters and filter box
    this.quickFiltersControl = new QuickFiltersControl(root, {
      configs: ARXIV_QUICK_FILTER_CONFIGS,
      active: () => this.quickFilters,
      onToggle: (type, enabled) => {
        if (setQuickFilter(this.quickFilters, type, enabled)) {
          this.arrange("focus");
        }
      },
    });
    this.filterBox = new FilterHistoryInput(doc, {
      placeholder: getString("arxiv-browser-filter"),
      onInput: () => this.onFilterInput(),
    });
    this.filterBox.wrapper.classList.add("arxiv-browser__filter");
    const pageSize = html(doc, "select", "arxiv-browser__select");
    const size = pageSizeSetting();
    for (const value of [...new Set([...PAGE_SIZES, size])].sort(
      (a, b) => a - b,
    )) {
      const option = html(doc, "option", undefined, String(value));
      option.value = String(value);
      pageSize.append(option);
    }
    pageSize.value = String(size);
    pageSize.addEventListener("change", () => {
      const value = Number(pageSize.value);
      setPref("arxiv_browser_page_size", value);
      this.listPane.setPageSize(value);
    });
    const abstracts = checkbox(
      doc,
      getString("arxiv-browser-abstracts"),
      getPref("arxiv_browser_abstracts_expanded") === true,
      (checked) => this.listPane.setAbstractsShown(checked),
    );
    this.dayControls = [
      this.labelled("arxiv-browser-sort", sortSelect),
      sections,
    ];
    listBar.append(
      ...this.dayControls,
      this.quickFiltersControl.element,
      this.filterBox.wrapper,
      this.labelled("arxiv-browser-page-size", pageSize),
      abstracts.label,
    );

    this.toolbar.append(this.subscriptions.element, daysBar, listBar);

    // List and detail, with a divider that sets their widths
    const main = html(doc, "div", "arxiv-browser__main");
    const listContainer = html(doc, "div", "arxiv-browser__list-pane");
    listContainer.append(html(doc, "div", "arxiv-browser__list"));
    const detailContainer = html(doc, "div", "arxiv-browser__detail");
    // Takes the focus on a click, for Ctrl/Cmd+A
    detailContainer.tabIndex = -1;
    this.divider = new PaneDivider(
      main,
      listContainer,
      html(doc, "div", "arxiv-browser__divider"),
    );
    const htmlContainer = html(doc, "div", "arxiv-browser__html-pane");
    htmlContainer.hidden = true;
    main.append(
      listContainer,
      this.divider.element,
      detailContainer,
      htmlContainer,
    );
    root.append(this.toolbar, main, notices);
    this.htmlPane = HtmlPane.available(doc)
      ? new HtmlPane({
          container: htmlContainer,
          openInWebBrowser: (url) => this.actions.openLink(url),
          copyText: (text) => void this.actions.copyText(text),
          onToggle: (shown) => {
            detailContainer.hidden = shown;
            this.divider.use(shown ? "html" : "detail");
          },
          load: options.loadHtmlPage,
        })
      : null;

    // Cards: the author's card (INSPIRE's when the paper's record names the
    // author, else the local one), and the paper's card on its title when the
    // row does not show the abstract
    const showInLibrary = options.showInLibrary ?? showInMainWindow;
    this.authorCard = new AuthorPreviewController({
      document: doc,
      container: root,
      countInLibrary: ({ fullName }) => {
        let count = this.authorCounts.get(fullName);
        if (!count) {
          count = countAuthorPapers(fullName);
          this.authorCounts.set(fullName, count);
        }
        return count;
      },
    });
    this.paperCard = new HoverPreviewController({
      document: doc,
      container: root,
      callbacks: {
        onCopyBibtex: async (entry) => {
          const listing = (entry as BrowserEntry).listing;
          if (listing) {
            await this.actions.copyBibtex(listing);
          }
        },
        onSelectInLibrary: (entry) => {
          if (entry.localItemID) showInLibrary(entry.localItemID);
        },
      },
      entryOptions: {
        canAdd: () => false,
        canCopyBibtex: () => true,
        canCopyTexkey: () => false,
      },
    });
    // A paper's PDF: the first PDF among its items in the library (the rows'
    // green button), otherwise arXiv's, in the web browser. The detail pane
    // gives the version it shows: a PDF whose address names that version;
    // for the newest also one whose address names no version (a journal's,
    // an unversioned arXiv address), never one of another version; else
    // arXiv's of that version.
    const itemWithPdf = (entry: BrowserEntry) =>
      (entry.localItemIDs ?? []).find(
        (itemID) => firstPdfAttachmentID(itemID) !== null,
      );
    const hasPdf = (entry: BrowserEntry) => itemWithPdf(entry) !== undefined;
    const openPdf = (entry: BrowserEntry, version?: number) => {
      if (version !== undefined) {
        const newest = version === entry.listing.version;
        const ofVersion = (attachment: Zotero.Item) =>
          arxivPdfVersion(attachment, entry.listing.id) === version;
        const unknown = (attachment: Zotero.Item) =>
          !!attachment.isPDFAttachment?.() &&
          arxivPdfVersion(attachment, entry.listing.id) === null;
        for (const matches of newest ? [ofVersion, unknown] : [ofVersion]) {
          for (const itemID of entry.localItemIDs ?? []) {
            const attachmentID = firstAttachmentID(itemID, matches);
            if (attachmentID !== null) {
              void openAttachment(attachmentID);
              return;
            }
          }
        }
        // arXiv's newest version without a version number
        this.actions.openPdf(entry.listing.id, newest ? undefined : version);
        return;
      }
      const itemID = itemWithPdf(entry);
      if (itemID !== undefined) void openLocalPdf(itemID);
      else this.actions.openPdf(entry.listing.id);
    };
    // A paper's HTML version: a snapshot of it saved among its items (opened
    // in Zotero's reader), otherwise arXiv's, in this window beside the list
    // (the menu also offers the web browser). The detail pane gives the
    // version it shows: a snapshot of that version; the rows none: any
    // snapshot. arXiv's newest version without a version number.
    const htmlSnapshot = (entry: BrowserEntry, version?: number) => {
      for (const itemID of entry.localItemIDs ?? []) {
        const attachmentID = htmlSnapshotID(itemID, entry.listing.id, version);
        if (attachmentID !== null) return attachmentID;
      }
      return null;
    };
    const openHtmlOnArxiv = (entry: BrowserEntry, version?: number) =>
      this.actions.openHtml(
        entry.listing.id,
        version === entry.listing.version ? undefined : version,
      );
    const showHtmlHere = (entry: BrowserEntry, version?: number) => {
      const { id } = entry.listing;
      if (!this.htmlPane) {
        openHtmlOnArxiv(entry, version);
        return;
      }
      // An older version chosen in the detail pane: that version's page,
      // named with its number, and its title once the pane has it.
      // Otherwise arXiv's newest (which may be newer than the listing's):
      // no number
      const older = version === entry.listing.version ? undefined : version;
      this.htmlPane.show({
        id,
        version: older,
        title:
          older === undefined
            ? entry.listing.title
            : this.detail.entry === entry
              ? this.detail.olderTitle(older)
              : undefined,
        url: htmlUrl(id, older),
      });
    };
    const htmlActions = {
      saved: (entry: BrowserEntry, version?: number) =>
        htmlSnapshot(entry, version) !== null,
      open: (entry: BrowserEntry, version?: number) => {
        const attachmentID = htmlSnapshot(entry, version);
        if (attachmentID === null) showHtmlHere(entry, version);
        else void openAttachment(attachmentID);
      },
      menu: (entry: BrowserEntry, anchor: HTMLElement, version?: number) => {
        const attachmentID = htmlSnapshot(entry, version);
        showMenu(anchor, [
          ...(this.htmlPane
            ? [
                {
                  label: getString("arxiv-browser-html-menu-here"),
                  run: () => showHtmlHere(entry, version),
                },
              ]
            : []),
          {
            label: getString("arxiv-browser-html-menu-browser"),
            run: () => openHtmlOnArxiv(entry, version),
          },
          {
            label: getString("arxiv-browser-html-menu-save"),
            run: () =>
              void this.library.saveHtmlSnapshot(
                entry,
                anchor,
                version ?? entry.listing.version,
              ),
          },
          ...(attachmentID === null
            ? []
            : [
                {
                  label: getString("arxiv-browser-html-menu-open"),
                  run: () => void openAttachment(attachmentID),
                },
              ]),
        ]);
      },
    };
    this.library = new LibraryActions({
      reporter: this.reporter,
      pickRelated: async (libraryID) => {
        const win = doc.defaultView as unknown as Window | null;
        return win
          ? (options.pickRelated ?? selectItemsDialog)(win, libraryID)
          : [];
      },
      host: root,
      list: () => this.listPane.list,
      onAdded: (entry, item) => this.markAdded(entry.listing.id, item.id),
      onRelationChange: (entry) => {
        this.listPane.refreshLinkStates(this.rowsOfPaper(entry.listing.id));
        if (this.detail.entry?.listing.id === entry.listing.id) {
          this.detail.show(this.detail.entry);
        }
      },
      showInLibrary: (itemIDs) => showItemsInMainWindow(itemIDs),
      addPapers: options.addPapers,
      pickTarget: options.pickTarget,
      saveHtmlSnapshot: options.saveHtmlSnapshot,
    });
    this.batch = new BatchImportManager({
      getDocument: () => doc,
      getBody: () => root,
      getListElement: () => this.listPane.list,
      // Every row loaded: a paper added shows on each of its rows
      getAllEntries: () => [...this.entryByKey.values()],
      // Select all and Shift-click ranges: the papers listed, on every page
      getFilteredEntries: () => [...this.listPane.entries],
      ...(options.batchImport ?? arxivBatchImport()),
      promptForSaveTarget: async (anchor) =>
        (this.library.batchTarget = await this.library.chooseTarget(anchor)),
      reporter: this.reporter,
      summarize: (result) => this.library.reportBatch(result),
      updateRowStatus: (entry) => {
        const row = entry as BrowserEntry;
        this.listPane.refreshLibraryMarks([row]);
        if (this.detail.entry === row) this.detail.show(row);
      },
      onSelectionChange: (count) => this.batchToolbar.update(count),
      onImportStateChange: (inProgress) =>
        this.batchToolbar.setImportInProgress(inProgress),
    });
    this.batchToolbar = new BatchToolbar(doc, this.batch);
    const libraryButtons = {
      add: (
        entry: BrowserEntry,
        how: { anchor: HTMLElement; journalVersion?: boolean },
      ) => void this.library.add(entry, how),
      relate: (entry: BrowserEntry, anchor: HTMLElement) =>
        void this.library.relate(entry, anchor),
    };
    this.detail = new DetailPane({
      container: detailContainer,
      actions: this.actions,
      onAuthorHover: (entry, index, anchor) =>
        this.showAuthorCard(entry, index, anchor),
      onAuthorLeave: () => this.authorCard.scheduleHide(),
      showInLibrary,
      openPdf,
      html: htmlActions,
      library: libraryButtons,
    });
    this.listPane = new ListPane({
      container: listContainer,
      actions: this.actions,
      pageSize: size,
      abstractsShown: abstracts.input.checked,
      onRetryDay: (date) => void this.loader.retryDay(date),
      onFocus: (entry) => this.showDetail(entry),
      showInLibrary,
      onLibraryRetry: () => this.recheckLibrary(),
      hasPdf,
      openPdf,
      html: htmlActions,
      onAuthorHover: (entry, index, anchor) =>
        this.showAuthorCard(entry, index, anchor),
      onAuthorLeave: () => this.authorCard.scheduleHide(),
      onTitleHover: (entry, row) => this.paperCard.scheduleShow(entry, row),
      onTitleLeave: () => this.paperCard.scheduleHide(),
      ticked: this.batch.getSelectedEntryIDs(),
      onTick: (entry, event) => this.batch.handleCheckboxClick(entry, event),
      onAdd: (entry, anchor) => void this.library.add(entry, { anchor }),
      onLink: (entry, anchor) => void this.library.relate(entry, anchor),
      isRelated: (entry) => this.library.isRelated(entry),
      headerTools: this.batchToolbar.element,
      onMore: () => this.fetchMoreResults(),
      relatedTitles: (entry) =>
        this.library
          .relatedItemsOf(entry)
          .map((item) => item.getDisplayTitle() || `#${item.id}`),
    });

    const scheduler = options.webScheduler ?? getArxivWebScheduler();
    this.stopFollowing = scheduler.onStatus((status) => {
      this.schedulerStatus = status;
      this.renderStatus();
    });
    this.stopFollowingApi = (
      options.apiScheduler ?? getArxivApiScheduler()
    ).onStatus((status) => {
      this.apiStatus = status;
      if (this.search.running) this.renderStatus();
    });
    doc.addEventListener("keydown", this.onKeyDown);
    doc.addEventListener("contextmenu", this.onContextMenu);
    this.stopFollowingLibrary = options.followLibrary?.(() =>
      this.recheckLibrary(),
    );
    this.stopFollowingItems = options.followItems?.(() => {
      if (this.disposed) return;
      this.listPane.refreshPdfButtons();
      // Relations may have been changed elsewhere
      this.listPane.refreshLinkStates();
    });

    this.onSubscriptionChange(this.subscriptions.current);

    void this.reading.ready.then(() => {
      if (this.disposed) return;
      // Rare and not to be missed: a dialog rather than a passing notice
      const notice = this.reading.takeFileNotice();
      const win = this.doc.defaultView;
      if (notice && win) {
        Zotero.alert(
          win as unknown as Window,
          config.addonName,
          getString(
            notice.kind === "kept"
              ? "arxiv-browser-reading-file-kept"
              : "arxiv-browser-reading-file-unreadable",
            { args: { path: notice.path } },
          ),
        );
      }
      this.dayPicker.refreshMarks();
    });
  }

  /** The days listed: a preset or days picked in the calendar */
  get days(): DaySelection {
    return this.selection;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.doc.removeEventListener("keydown", this.onKeyDown);
    this.doc.removeEventListener("contextmenu", this.onContextMenu);
    this.batch.dispose();
    this.library.dispose();
    this.completion.dispose();
    this.stopFollowing();
    this.stopFollowingApi();
    this.stopFollowingLibrary?.();
    this.stopFollowingItems?.();
    this.stopCountdown();
    const win = this.doc.defaultView;
    if (this.filterTimer !== undefined) win?.clearTimeout(this.filterTimer);
    this.loader.dispose();
    this.search.dispose();
    this.actions.dispose();
    this.dayPicker.dispose();
    this.listPane.dispose();
    this.subscriptions.dispose();
    this.quickFiltersControl.dispose();
    this.authorCard.dispose();
    this.paperCard.dispose();
    this.divider.dispose();
    this.htmlPane?.dispose();
  }

  /**
   * The card of the paper's author at `index`: the local card (name, papers
   * in the library, searches) until the paper's INSPIRE record, asked once
   * per paper when a card first shows, names the author; then the INSPIRE
   * card as in the References panel
   */
  private showAuthorCard(
    entry: BrowserEntry,
    index: number,
    anchor: Element,
  ): void {
    const fullName = entry.authors[index];
    if (!fullName) return;
    this.authorCard.scheduleLocalAuthor({ fullName }, anchor, async () => {
      const author = await this.actions.inspireAuthor(entry.listing, index);
      // The name as the listing gives it, for the count and the arXiv search
      return author && { ...author, fullName };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Loading
  // ───────────────────────────────────────────────────────────────────────────

  private onSubscriptionChange(
    subscription: ArxivSubscription | undefined,
  ): void {
    this.subscription = subscription;
    // The bar keeps the chips' choice while the subscription stays
    this.categories = this.subscriptions.chosenCategories;
    for (const [section, box] of this.sectionBoxes) {
      box.checked = subscription?.sections[section] ?? true;
    }
    this.enableListControls();
    if (!subscription) {
      this.leaveSearch();
      this.loader.cancel();
      this.loadedFor = null;
      this.showNoSubscription();
      this.renderStatus();
      return;
    }
    // Only the shown sections changed: the loaded listing stays (another
    // subscription loads its own, whose days are marked read for it)
    if (loadedFor(subscription) === this.loadedFor) {
      this.arrange("focus");
      return;
    }
    this.load();
  }

  /** No subscription: the list offers to make one */
  private showNoSubscription(): void {
    this.listPane.showMessage(
      getString("arxiv-browser-empty"),
      button(this.doc, getString("arxiv-browser-subscription-new"), () =>
        this.subscriptions.openEditor(undefined),
      ),
    );
  }

  /** Load the chosen days of the chosen subscription from scratch */
  private load(): void {
    const subscription = this.subscription;
    if (!subscription) return;
    this.leaveSearch();
    this.entryByKey.clear();
    // The selection is of the rows of the listing loaded before
    this.batch.clearSelection();
    this.loadedFor = loadedFor(subscription);
    void this.loader.load(subscription, this.selection);
  }

  /** The date button tells the days chosen */
  private showSelection(): void {
    this.dayButton.textContent = `${selectionLabel(this.selection)} ▾`;
  }

  private onLoaderChange(): void {
    if (this.disposed) return;
    // Days loading behind a search's results wait to be shown
    if (!this.search.active) this.arrange("keep-page");
    this.renderStatus();
    this.listPane.setRetryEnabled(!this.loader.running);
    void this.markLibraryPapers();
  }

  /**
   * The entries of a day, built once. A paper listed before (its day shown
   * again with more categories, or fetched again) keeps its entry, with the
   * new listing: its marks, focus and cards stay.
   */
  private entriesOf = (day: DayListing): BrowserEntry[] => {
    let entries = this.entriesOfDay.get(day);
    if (!entries) {
      entries = day.entries.map((listing) => {
        const known = this.entryByKey.get(
          rowKey(listing.id, listing.announceDate),
        );
        if (known) {
          known.listing = listing;
          return known;
        }
        const entry = toBrowserEntry(listing);
        this.entryByKey.set(entry.id, entry);
        return entry;
      });
      this.entriesOfDay.set(day, entries);
    }
    return entries;
  };

  /**
   * Show the list again: the days, or the results of the search. `position`:
   * the days, where the reader was (back from a search).
   */
  private arrange(update: ListUpdate, position?: ListPosition): void {
    if (this.search.active) {
      this.arrangeResults(update);
      return;
    }
    const subscription = this.subscription;
    if (!subscription) {
      // Back from a search's results
      this.showNoSubscription();
      return;
    }
    if (!this.loader.days.length) {
      this.listPane.showMessage(
        getString(
          this.loader.running
            ? "arxiv-browser-status-loading"
            : "arxiv-browser-nothing-loaded",
        ),
      );
      return;
    }
    const list = arrangeList(this.loader.days, this.entriesOf, {
      sort: this.sort,
      sections: openSections(subscription),
      filter: filterGroups(this.filterText),
      quick: this.quickFilter(),
      specs: subscription.categories,
      categories: this.categories,
    });
    if (position) this.listPane.restore(list, this.sort, position);
    else this.listPane.setList(list, this.sort, update);
    this.showFocused();
  }

  /** The quick filters on, as a test of a paper (none: undefined) */
  private quickFilter(): ((entry: BrowserEntry) => boolean) | undefined {
    return this.quickFilters.size
      ? (entry) => passesQuickFilters(entry, this.quickFilters)
      : undefined;
  }

  /**
   * The detail pane shows `entry`; another paper's HTML version shown in
   * its place goes (one being read stays when the list loses its focus)
   */
  private showDetail(entry: BrowserEntry | null): void {
    this.detail.show(entry);
    const read = this.htmlPane?.paper;
    if (read && entry && read.id !== entry.listing.id) this.htmlPane?.close();
  }

  /** The detail pane follows the focused paper */
  private showFocused(): void {
    const focused = this.listPane.focused;
    if (focused && focused !== this.detail.entry) this.showDetail(focused);
    // More of the day's categories may list the paper shown
    else this.detail.refreshSections();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Searching arXiv
  // ───────────────────────────────────────────────────────────────────────────

  /** Enter in the search box: search, or back to the days when it is empty */
  private runSearch(text: string): void {
    if (!arxivSearchQuery(text)) {
      this.endSearch();
      return;
    }
    if (!this.search.active) this.daysPosition = this.listPane.position;
    // The selection is of the rows shown before
    this.batch.clearSelection();
    this.wantedIndex = null;
    void this.search.search(text, this.listPane.size).then(() => {
      const failure = this.search.failure;
      if (failure?.reason === "query" && !this.disposed) {
        this.reporter.notify(this.searchFailureText());
      }
    });
  }

  /** The clear control: back to the days, where the reader was */
  private endSearch(): void {
    this.searchBox.clear();
    this.showSearchClear();
    this.search.clear();
  }

  /** Leave the search without going back to the reader's place (a load) */
  private leaveSearch(): void {
    this.daysPosition = null;
    if (this.search.active) this.endSearch();
  }

  /** Next past the last page of the results: fetch the page after them */
  private fetchMoreResults(): void {
    this.wantedIndex = this.listPane.entries.length;
    void this.search.more(this.listPane.size);
  }

  private showSearchClear(): void {
    this.searchClear.hidden = !this.search.active && !this.searchBox.value;
  }

  private onSearchChange(): void {
    if (this.disposed) return;
    this.showSearchClear();
    this.enableListControls();
    if (this.search.active) {
      this.arrange("keep-page");
    } else if (this.shownResults) {
      // Back to the days
      this.shownResults = null;
      this.wantedIndex = null;
      this.listPane.setMore("none");
      this.batch.clearSelection();
      const position = this.daysPosition ?? undefined;
      this.daysPosition = null;
      this.arrange("focus", position);
    }
    this.renderStatus();
    void this.markLibraryPapers();
  }

  /** The row of a search result, built once */
  private resultEntry = (listing: ArxivListingEntry): BrowserEntry => {
    let entry = this.entryOfResult.get(listing);
    if (!entry) {
      entry = toBrowserEntry(listing);
      this.entryOfResult.set(listing, entry);
    }
    this.entryByKey.set(entry.id, entry);
    return entry;
  };

  private arrangeResults(update: ListUpdate): void {
    const search = this.search;
    const results = search.entries;
    if (results !== this.shownResults) {
      // Another search, or this one fetched again: from its first paper
      this.shownResults = results;
      this.listPane.clearFocus();
      update = "focus";
    }
    this.listPane.setMore(
      search.canFetchMore ? (search.running ? "loading" : "available") : "none",
    );
    if (!results.length) {
      this.listPane.showMessage(
        search.running
          ? getString("arxiv-browser-search-running")
          : search.failure
            ? this.searchFailureText()
            : getString("arxiv-browser-search-none"),
      );
      return;
    }
    const list = arrangeResults(results.map(this.resultEntry), {
      filter: filterGroups(this.filterText),
      quick: this.quickFilter(),
    });
    this.listPane.setList(list, this.sort, update);
    const wanted = this.wantedIndex;
    if (wanted !== null && !search.running) {
      this.wantedIndex = null;
      if (wanted < list.entries.length) {
        this.listPane.goToPage(Math.floor(wanted / this.listPane.size));
      }
    }
    this.showFocused();
  }

  /** Why the search's last request failed, in words */
  private searchFailureText(): string {
    const failure = this.search.failure;
    if (!failure) return "";
    if (failure.reason === "query") {
      return getString("arxiv-browser-search-refused", {
        args: { message: failure.message },
      });
    }
    if (failure.reason === "cancelled") {
      return getString("arxiv-browser-status-cancelled");
    }
    return getString("arxiv-browser-status-stopped", {
      args: { reason: reasonText(failure.reason) },
    });
  }

  /**
   * The order and sections are the days' (results come newest first and
   * belong to no section): hidden during a search
   */
  private enableListControls(): void {
    const searching = this.search.active;
    for (const control of this.dayControls) control.hidden = searching;
    for (const box of this.sectionBoxes.values()) {
      box.disabled = !this.subscription;
    }
  }

  private setSection(section: ListingSection, shown: boolean): void {
    const subscription = this.subscription;
    if (!subscription) return;
    const sections = { ...subscription.sections, [section]: shown };
    // At least one section stays shown
    if (!LISTING_SECTIONS.some((item) => sections[item])) {
      this.sectionBoxes.get(section)!.checked = true;
      return;
    }
    this.subscriptions.updateCurrent({ sections });
  }

  private onFilterInput(): void {
    const win = this.doc.defaultView;
    if (this.filterTimer !== undefined) win?.clearTimeout(this.filterTimer);
    this.filterTimer = win?.setTimeout(() => {
      this.filterTimer = undefined;
      this.filterText = this.filterBox.value;
      this.arrange("focus");
    }, FILTER_DELAY_MS);
  }

  /**
   * Mark the papers of the days not looked up yet that are in the library:
   * one lookup for all of them, and only the rows whose marks changed redrawn
   */
  private async markLibraryPapers(): Promise<void> {
    const lookup = this.options.inLibrary;
    if (!lookup || this.disposed) return;
    const days = this.loader.days.filter((day) => !this.checkedDays.has(day));
    const results = this.search.entries
      .map(this.resultEntry)
      .filter((entry) => !this.checkedResults.has(entry));
    if (!days.length && !results.length) return;
    for (const day of days) this.checkedDays.add(day);
    for (const entry of results) this.checkedResults.add(entry);
    const entries = [...days.flatMap((day) => this.entriesOf(day)), ...results];
    const changes = this.libraryChanges;
    let found: ReadonlyMap<string, readonly number[]> | null;
    try {
      found = await lookup(entries.map((entry) => entry.listing.id));
    } catch (error) {
      Zotero.debug(
        `[${config.addonName}] arXiv browser library marks: ${error}`,
      );
      return;
    }
    // The library changed meanwhile: the lookup after the change marks them
    if (this.disposed || changes !== this.libraryChanges) return;
    const changed = new Set<BrowserEntry>();
    for (const entry of entries) {
      const items = found?.get(entry.listing.id);
      const marks: LocalPaper =
        found === null
          ? { localStatusUnknown: true }
          : items?.length
            ? {
                localItemID: items[0],
                localItemIDs: [...items],
                localFoundBy: "arxiv",
              }
            : {};
      if (writeMarks(entry, marks)) changed.add(entry);
    }
    if (!changed.size) return;
    this.listPane.refreshLibraryMarks(changed);
    this.redrawWhenLoaded(changed);
    this.rearrangeForMarks();
    // The paper in the detail pane may have been chosen before
    const shown = this.detail.entry;
    if (shown && changed.has(shown)) this.detail.show(shown);
  }

  /**
   * Papers found in a library whose items Zotero has not loaded yet (a group
   * library not shown since Zotero started) show no relations and no PDF of
   * the library: load it and redraw their marks and buttons
   */
  private redrawWhenLoaded(entries: Iterable<BrowserEntry>): void {
    const waiting = new Map<number, BrowserEntry[]>();
    for (const entry of entries) {
      for (const itemID of entry.localItemIDs ?? []) {
        if (loadedItem(itemID)) continue;
        const libraryID = (
          Zotero.Items.getLibraryAndKeyFromID(itemID) || undefined
        )?.libraryID;
        if (libraryID === undefined) continue;
        waiting.set(libraryID, [...(waiting.get(libraryID) ?? []), entry]);
      }
    }
    for (const [libraryID, papers] of waiting) {
      const library = Zotero.Libraries.get(libraryID);
      if (!library) continue;
      void library.waitForDataLoad("item").then(() => {
        if (this.disposed) return;
        this.listPane.refreshLibraryMarks(papers);
      });
    }
  }

  /**
   * The library changed, or a mark asked again: look up every paper loaded
   * again
   */
  private recheckLibrary(): void {
    if (this.disposed) return;
    this.libraryChanges++;
    this.checkedDays = new WeakSet();
    this.checkedResults = new WeakSet();
    void this.markLibraryPapers();
    this.completion.recount();
  }

  /** The rows loaded that show the paper `id` (one per announcement day) */
  private rowsOfPaper(id: string): BrowserEntry[] {
    return [...this.entryByKey.values()].filter(
      (entry) => entry.listing.id === id,
    );
  }

  /**
   * The paper `id` was added as the item `itemID`: its rows show it in the
   * library at once (the library's lookup follows)
   */
  private markAdded(id: string, itemID: number): void {
    const rows = this.rowsOfPaper(id);
    const changed = rows.filter((entry) =>
      writeMarks(entry, {
        localItemID: itemID,
        localItemIDs: [
          itemID,
          ...(entry.localItemIDs ?? []).filter((other) => other !== itemID),
        ],
        localFoundBy: "arxiv",
      }),
    );
    this.listPane.refreshLibraryMarks(changed);
    const shown = this.detail.entry;
    if (shown && rows.includes(shown)) this.detail.show(shown);
    this.rearrangeForMarks();
  }

  /**
   * Papers added or found in the library enter or leave the list when a
   * quick filter on reads those marks
   */
  private rearrangeForMarks(): void {
    if (
      this.quickFilters.has("localItems") ||
      this.quickFilters.has("onlineItems")
    ) {
      this.arrange("keep-page");
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Status line
  // ───────────────────────────────────────────────────────────────────────────

  private renderStatus(): void {
    if (this.disposed) return;
    const doc = this.doc;
    const loader = this.loader;
    const search = this.search;
    const searching = search.active;
    this.cancelButton.hidden = !(searching ? search.running : loader.running);
    this.reloadButton.disabled = searching
      ? search.running
      : loader.running || !this.subscription;
    const parts: Array<string | HTMLElement> = [];

    const scheduler = searching ? this.apiStatus : this.schedulerStatus;
    const waiting = scheduler?.state.kind;
    if (waiting === "waiting" || waiting === "paused") this.startCountdown();
    else this.stopCountdown();

    if (searching) {
      const total = search.total;
      if (search.running) {
        parts.push(
          (scheduler && schedulerText(scheduler, this.clock.now())) ||
            getString("arxiv-browser-search-running"),
        );
      } else if (total !== undefined) {
        parts.push(
          getString("arxiv-browser-search-found", {
            args: { total, fetched: search.entries.length },
          }),
        );
        if (total > SEARCH_RESULT_LIMIT) {
          parts.push(
            getString("arxiv-browser-search-limit", {
              args: { limit: SEARCH_RESULT_LIMIT },
            }),
          );
        }
      }
      if (search.failure && search.entries.length) {
        parts.push(this.searchFailureText());
      }
    } else if (loader.running) {
      parts.push(
        (this.schedulerStatus &&
          schedulerText(this.schedulerStatus, this.clock.now())) ||
          getString("arxiv-browser-status-loading"),
      );
    } else if (this.subscription) {
      const result = loader.result;
      const papers = loader.days.reduce(
        (sum, day) => sum + day.entries.length,
        0,
      );
      if (loader.days.length) {
        parts.push(
          getString("arxiv-browser-status-loaded", {
            args: { days: loader.days.length, papers },
          }),
        );
      }
      const stopped = result?.stopped;
      if (stopped) {
        parts.push(
          stopped.reason === "cancelled"
            ? getString("arxiv-browser-status-cancelled")
            : getString("arxiv-browser-status-stopped", {
                args: { reason: reasonText(stopped.reason) },
              }),
        );
        if (loader.canContinue) {
          parts.push(
            button(doc, getString("arxiv-browser-continue"), () => {
              void loader.continueLoading();
            }),
          );
        }
      }
      if (result?.previousIssue) {
        parts.push(getString("arxiv-browser-status-previous-issue"));
      }
      const holidays = loader.daysWithoutAnnouncement;
      if (holidays.length) {
        parts.push(
          getString("arxiv-browser-status-no-announcement", {
            args: { dates: holidays.map(formatShortDay).join(", ") },
          }),
        );
      }
    }
    this.status.replaceChildren(
      ...parts.flatMap((part, index) =>
        index ? [doc.createTextNode(" "), part] : [part],
      ),
    );
  }

  /** Update the "N seconds" of the status line every second while waiting */
  private startCountdown(): void {
    if (this.countdown !== undefined) return;
    this.countdown = this.doc.defaultView?.setInterval(
      () => this.renderStatus(),
      1000,
    );
  }

  private stopCountdown(): void {
    if (this.countdown === undefined) return;
    this.doc.defaultView?.clearInterval(this.countdown);
    this.countdown = undefined;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Controls and keys
  // ───────────────────────────────────────────────────────────────────────────

  private labelled(key: FluentMessageId, control: HTMLElement): HTMLElement {
    const label = html(
      this.doc,
      "label",
      "arxiv-browser__label",
      getString(key),
    );
    label.append(control);
    return label;
  }

  /**
   * The right-click menu in the list and the detail pane: copying the
   * selection (and, in an abstract, all of it or its TeX), selecting the
   * pane's text, a link's address, and the paper's title, identifier, arXiv
   * page, INSPIRE link and BibTeX
   */
  private readonly onContextMenu = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const pane = target?.closest<HTMLElement>(PANES);
    if (!target || !pane) return;
    event.preventDefault();
    const actions = this.actions;
    const items: Array<ContextMenuItem | "-"> = [
      {
        label: getString("arxiv-browser-menu-select-all"),
        run: () =>
          this.doc.defaultView?.getSelection()?.selectAllChildren(pane),
      },
    ];
    const link = target.closest<HTMLAnchorElement>("a[href^='http']");
    if (link) {
      items.push(
        "-",
        {
          label: getString("arxiv-browser-menu-open-link"),
          run: () => actions.openLink(link.href),
        },
        {
          label: getString("arxiv-browser-menu-copy-link"),
          run: () => void actions.copyText(link.href),
        },
      );
    }
    const inDetail = pane.classList.contains("arxiv-browser__detail");
    const entry = inDetail ? this.detail.entry : this.listPane.entryOf(target);
    if (entry) {
      const id = entry.listing.id;
      // The detail pane's title may be an older version's
      const title = (inDetail && this.detail.title) || entry.listing.title;
      items.push(
        "-",
        {
          label: getString("arxiv-browser-menu-copy-title"),
          run: () => void actions.copyText(title),
        },
        {
          label: getString("arxiv-browser-copy-id"),
          run: () => void actions.copyId(id),
        },
        {
          label: getString("arxiv-browser-menu-copy-abs-link"),
          run: () => void actions.copyText(abstractPageUrl(id)),
        },
        {
          label: getString("menuitem-copy-inspire-link"),
          run: () => void actions.copyInspireLink(id),
        },
        {
          label: getString("arxiv-browser-copy-bibtex"),
          run: () => void actions.copyBibtex(entry.listing),
        },
      );
    }
    // In an abstract (its TeX kept): Copy takes all of it when nothing is
    // selected, and Copy as LaTeX is offered
    const abstract = target.closest<HTMLElement>("[data-latex-source]");
    showAbstractContextMenu(event, abstract ?? pane, {
      document: this.doc,
      notify: (message) => this.reporter.notify(message),
      selectionOnly: !abstract,
      latex: Boolean(abstract),
      items,
    });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const accel = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (
      accel &&
      !event.shiftKey &&
      !event.altKey &&
      key.toLowerCase() === "w"
    ) {
      event.preventDefault();
      this.doc.defaultView?.close();
      return;
    }
    // Keys pressed in a paper's HTML version are the page's
    if (this.htmlPane?.isPage(event.target)) return;
    // Not while the subscription editor or the calendar is open, nor while
    // typing
    if (this.root.querySelector(".arxiv-browser__backdrop")) return;
    if (this.dayPicker.isOpen) {
      // Also when the focus has left the calendar
      if (event.key === "Escape") {
        event.preventDefault();
        this.dayPicker.close();
      }
      return;
    }
    const target = event.target as Element | null;
    const tag = target?.tagName?.toUpperCase() ?? "";
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    const focused = this.listPane.focused;
    if (accel && event.shiftKey && !event.altKey && key.toLowerCase() === "c") {
      if (focused) {
        event.preventDefault();
        void this.actions.copyBibtex(focused.listing);
      }
      return;
    }
    if (accel && !event.shiftKey && !event.altKey) {
      if (key.toLowerCase() === "c") {
        // The selection, each formula once (without KaTeX's hidden copy)
        const text = selectedTextIn(this.doc.defaultView);
        if (text) {
          event.preventDefault();
          void this.actions.copyText(text, false);
        }
        return;
      }
      if (key.toLowerCase() === "a") {
        // The text of the pane that has the focus
        const pane = target?.closest(PANES);
        if (pane) {
          event.preventDefault();
          this.doc.defaultView?.getSelection()?.selectAllChildren(pane);
        }
        return;
      }
    }
    if (accel && !event.altKey && key.toLowerCase() === "z") {
      // Zotero's Edit → Undo / Redo: relations made here, among others
      const history = (Zotero as any).UndoHistory;
      if (history) {
        event.preventDefault();
        void (event.shiftKey ? history.redo() : history.undo());
      }
      return;
    }
    if (accel || event.altKey) return;
    // Space and Enter keep their meaning on buttons and links
    const onControl = /^(BUTTON|A)$/.test(tag);
    const anchor = () =>
      (focused && this.listPane.rowOf(focused)) || this.listPane.list;
    switch (key) {
      case "j":
      case "ArrowDown":
        this.listPane.moveFocus(1);
        break;
      case "k":
      case "ArrowUp":
        this.listPane.moveFocus(-1);
        break;
      case "n":
        this.listPane.goToPage(this.listPane.currentPage + 1);
        break;
      case "p":
        this.listPane.goToPage(this.listPane.currentPage - 1);
        break;
      case "Home":
        this.listPane.focusPageEnd("first");
        break;
      case "End":
        this.listPane.focusPageEnd("last");
        break;
      case " ":
        if (onControl || !focused) return;
        this.listPane.toggleFocusedAbstract();
        break;
      case "Enter":
        if (onControl || !focused) return;
        this.actions.openAbstractPage(focused.listing.id);
        break;
      case "Escape":
        if (!focused) return;
        this.listPane.clearFocus();
        break;
      case "a":
        if (!focused) return;
        void this.library.add(focused, { anchor: anchor() });
        break;
      case "l":
        if (!focused) return;
        void this.library.relate(focused, anchor());
        break;
      case "x":
        if (!focused) return;
        this.batch.setSelected(
          [focused],
          !this.batch.getSelectedEntryIDs().has(focused.id),
        );
        break;
      default:
        return;
    }
    event.preventDefault();
  };
}

/** Select items in the main window's library and bring the window forward */
function showItemsInMainWindow(itemIDs: readonly number[]): void {
  const main = Zotero.getMainWindow();
  if (!main || !itemIDs.length) return;
  void main.ZoteroPane.selectItems([...itemIDs]);
  main.focus();
}

/** Select an item in the main window's library and bring the window forward */
function showInMainWindow(itemID: number): void {
  const main = Zotero.getMainWindow();
  if (!main) return;
  void main.ZoteroPane.selectItem(itemID);
  main.focus();
}
