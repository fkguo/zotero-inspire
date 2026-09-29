// ─────────────────────────────────────────────────────────────────────────────
// DayPicker: the calendar under the arXiv browser's date button. A preset
// loads at once (the newest day, the last five announcement days, this
// week); days are picked in the month grid — a click picks one, Ctrl/Cmd+
// click adds or removes one, Shift+click picks a range (the References
// panel chart's rules, applyClickSelection) — and loaded with Load, the
// calendar telling how many requests a first load of them takes and how
// long at least. Only listing days arXiv still serves can be picked: Monday
// to Friday, up to the newest scheduled listing, about 90 days back.
//
// A blue dot marks each such day of the subscription not marked read, from
// the subscription's first day on (days never fetched count as announcement
// days by weekday). The preset "Unread days" picks them all; the picked days
// can be marked read or unread, and "Mark all read" marks every dotted day
// without fetching anything.
// ─────────────────────────────────────────────────────────────────────────────

import type { FluentMessageId } from "../../../../typings/i10n";
import { applyClickSelection } from "../../../utils/clickSelection";
import { getString } from "../../../utils/locale";
import {
  addDays,
  earliestCatchupDate,
  isoDateToMs,
  latestScheduledListingDate,
  nextListingWeekday,
  weekdayOf,
  type IsoDate,
} from "../arxivDates";
import type { Clock } from "../arxivFetch";
import { estimateListingRequests } from "../listingService";
import { formatDay, formatShortDay } from "./browserText";
import { button, html } from "./dom";
import { thisWeekDays, type DaySelection } from "./ListingLoader";
import { formatDuration } from "./SubscriptionEditor";

/** The listing days arXiv serves at `nowMs`, oldest first */
export function servedListingDays(nowMs: number): IsoDate[] {
  const days: IsoDate[] = [];
  const last = latestScheduledListingDate(nowMs);
  for (
    let date = nextListingWeekday(earliestCatchupDate(nowMs));
    date <= last;
    date = addDays(date, 1)
  ) {
    const weekday = weekdayOf(date);
    if (weekday !== 0 && weekday !== 6) days.push(date);
  }
  return days;
}

/** The reading marks of the subscription shown */
export interface DayMarks {
  /** Its first day that can be unread; undefined: no such limit */
  since: IsoDate | undefined;
  isRead(date: IsoDate): boolean;
  setRead(dates: readonly IsoDate[], read: boolean): void;
}

/** The days of `days` a blue dot marks: from `since` on, not read */
export function unreadDays(
  days: readonly IsoDate[],
  marks: DayMarks | null,
): IsoDate[] {
  if (!marks) return [];
  return days.filter(
    (date) => (!marks.since || date >= marks.since) && !marks.isRead(date),
  );
}

type Preset = "newest" | "recent" | "week";

const PRESET_LABELS: Record<Preset, FluentMessageId> = {
  newest: "arxiv-browser-days-newest",
  recent: "arxiv-browser-days-recent",
  week: "arxiv-browser-days-week",
};

/** The date button's text for the days chosen */
export function selectionLabel(selection: DaySelection): string {
  if (selection.kind !== "days") {
    return getString(PRESET_LABELS[selection.kind]);
  }
  const dates = [...selection.dates].sort();
  if (dates.length === 1) return formatShortDay(dates[0]);
  return getString("arxiv-browser-days-range", {
    args: {
      first: formatShortDay(dates[0]),
      last: formatShortDay(dates[dates.length - 1]),
      count: dates.length,
    },
  });
}

/** A Monday, for the names of the weekdays */
const A_MONDAY: IsoDate = "2026-09-21";

function locale(): string | undefined {
  return (Zotero as unknown as { locale?: string }).locale || undefined;
}

/** "2026-09" of a date */
const monthOf = (date: IsoDate) => date.slice(0, 7);

export interface DayPickerOptions {
  /** The date button the calendar opens under */
  anchor: HTMLElement;
  /** Where the calendar is placed (next to the button) */
  container: HTMLElement;
  clock: Clock;
  /** Categories and archives of the subscription: the requests per day */
  specCount(): number;
  /** The reading marks of the subscription (null without one) */
  marks(): DayMarks | null;
  /** Load a preset or the days picked */
  onChoose(selection: DaySelection): void;
}

export class DayPicker {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly selected = new Set<IsoDate>();
  private lastClicked: IsoDate | undefined;
  /** Days that can be picked, oldest first */
  private days: IsoDate[] = [];
  private served = new Set<IsoDate>();
  /** The days with a blue dot, oldest first */
  private unread: IsoDate[] = [];
  /** "YYYY-MM" of the month shown */
  private month = "";
  private readonly grid: HTMLElement;
  private readonly title: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly summary: HTMLElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly presetButtons = new Map<Preset, HTMLButtonElement>();
  private readonly unreadButton: HTMLButtonElement;
  private readonly markButton: HTMLButtonElement;
  private readonly markAllButton: HTMLButtonElement;

