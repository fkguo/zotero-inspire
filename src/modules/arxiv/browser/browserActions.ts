// ─────────────────────────────────────────────────────────────────────────────
// Read-only actions of the arXiv browser: copy a paper's arXiv identifier or
// its BibTeX, and open the abstract page or the PDF in the system's web
// browser (the user's own browsing; the plugin sends no request for it).
// The BibTeX is INSPIRE's when INSPIRE has the paper (one request: by the
// INSPIRE recid of its library item, else by its arXiv identifier), else
// arXiv's own from arxiv.org/bibtex/<id>, fetched through the plugin's
// arxiv.org scheduler like every other request to arXiv. Its citation key is
// the library item's when the paper is in the library, else INSPIRE's, else
// one in the form of the owner's Better BibTeX fallback (arxivCitationKey).
//
// Notices go to the window's own notice area (windowReporter).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import { copyToClipboard } from "../../inspire/apiUtils";
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
  type InspireBibtexAnswer,
} from "../inspireByArxiv";
import type { ListingAuthor, ListingFailureReason } from "../listingTypes";
import { reasonText } from "./browserText";

const ARXIV = "https://arxiv.org";

/** How long a notice stays */
const NOTICE_MS = 3000;

export function abstractPageUrl(id: string): string {
  return `${ARXIV}/abs/${id}`;
}

export function pdfUrl(id: string): string {
  return `${ARXIV}/pdf/${id}`;
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
  private readonly inLibrary: BrowserActionsOptions["inLibrary"];
  /**
   * INSPIRE's answers in this window, by arXiv identifier: its BibTeX, or
   * null when INSPIRE has no record (a failure is asked again)
   */
  private readonly inspire = new Map<string, string | null>();
  /** arXiv's BibTeX already fetched in this window, by arXiv identifier */
  private readonly arxiv = new Map<string, string>();
  /** Identifiers whose BibTeX is being fetched */
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
    this.inLibrary = options.inLibrary;
    this.controller = createAbortController();
  }

  openAbstractPage(id: string): void {
    this.launch(abstractPageUrl(id));
  }

  openPdf(id: string): void {
    this.launch(pdfUrl(id));
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
    if (this.fetching.has(id)) return;
    this.fetching.add(id);
    let copied: { text: string; notice: string } | undefined;
    try {
      copied = await this.bibtexOf(paper, await this.libraryItems(id));
    } finally {
      this.fetching.delete(id);
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
      Zotero.debug(`[${config.addonName}] arXiv BibTeX ${id}: ${error}`);
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
    let inspire = this.inspire.get(id);
    let unreachable = false;
    if (inspire === undefined) {
      const answer = await this.inspireBibtex(
        id,
        fromLibrary(itemIDs, resolveItemRecid),
        this.controller?.signal,
      );
      if (answer.status === "failed") {
        unreachable = true;
      } else {
        inspire = answer.status === "found" ? answer.bibtex : null;
        this.inspire.set(id, inspire);
      }
    }
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

  /** Stop a BibTeX request that has not been answered (window closing) */
  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
  }
}

/** Notices in an area of the window; each goes away after a few seconds */
export function windowReporter(area: HTMLElement): Reporter {
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
