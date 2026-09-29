// ─────────────────────────────────────────────────────────────────────────────
// Read-only actions of the arXiv browser: copy a paper's arXiv identifier,
// its BibTeX or the link to its INSPIRE record, and open the abstract page,
// the PDF or the HTML version in the system's web browser (the user's own
// browsing; the plugin sends no request for it).
// The BibTeX is INSPIRE's when INSPIRE has the paper (one request: by the
// INSPIRE recid of its library item, else by its arXiv identifier), else
// arXiv's own from arxiv.org/bibtex/<id>, fetched through the plugin's
// arxiv.org scheduler like every other request to arXiv. Its citation key is
// the library item's when the paper is in the library, else INSPIRE's, else
// one in the form of the owner's Better BibTeX fallback (arxivCitationKey).
// The INSPIRE link needs the record's recid: its library item's, else one
// search of INSPIRE by the arXiv identifier (INSPIRE's BibTeX does not name
// the recid). Both copies keep what INSPIRE answered in one memory per
// window, so either copy spares the other a request where it can.
//
// Notices go to the window's own notice area (windowReporter).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import { copyToClipboard, inspireLiteratureUrl } from "../../inspire/apiUtils";
import { rewriteSingleBibtexEntryKey } from "../../inspireBibtexApi";
import { itemCitationKey } from "../../inspire/library/itemCitationKey";
import { resolveItemRecid } from "../../inspire/library/itemRecid";
import { loadedItem } from "../../inspire/library/localStatus";
import { fetchBibTeX } from "../../inspire/metadataService";
import { createAbortController } from "../../inspire/utils";
import type { ProgressDisplay, Reporter } from "../../inspire/panel/reporter";
import {
  ArxivFetchError,
  getArxivWebScheduler,
  type ArxivScheduler,
} from "../arxivFetch";
import { arxivCitationKey } from "../citationKey";
import {
  bibtexEprint,
  fetchInspireBibtexByArxiv,
  lookupInspireByArxiv,
  type InspireBibtexAnswer,
} from "../inspireByArxiv";
import type { ListingAuthor, ListingFailureReason } from "../listingTypes";
import { reasonText } from "./browserText";
import { button } from "./dom";

const ARXIV = "https://arxiv.org";

/** How long a notice stays */
const NOTICE_MS = 3000;
/** How long a notice with buttons stays, unless it asks a question */
const ASK_MS = 15000;

export function abstractPageUrl(id: string): string {
  return `${ARXIV}/abs/${id}`;
}

export function pdfUrl(id: string): string {
  return `${ARXIV}/pdf/${id}`;
}

/** arXiv's HTML version of the paper; without version, like the PDF's */
export function htmlUrl(id: string): string {
  return `${ARXIV}/html/${id}`;
}

/**
 * INSPIRE's BibTeX of an arXiv paper: by `recid` (its library item's) when
 * known and that record is the paper's (its eprint), else by its arXiv
 * identifier (a recid of another record, a record INSPIRE no longer has,
 * INSPIRE not answering). One request when the recid, or the search, gives
 * the paper's entry.
 */
export async function inspireBibtexOf(
  id: string,
  recid: string | null,
  signal?: AbortSignal,
): Promise<InspireBibtexAnswer> {
  if (recid) {
    const bibtex = await fetchBibTeX(recid, signal);
    if (bibtex && bibtexEprint(bibtex) === id) {
      return { status: "found", bibtex };
    }
  }
  return fetchInspireBibtexByArxiv(id, signal);
}

export type InspireRecidAnswer =
  | { status: "found"; recid: string }
  /** INSPIRE answered and has no record of the paper */
  | { status: "notFound" }
  /** INSPIRE could not be reached or answered with an error */
  | { status: "failed" };

/**
 * The recid of INSPIRE's record of an arXiv paper: one search by its arXiv
 * identifier (lookupInspireByArxiv, which takes a record only when one of
 * its eprints is the identifier)
 */
