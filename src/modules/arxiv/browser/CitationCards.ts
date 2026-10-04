// ─────────────────────────────────────────────────────────────────────────────
// CitationCards: the look-up of citations selected in arXiv's HTML version
// of a paper (HtmlPane), as the plugin's look-up in Zotero's PDF reader. A
// bar below the selection shows the citations' numbers with the PDF
// look-up's buttons (lookupButtons); the pointer on a number shows the
// plugin's INSPIRE card of the reference (HoverPreviewController, as in the
// References panel and the PDF look-up): authors, journal, citations,
// abstract, whether it is in the library, and its actions. A reference that
// INSPIRE's list of the paper does not have, and every reference of a paper
// INSPIRE has no record of, shows the page's entry text in the card, as the
// PDF look-up shows Zotero's text of a reference.
// The paper's INSPIRE reference list is asked for once per paper shown,
// with the first citations selected (the window knows its record, or asks;
// the list comes from the plugin's cache of reference lists when it has the
// paper's); after INSPIRE could not be reached, with the next citations
// selected. The page's
// entries are matched to the list by their identifiers (htmlReferences),
// again for another version's page of the paper (its entries' ids can
// differ). Until the list is there, a number shows the page's entry text.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { refreshLocalState } from "../../inspire/library/localStatus";
import {
  HoverPreviewController,
  type PreviewActionCallbacks,
} from "../../inspire/panel/HoverPreviewController";
import type {
  PositionRect,
  PreviewEntryOptions,
} from "../../inspire/panel/HoverPreviewRenderer";
import {
  createCompactLookupButton,
  createLookupGroup,
  createSingleLookupButton,
} from "../../inspire/pdfAnnotate/lookupButtons";
import type { InspireReferenceEntry } from "../../inspire/types";
import { createAbortController } from "../../inspire/utils";
import {
  matchHtmlReferences,
  type HtmlReferenceEntry,
} from "../htmlReferences";
import type { HtmlPaneCitation, HtmlPaneCitations } from "./HtmlPane";

export interface CitationCardsOptions {
  document: Document;
  /** The element the bar and the card are put in */
  container: HTMLElement;
  /** The card's actions */
  callbacks: PreviewActionCallbacks;
  entryOptions: PreviewEntryOptions;
  /**
   * INSPIRE's reference list of the paper `arxivId`; null when INSPIRE has
   * no record of it; rejects when INSPIRE cannot be reached
   */
  references: (
    arxivId: string,
    signal?: AbortSignal,
  ) => Promise<InspireReferenceEntry[] | null>;
}

/** Pixels between the bar and the selection, and the window's edges */
const BAR_GAP = 6;
const BAR_MARGIN = 8;

/** The paper shown: its page's entries, and INSPIRE's papers of them */
interface ShownPaper {
  id: string;
  entries: Map<string, HtmlReferenceEntry>;
  abort?: AbortController;
  /** INSPIRE's reference list, once asked for */
  list?: Promise<InspireReferenceEntry[] | null>;
  /** INSPIRE's papers of the entries, once matched */
  cited?: Promise<Map<string, InspireReferenceEntry[]> | null>;
  /** INSPIRE's answer has come */
  answered: boolean;
}

export class CitationCards implements HtmlPaneCitations {
  private readonly card: HoverPreviewController;
  private paper: ShownPaper | null = null;
  private bar: HTMLElement | null = null;
  /** Counts the numbers pointed at and left: a later one wins */
  private turn = 0;

  constructor(private readonly options: CitationCardsOptions) {
    this.card = new HoverPreviewController({
      document: options.document,
      container: options.container,
      callbacks: options.callbacks,
      entryOptions: options.entryOptions,
    });
  }

  entries(paperId: string, entries: HtmlReferenceEntry[]): void {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    if (this.paper?.id === paperId) {
      // The same paper's page again, maybe of another version: its entries
      // matched again
      this.paper.entries = byId;
      this.paper.cited = undefined;
      return;
    }
    this.paper?.abort?.abort();
    this.paper = {
      id: paperId,
      entries: byId,
      abort: createAbortController(),
      answered: false,
    };
  }

  select(
    paperId: string,
    citations: HtmlPaneCitation[],
    rect: PositionRect,
  ): void {
    const paper = this.paper;
    if (!citations.length || paper?.id !== paperId) {
      this.clear();
      return;
    }
    // Asked for now, so that it is there when the pointer is on a number
    void this.citedOf(paper);
    this.showBar(paper, citations, rect);
  }

  clear(): void {
    this.turn++;
    this.bar?.remove();
    this.bar = null;
    this.card.hide();
  }

