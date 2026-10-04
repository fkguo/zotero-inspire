// ─────────────────────────────────────────────────────────────────────────────
// The references of a paper's arXiv HTML page and INSPIRE's reference list of
// the paper. An entry of the page's bibliography is taken to be a paper of
// INSPIRE's list only when they share an identifier: an arXiv identifier (of
// a link to arxiv.org, written "arXiv:…", among the entry's "External Links:"
// as arXiv's bibliographies from BibTeX give it, or an old-style one such as
// hep-th/0012261 anywhere), the DOI of a link to doi.org, or, for an entry
// none of whose arXiv numbers and DOIs is in the list and for one naming
// several papers, the journal, volume and first page of its text (as a
// PDF's references are read) with the same year when both give one: JHEP's
// and JCAP's volumes are months, so a volume and a page can be another
// year's paper. The entries' numbers are not
// compared: the numbers of arXiv's page often differ from those INSPIRE has
// (measured: in 5 of 11 papers, for most references), and would give the
// wrong paper. An entry that names several papers ("[12] A; B; C") is
// matched to each of them.
//
// INSPIRE's list is the References panel's: read from the plugin's cache of
// reference lists, otherwise asked for, with the cited papers' data
// (identifiers, titles, citation counts), and kept in the cache.
// ─────────────────────────────────────────────────────────────────────────────

import { localCache } from "../inspire/localCache";
import {
  buildIdentifierIndexes,
  findByArxiv,
  findByDoi,
  findByJournalVolPage,
} from "../inspire/pdfAnnotate/labelMatcher/identifierIndex";
import { getPDFReferencesParser } from "../inspire/pdfAnnotate/pdfReferencesParser";
import {
  enrichReferencesEntries,
  fetchReferencesEntries,
} from "../inspire/referencesService";
import type { InspireReferenceEntry } from "../inspire/types";
import { arxivCandidateFromUrl, parseArxivId } from "./arxivId";

/** An entry of a page's bibliography, as the page's script reads it */
export interface HtmlReferenceEntry {
  /** The entry's id in the page (bib.bibN) */
  id: string;
  /** Its text, without its number */
  text: string;
  /** The addresses of its links */
  links: string[];
}

/** "arXiv:2610.00014", "arXiv:hep-ph/0101001v2" in an entry's text */
const ARXIV_IN_TEXT = /arXiv:\s*([^\s,;()[\]]+)/gi;
/** What follows "External Links:" in an entry ("2004.04545, Document") */
const EXTERNAL_LINKS = /External Links:([\s\S]*)$/;
/** An old-style arXiv identifier anywhere in the text: hep-th/0012261 */
const OLD_STYLE_IN_TEXT =
  /\b[a-z]+(?:-[a-z]+)?(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?\b/g;

/** The DOI of a link to doi.org (dx.doi.org), if it is one */
function doiOfLink(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!/(^|\.)doi\.org$/i.test(url.hostname)) return null;
  try {
    return decodeURIComponent(url.pathname.slice(1)) || null;
  } catch {
    return null;
  }
}

/**
 * For each entry of the page that names papers of `references`, those
 * papers (indexes into `references`), in the order the entry names them
 */
export function matchHtmlReferences(
  references: readonly InspireReferenceEntry[],
  entries: readonly HtmlReferenceEntry[],
): Map<string, number[]> {
  const indexes = buildIdentifierIndexes(references as InspireReferenceEntry[]);
  const parser = getPDFReferencesParser();
  const matched = new Map<string, number[]>();
  for (const entry of entries) {
    const found: number[] = [];
    const add = (index: number) => {
      if (index >= 0 && !found.includes(index)) found.push(index);
    };
    for (const link of entry.links) {
      add(findByArxiv(indexes, parseArxivId(arxivCandidateFromUrl(link))?.id));
      add(findByDoi(indexes, doiOfLink(link)));
    }
    const written = [
      ...[...entry.text.matchAll(ARXIV_IN_TEXT)].map((match) => match[1]),
      ...(entry.text.match(EXTERNAL_LINKS)?.[1].split(",") ?? []),
      ...(entry.text.match(OLD_STYLE_IN_TEXT) ?? []),
    ];
    for (const candidate of written) {
      // Not the full stop after it
      const id = parseArxivId(candidate.trim().replace(/\.+$/, ""))?.id;
      add(findByArxiv(indexes, id));
    }
    const papers = parser.parseReferenceText(entry.text);
    if (!found.length || papers.length > 1) {
      for (const paper of papers) {
        const index = findByJournalVolPage(
          indexes,
          paper.journalAbbrev,
          paper.volume,
          paper.pageStart,
        );
        const year = references[index]?.publicationInfo?.year;
        if (paper.year && year && String(year) !== paper.year) continue;
        add(index);
      }
    }
    if (found.length) matched.set(entry.id, found);
  }
  return matched;
}

/**
 * INSPIRE's reference list of the record `recid`, with the cited papers'
 * data: the cached list (its missing data asked for), otherwise the list
 * from INSPIRE, kept in the cache once complete. Rejects when INSPIRE does
 * not answer.
 */
export async function loadReferenceList(
  recid: string,
  signal?: AbortSignal,
): Promise<InspireReferenceEntry[]> {
  const cached = await localCache.get<InspireReferenceEntry[]>("refs", recid);
  const entries =
    cached?.data?.length && Array.isArray(cached.data)
      ? cached.data
      : await fetchReferencesEntries(recid, { signal });
  // A list kept without its papers' data (the citation graph keeps such
  // lists): their identifiers are asked for. Nothing is asked for a list
  // whose papers have all of it.
  const enrichment = await enrichReferencesEntries(entries, { signal });
  const changed = !cached || enrichment.processedRecids.length > 0;
  if (changed && enrichment.complete && entries.length && !signal?.aborted) {
    await localCache.set("refs", recid, entries, undefined, entries.length);
  }
  return entries;
}
