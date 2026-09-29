// ─────────────────────────────────────────────────────────────────────────────
// Adding arXiv papers to the library, each by the route its data allow:
//   A  INSPIRE has the paper: the plugin's INSPIRE import (the recid is the
//      record found by the paper's arXiv identifier, which is this paper);
//   C  INSPIRE has no record, the authors gave a journal DOI and the user
//      chose the journal version: Zotero's DOI lookup, checked first;
//   B  otherwise: the item from the arXiv API's data.
// A paper INSPIRE did not answer about waits for the user: try again, or add
// it from arXiv data. The duplicate check runs after the journal DOI is
// known, so that items saved under their journal DOI only are found. In one
// library, one paper at a time is checked and created, so that two adds of
// the same paper (two announcement days, the same journal DOI) cannot both
// pass the check.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../package.json";
import { getPref } from "../../utils/prefs";
import {
  LibraryIndexError,
  libraryLookup,
  type LibraryLookup,
} from "../inspire/library/arxivIndex";
import {
  createItemFromInspireMeta,
  type NewItemTarget,
} from "../inspire/library/itemCreation";
import { fetchInspireMetaByRecid } from "../inspire/metadataService";
import type { jsobject } from "../inspire/types";
import { fetchArxivApiEntries, type ArxivApiEntry } from "./arxivApi";
import { createItemFromArxiv } from "./arxivItem";
import { attachArxivPdf, type ArxivPdfResult } from "./arxivPdf";
import {
  lookupInspireByArxiv,
  type InspireArxivAnswer,
} from "./inspireByArxiv";
import {
  createItemFromJournalVersion,
  journalDOI,
  lookUpJournalVersion,
} from "./journalItem";
import type { ListingAuthor } from "./listingTypes";

/** A paper to add, with what the user chose for it */
export interface AddPaperRequest {
  /** Canonical arXiv identifier */
  arxivId: string;
  /** The authors as the browsed listing shows them (their split is kept) */
  listingAuthors?: readonly ListingAuthor[];
  /**
   * INSPIRE's answer from the list's lookup: used when it is recent and, for a
   * found record, asked for the record's DOIs; asked again otherwise
   */
  inspire?: InspireArxivAnswer;
  /** Add the journal version when INSPIRE has no record and there is a DOI */
  journalVersion?: boolean;
  /** INSPIRE did not answer: add from arXiv data all the same */
  withoutInspire?: boolean;
  /**
   * The user said that the items found by the journal DOI alone are another
   * paper (the authors gave a wrong DOI): add it all the same
   */
  notTheDoiItems?: boolean;
}

/** Why an item was found in the library */
export type DuplicateKind = "arxiv" | "recid" | "doi";

export type AddNote =
  /** The DOI's data belong to another paper: added from arXiv data */
  | "journalDoiMismatch"
  /** Zotero's DOI lookup found nothing: added from arXiv data */
  | "journalNotFound"
  /** The arXiv API did not answer: added from INSPIRE without the PDF */
  | "noPdfArxivUnavailable";

export type AddPaperOutcome =
  | {
      status: "added";
      route: "inspire" | "journal" | "arxiv";
      item: Zotero.Item;
      notes: AddNote[];
      /** The arXiv PDF being attached, when one is */
      pdf?: Promise<ArxivPdfResult>;
    }
  /** Items of the target library have the paper; nothing was added */
  | {
      status: "inLibrary";
      hits: { itemID: number; by: DuplicateKind[] }[];
      /**
       * Found by the journal DOI alone: the authors may have given a wrong
       * DOI, so the user confirms that the item is the paper
       */
      doiOnly: boolean;
    }
  /** INSPIRE did not answer: try again, or add with withoutInspire */
  | { status: "inspireUnknown" }
  /** The arXiv API did not answer and INSPIRE has no record: try later */
  | { status: "arxivUnavailable" }
  /** The arXiv API answered without the paper */
  | { status: "notOnArxiv" }
  | {
      status: "failed";
      reason: "libraryUnreadable" | "notEditable" | "inspireRecord" | "save";
      message: string;
    }
  | { status: "cancelled" };

export interface AddOptions {
  signal?: AbortSignal;
  /**
   * Attach the arXiv PDF of added papers ("find full text on import"
   * option when absent)
   */
  attachPdf?: boolean;
}

/**
 * How long an INSPIRE answer from the list stands in for asking again when
 * adding. INSPIRE harvests a day's papers hours after the announcement, so
 * an answer from minutes ago is still INSPIRE's answer; one from the morning
 * is asked again.
 */
export const INSPIRE_ANSWER_FRESH_MS = 10 * 60 * 1000;

