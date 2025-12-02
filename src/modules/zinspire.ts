import { config } from "../../package.json";
import { cleanMathTitle } from "../utils/mathTitle";
import { getJournalAbbreviations } from "../utils/journalAbbreviations";
import { getLocaleID, getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import {
  showTargetPickerUI,
  SaveTargetRow,
  SaveTargetSelection,
  applyRefEntryTextContainerStyle,
  applyRefEntryMarkerStyle,
  applyRefEntryMarkerColor,
  applyRefEntryLinkButtonStyle,
  applyRefEntryContentStyle,
  applyAuthorLinkStyle,
  applyTabButtonStyle,
  applyAbstractTooltipStyle,
  applyBibTeXButtonStyle,
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
  AUTHOR_IDS_EXTRACT_LIMIT,
  // Types
  type ReferenceSortOption,
  type InspireSortOption,
  type InspireViewMode,
  type AuthorSearchInfo,
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
  // Classes and utilities
  LRUCache,
  ZInsUtils,
  ZInsMenu,
  ReaderTabHelper,
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
  buildMetaFromMetadata,
  getCrossrefCount,
  // Item updater
  ZInspire,
  setInspireMeta,
  setCrossRefCitations,
  saveItemWithPendingInspireNote,
} from "./inspire";

// Re-export for external use
export { ZInsUtils, ZInsMenu, ZInspire };

/**
 * Clear all search history.
 */
function clearAllHistoryPrefs(): void {
  try {
    Zotero.Prefs.set(`${config.addonRef}.${SEARCH_HISTORY_PREF_KEY}`, "[]", true);
    Zotero.debug(`[${config.addonName}] Search history cleared`);
  } catch (err) {
    Zotero.debug(`[${config.addonName}] Failed to clear history: ${err}`);
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
    const paneIcon = `chrome://${config.addonRef}/content/icons/inspire@0.5x.png`;
    const paneIcon2x = `chrome://${config.addonRef}/content/icons/inspire.png`;

    this.registrationKey = Zotero.ItemPaneManager.registerSection({
      paneID: 'zoteroinspire-references',
      pluginID: config.addonID,
      header: {
        l10nID: "pane-item-references-header",
        icon: paneIcon,
        darkIcon: paneIcon,
      },
      sidenav: {
        l10nID: "pane-item-references-sidenav",
        icon: paneIcon2x,
        darkIcon: paneIcon2x,
      },
      onInit: (args) => {
        Zotero.debug(`[${config.addonName}] ZInspireReferencePane.onInit called`);
        try {
          args.setEnabled(true);
          Zotero.debug(`[${config.addonName}] ZInspireReferencePane.onInit: pane enabled`);
        } catch (err) {
          Zotero.debug(
            `[${config.addonName}] Failed to enable INSPIRE pane: ${err}`,
          );
        }
        const controller = new InspireReferencePanelController(args.body);
        this.controllers.set(args.body, controller);
        Zotero.debug(`[${config.addonName}] ZInspireReferencePane.onInit: controller created, instances count=${InspireReferencePanelController.getInstances().size}`);
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
          onClick: ({ body, event }: { body: HTMLDivElement; event: Event }) => {
            try {
              const controller = this.controllers.get(body);
              controller?.showExportMenu(event);
            } catch (e) {
              Zotero.debug(
                `[${config.addonName}] Export button error: ${e}`,
              );
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
    const searchBar = mainWindow.document.getElementById("zotero-tb-search-textbox") as HTMLInputElement | null;
    if (!searchBar) {
      Zotero.debug(`[${config.addonName}] Search bar not found, skipping listener registration`);
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
    const quickSearchComponent = mainWindow.document.getElementById("zotero-tb-search");
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
    (this as any)._searchBarOriginalAutocomplete = searchBar.getAttribute("autocomplete");

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
        white-space: nowrap;
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
      const historyJson = Zotero.Prefs.get(`${config.prefsPrefix}.${SEARCH_HISTORY_PREF_KEY}`, true) as string | undefined;
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
        if (historyQuery.toLowerCase().startsWith(queryPart.toLowerCase()) && historyQuery.length > queryPart.length) {
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
      const hintSuffix = matchingHint.slice(queryPart.length);
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
      measureSpan.textContent = userInput;
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
          Zotero.debug(`[${config.addonName}] Saved selection: ${savedItemIds.length} items`);
        }
      }
    };

    // Focus listener: save selection when user focuses on search bar
    // Also check if we should hide autocomplete based on current value
    const focusListener = () => {
      saveCurrentSelection();
      // Check if current value starts with inspire: and hide autocomplete if so
      const isInspireSearch = searchBar.value.toLowerCase().startsWith("inspire:");
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
      const quickSearchComponent = mainWindow.document.getElementById("zotero-tb-search");
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
        const autocompletePopup = mainWindow.document.querySelector(".autocomplete-richlistbox, .autocomplete-popup, [type='autocomplete-richlistbox']");
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
      if ((keyEvent.key === "Tab" || keyEvent.key === "ArrowRight") && currentHint) {
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
          Zotero.debug(`[${config.addonName}] INSPIRE search triggered from search bar: query="${query}"`);

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
                Zotero.debug(`[${config.addonName}] Focus transferred to itemsView`);
              } else {
                // Fallback: try to focus on the item tree element directly
                const itemTree = mainWindow?.document?.getElementById("zotero-items-tree");
                if (itemTree) {
                  itemTree.focus();
                  Zotero.debug(`[${config.addonName}] Focus transferred to zotero-items-tree`);
                }
              }
            } catch (e) {
              Zotero.debug(`[${config.addonName}] Failed to transfer focus: ${e}`);
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
          const quickSearch = mainWindow?.document?.getElementById("zotero-tb-search");
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
            Zotero.debug(`[${config.addonName}] Restoring ${savedItemIds.length} saved items`);
            // Restore selection after a brief delay to let Zotero process the clear
            setTimeout(() => {
              pane.selectItems?.(savedItemIds);
              Zotero.debug(`[${config.addonName}] Item selection restored`);
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
        Zotero.debug(`[${config.addonName}] Blocked keypress Enter event during INSPIRE search`);
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
      if (keyEvent.key === "Enter" && value.toLowerCase().startsWith("inspire:")) {
        handlingInspireSearch = true;
      }

      // Call original handler
      originalKeydownListener(event);
    };

    searchBar.addEventListener("focus", focusListener);
    searchBar.addEventListener("blur", blurListener);
    searchBar.addEventListener("input", inputListener);
    // CRITICAL: Use capture phase (third param true) to intercept before Zotero's bubble-phase handlers
    searchBar.addEventListener("keydown", this.searchBarListener, { capture: true });
    // Also listen on keypress in capture phase to block any XUL/command handlers
    searchBar.addEventListener("keypress", keypressListener, { capture: true });

    // Store references for cleanup
    (this as any)._searchBarFocusListener = focusListener;
    (this as any)._searchBarBlurListener = blurListener;
    (this as any)._searchBarInputListener = inputListener;
    (this as any)._searchBarKeypressListener = keypressListener;

    Zotero.debug(`[${config.addonName}] Search bar listeners registered on element: ${searchBar.id}`);
  }

  /**
   * Unregister the search bar listener.
   */
  static unregisterSearchBarListener() {
    if (this.searchBarElement) {
      if (this.searchBarListener) {
        // Must use same capture option as addEventListener to properly remove
        this.searchBarElement.removeEventListener("keydown", this.searchBarListener, { capture: true });
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
        this.searchBarElement.removeEventListener("keypress", keypressListener, { capture: true });
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
        const quickSearchComponent = mainWindow.document.getElementById("zotero-tb-search");
        if (quickSearchComponent) {
          quickSearchComponent.removeAttribute("disableautocomplete");
          quickSearchComponent.removeAttribute("enablehistory");
        }
      }
      this.searchBarListener = undefined;
      this.searchBarElement = undefined;
      Zotero.debug(`[${config.addonName}] Search bar listeners unregistered`);
    }
  }

  /**
   * Trigger an INSPIRE search in the first active panel controller.
   */
  private static triggerSearch(query: string) {
    Zotero.debug(`[${config.addonName}] triggerSearch called with query="${query}"`);
    // Use the InspireReferencePanelController's static instances set
    const instances = InspireReferencePanelController.getInstances();
    Zotero.debug(`[${config.addonName}] Active panel controller instances: ${instances.size}`);
    if (instances.size === 0) {
      Zotero.debug(`[${config.addonName}] No active panel controllers available for search`);
      // Show a notification to the user
      const progressWindow = new ProgressWindowHelper("INSPIRE Search");
      progressWindow.createLine({
        text: "Please open the INSPIRE panel first",
        type: "error",
      });
      progressWindow.show();
      progressWindow.startCloseTimer(3000);
      return;
    }
    for (const controller of instances) {
      Zotero.debug(`[${config.addonName}] Calling executeInspireSearch on controller`);
      controller.executeInspireSearch(query).catch((err: Error) => {
        Zotero.debug(`[${config.addonName}] Failed to trigger search: ${err}`);
      });
      break; // Only need to trigger on one controller
    }
  }
}

class InspireReferencePanelController {
  private static readonly instances = new Set<InspireReferencePanelController>();
  private static navigationStack: NavigationSnapshot[] = [];
  private static forwardStack: NavigationSnapshot[] = [];
  private static isNavigatingHistory = false;

  /**
   * Get all active controller instances for external access.
   */
  static getInstances(): Set<InspireReferencePanelController> {
    return this.instances;
  }
  private static sharedPendingScrollRestore?: ScrollState & { itemID: number };

  private body: HTMLDivElement;
  private statusEl: HTMLSpanElement;
  private listEl: HTMLDivElement;
  private filterInput: HTMLInputElement;
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
  private entryCitedPreviousMode: Exclude<InspireViewMode, "entryCited"> = "references";
  private entryCitedReturnScroll?: ScrollState;
  private pendingEntryScrollReset = false;
  private allEntries: InspireReferenceEntry[] = [];
  // LRU caches to prevent unbounded memory growth
  // References: ~100 entries, each with InspireReferenceEntry[]
  private referencesCache = new LRUCache<string, InspireReferenceEntry[]>(100);
  // Cited-by: ~50 entries (large arrays, paginated data)
  private citedByCache = new LRUCache<string, InspireReferenceEntry[]>(50);
  // Entry-cited: ~50 entries (similar to cited-by)
  private entryCitedCache = new LRUCache<string, InspireReferenceEntry[]>(50);
  // Metadata: ~500 entries (individual metadata objects, frequently accessed)
  private metadataCache = new LRUCache<string, jsobject>(500);
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
  private tooltipRAF?: number;  // For requestAnimationFrame throttling
  private readonly tooltipShowDelay = 300;
  private readonly tooltipHideDelay = 600;
  // Frontend pagination state (for cited-by and author papers)
  private renderedCount = 0;  // Number of entries currently rendered
  private loadMoreButton?: HTMLButtonElement;
  private loadMoreObserver?: IntersectionObserver;  // For infinite scroll
  private loadMoreContainer?: HTMLDivElement;  // Container being observed
  private currentFilteredEntries?: InspireReferenceEntry[];  // For infinite scroll loading
  // Total count from API (may be larger than fetched entries due to limits)
  private totalApiCount: number | null = null;
  // Chart state for citation/year statistics visualization
  private chartContainer?: HTMLDivElement;
  private chartSvgWrapper?: HTMLDivElement;
  private chartSubHeader?: HTMLDivElement;
  private chartCollapsed: boolean;  // Initialized from preferences in constructor
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
  private readonly filterDebounceDelay = 150; // ms
  // Chart deferred rendering timer
  private chartRenderTimer?: ReturnType<typeof setTimeout>;
  // Row element pool for recycling (reduces DOM creation and GC pressure)
  private rowPool: HTMLDivElement[] = [];
  private readonly maxRowPoolSize = 150;
  // Rate limiter status display
  private rateLimiterStatusEl?: HTMLSpanElement;
  private rateLimiterUnsubscribe?: () => void;

  // Search mode state
  private searchCache = new LRUCache<string, InspireReferenceEntry[]>(50);
  private searchSort: InspireSortOption = "mostrecent";
  private currentSearchQuery?: string;  // Current active search query
  private searchHistory: SearchHistoryItem[] = [];  // Recent search queries
  private searchInputContainer?: HTMLDivElement;  // Search input UI container
  private searchInput?: HTMLInputElement;  // Search query input field
  private searchHistoryDropdown?: HTMLDivElement;  // Search history dropdown

  // Author count filter for chart
  private authorFilterEnabled = false;  // Filter for papers with <= 10 authors
  private excludeSelfCitations = false; // Use citation counts excluding self citations in chart

  // Event delegation handlers (PERF-14: single listener instead of per-row)
  private boundHandleListClick?: (e: MouseEvent) => void;
  private boundHandleListMouseOver?: (e: MouseEvent) => void;
  private boundHandleListMouseOut?: (e: MouseEvent) => void;
  private boundHandleListMouseMove?: (e: MouseEvent) => void;

  constructor(body: HTMLDivElement) {
    Zotero.debug(`[${config.addonName}] InspireReferencePanelController constructor called`);
    this.body = body;
    this.body.classList.add("zinspire-ref-panel");
    this.enableTextSelection();

    // Initialize chart collapsed state from preferences
    this.chartCollapsed = getPref("chart_default_collapsed") !== false;

    const toolbar = ztoolkit.UI.appendElement(
      {
        tag: "div",
        classList: ["zinspire-ref-panel__toolbar"],
      },
      this.body,
    ) as HTMLDivElement;

    this.statusEl = ztoolkit.UI.appendElement(
      {
        tag: "span",
        classList: ["zinspire-ref-panel__status"],
        properties: { textContent: getString("references-panel-status-empty") },
      },
      toolbar,
    ) as HTMLSpanElement;

    const tabs = ztoolkit.UI.appendElement(
      {
        tag: "div",
        classList: ["zinspire-ref-panel__tabs"],
      },
      toolbar,
    ) as HTMLDivElement;

    this.tabButtons = {
      references: this.createTabButton(tabs, "references"),
      citedBy: this.createTabButton(tabs, "citedBy"),
      entryCited: this.createTabButton(tabs, "entryCited"),
      search: this.createTabButton(tabs, "search"),
    };
    // Search tab is always visible - users can search directly from panel
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
      toolbar,
    ) as HTMLSelectElement;
    this.updateTabSelection();

    this.entryViewBackButton = ztoolkit.UI.appendElement(
      {
        tag: "button",
        classList: ["zinspire-ref-panel__button"],
        attributes: {
          title: getString("references-panel-entry-back-tooltip"),
        },
        properties: {
          textContent: getString("references-panel-entry-back", {
            args: { tab: this.getTabLabel("references") },
          }),
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
      toolbar,
    ) as HTMLButtonElement;
    this.entryViewBackButton.hidden = true;

    this.backButton = ztoolkit.UI.appendElement(
      {
        tag: "button",
        classList: ["zinspire-ref-panel__button"],
        attributes: { title: getString("references-panel-back-tooltip") },
        properties: { textContent: getString("references-panel-back") },
        listeners: [
          {
            type: "click",
            listener: () => {
              this.handleBackNavigation();
            },
          },
        ],
      },
      toolbar,
    ) as HTMLButtonElement;
    this.backButton.disabled = true;

    this.forwardButton = ztoolkit.UI.appendElement(
      {
        tag: "button",
        classList: ["zinspire-ref-panel__button"],
        attributes: { title: getString("references-panel-forward-tooltip") },
        properties: { textContent: getString("references-panel-forward") },
        listeners: [
          {
            type: "click",
            listener: () => {
              this.handleForwardNavigation();
            },
          },
        ],
      },
      toolbar,
    ) as HTMLButtonElement;
    this.forwardButton.disabled = true;

    this.filterInput = ztoolkit.UI.appendElement(
      {
        tag: "input",
        classList: ["zinspire-ref-panel__filter"],
        attributes: {
          type: "search",
          placeholder: getString("references-panel-filter-placeholder"),
        },
        listeners: [
          {
            type: "input",
            listener: (event: Event) => {
              const target = event.target as HTMLInputElement;
              this.filterText = target.value.trim();
              // Debounce filter input to avoid excessive re-renders during fast typing
              if (this.filterDebounceTimer) {
                clearTimeout(this.filterDebounceTimer);
              }
              this.filterDebounceTimer = setTimeout(() => {
                this.renderChart();           // Update chart to reflect filtered data
                this.renderReferenceList();   // Update list with filtered entries
              }, this.filterDebounceDelay);
            },
          },
        ],
      },
      toolbar,
    ) as HTMLInputElement;

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

    // Create search input container (hidden by default, shown in search mode)
    Zotero.debug(`[${config.addonName}] InspireReferencePanelController: creating search input container`);
    this.createSearchInputContainer(toolbar);

    // Load search history from preferences
    this.loadSearchHistory();
    Zotero.debug(`[${config.addonName}] InspireReferencePanelController: loaded search history, count=${this.searchHistory.length}`);

    // Create chart container (between toolbar and list)
    const chartContainer = this.createChartContainer();
    this.body.appendChild(chartContainer);
    this.observeChartResize(chartContainer);

    this.listEl = ztoolkit.UI.appendElement(
      {
        tag: "div",
        classList: ["zinspire-ref-panel__list"],
      },
      this.body,
    ) as HTMLDivElement;

    // Setup event delegation on listEl (PERF-14: reduces listeners from 10000+ to 4)
    this.setupEventDelegation();

    this.allEntries = [];
    this.renderChartImmediate();
    this.renderMessage(getString("references-panel-status-empty"));
    this.registerNotifier();
    InspireReferencePanelController.instances.add(this);
    InspireReferencePanelController.syncBackButtonStates();
    Zotero.debug(`[${config.addonName}] InspireReferencePanelController constructor completed, instances count=${InspireReferencePanelController.instances.size}`);
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

      // Marker click (add/show item)
      if (target.closest(".zinspire-ref-entry__dot")) {
        event.preventDefault();
        const marker = target.closest(".zinspire-ref-entry__dot") as HTMLElement;
        this.handleMarkerClick(entry, marker).catch(() => void 0);
        return;
      }

      // Link button click (link/unlink reference)
      if (target.closest(".zinspire-ref-entry__link")) {
        event.preventDefault();
        const linkButton = target.closest(".zinspire-ref-entry__link") as HTMLElement;
        this.handleLinkAction(entry, linkButton).catch((err) => {
          if ((err as any)?.name !== "AbortError") {
            Zotero.debug(`[${config.addonName}] Unable to link reference: ${err}`);
          }
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
        const bibtexButton = target.closest(".zinspire-ref-entry__bibtex") as HTMLButtonElement;
        if (!bibtexButton.disabled) {
          this.handleBibTeXCopy(entry, bibtexButton).catch(() => void 0);
        }
        return;
      }

      // Author link click (show author papers)
      if (target.closest(".zinspire-ref-entry__author-link")) {
        event.preventDefault();
        event.stopPropagation();
        const authorLink = target.closest(".zinspire-ref-entry__author-link") as HTMLElement;
        const authorIndex = parseInt(authorLink.dataset.authorIndex ?? "-1", 10);
        if (authorIndex >= 0 && entry.authorSearchInfos?.[authorIndex]) {
          this.showAuthorPapersTab(entry.authorSearchInfos[authorIndex]).catch(() => void 0);
        } else if (authorIndex >= 0 && entry.authors[authorIndex]) {
          // Fallback: use author name directly
          this.showAuthorPapersTab({ fullName: entry.authors[authorIndex] }).catch(() => void 0);
        }
        return;
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

      // BibTeX button hover
      const bibtexButton = target.closest(".zinspire-ref-entry__bibtex") as HTMLButtonElement | null;
      if (bibtexButton && !bibtexButton.disabled) {
        bibtexButton.style.opacity = "1";
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

      // BibTeX button mouseout
      const bibtexButton = target.closest(".zinspire-ref-entry__bibtex") as HTMLButtonElement | null;
      if (bibtexButton && !bibtexButton.disabled) {
        bibtexButton.style.opacity = "0.7";
        return;
      }
    };

    // Mousemove handler for tooltip position
    this.boundHandleListMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const titleLink = target.closest(".zinspire-ref-entry__title-link");
      if (titleLink) {
        this.updateTooltipPosition(event);
      }
    };

    // Attach listeners to listEl
    this.listEl.addEventListener("click", this.boundHandleListClick);
    this.listEl.addEventListener("mouseover", this.boundHandleListMouseOver);
    this.listEl.addEventListener("mouseout", this.boundHandleListMouseOut);
    this.listEl.addEventListener("mousemove", this.boundHandleListMouseMove);
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
      this.listEl.removeEventListener("mouseover", this.boundHandleListMouseOver);
      this.boundHandleListMouseOver = undefined;
    }
    if (this.boundHandleListMouseOut) {
      this.listEl.removeEventListener("mouseout", this.boundHandleListMouseOut);
      this.boundHandleListMouseOut = undefined;
    }
    if (this.boundHandleListMouseMove) {
      this.listEl.removeEventListener("mousemove", this.boundHandleListMouseMove);
      this.boundHandleListMouseMove = undefined;
    }
  }

  private observeChartResize(container: HTMLDivElement) {
    const doc = this.body.ownerDocument;
    const owningWindow = (doc?.defaultView || Zotero.getMainWindow?.()) as Window | undefined;
    const ResizeObserverClass = owningWindow?.ResizeObserver ?? (typeof ResizeObserver !== "undefined" ? ResizeObserver : undefined);
    if (!ResizeObserverClass) {
      return;
    }

    if (this.chartResizeObserver) {
      this.chartResizeObserver.disconnect();
    }

    const mainWindow = owningWindow ?? Zotero.getMainWindow?.();
    const schedule = mainWindow?.requestAnimationFrame
      ? mainWindow.requestAnimationFrame.bind(mainWindow)
      : (cb: FrameRequestCallback) => (mainWindow?.setTimeout?.(cb, 16) ?? setTimeout(cb, 16)) as unknown as number;
    const cancel = mainWindow?.cancelAnimationFrame
      ? mainWindow.cancelAnimationFrame.bind(mainWindow)
      : (id: number) => (mainWindow?.clearTimeout?.(id) ?? clearTimeout(id));

    const resizeObserver = new ResizeObserverClass((entries: ResizeObserverEntry[]) => {
      // Only re-render if we have data and width actually changed
      if (!this.allEntries.length || this.chartCollapsed) {
        return;
      }
      const entry = entries[0];
      if (!entry) return;
      const newWidth = entry.contentRect.width;
      // Skip if width hasn't changed significantly (within 1px tolerance)
      if (this.lastChartWidth !== undefined && Math.abs(newWidth - this.lastChartWidth) < 2) {
        return;
      }
      this.lastChartWidth = newWidth;

      this.clearPendingChartResize();
      const frameId = schedule(() => {
        this.chartResizeFrame = undefined;
        this.renderChart();
      });
      this.chartResizeFrame = { cancel, id: frameId };
    });

    resizeObserver.observe(container);
    this.chartResizeObserver = resizeObserver;
  }

  private clearPendingChartResize() {
    if (this.chartResizeFrame) {
      this.chartResizeFrame.cancel(this.chartResizeFrame.id);
      this.chartResizeFrame = undefined;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chart Methods - Statistics visualization for references/cited-by/author papers
  // ─────────────────────────────────────────────────────────────────────────────

  private createChartContainer(): HTMLDivElement {
    const doc = this.body.ownerDocument;
    const container = doc.createElement("div");
    container.className = "zinspire-chart-container";
    // Soft muted blue color scheme - subtle and professional
    // Apply inline styles for reliable rendering (CSS files may not load properly in Zotero)
    // Start collapsed by default (chartCollapsed = true)
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 6px 10px;
      background: #f8fafc;
      flex-shrink: 0;
      height: auto;
      min-height: auto;
      max-height: auto;
    `;

    // Header with view buttons
    const header = doc.createElement("div");
    header.className = "zinspire-chart-header";
    header.style.cssText = `
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      margin-bottom: 4px;
      flex-shrink: 0;
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
    const collapseBtn = doc.createElement("button");
    collapseBtn.className = "zinspire-chart-collapse-btn";
    collapseBtn.type = "button";
    collapseBtn.textContent = this.chartCollapsed ? "▶" : "▼";
    collapseBtn.title = getString(this.chartCollapsed ? "references-panel-chart-expand" : "references-panel-chart-collapse");
    collapseBtn.style.cssText = `
      border: 1px solid #cbd5e1;
      background: #f1f5f9;
      font-size: 10px;
      cursor: pointer;
      color: #64748b;
      padding: 2px 8px;
      border-radius: 4px;
      flex-shrink: 0;
    `;
    collapseBtn.onclick = () => {
      this.toggleChartCollapse();
    };

    // View toggle buttons - soft blue theme
    const yearBtn = doc.createElement("button");
    yearBtn.className = "zinspire-chart-toggle-btn active";
    yearBtn.type = "button";
    yearBtn.textContent = getString("references-panel-chart-by-year");
    yearBtn.dataset.mode = "year";
    yearBtn.style.cssText = `
      border: none;
      border-radius: 5px;
      padding: 3px 10px;
      background: #475569;
      font-size: 11px;
      cursor: pointer;
      color: white;
      flex-shrink: 0;
      font-weight: 500;
    `;
    yearBtn.onclick = () => this.toggleChartView("year");

    const citationBtn = doc.createElement("button");
    citationBtn.className = "zinspire-chart-toggle-btn";
    citationBtn.type = "button";
    citationBtn.textContent = getString("references-panel-chart-by-citation");
    citationBtn.dataset.mode = "citation";
    citationBtn.style.cssText = `
      border: none;
      border-radius: 5px;
      padding: 3px 10px;
      background: #e2e8f0;
      font-size: 11px;
      cursor: pointer;
      color: #475569;
      flex-shrink: 0;
      font-weight: 500;
    `;
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
      this.chartSelectedBins.clear();
      this.renderChart();
      this.renderReferenceList();
    };

    // Author filter button (filter papers with <= 10 authors, i.e., non-large-collaboration)
    const authorFilterBtn = doc.createElement("button");
    authorFilterBtn.className = "zinspire-chart-author-filter-btn";
    authorFilterBtn.type = "button";
    authorFilterBtn.textContent = getString("references-panel-chart-author-filter");
    authorFilterBtn.title = getString("references-panel-chart-author-filter-tooltip");
    authorFilterBtn.style.cssText = `
      border: none;
      border-radius: 5px;
      padding: 3px 10px;
      background: #e2e8f0;
      font-size: 11px;
      cursor: pointer;
      color: #475569;
      flex-shrink: 0;
      font-weight: 500;
    `;
    const updateAuthorFilterStyle = () => {
      if (this.authorFilterEnabled) {
        authorFilterBtn.style.background = "#475569";
        authorFilterBtn.style.color = "white";
      } else {
        authorFilterBtn.style.background = "#e2e8f0";
        authorFilterBtn.style.color = "#475569";
      }
    };
    authorFilterBtn.onclick = () => {
      this.authorFilterEnabled = !this.authorFilterEnabled;
      updateAuthorFilterStyle();
      this.renderChart();
      this.renderReferenceList();
    };
    updateAuthorFilterStyle();

    // Self-citation exclusion toggle
    const selfCiteBtn = doc.createElement("button");
    selfCiteBtn.className = "zinspire-chart-selfcite-filter-btn";
    selfCiteBtn.type = "button";
    selfCiteBtn.textContent = getString("references-panel-chart-selfcite-filter");
    selfCiteBtn.title = getString("references-panel-chart-selfcite-filter-tooltip");
    selfCiteBtn.style.cssText = `
      border: none;
      border-radius: 5px;
      padding: 3px 10px;
      background: #e2e8f0;
      font-size: 11px;
      cursor: pointer;
      color: #475569;
      flex-shrink: 0;
      font-weight: 500;
    `;
    const updateSelfCiteStyle = () => {
      if (this.excludeSelfCitations) {
        selfCiteBtn.style.background = "#475569";
        selfCiteBtn.style.color = "white";
      } else {
        selfCiteBtn.style.background = "#e2e8f0";
        selfCiteBtn.style.color = "#475569";
      }
    };
    selfCiteBtn.onclick = () => {
      this.excludeSelfCitations = !this.excludeSelfCitations;
      updateSelfCiteStyle();
      // Re-apply sorting when in References mode with citationDesc sort
      // since citation values depend on excludeSelfCitations flag
      if (this.viewMode === "references" && this.referenceSort === "citationDesc") {
        const cacheKey = this.currentRecid ?? "";
        const cached = this.referencesCache.get(cacheKey);
        if (cached) {
          this.allEntries = this.getSortedReferences(cached);
        }
      }
      this.renderChart();
      this.renderReferenceList();
    };
    updateSelfCiteStyle();

    // Spacer to push stats to the right
    const spacer = doc.createElement("div");
    spacer.style.cssText = `flex: 1;`;

    // Stats display (two lines: header + subheader alignment)
    const statsTopLine = doc.createElement("span");
    statsTopLine.className = "zinspire-chart-stats zinspire-chart-stats-top";
    statsTopLine.style.cssText = `
      font-size: 11px;
      color: #64748b;
      font-weight: 500;
      text-align: left;
      line-height: 1.3;
    `;
    const statsBottomLine = doc.createElement("span");
    statsBottomLine.className = "zinspire-chart-stats zinspire-chart-stats-bottom";
    statsBottomLine.style.cssText = `
      font-size: 11px;
      color: #64748b;
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

    // Update button states with inline styles (soft blue/slate theme)
    if (this.chartContainer) {
      const buttons = this.chartContainer.querySelectorAll(".zinspire-chart-toggle-btn");
      buttons.forEach((btn) => {
        const btnEl = btn as HTMLButtonElement;
        const isActive = btnEl.dataset.mode === mode;
        btnEl.classList.toggle("active", isActive);
        if (isActive) {
          btnEl.style.background = "#475569"; // slate-600
          btnEl.style.color = "white";
        } else {
          btnEl.style.background = "#e2e8f0"; // slate-200
          btnEl.style.color = "#475569"; // slate-600
        }
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
        getString("references-panel-chart-disabled-message") || "Statistics chart is disabled. Enable it in Zotero Preferences → INSPIRE."
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
      const collapseBtn = this.chartContainer.querySelector(".zinspire-chart-collapse-btn");
      if (collapseBtn) {
        collapseBtn.textContent = this.chartCollapsed ? "▶" : "▼";
        (collapseBtn as HTMLButtonElement).title = getString(
          this.chartCollapsed ? "references-panel-chart-expand" : "references-panel-chart-collapse"
        );
      }
    }
  }

  private computeYearStats(entries: InspireReferenceEntry[], maxBars: number = 10): ChartBin[] {
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
        key: years.length === 1 ? String(years[0]) : `${years[0]}-${years[years.length - 1]}`,
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
    const targetCountPerBin = Math.max(MIN_COUNT_PER_BIN, Math.ceil(totalCount / MAX_BARS));
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
      const shouldCreateBin = currentCount >= targetCountPerBin ||
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
      const allYears = [...(bins[mergeIdx].years || []), ...(bins[mergeIdx + 1].years || [])].sort((a, b) => a - b);
      bins = [...bins.slice(0, mergeIdx), createBin(allYears), ...bins.slice(mergeIdx + 2)];
    }

    // Phase 3: Merge tiny leading bins (very few papers in early years)
    while (bins.length > 3 && bins[0].count < MIN_COUNT_PER_BIN && bins[0].count + bins[1].count < targetCountPerBin * 1.5) {
      const allYears = [...(bins[0].years || []), ...(bins[1].years || [])].sort((a, b) => a - b);
      bins = [createBin(allYears), ...bins.slice(2)];
    }

    return bins;
  }

  private computeCitationStats(entries: InspireReferenceEntry[]): ChartBin[] {
    const ranges: Array<{ label: string; min: number; max: number; key: string }> = [
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
      range: [r.min, r.max === Infinity ? Number.MAX_SAFE_INTEGER : r.max] as [number, number],
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
    this.chartSvgWrapper.textContent = "";
    const loadingMsg = this.chartSvgWrapper.ownerDocument.createElement("div");
    loadingMsg.className = "zinspire-chart-no-data";
    loadingMsg.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #9ca3af;
      font-size: 12px;
      font-style: italic;
    `;
    loadingMsg.textContent = "Loading...";
    this.chartSvgWrapper.appendChild(loadingMsg);
  }

  // Throttle interval for chart rendering during rapid data updates (ms)
  private static readonly CHART_THROTTLE_INTERVAL = 300;
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
    const delay = timeSinceLastRender < InspireReferencePanelController.CHART_THROTTLE_INTERVAL
      ? InspireReferencePanelController.CHART_THROTTLE_INTERVAL - timeSinceLastRender
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

    // Get entries to analyze (apply author filter if enabled)
    // Use allEntries as base, then apply authorFilterEnabled if active
    const entries = this.authorFilterEnabled
      ? this.allEntries.filter((entry) => this.matchesAuthorFilter(entry))
      : this.allEntries;
    if (!entries.length) {
      const noDataMsg = this.chartSvgWrapper.ownerDocument.createElement("div");
      noDataMsg.className = "zinspire-chart-no-data";
      noDataMsg.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: #9ca3af;
        font-size: 12px;
      `;
      noDataMsg.textContent = getString("references-panel-chart-no-data");
      this.chartSvgWrapper.appendChild(noDataMsg);
      return;
    }

    // Dynamic bar count based on container width
    const MAX_BAR_WIDTH = 50;
    const MIN_BAR_WIDTH = 20;
    const DEFAULT_MAX_BARS = 10;
    const BAR_GAP = 3;
    const PADDING = 16; // left + right padding

    // Get actual container width
    const containerWidth = this.chartSvgWrapper.clientWidth || 400;

    // Calculate how many bars can fit at max width
    // Formula: containerWidth = n * maxBarWidth + (n-1) * gap + padding
    // Solving for n: n = (containerWidth - padding + gap) / (maxBarWidth + gap)
    const maxPossibleBars = Math.floor((containerWidth - PADDING + BAR_GAP) / (MAX_BAR_WIDTH + BAR_GAP));
    const dynamicMaxBars = Math.max(DEFAULT_MAX_BARS, Math.min(maxPossibleBars, 20)); // Cap at 20

    // Compute stats based on current view mode
    let stats = this.chartViewMode === "year"
      ? this.computeYearStats(entries, dynamicMaxBars)
      : this.computeCitationStats(entries);

    // Fallback: If year mode returns no stats but we have entries, try citation mode
    // This handles cases where references lack year information
    if (!stats.length && this.chartViewMode === "year" && entries.length > 0) {
      Zotero.debug(`[${config.addonName}] Chart: No year data for ${entries.length} entries, falling back to citation view`);
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
    const MAX_BAR_WIDTH_RENDER = 50;
    const MIN_BAR_WIDTH_RENDER = 15;
    const basePadding = { top: 4, right: 8, left: 8 };
    const availableWidth = containerWidth - basePadding.left - basePadding.right;
    const totalGaps = (stats.length - 1) * barGap;
    const calculatedBarWidth = (availableWidth - totalGaps) / stats.length;
    const barWidth = Math.max(MIN_BAR_WIDTH_RENDER, Math.min(calculatedBarWidth, MAX_BAR_WIDTH_RENDER));

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

    // Colors for bars (soft muted blue - professional, easy on eyes)
    const selectedColor = "#3b82f6"; // blue-500 for selected
    const unselectedColor = "#93c5fd"; // blue-300 for unselected

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
      rect.setAttribute("class", `zinspire-chart-bar${isSelected ? " selected" : ""}`);
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
        text.setAttribute("transform", `rotate(${rotationAngle} ${adjustedX} ${labelBaseline})`);
      } else {
        text.setAttribute("x", String(labelX));
        text.setAttribute("text-anchor", "middle");
      }
      text.setAttribute("font-size", "11");
      text.setAttribute("fill", "#4a4a4f");
      text.textContent = bin.label;

      // Count label on top of bar (only if bar is tall enough)
      if (barHeight > 18 && bin.count > 0) {
        const countText = doc.createElementNS(SVG_NS, "text") as SVGTextElement;
        countText.setAttribute("x", String(x + barWidth / 2));
        countText.setAttribute("y", String(y + 14));
        countText.setAttribute("text-anchor", "middle");
        countText.setAttribute("font-size", "10");
        countText.setAttribute("fill", isSelected ? "#ffffff" : "#1e3a5f");
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
        if (this.chartSelectedBins.size === 1 && this.chartSelectedBins.has(key)) {
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
    const clearBtn = this.chartContainer.querySelector(".zinspire-chart-clear-btn") as HTMLButtonElement;
    if (clearBtn) {
      clearBtn.style.display = this.chartSelectedBins.size > 0 ? "inline-block" : "none";
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
      const avgCitations = entries.length > 0 ? totalCitations / entries.length : 0;

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
            return citationCount >= 1 && citationCount <= 9;
          case "10-49":
            return citationCount >= 10 && citationCount <= 49;
          case "50-99":
            return citationCount >= 50 && citationCount <= 99;
          case "100-249":
            return citationCount >= 100 && citationCount <= 249;
          case "250-499":
            return citationCount >= 250 && citationCount <= 499;
          case "500+":
            return citationCount >= 500;
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
    return authorCount > 0 && authorCount <= 10;
  }

  destroy() {
    this.unregisterNotifier();
    this.cancelActiveRequest();
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
      this.rateLimiterStatusEl.title = getString("references-panel-rate-limit-queued", {
        args: { count: status.queuedCount },
      });
    } else {
      this.rateLimiterStatusEl.hidden = true;
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
   */
  handleRefresh() {
    if (!this.currentRecid) return;

    // Clear cache based on current view mode
    switch (this.viewMode) {
      case "references":
        this.referencesCache.delete(this.currentRecid);
        break;
      case "citedBy":
        this.citedByCache.delete(this.currentRecid);
        break;
      case "entryCited":
        if (this.entryCitedSource?.recid) {
          const cacheKey = this.entryCitedSource.recid;
          this.entryCitedCache.delete(cacheKey);
        } else if (this.entryCitedSource?.authorSearchInfo) {
          // Author papers mode: clear cache using author query as key
          const authorKey =
            this.entryCitedSource.authorSearchInfo.bai ||
            this.entryCitedSource.authorSearchInfo.fullName;
          if (authorKey) {
            this.entryCitedCache.delete(authorKey);
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

    // Re-trigger the load based on view mode
    if (this.viewMode === "references" || this.viewMode === "citedBy") {
      if (this.currentItemID) {
        const item = Zotero.Items.get(this.currentItemID);
        if (item) {
          this.loadEntries(this.currentRecid, this.viewMode).catch((err) => {
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
      const cacheKey = this.entryCitedSource.recid || this.entryCitedSource.authorQuery;
      if (cacheKey) {
        this.loadEntries(cacheKey, "entryCited", { force: true }).catch((err) => {
          if ((err as any)?.name !== "AbortError") {
            Zotero.debug(
              `[${config.addonName}] Failed to refresh entryCited data: ${err}`,
            );
            this.allEntries = [];
            this.renderChartImmediate();
            this.renderMessage(getString("references-panel-status-error"));
          }
        });
      }
    }
  }

  /**
   * Copy all visible references as BibTeX to the clipboard.
   * Uses batch queries to efficiently fetch BibTeX from INSPIRE.
   */
  async copyAllBibTeX() {
    const strings = getCachedStrings();
    const entriesWithRecid = this.allEntries.filter((e) => e.recid);

    if (!entriesWithRecid.length) {
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({ text: strings.noRecidEntries, type: "default" })
        .show();
      return;
    }

    const BATCH_SIZE = 50; // Same as existing code for metadata batch fetch
    const allBibTeX: string[] = [];
    let successCount = 0;

    const progressWin = new ztoolkit.ProgressWindow(config.addonName)
      .createLine({ text: strings.bibtexFetching, type: "default" })
      .show();

    try {
      for (let i = 0; i < entriesWithRecid.length; i += BATCH_SIZE) {
        const batch = entriesWithRecid.slice(i, i + BATCH_SIZE);
        const recids = batch.map((e) => e.recid!);
        const query = recids.map((r) => `recid:${r}`).join(" OR ");
        const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${recids.length}&format=bibtex`;

        try {
          const response = await inspireFetch(url);
          if (response.ok) {
            const bibtex = await response.text();
            if (bibtex?.trim()) {
              allBibTeX.push(bibtex.trim());
              successCount += recids.length;
            }
          }
        } catch (e) {
          Zotero.debug(
            `[${config.addonName}] Failed to fetch BibTeX batch: ${e}`,
          );
        }
      }

      if (allBibTeX.length) {
        const success = await copyToClipboard(allBibTeX.join("\n\n"));
        if (success) {
          progressWin.changeLine({
            text: getString("references-panel-bibtex-all-copied", {
              args: { count: successCount },
            }),
            type: "success",
          });
        }
      } else {
        progressWin.changeLine({
          text: strings.bibtexAllFailed,
          type: "fail",
        });
      }
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Copy all BibTeX error: ${e}`);
      progressWin.changeLine({
        text: strings.bibtexAllFailed,
        type: "fail",
      });
    }

    setTimeout(() => progressWin.close(), 2000);
  }

  /**
   * Show export menu with format options (BibTeX, LaTeX US, LaTeX EU).
   * User can choose to copy to clipboard or export to file.
   */
  showExportMenu(event: Event) {
    const entriesWithRecid = this.allEntries.filter((e) => e.recid);
    if (!entriesWithRecid.length) {
      const strings = getCachedStrings();
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({ text: strings.noRecidEntries, type: "default" })
        .show();
      return;
    }

    const doc = this.body.ownerDocument;

    // Remove existing popup if any
    const existingPopup = doc.getElementById("zinspire-export-popup");
    if (existingPopup) {
      existingPopup.remove();
    }

    // Create popup menu
    const popup = doc.createXULElement("menupopup") as XUL.MenuPopup;
    popup.id = "zinspire-export-popup";

    const formats = [
      { id: "bibtex", label: "BibTeX (.bib)", ext: ".bib" },
      { id: "latex-us", label: "LaTeX (US)", ext: ".tex" },
      { id: "latex-eu", label: "LaTeX (EU)", ext: ".tex" },
    ];

    // Copy to clipboard section header
    const copyHeader = doc.createXULElement("menuitem");
    copyHeader.setAttribute("label", getString("references-panel-export-copy-header"));
    copyHeader.setAttribute("disabled", "true");
    popup.appendChild(copyHeader);

    for (const format of formats) {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", `  ${format.label}`);
      item.addEventListener("command", () => {
        this.exportEntries(format.id, "clipboard");
      });
      popup.appendChild(item);
    }

    // Separator
    popup.appendChild(doc.createXULElement("menuseparator"));

    // Export to file section header
    const exportHeader = doc.createXULElement("menuitem");
    exportHeader.setAttribute("label", getString("references-panel-export-file-header"));
    exportHeader.setAttribute("disabled", "true");
    popup.appendChild(exportHeader);

    for (const format of formats) {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", `  ${format.label}`);
      item.addEventListener("command", () => {
        this.exportEntries(format.id, "file", format.ext);
      });
      popup.appendChild(item);
    }

    // Add popup to document and show near the button
    doc.documentElement.appendChild(popup);
    const anchor = event.target as Element;
    // openPopup(anchor, position, x, y, isContextMenu, attributesOverride, triggerEvent)
    // position: "after_start" = below anchor, left-aligned
    //   - "before_start/end" = above anchor
    //   - "after_start/end" = below anchor  
    //   - "start" = left-aligned, "end" = right-aligned
    // x, y: offset from calculated position
    // isContextMenu: false (not a context menu)
    // attributesOverride: false (don't override popup attributes)
    popup.openPopup(anchor, "after_end", 0, 0, false, false);
  }

  /**
   * Export entries in specified format to clipboard or file.
   * Supports: bibtex, latex-us, latex-eu
   */
  private async exportEntries(
    format: string,
    target: "clipboard" | "file",
    fileExt: string = ".bib"
  ) {
    const entriesWithRecid = this.allEntries.filter((e) => e.recid);
    const strings = getCachedStrings();

    const BATCH_SIZE = 50;
    const allContent: string[] = [];
    let successCount = 0;
    let failedBatches = 0;

    const progressWin = new ztoolkit.ProgressWindow(config.addonName)
      .createLine({ text: strings.bibtexFetching, type: "default" })
      .show();

    try {
      for (let i = 0; i < entriesWithRecid.length; i += BATCH_SIZE) {
        const batch = entriesWithRecid.slice(i, i + BATCH_SIZE);
        const recids = batch.map((e) => e.recid!);
        const query = recids.map((r) => `recid:${r}`).join(" OR ");
        const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${recids.length}&format=${format}`;

        try {
          const response = await inspireFetch(url);
          if (response.ok) {
            const content = await response.text();
            if (content?.trim()) {
              allContent.push(content.trim());
              // Count entries (BibTeX uses @type{, LaTeX uses \cite{ or direct entries)
              const entryCount = format === "bibtex"
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
          Zotero.debug(`[${config.addonName}] Failed to fetch ${format} batch: ${e}`);
          failedBatches++;
        }
      }

      if (!allContent.length) {
        progressWin.changeLine({ text: strings.bibtexAllFailed, type: "fail" });
        setTimeout(() => progressWin.close(), 2000);
        return;
      }

      const fullContent = allContent.join("\n\n");
      const formatLabel = format === "bibtex" ? "BibTeX" : format === "latex-us" ? "LaTeX(US)" : "LaTeX(EU)";

      if (target === "clipboard") {
        // Warn if content is very large (may exceed clipboard limits)
        const contentSize = new Blob([fullContent]).size;
        const CLIPBOARD_WARN_SIZE = 500 * 1024; // 500KB threshold

        if (contentSize > CLIPBOARD_WARN_SIZE) {
          // Content too large, suggest file export
          progressWin.changeLine({
            text: getString("references-panel-export-too-large", {
              args: { size: Math.round(contentSize / 1024) },
            }),
            type: "fail",
          });
          setTimeout(() => progressWin.close(), 3000);
          return;
        }

        const success = await copyToClipboard(fullContent);
        if (success) {
          progressWin.changeLine({
            text: getString("references-panel-export-copied", {
              args: { count: successCount, format: formatLabel },
            }),
            type: "success",
          });
        } else {
          progressWin.changeLine({
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
            text: getString("references-panel-export-saved", {
              args: { count: successCount, format: formatLabel },
            }),
            type: "success",
          });
        } else {
          progressWin.changeLine({
            text: getString("references-panel-export-cancelled"),
            type: "default",
          });
        }
      }
    } catch (e) {
      Zotero.debug(`[${config.addonName}] Export error: ${e}`);
      progressWin.changeLine({ text: strings.bibtexAllFailed, type: "fail" });
    }

    setTimeout(() => progressWin.close(), 2000);
  }

  /**
   * Prompt user to save file with FilePicker dialog.
   */
  private async promptSaveFile(defaultFilename: string, ext: string): Promise<string | null> {
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
      const previousItemID = this.currentItemID;
      const itemChanged = previousItemID !== item.id;
      this.currentItemID = item.id;
      if (itemChanged && !InspireReferencePanelController.isNavigatingHistory) {
        InspireReferencePanelController.forwardStack = [];
        InspireReferencePanelController.syncBackButtonStates();
      }

      if (itemChanged) {
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
          this.renderChartLoading(); // Show loading state in chart
          this.renderMessage(this.getLoadingMessageForMode(this.viewMode));
        } else {
          Zotero.debug(`[${config.addonName}] handleItemChange: in search mode, preserving search results`);
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
    if (!snapshot.itemID || !Zotero.Reader || typeof Zotero.Reader.open !== "function") {
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
    const finalTabType = liveTabType === "reader" ? "reader" : this.currentTabType;
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
        const readerTabExists = ReaderTabHelper.getReaderByTabID(snapshot.readerTabID);
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
        const readerTabExists = ReaderTabHelper.getReaderByTabID(snapshot.readerTabID);
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
    if (this.forwardButton) {
      const hasForward = InspireReferencePanelController.forwardStack.length > 0;
      this.forwardButton.disabled = !hasForward || navigating;
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
        this.renderChart();  // Use deferred render (same as original implementation)
        this.renderReferenceList({ preserveScroll: !shouldReset });
        if (shouldReset) {
          this.resetListScroll();
        } else {
          setTimeout(() => {
            this.restoreScrollPositionIfNeeded();
          }, 0);
        }
      }
      return;
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
      const onProgress = (currentEntries: InspireReferenceEntry[], total: number | null) => {
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
          this.renderChartImmediate();  // Render chart immediately on first page
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
        const referencesOnProgress = (currentEntries: InspireReferenceEntry[], total: number) => {
          if (this.pendingToken !== token || this.viewMode !== mode) {
            return;
          }
          // Apply sorting before display
          this.allEntries = this.getSortedReferences(currentEntries);

          // Update status with loading progress (only when not filtering)
          if (!this.filterText) {
            this.setStatus(`Loading... ${currentEntries.length} of ${total} references`);
          }

          // First page: full render for initial display (same pattern as onProgress)
          if (!hasRenderedFirstPage) {
            this.renderChartImmediate();  // Render chart on first page
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

        entries = await this.fetchReferences(recid, controller?.signal, referencesOnProgress);
      } else if (mode === "entryCited" && this.entryCitedSource?.authorSearchInfo) {
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

      if (this.pendingToken === token && this.viewMode === mode) {
        const entriesForDisplay =
          mode === "references" ? this.getSortedReferences(entries) : entries;
        this.allEntries = entriesForDisplay;
        this.chartSelectedBins.clear(); // Clear chart selection on data change
        this.renderChart();  // Use deferred render (same as original implementation)
        this.renderReferenceList();
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
      // enrichCitationCounts fetches citation counts for references mode
      // enrichEntries fetches missing metadata for citedBy/entryCited modes
      const enrichToken = token;
      const enrichSignal = controller?.signal;
      setTimeout(async () => {
        // Skip if request was cancelled or mode changed
        if (this.pendingToken !== enrichToken) return;
        try {
          if (mode === "references") {
            await Promise.allSettled([
              this.enrichLocalStatus(entries, enrichSignal),
              this.enrichCitationCounts(entries, enrichSignal),
            ]);
          } else {
            await Promise.allSettled([
              this.enrichLocalStatus(entries, enrichSignal),
              this.enrichEntries(entries, enrichSignal),
            ]);
          }
        } catch (err) {
          // Silently ignore enrichment errors - they don't affect core functionality
          if ((err as any)?.name !== "AbortError") {
            Zotero.debug(`[${config.addonName}] Enrichment error: ${err}`);
          }
        }
      }, 0);
    } finally {
      if (this.pendingToken === token) {
        this.activeAbort = undefined;
      }
      if (isActiveMode) {
        this.setRefreshButtonLoading(false);
      }
    }
  }

  private async fetchReferences(
    recid: string,
    signal?: AbortSignal,
    onProgress?: (entries: InspireReferenceEntry[], total: number) => void,
  ) {
    Zotero.debug(
      `[${config.addonName}] Fetching references for recid ${recid}`,
    );
    // Pre-fetch cached strings once before processing all references
    const strings = getCachedStrings();
    const response = await inspireFetch(
      `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}?fields=metadata.references`,
      signal ? { signal } : undefined,
    ).catch(() => null);
    if (!response || response.status === 404) {
      throw new Error("Reference list not found");
    }
    const payload: any = await response.json();
    const references = payload?.metadata?.references ?? [];
    const totalCount = references.length;
    Zotero.debug(
      `[${config.addonName}] Retrieved ${totalCount} references for ${recid}`,
    );

    // Progressive rendering: process and report in batches
    const entries: InspireReferenceEntry[] = [];
    const BATCH_SIZE = 100;

    for (let i = 0; i < totalCount; i++) {
      if (signal?.aborted) break;
      entries.push(this.buildEntry(references[i], i, strings));

      // Report progress every batch for progressive rendering
      // PERF-16: Pass array reference directly instead of cloning
      if (onProgress && (entries.length % BATCH_SIZE === 0 || i === totalCount - 1)) {
        onProgress(entries, totalCount);
      }
    }

    return entries;
  }

  private async fetchCitedBy(
    recid: string,
    sort: InspireSortOption,
    signal?: AbortSignal,
    onProgress?: (entries: InspireReferenceEntry[], total: number | null) => void,
  ) {
    Zotero.debug(
      `[${config.addonName}] Fetching citing records for recid ${recid}`,
    );
    const entries: InspireReferenceEntry[] = [];
    const query = encodeURIComponent(`refersto:recid:${recid}`);
    const sortParam = sort ? `&sort=${sort}` : "";
    // Include authors.ids for BAI extraction (most reliable for author search)
    const fieldsParam = "&fields=control_number,titles.title,authors.full_name,authors.ids,publication_info,earliest_date,dois,arxiv_eprints,citation_count,citation_count_without_self_citations";

    // Helper to fetch a single page
    const fetchPage = async (pageNum: number, pageSize: number): Promise<any[]> => {
      const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=${pageSize}&page=${pageNum}${sortParam}${fieldsParam}`;
      const response = await inspireFetch(url, signal ? { signal } : undefined).catch(() => null);
      if (!response || response.status === 404) {
        return [];
      }
      const payload: any = await response.json();
      return Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
    };

    // Step 1: Fetch first page to get total count and display initial results quickly
    const firstUrl = `${INSPIRE_API_BASE}/literature?q=${query}&size=${CITED_BY_PAGE_SIZE}&page=1${sortParam}${fieldsParam}`;
    const firstResponse = await inspireFetch(firstUrl, signal ? { signal } : undefined).catch(() => null);
    if (!firstResponse || firstResponse.status === 404) {
      throw new Error("Cited-by list not found");
    }
    const firstPayload: any = await firstResponse.json();
    const totalHits = typeof firstPayload?.hits?.total === "number" ? firstPayload.hits.total : 0;
    const firstHits = Array.isArray(firstPayload?.hits?.hits) ? firstPayload.hits.hits : [];

    // Process first page results
    for (const hit of firstHits) {
      entries.push(this.buildEntryFromSearch(hit, entries.length));
    }

    // Show first page immediately
    if (onProgress && entries.length > 0) {
      onProgress(entries, totalHits);
    }

    // Step 2: Calculate remaining pages needed and fetch in parallel batches
    if (entries.length < totalHits && entries.length < CITED_BY_MAX_RESULTS && !signal?.aborted) {
      const remaining = Math.min(totalHits, CITED_BY_MAX_RESULTS) - entries.length;
      const pagesNeeded = Math.ceil(remaining / CITED_BY_PAGE_SIZE);
      const maxPages = Math.min(pagesNeeded, CITED_BY_MAX_PAGES - 1); // -1 for first page already fetched

      // Fetch subsequent pages in parallel batches
      for (let batchStart = 0; batchStart < maxPages && !signal?.aborted; batchStart += CITED_BY_PARALLEL_BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + CITED_BY_PARALLEL_BATCH_SIZE, maxPages);
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
        if (entries.length >= totalHits || entries.length >= CITED_BY_MAX_RESULTS) {
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
    onProgress?: (entries: InspireReferenceEntry[], total: number | null) => void,
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
    // Include authors.ids for BAI extraction (most reliable for author search)
    const fieldsParam = "&fields=control_number,titles.title,authors.full_name,authors.ids,publication_info,earliest_date,dois,arxiv_eprints,citation_count,citation_count_without_self_citations";

    // Helper to fetch a single page
    const fetchPage = async (pageNum: number, pageSize: number): Promise<any[]> => {
      const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=${pageSize}&page=${pageNum}${sortParam}${fieldsParam}`;
      const response = await inspireFetch(url, signal ? { signal } : undefined).catch(() => null);
      if (!response || response.status === 404) {
        return [];
      }
      const payload: any = await response.json();
      return Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
    };

    // Step 1: Fetch first page to get total count and display initial results quickly
    const firstUrl = `${INSPIRE_API_BASE}/literature?q=${query}&size=${CITED_BY_PAGE_SIZE}&page=1${sortParam}${fieldsParam}`;
    const firstResponse = await inspireFetch(firstUrl, signal ? { signal } : undefined).catch(() => null);
    if (!firstResponse || firstResponse.status === 404) {
      throw new Error("Author papers not found");
    }
    const firstPayload: any = await firstResponse.json();
    const totalHits = typeof firstPayload?.hits?.total === "number" ? firstPayload.hits.total : 0;
    const firstHits = Array.isArray(firstPayload?.hits?.hits) ? firstPayload.hits.hits : [];

    // Process first page results
    for (const hit of firstHits) {
      entries.push(this.buildEntryFromSearch(hit, entries.length));
    }

    // Show first page immediately
    if (onProgress && entries.length > 0) {
      onProgress(entries, totalHits);
    }

    // Step 2: Calculate remaining pages needed and fetch in parallel batches
    if (entries.length < totalHits && entries.length < CITED_BY_MAX_RESULTS && !signal?.aborted) {
      const remaining = Math.min(totalHits, CITED_BY_MAX_RESULTS) - entries.length;
      const pagesNeeded = Math.ceil(remaining / CITED_BY_PAGE_SIZE);
      const maxPages = Math.min(pagesNeeded, CITED_BY_MAX_PAGES - 1); // -1 for first page already fetched

      // Fetch subsequent pages in parallel batches
      for (let batchStart = 0; batchStart < maxPages && !signal?.aborted; batchStart += CITED_BY_PARALLEL_BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + CITED_BY_PARALLEL_BATCH_SIZE, maxPages);
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
        if (entries.length >= totalHits || entries.length >= CITED_BY_MAX_RESULTS) {
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
      (entry) =>
        entry.recid && (
          !entry.title ||
          entry.title === noTitleStr
        ),
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
    const recids = entries
      .map((e) => e.recid)
      .filter((r): r is string => !!r);
    if (!recids.length) {
      return;
    }
    const fieldID = Zotero.ItemFields.getID("archiveLocation");
    if (!fieldID) {
      return;
    }

    // Increased chunk size for fewer SQL queries (was 100, now 500)
    // SQLite handles IN clauses with 500+ parameters efficiently
    const CHUNK_SIZE = 500;
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

    for (const entry of entries) {
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
   * Enrich citation counts for references entries.
   * Uses batch INSPIRE API queries to fetch citation counts efficiently.
   * Parallel fetching: processes multiple batches concurrently for better performance.
   */
  private async enrichCitationCounts(
    entries: InspireReferenceEntry[],
    signal?: AbortSignal,
  ) {
    const strings = getCachedStrings();
    // Filter entries that have recid but are missing citation count or essential metadata
    const needsDetails = entries.filter(
      (entry) =>
        entry.recid &&
        (
          typeof entry.citationCount !== "number" ||
          !entry.title ||
          entry.title === strings.noTitle ||
          !entry.authors.length ||
          (entry.authors.length === 1 && entry.authors[0] === strings.unknownAuthor)
        ),
    );

    if (!needsDetails.length || signal?.aborted) {
      return;
    }

    Zotero.debug(
      `[${config.addonName}] Enriching citation counts for ${needsDetails.length} references`
    );

    // Batch query INSPIRE API for citation counts
    // Use chunks of 50 recids to avoid URL length limits
    const BATCH_SIZE = 50;
    const PARALLEL_BATCHES = 3; // Number of batches to fetch in parallel
    const recidToEntry = new Map<string, InspireReferenceEntry[]>();

    // Group entries by recid (some might have the same recid)
    for (const entry of needsDetails) {
      const existing = recidToEntry.get(entry.recid!) || [];
      existing.push(entry);
      recidToEntry.set(entry.recid!, existing);
    }

    const uniqueRecids = Array.from(recidToEntry.keys());

    // Split into batches
    const batches: string[][] = [];
    for (let i = 0; i < uniqueRecids.length; i += BATCH_SIZE) {
      batches.push(uniqueRecids.slice(i, i + BATCH_SIZE));
    }

    // Process batches in parallel groups
    for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
      if (signal?.aborted) return;

      const parallelBatches = batches.slice(i, i + PARALLEL_BATCHES);
      await Promise.all(
        parallelBatches.map(batch =>
          this.fetchBatchCitationCounts(batch, recidToEntry, signal)
        )
      );
    }
  }

  /**
   * Fetch citation counts for a single batch of recids.
   * Extracted from enrichCitationCounts to enable parallel fetching.
   */
  private async fetchBatchCitationCounts(
    batchRecids: string[],
    recidToEntry: Map<string, InspireReferenceEntry[]>,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted || !batchRecids.length) return;

    const query = batchRecids.map(r => `recid:${r}`).join(" OR ");
    const fieldsParam = "&fields=control_number,citation_count,citation_count_without_self_citations,titles.title,authors.full_name,author_count,publication_info,earliest_date,arxiv_eprints";
    const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${batchRecids.length}${fieldsParam}`;

    try {
      const response = await inspireFetch(url, signal ? { signal } : undefined).catch(() => null);
      if (!response || response.status !== 200) return;

      const payload: any = await response.json();
      const hits = payload?.hits?.hits ?? [];

      // Map results back to entries
      for (const hit of hits) {
        const recid = String(hit?.metadata?.control_number || hit?.id);
        const metadata = hit?.metadata ?? {};
        const citationCount = metadata?.citation_count;

        if (recid && typeof citationCount === "number") {
          const matchingEntries = recidToEntry.get(recid);
          if (matchingEntries) {
            for (const entry of matchingEntries) {
              entry.citationCount = citationCount;
              this.updateRowCitationCount(entry);
            }
          }
        }

        if (recid) {
          const matchingEntries = recidToEntry.get(recid);
          if (matchingEntries) {
            for (const entry of matchingEntries) {
              this.applySearchMetadataToEntry(entry, metadata);
              this.updateRowMetadata(entry);
            }
          }
        }
      }
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        Zotero.debug(`[${config.addonName}] Error fetching citation counts batch: ${err}`);
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

    const statsButton = row.querySelector(".zinspire-ref-entry__stats-button") as HTMLButtonElement | null;
    const statsDiv = row.querySelector(".zinspire-ref-entry__stats:not(.zinspire-ref-entry__stats-button)") as HTMLDivElement | null;

    const displayCitationCount = this.getCitationValue(entry);
    const hasCitationCount = displayCitationCount > 0 ||
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
        const content = row.querySelector(".zinspire-ref-entry__content") as HTMLDivElement | null;
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
      marker.setAttribute(
        "title",
        entry.localItemID ? s.dotLocal : s.dotAdd,
      );
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
    const labelSpan = row.querySelector(".zinspire-ref-entry__label") as HTMLElement;
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
    const authorsContainer = row.querySelector(".zinspire-ref-entry__authors") as HTMLElement;
    if (authorsContainer) {
      authorsContainer.innerHTML = "";
      this.appendAuthorLinks(authorsContainer, entry, s);
    }

    // Update title link - PERF-13: use existing element, events handled by delegation
    const titleLink = row.querySelector(".zinspire-ref-entry__title-link") as HTMLAnchorElement;
    if (titleLink) {
      titleLink.textContent = entry.title + ";";
      titleLink.href = entry.inspireUrl || entry.fallbackUrl || "#";
    }

    // Update meta (show/hide) - PERF-13: use existing element
    const meta = row.querySelector(".zinspire-ref-entry__meta") as HTMLElement;
    if (meta) {
      if (entry.summary) {
        meta.textContent = entry.summary;
        meta.style.display = "";
      } else {
        meta.textContent = "";
        meta.style.display = "none";
      }
    }

    // Update stats button (show/hide) - PERF-13: use existing element
    const statsButton = row.querySelector(".zinspire-ref-entry__stats-button") as HTMLButtonElement;
    if (statsButton) {
      const displayCitationCount = this.getCitationValue(entry);
      const hasCitationCount = displayCitationCount > 0 ||
        typeof entry.citationCount === "number" ||
        typeof entry.citationCountWithoutSelf === "number";
      const isReferencesMode = this.viewMode === "references";
      const canShowEntryCitedTab = Boolean(entry.recid) && (hasCitationCount || !isReferencesMode);

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


  private renderLinkButton(
    button: HTMLButtonElement,
    isLinked: boolean,
  ) {
    const doc = button.ownerDocument;
    button.innerHTML = "";
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
      // Copper/orange-brown color filter for linked state
      icon.style.filter =
        "brightness(0) saturate(100%) invert(50%) sepia(80%) saturate(400%) hue-rotate(350deg) brightness(90%) contrast(90%)";
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
        true,  // minimal mode: only fetch essential fields
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
  private applySearchMetadataToEntry(
    entry: InspireReferenceEntry,
    metadata: jsobject,
  ) {
    if (!metadata) {
      return;
    }
    const strings = getCachedStrings();

    // Citation count update (including self-citation exclusion)
    if (typeof metadata.citation_count === "number") {
      entry.citationCount = metadata.citation_count;
    }
    if (typeof metadata.citation_count_without_self_citations === "number") {
      entry.citationCountWithoutSelf = metadata.citation_count_without_self_citations;
    }

    // Title update
    if (
      (!entry.title || entry.title === strings.noTitle) &&
      Array.isArray(metadata.titles)
    ) {
      const titleObj = metadata.titles.find(
        (item: any) => typeof item?.title === "string" && item.title.trim(),
      );
      if (titleObj?.title) {
        entry.title = cleanMathTitle(titleObj.title);
      }
    }

    // Authors update
    const hasUnknownAuthor =
      entry.authors.length === 0 ||
      (entry.authors.length === 1 && entry.authors[0] === strings.unknownAuthor);
    if (hasUnknownAuthor && Array.isArray(metadata.authors)) {
      const authors = metadata.authors
        .map((author: any) => author?.full_name || author?.name || "")
        .filter(Boolean);
      if (authors.length) {
        entry.totalAuthors =
          typeof metadata.author_count === "number"
            ? metadata.author_count
            : authors.length;
        entry.authors = authors.slice(0, AUTHOR_IDS_EXTRACT_LIMIT);
        entry.authorText = formatAuthors(entry.authors, entry.totalAuthors);
      }
    }
    const metadataAuthorCount =
      typeof metadata.author_count === "number"
        ? metadata.author_count
        : Array.isArray(metadata.authors)
          ? metadata.authors.length
          : undefined;
    this.updateEntryAuthorCount(entry, metadataAuthorCount);

    // Year update
    if (
      (!entry.year || entry.year === strings.yearUnknown) &&
      metadata.earliest_date
    ) {
      entry.year = `${metadata.earliest_date}`.slice(0, 4);
    }

    // Extract arXiv details from metadata if not already present
    if (!entry.arxivDetails && metadata.arxiv_eprints) {
      const arxiv = extractArxivFromMetadata(metadata);
      if (arxiv) {
        entry.arxivDetails = arxiv;
      }
    }

    // Publication summary update
    const { primary: publicationInfo, errata } = splitPublicationInfo(
      metadata.publication_info,
    );
    if (publicationInfo || entry.arxivDetails || errata?.length) {
      entry.publicationInfo = publicationInfo ?? entry.publicationInfo;
      entry.publicationInfoErrata = errata;
      const fallbackYear =
        entry.year && entry.year !== strings.yearUnknown ? entry.year : undefined;
      entry.summary = buildPublicationSummary(
        entry.publicationInfo,
        entry.arxivDetails,
        fallbackYear,
        entry.publicationInfoErrata,
      );
    }

    // Update derived text fields
    entry.displayText = buildDisplayText(entry);
    // Invalidate searchText so it will be recalculated on next filter
    entry.searchText = "";
  }

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

  private buildEntry(
    referenceWrapper: any,
    index: number,
    strings?: Record<string, string>,
  ): InspireReferenceEntry {
    const s = strings ?? getCachedStrings();
    const reference = referenceWrapper?.reference ?? {};
    const recid =
      extractRecidFromRecordRef(referenceWrapper?.record?.["$ref"]) ||
      extractRecidFromUrls(reference?.urls);
    // Use limited author extraction for performance (large collaborations have thousands)
    const { names: authors, total: totalAuthors } = extractAuthorNamesFromReference(
      reference,
      AUTHOR_IDS_EXTRACT_LIMIT,
    );
    const arxivDetails = extractArxivFromReference(reference);
    const resolvedYear =
      reference?.publication_info?.year?.toString() ??
      (reference?.publication_info?.date
        ? `${reference.publication_info.date}`.slice(0, 4)
        : undefined);
    const { primary: publicationInfo, errata } = splitPublicationInfo(
      reference?.publication_info,
    );
    const summary = buildPublicationSummary(
      publicationInfo,
      arxivDetails,
      resolvedYear,
      errata,
    );
    const entry: InspireReferenceEntry = {
      id: `${index}-${recid ?? reference?.label ?? Date.now()}`,
      label: reference?.label,
      recid: recid ?? undefined,
      inspireUrl: buildReferenceUrl(reference, recid),
      fallbackUrl: buildFallbackUrl(reference, arxivDetails),
      title: cleanMathTitle(reference?.title?.title) || s.noTitle,
      summary,
      year: resolvedYear ?? s.yearUnknown,
      authors,
      totalAuthors,
      authorText: formatAuthors(authors, totalAuthors),
      displayText: "",
      searchText: "",
      citationCount:
        typeof reference?.citation_count === "number"
          ? reference.citation_count
          : undefined,
      citationCountWithoutSelf:
        typeof reference?.citation_count_without_self_citations === "number"
          ? reference.citation_count_without_self_citations
          : undefined,
      publicationInfo,
      publicationInfoErrata: errata,
      arxivDetails,
    };
    entry.displayText = buildDisplayText(entry);
    // Defer searchText calculation to first filter for better initial load performance
    entry.searchText = "";
    // DB lookup moved to enrichLocalStatus
    return entry;
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
    const authorSearchInfos = extractAuthorSearchInfos(rawAuthors, AUTHOR_IDS_EXTRACT_LIMIT);

    const recidSource =
      metadata.control_number ?? hit?.id ?? `${performance.now()}-${index}`;
    const recid = recidSource ? String(recidSource) : undefined;
    const year =
      (publicationInfo?.year && `${publicationInfo.year}`) ||
      (metadata.earliest_date
        ? `${metadata.earliest_date}`.slice(0, 4)
        : getString("references-panel-year-unknown"));

    const arxiv = extractArxivFromMetadata(metadata);
    const summary = buildPublicationSummary(publicationInfo, arxiv, year, errata);
    const entry: InspireReferenceEntry = {
      id: `cited-${index}-${recid ?? Date.now()}`,
      recid,
      inspireUrl: recid ? `${INSPIRE_LITERATURE_URL}/${recid}` : undefined,
      fallbackUrl: buildFallbackUrlFromMetadata(metadata, arxiv),
      title:
        cleanMathTitle(rawTitle) ||
        getString("references-panel-no-title"),
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
  private getFilteredEntries(entries: InspireReferenceEntry[]): InspireReferenceEntry[] {
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
    const chartFiltered = this.chartSelectedBins.size > 0
      ? textFiltered.filter((entry) => this.matchesChartFilter(entry))
      : textFiltered;

    // Apply author count filter (AND logic with previous filters)
    const filtered = this.authorFilterEnabled
      ? chartFiltered.filter((entry) => this.matchesAuthorFilter(entry))
      : chartFiltered;

    return filtered;
  }

  private renderReferenceList(options: { preserveScroll?: boolean; resetPagination?: boolean } = {}) {
    const { preserveScroll = false, resetPagination = true } = options;

    // Save list scroll position for potential restoration
    const previousScrollTop = preserveScroll ? this.listEl.scrollTop : 0;
    const previousScrollLeft = preserveScroll ? this.listEl.scrollLeft : 0;

    // Find and save the item pane scroll container position
    // This prevents the item pane from jumping when list content height changes
    const itemPaneContainer = this.body.closest(".item-pane-content") as HTMLElement | null;
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
    this.listEl.textContent = "";
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
      // However, when filtering, show all matching results for better UX
      // (filtered results are usually smaller and users expect to see all matches)
      const hasFilter = filterGroups.length > 0 || this.chartSelectedBins.size > 0 || this.authorFilterEnabled;
      const usePagination = !hasFilter && filtered.length > RENDER_PAGE_SIZE;
      const entriesToRender = usePagination
        ? filtered.slice(0, RENDER_PAGE_SIZE)
        : filtered;

      const fragment = this.listEl.ownerDocument.createDocumentFragment();
      for (const entry of entriesToRender) {
        fragment.appendChild(this.createReferenceRow(entry));
      }
      this.listEl.appendChild(fragment);
      this.renderedCount = entriesToRender.length;

      // Add "Load More" button with infinite scroll if there are more entries
      if (usePagination && filtered.length > this.renderedCount) {
        // Store filtered entries for infinite scroll
        this.currentFilteredEntries = filtered;
        this.renderLoadMoreButton(filtered);
      } else {
        this.currentFilteredEntries = undefined;
      }
    }
    this.lastRenderedEntries = filtered;

    // Use API total count for citedBy/entryCited modes if available
    // This shows the correct total even when we haven't fetched all entries
    const displayTotal = (this.viewMode !== "references" && this.totalApiCount !== null)
      ? this.totalApiCount
      : this.allEntries.length;
    const fetchedCount = this.allEntries.length;

    if (filterGroups.length) {
      // For filter mode, show matches and indicate if searching in partial data
      const isPartialData = this.viewMode !== "references" &&
        this.totalApiCount !== null &&
        fetchedCount < this.totalApiCount;

      if (isPartialData) {
        // Show "X matches in Y loaded (Z total)" for partial data
        this.setStatus(
          this.getFilterCountMessageForMode(
            this.viewMode,
            filtered.length,
            fetchedCount,  // Show loaded count, not API total
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
  private renderLoadMoreButton(allFiltered: InspireReferenceEntry[]) {
    const doc = this.listEl.ownerDocument;
    const remaining = allFiltered.length - this.renderedCount;
    const nextBatch = Math.min(remaining, RENDER_PAGE_SIZE);

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
      return;  // Fall back to manual click
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
        root: this.listEl,  // Observe within the scroll container
        rootMargin: "200px",  // Trigger 200px before container is visible
        threshold: 0,
      }
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

    // Calculate next batch
    const startIndex = this.renderedCount;
    const endIndex = Math.min(startIndex + RENDER_PAGE_SIZE, allFiltered.length);
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
      this.renderLoadMoreButton(allFiltered);
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
    const entriesToAppend = newEntries.slice(0, maxToRender - entriesAlreadyInDom);
    if (!entriesToAppend.length) {
      return 0;
    }

    const fragment = this.listEl.ownerDocument.createDocumentFragment();
    for (const entry of entriesToAppend) {
      fragment.appendChild(this.createReferenceRow(entry));
    }

    // Insert before load-more container if it exists, otherwise append
    if (this.loadMoreContainer && this.loadMoreContainer.parentElement === this.listEl) {
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
    return this.currentSearchQuery || getString("references-panel-search-label-default");
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
      if (this.viewMode === "references" || this.viewMode === "citedBy" || this.viewMode === "search") {
        this.entryCitedPreviousMode = this.viewMode;
      }
    }
    this.viewMode = mode;
    this.updateTabSelection();
    this.updateSearchUIVisibility();

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
      const cacheKey = this.getCacheKey(this.currentSearchQuery, "search", this.searchSort);
      const cached = this.searchCache.get(cacheKey);
      if (cached) {
        this.allEntries = cached;
        this.totalApiCount = null;
        this.chartSelectedBins.clear();
        this.cachedChartStats = undefined;
        this.renderChartImmediate();  // Use immediate render for cache hit
        this.renderReferenceList({ preserveScroll: false });
        return;
      }
      await this.loadSearchResults(this.currentSearchQuery).catch((err) => {
        if ((err as any)?.name !== "AbortError") {
          Zotero.debug(`[${config.addonName}] Failed to load search results: ${err}`);
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
    const shouldResetEntry = mode === "entryCited" && this.pendingEntryScrollReset;
    if (cached) {
      const entriesForDisplay =
        mode === "references" ? this.getSortedReferences(cached) : cached;
      this.allEntries = entriesForDisplay;
      // Reset totalApiCount for cached data (allEntries.length is accurate)
      this.totalApiCount = null;
      // Clear chart selection and render chart for new data
      this.chartSelectedBins.clear();
      this.cachedChartStats = undefined;
      this.lastRenderedEntries = [];
      this.chartNeedsRefresh = true;
      this.lastRenderedEntries = [];
      this.chartNeedsRefresh = true;
      this.renderChartImmediate();  // Use immediate render for cache hit
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
    (Object.entries(this.tabButtons) as [
      InspireViewMode,
      HTMLButtonElement,
    ][]).forEach(([mode, button]) => {
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
    if (isEntryMode) {
      const previousTabLabel = this.getTabLabel(this.entryCitedPreviousMode);
      this.entryViewBackButton.textContent = getString(
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
        ? Boolean(this.entryCitedSource?.recid || this.entryCitedSource?.authorQuery)
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
      const cacheKey = this.getCacheKey(this.currentSearchQuery, "search", rawValue);
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
    inputWrapper.style.cssText = `
      position: relative;
      flex: 1 1 auto;
      min-width: 150px;
      display: flex;
      align-items: center;
    `;

    // Search input field - needs transparent background for hint to show through
    this.searchInput = doc.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.className = "zinspire-search-input";
    this.searchInput.placeholder = getString("references-panel-search-placeholder");
    // Disable browser autocomplete to use our inline hint instead
    this.searchInput.setAttribute("autocomplete", "off");
    this.searchInput.setAttribute("autocorrect", "off");
    this.searchInput.setAttribute("autocapitalize", "off");
    this.searchInput.setAttribute("spellcheck", "false");
    this.searchInput.style.cssText = `
      width: 100%;
      padding: 4px 8px;
      border: 1px solid var(--zotero-gray-4, #d1d1d5);
      border-radius: 4px;
      font-size: 12px;
      background-color: transparent !important;
      background: none !important;
      position: relative;
      z-index: 2;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    // Create inline hint overlay (gray text showing suggestion)
    // This sits behind the input but shows through the transparent background
    const inlineHint = doc.createElement("span");
    inlineHint.className = "zinspire-search-inline-hint";
    inlineHint.style.cssText = `
      position: absolute;
      left: 9px;
      top: 50%;
      transform: translateY(-50%);
      color: #999;
      font-size: 12px;
      pointer-events: none;
      white-space: pre;
      overflow: hidden;
      z-index: 1;
      display: none;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1;
    `;

    // Track current hint for Tab/ArrowRight completion
    let currentHintText = "";

    // Update inline hint based on input
    const updateInlineHint = () => {
      const inputValue = this.searchInput?.value || "";

      if (!inputValue || this.searchHistory.length === 0) {
        inlineHint.style.display = "none";
        currentHintText = "";
        return;
      }

      // Find matching history entry
      let matchingHint = "";
      for (const historyItem of this.searchHistory) {
        const historyQuery = historyItem.query;
        if (historyQuery.toLowerCase().startsWith(inputValue.toLowerCase()) && historyQuery.length > inputValue.length) {
          matchingHint = historyQuery;
          break;
        }
      }

      if (!matchingHint) {
        inlineHint.style.display = "none";
        currentHintText = "";
        return;
      }

      // Show hint: display only the remaining suggestion after what user typed
      const rawSuffix = matchingHint.slice(inputValue.length);
      // Use replace to handle multiple spaces and preserve them
      const hintSuffix = rawSuffix.replace(/ /g, '\u00A0');
      currentHintText = matchingHint;

      // Calculate position based on input text width using canvas for accurate measurement
      const canvas = doc.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx && this.searchInput) {
        // Match the input font and styling exactly
        const computedStyle = this.searchInput.ownerDocument.defaultView?.getComputedStyle(this.searchInput);
        if (computedStyle) {
          const font = computedStyle.font ||
            `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
          ctx.font = font;

          // Replace spaces with NBSP for measurement, as measureText often ignores trailing spaces
          const textToMeasure = inputValue.replace(/ /g, '\u00A0');
          const textWidth = ctx.measureText(textToMeasure).width;

          // Get padding and border width
          const paddingLeft = parseFloat(computedStyle.paddingLeft) || 9;
          const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
          const startOffset = paddingLeft + borderLeft;

          inlineHint.textContent = hintSuffix;
          inlineHint.style.left = `${startOffset + textWidth}px`;
          inlineHint.style.display = "block";

          // Match font style of input
          inlineHint.style.font = font;
          inlineHint.style.fontSize = computedStyle.fontSize;
          inlineHint.style.fontFamily = computedStyle.fontFamily;
          inlineHint.style.lineHeight = computedStyle.lineHeight;

          Zotero.debug(`[${config.addonName}] Inline hint: "${hintSuffix}" at ${startOffset + textWidth}px`);
        } else {
          // Fallback if computed style fails
          ctx.font = "12px system-ui, -apple-system, sans-serif";
          const textToMeasure = inputValue.replace(/ /g, '\u00A0');
          const textWidth = ctx.measureText(textToMeasure).width;
          inlineHint.textContent = hintSuffix;
          inlineHint.style.left = `${9 + textWidth}px`;
          inlineHint.style.display = "block";
        }
      } else {
        // Fallback: use approximate character width
        const charWidth = 7; // approximate width per character
        const textWidth = inputValue.length * charWidth;

        inlineHint.textContent = hintSuffix;
        inlineHint.style.left = `${9 + textWidth}px`;
        inlineHint.style.display = "block";

        Zotero.debug(`[${config.addonName}] Inline hint (fallback): "${hintSuffix}" at ${9 + textWidth}px`);
      }
    };

    // Handle keyboard events
    this.searchInput.addEventListener("keydown", (event) => {
      Zotero.debug(`[${config.addonName}] Panel search input keydown: key=${event.key}`);

      // Tab or ArrowRight at end of input: accept inline hint
      if ((event.key === "Tab" || event.key === "ArrowRight") && currentHintText) {
        const cursorAtEnd = this.searchInput?.selectionStart === this.searchInput?.value.length;
        if (cursorAtEnd && this.searchInput) {
          event.preventDefault();
          this.searchInput.value = currentHintText;
          inlineHint.style.display = "none";
          currentHintText = "";
          return;
        }
      }

      // Escape: hide inline hint
      if (event.key === "Escape") {
        inlineHint.style.display = "none";
        currentHintText = "";
        this.hideSearchHistoryDropdown();
      }

      // Enter: execute search
      if (event.key === "Enter") {
        event.preventDefault();
        inlineHint.style.display = "none";
        currentHintText = "";
        const query = this.searchInput?.value.trim();
        Zotero.debug(`[${config.addonName}] Panel search Enter pressed, query="${query}"`);
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
      updateInlineHint();
      // Hide dropdown when user is typing (inline hint is shown instead)
      this.hideSearchHistoryDropdown();
    });

    // Focus: just update hint, don't show dropdown automatically
    this.searchInput.addEventListener("focus", () => {
      Zotero.debug(`[${config.addonName}] Panel search input focused, history count: ${this.searchHistory.length}`);
      updateInlineHint();
      // Don't auto-show dropdown - user can click ▼ button or press ArrowDown
    });

    // Blur: hide hint
    this.searchInput.addEventListener("blur", () => {
      // Delay to allow click on hint/dropdown
      setTimeout(() => {
        inlineHint.style.display = "none";
        currentHintText = "";
      }, 150);
    });

    inputWrapper.appendChild(this.searchInput);
    inputWrapper.appendChild(inlineHint);

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
      Zotero.debug(`[${config.addonName}] Panel search button clicked, query="${query}"`);
      if (query) {
        this.executeInspireSearch(query).catch((err) => {
          Zotero.debug(`[${config.addonName}] Panel search button error: ${err}`);
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
    Zotero.debug(`[${config.addonName}] createSearchInputContainer: completed, container added to toolbar`);
  }

  /**
   * Show or hide the search UI based on current view mode.
   */
  private updateSearchUIVisibility() {
    Zotero.debug(`[${config.addonName}] updateSearchUIVisibility: viewMode=${this.viewMode}, searchInputContainer=${!!this.searchInputContainer}`);
    if (!this.searchInputContainer) {
      Zotero.debug(`[${config.addonName}] updateSearchUIVisibility: WARNING - searchInputContainer is null`);
      return;
    }

    const isSearchMode = this.viewMode === "search";
    this.searchInputContainer.style.display = isSearchMode ? "flex" : "none";
    Zotero.debug(`[${config.addonName}] updateSearchUIVisibility: set searchInputContainer.display="${isSearchMode ? "flex" : "none"}"`);

    // Keep filter input visible in search mode for local filtering of search results
    // Users can use INSPIRE search to get broad results, then use filter to refine locally
  }

  /**
   * Show the search history dropdown.
   */
  private showSearchHistoryDropdown() {
    if (!this.searchHistoryDropdown || this.searchHistory.length === 0) return;

    const doc = this.body.ownerDocument;
    this.searchHistoryDropdown.innerHTML = "";

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
      const stored = Zotero.Prefs.get(`${config.addonRef}.${SEARCH_HISTORY_PREF_KEY}`, true) as string | undefined;
      if (stored) {
        const parsed = JSON.parse(stored);
        // Migrate old format (string[]) to new format (SearchHistoryItem[])
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
          this.searchHistory = (parsed as unknown as string[]).map(q => ({
            query: q,
            timestamp: Date.now()
          }));
          this.saveSearchHistory(); // Save in new format
        } else {
          this.searchHistory = parsed as SearchHistoryItem[];
        }
      }
    } catch (err) {
      Zotero.debug(`[${config.addonName}] Failed to load search history: ${err}`);
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
        true
      );
    } catch (err) {
      Zotero.debug(`[${config.addonName}] Failed to save search history: ${err}`);
    }
  }

  /**
   * Add a query to search history.
   */
  private addToSearchHistory(query: string) {
    // Remove if already exists (to move to top)
    const index = this.searchHistory.findIndex(item => item.query === query);
    if (index !== -1) {
      this.searchHistory.splice(index, 1);
    }

    // Add to front with current timestamp
    this.searchHistory.unshift({
      query,
      timestamp: Date.now()
    });

    // Filter by retention days
    const retentionDays = (Zotero.Prefs.get(`${config.prefsPrefix}.${SEARCH_HISTORY_DAYS_PREF_KEY}`, true) as number) || SEARCH_HISTORY_DAYS_DEFAULT;
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    this.searchHistory = this.searchHistory.filter(item => item.timestamp >= cutoff);

    // Limit to max entries (increased limit)
    if (this.searchHistory.length > SEARCH_HISTORY_MAX_ENTRIES) {
      this.searchHistory = this.searchHistory.slice(0, SEARCH_HISTORY_MAX_ENTRIES);
    }
    this.saveSearchHistory();
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
    Zotero.debug(`[${config.addonName}] executeInspireSearch called with query="${query}"`);
    if (!query.trim()) {
      Zotero.debug(`[${config.addonName}] executeInspireSearch: empty query, returning`);
      return;
    }

    const trimmedQuery = query.trim();
    this.currentSearchQuery = trimmedQuery;
    this.addToSearchHistory(trimmedQuery);
    Zotero.debug(`[${config.addonName}] executeInspireSearch: query set to "${trimmedQuery}"`);

    // Update search input value
    if (this.searchInput) {
      this.searchInput.value = trimmedQuery;
      Zotero.debug(`[${config.addonName}] executeInspireSearch: updated search input value`);
    } else {
      Zotero.debug(`[${config.addonName}] executeInspireSearch: WARNING - searchInput is null/undefined`);
    }

    // Switch to search mode and update UI
    Zotero.debug(`[${config.addonName}] executeInspireSearch: switching to search mode`);
    this.viewMode = "search";
    this.updateTabSelection();
    this.updateSearchUIVisibility();

    // Load search results
    Zotero.debug(`[${config.addonName}] executeInspireSearch: calling loadSearchResults`);
    await this.loadSearchResults(trimmedQuery);
    Zotero.debug(`[${config.addonName}] executeInspireSearch: loadSearchResults completed`);
  }

  /**
   * Load search results from INSPIRE API.
   */
  private async loadSearchResults(query: string) {
    Zotero.debug(`[${config.addonName}] loadSearchResults: starting for query="${query}"`);
    this.cancelActiveRequest();

    const loadingMessage = this.getLoadingMessageForMode("search");
    this.allEntries = [];
    this.setStatus(loadingMessage);
    this.renderMessage(loadingMessage);
    Zotero.debug(`[${config.addonName}] loadSearchResults: set status to "${loadingMessage}"`);

    const cacheKey = this.getCacheKey(query, "search", this.searchSort);
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      Zotero.debug(`[${config.addonName}] loadSearchResults: returning cached results (${cached.length} entries)`);
      this.allEntries = cached;
      this.totalApiCount = null;
      this.chartSelectedBins.clear();
      this.renderChartImmediate();  // Use immediate render for cache hit
      this.renderReferenceList();
      return;
    }
    Zotero.debug(`[${config.addonName}] loadSearchResults: no cache hit, fetching from API`);

    const supportsAbort = typeof AbortController !== "undefined";
    const controller = supportsAbort ? new AbortController() : null;
    this.activeAbort = controller ?? undefined;
    const token = `search-${cacheKey}-${performance.now()}`;
    this.pendingToken = token;

    try {
      let hasRenderedFirstPage = false;
      let previousEntryCount = 0;

      const onProgress = (currentEntries: InspireReferenceEntry[], total: number | null) => {
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
          this.renderChartImmediate();  // Render chart immediately on first page
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
        this.renderChartImmediate();  // Use immediate render for final data load
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
            Zotero.debug(`[${config.addonName}] Search enrichment error: ${err}`);
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
    onProgress?: (entries: InspireReferenceEntry[], total: number | null) => void,
  ): Promise<InspireReferenceEntry[]> {
    const startTime = performance.now();
    Zotero.debug(`[${config.addonName}] fetchInspireSearch: starting for query="${query}", sort=${sort}`);
    const entries: InspireReferenceEntry[] = [];
    const encodedQuery = encodeURIComponent(query);
    const sortParam = `&sort=${sort}`;
    const fieldsParam = "&fields=control_number,titles.title,authors.full_name,authors.ids,publication_info,earliest_date,dois,arxiv_eprints,citation_count,citation_count_without_self_citations";

    // Fetch first page to get total count
    const firstUrl = `${INSPIRE_API_BASE}/literature?q=${encodedQuery}&size=${CITED_BY_PAGE_SIZE}&page=1${sortParam}${fieldsParam}`;
    Zotero.debug(`[${config.addonName}] fetchInspireSearch: fetching first page from ${firstUrl}`);
    const firstFetchStart = performance.now();
    const firstResponse = await inspireFetch(firstUrl, signal ? { signal } : undefined).catch((err) => {
      Zotero.debug(`[${config.addonName}] fetchInspireSearch: first page fetch failed: ${err}`);
      return null;
    });
    Zotero.debug(`[${config.addonName}] fetchInspireSearch: first page fetch took ${(performance.now() - firstFetchStart).toFixed(0)}ms`);
    if (!firstResponse || firstResponse.status === 404) {
      Zotero.debug(`[${config.addonName}] fetchInspireSearch: first response failed, status=${firstResponse?.status}`);
      throw new Error("Search failed");
    }

    const firstPayload: any = await firstResponse.json();
    const totalHits = firstPayload?.hits?.total ?? 0;
    const firstHits = Array.isArray(firstPayload?.hits?.hits) ? firstPayload.hits.hits : [];

    Zotero.debug(`[${config.addonName}] fetchInspireSearch: found ${totalHits} total results, first page has ${firstHits.length} hits`);

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
    const totalPages = Math.ceil(Math.min(totalHits, CITED_BY_MAX_RESULTS) / CITED_BY_PAGE_SIZE);
    if (totalPages <= 1) {
      return entries;
    }

    // Fetch remaining pages in parallel batches
    for (let batchStart = 2; batchStart <= totalPages; batchStart += CITED_BY_PARALLEL_BATCH_SIZE) {
      if (signal?.aborted) break;

      const batchPages: number[] = [];
      for (let p = batchStart; p < batchStart + CITED_BY_PARALLEL_BATCH_SIZE && p <= totalPages; p++) {
        batchPages.push(p);
      }

      const batchResults = await Promise.all(
        batchPages.map(async (pageNum) => {
          const url = `${INSPIRE_API_BASE}/literature?q=${encodedQuery}&size=${CITED_BY_PAGE_SIZE}&page=${pageNum}${sortParam}${fieldsParam}`;
          const response = await inspireFetch(url, signal ? { signal } : undefined).catch(() => null);
          if (!response || !response.ok) return [];
          const payload: any = await response.json();
          return Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
        }),
      );

      // Process batch results
      for (const pageHits of batchResults) {
        for (const hit of pageHits) {
          if (signal?.aborted) break;
          entries.push(this.buildEntryFromSearchHit(hit, entries.length, strings));
        }
      }

      // PERF-16: Pass array reference directly instead of cloning
      if (onProgress && !signal?.aborted) {
        onProgress(entries, totalHits);
      }
    }

    Zotero.debug(`[${config.addonName}] fetchInspireSearch: completed in ${(performance.now() - startTime).toFixed(0)}ms, ${entries.length} entries`);
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
    const { primary: publicationInfo, errata } = splitPublicationInfo(meta?.publication_info);
    const arxivDetails = extractArxivFromMetadata(meta);
    const earliestDate = meta?.earliest_date ?? "";
    const year = earliestDate ? earliestDate.slice(0, 4) : publicationInfo?.year ?? "";
    const citationCount = typeof meta?.citation_count === "number" ? meta.citation_count : null;

    const { names: authorNames, total: totalAuthors } = extractAuthorNamesLimited(authors, 3);
    const authorText = formatAuthors(authorNames, totalAuthors);
    const fallbackYear = year || undefined;
    const summary = buildPublicationSummary(publicationInfo, arxivDetails, fallbackYear, errata);

    const inspireUrl = recid ? `${INSPIRE_LITERATURE_URL}/${recid}` : "";
    const fallbackUrl = buildFallbackUrlFromMetadata(meta, arxivDetails);

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
      inspireUrl,
      fallbackUrl,
      searchText: "",
      localItemID: undefined,
      isRelated: false,
      publicationInfo,
      publicationInfoErrata: errata,
      arxivDetails,
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
        (a, b) =>
          this.getCitationValue(b) - this.getCitationValue(a),
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

    // Use innerHTML for efficient batch creation of all sub-elements
    row.innerHTML = `
      <div class="zinspire-ref-entry__text">
        <span class="zinspire-ref-entry__dot is-clickable"></span>
        <button class="zinspire-ref-entry__link" type="button"></button>
        <button class="zinspire-ref-entry__bibtex" type="button"></button>
        <div class="zinspire-ref-entry__content">
          <div class="zinspire-ref-entry__title">
            <span class="zinspire-ref-entry__label"></span>
            <span class="zinspire-ref-entry__authors"></span><span class="zinspire-ref-entry__separator">: </span>
            <a class="zinspire-ref-entry__title-link" href="#"></a>
          </div>
          <div class="zinspire-ref-entry__meta"></div>
          <button class="zinspire-ref-entry__stats zinspire-ref-entry__stats-button" type="button"></button>
        </div>
      </div>
    `;

    // Apply inline styles to template elements (one-time cost)
    const textContainer = row.querySelector(".zinspire-ref-entry__text") as HTMLElement;
    const marker = row.querySelector(".zinspire-ref-entry__dot") as HTMLElement;
    const linkButton = row.querySelector(".zinspire-ref-entry__link") as HTMLElement;
    const bibtexButton = row.querySelector(".zinspire-ref-entry__bibtex") as HTMLElement;
    const content = row.querySelector(".zinspire-ref-entry__content") as HTMLElement;

    if (textContainer) applyRefEntryTextContainerStyle(textContainer);
    if (marker) {
      applyRefEntryMarkerStyle(marker);
      marker.style.cursor = "pointer";
    }
    if (linkButton) applyRefEntryLinkButtonStyle(linkButton);
    if (bibtexButton) applyBibTeXButtonStyle(bibtexButton);
    if (content) applyRefEntryContentStyle(content);

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
      this.rowPool.push(row);
    }
    // If pool is full, just let the element be garbage collected
  }

  /**
   * Recycle all current rows in the list to the pool before clearing.
   */
  private recycleRowsToPool() {
    const rows = this.listEl.querySelectorAll(".zinspire-ref-entry");
    for (const row of rows) {
      this.returnRowToPool(row as HTMLDivElement);
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
    const linkButton = row.querySelector(".zinspire-ref-entry__link") as HTMLButtonElement;
    if (linkButton) {
      linkButton.setAttribute(
        "title",
        entry.isRelated ? strings.linkExisting : strings.linkMissing,
      );
      this.renderLinkButton(linkButton, Boolean(entry.isRelated));
    }

    // Update bibtex button
    const bibtexButton = row.querySelector(".zinspire-ref-entry__bibtex") as HTMLButtonElement;
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

    // Update label (show/hide)
    const labelSpan = row.querySelector(".zinspire-ref-entry__label") as HTMLElement;
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
    const authorsContainer = row.querySelector(".zinspire-ref-entry__authors") as HTMLElement;
    if (authorsContainer) {
      // Clear and rebuild author links (variable count)
      authorsContainer.innerHTML = "";
      this.appendAuthorLinks(authorsContainer, entry, strings);
    }

    // Update title link
    const titleLink = row.querySelector(".zinspire-ref-entry__title-link") as HTMLAnchorElement;
    if (titleLink) {
      titleLink.textContent = entry.title + ";";
      titleLink.href = entry.inspireUrl || entry.fallbackUrl || "#";
    }

    // Update meta (show/hide)
    const meta = row.querySelector(".zinspire-ref-entry__meta") as HTMLElement;
    if (meta) {
      if (entry.summary) {
        meta.textContent = entry.summary;
        meta.style.display = "";
      } else {
        meta.textContent = "";
        meta.style.display = "none";
      }
    }

    // Update stats button (show/hide and content)
    const statsButton = row.querySelector(".zinspire-ref-entry__stats-button") as HTMLButtonElement;
    if (statsButton) {
      const displayCitationCount = this.getCitationValue(entry);
      const hasCitationCount = displayCitationCount > 0 ||
        typeof entry.citationCount === "number" ||
        typeof entry.citationCountWithoutSelf === "number";
      const isReferencesMode = this.viewMode === "references";
      const canShowEntryCitedTab = Boolean(entry.recid) && (hasCitationCount || !isReferencesMode);

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
    if (
      !entry.authors.length ||
      entry.authorText === s.unknownAuthor
    ) {
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
      formatted: string;        // Display name (e.g., "J. Smith")
      searchInfo: AuthorSearchInfo;  // Search info with fullName and optional recid
      originalIndex: number;    // Original index in entry.authors for event delegation
    };
    const validAuthors: AuthorDisplay[] = [];
    // For large collaborations, only process first author
    const processLimit = isLargeCollaboration ? 1 : Math.min(entry.authors.length, maxAuthors + 1);
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
      authorLink.title = getString("references-panel-author-click-hint", {
        args: { author: searchInfo.fullName },
      }) + idHint;
      // Event handled by delegation (PERF-14)
      applyAuthorLinkStyle(authorLink);
      container.appendChild(authorLink);
    }

    if (showEtAl) {
      const etAlSpan = doc.createElement("span");
      etAlSpan.textContent = " et al.";
      container.appendChild(etAlSpan);
    }
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
    const previousMode =
      this.viewMode === "entryCited"
        ? this.entryCitedPreviousMode
        : this.viewMode;
    if (previousMode === "references" || previousMode === "citedBy" || previousMode === "search") {
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

  /**
   * Show author papers in the entryCited tab.
   * Uses author recid for precise search if available, otherwise converts full name to search query.
   */
  private async showAuthorPapersTab(authorInfo: AuthorSearchInfo) {
    if (!authorInfo.fullName) {
      this.showToast(getString("references-panel-toast-missing"));
      return;
    }
    // Generate cache key: priority BAI > recid > name
    let authorQuery: string;
    if (authorInfo.bai) {
      authorQuery = `bai:${authorInfo.bai}`;
    } else if (authorInfo.recid) {
      authorQuery = `recid:${authorInfo.recid}`;
    } else {
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
    if (previousMode === "references" || previousMode === "citedBy" || previousMode === "search") {
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
    const displayLabel = authorInfo.fullName.length > 30
      ? authorInfo.fullName.substring(0, 27) + "..."
      : authorInfo.fullName;
    this.entryCitedSource = {
      authorQuery,
      authorSearchInfo: authorInfo,
      label: displayLabel, // Just the author name, message templates will add "Papers by"
    };
    this.updateTabSelection();
    if (this.viewMode !== "entryCited") {
      await this.activateViewMode("entryCited").catch(() => void 0);
      this.resetListScroll();
      this.pendingEntryScrollReset = false;
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

  private async importReference(
    recid: string,
    target: SaveTargetSelection,
  ) {
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
    // Recycle existing rows to pool before clearing
    this.recycleRowsToPool();
    this.listEl.textContent = "";
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
    const toast = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
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
    this.abstractTooltip.textContent = s.loadingAbstract || "Loading abstract...";

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
        if (this.abstractTooltip && this.abstractTooltip.style.display !== "none") {
          this.renderAbstractContent(entry.abstract || s.noAbstract);
        }
      } catch (_err) {
        entry.abstractLoading = false;
        if (this.abstractTooltip && this.abstractTooltip.style.display !== "none") {
          this.abstractTooltip.textContent = s.noAbstract || "No abstract available";
        }
      }
    } else {
      entry.abstract = "";
      this.abstractTooltip.textContent = s.noAbstract || "No abstract available";
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
          const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
            closeOnClick: true,
          });
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
      const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
        closeOnClick: true,
      });
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

  private doHideTooltip() {
    // Clear show timeout
    if (this.abstractHoverTimeout) {
      clearTimeout(this.abstractHoverTimeout);
      this.abstractHoverTimeout = undefined;
    }
    // Cancel any pending RAF for tooltip position update
    if (this.tooltipRAF) {
      const win = this.body.ownerDocument?.defaultView || window;
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
    const win = this.body.ownerDocument?.defaultView || window;
    const raf = win.requestAnimationFrame || ((cb: FrameRequestCallback) => win.setTimeout(cb, 16));
    this.tooltipRAF = raf(() => {
      this.tooltipRAF = undefined;
      if (this.abstractTooltip && this.abstractTooltip.style.display !== "none") {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions (use imports from ./inspire for most functions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lazily compute searchText for an entry if not already computed.
 * This is a performance optimization - searchText is only computed when
 * actually needed for filtering, not during initial data loading.
 */
function ensureSearchText(entry: InspireReferenceEntry): string {
  if (!entry.searchText) {
    entry.searchText = buildEntrySearchText(entry);
  }
  return entry.searchText;
}

// NOTE: ZInspire class, getInspireMeta, setInspireMeta, and other metadata functions
// have been moved to inspire/itemUpdater.ts and inspire/metadataService.ts
// Import them from "./inspire" instead of defining locally.
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
