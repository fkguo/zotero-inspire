// ─────────────────────────────────────────────────────────────────────────────
// Reader Integration
// FTR-PDF-ANNOTATE: Integrate with Zotero Reader for citation detection
// FTR-CACHE-PRELOAD: Background preload references when PDF is opened
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getCitationParser, postProcessLabels } from "./citationParser";
import { getPref } from "../../../utils/prefs";
import { deriveRecidFromItem } from "../apiUtils";
import { localCache } from "../localCache";
import { fetchReferencesEntries, enrichReferencesEntries } from "../referencesService";
import { getPDFReferencesParser, type PDFReferenceMapping, type AuthorYearReferenceMapping } from "./pdfReferencesParser";
import type { InspireReferenceEntry } from "../types";
import { LRUCache } from "../utils";
import type {
  ParsedCitation,
  CitationLookupEvent,
  CitationType,
  ReaderState,
  ZoteroChar,
  ZoteroPageData,
  ZoteroProcessedData,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Debug logging control
// Set to false in production for better performance during text selection
// ─────────────────────────────────────────────────────────────────────────────
const DEBUG_READER_INTEGRATION = false;

/** Conditional debug logging - only logs when DEBUG_READER_INTEGRATION is true */
function debugLog(message: string): void {
  if (DEBUG_READER_INTEGRATION) {
    Zotero.debug(message);
  }
}

/**
 * Event listener callback type
 */
type EventCallback<T> = (data: T) => void;

/**
 * Integrates with Zotero Reader API to detect citation selections
 * and communicate with the References Panel.
 */
export class ReaderIntegration {
  private static instance: ReaderIntegration | null = null;

  private listeners = new Map<string, Set<EventCallback<any>>>();
  private readerStates = new Map<string, ReaderState>();
  private initialized = false;
  /** Store bound handler reference for unregistration */
  private boundTextSelectionHandler?: (args: any) => void;
  /** Track preloaded recids to avoid duplicate background fetches */
  private preloadedRecids = new Set<string>();
  /** Track in-flight preload promises to avoid concurrent fetches for same recid */
  private preloadingRecids = new Map<string, Promise<void>>();
  /** FTR-PDF-MATCHING: Store max known label per item for concatenated range detection */
  private maxKnownLabelByItem = new Map<number, number>();
  /** FTR-CITATION-FORMAT-DETECT: Store detected citation format per attachment item */
  private citationFormatByItem = new Map<number, CitationType>();
  /** FTR-CITATION-FORMAT-DETECT: Track items being scanned to avoid duplicate scans */
  private scanningFormatItems = new Set<number>();
  /** FTR-CITATION-FORMAT-DETECT: Notifier ID for tab events */
  private tabNotifierID?: string;
  /** FTR-REFACTOR: Cache processed PDF data per item (expensive to re-fetch) */
  private static readonly PROCESSED_DATA_CACHE_SIZE = 20;
  private processedDataCache = new LRUCache<number, { data: ZoteroProcessedData; timestamp: number }>(
    ReaderIntegration.PROCESSED_DATA_CACHE_SIZE
  );
  /** FTR-REFACTOR: Cache page data per item+page (for frequently accessed pages) */
  private pageDataCache = new LRUCache<string, { data: ZoteroPageData; timestamp: number }>(50);
  /** FTR-REFACTOR: Cache TTL in milliseconds (5 minutes) */
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  /** FTR-PDF-PARSE-PRELOAD: Cache preloaded PDF numeric mapping per parent item */
  private static readonly PDF_MAPPING_CACHE_SIZE = 30;
  private pdfMappingCache = new LRUCache<number, PDFReferenceMapping>(
    ReaderIntegration.PDF_MAPPING_CACHE_SIZE
  );
  /** FTR-PDF-PARSE-PRELOAD: Cache preloaded PDF author-year mapping per parent item */
  private pdfAuthorYearMappingCache = new LRUCache<number, AuthorYearReferenceMapping>(
    ReaderIntegration.PDF_MAPPING_CACHE_SIZE
  );
  /** FTR-PDF-PARSE-PRELOAD: Track items being preloaded to avoid duplicate parses */
  private pdfParsingItems = new Set<number>();
  /** FTR-PRELOAD-AWAIT: Track PDF parsing promises for await support */
  private pdfParsingPromises = new Map<number, Promise<void>>();

  /**
   * Get singleton instance
   */
  static getInstance(): ReaderIntegration {
    if (!this.instance) {
      this.instance = new ReaderIntegration();
    }
    return this.instance;
  }

  /**
   * Initialize Reader event listeners.
   * Should be called once during addon startup.
   */
  initialize(): boolean {
    if (this.initialized) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] ReaderIntegration already initialized`,
      );
      return true;
    }

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Initializing ReaderIntegration...`,
    );

    // Check if Reader API is available
    if (!this.isReaderAPIAvailable()) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Reader API not available (Zotero.Reader.registerEventListener missing)`,
      );
      return false;
    }

    try {
      // Store bound handler reference for later unregistration
      this.boundTextSelectionHandler = this.handleTextSelectionPopup.bind(this);

      // Register for text selection popup
      Zotero.Reader.registerEventListener(
        "renderTextSelectionPopup",
        this.boundTextSelectionHandler,
        config.addonID,
      );

      this.initialized = true;
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Successfully registered renderTextSelectionPopup listener`,
      );

      // FTR-CITATION-FORMAT-DETECT: Register tab notifier to detect when PDF is opened
      this.registerTabNotifier();

      return true;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Failed to register event listener: ${err}`,
      );
      return false;
    }
  }

  /**
   * FTR-PDF-MATCHING: Set the max known label for an item (from PDF parsing).
   * Used for concatenated range detection (e.g., [62-64] copied as [6264]).
   * @param itemID - Zotero item ID
   * @param maxLabel - Maximum citation label number found in PDF
   */
  setMaxKnownLabel(itemID: number, maxLabel: number): void {
    this.maxKnownLabelByItem.set(itemID, maxLabel);
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Set maxKnownLabel=${maxLabel} for item ${itemID}`,
    );
  }

  /**
   * FTR-PDF-MATCHING: Get the max known label for an item.
   * @param itemID - Zotero item ID
   * @returns Max label or undefined if not set
   */
  getMaxKnownLabel(itemID: number): number | undefined {
    return this.maxKnownLabelByItem.get(itemID);
  }

  /**
   * Cleanup resources.
   */
  cleanup(): void {
    // Unregister Zotero Reader event listener to prevent memory leak
    if (this.initialized && this.boundTextSelectionHandler) {
      try {
        Zotero.Reader.unregisterEventListener(
          "renderTextSelectionPopup",
          this.boundTextSelectionHandler,
        );
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Unregistered renderTextSelectionPopup listener`,
        );
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] Failed to unregister event listener: ${err}`,
        );
      }
      this.boundTextSelectionHandler = undefined;
    }

    // FTR-CITATION-FORMAT-DETECT: Unregister tab notifier
    this.unregisterTabNotifier();

    const listenerCount = this.listeners.size;
    const stateCount = this.readerStates.size;
    const preloadCount = this.preloadedRecids.size;
    const formatCount = this.citationFormatByItem.size;
    const processedDataCacheCount = this.processedDataCache.size;
    const pageDataCacheCount = this.pageDataCache.size;
    this.readerStates.clear();
    this.listeners.clear();
    this.preloadedRecids.clear();
    this.preloadingRecids.clear();
    this.pdfParsingPromises.clear();
    this.maxKnownLabelByItem.clear();
    this.citationFormatByItem.clear();
    this.scanningFormatItems.clear();
    this.processedDataCache.clear();
    this.pageDataCache.clear();
    this.initialized = false;
    ReaderIntegration.instance = null;
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Cleaned up: ${listenerCount} listeners, ${stateCount} reader states, ${preloadCount} preloaded recids, ${formatCount} detected formats, ${processedDataCacheCount} processedData cache, ${pageDataCacheCount} pageData cache`,
    );
  }

  /**
   * Check if Reader API is available
   */
  private isReaderAPIAvailable(): boolean {
    return !!(
      Zotero?.Reader &&
      typeof Zotero.Reader.registerEventListener === "function"
    );
  }

  /**
   * Handle text selection popup event.
   * Adds "Look up in References" button when citation is detected.
   */
  private handleTextSelectionPopup(args: {
    reader: any;
    doc: Document;
    params: { annotation?: any };
    append: (elem: Element) => void;
  }): void {
    const { reader, doc, params, append } = args;

    // Debug: log all args structure to understand what Zotero provides
    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] handleTextSelectionPopup called`,
    );
    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] args.reader: itemID=${reader?.itemID}, tabID=${reader?.tabID}`,
    );
    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] args.params keys: ${Object.keys(params || {}).join(", ") || "(none)"}`,
    );

    // FTR-CACHE-PRELOAD: Trigger background preload when user interacts with PDF
    // This ensures references are cached before user clicks on a citation
    this.triggerBackgroundPreload(reader);

    // Try to find selected text from params.annotation
    if (params?.annotation) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] params.annotation keys: ${Object.keys(params.annotation).join(", ")}`,
      );
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] params.annotation.text: "${params.annotation.text?.substring(0, 100) || "(none)"}"`,
      );
    }

    // Get selected text - try multiple methods
    const selectedText = this.getSelectedText(reader, params);
    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] Final selected text: "${selectedText?.substring(0, 50) ?? "(null)"}${selectedText && selectedText.length > 50 ? "..." : ""}"`,
    );

    // Allow longer selections (up to 2000 chars) to capture multiple citations
    // Regex matching is fast enough for this length, no performance concerns
    if (!selectedText || selectedText.length > 2000) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] Skipping: no selection or too long (len=${selectedText?.length ?? 0})`,
      );
      return;
    }

    // Check if selection contains citation markers
    // For longer text, use parseText to find ALL citations; for short text, use parseSelection
    const parser = getCitationParser();
    const enableFuzzy = getPref("pdf_fuzzy_citation") === true;
    // FTR-PDF-MATCHING: Get max known label for concatenated range detection
    const maxKnownLabel = reader?.itemID ? this.getMaxKnownLabel(reader.itemID) : undefined;
    // FTR-CITATION-FORMAT-DETECT: Get cached citation format for this item
    const detectedFormat = reader?.itemID ? this.getCitationFormat(reader.itemID) : undefined;
    const isAuthorYearDoc = detectedFormat === "author-year";
    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] maxKnownLabel for itemID ${reader?.itemID}: ${maxKnownLabel ?? "undefined"}, detectedFormat: ${detectedFormat ?? "not yet detected"}`,
    );
    let allLabels: string[] = [];
    let citationType: "numeric" | "author-year" | "arxiv" | "mixed" | "unknown" = "numeric";
    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Preserve subCitations from parseSelection
    let subCitations: ParsedCitation["subCitations"] = undefined;
    let originalRaw: string | undefined = undefined;

    if (selectedText.length <= 100) {
      // Short selection: use parseSelection (more lenient, handles partial selections)
      // Pass enableFuzzy to control aggressive pattern matching
      // Pass maxKnownLabel for concatenated range detection (e.g., [62-64] copied as [6264])
      // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Increased threshold from 50 to 100 to capture author-year citations
      // FTR-CITATION-FORMAT-DETECT: Pass isAuthorYearDoc to prioritize author-year detection
      const citation = parser.parseSelection(selectedText, enableFuzzy, maxKnownLabel, isAuthorYearDoc);
      if (citation && citation.labels.length > 0) {
        allLabels = citation.labels;
        citationType = citation.type;
        subCitations = citation.subCitations;
        originalRaw = citation.raw;
      }
    } else {
      // Longer selection: use parseText to find all [xxx] patterns
      const citations = parser.parseText(selectedText);
      // Collect all unique labels from all citations
      const labelSet = new Set<string>();
      for (const cit of citations) {
        for (const label of cit.labels) {
          labelSet.add(label);
        }
      }
      // FTR-PDF-MATCHING: Apply postProcessLabels to handle concatenated ranges (e.g., [6264] -> [62,63,64])
      allLabels = postProcessLabels(Array.from(labelSet), maxKnownLabel);

      // If no citations found with parseText and fuzzy is enabled,
      // fallback to parseSelection for aggressive pattern matching
      // FTR-CITATION-FORMAT-DETECT: Pass isAuthorYearDoc to prioritize author-year detection
      if (allLabels.length === 0 && enableFuzzy) {
        const fuzzyCitation = parser.parseSelection(selectedText, true, maxKnownLabel, isAuthorYearDoc);
        if (fuzzyCitation && fuzzyCitation.labels.length > 0) {
          allLabels = fuzzyCitation.labels;
          citationType = fuzzyCitation.type;
          subCitations = fuzzyCitation.subCitations;
          originalRaw = fuzzyCitation.raw;
        }
      }
    }

    if (allLabels.length === 0) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] No citation pattern detected in selection`,
      );
      return;
    }

    // Build a combined citation object for UI
    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Preserve subCitations and use original raw for display
    const citation: ParsedCitation = {
      raw: originalRaw ?? (citationType === "author-year"
        ? allLabels[0] // For author-year, use the full label as raw
        : allLabels.map(l => `[${l}]`).join(", ")),
      type: citationType,
      labels: allLabels,
      position: null,
      subCitations,
    };

    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] Citation detected: type=${citation.type}, labels=[${citation.labels.join(",")}], raw="${citation.raw}", subCitations=${citation.subCitations?.length ?? 0}`,
    );

    // Create lookup UI - single button for one label, or multiple buttons for multiple labels
    const element = this.createLookupUI(doc, reader, citation);
    append(element);

    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] Lookup UI appended to popup (${citation.labels.length} label(s))`,
    );
  }

  /**
   * Create the lookup UI - single button for one label, or compact grid for multiple labels
   * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Author-year citations show multiple buttons if multiple papers detected
   */
  private createLookupUI(
    doc: Document,
    reader: any,
    citation: ParsedCitation,
  ): HTMLElement {
    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Handle author-year citations
    if (citation.type === "author-year") {
      // If multiple sub-citations detected (e.g., "Bignamini et al. (2009, 2010)" = 2 papers),
      // create a container with multiple buttons
      if (citation.subCitations && citation.subCitations.length > 1) {
        return this.createMultiAuthorYearLookupUI(doc, reader, citation);
      }
      // Single author-year citation: show one button
      return this.createAuthorYearLookupButton(doc, reader, citation);
    }

    // Single label: simple button with icon and text
    if (citation.labels.length === 1) {
      // createSingleLookupButton already adds icon and text
      return this.createSingleLookupButton(doc, reader, citation.labels[0]);
    }

    // Multiple labels: create a compact horizontal container with icon
    const container = doc.createElement("div");
    container.className = "zinspire-lookup-container";
    Object.assign(container.style, {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "3px",
      padding: "4px 6px",
      borderRadius: "4px",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      background: "var(--material-background, #ffffff)",
      maxWidth: "280px",
    });

    // Add plugin icon
    const icon = this.createInlineIcon(doc, 14);
    icon.style.marginRight = "4px";
    container.appendChild(icon);

    // Label prefix
    const label = doc.createElement("span");
    label.textContent = "Refs.";
    Object.assign(label.style, {
      fontSize: "12px",  // FTR-FOCUSED-SELECTION: increased from 11px
      fontWeight: "500",
      color: "var(--fill-secondary, #666)",
      marginRight: "4px",
    });
    container.appendChild(label);

    // Create compact buttons for each label
    for (const refLabel of citation.labels) {
      const button = this.createCompactLookupButton(doc, reader, refLabel);
      container.appendChild(button);
    }

    return container;
  }

  /**
   * Create a compact lookup button (just the number, minimal padding)
   */
  private createCompactLookupButton(
    doc: Document,
    reader: any,
    label: string,
  ): HTMLButtonElement {
    const button = doc.createElement("button");
    button.className = "zinspire-lookup-compact-btn";
    button.textContent = label;
    button.title = `Look up [${label}] in INSPIRE Refs.`;

    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "20px",
      padding: "2px 4px",
      fontSize: "11px",  // FTR-FOCUSED-SELECTION: increased from 10px
      fontWeight: "500",
      borderRadius: "3px",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      background: "var(--material-background, #ffffff)",
      cursor: "pointer",
      transition: "all 100ms ease-in-out",
    });

    button.addEventListener("mouseenter", () => {
      button.style.background = "var(--accent-color, #4a90d9)";
      button.style.color = "#fff";
      button.style.borderColor = "var(--accent-color, #4a90d9)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "var(--material-background, #ffffff)";
      button.style.color = "inherit";
      button.style.borderColor = "var(--fill-quinary, #d1d1d5)";
    });

    button.addEventListener("click", () => {
      const singleCitation: ParsedCitation = {
        raw: `[${label}]`,
        type: "numeric",
        labels: [label],
        position: null,
      };
      this.lookupCitation(reader, singleCitation);
    });

    return button;
  }

  /**
   * Create a lookup button for author-year citation (e.g., "Guerrieri et al. (2014)")
   * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Shows single button with citation text, sends all labels for matching
   */
  private createAuthorYearLookupButton(
    doc: Document,
    reader: any,
    citation: ParsedCitation,
  ): HTMLButtonElement {
    const button = doc.createElement("button");
    button.className = "toolbarButton zinspire-lookup-citation-btn";

    // Add icon
    const icon = this.createInlineIcon(doc, 14);
    button.appendChild(icon);

    // Use raw text for display (e.g., "Guerrieri et al. (2014)")
    // Truncate if too long for button display
    const displayText = citation.raw.length > 30
      ? citation.raw.substring(0, 27) + "..."
      : citation.raw;

    const textSpan = doc.createElement("span");
    textSpan.textContent = displayText;
    button.appendChild(textSpan);

    button.title = `Look up "${citation.raw}" in INSPIRE Refs.`;

    // Style the button (similar to createSingleLookupButton)
    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "4px 8px",
      fontSize: "13px",
      borderRadius: "4px",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      background: "var(--material-background, #ffffff)",
      cursor: "pointer",
      transition: "background 120ms ease-in-out",
    });

    button.addEventListener("mouseenter", () => {
      button.style.background = "var(--fill-quinary, #f0f0f0)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "var(--material-background, #ffffff)";
    });

    // On click, send the full citation with all labels for author-year matching
    button.addEventListener("click", () => {
      this.lookupCitation(reader, citation);
    });

    return button;
  }

  /**
   * Create UI for multiple author-year citations detected in one selection.
   * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Shows separate buttons for each distinct paper.
   * E.g., "Bignamini et al. (2009, 2010)" displays as two buttons: "(2009)" and "(2010)"
   */
  private createMultiAuthorYearLookupUI(
    doc: Document,
    reader: any,
    citation: ParsedCitation,
  ): HTMLElement {
    const container = doc.createElement("div");
    container.className = "zinspire-lookup-container zinspire-author-year-multi";
    Object.assign(container.style, {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "4px",
      padding: "4px 6px",
      borderRadius: "4px",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      background: "var(--material-background, #ffffff)",
      maxWidth: "350px",
    });

    // Add plugin icon
    const icon = this.createInlineIcon(doc, 14);
    icon.style.marginRight = "4px";
    container.appendChild(icon);

    // Create a button for each sub-citation
    for (const subCitation of citation.subCitations!) {
      const button = doc.createElement("button");
      button.className = "zinspire-lookup-author-year-btn";

      // Truncate if too long
      const displayText = subCitation.displayText.length > 25
        ? subCitation.displayText.substring(0, 22) + "..."
        : subCitation.displayText;
      button.textContent = displayText;
      button.title = `Look up "${subCitation.displayText}" in INSPIRE Refs.`;

      Object.assign(button.style, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "3px 6px",
        fontSize: "12px",
        fontWeight: "500",
        borderRadius: "3px",
        border: "1px solid var(--fill-quinary, #d1d1d5)",
        background: "var(--material-background, #ffffff)",
        cursor: "pointer",
        transition: "all 100ms ease-in-out",
        whiteSpace: "nowrap",
      });

      button.addEventListener("mouseenter", () => {
        button.style.background = "var(--accent-color, #4a90d9)";
        button.style.color = "#fff";
        button.style.borderColor = "var(--accent-color, #4a90d9)";
      });

      button.addEventListener("mouseleave", () => {
        button.style.background = "var(--material-background, #ffffff)";
        button.style.color = "inherit";
        button.style.borderColor = "var(--fill-quinary, #d1d1d5)";
      });

      // On click, lookup with this sub-citation's specific labels
      button.addEventListener("click", () => {
        const subCitationObj: ParsedCitation = {
          raw: subCitation.displayText,
          type: "author-year",
          labels: subCitation.labels,
          position: null,
        };
        this.lookupCitation(reader, subCitationObj);
      });

      container.appendChild(button);
    }

    return container;
  }

  /**
   * Create inline SVG icon element for the plugin logo
   */
  private createInlineIcon(doc: Document, size: number = 14): SVGSVGElement {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.style.flexShrink = "0";
    
    // Background
    const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", "16");
    rect.setAttribute("height", "16");
    rect.setAttribute("rx", "2");
    rect.setAttribute("fill", "#1a1a1a");
    svg.appendChild(rect);
    
    // Letter "i" - dot
    const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "4");
    circle.setAttribute("cy", "4");
    circle.setAttribute("r", "1.3");
    circle.setAttribute("fill", "#fff");
    svg.appendChild(circle);
    
    // Letter "i" - stem
    const iStem = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    iStem.setAttribute("x", "2.6");
    iStem.setAttribute("y", "6");
    iStem.setAttribute("width", "2.8");
    iStem.setAttribute("height", "6.5");
    iStem.setAttribute("rx", "0.5");
    iStem.setAttribute("fill", "#fff");
    svg.appendChild(iStem);
    
    // Letter "N"
    const nPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    nPath.setAttribute("d", "M7 12.5V3.5h2l3.5 6V3.5h1.8v9h-2l-3.5-6v6H7z");
    nPath.setAttribute("fill", "#3b82f6");
    svg.appendChild(nPath);
    
    return svg;
  }

  /**
   * Create a single lookup button for one label
   */
  private createSingleLookupButton(
    doc: Document,
    reader: any,
    label: string,
  ): HTMLButtonElement {
    const button = doc.createElement("button");
    button.className = "toolbarButton zinspire-lookup-citation-btn";

    // Add icon and text
    const icon = this.createInlineIcon(doc, 14);
    button.appendChild(icon);
    
    const textSpan = doc.createElement("span");
    textSpan.textContent = `Refs. [${label}]`;
    button.appendChild(textSpan);
    
    button.title = `Look up [${label}] in INSPIRE Refs.`;

    // Style the button
    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "4px 8px",
      fontSize: "13px",  // FTR-FOCUSED-SELECTION: increased from 12px
      borderRadius: "4px",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      background: "var(--material-background, #ffffff)",
      cursor: "pointer",
      transition: "background 120ms ease-in-out",
    });

    button.addEventListener("mouseenter", () => {
      button.style.background = "var(--fill-quinary, #f0f0f0)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "var(--material-background, #ffffff)";
    });

    button.addEventListener("click", () => {
      // Create a single-label citation object for lookup
      const singleCitation: ParsedCitation = {
        raw: `[${label}]`,
        type: "numeric",
        labels: [label],
        position: null,
      };
      this.lookupCitation(reader, singleCitation);
    });

    return button;
  }

  /**
   * Get selected text from Reader using multiple methods
   */
  private getSelectedText(reader: any, params?: { annotation?: any }): string | null {
    // Method 1: Try params.annotation.text (Zotero's standard way for highlight annotations)
    if (params?.annotation?.text) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found via params.annotation.text`,
      );
      return params.annotation.text.trim();
    }

    // Method 2: Try reader's internal state
    try {
      // Check _state or similar internal properties
      const internalReader = reader?._iframeWindow?.wrappedJSObject?.PDFViewerApplication;
      if (internalReader) {
        const selection = internalReader?.pdfViewer?.currentScaleValue;
        debugLog(
          `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: PDFViewerApplication found, checking selection`,
        );
      }
    } catch (err) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: PDFViewerApplication method failed: ${err}`,
      );
    }

    // Method 3: Try iframe contentWindow selection
    try {
      const iframe = reader._iframe;
      const iframeWin = iframe?.contentWindow;
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: trying iframe method, iframe=${!!iframe}, contentWindow=${!!iframeWin}`,
      );
      const selection = iframeWin?.getSelection?.();
      const text = selection?.toString()?.trim();
      if (text) {
        debugLog(
          `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found via iframe selection`,
        );
        return text;
      }
    } catch (err) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: iframe method failed: ${err}`,
      );
    }

    // Method 4: Try _iframeWindow directly
    try {
      const iframeWin = reader._iframeWindow;
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: trying _iframeWindow, exists=${!!iframeWin}`,
      );
      if (iframeWin) {
        const selection = iframeWin.getSelection?.();
        const text = selection?.toString()?.trim();
        if (text) {
          debugLog(
            `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found via _iframeWindow selection`,
          );
          return text;
        }
      }
    } catch (err) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: _iframeWindow method failed: ${err}`,
      );
    }

    // Method 5: Check if reader has a getSelectedText or similar method
    try {
      if (typeof reader.getSelectedText === "function") {
        const text = reader.getSelectedText();
        if (text) {
          debugLog(
            `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found via reader.getSelectedText()`,
          );
          return text.trim();
        }
      }
      // Check for _lastSelection or similar
      if (reader._lastSelection) {
        debugLog(
          `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found reader._lastSelection`,
        );
        return reader._lastSelection.trim();
      }
    } catch (err) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: reader method failed: ${err}`,
      );
    }

    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: all methods exhausted, returning null`,
    );
    return null;
  }

  /**
   * Look up citation and emit event to controller
   */
  private lookupCitation(reader: any, citation: ParsedCitation): void {
    try {
      // Get parent item ID from reader
      const itemID = reader.itemID;
      if (!itemID) {
        Zotero.debug(
          `[${config.addonName}] Cannot lookup citation: no itemID on reader`,
        );
        return;
      }

      // Reader shows attachment, we need parent item
      const item = Zotero.Items.get(itemID);
      const parentItemID = item?.parentItemID || itemID;

      // Emit lookup event
      const event: CitationLookupEvent = {
        parentItemID,
        citation,
        readerTabID: reader.tabID,
      };

      this.emit("citationLookup", event);

      Zotero.debug(
        `[${config.addonName}] Citation lookup: labels=[${citation.labels.join(",")}] parentItemID=${parentItemID}`,
      );
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to lookup citation: ${err}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Event Emitter
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to an event
   */
  on<T>(event: string, callback: EventCallback<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Event listener registered: ${event} (total: ${this.listeners.get(event)!.size})`,
    );
  }

  /**
   * Unsubscribe from an event
   */
  off<T>(event: string, callback?: EventCallback<T>): void {
    if (!callback) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(callback);
    }
  }

  /**
   * Emit an event
   */
  private emit<T>(event: string, data: T): void {
    const callbacks = this.listeners.get(event);
    const count = callbacks?.size ?? 0;
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Emitting event: ${event} to ${count} listener(s)`,
    );
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(data);
        } catch (err) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] Error in event listener for ${event}: ${err}`,
          );
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Reader State Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get or create state for a reader instance
   */
  private getReaderState(reader: any): ReaderState | null {
    const tabID = reader.tabID;
    if (!tabID) return null;

    if (!this.readerStates.has(tabID)) {
      const item = Zotero.Items.get(reader.itemID);
      const parentItemID = item?.parentItemID || reader.itemID;

      this.readerStates.set(tabID, {
        tabID,
        itemID: reader.itemID,
        parentItemID,
        scannedPages: new Set(),
        citations: new Map(),
      });
    }

    return this.readerStates.get(tabID)!;
  }

  /**
   * Clear state for a reader instance
   */
  clearReaderState(tabID: string): void {
    this.readerStates.delete(tabID);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-CACHE-PRELOAD: Background Preload for References
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Trigger background preload of references for the current PDF's parent item.
   * This is called when user interacts with the PDF (text selection popup appears).
   * Non-blocking: runs in background without affecting UI responsiveness.
   */
  private triggerBackgroundPreload(reader: any): void {
    try {
      // Get parent item info from reader
      const itemID = reader?.itemID;
      if (!itemID) return;

      const item = Zotero.Items.get(itemID);
      if (!item) return;

      // Get parent item (PDF attachment's parent)
      const parentItemID = item.parentItemID || itemID;
      const parentItem = Zotero.Items.get(parentItemID);
      if (!parentItem || !parentItem.isRegularItem()) return;

      // Get recid from parent item
      const recid = deriveRecidFromItem(parentItem);
      if (!recid) return;

      // Skip if already preloaded or currently preloading
      if (this.preloadedRecids.has(recid)) return;
      if (this.preloadingRecids.has(recid)) return;

      // Start background preload (fire and forget)
      // FTR-PDF-MATCHING: Pass itemID to set maxKnownLabel after fetch
      const preloadPromise = this.preloadReferencesForRecid(recid, itemID);
      this.preloadingRecids.set(recid, preloadPromise);

      // Clean up after preload completes
      preloadPromise
        .then(() => {
          this.preloadedRecids.add(recid);
        })
        .catch((err) => {
          Zotero.debug(
            `[${config.addonName}] [PRELOAD] Failed to preload refs for ${recid}: ${err}`,
          );
        })
        .finally(() => {
          this.preloadingRecids.delete(recid);
        });
    } catch (err) {
      // Silently ignore errors - preload is best-effort
      Zotero.debug(
        `[${config.addonName}] [PRELOAD] triggerBackgroundPreload error: ${err}`,
      );
    }
  }

  /**
   * Preload references for a given recid.
   * Checks cache first; if miss, fetches from INSPIRE and stores to cache.
   * FTR-PDF-MATCHING: Also sets maxKnownLabel based on entry count.
   * @param recid - INSPIRE record ID
   * @param attachmentItemID - Optional Zotero attachment item ID for maxKnownLabel
   */
  private async preloadReferencesForRecid(recid: string, attachmentItemID?: number): Promise<void> {
    // Check if local cache is enabled
    if (!localCache.isEnabled()) {
      Zotero.debug(
        `[${config.addonName}] [PRELOAD] Cache disabled, skipping preload for ${recid}`,
      );
      return;
    }

    // Check if already in cache
    const cached = await localCache.get<InspireReferenceEntry[]>("refs", recid);
    if (cached) {
      Zotero.debug(
        `[${config.addonName}] [PRELOAD] References for ${recid} already cached (age: ${cached.ageHours.toFixed(1)}h)`,
      );
      // FTR-PDF-MATCHING: Set maxKnownLabel from cached data
      if (attachmentItemID && cached.data && cached.data.length > 0) {
        this.setMaxKnownLabel(attachmentItemID, cached.data.length);
      }
      return;
    }

    Zotero.debug(
      `[${config.addonName}] [PRELOAD] Starting background fetch for ${recid}`,
    );

    // Fetch from INSPIRE
    const entries = await fetchReferencesEntries(recid);
    if (!entries || entries.length === 0) {
      Zotero.debug(
        `[${config.addonName}] [PRELOAD] No references found for ${recid}`,
      );
      return;
    }

    // Enrich with complete metadata (title, authors, etc.)
    await enrichReferencesEntries(entries);

    // Store to local cache
    await localCache.set("refs", recid, entries, undefined, entries.length);

    // FTR-PDF-MATCHING: Set maxKnownLabel based on entry count for precise concatenated range detection
    // This provides an early estimate before PDF is parsed
    if (attachmentItemID && entries.length > 0) {
      this.setMaxKnownLabel(attachmentItemID, entries.length);
      Zotero.debug(
        `[${config.addonName}] [PRELOAD] Set maxKnownLabel=${entries.length} for attachment ${attachmentItemID}`,
      );
    }

    Zotero.debug(
      `[${config.addonName}] [PRELOAD] Cached ${entries.length} references for ${recid}`,
    );

    // FTR-PDF-PARSE-PRELOAD: Also preload PDF parsing in background
    // This reduces first-click latency by having PDF mapping ready
    // FTR-PRELOAD-AWAIT: Track the promise so callers can await it
    if (attachmentItemID && getPref("pdf_parse_refs_list") === true) {
      this.startPdfParsing(attachmentItemID);
    }
  }

  /**
   * Start PDF parsing and track the promise.
   * FTR-PRELOAD-AWAIT: Separated from preloadPDFParsing to track promises by parentItemID.
   */
  private startPdfParsing(attachmentItemID: number): void {
    const attachment = Zotero.Items.get(attachmentItemID);
    if (!attachment) return;

    const parentItemID = attachment.parentItemID;
    if (!parentItemID) return;

    // Skip if already parsing or cached
    if (this.pdfParsingItems.has(parentItemID)) return;
    if (this.pdfMappingCache.has(parentItemID)) return;

    // Create and track the parsing promise
    const parsePromise = this.preloadPDFParsing(attachmentItemID);
    this.pdfParsingPromises.set(parentItemID, parsePromise);

    // Clean up promise map when done
    parsePromise.finally(() => {
      this.pdfParsingPromises.delete(parentItemID);
    }).catch((err) => {
      Zotero.debug(
        `[${config.addonName}] [PRELOAD] PDF parsing preload failed: ${err}`,
      );
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-PDF-PARSE-PRELOAD: Background PDF parsing for faster first-click
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Preload PDF parsing results in background.
   * Parses the PDF's reference section and caches the mapping for later use.
   * @param attachmentItemID - The PDF attachment item ID
   */
  private async preloadPDFParsing(attachmentItemID: number): Promise<void> {
    // Get attachment and parent item
    const attachment = Zotero.Items.get(attachmentItemID);
    if (!attachment) return;

    const parentItemID = attachment.parentItemID;
    if (!parentItemID) return;

    // Skip if already parsing or cached
    if (this.pdfParsingItems.has(parentItemID)) return;
    if (this.pdfMappingCache.has(parentItemID)) {
      Zotero.debug(
        `[${config.addonName}] [PRELOAD-PDF] Already cached for item ${parentItemID}`,
      );
      return;
    }

    this.pdfParsingItems.add(parentItemID);

    try {
      // Get PDF file path
      const pdfPath = await attachment.getFilePathAsync();
      if (!pdfPath) {
        Zotero.debug(
          `[${config.addonName}] [PRELOAD-PDF] No PDF path for attachment ${attachmentItemID}`,
        );
        return;
      }

      // Extract text from fulltext cache
      const pdfText = await this.extractPDFTextFromCache(pdfPath);
      if (!pdfText) {
        Zotero.debug(
          `[${config.addonName}] [PRELOAD-PDF] No text extracted for ${attachmentItemID}`,
        );
        return;
      }

      // Parse references
      const parser = getPDFReferencesParser();
      const mapping = parser.parseReferencesSection(pdfText);

      if (mapping && mapping.totalLabels > 0) {
        this.pdfMappingCache.set(parentItemID, mapping);

        // Update maxKnownLabel from PDF parsing result
        const labelNums = Array.from(mapping.labelCounts.keys())
          .map((l) => parseInt(l, 10))
          .filter((n) => !isNaN(n));
        if (labelNums.length > 0) {
          const maxLabel = Math.max(...labelNums);
          this.setMaxKnownLabel(attachmentItemID, maxLabel);
        }

        Zotero.debug(
          `[${config.addonName}] [PRELOAD-PDF] Cached numeric mapping (${mapping.totalLabels} labels) for item ${parentItemID}`,
        );
      }

      // Also try author-year parsing
      const authorYearMapping = parser.parseAuthorYearReferencesSection(pdfText);
      if (authorYearMapping && authorYearMapping.authorYearMap.size >= 5) {
        this.pdfAuthorYearMappingCache.set(parentItemID, authorYearMapping);
        Zotero.debug(
          `[${config.addonName}] [PRELOAD-PDF] Cached author-year mapping (${authorYearMapping.authorYearMap.size} entries) for item ${parentItemID}`,
        );
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [PRELOAD-PDF] Error parsing PDF for ${parentItemID}: ${err}`,
      );
    } finally {
      this.pdfParsingItems.delete(parentItemID);
    }
  }

  /**
   * Extract PDF text from Zotero's fulltext cache.
   * @param pdfPath - Path to the PDF file
   */
  private async extractPDFTextFromCache(pdfPath: string): Promise<string | null> {
    try {
      const cacheFileName = ".zotero-ft-cache";
      const pdfDir = pdfPath.substring(0, pdfPath.lastIndexOf("/"));
      const cachePath = `${pdfDir}/${cacheFileName}`;

      const cacheExists = await IOUtils.exists(cachePath);
      if (cacheExists) {
        const cacheData = await IOUtils.read(cachePath);
        const decoder = new TextDecoder("utf-8");
        const text = decoder.decode(cacheData);
        if (text && text.length > 100) {
          return text;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get preloaded PDF numeric mapping for an item.
   * @param parentItemID - The parent item ID (not attachment)
   */
  getPreloadedPDFMapping(parentItemID: number): PDFReferenceMapping | undefined {
    return this.pdfMappingCache.get(parentItemID);
  }

  /**
   * Get preloaded PDF author-year mapping for an item.
   * @param parentItemID - The parent item ID (not attachment)
   */
  getPreloadedAuthorYearMapping(parentItemID: number): AuthorYearReferenceMapping | undefined {
    return this.pdfAuthorYearMappingCache.get(parentItemID);
  }

  /**
   * Check if PDF parsing is in progress for an item.
   * @param parentItemID - The parent item ID
   */
  isPDFParsingInProgress(parentItemID: number): boolean {
    return this.pdfParsingItems.has(parentItemID);
  }

  /**
   * Set preloaded PDF mapping (for external callers to cache results).
   * @param parentItemID - The parent item ID
   * @param mapping - The PDF reference mapping
   */
  setPreloadedPDFMapping(parentItemID: number, mapping: PDFReferenceMapping): void {
    this.pdfMappingCache.set(parentItemID, mapping);
  }

  /**
   * Set preloaded author-year mapping (for external callers to cache results).
   * @param parentItemID - The parent item ID
   * @param mapping - The author-year mapping
   */
  setPreloadedAuthorYearMapping(parentItemID: number, mapping: AuthorYearReferenceMapping): void {
    this.pdfAuthorYearMappingCache.set(parentItemID, mapping);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-PRELOAD-AWAIT: Methods to await in-flight preloads
  // Reduces first-click latency by allowing callers to wait for ongoing preloads
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the in-flight preload promise for a recid.
   * If preload is in progress, returns the promise to await.
   * If preload is completed or not started, returns undefined.
   * @param recid - INSPIRE record ID
   */
  getPreloadPromise(recid: string): Promise<void> | undefined {
    return this.preloadingRecids.get(recid);
  }

  /**
   * Check if preload is in progress for a recid.
   * @param recid - INSPIRE record ID
   */
  isPreloading(recid: string): boolean {
    return this.preloadingRecids.has(recid);
  }

  /**
   * Check if references have been preloaded for a recid.
   * @param recid - INSPIRE record ID
   */
  isPreloaded(recid: string): boolean {
    return this.preloadedRecids.has(recid);
  }

  /**
   * Get the in-flight PDF parsing promise for a parent item.
   * If parsing is in progress, returns the promise to await.
   * If parsing is completed or not started, returns undefined.
   * @param parentItemID - The parent item ID (not attachment)
   */
  getPdfParsePromise(parentItemID: number): Promise<void> | undefined {
    return this.pdfParsingPromises.get(parentItemID);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-PDF-STRUCTURED-DATA: Zotero Structured Page Data Access
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the PDF document object from a reader instance.
   * This accesses Zotero's internal PDF.js document.
   */
  private getPDFDocument(reader: any): any | null {
    try {
      // Try different paths to access the PDF document
      // Path 1: _internalReader._iframeWindow.PDFViewerApplication
      const internalReader = reader?._internalReader;
      if (internalReader?._iframeWindow?.PDFViewerApplication?.pdfDocument) {
        return internalReader._iframeWindow.PDFViewerApplication.pdfDocument;
      }

      // Path 2: _iframeWindow.wrappedJSObject.PDFViewerApplication
      if (reader?._iframeWindow?.wrappedJSObject?.PDFViewerApplication?.pdfDocument) {
        return reader._iframeWindow.wrappedJSObject.PDFViewerApplication.pdfDocument;
      }

      // Path 3: Direct _iframeWindow.PDFViewerApplication
      if (reader?._iframeWindow?.PDFViewerApplication?.pdfDocument) {
        return reader._iframeWindow.PDFViewerApplication.pdfDocument;
      }

      return null;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [STRUCTURED-DATA] Failed to get PDF document: ${err}`,
      );
      return null;
    }
  }

  /**
   * Get structured page data for a specific page from Zotero Reader.
   * Returns character-level data with position and formatting information.
   * FTR-REFACTOR: Results are cached per item+page to avoid expensive re-fetches.
   *
   * @param reader - The Zotero Reader instance
   * @param pageIndex - 0-based page index
   * @returns Page data with chars and overlays, or null if unavailable
   */
  async getStructuredPageData(
    reader: any,
    pageIndex: number,
  ): Promise<ZoteroPageData | null> {
    try {
      // FTR-REFACTOR: Check cache first
      const itemID = reader?.itemID;
      const cacheKey = itemID ? `${itemID}:${pageIndex}` : null;
      if (cacheKey) {
        const cached = this.pageDataCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < ReaderIntegration.CACHE_TTL_MS) {
          debugLog(
            `[${config.addonName}] [STRUCTURED-DATA] Using cached pageData for ${cacheKey}`,
          );
          return cached.data;
        }
      }

      const pdfDocument = this.getPDFDocument(reader);
      if (!pdfDocument) {
        Zotero.debug(
          `[${config.addonName}] [STRUCTURED-DATA] PDF document not accessible`,
        );
        return null;
      }

      // Check if getPageData method exists
      if (typeof pdfDocument.getPageData !== "function") {
        Zotero.debug(
          `[${config.addonName}] [STRUCTURED-DATA] getPageData method not available`,
        );
        return null;
      }

      const pageData = await pdfDocument.getPageData({ pageIndex });
      const result = pageData as ZoteroPageData;

      // FTR-REFACTOR: Cache the result (LRUCache handles eviction automatically)
      if (cacheKey && result) {
        this.pageDataCache.set(cacheKey, { data: result, timestamp: Date.now() });
        debugLog(
          `[${config.addonName}] [STRUCTURED-DATA] Cached pageData for ${cacheKey} (cache size: ${this.pageDataCache.size})`,
        );
      }

      return result;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [STRUCTURED-DATA] Failed to get page data for page ${pageIndex}: ${err}`,
      );
      return null;
    }
  }

  /**
   * Get processed data for the entire PDF document.
   * This includes all pages' character data and detected overlays.
   * FTR-REFACTOR: Results are cached per item to avoid expensive re-fetches.
   *
   * @param reader - The Zotero Reader instance
   * @returns Processed data with all pages, or null if unavailable
   */
  async getProcessedData(reader: any): Promise<ZoteroProcessedData | null> {
    try {
      // FTR-REFACTOR: Check cache first
      const itemID = reader?.itemID;
      if (itemID) {
        const cached = this.processedDataCache.get(itemID);
        if (cached && Date.now() - cached.timestamp < ReaderIntegration.CACHE_TTL_MS) {
          debugLog(
            `[${config.addonName}] [STRUCTURED-DATA] Using cached processedData for item ${itemID}`,
          );
          return cached.data;
        }
      }

      const pdfDocument = this.getPDFDocument(reader);
      if (!pdfDocument) {
        Zotero.debug(
          `[${config.addonName}] [STRUCTURED-DATA] PDF document not accessible`,
        );
        return null;
      }

      // Check if getProcessedData method exists
      if (typeof pdfDocument.getProcessedData !== "function") {
        Zotero.debug(
          `[${config.addonName}] [STRUCTURED-DATA] getProcessedData method not available`,
        );
        return null;
      }

      const processedData = await pdfDocument.getProcessedData();
      const result = processedData as ZoteroProcessedData;

      // FTR-REFACTOR: Cache the result
      if (itemID && result) {
        this.processedDataCache.set(itemID, { data: result, timestamp: Date.now() });
        debugLog(
          `[${config.addonName}] [STRUCTURED-DATA] Cached processedData for item ${itemID}`,
        );
      }

      return result;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [STRUCTURED-DATA] Failed to get processed data: ${err}`,
      );
      return null;
    }
  }

  /**
   * Extract plain text from Zotero character array.
   * Respects spacing, line breaks, and paragraph breaks.
   * Reference: Zotero's reader/src/pdf/selection.js getTextFromChars()
   *
   * @param chars - Array of ZoteroChar objects
   * @returns Extracted text with proper spacing
   */
  extractTextFromChars(chars: ZoteroChar[]): string {
    const textParts: string[] = [];

    for (const char of chars) {
      if (char.ignorable) continue;

      textParts.push(char.c);

      // Add appropriate spacing based on flags
      if (char.paragraphBreakAfter) {
        textParts.push("\n\n");
      } else if (char.lineBreakAfter) {
        textParts.push("\n");
      } else if (char.spaceAfter) {
        textParts.push(" ");
      }
    }

    return textParts.join("").trim();
  }

  /**
   * Get full text from a reader using Zotero's structured data.
   * Falls back to null if structured data is not available.
   *
   * @param reader - The Zotero Reader instance
   * @returns Full text of the PDF, or null if unavailable
   */
  async getFullTextFromStructuredData(reader: any): Promise<string | null> {
    try {
      const processedData = await this.getProcessedData(reader);
      if (!processedData?.pages) {
        Zotero.debug(
          `[${config.addonName}] [STRUCTURED-DATA] No processed data available`,
        );
        return null;
      }

      const pageIndices = Object.keys(processedData.pages)
        .map(Number)
        .sort((a, b) => a - b);

      const textParts: string[] = [];
      for (const pageIndex of pageIndices) {
        const pageData = processedData.pages[pageIndex];
        if (pageData?.chars?.length) {
          const pageText = this.extractTextFromChars(pageData.chars);
          textParts.push(pageText);
        }
      }

      const fullText = textParts.join("\n\n");
      Zotero.debug(
        `[${config.addonName}] [STRUCTURED-DATA] Extracted ${fullText.length} chars from ${pageIndices.length} pages`,
      );

      return fullText || null;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [STRUCTURED-DATA] Failed to get full text: ${err}`,
      );
      return null;
    }
  }

  /**
   * Get the current active Reader instance.
   * Useful for extracting structured data from the currently open PDF.
   */
  getCurrentReader(): any | null {
    try {
      // @ts-ignore - Zotero_Tabs is a global
      const selectedTabID = Zotero_Tabs?.selectedID;
      if (!selectedTabID) return null;

      return Zotero.Reader.getByTabID(selectedTabID);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [STRUCTURED-DATA] Failed to get current reader: ${err}`,
      );
      return null;
    }
  }

  /**
   * Check if Zotero's structured page data API is available.
   * This determines whether we can use the enhanced parsing methods.
   *
   * @param reader - The Zotero Reader instance
   * @returns true if structured data API is available
   */
  async isStructuredDataAvailable(reader: any): Promise<boolean> {
    try {
      const pdfDocument = this.getPDFDocument(reader);
      if (!pdfDocument) return false;

      // Check for required methods
      return (
        typeof pdfDocument.getPageData === "function" ||
        typeof pdfDocument.getProcessedData === "function"
      );
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-CITATION-FORMAT-DETECT: Auto-detect citation format when PDF is opened
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register tab notifier to detect when reader tabs are opened/selected.
   * Triggers background citation format detection for the opened PDF.
   */
  private registerTabNotifier(): void {
    try {
      const callback = {
        notify: async (
          event: string,
          type: string,
          ids: string[] | number[],
          extraData: { [key: string]: any },
        ) => {
          // Only handle tab events
          if (type !== "tab") return;

          // Handle tab select event for reader tabs
          if (event === "select" && ids.length > 0) {
            const tabID = String(ids[0]);
            const tabData = extraData?.[tabID];

            // Only process reader tabs (PDFs)
            if (tabData?.type === "reader") {
              this.handleReaderTabOpened(tabID);
            }
          }

          // Handle tab add event (new tab created)
          if (event === "add" && ids.length > 0) {
            const tabID = String(ids[0]);
            const tabData = extraData?.[tabID];

            if (tabData?.type === "reader") {
              // Small delay to let the reader initialize
              setTimeout(() => this.handleReaderTabOpened(tabID), 500);
            }
          }
        },
      };

      this.tabNotifierID = Zotero.Notifier.registerObserver(callback, ["tab"]);
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Registered tab notifier: ${this.tabNotifierID}`,
      );
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Failed to register tab notifier: ${err}`,
      );
    }
  }

  /**
   * Unregister tab notifier.
   */
  private unregisterTabNotifier(): void {
    if (this.tabNotifierID) {
      try {
        Zotero.Notifier.unregisterObserver(this.tabNotifierID);
        Zotero.debug(
          `[${config.addonName}] [FORMAT-DETECT] Unregistered tab notifier`,
        );
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] [FORMAT-DETECT] Failed to unregister tab notifier: ${err}`,
        );
      }
      this.tabNotifierID = undefined;
    }
  }

  /**
   * Handle reader tab opened/selected event.
   * Triggers background citation format detection.
   */
  private handleReaderTabOpened(tabID: string): void {
    try {
      const reader = Zotero.Reader.getByTabID(tabID);
      if (!reader?.itemID) return;

      const itemID = reader.itemID;

      // Skip if already detected or currently scanning
      if (this.citationFormatByItem.has(itemID) || this.scanningFormatItems.has(itemID)) {
        return;
      }

      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Reader tab opened for item ${itemID}, triggering format detection`,
      );

      // Trigger background format detection
      this.detectCitationFormatBackground(reader);

      // Also trigger background preload
      this.triggerBackgroundPreload(reader);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Error handling reader tab: ${err}`,
      );
    }
  }

  /**
   * Detect citation format in background by sampling PDF text.
   * Non-blocking - runs asynchronously without blocking UI.
   */
  private async detectCitationFormatBackground(reader: any): Promise<void> {
    const itemID = reader?.itemID;
    if (!itemID) return;

    // Mark as scanning
    this.scanningFormatItems.add(itemID);

    try {
      const format = await this.detectCitationFormat(reader);

      // Cache the detected format
      this.citationFormatByItem.set(itemID, format);

      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Detected format for item ${itemID}: ${format}`,
      );

      // Emit event for any listeners
      this.emit("citationFormatDetected", { itemID, format });
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Error detecting format for item ${itemID}: ${err}`,
      );
      // Default to numeric on error
      this.citationFormatByItem.set(itemID, "numeric");
    } finally {
      this.scanningFormatItems.delete(itemID);
    }
  }

  /**
   * Detect citation format by sampling text from PDF pages.
   * Samples text from multiple pages to increase accuracy.
   *
   * Priority order:
   * 1. Zotero overlay data (if available, most accurate)
   * 2. Zotero fulltext cache (.zotero-ft-cache file)
   * 3. Zotero structured page data (chars array)
   * 4. Default to numeric
   *
   * @param reader - The Zotero Reader instance
   * @returns Detected citation format
   */
  private async detectCitationFormat(reader: any): Promise<CitationType> {
    const parser = getCitationParser();
    let numericCount = 0;
    let authorYearCount = 0;
    let sampledPages = 0;
    const maxPagesToSample = 10;

    try {
      // ═══════════════════════════════════════════════════════════════════════
      // Method 1: Check Zotero overlay data for citation type hints
      // Zotero PDF.js can detect "citation" and "reference" overlays
      // ═══════════════════════════════════════════════════════════════════════
      const overlayResult = await this.detectFormatFromOverlays(reader);
      if (overlayResult) {
        Zotero.debug(
          `[${config.addonName}] [FORMAT-DETECT] Detected from overlays: ${overlayResult}`,
        );
        return overlayResult;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // Method 2: Use Zotero fulltext cache (most efficient)
      // ═══════════════════════════════════════════════════════════════════════
      const cachedText = await this.getFulltextFromCache(reader);
      if (cachedText && cachedText.length > 500) {
        const result = this.analyzeTextForCitationFormat(cachedText, parser);
        numericCount = result.numeric;
        authorYearCount = result.authorYear;
        sampledPages = 1;
        Zotero.debug(
          `[${config.addonName}] [FORMAT-DETECT] Using fulltext cache (${cachedText.length} chars)`,
        );
      } else {
        // ═════════════════════════════════════════════════════════════════════
        // Method 3: Use structured page data (fallback)
        // ═════════════════════════════════════════════════════════════════════
        const fullText = await this.getFullTextFromStructuredData(reader);

        if (fullText && fullText.length > 500) {
          const result = this.analyzeTextForCitationFormat(fullText, parser);
          numericCount = result.numeric;
          authorYearCount = result.authorYear;
          sampledPages = 1;
        } else {
          // Fallback: sample from individual pages
          const pdfDocument = this.getPDFDocument(reader);
          if (!pdfDocument) {
            return "numeric";
          }

          const numPages = pdfDocument.numPages || 0;
          if (numPages === 0) {
            return "numeric";
          }

          // Sample from beginning, middle (skip title page and references)
          const pagesToSample: number[] = [];
          if (numPages > 2) {
            for (let i = 1; i < Math.min(5, numPages - 1); i++) {
              pagesToSample.push(i);
            }
            const mid = Math.floor(numPages / 2);
            for (let i = mid - 1; i <= mid + 1 && i < numPages - 1; i++) {
              if (i > 0 && !pagesToSample.includes(i)) {
                pagesToSample.push(i);
              }
            }
          }

          for (const pageIndex of pagesToSample.slice(0, maxPagesToSample)) {
            try {
              const pageData = await this.getStructuredPageData(reader, pageIndex);
              if (pageData?.chars?.length) {
                const pageText = this.extractTextFromChars(pageData.chars);
                if (pageText.length > 100) {
                  const result = this.analyzeTextForCitationFormat(pageText, parser);
                  numericCount += result.numeric;
                  authorYearCount += result.authorYear;
                  sampledPages++;
                }
              }
            } catch {
              // Skip failed pages
            }
          }
        }
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Error sampling PDF: ${err}`,
      );
    }

    // Determine format based on counts
    if (sampledPages === 0) {
      return "numeric";
    }

    const totalCitations = numericCount + authorYearCount;
    if (totalCitations === 0) {
      return "numeric";
    }

    const authorYearRatio = authorYearCount / totalCitations;

    Zotero.debug(
      `[${config.addonName}] [FORMAT-DETECT] Citation counts: numeric=${numericCount}, authorYear=${authorYearCount}, ratio=${authorYearRatio.toFixed(2)}`,
    );

    if (authorYearRatio >= 0.5) {
      return "author-year";
    }

    return "numeric";
  }

  /**
   * Detect citation format from Zotero overlay data.
   * Zotero PDF.js can detect citation markers and their types.
   * Returns null if overlays don't provide enough information.
   */
  private async detectFormatFromOverlays(reader: any): Promise<CitationType | null> {
    try {
      // Sample a few pages for overlay data
      const pagesToCheck = [1, 2, 3, 4, 5]; // Early pages where citations typically appear
      let numericOverlays = 0;
      let totalOverlays = 0;

      for (const pageIndex of pagesToCheck) {
        try {
          const pageData = await this.getStructuredPageData(reader, pageIndex);
          if (!pageData?.overlays?.length) continue;

          for (const overlay of pageData.overlays) {
            if (overlay.type === "citation" || overlay.type === "reference") {
              totalOverlays++;
              // Check if it looks like a numeric citation by examining position/context
              // Numeric citations are typically short (1-3 chars), author-year are longer
              // This is a heuristic based on overlay rect width
              if (overlay.position?.rects?.[0]) {
                const rect = overlay.position.rects[0];
                const width = Math.abs(rect[2] - rect[0]);
                // Numeric citations like [1] are narrow, author-year like (Smith, 2020) are wide
                if (width < 30) {
                  numericOverlays++;
                }
              }
            }
          }
        } catch {
          // Skip failed pages
        }
      }

      // Need enough overlays to make a decision
      if (totalOverlays < 3) {
        return null;
      }

      const numericRatio = numericOverlays / totalOverlays;
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Overlay analysis: ${numericOverlays}/${totalOverlays} numeric-looking (ratio=${numericRatio.toFixed(2)})`,
      );

      // If most overlays look numeric, return numeric
      if (numericRatio >= 0.7) {
        return "numeric";
      }
      // If most overlays look like author-year (wide), return author-year
      if (numericRatio <= 0.3) {
        return "author-year";
      }

      // Mixed or unclear - let text analysis decide
      return null;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Error analyzing overlays: ${err}`,
      );
      return null;
    }
  }

  /**
   * Get fulltext from Zotero's cache file (.zotero-ft-cache).
   * This is the most efficient method as it uses pre-indexed text.
   */
  private async getFulltextFromCache(reader: any): Promise<string | null> {
    try {
      const itemID = reader?.itemID;
      if (!itemID) return null;

      const item = Zotero.Items.get(itemID);
      if (!item) return null;

      // Get the attachment file path
      const filePath = await item.getFilePathAsync?.();
      if (!filePath) return null;

      // Construct cache file path
      const pdfDir = filePath.substring(0, filePath.lastIndexOf("/"));
      const cachePath = `${pdfDir}/.zotero-ft-cache`;

      // Check if cache file exists
      const cacheExists = await IOUtils.exists(cachePath);
      if (!cacheExists) {
        Zotero.debug(
          `[${config.addonName}] [FORMAT-DETECT] No fulltext cache at ${cachePath}`,
        );
        return null;
      }

      // Read cache file
      const cacheData = await IOUtils.read(cachePath);
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(cacheData);

      if (text && text.length > 100) {
        Zotero.debug(
          `[${config.addonName}] [FORMAT-DETECT] Got ${text.length} chars from fulltext cache`,
        );
        return text;
      }

      return null;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Error reading fulltext cache: ${err}`,
      );
      return null;
    }
  }

  /**
   * Analyze text for citation format indicators.
   * Returns counts of numeric and author-year citations found.
   */
  private analyzeTextForCitationFormat(
    text: string,
    parser: ReturnType<typeof getCitationParser>,
  ): { numeric: number; authorYear: number } {
    let numeric = 0;
    let authorYear = 0;

    // Count numeric citations [1], [1,2], [1-5], etc.
    const numericMatches = text.match(/\[\d+(?:\s*[-–,]\s*\d+)*\]/g);
    if (numericMatches) {
      numeric += numericMatches.length;
    }

    // Count superscript citations
    const superscriptMatches = text.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g);
    if (superscriptMatches) {
      numeric += superscriptMatches.length;
    }

    // Count author-year citations (Author, Year), Author et al. (Year), etc.
    // Pattern 1: (Author, YYYY) or (Authors, YYYY)
    const inParenMatches = text.match(/\([A-Z][a-zA-Z'''-]+(?:(?:\s*,\s*|\s+and\s+)[A-Z][a-zA-Z'''-]+)*(?:\s+et\s+al\.?)?\s*,\s*\d{4}[a-z]?\)/gi);
    if (inParenMatches) {
      authorYear += inParenMatches.length;
    }

    // Pattern 2: Author et al. (YYYY)
    const etAlMatches = text.match(/[A-Z][a-zA-Z'''-]+\s+et\s+al\.?\s*\(\d{4}[a-z]?\)/gi);
    if (etAlMatches) {
      authorYear += etAlMatches.length;
    }

    // Pattern 3: Author and Author (YYYY)
    const twoAuthorMatches = text.match(/[A-Z][a-zA-Z'''-]+\s+and\s+[A-Z][a-zA-Z'''-]+\s*\(\d{4}[a-z]?\)/gi);
    if (twoAuthorMatches) {
      authorYear += twoAuthorMatches.length;
    }

    return { numeric, authorYear };
  }

  /**
   * Get the detected citation format for an item.
   * Returns undefined if not yet detected.
   *
   * @param itemID - Zotero attachment item ID
   * @returns Detected format or undefined
   */
  getCitationFormat(itemID: number): CitationType | undefined {
    return this.citationFormatByItem.get(itemID);
  }

  /**
   * Check if the detected format for an item is author-year.
   * Returns false if not detected or if format is numeric.
   *
   * @param itemID - Zotero attachment item ID
   * @returns true if author-year format was detected
   */
  isAuthorYearFormat(itemID: number): boolean {
    return this.citationFormatByItem.get(itemID) === "author-year";
  }
}

// Export singleton getter
export function getReaderIntegration(): ReaderIntegration {
  return ReaderIntegration.getInstance();
}

