// ─────────────────────────────────────────────────────────────────────────────
// HoverPreviewController - Preview card state management and coordination
// Extracted from InspireReferencePanelController (Phase 0.4 of zinspire.ts refactor)
//
// Responsibilities:
// - Manage preview card state (entries, currentIndex, timers)
// - Schedule show/hide with delays
// - Coordinate multi-entry preview pagination
// - Fetch and cache abstracts
// - Position preview card relative to anchors
//
// Uses HoverPreviewRenderer for actual DOM rendering.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import {
  type InspireReferenceEntry,
  getCachedStrings,
  fetchInspireAbstract,
  createAbortControllerWithSignal,
  copyToClipboard,
} from "../index";
import {
  HoverPreviewRenderer,
  type PreviewRenderContext,
  type PositionRect,
} from "./HoverPreviewRenderer";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callbacks for preview card actions.
 * These are invoked when user interacts with action buttons.
 */
export interface PreviewActionCallbacks {
  /** Add entry to library */
  onAdd?: (entry: InspireReferenceEntry, anchor?: HTMLElement) => Promise<void>;
  /** Link entry as related item */
  onLink?: (entry: InspireReferenceEntry) => Promise<void>;
  /** Unlink related item */
  onUnlink?: (entry: InspireReferenceEntry) => Promise<void>;
  /** Open PDF attachment */
  onOpenPdf?: (entry: InspireReferenceEntry) => Promise<void>;
  /** Select item in library */
  onSelectInLibrary?: (entry: InspireReferenceEntry) => void;
  /** Copy BibTeX */
  onCopyBibtex?: (entry: InspireReferenceEntry) => Promise<void>;
  /** Copy texkey */
  onCopyTexkey?: (entry: InspireReferenceEntry) => Promise<void>;
  /** Show context menu for abstract */
  onAbstractContextMenu?: (e: MouseEvent, el: HTMLElement, entry: InspireReferenceEntry) => void;
  /** Check if entry has PDF attachment */
  hasPdf?: (entry: InspireReferenceEntry) => boolean;
  /** Called when preview is shown */
  onShow?: (entry: InspireReferenceEntry) => void;
  /** Called when preview is hidden */
  onHide?: () => void;
  /** Check if entry is favorited */
  isFavorite?: (entry: InspireReferenceEntry) => boolean;
  /** Toggle favorite status */
  onToggleFavorite?: (entry: InspireReferenceEntry) => void | Promise<void>;
}

/**
 * Options for HoverPreviewController initialization.
 */
export interface HoverPreviewControllerOptions {
  /** Document for creating elements */
  document: Document;
  /** Container for preview card */
  container: HTMLElement;
  /** Action callbacks */
  callbacks?: PreviewActionCallbacks;
  /** Allow clicking through the card unless pointer is inside */
  clickThrough?: boolean;
  /** Show delay in ms (default: 250) */
  showDelay?: number;
  /** Hide delay in ms (default: 100) */
  hideDelay?: number;
  /** Max entries for multi-preview (default: 20) */
  maxEntries?: number;
}

/**
 * Citation type for preview display.
 */
export type PreviewCitationType = "numeric" | "author-year" | "arxiv";

// ─────────────────────────────────────────────────────────────────────────────
// HoverPreviewController Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Controls preview card lifecycle, state, and interactions.
 *
 * Manages:
 * - Show/hide scheduling with delays
 * - Multi-entry pagination
 * - Abstract fetching and caching
 * - Positioning relative to anchors
 *
 * Uses HoverPreviewRenderer for DOM rendering.
 */
export class HoverPreviewController {
  private doc: Document;
  private container: HTMLElement;
  private renderer: HoverPreviewRenderer;
  private callbacks: PreviewActionCallbacks;

  // Timing configuration
  private readonly showDelay: number;
  private readonly hideDelay: number;
  private readonly maxEntries: number;
  private readonly clickThrough: boolean;

  // Preview card element
  private previewCard?: HTMLDivElement;
  private clickThroughMoveHandler?: (e: MouseEvent) => void;

  // State
  private currentEntryId?: string;
  private entries: InspireReferenceEntry[] = [];
  private currentIndex = 0;
  private label?: string;
  private citationType?: PreviewCitationType;
  private anchorRect?: PositionRect;
  private anchorRow?: HTMLElement;

