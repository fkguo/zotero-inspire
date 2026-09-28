// ─────────────────────────────────────────────────────────────────────────────
// Library index: the arXiv IDs, INSPIRE recids and DOIs of the regular items
// of the user's and group libraries, items in the trash excluded. One SQL scan reads the fields
// that can hold them (Extra, Journal Abbr, Archive ID, URL, DOI, Archive
// Location with Archive); Zotero's item notifications keep the index current.
// The duplicate checks and the "in library" marks look papers up here.
//
// Every canonical arXiv ID found in an item's fields points to the item
// (INSPIRE lists two eprints for some papers), and every hit is kept: a paper
// saved twice gives two hits.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import {
  arxivIdsFromFields,
  parseArxivId,
  type ArxivIdFields,
} from "../../arxiv/arxivId";
import { recidFromFields } from "./itemRecid";

/** An item that has a paper's identifier */
export interface LibraryHit {
  itemID: number;
  libraryID: number;
  /** The item has an INSPIRE recid */
  hasRecid: boolean;
}

/** Lookups in the index as it is at the moment they run */
export interface LibraryLookup {
  byArxiv(arxivId: string, libraryID?: number): LibraryHit[];
  byRecid(recid: string, libraryID?: number): LibraryHit[];
  byDOI(doi: string, libraryID?: number): LibraryHit[];
}

/** The library could not be read: nothing is known about what it holds */
export class LibraryIndexError extends Error {
  constructor(cause: unknown) {
    super(`The library could not be read: ${cause}`);
    this.name = "LibraryIndexError";
  }
}

const FIELD_NAMES = [
  "extra",
  "journalAbbreviation",
  "archiveID",
  "url",
  "DOI",
  "archiveLocation",
  "archive",
] as const;

const NON_REGULAR_TYPES = ["note", "attachment", "annotation"];

/** Item IDs per query when items are read again after a change */
const ITEMS_PER_QUERY = 500;

interface IndexedItem {
  itemID: number;
  libraryID: number;
  arxivIds: string[];
  recid: string | null;
  /** In lower case: DOIs are compared without regard to case */
  doi: string | null;
}

/** An item's entry in the index, or null when it has no identifier */
function indexedItem(
  itemID: number,
  libraryID: number,
  fields: ArxivIdFields,
): IndexedItem | null {
  const arxivIds = arxivIdsFromFields(fields);
  const recid = recidFromFields(fields);
  const doi = fields.DOI ? fields.DOI.toLowerCase() : null;
  if (!arxivIds.length && !recid && !doi) return null;
  return { itemID, libraryID, arxivIds, recid, doi };
}

function sameEntry(a: IndexedItem | undefined, b: IndexedItem | null) {
  if (!a || !b) return !a && !b;
  return (
    a.libraryID === b.libraryID &&
    a.recid === b.recid &&
    a.doi === b.doi &&
    a.arxivIds.join(" ") === b.arxivIds.join(" ")
  );
}

/**
 * The index entries of the regular items that are not in the trash, in the
 * user's and group libraries (a feed's items are not in the library); only of
 * `itemIDs` if given. Items without an identifier are left out.
 */
