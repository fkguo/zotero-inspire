export type ReaderSelectionRect = [number, number, number, number];

export interface ReaderSelectionPosition {
  pageIndex?: number;
  rects?: ReaderSelectionRect[];
  /** When a selection spans pages, rects for the next page (pageIndex + 1). */
  nextPageRects?: ReaderSelectionRect[];
}

export interface ReaderSelectionPayload {
  source: "zotero_reader_selection";
  parentItemID: number;
  parentItemKey?: string;
  attachmentItemID: number;
  attachmentItemKey?: string;
  readerTabID?: string;
  pageIndex?: number;
  pageLabel?: string;
  text: string;
  position?: ReaderSelectionPosition;
  createdAt: number;
}

export function formatReaderSelectionEvidence(
  selection: ReaderSelectionPayload,
  options?: { maxChars?: number },
): string {
  const maxChars =
    typeof options?.maxChars === "number" && options.maxChars > 0
      ? Math.floor(options.maxChars)
      : 2400;

  const pageLabel =
    typeof selection.pageLabel === "string" && selection.pageLabel.trim()
      ? selection.pageLabel.trim()
      : typeof selection.pageIndex === "number" && Number.isFinite(selection.pageIndex)
        ? String(selection.pageIndex + 1)
        : "";

  const parentRef =
    selection.parentItemKey || (selection.parentItemID ? String(selection.parentItemID) : "");
  const attachmentRef =
    selection.attachmentItemKey ||
    (selection.attachmentItemID ? String(selection.attachmentItemID) : "");

  const rectCount = Array.isArray(selection.position?.rects)
    ? selection.position!.rects!.length
    : 0;
  const nextRectCount = Array.isArray(selection.position?.nextPageRects)
    ? selection.position!.nextPageRects!.length
    : 0;

  const rawText = String(selection.text || "").trim();
  const clipped =
    rawText.length > maxChars ? `${rawText.slice(0, maxChars)}…` : rawText;
  const clipNote =
    rawText.length > maxChars ? `\n(Selection truncated to ${maxChars} chars.)` : "";

  return `[SEL]
Parent: ${parentRef}
Attachment: ${attachmentRef}
Page: ${pageLabel || "(unknown)"}
Rects: ${rectCount}${nextRectCount ? ` (+${nextRectCount} next page)` : ""}
Text:
${clipped}${clipNote}
`;
}

