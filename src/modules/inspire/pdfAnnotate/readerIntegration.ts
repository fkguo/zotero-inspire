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
import type { InspireReferenceEntry } from "../types";
import type {
  ParsedCitation,
  CitationLookupEvent,
  ReaderState,
  ZoteroChar,
  ZoteroPageData,
  ZoteroProcessedData,
} from "./types";

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

    const listenerCount = this.listeners.size;
    const stateCount = this.readerStates.size;
    const preloadCount = this.preloadedRecids.size;
    this.readerStates.clear();
    this.listeners.clear();
    this.preloadedRecids.clear();
    this.preloadingRecids.clear();
    this.maxKnownLabelByItem.clear();
    this.initialized = false;
    ReaderIntegration.instance = null;
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Cleaned up: ${listenerCount} listeners, ${stateCount} reader states, ${preloadCount} preloaded recids`,
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
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] handleTextSelectionPopup called`,
    );
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] args.reader: itemID=${reader?.itemID}, tabID=${reader?.tabID}`,
    );
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] args.params keys: ${Object.keys(params || {}).join(", ") || "(none)"}`,
    );

    // FTR-CACHE-PRELOAD: Trigger background preload when user interacts with PDF
    // This ensures references are cached before user clicks on a citation
    this.triggerBackgroundPreload(reader);

    // Try to find selected text from params.annotation
    if (params?.annotation) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] params.annotation keys: ${Object.keys(params.annotation).join(", ")}`,
      );
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] params.annotation.text: "${params.annotation.text?.substring(0, 100) || "(none)"}"`,
      );
    }

    // Get selected text - try multiple methods
    const selectedText = this.getSelectedText(reader, params);
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Final selected text: "${selectedText?.substring(0, 50) ?? "(null)"}${selectedText && selectedText.length > 50 ? "..." : ""}"`,
    );

    // Allow longer selections (up to 2000 chars) to capture multiple citations
    // Regex matching is fast enough for this length, no performance concerns
    if (!selectedText || selectedText.length > 2000) {
      Zotero.debug(
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
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] maxKnownLabel for itemID ${reader?.itemID}: ${maxKnownLabel ?? "undefined"}`,
    );
    let allLabels: string[] = [];

    if (selectedText.length <= 50) {
      // Short selection: use parseSelection (more lenient, handles partial selections)
      // Pass enableFuzzy to control aggressive pattern matching
      // Pass maxKnownLabel for concatenated range detection (e.g., [62-64] copied as [6264])
      const citation = parser.parseSelection(selectedText, enableFuzzy, maxKnownLabel);
      if (citation && citation.labels.length > 0) {
        allLabels = citation.labels;
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
      if (allLabels.length === 0 && enableFuzzy) {
        const fuzzyCitation = parser.parseSelection(selectedText, true, maxKnownLabel);
        if (fuzzyCitation && fuzzyCitation.labels.length > 0) {
          allLabels = fuzzyCitation.labels;
        }
      }
    }

    if (allLabels.length === 0) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] No citation pattern detected in selection`,
      );
      return;
    }

    // Build a combined citation object for UI
    const citation: ParsedCitation = {
      raw: allLabels.map(l => `[${l}]`).join(", "),
      type: "numeric",
      labels: allLabels,
      position: null,
    };

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Citation detected: type=${citation.type}, labels=[${citation.labels.join(",")}], raw="${citation.raw}"`,
    );

    // Create lookup UI - single button for one label, or multiple buttons for multiple labels
    const element = this.createLookupUI(doc, reader, citation);
    append(element);

    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Lookup UI appended to popup (${citation.labels.length} label(s))`,
    );
  }

  /**
   * Create the lookup UI - single button for one label, or compact grid for multiple labels
   */
  private createLookupUI(
    doc: Document,
    reader: any,
    citation: ParsedCitation,
  ): HTMLElement {
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
      Zotero.debug(
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
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: PDFViewerApplication found, checking selection`,
        );
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: PDFViewerApplication method failed: ${err}`,
      );
    }

    // Method 3: Try iframe contentWindow selection
    try {
      const iframe = reader._iframe;
      const iframeWin = iframe?.contentWindow;
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: trying iframe method, iframe=${!!iframe}, contentWindow=${!!iframeWin}`,
      );
      const selection = iframeWin?.getSelection?.();
      const text = selection?.toString()?.trim();
      if (text) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found via iframe selection`,
        );
        return text;
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: iframe method failed: ${err}`,
      );
    }

    // Method 4: Try _iframeWindow directly  
    try {
      const iframeWin = reader._iframeWindow;
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: trying _iframeWindow, exists=${!!iframeWin}`,
      );
      if (iframeWin) {
        const selection = iframeWin.getSelection?.();
        const text = selection?.toString()?.trim();
        if (text) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found via _iframeWindow selection`,
          );
          return text;
        }
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: _iframeWindow method failed: ${err}`,
      );
    }

    // Method 5: Check if reader has a getSelectedText or similar method
    try {
      if (typeof reader.getSelectedText === "function") {
        const text = reader.getSelectedText();
        if (text) {
          Zotero.debug(
            `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found via reader.getSelectedText()`,
          );
          return text.trim();
        }
      }
      // Check for _lastSelection or similar
      if (reader._lastSelection) {
        Zotero.debug(
          `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found reader._lastSelection`,
        );
        return reader._lastSelection.trim();
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: reader method failed: ${err}`,
      );
    }

    Zotero.debug(
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
      return pageData as ZoteroPageData;
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
   *
   * @param reader - The Zotero Reader instance
   * @returns Processed data with all pages, or null if unavailable
   */
  async getProcessedData(reader: any): Promise<ZoteroProcessedData | null> {
    try {
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
      return processedData as ZoteroProcessedData;
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
}

// Export singleton getter
export function getReaderIntegration(): ReaderIntegration {
  return ReaderIntegration.getInstance();
}