async function readItems(itemIDs?: number[]): Promise<IndexedItem[]> {
  const fieldNames = new Map<number, keyof ArxivIdFields>();
  for (const name of FIELD_NAMES) {
    const fieldID = Zotero.ItemFields.getID(name);
    if (fieldID) fieldNames.set(fieldID, name);
  }
  const nonRegular = NON_REGULAR_TYPES.map((name) =>
    Zotero.ItemTypes.getID(name),
  ).filter((id): id is number => typeof id === "number");
  const base = `
    SELECT itemID, libraryID, fieldID, value
    FROM items
      JOIN itemData USING (itemID)
      JOIN itemDataValues USING (valueID)
    WHERE fieldID IN (${[...fieldNames.keys()].join(", ")})
      AND itemTypeID NOT IN (${nonRegular.join(", ")})
      AND itemID NOT IN (SELECT itemID FROM deletedItems)
      AND libraryID NOT IN (SELECT libraryID FROM libraries WHERE type = 'feed')`;

  const found = new Map<number, { libraryID: number; fields: ArxivIdFields }>();
  const addRows = (rows: any[] | undefined) => {
    for (const row of rows ?? []) {
      const itemID = Number(row.itemID);
      let item = found.get(itemID);
      if (!item) {
        item = { libraryID: Number(row.libraryID), fields: {} };
        found.set(itemID, item);
      }
      const name = fieldNames.get(Number(row.fieldID));
      if (name) item.fields[name] = String(row.value);
    }
  };
  if (!itemIDs) {
    addRows(await Zotero.DB.queryAsync(base));
  } else {
    for (let i = 0; i < itemIDs.length; i += ITEMS_PER_QUERY) {
      const chunk = itemIDs.slice(i, i + ITEMS_PER_QUERY);
      addRows(
        await Zotero.DB.queryAsync(
          `${base} AND itemID IN (${chunk.map(() => "?").join(", ")})`,
          chunk,
        ),
      );
    }
  }

  const items: IndexedItem[] = [];
  for (const [itemID, { libraryID, fields }] of found) {
    const item = indexedItem(itemID, libraryID, fields);
    if (item) items.push(item);
  }
  return items;
}

class LibraryIndex implements LibraryLookup {
  private readonly items = new Map<number, IndexedItem>();
  private readonly arxiv = new Map<string, Set<number>>();
  private readonly recid = new Map<string, Set<number>>();
  private readonly doi = new Map<string, Set<number>>();
  private readonly listeners = new Set<(itemIDs: number[]) => void>();
  private observerID?: string;
  /** Set from the first request until the index is dropped */
  private building?: Promise<void>;
  private ready = false;
  /** Items changed while the index was built: read again at its end */
  private changedWhileBuilding = new Set<number>();
  /** Libraries removed while the index was built */
  private librariesRemovedWhileBuilding = new Set<number>();
  /** Updates run one after the other, in the order the changes came */
  private updates: Promise<void> = Promise.resolve();
  /**
   * A request was told that the library cannot be read since the index was
   * last built: once it is built again, the listeners are told, so that
   * papers shown as unknown are looked up again
   */
  private failedRequests = false;

  /** Resolves once the index holds the library; builds it on first use */
  async whenReady(): Promise<void> {
    // A failure drops the index; each request after it tries again
    while (!this.ready) {
      if (!this.building) {
        const building = this.build();
        this.building = building;
        building.catch((err) => {
          Zotero.debug(
            `[${config.addonName}] Library index could not be built: ${err}`,
          );
          if (this.building === building) this.drop();
        });
      }
      try {
        await this.building;
      } catch (err) {
        this.failedRequests = true;
        throw new LibraryIndexError(err);
      }
    }
  }

  byArxiv(arxivId: string, libraryID?: number): LibraryHit[] {
    const id = parseArxivId(arxivId)?.id;
    return id ? this.hits(this.arxiv.get(id), libraryID) : [];
  }

  byRecid(recid: string, libraryID?: number): LibraryHit[] {
    return this.hits(this.recid.get(recid.trim()), libraryID);
  }

  byDOI(doi: string, libraryID?: number): LibraryHit[] {
    return this.hits(this.doi.get(doi.toLowerCase()), libraryID);
  }

