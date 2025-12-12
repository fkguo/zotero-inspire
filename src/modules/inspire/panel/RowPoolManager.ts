// ─────────────────────────────────────────────────────────────────────────────
// RowPoolManager - Row pooling and template management for References Panel
// Extracted from InspireReferencePanelController as part of controller refactoring
// Focuses on PERF-13 optimizations: row pooling and template reuse
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { ROW_POOL_MAX_SIZE, type InspireReferenceEntry } from "../index";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Style applicator function type.
 */
export type StyleApplicator = (element: HTMLElement) => void;

/**
 * Options for RowPoolManager initialization.
 */
export interface RowPoolManagerOptions {
  /** Maximum size of the row pool */
  maxPoolSize?: number;
  /** Callback to apply text container styles */
  applyTextContainerStyle?: StyleApplicator;
  /** Callback to apply marker styles */
  applyMarkerStyle?: StyleApplicator;
  /** Callback to apply content styles */
  applyContentStyle?: StyleApplicator;
  /** Callback to apply link button styles */
  applyLinkButtonStyle?: StyleApplicator;
  /** Callback to apply BibTeX button styles */
  applyBibTeXButtonStyle?: StyleApplicator;
}

/**
 * Pool statistics for monitoring.
 */
export interface PoolStats {
  currentSize: number;
  maxSize: number;
  createdCount: number;
  recycledCount: number;
  hitCount: number;
  missCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// RowPoolManager Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages row element pooling for efficient list rendering (PERF-13).
 *
 * Key optimizations:
 * - Pre-creates row templates with all sub-elements
 * - Reuses pooled rows instead of creating new DOM elements
 * - Only updates content, not structure, when reusing rows
 */
export class RowPoolManager {
  private pool: HTMLDivElement[] = [];
  private maxPoolSize: number;
  private options: RowPoolManagerOptions;

  // Statistics for monitoring
  private stats = {
    createdCount: 0,
    recycledCount: 0,
    hitCount: 0,
    missCount: 0,
  };

