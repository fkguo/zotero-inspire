// ─────────────────────────────────────────────────────────────────────────────
// A small Zotero library for tests: Zotero's item tables in an in-memory
// SQLite database (node:sqlite), items that read their fields from it, and a
// notifier that calls observers after each change the way Zotero does (after
// the change is committed, awaiting each observer in priority order).
//
// Code under test runs its own SQL against these tables through Zotero.DB, so
// SQL lookups and anything built on them see one and the same library.
// ─────────────────────────────────────────────────────────────────────────────

import { DatabaseSync } from "node:sqlite";

const FIELD_NAMES = [
  "title",
  "date",
  "extra",
  "journalAbbreviation",
  "archiveID",
  "url",
  "DOI",
  "archiveLocation",
  "archive",
  "citationKey",
];

// Zotero's non-regular types come last, as in its schema
const ITEM_TYPES = [
  "journalArticle",
  "preprint",
  "book",
  "report",
  "note",
  "attachment",
  "annotation",
];
const NON_REGULAR = new Set(["note", "attachment", "annotation"]);

/** Library IDs of the libraries every fake library has */
export const USER_LIBRARY = 1;
export const GROUP_LIBRARY = 2;
/** A feed (an RSS subscription), whose items Zotero keeps as items too */
export const FEED_LIBRARY = 3;

export interface FakeItemSpec {
  libraryID?: number;
  itemType?: string;
  fields?: Record<string, string>;
  /** In the trash */
  deleted?: boolean;
  /** The item an attachment or note belongs to */
  parentItemID?: number;
  /** Zotero's dateAdded, "YYYY-MM-DD HH:MM:SS" (UTC) */
  dateAdded?: string;
  /** Creators in order; lastName only for a name in one field */
  creators?: { firstName?: string; lastName: string }[];
}

export interface FakeItem {
  id: number;
  key: string;
  libraryID: number;
  itemType: string;
  readonly deleted: boolean;
  relatedItems: string[];
  getField(name: string): string;
  setField(name: string, value: string): void;
  isRegularItem(): boolean;
  isNote(): boolean;
  isAttachment(): boolean;
  isPDFAttachment(): boolean;
  getDisplayTitle(): string;
  /** Its attachments, those in the trash left out unless asked for */
  getAttachments(includeTrashed?: boolean): number[];
  addRelatedItem(other: FakeItem): boolean;
  removeRelatedItem(other: FakeItem): Promise<boolean>;
  saveTx(): Promise<void>;
  parentItemID?: number;
  getCreators(): { firstName: string; lastName: string }[];
  /** Fields set since the last save */
  hasChanged(): boolean;
  /** Save the fields set since the last save (options kept in `saves`) */
  save(options?: unknown): Promise<void>;
  saves: unknown[];
}

interface Observer {
  ref: {
    notify: (
      event: string,
      type: string,
      ids: any[],
      extraData: Record<string, any>,
    ) => unknown;
  };
  types?: string[];
  priority: number;
}

export class FakeLibrary {
  readonly db = new DatabaseSync(":memory:");
  private readonly fieldIDs = new Map<string, number>();
  private readonly typeIDs = new Map<string, number>();
  private readonly items = new Map<number, FakeItem>();
  private readonly observers = new Map<string, Observer>();
  /** Each item's field values as its object holds them */
  private readonly fieldMaps = new WeakMap<FakeItem, Record<string, string>>();
  private nextItemID = 1;
  private nextObserver = 1;
  /** Error thrown by every query while set (Zotero.DB failing) */
  queryError?: Error;
  /**
   * Every queryAsync gives no rows while set, as Zotero answers a query
   * whose text does not start with SELECT
   */
  answerWithoutRows = false;
  /**
   * Libraries whose items Zotero has not loaded yet (not shown or synced
   * since startup): Zotero.Items.get throws for their items until
   * Zotero.Items.getAsync loads them
   */
  readonly unloadedLibraries = new Set<number>();
  private readonly loadedLater = new Set<number>();
  /** Number of queries run through Zotero.DB */
  queryCount = 0;

