// ─────────────────────────────────────────────────────────────────────────────
// arXiv API client: the current version of papers by identifier (id_list), for
// creating library items from arXiv data, one given version of a paper
// (id_list=<id>v<N>), and searches (search_query) for the arXiv browser. Requests go through the API scheduler (export.arxiv.org, 3 s
// apart). Batches hold at most 50 identifiers and set max_results to the
// batch size (the API's default of 10 would cut a batch short); answers are
// matched to the request by identifier, since the API does not keep the
// requested order, and identifiers missing from an answer are reported. A
// failed batch is sent once more.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ArxivFetchError,
  getArxivApiScheduler,
  type ArxivFetchErrorKind,
  type ArxivScheduler,
} from "./arxivFetch";
import { parseArxivId } from "./arxivId";

const API_URL = "https://export.arxiv.org/api/query";
const ATOM = "http://www.w3.org/2005/Atom";
const ARXIV_NS = "http://arxiv.org/schemas/atom";
const OPENSEARCH_NS = "http://a9.com/-/spec/opensearch/1.1/";

/**
 * Identifiers per request. Canonical identifiers have at most 16 characters
 * (cond-mat/0101001), so a batch's URL stays under 1000 characters.
 */
export const API_BATCH_SIZE = 50;

/** A paper's current version as the API gives it */
export interface ArxivApiEntry {
  /** Canonical identifier, without version */
  id: string;
  /** Current version */
  version: number;
  title: string;
  abstract: string;
  /** Author names as submitted, in order */
  authors: string[];
  /** Submission of version 1 (ISO date-time) */
  published: string;
  /** Submission of the current version (ISO date-time) */
  updated: string;
  /** PDF of the current version */
  pdfUrl?: string;
  /** Journal DOI entered by the authors */
  doi?: string;
  journalRef?: string;
  comments?: string;
  primaryCategory: string;
  /** All categories, the primary one first */
  categories: string[];
}

export type ArxivApiFailureReason = ArxivFetchErrorKind | "http" | "parse";

export interface ArxivApiResult {
  /** Entries by canonical identifier (only identifiers that were asked for) */
  entries: Map<string, ArxivApiEntry>;
  /** Asked for in a batch that was answered, but not in the answer */
  missing: string[];
  /** Batches that failed twice, or were not sent after arXiv refused */
  failed: { ids: string[]; reason: ArxivApiFailureReason; message: string }[];
}

export interface ArxivApiOptions {
  signal?: AbortSignal;
  scheduler?: ArxivScheduler;
  /** Parses the Atom answer (Zotero: DOMParser) */
  parseXml?: (xml: string) => Document;
}

/** Failures after which no further batch is sent */
const STOPPING: ReadonlySet<ArxivApiFailureReason> = new Set([
  "cancelled",
  "forbidden",
  "unavailable",
  "stopped",
]);

/** Split `ids` into batches of at most 50 */
export function apiBatches(ids: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += API_BATCH_SIZE) {
    batches.push(ids.slice(i, i + API_BATCH_SIZE));
  }
  return batches;
}

export function apiUrl(ids: readonly string[]): string {
  return `${API_URL}?id_list=${ids.join(",")}&max_results=${ids.length}`;
}

/** The current version of each paper in `ids` (canonical identifiers) */
export async function fetchArxivApiEntries(
  ids: readonly string[],
  options: ArxivApiOptions = {},
): Promise<ArxivApiResult> {
  const scheduler = options.scheduler ?? getArxivApiScheduler();
  const parseXml =
    options.parseXml ??
    ((xml: string) => new DOMParser().parseFromString(xml, "application/xml"));
  const result: ArxivApiResult = {
    entries: new Map(),
    missing: [],
    failed: [],
  };
  let stop: { reason: ArxivApiFailureReason; message: string } | null = null;

  for (const batch of apiBatches(Array.from(new Set(ids)))) {
    if (stop) {
      result.failed.push({ ids: batch, ...stop });
      continue;
    }
    let answer = await fetchBatch(scheduler, parseXml, batch, options.signal);
    if (!answer.ok && !STOPPING.has(answer.reason)) {
      answer = await fetchBatch(scheduler, parseXml, batch, options.signal);
    }
    if (!answer.ok) {
      result.failed.push({
        ids: batch,
        reason: answer.reason,
        message: answer.message,
      });
      if (STOPPING.has(answer.reason)) {
        stop = {
          reason: answer.reason,
          message: "Not requested: arXiv refused an earlier batch",
        };
      }
      continue;
    }
    for (const id of batch) {
      const entry = answer.entries.get(id);
      if (entry) result.entries.set(id, entry);
      else result.missing.push(id);
    }
  }
  return result;
}