export async function inspireRecidOf(
  id: string,
  signal?: AbortSignal,
): Promise<InspireRecidAnswer> {
  try {
    const answer = (await lookupInspireByArxiv([id], { signal })).get(id);
    if (answer?.status === "found") {
      return { status: "found", recid: answer.recid };
    }
    return { status: answer?.status === "notFound" ? "notFound" : "failed" };
  } catch {
    return { status: "failed" };
  }
}

/** What this window learnt of a paper's INSPIRE record */
interface InspireRecord {
  recid?: string;
  bibtex?: string;
}

/** The first answer of `read` for these library items (not loaded: none) */
function fromLibrary(
  itemIDs: readonly number[],
  read: (item: Zotero.Item) => string | null,
): string | null {
  for (const itemID of itemIDs) {
    const item = loadedItem(itemID);
    const value = item ? read(item) : null;
    if (value) return value;
  }
  return null;
}

/** The BibTeX with `key` as its citation key (unchanged if it cannot be) */
function withCitationKey(bibtex: string, key: string): string {
  try {
    return rewriteSingleBibtexEntryKey(bibtex, key).text;
  } catch {
    return bibtex;
  }
}

/** A paper as the BibTeX copy needs it */
export interface BibtexPaper {
  id: string;
  title: string;
  authors: readonly ListingAuthor[];
}

export interface BrowserActionsOptions {
  reporter: Reporter;
  /** arxiv.org requests (default: the plugin-wide web scheduler) */
  scheduler?: ArxivScheduler;
  /** Opens a page in the system's web browser (default: Zotero.launchURL) */
  launch?: (url: string) => void;
  /** Copies text (default: the plugin's clipboard helper) */
  copy?: (text: string) => Promise<boolean>;
  /** INSPIRE's BibTeX of a paper (default: inspireBibtexOf) */
  inspireBibtex?: typeof inspireBibtexOf;
  /** INSPIRE's recid of a paper (default: inspireRecidOf) */
  inspireRecid?: typeof inspireRecidOf;
  /**
   * The library's items with each of these arXiv identifiers (the view's
   * lookup); none when absent or when the library cannot be read
   */
  inLibrary?: (
    ids: readonly string[],
  ) => Promise<ReadonlyMap<string, readonly number[]> | null>;
}

export class BrowserActions {
  private readonly reporter: Reporter;
  private readonly scheduler: ArxivScheduler;
  private readonly launch: (url: string) => void;
  private readonly copy: (text: string) => Promise<boolean>;
  private readonly inspireBibtex: typeof inspireBibtexOf;
  private readonly inspireRecid: typeof inspireRecidOf;
  private readonly inLibrary: BrowserActionsOptions["inLibrary"];
  /**
   * INSPIRE's answers in this window, by arXiv identifier: the record's
   * recid and BibTeX as far as asked, or null when INSPIRE has no record (a
   * failure is asked again)
   */
  private readonly inspire = new Map<string, InspireRecord | null>();
  /** arXiv's BibTeX already fetched in this window, by arXiv identifier */
  private readonly arxiv = new Map<string, string>();
  /** Copies being fetched ("bibtex <id>", "link <id>") */
  private readonly fetching = new Set<string>();
  private readonly controller: AbortController | undefined;
  /** The window closed: nothing more is copied */
  private disposed = false;

  constructor(options: BrowserActionsOptions) {
    this.reporter = options.reporter;
    this.scheduler = options.scheduler ?? getArxivWebScheduler();
    this.launch = options.launch ?? ((url) => Zotero.launchURL(url));
    this.copy = options.copy ?? copyToClipboard;
    this.inspireBibtex = options.inspireBibtex ?? inspireBibtexOf;
    this.inspireRecid = options.inspireRecid ?? inspireRecidOf;
    this.inLibrary = options.inLibrary;
    this.controller = createAbortController();
  }

  openAbstractPage(id: string): void {
    this.launch(abstractPageUrl(id));
  }

  openPdf(id: string): void {
    this.launch(pdfUrl(id));
  }

  openHtml(id: string): void {
    this.launch(htmlUrl(id));
  }

  /** Open a link in the web browser */
  openLink(url: string): void {
    this.launch(url);
  }