  constructor() {
    this.db.exec(`
      CREATE TABLE libraries (libraryID INTEGER PRIMARY KEY, type TEXT NOT NULL, editable INT NOT NULL);
      CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
      CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
      CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT NOT NULL, libraryID INT NOT NULL, key TEXT NOT NULL, dateAdded TEXT NOT NULL DEFAULT '2026-01-01 00:00:00');
      CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
      CREATE TABLE itemCreators (itemID INT, creatorID INT, orderIndex INT);
      CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value UNIQUE);
      CREATE TABLE itemData (itemID INT, fieldID INT, valueID, PRIMARY KEY (itemID, fieldID));
      CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
    `);
    this.db
      .prepare(
        "INSERT INTO libraries VALUES (?, 'user', 1), (?, 'group', 1), (?, 'feed', 0)",
      )
      .run(USER_LIBRARY, GROUP_LIBRARY, FEED_LIBRARY);
    // IDs as in a real database: not 1..n, and differing between tables
    FIELD_NAMES.forEach((name, i) => {
      const id = 101 + i * 7;
      this.fieldIDs.set(name, id);
      this.db.prepare("INSERT INTO fields VALUES (?, ?)").run(id, name);
    });
    ITEM_TYPES.forEach((name, i) => {
      const id = 3 + i * 5;
      this.typeIDs.set(name, id);
      this.db.prepare("INSERT INTO itemTypes VALUES (?, ?)").run(id, name);
    });
  }

  // ── Zotero globals ──────────────────────────────────────────────────────

  /** What the code under test uses of Zotero, on this library */
  zoteroGlobals() {
    const run = (sql: string, params: unknown[] = []) => {
      this.queryCount++;
      if (this.queryError) throw this.queryError;
      return this.db.prepare(sql).all(...(params as any[])) as any[];
    };
    return {
      debug: () => undefined,
      logError: () => undefined,
      ItemFields: { getID: (name: string) => this.fieldIDs.get(name) ?? false },
      ItemTypes: { getID: (name: string) => this.typeIDs.get(name) ?? false },
      DB: {
        // Zotero returns the rows only when the text starts with the word
        // SELECT or PRAGMA: it takes the first word with /^[^a-z]*[^ ]+/i, so
        // with anything before it (a line break, a space) the query runs and
        // returns nothing (db.js, queryAsync)
        queryAsync: async (sql: string, params?: unknown[]) => {
          const rows = run(sql, params);
          const op = sql.match(/^[^a-z]*[^ ]+/i)?.[0].toLowerCase();
          if (this.answerWithoutRows) return undefined;
          return op === "select" || op === "pragma" ? rows : undefined;
        },
        valueQueryAsync: async (sql: string, params?: unknown[]) => {
          const row = run(sql, params)[0];
          return row ? Object.values(row)[0] : false;
        },
        columnQueryAsync: async (sql: string, params?: unknown[]) =>
          run(sql, params).map((row) => Object.values(row)[0]),
        executeTransaction: async (fn: () => Promise<unknown>) => fn(),
      },
      Items: {
        get: (ids: number | number[]) => {
          for (const id of Array.isArray(ids) ? ids : [ids]) {
            if (this.isUnloaded(id)) {
              const err = new Error(`Item ${id} not yet loaded`);
              err.name = "UnloadedDataException";
              throw err;
            }
          }
          return Array.isArray(ids)
            ? ids.map((id) => this.items.get(id)).filter(Boolean)
            : (this.items.get(ids) ?? false);
        },
        getAsync: async (ids: number | number[]) => {
          for (const id of Array.isArray(ids) ? ids : [ids]) {
            this.loadedLater.add(id);
          }
          return Array.isArray(ids)
            ? ids.map((id) => this.items.get(id)).filter(Boolean)
            : (this.items.get(ids) ?? false);
        },
        getLibraryAndKeyFromID: (id: number) => {
          const item = this.items.get(id);
          return item ? { libraryID: item.libraryID, key: item.key } : false;
        },
      },
      Libraries: {
        get: (libraryID: number) => ({
          libraryID,
          name:
            libraryID === USER_LIBRARY ? "My Library" : `Group ${libraryID}`,
          // Its items can be read from now on
          waitForDataLoad: async () => {
            this.unloadedLibraries.delete(libraryID);
          },
        }),
      },
      Notifier: {
        registerObserver: (
          ref: Observer["ref"],
          types?: string[],
          _id?: string,
          priority?: number,
        ) => {
          const id = `observer-${this.nextObserver++}`;
          this.observers.set(id, { ref, types, priority: priority || 100 });
          return id;
        },
        unregisterObserver: (id: string) => {
          this.observers.delete(id);
        },
      },
    };
  }

