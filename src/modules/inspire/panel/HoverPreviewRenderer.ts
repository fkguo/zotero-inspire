// ─────────────────────────────────────────────────────────────────────────────
// HoverPreviewRenderer - Preview card rendering for INSPIRE References Panel
// Extracted from InspireReferencePanelController (Phase 0.3 of zinspire.ts refactor)
//
// Responsibilities:
// - Build preview card content (title, authors, identifiers, abstract placeholder)
// - Build action row with buttons (Add, Link, Copy, Lookup)
// - Build pagination UI for multi-entry previews
// - Position preview cards relative to anchors
// - Render abstract text with LaTeX support
//
// NOT responsible for:
// - State management (previewEntries, currentIndex owned by controller)
// - Scheduling show/hide (delays, timers owned by controller)
// - Abstract fetching (API calls owned by controller)
// - Event coordination with other tooltips
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { cleanMathTitle } from "../../../utils/mathTitle";
import {
  ARXIV_ABS_URL,
  DOI_ORG_URL,
  type InspireReferenceEntry,
  getCachedStrings,
  formatAuthors,
  formatPublicationInfo,
  formatArxivDetails,
  getRenderMode,
  renderMathContent,
} from "../index";
import { isDarkMode } from "../styles";
import {
  applyPreviewCardStyle,
  applyPreviewCardTitleStyle,
  applyPreviewCardSectionStyle,
  applyPreviewCardIdentifiersStyle,
  applyPreviewCardAbstractStyle,
  applyMetaLinkStyle,
} from "../../pickerUI";

// XHTML namespace for proper element creation in Zotero (FIX-NAMESPACE-WARNING)
const XHTML_NS = "http://www.w3.org/1999/xhtml";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context for preview card rendering.
 * Contains entry data and callbacks for user interactions.
 */
export interface PreviewRenderContext {
  /** Entry to display */
  entry: InspireReferenceEntry;
  /** All entries for multi-entry preview (pagination) */
  entries?: InspireReferenceEntry[];
  /** Current index in entries array */
  currentIndex?: number;
  /** Label to display in pagination (e.g., "[65]") */
  label?: string;
  /** Citation type for hint message */
  citationType?: "numeric" | "author-year" | "arxiv";
  /** Whether entry has a PDF attachment (for showing Open PDF button) */
  hasPdf?: boolean;
  /** Whether entry is a favorite (for showing star button) */
  isFavorite?: boolean;

  // Action callbacks (async to support state refresh after completion)
  onAdd?: (entry: InspireReferenceEntry) => void | Promise<void>;
  onLink?: (entry: InspireReferenceEntry) => void | Promise<void>;
  onUnlink?: (entry: InspireReferenceEntry) => void | Promise<void>;
  onOpenPdf?: (entry: InspireReferenceEntry) => void | Promise<void>;
  onSelectInLibrary?: (entry: InspireReferenceEntry) => void;
  onCopyBibtex?: (entry: InspireReferenceEntry) => void | Promise<void>;
  onCopyTexkey?: (entry: InspireReferenceEntry) => void | Promise<void>;
  onToggleFavorite?: (entry: InspireReferenceEntry) => void | Promise<void>;
  onNavigate?: (delta: number) => void;
  onAbstractContextMenu?: (e: MouseEvent, el: HTMLElement) => void;
}

/**
 * Options for HoverPreviewRenderer initialization.
 */
export interface HoverPreviewRendererOptions {
  /** Document for creating elements */
  document: Document;
  /** Card max width in pixels (default: 420) */
  cardMaxWidth?: number;
  /** Card max height in pixels (default: 400) */
  cardMaxHeight?: number;
}

/**
 * Positioning rectangle for card placement.
 */
export interface PositionRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// HoverPreviewRenderer Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders preview cards for the INSPIRE References Panel.
 *
 * Extracts pure rendering logic from the main controller.
 * All state management and API calls remain in the main controller.
 */
