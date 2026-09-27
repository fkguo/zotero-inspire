// ─────────────────────────────────────────────────────────────────────────────
// arXiv API client: the current version of papers by identifier (id_list), for
// creating library items from arXiv data. Requests go through the API
// scheduler (export.arxiv.org, 3 s apart). Batches hold at most 50
// identifiers and set max_results to the batch size (the API's default of 10
// would cut a batch short); answers are matched to the request by identifier,
// since the API does not keep the requested order, and identifiers missing
// from an answer are reported. A failed batch is sent once more.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ArxivFetchError,
  getArxivApiScheduler,
  type ArxivFetchErrorKind,
  type ArxivScheduler,
} from "./arxivFetch";
import { listingId } from "./listingParser";

const API_URL = "https://export.arxiv.org/api/query";
const ATOM = "http://www.w3.org/2005/Atom";
const ARXIV_NS = "http://arxiv.org/schemas/atom";

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

type BatchAnswer =
  | { ok: true; entries: Map<string, ArxivApiEntry> }
  | { ok: false; reason: ArxivApiFailureReason; message: string };

async function fetchBatch(
  scheduler: ArxivScheduler,
  parseXml: (xml: string) => Document,
  ids: string[],
  signal: AbortSignal | undefined,
): Promise<BatchAnswer> {
  const url = apiUrl(ids);
  let text: string;
  try {
    const response = await scheduler.request(url, { signal });
    if (response.status !== 200) {
      return {
        ok: false,
        reason: "http",
        message: `HTTP ${response.status} for ${url}`,
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
    return { ok: true, entries: parseApiFeed(parseXml(text)) };
  } catch (error) {
    return {
      ok: false,
      reason: "parse",
      message: error instanceof Error ? error.message : String(error),
    };
  }
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
  const match = text
    .trim()
    .match(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/abs\/(.+)v(\d+)$/);
  const id = match ? listingId(match[1]) : null;
  return id ? { id, version: Number(match![2]) } : null;
}

/**
 * The entries of an API answer by canonical identifier. Entries without an
 * arXiv identifier (the API's error entries) are left out.
 */
export function parseApiFeed(doc: Document): Map<string, ArxivApiEntry> {
  const feed = doc.documentElement;
  if (!feed || feed.localName !== "feed" || feed.namespaceURI !== ATOM) {
    throw new Error("Not an Atom feed");
  }
  const entries = new Map<string, ArxivApiEntry>();
  for (const element of elementsNS(doc, ATOM, "entry")) {
    const identity = entryId(childText(element, ATOM, "id") ?? "");
    if (!identity) continue;
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
    entries.set(entry.id, entry);
  }
  return entries;
}
