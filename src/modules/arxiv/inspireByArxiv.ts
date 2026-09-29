// ─────────────────────────────────────────────────────────────────────────────
// INSPIRE records of arXiv papers, looked up by arXiv identifier in batches.
// INSPIRE has one record per arXiv identifier; a record counts for an
// identifier only when one of its arXiv eprints is that identifier exactly
// (after parseArxivId), so a search hit for a similar number is not taken.
//
// resolveInspireByArxiv also checks that the record is the paper of a Zotero
// item: an item's arXiv ID may be wrong (typed by hand, copied from another
// paper), and a recid written to the wrong item is permanent. The check
// compares the item's title and first author with the record's.
// ─────────────────────────────────────────────────────────────────────────────

import { cleanMathTitle } from "../../utils/mathTitle";
import { searchLiteratureInBatch } from "../inspire/referencesService";
import { parseArxivId } from "./arxivId";

/**
 * arXiv identifiers per INSPIRE request. INSPIRE answers a search for 75
 * identifiers and refuses one for 80 with 502 (2026-09-29); 50 leaves room.
 */
export const INSPIRE_ARXIV_BATCH_SIZE = 50;

/** Batches in flight at once (the send window spreads them further) */
const PARALLEL_BATCHES = 4;

/** An identifier INSPIRE had no record for is not asked again automatically within this time */
export const NOT_FOUND_RECHECK_MS = 60 * 60 * 1000;

export type InspireArxivAnswer =
  | {
      status: "found";
      recid: string;
      metadata: any;
      /** When INSPIRE answered (ms since the epoch) */
      at: number;
      /** The record's DOIs were asked for (metadata.dois lists them all) */
      withDois: boolean;
    }
  /** INSPIRE answered and has no record (at `at`, ms since the epoch) */
  | { status: "notFound"; at: number }
  /** INSPIRE did not answer */
  | { status: "failed" };

export interface InspireArxivLookupOptions {
  /** INSPIRE fields beyond control_number and arxiv_eprints */
  fields?: string[];
  signal?: AbortSignal;
  /**
   * An automatic lookup (not asked for by the user): identifiers INSPIRE had
   * no record for in the last hour are answered from memory
   */
  automatic?: boolean;
}

/** When INSPIRE last had no record for an identifier, in this session */
const notFoundAt = new Map<string, number>();

/** Forget the identifiers INSPIRE had no record for (tests) */
export function clearNotFoundMemory(): void {
  notFoundAt.clear();
}

/**
 * The INSPIRE record of each paper in `ids` (canonical arXiv identifiers),
 * with control_number, arxiv_eprints and the `fields` asked for. Rejects
 * with an AbortError when `signal` aborts.
 */
