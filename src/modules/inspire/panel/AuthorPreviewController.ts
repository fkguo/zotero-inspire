// ─────────────────────────────────────────────────────────────────────────────
// AuthorPreviewController - Author preview card state management
// Extracted from InspireReferencePanelController (Phase 0.5 of zinspire.ts refactor)
//
// Responsibilities:
// - Manage author preview card state (timers, current author)
// - Schedule show/hide with delays
// - Fetch author profile data
// - Position and render author preview card
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import {
  type AuthorSearchInfo,
  type InspireAuthorProfile,
  type InspireReferenceEntry,
  fetchAuthorProfile,
  createAbortController,
  isDarkMode,
  copyToClipboard,
  getCachedStrings,
} from "../index";
import { applyMetaLinkStyle } from "../../pickerUI";
import { applyAuthorPreviewCardStyle, positionFloatingElement } from "../../pickerUI";
import { countAuthorPapers } from "../library/authorCount";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callbacks for author preview card interactions.
 */
export interface AuthorPreviewCallbacks {
  /** Called when "View Papers" is clicked */
  onViewPapers?: (authorInfo: AuthorSearchInfo) => Promise<void>;
  onAcademicTree?: (authorInfo: AuthorSearchInfo) => void;
  /** Called when preview is shown */
  onShow?: (authorInfo: AuthorSearchInfo) => void;
  /** Called when preview is hidden */
  onHide?: () => void;
  /** Check if author is favorite */
  isFavorite?: (authorInfo: AuthorSearchInfo) => boolean;
  /** Toggle favorite status */
  toggleFavorite?: (authorInfo: AuthorSearchInfo) => void;
}

/**
 * Options for AuthorPreviewController initialization.
 */
export interface AuthorPreviewControllerOptions {
  /** Document for creating elements */
  document: Document;
  /** Container for preview card */
  container: HTMLElement;
  /** Action callbacks */
  callbacks?: AuthorPreviewCallbacks;
  /** Show delay in ms (default: 300) */
  showDelay?: number;
  /** Hide delay in ms (default: 120) */
  hideDelay?: number;
  /**
   * The author's papers in the library, shown on the card (default:
   * countAuthorPapers by the name as the paper gives it)
   */
  countInLibrary?: (authorInfo: AuthorSearchInfo) => Promise<number>;
}

/**
 * Author searches on arXiv and INSPIRE for a name as a paper gives it: the
 * links of the card's local form.
 */
