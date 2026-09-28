// ─────────────────────────────────────────────────────────────────────────────
// The number of papers an author has in the user's personal library, for the
// local form of the author card: items (not in the trash) with a creator of
// the same surname whose first name starts with the same letter ("Pathak,
// Krishna Kingkar" counts "Pathak, K." and "Pathak, Krishna"), also when
// Zotero keeps the name in one field ("Krishna Kingkar Pathak", "K. K.
// Pathak"). A simple query; the relevance stage computes the design's author
// count.
// ─────────────────────────────────────────────────────────────────────────────

/** "Family, Given" (or a name kept in one field) as family and first letter */
function splitName(fullName: string): { family: string; initial?: string } {
  const comma = fullName.indexOf(",");
  if (comma < 0) return { family: fullName.trim() };
  const family = fullName.slice(0, comma).trim();
  const initial = fullName
    .slice(comma + 1)
    .trim()
    .charAt(0);
  return initial ? { family, initial } : { family };
}

export async function countAuthorPapers(
  fullName: string,
  libraryID: number = Zotero.Libraries.userLibraryID,
): Promise<number> {
  const { family, initial } = splitName(fullName);
  if (!family) return 0;
  const params: Array<string | number> = [libraryID];
  let names = "C.lastName = ? COLLATE NOCASE";
  if (initial) {
    // Two fields: surname and first letter; one field: that letter first and
    // the surname last
    names = `((C.fieldMode = 0 AND C.lastName = ? COLLATE NOCASE
        AND C.firstName LIKE ?)
      OR (C.fieldMode = 1 AND C.lastName LIKE ?))`;
    params.push(family, `${initial}%`, `${initial}% ${family}`);
  } else {
    params.push(family);
  }
  const count = await Zotero.DB.valueQueryAsync(
    `SELECT COUNT(DISTINCT IC.itemID)
    FROM itemCreators IC
    JOIN creators C ON C.creatorID = IC.creatorID
    JOIN items I ON I.itemID = IC.itemID
    WHERE I.libraryID = ?
      AND ${names}
      AND I.itemID NOT IN (SELECT itemID FROM deletedItems)`,
    params,
  );
  return Number(count) || 0;
}
