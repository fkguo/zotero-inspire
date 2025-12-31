// ─────────────────────────────────────────────────────────────────────────────
// EntryListRenderer - Entry list rendering for INSPIRE References Panel
// Extracted from InspireReferencePanelController (Phase 0.1 of zinspire.ts refactor)
//
// Responsibilities:
// - Create and update entry row DOM elements
// - Manage row pooling via RowPoolManager
// - Handle visual state (focus, selection, link status)
//
// NOT responsible for:
// - Event handling (handled by main controller via event delegation)
// - Business logic (import, link, copy, etc.)
// - State management (selectedEntryIDs, focusedEntryID owned by controller)
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import { getPref } from "../../../utils/prefs";
import {
  DOI_ORG_URL,
  ARXIV_ABS_URL,
  LARGE_COLLABORATION_THRESHOLD,
  type InspireReferenceEntry,
  type InspireViewMode,
  type AuthorSearchInfo,
  getCachedStrings,
  formatAuthorName,
  formatPublicationInfo,
  formatArxivDetails,
} from "../index";
import { isDarkMode } from "../styles";
import {
  applyRefEntryRowStyle,
  applyRefEntryTextContainerStyle,
  applyRefEntryMarkerStyle,
  applyRefEntryMarkerColor,
  applyRefEntryLinkButtonStyle,
  applyRefEntryContentStyle,
  applyAuthorLinkStyle,
  applyMetaLinkStyle,
  applyBibTeXButtonStyle,
  applyPdfButtonStyle,
  // PDF button rendering (shared with zinspire.ts)
  renderPdfButtonIcon,
  PdfButtonState,
} from "../../pickerUI";
import { RowPoolManager, type RowPoolManagerOptions } from "./RowPoolManager";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render context passed to rendering methods.
 * Contains state and configuration needed for rendering.
 */
export interface EntryRenderContext {
  /** Set of selected entry IDs (for batch import checkbox state) */
  selectedEntryIDs: ReadonlySet<string>;
  /** Currently focused entry ID */
  focusedEntryID?: string;
  /** Current view mode */
  viewMode: InspireViewMode;
  /** Maximum number of authors to display */
  maxAuthors: number;
  /** Callback to get citation value for an entry (depends on viewMode and prefs) */
  getCitationValue: (entry: InspireReferenceEntry) => number;
  /** Callback to check if entry has PDF attachment (for PDF button state) */
  hasPdf?: (entry: InspireReferenceEntry) => boolean;
  /** Cached dark mode value (computed once per render batch for performance) */
  darkMode?: boolean;
}

/**
 * Options for EntryListRenderer initialization.
 */
export interface EntryListRendererOptions {
  /** Document for creating elements */
  document: Document;
  /** Maximum size of the row pool (default: 150) */
  maxPoolSize?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// EntryListRenderer Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders entry list rows for the INSPIRE References Panel.
 *
 * Uses RowPoolManager for efficient row creation/recycling (PERF-13).
 * All event handling is done by the main controller via event delegation.
 */
export class EntryListRenderer {
  private doc: Document;
  private poolManager: RowPoolManager;
  private rowCache = new Map<string, HTMLElement>();
  private strings: ReturnType<typeof getCachedStrings>;