export class HoverPreviewRenderer {
  private doc: Document;
  private cardMaxWidth: number;
  private cardMaxHeight: number;
  private strings: ReturnType<typeof getCachedStrings>;

  constructor(options: HoverPreviewRendererOptions) {
    this.doc = options.document;
    this.cardMaxWidth = options.cardMaxWidth ?? 420;
    this.cardMaxHeight = options.cardMaxHeight ?? 400;
    this.strings = getCachedStrings();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Card Creation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create the preview card container element with base styling.
   * The card is initially hidden (display: none).
   */
  createCard(): HTMLDivElement {
    const card = this.doc.createElement("div");
    card.className = "zinspire-preview-card";
    applyPreviewCardStyle(card);
    card.style.display = "none";
    card.style.position = "fixed";
    card.style.zIndex = "10001";
    card.style.maxWidth = `${this.cardMaxWidth}px`;
    card.style.maxHeight = `${this.cardMaxHeight}px`;
    card.style.overflow = "auto";
    return card;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Content Building
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Build the preview card content.
   * Clears existing content and rebuilds with entry data.
   */
  buildContent(card: HTMLDivElement, ctx: PreviewRenderContext): void {
    const { entry } = ctx;
    const s = this.strings;
    const dark = isDarkMode();

    // Clear previous content
    card.replaceChildren();

    // Title
    const titleEl = this.doc.createElement("div");
    titleEl.classList.add("zinspire-preview-card__title");
    applyPreviewCardTitleStyle(titleEl);
    const cleanedTitle = cleanMathTitle(entry.title || "");
    titleEl.innerHTML = cleanedTitle || s.noTitle;
    card.appendChild(titleEl);

    // Authors
    if (entry.authors?.length) {
      const authorsEl = this.doc.createElement("div");
      authorsEl.classList.add("zinspire-preview-card__authors");
      applyPreviewCardSectionStyle(authorsEl);
      authorsEl.textContent = formatAuthors(entry.authors, entry.totalAuthors);
      card.appendChild(authorsEl);
    }

    // Publication info
    const pubInfo = formatPublicationInfo(entry.publicationInfo, entry.year);
    if (pubInfo) {
      const pubEl = this.doc.createElement("div");
      pubEl.classList.add("zinspire-preview-card__publication");
      applyPreviewCardSectionStyle(pubEl);
      pubEl.textContent = pubInfo;
      card.appendChild(pubEl);
    }

    // Identifiers (arXiv, DOI)
    this.buildIdentifiersRow(card, entry, dark);

    // Citation count
    const citationCount = entry.citationCount ?? entry.citationCountWithoutSelf;
    if (typeof citationCount === "number") {
      const citesEl = this.doc.createElement("div");
      citesEl.classList.add("zinspire-preview-card__citations");
      applyPreviewCardSectionStyle(citesEl);
      citesEl.textContent = getString("references-panel-citation-count", {
        args: { count: citationCount },
      });
      card.appendChild(citesEl);
    }

    // Abstract placeholder
    const abstractEl = this.doc.createElement("div");
    abstractEl.classList.add("zinspire-preview-card__abstract");
    applyPreviewCardAbstractStyle(abstractEl);
    if (ctx.onAbstractContextMenu) {
      abstractEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.onAbstractContextMenu!(e, abstractEl);
      });
    }
    abstractEl.textContent = getString("references-panel-loading-abstract");
    card.appendChild(abstractEl);

    // Action row
    this.buildActionRow(card, ctx);

    // Pagination (if multi-entry)
    if (ctx.entries && ctx.entries.length > 1) {
      this.buildPagination(card, ctx);
    }
  }

