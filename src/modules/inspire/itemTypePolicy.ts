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
  /** arXiv identifier of the record, when it has one. */
  arxiv?: { value?: string } | null;
}

/**
 * Journal-related fields of the Zotero item itself. Used to make sure an
 * item is only turned back into a Preprint when neither INSPIRE nor the
 * item carries journal publication data.
 */
export interface LocalPublicationFields {
  journalAbbreviation?: string;
  publicationTitle?: string;
  volume?: string;
  pages?: string;
  DOI?: string;
}

export type TargetItemType = "journalArticle" | "book" | "preprint";

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

/** arXiv DOIs (10.48550/arXiv.xxxx) are not journal DOIs. */
const ARXIV_DOI_REGEX = /^10\.48550\/arXiv\./i;

/**
 * True when the Zotero item itself already holds journal publication data:
 * a journal name (not an "arXiv:..." placeholder), a volume, pages, or a
 * non-arXiv DOI. Such an item is never turned back into a Preprint.
 */
export function hasLocalPublicationInfo(
  fields: LocalPublicationFields,
): boolean {
  const journalAbbrev = (fields.journalAbbreviation ?? "").trim();
  if (journalAbbrev && !/^arXiv:/i.test(journalAbbrev)) return true;
  const publicationTitle = (fields.publicationTitle ?? "").trim();
  if (publicationTitle && !/arxiv/i.test(publicationTitle)) return true;
  if ((fields.volume ?? "").trim()) return true;
  if ((fields.pages ?? "").trim()) return true;
  const doi = (fields.DOI ?? "").trim();
  if (doi && !ARXIV_DOI_REGEX.test(doi)) return true;
  return false;
}

/** True when the record is an unpublished arXiv paper (not a book). */
function isUnpublishedArxivRecord(meta: ItemTypeMeta): boolean {
  return (
    Boolean(meta.arxiv?.value) &&
    !hasJournalPublicationInfo(meta) &&
    !isBookRecord(meta)
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
 * Rules (applied in order; 1 and 3 match the historical behaviour):
 * 1. `preprint` / `report` become `journalArticle`, unless the policy keeps
 *    them and INSPIRE has no journal publication info yet.
 * 2. With the keep-preprint policy, a `journalArticle` that is an unpublished
 *    arXiv paper on INSPIRE and carries no journal data locally becomes
 *    `preprint` again (undoes the historical conversion). This needs the
 *    item's own journal fields (`local`); when they are not supplied, e.g.
 *    for citation-count-only requests that carry no publication data, the
 *    rule is skipped.
 * 3. Anything that is not already a `book` becomes `book` when INSPIRE says
 *    the record is a book.
 *
 * @returns the target item type, or `null` when the type must stay unchanged.
 */
export function resolveInspireItemType(
  currentType: string,
  meta: ItemTypeMeta,
  policy: ItemTypePolicy,
  local?: LocalPublicationFields,
): TargetItemType | null {
  let type = currentType;

  if (PREPRINT_LIKE_TYPES.has(type)) {
    if (!policy.keepPreprintType || hasJournalPublicationInfo(meta)) {
      type = "journalArticle";
    }
  }

  if (
    policy.keepPreprintType &&
    type === "journalArticle" &&
    currentType === "journalArticle" &&
    local !== undefined &&
    isUnpublishedArxivRecord(meta) &&
    !hasLocalPublicationInfo(local)
  ) {
    type = "preprint";
  }

  if (type !== "book" && isBookRecord(meta)) {
    type = "book";
  }

  if (type === currentType) return null;
  return type as TargetItemType;
}

/**
 * Item type for a brand-new Zotero item created from an INSPIRE record
 * (panel import). Unpublished arXiv papers become `preprint` under the
 * keep-preprint policy; everything else keeps the historical `journalArticle`.
 */
export function resolveNewItemType(
  meta: ItemTypeMeta,
  policy: ItemTypePolicy,
): "journalArticle" | "preprint" {
  if (policy.keepPreprintType && isUnpublishedArxivRecord(meta)) {
    return "preprint";
  }
  return "journalArticle";
}