  // Timers
  private showTimeout?: ReturnType<typeof setTimeout>;
  private hideTimeout?: ReturnType<typeof setTimeout>;

  // Abstract fetching
  private abortController?: AbortController;

  // Context menu flag
  private contextMenuOpen = false;

  // Prevent repeated add actions while picker/import is in flight
  private addActionInFlight = false;

  // Keyboard handler reference (for cleanup)
  private keydownHandler?: (e: KeyboardEvent) => void;

  constructor(options: HoverPreviewControllerOptions) {
    this.doc = options.document;
    this.container = options.container;
    this.callbacks = options.callbacks ?? {};
    this.showDelay = options.showDelay ?? 250;
    this.hideDelay = options.hideDelay ?? 100;
    this.maxEntries = options.maxEntries ?? 20;
    this.clickThrough = options.clickThrough === true;

    this.renderer = new HoverPreviewRenderer({
      document: this.doc,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API - Scheduling
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Schedule preview to show for a single entry.
   * Cancels any pending show/hide operations.
   */
  scheduleShow(entry: InspireReferenceEntry, row: HTMLElement): void {
    this.cancelShow();
    this.cancelHide();
    this.anchorRow = row;

    this.showTimeout = setTimeout(() => {
      this.show(entry, row);
    }, this.showDelay);
  }

  /**
   * Schedule preview to show for multiple entries (pagination).
   * Used for ambiguous citation matches.
   */
  scheduleShowMulti(
    entries: InspireReferenceEntry[],
    options: {
      label?: string;
      citationType?: PreviewCitationType;
      buttonRect: PositionRect;
    },
  ): void {
    this.cancelShow();
    this.cancelHide();

    // Limit entries to prevent memory issues
    const limitedEntries = entries.slice(0, this.maxEntries);

    this.showTimeout = setTimeout(() => {
      this.showMulti(limitedEntries, options);
    }, this.showDelay);
  }

  /**
   * Schedule preview to hide after delay.
   * Does nothing if context menu is open.
   */
  scheduleHide(): void {
    if (this.contextMenuOpen) {
      return;
    }
    this.cancelHide();
    this.hideTimeout = setTimeout(() => {
      this.hide();
    }, this.hideDelay);
  }

  /**
   * Cancel scheduled show.
   */
  cancelShow(): void {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
      this.showTimeout = undefined;
    }
  }

  /**
   * Cancel scheduled hide.
   */
  cancelHide(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = undefined;
    }
  }

  /**
   * Immediately hide the preview card.
   */
  hide(): void {
    this.cancelShow();
    this.cancelHide();

    // Cancel pending abstract fetch
    this.abortController?.abort();
    this.abortController = undefined;

    // Clear state
    this.currentEntryId = undefined;
    this.entries = [];
    this.currentIndex = 0;
    this.label = undefined;
    this.citationType = undefined;
    this.anchorRect = undefined;
    this.anchorRow = undefined;

    if (this.previewCard) {
      this.previewCard.style.display = "none";
      this.previewCard.replaceChildren();
    }

    this.callbacks.onHide?.();
  }

  /**
   * Navigate multi-entry preview pagination.
   * @param delta - Direction: -1 for prev, +1 for next
   */
  navigate(delta: number): void {
    const newIndex = this.currentIndex + delta;
    if (newIndex < 0 || newIndex >= this.entries.length) return;

    // Cancel any scheduled hide to prevent flash
    this.cancelHide();

    this.currentIndex = newIndex;
    const entry = this.entries[newIndex];
    this.currentEntryId = entry.id;

    // Rebuild content
    const card = this.getCard();
    this.buildContent(card, entry);

    // Re-fetch abstract
    this.fetchAbstract(entry, card);
  }

  /**
   * Check if preview is currently visible.
   */
  isVisible(): boolean {
    return this.previewCard?.style.display !== "none" && !!this.currentEntryId;
  }

  /**
   * Get current entry being previewed.
   */
  getCurrentEntry(): InspireReferenceEntry | undefined {
    return this.entries[this.currentIndex];
  }

  /**
   * Set context menu open state.
   * Prevents hide while context menu is open.
   */
  setContextMenuOpen(open: boolean): void {
    this.contextMenuOpen = open;
    if (!open) {
      // Resume normal hide behavior
      this.scheduleHide();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internal - Show Logic
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Show preview for a single entry.
   */
  private show(entry: InspireReferenceEntry, row: HTMLElement): void {
    // Skip if already showing this entry
    if (this.currentEntryId === entry.id) {
      return;
    }

    this.currentEntryId = entry.id;
    this.entries = [entry];
    this.currentIndex = 0;
    this.citationType = undefined;
    this.label = undefined;

    const card = this.getCard();

    // Build content
    this.buildContent(card, entry);

    // Position relative to row
    this.renderer.positionRelativeToRow(card, row);

    // Show
    if (this.clickThrough) {
      card.style.pointerEvents = "none";
    }
    card.style.display = "block";

    // Fetch abstract
    this.fetchAbstract(entry, card);

    this.callbacks.onShow?.(entry);
  }

  /**
   * Show preview for multiple entries.
   */
  private showMulti(
    entries: InspireReferenceEntry[],
    options: {
      label?: string;
      citationType?: PreviewCitationType;
      buttonRect: PositionRect;
    },
  ): void {
    if (entries.length === 0) return;

    const entry = entries[0];

    // Skip if already showing same entries
    if (
      this.currentEntryId === entry.id &&
      this.entries.length === entries.length
    ) {
      return;
    }

    this.currentEntryId = entry.id;
    this.entries = entries;
    this.currentIndex = 0;
    this.label = options.label;
    this.citationType = options.citationType;
    this.anchorRect = options.buttonRect;

    const card = this.getCard();

    // Build content
    this.buildContent(card, entry);

    // Position using bottom anchoring for pagination stability
    this.renderer.positionRelativeToRect(card, options.buttonRect);

    // Show
    if (this.clickThrough) {
      card.style.pointerEvents = "none";
    }
    card.style.display = "block";

    // Fetch abstract
    this.fetchAbstract(entry, card);

    this.callbacks.onShow?.(entry);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internal - Card Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get or create the preview card element.
   */
  private getCard(): HTMLDivElement {
    if (!this.previewCard) {
      this.previewCard = this.renderer.createCard();

      // Append to container
      this.container.appendChild(this.previewCard);

      // Event handlers for hover
      this.previewCard.addEventListener("mouseenter", () => {
        this.cancelHide();
      });

      this.previewCard.addEventListener("mouseleave", () => {
        this.scheduleHide();
      });

      // Click-through mode: don't block underlying UI unless pointer is inside the card.
      if (this.clickThrough) {
        this.previewCard.style.pointerEvents = "none";
        this.clickThroughMoveHandler = (e: MouseEvent) => {
          if (!this.previewCard || this.previewCard.style.display === "none") {
            return;
          }
          const rect = this.previewCard.getBoundingClientRect();
          const inside =
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom;
          const next = inside ? "auto" : "none";
          if (this.previewCard.style.pointerEvents !== next) {
            this.previewCard.style.pointerEvents = next;
          }
          if (inside) {
            this.cancelHide();
          }
        };
        this.doc.addEventListener("mousemove", this.clickThroughMoveHandler, true);
      }

      // Keyboard copy handler
      this.keydownHandler = async (e: KeyboardEvent) => {
        if (!this.previewCard || this.previewCard.style.display === "none") {
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "c") {
          const mainWindow = Zotero.getMainWindow?.();
          const selection = mainWindow?.getSelection?.();
          const selectedText = selection?.toString();
          if (selectedText) {
            e.preventDefault();
            e.stopPropagation();
            await copyToClipboard(selectedText);
          }
        }
      };
      this.doc.addEventListener("keydown", this.keydownHandler, true);
    }
    return this.previewCard;
  }

  /**
   * Build preview card content using renderer.
   */
  private buildContent(card: HTMLDivElement, entry: InspireReferenceEntry): void {
    const ctx: PreviewRenderContext = {
      entry,
      entries: this.entries.length > 1 ? this.entries : undefined,
      currentIndex: this.currentIndex,
      label: this.label,
      citationType: this.citationType,
      hasPdf: this.callbacks.hasPdf ? this.callbacks.hasPdf(entry) : false,
      isFavorite: this.callbacks.isFavorite
        ? this.callbacks.isFavorite(entry)
        : undefined,
      onAdd: this.callbacks.onAdd
        ? async (e, anchor) => {
            if (this.addActionInFlight) {
              return;
            }
            this.addActionInFlight = true;
            // Save rendered abstract before rebuilding card
            const oldAbstractEl = card.querySelector(
              ".zinspire-preview-card__abstract",
            ) as HTMLElement | null;
            const savedAbstractEl = oldAbstractEl ?? undefined;
            const savedLatexSource = oldAbstractEl?.dataset.latexSource;

            try {
              await this.callbacks.onAdd!(e, anchor);
              // Refresh card to reflect local status changes
              this.buildContent(card, e);

              // Restore abstract content if unchanged (skip expensive re-render)
              if (
                savedAbstractEl &&
                savedLatexSource &&
                e.abstract === savedLatexSource
              ) {
                const newAbstractEl = card.querySelector(
                  ".zinspire-preview-card__abstract",
                ) as HTMLElement | null;
                if (newAbstractEl) {
                  newAbstractEl.replaceWith(savedAbstractEl);
                  savedAbstractEl.dataset.latexSource = savedLatexSource;
                  return;
                }
              }
              // Otherwise fetch/render abstract normally
              this.fetchAbstract(e, card);
            } finally {
              this.addActionInFlight = false;
            }
          }
        : undefined,
      // Wrap link callback to refresh content after completion
      onLink: this.callbacks.onLink
        ? async (e) => {
            // Save rendered abstract before rebuilding card
            const oldAbstractEl = card.querySelector(
              ".zinspire-preview-card__abstract",
            ) as HTMLElement | null;
            const savedAbstractEl = oldAbstractEl ?? undefined;
            const savedLatexSource = oldAbstractEl?.dataset.latexSource;

            await this.callbacks.onLink!(e);
            // Update state and refresh card
            e.isRelated = true;
            this.buildContent(card, e);

            // Restore abstract content if unchanged (skip expensive re-render)
            if (savedAbstractEl && savedLatexSource && e.abstract === savedLatexSource) {
              const newAbstractEl = card.querySelector(
                ".zinspire-preview-card__abstract",
              ) as HTMLElement | null;
              if (newAbstractEl) {
                newAbstractEl.replaceWith(savedAbstractEl);
                savedAbstractEl.dataset.latexSource = savedLatexSource;
                return;
              }
            }
            // Otherwise fetch/render abstract normally
            this.fetchAbstract(e, card);
          }
        : undefined,
      // Wrap unlink callback to refresh content after completion
      onUnlink: this.callbacks.onUnlink
        ? async (e) => {
            // Save rendered abstract before rebuilding card
            const oldAbstractEl = card.querySelector(
              ".zinspire-preview-card__abstract",
            ) as HTMLElement | null;
            const savedAbstractEl = oldAbstractEl ?? undefined;
            const savedLatexSource = oldAbstractEl?.dataset.latexSource;

            await this.callbacks.onUnlink!(e);
            // Update state and refresh card
            e.isRelated = false;
            this.buildContent(card, e);

            // Restore abstract content if unchanged (skip expensive re-render)
            if (savedAbstractEl && savedLatexSource && e.abstract === savedLatexSource) {
              const newAbstractEl = card.querySelector(
                ".zinspire-preview-card__abstract",
              ) as HTMLElement | null;
              if (newAbstractEl) {
                newAbstractEl.replaceWith(savedAbstractEl);
                savedAbstractEl.dataset.latexSource = savedLatexSource;
                return;
              }
            }
            // Otherwise fetch/render abstract normally
            this.fetchAbstract(e, card);
          }
        : undefined,
      onOpenPdf: this.callbacks.onOpenPdf
        ? (e) => this.callbacks.onOpenPdf!(e)
        : undefined,
      onSelectInLibrary: this.callbacks.onSelectInLibrary
        ? (e) => this.callbacks.onSelectInLibrary!(e)
        : undefined,
      onCopyBibtex: this.callbacks.onCopyBibtex
        ? (e) => this.callbacks.onCopyBibtex!(e)
        : undefined,
      onCopyTexkey: this.callbacks.onCopyTexkey
        ? (e) => this.callbacks.onCopyTexkey!(e)
        : undefined,
          onToggleFavorite: this.callbacks.onToggleFavorite
        ? async (e) => {
            const oldAbstractEl = card.querySelector(
              ".zinspire-preview-card__abstract",
            ) as HTMLElement | null;
            const savedAbstractEl = oldAbstractEl ?? undefined;
            const savedLatexSource = oldAbstractEl?.dataset.latexSource;

            await this.callbacks.onToggleFavorite!(e);
            this.buildContent(card, e);

            if (savedAbstractEl && savedLatexSource && e.abstract === savedLatexSource) {
              const newAbstractEl = card.querySelector(
                ".zinspire-preview-card__abstract",
              ) as HTMLElement | null;
              if (newAbstractEl) {
                newAbstractEl.replaceWith(savedAbstractEl);
                savedAbstractEl.dataset.latexSource = savedLatexSource;
                return;
              }
            }
            this.fetchAbstract(e, card);
          }
        : undefined,
      onNavigate: (delta) => this.navigate(delta),
      onAbstractContextMenu: this.callbacks.onAbstractContextMenu
        ? (e, el) => {
          this.setContextMenuOpen(true);
            this.callbacks.onAbstractContextMenu!(e, el, entry);
          }
        : undefined,
    };

    this.renderer.buildContent(card, ctx);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internal - Abstract Fetching
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fetch and display abstract in preview card.
   * Optimized to skip re-rendering if content unchanged.
   */
  private async fetchAbstract(
    entry: InspireReferenceEntry,
    card: HTMLDivElement,
  ): Promise<void> {
    const abstractEl = card.querySelector(
      ".zinspire-preview-card__abstract",
    ) as HTMLElement;

    if (!abstractEl) return;

    const s = getCachedStrings();

    // Check if already cached
    if (entry.abstract !== undefined) {
      const text = entry.abstract?.trim() || s.noAbstract;
      // Skip re-render if content unchanged (optimization for Link/Unlink refresh)
      if (abstractEl.dataset.latexSource === text) {
        return;
      }
      await this.renderer.renderAbstract(abstractEl, text);
      return;
    }

    // Try local library first
    if (entry.localItemID) {
      const localItem = Zotero.Items.get(entry.localItemID);
      if (localItem) {
        const localAbstract = localItem.getField("abstractNote") as string;
        if (localAbstract?.trim()) {
          entry.abstract = localAbstract.trim();
          await this.renderer.renderAbstract(abstractEl, entry.abstract);
          return;
        }
      }
    }

    // Fetch from INSPIRE API
    if (entry.recid) {
      // Cancel previous fetch
      this.abortController?.abort();
      const { controller, signal } = createAbortControllerWithSignal();
      this.abortController = controller;

      try {
        const abstract = await fetchInspireAbstract(entry.recid, signal);

        // Check if still showing same entry
        if (this.currentEntryId !== entry.id) return;

        if (abstract) {
          entry.abstract = abstract;
          await this.renderer.renderAbstract(abstractEl, abstract);
        } else {
          entry.abstract = "";
          abstractEl.textContent = s.noAbstract;
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          Zotero.debug(
            `[${config.addonName}] [HoverPreviewController] Abstract fetch error: ${err}`,
          );
          abstractEl.textContent = s.noAbstract;
        }
      }
    } else {
      abstractEl.textContent = s.noAbstract;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Clean up resources.
   * Call when controller is no longer needed.
   */
  dispose(): void {
    this.hide();

    // Remove document keydown listener
    if (this.keydownHandler) {
      this.doc.removeEventListener("keydown", this.keydownHandler, true);
      this.keydownHandler = undefined;
    }

    if (this.clickThroughMoveHandler) {
      this.doc.removeEventListener("mousemove", this.clickThroughMoveHandler, true);
      this.clickThroughMoveHandler = undefined;
    }

    if (this.previewCard) {
      this.previewCard.remove();
      this.previewCard = undefined;
    }
  }
}
