// ─────────────────────────────────────────────────────────────────────────────
// arXiv identifiers: strict parsing and the fields of a Zotero item that hold
// them. Every reader of an arXiv ID goes through parseArxivId, so an item, a
// PDF reference and an INSPIRE record agree on the same canonical form.
// ─────────────────────────────────────────────────────────────────────────────

import { archives } from "./arxivArchives.json";

/** An arXiv identifier in canonical form and the version the input named */
export interface ArxivId {
  /**
   * YYMM.NNNN (2007-04 to 2014-12), YYMM.NNNNN (from 2015) or
   * archive/YYMMNNN (1991-07 to 2007-03, without subject class)
   */
  id: string;
  version?: number;
}

/** Archive -> lower-case subject classes, from arXiv's taxonomy */
const ARCHIVE_SUBJECT_CLASSES: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map(
  archives.map((archive) => [
    archive.id,
    new Set(archive.subjectClasses.map((name) => name.toLowerCase())),
  ]),
);

const URL_FORM =
  /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/([^?#]+)(?:[?#].*)?$/i;
const DOI_FORM = /^10\.48550\/arxiv\.(.+)$/i;
const PREFIX_FORM = /^arxiv\s*:\s*(.+)$/i;
const VERSIONED = /^(.+?)v([1-9]\d*)$/i;
const NEW_STYLE = /^(\d\d)(\d\d)\.(\d{4,5})$/;
const OLD_STYLE =
  /^([a-z]+(?:-[a-z]+)?)(?:\.([a-z]+(?:-[a-z]+)?))?\/(\d\d)(\d\d)(\d{3})$/i;

/**
 * The arXiv identifier written in `input`, or null when `input` is not one.
 * Accepts a bare identifier, "arXiv:<id>", an arxiv.org (www., export.) abs or
 * pdf URL (query string and ".pdf" dropped) and the DOI 10.48550/arXiv.<id>,
 * each with an optional version vN. Rejects incomplete numbers, impossible
 * months, four-digit numbers from 2015 on (1501.0123 is not 1501.01234) and
 * archive names arXiv never had; old-style subject classes (math.GT) must be
 * classes of their archive and are dropped from the canonical form.
 */
export function parseArxivId(input: string | null | undefined): ArxivId | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  const url = value.match(URL_FORM);
  if (url) {
    value = url[1].replace(/\.pdf$/i, "");
  } else {
    value = (value.match(DOI_FORM) ?? value.match(PREFIX_FORM))?.[1] ?? value;
  }

  let version: number | undefined;
  const versioned = value.match(VERSIONED);
  if (versioned) {
    value = versioned[1];
    version = Number(versioned[2]);
  }

  const id = newStyleId(value) ?? oldStyleId(value);
  if (!id) return null;
  return version === undefined ? { id } : { id, version };
}

function newStyleId(value: string): string | null {
  const match = value.match(NEW_STYLE);
  if (!match) return null;
  const [, yy, mm, number] = match;
  const yymm = Number(yy) * 100 + Number(mm);
  const month = Number(mm);
  const valid =
    month >= 1 &&
    month <= 12 &&
    yymm >= 704 &&
    number.length === (yymm >= 1501 ? 5 : 4) &&
    Number(number) > 0;
  return valid ? value : null;
}

function oldStyleId(value: string): string | null {
  const match = value.match(OLD_STYLE);
  if (!match) return null;
  const [, archiveName, subjectClass, yy, mm, number] = match;
  const archive = archiveName.toLowerCase();
  const subjectClasses = ARCHIVE_SUBJECT_CLASSES.get(archive);
  if (!subjectClasses) return null;
  if (subjectClass && !subjectClasses.has(subjectClass.toLowerCase())) {
    return null;
  }
  const month = Number(mm);
  // Years 91-99 are 1991-1999, 00-07 are 2000-2007
  const year = (Number(yy) >= 91 ? 1900 : 2000) + Number(yy);
  const date = year * 100 + month;
  const valid =
    month >= 1 &&
    month <= 12 &&
    date >= 199107 &&
    date <= 200703 &&
    Number(number) > 0;
  return valid ? `${archive}/${yy}${mm}${number}` : null;
}

/** Digits of the sequence number in a sort key */
const SORT_KEY_SEQUENCE_DIGITS = 5;

/**
 * Sort key of a canonical arXiv ID (parseArxivId): year, month and the
 * zero-padded sequence number, so that old-style (1991-2007) and new-style
 * identifiers sort together by date. "" for anything else.
 */
export function arxivSortKey(arxivId: string): string {
  const newStyle = arxivId.match(/^(\d\d)(\d\d)\.(\d{4,5})$/);
  const match = newStyle ?? arxivId.match(/^[a-z-]+\/(\d\d)(\d\d)(\d{3})$/);
  if (!match) return "";
  const [, yy, mm, seq] = match;
  // Old-style years 91-99 are 1991-1999, all other years 20YY
  const year = (!newStyle && Number(yy) >= 91 ? 1900 : 2000) + Number(yy);
  return `${year}${mm}${seq.padStart(SORT_KEY_SEQUENCE_DIGITS, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidates in the fields of a Zotero item
// ─────────────────────────────────────────────────────────────────────────────

/** Fields of a Zotero item that can hold an arXiv identifier */
export interface ArxivIdFields {
  extra?: string;
  journalAbbreviation?: string;
  archiveID?: string;
  url?: string;
  DOI?: string;
  archiveLocation?: string;
  archive?: string;
}

/**
 * Candidates of Extra: at the start of a line, "arXiv:<id>" (a category in
 * brackets may follow), "_eprint:<id>" or "DOI: 10.48550/arXiv.<id>".
 */
export function arxivCandidatesFromExtra(extra: string | undefined): string[] {
  const candidates: string[] = [];
  for (const line of (extra ?? "").split(/\r?\n/)) {
    const match =
      line.match(/^\s*arxiv:\s*([^\s[]+)/i) ??
      line.match(/^\s*_eprint:\s*(\S+)/i) ??
      line.match(/^\s*doi:\s*10\.48550\/arxiv\.(\S+)/i);
    if (match) candidates.push(match[1]);
  }
  return candidates;
}

/**
 * Journal Abbr (the plugin's legacy layout): the whole value
 * "arXiv:<id> [category]"
 */
export function arxivCandidateFromJournalAbbreviation(
  value: string | undefined,
): string | null {
  const match = (value ?? "").match(
    /^\s*arxiv:\s*(\S+?)(?:\s*\[[^\]]*\])?\s*$/i,
  );
  return match ? match[1] : null;
}

/** Archive ID (Zotero's arXiv translator): the whole value "arXiv:<id>" */
export function arxivCandidateFromArchiveID(
  value: string | undefined,
): string | null {
  const match = (value ?? "").match(/^\s*arxiv:\s*(\S+)\s*$/i);
  return match ? match[1] : null;
}

const ARXIV_HOSTS: ReadonlySet<string> = new Set([
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
]);

/**
 * URL: an http(s) link to an abs or pdf page on arxiv.org (www., export.);
 * the candidate is the path after /abs/ or /pdf/: one segment for a new-style
 * identifier, two for an old-style one (abs/hep-ph/0101001).
 */
export function arxivCandidateFromUrl(url: string | undefined): string | null {
  let parsed: URL;
  try {
    parsed = new URL((url ?? "").trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!ARXIV_HOSTS.has(parsed.hostname)) return null;
  const match = parsed.pathname.match(/^\/(?:abs|pdf)\/([^/]+(?:\/[^/]+)?)$/);
  return match ? match[1].replace(/\.pdf$/i, "") : null;
}

/** DOI: the part after 10.48550/arXiv. */
export function arxivCandidateFromDOI(doi: string | undefined): string | null {
  const match = (doi ?? "").match(/^\s*10\.48550\/arxiv\.(\S+)\s*$/i);
  return match ? match[1] : null;
}

/**
 * Archive Location: the whole value "arXiv:<id>", or the whole value when
 * Archive is "arXiv". The plugin keeps the INSPIRE recid there, so a bare
 * number under any other Archive is not a candidate.
 */
export function arxivCandidateFromArchiveLocation(
  archiveLocation: string | undefined,
  archive: string | undefined,
): string | null {
  const value = (archiveLocation ?? "").trim();
  if (!value) return null;
  const prefixed = value.match(/^arxiv:\s*(\S+)$/i);
  if (prefixed) return prefixed[1];
  return /^arxiv$/i.test((archive ?? "").trim()) ? value : null;
}

/**
 * Canonical arXiv IDs of an item's fields, each once, in the order Extra,
 * Journal Abbr, Archive ID, URL, DOI, Archive Location.
 */
export function arxivIdsFromFields(fields: ArxivIdFields): string[] {
  const candidates = [
    ...arxivCandidatesFromExtra(fields.extra),
    arxivCandidateFromJournalAbbreviation(fields.journalAbbreviation),
    arxivCandidateFromArchiveID(fields.archiveID),
    arxivCandidateFromUrl(fields.url),
    arxivCandidateFromDOI(fields.DOI),
    arxivCandidateFromArchiveLocation(fields.archiveLocation, fields.archive),
  ];
  const ids: string[] = [];
  for (const candidate of candidates) {
    const id = parseArxivId(candidate)?.id;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

const ARXIV_ID_FIELD_NAMES = [
  "extra",
  "journalAbbreviation",
  "archiveID",
  "url",
  "DOI",
  "archiveLocation",
  "archive",
] as const;

/** The fields of `item` that can hold an arXiv ID ("" when the type lacks one) */
export function arxivIdFieldsOfItem(
  item: Zotero.Item,
): Required<ArxivIdFields> {
  const fields = {} as Required<ArxivIdFields>;
  for (const name of ARXIV_ID_FIELD_NAMES) {
    const value = item.getField(name);
    fields[name] = typeof value === "string" ? value : "";
  }
  return fields;
}

/** The arXiv ID of a Zotero item: the first of arxivIdsFromFields, or null */
export function arxivIdFromItem(item: Zotero.Item): string | null {
  return arxivIdsFromFields(arxivIdFieldsOfItem(item))[0] ?? null;
}
