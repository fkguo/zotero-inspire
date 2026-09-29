// ─────────────────────────────────────────────────────────────────────────────
// The PDF of a paper in the library: its item's first PDF attachment, opened
// in Zotero's reader. The References panel's green PDF button and the arXiv
// browser's use these.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { ReaderTabHelper } from "../utils";
import { loadedItem } from "./localStatus";

/**
 * The ID of the item's first PDF attachment, or null (also for an item of a
 * library whose items are not loaded yet, or are being loaded: the item is
 * there before its attachments are)
 */
export function firstPdfAttachmentID(parentItemID: number): number | null {
  const parentItem = loadedItem(parentItemID);
  if (!parentItem) {
    return null;
  }
  let attachmentIDs: number[];
  try {
    attachmentIDs = parentItem.getAttachments?.() || [];
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "UnloadedDataException") {
      return null;
    }
    throw err;
  }
  for (const id of attachmentIDs) {
    const attachment = Zotero.Items.get(id) as Zotero.Item | undefined;
    if (attachment?.isPDFAttachment?.()) {
      return id;
    }
  }
  return null;
}

/**
 * Open the item's first PDF in Zotero's reader and bring it to the front;
 * false when the item has none or it could not be opened
 */
export async function openLocalPdf(itemID: number): Promise<boolean> {
  if (!Zotero.Reader || typeof Zotero.Reader.open !== "function") {
    return false;
  }
  try {
    const attachmentID = firstPdfAttachmentID(itemID);
    if (!attachmentID) {
      return false;
    }
    const reader =
      (await Zotero.Reader.open(attachmentID, undefined, {
        allowDuplicate: false,
      })) || null;
    if (reader) {
      ReaderTabHelper.focusReader(reader as _ZoteroTypes.ReaderInstance);
      return true;
    }
    return false;
  } catch (err) {
    Zotero.debug(
      `[${config.addonName}] Failed to open PDF for item ${itemID}: ${err}`,
    );
    return false;
  }
}
