// ─────────────────────────────────────────────────────────────────────────────
// itemTypePolicy.ts - Decide which Zotero item type an item should have
// after it has been matched to an INSPIRE record.
//
// Pure functions only (no Zotero globals) so the decision can be unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

/** Subset of INSPIRE metadata relevant to the item-type decision. */
export interface ItemTypeMeta {
  /** Journal abbreviation; set only when INSPIRE has journal publication info. */
  journalAbbreviation?: string;
  /** INSPIRE document_type (normally an array such as ["article"]). */
  document_type?: string[] | string;
}

export interface ItemTypePolicy {
  /**
   * Keep Preprint / Report items as they are while the paper is unpublished.
   * When false (historical behaviour) they are always converted to
   * Journal Article once an INSPIRE record is found.
   */
  keepPreprintType: boolean;
}

/**
 * Build the effective policy from the two raw preference values.
 * The legacy "arXiv ID into Journal Abbr." option needs the Journal Article
 * type (only that type has the field), so while it is on the
 * "keep preprint type" option is ignored.
 */
export function policyFromPrefs(
  keepPreprintTypePref: unknown,
  arxivInJournalAbbrevPref: unknown,
): ItemTypePolicy {
  return {
    keepPreprintType:
      keepPreprintTypePref === true && arxivInJournalAbbrevPref !== true,
  };
}

/** Item types that are historically normalized to journalArticle. */
const PREPRINT_LIKE_TYPES: ReadonlySet<string> = new Set([
  "preprint",
  "report",
]);

/**
 * True when INSPIRE reports a journal publication for the record.
 * `journalAbbreviation` is only filled from `publication_info` entries that
 * carry a `journal_title`, so it is the same signal used for volume/pages.
 */
export function hasJournalPublicationInfo(meta: ItemTypeMeta): boolean {
  return (
    typeof meta.journalAbbreviation === "string" &&
    meta.journalAbbreviation.trim().length > 0
  );
}

/**
 * True when the INSPIRE record is a book.
 * Mirrors the historical `document_type == "book"` loose comparison, which is
 * true for the string "book" or for a single-element array ["book"].
 */
export function isBookRecord(meta: ItemTypeMeta): boolean {
  const dt = meta.document_type;
  if (Array.isArray(dt)) return dt.length === 1 && dt[0] === "book";
  return dt === "book";
}

/**
 * Resolve the item type an item should be converted to after an INSPIRE match.
 *
 * Rules (applied in order, matching the historical behaviour):
 * 1. `preprint` / `report` become `journalArticle`, unless the policy keeps
 *    them and INSPIRE has no journal publication info yet.
 * 2. Anything that is not already a `book` becomes `book` when INSPIRE says
 *    the record is a book.
 *
 * @returns the target item type, or `null` when the type must stay unchanged.
 */
export function resolveInspireItemType(
  currentType: string,
  meta: ItemTypeMeta,
  policy: ItemTypePolicy,
): "journalArticle" | "book" | null {
  let type = currentType;

  if (PREPRINT_LIKE_TYPES.has(type)) {
    if (!policy.keepPreprintType || hasJournalPublicationInfo(meta)) {
      type = "journalArticle";
    }
  }

  if (type !== "book" && isBookRecord(meta)) {
    type = "book";
  }

  if (type === currentType) return null;
  return type as "journalArticle" | "book";
}
