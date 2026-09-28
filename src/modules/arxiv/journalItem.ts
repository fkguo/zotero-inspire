// ─────────────────────────────────────────────────────────────────────────────
// A library item for the journal version of an arXiv paper INSPIRE has no
// record of, from the DOI its authors gave on arXiv. Zotero's own DOI lookup
// (the mechanism of "Add Item by Identifier") gives the item's data without
// saving it (libraryID: false); before anything is written the data is
// checked against the arXiv paper, since an author-given DOI can be wrong:
// the DOI must be the one asked for, the title close to the arXiv title and
// the first author the same. A DOI that belongs to another paper passes the
// first check and fails the other two.
// ─────────────────────────────────────────────────────────────────────────────

import {
  placeNewItem,
  saveNewItem,
  type NewItemTarget,
} from "../inspire/library/itemCreation";
import { arxivExtraLine } from "../inspire/itemUpdater";
import type { ArxivApiEntry } from "./arxivApi";
import { identityMismatches } from "./inspireByArxiv";

export type JournalCheckFailure = "doi" | "title" | "firstAuthor";

export type JournalVersion =
  /** The DOI's data describe the arXiv paper */
  | { status: "same"; data: any }
  /** The DOI's data describe another paper, or cannot be compared */
  | { status: "different"; data: any; reasons: JournalCheckFailure[] }
  /** Zotero's lookup found nothing for the DOI, or failed */
  | { status: "notFound" };

/** A DOI as written in arXiv's metadata or a translator's data, for comparing */
function normalizeDOI(doi: string | undefined): string {
  return (doi ?? "")
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "")
    .toLowerCase();
}

/**
 * The journal DOI of an arXiv paper: arXiv's DOI field, whose first DOI is
 * taken when the authors gave several
 */
export function journalDOI(entry: ArxivApiEntry): string | undefined {
  return entry.doi?.trim().split(/\s+/)[0] || undefined;
}

/**
 * Look the paper's journal version up by its DOI with Zotero's own lookup,
 * without saving anything, and check it against the arXiv paper
 */
export async function lookUpJournalVersion(
  entry: ArxivApiEntry,
  doi: string,
): Promise<JournalVersion> {
  let data: any;
  try {
    const translate = new Zotero.Translate.Search();
    translate.setIdentifier({ DOI: doi });
    const translators = await translate.getTranslators();
    if (!translators?.length) return { status: "notFound" };
    translate.setTranslator(translators);
    const items = await translate.translate({
      libraryID: false,
      saveAttachments: false,
    });
    data = items?.[0];
  } catch (err) {
    Zotero.debug(`[zotero-inspire] DOI lookup of ${doi} failed: ${err}`);
    return { status: "notFound" };
  }
  if (!data?.itemType) return { status: "notFound" };

  const reasons: JournalCheckFailure[] = [];
  if (normalizeDOI(data.DOI) !== normalizeDOI(doi)) reasons.push("doi");
  const first = data.creators?.[0];
  const arxivFirst = entry.authors[0] ?? "";
  const mismatches = identityMismatches(
    {
      arxivId: entry.id,
      title: data.title ?? "",
      firstAuthor: arxivFirst ? { lastName: arxivFirst } : undefined,
    },
    {
      titles: [{ title: entry.title }],
      first_author: { last_name: first?.lastName ?? first?.name },
    },
  ).filter(
    // arXiv gives a collaboration paper the collaboration as its author,
    // the journal a member: only the DOI and the title can be compared
    (reason) =>
      !(reason === "firstAuthor" && /\bcollaboration\b/i.test(arxivFirst)),
  );
  if (mismatches.includes("recordIncomplete")) {
    reasons.push("title", "firstAuthor");
  } else {
    reasons.push(...(mismatches as JournalCheckFailure[]));
  }
  return reasons.length
    ? { status: "different", data, reasons }
    : { status: "same", data };
}

/** Fields of a translator's item data that are not item fields */
const NOT_ITEM_FIELDS = [
  "attachments",
  "notes",
  "seeAlso",
  "id",
  "itemID",
  "dateAdded",
  "dateModified",
  "version",
  "path",
];

/**
 * A new item in `target` from checked journal data (lookUpJournalVersion),
 * saved as Zotero saves the result of "Add Item by Identifier"
 * (Translate.ItemSaver: creators default to authors; the lookup's tags are
 * automatic tags, left out when Zotero's automatic tags option is off; the
 * lookup's notes become child notes), with the paper's arXiv line in Extra
 * (the DOI lookup does not write it; the duplicate check and the preprint
 * watch read it). The item type is the one the DOI gives (an article, a
 * conference paper, a book chapter).
 */
export async function createItemFromJournalVersion(
  data: any,
  entry: ArxivApiEntry,
  target: NewItemTarget,
): Promise<Zotero.Item> {
  const json = { ...data };
  for (const field of NOT_ITEM_FIELDS) delete json[field];
  json.creators = (json.creators ?? []).map((creator: any) => ({
    creatorType: "author",
    ...creator,
  }));
  json.tags = Zotero.Prefs.get("automaticTags")
    ? (json.tags ?? [])
        .map((tag: any) => (typeof tag === "string" ? tag : tag?.tag))
        .filter((tag: unknown) => typeof tag === "string" && tag.trim())
        .map((tag: string) => ({ tag, type: 1 }))
    : [];
  if (json.accessDate === "CURRENT_TIMESTAMP") {
    json.accessDate = Zotero.Date.dateToISO(new Date());
  }

  const item = new Zotero.Item(json.itemType);
  item.fromJSON(json);
  placeNewItem(item, target);
  const extra = item.getField("extra") as string;
  item.setField(
    "extra",
    [arxivExtraLine(entry.id, entry.primaryCategory), extra]
      .filter(Boolean)
      .join("\n"),
  );
  await saveNewItem(item, target);
  for (const note of data.notes ?? []) {
    const text = typeof note === "string" ? note : note?.note;
    if (!text) continue;
    const child = new Zotero.Item("note");
    child.libraryID = item.libraryID;
    child.parentID = item.id;
    child.setNote(text);
    await child.saveTx({ skipSelect: true });
  }
  return item;
}
