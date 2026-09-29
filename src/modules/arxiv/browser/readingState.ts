// ─────────────────────────────────────────────────────────────────────────────
// Reading state of the arXiv browser, kept on announcement days only: for each
// subscription, the days marked read. A day is marked when its listing was
// fetched completely and shown (ListingLoader), when it turned out to have no
// announcement, or by hand in the calendar. Marks are kept 100 days after the
// day, like the listings; editing a subscription keeps its marks. The marks
// are read once per Zotero session from the plugin data file
// arxiv-reading.json (JsonStateFile) and written back after each change.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import {
  JsonStateFile,
  pluginDataPath,
  type StateFileLoad,
} from "../../../utils/jsonStateFile";
import {
  isWithinRetention,
  latestScheduledListingDate,
  type IsoDate,
} from "../arxivDates";
import { systemClock, type Clock } from "../arxivFetch";
import { subscriptionCreatedMs, type ArxivSubscription } from "./subscriptions";

const FILE_NAME = "arxiv-reading.json";
const FILE_VERSION = 1;

/** The file's content besides its version */
export interface ReadingFile {
  /** Days marked read, by subscription key */
  read: Record<string, IsoDate[]>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseReadingFile(
  data: Record<string, unknown>,
): ReadingFile | null {
  const read = data.read;
  if (!read || typeof read !== "object" || Array.isArray(read)) return null;
  const result: Record<string, IsoDate[]> = {};
  for (const [id, dates] of Object.entries(read)) {
    if (!Array.isArray(dates)) return null;
    result[id] = dates.filter(
      (date): date is IsoDate =>
        typeof date === "string" && ISO_DATE.test(date),
    );
  }
  return { read: result };
}

export function readingStateFile(path: string): JsonStateFile<ReadingFile> {
  return new JsonStateFile(path, FILE_VERSION, parseReadingFile);
}

/**
 * The first day of a subscription that can be unread: the listing current
 * when it was made (earlier days were before it). Undefined when its key does
 * not tell.
 */
export function firstUnreadDay(
  subscription: ArxivSubscription,
): IsoDate | undefined {
  const created = subscriptionCreatedMs(subscription.id);
  return created === undefined
    ? undefined
    : latestScheduledListingDate(created);
}

/**
 * The file could not be read: kept under another name (`path`), or not even
 * that (the marks of this session are not saved)
 */
export type ReadingFileNotice = { kind: "kept" | "unreadable"; path: string };

export class ReadingState {
  private readonly marks = new Map<string, Set<IsoDate>>();
  private loaded = false;
  /** Marks changed before the file was read: written once it is */
  private changedEarly = false;
  private notice: ReadingFileNotice | undefined;
  /** The file has been read (or could not be) */
  readonly ready: Promise<void>;

  constructor(
    /** null: the marks are kept for this session only */
    private readonly file: JsonStateFile<ReadingFile> | null,
    private readonly clock: Clock = systemClock,
  ) {
    this.ready = this.load();
  }

  isRead(subscriptionId: string, date: IsoDate): boolean {
    return this.marks.get(subscriptionId)?.has(date) ?? false;
  }

  /** Mark days of a subscription read (or not) and save the change */
  setRead(subscriptionId: string, dates: readonly IsoDate[], read: boolean) {
    let days = this.marks.get(subscriptionId);
    if (!days) {
      if (!read) return;
      days = new Set();
      this.marks.set(subscriptionId, days);
    }
    let changed = false;
    for (const date of dates) {
      if (days.has(date) === read) continue;
      if (read) days.add(date);
      else days.delete(date);
      changed = true;
    }
    if (!changed) return;
    if (this.loaded) void this.save();
    else this.changedEarly = true;
  }

  /**
   * What the user is to be told about the file, once (by the first window
   * that asks)
   */
  takeFileNotice(): ReadingFileNotice | undefined {
    const notice = this.notice;
    this.notice = undefined;
    return notice;
  }

  private async load(): Promise<void> {
    const loaded: StateFileLoad<ReadingFile> = this.file
      ? await this.file.load()
      : { state: "none" };
    if (loaded.state === "read") {
      // Marks made while the file was read stay
      for (const [id, dates] of Object.entries(loaded.content.read)) {
        let days = this.marks.get(id);
        if (!days) this.marks.set(id, (days = new Set()));
        for (const date of dates) days.add(date);
      }
    } else if (loaded.state === "kept") {
      this.notice = { kind: "kept", path: loaded.keptAs };
    } else if (loaded.state === "failed" && this.file) {
      Zotero.debug(
        `[${config.addonName}] arXiv reading marks not read, kept for this session only: ${loaded.error}`,
      );
      this.notice = { kind: "unreadable", path: this.file.path };
    }
    this.loaded = true;
    if (this.changedEarly) void this.save();
  }

  private save(): Promise<void> | undefined {
    return this.file?.save(() => ({ read: this.current() }));
  }

  /** The marks kept, without those past 100 days (which are dropped) */
  private current(): Record<string, IsoDate[]> {
    const now = this.clock.now();
    const read: Record<string, IsoDate[]> = {};
    for (const [id, days] of this.marks) {
      for (const date of days) {
        if (!isWithinRetention(date, now)) days.delete(date);
      }
      if (days.size) read[id] = [...days].sort();
      else this.marks.delete(id);
    }
    return read;
  }
}

let shared: ReadingState | undefined;

/** The reading marks of the arXiv browser windows, read once per session */
export function sharedReadingState(): ReadingState {
  if (!shared) {
    let file: JsonStateFile<ReadingFile> | null = null;
    try {
      file = readingStateFile(pluginDataPath(FILE_NAME));
    } catch (error) {
      Zotero.debug(`[${config.addonName}] No data directory: ${error}`);
    }
    shared = new ReadingState(file);
  }
  return shared;
}