  /** Copy a text (a title, a link, the selection); `notice`: say so */
  async copyText(text: string, notice = true): Promise<void> {
    if ((await this.copy(text)) && notice) {
      this.reporter.notify(getString("arxiv-browser-copied-text"));
    }
  }

  async copyId(id: string): Promise<void> {
    if (await this.copy(id)) {
      this.reporter.notify(
        getString("arxiv-browser-copied-id", { args: { id } }),
      );
    }
  }

  /**
   * Copy the paper's BibTeX: INSPIRE's when INSPIRE has the paper, else
   * arXiv's; the notice says which. The paper's library items, asked for
   * each copy (also before the list's marks arrived), give the citation
   * key, and one with an INSPIRE recid spares the search.
   */
  async copyBibtex(paper: BibtexPaper): Promise<void> {
    const { id } = paper;
    // One request per paper: clicks while it is fetched add none
    const job = `bibtex ${id}`;
    if (this.fetching.has(job)) return;
    this.fetching.add(job);
    let copied: { text: string; notice: string } | undefined;
    try {
      copied = await this.bibtexOf(paper, await this.libraryItems(id));
    } finally {
      this.fetching.delete(job);
    }
    if (copied && !this.disposed && (await this.copy(copied.text))) {
      this.reporter.notify(copied.notice);
    }
  }

  /** The library's items with the paper (none when it cannot be read) */
  private async libraryItems(id: string): Promise<readonly number[]> {
    try {
      return (await this.inLibrary?.([id]))?.get(id) ?? [];
    } catch (error) {
      Zotero.debug(`[${config.addonName}] arXiv library ${id}: ${error}`);
      return [];
    }
  }

  /** The BibTeX to copy and its notice, or nothing (the user was told why) */
  private async bibtexOf(
    paper: BibtexPaper,
    itemIDs: readonly number[],
  ): Promise<{ text: string; notice: string } | undefined> {
    const { id } = paper;
    const libraryKey = fromLibrary(itemIDs, itemCitationKey);
    let record = this.inspire.get(id);
    let unreachable = false;
    if (record !== null && !record?.bibtex) {
      const answer = await this.inspireBibtex(
        id,
        fromLibrary(itemIDs, resolveItemRecid) ?? record?.recid ?? null,
        this.controller?.signal,
      );
      if (answer.status === "failed") {
        unreachable = true;
      } else {
        record =
          answer.status === "found"
            ? { ...this.inspire.get(id), bibtex: answer.bibtex }
            : null;
        this.inspire.set(id, record);
      }
    }
    const inspire = record?.bibtex;
    if (inspire) {
      return {
        // INSPIRE's key unless the library item has its own
        text: libraryKey ? withCitationKey(inspire, libraryKey) : inspire,
        notice: getString("arxiv-browser-bibtex-copied-inspire", {
          args: { id },
        }),
      };
    }
    const arxiv = this.arxiv.get(id) ?? (await this.fetchArxivBibtex(id));
    if (arxiv === undefined) return undefined;
    return {
      text: withCitationKey(arxiv, libraryKey ?? arxivCitationKey(paper)),
      notice: getString(
        unreachable
          ? "arxiv-browser-bibtex-copied-arxiv-unreachable"
          : "arxiv-browser-bibtex-copied-arxiv",
        { args: { id } },
      ),
    };
  }

  /**
   * Copy the link to the paper's INSPIRE record: at once when its recid is
   * known (its library item's, or INSPIRE's answer earlier in this window),
   * else after one search of INSPIRE. Nothing is copied when INSPIRE has no
   * record or cannot be reached; the notice says which.
   */
  async copyInspireLink(id: string): Promise<void> {
    const job = `link ${id}`;
    if (this.fetching.has(job)) return;
    this.fetching.add(job);
    let recid: string | undefined;
    try {
      recid = await this.recidOf(id);
    } finally {
      this.fetching.delete(job);
    }
    if (
      recid &&
      !this.disposed &&
      (await this.copy(inspireLiteratureUrl(recid)))
    ) {
      this.reporter.notify(getString("copy-success-inspire-link"));
    }
  }

