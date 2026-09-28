// ─────────────────────────────────────────────────────────────────────────────
// Which papers of a list are in the library: the "in library" marks of the
// References panel and the citation graph, and the batch import's duplicate
// check. Both read the library index (arxivIndex.ts).
//
// A paper's marks are recomputed from the index each time: when its list is
// shown and when the library changes. They depend on the library only, so
// lists shared between items (the References cache is kept per recid, author
// lists per author) can hold them. Whether a paper's item is related to the
// item shown is not stored here: it depends on the item shown, and the panel
// works it out when it draws.
// ─────────────────────────────────────────────────────────────────────────────

import type { InspireReferenceEntry } from "../types";
import { LibraryIndexError, libraryLookup } from "./arxivIndex";

/** A paper whose marks are shown: a list entry or a citation graph node */
export interface LocalPaper {
  recid?: string;
  /** The first of localItemIDs: the item a click selects */
  localItemID?: number;
  /**
   * The items with the paper's recid (or arXiv identifier, see localFoundBy),
   * those with a recid first, then by item ID; set when there is one at least
   */
  localItemIDs?: number[];
  /** The library could not be read: whether the paper is in it is unknown */
  localStatusUnknown?: boolean;
  /**
   * The items were found by the paper's arXiv identifier, not its recid (the
   * arXiv browser's lists)
   */
  localFoundBy?: "arxiv";
}

/**
 * The item with `itemID`, or null when there is none or its library's items
 * are not loaded yet: Zotero loads the items of a library when the library
 * is first shown or synced (a group library, say), and until then
 * Zotero.Items.get throws for them
 */
export function loadedItem(itemID: number): Zotero.Item | null {
  try {
    return (Zotero.Items.get(itemID) as Zotero.Item | false) || null;
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "UnloadedDataException") {
      return null;
    }
    throw err;
  }
}

/** Number of the latest refresh, and the refresh each paper belongs to */
let latestRefresh = 0;
const refreshOf = new WeakMap<object, number>();
/** The refreshes under way, by number, each until it has written its marks */
const refreshesUnderWay = new Map<number, Promise<void>>();

/**
 * Recompute which papers are in the library, by their INSPIRE recid (the
 * lookup the References panel and the citation graph make), in every
 * library, items in the trash left out. The new marks of all papers are
 * computed first, then written at once. A paper that a later refresh took
 * over keeps that refresh's marks, whichever finishes first; this one
 * returns once they are written, so that every paper has its current marks
 * when it returns. When the library cannot be read, the papers are marked
 * unknown rather than "not in the library". Returns the papers whose marks
 * this refresh changed.
 */
export async function refreshLocalState<T extends LocalPaper>(
  papers: readonly T[],
): Promise<T[]> {
  const refresh = ++latestRefresh;
  for (const paper of papers) refreshOf.set(paper, refresh);
  let written!: () => void;
  refreshesUnderWay.set(
    refresh,
    new Promise<void>((resolve) => (written = resolve)),
  );
  try {
    let marks: LocalPaper[];
    try {
      const lookup = await libraryLookup();
      marks = papers.map((paper) => {
        const hits = paper.recid ? lookup.byRecid(paper.recid) : [];
        return hits.length
          ? {
              localItemID: hits[0].itemID,
              localItemIDs: hits.map((hit) => hit.itemID),
            }
          : {};
      });
    } catch (err) {
      if (!(err instanceof LibraryIndexError)) throw err;
      marks = papers.map(() => ({ localStatusUnknown: true }));
    }

    const changed: T[] = [];
    const later = new Set<number>();
    papers.forEach((paper, i) => {
      const owner = refreshOf.get(paper)!;
      if (owner !== refresh) later.add(owner);
      else if (writeMarks(paper, marks[i])) changed.push(paper);
    });
    // Later refreshes wait only for ones later still
    await Promise.all([...later].map((n) => refreshesUnderWay.get(n)));
    return changed;
  } finally {
    refreshesUnderWay.delete(refresh);
    written();
  }
}

/** Give `paper` the marks `next`; true if they differ from its old ones */
export function writeMarks(paper: LocalPaper, next: LocalPaper): boolean {
  const same =
    paper.localItemID === next.localItemID &&
    Boolean(paper.localStatusUnknown) === Boolean(next.localStatusUnknown) &&
    (paper.localItemIDs ?? []).join(" ") ===
      (next.localItemIDs ?? []).join(" ") &&
    paper.localFoundBy === next.localFoundBy;
  if (next.localItemID === undefined) delete paper.localItemID;
  else paper.localItemID = next.localItemID;
  if (next.localItemIDs === undefined) delete paper.localItemIDs;
  else paper.localItemIDs = next.localItemIDs;
  if (next.localStatusUnknown) paper.localStatusUnknown = true;
  else delete paper.localStatusUnknown;
  if (next.localFoundBy) paper.localFoundBy = next.localFoundBy;
  else delete paper.localFoundBy;
  return !same;
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate check of the batch import
// ─────────────────────────────────────────────────────────────────────────────

/** A paper already in the library, and the identifier it was found by */
export interface DuplicateInfo {
  localItemID: number;
  matchType: "recid" | "arxiv" | "doi";
}

/**
 * The papers of `entries` that have an item in the library (any library,
 * items in the trash left out), found by recid, else by arXiv ID, else by
 * DOI; of several items, the first (with a recid first, then by item ID).
 * Keyed by entry ID. Rejects with LibraryIndexError when the library cannot
 * be read: without the check, papers already there would be added again.
 */
export async function findDuplicates(
  entries: readonly InspireReferenceEntry[],
): Promise<Map<string, DuplicateInfo>> {
  const duplicates = new Map<string, DuplicateInfo>();
  if (!entries.length) return duplicates;
  const lookup = await libraryLookup();
  for (const entry of entries) {
    const arxivId =
      typeof entry.arxivDetails === "object"
        ? entry.arxivDetails?.id
        : undefined;
    const matches: [DuplicateInfo["matchType"], number | undefined][] = [
      [
        "recid",
        entry.recid ? lookup.byRecid(entry.recid)[0]?.itemID : undefined,
      ],
      ["arxiv", arxivId ? lookup.byArxiv(arxivId)[0]?.itemID : undefined],
      ["doi", entry.doi ? lookup.byDOI(entry.doi)[0]?.itemID : undefined],
    ];
    const match = matches.find(([, itemID]) => itemID !== undefined);
    if (match) {
      duplicates.set(entry.id, { localItemID: match[1]!, matchType: match[0] });
    }
  }
  return duplicates;
}
