// ─────────────────────────────────────────────────────────────────────────────
// Read-only actions of the arXiv browser: copy a paper's arXiv identifier or
// its BibTeX (arXiv's own, from arxiv.org/bibtex/<id>, fetched through the
// plugin's arxiv.org scheduler like every other request to arXiv), and open
// the abstract page or the PDF in the system's web browser (the user's own
// browsing; the plugin sends no request for it).
//
// Notices go to the window's own notice area (windowReporter).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import { copyToClipboard } from "../../inspire/apiUtils";
import { createAbortController } from "../../inspire/utils";
import type { ProgressDisplay, Reporter } from "../../inspire/panel/reporter";
import {
  ArxivFetchError,
  getArxivWebScheduler,
  type ArxivScheduler,
} from "../arxivFetch";
import type { ListingFailureReason } from "../listingTypes";
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

export interface BrowserActionsOptions {
  reporter: Reporter;
  /** arxiv.org requests (default: the plugin-wide web scheduler) */
  scheduler?: ArxivScheduler;
  /** Opens a page in the system's web browser (default: Zotero.launchURL) */
  launch?: (url: string) => void;
  /** Copies text (default: the plugin's clipboard helper) */
  copy?: (text: string) => Promise<boolean>;
}

export class BrowserActions {
  private readonly reporter: Reporter;
  private readonly scheduler: ArxivScheduler;
  private readonly launch: (url: string) => void;
  private readonly copy: (text: string) => Promise<boolean>;
  /** BibTeX already fetched in this window, by arXiv identifier */
  private readonly bibtex = new Map<string, string>();
  /** Identifiers whose BibTeX is being fetched */
  private readonly fetching = new Set<string>();
  private readonly controller: AbortController | undefined;

  constructor(options: BrowserActionsOptions) {
    this.reporter = options.reporter;
    this.scheduler = options.scheduler ?? getArxivWebScheduler();
    this.launch = options.launch ?? ((url) => Zotero.launchURL(url));
    this.copy = options.copy ?? copyToClipboard;
    this.controller = createAbortController();
  }

  openAbstractPage(id: string): void {
    this.launch(abstractPageUrl(id));
  }

  openPdf(id: string): void {
    this.launch(pdfUrl(id));
  }

  async copyId(id: string): Promise<void> {
    if (await this.copy(id)) {
      this.reporter.notify(
        getString("arxiv-browser-copied-id", { args: { id } }),
      );
    }
  }

  /** Copy arXiv's BibTeX of the paper, fetching it first if need be */
  async copyBibtex(id: string): Promise<void> {
    let text = this.bibtex.get(id);
    if (text === undefined) {
      // One request per paper: clicks while it waits for its turn add none
      if (this.fetching.has(id)) return;
      this.fetching.add(id);
      try {
        text = await this.fetchBibtex(id);
      } finally {
        this.fetching.delete(id);
      }
      if (text === undefined) return;
    }
    if (await this.copy(text)) {
      this.reporter.notify(
        getString("arxiv-browser-bibtex-copied", { args: { id } }),
      );
    }
  }

  /** arXiv's BibTeX of the paper, or nothing (the user was told why) */
  private async fetchBibtex(id: string): Promise<string | undefined> {
    this.reporter.notify(getString("arxiv-browser-bibtex-waiting"));
    let failure: ListingFailureReason = "http";
    try {
      const response = await this.scheduler.request(`${ARXIV}/bibtex/${id}`, {
        signal: this.controller?.signal,
      });
      const body = response.text.trim();
      if (response.status === 200 && body.startsWith("@")) {
        this.bibtex.set(id, body);
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