/** A list's INSPIRE answer that can be used as it is */
function usableAnswer(
  answer: InspireArxivAnswer | undefined,
  now: number,
): answer is Exclude<InspireArxivAnswer, { status: "failed" }> {
  if (!answer || answer.status === "failed") return false;
  if (now - answer.at >= INSPIRE_ANSWER_FRESH_MS) return false;
  return answer.status === "notFound" || answer.withDois;
}

/** The step "final check, then create" running in each library */
const librarySteps = new Map<number, Promise<unknown>>();

/** Run `step` after the steps queued before it in the same library */
function inLibraryOrder<T>(libraryID: number, step: () => Promise<T>) {
  const previous = librarySteps.get(libraryID) ?? Promise.resolve();
  const run = previous.then(step, step);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  librarySteps.set(libraryID, tail);
  void tail.then(() => {
    if (librarySteps.get(libraryID) === tail) librarySteps.delete(libraryID);
  });
  return run;
}

/** A DOI that is not arXiv's own (10.48550/arXiv.<id>) */
function journalDois(dois: (string | undefined)[]): string[] {
  return [
    ...new Set(
      dois
        .filter((doi): doi is string => !!doi)
        .map((doi) => doi.trim())
        .filter((doi) => doi && !/^10\.48550\/arxiv\./i.test(doi)),
    ),
  ];
}

/** Items of `libraryID` that have the paper, by what they were found */
function duplicates(
  lookup: LibraryLookup,
  libraryID: number,
  ids: { arxivId: string; recid?: string; dois: string[] },
) {
  const found = new Map<number, Set<DuplicateKind>>();
  const add = (kind: DuplicateKind, itemIDs: number[]) => {
    for (const itemID of itemIDs) {
      if (!found.has(itemID)) found.set(itemID, new Set());
      found.get(itemID)!.add(kind);
    }
  };
  add(
    "arxiv",
    lookup.byArxiv(ids.arxivId, libraryID).map((hit) => hit.itemID),
  );
  if (ids.recid) {
    add(
      "recid",
      lookup.byRecid(ids.recid, libraryID).map((hit) => hit.itemID),
    );
  }
  for (const doi of ids.dois) {
    add(
      "doi",
      lookup.byDOI(doi, libraryID).map((hit) => hit.itemID),
    );
  }
  return [...found].map(([itemID, kinds]) => ({ itemID, by: [...kinds] }));
}

/**
 * Add `requests` to the library and collections of `target`. Resolves once
 * every paper is added or known not to be; PDFs are attached after that
 * (each added paper's `pdf`).
 */
export async function addArxivPapers(
  requests: readonly AddPaperRequest[],
  target: NewItemTarget,
  options: AddOptions = {},
): Promise<AddPaperOutcome[]> {
  const { signal } = options;
  const library = Zotero.Libraries.get(target.libraryID) as
    | (Zotero.Library & { waitForDataLoad?(type: string): Promise<void> })
    | false;
  if (!library || !library.editable) {
    return requests.map(() => ({
      status: "failed",
      reason: "notEditable",
      message: "The library cannot be edited",
    }));
  }
  // Items of a library not shown yet have no data until loaded
  await library.waitForDataLoad?.("item");

  const cancelled = () =>
    requests.map((): AddPaperOutcome => ({ status: "cancelled" }));
  const ids = requests.map((request) => request.arxivId);
  let inspire: Map<string, InspireArxivAnswer>;
  let api: Awaited<ReturnType<typeof fetchArxivApiEntries>>;
  try {
    // Asked again unless the list's answer is recent: INSPIRE may have the
    // paper by now, and its DOIs (every one, not only the first) find an
    // item saved under them
    const now = Date.now();
    inspire = new Map();
    const toAsk: string[] = [];
    for (const request of requests) {
      if (usableAnswer(request.inspire, now)) {
        inspire.set(request.arxivId, request.inspire);
      } else {
        toAsk.push(request.arxivId);
      }
    }
    if (toAsk.length) {
      const asked = await lookupInspireByArxiv(toAsk, {
        fields: ["dois.value"],
        signal,
      });
      for (const [id, answer] of asked) inspire.set(id, answer);
    }
    api = await fetchArxivApiEntries(ids, { signal });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return cancelled();
    throw err;
  }
  const apiFailed = new Set(api.failed.flatMap((batch) => batch.ids));
  const notOnArxiv = new Set(api.missing);
  const attachPdf =
    options.attachPdf ?? getPref("auto_find_fulltext_on_import") === true;
  const skipJournalPdf = getPref("arxiv_pdf_skip_journal_items") === true;

  const outcomes: AddPaperOutcome[] = [];
  for (const request of requests) {
    if (signal?.aborted) {
      outcomes.push({ status: "cancelled" });
      continue;
    }
    const answer = inspire.get(request.arxivId);
    outcomes.push(
      await addPaper(request, answer, api.entries.get(request.arxivId), {
        apiFailed: apiFailed.has(request.arxivId),
        notOnArxiv: notOnArxiv.has(request.arxivId),
        target,
        signal,
        attachPdf,
        skipJournalPdf,
      }),
    );
  }
  return outcomes;
}