  /** Number of registered notifier observers */
  get observerCount(): number {
    return this.observers.size;
  }

  /**
   * Tell the observers about a change, as Zotero's notifier does once the
   * change is committed: one observer after the other, lower priority numbers
   * first, each awaited.
   */
  async notify(
    event: string,
    type: string,
    ids: any[],
    extraData: Record<string, any> = {},
  ): Promise<void> {
    const observers = [...this.observers.values()]
      .filter((o) => !o.types || o.types.includes(type))
      .sort((a, b) => a.priority - b.priority);
    for (const observer of observers) {
      await observer.ref.notify(event, type, ids, extraData);
    }
  }

  // ── Library contents ────────────────────────────────────────────────────

  /** Add an item without telling the observers (a library as found) */
  put(spec: FakeItemSpec = {}): FakeItem {
    const id = this.nextItemID;
    this.nextItemID += 3;
    const itemType = spec.itemType ?? "journalArticle";
    const libraryID = spec.libraryID ?? USER_LIBRARY;
    const key = `KEY${String(id).padStart(5, "0")}`;
    this.db
      .prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?)")
      .run(
        id,
        this.typeIDs.get(itemType)!,
        libraryID,
        key,
        spec.dateAdded ?? "2026-01-01 00:00:00",
      );
    const creators = (spec.creators ?? []).map((c) => ({
      firstName: c.firstName ?? "",
      lastName: c.lastName,
    }));
    creators.forEach((creator, orderIndex) => {
      const { lastInsertRowid } = this.db
        .prepare("INSERT INTO creators (firstName, lastName) VALUES (?, ?)")
        .run(creator.firstName, creator.lastName);
      this.db
        .prepare("INSERT INTO itemCreators VALUES (?, ?, ?)")
        .run(id, Number(lastInsertRowid), orderIndex);
    });
    const fields: Record<string, string> = {};
    const unsaved: Record<string, string> = {};
    const write = (changes: Record<string, string>) =>
      this.writeFields(item, fields, changes);
    const isTrashed = () => this.isTrashed(id);
    const item: FakeItem = {
      id,
      key,
      libraryID,
      itemType,
      get deleted() {
        return isTrashed();
      },
      relatedItems: [],
      getField: (name: string) => fields[name] ?? "",
      setField: (name: string, value: string) => {
        if ((fields[name] ?? "") === value) return;
        fields[name] = value;
        unsaved[name] = value;
      },
      getCreators: () => creators.map((c) => ({ ...c })),
      hasChanged: () => Object.keys(unsaved).length > 0,
      saves: [],
      async save(options?: unknown) {
        this.saves.push(options);
        const changes = { ...unsaved };
        for (const name of Object.keys(unsaved)) delete unsaved[name];
        write(changes);
      },
      isRegularItem: () => !NON_REGULAR.has(itemType),
      isNote: () => itemType === "note",
      isAttachment: () => itemType === "attachment",
      isPDFAttachment: () => itemType === "attachment",
      getDisplayTitle: () => fields.title ?? "",
      getAttachments: (includeTrashed = false) =>
        [...this.items.values()]
          .filter(
            (child) =>
              child.parentItemID === id &&
              child.itemType === "attachment" &&
              (includeTrashed || !this.isTrashed(child.id)),
          )
          .map((child) => child.id),
      // Relations by item key, as Zotero keeps them within a library
      addRelatedItem(other: FakeItem) {
        if (this.relatedItems.includes(other.key)) return false;
        this.relatedItems.push(other.key);
        return true;
      },
      async removeRelatedItem(other: FakeItem) {
        const index = this.relatedItems.indexOf(other.key);
        if (index < 0) return false;
        this.relatedItems.splice(index, 1);
        return true;
      },
      saveTx: async () => undefined,
      parentItemID: spec.parentItemID,
    };
    this.items.set(id, item);
    this.fieldMaps.set(item, fields);
    this.writeFields(item, fields, spec.fields ?? {});
    if (spec.deleted)
      this.db.prepare("INSERT INTO deletedItems VALUES (?)").run(id);
    return item;
  }

  /** Add an item, as a save of a new item does */
  async add(spec: FakeItemSpec = {}): Promise<FakeItem> {
    const item = this.put(spec);
    await this.notify("add", "item", [item.id]);
    return item;
  }

  /** Change fields ("" clears one), as a save of an edited item does */
  async edit(item: FakeItem, changes: Record<string, string>): Promise<void> {
    this.writeFields(item, null, changes);
    await this.notify("modify", "item", [item.id]);
  }

  /** Move to the trash, as Zotero.Items.trash does */
  async trash(item: FakeItem): Promise<void> {
    this.db
      .prepare("INSERT OR IGNORE INTO deletedItems VALUES (?)")
      .run(item.id);
    await this.notify("modify", "item", [item.id]);
    await this.notify("trash", "item", [item.id]);
  }

  /** Restore from the trash: a save of the item with deleted = false */
  async restore(item: FakeItem): Promise<void> {
    this.db.prepare("DELETE FROM deletedItems WHERE itemID = ?").run(item.id);
    await this.notify("modify", "item", [item.id]);
  }

  /** Delete for good, as emptying the trash does */
  async erase(item: FakeItem): Promise<void> {
    this.removeRows(item.id);
    this.items.delete(item.id);
    await this.notify("delete", "item", [item.id]);
  }

  /** Remove a group library with its items, as leaving the group does */
  async removeGroup(libraryID: number, groupID: number): Promise<void> {
    for (const item of [...this.items.values()]) {
      if (item.libraryID !== libraryID) continue;
      this.removeRows(item.id);
      this.items.delete(item.id);
    }
    this.db.prepare("DELETE FROM libraries WHERE libraryID = ?").run(libraryID);
    await this.notify("delete", "group", [groupID], {
      [groupID]: { libraryID },
    });
  }

  private isUnloaded(itemID: number): boolean {
    const item = this.items.get(itemID);
    return Boolean(
      item &&
      this.unloadedLibraries.has(item.libraryID) &&
      !this.loadedLater.has(itemID),
    );
  }

  isTrashed(itemID: number): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM deletedItems WHERE itemID = ?")
        .get(itemID),
    );
  }

  private removeRows(itemID: number) {
    this.db.prepare("DELETE FROM itemData WHERE itemID = ?").run(itemID);
    this.db.prepare("DELETE FROM deletedItems WHERE itemID = ?").run(itemID);
    this.db.prepare("DELETE FROM items WHERE itemID = ?").run(itemID);
  }

  private writeFields(
    item: FakeItem,
    fields: Record<string, string> | null,
    changes: Record<string, string>,
  ) {
    for (const [name, value] of Object.entries(changes)) {
      const fieldID = this.fieldIDs.get(name);
      if (fieldID === undefined) throw new Error(`no field ${name}`);
      (fields ?? this.fieldMaps.get(item)!)[name] = value;
      this.db
        .prepare("DELETE FROM itemData WHERE itemID = ? AND fieldID = ?")
        .run(item.id, fieldID);
      if (value === "") continue;
      this.db
        .prepare("INSERT OR IGNORE INTO itemDataValues (value) VALUES (?)")
        .run(value);
      const { valueID } = this.db
        .prepare("SELECT valueID FROM itemDataValues WHERE value = ?")
        .get(value) as { valueID: number };
      this.db
        .prepare("INSERT INTO itemData VALUES (?, ?, ?)")
        .run(item.id, fieldID, valueID);
    }
  }
}