  /**
   * Build identifiers row (arXiv, DOI links).
   */
  private buildIdentifiersRow(
    card: HTMLDivElement,
    entry: InspireReferenceEntry,
    dark: boolean,
  ): void {
    const arxivDetails = formatArxivDetails(entry.arxivDetails);
    const hasArxiv = Boolean(arxivDetails?.id);
    const hasDoi = Boolean(entry.doi);

    if (!hasArxiv && !hasDoi) return;

    const idsEl = this.doc.createElement("div");
    idsEl.classList.add("zinspire-preview-card__identifiers");
    applyPreviewCardIdentifiersStyle(idsEl);

    if (hasArxiv && arxivDetails?.id) {
      const arxivLink = this.doc.createElement("a");
      arxivLink.href = `${ARXIV_ABS_URL}/${arxivDetails.id}`;
      arxivLink.textContent = `arXiv:${arxivDetails.id}`;
      applyMetaLinkStyle(arxivLink, dark);
      arxivLink.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        Zotero.launchURL(arxivLink.href);
      });
      idsEl.appendChild(arxivLink);
    }

    if (hasDoi) {
      if (hasArxiv) {
        const sep = this.doc.createElement("span");
        sep.textContent = " • ";
        sep.style.color = "var(--fill-tertiary, #a0aec0)";
        idsEl.appendChild(sep);
      }
      const doiLink = this.doc.createElement("a");
      doiLink.href = `${DOI_ORG_URL}/${entry.doi}`;
      doiLink.textContent = `DOI:${entry.doi}`;
      applyMetaLinkStyle(doiLink, dark);
      doiLink.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        Zotero.launchURL(doiLink.href);
      });
      idsEl.appendChild(doiLink);
    }

    card.appendChild(idsEl);
  }

  /**
   * Build action row with buttons (Add, Open PDF, Select, Link, Copy).
   */
  private buildActionRow(card: HTMLDivElement, ctx: PreviewRenderContext): void {
    const { entry } = ctx;
    const s = this.strings;
    const isLocal = Boolean(entry.localItemID);

    const actionRow = this.doc.createElement("div");
    actionRow.classList.add("zinspire-preview-card__actions");
    Object.assign(actionRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginTop: "8px",
      paddingTop: "8px",
      borderTop: "1px solid var(--fill-quinary, #e2e8f0)",
    });

    // Action buttons (left side)
    if (!isLocal) {
      // Not in library - show Add button
      if (entry.recid && ctx.onAdd) {
        const addButton = this.createActionButton(
          getString("references-panel-button-add"),
          "add",
        );
        addButton.addEventListener("click", (e) => {
          e.stopPropagation();
          ctx.onAdd!(entry);
        });
        actionRow.appendChild(addButton);
      }
    } else {
      // In library - show Open PDF, Select, then Link/Unlink (most used first)

      // Open PDF button (if has PDF)
      if (ctx.hasPdf && ctx.onOpenPdf) {
        const pdfButton = this.createActionButton(
          getString("references-panel-button-open-pdf"),
          "pdf",
        );
        pdfButton.addEventListener("click", (e) => {
          e.stopPropagation();
          ctx.onOpenPdf!(entry);
        });
        actionRow.appendChild(pdfButton);
      }

      // Select in Library button
      if (ctx.onSelectInLibrary) {
        const selectButton = this.createActionButton(
          getString("references-panel-button-select"),
          "select",
        );
        selectButton.addEventListener("click", (e) => {
          e.stopPropagation();
          ctx.onSelectInLibrary!(entry);
        });
        actionRow.appendChild(selectButton);
      }

      // Link/Unlink button
      if (ctx.onLink) {
        const linkButton = this.createActionButton(
          entry.isRelated
            ? getString("references-panel-button-unlink")
            : getString("references-panel-button-link"),
          entry.isRelated ? "unlink" : "link",
        );
        linkButton.addEventListener("click", (e) => {
          e.stopPropagation();
          if (entry.isRelated && ctx.onUnlink) {
            ctx.onUnlink(entry);
          } else {
            ctx.onLink!(entry);
          }
        });
        actionRow.appendChild(linkButton);
      }
    }

    // Copy BibTeX button
    if (entry.recid && ctx.onCopyBibtex) {
      const bibtexBtn = this.createActionButton(s.copyBibtex, "copy");
      bibtexBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.onCopyBibtex!(entry);
      });
      actionRow.appendChild(bibtexBtn);
    }

    // Copy texkey button
    if ((entry.texkey || entry.recid) && ctx.onCopyTexkey) {
      const texkeyBtn = this.createActionButton(s.copyTexkey, "copy");
      texkeyBtn.textContent = "T";
      texkeyBtn.title = s.copyTexkey;
      texkeyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.onCopyTexkey!(entry);
      });
      actionRow.appendChild(texkeyBtn);
    }

    // Spacer
    const spacer = this.doc.createElement("div");
    spacer.style.flex = "1";
    actionRow.appendChild(spacer);

    // Local status indicator (right side)
    const statusEl = this.doc.createElement("span");
    statusEl.classList.add("zinspire-preview-card__status");
    Object.assign(statusEl.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      fontSize: "12px",
      color: isLocal
        ? "var(--accent-green, #10b981)"
        : "var(--fill-secondary, #6b7280)",
    });

    const statusIcon = this.doc.createElement("span");
    statusIcon.textContent = isLocal ? "●" : "○";
    statusIcon.style.fontSize = "10px";
    statusEl.appendChild(statusIcon);

    const statusText = this.doc.createElement("span");
    statusText.textContent = isLocal
      ? getString("references-panel-status-local")
      : getString("references-panel-status-online");
    statusEl.appendChild(statusText);

    actionRow.appendChild(statusEl);

    // Favorite toggle (rightmost, like author preview)
    const canFavorite = Boolean(entry.recid || entry.localItemID);
    if (
      canFavorite &&
      typeof ctx.isFavorite === "boolean" &&
      ctx.onToggleFavorite
    ) {
      const isFav = ctx.isFavorite;
      const favBtn = this.doc.createElement("button");
      favBtn.type = "button";
      favBtn.textContent = isFav ? "★" : "☆";
      favBtn.title = getString(
        isFav ? "references-panel-favorite-remove" : "references-panel-favorite-add",
      );
      favBtn.style.cssText = `
        border: none;
        background: transparent;
        font-size: 14px;
        cursor: pointer;
        color: ${isFav ? "#f59e0b" : "var(--fill-tertiary, #94a3b8)"};
        padding: 0 2px;
        margin-left: 6px;
        flex-shrink: 0;
      `;
      favBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.onToggleFavorite?.(entry);
      });
      actionRow.appendChild(favBtn);
    }

    card.appendChild(actionRow);
  }

  /**
   * Build pagination controls for multi-entry preview.
   */
  private buildPagination(
    card: HTMLDivElement,
    ctx: PreviewRenderContext,
  ): void {
    const { entries, currentIndex = 0, label, citationType, onNavigate } = ctx;
    if (!entries || entries.length <= 1) return;

    const total = entries.length;
    const current = currentIndex + 1;

    const paginationRow = this.doc.createElement("div");
    paginationRow.className = "zinspire-preview-pagination";
    Object.assign(paginationRow.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      padding: "6px 10px",
      borderTop: "1px solid var(--fill-quinary, #e0e0e0)",
      backgroundColor: "var(--material-background50, #fafafa)",
      borderRadius: "0 0 8px 8px",
      fontSize: "12px",
    });

    // Prev button
    const prevBtn = this.doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
    prevBtn.textContent = "‹";
    prevBtn.title = getString("references-panel-back");
    prevBtn.disabled = current <= 1;
    this.applyPaginationButtonStyle(prevBtn, current <= 1);
    if (onNavigate) {
      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onNavigate(-1);
      });
    }

    // Page indicator
    const indicator = this.doc.createElement("span");
    indicator.className = "zinspire-preview-indicator";
    const labelStr = label ? ` [${label}]` : "";
    indicator.textContent = `${current} / ${total}${labelStr}`;
    Object.assign(indicator.style, {
      color: "var(--fill-secondary, #666)",
      fontWeight: "500",
    });

    // Next button
    const nextBtn = this.doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
    nextBtn.textContent = "›";
    nextBtn.title = getString("references-panel-forward");
    nextBtn.disabled = current >= total;
    this.applyPaginationButtonStyle(nextBtn, current >= total);
    if (onNavigate) {
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onNavigate(1);
      });
    }

    paginationRow.appendChild(prevBtn);
    paginationRow.appendChild(indicator);
    paginationRow.appendChild(nextBtn);
    card.appendChild(paginationRow);

    // Hint for author-year with multiple matches
    if (citationType === "author-year" && total > 1) {
      const hintRow = this.doc.createElement("div");
      hintRow.className = "zinspire-preview-hint";
      Object.assign(hintRow.style, {
        padding: "4px 10px 6px",
        textAlign: "center",
        fontSize: "11px",
        color: "var(--fill-tertiary, #888)",
        fontStyle: "italic",
        backgroundColor: "var(--material-background50, #fafafa)",
        borderRadius: "0 0 8px 8px",
      });
      hintRow.textContent = getString("pdf-annotate-ambiguous-preview-hint");
      card.appendChild(hintRow);
    }
  }

  /**
   * Create a styled action button.
   */
  private createActionButton(
    label: string,
    type: "add" | "link" | "unlink" | "copy" | "lookup" | "pdf" | "select",
  ): HTMLButtonElement {
    const button = this.doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
    button.textContent = label;
    button.title = label;

    const isDestructive = type === "unlink";
    const isPrimary = type === "add" || type === "link";

    const baseStyle: Partial<CSSStyleDeclaration> = {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "4px 10px",
      fontSize: "11px",
      fontWeight: "500",
      borderRadius: "4px",
      cursor: "pointer",
      transition: "all 100ms ease-in-out",
    };

    if (isPrimary) {
      Object.assign(baseStyle, {
        backgroundColor: "var(--accent-color, #3b82f6)",
        color: "#fff",
        border: "1px solid var(--accent-color, #3b82f6)",
      });
    } else if (isDestructive) {
      Object.assign(baseStyle, {
        backgroundColor: "var(--material-background, #fff)",
        color: "var(--accent-red, #ef4444)",
        border: "1px solid var(--accent-red, #ef4444)",
      });
    } else {
      Object.assign(baseStyle, {
        backgroundColor: "var(--material-background, #fff)",
        color: "var(--fill-primary, #374151)",
        border: "1px solid var(--fill-quinary, #d1d5db)",
      });
    }

    Object.assign(button.style, baseStyle);

    // Hover effect
    button.addEventListener("mouseenter", () => {
      if (isPrimary) {
        button.style.opacity = "0.9";
      } else {
        button.style.backgroundColor = "var(--fill-quinary, #f3f4f6)";
      }
    });
    button.addEventListener("mouseleave", () => {
      if (isPrimary) {
        button.style.opacity = "1";
      } else {
        button.style.backgroundColor = "var(--material-background, #fff)";
      }
    });

    return button;
  }

  /**
   * Apply pagination button styling.
   */
  private applyPaginationButtonStyle(
    button: HTMLButtonElement,
    disabled: boolean,
  ): void {
    Object.assign(button.style, {
      width: "24px",
      height: "24px",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      borderRadius: "4px",
      backgroundColor: disabled
        ? "var(--fill-quinary, #e0e0e0)"
        : "var(--material-background, #fff)",
      cursor: disabled ? "default" : "pointer",
      fontSize: "14px",
      fontWeight: "bold",
      opacity: disabled ? "0.5" : "1",
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Positioning
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Position the preview card relative to a row element.
   * Prefers right side of row, falls back to below if no space.
   */
  positionRelativeToRow(card: HTMLDivElement, row: HTMLElement): void {
    const mainWindow = Zotero.getMainWindow();
    const doc = mainWindow?.document || this.doc;
    const viewportWidth = doc.documentElement?.clientWidth || 800;
    const viewportHeight = doc.documentElement?.clientHeight || 600;

    const rowRect = row.getBoundingClientRect();
    const gap = 8;

    let left: number;
    let top: number;

    // Try right side first
    const rightSpace = viewportWidth - rowRect.right - gap;
    if (rightSpace >= this.cardMaxWidth) {
      left = rowRect.right + gap;
      top = rowRect.top;
    } else {
      // Try left side
      const leftSpace = rowRect.left - gap;
      if (leftSpace >= this.cardMaxWidth) {
        left = rowRect.left - this.cardMaxWidth - gap;
        top = rowRect.top;
      } else {
        // Position below
        left = Math.max(
          gap,
          Math.min(rowRect.left, viewportWidth - this.cardMaxWidth - gap),
        );
        top = rowRect.bottom + gap;
      }
    }

    // Ensure within viewport
    if (top + this.cardMaxHeight > viewportHeight - gap) {
      top = Math.max(gap, viewportHeight - this.cardMaxHeight - gap);
    }
    if (top < gap) {
      top = gap;
    }

    // Use top positioning
    card.style.top = `${top}px`;
    card.style.bottom = "auto";
    card.style.left = `${left}px`;
  }

  /**
   * Position the preview card relative to a rect (e.g., button position).
   * Uses BOTTOM positioning so card anchors at bottom and expands upward.
   * This keeps pagination buttons near the anchor when content changes.
   */
  positionRelativeToRect(card: HTMLDivElement, rect: PositionRect): void {
    const mainWindow = Zotero.getMainWindow();
    const doc = mainWindow?.document || this.doc;
    const viewportWidth = doc.documentElement?.clientWidth || 800;
    const viewportHeight = doc.documentElement?.clientHeight || 600;

    const gap = 8;

    // Horizontal position
    const left = Math.max(
      gap,
      Math.min(rect.left, viewportWidth - this.cardMaxWidth - gap),
    );

    // Vertical position using bottom anchor
    const spaceAbove = rect.top - gap;
    const spaceBelow = viewportHeight - rect.bottom - gap;

    let bottom: number;

    if (spaceAbove >= this.cardMaxHeight || spaceAbove >= spaceBelow) {
      // Position above: card's bottom edge near button's top
      bottom = viewportHeight - rect.top + gap;
    } else {
      // Position below
      bottom = Math.max(
        gap,
        viewportHeight - rect.bottom - this.cardMaxHeight - gap,
      );
    }

    // Ensure card stays within viewport
    const maxBottom = viewportHeight - this.cardMaxHeight - gap;
    if (bottom > maxBottom) {
      bottom = Math.max(gap, maxBottom);
    }

    // Use bottom positioning
    card.style.top = "auto";
    card.style.bottom = `${bottom}px`;
    card.style.left = `${left}px`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Abstract Rendering
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Render abstract text in preview card with LaTeX support.
   * Stores original text in data attribute for "Copy as LaTeX" feature.
   */
  async renderAbstract(el: HTMLElement, text: string): Promise<void> {
    // Store original text for "Copy as LaTeX"
    el.dataset.latexSource = text;

    const mode = getRenderMode();

    if (mode === "unicode") {
      let processed = cleanMathTitle(text);
      processed = processed
        .replace(/<sup>([^<]+)<\/sup>/g, "^$1")
        .replace(/<sub>([^<]+)<\/sub>/g, "_$1");
      el.textContent = processed;
      return;
    }

    // KaTeX mode: render full text
    await renderMathContent(text, el);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Refresh cached localized strings (call when locale changes).
   */
  refreshStrings(): void {
    this.strings = getCachedStrings();
  }
}
