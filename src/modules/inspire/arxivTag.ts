// ─────────────────────────────────────────────────────────────────────────────
// The arXiv category tag an item gets when the "arXiv category tag" option is
// on: the paper's primary category (hep-ph, math.RT). Every writer of the
// plugin tags through here: the INSPIRE import and updates, the CrossRef
// update, the preprint watch's publication update, and the arXiv browser's
// items from arXiv data and from a journal DOI.
// ─────────────────────────────────────────────────────────────────────────────

import { getPref } from "../../utils/prefs";

const NEW_STYLE_LINE = /arXiv:\d{4}\.\d{4,5}\s*\[([^\]]+)\]/i;
const OLD_STYLE_LINE = /arXiv:([a-z-]+)\/\d{7}/i;

/**
 * Tag `item` with its primary arXiv category, when the option is on:
 * `primaryCategory` when the caller knows it (INSPIRE's or arXiv's data),
 * else the category of Extra's "arXiv:<id> [category]" line, else the
 * archive of an old-style identifier (arXiv:math/0501001 -> math). An item
 * that already carries the archive tag of its old-style identifier, as
 * earlier versions tagged it, is left as it is. Returns whether a tag was
 * added (the item is not saved).
 */
export function addArxivCategoryTag(
  item: Zotero.Item,
  primaryCategory?: string,
): boolean {
  if (!getPref("arxiv_tag_enable")) return false;
  const extra = (item.getField("extra") as string) || "";
  const newStyle = extra.match(NEW_STYLE_LINE);
  const oldStyle = newStyle ? null : extra.match(OLD_STYLE_LINE);
  const category = primaryCategory?.trim() || newStyle?.[1] || oldStyle?.[1];
  if (!category || item.hasTag(category)) return false;
  if (oldStyle && item.hasTag(oldStyle[1])) return false;
  item.addTag(category);
  return true;
}