  /** The recid of the paper's INSPIRE record, or nothing (the user was told) */
  private async recidOf(id: string): Promise<string | undefined> {
    const known =
      fromLibrary(await this.libraryItems(id), resolveItemRecid) ??
      this.inspire.get(id)?.recid;
    if (known) return known;
    let status: "notFound" | "failed" = "notFound";
    if (this.inspire.get(id) !== null) {
      const answer = await this.inspireRecid(id, this.controller?.signal);
      if (answer.status === "found") {
        this.inspire.set(id, { ...this.inspire.get(id), recid: answer.recid });
        return answer.recid;
      }
      if (answer.status === "notFound") this.inspire.set(id, null);
      status = answer.status;
    }
    if (!this.disposed) {
      this.reporter.notify(
        getString(
          status === "notFound"
            ? "arxiv-browser-inspire-link-not-found"
            : "arxiv-browser-inspire-link-unreachable",
          { args: { id } },
        ),
      );
    }
    return undefined;
  }

  /** arXiv's BibTeX of the paper, or nothing (the user was told why) */
  private async fetchArxivBibtex(id: string): Promise<string | undefined> {
    this.reporter.notify(getString("arxiv-browser-bibtex-waiting"));
    let failure: ListingFailureReason = "http";
    try {
      const response = await this.scheduler.request(`${ARXIV}/bibtex/${id}`, {
        signal: this.controller?.signal,
      });
      const body = response.text.trim();
      if (response.status === 200 && body.startsWith("@")) {
        this.arxiv.set(id, body);
        return body;
      }
      Zotero.debug(
        `[${config.addonName}] arXiv BibTeX ${id}: HTTP ${response.status}`,
      );
    } catch (error) {
      failure = error instanceof ArxivFetchError ? error.kind : "network";
      Zotero.debug(`[${config.addonName}] arXiv BibTeX ${id}: ${error}`);
    }
    if (failure !== "cancelled") {
      this.reporter.notify(
        getString("arxiv-browser-bibtex-failed", {
          args: { id, reason: reasonText(failure) },
        }),
      );
    }
    return undefined;
  }

  /** Stop the requests that have not been answered (window closing) */
  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
  }
}

/** A button of a notice */
export interface NoticeAction {
  label: string;
  run(): void;
}

/** The window's notices and progress */
export interface WindowReporter extends Reporter {
  /**
   * A notice with buttons (and a close button); `lines` are shown one below
   * the other. It goes when a button is clicked, or after a while unless it
   * is to `stay` until answered.
   */
  ask(
    lines: string | readonly string[],
    actions: readonly NoticeAction[],
    options?: { stay?: boolean },
  ): void;
}

/**
 * Notices in an area of the window; each goes away after a few seconds,
 * those with buttons when one is clicked
 */
export function windowReporter(area: HTMLElement): WindowReporter {
  const doc = area.ownerDocument;
  const win = doc.defaultView;
  const show = (text: string): HTMLElement => {
    const notice = doc.createElement("div");
    notice.className = "arxiv-browser__notice";
    notice.textContent = text;
    area.append(notice);
    return notice;
  };
  return {
    notify(message) {
      const notice = show(message);
      win?.setTimeout(() => notice.remove(), NOTICE_MS);
    },
    ask(lines, actions, options = {}) {
      const notice = show("");
      notice.classList.add("arxiv-browser__notice--ask");
      for (const line of typeof lines === "string" ? [lines] : lines) {
        const text = doc.createElement("div");
        text.textContent = line;
        notice.append(text);
      }
      const buttons = doc.createElement("div");
      buttons.className = "arxiv-browser__notice-actions";
      for (const action of [
        ...actions,
        { label: getString("arxiv-browser-notice-close"), run: () => {} },
      ]) {
        buttons.append(
          button(doc, action.label, () => {
            notice.remove();
            action.run();
          }),
        );
      }
      notice.append(buttons);
      // A question stays until answered; a result with a button a while
      if (!options.stay) win?.setTimeout(() => notice.remove(), ASK_MS);
    },
    startProgress(text): ProgressDisplay {
      const notice = show(text);
      return {
        update(next, percent) {
          notice.textContent = `${next} (${Math.round(percent)}%)`;
        },
        close() {
          notice.remove();
        },
      };
    },
  };
}
