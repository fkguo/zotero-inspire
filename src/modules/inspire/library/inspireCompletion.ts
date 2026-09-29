// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE completion: arXiv papers added before INSPIRE had them (from arXiv
// data, or from another source) get the plugin's own fields once INSPIRE
// has the record: the recid, an empty citation key, the citation count lines
// of Extra. Bibliographic fields are never touched. Nothing happens in the
// background: the user asks for the check, sees each item next to its
// INSPIRE record, and ticks what is written.
//
// A write is refused when it could clash with the user's own editing: the
// item is shown (selected in a main window's library, or the parent of an
// open reader), it has unsaved changes, or its saved state is no longer the
// state it was checked in. Items are written one at a time each, without
// changing their Date Modified; the change syncs as usual.
// ─────────────────────────────────────────────────────────────────────────────

import { getPref } from "../../../utils/prefs";
import { arxivIdFromItem, arxivIdsFromFields } from "../../arxiv/arxivId";
import {
  resolveInspireByArxiv,
  type IdentityMismatch,
} from "../../arxiv/inspireByArxiv";
import { setInspireCitationLines } from "../itemUpdater";
import { recidFromFields, resolveItemRecid } from "./itemRecid";

/** Items added this long ago at most are offered for completion */
export const COMPLETION_WINDOW_DAYS = 30;

const NON_REGULAR_TYPES = ["note", "attachment", "annotation"];

/** The first author as an item stores it */
interface FirstAuthor {
  lastName: string;
  firstName: string;
}

function firstAuthorOf(item: Zotero.Item): FirstAuthor | undefined {
  const creator = item.getCreators()[0] as
    | { lastName?: string; firstName?: string }
    | undefined;
  return creator
    ? { lastName: creator.lastName ?? "", firstName: creator.firstName ?? "" }
    : undefined;
}

/** An item as it was when checked against INSPIRE */
export interface CompletionEntry {
  itemID: number;
  libraryID: number;
  arxivId: string;
  title: string;
  firstAuthor?: FirstAuthor;
  status: "found" | "notFound" | "failed";
  /** INSPIRE's record, with what the list shows and what may be written */
  record?: {
    recid: string;
    title?: string;
    firstAuthor?: string;
    texkey?: string;
    citationCount?: number;
    citationCountWithoutSelf?: number;
  };
  /** Reasons to doubt the record is the item's paper */
  mismatches: IdentityMismatch[];
  /** Ticked in the list at first: the record is the item's paper */
  preselected: boolean;
}

export type CompletionWrite =
  | {
      status: "written";
      /** Fields written; recid missing when Archive held something else */
      wrote: ("recid" | "citationKey" | "citations")[];
      /** Archive or Archive Location held another value: both left alone */
      archiveConflict: boolean;
    }
  | {
      status: "skipped";
      reason:
        | "shown"
        | "unsaved"
        | "changed"
        | "gone"
        | "notFound"
        | "nothingToWrite";
    };

/**
 * Items added in the last 30 days, in the libraries the user can edit, that
 * have an arXiv ID and no INSPIRE recid (from the library alone; nothing is
 * asked of INSPIRE)
 */
export async function findCompletionCandidates(
  now = Date.now(),
): Promise<Zotero.Item[]> {
  const libraries = Zotero.Libraries.getAll().filter(
    (library) => library.editable && library.libraryType !== "feed",
  );
  const since = Zotero.Date.dateToSQL(
    new Date(now - COMPLETION_WINDOW_DAYS * 24 * 3600 * 1000),
    true,
  );
  const nonRegular = NON_REGULAR_TYPES.map((name) =>
    Zotero.ItemTypes.getID(name),
  ).filter((id): id is number => typeof id === "number");
  const candidates: Zotero.Item[] = [];
  for (const library of libraries) {
    // A library not shown yet in this session has no item data until loaded
    await library.waitForDataLoad("item");
    const ids = (await Zotero.DB.columnQueryAsync(
      `SELECT itemID FROM items WHERE libraryID = ? AND dateAdded >= ?
        AND itemTypeID NOT IN (${nonRegular.join(", ")})
        AND itemID NOT IN (SELECT itemID FROM deletedItems)`,
      [library.libraryID, since],
    )) as number[];
    const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
    for (const item of items) {
      if (arxivIdFromItem(item) && !resolveItemRecid(item)) {
        candidates.push(item);
      }
    }
  }
  return candidates;
}

/**
 * Ask INSPIRE about the candidates (the user asked for it): the record of
 * each item's arXiv ID, checked against the item's title and first author,
 * with the fields a write would take from it
 */