export type ArxivApiVersionAnswer =
  | { ok: true; entry: ArxivApiEntry }
  | { ok: false; reason: ArxivApiFailureReason; message: string };

/**
 * Version `version` of paper `id` (without `version`: its newest), one
 * request: the API then gives that version's title, abstract, authors,
 * comments and categories, with `updated` the submission of that version
 * (`published` stays version 1's)
 */
export async function fetchArxivApiVersion(
  id: string,
  version: number | undefined,
  options: ArxivApiOptions = {},
): Promise<ArxivApiVersionAnswer> {
  const asked = version === undefined ? id : `${id}v${version}`;
  const answer = await fetchBatch(
    options.scheduler ?? getArxivApiScheduler(),
    options.parseXml ??
      ((xml: string) =>
        new DOMParser().parseFromString(xml, "application/xml")),
    [asked],
    options.signal,
  );
  if (!answer.ok) return answer;
  const entry = answer.entries.get(id);
  return entry && (version === undefined || entry.version === version)
    ? { ok: true, entry }
    : {
        ok: false,
        reason: "parse",
        message: `The arXiv API gave no ${asked}`,
      };
}

type BatchAnswer =
  | { ok: true; entries: Map<string, ArxivApiEntry> }
  | { ok: false; reason: ArxivApiFailureReason; message: string };

async function fetchBatch(
  scheduler: ArxivScheduler,
  parseXml: (xml: string) => Document,
  ids: string[],
  signal: AbortSignal | undefined,
): Promise<BatchAnswer> {
  const answer = await requestFeed(scheduler, parseXml, apiUrl(ids), signal);
  if (!answer.ok) return answer;
  try {
    return { ok: true, entries: parseApiFeed(answer.doc) };
  } catch (error) {
    return { ok: false, reason: "parse", message: errorText(error) };
  }
}

type FeedAnswer =
  | { ok: true; doc: Document }
  | {
      ok: false;
      reason: ArxivApiFailureReason;
      message: string;
      /** The answer's text, when arXiv answered with another status */
      text?: string;
    };

