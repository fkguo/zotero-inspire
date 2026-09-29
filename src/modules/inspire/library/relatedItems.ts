// ─────────────────────────────────────────────────────────────────────────────
// Relating library items to each other ("Related" in Zotero), as Zotero's own
// Related section does it (relatedBox.js): both directions in one
// transaction, one step of Edit → Undo, and the items' Date Modified left as
// it is (the change syncs as usual). Items of two libraries cannot be
// related; such a request changes nothing.
// ─────────────────────────────────────────────────────────────────────────────

export type RelationChange =
  /** `items` (of the targets) were related or unrelated to the source */
  | { status: "changed"; items: Zotero.Item[] }
  /** Nothing to change: already related (or not related) */
  | { status: "unchanged" }
  /** A target is in another library than the source: nothing changed */
  | { status: "otherLibrary" };

/** Relate `source` and each of `targets`, both ways */
export function linkItems(
  source: Zotero.Item,
  targets: readonly Zotero.Item[],
): Promise<RelationChange> {
  return changeRelations(source, targets, true);
}

/** Remove the relations between `source` and each of `targets` */
export function unlinkItems(
  source: Zotero.Item,
  targets: readonly Zotero.Item[],
): Promise<RelationChange> {
  return changeRelations(source, targets, false);
}

async function changeRelations(
  source: Zotero.Item,
  targets: readonly Zotero.Item[],
  relate: boolean,
): Promise<RelationChange> {
  const others = targets.filter((target) => target.id !== source.id);
  if (others.some((target) => target.libraryID !== source.libraryID)) {
    return { status: "otherLibrary" };
  }
  if (!others.length) return { status: "unchanged" };
  // Relations of a library's items are there once its data is loaded
  const library = Zotero.Libraries.get(source.libraryID);
  if (library) await library.waitForDataLoad("item");

  const changed: Zotero.Item[] = [];
  const save = (item: Zotero.Item) =>
    item.save({ skipDateModifiedUpdate: true });
  await Zotero.DB.executeTransaction(async () => {
    // One undo step for the whole change (Zotero 10's Edit → Undo)
    (Zotero as any).UndoHistory?.stageAction(
      relate ? "undo-action-add-related" : "undo-action-remove-related",
    );
    for (const target of others) {
      let changedHere = false;
      if (
        relate
          ? source.addRelatedItem(target)
          : await source.removeRelatedItem(target)
      ) {
        await save(source);
        changedHere = true;
      }
      if (
        relate
          ? target.addRelatedItem(source)
          : await target.removeRelatedItem(source)
      ) {
        await save(target);
        changedHere = true;
      }
      if (changedHere) changed.push(target);
    }
  });
  return changed.length
    ? { status: "changed", items: changed }
    : { status: "unchanged" };
}
