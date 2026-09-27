// ─────────────────────────────────────────────────────────────────────────────
// Where fetched listings are kept: the plugin's localCache (type
// "arxiv_listing", only content that can be fetched again) with a small
// in-memory layer in front of it. When the local cache is switched off the
// listings live in memory only, for the lifetime of the store.
//
// Records:
//   day_<spec>_<YYYY-MM-DD>   a category's (or archive's) checked listing of
//                             one announcement day; localCache drops it once
//                             the date is older than the retention period
//   new_<spec>                which date /list/<spec>/new showed, and when
//   recent_<archive>          the date index of /list/<archive>/recent, and when
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../package.json";
import { localCache } from "../inspire/localCache";
import { LRUCache } from "../inspire/utils";
import type { IsoDate } from "./arxivDates";
import type { SpecDayListing } from "./listingTypes";

/** Which listing date a /new page showed when it was fetched */
export interface NewPageMarker {
  date: IsoDate;
  fetchedAt: number;
}

/** The date index of a /recent page (newest first) */
export interface RecentIndexRecord {
  dates: IsoDate[];
  fetchedAt: number;
}

export interface ListingStore {
  getDay(spec: string, date: IsoDate): Promise<SpecDayListing | null>;
  putDay(listing: SpecDayListing): Promise<void>;
  getNewMarker(spec: string): Promise<NewPageMarker | null>;
  putNewMarker(spec: string, marker: NewPageMarker): Promise<void>;
  getRecentIndex(archive: string): Promise<RecentIndexRecord | null>;
  putRecentIndex(archive: string, record: RecentIndexRecord): Promise<void>;
}

const RECORD_FORMAT = 1;

// localCache.purgeExpired reads the date at the end of day keys
const dayKey = (spec: string, date: IsoDate) => `day_${spec}_${date}`;
const newKey = (spec: string) => `new_${spec}`;
const recentKey = (archive: string) => `recent_${archive}`;

/** Keeps everything in memory (tests; a session without disk cache) */
export class MemoryListingStore implements ListingStore {
  private readonly records = new Map<string, unknown>();

  async getDay(spec: string, date: IsoDate) {
    return (this.records.get(dayKey(spec, date)) as SpecDayListing) ?? null;
  }
  async putDay(listing: SpecDayListing) {
    this.records.set(dayKey(listing.spec, listing.date), listing);
  }
  async getNewMarker(spec: string) {
    return (this.records.get(newKey(spec)) as NewPageMarker) ?? null;
  }
  async putNewMarker(spec: string, marker: NewPageMarker) {
    this.records.set(newKey(spec), marker);
  }
  async getRecentIndex(archive: string) {
    return (this.records.get(recentKey(archive)) as RecentIndexRecord) ?? null;
  }
  async putRecentIndex(archive: string, record: RecentIndexRecord) {
    this.records.set(recentKey(archive), record);
  }
}

// Records are objects, so that localCache's checks of array elements
// (authors, title of reference lists) do not apply to them
interface StoredDay {
  format: number;
  listing: SpecDayListing;
}
interface StoredMarker extends NewPageMarker {
  format: number;
}
interface StoredIndex extends RecentIndexRecord {
  format: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readDay(value: unknown): SpecDayListing | null {
  if (!isRecord(value) || value.format !== RECORD_FORMAT) return null;
  const listing = value.listing;
  if (
    !isRecord(listing) ||
    typeof listing.spec !== "string" ||
    typeof listing.date !== "string" ||
    typeof listing.fetchedAt !== "number" ||
    !Array.isArray(listing.entries)
  ) {
    return null;
  }
  return listing as unknown as SpecDayListing;
}

function readMarker(value: unknown): NewPageMarker | null {
  if (
    !isRecord(value) ||
    value.format !== RECORD_FORMAT ||
    typeof value.date !== "string" ||
    typeof value.fetchedAt !== "number"
  ) {
    return null;
  }
  return { date: value.date, fetchedAt: value.fetchedAt };
}

function readIndex(value: unknown): RecentIndexRecord | null {
  if (
    !isRecord(value) ||
    value.format !== RECORD_FORMAT ||
    !Array.isArray(value.dates) ||
    !value.dates.every((date) => typeof date === "string") ||
    typeof value.fetchedAt !== "number"
  ) {
    return null;
  }
  return { dates: value.dates as IsoDate[], fetchedAt: value.fetchedAt };
}

/** localCache ("arxiv_listing") behind an in-memory layer */
export class LocalCacheListingStore implements ListingStore {
  private readonly memory = new LRUCache<string, unknown>(64);

  async getDay(spec: string, date: IsoDate) {
    return this.read(dayKey(spec, date), readDay);
  }
  async putDay(listing: SpecDayListing) {
    const stored: StoredDay = { format: RECORD_FORMAT, listing };
    await this.write(dayKey(listing.spec, listing.date), stored);
  }
  async getNewMarker(spec: string) {
    return this.read(newKey(spec), readMarker);
  }
  async putNewMarker(spec: string, marker: NewPageMarker) {
    const stored: StoredMarker = { format: RECORD_FORMAT, ...marker };
    await this.write(newKey(spec), stored);
  }
  async getRecentIndex(archive: string) {
    return this.read(recentKey(archive), readIndex);
  }
  async putRecentIndex(archive: string, record: RecentIndexRecord) {
    const stored: StoredIndex = { format: RECORD_FORMAT, ...record };
    await this.write(recentKey(archive), stored);
  }

  private async read<T>(
    key: string,
    decode: (value: unknown) => T | null,
  ): Promise<T | null> {
    const inMemory = this.memory.get(key);
    if (inMemory !== undefined) return decode(inMemory);
    try {
      const cached = await localCache.get<unknown>("arxiv_listing", key);
      const value = cached ? decode(cached.data) : null;
      if (value !== null) this.memory.set(key, cached!.data);
      return value;
    } catch (error) {
      Zotero.debug(`[${config.addonName}] arXiv listing cache read: ${error}`);
      return null;
    }
  }

  private async write(key: string, stored: unknown): Promise<void> {
    this.memory.set(key, stored);
    try {
      await localCache.set("arxiv_listing", key, stored);
    } catch (error) {
      Zotero.debug(`[${config.addonName}] arXiv listing cache write: ${error}`);
    }
  }
}
