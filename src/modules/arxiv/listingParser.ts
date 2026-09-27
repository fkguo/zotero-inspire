// ─────────────────────────────────────────────────────────────────────────────
// listingParser: reads arXiv listing pages (/list/<x>/new, /catchup/<x>/<date>,
// the date index of /list/math/recent) and checks them.
//
// Each page is checked on its own: every <dt> has exactly one following <dd>,
// both give an identifier and a title; each section has as many entries as its
// heading shows; identifiers are unique on the page; an empty page ("No
// updates today." / "Total of 0 entries") is a complete page with no papers.
// The pages of one day are then checked together: they show the same date and
// total, follow each other without gap, add up to the total (and each section
// to its total), and no identifier repeats.
// ─────────────────────────────────────────────────────────────────────────────

import { parseListingDate, type IsoDate } from "./arxivDates";
import { parseArxivId } from "./arxivId";
import {
  LISTING_SECTIONS,
  type ListingAuthor,
  type ListingPage,
  type ListingPageEntry,
  type ListingPageKind,
  type ListingPageSection,
  type ListingSection,
  type SpecDayListing,
} from "./listingTypes";

/** A page that cannot be read, or pages that do not agree */
export class ListingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingParseError";
  }
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

const SECTION_NAMES: Record<string, ListingSection> = {
  new: "new",
  cross: "cross",
  replacement: "replace",
};

/** "New submissions (continued, showing last 19 of 119 entries)" */
const SECTION_HEADING =
  /^(New|Cross|Replacement)\s+submissions\s*\(\s*(?:continued\s*,\s*)?showing\s+(?:(?:first|last)\s+)?(\d+)\s+of\s+(\d+)\s+entries\s*\)$/;

const CATEGORY_ID = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z]+(?:-[A-Za-z]+)*)?$/;

// ─────────────────────────────────────────────────────────────────────────────
// Text helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Text of `node` as arXiv shows it: <br> becomes a line break, links and
 * other elements contribute their text, `span.descriptor` labels ("Title:")
 * are left out; white space from the HTML source collapses to single spaces.
 */
function displayText(node: Node): string {
  const parts: string[] = [];
  const walk = (current: Node) => {
    for (const child of childNodesOf(current)) {
      if (child.nodeType === TEXT_NODE) {
        parts.push((child.nodeValue ?? "").replace(/\s+/g, " "));
      } else if (child.nodeType === ELEMENT_NODE) {
        const element = child as Element;
        if (element.localName === "br") {
          parts.push("\n");
        } else if (!element.classList.contains("descriptor")) {
          walk(element);
        }
      }
    }
  };
  walk(node);
  return parts
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Elements under `root` matching `selector`, in document order */
function queryAll(root: Document | Element, selector: string): Element[] {
  const list = root.querySelectorAll(selector);
  const elements: Element[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list.item(i);
    if (item) elements.push(item as Element);
  }
  return elements;
}

function childNodesOf(node: Node): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes.item(i);
    if (child) nodes.push(child);
  }
  return nodes;
}

function childrenOf(element: Element): Element[] {
  const elements: Element[] = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children.item(i);
    if (child) elements.push(child);
  }
  return elements;
}

