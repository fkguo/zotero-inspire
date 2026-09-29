// ─────────────────────────────────────────────────────────────────────────────
// The batch import (BatchImportManager) of arXiv papers: each paper added by
// the route its data allow (addToLibrary.ts). INSPIRE and the arXiv API are
// asked about all the papers of the import at once, before the first is
// added, rather than once per paper; the rows of one paper are one paper to
// the manager, which writes the outcome to each of them.
// ─────────────────────────────────────────────────────────────────────────────

import { entryArxivId } from "../inspire/library/localStatus";
import type { BatchImportManagerOptions } from "../inspire/panel/BatchImportManager";
import type { InspireReferenceEntry } from "../inspire/types";
import {
  prepareArxivAdd,
  type AddOptions,
  type AddPaperRequest,
  type ArxivAdder,
} from "./addToLibrary";
import type { BrowserEntry } from "./browser/browserList";

/**
 * The add request of a row showing an arXiv paper: the paper, with its
 * authors as the listing splits them when the row is the arXiv browser's
 */
export function arxivAddRequest(
  entry: InspireReferenceEntry,
): AddPaperRequest | null {
  const arxivId = entryArxivId(entry);
  if (!arxivId) return null;
  const listing = (entry as Partial<BrowserEntry>).listing;
  return { arxivId, ...(listing ? { listingAuthors: listing.authors } : {}) };
}

/**
 * The manager's import callbacks for rows of arXiv papers. `requestOf` gives
 * a row's request, with the user's choices for it (null: not an arXiv
 * paper); `options` are the add options besides the cancel (the PDF).
 */
export function arxivBatchImport(
  requestOf: (
    entry: InspireReferenceEntry,
  ) => AddPaperRequest | null = arxivAddRequest,
  options: Omit<AddOptions, "signal"> = {},
): Required<
  Pick<BatchImportManagerOptions, "canImport" | "prepareImport" | "importEntry">
> {
  // The adder of the import under way (one batch import at a time)
  let adder: Promise<ArxivAdder> | undefined;
  return {
    canImport: (entry) => requestOf(entry) !== null,
    prepareImport: async (entries, target, signal) => {
      adder = prepareArxivAdd(
        entries.map((entry) => requestOf(entry)!),
        target,
        { ...options, signal },
      );
      await adder;
    },
    importEntry: async (entry) => {
      if (!adder) throw new Error("The import was not prepared");
      return (await adder).add(requestOf(entry)!);
    },
  };
}
