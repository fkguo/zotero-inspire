// ─────────────────────────────────────────────────────────────────────────────
// Dates of arXiv listings: the header dates printed on listing pages, the
// scheduled announcement times (20:00 America/New_York, Sunday to Thursday)
// and the date ranges arXiv serves and the plugin keeps.
//
// A listing date is the UTC date of its announcement: the announcement at
// Thursday 20:00 New York time is listed as Friday. Listing dates are always
// read from the page header; the local clock only tells which scheduled
// announcement has passed and which days lie outside the kept range.
// ─────────────────────────────────────────────────────────────────────────────

/** A calendar date "YYYY-MM-DD" */
export type IsoDate = string;

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Days back from today (UTC) that /catchup accepts (arXiv refuses > 91) */
export const CATCHUP_RANGE_DAYS = 90;

/** Announcement days whose listings the cache keeps */
export const LISTING_RETENTION_DAYS = 100;

/** Index of `name` in `names` by full name or three-letter abbreviation */
function nameIndex(names: string[], name: string): number {
  const lower = name.toLowerCase();
  return names.findIndex(
    (full) => full === lower || (lower.length === 3 && full.startsWith(lower)),
  );
}

/**
 * The date of a listing header, or null when `text` is not one of the forms
 * arXiv prints: "Friday, 25 September 2026" (/new), "Mon, 21 Sep 2026"
 * (/catchup, recent index). The weekday must match the date.
 */
export function parseListingDate(text: string): IsoDate | null {
  const match = text
    .trim()
    .match(/^([A-Za-z]+),\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const [, weekdayName, dayText, monthName, yearText] = match;
  const month = nameIndex(MONTHS, monthName);
  const weekday = nameIndex(WEEKDAYS, weekdayName);
  if (month < 0 || weekday < 0) return null;
  const year = Number(yearText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  if (date.getUTCDay() !== weekday) return null;
  return formatIsoDate(date.getTime());
}

/** "YYYY-MM-DD" of the UTC calendar date of `ms` */
export function formatIsoDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Milliseconds of 00:00 UTC on `date` */
export function isoDateToMs(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return formatIsoDate(isoDateToMs(date) + days * DAY_MS);
}

/** Day of the week of `date`, 0 = Sunday */
export function weekdayOf(date: IsoDate): number {
  return new Date(isoDateToMs(date)).getUTCDay();
}

/** Today's UTC date */
export function utcToday(nowMs: number): IsoDate {
  return formatIsoDate(nowMs);
}

/** Earliest date the /catchup pages accept at `nowMs` */
export function earliestCatchupDate(nowMs: number): IsoDate {
  return addDays(utcToday(nowMs), -CATCHUP_RANGE_DAYS);
}

/** Whether the cache still keeps the listing of `date` at `nowMs` */
export function isWithinRetention(date: IsoDate, nowMs: number): boolean {
  return date >= addDays(utcToday(nowMs), -LISTING_RETENTION_DAYS);
}

/**
 * Listings are dated Monday to Friday (announcements are Sunday to Thursday
 * evening in New York); a Saturday or Sunday moves to the next Monday.
 */
export function nextListingWeekday(date: IsoDate): IsoDate {
  const weekday = weekdayOf(date);
  if (weekday === 6) return addDays(date, 2);
  if (weekday === 0) return addDays(date, 1);
  return date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled announcements (20:00 America/New_York, Sunday to Thursday)
// ─────────────────────────────────────────────────────────────────────────────

const ANNOUNCEMENT_HOUR = 20;

let newYorkFormat: Intl.DateTimeFormat | null = null;

/** Calendar date, weekday and wall-clock time of `ms` in New York */
function newYorkParts(ms: number): {
  date: IsoDate;
  weekday: number;
  hour: number;
  minute: number;
} {
  newYorkFormat ??= new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const part of newYorkFormat.formatToParts(new Date(ms))) {
    parts[part.type] = part.value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: nameIndex(WEEKDAYS, parts.weekday),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** The instant of 20:00 New York time on the New York date `date` */
function announcementInstant(date: IsoDate): number {
  // 20:00 is 00:00 UTC of the next day in summer time (UTC-4) and 01:00 UTC
  // in winter time (UTC-5); daylight saving changes at 02:00, never at 20:00.
  const midnight = isoDateToMs(date);
  for (const offsetHours of [4, 5]) {
    const candidate = midnight + (ANNOUNCEMENT_HOUR + offsetHours) * 3600000;
    const parts = newYorkParts(candidate);
    if (
      parts.date === date &&
      parts.hour === ANNOUNCEMENT_HOUR &&
      parts.minute === 0
    ) {
      return candidate;
    }
  }
  throw new Error(`No 20:00 New York time on ${date}`);
}

/** Whether announcements are scheduled on the New York date `date` */
function isAnnouncementWeekday(date: IsoDate): boolean {
  return weekdayOf(date) <= 4; // Sunday (0) to Thursday (4)
}

/**
 * Whether a scheduled announcement time lies in (fromMs, toMs]: a listing
 * fetched at `fromMs` may have been replaced by `toMs`.
 */
export function scheduledAnnouncementBetween(
  fromMs: number,
  toMs: number,
): boolean {
  if (!(toMs > fromMs)) return false;
  const last = newYorkParts(toMs).date;
  for (
    let date = newYorkParts(fromMs).date;
    date <= last;
    date = addDays(date, 1)
  ) {
    if (!isAnnouncementWeekday(date)) continue;
    const instant = announcementInstant(date);
    if (instant > fromMs && instant <= toMs) return true;
  }
  return false;
}

/**
 * The listing date of the latest scheduled announcement at or before `nowMs`
 * (the date the newest listing carries unless arXiv postponed it).
 */
export function latestScheduledListingDate(nowMs: number): IsoDate {
  let date = newYorkParts(nowMs).date;
  for (let i = 0; i < 8; i++, date = addDays(date, -1)) {
    if (isAnnouncementWeekday(date) && announcementInstant(date) <= nowMs) {
      return addDays(date, 1);
    }
  }
  throw new Error("No scheduled announcement in the last week");
}