  dispose(): void {
    this.paper?.abort?.abort();
    this.paper = null;
    this.clear();
    this.card.dispose();
  }

  /** INSPIRE's papers of the paper's entries, its list asked for once */
  private citedOf(
    paper: ShownPaper,
  ): Promise<Map<string, InspireReferenceEntry[]> | null> {
    if (!paper.list) {
      const list = this.options.references(paper.id, paper.abort?.signal);
      paper.list = list;
      paper.answered = false;
      void list.then(
        () => (paper.answered = true),
        (error) => {
          Zotero.debug(
            `[${config.addonName}] References of arXiv:${paper.id} not loaded: ${error}`,
          );
          paper.answered = true;
          // Asked again with the next citations selected
          if (paper.list === list) {
            paper.list = undefined;
            paper.cited = undefined;
          }
        },
      );
    }
    const entries = [...paper.entries.values()];
    paper.cited ??= paper.list
      .then((references) => {
        if (!references) return null;
        const cited = new Map<string, InspireReferenceEntry[]>();
        for (const [id, indexes] of matchHtmlReferences(references, entries)) {
          cited.set(
            id,
            indexes.map((index) => references[index]),
          );
        }
        return cited;
      })
      .catch(() => null);
    return paper.cited;
  }

  /** The bar of `citations` below the selection's last line (`rect`) */
  private showBar(
    paper: ShownPaper,
    citations: HtmlPaneCitation[],
    rect: PositionRect,
  ): void {
    const doc = this.options.document;
    this.clear();
    const bar = doc.createElement("div");
    bar.className = "zoteroinspire-citation-bar";
    Object.assign(bar.style, {
      position: "fixed",
      zIndex: "10000",
      padding: "4px",
      borderRadius: "6px",
      background: "var(--material-background, #ffffff)",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
      visibility: "hidden",
      top: "0",
      left: "0",
    });
    const button = (citation: HtmlPaneCitation, compact: boolean) => {
      const element = compact
        ? createCompactLookupButton(doc, citation.label)
        : createSingleLookupButton(doc, citation.label);
      // Not the PDF look-up's "Look up in INSPIRE Refs.": a click here does
      // nothing more than pointing does
      element.removeAttribute("title");
      element.addEventListener("mouseenter", () =>
        this.preview(paper, element, citation),
      );
      element.addEventListener("mouseleave", () => {
        this.turn++;
        this.card.scheduleHide();
      });
      return element;
    };
    if (citations.length === 1) {
      bar.append(button(citations[0], false));
    } else {
      const group = createLookupGroup(doc);
      for (const citation of citations) group.append(button(citation, true));
      bar.append(group);
    }
    this.options.container.append(bar);
    this.bar = bar;
    // Below the selection, or above it when there is no room below; within
    // the window
    const view = doc.documentElement;
    const width = bar.offsetWidth;
    const height = bar.offsetHeight;
    const left = Math.min(rect.left, view.clientWidth - width - BAR_MARGIN);
    bar.style.left = `${Math.max(BAR_MARGIN, left)}px`;
    const below = rect.bottom + BAR_GAP;
    bar.style.top = `${
      below + height <= view.clientHeight - BAR_MARGIN
        ? below
        : Math.max(BAR_MARGIN, rect.top - BAR_GAP - height)
    }px`;
    bar.style.visibility = "visible";
  }

  /** The card of the citation whose number `button` the pointer is on */
  private preview(
    paper: ShownPaper,
    button: HTMLElement,
    citation: HtmlPaneCitation,
  ): void {
    const turn = ++this.turn;
    const { label } = citation;
    const text = paper.entries.get(citation.id)?.text ?? "";
    const current = () =>
      turn === this.turn && button.isConnected && this.paper === paper;
    const showText = () => {
      if (text) {
        this.card.scheduleShowNativeReference(text, {
          label,
          buttonRect: button.getBoundingClientRect(),
        });
      }
    };
    // INSPIRE's list asked for, or not reached (asked again with the next
    // citations selected, not by pointing)
    const cited = paper.list ? this.citedOf(paper) : null;
    // Until the list is there, and without it: the page's entry
    if (!cited || !paper.answered) showText();
    void cited?.then(async (matched) => {
      if (!current()) return;
      const papers = matched?.get(citation.id);
      if (!papers?.length) {
        showText();
        return;
      }
      // Whether the papers are in the library now
      await refreshLocalState(papers).catch(() => []);
      if (!current()) return;
      this.card.scheduleShowMulti(papers, {
        label,
        buttonRect: button.getBoundingClientRect(),
      });
    });
  }
}
