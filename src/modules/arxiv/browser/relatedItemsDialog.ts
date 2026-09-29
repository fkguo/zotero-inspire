// ─────────────────────────────────────────────────────────────────────────────
// The items a paper of the arXiv browser is related to are chosen in Zotero's
// Select Items dialog, as the item pane's Related section chooses them: the
// regular items of the paper's library (Zotero relates items of one library
// only), one or several.
// ─────────────────────────────────────────────────────────────────────────────

/** Asks for the items to relate a paper to, among those of `libraryID` */
export type PickRelatedItems = (
  win: Window,
  libraryID: number,
) => Promise<Zotero.Item[]>;

/** Zotero's Select Items dialog; no items when it is closed without a choice */
export const selectItemsDialog: PickRelatedItems = async (win, libraryID) => {
  const io: Record<string, unknown> = {
    dataIn: null,
    dataOut: null,
    deferred: Zotero.Promise.defer(),
    itemTreeID: "zoteroinspire-arxiv-relation-select-item",
    onlyRegularItems: true,
    filterLibraryIDs: [libraryID],
  };
  win.openDialog(
    "chrome://zotero/content/selectItemsDialog.xhtml",
    "",
    "chrome,dialog=no,centerscreen,resizable=yes",
    io,
  );
  await (io.deferred as { promise: Promise<void> }).promise;
  const ids = (io.dataOut as number[] | null) ?? [];
  if (!ids.length) return [];
  const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
  return items.filter((item) => item && item.isRegularItem());
};