  onChange(listener: (itemIDs: number[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stop following the library and forget it (plugin shutdown) */
  stop(): void {
    if (this.observerID) {
      Zotero.Notifier.unregisterObserver(this.observerID);
      this.observerID = undefined;
    }
    this.drop();
    this.failedRequests = false;
  }

  /** Called by Zotero's notifier after each committed change */
  notify = async (
    event: string,
    type: string,
    ids: Array<number | string>,
    extraData: Record<string, any>,
  ): Promise<void> => {
    if (type === "item") {
      const itemIDs = ids.filter((id): id is number => typeof id === "number");
      if (!itemIDs.length) return;
      if (!this.ready) {
        // A scan under way may have read the items before the change
        if (this.building) {
          for (const id of itemIDs) this.changedWhileBuilding.add(id);
        }
        return;
      }
      if (event === "add" || event === "modify" || event === "trash") {
        await this.update(() => this.readAgain(itemIDs));
      } else if (event === "delete") {
        await this.update(async () =>
          itemIDs.filter((id) => this.replace(id, null)),
        );
      }
    } else if (type === "group" && event === "delete") {
      // Leaving a group removes its library with its items, without an item
      // notification
      const libraryIDs = ids
        .map((groupID) => Number(extraData?.[groupID]?.libraryID))
        .filter((id) => Number.isFinite(id));
      if (!libraryIDs.length) return;
      if (!this.ready) {
        if (this.building) {
          for (const id of libraryIDs)
            this.librariesRemovedWhileBuilding.add(id);
        }
        return;
      }
      await this.update(async () => this.removeLibraries(libraryIDs));
    }
  };

  private async build(): Promise<void> {
    this.observe();
    this.changedWhileBuilding.clear();
    this.librariesRemovedWhileBuilding.clear();
    const items = await readItems();
    this.clear();
    for (const item of items) this.replace(item.itemID, item);
    // Changes that came while the library was read, and while they are read
    while (
      this.changedWhileBuilding.size ||
      this.librariesRemovedWhileBuilding.size
    ) {
      this.removeLibraries([...this.librariesRemovedWhileBuilding]);
      this.librariesRemovedWhileBuilding.clear();
      const changed = [...this.changedWhileBuilding];
      this.changedWhileBuilding.clear();
      if (changed.length) await this.readAgain(changed);
    }
    this.ready = true;
    if (this.failedRequests) {
      this.failedRequests = false;
      this.tell([]);
    }
  }

  private observe() {
    if (this.observerID) return;
    this.observerID = Zotero.Notifier.registerObserver(
      this,
      ["item", "group"],
      "zoteroinspire-libraryIndex",
      // Before the plugin's own observers, which read the index
      50,
    );
  }

  /**
   * Run an update after the ones before it and tell the listeners which items
   * changed. When the library cannot be read, the index is dropped (the next
   * request builds it again) and the listeners are told.
   */
  private update(change: () => Promise<number[]>): Promise<void> {
    const run = this.updates.then(async () => {
      if (!this.ready) return;
      let changed: number[];
      try {
        changed = await change();
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] Library index could not be updated: ${err}`,
        );
        this.drop();
        this.tell([]);
        return;
      }
      if (changed.length) this.tell(changed);
    });
    this.updates = run;
    return run;
  }

  /** Read items again; the items whose entries changed */
  private async readAgain(itemIDs: number[]): Promise<number[]> {
    const items = await readItems(itemIDs);
    const byID = new Map(items.map((item) => [item.itemID, item]));
    return itemIDs.filter((id) => this.replace(id, byID.get(id) ?? null));
  }

  private removeLibraries(libraryIDs: number[]): number[] {
    const removed = new Set(libraryIDs);
    const itemIDs = [...this.items.values()]
      .filter((item) => removed.has(item.libraryID))
      .map((item) => item.itemID);
    for (const id of itemIDs) this.replace(id, null);
    return itemIDs;
  }

  /** Put an item's new entry in place of its old one; true if it changed */
  private replace(itemID: number, item: IndexedItem | null): boolean {
    const old = this.items.get(itemID);
    if (sameEntry(old, item)) return false;
    if (old) {
      for (const id of old.arxivIds) removeKey(this.arxiv, id, itemID);
      if (old.recid) removeKey(this.recid, old.recid, itemID);
      if (old.doi) removeKey(this.doi, old.doi, itemID);
      this.items.delete(itemID);
    }
    if (item) {
      this.items.set(itemID, item);
      for (const id of item.arxivIds) addKey(this.arxiv, id, itemID);
      if (item.recid) addKey(this.recid, item.recid, itemID);
      if (item.doi) addKey(this.doi, item.doi, itemID);
    }
    return true;
  }

  /** Hits with a recid first, then by item ID */
  private hits(
    itemIDs: Set<number> | undefined,
    libraryID?: number,
  ): LibraryHit[] {
    const hits: LibraryHit[] = [];
    for (const itemID of itemIDs ?? []) {
      const item = this.items.get(itemID)!;
      if (libraryID !== undefined && item.libraryID !== libraryID) continue;
      hits.push({
        itemID,
        libraryID: item.libraryID,
        hasRecid: item.recid !== null,
      });
    }
    return hits.sort(
      (a, b) => Number(b.hasRecid) - Number(a.hasRecid) || a.itemID - b.itemID,
    );
  }

  private tell(itemIDs: number[]) {
    for (const listener of [...this.listeners]) {
      try {
        listener(itemIDs);
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] Library index listener failed: ${err}`,
        );
      }
    }
  }

  private clear() {
    this.items.clear();
    this.arxiv.clear();
    this.recid.clear();
    this.doi.clear();
  }

  private drop() {
    this.ready = false;
    this.building = undefined;
    this.changedWhileBuilding.clear();
    this.librariesRemovedWhileBuilding.clear();
    this.clear();
  }
}

function addKey(map: Map<string, Set<number>>, key: string, itemID: number) {
  let ids = map.get(key);
  if (!ids) {
    ids = new Set();
    map.set(key, ids);
  }
  ids.add(itemID);
}

function removeKey(map: Map<string, Set<number>>, key: string, itemID: number) {
  const ids = map.get(key);
  if (!ids) return;
  ids.delete(itemID);
  if (!ids.size) map.delete(key);
}

const index = new LibraryIndex();

/**
 * Lookups in the library index, once it holds the library (the first call
 * reads it). Rejects with LibraryIndexError when the library cannot be read.
 */
export async function libraryLookup(): Promise<LibraryLookup> {
  await index.whenReady();
  return index;
}

/**
 * Tell `listener` the IDs of the items whose identifiers changed (added,
 * edited, moved to or from the trash, deleted), after the index has them; an
 * empty list when the index was dropped because the library could not be
 * read, and when it can be read again after a lookup failed. Returns the
 * function that stops telling it.
 */
export function onLibraryIndexChange(
  listener: (itemIDs: number[]) => void,
): () => void {
  return index.onChange(listener);
}

/** Stop following the library (plugin shutdown) */
export function stopLibraryIndex(): void {
  index.stop();
}

/**
 * Items with each arXiv ID (any notation parseArxivId accepts), keyed by the
 * ID as asked; IDs without an item are left out. Only items of `libraryID`
 * when given.
 */
export async function findItemsByArxivs(
  arxivIds: string[],
  libraryID?: number,
): Promise<Map<string, LibraryHit[]>> {
  return findAll(arxivIds, (lookup, id) => lookup.byArxiv(id, libraryID));
}

/** Items with each INSPIRE recid (resolveItemRecid), as findItemsByArxivs */
export async function findItemsByRecids(
  recids: string[],
  libraryID?: number,
): Promise<Map<string, LibraryHit[]>> {
  return findAll(recids, (lookup, recid) => lookup.byRecid(recid, libraryID));
}

/**
 * Items with each DOI in their DOI field, compared without regard to case, as
 * findItemsByArxivs
 */
export async function findItemsByDOIs(
  dois: string[],
  libraryID?: number,
): Promise<Map<string, LibraryHit[]>> {
  return findAll(dois, (lookup, doi) => lookup.byDOI(doi, libraryID));
}

/**
 * The item with an INSPIRE recid in any library; of several, the one with the
 * lowest item ID
 */
export async function findItemByRecid(
  recid: string,
): Promise<Zotero.Item | null> {
  const [hit] = (await libraryLookup()).byRecid(recid);
  // Loads the item if its library's items are not loaded yet
  return (hit && (await Zotero.Items.getAsync(hit.itemID))) || null;
}

async function findAll(
  keys: string[],
  find: (lookup: LibraryLookup, key: string) => LibraryHit[],
): Promise<Map<string, LibraryHit[]>> {
  const result = new Map<string, LibraryHit[]>();
  if (!keys.length) return result;
  const lookup = await libraryLookup();
  for (const key of keys) {
    const hits = find(lookup, key);
    if (hits.length) result.set(key, hits);
  }
  return result;
}