export async function lookupInspireByArxiv(
  ids: readonly string[],
  options: InspireArxivLookupOptions = {},
): Promise<Map<string, InspireArxivAnswer>> {
  const answers = new Map<string, InspireArxivAnswer>();
  const now = Date.now();
  const toAsk: string[] = [];
  for (const id of new Set(ids)) {
    const at = notFoundAt.get(id);
    if (
      options.automatic &&
      at !== undefined &&
      now - at < NOT_FOUND_RECHECK_MS
    ) {
      answers.set(id, { status: "notFound", at });
    } else {
      toAsk.push(id);
    }
  }

  const fields = [
    "control_number",
    "arxiv_eprints",
    ...(options.fields ?? []),
  ].join(",");
  const batches: string[][] = [];
  for (let i = 0; i < toAsk.length; i += INSPIRE_ARXIV_BATCH_SIZE) {
    batches.push(toAsk.slice(i, i + INSPIRE_ARXIV_BATCH_SIZE));
  }

  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const { hits, failedTerms } = await searchLiteratureInBatch(
        batch.map((id) => `arxiv:${id}`),
        fields,
        options.signal,
      );
      const failed = new Set(failedTerms.map((t) => t.slice("arxiv:".length)));
      const asked = new Set(batch);
      const answeredAt = Date.now();
      const withDois = /(^|,)dois(\.value)?(,|$)/.test(fields);
      for (const metadata of hits) {
        for (const eprint of metadata.arxiv_eprints ?? []) {
          const id = parseArxivId(eprint?.value)?.id;
          if (id && asked.has(id) && !answers.has(id)) {
            answers.set(id, {
              status: "found",
              recid: String(metadata.control_number),
              metadata,
              at: answeredAt,
              withDois,
            });
          }
        }
      }
      for (const id of batch) {
        if (answers.has(id)) {
          notFoundAt.delete(id);
        } else if (failed.has(id)) {
          answers.set(id, { status: "failed" });
        } else {
          answers.set(id, { status: "notFound", at: answeredAt });
          notFoundAt.set(id, answeredAt);
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, worker),
  );
  return answers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity check
// ─────────────────────────────────────────────────────────────────────────────

/** A Zotero item's arXiv ID with the title and first author it shows */
export interface ArxivItemIdentity {
  arxivId: string;
  title: string;
  /**
   * The first author's names as the item stores them; an author stored in
   * one field has its whole name as lastName
   */
  firstAuthor?: { lastName: string; firstName?: string };
}

export type IdentityMismatch = "title" | "firstAuthor" | "recordIncomplete";

export type ResolvedInspireRecord =
  | {
      status: "found";
      recid: string;
      metadata: any;
      /** Reasons to doubt that the record is the item's paper; none: it is */
      mismatches: IdentityMismatch[];
    }
  | { status: "notFound" }
  | { status: "failed" };

/** Fields the identity check reads */
const IDENTITY_FIELDS = [
  "titles.title",
  "first_author.full_name",
  "first_author.last_name",
  "collaborations.value",
];

/**
 * Title word overlap from which two titles count as the same paper's. Set
 * from 168 papers of the arXiv listings of 2026-09-21 and 25 (hep-ph,
 * astro-ph.CO, quant-ph): a paper's arXiv title (current version) and its
 * INSPIRE title overlap 0.60 at least (0.60 where the journal version spells
 * out an abbreviation), different papers' titles 0.35 at most (28,056
 * pairs). test/inspireByArxiv.test.ts keeps the closest pairs.
 */
export const TITLE_OVERLAP_MIN = 0.5;

/**
 * The INSPIRE record of each item's paper (by its arXiv ID) and whether the
 * record's title and first author agree with the item's. Items are answered
 * in their order; items with the same arXiv ID share one lookup.
 */
export async function resolveInspireByArxiv(
  items: readonly ArxivItemIdentity[],
  options: { fields?: string[]; signal?: AbortSignal } = {},
): Promise<ResolvedInspireRecord[]> {
  const answers = await lookupInspireByArxiv(
    items.map((item) => item.arxivId),
    {
      fields: [...IDENTITY_FIELDS, ...(options.fields ?? [])],
      signal: options.signal,
    },
  );
  return items.map((item) => {
    const answer = answers.get(item.arxivId);
    if (!answer || answer.status === "failed") return { status: "failed" };
    if (answer.status === "notFound") return { status: "notFound" };
    return {
      status: "found",
      recid: answer.recid,
      metadata: answer.metadata,
      mismatches: identityMismatches(item, answer.metadata),
    };
  });
}

/** Why `metadata` may not be the record of `item`'s paper */
export function identityMismatches(
  item: ArxivItemIdentity,
  metadata: any,
): IdentityMismatch[] {
  const recordTitle: string | undefined = metadata?.titles?.[0]?.title;
  const recordAuthor: string | undefined =
    metadata?.first_author?.last_name ||
    metadata?.first_author?.full_name?.split(",")[0];
  if (!recordTitle || !recordAuthor) return ["recordIncomplete"];
  const mismatches: IdentityMismatch[] = [];
  if (titleOverlap(item.title, recordTitle) < TITLE_OVERLAP_MIN) {
    mismatches.push("title");
  }
  const author = item.firstAuthor;
  if (
    !author ||
    !(
      sameFamilyName(author.lastName, recordAuthor) ||
      isRecordCollaboration(author, metadata.collaborations)
    )
  ) {
    mismatches.push("firstAuthor");
  }
  return mismatches;
}

/** Letters without accents, in lower case */
function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The words of a title, without formula notation: both titles pass through
 * the plugin's formula-to-Unicode conversion (as Zotero items' titles did),
 * then HTML tags, accents, case and punctuation are dropped
 */
export function titleWords(title: string): Set<string> {
  const text = foldText(cleanMathTitle(title).replace(/<[^>]*>/g, " "));
  return new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/** Words the two titles share, over the words of both (0 to 1) */
export function titleOverlap(a: string, b: string): number {
  const wordsA = titleWords(a);
  const wordsB = titleWords(b);
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  const all = wordsA.size + wordsB.size - shared;
  return all ? shared / all : 0;
}

/**
 * The record's family name is the item's first author's family name, or
 * contains it, or (an author stored in one field: the whole name) is part
 * of it
 */
function sameFamilyName(itemAuthor: string, recordFamily: string): boolean {
  const words = (text: string) =>
    foldText(text)
      .split(/[^\p{L}]+/u)
      .filter(Boolean)
      .join(" ");
  const family = words(recordFamily);
  const author = words(itemAuthor);
  // "Infirri" (as arXiv splits "G. Sardo Infirri") and "Sardo Infirri"
  return (
    ` ${author} `.includes(` ${family} `) ||
    ` ${family} `.includes(` ${author} `)
  );
}

/**
 * The item's first author is the collaboration that signs the record ("CMS
 * Collaboration", "C. M. S. Collaboration", "The Belle II Collaboration"
 * for Belle-II), as arXiv and Zotero's arXiv translator give a
 * collaboration paper's author; INSPIRE's first author is then a member
 */
function isRecordCollaboration(
  author: { lastName: string; firstName?: string },
  collaborations: { value?: string }[] | undefined,
): boolean {
  const letters = (text: string) =>
    foldText(text).replace(/[^\p{L}\p{N}]+/gu, "");
  const name = foldText(`${author.firstName ?? ""} ${author.lastName}`);
  if (!/\bcollaboration\b/.test(name)) return false;
  const compact = letters(name);
  return (collaborations ?? []).some(
    ({ value }) => !!value && compact.includes(letters(value)),
  );
}
