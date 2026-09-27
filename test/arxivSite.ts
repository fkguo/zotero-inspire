// A simulated arxiv.org for tests of the listing service: listing pages built
// like arxiv-browse builds them (templates list/new.html, catchup.html,
// list/recent.html; headings and paging as in controllers/list_page and
// catchup_page), served over a simulated network on a VirtualClock.

import type {
  ArxivResponse,
  ArxivTransport,
} from "../src/modules/arxiv/arxivFetch";
import { ArxivFetchError } from "../src/modules/arxiv/arxivFetch";
import type { ListingSection } from "../src/modules/arxiv/listingTypes";
import type { VirtualClock } from "./virtualClock";

export interface SiteEntry {
  id: string;
  section: ListingSection;
  primary: string;
  /** Further categories after the primary one */
  cross?: string[];
  title?: string;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function dateParts(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    weekday: WEEKDAYS[d.getUTCDay()],
    day: d.getUTCDate(),
    month: MONTHS[d.getUTCMonth()],
    year: d.getUTCFullYear(),
  };
}

/** "Friday, 25 September 2026" (/new header) */
export function longDate(date: string): string {
  const p = dateParts(date);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** "Fri, 05 Sep 2026" (catch-up) or "Fri, 5 Sep 2026" (recent index) */
export function shortDate(date: string, padded: boolean): string {
  const p = dateParts(date);
  const day = padded ? String(p.day).padStart(2, "0") : String(p.day);
  return `${p.weekday.slice(0, 3)}, ${day} ${p.month.slice(0, 3)} ${p.year}`;
}

const SECTION_HEADINGS: Record<ListingSection, string> = {
  new: "New submissions",
  cross: "Cross submissions",
  replace: "Replacement submissions",
};

function entryHtml(entry: SiteEntry, index: number): string {
  const marker =
    entry.section === "cross"
      ? `(cross-list from ${entry.primary})`
      : entry.section === "replace"
        ? "(replaced)"
        : "";
  const categories = [entry.primary, ...(entry.cross ?? [])];
  const subjects = categories
    .map((category, i) =>
      i === 0
        ? `<span class="primary-subject">Subject ${category} (${category})</span>`
        : `; Subject ${category} (${category})`,
    )
    .join("");
  return `
    <dt>
      <a name='item${index}'>[${index}]</a>
      <a href ="/abs/${entry.id}" title="Abstract" id="${entry.id}">
        arXiv:${entry.id}
      </a>
      ${marker}
        [<a href="/pdf/${entry.id}" title="Download PDF" id="pdf-${entry.id}">pdf</a>, <a href="https://arxiv.org/html/${entry.id}v1" title="View HTML" id="html-${entry.id}">html</a>]
    </dt>
    <dd>
      <div class='meta'>
        <div class='list-title mathjax'><span class='descriptor'>Title:</span>
          ${entry.title ?? `Paper ${entry.id}`}
        </div>
        <div class='list-authors'><a href="https://arxiv.org/search/hep-ph?searchtype=author&amp;query=Author,+A">A. Author</a>, <a href="https://arxiv.org/search/hep-ph?searchtype=author&amp;query=Di+Vora,+R">R. Di Vora</a></div>
        <div class='list-subjects'><span class='descriptor'>Subjects:</span>
          ${subjects}
        </div>
        <p class='mathjax'>
          Abstract of ${entry.id}.
        </p>
      </div>
    </dd>`;
}

/** The section lists of one page, headed as arxiv-browse heads them */
function sectionsHtml(day: SiteEntry[], skip: number, show: number): string {
  const count = (section: ListingSection) =>
    day.filter((entry) => entry.section === section).length;
  const newCount = count("new");
  const crossCount = count("cross");
  const repCount = count("replace");
  const crossStart = newCount + 1;
  const repStart = newCount + crossCount + 1;
  const page = day.slice(skip, skip + show);
  const flags: Record<
    ListingSection,
    { continued: boolean; last: boolean; total: number }
  > = {
    new: {
      continued: skip > 0,
      last: skip >= newCount - show,
      total: newCount,
    },
    cross: {
      continued: skip + 1 > crossStart,
      last: skip >= repStart - show,
      total: crossCount,
    },
    replace: {
      continued: skip + 1 > repStart,
      last: skip + show >= newCount + crossCount + repCount,
      total: repCount,
    },
  };
  let html = "";
  let index = skip;
  for (const section of ["new", "cross", "replace"] as ListingSection[]) {
    const items = page.filter((entry) => entry.section === section);
    if (items.length === 0) continue;
    const { continued, last, total } = flags[section];
    let showing = "showing ";
    if (continued) showing = `continued, ${showing}${last ? "last " : ""}`;
    if (!last && !continued) showing += "first ";
    html += `
      <dl id='articles'>
    <h3>${SECTION_HEADINGS[section]} (${showing}${items.length} of ${total} entries)</h3>
${items.map((entry) => entryHtml(entry, ++index)).join("")}
</dl>
`;
  }
  return html;
}

function pageShell(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>arXiv</title></head>
<body><main><div id="content">
<div id='content-inner'>
<div id='dlpage'>
${inner}
</div>
</div></div></main></body></html>`;
}

/** /list/<spec>/new?skip=&show= for a day whose entries are `day` (in order) */
export function newPageHtml(
  spec: string,
  date: string,
  day: SiteEntry[],
  skip = 0,
  show = 2000,
): string {
  const total = day.length;
  let paging = "";
  if (total > 0) {
    let links = "";
    if (total > show) {
      links = " :";
      for (let start = 0; start < total; start += show) {
        const range = `${start + 1}-${Math.min(total, start + show)}`;
        links +=
          start === skip
            ? `\n      <span>${range}</span>`
            : `\n      <a href=/list/${spec}/new?skip=${start}&amp;show=${show}>${range}</a>`;
      }
    }
    paging = `
      <div class='paging'>Total of ${total} entries${links}
    </div>`;
  }
  const body =
    total > 0
      ? sectionsHtml(day, skip, show)
      : "\n    <p>No updates today.</p>\n";
  return pageShell(`
  <h1>Subject ${spec}</h1>
<ul></ul>
<p>See <a href="/list/${spec}/recent">recent</a> articles</p>
<h3>Showing new listings for ${longDate(date)}</h3>
${paging}
${body}
${paging}`);
}

/** /catchup/<spec>/<date>?abs=True&page= */
export function catchupPageHtml(
  spec: string,
  date: string,
  day: SiteEntry[],
  nextDay: string | null,
  page = 1,
  perPage = 2000,
): string {
  const total = day.length;
  const when = shortDate(date, true);
  const next = nextDay
    ? `<a href="/catchup/${spec}/${nextDay}?abs=True&amp;page=1">Continue to the next day</a>`
    : "";
  let pages = "";
  if (total > perPage) {
    pages = "View page:";
    const count = Math.ceil(total / perPage);
    for (let n = 1; n <= count; n++) {
      pages +=
        n === page
          ? `\n        <span>${n}</span>`
          : `\n        <a href=/catchup/${spec}/${date}?abs=True&amp;page=${n}>${n}</a>`;
    }
  }
  const body =
    total > 0
      ? sectionsHtml(day, (page - 1) * perPage, perPage)
      : `<br><div><p>No updates for ${when}. There was either no announcement for this day, or no updates within the requested subject.</p></div><br>`;
  return pageShell(`
  <h1>Catchup results for Subject ${spec} on ${when}</h1>
    <ul></ul>
    <div>
        ${next}
        ${next ? "<br><br>" : ""}
      Total of ${total} entries for ${when}
      ${pages}
    </div>
${body}
    <div></div>
    Total of ${total} entries for ${when}
      ${pages}
      ${next ? `<br> <br>\n        ${next}` : ""}
    `);
}

/** /list/<archive>/recent?show=25 (only the date index matters) */
export function recentIndexHtml(archive: string, dates: string[]): string {
  const items = dates
    .map(
      (date, i) => `<li>
        <a href="/list/${archive}/recent?skip=${i * 400}&amp;show=25">
          ${shortDate(date, false)}
        </a>
      </li>`,
    )
    .join("");
  return pageShell(`
  <h1>Mathematics</h1>
<h2>Authors and titles for recent submissions</h2>
  <ul>
${items}</ul>
  <p>See today's <a href="/list/${archive}/new">new</a> changes</p>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Serving
// ─────────────────────────────────────────────────────────────────────────────

export interface SiteReply {
  status?: number;
  text?: string;
  headers?: Record<string, string>;
  error?: ArxivFetchError;
}

export interface SentRequest {
  url: string;
  start: number;
  end?: number;
}

/**
 * A site that answers each URL from `routes` (exact URL -> reply, or a
 * function of the attempt number); unknown URLs get 404.
 */
export class SimulatedArxiv {
  readonly sent: SentRequest[] = [];
  readonly routes = new Map<
    string,
    SiteReply | ((attempt: number) => SiteReply)
  >();
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly clock: VirtualClock,
    private readonly latencyMs: (url: string) => number = () => 800,
  ) {}

  page(url: string, reply: SiteReply | ((attempt: number) => SiteReply)): this {
    this.routes.set(url, reply);
    return this;
  }

  html(url: string, text: string): this {
    return this.page(url, { text });
  }

  /** How often `url` was requested */
  count(url: string): number {
    return this.sent.filter((request) => request.url === url).length;
  }

  readonly transport: ArxivTransport = (url, options) => {
    const record: SentRequest = { url, start: this.clock.now() };
    this.sent.push(record);
    const attempt = (this.attempts.get(url) ?? 0) + 1;
    this.attempts.set(url, attempt);
    const route = this.routes.get(url);
    const reply: SiteReply =
      typeof route === "function"
        ? route(attempt)
        : (route ?? { status: 404, text: "Not found" });
    return new Promise<ArxivResponse>((resolve, reject) => {
      let done = false;
      options.cancelReceiver(() => {
        if (done) return;
        done = true;
        record.end = this.clock.now();
        reject(new ArxivFetchError("cancelled", "cancelled"));
      });
      void this.clock.sleep(this.latencyMs(url)).then(() => {
        if (done) return;
        done = true;
        record.end = this.clock.now();
        if (reply.error) {
          reject(reply.error);
          return;
        }
        const headers = new Map(
          Object.entries(reply.headers ?? {}).map(([k, v]) => [
            k.toLowerCase(),
            v,
          ]),
        );
        resolve({
          status: reply.status ?? 200,
          text: reply.text ?? "",
          header: (name) => headers.get(name.toLowerCase()) ?? null,
        });
      });
    });
  };
}

export const LIST_URL = (spec: string, skip = 0, show = 2000) =>
  `https://arxiv.org/list/${spec}/new?skip=${skip}&show=${show}`;
export const CATCHUP_URL = (spec: string, date: string, page = 1) =>
  `https://arxiv.org/catchup/${spec}/${date}?abs=True${page > 1 ? `&page=${page}` : ""}`;
export const INDEX_URL = "https://arxiv.org/list/math/recent?show=25";