export async function checkInspireCompletion(
  items: readonly Zotero.Item[],
  options: { signal?: AbortSignal } = {},
): Promise<CompletionEntry[]> {
  const identities = items.map((item) => ({
    item,
    arxivId: arxivIdFromItem(item)!,
    title: item.getField("title") as string,
    firstAuthor: firstAuthorOf(item),
  }));
  const resolved = await resolveInspireByArxiv(identities, {
    fields: [
      "texkeys",
      "citation_count",
      "citation_count_without_self_citations",
    ],
    signal: options.signal,
  });
  return identities.map(({ item, arxivId, title, firstAuthor }, i) => {
    const answer = resolved[i];
    const entry: CompletionEntry = {
      itemID: item.id,
      libraryID: item.libraryID,
      arxivId,
      title,
      firstAuthor,
      status: answer.status,
      mismatches: [],
      preselected: false,
    };
    if (answer.status === "found") {
      const md = answer.metadata;
      entry.record = {
        recid: answer.recid,
        title: md.titles?.[0]?.title,
        firstAuthor: md.first_author?.full_name,
        texkey: md.texkeys?.[0],
        citationCount: md.citation_count,
        citationCountWithoutSelf: md.citation_count_without_self_citations,
      };
      entry.mismatches = answer.mismatches;
      entry.preselected = answer.mismatches.length === 0;
    }
    return entry;
  });
}

/** Items shown now: selected in a main window's library, or open in a reader */
function shownItemIDs(): Set<number> {
  const shown = new Set<number>();
  for (const win of Zotero.getMainWindows()) {
    const pane = (win as any).ZoteroPane;
    for (const id of pane?.getSelectedItems?.(true, { libraryTabOnly: true }) ??
      []) {
      shown.add(id);
    }
  }
  const readers = ((Zotero.Reader as any)?._readers ?? []) as {
    itemID?: number;
  }[];
  for (const reader of readers) {
    const attachment = reader.itemID
      ? (Zotero.Items.get(reader.itemID) as Zotero.Item | false)
      : false;
    if (attachment) shown.add(attachment.parentItemID || attachment.id);
  }
  return shown;
}

/** Writes to one item run one after the other */
const itemWrites = new Map<number, Promise<unknown>>();

function inItemOrder<T>(itemID: number, step: () => Promise<T>): Promise<T> {
  const previous = itemWrites.get(itemID) ?? Promise.resolve();
  const run = previous.then(step, step);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  itemWrites.set(itemID, tail);
  void tail.then(() => {
    if (itemWrites.get(itemID) === tail) itemWrites.delete(itemID);
  });
  return run;
}

/** Fields of the saved item compared with the item object and the check */
const SNAPSHOT_FIELDS = [
  "title",
  "archive",
  "archiveLocation",
  "extra",
  "url",
  "DOI",
  "archiveID",
  "journalAbbreviation",
] as const;

type Snapshot = Record<(typeof SNAPSHOT_FIELDS)[number], string> & {
  firstAuthor?: FirstAuthor;
};

/** The item as saved in the database, or null when it is gone or in the trash */
async function savedState(itemID: number): Promise<Snapshot | null> {
  const exists = await Zotero.DB.valueQueryAsync(
    "SELECT COUNT(*) FROM items WHERE itemID = ? AND itemID NOT IN (SELECT itemID FROM deletedItems)",
    [itemID],
  );
  if (!Number(exists)) return null;
  const rows = (await Zotero.DB.queryAsync(
    `SELECT fieldName, value FROM itemData
      JOIN itemDataValues USING (valueID) JOIN fields USING (fieldID)
      WHERE itemID = ? AND fieldName IN (${SNAPSHOT_FIELDS.map(() => "?").join(", ")})`,
    [itemID, ...SNAPSHOT_FIELDS],
  )) as { fieldName: string; value: unknown }[];
  const snapshot = Object.fromEntries(
    SNAPSHOT_FIELDS.map((name) => [name, ""]),
  ) as unknown as Snapshot;
  for (const row of rows ?? []) {
    (snapshot as any)[row.fieldName] = String(row.value);
  }
  const [creator] = ((await Zotero.DB.queryAsync(
    `SELECT firstName, lastName FROM itemCreators JOIN creators USING (creatorID)
      WHERE itemID = ? AND orderIndex = 0`,
    [itemID],
  )) ?? []) as { firstName: string; lastName: string }[];
  if (creator) {
    snapshot.firstAuthor = {
      lastName: creator.lastName ?? "",
      firstName: creator.firstName ?? "",
    };
  }
  return snapshot;
}