  constructor(private readonly options: DayPickerOptions) {
    const doc = options.anchor.ownerDocument;
    this.doc = doc;
    this.element = html(doc, "div", "arxiv-browser__daypicker");
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", getString("arxiv-browser-days"));
    this.element.hidden = true;

    const presets = html(doc, "div", "arxiv-browser__daypicker-presets");
    for (const preset of Object.keys(PRESET_LABELS) as Preset[]) {
      const choose = button(doc, getString(PRESET_LABELS[preset]), () =>
        this.choose({ kind: preset }),
      );
      this.presetButtons.set(preset, choose);
      presets.append(choose);
    }
    this.unreadButton = button(
      doc,
      getString("arxiv-browser-days-unread"),
      () => this.choose({ kind: "days", dates: [...this.unread] }),
    );
    presets.append(this.unreadButton);

    const header = html(doc, "div", "arxiv-browser__daypicker-month");
    this.previous = button(doc, "‹", () => this.showMonth(-1));
    this.previous.title = getString("arxiv-browser-days-previous-month");
    this.next = button(doc, "›", () => this.showMonth(1));
    this.next.title = getString("arxiv-browser-days-next-month");
    this.title = html(doc, "span", "arxiv-browser__daypicker-title");
    header.append(this.previous, this.title, this.next);

    this.grid = html(doc, "div", "arxiv-browser__daypicker-grid");
    this.grid.addEventListener("click", this.onDayClick);

    const hint = html(
      doc,
      "div",
      "arxiv-browser__daypicker-note",
      getString("arxiv-browser-days-hint"),
    );
    const marks = html(doc, "div", "arxiv-browser__daypicker-marks");
    this.markButton = button(doc, "", () => this.markPicked());
    this.markAllButton = button(
      doc,
      getString("arxiv-browser-days-mark-all-read"),
      () => this.setRead(this.unread, true),
    );
    marks.append(
      html(
        doc,
        "span",
        "arxiv-browser__daypicker-note",
        getString("arxiv-browser-days-unread-legend"),
      ),
      this.markButton,
      this.markAllButton,
    );
    const footer = html(doc, "div", "arxiv-browser__daypicker-footer");
    this.summary = html(doc, "span", "arxiv-browser__daypicker-summary");
    this.loadButton = button(doc, getString("arxiv-browser-days-load"), () =>
      this.choose({ kind: "days", dates: [...this.selected] }),
    );
    this.loadButton.classList.add("arxiv-browser__button--primary");
    footer.append(
      this.summary,
      button(doc, getString("arxiv-browser-cancel"), () => this.close()),
      this.loadButton,
    );

    this.element.append(presets, header, this.grid, hint, marks, footer);
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
    options.container.append(this.element);
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Show the calendar with the days of `current` picked */
  open(current: DaySelection): void {
    const now = this.options.clock.now();
    this.days = servedListingDays(now);
    this.served = new Set(this.days);
    this.selected.clear();
    this.lastClicked = undefined;
    if (current.kind === "days") {
      for (const date of current.dates) {
        if (this.served.has(date)) this.selected.add(date);
      }
    }
    const newestPicked = [...this.selected].sort().pop();
    this.month = monthOf(newestPicked ?? this.days[this.days.length - 1]);

    // What each preset costs
    const specs = this.options.specCount();
    const estimates: Record<
      Preset,
      ReturnType<typeof estimateListingRequests>
    > = {
      newest: estimateListingRequests("new", specs),
      recent: estimateListingRequests("recent", specs),
      week: estimateListingRequests("catchup", specs, thisWeekDays(now).length),
    };
    for (const [preset, choose] of this.presetButtons) {
      choose.title = this.estimateText(estimates[preset]);
    }

    this.render();
    this.element.hidden = false;
    this.options.anchor.setAttribute("aria-expanded", "true");
    this.doc.addEventListener("mousedown", this.onOutside, true);
    this.presetButtons.get("newest")?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.options.anchor.setAttribute("aria-expanded", "false");
    this.doc.removeEventListener("mousedown", this.onOutside, true);
    this.options.anchor.focus();
  }

  dispose(): void {
    this.close();
    this.element.remove();
  }

  /** Show the reading marks again (they changed, or were read from disk) */
  refreshMarks(): void {
    if (this.isOpen) this.render();
  }

  private setRead(dates: readonly IsoDate[], read: boolean): void {
    if (!dates.length) return;
    this.options.marks()?.setRead(dates, read);
    this.render();
  }

  /** Mark the picked days read, or unread when all of them are read */
  private markPicked(): void {
    const marks = this.options.marks();
    const picked = [...this.selected];
    if (!marks || !picked.length) return;
    this.setRead(picked, !picked.every((date) => marks.isRead(date)));
  }

  private choose(selection: DaySelection): void {
    if (selection.kind === "days" && !selection.dates.length) return;
    this.close();
    this.options.onChoose(selection);
  }

  private showMonth(step: number): void {
    const [year, month] = this.month.split("-").map(Number);
    const shown = new Date(Date.UTC(year, month - 1 + step, 1));
    this.month = shown.toISOString().slice(0, 7);
    this.render();
  }

  private render(): void {
    const doc = this.doc;
    const first = `${this.month}-01` as IsoDate;
    this.title.textContent = new Intl.DateTimeFormat(locale(), {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
    }).format(new Date(isoDateToMs(first)));
    this.previous.disabled = this.month <= monthOf(this.days[0]);
    this.next.disabled = this.month >= monthOf(this.days[this.days.length - 1]);

    const marks = this.options.marks();
    this.unread = unreadDays(this.days, marks);
    const unread = new Set(this.unread);
    this.showUnreadPreset();

    const cells: HTMLElement[] = [];
    const weekdayName = new Intl.DateTimeFormat(locale(), {
      timeZone: "UTC",
      weekday: "narrow",
    });
    for (let i = 0; i < 7; i++) {
      cells.push(
        html(
          doc,
          "span",
          "arxiv-browser__daypicker-weekday",
          weekdayName.format(new Date(isoDateToMs(addDays(A_MONDAY, i)))),
        ),
      );
    }
    // Weeks start on Monday
    for (let i = 0; i < (weekdayOf(first) + 6) % 7; i++) {
      cells.push(html(doc, "span"));
    }
    for (
      let date = first;
      monthOf(date) === this.month;
      date = addDays(date, 1)
    ) {
      const number = String(Number(date.slice(8)));
      if (!this.served.has(date)) {
        cells.push(html(doc, "span", "arxiv-browser__daypicker-off", number));
        continue;
      }
      const day = html(doc, "button", "arxiv-browser__daypicker-day", number);
      day.type = "button";
      day.dataset.date = date;
      if (unread.has(date)) {
        day.classList.add("arxiv-browser__daypicker-day--unread");
        day.setAttribute(
          "aria-label",
          getString("arxiv-browser-days-day-unread", {
            args: { date: formatDay(date) },
          }),
        );
      } else {
        day.setAttribute("aria-label", formatDay(date));
      }
      cells.push(day);
    }
    this.grid.replaceChildren(...cells);
    this.showSelection();
  }

  private showSelection(): void {
    this.grid
      .querySelectorAll<HTMLButtonElement>(".arxiv-browser__daypicker-day")
      .forEach((day) => {
        const picked = this.selected.has(day.dataset.date!);
        day.classList.toggle("arxiv-browser__daypicker-day--picked", picked);
        day.setAttribute("aria-pressed", String(picked));
      });
    const count = this.selected.size;
    this.loadButton.disabled = count === 0;
    const marks = this.options.marks();
    const allRead =
      count > 0 && [...this.selected].every((date) => marks?.isRead(date));
    this.markButton.textContent = getString(
      allRead
        ? "arxiv-browser-days-mark-unread"
        : "arxiv-browser-days-mark-read",
    );
    this.markButton.disabled = count === 0 || !marks;
    if (!count) {
      this.summary.textContent = getString("arxiv-browser-days-none");
      return;
    }
    const estimate = estimateListingRequests(
      "catchup",
      this.options.specCount(),
      count,
    );
    this.summary.textContent = getString("arxiv-browser-days-picked", {
      args: {
        days: count,
        requests: estimate.requests,
        time: formatDuration(estimate.minimumMs),
      },
    });
  }

  /** "Unread days" and "Mark all read": the dotted days, when there are some */
  private showUnreadPreset(): void {
    const count = this.unread.length;
    this.unreadButton.disabled = count === 0;
    this.markAllButton.disabled = count === 0;
    this.unreadButton.title = count
      ? this.estimateText(
          estimateListingRequests("catchup", this.options.specCount(), count),
        )
      : getString("arxiv-browser-days-unread-none");
  }

  private estimateText(estimate: {
    requests: number;
    minimumMs: number;
  }): string {
    return getString("arxiv-browser-days-estimate", {
      args: {
        requests: estimate.requests,
        time: formatDuration(estimate.minimumMs),
      },
    });
  }

  private readonly onDayClick = (event: MouseEvent): void => {
    const day = (event.target as Element | null)?.closest<HTMLElement>(
      ".arxiv-browser__daypicker-day",
    );
    const date = day?.dataset.date;
    if (!date) return;
    applyClickSelection(
      this.selected,
      date,
      this.days,
      this.lastClicked,
      event,
    );
    this.lastClicked = date;
    this.showSelection();
  };

  /** A press outside the calendar and its button closes it */
  private readonly onOutside = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (
      target &&
      !this.element.contains(target) &&
      !this.options.anchor.contains(target)
    ) {
      this.close();
    }
  };
}
