// ─────────────────────────────────────────────────────────────────────────────
// Creating a library item from an INSPIRE record: the References panel, the
// citation graph and the arXiv browser's "INSPIRE has the record" path all
// add a paper this way. Messages, scrolling and the like stay with the
// callers.
//
// Items the plugin creates carry an in-memory mark until Zotero's "add"
// notification reaches the plugin: the new-item hook then leaves out its
// automatic INSPIRE update for them (they already have what the plugin
// writes, or come from arXiv data on purpose).
// ─────────────────────────────────────────────────────────────────────────────

import { resolveNewItemType } from "../itemTypePolicy";
import { fetchInspireMetaByRecid } from "../metadataService";
import {
  getItemTypePolicy,
  saveItemWithPendingInspireNote,
  setInspireMeta,
} from "../itemUpdater";
import type { jsobject } from "../types";

/** Where a new item goes: library, collections, tags and a child note */
export interface NewItemTarget {
  libraryID: number;
  collectionIDs: readonly (number | null | undefined)[];
  tags?: readonly string[];
  note?: string;
}

const CREATED_MARK = "_zinspireCreatedByPlugin";

/** Mark `item`, before its first save, as created by the plugin */
export function markCreatedByPlugin(item: Zotero.Item): void {
  (item as any)[CREATED_MARK] = true;
}

/** Whether the plugin created `item`; the mark is removed (read once) */
export function takeCreatedByPluginMark(item: Zotero.Item): boolean {
  const marked = (item as any)[CREATED_MARK] === true;
  delete (item as any)[CREATED_MARK];
  return marked;
}

/** Put a new, unsaved item in `target`: library, collections and tags */
export function placeNewItem(item: Zotero.Item, target: NewItemTarget): void {
  item.libraryID = target.libraryID;
  item.setCollections(
    Array.from(new Set(target.collectionIDs)).filter(
      (id): id is number => typeof id === "number",
    ),
  );
  for (const tag of target.tags ?? []) {
    if (typeof tag === "string" && tag.trim()) item.addTag(tag.trim());
  }
}

/**
 * Save a new item, marked as the plugin's, without selecting it (the item
 * the user is looking at stays selected), then its child note, if any
 */
export async function saveNewItem(
  item: Zotero.Item,
  target: NewItemTarget,
): Promise<void> {
  markCreatedByPlugin(item);
  await saveItemWithPendingInspireNote(item, { skipSelect: true });
  if (target.note) {
    const note = new Zotero.Item("note");
    note.setNote(target.note);
    note.parentID = item.id;
    note.libraryID = item.libraryID;
    await note.saveTx({ skipSelect: true });
  }
}

/** A new item in `target` from an INSPIRE record's metadata (fetchInspireMetaByRecid) */
export async function createItemFromInspireMeta(
  meta: jsobject,
  target: NewItemTarget,
): Promise<Zotero.Item> {
  const item = new Zotero.Item(
    resolveNewItemType(meta as any, getItemTypePolicy()),
  );
  placeNewItem(item, target);
  item.setField("extra", "");
  await setInspireMeta(item, meta, "full");
  await saveNewItem(item, target);
  return item;
}

/**
 * A new item in `target` from the INSPIRE record `recid`; null when INSPIRE
 * gives no record
 */
export async function createItemFromInspireRecord(
  recid: string,
  target: NewItemTarget,
  signal?: AbortSignal,
): Promise<Zotero.Item | null> {
  const meta = await fetchInspireMetaByRecid(recid, signal);
  if (meta === -1) return null;
  return createItemFromInspireMeta(meta, target);
}