/** One request through the scheduler; the answer read as XML */
async function requestFeed(
  scheduler: ArxivScheduler,
  parseXml: (xml: string) => Document,
  url: string,
  signal: AbortSignal | undefined,
): Promise<FeedAnswer> {
  let text: string;
  try {
    const response = await scheduler.request(url, { signal });
    if (response.status !== 200) {
      return {
        ok: false,
        reason: "http",
        message: `HTTP ${response.status} for ${url}`,
        text: response.text,
      };
    }
    text = response.text;
  } catch (error) {
    if (error instanceof ArxivFetchError) {
      return { ok: false, reason: error.kind, message: error.message };
    }
    return { ok: false, reason: "network", message: String(error) };
  }
  try {
    return { ok: true, doc: parseXml(text) };
  } catch (error) {
    return { ok: false, reason: "parse", message: errorText(error) };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elementsNS(
  root: Document | Element,
  ns: string,
  name: string,
): Element[] {
  const list = root.getElementsByTagNameNS(ns, name);
  const elements: Element[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list.item(i);
    if (item) elements.push(item);
  }
  return elements;
}

/** Text of the first child element `name` of `entry` */
function childText(
  entry: Element,
  ns: string,
  name: string,
): string | undefined {
  const child = elementsNS(entry, ns, name).find(
    (element) => element.parentNode === entry,
  );
  return child?.textContent ?? undefined;
}

/** "http://arxiv.org/abs/1706.03762v7" -> identifier and version */
function entryId(text: string): { id: string; version: number } | null {
  const parsed = parseArxivId(text);
  return parsed?.version === undefined
    ? null
    : { id: parsed.id, version: parsed.version };
}

/** The feed element of an API answer; throws when there is none */
function feedOf(doc: Document): Element {
  const feed = doc.documentElement;
  if (!feed || feed.localName !== "feed" || feed.namespaceURI !== ATOM) {
    throw new Error("Not an Atom feed");
  }
  return feed;
}

/** A paper of an API answer; null for an entry without an arXiv identifier */
function parseEntry(element: Element): ArxivApiEntry | null {
  const identity = entryId(childText(element, ATOM, "id") ?? "");
  if (!identity) return null;
  const primary =
    elementsNS(element, ARXIV_NS, "primary_category")[0]?.getAttribute(
      "term",
    ) ?? "";
  const categories = elementsNS(element, ATOM, "category")
    .map((category) => category.getAttribute("term") ?? "")
    .filter(Boolean);
  const pdfUrl = elementsNS(element, ATOM, "link")
    .find((link) => link.getAttribute("title") === "pdf")
    ?.getAttribute("href");
  const entry: ArxivApiEntry = {
    ...identity,
    title: (childText(element, ATOM, "title") ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    abstract: (childText(element, ATOM, "summary") ?? "").trim(),
    authors: elementsNS(element, ATOM, "author").map((author) =>
      (childText(author, ATOM, "name") ?? "").trim(),
    ),
    published: (childText(element, ATOM, "published") ?? "").trim(),
    updated: (childText(element, ATOM, "updated") ?? "").trim(),
    primaryCategory: primary,
    categories: primary
      ? [primary, ...categories.filter((category) => category !== primary)]
      : categories,
  };
  if (pdfUrl) entry.pdfUrl = pdfUrl;
  const doi = childText(element, ARXIV_NS, "doi")?.trim();
  if (doi) entry.doi = doi;
  const journalRef = childText(element, ARXIV_NS, "journal_ref")?.trim();
  if (journalRef) entry.journalRef = journalRef;
  const comments = childText(element, ARXIV_NS, "comment")?.trim();
  if (comments) entry.comments = comments;
  return entry;
}

/**
 * The entries of an API answer by canonical identifier. Entries without an
 * arXiv identifier (the API's error entries) are left out.
 */
export function parseApiFeed(doc: Document): Map<string, ArxivApiEntry> {
  feedOf(doc);
  const entries = new Map<string, ArxivApiEntry>();
  for (const element of elementsNS(doc, ATOM, "entry")) {
    const entry = parseEntry(element);
    if (entry) entries.set(entry.id, entry);
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// Searches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Results the API gives for one search: with start + max_results above
 * 10000 it answers HTTP 500 (tried on 29 September 2026; its manual names
 * 30000)
 */
export const SEARCH_RESULT_LIMIT = 10000;

/** The API's field prefixes and its date filter */
const SEARCH_FIELDS = /^(ti|au|abs|co|jr|cat|rn|id|all|submittedDate):/;
const OPERATORS = new Set(["AND", "OR", "ANDNOT"]);

/**
 * The search_query for what was typed in the search box. arXiv's syntax
 * passes through (field prefixes such as au: ti: abs: cat: all:, AND / OR /
 * ANDNOT, also in lower case, "phrases", parentheses, submittedDate:[… TO
 * …]); a word or phrase
 * without a prefix searches all fields (all:). Terms without an operator
 * between them must all match (AND): arXiv itself would read the space as
 * OR. "" when nothing was typed.
 */
export function arxivSearchQuery(text: string): string {
  const tokens =
    text.match(/[()]|[^\s()"[]*(?:"[^"]*"?|\[[^\]]*\]?)|[^\s()]+/g) ?? [];
  const parts: string[] = [];
  let operand = false;
  for (const raw of tokens) {
    // "pion or kaon" as typed naturally
    const token = OPERATORS.has(raw.toUpperCase()) ? raw.toUpperCase() : raw;
    if (OPERATORS.has(token)) {
      parts.push(token);
      operand = false;
      continue;
    }
    if (token === ")") {
      parts.push(token);
      operand = true;
      continue;
    }
    if (operand) parts.push("AND");
    if (token === "(") {
      parts.push(token);
      operand = false;
      continue;
    }
    // An unclosed quote or bracket is closed at the end
    let term = token;
    if ((term.match(/"/g)?.length ?? 0) % 2) term += '"';
    if (term.includes("[") && !term.includes("]")) term += "]";
    parts.push(SEARCH_FIELDS.test(term) ? term : `all:${term}`);
    operand = true;
  }
  // No operator at the end, no empty group
  while (OPERATORS.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

/** The API request for results start … start + count - 1, newest first */
export function searchUrl(query: string, start: number, count: number): string {
  const encoded = encodeURIComponent(query).replace(/%20/g, "+");
  return `${API_URL}?search_query=${encoded}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${count}`;
}

export type ArxivSearchAnswer =
  | {
      ok: true;
      /** The papers of this request, in arXiv's order */
      entries: ArxivApiEntry[];
      /** Papers matching the search (opensearch:totalResults) */
      total: number;
    }
  | {
      ok: false;
      /** query: arXiv did not accept the search (its message) */
      reason: ArxivApiFailureReason | "query";
      message: string;
    };

/** The error entry's message of an API answer, if it has one */
function errorMessage(doc: Document): string | undefined {
  const entry = elementsNS(doc, ATOM, "entry").find((element) =>
    (childText(element, ATOM, "id") ?? "").includes("/api/errors"),
  );
  return entry
    ? (childText(entry, ATOM, "summary") ?? "").trim() || "Error"
    : undefined;
}

/** The papers and total of a search's answer; throws when it is no feed */
export function parseSearchFeed(doc: Document): ArxivSearchAnswer {
  const feed = feedOf(doc);
  const message = errorMessage(doc);
  if (message !== undefined) return { ok: false, reason: "query", message };
  const total = Number(
    elementsNS(feed, OPENSEARCH_NS, "totalResults")[0]?.textContent,
  );
  const entries = elementsNS(doc, ATOM, "entry")
    .map(parseEntry)
    .filter((entry): entry is ArxivApiEntry => entry !== null);
  return {
    ok: true,
    entries,
    total: Number.isFinite(total) ? total : entries.length,
  };
}

/**
 * Results start … start + count - 1 of a search (a search_query from
 * arxivSearchQuery), newest submission first; one request. A search arXiv
 * refuses (HTTP 400 with an error entry) gives reason "query".
 */
export async function searchArxiv(
  query: string,
  start: number,
  count: number,
  options: ArxivApiOptions = {},
): Promise<ArxivSearchAnswer> {
  const scheduler = options.scheduler ?? getArxivApiScheduler();
  const parseXml =
    options.parseXml ??
    ((xml: string) => new DOMParser().parseFromString(xml, "application/xml"));
  const answer = await requestFeed(
    scheduler,
    parseXml,
    searchUrl(query, start, count),
    options.signal,
  );
  if (!answer.ok) {
    // arXiv explains a search it refuses in an error entry
    if (answer.reason === "http" && answer.text) {
      try {
        const refused = parseSearchFeed(parseXml(answer.text));
        if (!refused.ok) return refused;
      } catch {
        // No feed: the status is all there is
      }
    }
    return { ok: false, reason: answer.reason, message: answer.message };
  }
  try {
    return parseSearchFeed(answer.doc);
  } catch (error) {
    return { ok: false, reason: "parse", message: errorText(error) };
  }
}