async function addPaper(
  request: AddPaperRequest,
  inspire: InspireArxivAnswer | undefined,
  entry: ArxivApiEntry | undefined,
  context: {
    apiFailed: boolean;
    notOnArxiv: boolean;
    target: NewItemTarget;
    signal?: AbortSignal;
    attachPdf: boolean;
    skipJournalPdf: boolean;
  },
): Promise<AddPaperOutcome> {
  const { target, signal } = context;
  const recid = inspire?.status === "found" ? inspire.recid : undefined;
  if ((!inspire || inspire.status === "failed") && !request.withoutInspire) {
    return { status: "inspireUnknown" };
  }
  if (context.notOnArxiv) return { status: "notOnArxiv" };
  if (!entry && !recid) return { status: "arxivUnavailable" };

  const notes: AddNote[] = [];
  let create: () => Promise<Zotero.Item>;
  let route: "inspire" | "journal" | "arxiv";
  const dois = journalDois([
    entry ? journalDOI(entry) : undefined,
    ...(inspire?.status === "found"
      ? (inspire.metadata?.dois ?? []).map((d: { value?: string }) => d?.value)
      : []),
  ]);

  try {
    if (recid) {
      route = "inspire";
      const meta = await fetchInspireMetaByRecid(recid, signal);
      if (signal?.aborted) return { status: "cancelled" };
      if (meta === -1) {
        return {
          status: "failed",
          reason: "inspireRecord",
          message: `INSPIRE gave no record ${recid}`,
        };
      }
      // The record's journal DOI finds an item saved under it alone
      dois.push(...journalDois([(meta as jsobject).DOI]));
      create = () => createItemFromInspireMeta(meta as jsobject, target);
      if (!entry) notes.push("noPdfArxivUnavailable");
    } else {
      const doi = entry && journalDOI(entry);
      // Only a paper INSPIRE answered about goes by its journal version;
      // "add from arXiv data" after INSPIRE failed means the arXiv data
      const journal =
        request.journalVersion && doi && inspire?.status === "notFound"
          ? await lookUpJournalVersion(entry, doi)
          : undefined;
      if (signal?.aborted) return { status: "cancelled" };
      if (journal?.status === "same") {
        route = "journal";
        dois.push(...journalDois([journal.data.DOI]));
        create = () =>
          createItemFromJournalVersion(journal.data, entry!, target);
      } else {
        if (journal?.status === "different") {
          notes.push("journalDoiMismatch");
          // The DOI is another paper's: that paper's item is no duplicate
          const wrong = journalDois([doi]).map((d) => d.toLowerCase());
          for (let i = dois.length - 1; i >= 0; i--) {
            if (wrong.includes(dois[i].toLowerCase())) dois.splice(i, 1);
          }
        } else if (journal) {
          notes.push("journalNotFound");
        }
        route = "arxiv";
        create = () =>
          createItemFromArxiv(entry!, target, request.listingAuthors);
      }
    }
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      return { status: "cancelled" };
    }
    throw err;
  }

  const created = await inLibraryOrder(
    target.libraryID,
    async (): Promise<AddPaperOutcome | { created: Zotero.Item }> => {
      if (signal?.aborted) return { status: "cancelled" };
      let lookup: LibraryLookup;
      try {
        lookup = await libraryLookup();
      } catch (err) {
        if (!(err instanceof LibraryIndexError)) throw err;
        return {
          status: "failed",
          reason: "libraryUnreadable",
          message: err.message,
        };
      }
      const hits = duplicates(lookup, target.libraryID, {
        arxivId: request.arxivId,
        recid,
        dois,
      });
      const doiOnly = hits.every((hit) =>
        hit.by.every((kind) => kind === "doi"),
      );
      if (hits.length && !(doiOnly && request.notTheDoiItems)) {
        return { status: "inLibrary", hits, doiOnly };
      }
      try {
        return { created: await create() };
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] Adding arXiv:${request.arxivId} failed: ${err}`,
        );
        return { status: "failed", reason: "save", message: String(err) };
      }
    },
  );
  if (!("created" in created)) return created;

  const item = created.created;
  const journalItem = route !== "arxiv" && item.itemType !== "preprint";
  const pdf =
    context.attachPdf && entry && !(context.skipJournalPdf && journalItem)
      ? attachArxivPdf(item, entry, { signal })
      : undefined;
  return { status: "added", route, item, notes, ...(pdf ? { pdf } : {}) };
}
