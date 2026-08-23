// ─────────────────────────────────────────────────────────────────────────────
// Reader Integration
// FTR-PDF-ANNOTATE: Integrate with Zotero Reader for citation detection
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getCitationParser, postProcessLabels } from "./citationParser";
import { getPref } from "../../../utils/prefs";
import { deriveRecidFromItem } from "../apiUtils";
import {
  loadPersistedPdfParse,
  pdfMappingCacheKey,
} from "./pdfMappingPersistence";
import { MemoryMonitor } from "../memoryMonitor";
import type {
  PDFReferenceMapping,
  AuthorYearReferenceMapping,
} from "./pdfReferencesParser";
import { LRUCache } from "../utils";
import {
  getOverlayCoordinator,
  initializeOverlayCoordinator,
  shutdownOverlayCoordinator,
} from "./overlayCoordinatorRegistry";
import type {
  NativeLinkedReferenceCapture,
  NativeLinkedReferenceEvidence,
  NativeOriginAnchor,
} from "./nativeOverlayTypes";
import { settleLinkedReferenceWithin } from "./nativeLinkedReference";
import type {
  ParsedCitation,
  CitationLookupEvent,
  CitationPreviewEvent,
  ReaderState,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TransientState - Unified state management for easy cleanup
// Prevents memory leaks by centralizing state that needs clearing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transient state that is cleared on cleanup.
 * Centralizing these allows simple reset via createInitialTransientState().
 */
interface TransientState {
  /** FTR-PDF-MATCHING: Store max known label per item for concatenated range detection */
  maxKnownLabelByItem: Map<number, number>;
  /** FTR-RECID-AUTO-UPDATE: Track parent items that were opened without recid */
  itemsAwaitingRecid: Set<number>;
  /** Interaction-triggered persisted-map loads (never full-text parsing). */
  pdfMappingCacheLoads: Map<number, Promise<boolean>>;
  /** Avoid repeatedly probing a missing/stale persisted map in one session. */
  pdfMappingCacheLoadAttempted: Set<number>;
}

/**
 * Create initial transient state with empty collections.
 * Called on initialization and cleanup.
 */
function createInitialTransientState(): TransientState {
  return {
    maxKnownLabelByItem: new Map(),
    itemsAwaitingRecid: new Set(),
    pdfMappingCacheLoads: new Map(),
    pdfMappingCacheLoadAttempted: new Set(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug logging control
// Set to false in production for better performance during text selection
// ─────────────────────────────────────────────────────────────────────────────
const DEBUG_READER_INTEGRATION = false;

/**
 * Native destination resolution must never become a gate in front of the
 * established PDF-mapping path. Target pages are usually already available,
 * but a Reader page-load promise can remain pending on malformed or very large
 * PDFs. After this bounded opportunity the caller continues through the legacy
 * matcher while the single-flight native load may still finish for a later
 * interaction.
 */
const LINKED_REFERENCE_LOOKUP_BUDGET_MS = 750;
const LINKED_REFERENCE_PREVIEW_BUDGET_MS = 200;

/** Conditional debug logging - only logs when DEBUG_READER_INTEGRATION is true */
function debugLog(message: string): void {
  if (DEBUG_READER_INTEGRATION) {
    Zotero.debug(message);
  }
}

type ExtractedIdentifier =
  | { type: "arxiv"; value: string }
  | { type: "doi"; value: string };

/**
 * Fallback identifier extraction using Zotero.Utilities.extractIdentifiers.
 * Only invoked when citation parsing fails; safe-guarded to avoid errors in tests
 * (where Zotero may be undefined).
 */
function extractIdentifiersFallback(text: string): ExtractedIdentifier | null {
  try {
    const zoteroAny = Zotero as any;
    const utilities = zoteroAny?.Utilities;
    const extractIdentifiers = utilities?.extractIdentifiers;
    if (typeof extractIdentifiers !== "function") {
      return null;
    }

    const results = extractIdentifiers(text);
    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }

    const candidates: Array<{ id: ExtractedIdentifier; idx: number }> = [];
    const cleanDoi: ((doi: string) => string) | undefined =
      typeof utilities?.cleanDOI === "function"
        ? utilities.cleanDOI
        : undefined;
    const lower = text.toLowerCase();

    for (const r of results) {
      if (!r || typeof r !== "object") continue;

      const doiRaw =
        (r.DOI as string | undefined) ??
        (r.doi as string | undefined) ??
        undefined;
      if (typeof doiRaw === "string" && doiRaw.trim()) {
        const cleaned = cleanDoi ? cleanDoi(doiRaw) : doiRaw.trim();
        if (cleaned) {
          const idx = lower.indexOf(cleaned.toLowerCase());
          candidates.push({ id: { type: "doi", value: cleaned }, idx });
        }
      }

      const arxivRaw =
        (r.arXiv as string | undefined) ??
        (r.arxiv as string | undefined) ??
        undefined;
      if (typeof arxivRaw === "string" && arxivRaw.trim()) {
        const cleaned = arxivRaw.replace(/^arxiv:\s*/i, "").trim();
        if (cleaned) {
          const idx = lower.indexOf(cleaned.toLowerCase());
          candidates.push({ id: { type: "arxiv", value: cleaned }, idx });
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Prefer earliest occurrence; tie-breaker prefers arXiv in INSPIRE workflows.
    candidates.sort((a, b) => {
      const aIdx = a.idx >= 0 ? a.idx : Number.POSITIVE_INFINITY;
      const bIdx = b.idx >= 0 ? b.idx : Number.POSITIVE_INFINITY;
      if (aIdx !== bIdx) return aIdx - bIdx;
      if (a.id.type !== b.id.type) return a.id.type === "arxiv" ? -1 : 1;
      return 0;
    });

    return candidates[0].id;
  } catch (_err) {
    return null;
  }
}

/**
 * Event listener callback type
 */
type EventCallback<T> = (data: T) => void;

interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

interface ReaderUIContext {
  readerRef?: WeakRefLike<object>;
  sourceAttachmentItemID: number;
  parentItemID: number;
  readerTabID?: string;
  originAnchor?: NativeOriginAnchor;
  linkedReferenceCapture?: NativeLinkedReferenceCapture;
  linkedReferencePromise?: Promise<NativeLinkedReferenceEvidence>;
  linkedReferencePreviewRetryScheduled?: boolean;
}

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
  /** Unified transient state for easy cleanup */
  private transientState = createInitialTransientState();
  /** FTR-CITATION-FORMAT-DETECT: Notifier ID for tab events */
  private tabNotifierID?: string;
  /** Delayed reader-open callbacks, cancelled on select/close/shutdown. */
  private readerOpenTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** FTR-RECID-AUTO-UPDATE: Notifier ID for item events */
  private itemNotifierID?: string;
  /** FTR-RECID-AUTO-UPDATE: Track current reader tab's parent item ID */
  private currentReaderParentItemID?: number;
  /** On-demand PDF mappings, scoped per attachment. */
  private static readonly PDF_MAPPING_CACHE_SIZE = 30;
  private pdfMappingCache = new LRUCache<number, PDFReferenceMapping>(
    ReaderIntegration.PDF_MAPPING_CACHE_SIZE,
  );
  /** On-demand author-year mappings, scoped per attachment. */
  private pdfAuthorYearMappingCache = new LRUCache<
    number,
    AuthorYearReferenceMapping
  >(ReaderIntegration.PDF_MAPPING_CACHE_SIZE);

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
      initializeOverlayCoordinator(
        getPref("pdf_native_overlay_reuse") !== false,
      );

      // Store bound handler reference for later unregistration
      this.boundTextSelectionHandler = this.handleTextSelectionPopup.bind(this);
      // Mark ownership before registration so a partial failure can use the
      // normal idempotent cleanup path to roll back every acquired resource.
      this.initialized = true;

      // Register for text selection popup
      Zotero.Reader.registerEventListener(
        "renderTextSelectionPopup",
        this.boundTextSelectionHandler,
        config.addonID,
      );
      // Never use `renderToolbar` as a preload trigger. Zotero constructs an
      // embedded Reader for the library item pane's attachment Preview, so
      // ordinary item selection emits that hook even when the user never opens
      // a PDF tab. On a 2,270-page RPP PDF it turned simple selection into a
      // whole-document overlay/parse prewarm.

      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Successfully registered renderTextSelectionPopup listener`,
      );

      // Register LRU caches with MemoryMonitor for statistics tracking
      const monitor = MemoryMonitor.getInstance();
      monitor.registerCache("pdfMapping", this.pdfMappingCache);
      monitor.registerCache(
        "pdfAuthorYearMapping",
        this.pdfAuthorYearMappingCache,
      );

      // FTR-CITATION-FORMAT-DETECT: Register tab notifier to detect when PDF is opened
      this.registerTabNotifier();

      // FTR-RECID-AUTO-UPDATE: Register item notifier to detect when recid becomes available
      this.registerItemNotifier();

      // Do not scan already-open Reader overlays at startup. Marker-local
      // citation text/link targets are read directly on the first real
      // interaction; the global compatibility index is interaction-gated.

      return true;
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Failed to register event listener: ${err}`,
      );
      try {
        this.cleanup();
      } catch {
        shutdownOverlayCoordinator();
        this.initialized = false;
        this.boundTextSelectionHandler = undefined;
      }
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
    if (!Number.isSafeInteger(maxLabel) || maxLabel <= 0) return;
    const existing = this.transientState.maxKnownLabelByItem.get(itemID) ?? 0;
    // The cached INSPIRE list and a persisted/full PDF mapping are independent
    // estimates of the largest printed label. Never let a later, smaller list
    // estimate erase a mapping-derived bound: that could make a genuine high
    // label look like a lost-dash range on the next interaction.
    if (maxLabel <= existing) return;
    this.transientState.maxKnownLabelByItem.set(itemID, maxLabel);
    // Prevent unbounded growth if many PDFs are opened in one session.
    this.capMap(this.transientState.maxKnownLabelByItem, 300);
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
    return this.transientState.maxKnownLabelByItem.get(itemID);
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
    this.cancelAllReaderOpenTimers();
    this.cancelPreviewShow();
    this.currentPreviewButton = undefined;

    // FTR-RECID-AUTO-UPDATE: Unregister item notifier
    this.unregisterItemNotifier();

    const listenerCount = this.listeners.size;
    const stateCount = this.readerStates.size;
    const awaitingRecidCount = this.transientState.itemsAwaitingRecid.size;

    // Clear non-transient state
    this.readerStates.clear();
    this.listeners.clear();
    this.currentReaderParentItemID = undefined;

    // Reset all transient state in one operation (prevents forgotten cleanup)
    this.transientState = createInitialTransientState();

    // Clear LRU caches (they have their own eviction but need explicit cleanup on shutdown)
    const monitor = MemoryMonitor.getInstance();
    monitor.unregisterCache(this.pdfMappingCache);
    monitor.unregisterCache(this.pdfAuthorYearMappingCache);
    this.pdfMappingCache.clear();
    this.pdfAuthorYearMappingCache.clear();
    shutdownOverlayCoordinator();

    this.initialized = false;
    ReaderIntegration.instance = null;
    Zotero.debug(
      `[${config.addonName}] [PDF-ANNOTATE] Cleaned up: ${listenerCount} listeners, ${stateCount} reader states, ${awaitingRecidCount} items awaiting recid`,
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
   * S7: A "presentation" item (talk / slides) has no reference list, so the
   * citation-lookup / reference-parse feature does not apply to it. Resolves the
   * reader's parent item and checks its Zotero item type.
   */
  private isPresentationReader(reader: any): boolean {
    try {
      const itemID = reader?.itemID;
      if (!itemID) return false;
      const item = Zotero.Items.get(itemID);
      if (!item) return false;
      const parentItemID = item.parentItemID || itemID;
      const parentItem = Zotero.Items.get(parentItemID);
      return parentItem?.itemType === "presentation";
    } catch {
      return false;
    }
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

    // A presentation has no reference list, so citation matching does not
    // apply.
    if (this.isPresentationReader(reader)) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] Skipping presentation reader (no reference list)`,
      );
      return;
    }

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
    const maxKnownLabel = reader?.itemID
      ? this.getMaxKnownLabel(reader.itemID)
      : undefined;
    const attachmentItemID = reader?.itemID;
    if (!Number.isSafeInteger(attachmentItemID) || attachmentItemID <= 0)
      return;
    const selectionEvidence =
      getOverlayCoordinator().classifySelectionWithReadyEvidence(
        reader,
        attachmentItemID,
        selectedText,
      );
    const detectedFormat = selectionEvidence.format;
    const isAuthorYearDoc = detectedFormat === "author-year";
    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] maxKnownLabel for itemID ${reader?.itemID}: ${maxKnownLabel ?? "undefined"}, detectedFormat: ${detectedFormat ?? "not yet detected"}`,
    );
    let allLabels: string[] = [];
    let citationType:
      | "numeric"
      | "author-year"
      | "arxiv"
      | "mixed"
      | "unknown" = "numeric";
    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Preserve subCitations from parseSelection
    let subCitations: ParsedCitation["subCitations"] = undefined;
    let originalRaw: string | undefined = undefined;

    if (selectedText.length <= 100) {
      // Short selection: use parseSelection (more lenient, handles partial selections)
      // Pass enableFuzzy to control aggressive pattern matching
      // Pass maxKnownLabel for concatenated range detection (e.g., [62-64] copied as [6264])
      // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Increased threshold from 50 to 100 to capture author-year citations
      // FTR-CITATION-FORMAT-DETECT: Pass isAuthorYearDoc to prioritize author-year detection
      const citation = parser.parseSelection(
        selectedText,
        enableFuzzy,
        maxKnownLabel,
        isAuthorYearDoc,
      );
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
        const fuzzyCitation = parser.parseSelection(
          selectedText,
          true,
          maxKnownLabel,
          isAuthorYearDoc,
        );
        if (fuzzyCitation && fuzzyCitation.labels.length > 0) {
          allLabels = fuzzyCitation.labels;
          citationType = fuzzyCitation.type;
          subCitations = fuzzyCitation.subCitations;
          originalRaw = fuzzyCitation.raw;
        }
      }
    }

    if (allLabels.length === 0) {
      // Fallback: try Zotero.Utilities.extractIdentifiers() for DOI/arXiv when no citation pattern is detected
      const extracted = extractIdentifiersFallback(selectedText);
      if (extracted) {
        allLabels = [extracted.value];
        citationType = extracted.type === "arxiv" ? "arxiv" : "unknown";
        originalRaw =
          extracted.type === "arxiv"
            ? `arXiv:${extracted.value}`
            : `DOI:${extracted.value}`;
        debugLog(
          `[${config.addonName}] [PDF-ANNOTATE] extractIdentifiers fallback matched ${extracted.type}: ${extracted.value}`,
        );
      } else {
        debugLog(
          `[${config.addonName}] [PDF-ANNOTATE] No citation pattern detected in selection`,
        );
        return;
      }
    }

    // Build a combined citation object for UI
    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Preserve subCitations and use original raw for display
    const citation: ParsedCitation = {
      raw:
        originalRaw ??
        (citationType === "author-year"
          ? allLabels[0] // For author-year, use the full label as raw
          : allLabels.map((l) => `[${l}]`).join(", ")),
      type: citationType,
      labels: allLabels,
      position: null,
      subCitations,
    };

    debugLog(
      `[${config.addonName}] [PDF-ANNOTATE] Citation detected: type=${citation.type}, labels=[${citation.labels.join(",")}], raw="${citation.raw}", subCitations=${citation.subCitations?.length ?? 0}`,
    );

    // Create lookup UI - single button for one label, or multiple buttons for multiple labels
    const attachmentItem = Zotero.Items.get(attachmentItemID);
    const uiContext: ReaderUIContext = {
      readerRef: makeReaderWeakRef(reader),
      sourceAttachmentItemID: attachmentItemID,
      parentItemID: attachmentItem?.parentItemID || attachmentItemID,
      readerTabID: reader?.tabID ? String(reader.tabID) : undefined,
      originAnchor: selectionEvidence.originAnchor,
      linkedReferenceCapture:
        citation.type === "numeric" && citation.labels.length === 1
          ? getOverlayCoordinator().captureLinkedReference(
              reader,
              attachmentItemID,
              params?.annotation?.position,
              citation.labels[0],
            )
          : undefined,
    };
    // The appearance of a citation-specific lookup control is already a real
    // user interaction. Start Zotero's bounded one-target-page resolution now
    // so the first hover usually consumes a completed native result, without
    // restoring Reader-open References/PDF prewarming.
    this.primeLinkedReference(uiContext);
    const element = this.createLookupUI(doc, uiContext, citation);
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
    context: ReaderUIContext,
    citation: ParsedCitation,
  ): HTMLElement {
    // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Handle author-year citations
    if (citation.type === "author-year") {
      // If multiple sub-citations detected (e.g., "Bignamini et al. (2009, 2010)" = 2 papers),
      // create a container with multiple buttons
      if (citation.subCitations && citation.subCitations.length > 1) {
        return this.createMultiAuthorYearLookupUI(doc, context, citation);
      }
      // Single author-year citation: show one button
      return this.createAuthorYearLookupButton(doc, context, citation);
    }

    // Single label: simple button with icon and text
    if (citation.labels.length === 1) {
      // createSingleLookupButton already adds icon and text
      return this.createSingleLookupButton(doc, context, citation.labels[0]);
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
      fontSize: "12px", // FTR-FOCUSED-SELECTION: increased from 11px
      fontWeight: "500",
      color: "var(--fill-secondary, #666)",
      marginRight: "4px",
    });
    container.appendChild(label);

    // Create compact buttons for each label
    for (const refLabel of citation.labels) {
      const button = this.createCompactLookupButton(doc, context, refLabel);
      container.appendChild(button);
    }

    return container;
  }

  /**
   * Create a compact lookup button (just the number, minimal padding)
   */
  private createCompactLookupButton(
    doc: Document,
    context: ReaderUIContext,
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
      fontSize: "11px", // FTR-FOCUSED-SELECTION: increased from 10px
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
      // FTR-HOVER-PREVIEW: Schedule preview card
      this.schedulePreviewShow(button, context, label, "numeric");
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "var(--material-background, #ffffff)";
      button.style.color = "inherit";
      button.style.borderColor = "var(--fill-quinary, #d1d1d5)";
      // FTR-HOVER-PREVIEW: Hide preview card
      this.hidePreview();
    });

    button.addEventListener("click", () => {
      const singleCitation: ParsedCitation = {
        raw: `[${label}]`,
        type: "numeric",
        labels: [label],
        position: null,
      };
      void this.lookupCitation(context, singleCitation);
    });

    return button;
  }

  /**
   * Create a lookup button for author-year citation (e.g., "Guerrieri et al. (2014)")
   * FTR-PDF-ANNOTATE-AUTHOR-YEAR: Shows single button with citation text, sends all labels for matching
   */
  private createAuthorYearLookupButton(
    doc: Document,
    context: ReaderUIContext,
    citation: ParsedCitation,
  ): HTMLButtonElement {
    const button = doc.createElement("button");
    button.className = "toolbarButton zinspire-lookup-citation-btn";

    // Add icon
    const icon = this.createInlineIcon(doc, 14);
    button.appendChild(icon);

    // Use raw text for display (e.g., "Guerrieri et al. (2014)")
    // Truncate if too long for button display
    const displayText =
      citation.raw.length > 30
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
      // FTR-HOVER-PREVIEW: Schedule preview card
      // FTR-FIX: Pass citation.labels so panel can use its existing matching logic
      this.schedulePreviewShow(
        button,
        context,
        citation.raw,
        "author-year",
        citation.labels,
      );
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "var(--material-background, #ffffff)";
      // FTR-HOVER-PREVIEW: Hide preview card
      this.hidePreview();
    });

    // On click, send the full citation with all labels for author-year matching
    button.addEventListener("click", () => {
      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] Author-year button CLICKED: raw="${citation.raw}", labels=[${citation.labels.join(",")}]`,
      );
      void this.lookupCitation(context, citation);
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
    context: ReaderUIContext,
    citation: ParsedCitation,
  ): HTMLElement {
    const container = doc.createElement("div");
    container.className =
      "zinspire-lookup-container zinspire-author-year-multi";
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
      const displayText =
        subCitation.displayText.length > 25
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
        // FTR-HOVER-PREVIEW: Schedule preview card
        // FTR-FIX: Pass subCitation.labels so panel can use its existing matching logic
        this.schedulePreviewShow(
          button,
          context,
          subCitation.displayText,
          "author-year",
          subCitation.labels,
        );
      });

      button.addEventListener("mouseleave", () => {
        button.style.background = "var(--material-background, #ffffff)";
        button.style.color = "inherit";
        button.style.borderColor = "var(--fill-quinary, #d1d1d5)";
        // FTR-HOVER-PREVIEW: Hide preview card
        this.hidePreview();
      });

      // On click, lookup with this sub-citation's specific labels
      button.addEventListener("click", () => {
        const subCitationObj: ParsedCitation = {
          raw: subCitation.displayText,
          type: "author-year",
          labels: subCitation.labels,
          position: null,
        };
        void this.lookupCitation(context, subCitationObj);
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
    context: ReaderUIContext,
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
      fontSize: "13px", // FTR-FOCUSED-SELECTION: increased from 12px
      borderRadius: "4px",
      border: "1px solid var(--fill-quinary, #d1d1d5)",
      background: "var(--material-background, #ffffff)",
      cursor: "pointer",
      transition: "background 120ms ease-in-out",
    });

    button.addEventListener("mouseenter", () => {
      button.style.background = "var(--fill-quinary, #f0f0f0)";
      // FTR-HOVER-PREVIEW: Schedule preview card
      this.schedulePreviewShow(button, context, label, "numeric");
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "var(--material-background, #ffffff)";
      // FTR-HOVER-PREVIEW: Hide preview card
      this.hidePreview();
    });

    button.addEventListener("click", () => {
      // Create a single-label citation object for lookup
      const singleCitation: ParsedCitation = {
        raw: `[${label}]`,
        type: "numeric",
        labels: [label],
        position: null,
      };
      void this.lookupCitation(context, singleCitation);
    });

    return button;
  }

  /**
   * Get selected text from Reader using multiple methods
   */
  private getSelectedText(
    reader: any,
    params?: { annotation?: any },
  ): string | null {
    // Method 1: Try params.annotation.text (Zotero's standard way for highlight annotations)
    if (params?.annotation?.text) {
      debugLog(
        `[${config.addonName}] [PDF-ANNOTATE] getSelectedText: found via params.annotation.text`,
      );
      return params.annotation.text.trim();
    }

    // Try iframe contentWindow selection
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
   * FTR-MULTI-PDF-FIX: Now includes attachmentItemID for proper PDF-specific cache lookup
   */
  private async lookupCitation(
    context: ReaderUIContext,
    citation: ParsedCitation,
  ): Promise<void> {
    try {
      const liveReader = context.readerRef?.deref();
      const linkedReference = await this.resolveLinkedReference(
        context,
        citation.labels.length === 1 ? citation.labels[0] : undefined,
        LINKED_REFERENCE_LOOKUP_BUDGET_MS,
      );
      const readToken = getOverlayCoordinator().validateOriginAnchorForEvent(
        liveReader,
        context.sourceAttachmentItemID,
        context.originAnchor,
        "lookup",
      );

      // Emit lookup event with both IDs
      // FTR-MULTI-PDF-FIX: Include attachmentItemID for PDF-specific cache lookup
      const event: CitationLookupEvent = {
        parentItemID: context.parentItemID,
        attachmentItemID: context.sourceAttachmentItemID,
        citation,
        readerTabID: context.readerTabID,
        readToken,
        linkedReference,
      };

      Zotero.debug(
        `[${config.addonName}] [PDF-ANNOTATE] lookupCitation: about to emit citationLookup event for type="${citation.type}", labels=[${citation.labels.join(",")}]`,
      );
      this.emit("citationLookup", event);

      Zotero.debug(
        `[${config.addonName}] Citation lookup: labels=[${citation.labels.join(",")}] parentItemID=${context.parentItemID} attachmentItemID=${context.sourceAttachmentItemID}`,
      );
    } catch (err) {
      Zotero.debug(`[${config.addonName}] Failed to lookup citation: ${err}`);
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
  // FTR-HOVER-PREVIEW: Preview Card Event Emission
  // ─────────────────────────────────────────────────────────────────────────────

  /** Timeout for preview show delay */
  private previewShowTimeout?: ReturnType<typeof setTimeout>;
  /** Current preview button (to avoid duplicate events) */
  private currentPreviewButton?: HTMLElement;
  /** Preview show delay in ms */
  private readonly previewShowDelay = 300;

  /**
   * Schedule preview card show after delay.
   * FTR-HOVER-PREVIEW: Emits citationPreviewRequest event to panel controller.
   * FTR-FIX: Now accepts labels array for proper author-year matching.
   */
  private schedulePreviewShow(
    button: HTMLElement,
    context: ReaderUIContext,
    label: string,
    citationType: "numeric" | "author-year" | "arxiv",
    labels?: string[],
  ): void {
    // Cancel any pending preview
    this.cancelPreviewShow();

    // Skip if already showing for this button
    if (this.currentPreviewButton === button) {
      return;
    }

    this.previewShowTimeout = setTimeout(() => {
      this.currentPreviewButton = button;
      void this.emitPreviewRequest(
        button,
        context,
        label,
        citationType,
        labels,
      );
    }, this.previewShowDelay);
  }

  /**
   * Cancel scheduled preview show.
   */
  private cancelPreviewShow(): void {
    if (this.previewShowTimeout !== undefined) {
      clearTimeout(this.previewShowTimeout);
      this.previewShowTimeout = undefined;
    }
  }

  /**
   * Hide preview card immediately.
   * FTR-HOVER-PREVIEW: Emits citationPreviewHide event.
   */
  private hidePreview(): void {
    this.cancelPreviewShow();
    this.currentPreviewButton = undefined;
    this.emit("citationPreviewHide", {});
  }

  /**
   * Emit preview request event with button position.
   * FTR-HOVER-PREVIEW: Converts iframe-relative coordinates to main window coordinates.
   * FTR-FIX: Now accepts labels array for proper author-year matching.
   * FTR-MULTI-PDF-FIX: Includes attachmentItemID for PDF-specific cache lookup.
   */
  private async emitPreviewRequest(
    button: HTMLElement,
    context: ReaderUIContext,
    label: string,
    citationType: "numeric" | "author-year" | "arxiv",
    labels?: string[],
  ): Promise<void> {
    try {
      const liveReader = context.readerRef?.deref() as any;
      const linkedReference = await this.resolveLinkedReference(
        context,
        citationType === "numeric" && (labels?.length ?? 1) === 1
          ? label
          : undefined,
        LINKED_REFERENCE_PREVIEW_BUDGET_MS,
      );
      if (this.currentPreviewButton !== button || !button.isConnected) return;
      if (linkedReference?.kind === "timeout") {
        this.scheduleLinkedReferencePreviewRetry(
          button,
          context,
          label,
          citationType,
          labels,
        );
      }
      const readToken = getOverlayCoordinator().validateOriginAnchorForEvent(
        liveReader,
        context.sourceAttachmentItemID,
        context.originAnchor,
        "hover",
      );

      // Get button position in its document's viewport coordinates
      const rect = button.getBoundingClientRect();

      // Determine if we need to add iframe offset
      // The button is in a popup - check if popup is in main window or iframe
      let offsetX = 0;
      let offsetY = 0;

      // Get the main Zotero window for reference
      const mainWindow = Zotero.getMainWindow();
      const buttonDoc = button.ownerDocument;
      const buttonWindow = buttonDoc?.defaultView;

      // Check if button is in a different window than main window
      const isInMainWindow = buttonWindow === (mainWindow as unknown as Window);

      if (!isInMainWindow) {
        // Button is in iframe - need to calculate offset
        // Try multiple methods to get the iframe element
        try {
          // Method 1: reader._iframe
          let iframe = liveReader?._iframe;

          // Method 2: reader._internalReader?._iframe
          if (!iframe && liveReader?._internalReader?._iframe) {
            iframe = liveReader._internalReader._iframe;
          }

          // Method 3: Find iframe by checking window ancestry
          if (!iframe && mainWindow) {
            // Search for iframe whose contentWindow matches buttonWindow
            const iframes = mainWindow.document.querySelectorAll("iframe");
            for (const f of iframes) {
              if ((f as HTMLIFrameElement).contentWindow === buttonWindow) {
                iframe = f;
                break;
              }
            }
          }

          if (iframe) {
            const iframeRect = iframe.getBoundingClientRect();
            offsetX = iframeRect.left;
            offsetY = iframeRect.top;
          }
        } catch (e) {
          Zotero.debug(
            `[${config.addonName}] [HOVER-PREVIEW] Could not get iframe position: ${e}`,
          );
        }
      }

      // FTR-MULTI-PDF-FIX: Include attachmentItemID for PDF-specific cache lookup
      const event: CitationPreviewEvent = {
        parentItemID: context.parentItemID,
        attachmentItemID: context.sourceAttachmentItemID,
        label,
        labels: labels ?? [label], // Default to [label] if not provided
        citationType,
        buttonRect: {
          top: rect.top + offsetY,
          left: rect.left + offsetX,
          bottom: rect.bottom + offsetY,
          right: rect.right + offsetX,
        },
        readerTabID: context.readerTabID,
        readToken,
        linkedReference,
      };

      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] emitPreviewRequest: label=${label}, isInMainWindow=${isInMainWindow}, rect=(${rect.top.toFixed(0)},${rect.left.toFixed(0)}), offset=(${offsetY.toFixed(0)},${offsetX.toFixed(0)}), final=(${event.buttonRect.top.toFixed(0)},${event.buttonRect.left.toFixed(0)})`,
      );

      this.emit("citationPreviewRequest", event);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [HOVER-PREVIEW] Error emitting preview request: ${err}`,
      );
    }
  }

  private resolveLinkedReference(
    context: ReaderUIContext,
    label: string | undefined,
    budgetMs: number,
  ): Promise<NativeLinkedReferenceEvidence | undefined> {
    const capture = context.linkedReferenceCapture;
    if (!capture || !label || capture.label !== label) {
      return Promise.resolve(undefined);
    }
    if (!context.linkedReferencePromise) {
      const liveReader = context.readerRef?.deref();
      context.linkedReferencePromise =
        getOverlayCoordinator().resolveLinkedReference(liveReader, capture);
    }
    return settleLinkedReferenceWithin(
      context.linkedReferencePromise,
      budgetMs,
    ).then(
      (evidence): NativeLinkedReferenceEvidence =>
        evidence ?? { kind: "timeout", label: capture.label },
    );
  }

  private primeLinkedReference(context: ReaderUIContext): void {
    const capture = context.linkedReferenceCapture;
    if (!capture || context.linkedReferencePromise) return;
    const liveReader = context.readerRef?.deref();
    context.linkedReferencePromise =
      getOverlayCoordinator().resolveLinkedReference(liveReader, capture);
    void context.linkedReferencePromise.catch(() => undefined);
  }

  private scheduleLinkedReferencePreviewRetry(
    button: HTMLElement,
    context: ReaderUIContext,
    label: string,
    citationType: "numeric" | "author-year" | "arxiv",
    labels?: string[],
  ): void {
    const pending = context.linkedReferencePromise;
    if (!pending || context.linkedReferencePreviewRetryScheduled) return;
    context.linkedReferencePreviewRetryScheduled = true;
    void pending
      .then((evidence) => {
        if (
          evidence.kind !== "resolved" ||
          this.currentPreviewButton !== button ||
          !button.isConnected
        ) {
          return;
        }
        void this.emitPreviewRequest(
          button,
          context,
          label,
          citationType,
          labels,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        context.linkedReferencePreviewRetryScheduled = false;
      });
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

  /**
   * Get a cached PDF numeric mapping for a specific PDF attachment.
   * FTR-MULTI-PDF-FIX: Changed to use attachmentItemID to support multiple PDFs per item.
   * @param attachmentItemID - The PDF attachment item ID (NOT parent)
   */
  getCachedPDFMapping(
    attachmentItemID: number,
  ): PDFReferenceMapping | undefined {
    return this.pdfMappingCache.get(attachmentItemID);
  }

  /**
   * Get a cached PDF author-year mapping for a specific PDF attachment.
   * FTR-MULTI-PDF-FIX: Changed to use attachmentItemID to support multiple PDFs per item.
   * @param attachmentItemID - The PDF attachment item ID (NOT parent)
   */
  getCachedAuthorYearMapping(
    attachmentItemID: number,
  ): AuthorYearReferenceMapping | undefined {
    return this.pdfAuthorYearMappingCache.get(attachmentItemID);
  }

  /**
   * Restore the complex parser's persisted result on the first real citation
   * interaction. This reads only the attachment-scoped `pdfmap` cache after
   * mtime/size validation; it never opens `.zotero-ft-cache` and never invokes
   * the full reference parser.
   */
  async ensureCachedPDFMappings(attachmentItemID: number): Promise<boolean> {
    const state = this.transientState;
    // A live mapping is already restored. Check this before the negative-load
    // memo so a successful parser/install always wins.
    if (
      this.pdfMappingCache.has(attachmentItemID) ||
      this.pdfAuthorYearMappingCache.has(attachmentItemID)
    ) {
      return true;
    }
    const existing = state.pdfMappingCacheLoads.get(attachmentItemID);
    if (existing) return existing;
    if (state.pdfMappingCacheLoadAttempted.has(attachmentItemID)) {
      return false;
    }

    state.pdfMappingCacheLoadAttempted.add(attachmentItemID);
    this.capSet(state.pdfMappingCacheLoadAttempted, 300);
    const load = this.loadCachedPDFMappings(attachmentItemID, state);
    state.pdfMappingCacheLoads.set(attachmentItemID, load);
    this.capMap(state.pdfMappingCacheLoads, 100);
    try {
      const loaded = await load;
      if (loaded && this.transientState === state) {
        // Keep only negative probes memoized. Successful mappings live in the
        // bounded LRUs; if an entry is later evicted, a new interaction may
        // restore its persisted result instead of being blocked forever by an
        // old "attempted" bit.
        state.pdfMappingCacheLoadAttempted.delete(attachmentItemID);
      }
      return loaded;
    } finally {
      if (
        this.transientState === state &&
        state.pdfMappingCacheLoads.get(attachmentItemID) === load
      ) {
        state.pdfMappingCacheLoads.delete(attachmentItemID);
      }
    }
  }

  private async loadCachedPDFMappings(
    attachmentItemID: number,
    stateAtStart: TransientState,
  ): Promise<boolean> {
    try {
      const attachment = Zotero.Items.get(attachmentItemID);
      if (!attachment || typeof attachment.getFilePathAsync !== "function") {
        return false;
      }
      const pdfPath = await attachment.getFilePathAsync();
      if (!pdfPath) return false;
      const persisted = await loadPersistedPdfParse(
        pdfMappingCacheKey(attachment),
        pdfPath,
      );
      if (this.transientState !== stateAtStart || !persisted) return false;

      if (persisted.numeric) {
        this.pdfMappingCache.set(attachmentItemID, persisted.numeric);
        let maxLabel = 0;
        for (const label of persisted.numeric.labelCounts.keys()) {
          const parsed = Number.parseInt(label, 10);
          if (Number.isFinite(parsed) && parsed > maxLabel) maxLabel = parsed;
        }
        if (maxLabel > 0) this.setMaxKnownLabel(attachmentItemID, maxLabel);
      }
      if (persisted.authorYear) {
        this.pdfAuthorYearMappingCache.set(
          attachmentItemID,
          persisted.authorYear,
        );
      }
      return !!(persisted.numeric || persisted.authorYear);
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [PDF-PARSE-PERSIST] Interaction cache load failed for attachment ${attachmentItemID}: ${err}`,
      );
      return false;
    }
  }

  /**
   * Cache an on-demand PDF mapping.
   * FTR-MULTI-PDF-FIX: Changed to use attachmentItemID to support multiple PDFs per item.
   * @param attachmentItemID - The PDF attachment item ID (NOT parent)
   * @param mapping - The PDF reference mapping
   */
  setCachedPDFMapping(
    attachmentItemID: number,
    mapping: PDFReferenceMapping,
  ): void {
    this.pdfMappingCache.set(attachmentItemID, mapping);
    this.transientState.pdfMappingCacheLoadAttempted.delete(attachmentItemID);
  }

  /**
   * Cache an on-demand author-year mapping.
   * FTR-MULTI-PDF-FIX: Changed to use attachmentItemID to support multiple PDFs per item.
   * @param attachmentItemID - The PDF attachment item ID (NOT parent)
   * @param mapping - The author-year mapping
   */
  setCachedAuthorYearMapping(
    attachmentItemID: number,
    mapping: AuthorYearReferenceMapping,
  ): void {
    this.pdfAuthorYearMappingCache.set(attachmentItemID, mapping);
    this.transientState.pdfMappingCacheLoadAttempted.delete(attachmentItemID);
  }

  private capSet<T>(set: Set<T>, maxSize: number): void {
    if (!set || maxSize <= 0) return;
    while (set.size > maxSize) {
      const first = set.values().next().value as T | undefined;
      if (first === undefined) break;
      set.delete(first);
    }
  }

  private capMap<K, V>(map: Map<K, V>, maxSize: number): void {
    if (!map || maxSize <= 0) return;
    while (map.size > maxSize) {
      const firstKey = map.keys().next().value as K | undefined;
      if (firstKey === undefined) break;
      map.delete(firstKey);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Reader tab lifecycle and native completed-result admission
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register tab notifier to detect when reader tabs are opened/selected.
   * Tracks Reader lifecycle and admits bounded reuse of completed native data.
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
            this.cancelReaderOpenTimer(tabID);
            getOverlayCoordinator().reconcileTabSelection();

            // Only process reader tabs (PDFs)
            if (tabData?.type === "reader") {
              this.handleReaderTabOpened(
                tabID,
                Zotero.Reader.getByTabID(tabID),
              );
            }
          }

          // Handle tab add event (new tab created)
          if (event === "add" && ids.length > 0) {
            const tabID = String(ids[0]);
            const tabData = extraData?.[tabID];

            if (tabData?.type === "reader") {
              // Small delay to let the reader initialize
              this.cancelReaderOpenTimer(tabID);
              const timer = setTimeout(() => {
                if (this.readerOpenTimers.get(tabID) !== timer) return;
                this.readerOpenTimers.delete(tabID);
                if (!this.initialized) return;
                this.handleReaderTabOpened(
                  tabID,
                  Zotero.Reader.getByTabID(tabID),
                );
              }, 500);
              this.readerOpenTimers.set(tabID, timer);
            }
          }

          // Handle reader tab close/remove to prevent state leaks
          if (
            (event === "close" || event === "remove" || event === "delete") &&
            ids.length > 0
          ) {
            for (const id of ids) {
              const tabID = String(id);
              this.cancelReaderOpenTimer(tabID);
              this.handleReaderTabClosed(tabID);
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

  // ─────────────────────────────────────────────────────────────────────────────
  // FTR-RECID-AUTO-UPDATE: Item notifier for detecting recid availability
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register item notifier to detect when items are modified.
   * Used to detect when recid becomes available for items that were opened without one.
   */
  private registerItemNotifier(): void {
    try {
      const callback = {
        notify: async (
          event: string,
          type: string,
          ids: number[] | string[],
          extraData: { [key: string]: any },
        ) => {
          if (type !== "item") return;

          for (const id of ids) {
            const itemID = typeof id === "string" ? parseInt(id, 10) : id;
            if (isNaN(itemID)) continue;

            if (event === "modify" || event === "index") {
              getOverlayCoordinator().invalidateAttachment(itemID, false);
            } else if (event === "trash" || event === "delete") {
              getOverlayCoordinator().invalidateAttachment(itemID, true);
            }

            if (event !== "modify") continue;

            // Check if this item was awaiting recid
            if (!this.transientState.itemsAwaitingRecid.has(itemID)) continue;

            const item = Zotero.Items.get(itemID);
            if (!item || !item.isRegularItem()) continue;

            const recid = deriveRecidFromItem(item);
            if (recid) {
              // Recid is now available!
              this.transientState.itemsAwaitingRecid.delete(itemID);
              Zotero.debug(
                `[${config.addonName}] [RECID-AUTO-UPDATE] Item ${itemID} now has recid ${recid} after modification`,
              );

              // Emit event so panel can refresh
              this.emit("itemRecidAvailable", { parentItemID: itemID, recid });
            }
          }
        },
      };

      this.itemNotifierID = Zotero.Notifier.registerObserver(callback, [
        "item",
      ]);
      Zotero.debug(
        `[${config.addonName}] [RECID-AUTO-UPDATE] Registered item notifier: ${this.itemNotifierID}`,
      );
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [RECID-AUTO-UPDATE] Failed to register item notifier: ${err}`,
      );
    }
  }

  /**
   * Unregister item notifier.
   */
  private unregisterItemNotifier(): void {
    if (this.itemNotifierID) {
      try {
        Zotero.Notifier.unregisterObserver(this.itemNotifierID);
        Zotero.debug(
          `[${config.addonName}] [RECID-AUTO-UPDATE] Unregistered item notifier`,
        );
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] [RECID-AUTO-UPDATE] Failed to unregister item notifier: ${err}`,
        );
      }
      this.itemNotifierID = undefined;
    }
  }

  /**
   * Handle reader tab opened/selected event.
   * Registers bounded native reuse without starting plugin-owned cache loading
   * or full-text reference parsing.
   * FTR-RECID-AUTO-UPDATE: Tracks items without recid for auto-update.
   */
  private handleReaderTabOpened(_tabID: string, readerHint?: any): void {
    try {
      const reader = readerHint;
      if (!reader) return;
      if (this.isPresentationReader(reader)) return;
      if (!reader?.itemID) return;

      const itemID = reader.itemID;
      const item = Zotero.Items.get(itemID);
      if (!item) return;

      // Get parent item ID
      const parentItemID = item.parentItemID || itemID;
      const parentItem = Zotero.Items.get(parentItemID);
      if (!parentItem || !parentItem.isRegularItem()) return;

      // FTR-RECID-AUTO-UPDATE: Track current reader parent item
      this.currentReaderParentItemID = parentItemID;

      // Check if item has recid
      const recid = deriveRecidFromItem(parentItem);

      // FTR-RECID-AUTO-UPDATE: Track items without recid
      if (!recid) {
        this.transientState.itemsAwaitingRecid.add(parentItemID);
        this.capSet(this.transientState.itemsAwaitingRecid, 300);
        Zotero.debug(
          `[${config.addonName}] [RECID-AUTO-UPDATE] Item ${parentItemID} opened without recid, tracking for auto-update`,
        );
        // Emit event so panel can show "no recid" message immediately
        this.emit("itemNoRecid", { parentItemID });
      } else {
        // Item has recid - check if it was previously awaiting
        if (this.transientState.itemsAwaitingRecid.has(parentItemID)) {
          this.transientState.itemsAwaitingRecid.delete(parentItemID);
          Zotero.debug(
            `[${config.addonName}] [RECID-AUTO-UPDATE] Item ${parentItemID} now has recid ${recid}, emitting update event`,
          );
          // Emit event so panel can refresh
          this.emit("itemRecidAvailable", { parentItemID, recid });
        }
      }

      // Presentations have no reference list. Recid tracking above still runs
      // for the panel.
      if (parentItem?.itemType === "presentation") {
        return;
      }

      // Reader open is bookkeeping-only. Do not admit/schedule a plugin scan
      // of the completed native overlay store here. A real citation hover or
      // click reads its marker-local Zotero result directly and may then admit
      // the separate global compatibility index on demand.
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Error handling reader tab: ${err}`,
      );
    }
  }

  private handleReaderTabClosed(tabID: string): void {
    try {
      getOverlayCoordinator().releaseTab(tabID);
      const state = this.readerStates.get(tabID);
      if (!state) {
        // Still clear the entry if present (defensive)
        this.clearReaderState(tabID);
        return;
      }

      this.clearReaderState(tabID);

      // Clean transient per-item state to avoid long-session memory growth.
      const attachmentItemID = state.itemID;
      this.transientState.maxKnownLabelByItem.delete(attachmentItemID);

      // Best-effort: clear caches keyed by attachment item ID
      this.pdfMappingCache.delete(attachmentItemID);
      this.pdfAuthorYearMappingCache.delete(attachmentItemID);
      this.transientState.pdfMappingCacheLoadAttempted.delete(attachmentItemID);

      // Clear recid tracking for this parent item (if applicable)
      const parentItemID = state.parentItemID;
      this.transientState.itemsAwaitingRecid.delete(parentItemID);
      if (this.currentReaderParentItemID === parentItemID) {
        this.currentReaderParentItemID = undefined;
      }

      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Cleaned reader tab state: tabID=${tabID}, attachment=${attachmentItemID}, parent=${parentItemID}`,
      );
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] [FORMAT-DETECT] Failed to cleanup reader tab ${tabID}: ${err}`,
      );
    }
  }

  private cancelReaderOpenTimer(tabID: string): void {
    const timer = this.readerOpenTimers.get(tabID);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.readerOpenTimers.delete(tabID);
  }

  private cancelAllReaderOpenTimers(): void {
    for (const timer of this.readerOpenTimers.values()) clearTimeout(timer);
    this.readerOpenTimers.clear();
  }
}

// Export singleton getter
export function getReaderIntegration(): ReaderIntegration {
  return ReaderIntegration.getInstance();
}

function makeReaderWeakRef(value: unknown): WeakRefLike<object> | undefined {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  try {
    const Constructor = (globalThis as any).WeakRef;
    return typeof Constructor === "function"
      ? new Constructor(value)
      : undefined;
  } catch {
    return undefined;
  }
}