function sameAuthor(a?: FirstAuthor, b?: FirstAuthor): boolean {
  return (
    (a?.lastName ?? "") === (b?.lastName ?? "") &&
    (a?.firstName ?? "") === (b?.firstName ?? "")
  );
}

/**
 * Write the plugin's INSPIRE fields to the entry's item, when it may be
 * written: recid (Archive "INSPIRE" and Archive Location, where both are
 * empty or one already agrees), the citation key when empty, and the citation
 * count lines of Extra. Nothing else is changed.
 */
export async function attachInspireRecord(
  entry: CompletionEntry,
): Promise<CompletionWrite> {
  const record = entry.record;
  if (entry.status !== "found" || !record) {
    return { status: "skipped", reason: "notFound" };
  }
  return inItemOrder(entry.itemID, async (): Promise<CompletionWrite> => {
    if (shownItemIDs().has(entry.itemID)) {
      return { status: "skipped", reason: "shown" };
    }
    const item = (await Zotero.Items.getAsync(entry.itemID)) as
      | Zotero.Item
      | false;
    if (!item) return { status: "skipped", reason: "gone" };

    let result: CompletionWrite = { status: "skipped", reason: "gone" };
    await Zotero.DB.executeTransaction(async () => {
      const saved = await savedState(entry.itemID);
      // From here to the save, no other code runs in between
      if (!saved || item.deleted) {
        result = { status: "skipped", reason: "gone" };
        return;
      }
      if (item.hasChanged()) {
        result = { status: "skipped", reason: "unsaved" };
        return;
      }
      const differs =
        SNAPSHOT_FIELDS.some(
          (name) => saved[name] !== ((item.getField(name) as string) ?? ""),
        ) ||
        !sameAuthor(saved.firstAuthor, firstAuthorOf(item)) ||
        saved.title !== entry.title ||
        !sameAuthor(saved.firstAuthor, entry.firstAuthor) ||
        // The item's arXiv ID as read at the check (the first field that
        // holds one), not merely one of its IDs
        arxivIdsFromFields(saved)[0] !== entry.arxivId ||
        recidFromFields(saved) !== null;
      if (differs) {
        result = { status: "skipped", reason: "changed" };
        return;
      }

      const wrote: ("recid" | "citationKey" | "citations")[] = [];
      let archiveConflict = false;
      const archive = saved.archive.trim();
      const location = saved.archiveLocation.trim();
      const archiveAgrees = !archive || archive.toLowerCase() === "inspire";
      const locationAgrees = !location || location === record.recid;
      if (archiveAgrees && locationAgrees) {
        if (!archive) item.setField("archive", "INSPIRE");
        if (!location) item.setField("archiveLocation", record.recid);
        wrote.push("recid");
      } else {
        archiveConflict = true;
      }
      let extra = saved.extra;
      // Both counts or none: a missing count is not written
      if (
        typeof record.citationCount === "number" &&
        typeof record.citationCountWithoutSelf === "number"
      ) {
        const withCounts = setInspireCitationLines(
          extra,
          record.citationCount,
          record.citationCountWithoutSelf,
        );
        if (withCounts !== extra) wrote.push("citations");
        extra = withCounts;
      }
      // The citation key where the INSPIRE update puts it: the Citation Key
      // field from Zotero 8, a "Citation Key:" line of Extra before
      if (record.texkey && getPref("citekey") === "inspire") {
        if (Zotero.platformMajorVersion >= 8) {
          if (!item.getField("citationKey")) {
            item.setField("citationKey", record.texkey);
            wrote.push("citationKey");
          }
        } else if (!/^Citation\s*Key:/im.test(extra)) {
          extra = `${extra}\nCitation Key: ${record.texkey}`.replace(/^\n/, "");
          wrote.push("citationKey");
        }
      }
      if (extra !== saved.extra) item.setField("extra", extra);
      if (!wrote.length) {
        result = { status: "skipped", reason: "nothingToWrite" };
        return;
      }
      // Date Modified (and a group's "modified by") stay; the change syncs
      await item.save({ skipDateModifiedUpdate: true });
      result = { status: "written", wrote, archiveConflict };
    });
    return result;
  });
}

/** Write the entries the user ticked, one after the other */
export async function writeInspireCompletion(
  entries: readonly CompletionEntry[],
): Promise<CompletionWrite[]> {
  const results: CompletionWrite[] = [];
  for (const entry of entries) results.push(await attachInspireRecord(entry));
  return results;
}
