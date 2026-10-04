// ─────────────────────────────────────────────────────────────────────────────
// The places of the arXiv browser window, for its Back and Forward (as a
// web browser's). A place is what the window shows: a list (days of a
// subscription, or a search) with the reader's place in it, and on the
// right the details of a paper or a paper's HTML page. A new place comes
// with a change of the list, a page opened, a move in the list that closes
// a page, and "‹ Details"; the reader's other actions (moving in the list,
// filtering, sorting) stay in the place.
// Places made without changing the list share its record: the loads of a
// list of days that go on while any of them is shown belong to it, and its
// days are noted when a load has settled them. A page shown in several
// places (the list changed while it stayed) is one page element, with one
// history: each place notes where in it the place began, so that Back and
// Forward within the page keep to the place's own steps.
// ─────────────────────────────────────────────────────────────────────────────

import type { IsoDate } from "../arxivDates";
import type { HtmlPanePaper, PageHistory } from "./HtmlPane";
import type { DaySelection } from "./ListingLoader";
import type { ListPosition } from "./ListPane";

/** Places kept for a window (the oldest go first) */
export const PLACES_KEPT = 50;

/** A list of days of a subscription, shared by the places that show it */
export interface DaysRecord {
  kind: "days";
  subscriptionId: string;
  /** As chosen: a preset, or days picked */
  selection: DaySelection;
  /** The last load of it (the loader's run) */
  run: number;
  /** Its days, once a load settled them (newest first) */
  dates?: readonly IsoDate[];
}

/** A search of arXiv: the text typed */
export interface SearchRecord {
  kind: "search";
  text: string;
}

export type ListRecord = DaysRecord | SearchRecord;

/** The right side of a place */
export type PaneRecord =
  /** The details of the list's focused paper */
  | { kind: "detail" }
  /** The details of a paper the list does not show */
  | { kind: "outside"; id: string }
  /**
   * A paper's HTML page: its address with the reader's place, its element,
   * and where in that element's history the place began
   */
  | {
      kind: "page";
      paper: HtmlPanePaper;
      address: string;
      element: number;
      start: number;
    };

export interface Place {
  list: ListRecord;
  /** The reader's place in the list, noted when the place was left */
  position: ListPosition | null;
  pane: PaneRecord;
}

export class PlaceHistory {
  private readonly places: Place[] = [];
  private index = -1;

  constructor(private readonly kept = PLACES_KEPT) {}

  get current(): Place | null {
    return this.places[this.index] ?? null;
  }

  get previous(): Place | null {
    return this.places[this.index - 1] ?? null;
  }

  get next(): Place | null {
    return this.places[this.index + 1] ?? null;
  }

  /** A new place after the current one: the places after it go */
  push(place: Place): void {
    this.places.splice(this.index + 1);
    this.places.push(place);
    if (this.places.length > this.kept) this.places.shift();
    this.index = this.places.length - 1;
  }

  /** The place before (after) the current one, now the current one */
  back(): Place | null {
    if (this.index <= 0) return null;
    return this.places[--this.index];
  }

  forward(): Place | null {
    if (this.index >= this.places.length - 1) return null;
    return this.places[++this.index];
  }

  /** The places after the current one go (a new step in the page shown) */
  dropForward(): void {
    this.places.splice(this.index + 1);
  }

  /** The current place goes (it cannot be shown again: its subscription) */
  dropCurrent(): void {
    if (this.index < 0) return;
    this.places.splice(this.index, 1);
    this.index = Math.min(this.index, this.places.length - 1);
  }
}

/** Whether Back is a step back within the page shown, in `place`'s steps */
export function pageCanGoBack(
  place: Place | null,
  page: PageHistory | null,
): boolean {
  return (
    place?.pane.kind === "page" &&
    page?.element === place.pane.element &&
    page.index > place.pane.start
  );
}

/**
 * Whether Forward is a step forward within the page shown: up to where the
 * next place began, when that place shows the same page
 */
export function pageCanGoForward(
  place: Place | null,
  next: Place | null,
  page: PageHistory | null,
): boolean {
  if (place?.pane.kind !== "page" || page?.element !== place.pane.element) {
    return false;
  }
  const end =
    next?.pane.kind === "page" && next.pane.element === page.element
      ? next.pane.start
      : page.count - 1;
  return page.index < end;
}

/** Whether two lists of days are the same days */
export function sameDays(
  a: readonly IsoDate[] | undefined,
  b: readonly IsoDate[] | undefined,
): boolean {
  return (
    !!a && !!b && a.length === b.length && a.every((date, i) => date === b[i])
  );
}

/** Whether two choices of days are the same */
export function sameSelection(a: DaySelection, b: DaySelection): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "days" || b.kind !== "days"
    ? true
    : sameDays([...a.dates].sort(), [...b.dates].sort());
}