  constructor(options: RowPoolManagerOptions = {}) {
    this.maxPoolSize = options.maxPoolSize ?? ROW_POOL_MAX_SIZE;
    this.options = options;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a row element from the pool or create a new one.
   * Pooled elements retain their structure - only content needs updating.
   */
  getRow(doc: Document): HTMLDivElement {
    const pooled = this.pool.pop();
    if (pooled) {
      this.stats.hitCount++;
      return pooled;
    }

    this.stats.missCount++;
    return this.createRowTemplate(doc);
  }

  /**
   * Return a row element to the pool for later reuse.
   * Structure is preserved - no need to clear content.
   */
  returnRow(row: HTMLDivElement): boolean {
    if (this.pool.length < this.maxPoolSize) {
      // Keep structure intact, just reset data attributes
      delete row.dataset.entryId;
      // Clear focus/highlight styles before pooling
      row.classList.remove("zinspire-entry-focused", "zinspire-entry-highlight");
      row.style.backgroundColor = "";
      row.style.boxShadow = "";
      this.pool.push(row);
      this.stats.recycledCount++;
      return true;
    }
    // Pool is full - element will be garbage collected
    return false;
  }

  /**
   * Recycle rows from a container to the pool.
   * Only recycles up to available slots to avoid unnecessary iteration.
   */
  recycleFromContainer(container: HTMLElement): number {
    const slotsAvailable = this.maxPoolSize - this.pool.length;
    if (slotsAvailable <= 0) return 0;

    const rows = container.querySelectorAll(".zinspire-ref-entry");
    const limit = Math.min(rows.length, slotsAvailable);
    let recycled = 0;

    for (let i = 0; i < limit; i++) {
      if (this.returnRow(rows[i] as HTMLDivElement)) {
        recycled++;
      }
    }

    return recycled;
  }

  /**
   * Clear the pool and reset statistics.
   */
  clear(): void {
    this.pool.length = 0;
  }

  /**
   * Get pool statistics.
   */
  getStats(): PoolStats {
    return {
      currentSize: this.pool.length,
      maxSize: this.maxPoolSize,
      ...this.stats,
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this.stats = {
      createdCount: 0,
      recycledCount: 0,
      hitCount: 0,
      missCount: 0,
    };
  }

  /**
   * Get current pool size.
   */
  get size(): number {
    return this.pool.length;
  }

  /**
   * Get pool hit rate (0-1).
   */
  get hitRate(): number {
    const total = this.stats.hitCount + this.stats.missCount;
    return total > 0 ? this.stats.hitCount / total : 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Template Creation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a row template with all sub-elements pre-created (PERF-13).
   * This template is reused when pooling rows - only content is updated.
   */
  private createRowTemplate(doc: Document): HTMLDivElement {
    this.stats.createdCount++;

    const row = doc.createElement("div");
    row.classList.add("zinspire-ref-entry");

    // Use innerHTML for static elements (Zotero XHTML removes input/button via innerHTML)
    row.innerHTML = `
      <div class="zinspire-ref-entry__text">
        <span class="zinspire-ref-entry__dot is-clickable"></span>
        <div class="zinspire-ref-entry__content">
          <div class="zinspire-ref-entry__title">
            <span class="zinspire-ref-entry__label"></span>
            <span class="zinspire-ref-entry__authors"></span><span class="zinspire-ref-entry__separator">: </span>
            <a class="zinspire-ref-entry__title-link" href="#"></a>
          </div>
          <div class="zinspire-ref-entry__meta"></div>
        </div>
      </div>
    `;

    const textContainer = row.querySelector(".zinspire-ref-entry__text") as HTMLElement;
    const marker = row.querySelector(".zinspire-ref-entry__dot") as HTMLElement;
    const content = row.querySelector(".zinspire-ref-entry__content") as HTMLElement;

    // Apply styles via callbacks if provided
    if (textContainer && this.options.applyTextContainerStyle) {
      this.options.applyTextContainerStyle(textContainer);
    }
    if (marker) {
      if (this.options.applyMarkerStyle) {
        this.options.applyMarkerStyle(marker);
      }
      marker.style.cursor = "pointer";
    }
    if (content && this.options.applyContentStyle) {
      this.options.applyContentStyle(content);
    }

    // Create checkbox via createElement (required for Zotero XHTML security)
    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add("zinspire-ref-entry__checkbox");
    checkbox.style.width = "14px";
    checkbox.style.height = "14px";
    checkbox.style.margin = "0";
    checkbox.style.cursor = "pointer";
    checkbox.style.flexShrink = "0";

    // Create buttons via createElement (required for Zotero XHTML security)
    const linkButton = doc.createElement("button");
    linkButton.type = "button";
    linkButton.classList.add("zinspire-ref-entry__link");
    if (this.options.applyLinkButtonStyle) {
      this.options.applyLinkButtonStyle(linkButton);
    }

    const bibtexButton = doc.createElement("button");
    bibtexButton.type = "button";
    bibtexButton.classList.add("zinspire-ref-entry__bibtex");
    if (this.options.applyBibTeXButtonStyle) {
      this.options.applyBibTeXButtonStyle(bibtexButton);
    }

    const statsButton = doc.createElement("button");
    statsButton.type = "button";
    statsButton.classList.add("zinspire-ref-entry__stats", "zinspire-ref-entry__stats-button");

    // Insert elements at correct positions
    if (textContainer && marker && content) {
      // Insert checkbox before marker (leftmost position)
      textContainer.insertBefore(checkbox, marker);
      // Insert link and bibtex buttons before content
      textContainer.insertBefore(bibtexButton, content);
      textContainer.insertBefore(linkButton, bibtexButton);
      content.appendChild(statsButton);
    }

    return row;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ListRenderContext - Context for rendering operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context object passed to render operations.
 * Contains all dependencies needed for rendering without tight coupling.
 */
export interface ListRenderContext {
  /** Document for creating elements */
  doc: Document;
  /** Container element for the list */
  listEl: HTMLElement;
  /** Row pool manager */
  poolManager: RowPoolManager;
  /** Cache of row elements by entry ID */
  rowCache: Map<string, HTMLDivElement>;
  /** Set of selected entry IDs for checkbox state */
  selectedEntryIDs: Set<string>;
  /** Currently focused entry ID */
  focusedEntryID?: string;
  /** View mode for display logic */
  viewMode: string;
}

/**
 * Options for list rendering.
 */
export interface ListRenderOptions {
  /** Whether to preserve scroll position */
  preserveScroll?: boolean;
  /** Whether to reset pagination */
  resetPagination?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Async Container Replacement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace a container element asynchronously to avoid blocking UI (PERF FIX).
 * Returns the new container element.
 */
export function replaceContainerAsync(
  oldContainer: HTMLElement,
  onCleanup?: () => void
): HTMLElement {
  const doc = oldContainer.ownerDocument;
  const newContainer = doc.createElement("div");
  newContainer.className = oldContainer.className;
  if (oldContainer.id) {
    newContainer.id = oldContainer.id;
  }

  // Hide old container immediately (no reflow)
  oldContainer.style.display = "none";

  // Insert new container after old one
  oldContainer.parentNode?.insertBefore(newContainer, oldContainer.nextSibling);

  // Cleanup callback before async removal
  onCleanup?.();

  // Remove old container asynchronously (doesn't block UI)
  setTimeout(() => {
    oldContainer.remove();
  }, 0);

  return newContainer;
}

/**
 * Create a document fragment with rendered rows.
 */
export function createRowsFragment(
  entries: InspireReferenceEntry[],
  context: ListRenderContext,
  updateRowContent: (row: HTMLDivElement, entry: InspireReferenceEntry) => void
): DocumentFragment {
  const fragment = context.doc.createDocumentFragment();

  for (const entry of entries) {
    const row = context.poolManager.getRow(context.doc);
    updateRowContent(row, entry);
    context.rowCache.set(entry.id, row);
    fragment.appendChild(row);
  }

  return fragment;
}
