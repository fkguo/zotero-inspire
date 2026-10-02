// ─────────────────────────────────────────────────────────────────────────────
// The PDF of a paper in the library: its item's first PDF attachment, opened
// in Zotero's reader, or Zotero's Find Full Text for an item without one. The
// References panel's PDF buttons and the arXiv browser's use these; the arXiv
// browser also opens HTML snapshots so.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { PdfButtonState, renderPdfButtonIcon } from "../../pickerUI";
import { isDarkMode } from "../styles";
import { ReaderTabHelper } from "../utils";
import { loadedItem } from "./localStatus";

/**
 * The ID of the item's first attachment that `matches`, or null (also for an
 * item of a library whose items are not loaded yet, or are being loaded: the
 * item is there before its attachments are)
 */
export function firstAttachmentID(
  parentItemID: number,
  matches: (attachment: Zotero.Item) => boolean,
): number | null {
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
    if (attachment && matches(attachment)) {
      return id;
    }
  }
  return null;
}

/** The ID of the item's first PDF attachment, or null (firstAttachmentID) */
export function firstPdfAttachmentID(parentItemID: number): number | null {
  return firstAttachmentID(
    parentItemID,
    (attachment) => !!attachment.isPDFAttachment?.(),
  );
}

/**
 * Open the item's first PDF in Zotero's reader and bring it to the front;
 * false when the item has none or it could not be opened
 */
export async function openLocalPdf(itemID: number): Promise<boolean> {
  const attachmentID = firstPdfAttachmentID(itemID);
  return attachmentID ? openAttachment(attachmentID) : false;
}

/**
 * Open an attachment (a PDF, a snapshot) in Zotero's reader and bring it to
 * the front; false when it could not be opened
 */
export async function openAttachment(attachmentID: number): Promise<boolean> {
  if (!Zotero.Reader || typeof Zotero.Reader.open !== "function") {
    return false;
  }
  try {
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
      `[${config.addonName}] Failed to open attachment ${attachmentID}: ${err}`,
    );
    return false;
  }
}

/**
 * Zotero's Find Full Text (its items menu's command) on one item, in the
 * main window's context so that its views follow the new attachment. Zotero
 * shows its progress, and that it found nothing; it skips an item that has a
 * PDF already. Resolves to the ID of the item's PDF then, or null.
 */
export async function findFullText(itemID: number): Promise<number | null> {
  try {
    const mainWin = Zotero.getMainWindow?.() as any;
    const Z: any = mainWin?.Zotero || Zotero;
    const item =
      typeof Z.Items?.get === "function"
        ? Z.Items.get(itemID)
        : Zotero.Items.get(itemID);
    const attachmentsAPI: any = Z.Attachments || Zotero.Attachments;
    if (!item || typeof attachmentsAPI?.addAvailableFiles !== "function") {
      return null;
    }
    await attachmentsAPI.addAvailableFiles([item]);
    // Some environments update attachments asynchronously after the promise
    // resolves: poll briefly
    const pdfID = await waitForFirstPdfAttachmentID(itemID);
    if (pdfID) {
      // Show the new attachment in the main window immediately
      await notifyItemModifiedForUI(itemID, pdfID);
    }
    return pdfID;
  } catch (err) {
    Zotero.debug(`[${config.addonName}] Find Full Text failed: ${err}`);
    return null;
  }
}

/**
 * A PDF button's download icon clicked: ⏳ while `search` (findFullText)
 * runs, then the green icon if it found a PDF, else the download icon again,
 * unless the button shows another paper by then (`showing` false). Resolves
 * to the search's result.
 */
export async function showFullTextSearch(
  button: HTMLButtonElement,
  search: Promise<number | null>,
  showing: () => boolean,
  strings: { pdfOpen: string; pdfFind: string },
): Promise<number | null> {
  const doc = button.ownerDocument;
  const loading = doc.createElement("span");
  loading.textContent = "⏳";
  loading.style.fontSize = "12px";
  button.replaceChildren(loading);
  button.disabled = true;
  const pdfID = await search;
  if (showing()) {
    renderPdfButtonIcon(
      doc,
      button,
      pdfID ? PdfButtonState.HAS_PDF : PdfButtonState.FIND_PDF,
      strings,
      isDarkMode(doc),
    );
  }
  return pdfID;
}

async function waitForFirstPdfAttachmentID(
  parentItemID: number,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<number | null> {
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : 4000;
  const intervalMs =
    typeof options.intervalMs === "number" && options.intervalMs > 0
      ? options.intervalMs
      : 200;

  const deadline = Date.now() + timeoutMs;
  let pdfID = firstPdfAttachmentID(parentItemID);
  while (!pdfID && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    pdfID = firstPdfAttachmentID(parentItemID);
  }
  return pdfID;
}

async function notifyItemModifiedForUI(
  parentItemID: number,
  attachmentItemID?: number,
): Promise<void> {
  const mainWin = Zotero.getMainWindow?.() as any;
  const notifier: any = mainWin?.Zotero?.Notifier || (Zotero.Notifier as any);

  // Prime best-attachment cache so the main items view (hasAttachment column) can show the icon
  // without waiting for the delayed itemTree cell refresh.
  try {
    const Z: any = mainWin?.Zotero || Zotero;
    const parentItem =
      typeof Z.Items?.get === "function"
        ? Z.Items.get(parentItemID)
        : Zotero.Items.get(parentItemID);
    await parentItem?.getBestAttachmentState?.();
  } catch {
    // ignore
  }

  // Prefer Zotero.Notifier.trigger(..., force=true) to avoid being queued in an open transaction.
  try {
    if (typeof notifier?.trigger === "function") {
      if (attachmentItemID) {
        // Update attachments box rows without selecting anything (avoid "add" side effects)
        await notifier.trigger("refresh", "item", [attachmentItemID], {}, true);
      }
      // Ensure itemTree re-renders the row, so the hasAttachment cell schedules
      // (or immediately reflects) bestAttachmentState updates.
      await notifier.trigger("refresh", "item", [parentItemID], {}, true);
      await notifier.trigger("modify", "item", [parentItemID], {}, true);
      await notifier.trigger("redraw", "item", [parentItemID], {}, true);
    } else if (typeof notifier?.notify === "function") {
      if (attachmentItemID) {
        notifier.notify("refresh", "item", [attachmentItemID], {}, true);
      }
      notifier.notify("refresh", "item", [parentItemID], {}, true);
      notifier.notify("modify", "item", [parentItemID], {}, true);
      notifier.notify("redraw", "item", [parentItemID], {}, true);
    }
  } catch {
    // ignore
  }

  // Best-effort UI refresh fallback (some Zotero builds cache attachment state in views).
  try {
    const pane: any =
      Zotero.getActiveZoteroPane?.() ||
      mainWin?.ZoteroPane ||
      (globalThis as any).ZoteroPane;

    if (attachmentItemID && typeof pane?.itemsView?.notify === "function") {
      await pane.itemsView.notify("refresh", "item", [attachmentItemID], {});
    }
    if (typeof pane?.itemsView?.notify === "function") {
      await pane.itemsView.notify("refresh", "item", [parentItemID], {});
      await pane.itemsView.notify("modify", "item", [parentItemID], {});
      await pane.itemsView.notify("redraw", "item", [parentItemID], {});
    }

    pane?.itemPane?.refresh?.();
    pane?.itemsView?.invalidate?.();
  } catch {
    // ignore
  }
}