/** Text content with all white space collapsed */
function flatText(node: Node | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function childElements(element: Element, name: string): Element[] {
  return childrenOf(element).filter((child) => child.localName === name);
}

function getDlpage(doc: Document): Element {
  const dlpage = doc.getElementById("dlpage");
  if (!dlpage) throw new ListingParseError("No listing content (#dlpage)");
  return dlpage;
}

function requireDate(text: string, what: string): IsoDate {
  const date = parseListingDate(text);
  if (!date) throw new ListingParseError(`Unreadable ${what}: "${text}"`);
  return date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entries
// ─────────────────────────────────────────────────────────────────────────────

function parseAuthor(link: Element): ListingAuthor {
  const display = flatText(link);
  let query: string | null = null;
  try {
    query = new URL(
      link.getAttribute("href") ?? "",
      "https://arxiv.org",
    ).searchParams.get("query");
  } catch {
    query = null;
  }
  // arXiv's query is "<surname>, <initials>" with the surname's particles
  // ("Di Vora, R"); collaborations and one-word names have no comma
  const comma = query?.indexOf(",") ?? -1;
  if (query && comma > 0) {
    const family = query.slice(0, comma).replace(/\s+/g, " ").trim();
    if (display.endsWith(` ${family}`)) {
      const given = display.slice(0, display.length - family.length).trim();
      return { display, family, given };
    }
  }
  return { display };
}

function parseCategories(subjects: Element): {
  primary: string;
  all: string[];
} {
  const categoryOf = (text: string): string => {
    const id = text.match(/\(([^()]+)\)\s*$/)?.[1]?.trim() ?? "";
    if (!CATEGORY_ID.test(id)) {
      throw new ListingParseError(`Unreadable subject: "${text}"`);
    }
    return id;
  };
  const primaryElement = subjects.querySelector(".primary-subject");
  if (!primaryElement) throw new ListingParseError("Entry without subjects");
  const primary = categoryOf(flatText(primaryElement));
  const all = displayText(subjects)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(categoryOf);
  if (all[0] !== primary) {
    throw new ListingParseError(`Primary subject ${primary} is not first`);
  }
  return { primary, all };
}

function parseEntry(
  dt: Element,
  dd: Element,
  section: ListingSection,
): ListingPageEntry {
  const absLink = queryAll(dt, "a").find((link) =>
    (link.getAttribute("href") ?? "").startsWith("/abs/"),
  );
  const rawId = absLink?.getAttribute("href")?.slice("/abs/".length) ?? "";
  const id = parseArxivId(rawId)?.id;
  if (!id) throw new ListingParseError(`Entry without identifier: "${rawId}"`);

  // The version is only in the entry's HTML link, when it has one
  let version: number | undefined;
  for (const link of queryAll(dt, "a")) {
    const html = (link.getAttribute("href") ?? "").match(
      /^https:\/\/arxiv\.org\/html\/(.+)$/,
    );
    const linked = html ? parseArxivId(html[1]) : null;
    if (linked?.id === id && linked.version !== undefined) {
      version = linked.version;
    }
  }

  const titleElement = dd.querySelector(".list-title");
  const title = titleElement ? displayText(titleElement) : "";
  if (!title) throw new ListingParseError(`Entry ${id} without title`);

  const authorsElement = dd.querySelector(".list-authors");
  const authors = authorsElement
    ? queryAll(authorsElement, "a").map(parseAuthor)
    : [];

  const subjects = dd.querySelector(".list-subjects");
  if (!subjects) throw new ListingParseError(`Entry ${id} without subjects`);
  const { primary, all } = parseCategories(subjects);

  const abstractElement = dd.querySelector("p.mathjax");
  const commentsElement = dd.querySelector(".list-comments");
  const journalRefElement = dd.querySelector(".list-journal-ref");

  const entry: ListingPageEntry = {
    id,
    title,
    authors,
    abstract: abstractElement ? displayText(abstractElement) : "",
    primaryCategory: primary,
    categories: all,
    section,
  };
  if (version !== undefined) entry.version = version;
  const comments = commentsElement ? displayText(commentsElement) : "";
  if (comments) entry.comments = comments;
  const journalRef = journalRefElement ? displayText(journalRefElement) : "";
  if (journalRef) entry.journalRef = journalRef;
  return entry;
}

/** The sections and entries of the page's <dl> lists, checked */
function parseLists(dlpage: Element): {
  sections: ListingPageSection[];
  entries: ListingPageEntry[];
} {
  const sections: ListingPageSection[] = [];
  const entries: ListingPageEntry[] = [];
  for (const dl of queryAll(dlpage, "dl")) {
    const children = childrenOf(dl);
    const heading = children[0];
    const match =
      heading?.localName === "h3"
        ? flatText(heading).match(SECTION_HEADING)
        : null;
    if (!match) {
      throw new ListingParseError(
        `Unreadable section heading: "${flatText(heading)}"`,
      );
    }
    const section = SECTION_NAMES[match[1].toLowerCase()];
    const shown = Number(match[2]);
    const total = Number(match[3]);
    if (sections.some((known) => known.section === section)) {
      throw new ListingParseError(`Section ${section} appears twice`);
    }

    let count = 0;
    for (let i = 1; i < children.length; i += 2) {
      const dt = children[i];
      const dd = children[i + 1];
      if (dt.localName !== "dt" || dd?.localName !== "dd") {
        throw new ListingParseError(
          `Section ${section}: <${dt.localName}> where a <dt> with its <dd> belongs`,
        );
      }
      entries.push(parseEntry(dt, dd, section));
      count++;
    }
    if (count !== shown) {
      throw new ListingParseError(
        `Section ${section}: ${count} entries, heading shows ${shown}`,
      );
    }
    sections.push({ section, shown, total });
  }

  const order = sections.map((known) =>
    LISTING_SECTIONS.indexOf(known.section),
  );
  if (order.some((index, i) => i > 0 && index < order[i - 1])) {
    throw new ListingParseError("Sections out of order");
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new ListingParseError(`${entry.id} appears twice on the page`);
    }
    seen.add(entry.id);
  }
  return { sections, entries };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────────────────────

/** Parse and check a /list/<x>/new page */
export function parseNewPage(doc: Document): ListingPage {
  const dlpage = getDlpage(doc);

  const header = childElements(dlpage, "h3")
    .map((h3) => flatText(h3).match(/^Showing new listings for (.+)$/))
    .find(Boolean);
  if (!header) throw new ListingParseError("No listing date");
  const date = requireDate(header[1], "listing date");

  const paging = dlpage.querySelector("div.paging");
  const { sections, entries } = parseLists(dlpage);

  if (!paging) {
    // Only a day without papers has no "Total of N entries"
    const noUpdates = queryAll(dlpage, "p").some(
      (p) => flatText(p) === "No updates today.",
    );
    if (!noUpdates || entries.length > 0) {
      throw new ListingParseError("Neither entries nor 'No updates today.'");
    }
    return {
      kind: "new",
      date,
      total: 0,
      sections,
      entries,
      firstIndex: 1,
      next: null,
    };
  }

  const totalMatch = flatText(paging).match(/^Total of (\d+) entries/);
  if (!totalMatch) throw new ListingParseError("No 'Total of N entries'");
  const total = Number(totalMatch[1]);
  if (total === 0 || entries.length === 0) {
    throw new ListingParseError(
      `Total of ${total} entries, ${entries.length} shown`,
    );
  }

  // On a day spread over several pages the current page's range is a
  // <span>a-b</span> and the other pages are links "c-d"
  const range = queryAll(paging, "span")
    .map((span) => flatText(span).match(/^(\d+)-(\d+)$/))
    .find(Boolean);
  let firstIndex = 1;
  let lastIndex = total;
  let next: number | null = null;
  if (range) {
    firstIndex = Number(range[1]);
    lastIndex = Number(range[2]);
    if (lastIndex < total) {
      const nextLink = queryAll(paging, "a").find(
        (link) =>
          flatText(link).match(/^(\d+)-\d+$/)?.[1] === String(lastIndex + 1),
      );
      const skip = nextLink ? linkParam(nextLink, "skip") : null;
      if (skip !== String(lastIndex)) {
        throw new ListingParseError(
          `No link to the page after entry ${lastIndex}`,
        );
      }
      next = lastIndex;
    }
  }
  if (entries.length !== lastIndex - firstIndex + 1) {
    throw new ListingParseError(
      `${entries.length} entries on the page of entries ${firstIndex}-${lastIndex}`,
    );
  }
  return { kind: "new", date, total, sections, entries, firstIndex, next };
}

/** Parse and check a /catchup/<x>/<date> page */
export function parseCatchupPage(doc: Document): ListingPage {
  const dlpage = getDlpage(doc);

  const title = flatText(childElements(dlpage, "h1")[0]).match(
    /^Catchup results for .+ on ([A-Za-z]+, \d{1,2} [A-Za-z]+ \d{4})$/,
  );
  if (!title) throw new ListingParseError("No catch-up date");
  const date = requireDate(title[1], "catch-up date");

  const TOTAL =
    /Total of (\d+) entries for ([A-Za-z]+, \d{1,2} [A-Za-z]+ \d{4})/;
  const summary = childElements(dlpage, "div").find((div) =>
    TOTAL.test(flatText(div)),
  );
  const totalMatch = summary ? flatText(summary).match(TOTAL) : null;
  if (!summary || !totalMatch) {
    throw new ListingParseError("No 'Total of N entries for <date>'");
  }
  if (requireDate(totalMatch[2], "catch-up date") !== date) {
    throw new ListingParseError("Catch-up page shows two dates");
  }
  const total = Number(totalMatch[1]);

  // Several pages: "View page: <a>1</a> <span>2</span> …" after the total
  const current = queryAll(summary, "span")
    .map((span) => flatText(span))
    .find((text) => /^\d+$/.test(text));
  const pageNumber = current ? Number(current) : 1;
  let next: number | null = null;
  const nextLink = queryAll(summary, "a").find(
    (link) => flatText(link) === String(pageNumber + 1),
  );
  if (nextLink) {
    if (linkParam(nextLink, "page") !== String(pageNumber + 1)) {
      throw new ListingParseError("Unreadable link to the next page");
    }
    next = pageNumber + 1;
  }

  const nextDays = queryAll(dlpage, "a")
    .filter((link) => flatText(link) === "Continue to the next day")
    .map((link) => catchupLinkDate(link));
  if (nextDays.some((day) => day !== nextDays[0])) {
    throw new ListingParseError("Two different 'next day' links");
  }
  const nextDay = nextDays[0] ?? null;

  const { sections, entries } = parseLists(dlpage);
  if (total === 0) {
    if (entries.length > 0) {
      throw new ListingParseError(
        `Total of 0 entries, ${entries.length} shown`,
      );
    }
  } else if (entries.length === 0) {
    throw new ListingParseError(
      `Total of ${total} entries, none on page ${pageNumber}`,
    );
  }
  // Position of the first entry within the day: its "[2001]" item number
  let firstIndex = 1;
  if (entries.length > 0) {
    const anchor = dlpage.querySelector("dl dt a[name]")?.getAttribute("name");
    const item = anchor?.match(/^item(\d+)$/)?.[1];
    if (!item) throw new ListingParseError("Entry without item number");
    firstIndex = Number(item);
  }
  return {
    kind: "catchup",
    date,
    total,
    sections,
    entries,
    firstIndex,
    next,
    pageNumber,
    nextDay,
  };
}

/** A query parameter of a link's href, or null */
function linkParam(link: Element, name: string): string | null {
  try {
    return new URL(
      link.getAttribute("href") ?? "",
      "https://arxiv.org",
    ).searchParams.get(name);
  } catch {
    return null;
  }
}

/** The date of a /catchup/<subject>/<YYYY-MM-DD> link */
function catchupLinkDate(link: Element): IsoDate {
  let path = "";
  try {
    path = new URL(link.getAttribute("href") ?? "", "https://arxiv.org")
      .pathname;
  } catch {
    path = "";
  }
  const date = path.match(/^\/catchup\/[^/]+\/(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new ListingParseError(`Unreadable 'next day' link: "${path}"`);
  }
  return date;
}

/**
 * The announcement dates listed at the top of a /list/<x>/recent page
 * (newest first). Only the index is read, not the papers.
 */
export function parseRecentIndex(doc: Document): IsoDate[] {
  const dlpage = getDlpage(doc);
  const heading = childElements(dlpage, "h2").find(
    (h2) => flatText(h2) === "Authors and titles for recent submissions",
  );
  const list = heading?.nextElementSibling;
  if (!list || list.localName !== "ul") {
    throw new ListingParseError("No date index on the recent page");
  }
  const dates = queryAll(list, "li a").map((link) =>
    requireDate(flatText(link), "recent date"),
  );
  if (dates.length === 0) throw new ListingParseError("Empty date index");
  if (dates.some((date, i) => i > 0 && date >= dates[i - 1])) {
    throw new ListingParseError("Date index not in descending order");
  }
  return dates;
}

// ─────────────────────────────────────────────────────────────────────────────
// A whole day
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check the pages of one category (or archive) for one day together and
 * join them. `pages` are in the order they were fetched, first page first.
 */
export function assembleSpecDay(
  spec: string,
  pages: readonly ListingPage[],
  fetchedAt: number,
): SpecDayListing {
  const first = pages[0];
  if (!first) throw new ListingParseError("No pages");
  for (const page of pages) {
    if (page.kind !== first.kind)
      throw new ListingParseError("Mixed page kinds");
    if (page.date !== first.date) {
      throw new ListingParseError(`Pages show ${first.date} and ${page.date}`);
    }
    if (page.total !== first.total) {
      throw new ListingParseError(
        `Pages show totals ${first.total} and ${page.total}`,
      );
    }
  }

  let expectedIndex = 1;
  for (const [i, page] of pages.entries()) {
    if (page.firstIndex !== expectedIndex) {
      throw new ListingParseError(
        `Page ${i + 1} starts at entry ${page.firstIndex}, expected ${expectedIndex}`,
      );
    }
    const isLast = i === pages.length - 1;
    if ((page.next === null) !== isLast) {
      throw new ListingParseError(
        isLast
          ? "The last page links to a further page"
          : "A page without next page",
      );
    }
    expectedIndex += page.entries.length;
  }

  const entries = pages.flatMap((page) => page.entries);
  if (entries.length !== first.total) {
    throw new ListingParseError(
      `${entries.length} entries on the pages, total ${first.total}`,
    );
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new ListingParseError(`${entry.id} appears on two pages`);
    }
    seen.add(entry.id);
  }

  for (const section of LISTING_SECTIONS) {
    const parts = pages.flatMap((page) =>
      page.sections.filter((known) => known.section === section),
    );
    if (parts.length === 0) continue;
    const total = parts[0].total;
    const shown = parts.reduce((sum, part) => sum + part.shown, 0);
    if (parts.some((part) => part.total !== total) || shown !== total) {
      throw new ListingParseError(
        `Section ${section}: ${shown} entries on the pages, heading total ${total}`,
      );
    }
  }

  const listing: SpecDayListing = {
    spec,
    date: first.date,
    source: first.kind,
    total: first.total,
    entries,
    fetchedAt,
  };
  if (first.kind === "catchup") {
    listing.nextDay = pages.find((page) => page.nextDay)?.nextDay ?? null;
  }
  return listing;
}

/** Parse the HTML of a listing page of the given kind */
export function parseListingPage(
  doc: Document,
  kind: ListingPageKind,
): ListingPage {
  return kind === "new" ? parseNewPage(doc) : parseCatchupPage(doc);
}
