// ─────────────────────────────────────────────────────────────────────────────
// A library item from arXiv data, for a paper INSPIRE has no record of (a
// paper announced hours ago, or outside INSPIRE's subjects). The fields are
// laid out as the plugin lays out an arXiv preprint it imports from INSPIRE,
// so the duplicate check, the preprint watch and the arXiv column read them
// alike; two differences on purpose: the whole author list is kept (arXiv
// data cannot be fetched again later the way an INSPIRE record can), and the
// DOI is arXiv's own, 10.48550/arXiv.<id>, as Zotero's arXiv translator
// writes it. Bibliographic fields come from the arXiv API's current version.
// The category tag (under its option) is the primary category, also for an
// old-style identifier, which the INSPIRE import tags with its archive.
// ─────────────────────────────────────────────────────────────────────────────

import { cleanMathTitle } from "../../utils/mathTitle";
import { getPref } from "../../utils/prefs";
import {
  arxivExtraLine,
  getItemTypePolicy,
  setPreprintArxivFields,
} from "../inspire/itemUpdater";
import {
  placeNewItem,
  saveNewItem,
  type NewItemTarget,
} from "../inspire/library/itemCreation";
import type { ArxivApiEntry } from "./arxivApi";
import type { ListingAuthor } from "./listingTypes";

type Creator =
  | { creatorType: "author"; firstName: string; lastName: string }
  | { creatorType: "author"; name: string };

/** A name without accents, case and extra spaces, for comparing names */
function foldName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The authors of a paper as Zotero creators. The API gives whole names
 * only; where the listing page shows the same author at the same place, its
 * split into family and given name is used (arXiv's own, which gets
 * particles such as "Di Vora" right); any other author is kept whole in one
 * field rather than split by guess.
 */
export function arxivCreators(
  apiAuthors: readonly string[],
  listingAuthors: readonly ListingAuthor[] = [],
): Creator[] {
  return apiAuthors.map((name, i) => {
    const listed = listingAuthors[i];
    if (
      listed?.family &&
      listed.given !== undefined &&
      foldName(listed.display) === foldName(name)
    ) {
      return {
        creatorType: "author",
        firstName: listed.given,
        lastName: listed.family,
      };
    }
    return { creatorType: "author", name: name.trim() };
  });
}

/**
 * Write a paper's arXiv data to a new item whose type follows the item
 * type option (Preprint, or Journal Article when "keep preprint type" is
 * off).
 */
export function setArxivItemFields(
  item: Zotero.Item,
  entry: ArxivApiEntry,
  listingAuthors?: readonly ListingAuthor[],
): void {
  const line = arxivExtraLine(entry.id, entry.primaryCategory);
  item.setField("title", cleanMathTitle(entry.title));
  item.setCreators(arxivCreators(entry.authors, listingAuthors) as any);
  // Collapsed as Zotero's arXiv translator does (the API wraps lines)
  item.setField("abstractNote", entry.abstract.replace(/\s+/g, " ").trim());
  item.setField("date", entry.published.slice(0, 10));
  item.setField("DOI", `10.48550/arXiv.${entry.id}`);
  item.setField("url", `https://arxiv.org/abs/${entry.id}`);
  item.setField("extra", line);
  setPreprintArxivFields(item, { arxiv: { value: entry.id } });
  if (
    item.itemType === "journalArticle" &&
    getPref("arxiv_in_journal_abbrev")
  ) {
    item.setField("journalAbbreviation", line);
  }
  // The primary category, also for an old-style identifier (math/0702261 is
  // math.GM), whose Extra line has no category to read it from
  if (getPref("arxiv_tag_enable") && entry.primaryCategory) {
    item.addTag(entry.primaryCategory);
  }
}

/** A new item in `target` from a paper's arXiv data */
export async function createItemFromArxiv(
  entry: ArxivApiEntry,
  target: NewItemTarget,
  listingAuthors?: readonly ListingAuthor[],
): Promise<Zotero.Item> {
  const item = new Zotero.Item(
    getItemTypePolicy().keepPreprintType ? "preprint" : "journalArticle",
  );
  placeNewItem(item, target);
  setArxivItemFields(item, entry, listingAuthors);
  await saveNewItem(item, target);
  return item;
}
