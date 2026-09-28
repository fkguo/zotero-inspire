// ─────────────────────────────────────────────────────────────────────────────
// The arXiv browser's "in library" marks, from the library index: the items
// with a paper's arXiv identifier in any library, items in the trash left
// out, in the index's order (the References panel's: items with an INSPIRE
// recid first, then by item ID). When the library cannot be read, nothing
// is known.
// ─────────────────────────────────────────────────────────────────────────────

import {
  findItemsByArxivs,
  LibraryIndexError,
} from "../../inspire/library/arxivIndex";

/**
 * The items with each of `ids` that has any, the one a click selects first;
 * null when the library cannot be read
 */
export async function itemsWithArxivIds(
  ids: readonly string[],
): Promise<ReadonlyMap<string, number[]> | null> {
  let found;
  try {
    found = await findItemsByArxivs([...ids]);
  } catch (error) {
    if (error instanceof LibraryIndexError) return null;
    throw error;
  }
  return new Map(
    [...found].map(([id, hits]) => [id, hits.map((hit) => hit.itemID)]),
  );
}