  constructor(options: EntryListRendererOptions) {
    this.doc = options.document;
    this.strings = getCachedStrings();

    // Initialize pool manager with style applicators
    const poolOptions: RowPoolManagerOptions = {
      maxPoolSize: options.maxPoolSize,
      applyRowStyle: applyRefEntryRowStyle,
      applyTextContainerStyle: applyRefEntryTextContainerStyle,
      applyMarkerStyle: applyRefEntryMarkerStyle,
      applyContentStyle: applyRefEntryContentStyle,
      applyLinkButtonStyle: applyRefEntryLinkButtonStyle,
      applyBibTeXButtonStyle: applyBibTeXButtonStyle,
      applyPdfButtonStyle: applyPdfButtonStyle,
    };
    this.poolManager = new RowPoolManager(poolOptions);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Core Rendering API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a single entry row element.
   * Gets a row from pool (or creates new) and fills with entry data.
   */
  createRow(entry: InspireReferenceEntry, ctx: EntryRenderContext): HTMLDivElement {
    const row = this.poolManager.getRow(this.doc);
    this.updateRowContent(row, entry, ctx);
    this.rowCache.set(entry.id, row);
    return row;
  }

  /**
   * Create multiple rows efficiently using DocumentFragment.
   * Used for initial render and pagination.
   */
  createRows(
    entries: InspireReferenceEntry[],
    ctx: EntryRenderContext,
  ): DocumentFragment {
    const fragment = this.doc.createDocumentFragment();
    for (const entry of entries) {
      fragment.appendChild(this.createRow(entry, ctx));
    }
    return fragment;
  }

  /**
   * Update an existing row with new entry data.
   * Used when entry data changes (e.g., citation count loaded).
   */
  updateRow(
    row: HTMLDivElement,
    entry: InspireReferenceEntry,
    ctx: EntryRenderContext,
  ): void {
    this.updateRowContent(row, entry, ctx);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Targeted State Updates (avoid full row rebuild)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update only the selection state (checkbox) of a row.
   */
  updateSelectionState(row: HTMLDivElement, isSelected: boolean): void {
    const checkbox = row.querySelector(
      ".zinspire-ref-entry__checkbox",
    ) as HTMLInputElement | null;
    if (checkbox) {
      checkbox.checked = isSelected;
    }
  }

  /**
   * Update only the focus state (background, border) of a row.
   * Uses inline styles because CSS files may not load in Zotero.
   */
  updateFocusState(row: HTMLDivElement, isFocused: boolean): void {
    if (isFocused) {
      row.classList.add("zinspire-entry-focused");
      const dark = isDarkMode();
      if (dark) {
        row.style.backgroundColor = "rgba(0, 96, 223, 0.2)";
        row.style.boxShadow = "inset 3px 0 0 #3584e4";
      } else {
        row.style.backgroundColor = "rgba(0, 96, 223, 0.12)";
        row.style.boxShadow = "inset 3px 0 0 #0060df";
      }
    } else {
      row.classList.remove("zinspire-entry-focused");
      row.style.backgroundColor = "";
      row.style.boxShadow = "";
    }
  }

  /**
   * Update only the link button state (linked/unlinked icon).
   */
  updateLinkState(row: HTMLDivElement, isLinked: boolean): void {
    const linkButton = row.querySelector(
      ".zinspire-ref-entry__link",
    ) as HTMLButtonElement | null;
    if (linkButton) {
      this.renderLinkButton(linkButton, isLinked);
    }
  }

  /**
   * Update only the local status marker (● for local, ⊕ for missing).
   */
  updateLocalState(row: HTMLDivElement, hasLocalItem: boolean): void {
    const marker = row.querySelector(
      ".zinspire-ref-entry__dot",
    ) as HTMLElement | null;
    if (marker) {
      marker.textContent = hasLocalItem ? "●" : "⊕";
      marker.dataset.state = hasLocalItem ? "local" : "missing";
      applyRefEntryMarkerColor(marker, hasLocalItem);
      marker.setAttribute(
        "title",
        hasLocalItem ? this.strings.dotLocal : this.strings.dotAdd,
      );
    }
  }

  /**
   * Update only the PDF button state.
   * @param row The row element to update
   * @param state PdfButtonState enum value
   */
  updatePdfState(
    row: HTMLDivElement,
    state: PdfButtonState,
  ): void {
    const pdfButton = row.querySelector(
      ".zinspire-ref-entry__pdf",
    ) as HTMLButtonElement | null;
    if (pdfButton) {
      const pdfStrings = { pdfOpen: this.strings.pdfOpen, pdfFind: this.strings.pdfFind };
      renderPdfButtonIcon(this.doc, pdfButton, state, pdfStrings);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache and Pool Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get cached row element by entry ID.
   */
  getRowByEntryId(entryId: string): HTMLElement | undefined {
    return this.rowCache.get(entryId);
  }

  /**
   * Recycle a single row back to the pool.
   */
  recycleRow(row: HTMLDivElement): void {
    this.poolManager.returnRow(row);
  }

  /**
   * Recycle rows from a container element to the pool.
   * Returns number of rows recycled.
   */
  recycleRowsFromContainer(container: HTMLElement): number {
    return this.poolManager.recycleFromContainer(container);
  }

  /**
   * Clear the row cache (call when switching items).
   */
  clearCache(): void {
    this.rowCache.clear();
  }

  /**
   * Refresh cached localized strings (call when locale changes).
   */
  refreshStrings(): void {
    this.strings = getCachedStrings();
  }

  /**
   * Get pool statistics for debugging.
   */
  getPoolStats() {
    return this.poolManager.getStats();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Row Content Rendering
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update row content with entry data.
   * Called after getting a row from pool - only updates content, not structure.
   */
  private updateRowContent(
    row: HTMLDivElement,
    entry: InspireReferenceEntry,
    ctx: EntryRenderContext,
  ): void {
    // Cache dark mode value for this render (avoid multiple isDarkMode() calls)
    const dark = ctx.darkMode ?? isDarkMode();

    // Store entry ID and recid for event delegation
    row.dataset.entryId = entry.id;
    if (entry.recid) {
      row.dataset.recid = entry.recid;
    } else {
      delete row.dataset.recid;
    }

    // Update checkbox state
    const checkbox = row.querySelector(
      ".zinspire-ref-entry__checkbox",
    ) as HTMLInputElement | null;
    if (checkbox) {
      checkbox.checked = ctx.selectedEntryIDs.has(entry.id);
      checkbox.dataset.entryId = entry.id;
    }

    // Update marker (local/missing indicator)
    const marker = row.querySelector(
      ".zinspire-ref-entry__dot",
    ) as HTMLElement | null;
    if (marker) {
      marker.textContent = entry.localItemID ? "●" : "⊕";
      marker.dataset.state = entry.localItemID ? "local" : "missing";
      applyRefEntryMarkerColor(marker, Boolean(entry.localItemID));
      marker.setAttribute(
        "title",
        entry.localItemID ? this.strings.dotLocal : this.strings.dotAdd,
      );
    }

    // Update link button
    const linkButton = row.querySelector(
      ".zinspire-ref-entry__link",
    ) as HTMLButtonElement | null;
    if (linkButton) {
      linkButton.setAttribute(
        "title",
        entry.isRelated ? this.strings.linkExisting : this.strings.linkMissing,
      );
      this.renderLinkButton(linkButton, Boolean(entry.isRelated));
    }

    // Update BibTeX button
    const bibtexButton = row.querySelector(
      ".zinspire-ref-entry__bibtex",
    ) as HTMLButtonElement | null;
    if (bibtexButton) {
      bibtexButton.textContent = "📋";
      bibtexButton.setAttribute("title", this.strings.copyBibtex);
      if (entry.recid) {
        bibtexButton.disabled = false;
        bibtexButton.style.opacity = "1";
        bibtexButton.style.cursor = "pointer";
      } else {
        bibtexButton.disabled = true;
        bibtexButton.style.opacity = "0.3";
        bibtexButton.style.cursor = "not-allowed";
      }
    }

    // Update texkey button
    const texkeyButton = row.querySelector(
      ".zinspire-ref-entry__texkey",
    ) as HTMLButtonElement | null;
    if (texkeyButton) {
      texkeyButton.textContent = "T";
      texkeyButton.setAttribute("title", this.strings.copyTexkey);
      if (entry.texkey || entry.recid) {
        texkeyButton.disabled = false;
        texkeyButton.style.opacity = "1";
        texkeyButton.style.cursor = "pointer";
      } else {
        texkeyButton.disabled = true;
        texkeyButton.style.opacity = "0.3";
        texkeyButton.style.cursor = "not-allowed";
      }
    }

    // Update PDF button - shows PDF status and allows opening/finding PDF
    const pdfButton = row.querySelector(
      ".zinspire-ref-entry__pdf",
    ) as HTMLButtonElement | null;

    if (pdfButton) {
      const hasLocalItem = Boolean(entry.localItemID);
      const hasPdf = ctx.hasPdf ? ctx.hasPdf(entry) : false;
      const pdfStrings = { pdfOpen: this.strings.pdfOpen, pdfFind: this.strings.pdfFind };

      if (hasLocalItem && hasPdf) {
        renderPdfButtonIcon(this.doc, pdfButton, PdfButtonState.HAS_PDF, pdfStrings, dark);
      } else if (hasLocalItem && !hasPdf) {
        renderPdfButtonIcon(this.doc, pdfButton, PdfButtonState.FIND_PDF, pdfStrings, dark);
      } else {
        renderPdfButtonIcon(this.doc, pdfButton, PdfButtonState.DISABLED, undefined, dark);
      }
    }

    // Update label (reference number like [1], [2], etc.)
    const labelSpan = row.querySelector(
      ".zinspire-ref-entry__label",
    ) as HTMLElement | null;
    if (labelSpan) {
      if (entry.label) {
        labelSpan.textContent = `[${entry.label}] `;
        labelSpan.style.display = "";
      } else {
        labelSpan.textContent = "";
        labelSpan.style.display = "none";
      }
    }

    // Update authors container
    const authorsContainer = row.querySelector(
      ".zinspire-ref-entry__authors",
    ) as HTMLElement | null;
    if (authorsContainer) {
      authorsContainer.replaceChildren();
      this.appendAuthorLinks(authorsContainer, entry, ctx.maxAuthors, dark);
    }

    // Update title link
    // FIX-PANEL-WIDTH-OVERFLOW: Add word-wrap to ensure title text wraps within container
    const titleLink = row.querySelector(
      ".zinspire-ref-entry__title-link",
    ) as HTMLAnchorElement | null;
    if (titleLink) {
      titleLink.textContent = entry.title + ";";
      titleLink.href = entry.inspireUrl || entry.fallbackUrl || "#";
      titleLink.style.wordBreak = "break-word";
      titleLink.style.overflowWrap = "break-word";
    }

    // Update meta (journal, DOI, arXiv links)
    const meta = row.querySelector(
      ".zinspire-ref-entry__meta",
    ) as HTMLElement | null;
    if (meta) {
      const hasMeta = entry.publicationInfo || entry.arxivDetails || entry.doi;
      if (hasMeta) {
        this.buildMetaContent(meta, entry, dark);
        meta.style.display = "";
      } else {
        meta.replaceChildren();
        meta.style.display = "none";
      }
    }

    // Update stats button (citation count)
    const statsButton = row.querySelector(
      ".zinspire-ref-entry__stats-button",
    ) as HTMLButtonElement | null;
    if (statsButton) {
      const displayCitationCount = ctx.getCitationValue(entry);
      const hasCitationCount =
        displayCitationCount > 0 ||
        typeof entry.citationCount === "number" ||
        typeof entry.citationCountWithoutSelf === "number";
      const isReferencesMode = ctx.viewMode === "references";
      const canShowEntryCitedTab =
        Boolean(entry.recid) && (hasCitationCount || !isReferencesMode);

      if (canShowEntryCitedTab || hasCitationCount) {
        const label = hasCitationCount
          ? getString("references-panel-citation-count", {
              args: { count: displayCitationCount },
            })
          : this.strings.citationUnknown;
        statsButton.textContent = label;
        statsButton.style.display = "";
        if (canShowEntryCitedTab) {
          statsButton.style.cursor = "pointer";
          statsButton.disabled = false;
        } else {
          statsButton.style.cursor = "default";
          statsButton.disabled = true;
        }
      } else {
        statsButton.textContent = "";
        statsButton.style.display = "none";
      }
    }

    // Apply focus state if this entry is focused
    this.updateFocusState(row, ctx.focusedEntryID === entry.id);
  }

  /**
   * Append clickable author links to a container.
   * Handles "et al." format and large collaborations.
   */
  private appendAuthorLinks(
    container: HTMLElement,
    entry: InspireReferenceEntry,
    maxAuthors: number,
    dark: boolean,
  ): void {
    // Check if authors are unknown
    if (!entry.authors.length || entry.authorText === this.strings.unknownAuthor) {
      const span = this.doc.createElement("span");
      span.textContent = this.strings.unknownAuthor;
      container.appendChild(span);
      return;
    }

    const totalAuthors = entry.totalAuthors ?? entry.authors.length;
    const isLargeCollaboration = totalAuthors > LARGE_COLLABORATION_THRESHOLD;

    // Check if "others" is in the author list (convert to et al.)
    const hasOthers = entry.authors.some(
      (name) => name.toLowerCase() === "others",
    );

    // Build aligned arrays for author display
    type AuthorDisplay = {
      formatted: string;
      searchInfo: AuthorSearchInfo;
      originalIndex: number;
    };
    const validAuthors: AuthorDisplay[] = [];
    const processLimit = isLargeCollaboration
      ? 1
      : Math.min(entry.authors.length, maxAuthors + 1);

    for (let i = 0; i < processLimit && i < entry.authors.length; i++) {
      const fullName = entry.authors[i];
      if (fullName.toLowerCase() === "others") continue;

      const formatted = formatAuthorName(fullName);
      if (formatted) {
        const bai = entry.authorSearchInfos?.[i]?.bai;
        const recid = entry.authorSearchInfos?.[i]?.recid;
        validAuthors.push({
          formatted,
          searchInfo: { fullName, bai, recid },
          originalIndex: i,
        });
      }
    }

    if (!validAuthors.length) {
      const span = this.doc.createElement("span");
      span.textContent = this.strings.unknownAuthor;
      container.appendChild(span);
      return;
    }

    // Determine whether to show et al.
    const showEtAl =
      isLargeCollaboration ||
      totalAuthors > validAuthors.length ||
      hasOthers ||
      validAuthors.length > maxAuthors;

    const displayCount = showEtAl
      ? Math.min(validAuthors.length, maxAuthors)
      : validAuthors.length;
    const authorsToShow = validAuthors.slice(0, displayCount);

    for (let i = 0; i < authorsToShow.length; i++) {
      if (i > 0) {
        const comma = this.doc.createElement("span");
        comma.textContent = ", ";
        container.appendChild(comma);
      }

      const { formatted, searchInfo, originalIndex } = authorsToShow[i];
      const authorLink = this.doc.createElement("a");
      authorLink.classList.add("zinspire-ref-entry__author-link");
      authorLink.textContent = formatted;
      authorLink.href = "#";
      authorLink.dataset.authorIndex = String(originalIndex);

      const idHint = searchInfo.bai ? ` (${searchInfo.bai})` : "";
      authorLink.title =
        getString("references-panel-author-click-hint", {
          args: { author: searchInfo.fullName },
        }) + idHint;

      applyAuthorLinkStyle(authorLink, dark);
      container.appendChild(authorLink);
    }

    if (showEtAl) {
      const etAlSpan = this.doc.createElement("span");
      etAlSpan.textContent = " et al.";
      container.appendChild(etAlSpan);
    }
  }

  /**
   * Build meta content with clickable DOI and arXiv links.
   */
  private buildMetaContent(
    container: HTMLElement,
    entry: InspireReferenceEntry,
    dark: boolean,
  ): void {
    container.replaceChildren();

    // Journal info with DOI link
    const journalText = formatPublicationInfo(
      entry.publicationInfo,
      entry.year,
    );
    if (journalText) {
      if (entry.doi) {
        const doiUrl = `${DOI_ORG_URL}/${entry.doi}`;
        container.appendChild(this.createExternalLink(journalText, doiUrl, dark));
      } else {
        const journalSpan = this.doc.createElement("span");
        journalSpan.textContent = journalText;
        container.appendChild(journalSpan);
      }
    }

    // arXiv link
    const arxivDetails = formatArxivDetails(entry.arxivDetails);
    if (arxivDetails?.id) {
      if (journalText) {
        const space = this.doc.createElement("span");
        space.textContent = " ";
        container.appendChild(space);
      }
      const arxivUrl = `${ARXIV_ABS_URL}/${arxivDetails.id}`;
      const arxivText = `[arXiv:${arxivDetails.id}]`;
      container.appendChild(this.createExternalLink(arxivText, arxivUrl, dark));
    }

    // Erratum info
    if (entry.publicationInfoErrata?.length) {
      const space = this.doc.createElement("span");
      space.textContent = " [";
      container.appendChild(space);

      let first = true;
      for (const errataEntry of entry.publicationInfoErrata) {
        const text = formatPublicationInfo(errataEntry.info, entry.year, {
          omitJournal: true,
        });
        if (!text) continue;

        if (!first) {
          const sep = this.doc.createElement("span");
          sep.textContent = "; ";
          container.appendChild(sep);
        }
        first = false;

        const labelText = `${errataEntry.label}: ${text}`;
        if (errataEntry.doi) {
          const errataUrl = `${DOI_ORG_URL}/${errataEntry.doi}`;
          container.appendChild(this.createExternalLink(labelText, errataUrl, dark));
        } else {
          const errataSpan = this.doc.createElement("span");
          errataSpan.textContent = labelText;
          container.appendChild(errataSpan);
        }
      }

      const closeBracket = this.doc.createElement("span");
      closeBracket.textContent = "]";
      container.appendChild(closeBracket);
    }
  }

  /**
   * Create a clickable external link element.
   */
  private createExternalLink(text: string, url: string, dark: boolean): HTMLAnchorElement {
    const link = this.doc.createElement("a");
    link.href = url;
    link.textContent = text;
    applyMetaLinkStyle(link, dark);

    link.addEventListener("mouseenter", () => {
      link.style.textDecoration = "underline";
    });
    link.addEventListener("mouseleave", () => {
      link.style.textDecoration = "none";
    });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      Zotero.launchURL(url);
    });

    return link;
  }

  /**
   * Render link button with appropriate icon and color.
   */
  private renderLinkButton(button: HTMLButtonElement, isLinked: boolean): void {
    button.replaceChildren();
    button.dataset.state = isLinked ? "linked" : "unlinked";
    button.style.opacity = "1";
    button.style.cursor = "pointer";

    // Use createElementNS for XHTML compatibility
    const icon = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "img") as HTMLImageElement;
    icon.src = "chrome://zotero/skin/itempane/16/related.svg";
    icon.width = 14;
    icon.height = 14;
    icon.setAttribute("draggable", "false");
    icon.style.margin = "0";
    icon.style.padding = "0";
    icon.style.display = "block";

    if (isLinked) {
      // Bright green for linked state
      icon.style.filter =
        "brightness(0) saturate(100%) invert(55%) sepia(95%) saturate(500%) hue-rotate(85deg) brightness(95%) contrast(95%)";
    } else {
      // Light gray for unlinked state
      icon.style.filter =
        "brightness(0) saturate(100%) invert(70%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(95%) contrast(85%)";
    }

    button.appendChild(icon);
  }
}
