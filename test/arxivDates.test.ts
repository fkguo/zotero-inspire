import { describe, expect, it } from "vitest";
import {
  addDays,
  earliestCatchupDate,
  isWithinRetention,
  latestScheduledListingDate,
  nextListingWeekday,
  parseListingDate,
  scheduledAnnouncementBetween,
} from "../src/modules/arxiv/arxivDates";

const at = (iso: string) => Date.parse(iso);

describe("parseListingDate", () => {
  it("reads the three header forms", () => {
    expect(parseListingDate("Friday, 25 September 2026")).toBe("2026-09-25");
    expect(parseListingDate("Mon, 21 Sep 2026")).toBe("2026-09-21");
    expect(parseListingDate("Tue, 08 Sep 2026")).toBe("2026-09-08");
    expect(parseListingDate("  Fri, 25 Sep 2026 ")).toBe("2026-09-25");
  });

  it("rejects wrong weekdays, impossible dates and other forms", () => {
    expect(parseListingDate("Thursday, 25 September 2026")).toBeNull();
    expect(parseListingDate("Thu, 31 Sep 2026")).toBeNull();
    expect(parseListingDate("25 September 2026")).toBeNull();
    expect(parseListingDate("Frid, 25 Sep 2026")).toBeNull();
    expect(parseListingDate("Fri, 25 Sept 2026")).toBeNull();
    expect(parseListingDate("")).toBeNull();
  });
});

describe("scheduled announcements (20:00 New York, Sunday to Thursday)", () => {
  it("finds the Sunday announcement in summer time (00:00 UTC Monday)", () => {
    expect(
      scheduledAnnouncementBetween(
        at("2026-09-27T23:55:00Z"),
        at("2026-09-28T00:05:00Z"),
      ),
    ).toBe(true);
    expect(
      scheduledAnnouncementBetween(
        at("2026-09-27T23:55:00Z"),
        at("2026-09-28T00:00:00Z"),
      ),
    ).toBe(true);
    // (from, to]: an announcement exactly at `from` has been seen already
    expect(
      scheduledAnnouncementBetween(
        at("2026-09-28T00:00:00Z"),
        at("2026-09-28T03:00:00Z"),
      ),
    ).toBe(false);
  });

  it("finds none from Friday to Sunday afternoon", () => {
    expect(
      scheduledAnnouncementBetween(
        at("2026-09-25T00:05:00Z"),
        at("2026-09-27T23:59:00Z"),
      ),
    ).toBe(false);
  });

  it("follows the change to winter time (01:00 UTC)", () => {
    // Daylight saving ends on Sunday 1 November 2026
    expect(
      scheduledAnnouncementBetween(
        at("2026-11-02T00:30:00Z"),
        at("2026-11-02T00:59:00Z"),
      ),
    ).toBe(false);
    expect(
      scheduledAnnouncementBetween(
        at("2026-11-02T00:30:00Z"),
        at("2026-11-02T01:00:00Z"),
      ),
    ).toBe(true);
    // Summer time starts on Sunday 8 March 2026
    expect(
      scheduledAnnouncementBetween(
        at("2026-03-08T23:30:00Z"),
        at("2026-03-09T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("gives the listing date of the latest scheduled announcement", () => {
    // Sunday afternoon: Thursday's announcement, listed as Friday
    expect(latestScheduledListingDate(at("2026-09-27T16:54:00Z"))).toBe(
      "2026-09-25",
    );
    expect(latestScheduledListingDate(at("2026-09-27T23:59:59Z"))).toBe(
      "2026-09-25",
    );
    expect(latestScheduledListingDate(at("2026-09-28T00:00:00Z"))).toBe(
      "2026-09-28",
    );
    expect(latestScheduledListingDate(at("2026-09-30T12:00:00Z"))).toBe(
      "2026-09-30",
    );
    expect(latestScheduledListingDate(at("2026-11-02T00:30:00Z"))).toBe(
      "2026-10-30",
    );
    expect(latestScheduledListingDate(at("2026-11-02T01:00:00Z"))).toBe(
      "2026-11-02",
    );
  });
});

describe("date ranges", () => {
  const now = at("2026-09-28T01:00:00Z");

  it("catch-up accepts 90 days back", () => {
    expect(earliestCatchupDate(now)).toBe("2026-06-30");
  });

  it("the cache keeps 100 days of announcement days", () => {
    expect(isWithinRetention("2026-06-20", now)).toBe(true);
    expect(isWithinRetention("2026-06-19", now)).toBe(false);
  });

  it("moves weekend dates to the next Monday", () => {
    expect(nextListingWeekday("2026-09-26")).toBe("2026-09-28");
    expect(nextListingWeekday("2026-09-27")).toBe("2026-09-28");
    expect(nextListingWeekday("2026-09-25")).toBe("2026-09-25");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
