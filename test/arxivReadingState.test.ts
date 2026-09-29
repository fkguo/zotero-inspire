import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  firstUnreadDay,
  ReadingState,
  readingStateFile,
} from "../src/modules/arxiv/browser/readingState";
import {
  newSubscriptionId,
  subscriptionCreatedMs,
  type ArxivSubscription,
} from "../src/modules/arxiv/browser/subscriptions";
import { fakeFiles } from "./fakeFiles";
import { VirtualClock } from "./virtualClock";

// The days marked read, per subscription, kept in the plugin's data file.

const PATH = "/data/zoteroinspire/arxiv-reading.json";
/** Tuesday 29 September 2026, 12:00 UTC */
const NOW = Date.parse("2026-09-29T12:00:00Z");

beforeEach(() => {
  vi.stubGlobal("Zotero", { debug: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

const fileContent = (files: Map<string, string>) =>
  JSON.parse(files.get(PATH)!);

describe("arXiv reading state", () => {
  it("keeps the marks of two subscriptions apart", async () => {
    const disk = fakeFiles();
    const state = new ReadingState(
      readingStateFile(PATH),
      new VirtualClock(NOW),
    );
    await state.ready;
    state.setRead("sub-a", ["2026-09-28", "2026-09-29"], true);
    state.setRead("sub-b", ["2026-09-28"], true);
    state.setRead("sub-a", ["2026-09-28"], false);
    expect(state.isRead("sub-a", "2026-09-28")).toBe(false);
    expect(state.isRead("sub-a", "2026-09-29")).toBe(true);
    expect(state.isRead("sub-b", "2026-09-28")).toBe(true);
    expect(state.isRead("sub-b", "2026-09-29")).toBe(false);
    await vi.waitFor(() =>
      expect(fileContent(disk.files)).toEqual({
        version: 1,
        read: { "sub-a": ["2026-09-29"], "sub-b": ["2026-09-28"] },
      }),
    );
  });

  it("reads the marks back in the next session", async () => {
    const disk = fakeFiles();
    const clock = new VirtualClock(NOW);
    const first = new ReadingState(readingStateFile(PATH), clock);
    await first.ready;
    first.setRead("sub-a", ["2026-09-25"], true);
    await vi.waitFor(() => expect(disk.files.has(PATH)).toBe(true));
    const next = new ReadingState(readingStateFile(PATH), clock);
    await next.ready;
    expect(next.isRead("sub-a", "2026-09-25")).toBe(true);
  });

  it("drops the marks of days more than 100 days back", async () => {
    const disk = fakeFiles({
      [PATH]: JSON.stringify({
        version: 1,
        read: {
          "sub-a": ["2026-06-20", "2026-06-21", "2026-09-01"],
          "sub-old": ["2026-05-01"],
        },
      }),
    });
    const state = new ReadingState(
      readingStateFile(PATH),
      new VirtualClock(NOW),
    );
    await state.ready;
    state.setRead("sub-a", ["2026-09-29"], true);
    // 100 days before 29 September is 21 June
    await vi.waitFor(() =>
      expect(fileContent(disk.files).read).toEqual({
        "sub-a": ["2026-06-21", "2026-09-01", "2026-09-29"],
      }),
    );
    expect(state.isRead("sub-a", "2026-06-20")).toBe(false);
  });

  it("keeps the marks made while the file is read, with those in it", async () => {
    const disk = fakeFiles({
      [PATH]: JSON.stringify({ version: 1, read: { "sub-a": ["2026-09-25"] } }),
    });
    const state = new ReadingState(
      readingStateFile(PATH),
      new VirtualClock(NOW),
    );
    state.setRead("sub-a", ["2026-09-28"], true);
    // Nothing is written before the file is read
    expect(disk.IOUtils.writeJSON).not.toHaveBeenCalled();
    await state.ready;
    await vi.waitFor(() =>
      expect(fileContent(disk.files).read).toEqual({
        "sub-a": ["2026-09-25", "2026-09-28"],
      }),
    );
  });

  it("keeps an unreadable file, tells it once, and does not overwrite it", async () => {
    const disk = fakeFiles({ [PATH]: "{not json" });
    const state = new ReadingState(
      readingStateFile(PATH),
      new VirtualClock(NOW),
    );
    await state.ready;
    const notice = state.takeFileNotice();
    expect(notice?.kind).toBe("kept");
    const keptAs = notice?.path;
    expect(keptAs).toMatch(/arxiv-reading-unreadable-.*\.json$/);
    expect(state.takeFileNotice()).toBeUndefined();
    state.setRead("sub-a", ["2026-09-28"], true);
    await vi.waitFor(() => expect(disk.files.has(PATH)).toBe(true));
    expect(disk.files.get(keptAs!)).toBe("{not json");
  });

  it("keeps the marks for the session only when the file cannot be read", async () => {
    const disk = fakeFiles({
      [PATH]: JSON.stringify({ version: 1, read: { "sub-a": ["2026-09-25"] } }),
    });
    disk.unreadable(PATH);
    const state = new ReadingState(
      readingStateFile(PATH),
      new VirtualClock(NOW),
    );
    await state.ready;
    expect(state.takeFileNotice()).toEqual({ kind: "unreadable", path: PATH });
    state.setRead("sub-a", ["2026-09-28"], true);
    expect(state.isRead("sub-a", "2026-09-28")).toBe(true);
    await Promise.resolve();
    expect(disk.IOUtils.writeJSON).not.toHaveBeenCalled();
  });
});

describe("arXiv reading state: a subscription's first day", () => {
  const made = (id: string): ArxivSubscription => ({
    id,
    name: "Daily",
    categories: ["hep-ph"],
    sections: { new: true, cross: true, replace: false },
  });

  it("is the listing current when the subscription was made", () => {
    vi.useFakeTimers();
    try {
      // Tuesday 29 September 2026, 10:00 in Beijing: Monday evening in New
      // York, after Monday's announcement (the listing of Tuesday 29)
      vi.setSystemTime(Date.parse("2026-09-29T02:00:00Z"));
      const id = newSubscriptionId();
      expect(subscriptionCreatedMs(id)).toBe(
        Date.parse("2026-09-29T02:00:00Z"),
      );
      expect(firstUnreadDay(made(id))).toBe("2026-09-29");
      // Saturday: Friday's listing
      vi.setSystemTime(Date.parse("2026-09-26T12:00:00Z"));
      expect(firstUnreadDay(made(newSubscriptionId()))).toBe("2026-09-25");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not told by a key without the time", () => {
    expect(firstUnreadDay(made("sub-1"))).toBeUndefined();
  });
});
