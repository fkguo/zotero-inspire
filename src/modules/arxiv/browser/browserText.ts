// ─────────────────────────────────────────────────────────────────────────────
// Texts of the arXiv browser that depend on data: announcement days, why a
// listing could not be fetched, and what the arXiv scheduler is doing.
// ─────────────────────────────────────────────────────────────────────────────

import type { FluentMessageId } from "../../../../typings/i10n";
import { getString } from "../../../utils/locale";
import { isoDateToMs, type IsoDate } from "../arxivDates";
import type { ArxivSchedulerStatus } from "../arxivFetch";
import type { ListingFailureReason } from "../listingTypes";

/** Zotero's interface language, for dates */
function locale(): string | undefined {
  return (Zotero as unknown as { locale?: string }).locale || undefined;
}

let dayFormat: Intl.DateTimeFormat | null = null;

/** "Fri, 25 Sep 2026" (en-US) or "2026年9月25日周五" (zh-CN) */
export function formatDay(date: IsoDate): string {
  dayFormat ??= new Intl.DateTimeFormat(locale(), {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return dayFormat.format(new Date(isoDateToMs(date)));
}

let shortDayFormat: Intl.DateTimeFormat | null = null;

/** "Fri 25 Sep" (en-US) or "9月25日周五" (zh-CN), for the day index */
export function formatShortDay(date: IsoDate): string {
  shortDayFormat ??= new Intl.DateTimeFormat(locale(), {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return shortDayFormat.format(new Date(isoDateToMs(date)));
}

let monthFormat: Intl.DateTimeFormat | null = null;
let shortMonthFormat: Intl.DateTimeFormat | null = null;

/** "September 2026" (en-US) or "2026年9月" (zh-CN), of "2026-09" */
export function formatMonth(month: string): string {
  monthFormat ??= new Intl.DateTimeFormat(locale(), {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  return monthFormat.format(new Date(isoDateToMs(`${month}-01`)));
}

/** "Sep 2026" (en-US) or "2026年9月" (zh-CN), for the month index */
export function formatShortMonth(month: string): string {
  shortMonthFormat ??= new Intl.DateTimeFormat(locale(), {
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  });
  return shortMonthFormat.format(new Date(isoDateToMs(`${month}-01`)));
}

const REASONS: Record<ListingFailureReason, FluentMessageId> = {
  cancelled: "arxiv-browser-reason-cancelled",
  timeout: "arxiv-browser-reason-timeout",
  offline: "arxiv-browser-reason-offline",
  network: "arxiv-browser-reason-network",
  unavailable: "arxiv-browser-reason-unavailable",
  forbidden: "arxiv-browser-reason-forbidden",
  stopped: "arxiv-browser-reason-stopped",
  http: "arxiv-browser-reason-http",
  "out-of-range": "arxiv-browser-reason-out-of-range",
  parse: "arxiv-browser-reason-parse",
  check: "arxiv-browser-reason-check",
  "mixed-dates": "arxiv-browser-reason-mixed-dates",
};

/** Why a listing could not be fetched, in words */
export function reasonText(reason: ListingFailureReason): string {
  return getString(REASONS[reason]);
}

/** Wall-clock time of `ms` as HH:MM */
function clockTime(ms: number): string {
  return new Intl.DateTimeFormat(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

/**
 * What the arXiv scheduler is doing, for the status line; null when it has
 * nothing to do
 */
export function schedulerText(
  status: ArxivSchedulerStatus,
  now: number,
): string | null {
  const { state } = status;
  let text: string;
  if (state.kind === "waiting") {
    text = getString("arxiv-browser-status-waiting", {
      args: { seconds: Math.max(1, Math.ceil((state.until - now) / 1000)) },
    });
  } else if (state.kind === "paused") {
    text = getString("arxiv-browser-status-paused", {
      args: { time: clockTime(state.until) },
    });
  } else if (state.kind === "sending") {
    text = getString("arxiv-browser-status-sending");
  } else {
    return null;
  }
  if (status.queued > 0) {
    text += ` ${getString("arxiv-browser-status-queued", {
      args: { count: status.queued },
    })}`;
  }
  return text;
}