export function authorSearchUrls(name: string): {
  arxiv: string;
  inspire: string;
} {
  const query = encodeURIComponent(name.trim());
  return {
    arxiv: `https://arxiv.org/search/?searchtype=author&query=${query}`,
    inspire: `https://inspirehep.net/authors?q=${query}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility function for copyable values
// ─────────────────────────────────────────────────────────────────────────────

function attachCopyableValue(
  element: HTMLElement,
  value: string,
  copiedText: string,
): void {
  element.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await copyToClipboard(value);
      element.title = copiedText;
      setTimeout(() => {
        element.title = value;
      }, 1500);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [AuthorPreviewController] Copy failed: ${err}`,
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthorPreviewController Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Controls author preview card lifecycle, state, and interactions.
 *
 * Manages:
 * - Show/hide scheduling with delays
 * - Author profile fetching
 * - Card rendering and positioning
 */
export class AuthorPreviewController {
  private doc: Document;
  private container: HTMLElement;
  private callbacks: AuthorPreviewCallbacks;
  private strings: ReturnType<typeof getCachedStrings>;

  // Timing configuration
  private readonly showDelay: number;
  private readonly hideDelay: number;
  private readonly countInLibrary: (
    authorInfo: AuthorSearchInfo,
  ) => Promise<number>;

  // Preview card element
  private card?: HTMLDivElement;

  // State
  private currentKey?: string;
  /** Counts the cards shown: an answer for an earlier one is not shown */
  private shown = 0;
  private anchor?: Element;

  // Timers
  private showTimeout?: ReturnType<typeof setTimeout>;
  private hideTimeout?: ReturnType<typeof setTimeout>;

  // Profile fetching
  private abortController?: AbortController;

  // PERF-FIX: Store event handlers for cleanup
  private mouseEnterHandler?: () => void;
  private mouseLeaveHandler?: () => void;

  constructor(options: AuthorPreviewControllerOptions) {
    this.doc = options.document;
    this.container = options.container;
    this.callbacks = options.callbacks ?? {};
    this.showDelay = options.showDelay ?? 300;
    this.hideDelay = options.hideDelay ?? 120;
    this.countInLibrary =
      options.countInLibrary ??
      ((authorInfo) => countAuthorPapers(authorInfo.fullName));
    this.strings = getCachedStrings();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API - Scheduling
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Schedule author preview to show after delay.
   */
  scheduleShow(
    entry: InspireReferenceEntry,
    authorIndex: number,
    anchor: HTMLElement,
  ): void {
    const authorInfo = this.buildAuthorInfo(entry, authorIndex);
    if (authorInfo) this.scheduleAuthor(authorInfo, anchor);
  }

  /** The same preview card can be anchored to a graph's SVG author name. */
  scheduleAuthor(
    authorInfo: AuthorSearchInfo,
    anchor: Element,
    loadProfile = fetchAuthorProfile,
  ): void {
    this.cancelShow();
    this.cancelHide();
    this.anchor = anchor;
    this.showTimeout = setTimeout(() => {
      this.showAuthor(authorInfo, anchor, loadProfile);
    }, this.showDelay);
  }

  /**
   * Schedule the card's local form: the author's name, the number of their
   * papers in the library, and author searches on arXiv and INSPIRE that
   * open in the system browser. `identify`, asked when the card shows, may
   * name the author's INSPIRE identity (never found by name); the card then
   * becomes the INSPIRE card, else it stays local.
   */
  scheduleLocalAuthor(
    authorInfo: AuthorSearchInfo,
    anchor: Element,
    identify?: () => Promise<AuthorSearchInfo | null>,
  ): void {
    this.cancelShow();
    this.cancelHide();
    this.anchor = anchor;
    this.showTimeout = setTimeout(() => {
      this.showLocalAuthor(authorInfo, anchor, identify);
    }, this.showDelay);
  }

  /**
   * Schedule author preview to hide after delay.
   */
  scheduleHide(): void {
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

    // Cancel pending fetch
    this.abortController?.abort();
    this.abortController = undefined;

    // Clear state
    this.currentKey = undefined;
    this.anchor = undefined;

    if (this.card) {
      this.card.style.display = "none";
      this.card.replaceChildren();
    }

    this.callbacks.onHide?.();
  }

  /**
   * Check if preview is currently visible.
   */
  isVisible(): boolean {
    return this.card?.style.display !== "none" && !!this.currentKey;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internal - Show Logic
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Show author preview for an author in an entry.
   */
  private showAuthor(
    authorInfo: AuthorSearchInfo,
    anchor: Element,
    loadProfile = fetchAuthorProfile,
  ): void {
    const key = this.getAuthorKey(authorInfo);
    const card = this.getCard();
    this.currentKey = key;

    // Render initial state (loading); the profile and the library count are
    // added as they arrive
    let profile: InspireAuthorProfile | null | undefined;
    let libraryCount: number | undefined;
    const render = () => {
      this.renderCard(card, authorInfo, profile, libraryCount);
      this.positionCard(card, anchor);
    };
    render();

    this.callbacks.onShow?.(authorInfo);

    this.countFor(authorInfo, key, (count) => {
      libraryCount = count;
      render();
    });

    // Fetch profile
    this.abortController?.abort();
    this.abortController = createAbortController();
    const signal = this.abortController?.signal;

    loadProfile(authorInfo, signal)
      .then((loaded) => {
        if (this.currentKey !== key) {
          return;
        }
        profile = loaded;
        render();
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") {
          return;
        }
        if (this.currentKey === key) {
          profile = null;
          this.renderCard(card, authorInfo, profile, libraryCount);
        }
      });
  }

  /**
   * Show the local form of the card; the count is added once it is known,
   * and the INSPIRE card replaces it once `identify` names the author.
   */
  private showLocalAuthor(
    authorInfo: AuthorSearchInfo,
    anchor: Element,
    identify?: () => Promise<AuthorSearchInfo | null>,
  ): void {
    const key = `local:${this.getAuthorKey(authorInfo)}`;
    const card = this.getCard();
    this.currentKey = key;
    // The same name may be hovered again, on another paper, before the first
    // identity arrives
    const shown = ++this.shown;

    this.renderLocalCard(card, authorInfo);
    this.positionCard(card, anchor);

    this.callbacks.onShow?.(authorInfo);

    this.countFor(authorInfo, key, (count) => {
      this.renderLocalCard(card, authorInfo, count);
      this.positionCard(card, anchor);
    });

    identify?.().then(
      (identified) => {
        if (identified && this.currentKey === key && this.shown === shown) {
          this.showAuthor(identified, anchor);
        }
      },
      (err) => {
        // The card stays local
        Zotero.debug(
          `[${config.addonName}] [AuthorPreviewController] Author identity failed: ${err}`,
        );
      },
    );
  }

  /** Count the author's papers in the library; `show` it while the card is `key`'s */
  private countFor(
    authorInfo: AuthorSearchInfo,
    key: string,
    show: (count: number) => void,
  ): void {
    this.countInLibrary(authorInfo).then(
      (count) => {
        if (this.currentKey === key) show(count);
      },
      (err) => {
        // The card stays without a count
        Zotero.debug(
          `[${config.addonName}] [AuthorPreviewController] Library count failed: ${err}`,
        );
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internal - Card Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get or create the preview card element.
   */
  private getCard(): HTMLDivElement {
    if (!this.card) {
      this.card = this.doc.createElement("div");
      this.card.classList.add("zinspire-author-preview-card");
      applyAuthorPreviewCardStyle(this.card);
      this.card.style.display = "none";

      // PERF-FIX: Store handlers for cleanup
      this.mouseEnterHandler = () => {
        this.cancelHide();
      };
      this.mouseLeaveHandler = () => {
        this.scheduleHide();
      };

      this.card.addEventListener("mouseenter", this.mouseEnterHandler);
      this.card.addEventListener("mouseleave", this.mouseLeaveHandler);

      this.container.appendChild(this.card);
    }
    return this.card;
  }

  /**
   * Build author info from entry and index.
   */
  private buildAuthorInfo(
    entry: InspireReferenceEntry,
    authorIndex: number,
  ): AuthorSearchInfo | null {
    const fullName = entry.authors[authorIndex];
    if (!fullName) {
      return null;
    }
    const searchInfo = entry.authorSearchInfos?.[authorIndex];
    return {
      fullName,
      bai: searchInfo?.bai,
      recid: searchInfo?.recid,
    };
  }

  /**
   * Get a unique key for an author.
   */
  private getAuthorKey(authorInfo: AuthorSearchInfo): string {
    if (authorInfo.recid) {
      return `recid:${authorInfo.recid}`;
    }
    if (authorInfo.bai) {
      return `bai:${authorInfo.bai}`;
    }
    return `name:${authorInfo.fullName}`;
  }

  /**
   * Render the author preview card content.
   */
  private renderCard(
    card: HTMLDivElement,
    authorInfo: AuthorSearchInfo,
    profile: InspireAuthorProfile | null | undefined,
    libraryCount?: number,
  ): void {
    const doc = card.ownerDocument;
    card.replaceChildren();
    const copiedText = getString("references-panel-author-copied");
    const dark = isDarkMode(doc);

    // Title with name and BAI
    const title = doc.createElement("div");
    title.style.fontWeight = "600";
    title.style.marginBottom = "4px";
    const displayName = profile?.name || authorInfo.fullName;
    const bai = profile?.bai || authorInfo.bai;
    if (bai) {
      title.textContent = `${displayName} (${bai})`;
    } else {
      title.textContent = displayName;
    }
    card.appendChild(title);

    // Loading/error states
    if (profile === null) {
      const empty = doc.createElement("div");
      empty.style.color = "var(--fill-secondary, #64748b)";
      empty.textContent = getString("references-panel-author-profile-unavailable");
      card.appendChild(empty);
    } else if (!profile) {
      const loading = doc.createElement("div");
      loading.style.color = "var(--fill-secondary, #64748b)";
      loading.textContent = getString("references-panel-author-profile-loading");
      card.appendChild(loading);
    }

    // Institution
    if (profile?.currentPosition?.institution) {
      const inst = doc.createElement("div");
      inst.style.color = "var(--fill-secondary, #64748b)";
      inst.textContent = profile.currentPosition.institution;
      card.appendChild(inst);
    }

    // arXiv categories
    if (profile?.arxivCategories?.length) {
      const cats = doc.createElement("div");
      cats.style.color = "var(--fill-secondary, #64748b)";
      cats.textContent = `🔬 ${profile.arxivCategories.join(", ")}`;
      card.appendChild(cats);
    }

    // Advisors
    if (profile?.advisors?.length) {
      const advisorNames = profile.advisors
        .map((advisor) => advisor.name)
        .filter(Boolean)
        .slice(0, 2)
        .join(", ");
      if (advisorNames) {
        const advisors = doc.createElement("div");
        advisors.style.color = "var(--fill-secondary, #64748b)";
        advisors.textContent = `${getString("references-panel-author-advisors")}: ${advisorNames}`;
        card.appendChild(advisors);
      }
    }

    if (libraryCount !== undefined) {
      card.appendChild(this.libraryCountLine(doc, libraryCount));
    }

    // Action links
    const actions = doc.createElement("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    actions.style.marginTop = "6px";

    // Email link
    if (profile?.emails?.length) {
      const email = profile.emails[0];
      const emailLink = doc.createElement("a");
      applyMetaLinkStyle(emailLink, dark);
      emailLink.href = `mailto:${encodeURIComponent(email)}`;
      emailLink.textContent = `📧 Email`;
      emailLink.title = email;
      emailLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(emailLink.href);
      });
      attachCopyableValue(emailLink, email, copiedText);
      actions.appendChild(emailLink);
    }

    // ORCID link
    if (profile?.orcid) {
      const orcid = profile.orcid;
      const orcidLink = doc.createElement("a");
      applyMetaLinkStyle(orcidLink, dark);
      orcidLink.href = `https://orcid.org/${encodeURIComponent(orcid)}`;
      orcidLink.textContent = "ORCID";
      orcidLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(orcidLink.href);
      });
      attachCopyableValue(orcidLink, orcid, copiedText);
      actions.appendChild(orcidLink);
    }

    // INSPIRE link
    if (profile?.recid) {
      const inspireLink = doc.createElement("a");
      applyMetaLinkStyle(inspireLink, dark);
      inspireLink.href = `https://inspirehep.net/authors/${encodeURIComponent(profile.recid)}`;
      inspireLink.textContent = "INSPIRE";
      inspireLink.title = getString("references-panel-author-inspire-tooltip");
      inspireLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(inspireLink.href);
      });
      actions.appendChild(inspireLink);
    }

    // Homepage link
    if (profile?.homepageUrl) {
      const homepageLink = doc.createElement("a");
      applyMetaLinkStyle(homepageLink, dark);
      homepageLink.href = profile.homepageUrl;
      homepageLink.title = getString("references-panel-author-homepage-tooltip");
      homepageLink.textContent = "Home";
      homepageLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(homepageLink.href);
      });
      actions.appendChild(homepageLink);
    }

    // The author's papers on arXiv, searched by the name as the paper gives it
    if (authorInfo.fullName.trim()) {
      actions.appendChild(this.arxivSearchLink(doc, authorInfo, dark));
    }

    // View Papers link
    if (this.callbacks.onViewPapers) {
      const viewLink = doc.createElement("a");
      applyMetaLinkStyle(viewLink, dark);
      viewLink.href = "#";
      viewLink.textContent = getString("references-panel-author-preview-view-papers");
      viewLink.addEventListener("click", (event) => {
        event.preventDefault();
        this.hide();
        this.callbacks.onViewPapers?.(authorInfo);
      });
      actions.appendChild(viewLink);
    }

    if (this.callbacks.onAcademicTree) {
      const treeLink = doc.createElement("a");
      applyMetaLinkStyle(treeLink, dark);
      treeLink.href = "#";
      treeLink.textContent = getString("academic-tree-title");
      treeLink.addEventListener("click", event => {
        event.preventDefault();
        this.hide();
        this.callbacks.onAcademicTree?.(authorInfo);
      });
      actions.appendChild(treeLink);
    }

    // Favorite button
    if (this.callbacks.isFavorite && this.callbacks.toggleFavorite) {
      const isFav = this.callbacks.isFavorite(authorInfo);
      const favBtn = doc.createElement("button");
      favBtn.type = "button";
      favBtn.textContent = isFav ? "★" : "☆";
      favBtn.title = getString(
        isFav
          ? "references-panel-favorite-remove"
          : "references-panel-favorite-add",
      );
      favBtn.style.cssText = `
        border: none;
        background: transparent;
        font-size: 14px;
        cursor: pointer;
        color: ${isFav ? "#f59e0b" : "var(--fill-tertiary, #94a3b8)"};
        padding: 0 2px;
        margin-left: auto;
      `;
      favBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.toggleFavorite?.(authorInfo);
        // Re-render to update button state
        this.renderCard(card, authorInfo, profile, libraryCount);
      });
      actions.appendChild(favBtn);
    }

    if (actions.children.length) {
      card.appendChild(actions);
    }

    card.style.display = "block";
  }

  /**
   * Render the card's local form: name, papers in the library (once
   * counted), and author searches on arXiv and INSPIRE.
   */
  private renderLocalCard(
    card: HTMLDivElement,
    authorInfo: AuthorSearchInfo,
    libraryCount?: number,
  ): void {
    const doc = card.ownerDocument;
    card.replaceChildren();
    const dark = isDarkMode(doc);

    const title = doc.createElement("div");
    title.style.fontWeight = "600";
    title.style.marginBottom = "4px";
    title.textContent = authorInfo.fullName;
    card.appendChild(title);

    if (libraryCount !== undefined) {
      card.appendChild(this.libraryCountLine(doc, libraryCount));
    }

    const actions = doc.createElement("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    actions.style.marginTop = "6px";
    actions.append(
      this.arxivSearchLink(doc, authorInfo, dark),
      this.searchLink(
        doc,
        "INSPIRE",
        authorSearchUrls(authorInfo.fullName).inspire,
        getString("references-panel-author-search-inspire"),
        dark,
      ),
    );
    card.appendChild(actions);

    card.style.display = "block";
  }

  /** "N papers in your library" */
  private libraryCountLine(doc: Document, libraryCount: number): HTMLElement {
    const count = doc.createElement("div");
    count.style.color = "var(--fill-secondary, #64748b)";
    count.textContent = getString("references-panel-author-library-count", {
      args: { count: libraryCount },
    });
    return count;
  }

  /** The author search on arXiv by the name as the paper gives it */
  private arxivSearchLink(
    doc: Document,
    authorInfo: AuthorSearchInfo,
    dark: boolean,
  ): HTMLAnchorElement {
    return this.searchLink(
      doc,
      "arXiv",
      authorSearchUrls(authorInfo.fullName).arxiv,
      getString("references-panel-author-search-arxiv"),
      dark,
    );
  }

  /** A link that opens in the system browser */
  private searchLink(
    doc: Document,
    label: string,
    url: string,
    tooltip: string,
    dark: boolean,
  ): HTMLAnchorElement {
    const link = doc.createElement("a");
    applyMetaLinkStyle(link, dark);
    link.href = url;
    link.textContent = label;
    link.title = tooltip;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      Zotero.launchURL(url);
    });
    return link;
  }

  /**
   * Position the card relative to anchor.
   */
  private positionCard(card: HTMLDivElement, anchor: Element): void {
    positionFloatingElement(card, anchor, {
      spacing: 8,
      edgeMargin: 8,
      fallbackWidth: 220,
      fallbackHeight: 120,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Refresh cached localized strings (call when locale changes).
   */
  refreshStrings(): void {
    this.strings = getCachedStrings();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.hide();

    // PERF-FIX: Remove event listeners before removing card
    if (this.card) {
      if (this.mouseEnterHandler) {
        this.card.removeEventListener("mouseenter", this.mouseEnterHandler);
        this.mouseEnterHandler = undefined;
      }
      if (this.mouseLeaveHandler) {
        this.card.removeEventListener("mouseleave", this.mouseLeaveHandler);
        this.mouseLeaveHandler = undefined;
      }
      this.card.remove();
      this.card = undefined;
    }
  }
}
