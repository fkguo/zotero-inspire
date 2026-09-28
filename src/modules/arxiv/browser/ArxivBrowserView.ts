// ─────────────────────────────────────────────────────────────────────────────
// ArxivBrowserView: the content of the arXiv browser window, built into one
// container element of the window's document: the subscription, the days
// listed (chosen in a calendar) with the loading status, the list's
// controls, the list and the detail pane. It keeps no reference to the main
// window, so the same view could be placed elsewhere.
//
// Keys (outside text fields): j / k or ↓ / ↑ move between papers across page
// boundaries, n / p turn pages, Home / End go to the first / last paper of the
// page, Space shows or hides the abstract, Enter opens the arXiv page,
// Ctrl/Cmd+Shift+C copies the BibTeX, Escape clears the focus, Ctrl/Cmd+W
// closes the window.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import type { FluentMessageId } from "../../../../typings/i10n";
import { getString } from "../../../utils/locale";
import { getPref, setPref } from "../../../utils/prefs";
import {
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
  type DayListing,
  type ListingSection,
} from "../listingTypes";
import { BrowserActions, windowReporter } from "./browserActions";
import {
  arrangeList,
  filterGroups,
  LIST_SORTS,
  toBrowserEntry,
  type BrowserEntry,
  type ListSort,
} from "./browserList";
import { formatShortDay, reasonText, schedulerText } from "./browserText";
import { DayPicker, selectionLabel } from "./DayPicker";
import { button, checkbox, html } from "./dom";
import {
  ListingLoader,
  OPENING_SELECTIONS,
  type DaySelection,
  type OpeningSelection,
} from "./ListingLoader";
import { ListPane, type ListUpdate } from "./ListPane";
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
  /** Time for the status line's countdown */
  clock?: Clock;
  /** Opens a page in the system's web browser (default: Zotero.launchURL) */
  launch?: (url: string) => void;
  /** Copies text (default: the plugin's clipboard helper) */
  copy?: (text: string) => Promise<boolean>;
  /**
   * Which of these arXiv identifiers are papers in the library, with their
   * item IDs (the "in library" mark; wired to the library index)
   */
  inLibrary?: (ids: readonly string[]) => Promise<ReadonlyMap<string, number>>;
  /** Show an item in the main window's library */
  showInLibrary?: (itemID: number) => void;
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

export class ArxivBrowserView {
  readonly doc: Document;
  readonly toolbar: HTMLElement;
  readonly subscriptions: SubscriptionBar;
  readonly listPane: ListPane;
  /** The detail pane of the focused paper */
  readonly detail: HTMLElement;
  readonly loader: ListingLoader;
  readonly actions: BrowserActions;
  private readonly clock: Clock;
  /** The days listed: a preset or days picked in the calendar */
  private selection: DaySelection;
  private readonly dayButton: HTMLButtonElement;
  readonly dayPicker: DayPicker;
  private readonly reloadButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly sectionBoxes = new Map<ListingSection, HTMLInputElement>();
  private readonly filterInput: HTMLInputElement;
  private subscription: ArxivSubscription | undefined;
  /** The categories the listing was loaded for */
  private loadedCategories: string | null = null;
  private sort: ListSort = "announcement";
  private filterText = "";
  private filterTimer: number | undefined;
  private schedulerStatus: ArxivSchedulerStatus | null = null;
  private countdown: number | undefined;
  private readonly stopFollowing: () => void;
  private readonly entriesOfDay = new WeakMap<DayListing, BrowserEntry[]>();
  /** Days whose papers were looked up in the library */
  private readonly checkedDays = new WeakSet<DayListing>();
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
    this.actions = new BrowserActions({
      reporter: windowReporter(notices),
      scheduler: options.webScheduler,
      launch: options.launch,
      copy: options.copy,
    });
    this.loader = new ListingLoader(
      options.listing ?? new ListingService(),
      () => this.onLoaderChange(),
      this.clock,
    );

    // Subscription
    this.toolbar = html(doc, "div", "arxiv-browser__toolbar");
    this.subscriptions = new SubscriptionBar({
      host: root,
      confirm:
        options.confirm ??
        ((message) => doc.defaultView?.confirm(message) ?? false),
      onChange: (subscription) => this.onSubscriptionChange(subscription),
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
      onChoose: (selection) => {
        this.selection = selection;
        this.showSelection();
        this.load();
      },
    });
    this.showSelection();
    this.reloadButton = button(doc, getString("arxiv-browser-reload"), () => {
      void this.loader.refresh();
    });
    this.reloadButton.title = getString("arxiv-browser-reload-tooltip");
    this.cancelButton = button(doc, getString("arxiv-browser-cancel"), () =>
      this.loader.cancel(),
    );
    this.status = html(doc, "span", "arxiv-browser__status");
    this.status.setAttribute("role", "status");
    daysBar.append(days, this.reloadButton, this.cancelButton, this.status);

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
    this.filterInput = html(doc, "input", "arxiv-browser__filter");
    this.filterInput.type = "search";
    this.filterInput.placeholder = getString("arxiv-browser-filter");
    this.filterInput.addEventListener("input", () => this.onFilterInput());
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
    listBar.append(
      this.labelled("arxiv-browser-sort", sortSelect),
      sections,
      this.filterInput,
      this.labelled("arxiv-browser-page-size", pageSize),
      abstracts.label,
    );
    this.toolbar.append(this.subscriptions.element, daysBar, listBar);

