import { config } from "../../package.json";
import { cleanMathTitle } from "../utils/mathTitle";
import { getJournalAbbreviations } from "../utils/journalAbbreviations";
import { getLocaleID, getString } from "../utils/locale";
import type { FluentMessageId } from "../../typings/i10n";
import { getPref, setPref } from "../utils/prefs";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import {
  showTargetPickerUI,
  showAmbiguousCitationPicker,
  SaveTargetRow,
  SaveTargetSelection,
  applyRefEntryTextContainerStyle,
  applyRefEntryMarkerStyle,
  applyRefEntryMarkerColor,
  applyRefEntryLinkButtonStyle,
  applyRefEntryContentStyle,
  applyAuthorLinkStyle,
  applyMetaLinkStyle,
  applyTabButtonStyle,
  applyAbstractTooltipStyle,
  applyBibTeXButtonStyle,
  applyAuthorProfileCardStyle,
  applyAuthorPreviewCardStyle,
  attachCopyableValue,
  // FTR-HOVER-PREVIEW: Preview card styles
  applyPreviewCardStyle,
  applyPreviewCardTitleStyle,
  applyPreviewCardSectionStyle,
  applyPreviewCardIdentifiersStyle,
  // FTR-CONSISTENT-UI: Unified button styling
  applyPillButtonStyle,
  applyPreviewCardAbstractStyle,
} from "./pickerUI";

// ─────────────────────────────────────────────────────────────────────────────
// Import from inspire/ submodules (avoid code duplication)
// ─────────────────────────────────────────────────────────────────────────────
import {
  // Constants
  INSPIRE_API_BASE,
  INSPIRE_LITERATURE_URL,
  ARXIV_ABS_URL,
  DOI_ORG_URL,
  CROSSREF_API_URL,
  CITED_BY_PAGE_SIZE,
  CITED_BY_MAX_PAGES,
  CITED_BY_MAX_RESULTS,
  CITED_BY_PARALLEL_BATCH_SIZE,
  RENDER_PAGE_SIZE,
  NAVIGATION_STACK_LIMIT,
  LARGE_COLLABORATION_THRESHOLD,
  REFERENCE_SORT_OPTIONS,
  INSPIRE_SORT_OPTIONS,
  DEFAULT_REFERENCE_SORT,
  DEFAULT_CITED_BY_SORT,
  isReferenceSortOption,
  isInspireSortOption,
  SEARCH_HISTORY_MAX_ENTRIES,
  SEARCH_HISTORY_PREF_KEY,
  SEARCH_HISTORY_DAYS_PREF_KEY,
  SEARCH_HISTORY_DAYS_DEFAULT,
  FILTER_HISTORY_PREF_KEY,
  FILTER_HISTORY_MAX_ENTRIES,
  AUTHOR_IDS_EXTRACT_LIMIT,
  // New constants for magic number replacement
  FILTER_DEBOUNCE_MS,
  CHART_THROTTLE_MS,
  TOOLTIP_SHOW_DELAY_MS,
  TOOLTIP_HIDE_DELAY_MS,
  SCROLL_HIGHLIGHT_DELAY_MS,
  PROGRESS_CLOSE_DELAY_MS,
  PROGRESS_CLOSE_DELAY_WARN_MS,
  RAF_FALLBACK_MS,
  REFERENCES_CACHE_SIZE,
  CITED_BY_CACHE_SIZE,
  ENTRY_CITED_CACHE_SIZE,
  METADATA_CACHE_SIZE,
  SEARCH_CACHE_SIZE,
  ROW_POOL_MAX_SIZE,
  CHART_MAX_BAR_WIDTH,
  RENDER_PAGE_SIZE_FILTERED,
  METADATA_BATCH_SIZE,
  LOCAL_STATUS_BATCH_SIZE,
  HIGH_CITATIONS_THRESHOLD,
  SMALL_AUTHOR_GROUP_THRESHOLD,
  AUTHOR_NAME_MAX_LENGTH,
  CLIPBOARD_WARN_SIZE_BYTES,
  CITATION_RANGES,
  // Quick Filter constants
  QUICK_FILTER_TYPES,
  QUICK_FILTER_PREF_KEY,
  QUICK_FILTER_CONFIGS,
  isQuickFilterType,
  type QuickFilterType,
  // API Field Selection (FTR-API-FIELD-OPTIMIZATION)
  API_FIELDS_LIST_DISPLAY,
  buildFieldsParam,
  // Types
  type ReferenceSortOption,
  type InspireSortOption,
  type InspireViewMode,
  type AuthorSearchInfo,
  type InspireAuthorProfile,
  type AuthorStats,
  type InspireReferenceEntry,
  type InspireArxivDetails,
  type ScrollSnapshot,
  type ScrollState,
  type NavigationSnapshot,
  type EntryCitedSource,
  type ChartBin,
  type SearchHistoryItem,
  type jsobject,
  // Text utilities
  normalizeSearchText,
  buildVariantSet,
  buildSearchIndexText,
  buildFilterTokenVariants,
  parseFilterTokens,
  ensureSearchText,
  // Classes and utilities
  LRUCache,
  ZInsUtils,
  ZInsMenu,
  ReaderTabHelper,
  clearAllHistoryPrefs,
  // AbortController utilities (FTR-ABORT-CONTROLLER-FIX)
  createAbortController,
  // Rate limiter
  inspireFetch,
  getRateLimiterStatus,
  onRateLimiterStatusChange,
  type RateLimiterStatus,
  // Formatters
  getCachedStrings,
  formatAuthors,
  formatAuthorName,
  buildInitials,
  buildDisplayText,
  extractJournalName,
  buildEntrySearchText,
  splitPublicationInfo,
  getPublicationNoteLabel,
  formatPublicationInfo,
  buildPublicationSummary,
  normalizeArxivID,
  normalizeArxivCategories,
  formatArxivDetails,
  formatArxivTag,
  convertFullNameToSearchQuery,
  // API utilities
  deriveRecidFromItem,
  extractRecidFromRecordRef,
  extractRecidFromUrls,
  extractRecidFromUrl,
  buildReferenceUrl,
  buildFallbackUrl,
  buildFallbackUrlFromMetadata,
  extractArxivFromReference,
  extractArxivFromMetadata,
  findItemByRecid,
  copyToClipboard,
  // Batch query functions (FTR-BATCH-IMPORT)
  findItemsByRecids,
  findItemsByArxivs,
  findItemsByDOIs,
  // Author utilities
  extractAuthorNamesFromReference,
  extractAuthorNamesLimited,
  isValidBAI,
  extractAuthorSearchInfos,
  // Metadata service
  getInspireMeta,
  fetchRecidFromInspire,
  fetchInspireMetaByRecid,
  fetchInspireAbstract,
  fetchBibTeX,
  fetchInspireTexkey,
  fetchAuthorProfile,
  buildMetaFromMetadata,
  getCrossrefCount,
  // Item updater
  ZInspire,
  setInspireMeta,
  setCrossRefCitations,
  saveItemWithPendingInspireNote,
  // Local cache
  fetchReferencesEntries,
  enrichReferencesEntries,
  localCache,
  // Cache types
  type CacheSource,
  type LocalCacheType,
  // PDF Annotate (FTR-PDF-ANNOTATE)
  LabelMatcher,
  getReaderIntegration,
  type CitationLookupEvent,
  type CitationPreviewEvent,
  type ParsedCitation,
  type MatchResult,
  // Style utilities
  CHART_STYLES,
  toStyleString,
  isDarkMode,
  getChartNoDataStyle,
  getChartNoDataItalicStyle,
  // Smart Update (FTR-SMART-UPDATE)
  isSmartUpdateEnabled,
  isAutoCheckEnabled,
  compareItemWithInspire,
  getFieldProtectionConfig,
  filterProtectedChanges,
  showSmartUpdatePreviewDialog,
  showUpdateNotification,
  type SmartUpdateDiff,
  type FieldChange,
} from "./inspire";

// Re-export for external use
export { ZInsUtils, ZInsMenu, ZInspire };

// ─────────────────────────────────────────────────────────────────────────────
// InlineHintHelper: Reusable inline hint for input autocomplete
// ─────────────────────────────────────────────────────────────────────────────

/** Shared input styles for inline hint inputs (Filter & Search) */
const INLINE_HINT_INPUT_STYLE = `
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--zotero-gray-4, #d1d1d5);
  border-radius: 4px;
  font-size: 12px;
  background-color: transparent !important;
  background: transparent !important;
  -moz-appearance: none !important;
  appearance: none !important;
  position: relative;
  z-index: 2;
  font-family: system-ui, -apple-system, sans-serif;
`;

/** Shared wrapper styles for inline hint containers */
const INLINE_HINT_WRAPPER_STYLE = `
  position: relative;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  background: var(--material-background, #ffffff);
  border-radius: 4px;
`;

/** Configure input element for inline hint usage (disable browser autocomplete) */
function configureInlineHintInput(input: HTMLInputElement): void {
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");
}

interface InlineHintConfig {
  input: HTMLInputElement;
  wrapper: HTMLElement;
  history: SearchHistoryItem[];
}

/**
 * Helper class for managing inline hint (autocomplete suggestion) in input fields.
 * Used by both Filter input and Search input for consistent behavior.
 */
class InlineHintHelper {
  private input: HTMLInputElement;
  private wrapper: HTMLElement;
  private hintEl: HTMLSpanElement;
  private getHistory: () => SearchHistoryItem[];
  private _currentHintText = "";

  get currentHintText(): string {
    return this._currentHintText;
  }

  constructor(
    config: InlineHintConfig & { getHistory?: () => SearchHistoryItem[] },
  ) {
    this.input = config.input;
    this.wrapper = config.wrapper;
    this.getHistory = config.getHistory || (() => config.history);

    // Create hint element using native DOM with cssText (required for Zotero)
    const doc = this.wrapper.ownerDocument;
    this.hintEl = doc.createElement("span");
    this.hintEl.className = "zinspire-inline-hint";
    this.hintEl.style.cssText = `
      position: absolute;
      left: 9px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--fill-secondary, #888);
      font-size: 12px;
      pointer-events: none;
      white-space: pre;
      overflow: hidden;
      z-index: 3;
      display: none;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1;
    `;
    this.wrapper.appendChild(this.hintEl);
  }

  /** Update hint based on current input value */
  update(): void {
    const inputValue = this.input.value;
    const history = this.getHistory();

    // Always hide first, then show only if there's a match
    this.hintEl.textContent = "";
    this.hintEl.hidden = true;
    this.hintEl.style.display = "none";

    // No input or no history: stay hidden
    if (!inputValue || history.length === 0) {
      this._currentHintText = "";
      return;
    }

    // Find matching history entry
    const lowerValue = inputValue.toLowerCase();
    let matchingHint = "";
    for (const item of history) {
      // Defensive check: skip items with invalid query
      if (!item.query || typeof item.query !== "string") {
        continue;
      }
      if (
        item.query.toLowerCase().startsWith(lowerValue) &&
        item.query.length > inputValue.length
      ) {
        matchingHint = item.query;
        break;
      }
    }

    // No match found: stay hidden
    if (!matchingHint) {
      this._currentHintText = "";
      return;
    }

    // Show hint: display only the remaining suggestion after what user typed
    const hintSuffix = matchingHint
      .slice(inputValue.length)
      .replace(/ /g, "\u00A0");
    this._currentHintText = matchingHint;

    // Calculate position based on input text width
    const doc = this.wrapper.ownerDocument;
    const computedStyle = doc.defaultView?.getComputedStyle(this.input);

    if (computedStyle) {
      // Use a hidden span for accurate text width measurement
      const measureSpan = doc.createElement("span");
      measureSpan.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: pre;
        font: ${computedStyle.font};
        font-size: ${computedStyle.fontSize};
        font-family: ${computedStyle.fontFamily};
        font-weight: ${computedStyle.fontWeight};
        font-style: ${computedStyle.fontStyle};
        font-variant: ${computedStyle.fontVariant};
        font-stretch: ${computedStyle.fontStretch};
        letter-spacing: ${computedStyle.letterSpacing};
        word-spacing: ${computedStyle.wordSpacing};
        text-transform: ${computedStyle.textTransform};
        text-rendering: ${computedStyle.textRendering};
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      `;
      measureSpan.textContent = inputValue.replace(/ /g, "\u00A0");
      this.wrapper.appendChild(measureSpan);
      const textWidth = measureSpan.offsetWidth;
      this.wrapper.removeChild(measureSpan);

      // Get spacing
      const paddingLeft = parseFloat(computedStyle.paddingLeft) || 8;
      const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
      const paddingTop = parseFloat(computedStyle.paddingTop) || 4;
      const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;

      // Calculate position relative to wrapper
      const inputRect = this.input.getBoundingClientRect();
      const wrapperRect = this.wrapper.getBoundingClientRect();
      const inputLeftOffset = inputRect.left - wrapperRect.left;
      const inputTopOffset = inputRect.top - wrapperRect.top;

      const finalLeft = inputLeftOffset + borderLeft + paddingLeft + textWidth;
      const finalTop = inputTopOffset + borderTop + paddingTop;

      // Update hint element - show it
      this.hintEl.textContent = hintSuffix;
      this.hintEl.style.left = `${finalLeft}px`;
      this.hintEl.style.top = `${finalTop}px`;
      this.hintEl.style.transform = "none";
      this.hintEl.hidden = false;
      this.hintEl.style.display = "block";

      // Match font style of input
      this.hintEl.style.font = computedStyle.font;
      this.hintEl.style.fontSize = computedStyle.fontSize;
      this.hintEl.style.fontFamily = computedStyle.fontFamily;
      this.hintEl.style.lineHeight = computedStyle.lineHeight;
      this.hintEl.style.letterSpacing = computedStyle.letterSpacing;
    } else {
      // Fallback: approximate character width
      const textWidth = inputValue.length * 7;
      this.hintEl.textContent = hintSuffix;
      this.hintEl.style.left = `${9 + textWidth}px`;
      this.hintEl.hidden = false;
      this.hintEl.style.display = "block";
    }
  }

  /** Hide hint and clear current hint text */
  hide(): void {
    this.hintEl.textContent = "";
    this.hintEl.hidden = true;
    this.hintEl.style.display = "none";
    this._currentHintText = "";
  }

  /** Accept current hint (for Tab/ArrowRight completion) */
  accept(): boolean {
    if (this._currentHintText) {
      this.input.value = this._currentHintText;
      this.hide();
      return true;
    }
    return false;
  }

  /** Get the hint element (for adding custom classes) */
  getElement(): HTMLSpanElement {
    return this.hintEl;
  }

  /** Destroy and remove hint element */
  destroy(): void {
    this.hintEl.remove();
  }
}

export class ZInspireReferencePane {
  private static controllers = new WeakMap<
    HTMLDivElement,
    InspireReferencePanelController
  >();
  private static registrationKey?: string | false;

  static registerPanel() {
    if (!("ItemPaneManager" in Zotero)) {
      Zotero.debug(
        `[${config.addonName}] ItemPaneManager not available, skip references pane.`,
      );
      return;
    }
    if (this.registrationKey) {
      return;
    }
    const headerIcon = `chrome://${config.addonRef}/content/icons/inspire-header.svg`;
    const sidenavIcon = `chrome://${config.addonRef}/content/icons/inspire-sidenav.svg`;

    this.registrationKey = Zotero.ItemPaneManager.registerSection({
      paneID: "zoteroinspire-references",
      pluginID: config.addonID,
      header: {
        l10nID: "pane-item-references-header",
        icon: headerIcon,
        darkIcon: headerIcon,
      },
      sidenav: {
        l10nID: "pane-item-references-sidenav",
        icon: sidenavIcon,
        darkIcon: sidenavIcon,
      },
      onInit: (args) => {
        try {
          args.setEnabled(true);
        } catch (err) {
          Zotero.debug(
            `[${config.addonName}] Failed to enable INSPIRE pane: ${err}`,
          );
        }
        const controller = new InspireReferencePanelController(args.body);
        this.controllers.set(args.body, controller);
      },
      onRender: () => {
        // Required by Zotero 7 ItemPaneSection API even if we render manually
      },
      onDestroy: (args) => {
        const controller = this.controllers.get(args.body);
        controller?.destroy();
        this.controllers.delete(args.body);
      },
      onItemChange: (args) => {
        const controller = this.controllers.get(args.body);
        controller?.handleItemChange(args);
      },
      sectionButtons: [
        {
          type: "refresh",
          icon: "chrome://zotero/skin/16/universal/refresh.svg",
          l10nID: "zoteroinspire-refresh-button",
          onClick: ({ body }: { body: HTMLDivElement }) => {
            try {
              const controller = this.controllers.get(body);
              controller?.handleRefresh();
            } catch (e) {
              Zotero.debug(`[${config.addonName}] Refresh button error: ${e}`);
            }
          },
        },
        {
          type: "custom",
          icon: `chrome://${config.addonRef}/content/icons/clipboard.svg`,
          l10nID: "zoteroinspire-copy-all-button",
          onClick: ({
            body,
            event,
          }: {
            body: HTMLDivElement;
            event: Event;
          }) => {
            try {
              const controller = this.controllers.get(body);
              controller?.showExportMenu(event);
            } catch (e) {
              Zotero.debug(`[${config.addonName}] Export button error: ${e}`);
            }
          },
        },
      ],
    });

    // Register search bar listener for inspire: prefix
    this.registerSearchBarListener();
  }

  static unregisterPanel() {
    if (typeof this.registrationKey === "string") {
      Zotero.ItemPaneManager.unregisterSection(this.registrationKey);
      this.registrationKey = undefined;
    }
    this.unregisterSearchBarListener();
  }

  /**
   * Clear all history (both search and filter) from preferences and active instances.
   * Called from preferences panel.
   */
  static clearAllHistory() {
    clearAllHistoryPrefs();
    // Also clear history in all active controller instances
    for (const controller of InspireReferencePanelController.getInstances()) {
      controller.clearAllHistoryInInstance();
    }
  }

  // Search bar listener for `inspire:` prefix detection
  private static searchBarListener?: (event: Event) => void;
  private static searchBarElement?: HTMLInputElement;

  /**
   * Register a listener on Zotero's main search bar to detect `inspire:` prefix.
   * This enables searching INSPIRE directly from the main search bar.
   */
  static registerSearchBarListener() {
    const mainWindow = Zotero.getMainWindow?.();
    if (!mainWindow) return;

    // Try to find the main search bar
    const searchBar = mainWindow.document.getElementById(
      "zotero-tb-search-textbox",
    ) as HTMLInputElement | null;
    if (!searchBar) {
      return;
    }

    this.searchBarElement = searchBar;

    // Disable native browser autocomplete and Zotero's history dropdown
    // Try multiple attributes to ensure history dropdown is disabled
    searchBar.setAttribute("autocomplete", "off");
    searchBar.setAttribute("disableautocomplete", "true");
    searchBar.setAttribute("enablehistory", "false");
    searchBar.setAttribute("disablehistory", "true");
    // Remove autocompletesearch attribute if present
    searchBar.removeAttribute("autocompletesearch");

    // Also try to disable on the parent quicksearch component
    const quickSearchComponent =
      mainWindow.document.getElementById("zotero-tb-search");
    if (quickSearchComponent) {
      quickSearchComponent.setAttribute("disableautocomplete", "true");
      quickSearchComponent.setAttribute("enablehistory", "false");
      // Try to access and clear any history property
      if ((quickSearchComponent as any).disableAutoComplete) {
        (quickSearchComponent as any).disableAutoComplete = true;
      }
      if ((quickSearchComponent as any).enableHistory !== undefined) {
        (quickSearchComponent as any).enableHistory = false;
      }
    }
    // Store original attributes for cleanup
    (this as any)._searchBarOriginalAutocomplete =
      searchBar.getAttribute("autocomplete");

    // Create inline hint overlay for showing search history suggestions
    // The hint appears as gray text after user's input, completed with Tab/→
    let hintOverlay: HTMLSpanElement | null = null;
    let currentHint = "";

    const createHintOverlay = () => {
      if (hintOverlay) return;

      // Create a container for positioning
      const searchBarParent = searchBar.parentElement;
      if (!searchBarParent) return;

      // Make parent position relative if not already
      const parentStyle = mainWindow.getComputedStyle(searchBarParent);
      if (parentStyle && parentStyle.position === "static") {
        searchBarParent.style.position = "relative";
      }

      hintOverlay = mainWindow.document.createElement("span");
      hintOverlay.className = "zinspire-search-hint";
      hintOverlay.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        pointer-events: none;
        color: #999;
        font-family: inherit;
        font-size: inherit;
        white-space: pre;
        overflow: hidden;
        opacity: 0.6;
        z-index: 1;
        display: none;
      `;

      // Insert hint overlay after search bar
      searchBar.insertAdjacentElement("afterend", hintOverlay);
      (this as any)._searchBarHintOverlay = hintOverlay;
    };

    const updateHintOverlay = (userInput: string) => {
      if (!hintOverlay) createHintOverlay();
      if (!hintOverlay) return;

      // Only show hint when user has typed "inspire:" prefix
      if (!userInput.toLowerCase().startsWith("inspire:")) {
        hintOverlay.style.display = "none";
        currentHint = "";
        return;
      }

      // Get search history from preferences
      const historyJson = Zotero.Prefs.get(
        `${config.prefsPrefix}.${SEARCH_HISTORY_PREF_KEY}`,
        true,
      ) as string | undefined;
      let history: string[] = [];
      try {
        if (historyJson) {
          history = JSON.parse(historyJson);
        }
      } catch {
        history = [];
      }

      if (history.length === 0) {
        hintOverlay.style.display = "none";
        currentHint = "";
        return;
      }

      // Get the query part after "inspire:"
      const queryPart = userInput.slice(8); // After "inspire:"

      // Find a matching history item that starts with user's query
      let matchingHint = "";
      for (const historyQuery of history) {
        if (
          historyQuery.toLowerCase().startsWith(queryPart.toLowerCase()) &&
          historyQuery.length > queryPart.length
        ) {
          matchingHint = historyQuery;
          break;
        }
      }

      if (!matchingHint) {
        // If no prefix match, show the most recent search as suggestion (only if user just typed "inspire:")
        if (queryPart.length === 0 || queryPart.trim() === "") {
          matchingHint = history[0];
        } else {
          hintOverlay.style.display = "none";
          currentHint = "";
          return;
        }
      }

      // Calculate the hint text (the part user hasn't typed yet)
      const hintSuffixRaw = matchingHint.slice(queryPart.length);
      const hintSuffix = hintSuffixRaw.replace(/ /g, "\u00A0");
      currentHint = matchingHint;

      // Position hint overlay to appear after user's text
      // We need to calculate text width to position correctly
      const inputStyle = mainWindow.getComputedStyle(searchBar);
      if (!inputStyle) {
        hintOverlay.style.display = "none";
        return;
      }
      const paddingLeft = parseFloat(inputStyle.paddingLeft) || 0;

      // Create a temporary span to measure text width
      const measureSpan = mainWindow.document.createElement("span");
      measureSpan.style.cssText = `
        position: absolute;
        visibility: hidden;
        font-family: ${inputStyle.fontFamily || "inherit"};
        font-size: ${inputStyle.fontSize || "inherit"};
        font-weight: ${inputStyle.fontWeight || "normal"};
        letter-spacing: ${inputStyle.letterSpacing || "normal"};
        white-space: pre;
      `;
      measureSpan.textContent = userInput.replace(/ /g, "\u00A0");
      mainWindow.document.body.appendChild(measureSpan);
      const textWidth = measureSpan.offsetWidth;
      mainWindow.document.body.removeChild(measureSpan);

      // Update hint overlay
      hintOverlay.textContent = hintSuffix;
      hintOverlay.style.left = `${paddingLeft + textWidth}px`;
      hintOverlay.style.top = `${parseFloat(inputStyle.paddingTop) || 0}px`;
      hintOverlay.style.lineHeight = inputStyle.lineHeight || "normal";
      hintOverlay.style.display = "inline";
    };

    const acceptHint = () => {
      if (currentHint && searchBar.value.toLowerCase().startsWith("inspire:")) {
        searchBar.value = "inspire:" + currentHint;
        if (hintOverlay) {
          hintOverlay.style.display = "none";
        }
        currentHint = "";
        return true;
      }
      return false;
    };

    // Persistent storage for selected items - saved BEFORE Zotero's filter clears them
    let savedItemIds: number[] = [];

    // Helper to save current selection
    const saveCurrentSelection = () => {
      const pane = Zotero.getActiveZoteroPane?.();
      if (pane) {
        const selected = pane.getSelectedItems?.();
        if (selected && selected.length > 0) {
          savedItemIds = selected.map((item: any) => item.id);
        }
      }
    };

    // Focus listener: save selection when user focuses on search bar
    // Also check if we should hide autocomplete based on current value
    const focusListener = () => {
      saveCurrentSelection();
      // Check if current value starts with inspire: and hide autocomplete if so
      const isInspireSearch = searchBar.value
        .toLowerCase()
        .startsWith("inspire:");
      if (isInspireSearch) {
        setAutocompleteHidden(true);
      }
    };

    // Blur listener: restore autocomplete when search bar loses focus
    const blurListener = () => {
      // Restore autocomplete popup visibility when not focused
      // But only if not in the middle of accepting a hint
      setTimeout(() => {
        if (mainWindow.document.activeElement !== searchBar) {
          setAutocompleteHidden(false);
        }
      }, 100);
    };

    // Helper to toggle autocomplete popup hiding via CSS class
    const setAutocompleteHidden = (hidden: boolean) => {
      const quickSearchComponent =
        mainWindow.document.getElementById("zotero-tb-search");
      if (quickSearchComponent) {
        if (hidden) {
          quickSearchComponent.classList.add("zinspire-hide-autocomplete");
          searchBar.classList.add("zinspire-hide-autocomplete");
        } else {
          quickSearchComponent.classList.remove("zinspire-hide-autocomplete");
          searchBar.classList.remove("zinspire-hide-autocomplete");
        }
      }

      // Also try programmatic methods to close popup
      if (hidden && quickSearchComponent) {
        // Try various methods to close popup
        if ((quickSearchComponent as any).popup) {
          try {
            (quickSearchComponent as any).popup.hidePopup?.();
          } catch {
            // Ignore errors
          }
        }
        if (typeof (quickSearchComponent as any).closePopup === "function") {
          try {
            (quickSearchComponent as any).closePopup();
          } catch {
            // Ignore errors
          }
        }
        // Try to find and hide any autocomplete popup in the document
        const autocompletePopup = mainWindow.document.querySelector(
          ".autocomplete-richlistbox, .autocomplete-popup, [type='autocomplete-richlistbox']",
        );
        if (autocompletePopup) {
          try {
            (autocompletePopup as any).hidePopup?.();
            (autocompletePopup as HTMLElement).style.display = "none";
          } catch {
            // Ignore errors
          }
        }
      }
    };

    // Input listener: keep updating selection while user types (before Zotero filters)
    // Also update inline hint and toggle autocomplete popup visibility for inspire: searches
    const inputListener = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const value = target.value;

      // Update inline hint
      updateHintOverlay(value);

      // When typing inspire: prefix, hide autocomplete popup; otherwise show it
      const isInspireSearch = value.toLowerCase().startsWith("inspire:");
      setAutocompleteHidden(isInspireSearch);

      // Only save if we're starting to type inspire:
      // At the very beginning of typing, selection might still be intact
      if (value.toLowerCase().startsWith("inspire") && value.length <= 8) {
        saveCurrentSelection();
      }
    };

    // Keydown listener: handle Enter key with inspire: prefix, and Tab/ArrowRight for hint completion
    // Use capture phase to intercept before Zotero's handlers
    this.searchBarListener = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const value = target.value;
      const keyEvent = event as KeyboardEvent;

      // Handle Tab or ArrowRight to accept inline hint
      if (
        (keyEvent.key === "Tab" || keyEvent.key === "ArrowRight") &&
        currentHint
      ) {
        // Only accept hint if cursor is at the end of input
        if (target.selectionStart === value.length) {
          if (acceptHint()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
      }

      // Hide hint on Escape
      if (keyEvent.key === "Escape" && hintOverlay) {
        hintOverlay.style.display = "none";
        currentHint = "";
      }

      // Only handle Enter key for search
      if (keyEvent.key !== "Enter") {
        return;
      }

      // Check for inspire: prefix
      if (value.toLowerCase().startsWith("inspire:")) {
        const query = value.slice(8).trim();

        if (query) {
          // CRITICAL: Stop event propagation BEFORE any other processing
          // - preventDefault: Prevent default browser/form behavior
          // - stopPropagation: Prevent event from reaching parent elements
          // - stopImmediatePropagation: Prevent other listeners on SAME element (Zotero's handlers)
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          // Save the query before any DOM manipulation
          const searchQuery = query;

          // CRITICAL FIX: Transfer focus FIRST, before clearing search bar
          // This prevents Zotero's quicksearch from processing the Enter key
          const pane = Zotero.getActiveZoteroPane?.();
          const mainWindow = Zotero.getMainWindow?.();

          // Try to focus on items view to take focus away from search bar
          // This must happen BEFORE clearing the search bar
          if (pane) {
            try {
              // Focus on the items tree/view - this removes focus from search bar
              const itemsView = (pane as any).itemsView;
              if (itemsView && typeof itemsView.focus === "function") {
                itemsView.focus();
              } else {
                // Fallback: try to focus on the item tree element directly
                const itemTree =
                  mainWindow?.document?.getElementById("zotero-items-tree");
                if (itemTree) {
                  itemTree.focus();
                }
              }
            } catch (e) {
              // Silently ignore focus transfer errors
            }
          }

          // Now clear the search bar (after focus is transferred)
          target.value = "";

          // Hide inline hint overlay
          if (hintOverlay) {
            hintOverlay.style.display = "none";
            currentHint = "";
          }

          // Blur the search bar to close any autocomplete/history dropdown
          target.blur();

          // Also clear the quicksearch component wrapper if it exists
          const quickSearch =
            mainWindow?.document?.getElementById("zotero-tb-search");
          if (quickSearch) {
            // Clear value on the search component
            if (typeof (quickSearch as any).value !== "undefined") {
              (quickSearch as any).value = "";
            }
            // Also try clearing via the searchTextbox property if available
            if ((quickSearch as any).searchTextbox) {
              (quickSearch as any).searchTextbox.value = "";
            }
          }

          // Restore item selection using saved IDs
          if (savedItemIds.length > 0 && pane) {
            // Restore selection after a brief delay to let Zotero process the clear
            setTimeout(() => {
              pane.selectItems?.(savedItemIds);
            }, 50);
          }

          // Trigger INSPIRE search
          this.triggerSearch(searchQuery);
        }
      }
    };

    // Flag to track if we're handling an inspire search (shared between keydown and keypress)
    let handlingInspireSearch = false;

    // Keypress listener: also block keypress events if we're handling inspire search
    // Some components (like XUL quicksearch) may listen on keypress instead of keydown
    const keypressListener = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === "Enter" && handlingInspireSearch) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        // Reset the flag after blocking
        handlingInspireSearch = false;
      }
    };

    // Wrap the keydown listener to set the flag
    const originalKeydownListener = this.searchBarListener;
    this.searchBarListener = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const value = target.value;
      const keyEvent = event as KeyboardEvent;

      // Set flag before calling original handler if this is an inspire: search
      if (
        keyEvent.key === "Enter" &&
        value.toLowerCase().startsWith("inspire:")
      ) {
        handlingInspireSearch = true;
      }

      // Call original handler
      originalKeydownListener(event);
    };

    searchBar.addEventListener("focus", focusListener);
    searchBar.addEventListener("blur", blurListener);
    searchBar.addEventListener("input", inputListener);
    // CRITICAL: Use capture phase (third param true) to intercept before Zotero's bubble-phase handlers
    searchBar.addEventListener("keydown", this.searchBarListener, {
      capture: true,
    });
    // Also listen on keypress in capture phase to block any XUL/command handlers
    searchBar.addEventListener("keypress", keypressListener, { capture: true });

    // Store references for cleanup
    (this as any)._searchBarFocusListener = focusListener;
    (this as any)._searchBarBlurListener = blurListener;
    (this as any)._searchBarInputListener = inputListener;
    (this as any)._searchBarKeypressListener = keypressListener;
  }

  /**
   * Unregister the search bar listener.
   */
  static unregisterSearchBarListener() {
    if (this.searchBarElement) {
      if (this.searchBarListener) {
        // Must use same capture option as addEventListener to properly remove
        this.searchBarElement.removeEventListener(
          "keydown",
          this.searchBarListener,
          { capture: true },
        );
      }
      const focusListener = (this as any)._searchBarFocusListener;
      if (focusListener) {
        this.searchBarElement.removeEventListener("focus", focusListener);
        (this as any)._searchBarFocusListener = undefined;
      }
      const blurListener = (this as any)._searchBarBlurListener;
      if (blurListener) {
        this.searchBarElement.removeEventListener("blur", blurListener);
        (this as any)._searchBarBlurListener = undefined;
      }
      const inputListener = (this as any)._searchBarInputListener;
      if (inputListener) {
        this.searchBarElement.removeEventListener("input", inputListener);
        (this as any)._searchBarInputListener = undefined;
      }
      const keypressListener = (this as any)._searchBarKeypressListener;
      if (keypressListener) {
        this.searchBarElement.removeEventListener(
          "keypress",
          keypressListener,
          { capture: true },
        );
        (this as any)._searchBarKeypressListener = undefined;
      }
      // Remove inline hint overlay
      const hintOverlay = (this as any)._searchBarHintOverlay;
      if (hintOverlay && hintOverlay.parentElement) {
        hintOverlay.parentElement.removeChild(hintOverlay);
        (this as any)._searchBarHintOverlay = undefined;
      }
      // Restore original autocomplete attributes
      this.searchBarElement.removeAttribute("autocomplete");
      this.searchBarElement.removeAttribute("disableautocomplete");
      this.searchBarElement.removeAttribute("enablehistory");
      this.searchBarElement.removeAttribute("disablehistory");
      // Also restore on quicksearch component
      const mainWindow = Zotero.getMainWindow?.();
      if (mainWindow) {
        const quickSearchComponent =
          mainWindow.document.getElementById("zotero-tb-search");
        if (quickSearchComponent) {
          quickSearchComponent.removeAttribute("disableautocomplete");
          quickSearchComponent.removeAttribute("enablehistory");
        }
      }
      this.searchBarListener = undefined;
      this.searchBarElement = undefined;
    }
  }

  /**
   * Trigger an INSPIRE search in the first active panel controller.
   */
  private static triggerSearch(query: string) {
    // Use the InspireReferencePanelController's static instances set
    const instances = InspireReferencePanelController.getInstances();
    if (instances.size === 0) {
      // Show a notification to the user
      const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
      const progressWindow = new ProgressWindowHelper("INSPIRE Search");
      progressWindow.win.changeHeadline("INSPIRE Search", icon);
      progressWindow.createLine({
        icon: icon,
        text: "Please open the INSPIRE panel first",
        type: "error",
      });
      progressWindow.show();
      progressWindow.startCloseTimer(3000);
      return;
    }
    for (const controller of instances) {
      controller.executeInspireSearch(query).catch((err: Error) => {
        Zotero.debug(`[${config.addonName}] Failed to trigger search: ${err}`);
      });
      break; // Only need to trigger on one controller
    }
  }
}

class InspireReferencePanelController {
  private static readonly instances =
    new Set<InspireReferencePanelController>();
  private static navigationStack: NavigationSnapshot[] = [];
  private static forwardStack: NavigationSnapshot[] = [];
  private static isNavigatingHistory = false;
  // Shared citation listener (singleton on readerIntegration)
  private static citationListenerRegistered = false;
  private static sharedCitationHandler?: (event: CitationLookupEvent) => void;
  // FTR-RECID-AUTO-UPDATE: Shared handlers for recid availability events
  private static recidAvailableHandler?: (event: {
    parentItemID: number;
    recid: string;
  }) => void;
  private static noRecidHandler?: (event: { parentItemID: number }) => void;
  // FTR-HOVER-PREVIEW: Shared handlers for preview events from PDF reader
  private static previewRequestHandler?: (event: CitationPreviewEvent) => void;
  private static previewHideHandler?: () => void;
  // Shared citationLookup dedupe (prevents multiple controllers from handling same event)
  private static lastGlobalCitationEventKey?: string;
  private static lastGlobalCitationEventTs = 0;
  private static globalCitationInFlightKey?: string;

  /**
   * Get all active controller instances for external access.
   */
  static getInstances(): Set<InspireReferencePanelController> {
    return this.instances;
  }
  private static pickControllerForEvent(
    event: CitationLookupEvent,
  ): InspireReferencePanelController | undefined {
    // Prefer reader tab match
    if (event.readerTabID) {
      for (const inst of this.instances) {
        if (
          inst.currentReaderTabID &&
          inst.currentReaderTabID === event.readerTabID
        ) {
          return inst;
        }
      }
    }
    // Then parent item match
    for (const inst of this.instances) {
      if (inst.currentItemID === event.parentItemID) {
        return inst;
      }
    }
    // Fallback: first instance
    return this.instances.values().next().value;
  }
  /**
   * FTR-HOVER-PREVIEW: Pick controller for preview event (similar to pickControllerForEvent)
   */
  private static pickControllerForPreviewEvent(
    event: CitationPreviewEvent,
  ): InspireReferencePanelController | undefined {
    // Prefer reader tab match
    if (event.readerTabID) {
      for (const inst of this.instances) {
        if (
          inst.currentReaderTabID &&
          inst.currentReaderTabID === event.readerTabID
        ) {
          return inst;
        }
      }
    }
    // Then parent item match
    for (const inst of this.instances) {
      if (inst.currentItemID === event.parentItemID) {
        return inst;
      }
    }
    // Fallback: first instance
    return this.instances.values().next().value;
  }
  private static sharedPendingScrollRestore?: ScrollState & { itemID: number };

  private body: HTMLDivElement;
  private statusEl: HTMLSpanElement;
  private listEl: HTMLDivElement;
  private filterInput: HTMLInputElement;
  private filterInlineHint?: InlineHintHelper;
  private filterHistory: SearchHistoryItem[] = [];
  private sortSelect!: HTMLSelectElement;
  private tabButtons!: Record<InspireViewMode, HTMLButtonElement>;
  private filterText = "";
  private viewMode: InspireViewMode = "references";
  private referenceSort: ReferenceSortOption = DEFAULT_REFERENCE_SORT;
  private citedBySort: InspireSortOption = DEFAULT_CITED_BY_SORT;
  private entryCitedSort: InspireSortOption = DEFAULT_CITED_BY_SORT;
  private currentItemID?: number;
  private currentRecid?: string;
  private entryCitedSource?: EntryCitedSource;
  private entryCitedPreviousMode: Exclude<InspireViewMode, "entryCited"> =
    "references";
  private entryCitedReturnScroll?: ScrollState;
  private pendingEntryScrollReset = false;
  private allEntries: InspireReferenceEntry[] = [];
  // LRU caches to prevent unbounded memory growth
  // References: ~100 entries, each with InspireReferenceEntry[]
  private referencesCache = new LRUCache<string, InspireReferenceEntry[]>(
    REFERENCES_CACHE_SIZE,
  );
  // Cited-by: ~50 entries (large arrays, paginated data)
  private citedByCache = new LRUCache<string, InspireReferenceEntry[]>(
    CITED_BY_CACHE_SIZE,
  );
  // Entry-cited: ~50 entries (similar to cited-by)
  private entryCitedCache = new LRUCache<string, InspireReferenceEntry[]>(
    ENTRY_CITED_CACHE_SIZE,
  );
  // Metadata: ~500 entries (individual metadata objects, frequently accessed)
  private metadataCache = new LRUCache<string, jsobject>(METADATA_CACHE_SIZE);
  // Row cache: cleared on each render, no LRU needed
  private rowCache = new Map<string, HTMLElement>();
  private activeAbort?: AbortController;
  private pendingToken?: string;
  private notifierID?: string;
  private pendingScrollRestore?: ScrollState & { itemID: number };
  private currentTabType: "library" | "reader" = "library";
  private currentReaderTabID?: string;
  private backButton!: HTMLButtonElement;
  private forwardButton!: HTMLButtonElement;
  private entryViewBackButton!: HTMLButtonElement;
  // Abstract tooltip state
  private abstractTooltip?: HTMLDivElement;
  private abstractHoverTimeout?: ReturnType<typeof setTimeout>;
  private abstractHideTimeout?: ReturnType<typeof setTimeout>;
  private abstractAbort?: AbortController;
  private tooltipRAF?: number; // For requestAnimationFrame throttling
  private readonly tooltipShowDelay = TOOLTIP_SHOW_DELAY_MS;
  private readonly tooltipHideDelay = TOOLTIP_HIDE_DELAY_MS;
  // Author profile card state (Author Papers)
  private authorProfile?: InspireAuthorProfile | null;
  private authorStats?: AuthorStats;
  private authorProfileCard?: HTMLDivElement;
  private authorProfileCollapsed = false;
  private authorProfileCollapsedByKey = new Map<string, boolean>();
  private authorProfileAbort?: AbortController;
  private authorProfileKey?: string;
  // Author hover preview state (FTR-AUTHOR-PROFILE-PREVIEW)
  private authorPreviewCard?: HTMLDivElement;
  private authorPreviewShowTimeout?: ReturnType<typeof setTimeout>;
  private authorPreviewHideTimeout?: ReturnType<typeof setTimeout>;
  private authorPreviewAbort?: AbortController;
  private authorPreviewCurrentKey?: string;
  private authorPreviewAnchor?: HTMLElement;
  private readonly authorPreviewShowDelay = 300;
  private readonly authorPreviewHideDelay = 120;
  // FTR-HOVER-PREVIEW: Preview card state
  private previewCard?: HTMLDivElement;
  private previewShowTimeout?: ReturnType<typeof setTimeout>;
  private previewHideTimeout?: ReturnType<typeof setTimeout>;
  private previewCurrentEntryId?: string;
  private previewAbortController?: AbortController;
  private readonly previewShowDelay = 250; // ms before showing card
  private readonly previewHideDelay = 100; // ms before hiding card
  // FTR-HOVER-PREVIEW-MULTI: Multi-entry pagination state
  // Limit max entries to prevent memory issues with large result sets
  private static readonly MAX_PREVIEW_ENTRIES = 20;
  private previewEntries: InspireReferenceEntry[] = [];
  private previewCurrentIndex = 0;
  private previewLabel?: string;
  private previewButtonRect?: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
  // FTR-AMBIGUOUS-AUTHOR-YEAR: Track citation type for ambiguous message
  private previewCitationType?: "numeric" | "author-year" | "arxiv";
  // Frontend pagination state (for cited-by and author papers)
  private renderedCount = 0; // Number of entries currently rendered
  private loadMoreButton?: HTMLButtonElement;
  private loadMoreObserver?: IntersectionObserver; // For infinite scroll
  private loadMoreContainer?: HTMLDivElement; // Container being observed
  private currentFilteredEntries?: InspireReferenceEntry[]; // For infinite scroll loading
  private currentPaginationBatchSize: number = RENDER_PAGE_SIZE; // For infinite scroll batch size
  // Total count from API (may be larger than fetched entries due to limits)
  private totalApiCount: number | null = null;
  // Chart state for citation/year statistics visualization
  private chartContainer?: HTMLDivElement;
  private chartSvgWrapper?: HTMLDivElement;
  private chartSubHeader?: HTMLDivElement;
  private chartCollapsed: boolean; // Initialized from preferences in constructor
  private chartViewMode: "year" | "citation" = "year";
  private chartSelectedBins: Set<string> = new Set();
  private lastChartClickedKey?: string;
  private cachedChartStats?: { mode: string; stats: ChartBin[] };
  // ResizeObserver for dynamic chart re-rendering on width change
  private chartResizeObserver?: ResizeObserver;
  private chartResizeFrame?: { cancel: (id: number) => void; id: number };
  private lastChartWidth?: number;

  // Track whether the chart needs a refresh (e.g., after we displayed an empty state)
  private chartNeedsRefresh = true;
  private lastRenderedEntries: InspireReferenceEntry[] = [];
  private chartStatsTopLine?: HTMLSpanElement;
  private chartStatsBottomLine?: HTMLSpanElement;
  // Filter input debounce timer
  private filterDebounceTimer?: ReturnType<typeof setTimeout>;
  private readonly filterDebounceDelay = FILTER_DEBOUNCE_MS;
  // Chart deferred rendering timer
  private chartRenderTimer?: ReturnType<typeof setTimeout>;
  // Row element pool for recycling (reduces DOM creation and GC pressure)
  private rowPool: HTMLDivElement[] = [];
  private readonly maxRowPoolSize = ROW_POOL_MAX_SIZE;
  // Rate limiter status display
  private rateLimiterStatusEl?: HTMLSpanElement;
  private rateLimiterUnsubscribe?: () => void;

  // Cache source indicator
  private cacheSource: CacheSource = "api";
  private cacheSourceAge?: number; // Age in hours (for local cache)
  private cacheSourceExpired?: boolean; // True if using expired/stale cache (offline fallback)
  private cacheSourceEl?: HTMLSpanElement;

  // Search mode state
  private searchCache = new LRUCache<string, InspireReferenceEntry[]>(
    SEARCH_CACHE_SIZE,
  );
  private searchSort: InspireSortOption = "mostrecent";
  private currentSearchQuery?: string; // Current active search query
  private searchHistory: SearchHistoryItem[] = []; // Recent search queries
  private searchInputContainer?: HTMLDivElement; // Search input UI container
  private searchInput?: HTMLInputElement; // Search query input field
  private searchHistoryDropdown?: HTMLDivElement; // Search history dropdown

  // Quick filters dropdown state
  private quickFilters = new Set<QuickFilterType>();
  private quickFiltersButton?: HTMLButtonElement;
  private quickFiltersBadge?: HTMLSpanElement;
  private quickFiltersPopup?: HTMLDivElement;
  private quickFiltersPopupVisible = false;
  private quickFiltersWrapper?: HTMLDivElement;
  private quickFilterCheckboxes = new Map<QuickFilterType, HTMLInputElement>();
  // PERF-FIX-6: Track outside click handler and timeout for cleanup
  private quickFiltersOutsideClickHandler?: (e: MouseEvent) => void;
  private quickFiltersTimeoutId?: ReturnType<typeof setTimeout>;

  // PERF-FIX-2: Track AbortController for cancellable exports
  private exportAbort?: AbortController;

  // Author count filter for chart
  private authorFilterEnabled = false; // Filter for papers with <= 10 authors
  private authorFilterButton?: HTMLButtonElement;
  private excludeSelfCitations = false; // Use citation counts excluding self citations in chart
  private publishedOnlyFilterEnabled = false; // Filter for papers with journal information only
  private publishedOnlyButton?: HTMLButtonElement;

  // Focused selection state (FTR-FOCUSED-SELECTION, FTR-KEYBOARD-NAV-FULL)
  // Persistent selection for PDF citation lookup and keyboard navigation
  private focusedEntryID?: string;
  // Index in filtered entries for keyboard navigation (FTR-KEYBOARD-NAV-FULL)
  private focusedEntryIndex = -1;

  // Event delegation handlers (PERF-14: single listener instead of per-row)
  private boundHandleListClick?: (e: MouseEvent) => void;
  private boundHandleListMouseOver?: (e: MouseEvent) => void;
  private boundHandleListMouseOut?: (e: MouseEvent) => void;
  private boundHandleListMouseMove?: (e: MouseEvent) => void;
  private boundHandleListDoubleClick?: (e: MouseEvent) => void;
  private boundHandleBodyKeyDown?: (e: KeyboardEvent) => void; // FTR-KEYBOARD-NAV-FULL
  private boundHandleListContextMenu?: (e: MouseEvent) => void; // FTR-COPY-LINK
  // Timer for handling click/double-click conflict on marker
  private markerClickTimer?: ReturnType<typeof setTimeout>;
  // PERF-FIX-7: Throttle mousemove updates (~60fps)
  private lastMouseMoveTime = 0;
  private readonly mouseMoveThrottleMs = 16; // ~60fps

  // Batch import state (FTR-BATCH-IMPORT)
  private selectedEntryIDs = new Set<string>();
  private lastSelectedEntryID?: string; // For Shift+Click range selection
  private batchToolbar?: HTMLDivElement;
  private batchSelectedBadge?: HTMLSpanElement;
  private batchImportButton?: HTMLButtonElement;
  private batchImportAbort?: AbortController;

  // PDF Annotate (FTR-PDF-ANNOTATE)
  private labelMatcher?: LabelMatcher;
  private citationLookupHandler?: (event: CitationLookupEvent) => void;
  /** Track if PDF parsing has been attempted for current item */
  private pdfParseAttempted = false;
  /** Deduplicate bursty citationLookup events */
  private lastCitationEventKey?: string;
  private lastCitationEventTs = 0;
  /** In-flight guard to avoid re-entrance on same label burst */
  private citationInFlightKey?: string;

  // Smart Update Auto-check state (FTR-SMART-UPDATE-AUTO-CHECK)
  private autoCheckNotification?: HTMLElement;
  private autoCheckAbort?: AbortController;
  private autoCheckPendingDiff?: {
    diff: SmartUpdateDiff;
    allowedChanges: FieldChange[];
    itemRecid: string;
  };
  /** Map of itemID -> last check timestamp (for throttling, not permanent dedup) */
  private autoCheckLastCheckTime = new Map<number, number>();
  /** Throttle interval: don't re-check same item within this time (ms) */
  private readonly autoCheckThrottleMs = 5000; // 5 seconds
  /** FTR-DARK-MODE-AUTO: Theme change listener for chart re-render */
  private themeChangeListener?: () => void;
  private themeMediaQuery?: MediaQueryList;

  constructor(body: HTMLDivElement) {
    this.body = body;
    this.body.classList.add("zinspire-ref-panel");
    // FTR-PANEL-WIDTH-FIX: Ensure panel respects container width at all sizes
    // Use width: 100% with overflow handling to prevent content from exceeding sidebar width
    this.body.style.width = "100%";
    this.body.style.maxWidth = "100%";
    this.body.style.minWidth = "0"; // Allow shrinking below intrinsic minimum
    this.body.style.overflow = "hidden";
    this.body.style.boxSizing = "border-box";
    this.enableTextSelection();

    // Initialize chart collapsed state from preferences
    this.chartCollapsed = getPref("chart_default_collapsed") !== false;

    // Initialize quick filters from preferences before building UI
    this.loadQuickFiltersFromPrefs();

    // ─────────────────────────────────────────────────────────────────────────
    // Modern 3-Row Toolbar Layout
    // ─────────────────────────────────────────────────────────────────────────

    const toolbar = ztoolkit.UI.appendElement(
      {
        tag: "div",
        classList: ["zinspire-ref-panel__toolbar"],
      },
      this.body,
    ) as HTMLDivElement;
    // Main toolbar container styles
    // FTR-PANEL-WIDTH-FIX: Add min-width handling for narrow sidebars
    // FIX-POPUP-CLIP: Use overflow:visible so quick filters popup isn't clipped
    toolbar.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--fill-quinary, #e2e8f0);
      background: var(--material-sidepane, #f8fafc);
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
      overflow: visible;
    `;

    // ═══════════════════════════════════════════════════════════════════════
    // Row 1: Status (count display)
    // ═══════════════════════════════════════════════════════════════════════
    const row1 = body.ownerDocument.createElement("div");
    row1.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 20px;
    `;
    toolbar.appendChild(row1);

    this.statusEl = ztoolkit.UI.appendElement(
      {
        tag: "span",
        classList: ["zinspire-ref-panel__status"],
        properties: { textContent: getString("references-panel-status-empty") },
      },
      row1,
    ) as HTMLSpanElement;
    this.statusEl.style.cssText = `
      font-size: 13px;
      font-weight: 500;
      color: var(--fill-primary, #1e293b);
    `;

    // ═══════════════════════════════════════════════════════════════════════
    // Row 2: Tab buttons (pill button style)
    // ═══════════════════════════════════════════════════════════════════════
    const row2 = body.ownerDocument.createElement("div");
    // FTR-PANEL-WIDTH-FIX: Allow tab row to wrap on narrow sidebars
    row2.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      min-width: 0;
    `;
    toolbar.appendChild(row2);

    const tabs = body.ownerDocument.createElement("div");
    tabs.className = "zinspire-ref-panel__tabs";
    // FTR-PANEL-WIDTH-FIX: Allow tabs to wrap on narrow sidebars
    tabs.style.cssText = `
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      min-width: 0;
    `;
    row2.appendChild(tabs);

    this.tabButtons = {
      references: this.createTabButton(tabs, "references"),
      citedBy: this.createTabButton(tabs, "citedBy"),
      entryCited: this.createTabButton(tabs, "entryCited"),
      search: this.createTabButton(tabs, "search"),
    };
    this.updateTabSelection();

    // ═══════════════════════════════════════════════════════════════════════
    // Row 3: Filter (left) + Navigation (right)
    // ═══════════════════════════════════════════════════════════════════════
    const row3 = body.ownerDocument.createElement("div");
    // FTR-PANEL-WIDTH-FIX: Allow filter row to wrap on narrow sidebars
    row3.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      min-width: 0;
    `;
    toolbar.appendChild(row3);

    // Filter group (LEFT side)
    // FTR-PANEL-WIDTH-FIX: Allow filter group to wrap on narrow sidebars
    const filterGroup = ztoolkit.UI.appendElement(
      {
        tag: "div",
        classList: ["zinspire-filter-group"],
        styles: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "6px",
          flexWrap: "wrap",
          minWidth: "0",
        },
      },
      row3,
    ) as HTMLDivElement;

    this.createQuickFiltersControls(filterGroup);

    // Create wrapper using NATIVE DOM (not ztoolkit) - same pattern as Search
    // Critical: wrapper stays DETACHED until all setup is complete
    const filterDoc = filterGroup.ownerDocument;
    const filterInputWrapper = filterDoc.createElement("div");
    filterInputWrapper.className = "zinspire-filter-input-wrapper";
    filterInputWrapper.style.cssText =
      INLINE_HINT_WRAPPER_STYLE + `min-width: 120px;`;

    // Create filter input using native DOM
    this.filterInput = filterDoc.createElement("input");
    this.filterInput.type = "text";
    this.filterInput.className = "zinspire-ref-panel__filter";
    this.filterInput.placeholder = getString(
      "references-panel-filter-placeholder",
    );
    configureInlineHintInput(this.filterInput);
    this.filterInput.style.cssText = INLINE_HINT_INPUT_STYLE;

    // Create inline hint helper (wrapper is still DETACHED from DOM)
    const filterHint = new InlineHintHelper({
      input: this.filterInput,
      wrapper: filterInputWrapper,
      history: this.filterHistory,
      getHistory: () => this.filterHistory,
    });
    filterHint.getElement().classList.add("zinspire-filter-inline-hint");
    this.filterInlineHint = filterHint;

    // Add event listeners BEFORE appending input (same order as Search)
    this.filterInput.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        (event.key === "Tab" || event.key === "ArrowRight") &&
        filterHint.currentHintText
      ) {
        const input = event.target as HTMLInputElement;
        const cursorAtEnd = input.selectionStart === input.value.length;
        if (cursorAtEnd && filterHint.accept()) {
          event.preventDefault();
          this.handleFilterInputChange(input.value);
          this.addToFilterHistory(input.value);
        }
      } else if (event.key === "Escape") {
        filterHint.hide();
      } else if (event.key === "Enter") {
        this.addToFilterHistory((event.target as HTMLInputElement).value);
        filterHint.hide();
      }
    });

    this.filterInput.addEventListener("input", (event: Event) => {
      const target = event.target as HTMLInputElement;
      this.handleFilterInputChange(target.value);
      filterHint.update();
    });

    this.filterInput.addEventListener("focus", () => {
      filterHint.update();
    });

    this.filterInput.addEventListener("blur", () => {
      this.addToFilterHistory(this.filterInput?.value || "");
      setTimeout(() => filterHint.hide(), 150);
    });

    // Append input to wrapper AFTER all event listeners (same order as Search)
    filterInputWrapper.appendChild(this.filterInput);

    // NOW attach wrapper to DOM (after all setup is complete)
    filterGroup.appendChild(filterInputWrapper);

    // Navigation group (immediately after filter, no margin-left: auto)
    const navGroup = body.ownerDocument.createElement("div");
    navGroup.style.cssText = `
      display: flex;
      align-items: center;
      gap: 2px;
    `;
    row3.appendChild(navGroup);

    // Back button (icon)
    this.backButton = ztoolkit.UI.appendElement(
      {
        tag: "button",
        classList: ["zinspire-ref-panel__button"],
        attributes: { title: getString("references-panel-back-tooltip") },
        properties: { textContent: "←" },
        listeners: [
          {
            type: "click",
            listener: () => {
              this.handleBackNavigation();
            },
          },
        ],
      },
      navGroup,
    ) as HTMLButtonElement;
    this.backButton.disabled = true;
    this.applyNavButtonStyle(this.backButton, true);

    // Forward button (icon)
    this.forwardButton = ztoolkit.UI.appendElement(
      {
        tag: "button",
        classList: ["zinspire-ref-panel__button"],
        attributes: { title: getString("references-panel-forward-tooltip") },
        properties: { textContent: "→" },
        listeners: [
          {
            type: "click",
            listener: () => {
              this.handleForwardNavigation();
            },
          },
        ],
      },
      navGroup,
    ) as HTMLButtonElement;
    this.forwardButton.disabled = true;
    this.applyNavButtonStyle(this.forwardButton, true);

    // Entry view back button - compact icon version (hidden by default)
    this.entryViewBackButton = ztoolkit.UI.appendElement(
      {
        tag: "button",
        classList: ["zinspire-ref-panel__button"],
        attributes: {
          title: getString("references-panel-entry-back-tooltip"),
        },
        properties: {
          textContent: "↩", // Compact icon instead of full text
        },
        listeners: [
          {
            type: "click",
            listener: () => {
              this.exitEntryCitedTab().catch(() => void 0);
            },
          },
        ],
      },
      navGroup,
    ) as HTMLButtonElement;
    this.entryViewBackButton.hidden = true;
    this.applyNavButtonStyle(this.entryViewBackButton, true);
    this.entryViewBackButton.style.display = "none";

    // Rate limiter status indicator
    this.rateLimiterStatusEl = ztoolkit.UI.appendElement(
      {
        tag: "span",
        classList: ["zinspire-ref-panel__rate-status"],
        attributes: {
          title: getString("references-panel-rate-limit-tooltip"),
        },
      },
      toolbar,
    ) as HTMLSpanElement;
    this.rateLimiterStatusEl.hidden = true;
    this.rateLimiterUnsubscribe = onRateLimiterStatusChange((status) => {
      this.updateRateLimiterStatus(status);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Row 4: Sort dropdown (left) + Cache source indicator (right)
    // ═══════════════════════════════════════════════════════════════════════
    const row4 = body.ownerDocument.createElement("div");
    row4.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
    `;
    toolbar.appendChild(row4);

    // Sort dropdown (left side of row4)
    this.sortSelect = ztoolkit.UI.appendElement(
      {
        tag: "select",
        classList: ["zinspire-ref-panel__sort"],
        attributes: {
          "aria-label": getString("references-panel-sort-label"),
        },
        listeners: [
          {
            type: "change",
            listener: (event: Event) => {
              const target = event.target as HTMLSelectElement;
              this.handleSortChange(target.value);
            },
          },
        ],
      },
      row4,
    ) as HTMLSelectElement;
    this.sortSelect.style.cssText = `
      margin: 0;
      padding: 4px 24px 4px 8px;
      font-size: 12px;
      border: 0px solid var(--fill-quinary, #d1d5db);
      border-radius: 3px;
      background: var(--material-background, #fff) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M3 4.5L6 8l3-3.5H3z'/%3E%3C/svg%3E") no-repeat right 6px center;
      color: var(--fill-primary, #334155);
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
    `;

    // Cache source indicator (right side of row4, pushed to the right)
    this.cacheSourceEl = ztoolkit.UI.appendElement(
      {
        tag: "span",
        classList: ["zinspire-ref-panel__cache-source"],
      },
      row4,
    ) as HTMLSpanElement;
    this.cacheSourceEl.hidden = true;
    this.cacheSourceEl.style.cssText = `
      font-size: 10px;
      color: var(--fill-secondary, #64748b);
      margin-left: auto;
      padding: 2px 6px;
      background: var(--material-mix-quinary, #f1f5f9);
      border-radius: 4px;
      white-space: nowrap;
    `;

    // Create search input container (hidden by default, shown in search mode)
    this.createSearchInputContainer(toolbar);

    // Load search & filter history from preferences
    this.loadSearchHistory();
    this.loadFilterHistory();

    // Create chart container (between toolbar and list)
    const chartContainer = this.createChartContainer();
    this.body.appendChild(chartContainer);
    this.observeChartResize(chartContainer);
    // FTR-DARK-MODE-AUTO: Listen for theme changes to re-render chart SVG
    this.setupThemeChangeListener();

    this.listEl = ztoolkit.UI.appendElement(
      {
        tag: "div",
        classList: ["zinspire-ref-panel__list"],
      },
      this.body,
    ) as HTMLDivElement;
    // FTR-KEYBOARD-NAV-FULL: Make list focusable for keyboard navigation
    this.listEl.tabIndex = -1;
    // FTR-PANEL-WIDTH-FIX: Ensure list respects container width
    this.listEl.style.outline = "none";
    this.listEl.style.width = "100%";
    this.listEl.style.maxWidth = "100%";
    this.listEl.style.minWidth = "0";
    this.listEl.style.boxSizing = "border-box";
    this.listEl.style.overflowX = "hidden";
    this.listEl.style.overflowY = "auto";

    // FTR-BATCH-IMPORT: Create batch toolbar (hidden by default, shown when items selected)
    // Must be created AFTER listEl exists, so insertBefore(toolbar, listEl) works correctly
    this.createBatchToolbar();

    // Setup event delegation on listEl (PERF-14: reduces listeners from 10000+ to 4)
    this.setupEventDelegation();

    this.allEntries = [];
    this.renderChartImmediate();
    this.renderMessage(getString("references-panel-status-empty"));
    this.registerNotifier();
    InspireReferencePanelController.instances.add(this);
    InspireReferencePanelController.syncBackButtonStates();

    // FTR-PDF-ANNOTATE: Register for citation lookup events
    this.initPdfCitationLookup();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PDF Citation Lookup (FTR-PDF-ANNOTATE)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Initialize PDF citation lookup event handler.
   * Listens for citation selections from the PDF reader.
   * FTR-RECID-AUTO-UPDATE: Also listens for recid availability events.
   */
  private initPdfCitationLookup(): void {
    // Register a SINGLE listener on readerIntegration; dispatch to active controller
    if (InspireReferencePanelController.citationListenerRegistered) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] initPdfCitationLookup skipped (already registered)`,
      );
      return;
    }
    const reader = getReaderIntegration();
    InspireReferencePanelController.sharedCitationHandler = (
      event: CitationLookupEvent,
    ) => {
      const controller =
        InspireReferencePanelController.pickControllerForEvent(event);
      if (!controller) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] No controller available for citationLookup event`,
        );
        return;
      }
      controller.handleCitationLookup(event);
    };
    reader.on(
      "citationLookup",
      InspireReferencePanelController.sharedCitationHandler,
    );

    // FTR-RECID-AUTO-UPDATE: Register handler for recid availability events
    InspireReferencePanelController.recidAvailableHandler = (event: {
      parentItemID: number;
      recid: string;
    }) => {
      // Find controller(s) showing this item and trigger refresh
      for (const ctrl of InspireReferencePanelController.instances) {
        if (ctrl.currentItemID === event.parentItemID) {
          Zotero.debug(
            `[${config.addonName}] [RECID-AUTO-UPDATE] Refreshing panel for item ${event.parentItemID} with new recid ${event.recid}`,
          );
          ctrl.handleRecidBecameAvailable(event.parentItemID, event.recid);
        }
      }
    };
    reader.on(
      "itemRecidAvailable",
      InspireReferencePanelController.recidAvailableHandler,
    );

    // FTR-RECID-AUTO-UPDATE: Register handler for no-recid events
    InspireReferencePanelController.noRecidHandler = (event: {
      parentItemID: number;
    }) => {
      // Find controller(s) showing this item and show "no recid" message
      for (const ctrl of InspireReferencePanelController.instances) {
        if (ctrl.currentItemID === event.parentItemID) {
          Zotero.debug(
            `[${config.addonName}] [RECID-AUTO-UPDATE] Showing no-recid message for item ${event.parentItemID}`,
          );
          ctrl.handleNoRecid(event.parentItemID);
        }
      }
    };
    reader.on("itemNoRecid", InspireReferencePanelController.noRecidHandler);

    // FTR-HOVER-PREVIEW: Register handlers for preview events from PDF reader lookup buttons
    InspireReferencePanelController.previewRequestHandler = (
      event: CitationPreviewEvent,
    ) => {
      // Find controller for this event and show preview
      const controller =
        InspireReferencePanelController.pickControllerForPreviewEvent(event);
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] previewRequestHandler: parentItemID=${event.parentItemID}, label=${event.label}, controller=${controller ? "found" : "NOT FOUND"}`,
      );
      if (controller) {
        controller.handleCitationPreviewRequest(event);
      }
    };
    reader.on(
      "citationPreviewRequest",
      InspireReferencePanelController.previewRequestHandler,
    );

    InspireReferencePanelController.previewHideHandler = () => {
      // Schedule hide on all controllers (with delay to allow moving cursor to card)
      for (const ctrl of InspireReferencePanelController.instances) {
        ctrl.schedulePreviewHide();
      }
    };
    reader.on(
      "citationPreviewHide",
      InspireReferencePanelController.previewHideHandler,
    );

    InspireReferencePanelController.citationListenerRegistered = true;
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Registered shared citationLookup and recid event listeners`,
    );
  }

  /**
   * Handle citation lookup request from PDF reader.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Now supports multiple matches per label.
   * Finds matching entries and scrolls/highlights them.
   */
  private async handleCitationLookup(
    event: CitationLookupEvent,
  ): Promise<void> {
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] handleCitationLookup: parentItemID=${event.parentItemID}, currentItemID=${this.currentItemID}, labels=[${event.citation.labels.join(",")}]`,
    );

    // Only handle events from the active reader tab to avoid cross-pane interference
    const activeReaderTabID =
      this.currentReaderTabID ?? ReaderTabHelper.getSelectedTabID();
    if (
      event.readerTabID &&
      activeReaderTabID &&
      event.readerTabID !== activeReaderTabID
    ) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Skipping citationLookup from foreign readerTabID=${event.readerTabID}, active=${activeReaderTabID}`,
      );
      return;
    }

    // Deduplicate bursty repeated events (same item + labels in short window)
    const evtKey = `${event.parentItemID}:${event.citation.labels.join(",")}`;
    const now = Date.now();
    const dedupeWindow = 800;
    const globalRecent =
      InspireReferencePanelController.lastGlobalCitationEventKey === evtKey &&
      now - InspireReferencePanelController.lastGlobalCitationEventTs <
        dedupeWindow;
    const globalInFlight =
      InspireReferencePanelController.globalCitationInFlightKey === evtKey;
    if (
      globalRecent ||
      globalInFlight ||
      (this.lastCitationEventKey === evtKey &&
        now - this.lastCitationEventTs < dedupeWindow) ||
      this.citationInFlightKey === evtKey
    ) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Skipping duplicate citationLookup (${evtKey})`,
      );
      return;
    }
    InspireReferencePanelController.lastGlobalCitationEventKey = evtKey;
    InspireReferencePanelController.lastGlobalCitationEventTs = now;
    InspireReferencePanelController.globalCitationInFlightKey = evtKey;
    this.lastCitationEventKey = evtKey;
    this.lastCitationEventTs = now;
    this.citationInFlightKey = evtKey;

    try {
      // FTR-PRELOAD-AWAIT: Check for in-flight preloads and await them
      // This significantly reduces first-click latency when preload is already running
      const reader = getReaderIntegration();
      const item = Zotero.Items.get(event.parentItemID);
      if (item) {
        const recid = deriveRecidFromItem(item);
        if (recid) {
          // Check for in-flight reference preload
          const preloadPromise = reader.getPreloadPromise(recid);
          if (preloadPromise) {
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] Awaiting in-flight reference preload for recid ${recid}`,
            );
            this.showToast(getString("references-panel-status-loading"));
            await preloadPromise;
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] In-flight reference preload completed`,
            );
          }
        }

        // Check for in-flight PDF parsing
        const pdfParsePromise = reader.getPdfParsePromise(event.parentItemID);
        if (pdfParsePromise) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Awaiting in-flight PDF parsing for item ${event.parentItemID}`,
          );
          await pdfParsePromise;
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] In-flight PDF parsing completed`,
          );
        }
      }

      // Ensure the controller is synced to the PDF's parent item
      if (this.currentItemID !== event.parentItemID) {
        const switched = await this.ensureItemForCitation(event.parentItemID);
        if (!switched) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Ignoring: failed to sync to item ${event.parentItemID}`,
          );
          return;
        }
      }

      // Ensure we have entries loaded
      if (!this.allEntries?.length) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] No entries loaded yet, showing loading message`,
        );
        this.showToast(getString("references-panel-status-loading"));
        return;
      }

      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Processing lookup: viewMode=${this.viewMode}, entriesCount=${this.allEntries.length}`,
      );

      // Citation lookup only works on References tab (where the reference list matches PDF)
      if (this.viewMode !== "references") {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Warning: viewMode is ${this.viewMode}, not "references" - match may fail`,
        );
      }

      // Build label matcher if not exists or entries changed
      if (!this.labelMatcher) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Building new LabelMatcher for ${this.allEntries.length} entries`,
        );
        this.labelMatcher = new LabelMatcher(this.allEntries);
        this.pdfParseAttempted = false; // Reset flag when labelMatcher is rebuilt

        // FTR-PDF-PARSE-PRELOAD: Check for preloaded PDF mapping from background parsing
        const reader = getReaderIntegration();
        const preloadedMapping = reader.getPreloadedPDFMapping(
          event.parentItemID,
        );
        const preloadedAuthorYear = reader.getPreloadedAuthorYearMapping(
          event.parentItemID,
        );

        if (preloadedMapping) {
          this.labelMatcher.setPDFMapping(preloadedMapping);
          this.pdfParseAttempted = true;
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Applied preloaded PDF mapping (${preloadedMapping.totalLabels} labels)`,
          );
        }
        if (preloadedAuthorYear) {
          this.labelMatcher.setAuthorYearMapping(preloadedAuthorYear);
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Applied preloaded author-year mapping (${preloadedAuthorYear.authorYearMap.size} entries)`,
          );
        }

        // FTR-OVERLAY-REFS: Try to build/apply overlay mapping for numeric citations
        // Overlay mapping provides the most accurate citation→reference links for [1], [2], etc.
        // IMPORTANT: Only use for numeric citations; Author-Year uses matchAuthorYear() instead
        if (
          event.readerTabID &&
          event.citation.type !== "author-year" &&
          event.citation.type !== "arxiv"
        ) {
          const cachedOverlay = reader.getOverlayMapping(event.parentItemID);
          if (cachedOverlay?.isReliable) {
            this.labelMatcher.setOverlayMapping(cachedOverlay);
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] Applied cached overlay mapping (${cachedOverlay.totalMappedLabels} labels)`,
            );
          } else {
            // Build overlay mapping lazily on first lookup
            const currentReader = ReaderTabHelper.getReaderByTabID(
              event.readerTabID,
            );
            if (currentReader) {
              const overlayMapping =
                await reader.buildMappingFromOverlays(currentReader);
              if (overlayMapping?.isReliable) {
                this.labelMatcher.setOverlayMapping(overlayMapping);
                Zotero.debug(
                  `[${config.addonName}] [PDF-ANNOTATE] Built and applied overlay mapping (${overlayMapping.totalMappedLabels} labels)`,
                );
              } else {
                Zotero.debug(
                  `[${config.addonName}] [PDF-ANNOTATE] Overlay mapping unavailable or unreliable (OCR PDF?)`,
                );
              }
            }
          }
        }
      }

      // FTR-PDF-ANNOTATE-MULTI-LABEL: Check if PDF parsing is needed (even if labelMatcher exists)
      // This allows PDF parsing to be triggered if the preference was enabled after first lookup
      const report = this.labelMatcher.diagnoseAlignment();
      const pdfParseEnabled = getPref("pdf_parse_refs_list") === true;
      const hasPDFMapping = this.labelMatcher.hasPDFMapping?.() ?? false;

      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] State: pdfParseEnabled=${pdfParseEnabled}, pdfParseAttempted=${this.pdfParseAttempted}, hasPDFMapping=${hasPDFMapping}, recommendation=${report.recommendation}`,
      );

      // Try PDF parsing if: enabled + labels missing + no existing mapping
      // NOTE: Allow retry if previous attempt failed (pdfParseAttempted but no mapping)
      // FTR-PDF-PARSE-PRELOAD: Skip if preloaded mapping was already applied
      const forcePDFStrict = getPref("pdf_force_mapping_on_mismatch") !== false;
      const labelAvail = report.labelAvailableCount ?? 0;
      const labelRate =
        report.totalEntries > 0 ? labelAvail / report.totalEntries : 0;
      const wellAlignedLabels =
        report.recommendation === "USE_INSPIRE_LABEL" && labelRate >= 0.95;
      const shouldAttemptPDFParse =
        pdfParseEnabled &&
        !hasPDFMapping &&
        report.totalEntries > 0 &&
        // 原逻辑：标签几乎缺失
        (report.recommendation === "USE_INDEX_ONLY" ||
          // 新增：标签对齐不足（需要参考 PDF）
          report.recommendation === "USE_INDEX_WITH_FALLBACK" ||
          // 新增：强制偏好开启时，仅在标签未高对齐时尝试 PDF 解析
          (forcePDFStrict && !wellAlignedLabels));

      if (shouldAttemptPDFParse) {
        const labelRateStr = report.labelAvailableCount
          ? ((report.labelAvailableCount / report.totalEntries) * 100).toFixed(
              0,
            )
          : "0";
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ⚠️ WARNING: Label data mostly missing (${labelRateStr}% available). Attempting PDF parsing...`,
        );

        // FTR-PDF-ANNOTATE-MULTI-LABEL: AWAIT PDF parsing before matching
        try {
          const parseSuccess = await this.tryParsePDFReferences(
            event.parentItemID,
          );
          if (parseSuccess) {
            this.pdfParseAttempted = true; // Only mark as attempted if successful
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] PDF parsing completed successfully`,
            );
          } else {
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] PDF parsing completed but no mapping created`,
            );
          }
        } catch (err) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] PDF parsing failed: ${err}`,
          );
        }
      } else if (
        !pdfParseEnabled &&
        report.recommendation === "USE_INDEX_ONLY" &&
        report.totalEntries > 0
      ) {
        // Only show warning toast if PDF parsing is disabled
        const labelRateStr = report.labelAvailableCount
          ? ((report.labelAvailableCount / report.totalEntries) * 100).toFixed(
              0,
            )
          : "0";
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ⚠️ WARNING: Label data mostly missing (${labelRateStr}% available). PDF parsing disabled. Using index-based fallback.`,
        );
        // Only show toast once per session (first lookup)
        if (!this.pdfParseAttempted) {
          this.pdfParseAttempted = true;
          this.showToast(
            getString("pdf-annotate-fallback-warning", {
              args: { rate: labelRateStr },
            }),
          );
        }
      }

      // FTR-PDF-ANNOTATE-MULTI-LABEL: Try to match all citation labels and get all matches
      // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Use matchAuthorYear for author-year citation format
      const citation = event.citation;
      let allMatches: MatchResult[];

      if (citation.type === "author-year") {
        // Author-year citation: use matchAuthorYear method
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Using author-year matching for labels [${citation.labels.join(",")}]`,
        );
        allMatches = this.labelMatcher.matchAuthorYear(citation.labels);
      } else {
        // Numeric or other citation types: use standard matchAll
        allMatches = this.labelMatcher.matchAll(citation.labels);
      }

      if (allMatches.length > 0) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Found ${allMatches.length} match(es) for labels [${citation.labels.join(",")}]`,
        );

        // Log individual matches for debugging
        for (const match of allMatches) {
          const isIndexFallback =
            match.matchMethod === "inferred" && match.confidence === "low";
          const warningPrefix = isIndexFallback ? "⚠️ INDEX FALLBACK: " : "";
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] ${warningPrefix}Match: [${match.pdfLabel}] -> index ${match.entryIndex}, entryId=${match.entryId}, method=${match.matchMethod}, confidence=${match.confidence}`,
          );
        }

        // FTR-AMBIGUOUS-AUTHOR-YEAR: Handle ambiguous matches with picker UI
        const firstMatch = allMatches[0];
        if (
          firstMatch.isAmbiguous &&
          firstMatch.ambiguousCandidates &&
          firstMatch.ambiguousCandidates.length > 1
        ) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Ambiguous match detected with ${firstMatch.ambiguousCandidates.length} candidates, showing picker`,
          );

          // Show picker UI for user to select the correct match
          const citationText = citation.raw || firstMatch.pdfLabel;
          const pickerContainer =
            this.body || Zotero.getMainWindow()?.document.body;
          if (pickerContainer) {
            // FTR-HOVER-PREVIEW: Hide preview card before showing picker to avoid visual conflict
            this.hidePreviewCard();

            const selection = await showAmbiguousCitationPicker(
              citationText,
              firstMatch.ambiguousCandidates,
              pickerContainer as HTMLElement,
            );

            if (selection) {
              // User selected a candidate - update allMatches to use selected entry
              Zotero.debug(
                `[${config.addonName}] [PDF-ANNOTATE] User selected candidate: entryIndex=${selection.candidate.entryIndex}`,
              );
              allMatches = [
                {
                  pdfLabel: firstMatch.pdfLabel,
                  entryIndex: selection.candidate.entryIndex,
                  entryId: selection.candidate.entryId,
                  confidence: "high",
                  matchMethod: "exact",
                },
              ];
            } else {
              // User cancelled - don't scroll to anything
              Zotero.debug(
                `[${config.addonName}] [PDF-ANNOTATE] User cancelled ambiguous picker`,
              );
              return;
            }
          }
        }

        // Ensure INSPIRE pane is visible before scrolling
        const paneActivated = this.ensureINSPIREPaneVisible();
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible result: ${paneActivated}`,
        );

        // Give the UI time to update if we just activated the pane
        // Then scroll to and highlight the matched entries
        const doScrollAndHighlight = () => {
          // Check if DOM is ready
          if (!this.listEl || !this.body?.isConnected) {
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] doScrollAndHighlight: DOM not ready, retrying in 100ms`,
            );
            setTimeout(doScrollAndHighlight, 100);
            return;
          }
          // Check if list has children (content is rendered)
          const listElChildren = this.listEl?.children?.length ?? 0;
          if (listElChildren === 0 && this.allEntries.length > 0) {
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] doScrollAndHighlight: forcing re-render (no children)`,
            );
            this.renderReferenceList({ preserveScroll: false });
          }

          // Scroll to first match
          const firstIndex = allMatches[0].entryIndex;
          this.scrollToEntryByIndex(firstIndex);

          // FTR-PDF-ANNOTATE-MULTI-LABEL: Highlight all matches (with limit)
          const MAX_HIGHLIGHT = 20;
          const toHighlight = allMatches.slice(0, MAX_HIGHLIGHT);
          this.highlightEntryRows(toHighlight.map((m) => m.entryIndex));

          // Show toast if multiple matches or truncated; include missing info if any
          if (allMatches.length > 1) {
            const labelsStr = citation.labels.join(", ");
            let msg =
              allMatches.length > MAX_HIGHLIGHT
                ? getString("pdf-annotate-multi-match-truncated", {
                    args: {
                      label: labelsStr,
                      count: allMatches.length,
                      shown: MAX_HIGHLIGHT,
                    },
                  })
                : getString("pdf-annotate-multi-match", {
                    args: { label: labelsStr, count: allMatches.length },
                  });
            // Append missing info (first missing author/year) if label had extra PDF refs not found
            if (citation.labels.length === 1 && this.labelMatcher) {
              const miss = this.labelMatcher.getMismatchForLabel(
                citation.labels[0],
              );
              if (miss?.missing?.length) {
                const firstMissing = miss.missing[0];
                const missingStr =
                  `${firstMissing.firstAuthorLastName ?? "?"} ${firstMissing.year ?? ""}`.trim();
                msg = `${msg} (missing in INSPIRE: ${missingStr})`;
              }
            }
            this.showToast(msg);
          }
        };

        if (paneActivated) {
          // Longer delay when item pane was collapsed - it needs time to render
          setTimeout(doScrollAndHighlight, SCROLL_HIGHLIGHT_DELAY_MS);
        } else {
          // Pane already visible, scroll immediately
          doScrollAndHighlight();
        }
        return;
      }

      // No match found - show notification
      const labelsStr = citation.labels.join(", ");
      let notFoundMsg = getString("pdf-annotate-not-found", {
        args: { label: labelsStr },
      });
      if (citation.labels.length === 1 && this.labelMatcher) {
        const miss = this.labelMatcher.getMismatchForLabel(citation.labels[0]);
        if (miss?.missing?.length) {
          const firstMissing = miss.missing[0];
          const missingStr =
            `${firstMissing.firstAuthorLastName ?? "?"} ${firstMissing.year ?? ""}`.trim();
          notFoundMsg = `${notFoundMsg} (missing in INSPIRE: ${missingStr})`;
        }
      }
      this.showToast(notFoundMsg);
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] No match found for any label in [${labelsStr}]`,
      );
    } finally {
      const clearKey = this.citationInFlightKey;
      this.citationInFlightKey = undefined;
      if (clearKey) {
        setTimeout(() => {
          if (
            InspireReferencePanelController.globalCitationInFlightKey ===
            clearKey
          ) {
            InspireReferencePanelController.globalCitationInFlightKey =
              undefined;
          }
        }, 400);
      }
    }
  }

  /**
   * Sync controller state to the PDF parent item when citation events come from a different item.
   * Loads references so label matching can proceed.
   */
  private async ensureItemForCitation(itemID: number): Promise<boolean> {
    const item = Zotero.Items.get(itemID);
    if (!item || !item.isRegularItem()) {
      return false;
    }

    // If already showing this item and have entries, no-op
    if (this.currentItemID === itemID && this.allEntries?.length) {
      return true;
    }

    // Switch to references view to keep mapping consistent
    this.viewMode = "references";
    this.labelMatcher = undefined;
    this.pdfParseAttempted = false;
    this.currentItemID = itemID;

    const recid =
      deriveRecidFromItem(item) ?? (await fetchRecidFromInspire(item));
    if (!recid) {
      this.currentRecid = undefined;
      this.allEntries = [];
      this.renderChartImmediate();
      this.renderMessage(getString("references-panel-no-recid"));
      this.lastRenderedEntries = [];
      return false;
    }

    this.currentRecid = recid;
    this.updateSortSelector();
    try {
      await this.loadEntries(recid, "references");
      return this.allEntries?.length > 0;
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ensureItemForCitation load error: ${err}`,
        );
      }
      return false;
    }
  }

  /**
   * FTR-RECID-AUTO-UPDATE: Handle event when recid becomes available for an item.
   * Called when an item that was previously opened without recid now has one.
   * Shows a toast notification and refreshes the panel with the new data.
   */
  private async handleRecidBecameAvailable(
    itemID: number,
    recid: string,
  ): Promise<void> {
    // Verify this is still the current item
    if (this.currentItemID !== itemID) {
      return;
    }

    Zotero.debug(
      `[${config.addonName}] [RECID-AUTO-UPDATE] handleRecidBecameAvailable: item ${itemID}, recid ${recid}`,
    );

    // Show notification to user
    this.showToast(getString("references-panel-recid-found"));

    // Update current recid and load entries
    this.currentRecid = recid;
    this.updateSortSelector();

    // Reset view mode to references if not already
    if (this.viewMode !== "references") {
      this.viewMode = "references";
      this.updateTabSelection();
    }

    // Load entries with the new recid
    try {
      await this.loadEntries(recid, "references");
      Zotero.debug(
        `[${config.addonName}] [RECID-AUTO-UPDATE] Successfully loaded ${this.allEntries.length} entries for item ${itemID}`,
      );
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        Zotero.debug(
          `[${config.addonName}] [RECID-AUTO-UPDATE] Failed to load entries: ${err}`,
        );
        this.allEntries = [];
        this.renderChartImmediate();
        this.renderMessage(getString("references-panel-status-error"));
      }
    }
  }

  /**
   * FTR-RECID-AUTO-UPDATE: Handle event when item has no recid.
   * Shows the "no recid" message immediately instead of trying to load.
   */
  private handleNoRecid(itemID: number): void {
    // Verify this is still the current item
    if (this.currentItemID !== itemID) {
      return;
    }

    Zotero.debug(
      `[${config.addonName}] [RECID-AUTO-UPDATE] handleNoRecid: item ${itemID}`,
    );

    // Clear any loading state and show no-recid message
    this.currentRecid = undefined;
    this.allEntries = [];
    this.renderChartImmediate();
    this.renderMessage(getString("references-panel-no-recid"));
    this.lastRenderedEntries = [];
    this.updateSortSelector();
  }

  /**
   * FTR-HOVER-PREVIEW: Handle citation preview request from PDF reader lookup button.
   * Finds the matching entry and shows preview card at button position.
   * FTR-HOVER-PREVIEW-FIX: Now supports previewing when panel shows a different item
   * by fetching entries from cache.
   * FTR-HOVER-PREVIEW-MULTI: Now passes all matching entries for pagination.
   */
  private async handleCitationPreviewRequest(
    event: CitationPreviewEvent,
  ): Promise<void> {
    Zotero.debug(
      `[${config.addonName}] [HOVER-PREVIEW] handleCitationPreviewRequest: event.parentItemID=${event.parentItemID}, this.currentItemID=${this.currentItemID}, label=${event.label}, labels=${event.labels.join(",")}`,
    );

    // Determine which entries to use
    let entries: InspireReferenceEntry[] | undefined;
    let labelMatcher: LabelMatcher | undefined;

    if (this.currentItemID === event.parentItemID) {
      // Panel has matching item - use its entries
      entries = this.allEntries;

      // FTR-HOVER-PREVIEW-FIX: If labelMatcher doesn't exist yet (user hasn't clicked lookup),
      // create and save it to this.labelMatcher so it's shared with click lookup
      if (!this.labelMatcher && entries && entries.length > 0) {
        Zotero.debug(
          `[${config.addonName}] [HOVER-PREVIEW] this.labelMatcher not available, creating and saving`,
        );
        this.labelMatcher = new LabelMatcher(entries);
        this.pdfParseAttempted = false; // Reset flag when labelMatcher is created

        // Apply mappings just like handleCitationLookup does
        const reader = getReaderIntegration();

        // Apply preloaded PDF mapping
        const preloadedMapping = reader.getPreloadedPDFMapping(
          event.parentItemID,
        );
        if (preloadedMapping) {
          this.labelMatcher.setPDFMapping(preloadedMapping);
          this.pdfParseAttempted = true;
          Zotero.debug(
            `[${config.addonName}] [HOVER-PREVIEW] Applied preloaded PDF mapping (${preloadedMapping.totalLabels} labels)`,
          );
        }

        // Apply author-year mapping
        const preloadedAuthorYear = reader.getPreloadedAuthorYearMapping(
          event.parentItemID,
        );
        if (preloadedAuthorYear) {
          this.labelMatcher.setAuthorYearMapping(preloadedAuthorYear);
          Zotero.debug(
            `[${config.addonName}] [HOVER-PREVIEW] Applied preloaded author-year mapping (${preloadedAuthorYear.authorYearMap.size} entries)`,
          );
        }

        // Apply overlay mapping for numeric citations (most accurate)
        if (event.citationType === "numeric" && event.readerTabID) {
          const cachedOverlay = reader.getOverlayMapping(event.parentItemID);
          if (cachedOverlay?.isReliable) {
            this.labelMatcher.setOverlayMapping(cachedOverlay);
            Zotero.debug(
              `[${config.addonName}] [HOVER-PREVIEW] Applied cached overlay mapping (${cachedOverlay.totalMappedLabels} labels)`,
            );
          } else {
            // Try to build overlay mapping from current reader
            const currentReader = ReaderTabHelper.getReaderByTabID(
              event.readerTabID,
            );
            if (currentReader) {
              const overlayMapping =
                await reader.buildMappingFromOverlays(currentReader);
              if (overlayMapping?.isReliable) {
                this.labelMatcher.setOverlayMapping(overlayMapping);
                Zotero.debug(
                  `[${config.addonName}] [HOVER-PREVIEW] Built overlay mapping (${overlayMapping.totalMappedLabels} labels)`,
                );
              }
            }
          }
        }
      }

      labelMatcher = this.labelMatcher;
    } else {
      // Panel shows different item - try to get entries from cache
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] currentItemID mismatch, trying cache for parentItemID=${event.parentItemID}`,
      );

      // Get recid for the PDF's parent item
      const parentItem = Zotero.Items.get(event.parentItemID);
      if (parentItem) {
        const recid = deriveRecidFromItem(parentItem);
        if (recid) {
          // Try to get entries from cache
          const cached = await localCache.get<InspireReferenceEntry[]>(
            "refs",
            recid,
          );
          if (cached?.data && cached.data.length > 0) {
            entries = cached.data;
            // Create a temporary LabelMatcher for matching
            labelMatcher = new LabelMatcher(entries);
            Zotero.debug(
              `[${config.addonName}] [HOVER-PREVIEW] Loaded ${entries.length} entries from cache for recid=${recid}`,
            );

            // FTR-HOVER-PREVIEW-FULL: Apply mappings to temp LabelMatcher for full matching capability
            // This enables multi-entry lookup (overlay) and author-year matching
            const reader = getReaderIntegration();

            // Apply preloaded PDF mapping if available
            const preloadedMapping = reader.getPreloadedPDFMapping(
              event.parentItemID,
            );
            if (preloadedMapping) {
              labelMatcher.setPDFMapping(preloadedMapping);
              Zotero.debug(
                `[${config.addonName}] [HOVER-PREVIEW] Applied preloaded PDF mapping (${preloadedMapping.totalLabels} labels)`,
              );
            }

            // Apply author-year mapping for author-year citation support
            const preloadedAuthorYear = reader.getPreloadedAuthorYearMapping(
              event.parentItemID,
            );
            if (preloadedAuthorYear) {
              labelMatcher.setAuthorYearMapping(preloadedAuthorYear);
              Zotero.debug(
                `[${config.addonName}] [HOVER-PREVIEW] Applied preloaded author-year mapping (${preloadedAuthorYear.authorYearMap.size} entries)`,
              );
            }

            // Apply overlay mapping for multi-entry support (numeric citations)
            if (event.citationType === "numeric" && event.readerTabID) {
              const cachedOverlay = reader.getOverlayMapping(
                event.parentItemID,
              );
              if (cachedOverlay?.isReliable) {
                labelMatcher.setOverlayMapping(cachedOverlay);
                Zotero.debug(
                  `[${config.addonName}] [HOVER-PREVIEW] Applied cached overlay mapping (${cachedOverlay.totalMappedLabels} labels)`,
                );
              } else {
                // Try to build overlay mapping from current reader
                const currentReader = ReaderTabHelper.getReaderByTabID(
                  event.readerTabID,
                );
                if (currentReader) {
                  const overlayMapping =
                    await reader.buildMappingFromOverlays(currentReader);
                  if (overlayMapping?.isReliable) {
                    labelMatcher.setOverlayMapping(overlayMapping);
                    Zotero.debug(
                      `[${config.addonName}] [HOVER-PREVIEW] Built overlay mapping (${overlayMapping.totalMappedLabels} labels)`,
                    );
                  }
                }
              }
            }
          }
        }
      }
    }

    // Need entries loaded
    if (!entries || entries.length === 0) {
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] Skipping: no entries available`,
      );
      return;
    }

    // Find ALL matching entries based on label and citation type
    // FTR-HOVER-PREVIEW-MULTI: Collect all matches for pagination
    const matchedEntries: InspireReferenceEntry[] = [];

    if (event.citationType === "numeric") {
      // For numeric citations, use labelMatcher.match() which uses overlay mapping
      // No fallback to index-based matching - if match() returns empty, the label
      // is not in INSPIRE references (e.g., footnotes), so don't show preview
      if (labelMatcher) {
        const matches = labelMatcher.match(event.label);
        for (const match of matches) {
          const entry = entries[match.entryIndex];
          if (entry && !matchedEntries.includes(entry)) {
            matchedEntries.push(entry);
          }
        }
      }
    } else if (event.citationType === "author-year" && labelMatcher) {
      // For author-year, use matchAuthorYear with all labels for proper matching
      const matches = labelMatcher.matchAuthorYear(event.labels);

      // FTR-HOVER-PREVIEW-MATCH-CONSISTENCY: Match click handler behavior exactly:
      // - If first match is marked as ambiguous with candidates, show all candidates
      // - Otherwise, only show the first match (same as click handler scrolls to first)
      // This ensures hover preview and click produce identical results
      if (matches.length > 0) {
        const firstMatch = matches[0];

        if (
          firstMatch.isAmbiguous &&
          firstMatch.ambiguousCandidates &&
          firstMatch.ambiguousCandidates.length > 1
        ) {
          // Ambiguous match with candidates - show all candidates for pagination
          Zotero.debug(
            `[${config.addonName}] [HOVER-PREVIEW] Ambiguous author-year match with ${firstMatch.ambiguousCandidates.length} candidates`,
          );
          for (const candidate of firstMatch.ambiguousCandidates) {
            const entry = entries[candidate.entryIndex];
            if (entry && !matchedEntries.includes(entry)) {
              matchedEntries.push(entry);
            }
          }
        } else {
          // Non-ambiguous: only show the first match (like click handler does)
          const entry = entries[firstMatch.entryIndex];
          if (entry) {
            matchedEntries.push(entry);
          }
          Zotero.debug(
            `[${config.addonName}] [HOVER-PREVIEW] Non-ambiguous author-year match: showing only first result (total matches=${matches.length})`,
          );
        }
      }
    }

    if (matchedEntries.length === 0) {
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] No entry found for label: ${event.label}`,
      );
      return;
    }

    // FTR-HOVER-PREVIEW-PERF: Enrich localItemID for matched entries from cache
    // This enables instant abstract loading from local library instead of API fetch
    if (this.currentItemID !== event.parentItemID) {
      // Entries came from cache - need to populate localItemID
      const recidsToCheck = matchedEntries
        .map((e) => e.recid)
        .filter((r): r is string => !!r);
      if (recidsToCheck.length > 0) {
        const fieldID = Zotero.ItemFields.getID("archiveLocation");
        if (fieldID) {
          const placeholders = recidsToCheck.map(() => "?").join(",");
          const sql = `SELECT itemID, value FROM itemData JOIN itemDataValues USING(valueID) WHERE fieldID = ? AND value IN (${placeholders})`;
          try {
            const rows = await Zotero.DB.queryAsync(sql, [
              fieldID,
              ...recidsToCheck,
            ]);
            if (rows) {
              const recidMap = new Map<string, number>();
              for (const row of rows) {
                recidMap.set(row.value, Number(row.itemID));
              }
              // Apply localItemID to matched entries
              for (const entry of matchedEntries) {
                if (entry.recid && recidMap.has(entry.recid)) {
                  entry.localItemID = recidMap.get(entry.recid);
                  Zotero.debug(
                    `[${config.addonName}] [HOVER-PREVIEW] Set localItemID=${entry.localItemID} for entry ${entry.recid}`,
                  );
                }
              }
            }
          } catch (e) {
            Zotero.debug(
              `[${config.addonName}] [HOVER-PREVIEW] Error enriching localItemID: ${e}`,
            );
          }
        }
      }
    }

    Zotero.debug(
      `[${config.addonName}] [HOVER-PREVIEW] Found ${matchedEntries.length} entries for label [${event.label}]: ${matchedEntries[0].title?.substring(0, 50)}...`,
    );

    // Show preview card at button position with all matched entries
    // FTR-HOVER-PREVIEW-MULTI: Pass all entries for pagination
    // FTR-AMBIGUOUS-AUTHOR-YEAR: Pass citation type to show appropriate message
    this.showPreviewCardAtRect(
      matchedEntries,
      event.buttonRect,
      event.label,
      event.citationType,
    );
  }

  /**
   * Get row element for entry, checking cache first then DOM.
   * Updates cache if found in DOM.
   * @param entryId - Entry ID to find row for
   * @returns HTMLElement if found, undefined otherwise
   */
  private getEntryRow(entryId: string): HTMLElement | undefined {
    // Check cache first
    let row = this.rowCache.get(entryId);

    // Verify cached row is still connected to DOM
    if (row && !row.isConnected) {
      Zotero.debug(
        `[${config.addonName}] getEntryRow: cached row for ${entryId} is disconnected, looking up in DOM`,
      );
      row = undefined;
    }

    // Fallback to DOM lookup
    if (!row && this.listEl) {
      row =
        (this.listEl.querySelector(
          `[data-entry-id="${entryId}"]`,
        ) as HTMLElement | null) ?? undefined;
      if (row) {
        this.rowCache.set(entryId, row);
        Zotero.debug(
          `[${config.addonName}] getEntryRow: found row in DOM for ${entryId}`,
        );
      }
    }

    return row;
  }

  /**
   * Scroll the list to show entry at the given index.
   */
  private scrollToEntryByIndex(index: number): void {
    const entry = this.allEntries[index];
    if (!entry) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] scrollToEntryByIndex: no entry at index ${index}`,
      );
      return;
    }

    const row = this.getEntryRow(entry.id);

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] scrollToEntryByIndex: index=${index}, entryId=${entry.id}, rowFound=${!!row}, isConnected=${row?.isConnected ?? false}, listEl=${!!this.listEl}`,
    );

    if (row && this.listEl) {
      // Scroll row into view with smooth behavior
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] scrollIntoView called for entry ${entry.id}`,
      );
    } else if (!row) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] scrollToEntryByIndex: WARNING - row not found for entry ${entry.id}`,
      );
    }
  }

  /**
   * Highlight an entry row temporarily.
   */
  private highlightEntryRow(index: number): void {
    const entry = this.allEntries[index];
    if (!entry) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] highlightEntryRow: no entry at index ${index}`,
      );
      return;
    }

    const row = this.getEntryRow(entry.id);

    if (!row) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] highlightEntryRow: row not found for entry ${entry.id}`,
      );
      return;
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] highlightEntryRow: adding highlight to entry ${entry.id}`,
    );

    // Remove any previous highlight
    const prev = this.listEl?.querySelector(".zinspire-entry-highlight");
    if (prev) {
      prev.classList.remove("zinspire-entry-highlight");
    }

    // Add highlight class (temporary pulse animation)
    row.classList.add("zinspire-entry-highlight");

    // FTR-FOCUSED-SELECTION: Set focused entry (persistent selection)
    this.setFocusedEntry(entry.id);

    // Auto-remove temporary highlight after animation, but keep focused state
    setTimeout(() => {
      row.classList.remove("zinspire-entry-highlight");
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] temporary highlight removed from entry ${entry.id}, focused state kept`,
      );
    }, 2500);
  }

  /**
   * Try to parse PDF reference list and apply mapping to LabelMatcher.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: Scans PDF's References section to fix label alignment.
   * FTR-PDF-PARSE-PRELOAD: Checks preload cache first to avoid duplicate work.
   * @param parentItemID - The Zotero item ID (parent of PDF)
   * @returns true if mapping was successfully applied, false otherwise
   */
  private async tryParsePDFReferences(parentItemID: number): Promise<boolean> {
    // FTR-PDF-PARSE-PRELOAD: Check preload cache first to avoid duplicate parsing
    const reader = getReaderIntegration();
    const preloadedMapping = reader.getPreloadedPDFMapping(parentItemID);
    if (preloadedMapping && this.labelMatcher) {
      this.labelMatcher.setPDFMapping(preloadedMapping);
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Using preloaded mapping (${preloadedMapping.totalLabels} labels)`,
      );
      // Also check for author-year mapping
      const preloadedAuthorYear =
        reader.getPreloadedAuthorYearMapping(parentItemID);
      if (preloadedAuthorYear) {
        this.labelMatcher.setAuthorYearMapping(preloadedAuthorYear);
      }
      return true;
    }

    // FTR-PDF-PARSE-PRELOAD: If preload is in progress, wait briefly then check again
    if (reader.isPDFParsingInProgress(parentItemID)) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Preload in progress, waiting...`,
      );
      // Wait up to 2 seconds for preload to complete
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!reader.isPDFParsingInProgress(parentItemID)) {
          const mapping = reader.getPreloadedPDFMapping(parentItemID);
          if (mapping && this.labelMatcher) {
            this.labelMatcher.setPDFMapping(mapping);
            const authorYear =
              reader.getPreloadedAuthorYearMapping(parentItemID);
            if (authorYear) {
              this.labelMatcher.setAuthorYearMapping(authorYear);
            }
            Zotero.debug(
              `[${config.addonName}] [PDF-PARSE] Preload completed, using cached mapping`,
            );
            return true;
          }
          break;
        }
      }
    }

    const { getPDFReferencesParser } =
      await import("./inspire/pdfAnnotate/pdfReferencesParser");

    // Get the parent item and find its PDF attachment
    const item = Zotero.Items.get(parentItemID);
    if (!item) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Item ${parentItemID} not found`,
      );
      return false;
    }

    // Find PDF attachment
    const attachments = item.getAttachments();
    let pdfPath: string | null = null;
    let pdfAttachmentID: number | null = null;

    for (const attachmentID of attachments) {
      const attachment = Zotero.Items.get(attachmentID);
      if (attachment?.attachmentContentType === "application/pdf") {
        const filePath = await attachment.getFilePathAsync();
        if (filePath) {
          pdfPath = filePath;
          pdfAttachmentID = attachmentID;
        }
        break;
      }
    }

    if (!pdfPath || !pdfAttachmentID) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] No PDF attachment found for item ${parentItemID}`,
      );
      return false;
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-PARSE] Found PDF: ${pdfPath} (attachment ${pdfAttachmentID})`,
    );

    // Extract text from PDF (last few pages where References usually are)
    try {
      // Use Zotero's fulltext cache to extract text
      const pdfText = await this.extractPDFTextForReferences(
        pdfPath,
        pdfAttachmentID,
      );
      if (!pdfText) {
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Could not extract text from PDF`,
        );
        return false;
      }

      // Parse the reference list
      const parser = getPDFReferencesParser();
      const mapping = parser.parseReferencesSection(pdfText);

      if (mapping && this.labelMatcher) {
        this.labelMatcher.setPDFMapping(mapping);

        // FTR-PDF-PARSE-PRELOAD: Cache to readerIntegration for future use
        getReaderIntegration().setPreloadedPDFMapping(parentItemID, mapping);

        // FTR-PDF-MATCHING: Calculate and store max label for concatenated range detection
        // Set for attachment ID since reader.itemID is the attachment
        const labelNums = Array.from(mapping.labelCounts.keys())
          .map((l) => parseInt(l, 10))
          .filter((n) => !isNaN(n));
        if (labelNums.length > 0 && pdfAttachmentID) {
          const maxLabel = Math.max(...labelNums);
          getReaderIntegration().setMaxKnownLabel(pdfAttachmentID, maxLabel);
        }

        const multiCount = Array.from(mapping.labelCounts.values()).filter(
          (c) => c > 1,
        ).length;
        this.showToast(
          getString("pdf-annotate-parse-success", {
            args: {
              total: mapping.totalLabels,
              multi: multiCount,
            },
          }),
        );
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Successfully applied PDF mapping`,
        );
        // Don't return yet - also try author-year parsing for RMP-style papers
      }

      // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Always try author-year format parsing
      // This is needed for RMP-style papers that use author-year citations like "(Cho et al., 2011a)"
      // even if numeric parsing succeeded (the paper may have both numeric and author-year citations)
      if (this.labelMatcher) {
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Trying author-year format parsing (regardless of numeric result)...`,
        );

        const authorYearMapping =
          parser.parseAuthorYearReferencesSection(pdfText);
        if (authorYearMapping && authorYearMapping.authorYearMap.size >= 5) {
          this.labelMatcher.setAuthorYearMapping(authorYearMapping);
          // FTR-PDF-PARSE-PRELOAD: Cache to readerIntegration for future use
          getReaderIntegration().setPreloadedAuthorYearMapping(
            parentItemID,
            authorYearMapping,
          );
          Zotero.debug(
            `[${config.addonName}] [PDF-PARSE] Successfully applied author-year mapping with ${authorYearMapping.authorYearMap.size} entries`,
          );
        } else {
          Zotero.debug(
            `[${config.addonName}] [PDF-PARSE] Author-year parsing found ${authorYearMapping?.authorYearMap.size ?? 0} entries (not enough)`,
          );
        }
      }

      // Return true if we got either numeric or author-year mapping
      if (mapping && mapping.totalLabels > 0) {
        return true;
      }

      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] No valid mapping created from PDF`,
      );
      return false;
    } catch (err) {
      Zotero.debug(`[${config.addonName}] [PDF-PARSE] Error: ${err}`);
      return false;
    }
  }

  /**
   * Extract text from PDF for reference list parsing.
   * Reads from Zotero's fulltext cache files (.zotero-ft-cache) directly.
   * Uses Zotero.Fulltext.getItemCacheFile() API when available.
   *
   * @param pdfPath - Path to the PDF file
   * @param attachmentID - The Zotero attachment item ID
   */
  private async extractPDFTextForReferences(
    pdfPath: string,
    attachmentID: number,
  ): Promise<string | null> {
    try {
      // Method 0: Prefer Zotero.Fulltext.getItemCacheFile() API (most reliable)
      if (
        attachmentID &&
        typeof Zotero.Fulltext?.getItemCacheFile === "function"
      ) {
        try {
          const item = Zotero.Items.get(attachmentID);
          if (item) {
            const cacheFile = Zotero.Fulltext.getItemCacheFile(item);
            if (cacheFile?.exists?.()) {
              const content = await Zotero.File.getContentsAsync(
                cacheFile.path,
              );
              const text = typeof content === "string" ? content : null;
              if (text && text.length > 100) {
                Zotero.debug(
                  `[${config.addonName}] [PDF-PARSE] Got ${text.length} chars from fulltext cache (via API)`,
                );
                return text;
              }
            }
          }
        } catch (e) {
          Zotero.debug(
            `[${config.addonName}] [PDF-PARSE] getItemCacheFile error: ${e}`,
          );
        }
      }

      // Method 1: Try to read the fulltext cache file directly
      // Zotero stores fulltext cache in the same directory as the PDF
      // with the naming pattern: .zotero-ft-cache
      const cacheFileName = ".zotero-ft-cache";
      const pdfDir = pdfPath.substring(0, pdfPath.lastIndexOf("/"));
      const cachePath = `${pdfDir}/${cacheFileName}`;

      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Looking for fulltext cache at: ${cachePath}`,
      );

      try {
        // Check if cache file exists
        const cacheExists = await IOUtils.exists(cachePath);
        if (cacheExists) {
          // Read the cache file
          const cacheData = await IOUtils.read(cachePath);
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(cacheData);

          if (text && text.length > 100) {
            Zotero.debug(
              `[${config.addonName}] [PDF-PARSE] Got ${text.length} chars from fulltext cache file (full text, no tail truncation)`,
            );
            return text;
          }
          Zotero.debug(
            `[${config.addonName}] [PDF-PARSE] Cache file exists but has insufficient content (${text?.length || 0} chars)`,
          );
        } else {
          Zotero.debug(
            `[${config.addonName}] [PDF-PARSE] No fulltext cache file found at ${cachePath}`,
          );
        }
      } catch (e) {
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Error reading cache file: ${e}`,
        );
      }

      // Method 2: Try using Zotero's Fulltext.getItemWords (if available)
      // This returns an array of words, which we can join

      const fulltext = Zotero.Fulltext as any;
      if (fulltext) {
        // Try getItemWords first (returns words array)
        if (typeof fulltext.getItemWords === "function") {
          try {
            const words = await fulltext.getItemWords(attachmentID);
            if (words && words.length > 0) {
              const text = words.join(" ");
              Zotero.debug(
                `[${config.addonName}] [PDF-PARSE] Got ${text.length} chars from getItemWords (full text, no tail truncation)`,
              );
              return text;
            }
          } catch (e) {
            Zotero.debug(
              `[${config.addonName}] [PDF-PARSE] getItemWords error: ${e}`,
            );
          }
        }

        // Try getTextForItem (alternative API)
        if (typeof fulltext.getTextForItem === "function") {
          try {
            const text = await fulltext.getTextForItem(attachmentID);
            if (text && text.length > 100) {
              Zotero.debug(
                `[${config.addonName}] [PDF-PARSE] Got ${text.length} chars from getTextForItem (full text, no tail truncation)`,
              );
              return text;
            }
          } catch (e) {
            Zotero.debug(
              `[${config.addonName}] [PDF-PARSE] getTextForItem error: ${e}`,
            );
          }
        }

        // List available Fulltext methods for debugging
        const methods = Object.keys(fulltext).filter(
          (k) => typeof fulltext[k] === "function",
        );
        Zotero.debug(
          `[${config.addonName}] [PDF-PARSE] Available Zotero.Fulltext methods: ${methods.slice(0, 20).join(", ")}${methods.length > 20 ? "..." : ""}`,
        );
      }

      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Could not extract text from PDF`,
      );
      return null;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE] Text extraction error: ${err}`,
      );
      return null;
    }
  }

  /**
   * Highlight multiple entry rows.
   * FTR-PDF-ANNOTATE-MULTI-LABEL: New method to support multi-label highlighting.
   * Sets the first entry as focused, and highlights all entries with temporary animation.
   * @param indices - Array of entry indices to highlight
   */
  private highlightEntryRows(indices: number[]): void {
    if (!indices.length) return;

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] highlightEntryRows: highlighting ${indices.length} entries`,
    );

    // Detect dark mode for appropriate colors
    const dark = isDarkMode();

    // Clear any existing highlights (using inline style marker)
    const prevHighlights = this.listEl?.querySelectorAll(
      "[data-zinspire-highlight]",
    );
    prevHighlights?.forEach((el) => {
      const htmlEl = el as HTMLElement;
      htmlEl.removeAttribute("data-zinspire-highlight");
      htmlEl.style.backgroundColor = "";
      htmlEl.style.boxShadow = "";
      htmlEl.style.borderRadius = "";
    });

    // Set first entry as focused (persistent selection)
    const firstEntry = this.allEntries[indices[0]];
    if (firstEntry) {
      this.setFocusedEntry(firstEntry.id);
    }

    // FTR-MISSING-FIX: Use inline styles because CSS files may not load reliably in Zotero
    // Define highlight styles (matching zoteroPane.css .zinspire-entry-highlight)
    const highlightStyles = dark
      ? {
          backgroundColor: "rgba(0, 96, 223, 0.25)",
          boxShadow: "0 0 0 2px #0052cc",
          borderRadius: "4px",
        }
      : {
          backgroundColor: "#e0f0ff",
          boxShadow: "0 0 0 2px #0060df",
          borderRadius: "4px",
        };

    // Collect all row elements to highlight
    const rowsToHighlight: HTMLElement[] = [];
    for (const index of indices) {
      const entry = this.allEntries[index];
      if (!entry) continue;

      const row = this.getEntryRow(entry.id);

      if (row) {
        // Apply inline styles for highlight
        row.setAttribute("data-zinspire-highlight", "true");
        row.style.backgroundColor = highlightStyles.backgroundColor;
        row.style.boxShadow = highlightStyles.boxShadow;
        row.style.borderRadius = highlightStyles.borderRadius;
        rowsToHighlight.push(row);
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] highlightEntryRows: added highlight to entry ${entry.id}, isConnected=${row.isConnected}`,
        );
      } else {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] highlightEntryRows: WARNING - row not found for entry ${entry.id}`,
        );
      }
    }

    // Auto-remove temporary highlight after animation (longer delay for multiple)
    const highlightDuration = indices.length > 1 ? 3000 : 2500;
    setTimeout(() => {
      for (const row of rowsToHighlight) {
        row.removeAttribute("data-zinspire-highlight");
        // Only clear styles if this row is NOT the focused entry
        // (focused entry should keep its focus style)
        const isFocusedRow =
          row.getAttribute("data-entry-id") === this.focusedEntryID;
        if (!isFocusedRow) {
          row.style.backgroundColor = "";
          row.style.boxShadow = "";
          row.style.borderRadius = "";
        } else {
          // Re-apply focus style for the focused entry
          this.applyFocusedEntryStyle(row, true);
        }
      }
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] highlightEntryRows: removed temporary highlights from ${rowsToHighlight.length} entries`,
      );
    }, highlightDuration);
  }

  /**
   * Set focused entry and update visual state.
   * FTR-FOCUSED-SELECTION: Persistent selection for PDF citation lookup and keyboard navigation.
   * Uses inline styles because CSS files may not load properly in Zotero.
   * @param entryID - Entry ID to focus, or undefined to clear focus
   */
  private setFocusedEntry(entryID?: string): void {
    // Remove previous focus
    if (this.focusedEntryID) {
      let prevRow = this.rowCache.get(this.focusedEntryID);
      // FTR-PDF-ANNOTATE-MULTI-LABEL: If cached row is disconnected, try to find it in DOM
      if (prevRow && !prevRow.isConnected) {
        prevRow = this.listEl?.querySelector(
          `[data-entry-id="${this.focusedEntryID}"]`,
        ) as HTMLElement | undefined;
        if (prevRow) {
          this.rowCache.set(this.focusedEntryID, prevRow);
        }
      }
      if (prevRow) {
        this.applyFocusedEntryStyle(prevRow, false);
      }
    }

    // Set new focus
    this.focusedEntryID = entryID;

    if (entryID) {
      let row = this.rowCache.get(entryID);
      // FTR-PDF-ANNOTATE-MULTI-LABEL: If cached row is disconnected, try to find it in DOM
      if (row && !row.isConnected) {
        row = this.listEl?.querySelector(`[data-entry-id="${entryID}"]`) as
          | HTMLElement
          | undefined;
        if (row) {
          this.rowCache.set(entryID, row);
        }
      }
      // Try DOM lookup as fallback if not in cache
      if (!row) {
        row = this.listEl?.querySelector(`[data-entry-id="${entryID}"]`) as
          | HTMLElement
          | undefined;
        if (row) {
          this.rowCache.set(entryID, row);
        }
      }

      if (row) {
        this.applyFocusedEntryStyle(row, true);
        // FTR-KEYBOARD-NAV-FULL: Focus the list container to keep DOM focus in panel
        // This ensures keyboard events are captured properly
        // Don't focus individual rows (tabIndex=-1 causes Tab to exit panel)
        this.listEl?.focus({ preventScroll: true });
      }
    }
  }

  /**
   * Clear focused entry.
   * FTR-FOCUSED-SELECTION: Called when switching tabs, refreshing, or pressing Escape.
   * FTR-KEYBOARD-NAV-FULL: Also resets focusedEntryIndex.
   */
  private clearFocusedEntry(): void {
    this.focusedEntryIndex = -1;
    this.setFocusedEntry(undefined);
  }

  /**
   * Apply or remove focused entry inline styles on a row element.
   * FTR-FOCUSED-SELECTION: Extracted to avoid code duplication between
   * setFocusedEntry() and updateRowContent().
   * Uses inline styles because CSS files may not load properly in Zotero.
   * Uses box-shadow for left border to avoid layout shift (keeps buttons aligned).
   *
   * @param row - The row element to style
   * @param isFocused - Whether to apply focus styles (true) or clear them (false)
   */
  private applyFocusedEntryStyle(row: HTMLElement, isFocused: boolean): void {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // FTR-KEYBOARD-NAV-FULL: Keyboard Navigation Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Navigate to an entry by delta (relative movement).
   * FTR-KEYBOARD-NAV-FULL: Handles ↑/↓/j/k navigation.
   * @param delta - Direction: 1 for next, -1 for previous
   * @param filteredEntries - Current filtered entries list
   */
  private navigateEntryByDelta(
    delta: number,
    filteredEntries: InspireReferenceEntry[],
  ): void {
    if (filteredEntries.length === 0) return;

    let newIndex: number;

    if (!this.focusedEntryID) {
      // No current selection: start from beginning (delta > 0) or end (delta < 0)
      newIndex = delta > 0 ? 0 : filteredEntries.length - 1;
    } else {
      // PERF: Find actual position of focused entry in current filtered list
      // This handles the case where filter changed and focusedEntryIndex is stale
      const currentIndex = filteredEntries.findIndex(
        (e) => e.id === this.focusedEntryID,
      );
      if (currentIndex < 0) {
        // Focused entry is no longer in filtered list, start from edge
        newIndex = delta > 0 ? 0 : filteredEntries.length - 1;
      } else {
        // Move from current position
        newIndex = currentIndex + delta;
        // Clamp to valid range
        newIndex = Math.max(0, Math.min(newIndex, filteredEntries.length - 1));
      }
    }

    this.navigateToEntryIndex(newIndex, filteredEntries);
  }

  /**
   * Navigate to an entry by absolute index.
   * FTR-KEYBOARD-NAV-FULL: Handles Home/End navigation.
   * @param index - Target index in filtered entries
   * @param filteredEntries - Current filtered entries list
   */
  private navigateToEntryIndex(
    index: number,
    filteredEntries: InspireReferenceEntry[],
  ): void {
    if (index < 0 || index >= filteredEntries.length) return;

    const entry = filteredEntries[index];
    if (!entry) return;

    // Update focus state
    this.focusedEntryIndex = index;
    this.setFocusedEntry(entry.id);

    // Scroll entry into view
    const row = this.getEntryRow(entry.id);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    Zotero.debug(
      `[${config.addonName}] [KEYBOARD-NAV] Navigated to index ${index}, entryID=${entry.id}`,
    );
  }

  /**
   * Handle Enter key on focused entry.
   * FTR-KEYBOARD-NAV-FULL: Opens PDF if available, otherwise prompts to import.
   */
  private async handleKeyboardEnter(): Promise<void> {
    const entry = this.getFocusedEntry();
    if (!entry) return;

    // If item exists locally with PDF, open PDF (same as double-clicking green marker)
    if (entry.localItemID) {
      const pdfID = this.getFirstPdfAttachmentID(entry.localItemID);
      if (pdfID) {
        this.rememberCurrentItemForNavigation();
        const opened = await this.openPdfForLocalItem(entry.localItemID);
        if (opened) {
          Zotero.debug(
            `[${config.addonName}] [KEYBOARD-NAV] Opened PDF via Enter key`,
          );
          return;
        }
      }
      // Item exists but no PDF - select it in library
      const item = Zotero.Items.get(entry.localItemID);
      if (item) {
        const zoteroPane = Zotero.getActiveZoteroPane?.();
        if (zoteroPane) {
          await zoteroPane.selectItem(item.id);
          this.showToast(getString("references-panel-toast-selected"));
          Zotero.debug(
            `[${config.addonName}] [KEYBOARD-NAV] Selected item in library via Enter key`,
          );
          return;
        }
      }
    }

    // Item not in library - prompt to import
    if (entry.recid && !entry.localItemID) {
      await this.handleAddAction(entry, this.body);
      Zotero.debug(
        `[${config.addonName}] [KEYBOARD-NAV] Triggered import via Enter key`,
      );
    }
  }

  /**
   * Handle Space key on focused entry.
   * FTR-KEYBOARD-NAV-FULL: Toggles association status (link/unlink).
   */
  private async handleKeyboardSpace(): Promise<void> {
    const entry = this.getFocusedEntry();
    if (!entry) return;

    // Use handleLinkAction for toggling link/unlink status
    await this.handleLinkAction(entry, this.body);
    Zotero.debug(
      `[${config.addonName}] [KEYBOARD-NAV] Toggled association via Space key, isRelated=${entry.isRelated}`,
    );
  }

  /**
   * Handle Tab/Shift+Tab to switch between tabs.
   * FTR-KEYBOARD-NAV-FULL: Cycles through available tabs.
   * @param reverse - True for Shift+Tab (previous tab)
   */
  private handleKeyboardTab(reverse: boolean): void {
    // Get list of available tabs in order
    const tabOrder: InspireViewMode[] = [
      "references",
      "citedBy",
      "entryCited",
      "search",
    ];

    // Helper to check if a tab button is visible and enabled
    const isTabAvailable = (button: HTMLButtonElement): boolean => {
      // Check hidden property (boolean in HTML, might be string in XUL)
      const isHidden =
        button.hidden === true ||
        button.hidden === ("true" as unknown as boolean) ||
        button.style.display === "none";
      // Check disabled property
      const isDisabled =
        button.disabled === true ||
        button.disabled === ("true" as unknown as boolean);
      return !isHidden && !isDisabled;
    };

    // Filter to only visible/enabled tabs
    const availableTabs = tabOrder.filter((mode) => {
      const button = this.tabButtons?.[mode];
      if (!button) return false;
      return isTabAvailable(button);
    });

    Zotero.debug(
      `[${config.addonName}] [KEYBOARD-NAV] Tab press: availableTabs=${availableTabs.join(",")}, current=${this.viewMode}`,
    );

    if (availableTabs.length <= 1) return;

    const currentIndex = availableTabs.indexOf(this.viewMode);
    let newIndex: number;

    if (reverse) {
      // Shift+Tab: previous tab (wrap around)
      newIndex =
        currentIndex <= 0 ? availableTabs.length - 1 : currentIndex - 1;
    } else {
      // Tab: next tab (wrap around)
      newIndex = (currentIndex + 1) % availableTabs.length;
    }

    const newMode = availableTabs[newIndex];
    this.activateViewMode(newMode)
      .then(() => {
        // FTR-KEYBOARD-NAV-FULL: Restore DOM focus to listEl after tab switch
        // This ensures subsequent Tab presses are captured by our handler
        // Use setTimeout to ensure rendering is complete
        setTimeout(() => {
          this.listEl?.focus({ preventScroll: true });
        }, 0);
      })
      .catch(() => void 0);
    Zotero.debug(
      `[${config.addonName}] [KEYBOARD-NAV] Switched to tab ${newMode} via ${reverse ? "Shift+" : ""}Tab`,
    );
  }

  /**
   * Handle Ctrl/Cmd+Shift+C to copy BibTeX of focused entry.
   * FTR-KEYBOARD-NAV-FULL: Copies BibTeX to clipboard.
   */
  private async handleKeyboardCopy(): Promise<void> {
    const entry = this.getFocusedEntry();
    if (!entry?.recid) return;

    try {
      const bibtex = await fetchBibTeX(entry.recid);
      if (bibtex) {
        const success = await copyToClipboard(bibtex);
        if (success) {
          this.showToast(getString("references-panel-toast-bibtex-success"));
          Zotero.debug(
            `[${config.addonName}] [KEYBOARD-NAV] Copied BibTeX via Ctrl+Shift+C`,
          );
        }
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [KEYBOARD-NAV] Failed to copy BibTeX: ${err}`,
      );
    }
  }

  /**
   * Get the currently focused entry object.
   * FTR-KEYBOARD-NAV-FULL: Helper to retrieve focused entry.
   */
  private getFocusedEntry(): InspireReferenceEntry | undefined {
    if (!this.focusedEntryID) return undefined;
    return this.findEntryById(this.focusedEntryID);
  }

  /**
   * Ensure the INSPIRE References pane is visible in the item pane sidenav.
   * Handles both main window item pane and PDF reader context pane.
   * Returns true if the pane was found and activated, false otherwise.
   */
  private ensureINSPIREPaneVisible(): boolean {
    const mainWindow = Zotero.getMainWindow?.();
    if (!mainWindow?.document) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: mainWindow not available`,
      );
      return false;
    }

    const doc = mainWindow.document;

    // Check if we're in a PDF reader context by looking at the body's parent hierarchy
    // In reader, body is inside context-pane which is inside the reader tab
    const isInReader =
      this.body?.closest(".context-pane") !== null ||
      this.body?.closest("[class*='reader']") !== null ||
      this.currentReaderTabID != null;

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: isInReader=${isInReader}, currentReaderTabID=${this.currentReaderTabID}`,
    );

    // If in reader, we need to ensure the context pane (right sidebar) is visible
    if (isInReader) {
      const contextPaneOpened = this.ensureReaderContextPaneVisible(doc);
      if (!contextPaneOpened) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: failed to open reader context pane`,
        );
        // Don't return false yet - try to find sidenav button anyway
      }
    } else {
      // Main window: Use ZoteroPane.itemPane API
      const zoteroPane = Zotero.getActiveZoteroPane?.();

      const itemPaneEl = zoteroPane?.itemPane as
        | (HTMLElement & { collapsed?: boolean })
        | false
        | undefined;

      if (itemPaneEl) {
        // Check collapsed state - itemPane has a 'collapsed' property in Zotero 7
        const isCollapsed =
          itemPaneEl.collapsed === true ||
          itemPaneEl.getAttribute("collapsed") === "true";
        const offsetWidth = itemPaneEl.offsetWidth ?? 0;

        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: itemPane exists=true, collapsed=${isCollapsed}, offsetWidth=${offsetWidth}`,
        );

        // If item pane is collapsed, we need to open it first
        if (isCollapsed) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: item pane is collapsed, attempting to open it`,
          );
          try {
            // Use the proper API: set collapsed property to false
            itemPaneEl.collapsed = false;
            // Also call updateLayoutConstraints if available
            if (typeof zoteroPane?.updateLayoutConstraints === "function") {
              zoteroPane.updateLayoutConstraints();
            }
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: opened item pane via itemPane.collapsed = false`,
            );
          } catch (err) {
            Zotero.debug(
              `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: failed to open item pane: ${err}`,
            );
          }
        }
      } else {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: itemPane not available`,
        );
      }
    }

    // Our registered paneID is 'zoteroinspire-references'
    // In Zotero 7, sidenav buttons have data-pane attribute matching the paneID
    const paneID = "zoteroinspire-references";

    // Try to find the sidenav button for our section
    // The button should be in item-pane-sidenav or similar container
    const sidenavButton = doc.querySelector(
      `[data-pane="${paneID}"], [data-l10n-id="pane-item-references-sidenav"]`,
    ) as HTMLElement | null;

    if (sidenavButton) {
      // Check if already selected
      const isSelected =
        sidenavButton.classList.contains("selected") ||
        sidenavButton.getAttribute("aria-selected") === "true" ||
        sidenavButton.hasAttribute("selected");

      if (!isSelected) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: clicking sidenav button to select INSPIRE section`,
        );
        // Click the button to select our section
        sidenavButton.click();
      } else {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: INSPIRE section already selected`,
        );
      }
      return true;
    }

    // Alternative: Try to find by looking through all sidenav buttons
    const sidenavContainer = doc.querySelector(
      ".item-pane-sidenav, #zotero-item-pane-sidenav, [class*='sidenav']",
    );

    if (sidenavContainer) {
      // Look for our section button by its icon or other attributes
      const allButtons = Array.from(
        sidenavContainer.querySelectorAll(
          "toolbarbutton, button, [role='tab']",
        ),
      ) as HTMLElement[];
      for (const btn of allButtons) {
        if (!btn) continue;
        const labelAttr = btn.getAttribute?.("data-l10n-id");
        const tooltipAttr = btn.getAttribute?.("tooltiptext");
        const paneAttr = btn.getAttribute?.("data-pane");

        if (
          paneAttr === paneID ||
          labelAttr?.includes("references") ||
          tooltipAttr?.toLowerCase().includes("inspire")
        ) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: found button by alternative search, clicking`,
          );
          btn.click?.();
          return true;
        }
      }
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] ensureINSPIREPaneVisible: could not find sidenav button for INSPIRE section`,
    );
    return false;
  }

  /**
   * Ensure the reader's context pane (right sidebar) is visible.
   * In Zotero 7, the reader has a toggle button to show/hide the context pane.
   */
  private ensureReaderContextPaneVisible(doc: Document): boolean {
    // First, try using ZoteroContextPane API directly (preferred method)

    const ZoteroContextPane = (Zotero.getMainWindow() as any)
      ?.ZoteroContextPane;
    if (ZoteroContextPane) {
      const isCollapsed = ZoteroContextPane.collapsed;
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] ensureReaderContextPaneVisible: ZoteroContextPane.collapsed=${isCollapsed}`,
      );
      if (isCollapsed) {
        // Open the context pane by setting collapsed to false
        ZoteroContextPane.collapsed = false;
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ensureReaderContextPaneVisible: opened context pane via ZoteroContextPane.collapsed = false`,
        );
        return true;
      }
      return true; // Already visible
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] ensureReaderContextPaneVisible: ZoteroContextPane API not available, trying fallback methods`,
    );

    // Fallback: Try multiple selectors for the context pane toggle button
    // The button is typically in the reader toolbar area
    const toggleSelectors = [
      // Context pane toggle button (most common)
      "#zotero-tb-toggle-item-pane",
      "[data-l10n-id='toggle-item-pane']",
      ".context-pane-toggle",
      // Try by tooltip text
      "toolbarbutton[tooltiptext*='pane']",
      "button[aria-label*='pane']",
      // Generic reader context toggle
      "[id*='context'][id*='toggle']",
      "[class*='context'][class*='toggle']",
    ];

    for (const selector of toggleSelectors) {
      const toggleBtn = doc.querySelector(selector) as HTMLElement | null;
      if (toggleBtn) {
        // Check if context pane is currently collapsed
        // The button or a parent element typically has aria-pressed or similar state
        const isExpanded =
          toggleBtn.getAttribute("aria-pressed") === "true" ||
          toggleBtn.getAttribute("aria-expanded") === "true" ||
          toggleBtn.classList.contains("toggled") ||
          toggleBtn.hasAttribute("checked");

        // Also check if context pane element exists and is visible
        const contextPane = doc.querySelector(
          ".context-pane, #zotero-context-pane",
        ) as HTMLElement | null;
        const contextPaneVisible =
          contextPane != null &&
          contextPane.offsetWidth > 0 &&
          !contextPane.hasAttribute("collapsed") &&
          (contextPane.ownerDocument?.defaultView?.getComputedStyle(contextPane)
            ?.display ?? "none") !== "none";

        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] ensureReaderContextPaneVisible: found toggle button (${selector}), isExpanded=${isExpanded}, contextPaneVisible=${contextPaneVisible}`,
        );

        // If context pane is not visible, click the toggle
        if (!contextPaneVisible) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] ensureReaderContextPaneVisible: clicking toggle to open context pane`,
          );
          toggleBtn.click();
          return true;
        }
        return true; // Already visible
      }
    }

    // Fallback: Try to find the context pane splitter and check its state
    const splitter = doc.querySelector(
      "#zotero-context-splitter, .context-pane-splitter",
    ) as HTMLElement | null;
    if (splitter) {
      const isCollapsed =
        splitter.getAttribute("state") === "collapsed" ||
        splitter.getAttribute("collapsed") === "true";

      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] ensureReaderContextPaneVisible: found splitter, isCollapsed=${isCollapsed}`,
      );

      if (isCollapsed) {
        // Try to open by changing splitter state
        splitter.setAttribute("state", "open");
        splitter.removeAttribute("collapsed");
        return true;
      }
      return true; // Already visible
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] ensureReaderContextPaneVisible: could not find toggle button or splitter`,
    );
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Quick Filters Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private loadQuickFiltersFromPrefs(): void {
    this.quickFilters.clear();
    const prefValue = getPref(QUICK_FILTER_PREF_KEY);
    const parsedValues = this.parseQuickFilterPref(prefValue);
    for (const value of parsedValues) {
      this.quickFilters.add(value);
    }
    this.enforceQuickFilterConstraints();
    this.updatePublishedOnlyStateFromQuickFilters();
  }

  private parseQuickFilterPref(prefValue: unknown): QuickFilterType[] {
    if (Array.isArray(prefValue)) {
      return prefValue.filter(isQuickFilterType);
    }
    if (typeof prefValue === "string" && prefValue.trim()) {
      try {
        const parsed = JSON.parse(prefValue);
        if (Array.isArray(parsed)) {
          return parsed.filter(isQuickFilterType);
        }
      } catch (error) {
        // Failed to parse, return empty array
      }
    }
    return [];
  }

  private enforceQuickFilterConstraints(newlyEnabled?: QuickFilterType): void {
    // publishedOnly and preprintOnly are mutually exclusive
    if (
      this.quickFilters.has("publishedOnly") &&
      this.quickFilters.has("preprintOnly")
    ) {
      if (newlyEnabled === "preprintOnly") {
        this.quickFilters.delete("publishedOnly");
      } else if (newlyEnabled === "publishedOnly") {
        this.quickFilters.delete("preprintOnly");
      } else {
        this.quickFilters.delete("preprintOnly");
      }
    }

    // recent1Year and recent5Years are mutually exclusive
    if (
      this.quickFilters.has("recent1Year") &&
      this.quickFilters.has("recent5Years")
    ) {
      if (newlyEnabled === "recent1Year") {
        this.quickFilters.delete("recent5Years");
      } else if (newlyEnabled === "recent5Years") {
        this.quickFilters.delete("recent1Year");
      } else {
        this.quickFilters.delete("recent5Years");
      }
    }

    // localItems and onlineItems are mutually exclusive
    if (
      this.quickFilters.has("localItems") &&
      this.quickFilters.has("onlineItems")
    ) {
      if (newlyEnabled === "onlineItems") {
        this.quickFilters.delete("localItems");
      } else if (newlyEnabled === "localItems") {
        this.quickFilters.delete("onlineItems");
      } else {
        this.quickFilters.delete("onlineItems");
      }
    }
  }

  private persistQuickFiltersToPrefs(): void {
    try {
      setPref(
        QUICK_FILTER_PREF_KEY,
        JSON.stringify(Array.from(this.quickFilters)),
      );
    } catch (error) {
      // Failed to persist, ignore
    }
  }

  private updatePublishedOnlyStateFromQuickFilters(): void {
    this.publishedOnlyFilterEnabled = this.quickFilters.has("publishedOnly");
  }

  private setQuickFilterState(
    type: QuickFilterType,
    enabled: boolean,
    options?: { suppressRender?: boolean; skipPersist?: boolean },
  ): void {
    const currentlyEnabled = this.quickFilters.has(type);
    if (enabled === currentlyEnabled) {
      return;
    }

    if (enabled) {
      this.quickFilters.add(type);
      this.enforceQuickFilterConstraints(type);
    } else {
      this.quickFilters.delete(type);
    }

    this.updatePublishedOnlyStateFromQuickFilters();

    if (!options?.skipPersist) {
      this.persistQuickFiltersToPrefs();
    }

    this.updateQuickFiltersButtonState();
    this.updatePublishedOnlyButtonStyle();
    this.updateQuickFilterCheckboxStates();
    this.cachedChartStats = undefined;
    this.updateChartClearButton();

    if (!options?.suppressRender) {
      this.renderChart();
      this.renderReferenceList();
      // FTR-AUTHOR-CARD-FILTERS: Update author stats when quick filter changes
      if (this.viewMode === "entryCited" && this.entryCitedSource?.authorSearchInfo) {
        this.updateAuthorStats(this.getEntriesForAuthorStats());
        this.updateAuthorProfileCard();
      }
    }
  }

  private toggleQuickFilter(
    type: QuickFilterType,
    options?: { suppressRender?: boolean },
  ): void {
    const shouldEnable = !this.quickFilters.has(type);
    this.setQuickFilterState(type, shouldEnable, options);
  }

  private updateQuickFiltersButtonState(): void {
    if (!this.quickFiltersButton) {
      return;
    }

    const activeCount = this.quickFilters.size;
    this.quickFiltersButton.classList.toggle("active", activeCount > 0);

    if (this.quickFiltersBadge) {
      this.quickFiltersBadge.textContent =
        activeCount > 0 ? `${activeCount}` : "";
      this.quickFiltersBadge.hidden = activeCount === 0;
    }
  }

  private updatePublishedOnlyButtonStyle(): void {
    if (!this.publishedOnlyButton) {
      return;
    }
    // FTR-CONSISTENT-UI: Use unified pill button style
    applyPillButtonStyle(
      this.publishedOnlyButton,
      this.publishedOnlyFilterEnabled,
      isDarkMode(),
    );
  }

  private updateAuthorFilterButtonStyle(): void {
    if (!this.authorFilterButton) {
      return;
    }
    // FTR-CONSISTENT-UI: Use unified pill button style
    applyPillButtonStyle(
      this.authorFilterButton,
      this.authorFilterEnabled,
      isDarkMode(),
    );
    this.updateChartClearButton();
  }

  private hasActiveFilters(): boolean {
    return Boolean(
      this.filterText ||
      this.chartSelectedBins.size > 0 ||
      this.authorFilterEnabled ||
      this.quickFilters.size > 0,
    );
  }

  private clearAllFilters(): void {
    let didChange = false;

    if (this.filterText) {
      this.filterText = "";
      if (this.filterInput) {
        this.filterInput.value = "";
      }
      this.filterInlineHint?.hide();
      if (this.filterDebounceTimer) {
        clearTimeout(this.filterDebounceTimer);
        this.filterDebounceTimer = undefined;
      }
      didChange = true;
    }

    if (this.chartSelectedBins.size > 0) {
      this.chartSelectedBins.clear();
      this.lastChartClickedKey = undefined;
      this.cachedChartStats = undefined;
      didChange = true;
    }

    if (this.authorFilterEnabled) {
      this.authorFilterEnabled = false;
      this.updateAuthorFilterButtonStyle();
      didChange = true;
    }

    if (this.quickFilters.size > 0) {
      this.quickFilters.clear();
      this.persistQuickFiltersToPrefs();
      this.updatePublishedOnlyStateFromQuickFilters();
      this.updateQuickFiltersButtonState();
      this.updateQuickFilterCheckboxStates();
      this.updatePublishedOnlyButtonStyle();
      this.cachedChartStats = undefined;
      didChange = true;
    }

    if (!didChange) {
      this.updateChartClearButton();
      return;
    }

    this.updateChartClearButton();
    this.renderChart();
    this.renderReferenceList();
  }

  private handleFilterInputChange(rawValue: string): void {
    this.filterText = rawValue.trim();
    if (this.filterDebounceTimer) {
      clearTimeout(this.filterDebounceTimer);
    }
    this.filterDebounceTimer = setTimeout(() => {
      this.renderChart();
      this.renderReferenceList();
    }, this.filterDebounceDelay);
  }

  private getOwnerDocument(element?: Element | null): Document {
    return (
      element?.ownerDocument ||
      this.body.ownerDocument ||
      Zotero.getMainWindow().document
    );
  }

  private createQuickFiltersControls(toolbar: HTMLDivElement): void {
    const doc = this.getOwnerDocument(toolbar);
    const wrapper = doc.createElement("div");
    wrapper.className = "zinspire-quick-filters";
    // Inline styles to ensure proper flex behavior in Zotero's XUL environment
    wrapper.style.display = "inline-flex";
    wrapper.style.flexShrink = "0";
    wrapper.style.position = "relative";
    toolbar.appendChild(wrapper);
    this.quickFiltersWrapper = wrapper as HTMLDivElement;

    const button = doc.createElement("button");
    button.className = "zinspire-quick-filter-btn";
    button.type = "button";
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    const filtersLabel = getString("references-panel-quick-filters");
    const filtersEmoji = "⏳";
    button.textContent = filtersEmoji;
    button.setAttribute("aria-label", filtersLabel);
    button.setAttribute("title", filtersLabel);
    // Apply button styling
    button.style.cssText = `
      padding: 4px 8px;
      font-size: 14px;
      border: 1px solid var(--fill-quinary, #d1d5db);
      border-radius: 4px;
      background: var(--material-background, #fff);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    `;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleQuickFiltersPopup();
    });

    const badge = doc.createElement("span");
    badge.className = "zinspire-quick-filter-badge";
    badge.hidden = true;
    button.appendChild(badge);

    wrapper.appendChild(button);
    this.quickFiltersButton = button as HTMLButtonElement;
    this.quickFiltersBadge = badge as HTMLSpanElement;

    // Create popup as absolute positioned dropdown overlay
    const popup = doc.createElement("div");
    popup.className = "zinspire-quick-filter-popup";
    popup.hidden = true;
    // Absolute positioned dropdown overlay - single column
    // Use left: 0 to align with button's left edge (prevents cutoff on narrow panels)
    // FIX-DARK-MODE: Use solid background for better visibility
    popup.style.cssText = `
      display: none;
      flex-direction: column;
      position: absolute;
      top: 100%;
      left: 0;
      z-index: 1000;
      background: var(--material-background, #fff);
      border: 1px solid var(--fill-quinary, #d1d5db);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      padding: 6px 4px;
      margin-top: 4px;
      gap: 2px;
      min-width: 160px;
    `;
    wrapper.appendChild(popup);
    this.quickFiltersPopup = popup as HTMLDivElement;

    this.renderQuickFilterItems(popup as HTMLDivElement);
    this.updateQuickFiltersButtonState();
    this.updateQuickFilterCheckboxStates();
    this.updateQuickFiltersButtonExpandedState();
    // Note: No outside click handler - popup only closes via button toggle
  }

  private renderQuickFilterItems(container: HTMLDivElement): void {
    this.quickFilterCheckboxes.clear();
    container.replaceChildren();
    const doc = this.getOwnerDocument(container);

    for (const config of QUICK_FILTER_CONFIGS) {
      const item = doc.createElement("label");
      item.className = "zinspire-quick-filter-item";
      // Compact row style with hover effect - use CSS variables for dark mode
      item.style.cssText = `
        display: flex;
        align-items: center;
        white-space: nowrap;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        color: var(--fill-primary, #1e293b);
        transition: background-color 0.1s ease;
      `;
      const labelText = getString(config.labelKey);
      if (config.tooltipKey) {
        item.title = getString(config.tooltipKey);
      } else {
        item.title = labelText;
      }

      // Hover effect - use CSS variable for dark mode support
      item.addEventListener("mouseenter", () => {
        item.style.backgroundColor = "var(--fill-quinary, rgba(0, 0, 0, 0.05))";
      });
      item.addEventListener("mouseleave", () => {
        item.style.backgroundColor = "";
      });

      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.quickFilters.has(config.type);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", (event) => {
        event.stopPropagation();
        this.setQuickFilterState(config.type, checkbox.checked);
      });

      const emojiSpan = doc.createElement("span");
      emojiSpan.className = "zinspire-quick-filter-item-emoji";
      emojiSpan.textContent = config.emoji;

      const labelSpan = doc.createElement("span");
      labelSpan.className = "zinspire-quick-filter-item-label";
      labelSpan.textContent = labelText;

      item.appendChild(checkbox);
      item.appendChild(emojiSpan);
      item.appendChild(labelSpan);

      container.appendChild(item);
      this.quickFilterCheckboxes.set(config.type, checkbox as HTMLInputElement);
    }
  }

  private updateQuickFilterCheckboxStates(): void {
    for (const [type, checkbox] of this.quickFilterCheckboxes.entries()) {
      checkbox.checked = this.quickFilters.has(type);
    }
  }

  private toggleQuickFiltersPopup(): void {
    if (this.quickFiltersPopupVisible) {
      this.closeQuickFiltersPopup();
    } else {
      this.openQuickFiltersPopup();
    }
  }

  private openQuickFiltersPopup(): void {
    if (!this.quickFiltersPopup) {
      return;
    }
    this.quickFiltersPopup.hidden = false;
    this.quickFiltersPopup.style.display = "flex";
    this.quickFiltersPopupVisible = true;
    this.updateQuickFiltersButtonExpandedState();
    this.updateQuickFilterCheckboxStates();

    // PERF-FIX-6: Clean up any existing handler before creating new one
    this.cleanupQuickFiltersHandler();

    // PERF-FIX-6: Create tracked outside click handler
    this.quickFiltersOutsideClickHandler = (event: MouseEvent) => {
      // Early exit if controller is destroyed
      if (!this.body?.ownerDocument) {
        this.cleanupQuickFiltersHandler();
        return;
      }

      const target = event.target as Node;
      const isInsidePopup = this.quickFiltersPopup?.contains(target);
      const isInsideButton = this.quickFiltersButton?.contains(target);
      if (!isInsidePopup && !isInsideButton) {
        this.closeQuickFiltersPopup();
      }
    };

    // PERF-FIX-6: Track timeout ID for cleanup
    this.quickFiltersTimeoutId = setTimeout(() => {
      this.quickFiltersTimeoutId = undefined;
      if (this.quickFiltersOutsideClickHandler) {
        this.body.ownerDocument?.addEventListener(
          "click",
          this.quickFiltersOutsideClickHandler,
          true,
        );
      }
    }, 0);
  }

  private closeQuickFiltersPopup(): void {
    // PERF-FIX-6: Clean up handler when closing
    this.cleanupQuickFiltersHandler();

    if (!this.quickFiltersPopup) {
      this.quickFiltersPopupVisible = false;
      this.updateQuickFiltersButtonExpandedState();
      return;
    }
    this.quickFiltersPopup.hidden = true;
    this.quickFiltersPopup.style.display = "none";
    this.quickFiltersPopupVisible = false;
    this.updateQuickFiltersButtonExpandedState();
  }

  /**
   * PERF-FIX-6: Clean up quick filters outside click handler and timeout.
   * Called when closing popup or destroying controller.
   */
  private cleanupQuickFiltersHandler(): void {
    if (this.quickFiltersTimeoutId) {
      clearTimeout(this.quickFiltersTimeoutId);
      this.quickFiltersTimeoutId = undefined;
    }
    if (this.quickFiltersOutsideClickHandler) {
      this.body.ownerDocument?.removeEventListener(
        "click",
        this.quickFiltersOutsideClickHandler,
        true,
      );
      this.quickFiltersOutsideClickHandler = undefined;
    }
  }

  /**
   * PERF-FIX-2: Cancel any ongoing export operation.
   * Called when the controller is destroyed or user navigates away.
   */
  private cancelExport(): void {
    if (this.exportAbort) {
      this.exportAbort.abort();
      this.exportAbort = undefined;
      Zotero.debug(`[${config.addonName}] Export operation cancelled`);
    }
  }

  private updateQuickFiltersButtonExpandedState(): void {
    if (!this.quickFiltersButton) {
      return;
    }
    this.quickFiltersButton.setAttribute(
      "aria-expanded",
      this.quickFiltersPopupVisible ? "true" : "false",
    );
  }

  private applyQuickFilters(
    entries: InspireReferenceEntry[],
  ): InspireReferenceEntry[] {
    if (!this.quickFilters.size) {
      return entries;
    }
    return entries.filter((entry) => this.matchesQuickFilters(entry));
  }

  private matchesQuickFilters(entry: InspireReferenceEntry): boolean {
    if (!this.quickFilters.size) {
      return true;
    }

    for (const filter of this.quickFilters) {
      switch (filter) {
        case "highCitations":
          if (!this.matchesHighCitationsFilter(entry)) return false;
          break;
        case "recent5Years":
          if (!this.matchesRecentYearsFilter(entry, 5)) return false;
          break;
        case "recent1Year":
          if (!this.matchesRecentYearsFilter(entry, 1)) return false;
          break;
        case "publishedOnly":
          if (!this.matchesPublishedOnlyFilter(entry)) return false;
          break;
        case "preprintOnly":
          if (!this.matchesPreprintOnlyFilter(entry)) return false;
          break;
        case "relatedOnly":
          if (!this.matchesRelatedOnlyFilter(entry)) return false;
          break;
        case "localItems":
          if (!this.matchesLocalItemsFilter(entry)) return false;
          break;
        case "onlineItems":
          if (!this.matchesOnlineItemsFilter(entry)) return false;
          break;
        default:
          break;
      }
    }

    return true;
  }

  private enableTextSelection() {
    const applySelectable = (el: HTMLElement | null) => {
      if (!el) {
        return;
      }
      el.style.setProperty("user-select", "text", "important");
      el.style.setProperty("-moz-user-select", "text", "important");
    };
    let current: HTMLElement | null = this.body;
    while (current) {
      applySelectable(current);
      current = current.parentElement;
    }
  }

  /**
   * Apply modern inline styles to navigation buttons (Back/Forward)
   * @param isIcon - If true, use smaller square padding for icon-only buttons
   */
  private applyNavButtonStyle(button: HTMLButtonElement, isIcon = false): void {
    const padding = isIcon ? "4px 8px" : "4px 10px";
    const fontSize = isIcon ? "14px" : "12px";
    button.style.cssText = `
      padding: ${padding};
      font-size: ${fontSize};
      border: 1px solid var(--fill-quinary, #cbd5e1);
      border-radius: 4px;
      background: var(--material-background, #fff);
      color: var(--fill-primary, #334155);
      cursor: pointer;
      transition: all 0.15s ease;
      min-width: ${isIcon ? "28px" : "auto"};
      display: inline-flex;
      align-items: center;
      justify-content: center;
    `;
    // Apply initial visual state based on disabled
    this.updateNavButtonVisualState(button);

    // Add hover effect (only works when enabled)
    button.addEventListener("mouseenter", () => {
      if (!button.disabled) {
        button.style.backgroundColor = "#e6f2ff";
        button.style.borderColor = "#0066cc";
        button.style.color = "#0066cc";
      }
    });
    button.addEventListener("mouseleave", () => {
      this.updateNavButtonVisualState(button);
    });
  }

  /**
   * Update navigation button visual state based on disabled property
   */
  private updateNavButtonVisualState(button: HTMLButtonElement): void {
    if (button.disabled) {
      // Disabled: faded, gray, no pointer
      button.style.opacity = "0.4";
      button.style.color = "var(--fill-secondary, #94a3b8)";
      button.style.backgroundColor = "var(--material-background, #fff)";
      button.style.borderColor = "var(--fill-quinary, #e2e8f0)";
      button.style.cursor = "not-allowed";
    } else {
      // Enabled: full opacity, clickable
      button.style.opacity = "1";
      button.style.color = "var(--fill-primary, #334155)";
      button.style.backgroundColor = "var(--material-background, #fff)";
      button.style.borderColor = "var(--fill-quinary, #cbd5e1)";
      button.style.cursor = "pointer";
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Event Delegation (PERF-14)
  // Single listeners on listEl instead of per-row listeners.
  // Reduces listener count from 10000+ to 4 for long lists.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find entry by ID from allEntries array.
   * Used by event delegation to map row elements back to entry data.
   */
  private findEntryById(id: string): InspireReferenceEntry | undefined {
    return this.allEntries.find((e) => e.id === id);
  }

  /**
   * Setup event delegation on listEl.
   * Handles click, mouseover, mouseout, mousemove for all row elements.
   */
  private setupEventDelegation() {
    // Click handler for all interactive elements
    this.boundHandleListClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const row = target.closest(".zinspire-ref-entry") as HTMLElement | null;
      if (!row) return;

      const entryId = row.dataset.entryId;
      const entry = entryId ? this.findEntryById(entryId) : null;
      if (!entry) return;

      // FTR-BATCH-IMPORT: Checkbox click (batch selection)
      if (target.closest(".zinspire-ref-entry__checkbox")) {
        Zotero.debug(
          `[${config.addonName}] Event delegation: checkbox click detected`,
        );
        // Don't prevent default - let checkbox toggle naturally
        this.handleCheckboxClick(entry, event);
        return;
      }

      // Marker click (add/show item)
      if (target.closest(".zinspire-ref-entry__dot")) {
        event.preventDefault();
        const marker = target.closest(
          ".zinspire-ref-entry__dot",
        ) as HTMLElement;
        // Delay click handling to allow double-click detection
        if (this.markerClickTimer) {
          clearTimeout(this.markerClickTimer);
        }
        this.markerClickTimer = setTimeout(() => {
          this.handleMarkerClick(entry, marker).catch(() => void 0);
          this.markerClickTimer = undefined;
        }, 250);
        return;
      }

      // Link button click (link/unlink reference)
      if (target.closest(".zinspire-ref-entry__link")) {
        event.preventDefault();
        const linkButton = target.closest(
          ".zinspire-ref-entry__link",
        ) as HTMLElement;
        this.handleLinkAction(entry, linkButton).catch((err) => {
          // Silently ignore aborted requests
        });
        return;
      }

      // Title link click (open URL)
      if (target.closest(".zinspire-ref-entry__title-link")) {
        event.preventDefault();
        this.handleTitleClick(entry);
        return;
      }

      // Stats button click (show citing papers)
      if (target.closest(".zinspire-ref-entry__stats-button")) {
        event.preventDefault();
        this.showEntryCitedTab(entry).catch(() => void 0);
        return;
      }

      // BibTeX button click (copy BibTeX)
      if (target.closest(".zinspire-ref-entry__bibtex")) {
        event.preventDefault();
        event.stopPropagation();
        const bibtexButton = target.closest(
          ".zinspire-ref-entry__bibtex",
        ) as HTMLButtonElement;
        if (!bibtexButton.disabled) {
          this.handleBibTeXCopy(entry, bibtexButton).catch(() => void 0);
        }
        return;
      }

      // Texkey button click (copy texkey)
      if (target.closest(".zinspire-ref-entry__texkey")) {
        event.preventDefault();
        event.stopPropagation();
        const texkeyButton = target.closest(
          ".zinspire-ref-entry__texkey",
        ) as HTMLButtonElement;
        if (!texkeyButton.disabled) {
          this.handleTexkeyCopy(entry, texkeyButton).catch(() => void 0);
        }
        return;
      }

      // Author link click (show author papers)
      if (target.closest(".zinspire-ref-entry__author-link")) {
        event.preventDefault();
        event.stopPropagation();
        const authorLink = target.closest(
          ".zinspire-ref-entry__author-link",
        ) as HTMLElement;
        this.hideAuthorPreviewCard();
        const authorIndex = parseInt(
          authorLink.dataset.authorIndex ?? "-1",
          10,
        );
        if (authorIndex >= 0 && entry.authorSearchInfos?.[authorIndex]) {
          this.showAuthorPapersTab(entry.authorSearchInfos[authorIndex]).catch(
            () => void 0,
          );
        } else if (authorIndex >= 0 && entry.authors[authorIndex]) {
          // Fallback: use author name directly
          this.showAuthorPapersTab({
            fullName: entry.authors[authorIndex],
          }).catch(() => void 0);
        }
        return;
      }

      // FTR-FOCUSED-SELECTION: Row background click sets focus
      // FTR-KEYBOARD-NAV-FULL: Also sync focusedEntryIndex for keyboard navigation
      // Only if not clicking on interactive elements (buttons, links, inputs, etc.)
      const isInteractiveElement = target.closest(
        "button, a, input, .zinspire-ref-entry__dot, .zinspire-ref-entry__link, " +
          ".zinspire-ref-entry__author-link, .zinspire-ref-entry__stats-button, " +
          ".zinspire-ref-entry__bibtex, .zinspire-ref-entry__texkey, .zinspire-ref-entry__checkbox",
      );
      if (!isInteractiveElement) {
        // Sync focusedEntryIndex with current filtered list
        const filteredEntries = this.getFilteredEntries(this.allEntries);
        const entryIndex = filteredEntries.findIndex((e) => e.id === entry.id);
        this.focusedEntryIndex = entryIndex >= 0 ? entryIndex : -1;
        this.setFocusedEntry(entry.id);
      }
    };

    // Mouseover handler for tooltip and hover effects
    this.boundHandleListMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const row = target.closest(".zinspire-ref-entry") as HTMLElement | null;
      if (!row) return;

      const entryId = row.dataset.entryId;
      const entry = entryId ? this.findEntryById(entryId) : null;

      // Title link hover - show abstract tooltip
      const titleLink = target.closest(".zinspire-ref-entry__title-link");
      if (titleLink && entry) {
        this.scheduleAbstractTooltip(entry, event);
        return;
      }

      const authorLink = target.closest(
        ".zinspire-ref-entry__author-link",
      ) as HTMLElement | null;
      if (authorLink && entry) {
        const authorIndex = parseInt(
          authorLink.dataset.authorIndex ?? "-1",
          10,
        );
        if (authorIndex >= 0) {
          this.scheduleAuthorPreview(entry, authorIndex, authorLink);
        }
        return;
      }

      // BibTeX button hover
      const bibtexButton = target.closest(
        ".zinspire-ref-entry__bibtex",
      ) as HTMLButtonElement | null;
      if (bibtexButton && !bibtexButton.disabled) {
        bibtexButton.style.opacity = "1";
        return;
      }

      // Texkey button hover
      const texkeyButton = target.closest(
        ".zinspire-ref-entry__texkey",
      ) as HTMLButtonElement | null;
      if (texkeyButton && !texkeyButton.disabled) {
        texkeyButton.style.opacity = "1";
        return;
      }
    };

    // Mouseout handler for tooltip and hover effects
    this.boundHandleListMouseOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Title link mouseout - hide tooltip
      const titleLink = target.closest(".zinspire-ref-entry__title-link");
      if (titleLink) {
        this.handleTitleMouseLeave(event);
        return;
      }

      const authorLink = target.closest(
        ".zinspire-ref-entry__author-link",
      ) as HTMLElement | null;
      if (authorLink) {
        const related = event.relatedTarget as Node | null;
        if (
          related &&
          this.authorPreviewCard &&
          (related === this.authorPreviewCard ||
            this.authorPreviewCard.contains(related))
        ) {
          this.cancelAuthorPreviewHide();
          return;
        }
        this.scheduleAuthorPreviewHide();
        return;
      }

      // BibTeX button mouseout
      const bibtexButton = target.closest(
        ".zinspire-ref-entry__bibtex",
      ) as HTMLButtonElement | null;
      if (bibtexButton && !bibtexButton.disabled) {
        bibtexButton.style.opacity = "0.7";
        return;
      }

      // Texkey button mouseout
      const texkeyButton = target.closest(
        ".zinspire-ref-entry__texkey",
      ) as HTMLButtonElement | null;
      if (texkeyButton && !texkeyButton.disabled) {
        texkeyButton.style.opacity = "0.7";
        return;
      }
    };

    // Mousemove handler for tooltip position (PERF-FIX-7: throttled ~60fps)
    this.boundHandleListMouseMove = (event: MouseEvent) => {
      const now = Date.now();
      if (now - this.lastMouseMoveTime < this.mouseMoveThrottleMs) {
        return; // Skip if within throttle window
      }
      this.lastMouseMoveTime = now;

      const target = event.target as HTMLElement;
      const titleLink = target.closest(".zinspire-ref-entry__title-link");
      if (titleLink) {
        this.updateTooltipPosition(event);
      }
    };

    // Double-click handler for marker (open PDF)
    this.boundHandleListDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const row = target.closest(".zinspire-ref-entry") as HTMLElement | null;
      if (!row) return;

      const entryId = row.dataset.entryId;
      const entry = entryId ? this.findEntryById(entryId) : null;
      if (!entry) return;

      // Marker double-click (open PDF)
      if (target.closest(".zinspire-ref-entry__dot")) {
        event.preventDefault();
        // Cancel pending click handler
        if (this.markerClickTimer) {
          clearTimeout(this.markerClickTimer);
          this.markerClickTimer = undefined;
        }
        this.handleMarkerDoubleClick(entry).catch(() => void 0);
        return;
      }
    };

    // FTR-KEYBOARD-NAV-FULL: Comprehensive keyboard navigation handler
    // Attached to document in capture phase to intercept before default behavior
    this.boundHandleBodyKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;

      // Check if target is within our panel
      const isInPanel = this.body?.contains(target) ?? false;
      if (!isInPanel) {
        return; // Don't handle events outside our panel
      }

      // Check if in form input (for most keys, we don't interfere)
      // Use case-insensitive tag check; avoid instanceof due to cross-window issues in Zotero
      const isFormInput =
        /^(INPUT|TEXTAREA|SELECT)$/i.test(tag || "") ||
        target?.isContentEditable === true;

      // Check if target is a button (case-insensitive)
      const isButton = /^BUTTON$/i.test(tag || "");

      // PERF: Lazy-evaluate filteredEntries only when navigation keys are pressed
      // This avoids expensive filtering on every keystroke (Escape, Tab, Space, etc.)
      let _filteredEntries: InspireReferenceEntry[] | null = null;
      const getEntries = () => {
        if (_filteredEntries === null) {
          _filteredEntries = this.getFilteredEntries(this.allEntries);
        }
        return _filteredEntries;
      };

      switch (event.key) {
        // ═══════════════════════════════════════════════════════════════════════
        // Escape: Clear focused entry (FTR-FOCUSED-SELECTION)
        // ═══════════════════════════════════════════════════════════════════════
        case "Escape":
          if (this.focusedEntryID) {
            this.clearFocusedEntry();
            event.preventDefault();
            event.stopPropagation();
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // Arrow Down / j: Navigate to next entry
        // ═══════════════════════════════════════════════════════════════════════
        case "ArrowDown":
          if (!isFormInput) {
            const entries = getEntries();
            if (entries.length > 0) {
              event.preventDefault();
              this.navigateEntryByDelta(1, entries);
            }
          }
          break;
        case "j":
          // Vim-style: only without any modifier keys
          if (
            !isFormInput &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const entries = getEntries();
            if (entries.length > 0) {
              event.preventDefault();
              this.navigateEntryByDelta(1, entries);
            }
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // Arrow Up / k: Navigate to previous entry
        // ═══════════════════════════════════════════════════════════════════════
        case "ArrowUp":
          if (!isFormInput) {
            const entries = getEntries();
            if (entries.length > 0) {
              event.preventDefault();
              this.navigateEntryByDelta(-1, entries);
            }
          }
          break;
        case "k":
          // Vim-style: only without any modifier keys
          if (
            !isFormInput &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const entries = getEntries();
            if (entries.length > 0) {
              event.preventDefault();
              this.navigateEntryByDelta(-1, entries);
            }
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // Arrow Left: Go back in navigation history
        // ═══════════════════════════════════════════════════════════════════════
        case "ArrowLeft":
          if (
            !isFormInput &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const hasBack =
              InspireReferencePanelController.navigationStack.length > 0;
            if (hasBack) {
              event.preventDefault();
              this.handleBackNavigation();
            }
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // Arrow Right: Go forward in navigation history
        // ═══════════════════════════════════════════════════════════════════════
        case "ArrowRight":
          if (
            !isFormInput &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const hasForward =
              InspireReferencePanelController.forwardStack.length > 0;
            if (hasForward) {
              event.preventDefault();
              this.handleForwardNavigation();
            }
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // Home: Jump to first entry
        // ═══════════════════════════════════════════════════════════════════════
        case "Home":
          if (
            !isFormInput &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const entries = getEntries();
            if (entries.length > 0) {
              event.preventDefault();
              this.navigateToEntryIndex(0, entries);
            }
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // End: Jump to last entry
        // ═══════════════════════════════════════════════════════════════════════
        case "End":
          if (
            !isFormInput &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const entries = getEntries();
            if (entries.length > 0) {
              event.preventDefault();
              this.navigateToEntryIndex(entries.length - 1, entries);
            }
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // Enter: Open/import focused entry
        // ═══════════════════════════════════════════════════════════════════════
        case "Enter":
          // Exclude BUTTON to allow toolbar buttons to work normally
          if (this.focusedEntryID && !isFormInput && !isButton) {
            event.preventDefault();
            this.handleKeyboardEnter().catch(() => void 0);
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // Space: Toggle association status
        // ═══════════════════════════════════════════════════════════════════════
        case " ":
          // Exclude BUTTON to allow button activation via Space
          if (this.focusedEntryID && !isFormInput && !isButton) {
            event.preventDefault();
            this.handleKeyboardSpace().catch(() => void 0);
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // Tab/Shift+Tab: Switch tabs
        // ═══════════════════════════════════════════════════════════════════════
        case "Tab":
          // Switch tabs from anywhere in panel except form inputs
          if (!isFormInput) {
            event.preventDefault();
            event.stopImmediatePropagation(); // Prevent any other Tab handlers
            this.handleKeyboardTab(event.shiftKey);
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // Ctrl/Cmd+Shift+C: Copy BibTeX of focused entry
        // (Using Shift to avoid conflict with text copy shortcut)
        // ═══════════════════════════════════════════════════════════════════════
        case "c":
        case "C":
          if (
            (event.ctrlKey || event.metaKey) &&
            event.shiftKey &&
            this.focusedEntryID &&
            !isFormInput
          ) {
            event.preventDefault();
            this.handleKeyboardCopy().catch(() => void 0);
          }
          break;

        // ═══════════════════════════════════════════════════════════════════════
        // L: Toggle link/unlink status (alternative to Space)
        // ═══════════════════════════════════════════════════════════════════════
        case "l":
        case "L":
          if (
            this.focusedEntryID &&
            !isFormInput &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            event.preventDefault();
            this.handleKeyboardSpace().catch(() => void 0);
          }
          break;
      }
    };

    // FTR-COPY-LINK: Right-click to copy link URL
    this.boundHandleListContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      // Check if right-clicked on a link (anchor element)
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor || !anchor.href || anchor.href === "#") return;

      // Show context menu with copy option
      event.preventDefault();
      this.showLinkContextMenu(anchor, event);
    };

    // Attach listeners to listEl
    this.listEl.addEventListener("click", this.boundHandleListClick);
    this.listEl.addEventListener("mouseover", this.boundHandleListMouseOver);
    this.listEl.addEventListener("mouseout", this.boundHandleListMouseOut);
    this.listEl.addEventListener("mousemove", this.boundHandleListMouseMove);
    this.listEl.addEventListener("dblclick", this.boundHandleListDoubleClick);
    this.listEl.addEventListener(
      "contextmenu",
      this.boundHandleListContextMenu,
    );
    // FTR-KEYBOARD-NAV-FULL: Capture on document to intercept before default behavior
    this.body.ownerDocument?.addEventListener(
      "keydown",
      this.boundHandleBodyKeyDown,
      true,
    );
  }

  /**
   * Clean up event delegation listeners.
   */
  private cleanupEventDelegation() {
    if (this.boundHandleListClick) {
      this.listEl.removeEventListener("click", this.boundHandleListClick);
      this.boundHandleListClick = undefined;
    }
    if (this.boundHandleListMouseOver) {
      this.listEl.removeEventListener(
        "mouseover",
        this.boundHandleListMouseOver,
      );
      this.boundHandleListMouseOver = undefined;
    }
    if (this.boundHandleListMouseOut) {
      this.listEl.removeEventListener("mouseout", this.boundHandleListMouseOut);
      this.boundHandleListMouseOut = undefined;
    }
    if (this.boundHandleListMouseMove) {
      this.listEl.removeEventListener(
        "mousemove",
        this.boundHandleListMouseMove,
      );
      this.boundHandleListMouseMove = undefined;
    }
    if (this.boundHandleListDoubleClick) {
      this.listEl.removeEventListener(
        "dblclick",
        this.boundHandleListDoubleClick,
      );
      this.boundHandleListDoubleClick = undefined;
    }
    if (this.boundHandleBodyKeyDown) {
      this.body.ownerDocument?.removeEventListener(
        "keydown",
        this.boundHandleBodyKeyDown,
        true,
      );
      this.boundHandleBodyKeyDown = undefined;
    }
    // FTR-COPY-LINK: cleanup contextmenu handler
    if (this.boundHandleListContextMenu) {
      this.listEl.removeEventListener(
        "contextmenu",
        this.boundHandleListContextMenu,
      );
      this.boundHandleListContextMenu = undefined;
    }
    // Clear any pending click timer
    if (this.markerClickTimer) {
      clearTimeout(this.markerClickTimer);
      this.markerClickTimer = undefined;
    }
  }

  private observeChartResize(container: HTMLDivElement) {
    const doc = this.body.ownerDocument;
    const owningWindow = (doc?.defaultView || Zotero.getMainWindow?.()) as
      | Window
      | undefined;
    const ResizeObserverClass =
      owningWindow?.ResizeObserver ??
      (typeof ResizeObserver !== "undefined" ? ResizeObserver : undefined);
    if (!ResizeObserverClass) {
      return;
    }

    if (this.chartResizeObserver) {
      this.chartResizeObserver.disconnect();
    }

    const mainWindow = owningWindow ?? Zotero.getMainWindow?.();
    const schedule = mainWindow?.requestAnimationFrame
      ? mainWindow.requestAnimationFrame.bind(mainWindow)
      : (cb: FrameRequestCallback) =>
          (mainWindow?.setTimeout?.(cb, RAF_FALLBACK_MS) ??
            setTimeout(cb, RAF_FALLBACK_MS)) as unknown as number;
    const cancel = mainWindow?.cancelAnimationFrame
      ? mainWindow.cancelAnimationFrame.bind(mainWindow)
      : (id: number) => mainWindow?.clearTimeout?.(id) ?? clearTimeout(id);

    const resizeObserver = new ResizeObserverClass(
      (entries: ResizeObserverEntry[]) => {
        // Only re-render if we have data and width actually changed
        if (!this.allEntries.length || this.chartCollapsed) {
          return;
        }
        const entry = entries[0];
        if (!entry) return;
        const newWidth = entry.contentRect.width;
        // Skip if width hasn't changed significantly (within 1px tolerance)
        if (
          this.lastChartWidth !== undefined &&
          Math.abs(newWidth - this.lastChartWidth) < 2
        ) {
          return;
        }
        this.lastChartWidth = newWidth;

        this.clearPendingChartResize();
        const frameId = schedule(() => {
          this.chartResizeFrame = undefined;
          this.renderChart();
        });
        this.chartResizeFrame = { cancel, id: frameId };
      },
    );

    resizeObserver.observe(container);
    this.chartResizeObserver = resizeObserver;
  }

  private clearPendingChartResize() {
    if (this.chartResizeFrame) {
      this.chartResizeFrame.cancel(this.chartResizeFrame.id);
      this.chartResizeFrame = undefined;
    }
  }

  /**
   * FTR-DARK-MODE-AUTO: Set up theme change listener to re-render chart SVG.
   * The chart container and buttons use CSS variables for auto-adaptation,
   * but SVG bar colors need to be recalculated when theme changes.
   */
  private setupThemeChangeListener() {
    try {
      const mainWindow = Zotero.getMainWindow?.();
      if (!mainWindow?.matchMedia) return;

      const mediaQuery = mainWindow.matchMedia("(prefers-color-scheme: dark)");
      if (!mediaQuery) return;

      this.themeMediaQuery = mediaQuery;
      this.themeChangeListener = () => {
        // Re-render chart to update SVG bar colors
        if (!this.chartCollapsed && this.allEntries.length) {
          this.renderChartImmediate();
        }
        // FTR-CONSISTENT-UI: Update button styles on theme change
        this.updatePublishedOnlyButtonStyle();
        this.updateAuthorFilterButtonStyle();
        // Update chart toggle buttons
        if (this.chartContainer) {
          const dark = isDarkMode();
          const buttons = this.chartContainer.querySelectorAll(
            ".zinspire-chart-toggle-btn",
          );
          buttons.forEach((btn) => {
            const btnEl = btn as HTMLButtonElement;
            const isActive = btnEl.classList.contains("active");
            applyPillButtonStyle(btnEl, isActive, dark);
          });
          // Update self-cite button
          const selfCiteBtn = this.chartContainer.querySelector(
            ".zinspire-chart-selfcite-filter-btn",
          ) as HTMLButtonElement | null;
          if (selfCiteBtn) {
            applyPillButtonStyle(selfCiteBtn, this.excludeSelfCitations, dark);
          }
        }
      };

      // Use addListener for compatibility with older browsers
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", this.themeChangeListener);
      } else if ((mediaQuery as any).addListener) {
        // Deprecated but still works in some environments
        (mediaQuery as any).addListener(this.themeChangeListener);
      }
    } catch (err) {
      Zotero.debug(`[${config.addonName}] Failed to setup theme listener: ${err}`);
    }
  }

  /**
   * FTR-DARK-MODE-AUTO: Remove theme change listener.
   */
  private removeThemeChangeListener() {
    if (this.themeMediaQuery && this.themeChangeListener) {
      try {
        if (this.themeMediaQuery.removeEventListener) {
          this.themeMediaQuery.removeEventListener("change", this.themeChangeListener);
        } else if (this.themeMediaQuery.removeListener) {
          this.themeMediaQuery.removeListener(this.themeChangeListener);
        }
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.themeMediaQuery = undefined;
    this.themeChangeListener = undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chart Methods - Statistics visualization for references/cited-by/author papers
  // ─────────────────────────────────────────────────────────────────────────────

  private createChartContainer(): HTMLDivElement {
    const doc = this.body.ownerDocument;
    const container = doc.createElement("div");
    container.className = "zinspire-chart-container";
    // FTR-DARK-MODE-AUTO: Use CSS variables for automatic theme adaptation (like author card)
    // FIX-ZINDEX: Use position:relative and z-index:1 so quick filters popup (z-index:1000) stays on top
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      border: 1px solid var(--fill-quaternary, #cbd5e1);
      border-radius: 8px;
      padding: 6px 10px;
      background: var(--material-sidepane, #f8fafc);
      flex-shrink: 0;
      height: auto;
      min-height: auto;
      max-height: auto;
      max-width: 100%;
      overflow: hidden;
      box-sizing: border-box;
      position: relative;
      z-index: 1;
    `;

    // Header with view buttons
    const header = doc.createElement("div");
    header.className = "zinspire-chart-header";
    header.style.cssText = `
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      margin-bottom: 4px;
      flex-shrink: 0;
      max-width: 100%;
    `;

    // Sub-header for filters (second row)
    const subHeader = doc.createElement("div");
    subHeader.className = "zinspire-chart-subheader";
    subHeader.style.cssText = `
      display: ${this.chartCollapsed ? "none" : "flex"};
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      font-size: 11px;
      margin-bottom: 4px;
      margin-left: 0;
      padding-left: 0;
      width: 100%;
      flex-shrink: 0;
    `;
    this.chartSubHeader = subHeader;

    // Collapse button - initial state based on chartCollapsed preference
    // FTR-DARK-MODE-AUTO: Use CSS variables for automatic theme adaptation
    const collapseBtn = doc.createElement("button");
    collapseBtn.className = "zinspire-chart-collapse-btn";
    collapseBtn.type = "button";
    collapseBtn.textContent = this.chartCollapsed ? "▶" : "▼";
    collapseBtn.title = getString(
      this.chartCollapsed
        ? "references-panel-chart-expand"
        : "references-panel-chart-collapse",
    );
    collapseBtn.style.cssText = `
      border: 1px solid var(--fill-quaternary, #cbd5e1);
      background: var(--material-background, #f1f5f9);
      font-size: 10px;
      cursor: pointer;
      color: var(--fill-secondary, #64748b);
      padding: 2px 8px;
      border-radius: 4px;
      flex-shrink: 0;
    `;
    collapseBtn.onclick = () => {
      this.toggleChartCollapse();
    };

    // View toggle buttons - use CSS classes to manage active/inactive state styles
    // FTR-CONSISTENT-UI: Use unified pill button style for consistent appearance
    const yearBtn = doc.createElement("button");
    yearBtn.className = "zinspire-chart-toggle-btn active";
    yearBtn.type = "button";
    yearBtn.textContent = getString("references-panel-chart-by-year");
    yearBtn.dataset.mode = "year";
    yearBtn.style.flexShrink = "0";
    yearBtn.style.fontWeight = "500";
    yearBtn.style.fontSize = "11px";
    applyPillButtonStyle(yearBtn, true, isDarkMode());
    yearBtn.onclick = () => this.toggleChartView("year");

    const citationBtn = doc.createElement("button");
    citationBtn.className = "zinspire-chart-toggle-btn";
    citationBtn.type = "button";
    citationBtn.textContent = getString("references-panel-chart-by-citation");
    citationBtn.dataset.mode = "citation";
    citationBtn.style.flexShrink = "0";
    citationBtn.style.fontWeight = "500";
    citationBtn.style.fontSize = "11px";
    applyPillButtonStyle(citationBtn, false, isDarkMode());
    citationBtn.onclick = () => this.toggleChartView("citation");

    // Clear filter button (right after citations button)
    const clearBtn = doc.createElement("button");
    clearBtn.className = "zinspire-chart-clear-btn";
    clearBtn.type = "button";
    clearBtn.textContent = "✕";
    clearBtn.title = getString("references-panel-chart-clear-filter");
    clearBtn.style.cssText = `
      border: none;
      background: #fee2e2;
      font-size: 11px;
      cursor: pointer;
      color: #dc2626;
      padding: 3px 8px;
      border-radius: 5px;
      flex-shrink: 0;
      display: none;
      margin-left: 4px;
      font-weight: 500;
    `;
    clearBtn.onclick = () => {
      this.clearAllFilters();
    };

    // Author filter button (filter papers with <= 10 authors, i.e., non-large-collaboration)
    // FTR-CONSISTENT-UI: Use unified pill button style
    const authorFilterBtn = doc.createElement("button");
    authorFilterBtn.className = "zinspire-chart-author-filter-btn";
    authorFilterBtn.type = "button";
    authorFilterBtn.textContent = getString(
      "references-panel-chart-author-filter",
    );
    authorFilterBtn.title = getString(
      "references-panel-chart-author-filter-tooltip",
    );
    authorFilterBtn.style.flexShrink = "0";
    authorFilterBtn.style.fontWeight = "500";
    authorFilterBtn.style.fontSize = "11px";
    this.authorFilterButton = authorFilterBtn as HTMLButtonElement;
    authorFilterBtn.onclick = () => {
      this.authorFilterEnabled = !this.authorFilterEnabled;
      this.updateAuthorFilterButtonStyle();
      this.renderChart();
      this.renderReferenceList();
      // FTR-AUTHOR-CARD-FILTERS: Update author stats when filter changes
      if (this.viewMode === "entryCited" && this.entryCitedSource?.authorSearchInfo) {
        this.updateAuthorStats(this.getEntriesForAuthorStats());
        this.updateAuthorProfileCard();
      }
    };
    this.updateAuthorFilterButtonStyle();

    // Self-citation exclusion toggle
    // FTR-CONSISTENT-UI: Use unified pill button style
    const selfCiteBtn = doc.createElement("button");
    selfCiteBtn.className = "zinspire-chart-selfcite-filter-btn";
    selfCiteBtn.type = "button";
    selfCiteBtn.textContent = getString(
      "references-panel-chart-selfcite-filter",
    );
    selfCiteBtn.title = getString(
      "references-panel-chart-selfcite-filter-tooltip",
    );
    selfCiteBtn.style.flexShrink = "0";
    selfCiteBtn.style.fontWeight = "500";
    selfCiteBtn.style.fontSize = "11px";
    const updateSelfCiteStyle = () => {
      applyPillButtonStyle(selfCiteBtn, this.excludeSelfCitations, isDarkMode());
    };
    selfCiteBtn.onclick = () => {
      this.excludeSelfCitations = !this.excludeSelfCitations;
      updateSelfCiteStyle();
      // Re-apply sorting when in References mode with citationDesc sort
      // since citation values depend on excludeSelfCitations flag
      if (
        this.viewMode === "references" &&
        this.referenceSort === "citationDesc"
      ) {
        const cacheKey = this.currentRecid ?? "";
        const cached = this.referencesCache.get(cacheKey);
        if (cached) {
          this.allEntries = this.getSortedReferences(cached);
        }
      }
      this.renderChart();
      this.renderReferenceList();
      if (this.viewMode === "entryCited" && this.entryCitedSource?.authorSearchInfo) {
        // FTR-AUTHOR-CARD-FILTERS: Use filtered entries for author stats
        this.updateAuthorStats(this.getEntriesForAuthorStats());
        this.updateAuthorProfileCard();
      }
    };
    updateSelfCiteStyle();

    // Published only filter button (filter papers with journal information)
    // FTR-CONSISTENT-UI: Use unified pill button style
    const publishedOnlyBtn = doc.createElement("button");
    publishedOnlyBtn.className = "zinspire-chart-published-filter-btn";
    publishedOnlyBtn.type = "button";
    publishedOnlyBtn.textContent = getString(
      "references-panel-chart-published-only",
    );
    publishedOnlyBtn.title = getString(
      "references-panel-chart-published-only-tooltip",
    );
    publishedOnlyBtn.style.flexShrink = "0";
    publishedOnlyBtn.style.fontWeight = "500";
    publishedOnlyBtn.style.fontSize = "11px";
    publishedOnlyBtn.onclick = () => {
      this.toggleQuickFilter("publishedOnly");
    };
    this.publishedOnlyButton = publishedOnlyBtn as HTMLButtonElement;
    this.updatePublishedOnlyButtonStyle();

    // Spacer to push stats to the right
    const spacer = doc.createElement("div");
    spacer.style.cssText = `flex: 1;`;

    // Stats display (two lines: header + subheader alignment)
    // FTR-DARK-MODE-AUTO: Use CSS variables for automatic theme adaptation
    const statsTopLine = doc.createElement("span");
    statsTopLine.className = "zinspire-chart-stats zinspire-chart-stats-top";
    statsTopLine.style.cssText = `
      font-size: 11px;
      color: var(--fill-secondary, #64748b);
      font-weight: 500;
      text-align: left;
      line-height: 1.3;
    `;
    const statsBottomLine = doc.createElement("span");
    statsBottomLine.className =
      "zinspire-chart-stats zinspire-chart-stats-bottom";
    statsBottomLine.style.cssText = `
      font-size: 11px;
      color: var(--fill-secondary, #64748b);
      font-weight: 500;
      text-align: left;
      line-height: 1.3;
    `;

    this.chartStatsTopLine = statsTopLine;
    this.chartStatsBottomLine = statsBottomLine;

    header.appendChild(collapseBtn);
    header.appendChild(yearBtn);
    header.appendChild(citationBtn);
    header.appendChild(clearBtn);
    header.appendChild(spacer);
    header.appendChild(statsTopLine);

    // Add filter buttons to subheader
    subHeader.appendChild(authorFilterBtn);
    subHeader.appendChild(selfCiteBtn);
    subHeader.appendChild(publishedOnlyBtn);

    // Add spacer before bottom stats to align with top line
    const subHeaderSpacer = doc.createElement("div");
    subHeaderSpacer.style.cssText = `flex: 1;`;
    subHeader.appendChild(subHeaderSpacer);
    subHeader.appendChild(statsBottomLine);

    // SVG wrapper for the chart - initial visibility based on chartCollapsed preference
    const svgWrapper = doc.createElement("div");
    svgWrapper.className = "zinspire-chart-svg-wrapper";
    svgWrapper.style.cssText = `
      flex: 1;
      min-height: 0;
      overflow: hidden;
      height: 130px;
      display: ${this.chartCollapsed ? "none" : "block"};
      max-width: 100%;
      box-sizing: border-box;
    `;
    this.chartSvgWrapper = svgWrapper;

    container.appendChild(header);
    container.appendChild(subHeader);
    container.appendChild(svgWrapper);

    this.chartContainer = container;
    return container;
  }

  private toggleChartView(mode: "year" | "citation") {
    // Check if chart is enabled in preferences
    if (!this.isChartEnabled()) {
      this.showChartDisabledMessage();
      return;
    }

    if (this.chartViewMode === mode) return;
    this.chartViewMode = mode;
    this.chartSelectedBins.clear(); // Clear selection when switching views
    this.cachedChartStats = undefined; // Invalidate cache

    // Update button states with inline styles (dark mode aware)
    if (this.chartContainer) {
      const dark = isDarkMode();
      const buttons = this.chartContainer.querySelectorAll(
        ".zinspire-chart-toggle-btn",
      );
      buttons.forEach((btn) => {
        const btnEl = btn as HTMLButtonElement;
        const isActive = btnEl.dataset.mode === mode;
        btnEl.classList.toggle("active", isActive);
        // FTR-CONSISTENT-UI: Use unified pill button style
        applyPillButtonStyle(btnEl, isActive, dark);
      });
    }

    this.updateChartClearButton(); // Hide clear button after clearing selection
    this.renderChart();
    this.renderReferenceList();
  }

  /**
   * Check if chart is enabled in preferences.
   */
  private isChartEnabled(): boolean {
    return getPref("chart_enable") !== false;
  }

  /**
   * Show message when chart is disabled and user tries to interact with it.
   */
  private showChartDisabledMessage() {
    const win = Zotero.getMainWindow();
    if (win) {
      Services.prompt.alert(
        win as unknown as mozIDOMWindowProxy,
        getString("references-panel-chart-disabled-title") || "Chart Disabled",
        getString("references-panel-chart-disabled-message") ||
          "Statistics chart is disabled. Enable it in Zotero Preferences → INSPIRE.",
      );
    }
  }

  private toggleChartCollapse() {
    // Check if chart is enabled in preferences when trying to expand
    if (!this.isChartEnabled() && this.chartCollapsed) {
      this.showChartDisabledMessage();
      return;
    }

    this.chartCollapsed = !this.chartCollapsed;
    if (this.chartContainer && this.chartSvgWrapper) {
      // Directly control visibility with JS (more reliable than CSS classes in Zotero)
      if (this.chartCollapsed) {
        this.chartSvgWrapper.style.display = "none";
        // Clear chart data to avoid hidden filters affecting list rendering
        this.chartSvgWrapper.textContent = "";
        this.chartSelectedBins.clear();
        this.cachedChartStats = undefined;
        this.lastChartClickedKey = undefined;
        this.chartNeedsRefresh = true;
        this.clearChartStatsDisplay();
        this.renderReferenceList({ preserveScroll: true });
        this.updateChartClearButton();
        if (this.chartSubHeader) {
          this.chartSubHeader.style.display = "none";
        }
        this.chartContainer.style.height = "auto";
        this.chartContainer.style.minHeight = "auto";
        this.chartContainer.style.maxHeight = "auto";
        this.chartContainer.style.padding = "6px 10px";
      } else {
        this.chartSvgWrapper.style.display = "block";
        if (this.chartSubHeader) {
          this.chartSubHeader.style.display = "flex";
        }
        this.chartContainer.style.height = "auto";
        this.chartContainer.style.minHeight = "auto";
        this.chartContainer.style.maxHeight = "auto";
        this.chartContainer.style.padding = "10px";
        // Render chart when expanding
        this.renderChartImmediate();
      }
      const collapseBtn = this.chartContainer.querySelector(
        ".zinspire-chart-collapse-btn",
      );
      if (collapseBtn) {
        collapseBtn.textContent = this.chartCollapsed ? "▶" : "▼";
        (collapseBtn as HTMLButtonElement).title = getString(
          this.chartCollapsed
            ? "references-panel-chart-expand"
            : "references-panel-chart-collapse",
        );
      }
    }
  }

  private computeYearStats(
    entries: InspireReferenceEntry[],
    maxBars: number = 10,
  ): ChartBin[] {
    const yearCounts = new Map<number, number>();
    const MAX_BARS = maxBars;
    const MIN_COUNT_PER_BIN = 3; // Minimum papers to warrant a separate bin

    // Count entries per year
    for (const entry of entries) {
      const year = parseInt(entry.year || "0", 10);
      if (year > 0) {
        yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
      }
    }

    if (yearCounts.size === 0) return [];

    // Sort years chronologically
    const sorted = Array.from(yearCounts.entries()).sort((a, b) => a[0] - b[0]);
    const totalCount = sorted.reduce((sum, [, count]) => sum + count, 0);

    // Helper to format year label (use last 2 digits with apostrophe)
    const formatYearLabel = (startYear: number, endYear?: number): string => {
      const startStr = "'" + String(startYear).slice(-2);
      if (endYear === undefined || endYear === startYear) {
        return startStr;
      }
      const endStr = "'" + String(endYear).slice(-2);
      return `${startStr}-${endStr}`;
    };

    // Helper to create a bin from years array
    const createBin = (years: number[]): ChartBin => {
      const count = years.reduce((sum, y) => sum + (yearCounts.get(y) || 0), 0);
      return {
        label: formatYearLabel(years[0], years[years.length - 1]),
        count,
        years,
        key:
          years.length === 1
            ? String(years[0])
            : `${years[0]}-${years[years.length - 1]}`,
      };
    };

    // If few unique years, just create one bin per year
    if (sorted.length <= MAX_BARS) {
      return sorted.map(([year, count]) => ({
        label: formatYearLabel(year),
        count,
        years: [year],
        key: String(year),
      }));
    }

    // Strategy: Merge sparse early years, keep recent years separate
    // Phase 1: Start from the oldest years, greedily merge until we have enough papers
    const targetCountPerBin = Math.max(
      MIN_COUNT_PER_BIN,
      Math.ceil(totalCount / MAX_BARS),
    );
    let bins: ChartBin[] = [];
    let currentYears: number[] = [];
    let currentCount = 0;

    for (let i = 0; i < sorted.length; i++) {
      const [year, count] = sorted[i];
      currentYears.push(year);
      currentCount += count;

      const remainingYears = sorted.length - i - 1;
      const remainingBins = MAX_BARS - bins.length - 1;

      // Create a bin if:
      // 1. We have enough papers, OR
      // 2. We need to leave room for remaining years (one year per bin for recent years)
      const shouldCreateBin =
        currentCount >= targetCountPerBin ||
        (remainingYears <= remainingBins && currentCount > 0) ||
        i === sorted.length - 1;

      if (shouldCreateBin && currentYears.length > 0) {
        bins.push(createBin(currentYears));
        currentYears = [];
        currentCount = 0;
      }
    }

    // Phase 2: If too many bins, merge small adjacent bins from the beginning
    while (bins.length > MAX_BARS && bins.length >= 2) {
      // Find the pair with smallest combined count to merge
      let minSum = Infinity;
      let mergeIdx = 0;
      for (let i = 0; i < bins.length - 1; i++) {
        const sum = bins[i].count + bins[i + 1].count;
        if (sum < minSum) {
          minSum = sum;
          mergeIdx = i;
        }
      }
      const allYears = [
        ...(bins[mergeIdx].years || []),
        ...(bins[mergeIdx + 1].years || []),
      ].sort((a, b) => a - b);
      bins = [
        ...bins.slice(0, mergeIdx),
        createBin(allYears),
        ...bins.slice(mergeIdx + 2),
      ];
    }

    // Phase 3: Merge tiny leading bins (very few papers in early years)
    while (
      bins.length > 3 &&
      bins[0].count < MIN_COUNT_PER_BIN &&
      bins[0].count + bins[1].count < targetCountPerBin * 1.5
    ) {
      const allYears = [
        ...(bins[0].years || []),
        ...(bins[1].years || []),
      ].sort((a, b) => a - b);
      bins = [createBin(allYears), ...bins.slice(2)];
    }

    return bins;
  }

  private computeCitationStats(entries: InspireReferenceEntry[]): ChartBin[] {
    const ranges: Array<{
      label: string;
      min: number;
      max: number;
      key: string;
    }> = [
      { label: "0", min: 0, max: 0, key: "0" },
      { label: "1-9", min: 1, max: 9, key: "1-9" },
      { label: "10-49", min: 10, max: 49, key: "10-49" },
      { label: "50-99", min: 50, max: 99, key: "50-99" },
      { label: "100-249", min: 100, max: 249, key: "100-249" },
      { label: "250-499", min: 250, max: 499, key: "250-499" },
      { label: "500+", min: 500, max: Infinity, key: "500+" },
    ];

    const counts = new Map<string, number>();
    ranges.forEach((r) => counts.set(r.key, 0));

    for (const entry of entries) {
      const citationCount = this.getCitationValue(entry);
      for (const range of ranges) {
        if (citationCount >= range.min && citationCount <= range.max) {
          counts.set(range.key, (counts.get(range.key) || 0) + 1);
          break;
        }
      }
    }

    return ranges.map((r) => ({
      label: r.label,
      count: counts.get(r.key) || 0,
      range: [r.min, r.max === Infinity ? Number.MAX_SAFE_INTEGER : r.max] as [
        number,
        number,
      ],
      key: r.key,
    }));
  }

  /**
   * Get the citation value that should be used for chart calculations.
   * When excludeSelfCitations is enabled and data is available, prefer the
   * citationCountWithoutSelf field. Otherwise fall back to the standard citationCount.
   */
  private getCitationValue(entry: InspireReferenceEntry): number {
    if (this.excludeSelfCitations) {
      if (typeof entry.citationCountWithoutSelf === "number") {
        return entry.citationCountWithoutSelf;
      }
    }
    if (typeof entry.citationCount === "number") {
      return entry.citationCount;
    }
    if (typeof entry.citationCountWithoutSelf === "number") {
      return entry.citationCountWithoutSelf;
    }
    return 0;
  }

  private renderChartLoading() {
    if (!this.chartSvgWrapper) return;
    // Cancel any pending chart render to avoid processing stale data
    if (this.chartRenderTimer) {
      clearTimeout(this.chartRenderTimer);
      this.chartRenderTimer = undefined;
    }
    this.chartSvgWrapper.textContent = "";
    const loadingMsg = this.chartSvgWrapper.ownerDocument.createElement("div");
    loadingMsg.className = "zinspire-chart-no-data";
    loadingMsg.style.cssText = toStyleString(getChartNoDataItalicStyle());
    loadingMsg.textContent = "Loading...";
    this.chartSvgWrapper.appendChild(loadingMsg);
  }

  // Throttle interval for chart rendering during rapid data updates (ms)
  private static readonly CHART_THROTTLE_INTERVAL = CHART_THROTTLE_MS;
  private lastChartRenderTime = 0;

  /**
   * Render chart with throttling (for rapid updates during progressive loading).
   * Use renderChartImmediate() when you need guaranteed synchronous rendering.
   */
  private renderChart() {
    // Early return for collapsed or missing container - no deferred scheduling needed
    if (!this.chartSvgWrapper) return;
    if (this.chartCollapsed) {
      this.chartNeedsRefresh = true;
      return;
    }

    // Cancel any pending chart render to avoid duplicate work
    if (this.chartRenderTimer) {
      clearTimeout(this.chartRenderTimer);
      this.chartRenderTimer = undefined;
    }

    // Throttle chart rendering during rapid updates (e.g., progressive loading)
    const now = performance.now();
    const timeSinceLastRender = now - this.lastChartRenderTime;
    const delay =
      timeSinceLastRender <
      InspireReferencePanelController.CHART_THROTTLE_INTERVAL
        ? InspireReferencePanelController.CHART_THROTTLE_INTERVAL -
          timeSinceLastRender
        : 0;

    // Defer chart rendering to allow main thread to handle UI updates first
    // This improves perceived performance during data loading
    this.chartRenderTimer = setTimeout(() => {
      this.chartRenderTimer = undefined;
      this.lastChartRenderTime = performance.now();
      this.doRenderChart();
    }, delay);
  }

  /**
   * Render chart immediately without throttling.
   * Use this when chart must be rendered synchronously (e.g., first data load, tab switch).
   */
  private renderChartImmediate() {
    // Cancel any pending throttled render
    if (this.chartRenderTimer) {
      clearTimeout(this.chartRenderTimer);
      this.chartRenderTimer = undefined;
    }
    if (!this.chartSvgWrapper) {
      return;
    }
    if (this.chartCollapsed) {
      // Mark for refresh so we re-render once the user expands the chart
      this.chartNeedsRefresh = true;
      return;
    }
    this.lastChartRenderTime = performance.now();
    this.doRenderChart();
    this.chartNeedsRefresh = false;
  }

  /**
   * Actual chart rendering logic (called after deferred scheduling).
   */
  private doRenderChart() {
    if (!this.chartSvgWrapper || this.chartCollapsed) return;

    // Clear previous content
    this.chartSvgWrapper.textContent = "";

    // Apply all global filters except for chart bin selection (handled separately)
    const entries = this.getFilteredEntries(this.allEntries, {
      skipChartFilter: true,
    });
    if (!entries.length) {
      const noDataMsg = this.chartSvgWrapper.ownerDocument.createElement("div");
      noDataMsg.className = "zinspire-chart-no-data";
      noDataMsg.style.cssText = toStyleString(getChartNoDataStyle());
      noDataMsg.textContent = getString("references-panel-chart-no-data");
      this.chartSvgWrapper.appendChild(noDataMsg);
      return;
    }

    // Dynamic bar count based on container width
    const MAX_BAR_WIDTH = CHART_MAX_BAR_WIDTH;
    const MIN_BAR_WIDTH = 20;
    const DEFAULT_MAX_BARS = 10;
    const BAR_GAP = 3;
    const PADDING = 16; // left + right padding

    // Get actual container width
    const containerWidth = this.chartSvgWrapper.clientWidth || 400;

    // Calculate how many bars can fit at max width
    // Formula: containerWidth = n * maxBarWidth + (n-1) * gap + padding
    // Solving for n: n = (containerWidth - padding + gap) / (maxBarWidth + gap)
    const maxPossibleBars = Math.floor(
      (containerWidth - PADDING + BAR_GAP) / (MAX_BAR_WIDTH + BAR_GAP),
    );
    const dynamicMaxBars = Math.max(
      DEFAULT_MAX_BARS,
      Math.min(maxPossibleBars, 20),
    ); // Cap at 20

    // Compute stats based on current view mode
    let stats =
      this.chartViewMode === "year"
        ? this.computeYearStats(entries, dynamicMaxBars)
        : this.computeCitationStats(entries);

    // Fallback: If year mode returns no stats but we have entries, try citation mode
    // This handles cases where references lack year information
    if (!stats.length && this.chartViewMode === "year" && entries.length > 0) {
      Zotero.debug(
        `[${config.addonName}] Chart: No year data for ${entries.length} entries, falling back to citation view`,
      );
      stats = this.computeCitationStats(entries);
      // Note: Don't change chartViewMode - this is just a display fallback
      // User can still switch views, and next render will try year mode first
    }

    if (!stats.length) {
      this.clearChartStatsDisplay();
      const noDataMsg = this.chartSvgWrapper.ownerDocument.createElement("div");
      noDataMsg.className = "zinspire-chart-no-data";
      noDataMsg.textContent = getString("references-panel-chart-no-data");
      this.chartSvgWrapper.appendChild(noDataMsg);
      return;
    }

    // Cache stats
    this.cachedChartStats = { mode: this.chartViewMode, stats };

    // Update stats display in header
    this.updateChartStatsDisplay(entries);

    // Create SVG - use actual pixel dimensions, no viewBox scaling
    const SVG_NS = "http://www.w3.org/2000/svg";
    const doc = this.chartSvgWrapper.ownerDocument;

    const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;

    // Chart dimensions in actual pixels
    const chartHeight = 80; // Fixed chart area height
    const barGap = 4;

    // Calculate bar width first to determine if labels need rotation
    const MAX_BAR_WIDTH_RENDER = CHART_MAX_BAR_WIDTH;
    const MIN_BAR_WIDTH_RENDER = 15;
    const basePadding = { top: 4, right: 8, left: 8 };
    const availableWidth =
      containerWidth - basePadding.left - basePadding.right;
    const totalGaps = (stats.length - 1) * barGap;
    const calculatedBarWidth = (availableWidth - totalGaps) / stats.length;
    const barWidth = Math.max(
      MIN_BAR_WIDTH_RENDER,
      Math.min(calculatedBarWidth, MAX_BAR_WIDTH_RENDER),
    );

    // Determine if labels should be rotated (when bars are narrow or many)
    const rotateLabels = barWidth < 38 || stats.length > 8;
    // Increase bottom padding when labels are rotated to accommodate angled text
    const padding = { ...basePadding, bottom: rotateLabels ? 42 : 24 };
    const svgHeight = chartHeight + padding.top + padding.bottom;

    // Use actual container width
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", String(svgHeight));
    // No viewBox - draw in actual pixels, SVG will naturally fill width

    const maxCount = Math.max(...stats.map((s) => s.count), 1);

    const actualTotalWidth = stats.length * barWidth + totalGaps;
    const startX = padding.left + (availableWidth - actualTotalWidth) / 2;

    // Create bars
    const fragment = doc.createDocumentFragment();

    // Colors for bars - dark mode aware
    const dark = isDarkMode();
    const selectedColor = dark ? "#60a5fa" : "#3b82f6"; // blue-400/500 for selected
    const unselectedColor = dark ? "#3b82f6" : "#93c5fd"; // blue-500/300 for unselected
    const labelColor = dark ? "#a0a0a5" : "#4a4a4f"; // axis label color
    const countSelectedColor = "#ffffff"; // white on selected bar
    const countUnselectedColor = dark ? "#c7d2fe" : "#1e3a5f"; // count label on unselected

    // Label positioning for rotated labels
    const labelBaseline = padding.top + chartHeight + (rotateLabels ? 14 : 16);
    const rotationAngle = -35; // Negative for counter-clockwise rotation

    stats.forEach((bin, index) => {
      const barHeight = Math.max((bin.count / maxCount) * chartHeight, 2); // Minimum height of 2
      const x = startX + index * (barWidth + barGap);
      const y = padding.top + chartHeight - barHeight;

      // Bar group
      const g = doc.createElementNS(SVG_NS, "g") as SVGGElement;
      g.setAttribute("class", "zinspire-chart-bar-group");
      g.dataset.key = bin.key;

      // Bar rectangle
      const isSelected = this.chartSelectedBins.has(bin.key);
      const rect = doc.createElementNS(SVG_NS, "rect") as SVGRectElement;
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(barWidth));
      rect.setAttribute("height", String(barHeight));
      rect.setAttribute("rx", "2");
      rect.setAttribute(
        "class",
        `zinspire-chart-bar${isSelected ? " selected" : ""}`,
      );
      rect.setAttribute("fill", isSelected ? selectedColor : unselectedColor);

      // Tooltip
      const title = doc.createElementNS(SVG_NS, "title") as SVGTitleElement;
      title.textContent = `${bin.label}: ${bin.count} ${bin.count === 1 ? "paper" : "papers"}`;
      rect.appendChild(title);

      // X-axis label
      const text = doc.createElementNS(SVG_NS, "text") as SVGTextElement;
      const labelX = x + barWidth / 2;
      text.setAttribute("y", String(labelBaseline));
      if (rotateLabels) {
        // Use "end" anchor so all labels align at their top (text end) regardless of length
        // Shift x position right so the rotated text end sits under the bar center
        const adjustedX = labelX + 11;
        text.setAttribute("x", String(adjustedX));
        text.setAttribute("text-anchor", "end");
        text.setAttribute(
          "transform",
          `rotate(${rotationAngle} ${adjustedX} ${labelBaseline})`,
        );
      } else {
        text.setAttribute("x", String(labelX));
        text.setAttribute("text-anchor", "middle");
      }
      text.setAttribute("font-size", "11");
      text.setAttribute("fill", labelColor);
      text.textContent = bin.label;

      // Count label on top of bar (only if bar is tall enough)
      if (barHeight > 18 && bin.count > 0) {
        const countText = doc.createElementNS(SVG_NS, "text") as SVGTextElement;
        countText.setAttribute("x", String(x + barWidth / 2));
        countText.setAttribute("y", String(y + 14));
        countText.setAttribute("text-anchor", "middle");
        countText.setAttribute("font-size", "10");
        countText.setAttribute("fill", isSelected ? countSelectedColor : countUnselectedColor);
        countText.textContent = String(bin.count);
        g.appendChild(countText);
      }

      g.appendChild(rect);
      g.appendChild(text);
      fragment.appendChild(g);
    });

    svg.appendChild(fragment);

    // Event delegation for bar clicks
    svg.addEventListener("click", (event) => {
      const target = event.target as Element;
      const group = target.closest(".zinspire-chart-bar-group");
      if (group) {
        const key = (group as HTMLElement).dataset.key;
        if (key) {
          this.handleChartBarClick(key, event);
        }
      }
    });

    this.chartSvgWrapper.appendChild(svg);

    // Update clear button visibility
    this.updateChartClearButton();
  }

  private handleChartBarClick(key: string, event: MouseEvent) {
    const isRangeSelect = event.shiftKey;
    const isMultiSelect = event.ctrlKey || event.metaKey;
    const handledRange =
      isRangeSelect && this.applyShiftChartSelection(key, isMultiSelect);

    if (!handledRange) {
      if (isMultiSelect) {
        // Toggle the clicked bin
        if (this.chartSelectedBins.has(key)) {
          this.chartSelectedBins.delete(key);
        } else {
          this.chartSelectedBins.add(key);
        }
      } else {
        // Single select: toggle if same, replace if different
        if (
          this.chartSelectedBins.size === 1 &&
          this.chartSelectedBins.has(key)
        ) {
          this.chartSelectedBins.clear();
        } else {
          this.chartSelectedBins.clear();
          this.chartSelectedBins.add(key);
        }
      }
    }

    this.lastChartClickedKey = key;
    this.renderChart();
    this.renderReferenceList();
  }

  private applyShiftChartSelection(key: string, additive: boolean): boolean {
    const stats = this.cachedChartStats?.stats;
    if (!stats?.length) {
      return false;
    }

    const rangeKeys = this.getChartRangeKeys(
      this.lastChartClickedKey,
      key,
      stats,
    );
    if (!rangeKeys.length) {
      // If no valid anchor, fall back to single key selection
      if (!additive && !this.chartSelectedBins.has(key)) {
        this.chartSelectedBins.clear();
        this.chartSelectedBins.add(key);
        return true;
      }
      return false;
    }

    if (!additive) {
      this.chartSelectedBins.clear();
    }
    for (const rangeKey of rangeKeys) {
      this.chartSelectedBins.add(rangeKey);
    }
    return true;
  }

  private getChartRangeKeys(
    anchorKey: string | undefined,
    targetKey: string,
    stats: ChartBin[],
  ): string[] {
    const targetIndex = stats.findIndex((bin) => bin.key === targetKey);
    if (targetIndex === -1) {
      return [];
    }

    const anchorIndex = anchorKey
      ? stats.findIndex((bin) => bin.key === anchorKey)
      : -1;
    const startIndex = anchorIndex === -1 ? targetIndex : anchorIndex;
    const lower = Math.min(startIndex, targetIndex);
    const upper = Math.max(startIndex, targetIndex);
    return stats.slice(lower, upper + 1).map((bin) => bin.key);
  }

  private updateChartClearButton() {
    if (!this.chartContainer) return;
    const clearBtn = this.chartContainer.querySelector(
      ".zinspire-chart-clear-btn",
    ) as HTMLButtonElement;
    if (clearBtn) {
      clearBtn.style.display = this.hasActiveFilters()
        ? "inline-block"
        : "none";
    }
  }

  /**
   * Update the stats display in chart header.
   * - By Year mode: shows total paper count (single line)
   * - By Citations mode: shows total citations on line 1, h-index and avg on line 2
   */
  private updateChartStatsDisplay(entries: InspireReferenceEntry[]) {
    const topLine = this.chartStatsTopLine;
    const bottomLine = this.chartStatsBottomLine;
    if (!topLine) return;

    topLine.textContent = "";
    if (bottomLine) {
      bottomLine.textContent = "";
    }

    if (this.chartViewMode === "year") {
      // Show total paper count (single line)
      const totalPapers = entries.length;
      topLine.textContent = `${totalPapers.toLocaleString()} ${totalPapers === 1 ? "paper" : "papers"}`;
      if (bottomLine) {
        bottomLine.textContent = "";
      }
    } else {
      // Show total citations, h-index, and average citations in two lines
      const citations = entries.map((entry) => this.getCitationValue(entry));
      const totalCitations = citations.reduce((sum, c) => sum + c, 0);
      const hIndex = this.calculateHIndex(citations);
      const avgCitations =
        entries.length > 0 ? totalCitations / entries.length : 0;

      topLine.textContent = `${totalCitations.toLocaleString()} ${this.excludeSelfCitations ? "cit. (no self)" : "citations"}`;
      if (bottomLine) {
        bottomLine.textContent = `h=${hIndex} · avg ${avgCitations.toFixed(1)}`;
      }
    }
  }

  /**
   * Calculate h-index from citation counts.
   * h-index: the maximum h such that h papers have at least h citations each.
   */
  private calculateHIndex(citations: number[]): number {
    if (citations.length === 0) return 0;

    // Sort in descending order
    const sorted = [...citations].sort((a, b) => b - a);

    // Find h: largest index where sorted[i] >= i + 1
    let h = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] >= i + 1) {
        h = i + 1;
      } else {
        break;
      }
    }
    return h;
  }

  /**
   * Clear the stats display when no data is available.
   */
  private clearChartStatsDisplay() {
    if (this.chartStatsTopLine) {
      this.chartStatsTopLine.textContent = "";
    }
    if (this.chartStatsBottomLine) {
      this.chartStatsBottomLine.textContent = "";
    }
  }

  private matchesChartFilter(entry: InspireReferenceEntry): boolean {
    if (!this.chartSelectedBins.size) return true;

    if (this.chartViewMode === "year") {
      const entryYear = parseInt(entry.year || "0", 10);
      if (entryYear <= 0) return false;

      return Array.from(this.chartSelectedBins).some((binKey) => {
        // binKey can be "2020" or "2018-2020"
        if (binKey.includes("-")) {
          const [start, end] = binKey.split("-").map((y) => parseInt(y, 10));
          return entryYear >= start && entryYear <= end;
        } else {
          return entryYear === parseInt(binKey, 10);
        }
      });
    } else {
      // Citation mode
      const citationCount = this.getCitationValue(entry);

      return Array.from(this.chartSelectedBins).some((binKey) => {
        switch (binKey) {
          case "0":
            return citationCount === 0;
          case "1-9":
            return (
              citationCount >= CITATION_RANGES.LOW_MIN &&
              citationCount <= CITATION_RANGES.LOW_MAX
            );
          case "10-49":
            return (
              citationCount >= CITATION_RANGES.MID_LOW_MIN &&
              citationCount <= CITATION_RANGES.MID_LOW_MAX
            );
          case "50-99":
            return (
              citationCount >= CITATION_RANGES.MID_MIN &&
              citationCount <= CITATION_RANGES.MID_MAX
            );
          case "100-249":
            return (
              citationCount >= CITATION_RANGES.MID_HIGH_MIN &&
              citationCount <= CITATION_RANGES.MID_HIGH_MAX
            );
          case "250-499":
            return (
              citationCount >= CITATION_RANGES.HIGH_MIN &&
              citationCount <= CITATION_RANGES.HIGH_MAX
            );
          case "500+":
            return citationCount >= CITATION_RANGES.VERY_HIGH_MIN;
          default:
            return false;
        }
      });
    }
  }

  /**
   * Check if an entry matches the author count filter.
   * Returns true if author filter is disabled or if entry has <= 10 authors.
   * Uses totalAuthors field which comes from INSPIRE API's author_count.
   */
  private matchesAuthorFilter(entry: InspireReferenceEntry): boolean {
    // Use totalAuthors which is the actual author count from INSPIRE API
    // This is more reliable than authors.length which is limited for performance
    const authorCount = entry.totalAuthors ?? entry.authors?.length ?? 0;
    return authorCount > 0 && authorCount <= SMALL_AUTHOR_GROUP_THRESHOLD;
  }

  private matchesHighCitationsFilter(entry: InspireReferenceEntry): boolean {
    const citationCount = this.getCitationValue(entry);
    return citationCount > HIGH_CITATIONS_THRESHOLD;
  }

  private matchesRecentYearsFilter(
    entry: InspireReferenceEntry,
    years: number,
  ): boolean {
    const normalizedYears = Math.max(1, years);
    const currentYear = new Date().getFullYear();
    const thresholdYear = currentYear - (normalizedYears - 1);
    const entryYear = Number.parseInt(entry.year ?? "", 10);
    if (Number.isNaN(entryYear)) {
      return false;
    }
    return entryYear >= thresholdYear;
  }

  private matchesPreprintOnlyFilter(entry: InspireReferenceEntry): boolean {
    return (
      this.hasArxivIdentifier(entry) && !this.matchesPublishedOnlyFilter(entry)
    );
  }

  private matchesRelatedOnlyFilter(entry: InspireReferenceEntry): boolean {
    return entry.isRelated === true;
  }

  private matchesLocalItemsFilter(entry: InspireReferenceEntry): boolean {
    return typeof entry.localItemID === "number" && entry.localItemID > 0;
  }

  private matchesOnlineItemsFilter(entry: InspireReferenceEntry): boolean {
    return typeof entry.localItemID !== "number" || entry.localItemID <= 0;
  }

  /**
   * Check if entry has journal information (formally published).
   * Returns true if the paper has journal_title or journal_title_abbrev.
   * Papers with both journal info and arXiv are included (they are published).
   */
  private matchesPublishedOnlyFilter(entry: InspireReferenceEntry): boolean {
    const info = entry.publicationInfo;
    return !!(info?.journal_title || info?.journal_title_abbrev);
  }

  private hasArxivIdentifier(entry: InspireReferenceEntry): boolean {
    if (!entry.arxivDetails) {
      return false;
    }
    if (typeof entry.arxivDetails === "string") {
      return entry.arxivDetails.trim().length > 0;
    }
    if (typeof entry.arxivDetails === "object") {
      if (
        typeof entry.arxivDetails.id === "string" &&
        entry.arxivDetails.id.trim()
      ) {
        return true;
      }
      if (
        Array.isArray(entry.arxivDetails.categories) &&
        entry.arxivDetails.categories.length
      ) {
        return true;
      }
    }
    return false;
  }

  destroy() {
    this.unregisterNotifier();
    this.cancelActiveRequest();
    // PERF-FIX-2: Cancel any ongoing export operations
    this.cancelExport();
    this.allEntries = [];
    this.referencesCache.clear();
    this.citedByCache.clear();
    this.entryCitedCache.clear();
    this.metadataCache.clear();
    this.rowCache.clear();
    // Clean up event delegation listeners (PERF-14)
    this.cleanupEventDelegation();
    // Clear filter debounce timer
    if (this.filterDebounceTimer) {
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = undefined;
    }
    // Clear chart render timer
    if (this.chartRenderTimer) {
      clearTimeout(this.chartRenderTimer);
      this.chartRenderTimer = undefined;
    }
    // Clear row pool
    this.rowPool.length = 0;
    // Clear infinite scroll observer
    if (this.loadMoreObserver) {
      this.loadMoreObserver.disconnect();
      this.loadMoreObserver = undefined;
    }
    this.loadMoreContainer = undefined;
    this.currentFilteredEntries = undefined;
    // Clear chart resize observer
    this.clearPendingChartResize();
    if (this.chartResizeObserver) {
      this.chartResizeObserver.disconnect();
      this.chartResizeObserver = undefined;
    }
    // FTR-DARK-MODE-AUTO: Remove theme change listener
    this.removeThemeChangeListener();
    // Clear chart state
    this.chartSelectedBins.clear();
    this.cachedChartStats = undefined;
    this.chartContainer = undefined;
    this.chartSvgWrapper = undefined;
    // Clear rate limiter subscription
    if (this.rateLimiterUnsubscribe) {
      this.rateLimiterUnsubscribe();
      this.rateLimiterUnsubscribe = undefined;
    }
    // FTR-HOVER-PREVIEW: Cleanup preview card
    this.hidePreviewCard();
    if (this.previewCard) {
      this.previewCard.remove();
      this.previewCard = undefined;
    }
    // FTR-AUTHOR-PROFILE: Cleanup author profile and hover preview
    this.clearAuthorProfileState();
    this.hideAuthorPreviewCard();
    if (this.authorPreviewCard) {
      this.authorPreviewCard.remove();
      this.authorPreviewCard = undefined;
    }
    // Note: No outside click handler cleanup needed - popup only closes via button toggle
    // FTR-PDF-ANNOTATE: Cleanup shared citation lookup handler when last instance gone
    // FTR-RECID-AUTO-UPDATE: Also cleanup recid event handlers
    if (
      InspireReferencePanelController.instances.size === 1 &&
      InspireReferencePanelController.citationListenerRegistered
    ) {
      const reader = getReaderIntegration();
      if (InspireReferencePanelController.sharedCitationHandler) {
        reader.off(
          "citationLookup",
          InspireReferencePanelController.sharedCitationHandler,
        );
        InspireReferencePanelController.sharedCitationHandler = undefined;
      }
      if (InspireReferencePanelController.recidAvailableHandler) {
        reader.off(
          "itemRecidAvailable",
          InspireReferencePanelController.recidAvailableHandler,
        );
        InspireReferencePanelController.recidAvailableHandler = undefined;
      }
      if (InspireReferencePanelController.noRecidHandler) {
        reader.off(
          "itemNoRecid",
          InspireReferencePanelController.noRecidHandler,
        );
        InspireReferencePanelController.noRecidHandler = undefined;
      }
      // FTR-HOVER-PREVIEW: Cleanup preview event handlers
      if (InspireReferencePanelController.previewRequestHandler) {
        reader.off(
          "citationPreviewRequest",
          InspireReferencePanelController.previewRequestHandler,
        );
        InspireReferencePanelController.previewRequestHandler = undefined;
      }
      if (InspireReferencePanelController.previewHideHandler) {
        reader.off(
          "citationPreviewHide",
          InspireReferencePanelController.previewHideHandler,
        );
        InspireReferencePanelController.previewHideHandler = undefined;
      }
      InspireReferencePanelController.citationListenerRegistered = false;
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Unregistered shared event listeners`,
      );
    }
    this.labelMatcher = undefined;
    this.pdfParseAttempted = false;
    InspireReferencePanelController.instances.delete(this);
    if (!InspireReferencePanelController.instances.size) {
      InspireReferencePanelController.navigationStack = [];
      InspireReferencePanelController.forwardStack = [];
      InspireReferencePanelController.sharedPendingScrollRestore = undefined;
      InspireReferencePanelController.isNavigatingHistory = false;
    }
    InspireReferencePanelController.syncBackButtonStates();
    this.entryCitedSource = undefined;
    this.updateTabSelection();
  }

  /**
   * Update the rate limiter status indicator.
   * Shows queued request count when rate limiting is active.
   */
  private updateRateLimiterStatus(status: RateLimiterStatus) {
    if (!this.rateLimiterStatusEl) return;

    if (status.isThrottling && status.queuedCount > 0) {
      this.rateLimiterStatusEl.textContent = `⏳ ${status.queuedCount}`;
      this.rateLimiterStatusEl.hidden = false;
      this.rateLimiterStatusEl.title = getString(
        "references-panel-rate-limit-queued",
        {
          args: { count: status.queuedCount },
        },
      );
    } else {
      this.rateLimiterStatusEl.hidden = true;
    }
  }

  /**
   * Update the cache source indicator.
   * Shows whether data is from API, memory cache, or local cache.
   */
  private updateCacheSourceDisplay() {
    if (!this.cacheSourceEl) return;

    // Check if cache source display is enabled in preferences
    const showSource = getPref("local_cache_show_source");
    if (!showSource) {
      this.cacheSourceEl.hidden = true;
      return;
    }

    switch (this.cacheSource) {
      case "api":
        this.cacheSourceEl.textContent = getString(
          "references-panel-cache-source-api",
        );
        this.cacheSourceEl.style.background =
          "var(--material-mix-quinary, #f1f5f9)";
        this.cacheSourceEl.hidden = false;
        break;
      case "memory":
        this.cacheSourceEl.textContent = getString(
          "references-panel-cache-source-memory",
        );
        this.cacheSourceEl.style.background =
          "var(--material-mix-quinary, #e0f2fe)";
        this.cacheSourceEl.hidden = false;
        break;
      case "local":
        if (this.cacheSourceExpired) {
          // Show expired cache indicator with warning color
          this.cacheSourceEl.textContent = getString(
            "references-panel-cache-source-local-expired",
            {
              args: { age: this.cacheSourceAge ?? 0 },
            },
          );
          this.cacheSourceEl.style.background =
            "var(--material-mix-quinary, #fef3c7)"; // Amber/warning color
        } else {
          this.cacheSourceEl.textContent = getString(
            "references-panel-cache-source-local",
            {
              args: { age: this.cacheSourceAge ?? 0 },
            },
          );
          this.cacheSourceEl.style.background =
            "var(--material-mix-quinary, #dcfce7)";
        }
        this.cacheSourceEl.hidden = false;
        break;
      default:
        this.cacheSourceEl.hidden = true;
    }
  }

  private registerNotifier() {
    const callback = {
      notify: async (
        event: string,
        type: string,
        ids: number[] | string[],
        extraData: { [key: string]: any },
      ) => {
        if (!addon?.data.alive) {
          this.unregisterNotifier();
          return;
        }
        if (type !== "item") {
          return;
        }
        if (event === "add") {
          await this.handleItemAdded(ids as number[]);
        } else if (event === "delete") {
          await this.handleItemDeleted(ids as number[]);
        }
      },
    };
    this.notifierID = Zotero.Notifier.registerObserver(callback, ["item"]);
  }

  private unregisterNotifier() {
    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = undefined;
    }
  }

  private async handleItemAdded(itemIDs: number[]) {
    // Check if any newly added items match any reference entries
    for (const itemID of itemIDs) {
      const item = Zotero.Items.get(itemID);
      if (!item || !item.isRegularItem()) {
        continue;
      }
      // Get recid from the new item
      const recid = deriveRecidFromItem(item);
      if (!recid) {
        continue;
      }
      // Check if this recid matches any entry in the current reference list
      for (const entry of this.allEntries) {
        if (entry.recid === recid && !entry.localItemID) {
          entry.localItemID = itemID;
          entry.isRelated = this.isCurrentItemRelated(item);
          this.updateRowStatus(entry);
        }
      }
    }
  }

  private async handleItemDeleted(itemIDs: number[]) {
    // Check if any deleted items match any reference entries
    const deletedIDs = new Set(itemIDs);
    for (const entry of this.allEntries) {
      if (entry.localItemID && deletedIDs.has(entry.localItemID)) {
        // Clear the localItemID and isRelated status
        entry.localItemID = undefined;
        entry.isRelated = false;
        this.updateRowStatus(entry);
      }
    }
  }

  /**
   * Refresh the current view by clearing cache and reloading data.
   * Called from the section button in the panel header.
   * Clears both memory cache and local file cache.
   */
  handleRefresh() {
    if (!this.currentRecid) return;

    // FTR-FOCUSED-SELECTION: Clear focus when refreshing
    this.clearFocusedEntry();

    // Clear memory cache and local file cache based on current view mode
    // Smart caching: delete both unsorted and sorted cache files
    switch (this.viewMode) {
      case "references":
        this.referencesCache.delete(this.currentRecid);
        // References only use unsorted cache
        localCache.delete("refs", this.currentRecid).catch(() => {});
        break;
      case "citedBy":
        this.citedByCache.delete(this.currentRecid);
        // Delete both unsorted (if data was complete) and sorted cache
        localCache.delete("cited", this.currentRecid).catch(() => {});
        localCache
          .delete("cited", this.currentRecid, this.citedBySort)
          .catch(() => {});
        break;
      case "entryCited":
        if (this.entryCitedSource?.recid) {
          const cacheKey = this.entryCitedSource.recid;
          this.entryCitedCache.delete(cacheKey);
          // Delete both unsorted and sorted cache
          localCache.delete("cited", cacheKey).catch(() => {});
          localCache
            .delete("cited", cacheKey, this.entryCitedSort)
            .catch(() => {});
        } else if (this.entryCitedSource?.authorSearchInfo) {
          // Author papers mode: clear cache using author query as key
          const authorKey =
            this.entryCitedSource.authorSearchInfo.bai ||
            this.entryCitedSource.authorSearchInfo.fullName;
          if (authorKey) {
            this.entryCitedCache.delete(authorKey);
            // Delete both unsorted and sorted cache
            localCache.delete("author", authorKey).catch(() => {});
            localCache
              .delete("author", authorKey, this.entryCitedSort)
              .catch(() => {});
          }
        }
        break;
    }

    // Cancel any active request
    this.cancelActiveRequest();

    // Reset entries and UI
    this.allEntries = [];
    this.rowCache.clear();
    this.totalApiCount = null;
    this.chartSelectedBins.clear(); // Clear chart selection on refresh
    this.cachedChartStats = undefined; // Invalidate chart cache
    this.renderChartLoading(); // Show loading state in chart
    this.renderMessage(this.getLoadingMessageForMode(this.viewMode));

    // Re-trigger the load based on view mode (force=true to bypass any remaining cache)
    if (this.viewMode === "references" || this.viewMode === "citedBy") {
      if (this.currentItemID) {
        const item = Zotero.Items.get(this.currentItemID);
        if (item) {
          this.loadEntries(this.currentRecid, this.viewMode, {
            force: true,
          }).catch((err) => {
            if ((err as any)?.name !== "AbortError") {
              Zotero.debug(
                `[${config.addonName}] Failed to refresh INSPIRE data: ${err}`,
              );
              this.allEntries = [];
              this.renderChartImmediate();
              this.renderMessage(getString("references-panel-status-error"));
            }
          });
        }
      }
    } else if (this.viewMode === "entryCited" && this.entryCitedSource) {
      // Reload entryCited data using the appropriate key
      const cacheKey =
        this.entryCitedSource.recid || this.entryCitedSource.authorQuery;
      if (cacheKey) {
        this.loadEntries(cacheKey, "entryCited", { force: true }).catch(
          (err) => {
            if ((err as any)?.name !== "AbortError") {
              Zotero.debug(
                `[${config.addonName}] Failed to refresh entryCited data: ${err}`,
              );
              this.allEntries = [];
              this.renderChartImmediate();
              this.renderMessage(getString("references-panel-status-error"));
            }
          },
        );
      }
    }
  }

  /**
   * Copy all visible references as BibTeX to the clipboard.
   * Uses batch queries to efficiently fetch BibTeX from INSPIRE.
   * PERF-FIX-2: Now cancellable via AbortController.
   */
  async copyAllBibTeX() {
    const strings = getCachedStrings();
    const entriesWithRecid = this.allEntries.filter((e) => e.recid);

    if (!entriesWithRecid.length) {
      const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
      const noRecidWin = new ztoolkit.ProgressWindow(config.addonName);
      noRecidWin.win.changeHeadline(config.addonName, icon);
      noRecidWin.createLine({
        icon: icon,
        text: strings.noRecidEntries,
        type: "default",
      });
      noRecidWin.show();
      return;
    }

    // PERF-FIX-2: Create AbortController for this export operation
    this.cancelExport(); // Cancel any previous export
    // FTR-ABORT-CONTROLLER-FIX: Use utility function to safely create AbortController
    // Don't create mock signal - only pass real signal to fetch()
    this.exportAbort = createAbortController();

    const BATCH_SIZE = METADATA_BATCH_SIZE; // Same as existing code for metadata batch fetch
    const allBibTeX: string[] = [];
    let successCount = 0;

    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
    const progressWin = new ztoolkit.ProgressWindow(config.addonName);
    progressWin.win.changeHeadline(config.addonName, icon);
    progressWin.createLine({
      icon: icon,
      text: strings.bibtexFetching,
      type: "default",
    });
    progressWin.show();

    try {
      for (let i = 0; i < entriesWithRecid.length; i += BATCH_SIZE) {
        // PERF-FIX-2: Check abort before each batch (use optional chaining)
        if (this.exportAbort?.signal?.aborted) {
          Zotero.debug(`[${config.addonName}] BibTeX export aborted`);
          progressWin.changeLine({
            icon: icon,
            text: "Export cancelled",
            type: "default",
          });
          break;
        }

        const batch = entriesWithRecid.slice(i, i + BATCH_SIZE);
        const recids = batch.map((e) => e.recid!);
        const query = recids.map((r) => `recid:${r}`).join(" OR ");
        const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${recids.length}&format=bibtex`;

        try {
          // PERF-FIX-2: Only pass signal to fetch if it's a real AbortSignal
          const fetchOptions = this.exportAbort?.signal
            ? { signal: this.exportAbort.signal }
            : {};
          const response = await inspireFetch(url, fetchOptions);
          if (response.ok) {
            const bibtex = await response.text();
            if (bibtex?.trim()) {
              allBibTeX.push(bibtex.trim());
              successCount += recids.length;
            }
          }
        } catch (e) {
          // PERF-FIX-2: Handle abort error gracefully
          if ((e as Error).name === "AbortError") {
            Zotero.debug(`[${config.addonName}] BibTeX batch aborted`);
            break;
          }
          Zotero.debug(
            `[${config.addonName}] Failed to fetch BibTeX batch: ${e}`,
          );
        }
      }

      // PERF-FIX-2: Only show success if not aborted (use optional chaining)
      if (!this.exportAbort?.signal?.aborted && allBibTeX.length) {
        const success = await copyToClipboard(allBibTeX.join("\n\n"));
        if (success) {
          progressWin.changeLine({
            icon: icon,
            text: getString("references-panel-bibtex-all-copied", {
              args: { count: successCount },
            }),
            type: "success",
          });
        }
      } else if (!this.exportAbort?.signal?.aborted) {
        progressWin.changeLine({
          icon: icon,
          text: strings.bibtexAllFailed,
          type: "fail",
        });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        Zotero.debug(`[${config.addonName}] Copy all BibTeX error: ${e}`);
        progressWin.changeLine({
          icon: icon,
          text: strings.bibtexAllFailed,
          type: "fail",
        });
      }
    } finally {
      // PERF-FIX-2: Clear abort controller after export completes
      this.exportAbort = undefined;
    }

    setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
  }

  /**
   * Show export menu with format options (BibTeX, LaTeX US, LaTeX EU).
   * User can choose to copy to clipboard or export to file.
   * Uses HTML dropdown positioned relative to the panel container.
   */
  showExportMenu(event: Event) {
    // Determine which entries to export
    const hasSelection = this.selectedEntryIDs.size > 0;
    const targetEntries = hasSelection
      ? this.allEntries.filter((e) => this.selectedEntryIDs.has(e.id))
      : this.allEntries;
    const selectedEntries = hasSelection ? targetEntries : [];

    const entriesWithRecid = targetEntries.filter((e) => e.recid);

    if (!entriesWithRecid.length) {
      const strings = getCachedStrings();
      const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
      const noRecidWin = new ztoolkit.ProgressWindow(config.addonName);
      noRecidWin.win.changeHeadline(config.addonName, icon);
      noRecidWin.createLine({
        icon: icon,
        text: strings.noRecidEntries,
        type: "default",
      });
      noRecidWin.show();
      return;
    }

    const doc = this.body.ownerDocument;

    // Remove existing popup if any
    const popupId = "zinspire-export-popup";
    const existingPopup = doc.getElementById(popupId);
    if (existingPopup) {
      existingPopup.remove();
    }

    const formats = [
      { id: "bibtex", label: "BibTeX (.bib)", ext: ".bib" },
      { id: "latex-us", label: "LaTeX (US)", ext: ".tex" },
      { id: "latex-eu", label: "LaTeX (EU)", ext: ".tex" },
    ];

    // Citation Style section - find entries with local items
    const entriesWithLocalItem = targetEntries.filter(
      (e) => typeof e.localItemID === "number" && e.localItemID > 0,
    );

    // Find the actual button element for popup anchor
    let button = event.target as HTMLElement;

    // Walk up to find a toolbarbutton or button element (the actual button)
    while (
      button &&
      !button.matches("toolbarbutton, button, .section-custom-button")
    ) {
      button = button.parentElement as HTMLElement;
    }

    // Try to recover a better anchor when event target is a collapsible-section
    const targetRect = (
      event.target as HTMLElement | null
    )?.getBoundingClientRect?.();
    const probeButtons = Array.from(
      doc.querySelectorAll(".section-custom-button"),
    ) as HTMLElement[];

    const usableButtons = probeButtons.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    const customButtons = usableButtons.filter((el) =>
      el.classList.contains("custom"),
    );

    const pickNearest = (buttons: HTMLElement[]) => {
      if (!buttons.length) return null;
      if (!targetRect) return buttons[0];
      let nearest: HTMLElement = buttons[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const b of buttons) {
        const r = b.getBoundingClientRect();
        const dy = Math.abs(r.top - targetRect.top);
        const dx = Math.abs(r.left - targetRect.left);
        const dist = dx * 0.5 + dy; // favor vertical proximity
        if (dist < bestDist) {
          bestDist = dist;
          nearest = b;
        }
      }
      return nearest;
    };

    const fallbackButton =
      pickNearest(customButtons) ?? pickNearest(usableButtons);

    const anchorButton = button || fallbackButton;

    if (!anchorButton) {
      Zotero.debug(
        `[${config.addonName}] showExportMenu: No anchor button found`,
      );
      return;
    }

    // Create XUL menupopup
    const popup = (doc as any).createXULElement("menupopup") as XUL.MenuPopup;
    popup.id = popupId;

    // Helper to create XUL menuitem
    const createMenuItem = (
      label: string,
      disabled: boolean,
      handler?: () => void,
    ) => {
      const item = (doc as any).createXULElement("menuitem");
      item.setAttribute("label", label);
      if (disabled) {
        item.setAttribute("disabled", "true");
      } else if (handler) {
        item.addEventListener("command", handler);
      }
      return item;
    };

    // Copy to clipboard section
    const copyLabel = getString("references-panel-export-copy-header");
    popup.appendChild(
      createMenuItem(
        hasSelection ? `${copyLabel} (${entriesWithRecid.length})` : copyLabel,
        true,
      ),
    );

    for (const format of formats) {
      popup.appendChild(
        createMenuItem(`  ${format.label}`, false, () => {
          this.exportEntries(format.id, "clipboard", format.ext);
        }),
      );
    }

    popup.appendChild(
      createMenuItem(
        `  ${getString("references-panel-export-copy-texkey")}`,
        !hasSelection,
        () => this.copyCitationKeys(selectedEntries),
      ),
    );

    // Separator
    popup.appendChild((doc as any).createXULElement("menuseparator"));

    // Export to file section
    const exportLabel = getString("references-panel-export-file-header");
    popup.appendChild(
      createMenuItem(
        hasSelection
          ? `${exportLabel} (${entriesWithRecid.length})`
          : exportLabel,
        true,
      ),
    );

    for (const format of formats) {
      popup.appendChild(
        createMenuItem(`  ${format.label}`, false, () => {
          this.exportEntries(format.id, "file", format.ext);
        }),
      );
    }

    // Citation section - always show, will handle import if needed
    // FTR-CITATION-EXPORT: Show for all entries with recid (not just those with localItemID)
    if (entriesWithRecid.length > 0) {
      popup.appendChild((doc as any).createXULElement("menuseparator"));
      const citationLabel = getString(
        "references-panel-export-citation-header",
      );
      popup.appendChild(
        createMenuItem(
          hasSelection
            ? `${citationLabel} (${entriesWithRecid.length})`
            : citationLabel,
          true,
        ),
      );

      popup.appendChild(
        createMenuItem(
          `  ${getString("references-panel-export-citation-select-style")}`,
          false,
          () => this.handleCitationStyleExport(targetEntries),
        ),
      );
    }

    // Add popup to document and open
    doc.documentElement.appendChild(popup);
    popup.addEventListener("popuphidden", () => popup.remove(), { once: true });
    popup.openPopup(anchorButton as any, "after_end", 0, 2, false, false);
  }

  /**
   * Export entries in specified format to clipboard or file.
   * Supports: bibtex, latex-us, latex-eu
   * PERF-FIX-2: Now cancellable via AbortController.
   */
  private async exportEntries(
    format: string,
    target: "clipboard" | "file",
    fileExt: string = ".bib",
  ) {
    // Determine which entries to export
    const hasSelection = this.selectedEntryIDs.size > 0;
    const targetEntries = hasSelection
      ? this.allEntries.filter((e) => this.selectedEntryIDs.has(e.id))
      : this.allEntries;

    const entriesWithRecid = targetEntries.filter((e) => e.recid);
    const strings = getCachedStrings();

    // PERF-FIX-2: Create AbortController for this export operation
    this.cancelExport(); // Cancel any previous export
    // FTR-ABORT-CONTROLLER-FIX: Use utility function to safely create AbortController
    // Don't create mock signal - only pass real signal to fetch()
    this.exportAbort = createAbortController();

    const BATCH_SIZE = METADATA_BATCH_SIZE;
    const allContent: string[] = [];
    let successCount = 0;
    let failedBatches = 0;

    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
    const progressWin = new ztoolkit.ProgressWindow(config.addonName);
    progressWin.win.changeHeadline(config.addonName, icon);
    progressWin.createLine({
      icon: icon,
      text: strings.bibtexFetching,
      type: "default",
    });
    progressWin.show();

    try {
      for (let i = 0; i < entriesWithRecid.length; i += BATCH_SIZE) {
        // PERF-FIX-2: Check abort before each batch (use optional chaining)
        if (this.exportAbort?.signal?.aborted) {
          Zotero.debug(`[${config.addonName}] ${format} export aborted`);
          progressWin.changeLine({
            icon: icon,
            text: "Export cancelled",
            type: "default",
          });
          setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
          return;
        }

        const batch = entriesWithRecid.slice(i, i + BATCH_SIZE);
        const recids = batch.map((e) => e.recid!);
        const query = recids.map((r) => `recid:${r}`).join(" OR ");
        const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${recids.length}&format=${format}`;

        try {
          // PERF-FIX-2: Only pass signal to fetch if it's a real AbortSignal
          const fetchOptions = this.exportAbort?.signal
            ? { signal: this.exportAbort.signal }
            : {};
          const response = await inspireFetch(url, fetchOptions);
          if (response.ok) {
            const content = await response.text();
            if (content?.trim()) {
              allContent.push(content.trim());
              // Count entries (BibTeX uses @type{, LaTeX uses \cite{ or direct entries)
              const entryCount =
                format === "bibtex"
                  ? (content.match(/@\w+\{/g) || []).length
                  : recids.length;
              successCount += entryCount;
            } else {
              failedBatches++;
            }
          } else {
            failedBatches++;
          }
        } catch (e) {
          // PERF-FIX-2: Handle abort error gracefully
          if ((e as Error).name === "AbortError") {
            Zotero.debug(`[${config.addonName}] ${format} batch aborted`);
            progressWin.changeLine({
              icon: icon,
              text: "Export cancelled",
              type: "default",
            });
            setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
            return;
          }
          Zotero.debug(
            `[${config.addonName}] Failed to fetch ${format} batch: ${e}`,
          );
          failedBatches++;
        }
      }

      if (!allContent.length) {
        progressWin.changeLine({
          icon: icon,
          text: strings.bibtexAllFailed,
          type: "fail",
        });
        setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
        return;
      }

      const fullContent = allContent.join("\n\n");
      const formatLabel =
        format === "bibtex"
          ? "BibTeX"
          : format === "latex-us"
            ? "LaTeX(US)"
            : "LaTeX(EU)";

      if (target === "clipboard") {
        // Warn if content is very large (may exceed clipboard limits)
        const contentSize = new Blob([fullContent]).size;

        if (contentSize > CLIPBOARD_WARN_SIZE_BYTES) {
          // Content too large, suggest file export
          progressWin.changeLine({
            icon: icon,
            text: getString("references-panel-export-too-large", {
              args: { size: Math.round(contentSize / 1024) },
            }),
            type: "fail",
          });
          setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_WARN_MS);
          return;
        }

        const success = await copyToClipboard(fullContent);
        if (success) {
          progressWin.changeLine({
            icon: icon,
            text: getString("references-panel-export-copied", {
              args: { count: successCount, format: formatLabel },
            }),
            type: "success",
          });
        } else {
          progressWin.changeLine({
            icon: icon,
            text: getString("references-panel-export-clipboard-failed"),
            type: "fail",
          });
        }
      } else {
        // Export to file
        const filename = `references_${this.currentRecid || "export"}${fileExt}`;
        const filePath = await this.promptSaveFile(filename, fileExt);
        if (filePath) {
          await Zotero.File.putContentsAsync(filePath, fullContent);
          progressWin.changeLine({
            icon: icon,
            text: getString("references-panel-export-saved", {
              args: { count: successCount, format: formatLabel },
            }),
            type: "success",
          });
        } else {
          progressWin.changeLine({
            icon: icon,
            text: getString("references-panel-export-cancelled"),
            type: "default",
          });
        }
      }
    } catch (e) {
      // PERF-FIX-2: Handle abort error at top level
      if ((e as Error).name === "AbortError") {
        progressWin.changeLine({
          icon: icon,
          text: "Export cancelled",
          type: "default",
        });
        setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
        return;
      }
      Zotero.debug(`[${config.addonName}] Export error: ${e}`);
      progressWin.changeLine({ text: strings.bibtexAllFailed, type: "fail" });
    } finally {
      // PERF-FIX-2: Clear abort controller after export completes
      this.exportAbort = undefined;
    }

    setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
  }

  /**
   * Copy citation keys (INSPIRE texkeys) for selected entries.
   * Keys are joined by ", " for quick paste into LaTeX.
   */
  private async copyCitationKeys(entries: InspireReferenceEntry[]) {
    if (!entries.length) return;

    const entriesWithRecidOrKey = entries.filter((e) => e.recid || e.texkey);
    if (!entriesWithRecidOrKey.length) {
      const strings = getCachedStrings();
      const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
      const noRecidWin = new ztoolkit.ProgressWindow(config.addonName);
      noRecidWin.win.changeHeadline(config.addonName, icon);
      noRecidWin.createLine({
        icon: icon,
        text: strings.noRecidEntries,
        type: "default",
      });
      noRecidWin.show();
      return;
    }

    this.cancelExport();
    // FTR-ABORT-CONTROLLER-FIX: Use utility function to safely create AbortController
    this.exportAbort = createAbortController();

    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
    const progressWin = new ztoolkit.ProgressWindow(config.addonName);
    progressWin.win.changeHeadline(config.addonName, icon);
    progressWin.createLine({
      icon: icon,
      text: getString("references-panel-export-texkey-copying"),
      type: "default",
    });
    progressWin.show();

    try {
      // OPTIMIZATION: First, try to get citation keys from Zotero library
      // This avoids unnecessary INSPIRE API calls
      const texkeyByRecid = new Map<string, string>();

      for (const entry of entriesWithRecidOrKey) {
        if (entry.texkey?.trim()) continue;
        if (entry.localItemID) {
          try {
            const item = Zotero.Items.get(entry.localItemID);
            if (item) {
              const citationKey = (
                item.getField("citationKey") as string | undefined
              )?.trim();
              if (citationKey && entry.recid) {
                texkeyByRecid.set(entry.recid, citationKey);
                entry.texkey = citationKey;
              }
            }
          } catch {
            // Ignore errors when getting Zotero item
          }
        }
      }

      // Fetch remaining texkeys from INSPIRE
      const missingEntries = entriesWithRecidOrKey.filter(
        (entry) => entry.recid && !entry.texkey,
      );
      const missingRecids = missingEntries.map((entry) => entry.recid!);
      const fieldsParam = buildFieldsParam("control_number,texkeys");

      for (let i = 0; i < missingRecids.length; i += METADATA_BATCH_SIZE) {
        if (this.exportAbort?.signal?.aborted) {
          progressWin.changeLine({
            icon: icon,
            text: getString("references-panel-export-cancelled"),
            type: "default",
          });
          return;
        }

        const batch = missingRecids.slice(i, i + METADATA_BATCH_SIZE);
        const query = batch.map((recid) => `recid:${recid}`).join(" OR ");
        const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${batch.length}${fieldsParam}`;

        try {
          const fetchOptions = this.exportAbort?.signal
            ? { signal: this.exportAbort.signal }
            : {};
          const response = await inspireFetch(url, fetchOptions);
          if (!response.ok) continue;

          const payload: any = await response.json();
          const hits = payload?.hits?.hits ?? [];
          for (const hit of hits) {
            const recid = String(hit?.metadata?.control_number || hit?.id || "");
            const texkeys = hit?.metadata?.texkeys;
            if (!recid || !Array.isArray(texkeys) || !texkeys.length) continue;
            const texkey = texkeys[0];
            if (typeof texkey === "string" && texkey.trim()) {
              texkeyByRecid.set(recid, texkey);
            }
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          Zotero.debug(`[${config.addonName}] Failed to fetch texkeys: ${e}`);
        }
      }

      // Collect all texkeys
      const texkeys: string[] = [];
      for (const entry of entriesWithRecidOrKey) {
        let texkey = entry.texkey?.trim() || "";
        if (!texkey && entry.recid) {
          const fetched = texkeyByRecid.get(entry.recid);
          if (fetched) {
            texkey = fetched;
            entry.texkey = fetched;
          }
        }
        if (texkey) texkeys.push(texkey);
      }

      if (!texkeys.length) {
        progressWin.changeLine({
          icon: icon,
          text: getString("references-panel-export-texkey-failed"),
          type: "fail",
        });
        return;
      }

      const success = await copyToClipboard(texkeys.join(", "));
      if (success) {
        progressWin.changeLine({
          icon: icon,
          text: getString("references-panel-export-texkey-copied", {
            args: { count: texkeys.length },
          }),
          type: "success",
        });
      } else {
        progressWin.changeLine({
          icon: icon,
          text: getString("references-panel-export-texkey-failed"),
          type: "fail",
        });
      }
    } finally {
      this.exportAbort = undefined;
      setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
    }
  }

  /**
   * Prompt user to save file with FilePicker dialog.
   */
  private async promptSaveFile(
    defaultFilename: string,
    ext: string,
  ): Promise<string | null> {
    const win = Zotero.getMainWindow();
    const fp = new win.FilePicker();
    fp.init(win, getString("references-panel-export-save-title"), fp.modeSave);

    if (ext === ".bib") {
      fp.appendFilter("BibTeX", "*.bib");
    } else {
      fp.appendFilter("LaTeX", "*.tex");
    }
    fp.appendFilters(fp.filterAll);
    fp.defaultString = defaultFilename;

    const result = await fp.show();
    if (result === fp.returnOK || result === fp.returnReplace) {
      return fp.file;
    }
    return null;
  }

  /**
   * Open Zotero's built-in bibliography dialog for citation style export.
   * Uses Zotero's native dialog at chrome://zotero/content/bibliography.xhtml
   * @param entries - Reference entries with localItemID
   */
  private async openBibliographyDialog(
    entries: InspireReferenceEntry[],
  ): Promise<void> {
    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;

    try {
      // Get Zotero items from localItemIDs
      const localItemIDs = entries
        .filter((e) => typeof e.localItemID === "number" && e.localItemID > 0)
        .map((e) => e.localItemID!);

      if (localItemIDs.length === 0) {
        const progressWin = new ztoolkit.ProgressWindow(config.addonName);
        progressWin.win.changeHeadline(config.addonName, icon);
        progressWin.createLine({
          icon: icon,
          text: getString("references-panel-export-citation-no-local"),
          type: "fail",
        });
        progressWin.show();
        setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
        return;
      }

      const items = Zotero.Items.get(localItemIDs);
      if (!items || items.length === 0) {
        const progressWin = new ztoolkit.ProgressWindow(config.addonName);
        progressWin.win.changeHeadline(config.addonName, icon);
        progressWin.createLine({
          icon: icon,
          text: getString("references-panel-export-citation-no-local"),
          type: "fail",
        });
        progressWin.show();
        setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
        return;
      }

      // Filter to regular items only (not notes/attachments)
      const regularItems = items.filter((item: Zotero.Item) =>
        item.isRegularItem(),
      );
      if (regularItems.length === 0) {
        const progressWin = new ztoolkit.ProgressWindow(config.addonName);
        progressWin.win.changeHeadline(config.addonName, icon);
        progressWin.createLine({
          icon: icon,
          text: getString("references-panel-export-citation-no-local"),
          type: "fail",
        });
        progressWin.show();
        setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
        return;
      }

      // Open Zotero's built-in bibliography dialog
      // The dialog is modal and returns results via the io object
      const io: {
        style?: string;
        locale?: string;
        method?: string;
        mode?: string;
      } = {};

      const win = Zotero.getMainWindow();
      win.openDialog(
        "chrome://zotero/content/bibliography.xhtml",
        "_blank",
        "chrome,modal,centerscreen",
        io,
      );

      // Check if user cancelled
      if (!io.method) {
        Zotero.debug(`[${config.addonName}] Bibliography dialog cancelled`);
        return;
      }

      Zotero.debug(
        `[${config.addonName}] Bibliography dialog result: style=${io.style}, locale=${io.locale}, method=${io.method}, mode=${io.mode}`,
      );

      // Handle the selected output method
      const style = io.style;
      const locale = io.locale;
      const isCitations = io.mode === "citations";

      if (io.method === "copy-to-clipboard") {
        // Use Zotero's built-in function to copy to clipboard
        // Access via window to avoid TypeScript type issues
        const ZFI = (win as any).Zotero_File_Interface;
        if (ZFI && typeof ZFI.copyItemsToClipboard === "function") {
          ZFI.copyItemsToClipboard(
            regularItems,
            style,
            locale,
            false,
            isCitations,
          );
        } else {
          // Fallback: generate and copy manually
          const styleObj = Zotero.Styles.get(style);
          const cslEngine = styleObj.getCiteProc(locale, "text");
          const bibliography =
            Zotero.Cite.makeFormattedBibliographyOrCitationList(
              cslEngine,
              regularItems,
              "text",
              isCitations,
            );
          await copyToClipboard(bibliography);
        }

        const progressWin = new ztoolkit.ProgressWindow(config.addonName);
        progressWin.win.changeHeadline(config.addonName, icon);
        progressWin.createLine({
          icon: icon,
          text: getString("references-panel-export-citation-copied", {
            args: { count: regularItems.length },
          }),
          type: "success",
        });
        progressWin.show();
        setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
      } else if (io.method === "save-as-rtf" || io.method === "save-as-html") {
        // Generate bibliography using Zotero's cite engine
        const format = io.method === "save-as-rtf" ? "rtf" : "html";
        const styleObj = Zotero.Styles.get(style);
        const cslEngine = styleObj.getCiteProc(locale, format);
        const bibliography =
          Zotero.Cite.makeFormattedBibliographyOrCitationList(
            cslEngine,
            regularItems,
            format,
            isCitations,
          );

        // Save to file
        const ext = io.method === "save-as-rtf" ? ".rtf" : ".html";
        const filename = `references_${this.currentRecid || "export"}${ext}`;
        const filePath = await this.promptSaveFile(filename, ext);

        if (filePath) {
          if (io.method === "save-as-html") {
            // Wrap in HTML document
            let html =
              '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n';
            html +=
              '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">\n';
            html += "<head>\n";
            html +=
              '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>\n';
            html += "<title>Bibliography</title>\n";
            html += "</head>\n";
            html += "<body>\n";
            html += bibliography;
            html += "</body>\n";
            html += "</html>\n";
            await Zotero.File.putContentsAsync(filePath, html);
          } else {
            await Zotero.File.putContentsAsync(filePath, bibliography);
          }

          const progressWin = new ztoolkit.ProgressWindow(config.addonName);
          progressWin.win.changeHeadline(config.addonName, icon);
          progressWin.createLine({
            icon: icon,
            text: getString("references-panel-export-saved", {
              args: {
                count: regularItems.length,
                format: format.toUpperCase(),
              },
            }),
            type: "success",
          });
          progressWin.show();
          setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
        }
      } else if (io.method === "print") {
        // Generate HTML bibliography for printing
        const styleObj = Zotero.Styles.get(style);
        const cslEngine = styleObj.getCiteProc(locale, "html");
        const bibliography =
          Zotero.Cite.makeFormattedBibliographyOrCitationList(
            cslEngine,
            regularItems,
            "html",
            isCitations,
          );

        // Use Zotero's HiddenBrowser for printing
        const HiddenBrowser = ChromeUtils.importESModule(
          "chrome://zotero/content/HiddenBrowser.mjs",
        ).HiddenBrowser;
        const browser = new HiddenBrowser({ useHiddenFrame: false });
        await browser.load(
          "data:text/html;charset=utf-8," + encodeURIComponent(bibliography),
        );
        await browser.print({
          overrideSettings: {
            headerStrLeft: "",
            headerStrCenter: "",
            headerStrRight: "",
            footerStrLeft: "",
            footerStrCenter: "",
            footerStrRight: "",
          },
        });
        browser.destroy();
      }
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Bibliography dialog error: ${e}`);
      const progressWin = new ztoolkit.ProgressWindow(config.addonName);
      progressWin.win.changeHeadline(config.addonName, icon);
      progressWin.createLine({
        icon: icon,
        text: getString("references-panel-export-clipboard-failed"),
        type: "fail",
      });
      progressWin.show();
      setTimeout(() => progressWin.close(), PROGRESS_CLOSE_DELAY_MS);
    }
  }

  /**
   * FTR-CITATION-EXPORT: Handle citation style export with automatic import
   * If entries are not in Zotero library, prompt user to select a collection,
   * import them first, then proceed with bibliography dialog.
   */
  private async handleCitationStyleExport(
    entries: InspireReferenceEntry[],
  ): Promise<void> {
    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;

    // Separate entries with and without localItemID
    const entriesWithLocalItem = entries.filter(
      (e) => typeof e.localItemID === "number" && e.localItemID > 0,
    );
    const entriesNeedingImport = entries.filter(
      (e) =>
        e.recid &&
        (typeof e.localItemID !== "number" || e.localItemID <= 0),
    );

    // If all entries have localItemID, proceed directly to bibliography dialog
    if (entriesNeedingImport.length === 0) {
      await this.openBibliographyDialog(entriesWithLocalItem);
      return;
    }

    // Show progress window explaining what needs to happen
    const progressWin = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: false,
    });
    progressWin.win.changeHeadline(config.addonName, icon);
    progressWin.createLine({
      icon: icon,
      text: getString("references-panel-export-citation-import-needed", {
        args: { count: entriesNeedingImport.length },
      }),
      type: "default",
    });
    progressWin.show();

    // Get anchor for collection picker (use body element)
    const anchor = this.body;

    // Show collection picker for user to select where to import
    const selection = await this.promptForSaveTarget(anchor);

    // Close the progress window after picker closes
    progressWin.close();

    if (!selection) {
      // User cancelled
      return;
    }

    // Import entries that need importing
    const importProgressWin = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: false,
    });
    importProgressWin.win.changeHeadline(config.addonName, icon);
    importProgressWin.createLine({
      icon: icon,
      text: getString("references-panel-export-citation-importing", {
        args: { done: 0, total: entriesNeedingImport.length },
      }),
      type: "default",
    });
    importProgressWin.show();

    let importedCount = 0;
    let failedCount = 0;
    const importedEntries: InspireReferenceEntry[] = [...entriesWithLocalItem];

    // Import entries one by one (to avoid overwhelming the API)
    for (let i = 0; i < entriesNeedingImport.length; i++) {
      const entry = entriesNeedingImport[i];
      try {
        const newItem = await this.importReference(entry.recid!, selection);
        if (newItem) {
          // Update entry with new localItemID
          entry.localItemID = newItem.id;
          entry.displayText = buildDisplayText(entry);
          entry.searchText = "";
          importedEntries.push(entry);
          importedCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] Citation export import error: ${err}`,
        );
        failedCount++;
      }

      // Update progress
      importProgressWin.changeLine({
        icon: icon,
        text: getString("references-panel-export-citation-importing", {
          args: { done: i + 1, total: entriesNeedingImport.length },
        }),
        type: "default",
      });
    }

    importProgressWin.close();

    // Re-render to show updated local item status
    if (importedCount > 0) {
      this.renderReferenceList({ preserveScroll: true });
    }

    // Check if we have any entries to format
    const entriesWithLocalItemNow = importedEntries.filter(
      (e) => typeof e.localItemID === "number" && e.localItemID > 0,
    );

    if (entriesWithLocalItemNow.length === 0) {
      const errorWin = new ztoolkit.ProgressWindow(config.addonName);
      errorWin.win.changeHeadline(config.addonName, icon);
      errorWin.createLine({
        icon: icon,
        text: getString("references-panel-export-citation-no-local"),
        type: "fail",
      });
      errorWin.show();
      setTimeout(() => errorWin.close(), PROGRESS_CLOSE_DELAY_MS);
      return;
    }

    // If some imports failed, show a warning
    if (failedCount > 0) {
      const warningWin = new ztoolkit.ProgressWindow(config.addonName);
      warningWin.win.changeHeadline(config.addonName, icon);
      warningWin.createLine({
        icon: icon,
        text: getString("references-panel-export-citation-import-failed", {
          args: {
            success: entriesWithLocalItemNow.length,
            total: entriesNeedingImport.length + entriesWithLocalItem.length,
          },
        }),
        type: "fail",
      });
      warningWin.show();
      setTimeout(() => warningWin.close(), PROGRESS_CLOSE_DELAY_MS);
    }

    // Proceed with bibliography dialog for entries with localItemID
    await this.openBibliographyDialog(entriesWithLocalItemNow);
  }

  async handleItemChange(
    args: _ZoteroTypes.ItemPaneManagerSection.SectionHookArgs,
  ) {
    try {
      if (args.tabType !== "library" && args.tabType !== "reader") {
        // Don't override search mode display
        if (this.viewMode !== "search") {
          this.allEntries = [];
          this.renderChartImmediate();
          this.renderMessage(getString("references-panel-reader-mode"));
          this.lastRenderedEntries = [];
        }
        return;
      }
      this.currentTabType = args.tabType === "reader" ? "reader" : "library";
      this.currentReaderTabID =
        args.tabType === "reader"
          ? ReaderTabHelper.getSelectedTabID()
          : undefined;
      const item = args.item;
      if (!item || !item.isRegularItem()) {
        this.currentItemID = undefined;
        this.currentRecid = undefined;
        // In search mode, don't show "select item" message - keep search results visible
        if (this.viewMode !== "search") {
          this.allEntries = [];
          this.renderChartImmediate();
          this.renderMessage(getString("references-panel-select-item"));
          this.lastRenderedEntries = [];
        }
        this.updateSortSelector();
        return;
      }

      // Skip redundant processing for same item (e.g., PDF annotation changes)
      // This avoids unnecessary network requests to INSPIRE for recid lookup
      if (item.id === this.currentItemID && this.currentRecid) {
        // Same item and already have recid - no need to re-process
        // Just handle any scroll restoration if needed
        if (this.viewMode !== "search") {
          this.restoreScrollPositionIfNeeded();
        }
        return;
      }

      const previousItemID = this.currentItemID;
      const itemChanged = previousItemID !== item.id;
      this.currentItemID = item.id;
      if (itemChanged) {
        // FTR-PDF-ANNOTATE: Invalidate label matcher for new item
        this.labelMatcher = undefined;
        if (!InspireReferencePanelController.isNavigatingHistory) {
          InspireReferencePanelController.forwardStack = [];
          InspireReferencePanelController.syncBackButtonStates();
        }
      }

      if (itemChanged) {
        // FTR-BATCH-IMPORT: Clear selection when item changes
        this.selectedEntryIDs.clear();
        this.lastSelectedEntryID = undefined;
        this.updateBatchToolbarVisibility();

        // FTR-SMART-UPDATE-AUTO-CHECK: Clear notification and pending diff
        this.clearAutoCheckNotification();
        this.autoCheckPendingDiff = undefined;

        // In search mode, don't clear entries - preserve search results
        if (this.viewMode !== "search") {
          this.clearEntryCitedContext();
          this.cancelActiveRequest();
          this.allEntries = [];
          this.totalApiCount = null; // Reset API count for new item
          this.chartSelectedBins.clear(); // Clear chart selection
          this.cachedChartStats = undefined; // Invalidate chart cache
          // Clear filter state for new item to avoid incorrect filtering
          this.filterText = "";
          if (this.filterInput) {
            this.filterInput.value = "";
          }
          this.filterInlineHint?.hide();
          this.renderChartLoading(); // Show loading state in chart
          this.renderMessage(this.getLoadingMessageForMode(this.viewMode));
        } else {
          // Search mode: preserve search results but still restore scroll position
          // when navigating back (e.g., after clicking green dot to jump to a local item).
          // This ensures Back navigation works the same as References/Cited By tabs.
          setTimeout(() => {
            this.restoreScrollPositionIfNeeded();
          }, 0);
        }
      } else {
        // Check if we need to restore scroll position when switching back to original item
        // Only restore if we are not loading new content (item didn't change)
        this.restoreScrollPositionIfNeeded();
      }

      const recid =
        deriveRecidFromItem(item) ?? (await fetchRecidFromInspire(item));
      if (!recid) {
        this.currentRecid = undefined;
        this.allEntries = [];
        this.renderChartImmediate();
        this.renderMessage(getString("references-panel-no-recid"));
        this.lastRenderedEntries = [];
        this.updateSortSelector();
        return;
      }

      // FTR-SMART-UPDATE-AUTO-CHECK: Trigger auto-check when item changes
      // Run in parallel with references loading (don't await)
      // Pass the already-obtained recid to avoid redundant lookup
      if (itemChanged) {
        this.performAutoCheck(item, recid).catch((err) => {
          Zotero.debug(`[${config.addonName}] Auto-check failed: ${err}`);
        });
      }

      if (this.currentRecid !== recid) {
        this.currentRecid = recid;
        this.updateSortSelector();
        // Don't load entries if in search mode - keep search results visible
        if (this.viewMode !== "search") {
          await this.loadEntries(recid, this.viewMode).catch((err) => {
            if ((err as any)?.name !== "AbortError") {
              Zotero.debug(
                `[${config.addonName}] Failed to load INSPIRE data: ${err}`,
              );
              this.allEntries = [];
              this.renderChartImmediate();
              this.renderMessage(getString("references-panel-status-error"));
            }
          });
        }
      } else if (this.viewMode !== "search") {
        // Recid unchanged but item changed (e.g., user switched away and back)
        // Need to re-render both chart and list since renderChartLoading() was called
        this.renderChartImmediate();
        this.renderReferenceList({ preserveScroll: true });
        // Restore scroll position after rendering if needed
        setTimeout(() => {
          this.restoreScrollPositionIfNeeded();
        }, 0);
      } else {
        // Search mode with same recid: just restore scroll position if pending.
        // Search results are independent of the current item, so we don't re-render,
        // but we need to restore scroll when navigating back via Back button.
        setTimeout(() => {
          this.restoreScrollPositionIfNeeded();
        }, 0);
      }
    } finally {
      if (InspireReferencePanelController.isNavigatingHistory) {
        const currentID = args.item?.id;
        if (!args.item || currentID === this.currentItemID) {
          InspireReferencePanelController.isNavigatingHistory = false;
        }
      }
      InspireReferencePanelController.syncBackButtonStates();
    }
  }

  private restoreScrollPositionIfNeeded() {
    if (this.applyScrollRestore(this.pendingScrollRestore)) {
      this.pendingScrollRestore = undefined;
      return;
    }
    if (
      this.applyScrollRestore(
        InspireReferencePanelController.sharedPendingScrollRestore,
      )
    ) {
      InspireReferencePanelController.sharedPendingScrollRestore = undefined;
    }
  }

  private applyScrollRestore(
    restore?: ScrollState & { itemID: number },
  ): boolean {
    if (!restore || this.currentItemID !== restore.itemID) {
      return false;
    }

    this.listEl.scrollTop = restore.scrollTop;
    this.listEl.scrollLeft = restore.scrollLeft;

    for (const snapshot of restore.scrollSnapshots) {
      const target = snapshot.element as any;
      if (typeof target.scrollTo === "function") {
        target.scrollTo(snapshot.left, snapshot.top);
      } else {
        if (typeof target.scrollTop === "number") {
          target.scrollTop = snapshot.top;
        }
        if (typeof target.scrollLeft === "number") {
          target.scrollLeft = snapshot.left;
        }
      }
    }

    if (
      restore.activeElement &&
      typeof (restore.activeElement as any).focus === "function"
    ) {
      try {
        (restore.activeElement as any).focus();
      } catch (_err) {
        // Ignore focus restoration issues
      }
    }
    return true;
  }

  private captureScrollState(): ScrollState {
    const doc = this.body.ownerDocument;
    const isElementNode = (value: any): value is Element =>
      Boolean(value && typeof value === "object" && value.nodeType === 1);
    const scrollSnapshots: ScrollSnapshot[] = [];
    let current: Element | null = this.body;
    while (current) {
      const node = current as any;
      if (
        typeof node.scrollTop === "number" &&
        typeof node.scrollHeight === "number" &&
        typeof node.clientHeight === "number" &&
        node.scrollHeight > node.clientHeight
      ) {
        scrollSnapshots.push({
          element: current,
          top: node.scrollTop ?? 0,
          left: node.scrollLeft ?? 0,
        });
      }
      current = current.parentElement;
    }
    const docElement =
      doc.scrollingElement ||
      (doc as any).documentElement ||
      (doc as any).body ||
      null;
    if (isElementNode(docElement)) {
      const node = docElement as any;
      scrollSnapshots.push({
        element: docElement,
        top: node.scrollTop ?? 0,
        left: node.scrollLeft ?? 0,
      });
    }
    return {
      scrollTop: this.listEl.scrollTop,
      scrollLeft: this.listEl.scrollLeft,
      scrollSnapshots,
      activeElement: doc.activeElement as Element | null,
    };
  }

  private applyScrollState(state?: ScrollState) {
    if (!state) {
      return;
    }
    this.listEl.scrollTop = state.scrollTop;
    this.listEl.scrollLeft = state.scrollLeft;
    for (const snapshot of state.scrollSnapshots) {
      const target = snapshot.element as any;
      if (typeof target.scrollTo === "function") {
        target.scrollTo(snapshot.left, snapshot.top);
      } else {
        if (typeof target.scrollTop === "number") {
          target.scrollTop = snapshot.top;
        }
        if (typeof target.scrollLeft === "number") {
          target.scrollLeft = snapshot.left;
        }
      }
    }
  }

  private captureNavigationSnapshot(): NavigationSnapshot | null {
    if (!this.currentItemID) {
      return null;
    }
    // Capture live tab state for accurate snapshot
    const liveTabType = ReaderTabHelper.getSelectedTabType();
    const liveReaderTabID =
      liveTabType === "reader"
        ? ReaderTabHelper.getSelectedTabID() ||
          ReaderTabHelper.getReaderTabIDForParentItem(this.currentItemID)
        : undefined;
    return {
      itemID: this.currentItemID,
      recid: this.currentRecid,
      scrollState: this.captureScrollState(),
      tabType: liveTabType === "reader" ? "reader" : this.currentTabType,
      readerTabID: liveReaderTabID || this.currentReaderTabID,
    };
  }

  private async reopenReaderTab(snapshot: NavigationSnapshot) {
    if (
      !snapshot.itemID ||
      !Zotero.Reader ||
      typeof Zotero.Reader.open !== "function"
    ) {
      return;
    }
    try {
      // Zotero.Reader.open expects an attachment ID, not the parent item ID
      // Find the best attachment for this parent item
      const parentItem = Zotero.Items.get(snapshot.itemID);
      if (!parentItem) {
        return;
      }
      const attachmentIDs = parentItem.getAttachments?.() || [];
      // Find the first PDF attachment
      let attachmentID: number | undefined;
      for (const id of attachmentIDs) {
        const attachment = Zotero.Items.get(id);
        if (attachment?.isPDFAttachment?.()) {
          attachmentID = id;
          break;
        }
      }
      if (!attachmentID && attachmentIDs.length > 0) {
        attachmentID = attachmentIDs[0]; // Fallback to first attachment
      }
      if (!attachmentID) {
        Zotero.debug(
          `[${config.addonName}] No attachment found for item ${snapshot.itemID}`,
        );
        return;
      }
      const reader =
        (await Zotero.Reader.open(attachmentID, undefined, {
          allowDuplicate: false,
        })) || null;
      if (reader) {
        ReaderTabHelper.focusReader(reader as _ZoteroTypes.ReaderInstance);
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to reopen reader for item ${snapshot.itemID}: ${err}`,
      );
    }
  }

  private static syncBackButtonStates() {
    for (const controller of InspireReferencePanelController.instances) {
      controller.updateBackButtonState();
    }
  }

  private resetListScroll() {
    // Only reset the list element's scroll position, NOT parent elements
    // Resetting parent scroll or calling scrollIntoView causes the entire
    // item pane to jump when switching tabs, which is a poor UX
    if (this.listEl) {
      this.listEl.scrollTop = 0;
      this.listEl.scrollLeft = 0;
    }
  }

  private clearEntryCitedContext() {
    if (this.viewMode === "entryCited") {
      this.viewMode = "references";
    }
    this.entryCitedSource = undefined;
    this.entryCitedReturnScroll = undefined;
    this.clearAuthorProfileState();
    this.updateTabSelection();
  }

  private rememberCurrentItemForNavigation() {
    if (
      !this.currentItemID ||
      InspireReferencePanelController.isNavigatingHistory
    ) {
      return;
    }
    const stack = InspireReferencePanelController.navigationStack;
    const last = stack[stack.length - 1];
    if (last?.itemID === this.currentItemID) {
      return;
    }
    // Capture current tab state at the moment of navigation
    // Use live selectedID/selectedType to ensure we get the actual current tab
    const liveTabType = ReaderTabHelper.getSelectedTabType();
    const liveReaderTabID =
      liveTabType === "reader" ? ReaderTabHelper.getSelectedTabID() : undefined;
    // Also try to find reader tab by parent item's attachments
    const readerTabID =
      liveReaderTabID ||
      ReaderTabHelper.getReaderTabIDForParentItem(this.currentItemID) ||
      this.currentReaderTabID;
    const scrollState = this.captureScrollState();
    const finalTabType =
      liveTabType === "reader" ? "reader" : this.currentTabType;
    stack.push({
      itemID: this.currentItemID,
      recid: this.currentRecid,
      scrollState,
      tabType: finalTabType,
      readerTabID: readerTabID,
    });
    if (stack.length > NAVIGATION_STACK_LIMIT) {
      stack.shift();
    }
    InspireReferencePanelController.forwardStack = [];
    InspireReferencePanelController.syncBackButtonStates();
  }

  private handleBackNavigation() {
    const stack = InspireReferencePanelController.navigationStack;
    if (!stack.length) {
      return;
    }
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) {
      return;
    }
    const currentSnapshot = this.captureNavigationSnapshot();
    if (currentSnapshot) {
      InspireReferencePanelController.forwardStack.push(currentSnapshot);
      if (
        InspireReferencePanelController.forwardStack.length >
        NAVIGATION_STACK_LIMIT
      ) {
        InspireReferencePanelController.forwardStack.shift();
      }
    }
    InspireReferencePanelController.sharedPendingScrollRestore = undefined;
    while (stack.length) {
      const snapshot = stack.pop();
      if (!snapshot) {
        break;
      }
      const targetItem = Zotero.Items.get(snapshot.itemID);
      if (!targetItem) {
        continue;
      }
      InspireReferencePanelController.isNavigatingHistory = true;
      InspireReferencePanelController.sharedPendingScrollRestore = {
        itemID: snapshot.itemID,
        scrollTop: snapshot.scrollState.scrollTop,
        scrollLeft: snapshot.scrollState.scrollLeft,
        scrollSnapshots: snapshot.scrollState.scrollSnapshots,
        activeElement: snapshot.scrollState.activeElement,
      };
      // If the snapshot was from a reader tab, try to switch to it directly
      // instead of calling selectItems (which would switch to library tab)
      if (snapshot.tabType === "reader" && snapshot.readerTabID) {
        const readerTabExists = ReaderTabHelper.getReaderByTabID(
          snapshot.readerTabID,
        );
        if (readerTabExists) {
          ReaderTabHelper.selectTab(snapshot.readerTabID);
          ReaderTabHelper.focusReader(readerTabExists);
          break;
        }
        // Reader tab was closed - try to reopen if setting is enabled
        if (getPref("reader_auto_reopen")) {
          void this.reopenReaderTab(snapshot);
          break;
        }
      }
      // Fallback: select item in library (for library snapshots or closed reader tabs)
      pane.selectItems([snapshot.itemID]);
      break;
    }
    InspireReferencePanelController.syncBackButtonStates();
  }

  private handleForwardNavigation() {
    const stack = InspireReferencePanelController.forwardStack;
    if (!stack.length) {
      return;
    }
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) {
      return;
    }
    const currentSnapshot = this.captureNavigationSnapshot();
    if (currentSnapshot) {
      const backStack = InspireReferencePanelController.navigationStack;
      backStack.push(currentSnapshot);
      if (backStack.length > NAVIGATION_STACK_LIMIT) {
        backStack.shift();
      }
    }
    InspireReferencePanelController.sharedPendingScrollRestore = undefined;
    while (stack.length) {
      const snapshot = stack.pop();
      if (!snapshot) {
        break;
      }
      const targetItem = Zotero.Items.get(snapshot.itemID);
      if (!targetItem) {
        continue;
      }
      InspireReferencePanelController.isNavigatingHistory = true;
      InspireReferencePanelController.sharedPendingScrollRestore = {
        itemID: snapshot.itemID,
        scrollTop: snapshot.scrollState.scrollTop,
        scrollLeft: snapshot.scrollState.scrollLeft,
        scrollSnapshots: snapshot.scrollState.scrollSnapshots,
        activeElement: snapshot.scrollState.activeElement,
      };
      // If the snapshot was from a reader tab, try to switch to it directly
      if (snapshot.tabType === "reader" && snapshot.readerTabID) {
        const readerTabExists = ReaderTabHelper.getReaderByTabID(
          snapshot.readerTabID,
        );
        if (readerTabExists) {
          ReaderTabHelper.selectTab(snapshot.readerTabID);
          ReaderTabHelper.focusReader(readerTabExists);
          break;
        }
        // Reader tab was closed - try to reopen if setting is enabled
        if (getPref("reader_auto_reopen")) {
          void this.reopenReaderTab(snapshot);
          break;
        }
      }
      // Fallback: select item in library
      pane.selectItems([snapshot.itemID]);
      break;
    }
    InspireReferencePanelController.syncBackButtonStates();
  }

  private updateBackButtonState() {
    if (!this.backButton) {
      return;
    }
    const hasHistory =
      InspireReferencePanelController.navigationStack.length > 0;
    const navigating = InspireReferencePanelController.isNavigatingHistory;
    this.backButton.disabled = !hasHistory || navigating;
    this.updateNavButtonVisualState(this.backButton);
    if (this.forwardButton) {
      const hasForward =
        InspireReferencePanelController.forwardStack.length > 0;
      this.forwardButton.disabled = !hasForward || navigating;
      this.updateNavButtonVisualState(this.forwardButton);
    }
  }

  /**
   * Set loading state for the section header refresh button.
   * Swaps the icon to Zotero's built-in loading.svg (with animation) during loading.
   */
  private setRefreshButtonLoading(loading: boolean) {
    const REFRESH_ICON = "chrome://zotero/skin/16/universal/refresh.svg";
    const LOADING_ICON = "chrome://global/skin/icons/loading.svg";

    Zotero.debug(
      `[${config.addonName}] setRefreshButtonLoading called: loading=${loading}`,
    );

    try {
      // Find section container from body
      let section: Element | null = this.body.parentElement;
      let attempts = 0;
      while (section && attempts < 10) {
        if (
          section.tagName?.toLowerCase() === "collapsible-section" ||
          section.classList?.contains("collapsible-section")
        ) {
          break;
        }
        section = section.parentElement;
        attempts++;
      }

      if (!section) {
        Zotero.debug(
          `[${config.addonName}] setRefreshButtonLoading: section not found`,
        );
        return;
      }

      // Find the refresh button by class name (class="refresh section-custom-button")
      const refreshBtn = section.querySelector(
        "toolbarbutton.refresh, .refresh.section-custom-button",
      ) as Element | null;

      if (!refreshBtn) {
        Zotero.debug(
          `[${config.addonName}] setRefreshButtonLoading: refresh button not found`,
        );
        return;
      }

      // Find the icon inside the refresh button
      const icon = refreshBtn.querySelector(
        ".toolbarbutton-icon, image",
      ) as HTMLElement | null;

      if (icon) {
        const currentSrc = icon.getAttribute("src");
        const newSrc = loading ? LOADING_ICON : REFRESH_ICON;
        Zotero.debug(
          `[${config.addonName}] setRefreshButtonLoading: changing icon from ${currentSrc} to ${newSrc}`,
        );
        icon.setAttribute("src", newSrc);
      } else {
        Zotero.debug(
          `[${config.addonName}] setRefreshButtonLoading: icon element not found in refresh button`,
        );
      }
    } catch (e) {
      Zotero.debug(`[${config.addonName}] setRefreshButtonLoading error: ${e}`);
    }
  }

  private async loadEntries(
    recid: string,
    mode: InspireViewMode,
    options: { force?: boolean; resetScroll?: boolean } = {},
  ) {
    this.cancelActiveRequest();
    const isActiveMode = this.viewMode === mode;
    if (isActiveMode) {
      const loadingMessage = this.getLoadingMessageForMode(mode);
      this.allEntries = [];
      this.setStatus(loadingMessage);
      this.renderMessage(loadingMessage);
      this.setRefreshButtonLoading(true);
    }

    const cache = this.getCacheForMode(mode);
    const sortOption = this.getSortOptionForMode(mode);
    const cacheKey = this.getCacheKey(recid, mode, sortOption);

    // Force mode: delete local cache to ensure fresh data from API
    // Smart caching: delete both unsorted and sorted cache files
    if (options.force) {
      const localCacheType = this.getLocalCacheType(mode);
      if (localCacheType) {
        if (mode === "references") {
          // References only use unsorted cache
          await localCache.delete(localCacheType, recid);
        } else {
          // Cited By / Author: delete both unsorted and sorted cache
          await Promise.all([
            localCache.delete(localCacheType, recid),
            localCache.delete(localCacheType, recid, sortOption),
          ]);
        }
      }
    }

    // Step 1: Check memory cache (fastest)
    const cached = cache.get(cacheKey);
    if (cached && !options.force) {
      if (isActiveMode) {
        const shouldReset = Boolean(options.resetScroll);
        const entriesForDisplay =
          mode === "references" ? this.getSortedReferences(cached) : cached;
        this.allEntries = entriesForDisplay;
        // Reset totalApiCount for cached data (allEntries.length is accurate)
        this.totalApiCount = null;
        this.chartSelectedBins.clear(); // Clear chart selection on data change
        // Update cache source indicator
        this.cacheSource = "memory";
        this.cacheSourceAge = undefined;
        this.cacheSourceExpired = false;
        this.updateCacheSourceDisplay();
        this.renderChart(); // Use deferred render (same as original implementation)
        this.renderReferenceList({ preserveScroll: !shouldReset });
        if (mode === "entryCited" && this.entryCitedSource?.authorSearchInfo) {
          this.updateAuthorStats(entriesForDisplay);
          this.updateAuthorProfileCard();
        }
        if (shouldReset) {
          this.resetListScroll();
        } else {
          setTimeout(() => {
            this.restoreScrollPositionIfNeeded();
          }, 0);
        }
        this.setRefreshButtonLoading(false);
      }
      return;
    }

    // Step 2: Check local file cache (if enabled)
    // Smart caching strategy:
    // - References: always store without sort (client-side sorting)
    // - Cited By/Author: if total <= CITED_BY_MAX_RESULTS, store without sort; otherwise by sort
    if (!options.force) {
      const localCacheType = this.getLocalCacheType(mode);
      if (localCacheType) {
        let localResult: {
          data: InspireReferenceEntry[];
          fromCache: true;
          ageHours: number;
          total?: number;
        } | null = null;
        let usedClientSideSort = false;

        if (mode === "references") {
          // References: always read without sort (client-side sorting)
          localResult = await localCache.get<InspireReferenceEntry[]>(
            localCacheType,
            recid,
          );
          usedClientSideSort = true;
        } else {
          // Cited By / Author Papers: try unsorted cache first (if data was complete)
          const unsortedResult = await localCache.get<InspireReferenceEntry[]>(
            localCacheType,
            recid,
          );
          if (
            unsortedResult &&
            unsortedResult.total !== undefined &&
            unsortedResult.total <= CITED_BY_MAX_RESULTS
          ) {
            // Data is complete, can use client-side sorting
            localResult = unsortedResult;
            usedClientSideSort = true;
          } else {
            // Try sort-specific cache
            localResult = await localCache.get<InspireReferenceEntry[]>(
              localCacheType,
              recid,
              sortOption,
            );
          }
        }

        if (localResult) {
          // Found in local cache - populate memory cache and display
          cache.set(cacheKey, localResult.data);
          if (isActiveMode) {
            const shouldReset = Boolean(options.resetScroll);
            // Apply client-side sorting if using unsorted cache
            const entriesForDisplay = usedClientSideSort
              ? mode === "references"
                ? this.getSortedReferences(localResult.data)
                : this.getSortedCitedBy(
                    localResult.data,
                    sortOption as InspireSortOption,
                  )
              : localResult.data;
            this.allEntries = entriesForDisplay;
            this.totalApiCount = localResult.total ?? null;
            this.chartSelectedBins.clear();
            // Update cache source indicator (ageHours returned from get() to avoid re-reading file)
            this.cacheSource = "local";
            this.cacheSourceAge = localResult.ageHours;
            this.cacheSourceExpired = false;
            this.updateCacheSourceDisplay();
            this.renderChart();
            this.renderReferenceList({ preserveScroll: !shouldReset });
            if (mode === "entryCited" && this.entryCitedSource?.authorSearchInfo) {
              this.updateAuthorStats(entriesForDisplay);
              this.updateAuthorProfileCard();
            }
            if (shouldReset) {
              this.resetListScroll();
            } else {
              setTimeout(() => {
                this.restoreScrollPositionIfNeeded();
              }, 0);
            }
            this.setRefreshButtonLoading(false);

            // Local cache data is already enriched (complete with titles, authors, etc.)
            // Only run enrichLocalStatus to update local item status (may have changed since cache)
            const localCacheToken = `${mode}-${cacheKey}-local-${performance.now()}`;
            this.pendingToken = localCacheToken;
            const localSupportsAbort =
              typeof AbortController !== "undefined" &&
              typeof AbortController === "function";
            const localEnrichController = localSupportsAbort
              ? new AbortController()
              : null;
            this.activeAbort = localEnrichController ?? undefined;
            setTimeout(async () => {
              if (this.pendingToken !== localCacheToken) {
                return;
              }
              try {
                await this.enrichLocalStatus(
                  localResult.data,
                  localEnrichController?.signal,
                );
              } catch (err) {
                // Silently ignore errors
                if ((err as any)?.name !== "AbortError") {
                  Zotero.debug(
                    `[${config.addonName}] Local status enrichment error: ${err}`,
                  );
                }
              } finally {
                if (this.activeAbort === localEnrichController) {
                  this.activeAbort = undefined;
                }
              }
            }, 0);
          }
          return;
        }
      }
    }

    const supportsAbort =
      typeof AbortController !== "undefined" &&
      typeof AbortController === "function";
    const controller = supportsAbort ? new AbortController() : null;
    this.activeAbort = controller ?? undefined;
    const token = `${mode}-${cacheKey}-${performance.now()}`;
    this.pendingToken = token;

    try {
      let entries: InspireReferenceEntry[];
      let hasRenderedFirstPage = false;

      // Reset total count for new load
      this.totalApiCount = null;

      // Track previous entry count for incremental append
      let previousEntryCount = 0;

      // Progressive rendering callback for cited-by and author papers
      // Optimized to use incremental append instead of full re-render
      const onProgress = (
        currentEntries: InspireReferenceEntry[],
        total: number | null,
      ) => {
        if (this.pendingToken !== token || this.viewMode !== mode) {
          return;
        }
        const prevCount = previousEntryCount;
        previousEntryCount = currentEntries.length;
        this.allEntries = currentEntries;

        // Save API total count (may be larger than what we fetch due to limits)
        if (total !== null) {
          this.totalApiCount = total;
        }

        // Update status with loading progress (only when not filtering)
        if (!this.filterText) {
          const loadedCount = currentEntries.length;
          const totalStr = total !== null ? ` of ${total}` : "";
          this.setStatus(`Loading... ${loadedCount}${totalStr} records`);
        }

        // First page: full render for initial display
        if (!hasRenderedFirstPage) {
          this.renderChartImmediate(); // Render chart immediately on first page
          this.renderReferenceList({ preserveScroll: false });
          if (options.resetScroll) {
            this.resetListScroll();
          }
          hasRenderedFirstPage = true;
        } else if (this.filterText || this.chartSelectedBins.size > 0) {
          // If filtering is active, need full re-render to apply filter
          this.renderReferenceList({ preserveScroll: true });
        } else {
          // Incremental append for subsequent batches (no filter active)
          this.appendNewEntries(prevCount);
        }
      };

      if (mode === "references") {
        // References mode with progressive rendering
        this.totalApiCount = null;

        // Custom progress handler for references that applies sorting
        // Use same pattern as onProgress (cited-by) which works correctly
        const referencesOnProgress = (
          currentEntries: InspireReferenceEntry[],
          total: number,
        ) => {
          if (this.pendingToken !== token || this.viewMode !== mode) {
            return;
          }
          // Apply sorting before display
          this.allEntries = this.getSortedReferences(currentEntries);

          // Update status with loading progress (only when not filtering)
          if (!this.filterText) {
            this.setStatus(
              `Loading... ${currentEntries.length} of ${total} references`,
            );
          }

          // First page: full render for initial display (same pattern as onProgress)
          if (!hasRenderedFirstPage) {
            this.renderChartImmediate(); // Render chart on first page
            this.renderReferenceList({ preserveScroll: false });
            if (options.resetScroll) {
              this.resetListScroll();
            }
            hasRenderedFirstPage = true;
          } else if (this.filterText) {
            // If filtering is active, need full re-render to apply filter
            this.renderReferenceList({ preserveScroll: true });
          }
        };

        entries = await fetchReferencesEntries(recid, {
          signal: controller?.signal,
          onProgress: referencesOnProgress,
        });
      } else if (
        mode === "entryCited" &&
        this.entryCitedSource?.authorSearchInfo
      ) {
        // Author papers search mode with progressive rendering
        entries = await this.fetchAuthorPapers(
          this.entryCitedSource.authorSearchInfo,
          sortOption as InspireSortOption,
          controller?.signal,
          onProgress,
        );
      } else {
        // citedBy or entryCited with recid - with progressive rendering
        entries = await this.fetchCitedBy(
          recid,
          sortOption as InspireSortOption,
          controller?.signal,
          onProgress,
        );
      }
      cache.set(cacheKey, entries);

      // Local cache write is deferred until after enrichment completes
      // to ensure complete data (with titles, authors, citation counts) is stored

      if (this.pendingToken === token && this.viewMode === mode) {
        const entriesForDisplay =
          mode === "references" ? this.getSortedReferences(entries) : entries;
        this.allEntries = entriesForDisplay;
        this.chartSelectedBins.clear(); // Clear chart selection on data change
        // Update cache source indicator - data from API
        this.cacheSource = "api";
        this.cacheSourceAge = undefined;
        this.cacheSourceExpired = false;
        this.updateCacheSourceDisplay();
        this.renderChart(); // Use deferred render (same as original implementation)
        this.renderReferenceList();
        if (mode === "entryCited" && this.entryCitedSource?.authorSearchInfo) {
          this.updateAuthorStats(entriesForDisplay);
          this.updateAuthorProfileCard();
        }
        if (options.resetScroll && !hasRenderedFirstPage) {
          this.resetListScroll();
        } else if (!hasRenderedFirstPage) {
          setTimeout(() => {
            this.restoreScrollPositionIfNeeded();
          }, 0);
        }
      }

      // Non-blocking enrichment: run after rendering to improve perceived performance
      // Use setTimeout(0) to ensure DOM is fully updated before starting enrichment
      // enrichLocalStatus checks which entries exist in local library
      // enrichReferencesEntries fetches missing metadata for references mode
      // enrichEntries fetches missing metadata for citedBy/entryCited modes
      const enrichToken = token;
      const enrichSignal = controller?.signal;
      const enrichRecid = recid;
      const enrichMode = mode;
      const enrichSortOption = sortOption;
      setTimeout(async () => {
        // Skip if request was cancelled or mode changed
        if (this.pendingToken !== enrichToken) {
          Zotero.debug(
            `[${config.addonName}] Enrichment skipped: token mismatch (expected ${enrichToken}, got ${this.pendingToken})`,
          );
          return;
        }
        try {
          Zotero.debug(
            `[${config.addonName}] Starting enrichment for ${enrichMode}/${enrichRecid} (${entries.length} entries)`,
          );
          if (mode === "references") {
            await Promise.allSettled([
              this.enrichLocalStatus(entries, enrichSignal),
              enrichReferencesEntries(entries, {
                signal: enrichSignal,
                onBatchComplete: (processedRecids) => {
                  if (this.pendingToken !== enrichToken) {
                    return;
                  }
                  for (const recid of processedRecids) {
                    for (const entry of entries) {
                      if (entry.recid === recid) {
                        this.updateRowMetadata(entry);
                        this.updateRowCitationCount(entry);
                      }
                    }
                  }
                },
              }),
            ]);
          } else {
            await Promise.allSettled([
              this.enrichLocalStatus(entries, enrichSignal),
              this.enrichEntries(entries, enrichSignal),
            ]);
          }
          Zotero.debug(
            `[${config.addonName}] Enrichment completed for ${enrichMode}/${enrichRecid}`,
          );

          if (
            enrichMode === "entryCited" &&
            this.entryCitedSource?.authorSearchInfo
          ) {
            this.updateAuthorStats(entries);
            this.updateAuthorProfileCard();
          }

          // After enrichment completes, persist enriched data to local cache
          // ALWAYS write to cache after enrichment, even if user switched to another item
          // This ensures the enriched data is saved for future use
          await this.persistEnrichedCache(
            entries,
            enrichMode,
            enrichRecid,
            enrichSortOption,
          );
        } catch (err) {
          // Silently ignore enrichment errors - they don't affect core functionality
          if ((err as any)?.name !== "AbortError") {
            Zotero.debug(`[${config.addonName}] Enrichment error: ${err}`);
          }
        }
      }, 0);
    } catch (err) {
      // Network error - try to fallback to stale local cache (ignoreTTL)
      // This provides offline support for Cited By and Author Papers modes
      if ((err as any)?.name === "AbortError") {
        throw err; // Re-throw abort errors
      }

      // Only attempt stale cache fallback for modes that have TTL-based caching
      // (citedBy, entryCited/author) - references are permanent so never expire
      if (mode !== "references") {
        const localCacheType = this.getLocalCacheType(mode);
        if (localCacheType) {
          Zotero.debug(
            `[${config.addonName}] Network error, attempting stale cache fallback for ${mode}/${recid}`,
          );

          let staleResult: {
            data: InspireReferenceEntry[];
            fromCache: true;
            ageHours: number;
            total?: number;
            expired?: boolean;
          } | null = null;

          // Try unsorted cache first (if data was complete), then sorted cache
          const unsortedResult = await localCache.get<InspireReferenceEntry[]>(
            localCacheType,
            recid,
            undefined,
            { ignoreTTL: true },
          );
          if (
            unsortedResult &&
            unsortedResult.total !== undefined &&
            unsortedResult.total <= CITED_BY_MAX_RESULTS
          ) {
            staleResult = unsortedResult;
          } else {
            // Try sort-specific cache
            staleResult = await localCache.get<InspireReferenceEntry[]>(
              localCacheType,
              recid,
              sortOption,
              { ignoreTTL: true },
            );
          }

          if (staleResult) {
            Zotero.debug(
              `[${config.addonName}] Using stale cache (${staleResult.ageHours}h old, expired=${staleResult.expired}) for ${mode}/${recid}`,
            );

            // Populate memory cache and display stale data
            cache.set(cacheKey, staleResult.data);
            if (isActiveMode) {
              const entriesForDisplay = this.getSortedCitedBy(
                staleResult.data,
                sortOption as InspireSortOption,
              );
              this.allEntries = entriesForDisplay;
              this.totalApiCount = staleResult.total ?? null;
              this.chartSelectedBins.clear();
              // Update cache source indicator with expired flag
              this.cacheSource = "local";
              this.cacheSourceAge = staleResult.ageHours;
              this.cacheSourceExpired = staleResult.expired ?? false;
              this.updateCacheSourceDisplay();
              this.renderChart();
              this.renderReferenceList({ preserveScroll: false });
              if (mode === "entryCited" && this.entryCitedSource?.authorSearchInfo) {
                this.updateAuthorStats(entriesForDisplay);
                this.updateAuthorProfileCard();
              }
              if (options.resetScroll) {
                this.resetListScroll();
              }

              // Show warning toast that data may be outdated
              if (staleResult.expired) {
                const warningMsg = getString(
                  "references-panel-status-stale-cache",
                  {
                    args: { hours: String(staleResult.ageHours) },
                  },
                );
                this.showToast(warningMsg);
              }
            }
            return; // Successfully used stale cache
          }
        }
      }

      // No stale cache available, re-throw the error
      throw err;
    } finally {
      if (this.pendingToken === token) {
        this.activeAbort = undefined;
      }
      if (isActiveMode) {
        this.setRefreshButtonLoading(false);
      }
    }
  }

  private async fetchCitedBy(
    recid: string,
    sort: InspireSortOption,
    signal?: AbortSignal,
    onProgress?: (
      entries: InspireReferenceEntry[],
      total: number | null,
    ) => void,
  ) {
    Zotero.debug(
      `[${config.addonName}] Fetching citing records for recid ${recid}`,
    );
    const entries: InspireReferenceEntry[] = [];
    const query = encodeURIComponent(`refersto:recid:${recid}`);
    const sortParam = sort ? `&sort=${sort}` : "";
    // FTR-API-FIELD-OPTIMIZATION: Use centralized field configuration
    // Include authors.ids for BAI extraction (most reliable for author search)
    const fieldsParam = buildFieldsParam(API_FIELDS_LIST_DISPLAY);

    // Helper to fetch a single page
    const fetchPage = async (
      pageNum: number,
      pageSize: number,
    ): Promise<any[]> => {
      const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=${pageSize}&page=${pageNum}${sortParam}${fieldsParam}`;
      const response = await inspireFetch(
        url,
        signal ? { signal } : undefined,
      ).catch(() => null);
      if (!response || response.status === 404) {
        return [];
      }
      const payload: any = await response.json();
      return Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
    };

    // Step 1: Fetch first page to get total count and display initial results quickly
    const firstUrl = `${INSPIRE_API_BASE}/literature?q=${query}&size=${CITED_BY_PAGE_SIZE}&page=1${sortParam}${fieldsParam}`;
    const firstResponse = await inspireFetch(
      firstUrl,
      signal ? { signal } : undefined,
    ).catch(() => null);
    if (!firstResponse || firstResponse.status === 404) {
      throw new Error("Cited-by list not found");
    }
    const firstPayload: any = await firstResponse.json();
    const totalHits =
      typeof firstPayload?.hits?.total === "number"
        ? firstPayload.hits.total
        : 0;
    const firstHits = Array.isArray(firstPayload?.hits?.hits)
      ? firstPayload.hits.hits
      : [];

    // Process first page results
    for (const hit of firstHits) {
      entries.push(this.buildEntryFromSearch(hit, entries.length));
    }

    // Show first page immediately
    if (onProgress && entries.length > 0) {
      onProgress(entries, totalHits);
    }

    // Step 2: Calculate remaining pages needed and fetch in parallel batches
    if (
      entries.length < totalHits &&
      entries.length < CITED_BY_MAX_RESULTS &&
      !signal?.aborted
    ) {
      const remaining =
        Math.min(totalHits, CITED_BY_MAX_RESULTS) - entries.length;
      const pagesNeeded = Math.ceil(remaining / CITED_BY_PAGE_SIZE);
      const maxPages = Math.min(pagesNeeded, CITED_BY_MAX_PAGES - 1); // -1 for first page already fetched

      // Fetch subsequent pages in parallel batches
      for (
        let batchStart = 0;
        batchStart < maxPages && !signal?.aborted;
        batchStart += CITED_BY_PARALLEL_BATCH_SIZE
      ) {
        const batchEnd = Math.min(
          batchStart + CITED_BY_PARALLEL_BATCH_SIZE,
          maxPages,
        );
        const batchPromises: Promise<any[]>[] = [];

        for (let i = batchStart; i < batchEnd; i++) {
          const pageNum = i + 2; // Page 2, 3, 4, ... (page 1 already fetched)
          batchPromises.push(fetchPage(pageNum, CITED_BY_PAGE_SIZE));
        }

        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises);

        // Process results in order
        for (const hits of batchResults) {
          if (signal?.aborted) break;
          for (const hit of hits) {
            if (entries.length >= CITED_BY_MAX_RESULTS) break;
            entries.push(this.buildEntryFromSearch(hit, entries.length));
          }
        }

        // Progress callback after each batch
        if (onProgress && entries.length > 0) {
          onProgress(entries, totalHits);
        }

        // Check if we have enough
        if (
          entries.length >= totalHits ||
          entries.length >= CITED_BY_MAX_RESULTS
        ) {
          break;
        }
      }
    }

    Zotero.debug(
      `[${config.addonName}] Retrieved ${entries.length} citing records for ${recid}`,
    );
    return entries;
  }

  /**
   * Fetch papers by author using INSPIRE search API.
   * Priority: BAI > fullName (authorrecid removed as it doesn't work reliably)
   * BAI like "Feng.Kun.Guo.1" is the most reliable (per INSPIRE API docs).
   */
  private async fetchAuthorPapers(
    authorInfo: AuthorSearchInfo,
    sort: InspireSortOption,
    signal?: AbortSignal,
    onProgress?: (
      entries: InspireReferenceEntry[],
      total: number | null,
    ) => void,
  ) {
    // Build query based on available information (priority: BAI > name)
    let queryString: string;
    if (authorInfo.bai) {
      // Use BAI for precise search (per INSPIRE API docs: "a E.Witten.1")
      queryString = `author:${authorInfo.bai}`;
      Zotero.debug(
        `[${config.addonName}] Fetching papers for author BAI: ${authorInfo.bai} (${authorInfo.fullName})`,
      );
    } else {
      // Convert full name to search format: "Guo, Feng-Kun" → "f k guo"
      const searchName = convertFullNameToSearchQuery(authorInfo.fullName);
      queryString = `author:${searchName}`;
      Zotero.debug(
        `[${config.addonName}] Fetching papers for author: ${searchName} (from ${authorInfo.fullName})`,
      );
    }
    const entries: InspireReferenceEntry[] = [];
    const query = encodeURIComponent(queryString);
    const sortParam = sort ? `&sort=${sort}` : "";
    // FTR-API-FIELD-OPTIMIZATION: Use centralized field configuration
    // Include authors.ids for BAI extraction (most reliable for author search)
    const fieldsParam = buildFieldsParam(API_FIELDS_LIST_DISPLAY);

    // Helper to fetch a single page
    const fetchPage = async (
      pageNum: number,
      pageSize: number,
    ): Promise<any[]> => {
      const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=${pageSize}&page=${pageNum}${sortParam}${fieldsParam}`;
      const response = await inspireFetch(
        url,
        signal ? { signal } : undefined,
      ).catch(() => null);
      if (!response || response.status === 404) {
        return [];
      }
      const payload: any = await response.json();
      return Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
    };

    // Step 1: Fetch first page to get total count and display initial results quickly
    const firstUrl = `${INSPIRE_API_BASE}/literature?q=${query}&size=${CITED_BY_PAGE_SIZE}&page=1${sortParam}${fieldsParam}`;
    const firstResponse = await inspireFetch(
      firstUrl,
      signal ? { signal } : undefined,
    ).catch(() => null);
    if (!firstResponse || firstResponse.status === 404) {
      throw new Error("Author papers not found");
    }
    const firstPayload: any = await firstResponse.json();
    const totalHits =
      typeof firstPayload?.hits?.total === "number"
        ? firstPayload.hits.total
        : 0;
    const firstHits = Array.isArray(firstPayload?.hits?.hits)
      ? firstPayload.hits.hits
      : [];

    // Process first page results
    for (const hit of firstHits) {
      entries.push(this.buildEntryFromSearch(hit, entries.length));
    }

    // Show first page immediately
    if (onProgress && entries.length > 0) {
      onProgress(entries, totalHits);
    }

    // Step 2: Calculate remaining pages needed and fetch in parallel batches
    if (
      entries.length < totalHits &&
      entries.length < CITED_BY_MAX_RESULTS &&
      !signal?.aborted
    ) {
      const remaining =
        Math.min(totalHits, CITED_BY_MAX_RESULTS) - entries.length;
      const pagesNeeded = Math.ceil(remaining / CITED_BY_PAGE_SIZE);
      const maxPages = Math.min(pagesNeeded, CITED_BY_MAX_PAGES - 1); // -1 for first page already fetched

      // Fetch subsequent pages in parallel batches
      for (
        let batchStart = 0;
        batchStart < maxPages && !signal?.aborted;
        batchStart += CITED_BY_PARALLEL_BATCH_SIZE
      ) {
        const batchEnd = Math.min(
          batchStart + CITED_BY_PARALLEL_BATCH_SIZE,
          maxPages,
        );
        const batchPromises: Promise<any[]>[] = [];

        for (let i = batchStart; i < batchEnd; i++) {
          const pageNum = i + 2; // Page 2, 3, 4, ... (page 1 already fetched)
          batchPromises.push(fetchPage(pageNum, CITED_BY_PAGE_SIZE));
        }

        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises);

        // Process results in order
        for (const hits of batchResults) {
          if (signal?.aborted) break;
          for (const hit of hits) {
            if (entries.length >= CITED_BY_MAX_RESULTS) break;
            entries.push(this.buildEntryFromSearch(hit, entries.length));
          }
        }

        // Progress callback after each batch
        if (onProgress && entries.length > 0) {
          onProgress(entries, totalHits);
        }

        // Check if we have enough
        if (
          entries.length >= totalHits ||
          entries.length >= CITED_BY_MAX_RESULTS
        ) {
          break;
        }
      }
    }

    Zotero.debug(
      `[${config.addonName}] Retrieved ${entries.length} papers for author: ${authorInfo.fullName}`,
    );
    return entries;
  }

  /**
   * Enrich entries that are missing essential metadata.
   * Note: abstract is loaded on-demand in showAbstractTooltip, not here.
   *
   * IMPORTANT: For References mode, we only fetch metadata for entries that have
   * a recid but are missing title. We do NOT fetch citation counts for references
   * as this would cause thousands of API requests for large reference lists.
   * Citation counts for references are only shown if already available from the
   * original data.
   */
  private async enrichEntries(
    entries: InspireReferenceEntry[],
    signal?: AbortSignal,
  ) {
    // Cache the "no title" string outside the filter loop for performance
    const noTitleStr = getString("references-panel-no-title");

    // Only fetch metadata for entries that have recid but missing title
    // Citation count is NOT a reason to fetch - it would cause too many requests
    // for references mode where citation counts are typically not in the source data
    const needsDetails = entries.filter(
      (entry) => entry.recid && (!entry.title || entry.title === noTitleStr),
    );
    if (!needsDetails.length) {
      return;
    }
    const concurrency = Math.min(4, needsDetails.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(
        this.runMetadataWorker(needsDetails, i, concurrency, signal),
      );
    }
    await Promise.all(workers);
  }

  /**
   * Enrich local status for entries by checking if they exist in the local library.
   * Uses batch SQL queries to minimize database interactions.
   *
   * Optimization: Increased chunk size from 100 to 500 to reduce query count.
   * - 500 entries: 1 query instead of 5
   * - 1000 entries: 2 queries instead of 10
   */
  private async enrichLocalStatus(
    entries: InspireReferenceEntry[],
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) {
      return;
    }
    const recids = entries.map((e) => e.recid).filter((r): r is string => !!r);
    if (!recids.length) {
      return;
    }
    const fieldID = Zotero.ItemFields.getID("archiveLocation");
    if (!fieldID) {
      return;
    }

    // Increased chunk size for fewer SQL queries (was 100, now 500)
    // SQLite handles IN clauses with 500+ parameters efficiently
    const CHUNK_SIZE = LOCAL_STATUS_BATCH_SIZE;
    const recidMap = new Map<string, number>();

    for (let i = 0; i < recids.length; i += CHUNK_SIZE) {
      if (signal?.aborted) {
        return;
      }
      const chunk = recids.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const sql = `SELECT itemID, value FROM itemData JOIN itemDataValues USING(valueID) WHERE fieldID = ? AND value IN (${placeholders})`;
      try {
        const rows = await Zotero.DB.queryAsync(sql, [fieldID, ...chunk]);
        if (rows) {
          for (const row of rows) {
            recidMap.set(row.value, Number(row.itemID));
          }
        }
      } catch (e) {
        Zotero.debug(`[${config.addonName}] Error querying local items: ${e}`);
      }
    }

    if (signal?.aborted) {
      return;
    }

    // Check signal periodically during iteration to allow early abort
    const CHECK_INTERVAL = 200;
    let checkCounter = 0;
    for (const entry of entries) {
      // Periodic signal check to allow early abort on large datasets
      if (++checkCounter >= CHECK_INTERVAL) {
        checkCounter = 0;
        if (signal?.aborted) {
          return;
        }
      }
      if (entry.recid && recidMap.has(entry.recid)) {
        const itemID = recidMap.get(entry.recid)!;
        if (entry.localItemID !== itemID) {
          entry.localItemID = itemID;
          const item = Zotero.Items.get(itemID);
          if (item) {
            entry.isRelated = this.isCurrentItemRelated(item);
          }
          this.updateRowStatus(entry);
        }
      }
    }
  }

  /**
   * Update the citation count display for a single row.
   * Uses getCitationValue() to respect excludeSelfCitations toggle.
   */
  private updateRowCitationCount(entry: InspireReferenceEntry) {
    const row = this.rowCache.get(entry.id);
    if (!row) return;

    const statsButton = row.querySelector(
      ".zinspire-ref-entry__stats-button",
    ) as HTMLButtonElement | null;
    const statsDiv = row.querySelector(
      ".zinspire-ref-entry__stats:not(.zinspire-ref-entry__stats-button)",
    ) as HTMLDivElement | null;

    const displayCitationCount = this.getCitationValue(entry);
    const hasCitationCount =
      displayCitationCount > 0 ||
      typeof entry.citationCount === "number" ||
      typeof entry.citationCountWithoutSelf === "number";

    if (hasCitationCount) {
      const label = getString("references-panel-citation-count", {
        args: { count: displayCitationCount },
      });

      if (statsButton) {
        statsButton.textContent = label;
      } else if (statsDiv) {
        statsDiv.textContent = label;
      } else if (entry.recid) {
        // Create stats button if it doesn't exist
        const content = row.querySelector(
          ".zinspire-ref-entry__content",
        ) as HTMLDivElement | null;
        if (content) {
          const newStatsButton = content.ownerDocument.createElement("button");
          newStatsButton.type = "button";
          newStatsButton.classList.add(
            "zinspire-ref-entry__stats",
            "zinspire-ref-entry__stats-button",
          );
          newStatsButton.style.cursor = "pointer";
          newStatsButton.textContent = label;
          newStatsButton.addEventListener("click", (event) => {
            event.preventDefault();
            this.showEntryCitedTab(entry).catch(() => void 0);
          });
          content.appendChild(newStatsButton);
        }
      }
    }
  }

  private updateRowStatus(entry: InspireReferenceEntry) {
    const row = this.rowCache.get(entry.id);
    if (!row) return;

    // Get cached strings for performance
    const s = getCachedStrings();

    const marker = row.querySelector(".zinspire-ref-entry__dot") as HTMLElement;
    if (marker) {
      // Use filled circle for local items, circled plus for missing (click to add)
      marker.textContent = entry.localItemID ? "●" : "⊕";
      marker.dataset.state = entry.localItemID ? "local" : "missing";
      marker.classList.add("is-clickable");
      marker.style.cursor = "pointer";
      applyRefEntryMarkerColor(marker, Boolean(entry.localItemID));
      marker.setAttribute("title", entry.localItemID ? s.dotLocal : s.dotAdd);
    }

    const linkButton = row.querySelector(
      ".zinspire-ref-entry__link",
    ) as HTMLButtonElement;
    if (linkButton) {
      linkButton.setAttribute(
        "title",
        entry.isRelated ? s.linkExisting : s.linkMissing,
      );
      this.renderLinkButton(linkButton, Boolean(entry.isRelated));
    }
  }

  /**
   * Update row metadata after entry data changes (PERF-13 compatible).
   * Uses the same template structure as updateRowContent - only updates content, not structure.
   */
  private updateRowMetadata(entry: InspireReferenceEntry) {
    const row = this.rowCache.get(entry.id);
    if (!row) return;

    // Get cached strings for performance
    const s = getCachedStrings();

    // Update label (show/hide) - PERF-13: use existing element
    const labelSpan = row.querySelector(
      ".zinspire-ref-entry__label",
    ) as HTMLElement;
    if (labelSpan) {
      if (entry.label) {
        labelSpan.textContent = `[${entry.label}] `;
        labelSpan.style.display = "";
      } else {
        labelSpan.textContent = "";
        labelSpan.style.display = "none";
      }
    }

    // Update authors container - PERF-13: clear and rebuild author links only
    const authorsContainer = row.querySelector(
      ".zinspire-ref-entry__authors",
    ) as HTMLElement;
    if (authorsContainer) {
      // PERF-FIX-15: Use replaceChildren() instead of innerHTML
      authorsContainer.replaceChildren();
      this.appendAuthorLinks(authorsContainer, entry, s);
    }

    // Update title link - PERF-13: use existing element, events handled by delegation
    const titleLink = row.querySelector(
      ".zinspire-ref-entry__title-link",
    ) as HTMLAnchorElement;
    if (titleLink) {
      titleLink.textContent = entry.title + ";";
      titleLink.href = entry.inspireUrl || entry.fallbackUrl || "#";
    }

    // Update meta with clickable links (DOI/arXiv) - PERF-13: rebuild content
    const meta = row.querySelector(".zinspire-ref-entry__meta") as HTMLElement;
    if (meta) {
      const hasMeta = entry.publicationInfo || entry.arxivDetails || entry.doi;
      if (hasMeta) {
        this.buildMetaContent(meta, entry);
        meta.style.display = "";
      } else {
        // PERF-FIX-15: Use replaceChildren() instead of innerHTML
        meta.replaceChildren();
        meta.style.display = "none";
      }
    }

    // Update stats button (show/hide) - PERF-13: use existing element
    const statsButton = row.querySelector(
      ".zinspire-ref-entry__stats-button",
    ) as HTMLButtonElement;
    if (statsButton) {
      const displayCitationCount = this.getCitationValue(entry);
      const hasCitationCount =
        displayCitationCount > 0 ||
        typeof entry.citationCount === "number" ||
        typeof entry.citationCountWithoutSelf === "number";
      const isReferencesMode = this.viewMode === "references";
      const canShowEntryCitedTab =
        Boolean(entry.recid) && (hasCitationCount || !isReferencesMode);

      if (canShowEntryCitedTab || hasCitationCount) {
        const label = hasCitationCount
          ? getString("references-panel-citation-count", {
              args: { count: displayCitationCount },
            })
          : s.citationUnknown;
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
  }

  private renderLinkButton(button: HTMLButtonElement, isLinked: boolean) {
    const doc = button.ownerDocument;
    // PERF-FIX-15: Use replaceChildren() instead of innerHTML
    button.replaceChildren();
    button.dataset.state = isLinked ? "linked" : "unlinked";
    button.style.opacity = "1";
    button.style.cursor = "pointer";
    // Use the same related.svg icon for both states, with different colors
    const icon = doc.createElement("img");
    icon.src = "chrome://zotero/skin/itempane/16/related.svg";
    icon.width = 14;
    icon.height = 14;
    icon.setAttribute("draggable", "false");
    icon.style.margin = "0";
    icon.style.padding = "0";
    icon.style.display = "block";
    if (isLinked) {
      // Bright green color filter for linked state (high contrast with gray)
      icon.style.filter =
        "brightness(0) saturate(100%) invert(55%) sepia(95%) saturate(500%) hue-rotate(85deg) brightness(95%) contrast(95%)";
    } else {
      // Light gray color filter for unlinked state
      icon.style.filter =
        "brightness(0) saturate(100%) invert(70%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(95%) contrast(85%)";
    }
    button.appendChild(icon);
  }

  private async runMetadataWorker(
    entries: InspireReferenceEntry[],
    offset: number,
    step: number,
    signal?: AbortSignal,
  ) {
    for (let i = offset; i < entries.length; i += step) {
      if (signal?.aborted) {
        return;
      }
      const entry = entries[i];
      // Skip if no recid (can't fetch)
      if (!entry.recid) {
        continue;
      }
      // Use cached metadata if available
      const cachedMeta = this.metadataCache.get(entry.recid);
      if (cachedMeta) {
        this.applyMetadataToEntry(entry, cachedMeta);
        this.updateRowMetadata(entry);
        continue;
      }
      // Fetch metadata from INSPIRE API (minimal fields for performance)
      // Note: minimal=true fetches only title, creators, date - not abstract
      const meta = await fetchInspireMetaByRecid(
        entry.recid,
        undefined,
        "full",
        true, // minimal mode: only fetch essential fields
      ).catch(() => -1);
      if (meta !== -1 && entry.recid) {
        this.metadataCache.set(entry.recid, meta as jsobject);
        this.applyMetadataToEntry(entry, meta as jsobject);
        this.updateRowMetadata(entry);
      }
    }
  }

  private applyMetadataToEntry(entry: InspireReferenceEntry, meta: jsobject) {
    if (!entry.title && meta.title) {
      entry.title = meta.title as string;
    }
    if (entry.title === getString("references-panel-no-title") && meta.title) {
      entry.title = meta.title as string;
    }
    if (!entry.authors.length && Array.isArray(meta.creators)) {
      const allAuthors = (meta.creators as any[])
        .map((creator) => {
          if (creator.name) {
            return creator.name as string;
          }
          const first = creator.firstName ?? "";
          const last = creator.lastName ?? "";
          return `${first} ${last}`.trim();
        })
        .filter(Boolean);
      entry.totalAuthors = allAuthors.length;
      entry.authors = allAuthors;
      entry.authorText = formatAuthors(entry.authors, entry.totalAuthors);
    }
    this.updateEntryAuthorCount(
      entry,
      typeof (meta as any)?.author_count === "number"
        ? Number((meta as any).author_count)
        : undefined,
    );
    if (
      (!entry.year ||
        entry.year === getString("references-panel-year-unknown")) &&
      meta.date
    ) {
      entry.year = `${meta.date}`.slice(0, 4);
    }
    const fallbackYear =
      entry.year && entry.year !== getString("references-panel-year-unknown")
        ? entry.year
        : undefined;
    // Extract arXiv details from metadata if not already present
    if (!entry.arxivDetails && meta.arxiv_eprints) {
      const arxiv = extractArxivFromMetadata(meta);
      if (arxiv) {
        entry.arxivDetails = arxiv;
      }
    }
    const { primary: publicationInfo, errata } = splitPublicationInfo(
      meta.publication_info,
    );
    entry.publicationInfo = publicationInfo ?? entry.publicationInfo;
    entry.publicationInfoErrata = errata;
    if (entry.publicationInfo || entry.arxivDetails || errata?.length) {
      entry.summary = buildPublicationSummary(
        entry.publicationInfo,
        entry.arxivDetails,
        fallbackYear,
        entry.publicationInfoErrata,
      );
    }
    entry.displayText = buildDisplayText(entry);
    // Invalidate searchText so it will be recalculated on next filter
    entry.searchText = "";
    if (typeof meta.citation_count === "number") {
      entry.citationCount = meta.citation_count;
    }
    const metaSelfCitations =
      typeof meta.citation_count_without_self_citations === "number"
        ? meta.citation_count_without_self_citations
        : typeof meta.citation_count_wo_self_citations === "number"
          ? meta.citation_count_wo_self_citations
          : undefined;
    if (typeof metaSelfCitations === "number") {
      entry.citationCountWithoutSelf = metaSelfCitations;
    }
    if (typeof meta.abstractNote === "string" && meta.abstractNote.trim()) {
      entry.abstract = meta.abstractNote.trim();
    }
  }

  /**
   * Apply metadata returned from INSPIRE search hits (used in batch enrichment).
   */

  private updateEntryAuthorCount(
    entry: InspireReferenceEntry,
    authorCount?: number,
  ) {
    if (typeof authorCount !== "number") {
      return;
    }
    entry.totalAuthors = authorCount;
    if (entry.authors.length) {
      entry.authorText = formatAuthors(entry.authors, authorCount);
    }
  }

  private buildEntryFromSearch(hit: any, index: number): InspireReferenceEntry {
    const metadata = hit?.metadata ?? {};
    const { primary: publicationInfo, errata } = splitPublicationInfo(
      metadata.publication_info,
    );
    const rawTitle = metadata?.titles?.[0]?.title;

    // Only extract needed authors for performance (large collaborations have thousands)
    const rawAuthors = metadata.authors;
    const { names: authors, total: totalAuthors } = extractAuthorNamesLimited(
      rawAuthors,
      AUTHOR_IDS_EXTRACT_LIMIT,
    );
    // Extract author search info (fullName + recid) for precise author search
    const authorSearchInfos = extractAuthorSearchInfos(
      rawAuthors,
      AUTHOR_IDS_EXTRACT_LIMIT,
    );

    const recidSource =
      metadata.control_number ?? hit?.id ?? `${performance.now()}-${index}`;
    const recid = recidSource ? String(recidSource) : undefined;
    const year =
      (publicationInfo?.year && `${publicationInfo.year}`) ||
      (metadata.earliest_date
        ? `${metadata.earliest_date}`.slice(0, 4)
        : getString("references-panel-year-unknown"));

    const arxiv = extractArxivFromMetadata(metadata);
    const summary = buildPublicationSummary(
      publicationInfo,
      arxiv,
      year,
      errata,
    );
    // Extract primary DOI from metadata
    const doi =
      Array.isArray(metadata?.dois) && metadata.dois.length
        ? typeof metadata.dois[0] === "string"
          ? metadata.dois[0]
          : metadata.dois[0]?.value
        : undefined;
    const entry: InspireReferenceEntry = {
      id: `cited-${index}-${recid ?? Date.now()}`,
      recid,
      inspireUrl: recid ? `${INSPIRE_LITERATURE_URL}/${recid}` : undefined,
      fallbackUrl: buildFallbackUrlFromMetadata(metadata, arxiv),
      title: cleanMathTitle(rawTitle) || getString("references-panel-no-title"),
      summary,
      year,
      authors,
      totalAuthors,
      authorSearchInfos,
      authorText: formatAuthors(authors, totalAuthors),
      displayText: "",
      searchText: "",
      citationCount:
        typeof metadata.citation_count === "number"
          ? metadata.citation_count
          : undefined,
      citationCountWithoutSelf:
        typeof metadata.citation_count_without_self_citations === "number"
          ? metadata.citation_count_without_self_citations
          : undefined,
      publicationInfo,
      publicationInfoErrata: errata,
      arxivDetails: arxiv,
      doi,
    };
    entry.displayText = buildDisplayText(entry);
    // Defer searchText calculation to first filter for better initial load performance
    // entry.searchText will be lazily computed in ensureSearchText()
    entry.searchText = "";
    return entry;
  }

  /**
   * Apply all active filters to entries (text filter, chart filter, author filter).
   * This is used by both renderReferenceList and doRenderChart for consistency.
   * Ensures chart stats always match the filtered list view.
   */
  private getFilteredEntries(
    entries: InspireReferenceEntry[],
    options: { skipChartFilter?: boolean } = {},
  ): InspireReferenceEntry[] {
    const { skipChartFilter = false } = options;

    // Parse and apply text filter
    const filterGroups = parseFilterTokens(this.filterText)
      .map(({ text, quoted }) =>
        buildFilterTokenVariants(text, { ignoreSpaceDot: quoted }),
      )
      .filter((variants) => variants.length);

    const textFiltered = filterGroups.length
      ? entries.filter((entry) =>
          filterGroups.every((variants) =>
            variants.some((token) => ensureSearchText(entry).includes(token)),
          ),
        )
      : entries;

    // Apply chart filter (AND logic with text filter)
    const shouldApplyChartFilter =
      this.chartSelectedBins.size > 0 && !skipChartFilter;
    const chartFiltered = shouldApplyChartFilter
      ? textFiltered.filter((entry) => this.matchesChartFilter(entry))
      : textFiltered;

    // Apply author count filter (AND logic with previous filters)
    const authorFiltered = this.authorFilterEnabled
      ? chartFiltered.filter((entry) => this.matchesAuthorFilter(entry))
      : chartFiltered;

    // Apply published only filter (AND logic with previous filters)
    const publishedFiltered = this.publishedOnlyFilterEnabled
      ? authorFiltered.filter((entry) => this.matchesPublishedOnlyFilter(entry))
      : authorFiltered;

    // Apply quick filters (high citations, recency, etc.)
    return this.applyQuickFilters(publishedFiltered);
  }

  private renderReferenceList(
    options: { preserveScroll?: boolean; resetPagination?: boolean } = {},
  ) {
    const { preserveScroll = false, resetPagination = true } = options;
    this.updateChartClearButton();

    // Save list scroll position for potential restoration
    const previousScrollTop = preserveScroll ? this.listEl.scrollTop : 0;
    const previousScrollLeft = preserveScroll ? this.listEl.scrollLeft : 0;

    // Find and save the item pane scroll container position
    // This prevents the item pane from jumping when list content height changes
    const itemPaneContainer = this.body.closest(
      ".item-pane-content",
    ) as HTMLElement | null;
    const itemPaneScrollTop = itemPaneContainer?.scrollTop ?? 0;
    const itemPaneScrollLeft = itemPaneContainer?.scrollLeft ?? 0;

    const restoreScroll = () => {
      // Restore list scroll
      if (preserveScroll) {
        this.listEl.scrollTop = previousScrollTop;
        this.listEl.scrollLeft = previousScrollLeft;
      } else {
        this.listEl.scrollTop = 0;
        this.listEl.scrollLeft = 0;
      }
      // Always restore item pane position to prevent jump
      if (itemPaneContainer) {
        itemPaneContainer.scrollTop = itemPaneScrollTop;
        itemPaneContainer.scrollLeft = itemPaneScrollLeft;
      }
    };

    // References mode doesn't use totalApiCount - ensure it's always null
    // This prevents any leftover value from affecting the display
    if (this.viewMode === "references") {
      this.totalApiCount = null;
    }

    // Reset pagination state if needed
    if (resetPagination) {
      this.renderedCount = 0;
    }

    // Clear infinite scroll state
    this.cleanupInfiniteScroll();

    // Recycle existing rows to pool before clearing
    this.recycleRowsToPool();
    // PERF FIX: Async removal of old container to avoid blocking UI
    this.cleanupEventDelegation();
    const doc = this.listEl.ownerDocument;
    const oldListEl = this.listEl;
    const newListEl = doc.createElement("div");
    newListEl.className = oldListEl.className;
    if (oldListEl.id) newListEl.id = oldListEl.id;
    // FTR-KEYBOARD-NAV-FULL: Make list focusable for keyboard navigation
    newListEl.tabIndex = -1;
    newListEl.style.outline = "none";
    // Hide old container immediately
    oldListEl.style.display = "none";
    // Insert new container after old one
    oldListEl.parentNode?.insertBefore(newListEl, oldListEl.nextSibling);
    this.listEl = newListEl;
    this.setupEventDelegation();
    // Remove old container asynchronously
    setTimeout(() => {
      oldListEl.remove();
    }, 0);
    this.rowCache.clear();
    this.loadMoreButton = undefined;

    if (!this.allEntries.length) {
      this.renderMessage(this.getEmptyMessageForMode(this.viewMode));
      restoreScroll();
      return;
    }

    // Apply all active filters using shared filtering logic
    const filtered = this.getFilteredEntries(this.allEntries);

    // Parse filter tokens for UI feedback (to show filter count message)
    const filterGroups = parseFilterTokens(this.filterText)
      .map(({ text, quoted }) =>
        buildFilterTokenVariants(text, { ignoreSpaceDot: quoted }),
      )
      .filter((variants) => variants.length);

    if (!filtered.length) {
      this.renderMessage(getString("references-panel-no-match"));
    } else {
      // Enable pagination for ALL modes when there are many entries
      // This improves perceived performance for references with 100+ entries
      // PERF FIX: Always use pagination when there are many entries, even with filters
      // Without this, DOM operations (clearing 10000+ elements) can take seconds
      // Use higher threshold when filtering for better UX with smaller result sets
      const hasFilter =
        filterGroups.length > 0 ||
        this.chartSelectedBins.size > 0 ||
        this.authorFilterEnabled ||
        this.publishedOnlyFilterEnabled ||
        this.quickFilters.size > 0;
      const paginationThreshold = hasFilter
        ? RENDER_PAGE_SIZE_FILTERED
        : RENDER_PAGE_SIZE;
      const usePagination = filtered.length > paginationThreshold;
      const entriesToRender = usePagination
        ? filtered.slice(0, paginationThreshold)
        : filtered;

      const fragment = this.listEl.ownerDocument.createDocumentFragment();
      for (const entry of entriesToRender) {
        fragment.appendChild(this.createReferenceRow(entry));
      }
      this.listEl.appendChild(fragment);
      this.renderedCount = entriesToRender.length;

      // Add "Load More" button with infinite scroll if there are more entries
      if (usePagination && filtered.length > this.renderedCount) {
        // Store filtered entries and batch size for infinite scroll
        this.currentFilteredEntries = filtered;
        this.currentPaginationBatchSize = paginationThreshold;
        this.renderLoadMoreButton(filtered, paginationThreshold);
      } else {
        this.currentFilteredEntries = undefined;
      }
    }
    this.lastRenderedEntries = filtered;

    // Use API total count for citedBy/entryCited modes if available
    // This shows the correct total even when we haven't fetched all entries
    const displayTotal =
      this.viewMode !== "references" && this.totalApiCount !== null
        ? this.totalApiCount
        : this.allEntries.length;
    const fetchedCount = this.allEntries.length;

    // Check if any filter is active (text, chart, author, or published only)
    const anyFilterActive =
      filterGroups.length > 0 ||
      this.chartSelectedBins.size > 0 ||
      this.authorFilterEnabled ||
      this.publishedOnlyFilterEnabled ||
      this.quickFilters.size > 0;

    if (anyFilterActive) {
      // For filter mode, show matches and indicate if searching in partial data
      const isPartialData =
        this.viewMode !== "references" &&
        this.totalApiCount !== null &&
        fetchedCount < this.totalApiCount;

      if (isPartialData) {
        // Show "X matches in Y loaded (Z total)" for partial data
        this.setStatus(
          this.getFilterCountMessageForMode(
            this.viewMode,
            filtered.length,
            fetchedCount, // Show loaded count, not API total
          ) + ` / ${displayTotal}`,
        );
      } else {
        this.setStatus(
          this.getFilterCountMessageForMode(
            this.viewMode,
            filtered.length,
            displayTotal,
          ),
        );
      }
    } else {
      // Show both fetched and total if they differ
      if (displayTotal > fetchedCount && fetchedCount < CITED_BY_MAX_RESULTS) {
        // Still loading or hit a limit before fetching all
        this.setStatus(
          this.getCountMessageForMode(this.viewMode, displayTotal) +
            ` (${fetchedCount} loaded)`,
        );
      } else if (displayTotal > fetchedCount) {
        // Hit the max results limit
        this.setStatus(
          this.getCountMessageForMode(this.viewMode, displayTotal) +
            ` (showing ${fetchedCount})`,
        );
      } else {
        this.setStatus(
          this.getCountMessageForMode(this.viewMode, displayTotal),
        );
      }
    }
    restoreScroll();

    // FTR-KEYBOARD-NAV-FULL: Restore DOM focus to listEl if there's a focused entry
    // This is needed because rendering replaces listEl, losing the DOM focus
    if (this.focusedEntryID) {
      this.listEl.focus({ preventScroll: true });
    }
  }

  /**
   * Clean up infinite scroll observer and related state.
   */
  private cleanupInfiniteScroll() {
    if (this.loadMoreObserver) {
      this.loadMoreObserver.disconnect();
      this.loadMoreObserver = undefined;
    }
    this.loadMoreContainer = undefined;
  }

  /**
   * Render "Load More" button for paginated lists with infinite scroll support.
   * - Uses IntersectionObserver to auto-load when button becomes visible
   * - Falls back to manual click if observer not supported
   */
  private renderLoadMoreButton(
    allFiltered: InspireReferenceEntry[],
    batchSize: number = RENDER_PAGE_SIZE,
  ) {
    const doc = this.listEl.ownerDocument;
    const remaining = allFiltered.length - this.renderedCount;
    const nextBatch = Math.min(remaining, batchSize);

    const container = doc.createElement("div");
    container.classList.add("zinspire-load-more-container");
    container.style.cssText = `
      display: flex;
      justify-content: center;
      padding: 12px;
      border-top: 1px solid var(--fill-tertiary, #e0e0e0);
    `;

    const button = doc.createElement("button");
    button.classList.add("zinspire-load-more-button");
    button.textContent = `Load ${nextBatch} more (${remaining} remaining)`;
    button.style.cssText = `
      padding: 8px 16px;
      border: 1px solid var(--fill-tertiary, #ccc);
      border-radius: 4px;
      background: var(--material-background, #f5f5f5);
      cursor: pointer;
      font-size: 13px;
    `;
    button.addEventListener("click", () => {
      this.loadMoreEntriesInfinite();
    });

    container.appendChild(button);
    this.listEl.appendChild(container);
    this.loadMoreButton = button;
    this.loadMoreContainer = container;

    // Set up IntersectionObserver for infinite scroll
    this.setupInfiniteScrollObserver(container);
  }

  /**
   * Set up IntersectionObserver to auto-load more entries when the
   * load-more container becomes visible (scrolls into view).
   */
  private setupInfiniteScrollObserver(container: HTMLDivElement) {
    // Clean up existing observer
    if (this.loadMoreObserver) {
      this.loadMoreObserver.disconnect();
    }

    // Check if IntersectionObserver is available (should be in modern browsers)
    const win = this.listEl.ownerDocument.defaultView;
    if (!win || typeof win.IntersectionObserver !== "function") {
      return; // Fall back to manual click
    }

    // Create observer with rootMargin to trigger slightly before container is visible
    // This provides smoother infinite scroll experience
    this.loadMoreObserver = new win.IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Auto-load more entries when container is visible
            this.loadMoreEntriesInfinite();
            break;
          }
        }
      },
      {
        root: this.listEl, // Observe within the scroll container
        rootMargin: "200px", // Trigger 200px before container is visible
        threshold: 0,
      },
    );

    this.loadMoreObserver.observe(container);
  }

  /**
   * Load more entries (next page) into the list.
   * Used by both manual click and infinite scroll observer.
   */
  private loadMoreEntriesInfinite() {
    const allFiltered = this.currentFilteredEntries;
    if (!allFiltered || this.renderedCount >= allFiltered.length) {
      return;
    }

    // Clean up current infinite scroll state
    this.cleanupInfiniteScroll();

    // Remove load more button/container
    if (this.loadMoreButton?.parentElement) {
      this.loadMoreButton.parentElement.remove();
    }
    this.loadMoreButton = undefined;

    // Calculate next batch using the stored batch size
    const batchSize = this.currentPaginationBatchSize || RENDER_PAGE_SIZE;
    const startIndex = this.renderedCount;
    const endIndex = Math.min(startIndex + batchSize, allFiltered.length);
    const nextBatch = allFiltered.slice(startIndex, endIndex);

    // Render next batch
    const fragment = this.listEl.ownerDocument.createDocumentFragment();
    for (const entry of nextBatch) {
      fragment.appendChild(this.createReferenceRow(entry));
    }
    this.listEl.appendChild(fragment);
    this.renderedCount = endIndex;

    // Add new "Load More" button with infinite scroll if there are still more entries
    if (allFiltered.length > this.renderedCount) {
      this.renderLoadMoreButton(allFiltered, batchSize);
    } else {
      // All entries rendered, clear filtered entries reference
      this.currentFilteredEntries = undefined;
    }
  }

  /**
   * Incrementally append new entries to the list without full re-render.
   * Used during progressive loading to avoid re-rendering the entire list.
   * Only appends entries from previousCount to current allEntries.length.
   *
   * @param previousCount Number of entries already rendered
   * @returns Number of newly appended entries
   */
  private appendNewEntries(previousCount: number): number {
    // Skip if filtering is active (need full re-render to apply filter)
    if (this.filterText || this.chartSelectedBins.size > 0) {
      return 0;
    }

    const newEntries = this.allEntries.slice(previousCount);
    if (!newEntries.length) {
      return 0;
    }

    // Check if we need pagination
    const currentRendered = this.renderedCount;
    const maxToRender = RENDER_PAGE_SIZE;

    // If we haven't rendered first page yet, skip (will be handled by full render)
    if (currentRendered === 0) {
      return 0;
    }

    // Calculate how many more we can render before needing "Load More"
    const entriesAlreadyInDom = currentRendered;
    const totalAvailable = this.allEntries.length;

    // If pagination is active and we've rendered the first page,
    // don't auto-append more entries (let infinite scroll handle it)
    if (totalAvailable > maxToRender && entriesAlreadyInDom >= maxToRender) {
      // Just update the "Load More" button text if it exists
      if (this.loadMoreButton) {
        this.currentFilteredEntries = this.allEntries;
        const remaining = totalAvailable - entriesAlreadyInDom;
        const nextBatch = Math.min(remaining, RENDER_PAGE_SIZE);
        this.loadMoreButton.textContent = `Load ${nextBatch} more (${remaining} remaining)`;
      }
      return 0;
    }

    // Append new entries up to page limit
    const entriesToAppend = newEntries.slice(
      0,
      maxToRender - entriesAlreadyInDom,
    );
    if (!entriesToAppend.length) {
      return 0;
    }

    const fragment = this.listEl.ownerDocument.createDocumentFragment();
    for (const entry of entriesToAppend) {
      fragment.appendChild(this.createReferenceRow(entry));
    }

    // Insert before load-more container if it exists, otherwise append
    if (
      this.loadMoreContainer &&
      this.loadMoreContainer.parentElement === this.listEl
    ) {
      this.listEl.insertBefore(fragment, this.loadMoreContainer);
    } else {
      this.listEl.appendChild(fragment);
    }

    this.renderedCount += entriesToAppend.length;

    // Add/update "Load More" if needed
    if (totalAvailable > this.renderedCount) {
      this.currentFilteredEntries = this.allEntries;
      if (!this.loadMoreContainer) {
        this.renderLoadMoreButton(this.allEntries);
      } else {
        const remaining = totalAvailable - this.renderedCount;
        const nextBatch = Math.min(remaining, RENDER_PAGE_SIZE);
        if (this.loadMoreButton) {
          this.loadMoreButton.textContent = `Load ${nextBatch} more (${remaining} remaining)`;
        }
      }
    }

    return entriesToAppend.length;
  }

  private getCacheForMode(mode: InspireViewMode) {
    if (mode === "references") {
      return this.referencesCache;
    }
    if (mode === "citedBy") {
      return this.citedByCache;
    }
    if (mode === "search") {
      return this.searchCache;
    }
    return this.entryCitedCache;
  }

  private getLoadingMessageForMode(mode: InspireViewMode) {
    if (mode === "references") {
      return getString("references-panel-status-loading");
    }
    if (mode === "citedBy") {
      return getString("references-panel-status-loading-cited");
    }
    if (mode === "search") {
      return getString("references-panel-status-loading-search");
    }
    // For entryCited mode, show different message based on source type
    if (this.entryCitedSource?.authorQuery) {
      return getString("references-panel-status-loading-author");
    }
    return getString("references-panel-status-loading-entry");
  }

  private getEmptyMessageForMode(mode: InspireViewMode) {
    if (mode === "references") {
      return getString("references-panel-empty-list");
    }
    if (mode === "citedBy") {
      return getString("references-panel-empty-cited");
    }
    if (mode === "search") {
      return getString("references-panel-search-empty");
    }
    // For entryCited mode, show different message based on source type
    if (this.entryCitedSource?.authorQuery) {
      return getString("references-panel-author-empty");
    }
    return getString("references-panel-entry-empty");
  }

  private getCountMessageForMode(mode: InspireViewMode, count: number) {
    if (mode === "references") {
      return getString("references-panel-count", { args: { count } });
    }
    if (mode === "citedBy") {
      return getString("references-panel-count-cited", { args: { count } });
    }
    if (mode === "search") {
      return getString("references-panel-count-search", {
        args: { count, query: this.getSearchLabel() },
      });
    }
    // For entryCited mode, show different message based on source type
    if (this.entryCitedSource?.authorQuery) {
      return getString("references-panel-count-author", {
        args: { count, label: this.getEntryCitedLabel() },
      });
    }
    return getString("references-panel-count-entry", {
      args: { count, label: this.getEntryCitedLabel() },
    });
  }

  private getFilterCountMessageForMode(
    mode: InspireViewMode,
    visible: number,
    total: number,
  ) {
    if (mode === "references") {
      return getString("references-panel-filter-count", {
        args: { visible, total },
      });
    }
    if (mode === "citedBy") {
      return getString("references-panel-filter-count-cited", {
        args: { visible, total },
      });
    }
    if (mode === "search") {
      return getString("references-panel-filter-count-search", {
        args: { visible, total, query: this.getSearchLabel() },
      });
    }
    // For entryCited mode, show different message based on source type
    if (this.entryCitedSource?.authorQuery) {
      return getString("references-panel-filter-count-author", {
        args: { visible, total, label: this.getEntryCitedLabel() },
      });
    }
    return getString("references-panel-filter-count-entry", {
      args: { visible, total, label: this.getEntryCitedLabel() },
    });
  }

  private getEntryCitedLabel() {
    return (
      this.entryCitedSource?.label ||
      getString("references-panel-entry-label-default")
    );
  }

  private getSearchLabel() {
    return (
      this.currentSearchQuery ||
      getString("references-panel-search-label-default")
    );
  }

  private createTabButton(
    container: HTMLDivElement,
    mode: InspireViewMode,
  ): HTMLButtonElement {
    const button = ztoolkit.UI.appendElement(
      {
        tag: "button",
        classList: ["zinspire-ref-panel__tab"],
        properties: { textContent: this.getTabLabel(mode) },
        attributes: {
          type: "button",
          "data-mode": mode,
        },
      },
      container,
    ) as HTMLButtonElement;

    // Apply initial inline styles for pill button tabs
    button.style.cssText = `
      padding: 4px 12px;
      font-size: 12px;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
      background-color: var(--material-background, #fff);
      color: var(--fill-secondary, #64748b);
      font-weight: 400;
      border: 1px solid var(--fill-quinary, #d1d5db);
    `;

    // Add hover effect
    button.addEventListener("mouseenter", () => {
      if (button.getAttribute("data-active") !== "true") {
        button.style.borderColor = "#94a3b8";
        button.style.color = "var(--fill-primary, #334155)";
      }
    });
    button.addEventListener("mouseleave", () => {
      if (button.getAttribute("data-active") !== "true") {
        button.style.borderColor = "var(--fill-quinary, #d1d5db)";
        button.style.color = "var(--fill-secondary, #64748b)";
      }
    });

    button.addEventListener("click", () => {
      this.activateViewMode(mode).catch(() => void 0);
    });
    return button;
  }

  private async activateViewMode(mode: InspireViewMode) {
    if (this.viewMode === mode) {
      if (mode !== "entryCited" && mode !== "search") {
        return;
      }
    }
    if (mode === "entryCited" && this.viewMode !== "entryCited") {
      if (
        this.viewMode === "references" ||
        this.viewMode === "citedBy" ||
        this.viewMode === "search"
      ) {
        this.entryCitedPreviousMode = this.viewMode;
      }
    }

    // FTR-FOCUSED-SELECTION: Clear focus when switching tabs
    this.clearFocusedEntry();

    this.viewMode = mode;
    this.updateTabSelection();
    this.updateSearchUIVisibility();
    this.updateAuthorProfileCard();
    this.hideAuthorPreviewCard();

    // For search mode, use current search query
    if (mode === "search") {
      if (!this.currentSearchQuery) {
        // Clear chart and show prompt message
        this.allEntries = [];
        this.chartSelectedBins.clear();
        this.cachedChartStats = undefined;
        this.chartNeedsRefresh = true;
        this.chartNeedsRefresh = true;
        this.lastRenderedEntries = [];
        this.chartNeedsRefresh = true;
        this.clearChartStatsDisplay();
        this.renderChart();
        this.renderMessage(getString("references-panel-search-prompt"));
        return;
      }
      const cacheKey = this.getCacheKey(
        this.currentSearchQuery,
        "search",
        this.searchSort,
      );
      const cached = this.searchCache.get(cacheKey);
      if (cached) {
        this.allEntries = cached;
        this.totalApiCount = null;
        this.chartSelectedBins.clear();
        this.cachedChartStats = undefined;
        this.renderChartImmediate(); // Use immediate render for cache hit
        this.renderReferenceList({ preserveScroll: false });
        return;
      }
      await this.loadSearchResults(this.currentSearchQuery).catch((err) => {
        if ((err as any)?.name !== "AbortError") {
          Zotero.debug(
            `[${config.addonName}] Failed to load search results: ${err}`,
          );
          this.allEntries = [];
          this.renderChartImmediate();
          this.renderMessage(getString("references-panel-status-error"));
        }
      });
      return;
    }

    // For entryCited mode, support both recid and authorQuery
    const targetKey =
      mode === "entryCited"
        ? this.entryCitedSource?.recid || this.entryCitedSource?.authorQuery
        : this.currentRecid;
    if (!targetKey) {
      const message =
        mode === "entryCited"
          ? getString("references-panel-entry-select")
          : getString("references-panel-status-empty");
      this.allEntries = [];
      this.renderChartImmediate();
      this.renderMessage(message);
      return;
    }
    const cache = this.getCacheForMode(mode);
    const cacheKey = this.getCacheKey(
      targetKey,
      mode,
      this.getSortOptionForMode(mode),
    );
    const cached = cache.get(cacheKey);
    const shouldResetEntry =
      mode === "entryCited" && this.pendingEntryScrollReset;
    if (cached) {
      const entriesForDisplay =
        mode === "references" ? this.getSortedReferences(cached) : cached;
      this.allEntries = entriesForDisplay;
      if (mode === "entryCited" && this.entryCitedSource?.authorSearchInfo) {
        this.updateAuthorStats(entriesForDisplay);
        this.updateAuthorProfileCard();
      }
      // Reset totalApiCount for cached data (allEntries.length is accurate)
      this.totalApiCount = null;
      // Clear chart selection and render chart for new data
      this.chartSelectedBins.clear();
      this.cachedChartStats = undefined;
      this.lastRenderedEntries = [];
      this.chartNeedsRefresh = true;
      this.lastRenderedEntries = [];
      this.chartNeedsRefresh = true;
      this.renderChartImmediate(); // Use immediate render for cache hit
      this.renderReferenceList({
        preserveScroll: !shouldResetEntry,
      });
      if (shouldResetEntry) {
        this.resetListScroll();
      }
      this.pendingEntryScrollReset = false;
      return;
    }
    await this.loadEntries(targetKey, mode, {
      resetScroll: shouldResetEntry,
    }).catch((err) => {
      if ((err as any)?.name !== "AbortError") {
        Zotero.debug(
          `[${config.addonName}] Failed to load ${mode} list: ${err}`,
        );
        this.allEntries = [];
        this.renderChartImmediate();
        this.renderMessage(getString("references-panel-status-error"));
        this.lastRenderedEntries = [];
      }
    });
    if (shouldResetEntry) {
      this.pendingEntryScrollReset = false;
    }
  }

  private updateTabSelection() {
    if (!this.tabButtons) {
      return;
    }
    const hasEntrySource = Boolean(this.entryCitedSource);
    (
      Object.entries(this.tabButtons) as [InspireViewMode, HTMLButtonElement][]
    ).forEach(([mode, button]) => {
      if (mode === "entryCited") {
        button.hidden = !hasEntrySource;
        button.disabled = !hasEntrySource;
        // Update the tab label dynamically based on source type
        button.textContent = this.getTabLabel(mode);
      } else if (mode === "search") {
        // Search tab is always visible and enabled
        button.hidden = false;
        button.disabled = false;
        button.textContent = this.getTabLabel(mode);
      }
      const isActive = mode === this.viewMode;
      button.setAttribute("data-active", String(isActive));
      button.setAttribute("aria-pressed", String(isActive));
      applyTabButtonStyle(button, isActive);
    });
    this.updateEntryCitedControls();
    this.updateSortSelector();
  }

  private updateEntryCitedControls() {
    if (!this.entryViewBackButton) {
      return;
    }
    const isEntryMode = this.viewMode === "entryCited";
    this.entryViewBackButton.hidden = !isEntryMode;
    // Must also set display to override inline-flex from applyNavButtonStyle
    this.entryViewBackButton.style.display = isEntryMode
      ? "inline-flex"
      : "none";
    if (isEntryMode) {
      // Update tooltip with target tab name
      const previousTabLabel = this.getTabLabel(this.entryCitedPreviousMode);
      this.entryViewBackButton.title = getString(
        "references-panel-entry-back",
        {
          args: { tab: previousTabLabel },
        },
      );
    }
  }

  private getTabLabel(mode: InspireViewMode) {
    if (mode === "references") {
      return getString("references-panel-tab-references");
    }
    if (mode === "citedBy") {
      return getString("references-panel-tab-cited");
    }
    if (mode === "search") {
      return getString("references-panel-tab-search");
    }
    // For entryCited mode, show different tab name based on source type
    if (this.entryCitedSource?.authorQuery) {
      return getString("references-panel-tab-author-papers");
    }
    return getString("references-panel-tab-entry-cited");
  }

  private updateSortSelector() {
    if (!this.sortSelect) {
      return;
    }
    const options = this.getSortOptionsForMode(this.viewMode);
    this.sortSelect.textContent = "";
    for (const option of options) {
      const opt = this.sortSelect.ownerDocument.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      this.sortSelect.appendChild(opt);
    }
    const currentValue =
      this.viewMode === "references"
        ? this.referenceSort
        : this.viewMode === "citedBy"
          ? this.citedBySort
          : this.viewMode === "search"
            ? this.searchSort
            : this.entryCitedSort;
    this.sortSelect.value = currentValue;
    const hasTarget =
      this.viewMode === "entryCited"
        ? Boolean(
            this.entryCitedSource?.recid || this.entryCitedSource?.authorQuery,
          )
        : this.viewMode === "search"
          ? Boolean(this.currentSearchQuery)
          : Boolean(this.currentRecid);
    this.sortSelect.disabled = !hasTarget;
  }

  private getSortOptionsForMode(mode: InspireViewMode) {
    if (mode === "references") {
      return [
        {
          value: "default",
          label: getString("references-panel-sort-default"),
        },
        {
          value: "yearDesc",
          label: getString("references-panel-sort-mostrecent"),
        },
        {
          value: "citationDesc",
          label: getString("references-panel-sort-mostcited"),
        },
      ];
    }
    // citedBy, entryCited, and search all use the same sort options
    return [
      {
        value: "mostrecent",
        label: getString("references-panel-sort-mostrecent"),
      },
      {
        value: "mostcited",
        label: getString("references-panel-sort-mostcited"),
      },
    ];
  }

  private handleSortChange(rawValue: string) {
    if (this.viewMode === "references") {
      if (!this.currentRecid) {
        this.sortSelect.value = this.referenceSort;
        return;
      }
      if (!isReferenceSortOption(rawValue)) {
        this.sortSelect.value = this.referenceSort;
        return;
      }
      if (rawValue === this.referenceSort) {
        return;
      }
      this.referenceSort = rawValue;
      const cached = this.referencesCache.get(this.currentRecid);
      if (cached) {
        this.allEntries = this.getSortedReferences(cached);
        this.totalApiCount = null; // Reset for cached data
        this.renderReferenceList();
        return;
      }
      return;
    }
    if (this.viewMode === "citedBy") {
      if (!this.currentRecid) {
        this.sortSelect.value = this.citedBySort;
        return;
      }
      if (!isInspireSortOption(rawValue)) {
        this.sortSelect.value = this.citedBySort;
        return;
      }
      if (rawValue === this.citedBySort) {
        return;
      }
      this.citedBySort = rawValue;
      const cacheKey = this.getCacheKey(this.currentRecid, "citedBy", rawValue);
      const cached = this.citedByCache.get(cacheKey);
      if (cached) {
        this.allEntries = cached;
        this.totalApiCount = null; // Reset for cached data
        this.renderReferenceList();
        return;
      }
      this.loadEntries(this.currentRecid, "citedBy").catch((err) => {
        if ((err as any)?.name !== "AbortError") {
          Zotero.debug(
            `[${config.addonName}] Failed to sort cited-by list: ${err}`,
          );
        }
      });
      return;
    }
    if (this.viewMode === "search") {
      if (!this.currentSearchQuery) {
        this.sortSelect.value = this.searchSort;
        return;
      }
      if (!isInspireSortOption(rawValue)) {
        this.sortSelect.value = this.searchSort;
        return;
      }
      if (rawValue === this.searchSort) {
        return;
      }
      this.searchSort = rawValue;
      const cacheKey = this.getCacheKey(
        this.currentSearchQuery,
        "search",
        rawValue,
      );
      const cached = this.searchCache.get(cacheKey);
      if (cached) {
        this.allEntries = cached;
        this.totalApiCount = null;
        this.renderReferenceList();
        return;
      }
      this.loadSearchResults(this.currentSearchQuery).catch((err) => {
        if ((err as any)?.name !== "AbortError") {
          Zotero.debug(
            `[${config.addonName}] Failed to sort search results: ${err}`,
          );
        }
      });
      return;
    }
    // For entryCited mode, use either recid or authorQuery as the key
    const entryKey =
      this.entryCitedSource?.recid || this.entryCitedSource?.authorQuery;
    if (!entryKey) {
      this.sortSelect.value = this.entryCitedSort;
      return;
    }
    if (!isInspireSortOption(rawValue)) {
      this.sortSelect.value = this.entryCitedSort;
      return;
    }
    if (rawValue === this.entryCitedSort) {
      return;
    }
    this.entryCitedSort = rawValue;
    const cacheKey = this.getCacheKey(entryKey, "entryCited", rawValue);
    const cached = this.entryCitedCache.get(cacheKey);
    if (cached) {
      this.allEntries = cached;
      this.totalApiCount = null; // Reset for cached data
      this.renderReferenceList();
      return;
    }
    this.loadEntries(entryKey, "entryCited").catch((err) => {
      if ((err as any)?.name !== "AbortError") {
        Zotero.debug(
          `[${config.addonName}] Failed to sort entry cited-by list: ${err}`,
        );
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INSPIRE Search Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create the search input container UI.
   * Includes search input field and history dropdown.
   */
  private createSearchInputContainer(toolbar: HTMLDivElement) {
    const doc = this.body.ownerDocument;

    // Create container for search input and history
    this.searchInputContainer = doc.createElement("div");
    this.searchInputContainer.className = "zinspire-search-container";
    this.searchInputContainer.style.cssText = `
      display: none;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      flex: 1 1 auto;
      position: relative;
    `;

    // Create wrapper for input + inline hint positioning
    const inputWrapper = doc.createElement("div");
    inputWrapper.className = "zinspire-search-input-wrapper";
    inputWrapper.style.cssText =
      INLINE_HINT_WRAPPER_STYLE + `min-width: 150px;`;

    // Search input field - needs transparent background for hint to show through
    this.searchInput = doc.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.className = "zinspire-search-input";
    this.searchInput.placeholder = getString(
      "references-panel-search-placeholder",
    );
    configureInlineHintInput(this.searchInput);
    this.searchInput.style.cssText = INLINE_HINT_INPUT_STYLE;

    // Create inline hint helper for search input
    const searchInlineHint = new InlineHintHelper({
      input: this.searchInput,
      wrapper: inputWrapper,
      history: this.searchHistory,
      getHistory: () => this.searchHistory,
    });
    searchInlineHint.getElement().classList.add("zinspire-search-inline-hint");

    // Handle keyboard events
    this.searchInput.addEventListener("keydown", (event) => {
      Zotero.debug(
        `[${config.addonName}] Panel search input keydown: key=${event.key}`,
      );

      // Tab or ArrowRight at end of input: accept inline hint
      if (
        (event.key === "Tab" || event.key === "ArrowRight") &&
        searchInlineHint.currentHintText
      ) {
        const cursorAtEnd =
          this.searchInput?.selectionStart === this.searchInput?.value.length;
        if (cursorAtEnd && searchInlineHint.accept()) {
          event.preventDefault();
          return;
        }
      }

      // Escape: hide inline hint
      if (event.key === "Escape") {
        searchInlineHint.hide();
        this.hideSearchHistoryDropdown();
      }

      // Enter: execute search
      if (event.key === "Enter") {
        event.preventDefault();
        searchInlineHint.hide();
        const query = this.searchInput?.value.trim();
        Zotero.debug(
          `[${config.addonName}] Panel search Enter pressed, query="${query}"`,
        );
        if (query) {
          this.executeInspireSearch(query).catch((err) => {
            Zotero.debug(`[${config.addonName}] Panel search error: ${err}`);
          });
        }
      }

      // ArrowDown: show history dropdown
      if (event.key === "ArrowDown" && this.searchHistoryDropdown) {
        event.preventDefault();
        this.showSearchHistoryDropdown();
      }
    });

    // Update hint on input
    this.searchInput.addEventListener("input", () => {
      searchInlineHint.update();
      // Hide dropdown when user is typing (inline hint is shown instead)
      this.hideSearchHistoryDropdown();
    });

    // Focus: just update hint, don't show dropdown automatically
    this.searchInput.addEventListener("focus", () => {
      Zotero.debug(
        `[${config.addonName}] Panel search input focused, history count: ${this.searchHistory.length}`,
      );
      searchInlineHint.update();
      // Don't auto-show dropdown - user can click ▼ button or press ArrowDown
    });

    // Blur: hide hint
    this.searchInput.addEventListener("blur", () => {
      // Delay to allow click on hint/dropdown
      setTimeout(() => {
        searchInlineHint.hide();
      }, 150);
    });

    inputWrapper.appendChild(this.searchInput);

    // Create search button
    const searchButton = doc.createElement("button");
    searchButton.type = "button";
    searchButton.className = "zinspire-search-button";
    searchButton.textContent = "🔍";
    searchButton.title = getString("references-panel-search-button-tooltip");
    searchButton.style.cssText = `
      border: 1px solid var(--zotero-gray-4, #d1d1d5);
      border-radius: 4px;
      padding: 4px 8px;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
    `;
    searchButton.addEventListener("click", () => {
      const query = this.searchInput?.value.trim();
      Zotero.debug(
        `[${config.addonName}] Panel search button clicked, query="${query}"`,
      );
      if (query) {
        this.executeInspireSearch(query).catch((err) => {
          Zotero.debug(
            `[${config.addonName}] Panel search button error: ${err}`,
          );
        });
      }
    });

    // Create history dropdown button
    const historyButton = doc.createElement("button");
    historyButton.type = "button";
    historyButton.className = "zinspire-history-button";
    historyButton.textContent = "▼";
    historyButton.title = getString("references-panel-search-history-tooltip");
    historyButton.style.cssText = `
      border: 1px solid var(--zotero-gray-4, #d1d1d5);
      border-radius: 4px;
      padding: 4px 6px;
      background: transparent;
      cursor: pointer;
      font-size: 10px;
    `;
    historyButton.addEventListener("click", () => {
      this.toggleSearchHistoryDropdown();
    });

    // Create history dropdown container
    this.searchHistoryDropdown = doc.createElement("div");
    this.searchHistoryDropdown.className = "zinspire-search-history-dropdown";
    this.searchHistoryDropdown.style.cssText = `
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: var(--zotero-gray-1, #ffffff);
      border: 1px solid var(--zotero-gray-4, #d1d1d5);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      z-index: 1000;
      margin-top: 2px;
    `;

    // Close dropdown when clicking outside
    doc.addEventListener("click", (event) => {
      if (
        this.searchHistoryDropdown &&
        !this.searchInputContainer?.contains(event.target as Node)
      ) {
        this.hideSearchHistoryDropdown();
      }
    });

    this.searchInputContainer.appendChild(inputWrapper);
    this.searchInputContainer.appendChild(searchButton);
    this.searchInputContainer.appendChild(historyButton);
    this.searchInputContainer.appendChild(this.searchHistoryDropdown);
    toolbar.appendChild(this.searchInputContainer);
    Zotero.debug(
      `[${config.addonName}] createSearchInputContainer: completed, container added to toolbar`,
    );
  }

  /**
   * Show or hide the search UI based on current view mode.
   */
  private updateSearchUIVisibility() {
    Zotero.debug(
      `[${config.addonName}] updateSearchUIVisibility: viewMode=${this.viewMode}, searchInputContainer=${!!this.searchInputContainer}`,
    );
    if (!this.searchInputContainer) {
      Zotero.debug(
        `[${config.addonName}] updateSearchUIVisibility: WARNING - searchInputContainer is null`,
      );
      return;
    }

    const isSearchMode = this.viewMode === "search";
    this.searchInputContainer.style.display = isSearchMode ? "flex" : "none";
    Zotero.debug(
      `[${config.addonName}] updateSearchUIVisibility: set searchInputContainer.display="${isSearchMode ? "flex" : "none"}"`,
    );

    // Keep filter input visible in search mode for local filtering of search results
    // Users can use INSPIRE search to get broad results, then use filter to refine locally
  }

  /**
   * Show the search history dropdown.
   */
  private showSearchHistoryDropdown() {
    if (!this.searchHistoryDropdown || this.searchHistory.length === 0) return;

    const doc = this.body.ownerDocument;
    // PERF-FIX-15: Use replaceChildren() instead of innerHTML
    this.searchHistoryDropdown.replaceChildren();

    for (const historyItem of this.searchHistory) {
      const query = historyItem.query;
      const item = doc.createElement("div");
      item.className = "zinspire-search-history-item";
      item.textContent = query;
      item.style.cssText = `
        padding: 6px 10px;
        cursor: pointer;
        font-size: 12px;
        border-bottom: 1px solid var(--zotero-gray-3, #e6e6e6);
      `;
      item.addEventListener("mouseenter", () => {
        item.style.backgroundColor = "var(--zotero-gray-2, #f0f0f0)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.backgroundColor = "";
      });
      item.addEventListener("click", () => {
        if (this.searchInput) {
          this.searchInput.value = query;
        }
        this.hideSearchHistoryDropdown();
        this.executeInspireSearch(query).catch(() => void 0);
      });
      this.searchHistoryDropdown.appendChild(item);
    }

    // Add clear history option
    const clearItem = doc.createElement("div");
    clearItem.className = "zinspire-search-history-clear";
    clearItem.textContent = getString("references-panel-search-clear-history");
    clearItem.style.cssText = `
      padding: 6px 10px;
      cursor: pointer;
      font-size: 11px;
      color: var(--zotero-gray-6, #666666);
      text-align: center;
      font-style: italic;
    `;
    clearItem.addEventListener("mouseenter", () => {
      clearItem.style.backgroundColor = "var(--zotero-gray-2, #f0f0f0)";
    });
    clearItem.addEventListener("mouseleave", () => {
      clearItem.style.backgroundColor = "";
    });
    clearItem.addEventListener("click", () => {
      this.clearSearchHistory();
      this.hideSearchHistoryDropdown();
    });
    this.searchHistoryDropdown.appendChild(clearItem);

    this.searchHistoryDropdown.style.display = "block";
  }

  /**
   * Hide the search history dropdown.
   */
  private hideSearchHistoryDropdown() {
    if (this.searchHistoryDropdown) {
      this.searchHistoryDropdown.style.display = "none";
    }
  }

  /**
   * Toggle the search history dropdown visibility.
   */
  private toggleSearchHistoryDropdown() {
    if (!this.searchHistoryDropdown) return;
    if (this.searchHistoryDropdown.style.display === "none") {
      this.showSearchHistoryDropdown();
    } else {
      this.hideSearchHistoryDropdown();
    }
  }

  /**
   * Load search history from preferences.
   */
  private loadSearchHistory() {
    try {
      const stored = Zotero.Prefs.get(
        `${config.addonRef}.${SEARCH_HISTORY_PREF_KEY}`,
        true,
      ) as string | undefined;
      if (stored) {
        const parsed = JSON.parse(stored);
        // Migrate old format (string[]) to new format (SearchHistoryItem[])
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          typeof parsed[0] === "string"
        ) {
          this.searchHistory = (parsed as unknown as string[]).map((q) => ({
            query: q,
            timestamp: Date.now(),
          }));
          this.saveSearchHistory(); // Save in new format
        } else {
          this.searchHistory = parsed as SearchHistoryItem[];
        }
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to load search history: ${err}`,
      );
      this.searchHistory = [];
    }
  }

  /**
   * Save search history to preferences.
   */
  private saveSearchHistory() {
    try {
      Zotero.Prefs.set(
        `${config.addonRef}.${SEARCH_HISTORY_PREF_KEY}`,
        JSON.stringify(this.searchHistory),
        true,
      );
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to save search history: ${err}`,
      );
    }
  }

  /**
   * Add a query to search history.
   */
  private addToSearchHistory(query: string) {
    // Remove if already exists (to move to top)
    const index = this.searchHistory.findIndex((item) => item.query === query);
    if (index !== -1) {
      this.searchHistory.splice(index, 1);
    }

    // Add to front with current timestamp
    this.searchHistory.unshift({
      query,
      timestamp: Date.now(),
    });

    // Filter by retention days
    const retentionDays =
      (Zotero.Prefs.get(
        `${config.prefsPrefix}.${SEARCH_HISTORY_DAYS_PREF_KEY}`,
        true,
      ) as number) || SEARCH_HISTORY_DAYS_DEFAULT;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    this.searchHistory = this.searchHistory.filter(
      (item) => item.timestamp >= cutoff,
    );

    // Limit to max entries (increased limit)
    if (this.searchHistory.length > SEARCH_HISTORY_MAX_ENTRIES) {
      this.searchHistory = this.searchHistory.slice(
        0,
        SEARCH_HISTORY_MAX_ENTRIES,
      );
    }
    this.saveSearchHistory();
  }

  private loadFilterHistory() {
    try {
      const stored = Zotero.Prefs.get(
        `${config.addonRef}.${FILTER_HISTORY_PREF_KEY}`,
        true,
      ) as string | undefined;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          typeof parsed[0] === "string"
        ) {
          this.filterHistory = (parsed as unknown as string[]).map((query) => ({
            query,
            timestamp: Date.now(),
          }));
          this.saveFilterHistory();
        } else if (Array.isArray(parsed)) {
          this.filterHistory = parsed as SearchHistoryItem[];
        } else {
          this.filterHistory = [];
        }
      } else {
        this.filterHistory = [];
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to load filter history: ${err}`,
      );
      this.filterHistory = [];
    }
  }

  private saveFilterHistory() {
    try {
      Zotero.Prefs.set(
        `${config.addonRef}.${FILTER_HISTORY_PREF_KEY}`,
        JSON.stringify(this.filterHistory),
        true,
      );
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to save filter history: ${err}`,
      );
    }
  }

  private addToFilterHistory(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    const existingIndex = this.filterHistory.findIndex(
      (item) => item.query === trimmed,
    );
    if (existingIndex !== -1) {
      this.filterHistory.splice(existingIndex, 1);
    }
    this.filterHistory.unshift({
      query: trimmed,
      timestamp: Date.now(),
    });
    if (this.filterHistory.length > FILTER_HISTORY_MAX_ENTRIES) {
      this.filterHistory = this.filterHistory.slice(
        0,
        FILTER_HISTORY_MAX_ENTRIES,
      );
    }
    this.saveFilterHistory();
  }

  /**
   * Clear search history.
   */
  private clearSearchHistory() {
    this.searchHistory = [];
    this.saveSearchHistory();
  }

  /**
   * Clear all history in this instance (called from preferences).
   */
  clearAllHistoryInInstance() {
    this.searchHistory = [];
  }

  /**
   * Execute an INSPIRE search query.
   * This is the main entry point for search functionality.
   */
  async executeInspireSearch(query: string) {
    Zotero.debug(
      `[${config.addonName}] executeInspireSearch called with query="${query}"`,
    );
    if (!query.trim()) {
      Zotero.debug(
        `[${config.addonName}] executeInspireSearch: empty query, returning`,
      );
      return;
    }

    const trimmedQuery = query.trim();
    this.currentSearchQuery = trimmedQuery;
    this.addToSearchHistory(trimmedQuery);
    Zotero.debug(
      `[${config.addonName}] executeInspireSearch: query set to "${trimmedQuery}"`,
    );

    // Update search input value
    if (this.searchInput) {
      this.searchInput.value = trimmedQuery;
      Zotero.debug(
        `[${config.addonName}] executeInspireSearch: updated search input value`,
      );
    } else {
      Zotero.debug(
        `[${config.addonName}] executeInspireSearch: WARNING - searchInput is null/undefined`,
      );
    }

    // Switch to search mode and update UI
    Zotero.debug(
      `[${config.addonName}] executeInspireSearch: switching to search mode`,
    );
    this.viewMode = "search";
    this.updateTabSelection();
    this.updateSearchUIVisibility();

    // Load search results
    Zotero.debug(
      `[${config.addonName}] executeInspireSearch: calling loadSearchResults`,
    );
    await this.loadSearchResults(trimmedQuery);
    Zotero.debug(
      `[${config.addonName}] executeInspireSearch: loadSearchResults completed`,
    );
  }

  /**
   * Load search results from INSPIRE API.
   */
  private async loadSearchResults(query: string) {
    Zotero.debug(
      `[${config.addonName}] loadSearchResults: starting for query="${query}"`,
    );
    this.cancelActiveRequest();

    const loadingMessage = this.getLoadingMessageForMode("search");
    this.allEntries = [];
    this.setStatus(loadingMessage);
    this.renderMessage(loadingMessage);
    Zotero.debug(
      `[${config.addonName}] loadSearchResults: set status to "${loadingMessage}"`,
    );

    const cacheKey = this.getCacheKey(query, "search", this.searchSort);
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      Zotero.debug(
        `[${config.addonName}] loadSearchResults: returning cached results (${cached.length} entries)`,
      );
      this.allEntries = cached;
      this.totalApiCount = null;
      this.chartSelectedBins.clear();
      this.renderChartImmediate(); // Use immediate render for cache hit
      this.renderReferenceList();
      return;
    }
    Zotero.debug(
      `[${config.addonName}] loadSearchResults: no cache hit, fetching from API`,
    );

    const supportsAbort = typeof AbortController !== "undefined";
    const controller = supportsAbort ? new AbortController() : null;
    this.activeAbort = controller ?? undefined;
    const token = `search-${cacheKey}-${performance.now()}`;
    this.pendingToken = token;

    try {
      let hasRenderedFirstPage = false;
      let previousEntryCount = 0;

      const onProgress = (
        currentEntries: InspireReferenceEntry[],
        total: number | null,
      ) => {
        if (this.pendingToken !== token || this.viewMode !== "search") {
          return;
        }
        const prevCount = previousEntryCount;
        previousEntryCount = currentEntries.length;
        this.allEntries = currentEntries;

        if (total !== null) {
          this.totalApiCount = total;
        }

        if (!this.filterText) {
          const loadedCount = currentEntries.length;
          const totalStr = total !== null ? ` of ${total}` : "";
          this.setStatus(`Searching... ${loadedCount}${totalStr} results`);
        }

        if (!hasRenderedFirstPage) {
          this.renderChartImmediate(); // Render chart immediately on first page
          this.renderReferenceList({ preserveScroll: false });
          this.resetListScroll();
          hasRenderedFirstPage = true;
        } else if (this.filterText || this.chartSelectedBins.size > 0) {
          this.renderReferenceList({ preserveScroll: true });
        } else {
          this.appendNewEntries(prevCount);
        }
      };

      const entries = await this.fetchInspireSearch(
        query,
        this.searchSort,
        controller?.signal,
        onProgress,
      );

      this.searchCache.set(cacheKey, entries);

      if (this.pendingToken === token && this.viewMode === "search") {
        this.allEntries = entries;
        this.chartSelectedBins.clear();
        this.renderChartImmediate(); // Use immediate render for final data load
        this.renderReferenceList();
      }

      // Enrich with local status
      const enrichToken = token;
      const enrichSignal = controller?.signal;
      setTimeout(async () => {
        if (this.pendingToken !== enrichToken) return;
        try {
          await this.enrichLocalStatus(entries, enrichSignal);
        } catch (err) {
          if ((err as any)?.name !== "AbortError") {
            Zotero.debug(
              `[${config.addonName}] Search enrichment error: ${err}`,
            );
          }
        }
      }, 0);
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        Zotero.debug(`[${config.addonName}] INSPIRE search error: ${err}`);
        this.allEntries = [];
        this.renderChartImmediate();
        this.renderMessage(getString("references-panel-status-error"));
      }
    } finally {
      if (this.pendingToken === token) {
        this.activeAbort = undefined;
      }
    }
  }

  /**
   * Fetch search results from INSPIRE API.
   */
  private async fetchInspireSearch(
    query: string,
    sort: InspireSortOption,
    signal?: AbortSignal,
    onProgress?: (
      entries: InspireReferenceEntry[],
      total: number | null,
    ) => void,
  ): Promise<InspireReferenceEntry[]> {
    const entries: InspireReferenceEntry[] = [];
    const encodedQuery = encodeURIComponent(query);
    const sortParam = `&sort=${sort}`;
    // FTR-API-FIELD-OPTIMIZATION: Use centralized field configuration
    const fieldsParam = buildFieldsParam(API_FIELDS_LIST_DISPLAY);

    // Fetch first page to get total count
    const firstUrl = `${INSPIRE_API_BASE}/literature?q=${encodedQuery}&size=${CITED_BY_PAGE_SIZE}&page=1${sortParam}${fieldsParam}`;
    const firstResponse = await inspireFetch(
      firstUrl,
      signal ? { signal } : undefined,
    ).catch((err) => {
      Zotero.debug(
        `[${config.addonName}] fetchInspireSearch: first page fetch failed: ${err}`,
      );
      return null;
    });
    if (!firstResponse || firstResponse.status === 404) {
      throw new Error("Search failed");
    }

    const firstPayload: any = await firstResponse.json();
    const totalHits = firstPayload?.hits?.total ?? 0;
    const firstHits = Array.isArray(firstPayload?.hits?.hits)
      ? firstPayload.hits.hits
      : [];

    if (totalHits === 0) {
      return [];
    }

    // Process first page
    const strings = getCachedStrings();
    for (let i = 0; i < firstHits.length; i++) {
      if (signal?.aborted) break;
      entries.push(this.buildEntryFromSearchHit(firstHits[i], i, strings));
    }

    // PERF-16: Pass array reference directly instead of cloning
    if (onProgress) {
      onProgress(entries, totalHits);
    }

    // If there are more pages, fetch them in parallel batches
    const totalPages = Math.ceil(
      Math.min(totalHits, CITED_BY_MAX_RESULTS) / CITED_BY_PAGE_SIZE,
    );
    if (totalPages <= 1) {
      return entries;
    }

    // Fetch remaining pages in parallel batches
    for (
      let batchStart = 2;
      batchStart <= totalPages;
      batchStart += CITED_BY_PARALLEL_BATCH_SIZE
    ) {
      if (signal?.aborted) break;

      const batchPages: number[] = [];
      for (
        let p = batchStart;
        p < batchStart + CITED_BY_PARALLEL_BATCH_SIZE && p <= totalPages;
        p++
      ) {
        batchPages.push(p);
      }

      const batchResults = await Promise.all(
        batchPages.map(async (pageNum) => {
          const url = `${INSPIRE_API_BASE}/literature?q=${encodedQuery}&size=${CITED_BY_PAGE_SIZE}&page=${pageNum}${sortParam}${fieldsParam}`;
          const response = await inspireFetch(
            url,
            signal ? { signal } : undefined,
          ).catch(() => null);
          if (!response || !response.ok) return [];
          const payload: any = await response.json();
          return Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
        }),
      );

      // Process batch results
      for (const pageHits of batchResults) {
        for (const hit of pageHits) {
          if (signal?.aborted) break;
          entries.push(
            this.buildEntryFromSearchHit(hit, entries.length, strings),
          );
        }
      }

      // PERF-16: Pass array reference directly instead of cloning
      if (onProgress && !signal?.aborted) {
        onProgress(entries, totalHits);
      }
    }

    return entries;
  }

  /**
   * Build an entry from a search hit result.
   */
  private buildEntryFromSearchHit(
    hit: any,
    index: number,
    strings: ReturnType<typeof getCachedStrings>,
  ): InspireReferenceEntry {
    const meta = hit?.metadata || hit;
    const recid = String(meta?.control_number ?? "");
    const rawTitle = meta?.titles?.[0]?.title ?? strings.noTitle;
    const title = cleanMathTitle(rawTitle);
    const authors = meta?.authors ?? [];
    const { primary: publicationInfo, errata } = splitPublicationInfo(
      meta?.publication_info,
    );
    const arxivDetails = extractArxivFromMetadata(meta);
    const earliestDate = meta?.earliest_date ?? "";
    const year = earliestDate
      ? earliestDate.slice(0, 4)
      : (publicationInfo?.year ?? "");
    const citationCount =
      typeof meta?.citation_count === "number" ? meta.citation_count : null;
    const citationCountWithoutSelf =
      typeof meta?.citation_count_without_self_citations === "number"
        ? meta.citation_count_without_self_citations
        : typeof meta?.citation_count_wo_self_citations === "number"
          ? meta.citation_count_wo_self_citations
          : null;

    const { names: authorNames, total: totalAuthors } =
      extractAuthorNamesLimited(authors, 3);
    const authorText = formatAuthors(authorNames, totalAuthors);
    const fallbackYear = year || undefined;
    const summary = buildPublicationSummary(
      publicationInfo,
      arxivDetails,
      fallbackYear,
      errata,
    );

    const inspireUrl = recid ? `${INSPIRE_LITERATURE_URL}/${recid}` : "";
    const fallbackUrl = buildFallbackUrlFromMetadata(meta, arxivDetails);

    // Extract primary DOI from metadata
    const doi =
      Array.isArray(meta?.dois) && meta.dois.length
        ? typeof meta.dois[0] === "string"
          ? meta.dois[0]
          : meta.dois[0]?.value
        : undefined;

    const entry: InspireReferenceEntry = {
      id: `search-${index}-${recid || Date.now()}`,
      recid,
      title,
      authors: authorNames,
      totalAuthors,
      authorSearchInfos: extractAuthorSearchInfos(authors, 3),
      authorText,
      displayText: "",
      year: year || strings.yearUnknown,
      summary,
      citationCount,
      citationCountWithoutSelf: citationCountWithoutSelf ?? undefined,
      inspireUrl,
      fallbackUrl,
      searchText: "",
      localItemID: undefined,
      isRelated: false,
      publicationInfo,
      publicationInfoErrata: errata,
      arxivDetails,
      doi,
    };

    // Build displayText for proper filtering (matches behavior in buildEntry and buildEntryFromSearch)
    entry.displayText = buildDisplayText(entry);
    // Defer searchText calculation to first filter for better initial load performance
    entry.searchText = "";

    return entry;
  }

  private getSortOptionForMode(mode: InspireViewMode) {
    if (mode === "references") {
      return this.referenceSort;
    }
    if (mode === "citedBy") {
      return this.citedBySort;
    }
    if (mode === "search") {
      return this.searchSort;
    }
    return this.entryCitedSort;
  }

  /**
   * Map view mode to local cache type.
   * Returns null for modes that shouldn't use local cache (e.g., search results).
   */
  private getLocalCacheType(mode: InspireViewMode): LocalCacheType | null {
    switch (mode) {
      case "references":
        return "refs";
      case "citedBy":
        return "cited";
      case "entryCited":
        // Author papers use "author" type; entry cited-by uses "cited"
        return this.entryCitedSource?.authorSearchInfo ? "author" : "cited";
      case "search":
        // Search results are not cached to local storage
        return null;
      default:
        return null;
    }
  }

  /**
   * Persist enriched entries to local cache after enrichment completes.
   * Smart caching strategy:
   * - References: always store without sort (client-side sorting)
   * - Cited By/Author: if total <= CITED_BY_MAX_RESULTS, store without sort; otherwise by sort
   *
   * @param entries - Enriched entries to persist
   * @param mode - Current view mode
   * @param recid - Record ID or author key
   * @param sortOption - Sort option (for cited-by/author modes)
   */
  private async persistEnrichedCache(
    entries: InspireReferenceEntry[],
    mode: InspireViewMode,
    recid: string,
    sortOption?: ReferenceSortOption | InspireSortOption,
  ): Promise<void> {
    const localCacheType = this.getLocalCacheType(mode);
    if (!localCacheType) return;

    try {
      const totalFromApi = this.totalApiCount ?? entries.length;

      if (mode === "references") {
        // References: store without sort (client-side sorting)
        await localCache.set(
          localCacheType,
          recid,
          entries,
          undefined,
          entries.length,
        );
        Zotero.debug(
          `[${config.addonName}] Persisted enriched references cache: ${recid} (${entries.length} entries)`,
        );
      } else if (totalFromApi <= CITED_BY_MAX_RESULTS) {
        // Data is complete - store without sort for client-side sorting
        await localCache.set(
          localCacheType,
          recid,
          entries,
          undefined,
          totalFromApi,
        );
        Zotero.debug(
          `[${config.addonName}] Persisted enriched cache (unsorted): ${recid} (${entries.length}/${totalFromApi})`,
        );
      } else {
        // Data is truncated - store with sort parameter
        await localCache.set(
          localCacheType,
          recid,
          entries,
          sortOption as string,
          totalFromApi,
        );
        Zotero.debug(
          `[${config.addonName}] Persisted enriched cache (sorted by ${sortOption}): ${recid} (${entries.length}/${totalFromApi})`,
        );
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Error persisting enriched cache: ${err}`,
      );
    }
  }

  private getCacheKey(
    recidOrQuery: string,
    mode: InspireViewMode,
    sort?: ReferenceSortOption | InspireSortOption,
  ) {
    if (mode === "citedBy") {
      return `${recidOrQuery}:cited:${sort ?? this.citedBySort}`;
    }
    if (mode === "entryCited") {
      // Differentiate author queries from recid queries
      const prefix = this.entryCitedSource?.authorQuery ? "author" : "entry";
      return `${recidOrQuery}:${prefix}:${sort ?? this.entryCitedSort}`;
    }
    if (mode === "search") {
      return `${recidOrQuery}:search:${sort ?? this.searchSort}`;
    }
    return recidOrQuery;
  }

  private getSortedReferences(entries: InspireReferenceEntry[]) {
    if (this.referenceSort === "default") {
      return entries;
    }
    const sorted = [...entries];
    if (this.referenceSort === "yearDesc") {
      sorted.sort((a, b) => {
        const aYear = Number(a.year);
        const bYear = Number(b.year);
        const safeA = Number.isFinite(aYear) ? aYear : -Infinity;
        const safeB = Number.isFinite(bYear) ? bYear : -Infinity;
        return safeB - safeA;
      });
    } else if (this.referenceSort === "citationDesc") {
      // Use getCitationValue() to respect excludeSelfCitations toggle
      sorted.sort(
        (a, b) => this.getCitationValue(b) - this.getCitationValue(a),
      );
    }
    return sorted;
  }

  /**
   * Sort cited-by / author papers entries client-side.
   * Used when reading from unsorted local cache (data is complete).
   */
  private getSortedCitedBy(
    entries: InspireReferenceEntry[],
    sort: InspireSortOption,
  ) {
    if (!sort) return entries;
    const sorted = [...entries];
    if (sort === "mostrecent") {
      // Sort by year descending (most recent first)
      sorted.sort((a, b) => {
        const aYear = Number(a.year);
        const bYear = Number(b.year);
        const safeA = Number.isFinite(aYear) ? aYear : -Infinity;
        const safeB = Number.isFinite(bYear) ? bYear : -Infinity;
        return safeB - safeA;
      });
    } else if (sort === "mostcited") {
      // Sort by citation count descending
      sorted.sort(
        (a, b) => this.getCitationValue(b) - this.getCitationValue(a),
      );
    }
    return sorted;
  }

  /**
   * Create a row template with all sub-elements pre-created (PERF-13).
   * This template is reused when pooling rows - only content is updated, not structure.
   */
  private createRowTemplate(): HTMLDivElement {
    const doc = this.listEl.ownerDocument;
    const row = doc.createElement("div");
    row.classList.add("zinspire-ref-entry");
    // FTR-KEYBOARD-NAV-FULL: Make rows focusable for keyboard navigation
    // tabindex="-1" means focusable via JavaScript but not in tab order
    row.tabIndex = -1;
    // Remove browser's focus outline since we have our own visual indicator
    row.style.outline = "none";

    // Use innerHTML for static elements only (Zotero XHTML removes input/button via innerHTML)
    row.innerHTML = `
      <div class="zinspire-ref-entry__text">
        <div class="zinspire-ref-entry__controls">
          <span class="zinspire-ref-entry__dot is-clickable"></span>
        </div>
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

    const textContainer = row.querySelector(
      ".zinspire-ref-entry__text",
    ) as HTMLElement;
    const controls = row.querySelector(
      ".zinspire-ref-entry__controls",
    ) as HTMLElement;
    const marker = row.querySelector(".zinspire-ref-entry__dot") as HTMLElement;
    const content = row.querySelector(
      ".zinspire-ref-entry__content",
    ) as HTMLElement;

    if (textContainer) applyRefEntryTextContainerStyle(textContainer);
    if (marker) {
      applyRefEntryMarkerStyle(marker);
      marker.style.cursor = "pointer";
    }
    if (content) applyRefEntryContentStyle(content);

    // FTR-BATCH-IMPORT: Create checkbox via createElement (required for Zotero XHTML security)
    // Input elements cannot be created via innerHTML in Zotero's XHTML environment
    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add("zinspire-ref-entry__checkbox");
    // Apply inline styles since CSS class may not be enough
    checkbox.style.width = "14px";
    checkbox.style.height = "14px";
    checkbox.style.margin = "0";
    checkbox.style.cursor = "pointer";
    checkbox.style.flexShrink = "0";

    // Create buttons via createElement (required for Zotero XHTML security)
    const linkButton = doc.createElement("button");
    linkButton.type = "button";
    linkButton.classList.add("zinspire-ref-entry__link");
    applyRefEntryLinkButtonStyle(linkButton);

    const bibtexButton = doc.createElement("button");
    bibtexButton.type = "button";
    bibtexButton.classList.add("zinspire-ref-entry__bibtex");
    applyBibTeXButtonStyle(bibtexButton);

    const texkeyButton = doc.createElement("button");
    texkeyButton.type = "button";
    texkeyButton.classList.add("zinspire-ref-entry__texkey");
    applyBibTeXButtonStyle(texkeyButton);

    const statsButton = doc.createElement("button");
    statsButton.type = "button";
    statsButton.classList.add(
      "zinspire-ref-entry__stats",
      "zinspire-ref-entry__stats-button",
    );

    // Insert elements at correct positions
    if (controls && marker && content) {
      // FTR-BATCH-IMPORT: Insert checkbox before marker (leftmost position)
      controls.insertBefore(checkbox, marker);
      // Insert link, texkey, and bibtex buttons after marker
      controls.appendChild(linkButton);
      controls.appendChild(texkeyButton);
      controls.appendChild(bibtexButton);
      content.appendChild(statsButton);
    }

    return row;
  }

  /**
   * Get a row element from the pool or create a new one (PERF-13).
   * Pooled elements retain their structure - only content needs updating.
   */
  private getRowFromPool(): HTMLDivElement {
    const pooled = this.rowPool.pop();
    if (pooled) {
      // PERF-13: Don't clear content, structure is preserved for reuse
      return pooled;
    }
    // Create new template if pool is empty
    return this.createRowTemplate();
  }

  /**
   * Return a row element to the pool for later reuse (PERF-13).
   * Structure is preserved - no need to clear content.
   */
  private returnRowToPool(row: HTMLDivElement) {
    if (this.rowPool.length < this.maxRowPoolSize) {
      // PERF-13: Keep structure intact, just reset data attributes
      delete row.dataset.entryId;
      // FTR-FOCUSED-SELECTION: Clear inline focus styles before pooling
      row.classList.remove(
        "zinspire-entry-focused",
        "zinspire-entry-highlight",
      );
      row.style.backgroundColor = "";
      row.style.boxShadow = "";
      this.rowPool.push(row);
    }
    // If pool is full, just let the element be garbage collected
  }

  /**
   * Recycle rows from the list to the pool before clearing.
   * PERF FIX: Only recycle up to maxRowPoolSize elements, since we can't use more anyway.
   * This avoids iterating through 10000+ elements when only 150 can be pooled.
   */
  private recycleRowsToPool() {
    // Skip if pool is already full
    const slotsAvailable = this.maxRowPoolSize - this.rowPool.length;
    if (slotsAvailable <= 0) return;

    // Only query and process the number of elements we can actually pool
    const rows = this.listEl.querySelectorAll(".zinspire-ref-entry");
    const limit = Math.min(rows.length, slotsAvailable);
    for (let i = 0; i < limit; i++) {
      this.returnRowToPool(rows[i] as HTMLDivElement);
    }
  }

  /**
   * Update row content with entry data (PERF-13).
   * Called after getting a row from pool - only updates text/attributes, not structure.
   */
  private updateRowContent(row: HTMLDivElement, entry: InspireReferenceEntry) {
    const strings = getCachedStrings();

    // Store entry ID for event delegation (PERF-14)
    row.dataset.entryId = entry.id;

    // FTR-BATCH-IMPORT: Update checkbox state
    const checkbox = row.querySelector(
      ".zinspire-ref-entry__checkbox",
    ) as HTMLInputElement;
    if (checkbox) {
      checkbox.checked = this.selectedEntryIDs.has(entry.id);
      checkbox.dataset.entryId = entry.id;
    } else {
      Zotero.debug(
        `[${config.addonName}] updateRowContent: checkbox NOT found in row for entry ${entry.id}`,
      );
    }

    // Update marker
    const marker = row.querySelector(".zinspire-ref-entry__dot") as HTMLElement;
    if (marker) {
      marker.textContent = entry.localItemID ? "●" : "⊕";
      marker.dataset.state = entry.localItemID ? "local" : "missing";
      applyRefEntryMarkerColor(marker, Boolean(entry.localItemID));
      marker.setAttribute(
        "title",
        entry.localItemID ? strings.dotLocal : strings.dotAdd,
      );
    }

    // Update link button
    const linkButton = row.querySelector(
      ".zinspire-ref-entry__link",
    ) as HTMLButtonElement;
    if (linkButton) {
      linkButton.setAttribute(
        "title",
        entry.isRelated ? strings.linkExisting : strings.linkMissing,
      );
      this.renderLinkButton(linkButton, Boolean(entry.isRelated));
    }

    // Update bibtex button
    const bibtexButton = row.querySelector(
      ".zinspire-ref-entry__bibtex",
    ) as HTMLButtonElement;
    if (bibtexButton) {
      bibtexButton.textContent = "📋";
      bibtexButton.setAttribute("title", strings.copyBibtex);
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
    ) as HTMLButtonElement;
    if (texkeyButton) {
      texkeyButton.textContent = "T";
      texkeyButton.setAttribute("title", strings.copyTexkey);
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

    // Update label (show/hide)
    const labelSpan = row.querySelector(
      ".zinspire-ref-entry__label",
    ) as HTMLElement;
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
    ) as HTMLElement;
    if (authorsContainer) {
      // Clear and rebuild author links (variable count)
      // PERF-FIX-15: Use replaceChildren() instead of innerHTML = ""
      authorsContainer.replaceChildren();
      this.appendAuthorLinks(authorsContainer, entry, strings);
    }

    // Update title link
    const titleLink = row.querySelector(
      ".zinspire-ref-entry__title-link",
    ) as HTMLAnchorElement;
    if (titleLink) {
      titleLink.textContent = entry.title + ";";
      titleLink.href = entry.inspireUrl || entry.fallbackUrl || "#";
    }

    // Update meta with clickable links (DOI/arXiv)
    const meta = row.querySelector(".zinspire-ref-entry__meta") as HTMLElement;
    if (meta) {
      const hasMeta = entry.publicationInfo || entry.arxivDetails || entry.doi;
      if (hasMeta) {
        this.buildMetaContent(meta, entry);
        meta.style.display = "";
      } else {
        // PERF-FIX-15: Use replaceChildren() instead of innerHTML
        meta.replaceChildren();
        meta.style.display = "none";
      }
    }

    // Update stats button (show/hide and content)
    const statsButton = row.querySelector(
      ".zinspire-ref-entry__stats-button",
    ) as HTMLButtonElement;
    if (statsButton) {
      const displayCitationCount = this.getCitationValue(entry);
      const hasCitationCount =
        displayCitationCount > 0 ||
        typeof entry.citationCount === "number" ||
        typeof entry.citationCountWithoutSelf === "number";
      const isReferencesMode = this.viewMode === "references";
      const canShowEntryCitedTab =
        Boolean(entry.recid) && (hasCitationCount || !isReferencesMode);

      if (canShowEntryCitedTab || hasCitationCount) {
        const label = hasCitationCount
          ? getString("references-panel-citation-count", {
              args: { count: displayCitationCount },
            })
          : strings.citationUnknown;
        statsButton.textContent = label;
        statsButton.style.display = "";
        // Make it clickable only if we can show entry cited tab
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

    // FTR-FOCUSED-SELECTION: Restore focus state if this entry is focused
    this.applyFocusedEntryStyle(row, this.focusedEntryID === entry.id);
  }

  /**
   * Create a reference row element for an entry (PERF-13).
   * Uses pooled row templates and only updates content, not structure.
   */
  private createReferenceRow(entry: InspireReferenceEntry) {
    // Get row from pool (with pre-created structure) or create new template
    const row = this.getRowFromPool();
    // Update row content with entry data
    this.updateRowContent(row, entry);
    // Cache the row for later updates (e.g., citation count, status)
    this.rowCache.set(entry.id, row);
    return row;
  }

  /**
   * Append clickable author links to the container.
   * Handles "et al." format and unknown authors.
   * Accepts optional cached strings for performance.
   *
   * IMPORTANT: We build aligned arrays where each index corresponds to the same author.
   * This avoids the index mismatch bug when filtering empty names.
   *
   * Special cases:
   * - Large collaborations (>50 authors): show only first author + et al.
   * - "others" in author list: convert to et al.
   * - More total authors than displayed: show et al.
   */
  private appendAuthorLinks(
    container: HTMLElement,
    entry: InspireReferenceEntry,
    strings?: Record<string, string>,
  ) {
    const doc = this.listEl.ownerDocument;
    const s = strings ?? getCachedStrings();
    // Check if authors are unknown
    if (!entry.authors.length || entry.authorText === s.unknownAuthor) {
      const span = doc.createElement("span");
      span.textContent = s.unknownAuthor;
      container.appendChild(span);
      return;
    }

    const maxAuthors = (getPref("max_authors") as number) || 3;
    const totalAuthors = entry.totalAuthors ?? entry.authors.length;
    const isLargeCollaboration = totalAuthors > LARGE_COLLABORATION_THRESHOLD;

    // Check if "others" is in the author list (convert to et al.)
    const hasOthers = entry.authors.some(
      (name) => name.toLowerCase() === "others",
    );

    // Build aligned arrays: each index corresponds to the same author
    // Filter out entries where formatAuthorName returns empty string
    // Also filter out "others" (will be converted to et al.)
    // Also track author search info (recid if available) for precise search
    // Store original index for event delegation (PERF-14)
    type AuthorDisplay = {
      formatted: string; // Display name (e.g., "J. Smith")
      searchInfo: AuthorSearchInfo; // Search info with fullName and optional recid
      originalIndex: number; // Original index in entry.authors for event delegation
    };
    const validAuthors: AuthorDisplay[] = [];
    // For large collaborations, only process first author
    const processLimit = isLargeCollaboration
      ? 1
      : Math.min(entry.authors.length, maxAuthors + 1);
    for (let i = 0; i < processLimit && i < entry.authors.length; i++) {
      const fullName = entry.authors[i];
      // Skip "others" - will be converted to et al.
      if (fullName.toLowerCase() === "others") {
        continue;
      }
      const formatted = formatAuthorName(fullName);
      if (formatted) {
        // Get BAI and recid from authorSearchInfos if available (index-aligned)
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
      const span = doc.createElement("span");
      span.textContent = s.unknownAuthor;
      container.appendChild(span);
      return;
    }

    // Determine which authors to show and whether to show et al.
    // Show et al. if:
    // 1. Large collaboration (>50 authors)
    // 2. Total authors > displayed authors
    // 3. "others" was in the author list
    // 4. More valid authors than maxAuthors
    const showEtAl =
      isLargeCollaboration ||
      totalAuthors > validAuthors.length ||
      hasOthers ||
      validAuthors.length > maxAuthors;

    // For large collaborations or when et al. is needed, show only up to maxAuthors
    const displayCount = showEtAl
      ? Math.min(validAuthors.length, maxAuthors)
      : validAuthors.length;
    const authorsToShow = validAuthors.slice(0, displayCount);

    for (let i = 0; i < authorsToShow.length; i++) {
      if (i > 0) {
        const comma = doc.createElement("span");
        comma.textContent = ", ";
        container.appendChild(comma);
      }
      const { formatted, searchInfo, originalIndex } = authorsToShow[i];
      const authorLink = doc.createElement("a");
      authorLink.classList.add("zinspire-ref-entry__author-link");
      authorLink.textContent = formatted;
      authorLink.href = "#";
      // Store original author index for event delegation (PERF-14)
      authorLink.dataset.authorIndex = String(originalIndex);
      // Show BAI in tooltip if available (most reliable identifier)
      const idHint = searchInfo.bai ? ` (${searchInfo.bai})` : "";
      authorLink.title =
        getString("references-panel-author-click-hint", {
          args: { author: searchInfo.fullName },
        }) + idHint;
      // Event handled by delegation (PERF-14)
      applyAuthorLinkStyle(authorLink, isDarkMode());
      container.appendChild(authorLink);
    }

    if (showEtAl) {
      const etAlSpan = doc.createElement("span");
      etAlSpan.textContent = " et al.";
      container.appendChild(etAlSpan);
    }
  }

  /**
   * Create a clickable external link element.
   * Shared helper for title links, DOI links, arXiv links, etc.
   * - Blue color, underline on hover
   * - Left click opens in browser via Zotero.launchURL()
   * - Right click shows context menu (handled by event delegation)
   */
  private createExternalLink(
    doc: Document,
    text: string,
    url: string,
  ): HTMLAnchorElement {
    const link = doc.createElement("a");
    link.href = url;
    link.textContent = text;
    applyMetaLinkStyle(link, isDarkMode());
    // Hover underline
    link.addEventListener("mouseenter", () => {
      link.style.textDecoration = "underline";
    });
    link.addEventListener("mouseleave", () => {
      link.style.textDecoration = "none";
    });
    // Left click opens in browser (Zotero doesn't support target="_blank")
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      Zotero.launchURL(url);
    });
    return link;
  }

  /**
   * Build meta content with clickable links for DOI and arXiv.
   * - Journal info links to DOI if available
   * - arXiv tag links to arXiv abstract page
   * - Erratum info also links to its DOI if available
   */
  private buildMetaContent(
    container: HTMLElement,
    entry: InspireReferenceEntry,
  ): void {
    const doc = this.listEl.ownerDocument;
    // PERF-FIX-15: Use replaceChildren() instead of innerHTML = ""
    container.replaceChildren();

    // Build journal info part
    const journalText = formatPublicationInfo(
      entry.publicationInfo,
      entry.year,
    );
    if (journalText) {
      if (entry.doi) {
        const doiUrl = `${DOI_ORG_URL}/${entry.doi}`;
        container.appendChild(
          this.createExternalLink(doc, journalText, doiUrl),
        );
      } else {
        const journalSpan = doc.createElement("span");
        journalSpan.textContent = journalText;
        container.appendChild(journalSpan);
      }
    }

    // Build arXiv part
    const arxivDetails = formatArxivDetails(entry.arxivDetails);
    if (arxivDetails?.id) {
      if (journalText) {
        // Add space separator
        const space = doc.createElement("span");
        space.textContent = " ";
        container.appendChild(space);
      }
      const arxivUrl = `${ARXIV_ABS_URL}/${arxivDetails.id}`;
      const arxivText = `[arXiv:${arxivDetails.id}]`;
      container.appendChild(this.createExternalLink(doc, arxivText, arxivUrl));
    }

    // Build erratum part
    if (entry.publicationInfoErrata?.length) {
      const errataSummaries: string[] = [];
      for (const errataEntry of entry.publicationInfoErrata) {
        const text = formatPublicationInfo(errataEntry.info, entry.year, {
          omitJournal: true,
        });
        if (text) {
          errataSummaries.push(`${errataEntry.label}: ${text}`);
        }
      }
      if (errataSummaries.length) {
        // Add space before erratum bracket
        const space = doc.createElement("span");
        space.textContent = " [";
        container.appendChild(space);

        for (let i = 0; i < entry.publicationInfoErrata.length; i++) {
          const errataEntry = entry.publicationInfoErrata[i];
          const text = formatPublicationInfo(errataEntry.info, entry.year, {
            omitJournal: true,
          });
          if (!text) continue;

          if (i > 0) {
            const sep = doc.createElement("span");
            sep.textContent = "; ";
            container.appendChild(sep);
          }

          const labelText = `${errataEntry.label}: ${text}`;
          if (errataEntry.doi) {
            const errataUrl = `${DOI_ORG_URL}/${errataEntry.doi}`;
            container.appendChild(
              this.createExternalLink(doc, labelText, errataUrl),
            );
          } else {
            const errataSpan = doc.createElement("span");
            errataSpan.textContent = labelText;
            container.appendChild(errataSpan);
          }
        }

        const closeBracket = doc.createElement("span");
        closeBracket.textContent = "]";
        container.appendChild(closeBracket);
      }
    }
  }

  /**
   * Show a context menu for link with copy option.
   * FTR-COPY-LINK: Right-click on any link to copy its URL.
   */
  private showLinkContextMenu(
    anchor: HTMLAnchorElement,
    event: MouseEvent,
  ): void {
    const doc = this.listEl.ownerDocument;
    const url = anchor.href;

    // Remove existing popup if any
    const popupId = "zinspire-link-context-popup";
    const existingPopup = doc.getElementById(popupId);
    if (existingPopup) {
      existingPopup.remove();
    }

    // Create XUL menupopup
    const popup = (doc as any).createXULElement("menupopup") as XUL.MenuPopup;
    popup.id = popupId;

    // Copy link option
    const copyItem = (doc as any).createXULElement("menuitem");
    copyItem.setAttribute("label", getString("references-panel-copy-link"));
    copyItem.addEventListener("command", () => {
      this.copyToClipboard(url);
    });
    popup.appendChild(copyItem);

    // Open in browser option
    const openItem = (doc as any).createXULElement("menuitem");
    openItem.setAttribute("label", getString("references-panel-open-link"));
    openItem.addEventListener("command", () => {
      Zotero.launchURL?.(url);
    });
    popup.appendChild(openItem);

    // Add popup to document and open at mouse position
    doc.documentElement.appendChild(popup);
    popup.addEventListener("popuphidden", () => popup.remove(), { once: true });
    popup.openPopupAtScreen(event.screenX, event.screenY, true);
  }

  /**
   * Copy text to clipboard using Zotero's clipboard utility.
   */
  private copyToClipboard(text: string): void {
    try {
      // Use Zotero's clipboard utility (XPCOM)
      const CC = Components.classes as any;
      const CI = Components.interfaces as any;
      const clipboardService = CC[
        "@mozilla.org/widget/clipboard;1"
      ]?.getService(CI.nsIClipboard);
      const transferable = CC[
        "@mozilla.org/widget/transferable;1"
      ]?.createInstance(CI.nsITransferable);

      if (transferable && clipboardService) {
        transferable.init(null);
        transferable.addDataFlavor("text/plain");

        const str = CC["@mozilla.org/supports-string;1"]?.createInstance(
          CI.nsISupportsString,
        );
        if (str) {
          str.data = text;
          transferable.setTransferData("text/plain", str);
          clipboardService.setData(
            transferable,
            null,
            clipboardService.kGlobalClipboard,
          );
          this.showToast(getString("references-panel-link-copied"));
          return;
        }
      }
    } catch (e) {
      Zotero.debug?.(`[${config.addonName}] Clipboard fallback: ${e}`);
    }

    // Fallback: try navigator.clipboard API
    try {
      const mainWindow = Zotero.getMainWindow?.() as Window | undefined;
      if (mainWindow?.navigator?.clipboard) {
        mainWindow.navigator.clipboard
          .writeText(text)
          .then(() => {
            this.showToast(getString("references-panel-link-copied"));
          })
          .catch(() => {
            this.showToast(getString("references-panel-copy-failed"));
          });
        return;
      }
    } catch (e) {
      // Ignore
    }

    this.showToast(getString("references-panel-copy-failed"));
  }

  private async handleLinkAction(
    entry: InspireReferenceEntry,
    anchor?: HTMLElement,
  ) {
    if (!this.currentItemID) {
      return;
    }
    // If item is not in library, add it first then link
    if (!entry.localItemID) {
      const target = anchor ?? this.body;
      await this.handleAddAndLinkAction(entry, target);
      return;
    }
    if (entry.isRelated) {
      await this.unlinkReference(entry.localItemID);
      entry.isRelated = false;
      this.renderReferenceList();
      return;
    }
    await this.linkExistingReference(entry.localItemID);
    entry.isRelated = true;
    this.renderReferenceList();
  }

  private async handleAddAndLinkAction(
    entry: InspireReferenceEntry,
    anchor: HTMLElement,
  ) {
    if (entry.localItemID) {
      return;
    }
    if (!entry.recid) {
      this.showToast(getString("references-panel-toast-missing"));
      return;
    }
    const selection = await this.promptForSaveTarget(anchor);
    if (!selection) {
      return;
    }
    const newItem = await this.importReference(entry.recid, selection);
    if (newItem) {
      entry.localItemID = newItem.id;
      entry.displayText = buildDisplayText(entry);
      // Invalidate searchText so it will be recalculated on next filter
      entry.searchText = "";
      // Automatically link after adding
      await this.linkExistingReference(newItem.id);
      entry.isRelated = true;
      this.renderReferenceList({ preserveScroll: true });
      setTimeout(() => {
        this.restoreScrollPositionIfNeeded();
      }, 0);
    }
  }

  private async handleMarkerClick(
    entry: InspireReferenceEntry,
    anchor?: HTMLElement,
  ) {
    // Clear timer reference since we're executing now
    this.markerClickTimer = undefined;

    if (entry.localItemID) {
      const pane = Zotero.getActiveZoteroPane();
      if (
        pane &&
        this.currentItemID &&
        entry.localItemID !== this.currentItemID
      ) {
        this.rememberCurrentItemForNavigation();
        pane.selectItems([entry.localItemID]);
      } else {
        pane?.selectItems([entry.localItemID]);
      }
      return;
    }
    const target = anchor ?? this.body;
    await this.handleAddAction(entry, target);
  }

  /**
   * Get the first PDF attachment ID for a parent item.
   * Returns the attachment ID if found, null otherwise.
   */
  private getFirstPdfAttachmentID(parentItemID: number): number | null {
    const parentItem = Zotero.Items.get(parentItemID);
    if (!parentItem) {
      return null;
    }
    const attachmentIDs = parentItem.getAttachments?.() || [];
    // Find the first PDF attachment
    for (const id of attachmentIDs) {
      const attachment = Zotero.Items.get(id);
      if (attachment?.isPDFAttachment?.()) {
        return id;
      }
    }
    return null;
  }

  /**
   * Open PDF for a local item.
   * Returns true if PDF was opened successfully, false otherwise.
   */
  private async openPdfForLocalItem(itemID: number): Promise<boolean> {
    if (!Zotero.Reader || typeof Zotero.Reader.open !== "function") {
      return false;
    }
    try {
      const attachmentID = this.getFirstPdfAttachmentID(itemID);
      if (!attachmentID) {
        return false;
      }
      const reader =
        (await Zotero.Reader.open(attachmentID, undefined, {
          allowDuplicate: false,
        })) || null;
      if (reader) {
        ReaderTabHelper.focusReader(reader as _ZoteroTypes.ReaderInstance);
        return true;
      }
      return false;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to open PDF for item ${itemID}: ${err}`,
      );
      return false;
    }
  }

  /**
   * Handle double-click on marker: open PDF if available.
   */
  private async handleMarkerDoubleClick(entry: InspireReferenceEntry) {
    // Only handle double-click for entries with local items
    if (!entry.localItemID) {
      return;
    }

    // Check for PDF presence first
    const pdfID = this.getFirstPdfAttachmentID(entry.localItemID);

    // If PDF exists, save current state to history before navigation
    if (pdfID) {
      this.rememberCurrentItemForNavigation();
    }

    // Attempt to open
    const opened = await this.openPdfForLocalItem(entry.localItemID);

    // If not opened and strictly because no PDF existed, show toast
    if (!opened && !pdfID) {
      this.showToast(getString("references-panel-toast-no-pdf"));
    }
  }

  private async handleTitleClick(entry: InspireReferenceEntry) {
    const targetUrl = entry.inspireUrl || entry.fallbackUrl;
    if (targetUrl) {
      Zotero.launchURL(targetUrl);
      return;
    }
    this.showToast(getString("references-panel-toast-missing"));
  }

  private async showEntryCitedTab(entry: InspireReferenceEntry) {
    if (!entry.recid) {
      this.showToast(getString("references-panel-toast-missing"));
      return;
    }
    this.clearAuthorProfileState();
    const previousMode =
      this.viewMode === "entryCited"
        ? this.entryCitedPreviousMode
        : this.viewMode;
    if (
      previousMode === "references" ||
      previousMode === "citedBy" ||
      previousMode === "search"
    ) {
      this.entryCitedPreviousMode = previousMode;
    }
    const recidChanged = this.entryCitedSource?.recid !== entry.recid;
    this.pendingEntryScrollReset = true;
    if (this.viewMode !== "entryCited") {
      this.entryCitedReturnScroll = this.captureScrollState();
    } else if (recidChanged) {
      this.entryCitedReturnScroll = undefined;
    }
    const label =
      entry.displayText ||
      entry.title ||
      getString("references-panel-entry-label-default");
    this.entryCitedSource = { recid: entry.recid, label };
    this.updateTabSelection();
    if (this.viewMode !== "entryCited") {
      await this.activateViewMode("entryCited").catch(() => void 0);
      this.resetListScroll();
      this.pendingEntryScrollReset = false;
      return;
    }
    if (recidChanged) {
      await this.loadEntries(entry.recid, "entryCited", {
        force: true,
        resetScroll: true,
      }).catch(() => void 0);
      this.pendingEntryScrollReset = false;
    } else {
      this.renderReferenceList();
      this.resetListScroll();
      this.pendingEntryScrollReset = false;
    }
  }

  private getAuthorProfileKey(authorInfo: AuthorSearchInfo): string {
    if (authorInfo.recid) {
      return `recid:${authorInfo.recid}`;
    }
    if (authorInfo.bai) {
      return `bai:${authorInfo.bai.trim()}`;
    }
    return `name:${authorInfo.fullName.trim().toLowerCase()}`;
  }

  private prepareAuthorProfileState(authorInfo: AuthorSearchInfo) {
    this.authorProfileAbort?.abort();
    this.authorProfileAbort = undefined;
    this.authorProfile = undefined;
    this.authorStats = undefined;
    const key = this.getAuthorProfileKey(authorInfo);
    this.authorProfileKey = key;
    this.authorProfileCollapsed =
      this.authorProfileCollapsedByKey.get(key) ?? false;
    this.startAuthorProfileFetch(authorInfo);
  }

  private startAuthorProfileFetch(authorInfo: AuthorSearchInfo) {
    const supportsAbort =
      typeof AbortController !== "undefined" &&
      typeof AbortController === "function";
    this.authorProfileAbort = supportsAbort ? new AbortController() : undefined;
    const signal = this.authorProfileAbort?.signal;
    const key = this.getAuthorProfileKey(authorInfo);
    fetchAuthorProfile(authorInfo, signal)
      .then((profile) => {
        const currentInfo = this.entryCitedSource?.authorSearchInfo;
        const currentKey = currentInfo
          ? this.getAuthorProfileKey(currentInfo)
          : undefined;
        if (!currentKey || currentKey !== key) {
          return;
        }
        this.authorProfile = profile;
        this.updateAuthorProfileCard();
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") {
          return;
        }
        this.authorProfile = null;
        this.updateAuthorProfileCard();
      });
  }

  /**
   * Get entries filtered for author stats calculation.
   * Applies author filter and published filter (same as chart), but not chart bin selection.
   * FTR-AUTHOR-CARD-FILTERS: Ensure author card stats respect all active filters.
   */
  private getEntriesForAuthorStats(): InspireReferenceEntry[] {
    return this.getFilteredEntries(this.allEntries, { skipChartFilter: true });
  }

  private updateAuthorStats(entries: InspireReferenceEntry[]) {
    if (!this.entryCitedSource?.authorSearchInfo) {
      this.authorStats = undefined;
      return;
    }
    const citations = entries.map((entry) => this.getCitationValue(entry));
    const totalCitations = citations.reduce((sum, value) => sum + value, 0);
    const hIndex = this.calculateHIndex(citations);
    this.authorStats = {
      paperCount: entries.length,
      totalCitations,
      hIndex,
      citationsWithoutSelf: this.excludeSelfCitations
        ? totalCitations
        : undefined,
    };
  }

  private clearAuthorProfileState() {
    this.authorProfileAbort?.abort();
    this.authorProfileAbort = undefined;
    this.authorProfile = undefined;
    this.authorStats = undefined;
    this.authorProfileKey = undefined;
    this.authorProfileCard?.remove();
    this.authorProfileCard = undefined;
  }

  private updateAuthorProfileCard() {
    if (
      this.viewMode !== "entryCited" ||
      !this.entryCitedSource?.authorSearchInfo
    ) {
      this.authorProfileCard?.remove();
      this.authorProfileCard = undefined;
      return;
    }
    this.renderAuthorProfileCard();
  }

  private renderAuthorProfileCard() {
    if (!this.entryCitedSource?.authorSearchInfo || !this.chartContainer) {
      return;
    }

    const doc = this.body.ownerDocument;
    if (!this.authorProfileCard) {
      this.authorProfileCard = doc.createElement("div");
      this.authorProfileCard.classList.add("zinspire-author-profile-card");
      this.chartContainer.parentElement?.insertBefore(
        this.authorProfileCard,
        this.chartContainer,
      );
    }

    const card = this.authorProfileCard;
    card.replaceChildren();
    applyAuthorProfileCardStyle(card);

    const authorInfo = this.entryCitedSource.authorSearchInfo;
    const displayName = this.authorProfile?.name || authorInfo.fullName;
    const bai = this.authorProfile?.bai || authorInfo.bai;
    // Keep BAI in display for disambiguation, but no copy interaction

    // FTR-CONSISTENT-UI: Match chart header layout exactly
    // Header: [collapse btn] [name] [spacer]
    const header = doc.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.style.marginBottom = this.authorProfileCollapsed ? "0" : "6px";
    card.appendChild(header);

    // Collapse button FIRST (left side, like chart)
    const collapseBtn = doc.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.textContent = this.authorProfileCollapsed ? "▶" : "▼";
    collapseBtn.title = getString(
      this.authorProfileCollapsed
        ? "references-panel-author-profile-expand"
        : "references-panel-author-profile-collapse",
    );
    collapseBtn.style.cssText = `
      border: 1px solid var(--fill-quaternary, #cbd5e1);
      background: var(--material-background, #f1f5f9);
      font-size: 10px;
      cursor: pointer;
      color: var(--fill-secondary, #64748b);
      padding: 2px 8px;
      border-radius: 4px;
      flex-shrink: 0;
    `;
    collapseBtn.onclick = () => {
      this.authorProfileCollapsed = !this.authorProfileCollapsed;
      const key = this.authorProfileKey;
      if (key) {
        this.authorProfileCollapsedByKey.set(key, this.authorProfileCollapsed);
      }
      this.updateAuthorProfileCard();
    };
    header.appendChild(collapseBtn);

    // Name with BAI in parentheses (no copy interaction)
    const nameEl = doc.createElement("div");
    nameEl.style.fontWeight = "600";
    nameEl.style.fontSize = "13px";
    if (bai) {
      nameEl.textContent = `📚 ${displayName} (${bai})`;
    } else {
      nameEl.textContent = `📚 ${displayName}`;
    }
    header.appendChild(nameEl);

    if (this.authorProfileCollapsed) {
      return;
    }

    const content = doc.createElement("div");
    card.appendChild(content);

    if (this.authorProfile === null) {
      const empty = doc.createElement("div");
      empty.style.fontSize = "12px";
      empty.style.color = "var(--fill-secondary, #64748b)";
      empty.textContent = getString("references-panel-author-profile-unavailable");
      content.appendChild(empty);
    }

    if (this.authorProfile === undefined) {
      const loading = doc.createElement("div");
      loading.style.fontSize = "12px";
      loading.style.color = "var(--fill-secondary, #64748b)";
      loading.textContent = getString("references-panel-author-profile-loading");
      content.appendChild(loading);
    }

    if (this.authorProfile?.currentPosition?.institution) {
      const instEl = doc.createElement("div");
      instEl.style.fontSize = "12px";
      instEl.style.color = "var(--fill-secondary, #64748b)";
      instEl.style.marginTop = "4px";
      instEl.textContent = this.authorProfile.currentPosition.institution;
      content.appendChild(instEl);
    }

    const statsEl = doc.createElement("div");
    statsEl.style.fontSize = "12px";
    statsEl.style.fontWeight = "500";
    statsEl.style.marginTop = "6px";
    if (this.authorStats) {
      const statsKey = this.excludeSelfCitations
        ? "references-panel-author-stats-no-self"
        : "references-panel-author-stats";
      statsEl.textContent = getString(statsKey, {
        args: {
          papers: this.authorStats.paperCount.toLocaleString(),
          citations: this.authorStats.totalCitations.toLocaleString(),
          h: String(this.authorStats.hIndex),
        },
      });
    } else {
      statsEl.textContent = getString("references-panel-author-stats-loading");
    }
    content.appendChild(statsEl);

    if (
      this.totalApiCount !== null &&
      this.totalApiCount > this.allEntries.length
    ) {
      const partialEl = doc.createElement("div");
      partialEl.style.fontSize = "11px";
      partialEl.style.color = "var(--fill-secondary, #64748b)";
      partialEl.textContent = getString("references-panel-author-stats-partial", {
        args: { count: String(this.allEntries.length) },
      });
      content.appendChild(partialEl);
    }

    if (this.authorProfile?.arxivCategories?.length) {
      const catEl = doc.createElement("div");
      catEl.style.fontSize = "12px";
      catEl.style.color = "var(--fill-secondary, #64748b)";
      catEl.style.marginTop = "4px";
      catEl.textContent = `🔬 ${this.authorProfile.arxivCategories.join(", ")}`;
      content.appendChild(catEl);
    }

    if (this.authorProfile?.advisors?.length) {
      const advisors = this.authorProfile.advisors
        .map((advisor) => advisor.name)
        .filter(Boolean)
        .join(", ");
      if (advisors) {
        const advisorEl = doc.createElement("div");
        advisorEl.style.fontSize = "12px";
        advisorEl.style.color = "var(--fill-secondary, #64748b)";
        advisorEl.style.marginTop = "4px";
        advisorEl.textContent = `${getString("references-panel-author-advisors")}: ${advisors}`;
        content.appendChild(advisorEl);
      }
    }

    const links = this.buildAuthorProfileLinks(doc);
    if (links) {
      content.appendChild(links);
    }
  }

  private buildAuthorProfileLinks(doc: Document): HTMLDivElement | null {
    if (!this.authorProfile) {
      return null;
    }
    const links = doc.createElement("div");
    links.style.display = "flex";
    links.style.flexWrap = "wrap";
    links.style.gap = "10px";
    links.style.marginTop = "6px";
    const copiedText = getString("references-panel-author-copied");
    const dark = isDarkMode();

    // Email link - first in the row, with right-click copy
    if (this.authorProfile.emails?.length) {
      const email = this.authorProfile.emails[0];
      const emailLink = doc.createElement("a");
      applyMetaLinkStyle(emailLink, dark);
      emailLink.href = `mailto:${encodeURIComponent(email)}`;
      emailLink.textContent = `📧 Email`;
      emailLink.title = email; // Show full email on hover
      emailLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(emailLink.href);
      });
      attachCopyableValue(emailLink, email, copiedText);
      links.appendChild(emailLink);
    }

    // ORCID link with right-click copy
    if (this.authorProfile.orcid) {
      const orcid = this.authorProfile.orcid;
      const orcidLink = doc.createElement("a");
      applyMetaLinkStyle(orcidLink, dark);
      orcidLink.href = `https://orcid.org/${encodeURIComponent(orcid)}`;
      orcidLink.textContent = `🆔 ORCID`;
      orcidLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(orcidLink.href);
      });
      attachCopyableValue(orcidLink, orcid, copiedText);
      links.appendChild(orcidLink);
    }

    // INSPIRE link (no right-click copy)
    if (this.authorProfile.recid) {
      const recid = this.authorProfile.recid;
      const inspireLink = doc.createElement("a");
      applyMetaLinkStyle(inspireLink, dark);
      inspireLink.href = `https://inspirehep.net/authors/${encodeURIComponent(recid)}`;
      inspireLink.textContent = "🔗 INSPIRE";
      inspireLink.title = getString("references-panel-author-inspire-tooltip");
      inspireLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(inspireLink.href);
      });
      links.appendChild(inspireLink);
    }

    // Homepage link
    if (this.authorProfile.homepageUrl) {
      const homepageLink = doc.createElement("a");
      applyMetaLinkStyle(homepageLink, dark);
      homepageLink.href = this.authorProfile.homepageUrl;
      homepageLink.title = getString("references-panel-author-homepage-tooltip");
      homepageLink.textContent = "🌐 Home";
      homepageLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(homepageLink.href);
      });
      links.appendChild(homepageLink);
    }

    return links.children.length ? links : null;
  }

  /**
   * Show author papers in the entryCited tab.
   * Uses BAI for precise search if available, otherwise converts full name to search query.
   */
  private async showAuthorPapersTab(authorInfo: AuthorSearchInfo) {
    if (!authorInfo.fullName) {
      this.showToast(getString("references-panel-toast-missing"));
      return;
    }
    this.hideAuthorPreviewCard();
    // Generate cache key: priority recid > BAI > name
    let authorQuery: string;
    if (authorInfo.recid) {
      authorQuery = `recid:${authorInfo.recid}`;
    } else if (authorInfo.bai) {
      authorQuery = `bai:${authorInfo.bai}`;
    } else {
      // Use name-based query
      authorQuery = convertFullNameToSearchQuery(authorInfo.fullName);
    }
    if (!authorQuery) {
      this.showToast(getString("references-panel-toast-missing"));
      return;
    }
    const previousMode =
      this.viewMode === "entryCited"
        ? this.entryCitedPreviousMode
        : this.viewMode;
    if (
      previousMode === "references" ||
      previousMode === "citedBy" ||
      previousMode === "search"
    ) {
      this.entryCitedPreviousMode = previousMode;
    }
    const queryChanged = this.entryCitedSource?.authorQuery !== authorQuery;
    this.pendingEntryScrollReset = true;
    if (this.viewMode !== "entryCited") {
      this.entryCitedReturnScroll = this.captureScrollState();
    } else if (queryChanged) {
      this.entryCitedReturnScroll = undefined;
    }
    // Use shortened display label for the author (just the name, not "Papers by X")
    const displayLabel =
      authorInfo.fullName.length > 30
        ? authorInfo.fullName.substring(0, 27) + "..."
        : authorInfo.fullName;
    this.entryCitedSource = {
      authorQuery,
      authorSearchInfo: authorInfo,
      label: displayLabel, // Just the author name, message templates will add "Papers by"
    };
    this.prepareAuthorProfileState(authorInfo);
    this.updateTabSelection();
    if (this.viewMode !== "entryCited") {
      await this.activateViewMode("entryCited").catch(() => void 0);
      this.resetListScroll();
      this.pendingEntryScrollReset = false;
      this.updateAuthorProfileCard();
      return;
    }
    if (queryChanged) {
      // Use authorQuery as the cache key for loadEntries
      await this.loadEntries(authorQuery, "entryCited", {
        force: true,
        resetScroll: true,
      }).catch(() => void 0);
      this.pendingEntryScrollReset = false;
    } else {
      this.renderReferenceList();
      this.resetListScroll();
      this.pendingEntryScrollReset = false;
    }
    this.updateAuthorProfileCard();
  }

  private async exitEntryCitedTab() {
    if (this.viewMode !== "entryCited") {
      return;
    }
    const target =
      this.entryCitedPreviousMode === "citedBy"
        ? "citedBy"
        : this.entryCitedPreviousMode === "search"
          ? "search"
          : "references";
    const scrollState = this.entryCitedReturnScroll;
    await this.activateViewMode(target).catch(() => void 0);
    this.applyScrollState(scrollState);
    this.entryCitedReturnScroll = undefined;
  }

  private isCurrentItemRelated(localItem: Zotero.Item) {
    if (!this.currentItemID) {
      return false;
    }
    const currentItem = Zotero.Items.get(this.currentItemID);
    if (!currentItem) {
      return false;
    }
    const relatedKeys = currentItem.relatedItems || [];
    const compositeKey = `${localItem.libraryID}/${localItem.key}`;
    return (
      relatedKeys.includes(localItem.key) || relatedKeys.includes(compositeKey)
    );
  }

  private async linkExistingReference(localItemID: number) {
    if (!this.currentItemID || localItemID === this.currentItemID) {
      return;
    }
    const currentItem = Zotero.Items.get(this.currentItemID);
    const targetItem = Zotero.Items.get(localItemID);
    if (!currentItem || !targetItem) {
      return;
    }
    const updated = currentItem.addRelatedItem(targetItem);
    if (targetItem.addRelatedItem(currentItem)) {
      await targetItem.saveTx();
    }
    if (updated) {
      await currentItem.saveTx();
      this.showToast(getString("references-panel-toast-linked"));
    }
  }

  private async unlinkReference(localItemID: number) {
    if (!this.currentItemID || localItemID === this.currentItemID) {
      return;
    }
    const currentItem = Zotero.Items.get(this.currentItemID);
    const targetItem = Zotero.Items.get(localItemID);
    if (!currentItem || !targetItem) {
      return;
    }
    const updated = await currentItem.removeRelatedItem(targetItem);
    if (await targetItem.removeRelatedItem(currentItem)) {
      await targetItem.saveTx();
    }
    if (updated) {
      await currentItem.saveTx();
      this.showToast(
        getString("references-panel-toast-unlinked") || "Related item unlinked",
      );
    }
  }

  private async handleAddAction(
    entry: InspireReferenceEntry,
    anchor: HTMLElement,
  ) {
    if (entry.localItemID) {
      return;
    }
    if (!entry.recid) {
      this.showToast(getString("references-panel-toast-missing"));
      return;
    }
    const selection = await this.promptForSaveTarget(anchor);
    if (!selection) {
      return;
    }
    const newItem = await this.importReference(entry.recid, selection);
    if (newItem) {
      entry.localItemID = newItem.id;
      entry.displayText = buildDisplayText(entry);
      // Invalidate searchText so it will be recalculated on next filter
      entry.searchText = "";
      entry.isRelated = false;
      this.renderReferenceList({ preserveScroll: true });
      // Restore scroll position after rendering if needed
      setTimeout(() => {
        this.restoreScrollPositionIfNeeded();
      }, 0);
    }
  }

  private async importReference(recid: string, target: SaveTargetSelection) {
    const currentItem = this.currentItemID
      ? Zotero.Items.get(this.currentItemID)
      : null;
    if (!currentItem) {
      return null;
    }
    const meta = await fetchInspireMetaByRecid(recid);
    if (meta === -1) {
      this.showToast(getString("references-panel-toast-missing"));
      return null;
    }
    const pane = Zotero.getActiveZoteroPane();
    const originalItemID = this.currentItemID;
    const scrollState = this.captureScrollState();

    const newItem = new Zotero.Item("journalArticle");
    newItem.libraryID = target.libraryID ?? currentItem.libraryID;
    const targetCollectionIDs = Array.from(
      new Set(target.collectionIDs),
    ).filter((id): id is number => typeof id === "number");
    newItem.setField("extra", "");
    if (targetCollectionIDs.length) {
      newItem.setCollections(targetCollectionIDs);
    } else {
      newItem.setCollections([]);
    }

    if (target.tags && target.tags.length) {
      for (const tag of target.tags) {
        newItem.addTag(tag);
      }
    }

    await setInspireMeta(newItem, meta as jsobject, "full");
    await saveItemWithPendingInspireNote(newItem);

    if (target.note) {
      const newNote = new Zotero.Item("note");
      newNote.setNote(target.note);
      newNote.parentID = newItem.id;
      newNote.libraryID = newItem.libraryID;
      await newNote.saveTx();
    }

    this.rememberRecentTarget(target.primaryRowID);

    // Save scroll state so switching back to the original item restores the view
    if (originalItemID) {
      this.pendingScrollRestore = {
        itemID: originalItemID,
        scrollTop: scrollState.scrollTop,
        scrollLeft: scrollState.scrollLeft,
        scrollSnapshots: scrollState.scrollSnapshots,
        activeElement: scrollState.activeElement,
      };

      // Try to restore immediately if itemPane is still showing the original item
      setTimeout(() => {
        this.restoreScrollPositionIfNeeded();
      }, 0);
    }
    this.showToast(getString("references-panel-toast-added"));
    return newItem;
  }

  private renderMessage(message: string) {
    // Recycle existing rows to pool before clearing (only up to pool capacity)
    this.recycleRowsToPool();

    // PERF FIX: Async removal of old container to avoid blocking UI
    // Instead of synchronous replaceChild (which blocks while detaching 10000+ nodes),
    // we hide the old container, insert new one, then remove old one asynchronously
    // Clean up old event listeners first
    this.cleanupEventDelegation();
    const doc = this.listEl.ownerDocument;
    const oldListEl = this.listEl;
    const newListEl = doc.createElement("div");
    newListEl.className = oldListEl.className;
    // Copy essential attributes
    if (oldListEl.id) newListEl.id = oldListEl.id;
    // FTR-KEYBOARD-NAV-FULL: Make list focusable for keyboard navigation
    newListEl.tabIndex = -1;
    newListEl.style.outline = "none";
    // Hide old container immediately (no reflow)
    oldListEl.style.display = "none";
    // Insert new container after old one
    oldListEl.parentNode?.insertBefore(newListEl, oldListEl.nextSibling);
    this.listEl = newListEl;
    // Re-register event delegation on new container
    this.setupEventDelegation();
    // Remove old container asynchronously (doesn't block UI)
    setTimeout(() => {
      oldListEl.remove();
    }, 0);

    const empty = this.listEl.ownerDocument.createElement("div");
    empty.classList.add("zinspire-ref-panel__empty");
    empty.textContent = message;
    this.listEl.appendChild(empty);

    this.setStatus(message);

    this.chartNeedsRefresh = true;
    this.lastRenderedEntries = [];
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  private cancelActiveRequest() {
    try {
      this.activeAbort?.abort();
    } catch (_err) {
      // Ignore abort errors for environments without AbortController
    }
    this.activeAbort = undefined;
  }

  private async promptForSaveTarget(
    anchor: HTMLElement,
  ): Promise<SaveTargetSelection | null> {
    const recentTargets = this.getRecentTargets();
    const targets = this.buildSaveTargets(recentTargets.ids);
    if (!targets.length) {
      this.showToast(getString("references-panel-picker-empty"));
      return null;
    }
    let defaultID = this.getDefaultTargetID();
    if (!defaultID) {
      defaultID = recentTargets.ordered[0] || targets[0]?.id || null;
    }
    return this.showTargetPicker(targets, defaultID, anchor);
  }

  private buildSaveTargets(recentIDs: Set<string>): SaveTargetRow[] {
    const targets: SaveTargetRow[] = [];
    for (const library of Zotero.Libraries.getAll()) {
      if (!library?.editable) {
        continue;
      }
      const libraryID = library.libraryID;
      const libraryRow: SaveTargetRow = {
        id: `L${libraryID}`,
        name: library.name,
        level: 0,
        type: "library",
        libraryID,
        filesEditable: library.filesEditable,
        recent: recentIDs.has(`L${libraryID}`),
      };
      targets.push(libraryRow);
      const collections =
        Zotero.Collections.getByLibrary(libraryID, true) || [];
      for (const collection of collections) {
        const rawLevel = (collection as any)?.level;
        const level = typeof rawLevel === "number" ? rawLevel + 1 : 1;
        const row: SaveTargetRow = {
          id: collection.treeViewID,
          name: collection.name,
          level,
          type: "collection",
          libraryID,
          collectionID: collection.id,
          filesEditable: library.filesEditable,
          parentID: collection.parentID
            ? `C${collection.parentID}`
            : `L${libraryID}`,
          recent: recentIDs.has(collection.treeViewID),
        };
        targets.push(row);
      }
    }
    return targets;
  }

  private getDefaultTargetID(): string | null {
    const pane = Zotero.getActiveZoteroPane();
    if (pane?.getSelectedCollection()) {
      const selected = pane.getSelectedCollection();
      if (selected) {
        return `C${selected.id}`;
      }
    }
    const libraryID =
      pane?.getSelectedLibraryID() ?? Zotero.Libraries.userLibrary?.libraryID;
    return libraryID ? `L${libraryID}` : null;
  }

  private getRecentTargets() {
    const ids = new Set<string>();
    const ordered: string[] = [];
    try {
      const raw = Zotero.Prefs.get("recentSaveTargets") as string | undefined;
      if (!raw) {
        return { ids, ordered };
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry?.id && typeof entry.id === "string") {
            ids.add(entry.id);
            ordered.push(entry.id);
          }
        }
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to parse recentSaveTargets: ${err}`,
      );
      Zotero.Prefs.clear("recentSaveTargets");
    }
    return { ids, ordered };
  }

  private rememberRecentTarget(targetID: string) {
    try {
      const raw = Zotero.Prefs.get("recentSaveTargets") as string | undefined;
      let entries: Array<{ id: string }> = [];
      if (raw) {
        entries = JSON.parse(raw);
      }
      if (!Array.isArray(entries)) {
        entries = [];
      }
      entries = entries.filter((entry) => entry?.id !== targetID);
      entries.unshift({ id: targetID });
      Zotero.Prefs.set(
        "recentSaveTargets",
        JSON.stringify(entries.slice(0, 5)),
      );
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to update recentSaveTargets: ${err}`,
      );
      Zotero.Prefs.clear("recentSaveTargets");
    }
  }

  private showTargetPicker(
    targets: SaveTargetRow[],
    defaultID: string | null,
    anchor: HTMLElement,
  ): Promise<SaveTargetSelection | null> {
    return showTargetPickerUI(
      targets,
      defaultID,
      anchor,
      this.body,
      this.listEl,
    );
  }

  private showToast(message: string) {
    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
    const toast = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    toast.win.changeHeadline(config.addonName, icon);
    toast.createLine({ text: message });
    toast.show();
    toast.startCloseTimer(3000);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Abstract tooltip methods
  // ─────────────────────────────────────────────────────────────────────────────

  private scheduleAbstractTooltip(
    entry: InspireReferenceEntry,
    event: MouseEvent,
  ) {
    // Clear any existing timeout
    if (this.abstractHoverTimeout) {
      clearTimeout(this.abstractHoverTimeout);
    }
    // Cancel any pending fetch/hide timers
    this.cancelTooltipHide();
    this.abstractAbort?.abort();

    // Delay before showing tooltip
    this.abstractHoverTimeout = setTimeout(() => {
      this.showAbstractTooltip(entry, event);
    }, this.tooltipShowDelay);
  }

  private async showAbstractTooltip(
    entry: InspireReferenceEntry,
    event: MouseEvent,
  ) {
    // Use the main Zotero window document for reliable tooltip placement
    const mainWindow = Zotero.getMainWindow();
    const doc = mainWindow?.document || this.body.ownerDocument;

    // Create tooltip if not exists
    if (!this.abstractTooltip) {
      this.abstractTooltip = doc.createElement("div");
      this.abstractTooltip.classList.add("zinspire-abstract-tooltip");
      applyAbstractTooltipStyle(this.abstractTooltip);
      // Append to the main document's root element
      // In Zotero 7, we need to find a suitable container that supports fixed positioning
      const tooltipContainer =
        doc.getElementById("browser") || // Zotero main browser element
        doc.documentElement ||
        doc.body;
      if (tooltipContainer) {
        tooltipContainer.appendChild(this.abstractTooltip);
      }
      // Add event listeners to keep tooltip visible when mouse is over it
      this.abstractTooltip.addEventListener("mouseenter", () => {
        this.cancelTooltipHide();
      });
      this.abstractTooltip.addEventListener("mouseleave", () => {
        this.scheduleTooltipHide();
      });
    }

    // Get cached strings for performance
    const s = getCachedStrings();

    // Position the tooltip
    this.positionTooltip(event);
    this.abstractTooltip.style.display = "block";

    // Check if we already have the abstract cached
    if (entry.abstract !== undefined) {
      const cached =
        entry.abstract && entry.abstract.trim().length
          ? entry.abstract
          : s.noAbstract;
      this.renderAbstractContent(cached);
      return;
    }

    // Show loading state
    this.abstractTooltip.textContent =
      s.loadingAbstract || "Loading abstract...";

    // Try to get abstract from local library first
    if (entry.localItemID) {
      const localItem = Zotero.Items.get(entry.localItemID);
      if (localItem) {
        const localAbstract = localItem.getField("abstractNote") as string;
        if (localAbstract?.trim()) {
          entry.abstract = localAbstract.trim();
          if (this.abstractTooltip) {
            this.renderAbstractContent(entry.abstract);
          }
          return;
        }
      }
    }

    // Fetch from INSPIRE API if not in library or no abstract locally
    if (entry.recid) {
      entry.abstractLoading = true;
      const supportsAbort =
        typeof AbortController !== "undefined" &&
        typeof AbortController === "function";
      const controller = supportsAbort ? new AbortController() : null;
      this.abstractAbort = controller ?? undefined;
      try {
        const abstract = await fetchInspireAbstract(
          entry.recid,
          this.abstractAbort?.signal,
        );
        entry.abstract = abstract || "";
        entry.abstractLoading = false;
        if (
          this.abstractTooltip &&
          this.abstractTooltip.style.display !== "none"
        ) {
          this.renderAbstractContent(entry.abstract || s.noAbstract);
        }
      } catch (_err) {
        entry.abstractLoading = false;
        if (
          this.abstractTooltip &&
          this.abstractTooltip.style.display !== "none"
        ) {
          this.abstractTooltip.textContent =
            s.noAbstract || "No abstract available";
        }
      }
    } else {
      entry.abstract = "";
      this.abstractTooltip.textContent =
        s.noAbstract || "No abstract available";
    }
  }

  /**
   * Render abstract content with LaTeX math converted to Unicode
   * Uses ^ and _ for superscripts/subscripts instead of HTML tags
   */
  private renderAbstractContent(abstract: string) {
    if (!this.abstractTooltip) return;

    // Process LaTeX math in the abstract
    let processed = cleanMathTitle(abstract);

    // Convert HTML sup/sub tags to ^ and _ notation
    processed = processed
      .replace(/<sup>([^<]+)<\/sup>/g, "^$1")
      .replace(/<sub>([^<]+)<\/sub>/g, "_$1");

    // Use textContent for safety (no HTML injection)
    this.abstractTooltip.textContent = processed;
  }

  /**
   * Handle BibTeX copy button click.
   * Fetches BibTeX from INSPIRE and copies to clipboard.
   */
  private async handleBibTeXCopy(
    entry: InspireReferenceEntry,
    button: HTMLButtonElement,
  ) {
    if (!entry.recid) {
      return;
    }

    const originalText = button.textContent;
    button.textContent = "⏳";
    button.disabled = true;

    try {
      const bibtex = await fetchBibTeX(entry.recid);
      if (bibtex) {
        const success = await copyToClipboard(bibtex);
        if (success) {
          button.textContent = "✓";
          // Show toast notification
          const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
          const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
            closeOnClick: true,
          });
          progressWindow.win.changeHeadline(config.addonName, icon);
          progressWindow.createLine({
            text: getString("references-panel-bibtex-copied"),
            type: "success",
          });
          progressWindow.show();
          progressWindow.startCloseTimer(2000);
        } else {
          throw new Error("Clipboard copy failed");
        }
      } else {
        throw new Error("BibTeX not found");
      }
    } catch (_err) {
      button.textContent = "✗";
      Zotero.debug(`[${config.addonName}] BibTeX copy failed: ${_err}`);
      // Show error toast
      const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
      const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
        closeOnClick: true,
      });
      progressWindow.win.changeHeadline(config.addonName, icon);
      progressWindow.createLine({
        text: getString("references-panel-bibtex-failed"),
        type: "fail",
      });
      progressWindow.show();
      progressWindow.startCloseTimer(2000);
    }

    // Restore original state after brief delay
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1500);
  }

  private hideAbstractTooltip() {
    // Schedule hide with a small delay to allow mouse to move to tooltip
    this.scheduleTooltipHide();
  }

  private handleTitleMouseLeave(event: MouseEvent) {
    const related = event.relatedTarget as Node | null;
    if (
      related &&
      this.abstractTooltip &&
      (related === this.abstractTooltip ||
        this.abstractTooltip.contains(related))
    ) {
      // Pointer is moving toward the tooltip, keep delayed hide
      this.hideAbstractTooltip();
      return;
    }
    // Pointer is moving elsewhere; hide immediately
    this.doHideTooltip();
  }

  private scheduleTooltipHide() {
    // Clear any existing hide timeout
    this.cancelTooltipHide();
    // Schedule hide after a short delay (allows user to move mouse to tooltip)
    this.abstractHideTimeout = setTimeout(() => {
      this.doHideTooltip();
    }, this.tooltipHideDelay);
  }

  private cancelTooltipHide() {
    if (this.abstractHideTimeout) {
      clearTimeout(this.abstractHideTimeout);
      this.abstractHideTimeout = undefined;
    }
  }

  /**
   * Handle TeX key copy button click.
   * Copies INSPIRE texkey to clipboard.
   * Priority: 1) cached texkey, 2) Zotero library citationKey, 3) INSPIRE API
   */
  private async handleTexkeyCopy(
    entry: InspireReferenceEntry,
    button: HTMLButtonElement,
  ) {
    if (!entry.recid && !entry.texkey && !entry.localItemID) {
      return;
    }

    const originalText = button.textContent;
    button.textContent = "⏳";
    button.disabled = true;

    try {
      let texkey = entry.texkey?.trim() || "";

      // Priority 2: Check Zotero library if entry exists locally
      if (!texkey && entry.localItemID) {
        try {
          const item = Zotero.Items.get(entry.localItemID);
          if (item) {
            const citationKey = (
              item.getField("citationKey") as string | undefined
            )?.trim();
            if (citationKey) {
              texkey = citationKey;
              entry.texkey = citationKey;
            }
          }
        } catch {
          // Ignore errors when getting Zotero item
        }
      }

      // Priority 3: Fetch from INSPIRE API
      if (!texkey && entry.recid) {
        texkey = (await fetchInspireTexkey(entry.recid)) || "";
        if (texkey) {
          entry.texkey = texkey;
        }
      }

      if (!texkey) {
        throw new Error("Texkey not found");
      }

      const success = await copyToClipboard(texkey);
      if (success) {
        button.textContent = "✓";
        const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
        const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
          closeOnClick: true,
        });
        progressWindow.win.changeHeadline(config.addonName, icon);
        progressWindow.createLine({
          text: getString("references-panel-texkey-copied"),
          type: "success",
        });
        progressWindow.show();
        progressWindow.startCloseTimer(2000);
      } else {
        throw new Error("Clipboard copy failed");
      }
    } catch (_err) {
      button.textContent = "✗";
      Zotero.debug(`[${config.addonName}] Texkey copy failed: ${_err}`);
      const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
      const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
        closeOnClick: true,
      });
      progressWindow.win.changeHeadline(config.addonName, icon);
      progressWindow.createLine({
        text: getString("references-panel-texkey-failed"),
        type: "fail",
      });
      progressWindow.show();
      progressWindow.startCloseTimer(2000);
    }

    // Restore original state after brief delay
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1500);
  }

  private getAuthorPreviewCard(): HTMLDivElement {
    if (!this.authorPreviewCard) {
      const mainWindow = Zotero.getMainWindow();
      const doc = mainWindow?.document || this.body.ownerDocument;
      const card = doc.createElement("div");
      card.classList.add("zinspire-author-preview-card");
      applyAuthorPreviewCardStyle(card);
      card.style.display = "none";
      card.addEventListener("mouseenter", () => {
        this.cancelAuthorPreviewHide();
      });
      card.addEventListener("mouseleave", () => {
        this.scheduleAuthorPreviewHide();
      });
      const container =
        doc.getElementById("browser") || doc.documentElement || doc.body;
      container?.appendChild(card);
      this.authorPreviewCard = card;
    }
    return this.authorPreviewCard;
  }

  private scheduleAuthorPreview(
    entry: InspireReferenceEntry,
    authorIndex: number,
    anchor: HTMLElement,
  ) {
    this.cancelAuthorPreviewShow();
    this.cancelAuthorPreviewHide();
    this.authorPreviewAnchor = anchor;
    this.authorPreviewShowTimeout = setTimeout(() => {
      this.showAuthorPreview(entry, authorIndex, anchor);
    }, this.authorPreviewShowDelay);
  }

  private cancelAuthorPreviewShow() {
    if (this.authorPreviewShowTimeout) {
      clearTimeout(this.authorPreviewShowTimeout);
      this.authorPreviewShowTimeout = undefined;
    }
  }

  private scheduleAuthorPreviewHide() {
    this.cancelAuthorPreviewHide();
    this.authorPreviewHideTimeout = setTimeout(() => {
      this.hideAuthorPreviewCard();
    }, this.authorPreviewHideDelay);
  }

  private cancelAuthorPreviewHide() {
    if (this.authorPreviewHideTimeout) {
      clearTimeout(this.authorPreviewHideTimeout);
      this.authorPreviewHideTimeout = undefined;
    }
  }

  private buildAuthorInfoFromEntry(
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

  private showAuthorPreview(
    entry: InspireReferenceEntry,
    authorIndex: number,
    anchor: HTMLElement,
  ) {
    const authorInfo = this.buildAuthorInfoFromEntry(entry, authorIndex);
    if (!authorInfo) {
      return;
    }
    const key = this.getAuthorProfileKey(authorInfo);
    const card = this.getAuthorPreviewCard();
    this.authorPreviewCurrentKey = key;
    this.renderAuthorPreviewCard(card, authorInfo, undefined);
    this.positionAuthorPreviewCard(card, anchor);

    this.authorPreviewAbort?.abort();
    const supportsAbort =
      typeof AbortController !== "undefined" &&
      typeof AbortController === "function";
    this.authorPreviewAbort = supportsAbort ? new AbortController() : undefined;
    const signal = this.authorPreviewAbort?.signal;
    fetchAuthorProfile(authorInfo, signal)
      .then((profile) => {
        if (this.authorPreviewCurrentKey !== key) {
          return;
        }
        this.renderAuthorPreviewCard(card, authorInfo, profile);
        this.positionAuthorPreviewCard(card, anchor);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") {
          return;
        }
        if (this.authorPreviewCurrentKey === key) {
          this.renderAuthorPreviewCard(card, authorInfo, null);
        }
      });
  }

  private renderAuthorPreviewCard(
    card: HTMLDivElement,
    authorInfo: AuthorSearchInfo,
    profile: InspireAuthorProfile | null | undefined,
  ) {
    const doc = card.ownerDocument;
    card.replaceChildren();
    const copiedText = getString("references-panel-author-copied");
    const dark = isDarkMode();

    // Title with name and BAI in parentheses (no copy interaction)
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

    if (profile?.currentPosition?.institution) {
      const inst = doc.createElement("div");
      inst.style.color = "var(--fill-secondary, #64748b)";
      inst.textContent = profile.currentPosition.institution;
      card.appendChild(inst);
    }

    if (profile?.arxivCategories?.length) {
      const cats = doc.createElement("div");
      cats.style.color = "var(--fill-secondary, #64748b)";
      cats.textContent = `🔬 ${profile.arxivCategories.join(", ")}`;
      card.appendChild(cats);
    }

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

    const actions = doc.createElement("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    actions.style.marginTop = "6px";

    // Email link - first in the row, with right-click copy
    if (profile?.emails?.length) {
      const email = profile.emails[0];
      const emailLink = doc.createElement("a");
      applyMetaLinkStyle(emailLink, dark);
      emailLink.href = `mailto:${encodeURIComponent(email)}`;
      emailLink.textContent = `📧 Email`;
      emailLink.title = email; // Show full email on hover
      emailLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(emailLink.href);
      });
      attachCopyableValue(emailLink, email, copiedText);
      actions.appendChild(emailLink);
    }

    // ORCID link with right-click copy
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

    // INSPIRE link (no right-click copy)
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

    const viewLink = doc.createElement("a");
    applyMetaLinkStyle(viewLink, dark);
    viewLink.href = "#";
    viewLink.textContent = getString("references-panel-author-preview-view-papers");
    viewLink.addEventListener("click", (event) => {
      event.preventDefault();
      this.hideAuthorPreviewCard();
      this.showAuthorPapersTab(authorInfo).catch(() => void 0);
    });
    actions.appendChild(viewLink);

    if (actions.children.length) {
      card.appendChild(actions);
    }

    card.style.display = "block";
  }

  private positionAuthorPreviewCard(card: HTMLDivElement, anchor: HTMLElement) {
    const win = this.body.ownerDocument.defaultView || Zotero.getMainWindow();
    const rect = anchor.getBoundingClientRect();
    const spacing = 8;
    const cardWidth = card.offsetWidth || 220;
    const cardHeight = card.offsetHeight || 120;

    let left = rect.right + spacing;
    if (left + cardWidth > win.innerWidth - spacing) {
      left = rect.left - cardWidth - spacing;
    }
    if (left < spacing) {
      left = spacing;
    }

    let top = rect.top;
    if (top + cardHeight > win.innerHeight - spacing) {
      top = rect.bottom - cardHeight;
    }
    if (top < spacing) {
      top = spacing;
    }

    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  private hideAuthorPreviewCard() {
    this.cancelAuthorPreviewShow();
    this.cancelAuthorPreviewHide();
    this.authorPreviewAbort?.abort();
    this.authorPreviewAbort = undefined;
    this.authorPreviewCurrentKey = undefined;
    this.authorPreviewAnchor = undefined;
    if (this.authorPreviewCard) {
      this.authorPreviewCard.style.display = "none";
      this.authorPreviewCard.replaceChildren();
    }
  }

  private doHideTooltip() {
    // Clear show timeout
    if (this.abstractHoverTimeout) {
      clearTimeout(this.abstractHoverTimeout);
      this.abstractHoverTimeout = undefined;
    }
    // Cancel any pending RAF for tooltip position update
    if (this.tooltipRAF) {
      const win =
        this.body.ownerDocument?.defaultView || Zotero.getMainWindow();
      const caf = win.cancelAnimationFrame || win.clearTimeout;
      caf(this.tooltipRAF);
      this.tooltipRAF = undefined;
    }
    // Cancel any pending fetch
    this.abstractAbort?.abort();
    this.abstractAbort = undefined;

    // Hide tooltip
    if (this.abstractTooltip) {
      this.abstractTooltip.style.display = "none";
      this.abstractTooltip.textContent = "";
    }
  }

  private updateTooltipPosition(event: MouseEvent) {
    // Throttle tooltip position updates using requestAnimationFrame
    // This prevents excessive DOM updates during fast mouse movement
    if (this.tooltipRAF) {
      return; // Skip if previous frame hasn't rendered yet
    }
    const win = this.body.ownerDocument?.defaultView || Zotero.getMainWindow();
    const raf =
      win.requestAnimationFrame ||
      ((cb: FrameRequestCallback) => win.setTimeout(cb, RAF_FALLBACK_MS));
    this.tooltipRAF = raf(() => {
      this.tooltipRAF = undefined;
      if (
        this.abstractTooltip &&
        this.abstractTooltip.style.display !== "none"
      ) {
        this.positionTooltip(event);
      }
    });
  }

  private positionTooltip(event: MouseEvent) {
    if (!this.abstractTooltip) return;

    // Use screen coordinates for more reliable positioning across different contexts
    const mainWindow = Zotero.getMainWindow();
    const doc = mainWindow?.document || this.body.ownerDocument;
    const viewportWidth = doc.documentElement?.clientWidth || 800;
    const viewportHeight = doc.documentElement?.clientHeight || 600;

    // Use clientX/clientY which are relative to the viewport
    let left = event.clientX + 15;
    let top = event.clientY + 15;

    // Get tooltip dimensions (estimate if not yet rendered)
    const tooltipWidth = this.abstractTooltip.offsetWidth || 400;
    const tooltipHeight = this.abstractTooltip.offsetHeight || 150;

    // Adjust if tooltip would go off screen
    if (left + tooltipWidth > viewportWidth - 10) {
      left = Math.max(10, event.clientX - tooltipWidth - 15);
    }
    if (top + tooltipHeight > viewportHeight - 10) {
      top = Math.max(10, event.clientY - tooltipHeight - 15);
    }

    // Ensure minimum position
    left = Math.max(10, left);
    top = Math.max(10, top);

    this.abstractTooltip.style.left = `${left}px`;
    this.abstractTooltip.style.top = `${top}px`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hover Preview Card Methods (FTR-HOVER-PREVIEW)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create and initialize the preview card element (FTR-HOVER-PREVIEW)
   */
  private createPreviewCard(): HTMLDivElement {
    const mainWindow = Zotero.getMainWindow();
    const doc = mainWindow?.document || this.body.ownerDocument;

    const card = doc.createElement("div");
    card.classList.add("zinspire-preview-card");
    applyPreviewCardStyle(card);

    // Find suitable container
    const container =
      doc.getElementById("browser") || doc.documentElement || doc.body;
    if (container) {
      container.appendChild(card);
    }

    // Keep card visible when mouse enters it
    card.addEventListener("mouseenter", () => {
      this.cancelPreviewHide();
    });

    // Schedule hide when mouse leaves card
    card.addEventListener("mouseleave", () => {
      this.schedulePreviewHide();
    });

    return card;
  }

  /**
   * Get or create the preview card element
   */
  private getPreviewCard(): HTMLDivElement {
    if (!this.previewCard) {
      this.previewCard = this.createPreviewCard();
    }
    return this.previewCard;
  }

  /**
   * Schedule preview card to show after delay
   */
  private schedulePreviewShow(entry: InspireReferenceEntry, row: HTMLElement) {
    this.cancelPreviewShow();
    this.cancelPreviewHide();

    this.previewShowTimeout = setTimeout(() => {
      this.showPreviewCard(entry, row);
    }, this.previewShowDelay);
  }

  /**
   * Cancel scheduled preview show
   */
  private cancelPreviewShow() {
    if (this.previewShowTimeout) {
      clearTimeout(this.previewShowTimeout);
      this.previewShowTimeout = undefined;
    }
  }

  /**
   * Schedule preview card to hide after delay
   */
  private schedulePreviewHide() {
    this.cancelPreviewHide();
    this.previewHideTimeout = setTimeout(() => {
      this.hidePreviewCard();
    }, this.previewHideDelay);
  }

  /**
   * Cancel scheduled preview hide
   */
  private cancelPreviewHide() {
    if (this.previewHideTimeout) {
      clearTimeout(this.previewHideTimeout);
      this.previewHideTimeout = undefined;
    }
  }

  /**
   * Immediately hide the preview card
   */
  private hidePreviewCard() {
    this.cancelPreviewShow();
    this.cancelPreviewHide();

    // Cancel any pending abstract fetch
    this.previewAbortController?.abort();
    this.previewAbortController = undefined;

    this.previewCurrentEntryId = undefined;
    // FTR-HOVER-PREVIEW-MULTI: Clear pagination state
    this.previewEntries = [];
    this.previewCurrentIndex = 0;
    this.previewLabel = undefined;
    this.previewButtonRect = undefined;

    if (this.previewCard) {
      this.previewCard.style.display = "none";
      // PERF-FIX-15: Use replaceChildren() instead of innerHTML = ""
      this.previewCard.replaceChildren();
    }
  }

  /**
   * Show the preview card with entry details (FTR-HOVER-PREVIEW)
   */
  private showPreviewCard(entry: InspireReferenceEntry, row: HTMLElement) {
    // Skip if already showing this entry
    if (this.previewCurrentEntryId === entry.id) {
      return;
    }

    // Hide any existing abstract tooltip to avoid visual conflict
    this.hideAbstractTooltipImmediate();

    this.previewCurrentEntryId = entry.id;
    const card = this.getPreviewCard();
    const doc = card.ownerDocument;

    // Clear previous content
    // PERF-FIX-15: Use replaceChildren() instead of innerHTML = ""
    card.replaceChildren();

    // Build card content
    this.buildPreviewCardContent(card, entry, doc);

    // Position the card relative to the row
    this.positionPreviewCard(card, row);

    // Show the card
    card.style.display = "block";

    // Fetch abstract if not already cached
    this.fetchPreviewAbstract(entry, card);
  }

  /**
   * Build the preview card content (FTR-HOVER-PREVIEW)
   */
  private buildPreviewCardContent(
    card: HTMLDivElement,
    entry: InspireReferenceEntry,
    doc: Document,
  ) {
    const s = getCachedStrings();
    const dark = isDarkMode();

    // Title
    const titleEl = doc.createElement("div");
    titleEl.classList.add("zinspire-preview-card__title");
    applyPreviewCardTitleStyle(titleEl);
    // Process LaTeX in title
    const cleanedTitle = cleanMathTitle(entry.title || "");
    // Use innerHTML to render <sup>/<sub> tags from cleanMathTitle
    titleEl.innerHTML = cleanedTitle || s.noTitle;
    card.appendChild(titleEl);

    // Authors - use formatAuthors() which respects max_authors setting
    // This handles large collaborations (>50 authors) properly
    if (entry.authors?.length) {
      const authorsEl = doc.createElement("div");
      authorsEl.classList.add("zinspire-preview-card__authors");
      applyPreviewCardSectionStyle(authorsEl);
      // formatAuthors already respects getPref("max_authors") and LARGE_COLLABORATION_THRESHOLD
      authorsEl.textContent = formatAuthors(entry.authors, entry.totalAuthors);
      card.appendChild(authorsEl);
    }

    // Publication info
    const pubInfo = formatPublicationInfo(entry.publicationInfo, entry.year);
    if (pubInfo) {
      const pubEl = doc.createElement("div");
      pubEl.classList.add("zinspire-preview-card__publication");
      applyPreviewCardSectionStyle(pubEl);
      pubEl.textContent = pubInfo;
      card.appendChild(pubEl);
    }

    // Identifiers row (arXiv, DOI)
    const arxivDetails = formatArxivDetails(entry.arxivDetails);
    const hasArxiv = Boolean(arxivDetails?.id);
    const hasDoi = Boolean(entry.doi);

    if (hasArxiv || hasDoi) {
      const idsEl = doc.createElement("div");
      idsEl.classList.add("zinspire-preview-card__identifiers");
      applyPreviewCardIdentifiersStyle(idsEl);

      // arXiv link
      if (hasArxiv && arxivDetails?.id) {
        const arxivLink = doc.createElement("a");
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

      // DOI link
      if (hasDoi) {
        if (hasArxiv) {
          const sep = doc.createElement("span");
          sep.textContent = " • ";
          sep.style.color = "var(--fill-tertiary, #a0aec0)";
          idsEl.appendChild(sep);
        }
        const doiLink = doc.createElement("a");
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

    // Citation count
    const citationCount = entry.citationCount ?? entry.citationCountWithoutSelf;
    if (typeof citationCount === "number") {
      const citesEl = doc.createElement("div");
      citesEl.classList.add("zinspire-preview-card__citations");
      applyPreviewCardSectionStyle(citesEl);
      citesEl.textContent = getString("references-panel-citation-count", {
        args: { count: citationCount },
      });
      card.appendChild(citesEl);
    }

    // Abstract placeholder (will be filled by fetchPreviewAbstract)
    const abstractEl = doc.createElement("div");
    abstractEl.classList.add("zinspire-preview-card__abstract");
    applyPreviewCardAbstractStyle(abstractEl);
    // FIX: Use same loading text as References panel abstract tooltip for consistency
    abstractEl.textContent = getString("references-panel-loading-abstract");
    card.appendChild(abstractEl);

    // Action row (local status + add/link/unlink buttons)
    this.buildPreviewCardActionRow(card, entry, doc);
  }

  /**
   * FTR-HOVER-PREVIEW: Build the action row for preview card.
   * Shows local status indicator and action buttons (Add/Link/Unlink).
   * Layout: [Buttons] --- [Status Indicator] (buttons closer to mouse for quick access)
   */
  private buildPreviewCardActionRow(
    card: HTMLDivElement,
    entry: InspireReferenceEntry,
    doc: Document,
  ) {
    const s = getCachedStrings();
    const isLocal = Boolean(entry.localItemID);

    const actionRow = doc.createElement("div");
    actionRow.classList.add("zinspire-preview-card__actions");
    Object.assign(actionRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginTop: "8px",
      paddingTop: "8px",
      borderTop: "1px solid var(--fill-quinary, #e2e8f0)",
    });

    // Action button(s) - placed first (left side) for quick mouse access
    if (!isLocal) {
      // Not in library - show Add button
      if (entry.recid) {
        const addButton = this.createPreviewActionButton(
          doc,
          getString("references-panel-button-add"),
          "add",
        );
        addButton.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await this.handleAddAction(entry, card);
          // Update the action row after adding
          this.updatePreviewCardActionRow(card, entry);
        });
        actionRow.appendChild(addButton);
      }
    } else {
      // In library - show Open PDF, Select, then Link/Unlink (most used first)

      // Add "Open PDF" button if item has PDF attachment
      const pdfAttachmentID = this.getFirstPdfAttachmentID(entry.localItemID!);
      if (pdfAttachmentID) {
        const pdfButton = this.createPreviewActionButton(
          doc,
          getString("references-panel-button-open-pdf"),
          "pdf",
        );
        pdfButton.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          // FTR-HOVER-PREVIEW-NAV: Push current state to navigation history
          this.rememberCurrentItemForNavigation();
          InspireReferencePanelController.forwardStack = [];
          await this.openPdfForLocalItem(entry.localItemID!);
          InspireReferencePanelController.syncBackButtonStates();
        });
        actionRow.appendChild(pdfButton);
      }

      // "Select in Library" button
      const selectButton = this.createPreviewActionButton(
        doc,
        getString("references-panel-button-select"),
        "select",
      );
      selectButton.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (entry.localItemID) {
          // FTR-HOVER-PREVIEW-NAV: Push current state to navigation history
          // so user can use Back button to return to current view
          this.rememberCurrentItemForNavigation();
          // Clear forward stack since we're starting a new navigation path
          InspireReferencePanelController.forwardStack = [];

          const pane = Zotero.getActiveZoteroPane();
          pane?.selectItems([entry.localItemID]);
          this.showToast(getString("references-panel-toast-selected"));

          // Update back button states
          InspireReferencePanelController.syncBackButtonStates();
        }
      });
      actionRow.appendChild(selectButton);

      // Link/Unlink button
      const isLinked = Boolean(entry.isRelated);
      const linkButton = this.createPreviewActionButton(
        doc,
        isLinked
          ? getString("references-panel-button-unlink")
          : getString("references-panel-button-link"),
        isLinked ? "unlink" : "link",
      );
      linkButton.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.handleLinkAction(entry, card);
        // Update the action row after linking/unlinking
        this.updatePreviewCardActionRow(card, entry);
      });
      actionRow.appendChild(linkButton);
    }

    // Spacer
    const spacer = doc.createElement("span");
    spacer.style.flex = "1";
    actionRow.appendChild(spacer);

    // Status indicator - placed last (right side)
    const statusEl = doc.createElement("span");
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

    const statusIcon = doc.createElement("span");
    statusIcon.textContent = isLocal ? "●" : "○";
    statusIcon.style.fontSize = "10px";
    statusEl.appendChild(statusIcon);

    const statusText = doc.createElement("span");
    statusText.textContent = isLocal
      ? getString("references-panel-status-local")
      : getString("references-panel-status-online");
    statusEl.appendChild(statusText);

    actionRow.appendChild(statusEl);

    card.appendChild(actionRow);
  }

  /**
   * Create a styled action button for preview card.
   */
  private createPreviewActionButton(
    doc: Document,
    label: string,
    type: "add" | "link" | "unlink" | "select" | "pdf",
  ): HTMLButtonElement {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = label;

    const isDestructive = type === "unlink";
    const isPrimary = type === "add" || type === "link";

    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "4px 10px",
      fontSize: "11px",
      fontWeight: "500",
      borderRadius: "4px",
      border: "1px solid",
      borderColor: isDestructive
        ? "var(--accent-red, #ef4444)"
        : isPrimary
          ? "var(--accent-color, #3b82f6)"
          : "var(--fill-quinary, #d1d5db)",
      background: isPrimary
        ? "var(--accent-color, #3b82f6)"
        : "var(--material-background, #ffffff)",
      color: isPrimary
        ? "#ffffff"
        : isDestructive
          ? "var(--accent-red, #ef4444)"
          : "var(--fill-primary, #374151)",
      cursor: "pointer",
      transition: "all 100ms ease-in-out",
    });

    button.addEventListener("mouseenter", () => {
      if (isPrimary) {
        button.style.opacity = "0.9";
      } else {
        button.style.background = "var(--fill-quinary, #f3f4f6)";
      }
    });

    button.addEventListener("mouseleave", () => {
      if (isPrimary) {
        button.style.opacity = "1";
      } else {
        button.style.background = "var(--material-background, #ffffff)";
      }
    });

    return button;
  }

  /**
   * Update the action row in preview card after state change.
   */
  private updatePreviewCardActionRow(
    card: HTMLDivElement,
    entry: InspireReferenceEntry,
  ) {
    const existingActionRow = card.querySelector(
      ".zinspire-preview-card__actions",
    );
    if (existingActionRow) {
      existingActionRow.remove();
    }
    const doc = card.ownerDocument;
    this.buildPreviewCardActionRow(card, entry, doc);
  }

  /**
   * Position the preview card relative to the row (FTR-HOVER-PREVIEW)
   * Prefers right side of row, falls back to below if no space
   */
  private positionPreviewCard(card: HTMLDivElement, row: HTMLElement) {
    const mainWindow = Zotero.getMainWindow();
    const doc = mainWindow?.document || this.body.ownerDocument;
    const viewportWidth = doc.documentElement?.clientWidth || 800;
    const viewportHeight = doc.documentElement?.clientHeight || 600;

    // Get row position
    const rowRect = row.getBoundingClientRect();
    const cardWidth = 420; // max-width from style
    const cardHeight = 400; // max-height from style
    const gap = 8; // gap between row and card

    let left: number;
    let top: number;

    // Try to position on the right side of the row
    const rightSpace = viewportWidth - rowRect.right - gap;
    if (rightSpace >= cardWidth) {
      // Enough space on the right
      left = rowRect.right + gap;
      top = rowRect.top;
    } else {
      // Not enough space on right, try left side
      const leftSpace = rowRect.left - gap;
      if (leftSpace >= cardWidth) {
        left = rowRect.left - cardWidth - gap;
        top = rowRect.top;
      } else {
        // Position below the row
        left = Math.max(
          gap,
          Math.min(rowRect.left, viewportWidth - cardWidth - gap),
        );
        top = rowRect.bottom + gap;
      }
    }

    // Ensure card doesn't go below viewport
    if (top + cardHeight > viewportHeight - gap) {
      top = Math.max(gap, viewportHeight - cardHeight - gap);
    }

    // Ensure card doesn't go above viewport
    if (top < gap) {
      top = gap;
    }

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  /**
   * FTR-HOVER-PREVIEW: Show preview card at a specific rect position.
   * Used for PDF reader lookup button hover preview.
   * FTR-HOVER-PREVIEW-MULTI: Now supports multiple entries with pagination.
   * FTR-AMBIGUOUS-AUTHOR-YEAR: Shows message when author-year matching returns multiple results.
   */
  private showPreviewCardAtRect(
    entries: InspireReferenceEntry | InspireReferenceEntry[],
    buttonRect: { top: number; left: number; bottom: number; right: number },
    label?: string,
    citationType?: "numeric" | "author-year" | "arxiv",
  ) {
    // Normalize to array
    const entryArray = Array.isArray(entries) ? entries : [entries];
    if (entryArray.length === 0) return;

    const entry = entryArray[0];
    Zotero.debug(
      `[${config.addonName}] [HOVER-PREVIEW] showPreviewCardAtRect: entry=${entry.id}, totalEntries=${entryArray.length}, rect=(${buttonRect.top.toFixed(0)},${buttonRect.left.toFixed(0)})`,
    );

    // Skip if already showing the same set of entries
    // Note: Only compare entries keys - if entries match, first entry ID also matches
    const newEntriesKey = entryArray.map((e) => e.id).join(",");
    const currentEntriesKey = this.previewEntries.map((e) => e.id).join(",");
    if (newEntriesKey === currentEntriesKey) {
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] Skipping: already showing these entries`,
      );
      return;
    }

    // Hide any existing abstract tooltip to avoid visual conflict
    this.hideAbstractTooltipImmediate();

    // Store pagination state (cap entries to prevent memory issues)
    this.previewEntries = entryArray.slice(
      0,
      InspireReferencePanelController.MAX_PREVIEW_ENTRIES,
    );
    this.previewCurrentIndex = 0;
    this.previewCurrentEntryId = entry.id;
    this.previewLabel = label;
    this.previewButtonRect = buttonRect;
    // FTR-AMBIGUOUS-AUTHOR-YEAR: Store citation type for message display
    this.previewCitationType = citationType;

    const card = this.getPreviewCard();
    const doc = card.ownerDocument;

    Zotero.debug(
      `[${config.addonName}] [HOVER-PREVIEW] Got preview card, connected=${card.isConnected}`,
    );

    // Clear previous content
    // PERF-FIX-15: Use replaceChildren() instead of innerHTML = ""
    card.replaceChildren();

    // Build card content for current entry
    this.buildPreviewCardContent(card, entry, doc);

    // Add pagination controls if multiple entries
    if (entryArray.length > 1) {
      this.buildPreviewPagination(card, doc);
    }

    // Position the card relative to the button rect
    this.positionPreviewCardAtRect(card, buttonRect);

    // Show the card
    card.style.display = "block";

    Zotero.debug(
      `[${config.addonName}] [HOVER-PREVIEW] Card displayed at (${card.style.top}, ${card.style.left})`,
    );

    // Fetch abstract if not already cached
    this.fetchPreviewAbstract(entry, card);
  }

  /**
   * FTR-HOVER-PREVIEW-MULTI: Build pagination controls for multi-entry preview.
   */
  private buildPreviewPagination(card: HTMLDivElement, doc: Document): void {
    const total = this.previewEntries.length;
    const current = this.previewCurrentIndex + 1;
    const label = this.previewLabel || "";

    const paginationRow = doc.createElement("div");
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
    const prevBtn = doc.createElement("button");
    prevBtn.textContent = "‹";
    prevBtn.title = getString("references-panel-back");
    prevBtn.disabled = current <= 1;
    Object.assign(prevBtn.style, {
      width: "24px",
      height: "24px",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      borderRadius: "4px",
      backgroundColor:
        current <= 1
          ? "var(--fill-quinary, #e0e0e0)"
          : "var(--material-background, #fff)",
      cursor: current <= 1 ? "default" : "pointer",
      fontSize: "14px",
      fontWeight: "bold",
      opacity: current <= 1 ? "0.5" : "1",
    });
    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.navigatePreview(-1);
    });

    // Page indicator: "1 / 3 for [65]"
    const indicator = doc.createElement("span");
    indicator.className = "zinspire-preview-indicator";
    const labelStr = label ? ` [${label}]` : "";
    indicator.textContent = `${current} / ${total}${labelStr}`;
    Object.assign(indicator.style, {
      color: "var(--fill-secondary, #666)",
      fontWeight: "500",
    });

    // Next button
    const nextBtn = doc.createElement("button");
    nextBtn.textContent = "›";
    nextBtn.title = getString("references-panel-forward");
    nextBtn.disabled = current >= total;
    Object.assign(nextBtn.style, {
      width: "24px",
      height: "24px",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      borderRadius: "4px",
      backgroundColor:
        current >= total
          ? "var(--fill-quinary, #e0e0e0)"
          : "var(--material-background, #fff)",
      cursor: current >= total ? "default" : "pointer",
      fontSize: "14px",
      fontWeight: "bold",
      opacity: current >= total ? "0.5" : "1",
    });
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.navigatePreview(1);
    });

    paginationRow.appendChild(prevBtn);
    paginationRow.appendChild(indicator);
    paginationRow.appendChild(nextBtn);

    card.appendChild(paginationRow);

    // FTR-AMBIGUOUS-AUTHOR-YEAR: Add hint message for author-year with multiple matches
    if (this.previewCitationType === "author-year" && total > 1) {
      const hintRow = doc.createElement("div");
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
   * FTR-HOVER-PREVIEW-MULTI: Navigate preview pagination.
   * @param delta - Direction: -1 for prev, +1 for next
   */
  private navigatePreview(delta: number): void {
    const newIndex = this.previewCurrentIndex + delta;
    if (newIndex < 0 || newIndex >= this.previewEntries.length) return;

    // FIX: Cancel any scheduled hide to prevent flash when content changes
    // When card.innerHTML is cleared, mouseleave might fire briefly
    this.cancelPreviewHide();

    this.previewCurrentIndex = newIndex;
    const entry = this.previewEntries[newIndex];
    this.previewCurrentEntryId = entry.id;

    const card = this.previewCard;
    if (!card) return;

    const doc = card.ownerDocument;

    // Clear and rebuild content
    // PERF-FIX-15: Use replaceChildren() instead of innerHTML = ""
    card.replaceChildren();
    this.buildPreviewCardContent(card, entry, doc);

    // Rebuild pagination
    if (this.previewEntries.length > 1) {
      this.buildPreviewPagination(card, doc);
    }

    // Re-position (in case content size changed)
    if (this.previewButtonRect) {
      this.positionPreviewCardAtRect(card, this.previewButtonRect);
    }

    // Fetch abstract for new entry
    this.fetchPreviewAbstract(entry, card);

    Zotero.debug(
      `[${config.addonName}] [HOVER-PREVIEW] Navigated to entry ${newIndex + 1}/${this.previewEntries.length}: ${entry.title?.substring(0, 50)}...`,
    );
  }

  /**
   * FTR-HOVER-PREVIEW: Position preview card relative to a rect.
   * Uses BOTTOM positioning so the card anchors at bottom and expands upward.
   * This keeps pagination buttons near the Lookup button when content changes.
   */
  private positionPreviewCardAtRect(
    card: HTMLDivElement,
    rect: { top: number; left: number; bottom: number; right: number },
  ) {
    const mainWindow = Zotero.getMainWindow();
    const doc = mainWindow?.document || this.body.ownerDocument;
    const viewportWidth = doc.documentElement?.clientWidth || 800;
    const viewportHeight = doc.documentElement?.clientHeight || 600;

    const cardWidth = 420; // max-width from style
    const cardMaxHeight = 400; // max-height from style
    const gap = 8;

    // Calculate horizontal position
    const left = Math.max(
      gap,
      Math.min(rect.left, viewportWidth - cardWidth - gap),
    );

    // Use BOTTOM positioning - card anchors at bottom, expands upward
    // This keeps pagination buttons (at card bottom) near the Lookup button
    // when abstract loads and card grows

    const spaceAbove = rect.top - gap;
    const spaceBelow = viewportHeight - rect.bottom - gap;

    let bottom: number;

    if (spaceAbove >= cardMaxHeight || spaceAbove >= spaceBelow) {
      // Position above the button: card's bottom edge near button's top
      // bottom CSS value = distance from viewport bottom
      bottom = viewportHeight - rect.top + gap;
    } else {
      // Position below the button: card's bottom edge at a fixed distance
      // Calculate so the top of the card starts just below the button
      // Card bottom = viewportHeight - (rect.bottom + gap + cardMaxHeight)
      // But we want the bottom to be stable, so:
      bottom = Math.max(
        gap,
        viewportHeight - rect.bottom - cardMaxHeight - gap,
      );
    }

    // Ensure card stays within viewport (top doesn't go off screen)
    // When using bottom positioning, we need to ensure there's room at top
    // bottom value should not be so large that card extends above viewport
    const maxBottom = viewportHeight - cardMaxHeight - gap;
    if (bottom > maxBottom) {
      bottom = Math.max(gap, maxBottom);
    }

    // Clear top positioning, use bottom instead
    card.style.top = "auto";
    card.style.bottom = `${bottom}px`;
    card.style.left = `${left}px`;
  }

  /**
   * Fetch and display abstract in the preview card (FTR-HOVER-PREVIEW)
   * Reuses existing abstract caching logic from entry.abstract
   * FIX: Added timeout fallback and more robust error handling
   */
  private async fetchPreviewAbstract(
    entry: InspireReferenceEntry,
    card: HTMLDivElement,
  ) {
    const abstractEl = card.querySelector(
      ".zinspire-preview-card__abstract",
    ) as HTMLElement;

    Zotero.debug(
      `[${config.addonName}] [HOVER-PREVIEW] fetchPreviewAbstract: entry=${entry.id}, abstractEl=${!!abstractEl}, entry.abstract=${entry.abstract !== undefined ? `"${entry.abstract?.substring(0, 30)}..."` : "undefined"}, localItemID=${entry.localItemID}, recid=${entry.recid}`,
    );

    if (!abstractEl) {
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] fetchPreviewAbstract: abstractEl not found, returning`,
      );
      return;
    }

    const s = getCachedStrings();
    const maxAbstractLength = 500;

    // Check if abstract is already cached
    if (entry.abstract !== undefined) {
      const text = entry.abstract?.trim() || s.noAbstract;
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] Using cached abstract: "${text.substring(0, 50)}..."`,
      );
      this.renderPreviewAbstract(abstractEl, text, maxAbstractLength);
      return;
    }

    // FIX: Also check if this entry exists in the local library by recid
    // This handles the case where enrichLocalStatus hasn't completed yet
    if (!entry.localItemID && entry.recid) {
      try {
        const fieldID = Zotero.ItemFields.getID("archiveLocation");
        if (fieldID) {
          const sql = `SELECT itemID FROM itemData JOIN itemDataValues USING(valueID) WHERE fieldID = ? AND value = ? LIMIT 1`;
          const rows = await Zotero.DB.queryAsync(sql, [fieldID, entry.recid]);
          if (rows && rows.length > 0) {
            entry.localItemID = Number(rows[0].itemID);
            Zotero.debug(
              `[${config.addonName}] [HOVER-PREVIEW] Found localItemID=${entry.localItemID} via direct DB lookup`,
            );
          }
        }
      } catch (e) {
        Zotero.debug(
          `[${config.addonName}] [HOVER-PREVIEW] Error looking up localItemID: ${e}`,
        );
      }
    }

    // Try to get from local library first
    if (entry.localItemID) {
      const localItem = Zotero.Items.get(entry.localItemID);
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] Trying local library: localItemID=${entry.localItemID}, localItem=${!!localItem}`,
      );
      if (localItem) {
        const localAbstract = localItem.getField("abstractNote") as string;
        if (localAbstract?.trim()) {
          entry.abstract = localAbstract.trim();
          Zotero.debug(
            `[${config.addonName}] [HOVER-PREVIEW] Got abstract from local library: "${entry.abstract.substring(0, 50)}..."`,
          );
          this.renderPreviewAbstract(
            abstractEl,
            entry.abstract,
            maxAbstractLength,
          );
          return;
        }
      }
    }

    // Fetch from INSPIRE if we have a recid
    if (entry.recid) {
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] Fetching abstract from INSPIRE API for recid=${entry.recid}`,
      );
      // FIX: Check if AbortController is available (not available in all Zotero environments)
      const supportsAbort =
        typeof AbortController !== "undefined" &&
        typeof AbortController === "function";
      // Cancel any existing fetch
      this.previewAbortController?.abort();
      this.previewAbortController = supportsAbort
        ? new AbortController()
        : undefined;

      // FIX: Store the entry ID before async operation to handle race conditions
      const fetchEntryId = entry.id;

      try {
        const abstract = await fetchInspireAbstract(
          entry.recid,
          this.previewAbortController?.signal,
        );
        entry.abstract = abstract || "";

        Zotero.debug(
          `[${config.addonName}] [HOVER-PREVIEW] Got abstract from INSPIRE: "${entry.abstract.substring(0, 50)}..."`,
        );

        // Only update if this entry is still being shown
        // FIX: Use the stored fetchEntryId to handle race conditions
        if (
          this.previewCurrentEntryId === fetchEntryId &&
          card.style.display !== "none"
        ) {
          this.renderPreviewAbstract(
            abstractEl,
            entry.abstract || s.noAbstract,
            maxAbstractLength,
          );
        } else {
          Zotero.debug(
            `[${config.addonName}] [HOVER-PREVIEW] Entry no longer shown (expected=${fetchEntryId}, current=${this.previewCurrentEntryId}), skipping render`,
          );
        }
      } catch (_err) {
        Zotero.debug(
          `[${config.addonName}] [HOVER-PREVIEW] Error fetching abstract: ${_err}`,
        );
        // Only show error if this entry is still being shown
        if (
          this.previewCurrentEntryId === fetchEntryId &&
          card.style.display !== "none"
        ) {
          abstractEl.textContent = s.noAbstract;
        }
      }
    } else {
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] No recid, showing no abstract`,
      );
      abstractEl.textContent = s.noAbstract;
    }
  }

  /**
   * Render abstract text in preview card, truncating if needed
   */
  private renderPreviewAbstract(
    el: HTMLElement,
    text: string,
    maxLength: number,
  ) {
    // Process LaTeX math
    let processed = cleanMathTitle(text);

    // Convert HTML sup/sub to Unicode-like notation
    processed = processed
      .replace(/<sup>([^<]+)<\/sup>/g, "^$1")
      .replace(/<sub>([^<]+)<\/sub>/g, "_$1");

    // Truncate if too long
    if (processed.length > maxLength) {
      processed =
        processed.slice(0, maxLength).trim() +
        "... " +
        getString("references-panel-preview-abstract-truncated");
    }

    el.textContent = processed;
  }

  /**
   * Immediately hide the abstract tooltip without delay (FTR-HOVER-PREVIEW)
   * Called when showing preview card to avoid visual conflict
   */
  private hideAbstractTooltipImmediate() {
    // Cancel any pending show/hide
    if (this.abstractHoverTimeout) {
      clearTimeout(this.abstractHoverTimeout);
      this.abstractHoverTimeout = undefined;
    }
    if (this.abstractHideTimeout) {
      clearTimeout(this.abstractHideTimeout);
      this.abstractHideTimeout = undefined;
    }
    // Cancel any pending fetch
    this.abstractAbort?.abort();
    this.abstractAbort = undefined;
    // Hide tooltip
    if (this.abstractTooltip) {
      this.abstractTooltip.style.display = "none";
      this.abstractTooltip.textContent = "";
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Batch Import Methods (FTR-BATCH-IMPORT)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create the batch toolbar UI (hidden by default).
   */
  private createBatchToolbar() {
    Zotero.debug(
      `[${config.addonName}] createBatchToolbar: creating batch toolbar`,
    );
    const doc = this.body.ownerDocument;
    this.batchToolbar = doc.createElement("div");
    this.batchToolbar.className = "zinspire-batch-toolbar";
    this.batchToolbar.style.display = "none";

    // Selection badge
    this.batchSelectedBadge = doc.createElement("span");
    this.batchSelectedBadge.className = "zinspire-batch-toolbar__badge";
    this.batchSelectedBadge.textContent = getString(
      "references-panel-batch-selected",
      { args: { count: 0 } },
    );
    this.batchToolbar.appendChild(this.batchSelectedBadge);

    // Select All button
    const selectAllBtn = doc.createElement("button");
    selectAllBtn.className = "zinspire-batch-toolbar__btn";
    selectAllBtn.textContent = getString("references-panel-batch-select-all");
    selectAllBtn.addEventListener("click", () => this.selectAllEntries());
    this.batchToolbar.appendChild(selectAllBtn);

    // Clear button
    const clearBtn = doc.createElement("button");
    clearBtn.className = "zinspire-batch-toolbar__btn";
    clearBtn.textContent = getString("references-panel-batch-clear");
    clearBtn.addEventListener("click", () => this.clearSelection());
    this.batchToolbar.appendChild(clearBtn);

    // Import button
    this.batchImportButton = doc.createElement("button");
    this.batchImportButton.className =
      "zinspire-batch-toolbar__btn zinspire-batch-toolbar__btn--primary";
    this.batchImportButton.textContent = getString(
      "references-panel-batch-import",
    );
    this.batchImportButton.addEventListener("click", () => {
      Zotero.debug(`[${config.addonName}] Import button clicked`);
      this.handleBatchImport().catch((err) => {
        Zotero.debug(`[${config.addonName}] handleBatchImport error: ${err}`);
      });
    });
    this.batchToolbar.appendChild(this.batchImportButton);

    // Insert batch toolbar after chart (before list), closer to the items it operates on
    this.body.insertBefore(this.batchToolbar, this.listEl);
  }

  /**
   * Update batch toolbar visibility and badge.
   */
  private updateBatchToolbarVisibility() {
    if (!this.batchToolbar) {
      Zotero.debug(
        `[${config.addonName}] updateBatchToolbarVisibility: batchToolbar is null`,
      );
      return;
    }

    const count = this.selectedEntryIDs.size;
    Zotero.debug(
      `[${config.addonName}] updateBatchToolbarVisibility: count=${count}`,
    );
    if (count > 0) {
      this.batchToolbar.style.display = "flex";
      if (this.batchSelectedBadge) {
        this.batchSelectedBadge.textContent = getString(
          "references-panel-batch-selected",
          { args: { count } },
        );
      }
      if (this.batchImportButton) {
        this.batchImportButton.disabled = false;
      }
    } else {
      this.batchToolbar.style.display = "none";
    }
  }

  /**
   * Handle checkbox click with Shift+Click range selection support.
   */
  private handleCheckboxClick(entry: InspireReferenceEntry, event: MouseEvent) {
    Zotero.debug(
      `[${config.addonName}] handleCheckboxClick: entry.id=${entry.id}`,
    );
    const checkbox = event.target as HTMLInputElement;
    const isChecked = checkbox.checked;
    Zotero.debug(
      `[${config.addonName}] handleCheckboxClick: isChecked=${isChecked}`,
    );

    if (event.shiftKey && this.lastSelectedEntryID) {
      // Shift+Click: select range
      const filteredEntries = this.getFilteredEntries(this.allEntries);
      const lastIndex = filteredEntries.findIndex(
        (e) => e.id === this.lastSelectedEntryID,
      );
      const currentIndex = filteredEntries.findIndex((e) => e.id === entry.id);

      if (lastIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);

        for (let i = start; i <= end; i++) {
          const e = filteredEntries[i];
          if (isChecked) {
            this.selectedEntryIDs.add(e.id);
          } else {
            this.selectedEntryIDs.delete(e.id);
          }
        }

        // Update all checkboxes in the range
        this.updateAllCheckboxes();
      }
    } else {
      // Regular click: toggle single item
      if (isChecked) {
        this.selectedEntryIDs.add(entry.id);
      } else {
        this.selectedEntryIDs.delete(entry.id);
      }
    }

    // Update last selected for Shift+Click
    this.lastSelectedEntryID = entry.id;
    this.updateBatchToolbarVisibility();
  }

  /**
   * Update all visible checkboxes to match selection state.
   */
  private updateAllCheckboxes() {
    const checkboxes = this.listEl.querySelectorAll(
      ".zinspire-ref-entry__checkbox",
    );
    for (let i = 0; i < checkboxes.length; i++) {
      const checkbox = checkboxes[i] as HTMLInputElement;
      const entryId = checkbox.dataset?.entryId;
      if (entryId) {
        checkbox.checked = this.selectedEntryIDs.has(entryId);
      }
    }
  }

  /**
   * Select all entries in the current filtered view.
   */
  private selectAllEntries() {
    const filteredEntries = this.getFilteredEntries(this.allEntries);
    for (const entry of filteredEntries) {
      this.selectedEntryIDs.add(entry.id);
    }
    this.updateAllCheckboxes();
    this.updateBatchToolbarVisibility();
  }

  /**
   * Clear all selections.
   */
  private clearSelection() {
    this.selectedEntryIDs.clear();
    this.lastSelectedEntryID = undefined;
    this.updateAllCheckboxes();
    this.updateBatchToolbarVisibility();
  }

  /**
   * Handle batch import button click.
   */
  private async handleBatchImport() {
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: started, selectedEntryIDs.size=${this.selectedEntryIDs.size}`,
    );
    if (this.selectedEntryIDs.size === 0) {
      this.showToast(getString("references-panel-batch-no-selection"));
      return;
    }

    // Get selected entries
    const selectedEntries = this.allEntries.filter(
      (e) => this.selectedEntryIDs.has(e.id) && e.recid,
    );
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: selectedEntries.length=${selectedEntries.length}`,
    );
    if (selectedEntries.length === 0) {
      this.showToast(getString("references-panel-batch-no-selection"));
      return;
    }

    // Detect duplicates
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: detecting duplicates...`,
    );
    const duplicates = await this.detectDuplicates(selectedEntries);
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: duplicates.size=${duplicates.size}`,
    );

    // If there are duplicates, show dialog
    let entriesToImport = selectedEntries;
    if (duplicates.size > 0) {
      const result = await this.showDuplicateDialog(
        selectedEntries,
        duplicates,
      );
      if (!result) {
        // User cancelled
        return;
      }
      entriesToImport = result;
    }

    if (entriesToImport.length === 0) {
      this.showToast(getString("references-panel-batch-no-selection"));
      return;
    }

    // Prompt for save target once
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: prompting for save target...`,
    );
    const anchor = this.batchImportButton || this.body;
    const target = await this.promptForSaveTarget(anchor);
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: target=${target ? "selected" : "cancelled"}`,
    );
    if (!target) {
      return;
    }

    // Run batch import
    Zotero.debug(
      `[${config.addonName}] handleBatchImport: starting batch import for ${entriesToImport.length} entries`,
    );
    await this.runBatchImportWithProgress(entriesToImport, target);
  }

  /**
   * Detect duplicates for selected entries.
   * Returns a map of entry.id -> { localItemID, matchType }
   */
  private async detectDuplicates(
    entries: InspireReferenceEntry[],
  ): Promise<
    Map<string, { localItemID: number; matchType: "recid" | "arxiv" | "doi" }>
  > {
    const duplicates = new Map<
      string,
      { localItemID: number; matchType: "recid" | "arxiv" | "doi" }
    >();

    // Skip entries that already have localItemID (already detected as local)
    const entriesToCheck = entries.filter((e) => !e.localItemID);
    if (entriesToCheck.length === 0) {
      // All entries already have localItemID, mark them as duplicates
      for (const entry of entries) {
        if (entry.localItemID) {
          duplicates.set(entry.id, {
            localItemID: entry.localItemID,
            matchType: "recid",
          });
        }
      }
      return duplicates;
    }

    // Collect identifiers for batch queries
    const recids: string[] = [];
    const arxivIds: string[] = [];
    const dois: string[] = [];
    const entryByRecid = new Map<string, InspireReferenceEntry>();
    const entryByArxiv = new Map<string, InspireReferenceEntry>();
    const entryByDOI = new Map<string, InspireReferenceEntry>();

    for (const entry of entriesToCheck) {
      if (entry.recid) {
        recids.push(entry.recid);
        entryByRecid.set(entry.recid, entry);
      }
      const arxivId =
        typeof entry.arxivDetails === "object"
          ? entry.arxivDetails?.id
          : undefined;
      if (arxivId) {
        arxivIds.push(arxivId);
        entryByArxiv.set(arxivId, entry);
      }
      if (entry.doi) {
        dois.push(entry.doi);
        entryByDOI.set(entry.doi, entry);
      }
    }

    // Batch query for each identifier type (priority: recid > arXiv > DOI)
    const [recidMatches, arxivMatches, doiMatches] = await Promise.all([
      recids.length > 0
        ? findItemsByRecids(recids)
        : Promise.resolve(new Map<string, number>()),
      arxivIds.length > 0
        ? findItemsByArxivs(arxivIds)
        : Promise.resolve(new Map<string, number>()),
      dois.length > 0
        ? findItemsByDOIs(dois)
        : Promise.resolve(new Map<string, number>()),
    ]);

    // Add already-local entries to duplicates
    for (const entry of entries) {
      if (entry.localItemID) {
        duplicates.set(entry.id, {
          localItemID: entry.localItemID,
          matchType: "recid",
        });
      }
    }

    // Process matches in priority order
    for (const [recid, localItemID] of recidMatches) {
      const entry = entryByRecid.get(recid);
      if (entry && !duplicates.has(entry.id)) {
        duplicates.set(entry.id, { localItemID, matchType: "recid" });
      }
    }

    for (const [arxivId, localItemID] of arxivMatches) {
      const entry = entryByArxiv.get(arxivId);
      if (entry && !duplicates.has(entry.id)) {
        duplicates.set(entry.id, { localItemID, matchType: "arxiv" });
      }
    }

    for (const [doi, localItemID] of doiMatches) {
      const entry = entryByDOI.get(doi);
      if (entry && !duplicates.has(entry.id)) {
        duplicates.set(entry.id, { localItemID, matchType: "doi" });
      }
    }

    return duplicates;
  }

  /**
   * Show duplicate detection dialog.
   * Returns the entries to import (user-selected), or null if cancelled.
   */
  private async showDuplicateDialog(
    entries: InspireReferenceEntry[],
    duplicates: Map<
      string,
      { localItemID: number; matchType: "recid" | "arxiv" | "doi" }
    >,
  ): Promise<InspireReferenceEntry[] | null> {
    return new Promise((resolve) => {
      // Use the panel's own document for creating elements
      const doc = this.body.ownerDocument;
      Zotero.debug(
        `[${config.addonName}] showDuplicateDialog: duplicates.size=${duplicates.size}`,
      );

      // Create overlay - append to panel body instead of document.body
      const overlay = doc.createElement("div");
      overlay.className = "zinspire-duplicate-dialog";
      // Make overlay cover the panel area
      overlay.style.position = "fixed";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.right = "0";
      overlay.style.bottom = "0";
      overlay.style.background = "rgba(0, 0, 0, 0.5)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.zIndex = "10000";

      // Create content
      const content = doc.createElement("div");
      content.className = "zinspire-duplicate-dialog__content";
      content.style.background = "var(--material-background, #ffffff)";
      content.style.borderRadius = "8px";
      content.style.padding = "16px";
      content.style.maxWidth = "90%";
      content.style.maxHeight = "70%";
      content.style.overflowY = "auto";
      content.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.3)";

      // Title
      const title = doc.createElement("div");
      title.className = "zinspire-duplicate-dialog__title";
      title.style.fontSize = "14px";
      title.style.fontWeight = "600";
      title.style.marginBottom = "8px";
      title.textContent = getString("references-panel-batch-duplicate-title");
      content.appendChild(title);

      // Message
      const message = doc.createElement("div");
      message.className = "zinspire-duplicate-dialog__message";
      message.style.fontSize = "12px";
      message.style.marginBottom = "12px";
      message.textContent = getString(
        "references-panel-batch-duplicate-message",
        { args: { count: duplicates.size } },
      );
      content.appendChild(message);

      // List of duplicates
      const list = doc.createElement("div");
      list.className = "zinspire-duplicate-dialog__list";
      list.style.maxHeight = "150px";
      list.style.overflowY = "auto";
      list.style.border = "1px solid var(--fill-quinary, #e0e0e0)";
      list.style.borderRadius = "4px";
      list.style.marginBottom = "12px";

      const duplicateEntries = entries.filter((e) => duplicates.has(e.id));
      const checkboxMap = new Map<string, HTMLInputElement>();

      for (const entry of duplicateEntries) {
        const match = duplicates.get(entry.id)!;
        const item = doc.createElement("div");
        item.className = "zinspire-duplicate-dialog__item";
        item.style.display = "flex";
        item.style.alignItems = "flex-start";
        item.style.gap = "8px";
        item.style.padding = "8px";
        item.style.borderBottom = "1px solid var(--fill-quinary, #e0e0e0)";
        item.style.fontSize = "12px";

        const checkbox = doc.createElement("input");
        checkbox.type = "checkbox";
        checkbox.style.marginTop = "2px";
        checkbox.style.flexShrink = "0";
        checkbox.checked = false; // Default: skip duplicates
        checkboxMap.set(entry.id, checkbox);
        item.appendChild(checkbox);

        const info = doc.createElement("div");
        info.style.flex = "1";
        info.style.minWidth = "0";

        const titleEl = doc.createElement("div");
        titleEl.style.fontWeight = "500";
        titleEl.style.whiteSpace = "nowrap";
        titleEl.style.overflow = "hidden";
        titleEl.style.textOverflow = "ellipsis";
        titleEl.textContent = entry.title;
        titleEl.title = entry.title;
        info.appendChild(titleEl);

        const matchEl = doc.createElement("div");
        matchEl.style.fontSize = "10px";
        matchEl.style.color = "var(--zotero-blue-6, #2554c7)";
        matchEl.style.marginTop = "2px";
        const matchKey =
          `references-panel-batch-duplicate-match-${match.matchType}` as FluentMessageId;
        matchEl.textContent = getString(matchKey);
        info.appendChild(matchEl);

        item.appendChild(info);
        list.appendChild(item);
      }
      content.appendChild(list);

      // Actions
      const actions = doc.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.flexWrap = "wrap";
      actions.style.justifyContent = "flex-end";

      const createBtn = (text: string, primary = false) => {
        const btn = doc.createElement("button");
        btn.style.border = "1px solid var(--zotero-gray-4, #d1d1d5)";
        btn.style.borderRadius = "4px";
        btn.style.padding = "6px 12px";
        btn.style.fontSize = "12px";
        btn.style.cursor = "pointer";
        if (primary) {
          btn.style.background = "var(--zotero-blue-5, #0060df)";
          btn.style.color = "#ffffff";
          btn.style.borderColor = "var(--zotero-blue-5, #0060df)";
        } else {
          btn.style.background = "var(--zotero-gray-1, #ffffff)";
          btn.style.color = "var(--zotero-gray-7, #2b2b30)";
        }
        btn.textContent = text;
        return btn;
      };

      // Skip All button
      const skipAllBtn = createBtn(
        getString("references-panel-batch-duplicate-skip-all"),
      );
      skipAllBtn.addEventListener("click", () => {
        for (const cb of checkboxMap.values()) {
          cb.checked = false;
        }
      });
      actions.appendChild(skipAllBtn);

      // Import All button
      const importAllBtn = createBtn(
        getString("references-panel-batch-duplicate-import-all"),
      );
      importAllBtn.addEventListener("click", () => {
        for (const cb of checkboxMap.values()) {
          cb.checked = true;
        }
      });
      actions.appendChild(importAllBtn);

      // Cancel button
      const cancelBtn = createBtn(
        getString("references-panel-batch-duplicate-cancel"),
      );
      cancelBtn.addEventListener("click", () => {
        overlay.remove();
        resolve(null);
      });
      actions.appendChild(cancelBtn);

      // Confirm button
      const confirmBtn = createBtn(
        getString("references-panel-batch-duplicate-confirm"),
        true,
      );
      confirmBtn.addEventListener("click", () => {
        // Get entries to import (non-duplicates + selected duplicates)
        const result: InspireReferenceEntry[] = [];
        for (const entry of entries) {
          if (!duplicates.has(entry.id)) {
            result.push(entry);
          } else if (checkboxMap.get(entry.id)?.checked) {
            result.push(entry);
          }
        }
        overlay.remove();
        resolve(result);
      });
      actions.appendChild(confirmBtn);

      content.appendChild(actions);
      overlay.appendChild(content);

      // Add to panel body (not document.body)
      // Make panel body position relative for overlay positioning
      this.body.appendChild(overlay);

      // Close on overlay click
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(null);
        }
      });

      // Close on Escape
      const escapeHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          overlay.remove();
          resolve(null);
          doc.removeEventListener("keydown", escapeHandler);
        }
      };
      doc.addEventListener("keydown", escapeHandler);
    });
  }

  /**
   * Run batch import with progress display.
   */
  private async runBatchImportWithProgress(
    entries: InspireReferenceEntry[],
    target: SaveTargetSelection,
  ) {
    const total = entries.length;
    let done = 0;
    let success = 0;
    let failed = 0;

    // Setup cancellation
    let AbortControllerClass =
      typeof AbortController !== "undefined" ? AbortController : null;
    if (!AbortControllerClass) {
      const win = Zotero.getMainWindow();
      if (win && (win as any).AbortController) {
        AbortControllerClass = (win as any).AbortController;
      }
    }

    this.batchImportAbort = AbortControllerClass
      ? new AbortControllerClass()
      : undefined;
    const signal = this.batchImportAbort?.signal || {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }; // Mock signal if not supported

    // Escape key listener for cancellation
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.batchImportAbort?.abort();
      }
    };
    const mainWindow = Zotero.getMainWindow();
    mainWindow?.addEventListener("keydown", escapeHandler, true);

    // Progress window
    const icon = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;
    const progressWindow = new ProgressWindowHelper(config.addonName);
    progressWindow.win.changeHeadline(config.addonName, icon);
    progressWindow.createLine({
      text: getString("references-panel-batch-importing", {
        args: { done: 0, total },
      }),
      progress: 0,
    });
    progressWindow.show(-1); // Keep open

    // Concurrency limiter
    const CONCURRENCY = 3;
    let index = 0;

    const worker = async () => {
      while (index < entries.length && !signal.aborted) {
        const currentIndex = index++;
        const entry = entries[currentIndex];

        try {
          const newItem = await this.importReference(entry.recid!, target);
          if (newItem) {
            entry.localItemID = newItem.id;
            entry.displayText = buildDisplayText(entry);
            entry.searchText = "";
            this.selectedEntryIDs.delete(entry.id);
            this.updateRowStatus(entry);
            success++;
          } else {
            failed++;
          }
        } catch (err) {
          Zotero.debug(`[${config.addonName}] Batch import error: ${err}`);
          failed++;
        }

        done++;
        const percent = Math.round((done / total) * 100);
        progressWindow.changeLine({
          text: getString("references-panel-batch-importing", {
            args: { done, total },
          }),
          progress: percent,
        });
      }
    };

    try {
      // Start workers
      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.min(CONCURRENCY, entries.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
    } finally {
      // Clean up
      mainWindow?.removeEventListener("keydown", escapeHandler, true);
      this.batchImportAbort = undefined;

      // Close progress and show result
      progressWindow.close();

      // Show result toast
      if (signal.aborted) {
        this.showToast(
          getString("references-panel-batch-import-cancelled", {
            args: { done, total },
          }),
        );
      } else if (failed > 0) {
        this.showToast(
          getString("references-panel-batch-import-partial", {
            args: { success, total, failed },
          }),
        );
      } else {
        this.showToast(
          getString("references-panel-batch-import-success", {
            args: { count: success },
          }),
        );
      }

      // Update UI
      this.updateAllCheckboxes();
      this.updateBatchToolbarVisibility();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Smart Update Auto-check (FTR-SMART-UPDATE-AUTO-CHECK)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Perform auto-check for INSPIRE updates when item is selected.
   * Optimized for speed: uses direct recid lookup with minimal fields.
   * Only runs if:
   * - Auto-check is enabled in preferences
   * - Item has not been checked recently (throttled)
   * - Item has a valid recid
   *
   * @param item - The Zotero item to check
   * @param knownRecid - Optional pre-fetched recid to avoid redundant lookup
   */
  private async performAutoCheck(item: Zotero.Item, knownRecid?: string) {
    // Check if auto-check is enabled
    if (!isAutoCheckEnabled()) {
      return;
    }

    const itemId = item.id;

    // Throttle: skip if checked recently
    const now = Date.now();
    const lastCheck = this.autoCheckLastCheckTime.get(itemId);
    if (lastCheck && now - lastCheck < this.autoCheckThrottleMs) {
      Zotero.debug(
        `[${config.addonName}] Auto-check: throttled for item ${itemId} (checked ${Math.round((now - lastCheck) / 1000)}s ago)`,
      );
      return;
    }

    // Update last check time
    this.autoCheckLastCheckTime.set(itemId, now);

    // Cancel any pending check
    this.autoCheckAbort?.abort();

    // Setup AbortController (available in Zotero's main window)
    let AbortControllerClass =
      typeof AbortController !== "undefined" ? AbortController : null;
    if (!AbortControllerClass) {
      const win = Zotero.getMainWindow();
      if (win && (win as any).AbortController) {
        AbortControllerClass = (win as any).AbortController;
      }
    }
    this.autoCheckAbort = AbortControllerClass
      ? new AbortControllerClass()
      : undefined;
    const signal = this.autoCheckAbort?.signal;

    // Clear existing notification
    this.clearAutoCheckNotification();

    // Use provided recid or derive from item (deriveRecidFromItem is synchronous)
    const itemRecid = knownRecid || deriveRecidFromItem(item);
    const itemTitle = (item.getField("title") as string) || "(Untitled)";

    if (!itemRecid) {
      Zotero.debug(
        `[${config.addonName}] Auto-check: no recid for item ${itemId}, skipping`,
      );
      return;
    }

    Zotero.debug(
      `[${config.addonName}] Auto-check: starting for item ${itemId}, recid=${itemRecid}, title="${itemTitle.substring(0, 40)}..."`,
    );

    try {
      const t0 = performance.now();

      // Fetch INSPIRE metadata using the item's own recid
      const metaInspire = await fetchInspireMetaByRecid(
        itemRecid,
        signal,
        "autoCheck",
      );

      if (signal?.aborted) return;

      const t1 = performance.now();
      Zotero.debug(
        `[${config.addonName}] Auto-check: fetch took ${Math.round(t1 - t0)}ms for item ${itemId}`,
      );

      if (metaInspire === -1 || (metaInspire as jsobject).recid === undefined) {
        Zotero.debug(
          `[${config.addonName}] Auto-check: no INSPIRE record for item ${itemId}`,
        );
        return;
      }

      // Verify we're comparing the same record (recid should match)
      const fetchedRecid = String((metaInspire as jsobject).recid);
      if (fetchedRecid !== itemRecid) {
        Zotero.debug(
          `[${config.addonName}] Auto-check: ERROR - recid mismatch! item=${itemRecid}, fetched=${fetchedRecid}`,
        );
        return;
      }

      // Compare with the item's local data (always use the original item, not current selection)
      const diff = compareItemWithInspire(item, metaInspire as jsobject);
      if (!diff.hasChanges) {
        Zotero.debug(
          `[${config.addonName}] Auto-check: no changes for item ${itemId}`,
        );
        return;
      }

      Zotero.debug(
        `[${config.addonName}] Auto-check: found ${diff.changes.length} changes for item ${itemId}`,
      );

      // Filter protected fields
      const protectionConfig = getFieldProtectionConfig();
      const allowedChanges = filterProtectedChanges(diff, protectionConfig);

      if (allowedChanges.length === 0) {
        Zotero.debug(
          `[${config.addonName}] Auto-check: all ${diff.changes.length} changes are protected for item ${itemId}`,
        );
        return;
      }

      Zotero.debug(
        `[${config.addonName}] Auto-check: ${allowedChanges.length} allowed changes for item ${itemId}`,
      );

      // Store pending diff for later use (includes recid for verification during apply)
      this.autoCheckPendingDiff = { diff, allowedChanges, itemRecid };

      // Show notification (even if user has switched to another item)
      // The notification will update the correct item when user clicks "View Changes"
      this.showAutoCheckNotification(item, itemRecid, diff, allowedChanges);
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        Zotero.debug(
          `[${config.addonName}] Auto-check error for item ${itemId}: ${err}`,
        );
      }
    }
  }

  /**
   * Show the auto-check update notification bar
   */
  private showAutoCheckNotification(
    item: Zotero.Item,
    itemRecid: string,
    diff: SmartUpdateDiff,
    allowedChanges: FieldChange[],
  ) {
    if (!this.statusEl?.parentElement) return;

    // Clear existing notification first
    this.clearAutoCheckNotification();

    const container = this.statusEl.parentElement;
    const notification = showUpdateNotification(
      container,
      diff,
      allowedChanges,
      // onViewChanges
      async () => {
        Zotero.debug(`[${config.addonName}] Auto-check: View Changes clicked`);
        this.clearAutoCheckNotification();

        if (!this.autoCheckPendingDiff) {
          Zotero.debug(
            `[${config.addonName}] Auto-check: ERROR - autoCheckPendingDiff is undefined!`,
          );
          return;
        }

        try {
          const {
            diff,
            allowedChanges,
            itemRecid: pendingRecid,
          } = this.autoCheckPendingDiff;
          Zotero.debug(
            `[${config.addonName}] Auto-check: showing dialog for ${allowedChanges.length} changes`,
          );

          const result = await showSmartUpdatePreviewDialog(
            diff,
            allowedChanges,
          );
          Zotero.debug(
            `[${config.addonName}] Auto-check: dialog result confirmed=${result.confirmed}, fields=${result.selectedFields.length}`,
          );

          if (result.confirmed && result.selectedFields.length > 0) {
            // Apply selected updates
            const selectedChanges = allowedChanges.filter((c) =>
              result.selectedFields.includes(c.field),
            );
            await this.applyAutoCheckUpdates(
              item,
              pendingRecid,
              selectedChanges,
            );
          }
        } catch (err) {
          Zotero.debug(
            `[${config.addonName}] Auto-check: ERROR in View Changes handler: ${err}`,
          );
        } finally {
          this.autoCheckPendingDiff = undefined;
        }
      },
      // onDismiss
      () => {
        this.clearAutoCheckNotification();
        this.autoCheckPendingDiff = undefined;
      },
    );

    // Insert notification at the top of the panel body
    container.insertBefore(notification, container.firstChild);
    this.autoCheckNotification = notification;
  }

  /**
   * Clear the auto-check notification bar
   */
  private clearAutoCheckNotification() {
    if (this.autoCheckNotification) {
      this.autoCheckNotification.remove();
      this.autoCheckNotification = undefined;
    }
  }

  /**
   * Apply selected updates from auto-check
   * @param item - The Zotero item to update
   * @param expectedRecid - The recid that was used for comparison (for verification)
   * @param selectedChanges - The field changes to apply
   */
  private async applyAutoCheckUpdates(
    item: Zotero.Item,
    expectedRecid: string,
    selectedChanges: FieldChange[],
  ) {
    if (selectedChanges.length === 0) return;

    try {
      // Re-fetch metadata to ensure we have the latest (using full fields for complete update)
      const metaInspire = await getInspireMeta(item, "full");
      if (metaInspire === -1 || (metaInspire as jsobject).recid === undefined) {
        Zotero.debug(
          `[${config.addonName}] Auto-check apply: failed to fetch metadata for item ${item.id}`,
        );
        return;
      }

      // Verify recid matches to ensure we're updating with correct data
      const fetchedRecid = String((metaInspire as jsobject).recid);
      if (fetchedRecid !== expectedRecid) {
        Zotero.debug(
          `[${config.addonName}] Auto-check apply: ERROR - recid mismatch! expected=${expectedRecid}, fetched=${fetchedRecid}`,
        );
        this.showToast("Update failed: record mismatch");
        return;
      }

      // Import selective update function
      const { setInspireMetaSelective } = await import("./inspire/itemUpdater");

      // Apply updates
      await setInspireMetaSelective(
        item,
        metaInspire as jsobject,
        "full",
        selectedChanges,
      );
      await saveItemWithPendingInspireNote(item);

      Zotero.debug(
        `[${config.addonName}] Auto-check apply: successfully updated ${selectedChanges.length} fields for item ${item.id}`,
      );
      this.showToast(
        getString("smart-update-auto-check-changes", {
          args: { count: selectedChanges.length },
        }) + " ✓",
      );
    } catch (err) {
      Zotero.debug(`[${config.addonName}] Auto-check apply error: ${err}`);
      this.showToast("Update failed");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports from modularized files (for incremental migration)
// ─────────────────────────────────────────────────────────────────────────────

// Export modular types for external use
export type {
  AuthorSearchInfo,
  InspireReferenceEntry,
  InspireArxivDetails,
  ScrollSnapshot,
  ScrollState,
  NavigationSnapshot,
  EntryCitedSource,
  ChartBin,
  InspireViewMode,
};