    // List and detail
    const main = html(doc, "div", "arxiv-browser__main");
    const listContainer = html(doc, "div", "arxiv-browser__list-pane");
    listContainer.append(html(doc, "div", "arxiv-browser__list"));
    this.detail = html(doc, "div", "arxiv-browser__detail");
    this.detail.append(
      html(
        doc,
        "div",
        "arxiv-browser__empty",
        getString("arxiv-browser-detail-empty"),
      ),
    );
    main.append(listContainer, this.detail);
    root.append(this.toolbar, main, notices);
    this.listPane = new ListPane({
      container: listContainer,
      actions: this.actions,
      pageSize: size,
      abstractsShown: abstracts.input.checked,
      onRetryDay: (date) => void this.loader.retryDay(date),
      showInLibrary: options.showInLibrary ?? showInMainWindow,
    });

    const scheduler = options.webScheduler ?? getArxivWebScheduler();
    this.stopFollowing = scheduler.onStatus((status) => {
      this.schedulerStatus = status;
      this.renderStatus();
    });
    doc.addEventListener("keydown", this.onKeyDown);

    this.onSubscriptionChange(this.subscriptions.current);
  }

  /** The days listed: a preset or days picked in the calendar */
  get days(): DaySelection {
    return this.selection;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.doc.removeEventListener("keydown", this.onKeyDown);
    this.stopFollowing();
    this.stopCountdown();
    const win = this.doc.defaultView;
    if (this.filterTimer !== undefined) win?.clearTimeout(this.filterTimer);
    this.loader.dispose();
    this.actions.dispose();
    this.dayPicker.dispose();
    this.listPane.dispose();
    this.subscriptions.dispose();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Loading
  // ───────────────────────────────────────────────────────────────────────────

  private onSubscriptionChange(
    subscription: ArxivSubscription | undefined,
  ): void {
    this.subscription = subscription;
    for (const [section, box] of this.sectionBoxes) {
      box.checked = subscription?.sections[section] ?? true;
      box.disabled = !subscription;
    }
    if (!subscription) {
      this.loader.cancel();
      this.loadedCategories = null;
      this.listPane.showMessage(
        getString("arxiv-browser-empty"),
        button(this.doc, getString("arxiv-browser-subscription-new"), () =>
          this.subscriptions.openEditor(undefined),
        ),
      );
      this.renderStatus();
      return;
    }
    // Only the shown sections changed: the loaded listing stays
    const categories = subscription.categories.join(" ");
    if (categories === this.loadedCategories) {
      this.arrange("focus");
      return;
    }
    this.load();
  }

  /** Load the chosen days of the chosen subscription from scratch */
  private load(): void {
    const subscription = this.subscription;
    if (!subscription) return;
    this.loadedCategories = subscription.categories.join(" ");
    void this.loader.load(subscription, this.selection);
  }

  /** The date button tells the days chosen */
  private showSelection(): void {
    this.dayButton.textContent = `${selectionLabel(this.selection)} ▾`;
  }

  private onLoaderChange(): void {
    if (this.disposed) return;
    this.arrange("keep-page");
    this.renderStatus();
    this.listPane.setRetryEnabled(!this.loader.running);
    void this.markLibraryPapers();
  }

  /** The entries of a day, built once */
  private entriesOf = (day: DayListing): BrowserEntry[] => {
    let entries = this.entriesOfDay.get(day);
    if (!entries) {
      entries = day.entries.map(toBrowserEntry);
      this.entriesOfDay.set(day, entries);
    }
    return entries;
  };

  private arrange(update: ListUpdate): void {
    const subscription = this.subscription;
    if (!subscription) return;
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
      specs: subscription.categories,
    });
    this.listPane.setList(list, this.sort, update);
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
      this.filterText = this.filterInput.value;
      this.arrange("focus");
    }, FILTER_DELAY_MS);
  }

  /** Mark the papers of newly loaded days that are in the library */
  private async markLibraryPapers(): Promise<void> {
    const lookup = this.options.inLibrary;
    if (!lookup) return;
    for (const day of this.loader.days) {
      if (this.checkedDays.has(day)) continue;
      this.checkedDays.add(day);
      const entries = this.entriesOf(day);
      try {
        const found = await lookup(entries.map((entry) => entry.listing.id));
        let changed = false;
        for (const entry of entries) {
          const itemID = found.get(entry.listing.id);
          if (itemID && entry.localItemID !== itemID) {
            entry.localItemID = itemID;
            changed = true;
          }
        }
        if (changed && !this.disposed) this.listPane.refreshLibraryMarks();
      } catch (error) {
        Zotero.debug(
          `[${config.addonName}] arXiv browser library marks: ${error}`,
        );
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Status line
  // ───────────────────────────────────────────────────────────────────────────

  private renderStatus(): void {
    if (this.disposed) return;
    const doc = this.doc;
    const loader = this.loader;
    this.cancelButton.hidden = !loader.running;
    this.reloadButton.disabled = loader.running || !this.subscription;
    const parts: Array<string | HTMLElement> = [];

    const waiting = this.schedulerStatus?.state.kind;
    if (waiting === "waiting" || waiting === "paused") this.startCountdown();
    else this.stopCountdown();

    if (loader.running) {
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
        void this.actions.copyBibtex(focused.listing.id);
      }
      return;
    }
    if (accel || event.altKey) return;
    // Space and Enter keep their meaning on buttons and links
    const onControl = /^(BUTTON|A)$/.test(tag);
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
      default:
        return;
    }
    event.preventDefault();
  };
}

/** Select an item in the main window's library and bring the window forward */
function showInMainWindow(itemID: number): void {
  const main = Zotero.getMainWindow();
  if (!main) return;
  void main.ZoteroPane.selectItem(itemID);
  main.focus();
}
