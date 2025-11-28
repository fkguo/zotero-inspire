import { config } from "../../package.json";
import { cleanMathTitle } from "../utils/mathTitle";
import {
  getJournalAbbreviations,
  getJournalFullNames,
} from "../utils/journalAbbreviations";
import { getLocaleID, getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { ProgressWindowHelper } from "zotero-plugin-toolkit/dist/helpers/progressWindow";
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
// API Constants
// ─────────────────────────────────────────────────────────────────────────────
const INSPIRE_API_BASE = "https://inspirehep.net/api";
const INSPIRE_LITERATURE_URL = "https://inspirehep.net/literature";
const ARXIV_ABS_URL = "https://arxiv.org/abs";
const DOI_ORG_URL = "https://doi.org";
const CROSSREF_API_URL = "https://api.crossref.org/works";

// ─────────────────────────────────────────────────────────────────────────────
// Text Normalization Constants
// ─────────────────────────────────────────────────────────────────────────────
const SPECIAL_CHAR_REPLACEMENTS: Record<string, string> = {
  "ß": "ss",
  "æ": "ae",
  "œ": "oe",
  "ø": "o",
  "đ": "d",
  "ð": "d",
  "þ": "th",
  "ł": "l",
};
const SPECIAL_CHAR_REGEX = /[ßæœøđðþł]/g;
const GERMAN_UMLAUT_REPLACEMENTS: Record<string, string> = {
  "ä": "ae",
  "ö": "oe",
  "ü": "ue",
};
const GERMAN_UMLAUT_REGEX = /[äöü]/g;
const COMBINING_MARKS_REGEX = /[\u0300-\u036f]/g;

const normalizeSearchText = (value: string): string => {
  if (!value) {
    return "";
  }
  const lower = value.toLowerCase();
  const replaced = lower.replace(
    SPECIAL_CHAR_REGEX,
    (char) => SPECIAL_CHAR_REPLACEMENTS[char] ?? char,
  );
  return replaced.normalize("NFD").replace(COMBINING_MARKS_REGEX, "");
};

const buildVariantSet = (value: string): string[] => {
  if (!value) {
    return [];
  }
  const normalized = normalizeSearchText(value);
  const umlautExpanded = normalizeSearchText(
    value
      .toLowerCase()
      .replace(
        GERMAN_UMLAUT_REGEX,
        (char) => GERMAN_UMLAUT_REPLACEMENTS[char] ?? char,
      ),
  );
  const variants = [normalized, umlautExpanded].filter(
    (token): token is string => Boolean(token),
  );
  return Array.from(new Set(variants));
};

const buildSearchIndexText = (value: string): string =>
  buildVariantSet(value).join(" ");

const SEARCH_COLLAPSE_REGEX = /[.\s]+/g;

const buildFilterTokenVariants = (
  value: string,
  options?: { ignoreSpaceDot?: boolean },
): string[] => {
  const variants = buildVariantSet(value);
  const journalFullNames = getJournalFullNames(value);
  if (journalFullNames.length) {
    for (const fullName of journalFullNames) {
      variants.push(...buildVariantSet(fullName));
    }
  }
  let uniqueVariants = Array.from(new Set(variants));
  if (!options?.ignoreSpaceDot) {
    return uniqueVariants;
  }
  const collapsed = uniqueVariants
    .map((token) => token.replace(SEARCH_COLLAPSE_REGEX, ""))
    .filter((token): token is string => Boolean(token));
  if (!collapsed.length) {
    return uniqueVariants;
  }
  uniqueVariants = Array.from(new Set([...uniqueVariants, ...collapsed]));
  return uniqueVariants;
};

const isFilterWhitespace = (char: string): boolean =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";

type ParsedFilterToken = { text: string; quoted: boolean };

const parseFilterTokens = (value: string): ParsedFilterToken[] => {
  if (!value) {
    return [];
  }
  const tokens: ParsedFilterToken[] = [];
  let current = "";
  let inQuotes = false;

  const pushToken = (quoted: boolean) => {
    if (!current) {
      return;
    }
    const trimmed = current.trim();
    if (trimmed) {
      tokens.push({ text: trimmed, quoted });
    }
    current = "";
  };

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      pushToken(inQuotes);
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && isFilterWhitespace(char)) {
      pushToken(false);
      continue;
    }
    current += char;
  }

  pushToken(inQuotes);
  return tokens;
};
export class ZInsUtils {
  static registerPrefs() {
    const prefOptions = {
      pluginID: config.addonID,
      src: rootURI + "content/preferences.xhtml",
      image: `chrome://${config.addonRef}/content/icons/inspire@2x.png`,
      defaultXUL: true,
    };
    Zotero.PreferencePanes.register(prefOptions);
  }

  static registerNotifier() {
    const callback = {
      notify: async (
        event: string,
        type: string,
        ids: number[] | string[],
        extraData: { [key: string]: any },
      ) => {
        if (!addon?.data.alive) {
          this.unregisterNotifier(notifierID);
          return;
        }
        addon.hooks.onNotify(event, type, ids, extraData);
      },
    };

    const notifierID = Zotero.Notifier.registerObserver(callback, ["item"]);

    Zotero.Plugins.addObserver({
      shutdown: ({ id }) => {
        if (id === addon.data.config.addonID)
          this.unregisterNotifier(notifierID);
      },
    });
  }

  private static unregisterNotifier(notifierID: string) {
    Zotero.Notifier.unregisterObserver(notifierID);
  }
}

export class ZInsMenu {
  static registerRightClickMenuPopup() {
    ztoolkit.Menu.register("item", {
      tag: "menuseparator",
    });
    const menuIcon = `chrome://${config.addonRef}/content/icons/inspire.png`;
    ztoolkit.Menu.register(
      "item",
      {
        tag: "menu",
        label: getString("menupopup-label"),
        children: [
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel0"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedItems("full");
            },
          },
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel1"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedItems("noabstract");
            },
          },
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel2"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedItems("citations");
            },
          },
          {
            tag: "menuseparator",
          },
          {
            tag: "menuitem",
            label: "Cancel Update",
            commandListener: (_ev) => {
              _globalThis.inspire.cancelUpdate();
            },
          },
        ],
        icon: menuIcon,
      },
      // "before",
      // document.querySelector(
      //   "#zotero-itemmenu-addontemplate-test",
      // ) as XUL.MenuItem,
    );
    // ztoolkit.Menu.register("menuFile", {
    //   tag: "menuseparator",
    // });
  }

  static registerRightClickCollectionMenu() {
    ztoolkit.Menu.register("collection", {
      tag: "menuseparator",
    });
    const menuIcon = `chrome://${config.addonRef}/content/icons/inspire.png`;
    ztoolkit.Menu.register(
      "collection",
      {
        tag: "menu",
        label: getString("menupopup-label"),
        children: [
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel0"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedCollection("full");
            },
          },
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel1"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedCollection("noabstract");
            },
          },
          {
            tag: "menuitem",
            label: getString("menuitem-submenulabel2"),
            commandListener: (_ev) => {
              _globalThis.inspire.updateSelectedCollection("citations");
            },
          },
        ],
        icon: menuIcon,
      },
      // "before",
      // document.querySelector(
      //   "#zotero-itemmenu-addontemplate-test",
      // ) as XUL.MenuItem,
    );
  }
}

/**
 * Author search information for precise INSPIRE author search.
 * Priority: BAI > recid > fullName
 * BAI (INSPIRE Author ID) like "Feng.Kun.Guo.1" is the most reliable.
 */
interface AuthorSearchInfo {
  fullName: string;
  bai?: string;    // INSPIRE BAI (e.g., "Feng.Kun.Guo.1") - most precise
  recid?: string;  // INSPIRE author recid (backup)
}

interface InspireReferenceEntry {
  id: string;
  label?: string;
  recid?: string;
  inspireUrl?: string;
  fallbackUrl?: string;
  title: string;
  summary?: string;
  year: string;
  authors: string[];
  totalAuthors?: number;  // Total author count (for detecting "et al." need)
  authorSearchInfos?: AuthorSearchInfo[];  // Author info for precise search
  authorText: string;
  displayText: string;
  searchText: string;
  localItemID?: number;
  isRelated?: boolean;
  citationCount?: number;
  publicationInfo?: any;
  publicationInfoErrata?: Array<{ info: any; label: string }>;
  arxivDetails?: InspireArxivDetails | string | null;
  abstract?: string;
  abstractLoading?: boolean;
}

interface InspireArxivDetails {
  id?: string;
  categories?: string[];
}

interface ScrollSnapshot {
  element: Element;
  top: number;
  left: number;
}

interface ScrollState {
  scrollTop: number;
  scrollLeft: number;
  scrollSnapshots: ScrollSnapshot[];
  activeElement: Element | null;
}

interface NavigationSnapshot {
  itemID: number;
  recid?: string;
  scrollState: ScrollState;
  tabType: "library" | "reader";
  readerTabID?: string;
}

interface EntryCitedSource {
  recid?: string;
  authorQuery?: string; // Author search query (deprecated, for cache key only)
  authorSearchInfo?: AuthorSearchInfo; // Full author info for precise search
  label: string;
}

type InspireViewMode = "references" | "citedBy" | "entryCited";
const REFERENCE_SORT_OPTIONS = ["default", "yearDesc", "citationDesc"] as const;
type ReferenceSortOption = (typeof REFERENCE_SORT_OPTIONS)[number];
const INSPIRE_SORT_OPTIONS = ["mostrecent", "mostcited"] as const;
type InspireSortOption = (typeof INSPIRE_SORT_OPTIONS)[number];
const DEFAULT_REFERENCE_SORT: ReferenceSortOption = "default";
const DEFAULT_CITED_BY_SORT: InspireSortOption = "mostrecent";
// Page sizing: use consistent page size to avoid pagination offset bugs
// INSPIRE API calculates offset as (page-1) * size, so different sizes cause gaps
const CITED_BY_PAGE_SIZE = 250; // Consistent page size for all pages
const CITED_BY_MAX_PAGES = 40;  // Max pages to fetch (40 * 250 = 10000)
const CITED_BY_MAX_RESULTS = 10000;
const CITED_BY_PARALLEL_BATCH_SIZE = 3; // Number of pages to fetch in parallel
// Frontend pagination: render entries in chunks for better performance
const RENDER_PAGE_SIZE = 100; // Number of entries to render per "page"
const NAVIGATION_STACK_LIMIT = 20;
// Large collaboration threshold: if authors > this, only show first author + et al.
const LARGE_COLLABORATION_THRESHOLD = 20;

const isReferenceSortOption = (value: string): value is ReferenceSortOption =>
  (REFERENCE_SORT_OPTIONS as readonly string[]).includes(value);

const isInspireSortOption = (value: string): value is InspireSortOption =>
  (INSPIRE_SORT_OPTIONS as readonly string[]).includes(value);

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
        l10nID: 'zoteroinspire-references-panel-header',
        icon: paneIcon,
        darkIcon: paneIcon,
      },
      sidenav: {
        l10nID: 'zoteroinspire-referencesSection',
        icon: paneIcon2x,
        darkIcon: paneIcon2x,
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
          onClick: ({ body }: { body: HTMLDivElement }) => {
            try {
              const controller = this.controllers.get(body);
              controller?.copyAllBibTeX();
            } catch (e) {
              Zotero.debug(
                `[${config.addonName}] Copy BibTeX button error: ${e}`,
              );
            }
          },
        },
      ],
    });
  }

  static unregisterPanel() {
    if (typeof this.registrationKey === "string") {
      Zotero.ItemPaneManager.unregisterSection(this.registrationKey);
      this.registrationKey = undefined;
    }
  }
}

class InspireReferencePanelController {
  private static readonly instances = new Set<InspireReferencePanelController>();
  private static navigationStack: NavigationSnapshot[] = [];
  private static forwardStack: NavigationSnapshot[] = [];
  private static isNavigatingHistory = false;
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
  private referencesCache = new Map<string, InspireReferenceEntry[]>();
  private citedByCache = new Map<string, InspireReferenceEntry[]>();
  private entryCitedCache = new Map<string, InspireReferenceEntry[]>();
  private metadataCache = new Map<string, jsobject>();
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
  // Total count from API (may be larger than fetched entries due to limits)
  private totalApiCount: number | null = null;

  constructor(body: HTMLDivElement) {
    this.body = body;
    this.body.classList.add("zinspire-ref-panel");
    this.enableTextSelection();

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
    };
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
              this.renderReferenceList();
            },
          },
        ],
      },
      toolbar,
    ) as HTMLInputElement;

    this.listEl = ztoolkit.UI.appendElement(
      {
        tag: "div",
        classList: ["zinspire-ref-panel__list"],
      },
      this.body,
    ) as HTMLDivElement;

    this.renderMessage(getString("references-panel-status-empty"));
    this.registerNotifier();
    InspireReferencePanelController.instances.add(this);
    InspireReferencePanelController.syncBackButtonStates();
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

  destroy() {
    this.unregisterNotifier();
    this.cancelActiveRequest();
    this.allEntries = [];
    this.referencesCache.clear();
    this.citedByCache.clear();
    this.entryCitedCache.clear();
    this.metadataCache.clear();
    this.rowCache.clear();
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
          const response = await fetch(url);
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

  async handleItemChange(
    args: _ZoteroTypes.ItemPaneManagerSection.SectionHookArgs,
  ) {
    try {
      if (args.tabType !== "library" && args.tabType !== "reader") {
        this.renderMessage(getString("references-panel-reader-mode"));
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
        this.renderMessage(getString("references-panel-select-item"));
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
        this.clearEntryCitedContext();
        this.cancelActiveRequest();
        this.allEntries = [];
        this.totalApiCount = null; // Reset API count for new item
        this.renderMessage(this.getLoadingMessageForMode(this.viewMode));
      } else {
        // Check if we need to restore scroll position when switching back to original item
        // Only restore if we are not loading new content (item didn't change)
        this.restoreScrollPositionIfNeeded();
      }

      const recid =
        deriveRecidFromItem(item) ?? (await fetchRecidFromInspire(item));
      if (!recid) {
        this.currentRecid = undefined;
        this.renderMessage(getString("references-panel-no-recid"));
        this.updateSortSelector();
        return;
      }
      if (this.currentRecid !== recid) {
        this.currentRecid = recid;
        this.updateSortSelector();
        await this.loadEntries(recid, this.viewMode).catch((err) => {
          if ((err as any)?.name !== "AbortError") {
            Zotero.debug(
              `[${config.addonName}] Failed to load INSPIRE data: ${err}`,
            );
            this.renderMessage(getString("references-panel-status-error"));
          }
        });
      } else {
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
    const resetNode = (node: any) => {
      if (!node) {
        return;
      }
      if (typeof node.scrollTop === "number") {
        node.scrollTop = 0;
      }
      if (typeof node.scrollLeft === "number") {
        node.scrollLeft = 0;
      }
      if (typeof node.scrollTo === "function") {
        try {
          node.scrollTo(0, 0);
        } catch (_err) {
          // Ignore scroll failures
        }
      }
    };
    let current: Element | null = this.listEl;
    while (current) {
      resetNode(current);
      if (current === this.body) {
        break;
      }
      current = current.parentElement;
    }
    this.scrollSectionIntoView();
  }

  private scrollSectionIntoView() {
    const sectionRoot =
      (typeof (this.body as any).closest === "function"
        ? (this.body.closest(".item-pane-section") as HTMLElement | null)
        : null) ?? this.body;
    if (!sectionRoot || typeof sectionRoot.scrollIntoView !== "function") {
      return;
    }
    try {
      sectionRoot.scrollIntoView({ block: "start", behavior: "auto" });
    } catch (_err) {
      try {
        sectionRoot.scrollIntoView(true);
      } catch (_err2) {
        // Ignore scroll failures
      }
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

      // Progressive rendering callback for cited-by and author papers
      const onProgress = (currentEntries: InspireReferenceEntry[], total: number | null) => {
        if (this.pendingToken !== token || this.viewMode !== mode) {
          return;
        }
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

        // Render first page immediately for faster perceived performance
        // Also re-render when filtering to update filter results with new data
        if (!hasRenderedFirstPage || this.filterText) {
          this.renderReferenceList({ preserveScroll: hasRenderedFirstPage });
          if (options.resetScroll && !hasRenderedFirstPage) {
            this.resetListScroll();
          }
          hasRenderedFirstPage = true;
        }
      };

      if (mode === "references") {
        // References mode with progressive rendering
        this.totalApiCount = null;

        // Custom progress handler for references that applies sorting
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

          // Progressive render
          if (!hasRenderedFirstPage || this.filterText) {
            this.renderReferenceList({ preserveScroll: hasRenderedFirstPage });
            if (options.resetScroll && !hasRenderedFirstPage) {
              this.resetListScroll();
            }
            hasRenderedFirstPage = true;
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
    const response = await fetch(
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
      if (onProgress && (entries.length % BATCH_SIZE === 0 || i === totalCount - 1)) {
        onProgress([...entries], totalCount);
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
    const fieldsParam = "&fields=control_number,titles.title,authors.full_name,authors.ids,publication_info,earliest_date,dois,arxiv_eprints,citation_count";

    // Helper to fetch a single page
    const fetchPage = async (pageNum: number, pageSize: number): Promise<any[]> => {
      const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=${pageSize}&page=${pageNum}${sortParam}${fieldsParam}`;
      const response = await fetch(url, signal ? { signal } : undefined).catch(() => null);
      if (!response || response.status === 404) {
        return [];
      }
      const payload: any = await response.json();
      return Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
    };

    // Step 1: Fetch first page to get total count and display initial results quickly
    const firstUrl = `${INSPIRE_API_BASE}/literature?q=${query}&size=${CITED_BY_PAGE_SIZE}&page=1${sortParam}${fieldsParam}`;
    const firstResponse = await fetch(firstUrl, signal ? { signal } : undefined).catch(() => null);
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
    const fieldsParam = "&fields=control_number,titles.title,authors.full_name,authors.ids,publication_info,earliest_date,dois,arxiv_eprints,citation_count";

    // Helper to fetch a single page
    const fetchPage = async (pageNum: number, pageSize: number): Promise<any[]> => {
      const url = `${INSPIRE_API_BASE}/literature?q=${query}&size=${pageSize}&page=${pageNum}${sortParam}${fieldsParam}`;
      const response = await fetch(url, signal ? { signal } : undefined).catch(() => null);
      if (!response || response.status === 404) {
        return [];
      }
      const payload: any = await response.json();
      return Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
    };

    // Step 1: Fetch first page to get total count and display initial results quickly
    const firstUrl = `${INSPIRE_API_BASE}/literature?q=${query}&size=${CITED_BY_PAGE_SIZE}&page=1${sortParam}${fieldsParam}`;
    const firstResponse = await fetch(firstUrl, signal ? { signal } : undefined).catch(() => null);
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

    const chunk_size = 100;
    const recidMap = new Map<string, number>();

    for (let i = 0; i < recids.length; i += chunk_size) {
      if (signal?.aborted) {
        return;
      }
      const chunk = recids.slice(i, i + chunk_size);
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
    const recidToEntry = new Map<string, InspireReferenceEntry[]>();

    // Group entries by recid (some might have the same recid)
    for (const entry of needsDetails) {
      const existing = recidToEntry.get(entry.recid!) || [];
      existing.push(entry);
      recidToEntry.set(entry.recid!, existing);
    }

    const uniqueRecids = Array.from(recidToEntry.keys());

    for (let i = 0; i < uniqueRecids.length; i += BATCH_SIZE) {
      if (signal?.aborted) return;

      const batchRecids = uniqueRecids.slice(i, i + BATCH_SIZE);
      const query = batchRecids.map(r => `recid:${r}`).join(" OR ");
      const fieldsParam = "&fields=control_number,citation_count,titles.title,authors.full_name,author_count,publication_info,earliest_date,arxiv_eprints";
      const url = `${INSPIRE_API_BASE}/literature?q=${encodeURIComponent(query)}&size=${batchRecids.length}${fieldsParam}`;

      try {
        const response = await fetch(url, signal ? { signal } : undefined).catch(() => null);
        if (!response || response.status !== 200) continue;

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
          Zotero.debug(`[${config.addonName}] Error fetching citation counts: ${err}`);
        }
      }
    }
  }

  /**
   * Update the citation count display for a single row.
   */
  private updateRowCitationCount(entry: InspireReferenceEntry) {
    const row = this.rowCache.get(entry.id);
    if (!row) return;

    const statsButton = row.querySelector(".zinspire-ref-entry__stats-button") as HTMLButtonElement | null;
    const statsDiv = row.querySelector(".zinspire-ref-entry__stats:not(.zinspire-ref-entry__stats-button)") as HTMLDivElement | null;

    if (typeof entry.citationCount === "number") {
      const label = getString("references-panel-citation-count", {
        args: { count: entry.citationCount },
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

  private updateRowMetadata(entry: InspireReferenceEntry) {
    const row = this.rowCache.get(entry.id);
    if (!row) return;

    // Get cached strings for performance
    const s = getCachedStrings();

    // Rebuild the title container with proper author and title links
    const titleContainer = row.querySelector(
      ".zinspire-ref-entry__title",
    ) as HTMLDivElement | null;
    if (titleContainer) {
      // Clear and rebuild the container
      titleContainer.textContent = "";

      // Add label if present
      if (entry.label) {
        const labelSpan = titleContainer.ownerDocument.createElement("span");
        labelSpan.textContent = `[${entry.label}] `;
        titleContainer.appendChild(labelSpan);
      }

      // Rebuild author links
      this.appendAuthorLinks(titleContainer, entry);

      // Add year if needed
      const normalizedYear =
        entry.year && entry.year !== s.yearUnknown ? entry.year : "";
      const summaryContainsYear =
        normalizedYear &&
        entry.summary &&
        entry.summary.includes(`(${normalizedYear})`);
      if (normalizedYear && !summaryContainsYear) {
        const yearSpan = titleContainer.ownerDocument.createElement("span");
        yearSpan.textContent = ` (${normalizedYear})`;
        titleContainer.appendChild(yearSpan);
      }

      // Add separator and title link
      const separatorSpan = titleContainer.ownerDocument.createElement("span");
      separatorSpan.textContent = ": ";
      titleContainer.appendChild(separatorSpan);

      const titleLink = titleContainer.ownerDocument.createElement("a");
      titleLink.classList.add("zinspire-ref-entry__title-link");
      titleLink.textContent = entry.title + ";";
      titleLink.href = entry.inspireUrl || entry.fallbackUrl || "#";
      titleLink.addEventListener("click", (event) => {
        event.preventDefault();
        this.handleTitleClick(entry);
      });
      titleLink.addEventListener("mouseenter", (event) => {
        this.scheduleAbstractTooltip(entry, event);
      });
      titleLink.addEventListener("mouseleave", (event) => {
        this.handleTitleMouseLeave(event);
      });
      titleLink.addEventListener("mousemove", (event) => {
        this.updateTooltipPosition(event);
      });
      titleContainer.appendChild(titleLink);
    }

    const meta = row.querySelector(
      ".zinspire-ref-entry__meta",
    ) as HTMLDivElement | null;
    if (meta) {
      if (entry.summary) {
        meta.textContent = entry.summary;
        meta.hidden = false;
      } else {
        meta.hidden = true;
      }
    }
    const stats = row.querySelector(
      ".zinspire-ref-entry__stats",
    ) as HTMLDivElement | null;
    if (stats) {
      if (typeof entry.citationCount === "number") {
        stats.textContent = getString("references-panel-citation-count", {
          args: { count: entry.citationCount },
        });
        stats.hidden = false;
      } else {
        stats.hidden = true;
      }
    } else if (typeof entry.citationCount === "number") {
      const content = row.querySelector(
        ".zinspire-ref-entry__content",
      ) as HTMLDivElement | null;
      if (content) {
        const statsEl = content.ownerDocument.createElement("div");
        statsEl.classList.add("zinspire-ref-entry__stats");
        statsEl.textContent = getString("references-panel-citation-count", {
          args: { count: entry.citationCount },
        });
        content.appendChild(statsEl);
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
    entry.searchText = buildEntrySearchText(entry);
    if (typeof meta.citation_count === "number") {
      entry.citationCount = meta.citation_count;
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

    // Year update
    if (
      (!entry.year || entry.year === strings.yearUnknown) &&
      metadata.earliest_date
    ) {
      entry.year = `${metadata.earliest_date}`.slice(0, 4);
    }

    // Publication summary update
    const { primary: publicationInfo, errata } = splitPublicationInfo(
      metadata.publication_info,
    );
    if (publicationInfo || errata?.length) {
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
    entry.searchText = buildEntrySearchText(entry);
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
      publicationInfo,
      publicationInfoErrata: errata,
      arxivDetails,
    };
    entry.displayText = buildDisplayText(entry);
    entry.searchText = buildEntrySearchText(entry);
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
      publicationInfo,
      publicationInfoErrata: errata,
      arxivDetails: arxiv,
    };
    entry.displayText = buildDisplayText(entry);
    entry.searchText = buildEntrySearchText(entry);
    return entry;
  }

  private renderReferenceList(options: { preserveScroll?: boolean; resetPagination?: boolean } = {}) {
    const { preserveScroll = false, resetPagination = true } = options;
    const previousScrollTop = preserveScroll ? this.listEl.scrollTop : 0;
    const previousScrollLeft = preserveScroll ? this.listEl.scrollLeft : 0;
    const restoreScroll = () => {
      if (preserveScroll) {
        this.listEl.scrollTop = previousScrollTop;
        this.listEl.scrollLeft = previousScrollLeft;
      } else {
        this.listEl.scrollTop = 0;
        this.listEl.scrollLeft = 0;
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

    this.listEl.textContent = "";
    this.rowCache.clear();
    this.loadMoreButton = undefined;

    if (!this.allEntries.length) {
      this.renderMessage(this.getEmptyMessageForMode(this.viewMode));
      restoreScroll();
      return;
    }

    const filterGroups = parseFilterTokens(this.filterText)
      .map(({ text, quoted }) =>
        buildFilterTokenVariants(text, { ignoreSpaceDot: quoted }),
      )
      .filter((variants) => variants.length);
    const filtered = filterGroups.length
      ? this.allEntries.filter((entry) =>
        filterGroups.every((variants) =>
          variants.some((token) => entry.searchText.includes(token)),
        ),
      )
      : this.allEntries;

    if (!filtered.length) {
      this.renderMessage(getString("references-panel-no-match"));
    } else {
      // Enable pagination for ALL modes when there are many entries
      // This improves perceived performance for references with 100+ entries
      // However, when filtering, show all matching results for better UX
      // (filtered results are usually smaller and users expect to see all matches)
      const hasFilter = filterGroups.length > 0;
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

      // Add "Load More" button if there are more entries
      if (usePagination && filtered.length > this.renderedCount) {
        this.renderLoadMoreButton(filtered);
      }
    }

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
   * Render "Load More" button for paginated lists.
   * Clicking it renders the next batch of entries.
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
      this.loadMoreEntries(allFiltered);
    });

    container.appendChild(button);
    this.listEl.appendChild(container);
    this.loadMoreButton = button;
  }

  /**
   * Load more entries (next page) into the list.
   */
  private loadMoreEntries(allFiltered: InspireReferenceEntry[]) {
    // Remove load more button
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

    // Add new "Load More" button if there are still more entries
    if (allFiltered.length > this.renderedCount) {
      this.renderLoadMoreButton(allFiltered);
    }
  }

  private getCacheForMode(mode: InspireViewMode) {
    if (mode === "references") {
      return this.referencesCache;
    }
    if (mode === "citedBy") {
      return this.citedByCache;
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
      if (mode !== "entryCited") {
        return;
      }
    }
    if (mode === "entryCited" && this.viewMode !== "entryCited") {
      if (this.viewMode === "references" || this.viewMode === "citedBy") {
        this.entryCitedPreviousMode = this.viewMode;
      }
    }
    this.viewMode = mode;
    this.updateTabSelection();
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
        this.renderMessage(getString("references-panel-status-error"));
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
          : this.entryCitedSort;
    this.sortSelect.value = currentValue;
    const hasTarget =
      this.viewMode === "entryCited"
        ? Boolean(this.entryCitedSource?.recid || this.entryCitedSource?.authorQuery)
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

  private getSortOptionForMode(mode: InspireViewMode) {
    if (mode === "references") {
      return this.referenceSort;
    }
    if (mode === "citedBy") {
      return this.citedBySort;
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
      sorted.sort(
        (a, b) =>
          (b.citationCount ?? Number.NEGATIVE_INFINITY) -
          (a.citationCount ?? Number.NEGATIVE_INFINITY),
      );
    }
    return sorted;
  }

  private createReferenceRow(entry: InspireReferenceEntry) {
    const doc = this.listEl.ownerDocument;
    const strings = getCachedStrings();
    const row = doc.createElement("div");
    row.classList.add("zinspire-ref-entry");

    const marker = doc.createElement("span");
    marker.classList.add("zinspire-ref-entry__dot");
    // Use filled circle for local items, circled plus for missing (click to add)
    marker.textContent = entry.localItemID ? "●" : "⊕";
    marker.dataset.state = entry.localItemID ? "local" : "missing";
    applyRefEntryMarkerStyle(marker);
    applyRefEntryMarkerColor(marker, Boolean(entry.localItemID));
    marker.setAttribute(
      "title",
      entry.localItemID ? strings.dotLocal : strings.dotAdd,
    );
    marker.classList.add("is-clickable");
    marker.style.cursor = "pointer";
    marker.addEventListener("click", (event) => {
      event.preventDefault();
      const target = (event.target as HTMLElement).closest(
        ".zinspire-ref-entry__dot",
      ) as HTMLElement | null;
      this.handleMarkerClick(entry, target ?? undefined).catch(() => void 0);
    });

    const linkButton = doc.createElement("button");
    linkButton.classList.add("zinspire-ref-entry__link");
    applyRefEntryLinkButtonStyle(linkButton);
    linkButton.setAttribute(
      "title",
      entry.isRelated ? strings.linkExisting : strings.linkMissing,
    );
    this.renderLinkButton(linkButton, Boolean(entry.isRelated));
    linkButton.addEventListener("click", (event) => {
      event.preventDefault();
      this.handleLinkAction(entry, linkButton).catch((err) => {
        if ((err as any)?.name !== "AbortError") {
          Zotero.debug(
            `[${config.addonName}] Unable to link reference: ${err}`,
          );
        }
      });
    });

    const content = doc.createElement("div");
    content.classList.add("zinspire-ref-entry__content");
    applyRefEntryContentStyle(content);

    // Build structured entry text with clickable author names
    const entryTextContainer = doc.createElement("div");
    entryTextContainer.classList.add("zinspire-ref-entry__title");

    // Add label if present
    if (entry.label) {
      const labelSpan = doc.createElement("span");
      labelSpan.textContent = `[${entry.label}] `;
      entryTextContainer.appendChild(labelSpan);
    }

    // Create clickable author links (pass cached strings for performance)
    this.appendAuthorLinks(entryTextContainer, entry, strings);

    // Add year if needed
    const normalizedYear =
      entry.year && entry.year !== strings.yearUnknown ? entry.year : "";
    const summaryContainsYear =
      normalizedYear &&
      entry.summary &&
      entry.summary.includes(`(${normalizedYear})`);
    if (normalizedYear && !summaryContainsYear) {
      const yearSpan = doc.createElement("span");
      yearSpan.textContent = ` (${normalizedYear})`;
      entryTextContainer.appendChild(yearSpan);
    }

    // Add separator and title link
    const separatorSpan = doc.createElement("span");
    separatorSpan.textContent = ": ";
    entryTextContainer.appendChild(separatorSpan);

    const titleLink = doc.createElement("a");
    titleLink.classList.add("zinspire-ref-entry__title-link");
    titleLink.textContent = entry.title + ";";
    titleLink.href = entry.inspireUrl || entry.fallbackUrl || "#";
    titleLink.addEventListener("click", (event) => {
      event.preventDefault();
      this.handleTitleClick(entry);
    });
    // Add hover events for abstract tooltip
    titleLink.addEventListener("mouseenter", (event) => {
      this.scheduleAbstractTooltip(entry, event);
    });
    titleLink.addEventListener("mouseleave", (event) => {
      this.handleTitleMouseLeave(event);
    });
    titleLink.addEventListener("mousemove", (event) => {
      this.updateTooltipPosition(event);
    });
    entryTextContainer.appendChild(titleLink);

    content.appendChild(entryTextContainer);
    if (entry.summary) {
      const meta = doc.createElement("div");
      meta.classList.add("zinspire-ref-entry__meta");
      meta.textContent = entry.summary;
      content.appendChild(meta);
    }
    // Show citation count button only if:
    // 1. Entry has recid (so we can navigate to citing records), AND
    // 2. Either citation count is known, OR we're in citedBy/entryCited mode (not references)
    const hasCitationCount = typeof entry.citationCount === "number";
    const isReferencesMode = this.viewMode === "references";
    const canShowEntryCitedTab = Boolean(entry.recid) && (hasCitationCount || !isReferencesMode);

    if (canShowEntryCitedTab) {
      const statsButton = doc.createElement("button");
      statsButton.type = "button";
      statsButton.classList.add(
        "zinspire-ref-entry__stats",
        "zinspire-ref-entry__stats-button",
      );
      // Citation count with args still needs getString, but could be optimized if needed
      const label = hasCitationCount
        ? getString("references-panel-citation-count", {
          args: { count: entry.citationCount },
        })
        : strings.citationUnknown;
      statsButton.textContent = label;
      statsButton.addEventListener("click", (event) => {
        event.preventDefault();
        this.showEntryCitedTab(entry).catch(() => void 0);
      });
      content.appendChild(statsButton);
    } else if (hasCitationCount) {
      const stats = doc.createElement("div");
      stats.classList.add("zinspire-ref-entry__stats");
      stats.textContent = getString("references-panel-citation-count", {
        args: { count: entry.citationCount },
      });
      content.appendChild(stats);
    }

    // BibTeX copy button - only show if recid is available
    const bibtexButton = doc.createElement("button");
    bibtexButton.type = "button";
    bibtexButton.classList.add("zinspire-ref-entry__bibtex");
    applyBibTeXButtonStyle(bibtexButton);
    bibtexButton.textContent = "📋";
    bibtexButton.setAttribute("title", strings.copyBibtex);
    if (entry.recid) {
      bibtexButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this.handleBibTeXCopy(entry, bibtexButton);
      });
      bibtexButton.addEventListener("mouseenter", () => {
        bibtexButton.style.opacity = "1";
      });
      bibtexButton.addEventListener("mouseleave", () => {
        bibtexButton.style.opacity = "0.7";
      });
    } else {
      bibtexButton.disabled = true;
      bibtexButton.style.opacity = "0.3";
      bibtexButton.style.cursor = "not-allowed";
    }

    const textContainer = doc.createElement("div");
    textContainer.classList.add("zinspire-ref-entry__text");
    applyRefEntryTextContainerStyle(textContainer);
    textContainer.append(marker, linkButton, bibtexButton, content);
    row.appendChild(textContainer);
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
    type AuthorDisplay = {
      formatted: string;        // Display name (e.g., "J. Smith")
      searchInfo: AuthorSearchInfo;  // Search info with fullName and optional recid
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
      const { formatted, searchInfo } = authorsToShow[i];
      const authorLink = doc.createElement("a");
      authorLink.classList.add("zinspire-ref-entry__author-link");
      authorLink.textContent = formatted;
      authorLink.href = "#";
      // Show BAI in tooltip if available (most reliable identifier)
      const idHint = searchInfo.bai ? ` (${searchInfo.bai})` : "";
      authorLink.title = getString("references-panel-author-click-hint", {
        args: { author: searchInfo.fullName },
      }) + idHint;
      authorLink.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        // Pass full search info for precise author search
        this.showAuthorPapersTab(searchInfo).catch(() => void 0);
      });
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
      entry.searchText = buildEntrySearchText(entry);
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
    if (previousMode === "references" || previousMode === "citedBy") {
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
    if (previousMode === "references" || previousMode === "citedBy") {
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
      this.entryCitedPreviousMode === "citedBy" ? "citedBy" : "references";
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
      entry.searchText = buildEntrySearchText(entry);
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
    this.listEl.textContent = "";
    const empty = this.listEl.ownerDocument.createElement("div");
    empty.classList.add("zinspire-ref-panel__empty");
    empty.textContent = message;
    this.listEl.appendChild(empty);
    this.setStatus(message);
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
      this.abstractAbort = new AbortController();
      try {
        const abstract = await fetchInspireAbstract(
          entry.recid,
          this.abstractAbort.signal,
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

class ReaderTabHelper {
  // Get Zotero_Tabs dynamically to avoid initialization timing issues
  private static get tabs() {
    return typeof Zotero_Tabs !== "undefined" ? Zotero_Tabs : undefined;
  }

  // Get Zotero.Reader dynamically
  private static get readerAPI() {
    return (Zotero?.Reader as any) ?? undefined;
  }

  static selectTab(tabID: string) {
    const tabs = this.tabs;
    if (tabs && typeof tabs.select === "function") {
      try {
        tabs.select(tabID);
      } catch (err) {
        Zotero.debug(
          `[${config.addonName}] Failed to select reader tab ${tabID}: ${err}`,
        );
      }
    }
  }

  static focusReader(reader?: _ZoteroTypes.ReaderInstance) {
    if (!reader) {
      return;
    }
    const win = (reader as any)?._window as Window | undefined;
    try {
      reader.focus?.();
      win?.focus?.();
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to focus reader ${reader.tabID}: ${err}`,
      );
    }
  }

  static getReaderByTabID(tabID: string) {
    return this.readerAPI?.getByTabID?.(tabID) as _ZoteroTypes.ReaderInstance | undefined;
  }

  static getReaderByItemID(itemID?: number) {
    if (!itemID || !this.readerAPI?._readers) {
      return undefined;
    }
    const readers = this.readerAPI._readers as _ZoteroTypes.ReaderInstance[];
    return readers.find((reader) => reader.itemID === itemID);
  }

  static getSelectedTabID() {
    return this.tabs?.selectedID;
  }

  static getSelectedTabType(): "library" | "reader" | "other" {
    const type = this.tabs?.selectedType;
    if (type === "library") return "library";
    if (type === "reader") return "reader";
    return "other";
  }

  /**
   * Find reader tab ID by looking at parent item's attachments.
   * Reader tabs are opened for attachment items, not parent items.
   */
  static getReaderTabIDForParentItem(parentItemID?: number): string | undefined {
    if (!parentItemID) {
      return undefined;
    }
    try {
      const parentItem = Zotero.Items.get(parentItemID);
      if (!parentItem) {
        return undefined;
      }
      // Get all attachment IDs for this parent item
      const attachmentIDs = parentItem.getAttachments?.() || [];
      for (const attachmentID of attachmentIDs) {
        // Check if there's a reader tab for this attachment
        const tabID = this.tabs?.getTabIDByItemID?.(attachmentID);
        if (tabID) {
          return tabID;
        }
        // Also check via reader API
        const reader = this.getReaderByItemID(attachmentID);
        if (reader?.tabID) {
          return reader.tabID;
        }
      }
    } catch (err) {
      Zotero.debug(
        `[${config.addonName}] Failed to find reader tab for parent item ${parentItemID}: ${err}`,
      );
    }
    return undefined;
  }
}

function deriveRecidFromItem(item: Zotero.Item) {
  const archiveLocation = (
    item.getField("archiveLocation") as string | undefined
  )?.trim();
  if (archiveLocation && /^\d+$/.test(archiveLocation)) {
    return archiveLocation;
  }
  const url = item.getField("url") as string | undefined;
  const recidFromUrl = extractRecidFromUrl(url);
  if (recidFromUrl) {
    return recidFromUrl;
  }
  const extra = item.getField("extra") as string | undefined;
  if (extra) {
    const match = extra.match(/inspirehep\.net\/(?:record|literature)\/(\d+)/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function extractRecidFromRecordRef(ref?: string) {
  if (!ref) {
    return null;
  }
  const match = ref.match(/\/(\d+)(?:\?.*)?$/);
  return match ? match[1] : null;
}

function extractRecidFromUrls(urls?: Array<{ value: string }>) {
  if (!Array.isArray(urls)) {
    return null;
  }
  for (const entry of urls) {
    const candidate = extractRecidFromUrl(entry?.value);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function extractRecidFromUrl(url?: string | null) {
  if (!url) {
    return null;
  }
  const match = url.match(/(?:literature|record)\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract author names from a reference object with a limit for performance.
 * Falls back to collaboration names if no authors found.
 * For large collaborations (>50 authors), only extract first author.
 * Returns both author names and total count for "et al." logic.
 */
function extractAuthorNamesFromReference(
  reference: any,
  limit: number,
): { names: string[]; total: number } {
  if (Array.isArray(reference?.authors) && reference.authors.length) {
    const totalAuthors = reference.authors.length;
    // For large collaborations, only extract first author
    const effectiveLimit = totalAuthors > LARGE_COLLABORATION_THRESHOLD ? 1 : limit;
    const result: string[] = [];
    const maxToProcess = Math.min(totalAuthors, effectiveLimit);
    for (let i = 0; i < maxToProcess; i++) {
      const author = reference.authors[i];
      let name: string | null = null;
      if (author?.full_name) {
        name = author.full_name;
      } else if (author?.name) {
        name = author.name;
      } else if (author?.last_name || author?.first_name) {
        const first = author.first_name ?? "";
        const last = author.last_name ?? "";
        name = `${last}, ${first}`.replace(/^, |, $/, "").trim();
      }
      if (name) {
        result.push(name);
      }
    }
    if (result.length) {
      return { names: result, total: totalAuthors };
    }
  }
  if (
    Array.isArray(reference?.collaborations) &&
    reference.collaborations.length
  ) {
    const maxCollabs = Math.min(reference.collaborations.length, limit);
    const names = reference.collaborations.slice(0, maxCollabs).filter(Boolean);
    return { names, total: reference.collaborations.length };
  }
  return { names: [], total: 0 };
}

/**
 * Extract last name from author full name for INSPIRE search.
 * Handles both "Last, First" and "First Last" formats.
 * Returns the last name portion for `author:LastName` query.
 */
/**
 * Extract author names from INSPIRE authors array with a limit.
 * This avoids performance issues with large collaborations (thousands of authors).
 */
const AUTHOR_IDS_EXTRACT_LIMIT = 10; // Support up to 10 displayed authors

// ─────────────────────────────────────────────────────────────────────────────
// Cached locale strings for rendering performance
// getString() calls formatMessagesSync() every time, which is slow.
// For static strings used repeatedly in lists, we cache them here.
// ─────────────────────────────────────────────────────────────────────────────
let _cachedStrings: Record<string, string> | null = null;

function getCachedStrings(): Record<string, string> {
  if (!_cachedStrings) {
    _cachedStrings = {
      // Entry row strings (used in createReferenceRow, updateRowMetadata)
      dotLocal: getString("references-panel-dot-local"),
      dotAdd: getString("references-panel-dot-add"),
      linkExisting: getString("references-panel-link-existing"),
      linkMissing: getString("references-panel-link-missing"),
      yearUnknown: getString("references-panel-year-unknown"),
      citationUnknown: getString("references-panel-citation-count-unknown"),
      unknownAuthor: getString("references-panel-unknown-author"),
      copyBibtex: getString("references-panel-copy-bibtex"),
      noTitle: getString("references-panel-no-title"),
      // Abstract tooltip strings
      noAbstract: getString("references-panel-no-abstract"),
      loadingAbstract: getString("references-panel-loading-abstract"),
      // Status messages (used in status bar updates)
      statusLoading: getString("references-panel-status-loading"),
      statusLoadingCited: getString("references-panel-status-loading-cited"),
      statusLoadingAuthor: getString("references-panel-status-loading-author"),
      statusLoadingEntry: getString("references-panel-status-loading-entry"),
      statusError: getString("references-panel-status-error"),
      statusEmpty: getString("references-panel-status-empty"),
      // Empty list messages
      emptyList: getString("references-panel-empty-list"),
      emptyCited: getString("references-panel-empty-cited"),
      authorEmpty: getString("references-panel-author-empty"),
      entryEmpty: getString("references-panel-entry-empty"),
      noMatch: getString("references-panel-no-match"),
      // Tab labels
      tabReferences: getString("references-panel-tab-references"),
      tabCited: getString("references-panel-tab-cited"),
      tabAuthorPapers: getString("references-panel-tab-author-papers"),
      tabEntryCited: getString("references-panel-tab-entry-cited"),
      // Sort options
      sortDefault: getString("references-panel-sort-default"),
      sortMostrecent: getString("references-panel-sort-mostrecent"),
      sortMostcited: getString("references-panel-sort-mostcited"),
      // Navigation
      entryLabelDefault: getString("references-panel-entry-label-default"),
      selectItem: getString("references-panel-select-item"),
      noRecid: getString("references-panel-no-recid"),
      readerMode: getString("references-panel-reader-mode"),
      entrySelect: getString("references-panel-entry-select"),
      // Batch BibTeX copy
      bibtexFetching: getString("references-panel-bibtex-fetching"),
      bibtexAllFailed: getString("references-panel-bibtex-all-failed"),
      noRecidEntries: getString("references-panel-no-recid-entries"),
    };
  }
  return _cachedStrings;
}

/**
 * Clear cached strings (useful if locale changes at runtime).
 */
function clearCachedStrings() {
  _cachedStrings = null;
}

/**
 * Extract author names with limit, handling large collaborations.
 * For large collaborations (>50 authors), only extract first author.
 * Returns both author names and total count for "et al." logic.
 */
function extractAuthorNamesLimited(
  authors: any[] | undefined,
  limit: number,
): { names: string[]; total: number } {
  if (!Array.isArray(authors) || !authors.length) {
    return { names: [], total: 0 };
  }
  const totalAuthors = authors.length;
  // For large collaborations, only extract first author
  const effectiveLimit = totalAuthors > LARGE_COLLABORATION_THRESHOLD ? 1 : limit;
  const result: string[] = [];
  const maxToProcess = Math.min(totalAuthors, effectiveLimit);
  for (let i = 0; i < maxToProcess; i++) {
    const name = authors[i]?.full_name || authors[i]?.full_name_unicode_normalized;
    if (name) {
      result.push(name);
    }
  }
  return { names: result, total: totalAuthors };
}

/**
 * Validate INSPIRE BAI format.
 * Valid BAI examples: "Feng.Kun.Guo.1", "E.Witten.1", "R.L.Jaffe.1"
 * BAI must contain at least one letter segment and end with a number.
 */
function isValidBAI(bai: string): boolean {
  if (!bai || typeof bai !== "string") {
    return false;
  }
  // BAI format: Name.Parts.Separated.By.Dots.Number
  // Must have at least 2 parts (name + number), and last part must be a number
  const parts = bai.split(".");
  if (parts.length < 2) {
    return false;
  }
  // Last part should be a number (disambiguation number)
  const lastPart = parts[parts.length - 1];
  if (!/^\d+$/.test(lastPart)) {
    return false;
  }
  // At least one name part should contain letters
  const nameParts = parts.slice(0, -1);
  const hasLetterPart = nameParts.some((part) => /[A-Za-z]/.test(part));
  if (!hasLetterPart) {
    return false;
  }
  return true;
}

/**
 * Extract author search info (fullName + BAI/recid) from INSPIRE authors array.
 * BAI (INSPIRE Author ID) like "Feng.Kun.Guo.1" is the most reliable for precise search.
 * For large collaborations (>50 authors), only extract first author's info.
 * See: https://github.com/inspirehep/rest-api-doc
 */
function extractAuthorSearchInfos(
  authors: any[] | undefined,
  limit: number,
): AuthorSearchInfo[] | undefined {
  if (!Array.isArray(authors) || !authors.length) {
    return undefined;
  }
  // For large collaborations, only extract first author's search info
  const effectiveLimit = authors.length > LARGE_COLLABORATION_THRESHOLD ? 1 : limit;
  const result: AuthorSearchInfo[] = [];
  const maxToProcess = Math.min(authors.length, effectiveLimit);
  for (let i = 0; i < maxToProcess; i++) {
    const author = authors[i];
    const fullName = author?.full_name || author?.full_name_unicode_normalized;
    if (!fullName) {
      continue;
    }

    // Extract BAI from ids array (most reliable for author search)
    // Validate BAI format to avoid false positives
    let bai: string | undefined;
    if (Array.isArray(author.ids)) {
      for (const id of author.ids) {
        if (id?.schema === "INSPIRE BAI" && id?.value && isValidBAI(id.value)) {
          bai = id.value;
          break;
        }
      }
    }

    // Extract recid for display purposes (not used for search anymore)
    let recid: string | undefined;
    if (author.recid) {
      recid = String(author.recid);
    } else if (author.record?.$ref) {
      const match = author.record.$ref.match(/\/authors\/(\d+)$/);
      if (match) {
        recid = match[1];
      }
    }

    result.push({ fullName, bai, recid });
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Normalize consecutive initials like "R.L." to "R. L." for proper parsing.
 * This handles cases where initials are written without spaces between them.
 * Examples:
 *   "R.L." → "R. L."
 *   "R.L.K." → "R. L. K."
 *   "R.L. Jaffe" → "R. L. Jaffe"
 */
function normalizeInitials(name: string): string {
  if (!name) {
    return name;
  }
  // Pattern: uppercase letter followed by dot and another uppercase letter
  // Insert space after dot when followed by another initial (uppercase letter + optional dot)
  // "R.L." → "R. L.", "R.L.K." → "R. L. K."
  return name.replace(/([A-Z])\.([A-Z])/g, "$1. $2");
}

/**
 * Convert full name to INSPIRE search query format.
 * "Guo, Feng-Kun" → "f k guo" (initials of first name + last name, all lowercase)
 * "Edward Witten" → "e witten"
 * "R.L. Jaffe" → "r l jaffe"
 *
 * INSPIRE author search uses this format for name-based queries.
 */
function convertFullNameToSearchQuery(fullName: string): string {
  if (!fullName?.trim()) {
    return "";
  }
  const trimmed = fullName.trim();
  let lastName = "";
  let firstName = "";

  // Handle "Last, First" format (common in bibliographic data)
  if (trimmed.includes(",")) {
    const [lastPart, firstPart] = trimmed.split(",", 2);
    lastName = (lastPart || "").trim();
    firstName = (firstPart || "").trim();
  } else {
    // Handle "First Last" format
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].toLowerCase();
    }
    // Last word is last name, everything before is first name(s)
    lastName = parts[parts.length - 1];
    firstName = parts.slice(0, -1).join(" ");
  }

  if (!lastName) {
    return "";
  }

  // Normalize consecutive initials: "R.L." → "R. L."
  const normalizedFirstName = normalizeInitials(firstName);

  // Convert first name to initials: "Feng-Kun" → "f k", "Edward" → "e", "R. L." → "r l"
  // Split by space, hyphen, or dot (for initials like "R.L.")
  const initials = normalizedFirstName
    .split(/[\s\-.]+/)  // Split by space, hyphen, or dot
    .map((part) => part.charAt(0)?.toLowerCase())
    .filter(Boolean)
    .join(" ");

  // Format: "initials lastname" (all lowercase)
  if (initials) {
    return `${initials} ${lastName.toLowerCase()}`;
  }
  return lastName.toLowerCase();
}

function splitPublicationInfo(
  raw?: any | any[],
): { primary?: any; errata?: Array<{ info: any; label: string }> } {
  if (!raw) {
    return {};
  }
  const list = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  if (!list.length) {
    return {};
  }
  let primary = list.find((info) => !getPublicationNoteLabel(info));
  if (!primary) {
    primary = list[0];
  }
  const errata = list
    .filter((info) => info && info !== primary)
    .map((info) => {
      const label = getPublicationNoteLabel(info);
      return label ? { info, label } : undefined;
    })
    .filter((note): note is { info: any; label: string } => Boolean(note));
  return {
    primary,
    errata: errata.length ? errata : undefined,
  };
}

function getPublicationNoteLabel(info: any): string | undefined {
  if (!info || typeof info !== "object") {
    return undefined;
  }
  const collectValues = (value: any): string[] => {
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap(collectValues);
    }
    return [];
  };
  const values: string[] = [];
  if (info.material !== undefined) values.push(...collectValues(info.material));
  if (info.note !== undefined) values.push(...collectValues(info.note));
  if (info.pubinfo_freetext !== undefined) {
    values.push(...collectValues(info.pubinfo_freetext));
  }
  if (info.additional_info !== undefined) {
    values.push(...collectValues(info.additional_info));
  }
  const labelRegexes: Array<{ regex: RegExp; label: string }> = [
    { regex: /erratum/i, label: "Erratum" },
    { regex: /addendum/i, label: "Addendum" },
  ];
  for (const value of values) {
    for (const { regex, label } of labelRegexes) {
      if (regex.test(value)) {
        return label;
      }
    }
  }
  return undefined;
}

function buildPublicationSummary(
  info?: any,
  arxiv?: InspireArxivDetails | string | null,
  fallbackYear?: string,
  errata?: any[],
) {
  const mainSummary = formatPublicationInfo(info, fallbackYear);
  const arxivTag = formatArxivTag(arxiv);
  // const baseSummary = mainSummary || arxivTag;
  // Show both journal informaion and arXiv information when both are available
  const baseSummary = [mainSummary, arxivTag].filter(Boolean).join(" ");

  const errataSummaries = (errata ?? [])
    .map((entry) => {
      const text = formatPublicationInfo(entry.info, fallbackYear, {
        omitJournal: true,
      });
      return text ? `${entry.label}: ${text}` : null;
    })
    .filter((text): text is string => Boolean(text));

  if (errataSummaries.length) {
    const errataText = `[${errataSummaries.join("; ")}]`;
    return baseSummary ? `${baseSummary} ${errataText}` : errataText;
  }

  return baseSummary;
}

function formatPublicationInfo(
  info?: any,
  fallbackYear?: string,
  options?: { omitJournal?: boolean },
) {
  if (!info) {
    return "";
  }
  const parts: string[] = [];
  const journal = options?.omitJournal
    ? ""
    : info.journal_title || info.journal_title_abbrev || "";
  const volume = info.journal_volume || info.volume || "";
  const artid = info.artid || info.article_number || info.eprintid;
  const pageStart =
    info.page_start ||
    info.pagination ||
    (Array.isArray(info.pages) ? info.pages[0] : undefined);
  const pageEnd =
    info.page_end ||
    (Array.isArray(info.pages) ? info.pages[1] : undefined);
  if (journal) {
    parts.push(journal);
  }
  if (volume) {
    parts.push(volume);
  }
  const normalizedFallbackYear =
    fallbackYear && typeof fallbackYear === "string"
      ? fallbackYear.match(/\d{4}/)?.[0] ?? fallbackYear
      : undefined;
  const resolvedYear =
    info.year ??
    (info.date ? String(info.date).slice(0, 4) : undefined) ??
    normalizedFallbackYear;
  const yearPart = resolvedYear ? `(${resolvedYear})` : undefined;
  let yearInserted = false;
  const insertYearIfNeeded = () => {
    if (!yearInserted && yearPart) {
      parts.push(yearPart);
      yearInserted = true;
    }
  };
  if (artid) {
    insertYearIfNeeded();
    parts.push(artid);
  } else if (pageStart) {
    insertYearIfNeeded();
    const range =
      pageEnd && pageEnd !== pageStart ? `${pageStart}-${pageEnd}` : pageStart;
    parts.push(range);
  } else {
    insertYearIfNeeded();
  }
  if (!parts.length && info.publication_info) {
    const fallback = [
      options?.omitJournal ? undefined : info.publication_info.title,
      info.publication_info.volume,
      info.publication_info.year
        ? `(${info.publication_info.year})`
        : normalizedFallbackYear
          ? `(${normalizedFallbackYear})`
          : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    if (fallback) {
      parts.push(fallback);
    }
  }
  return parts.join(" ").trim();
}

function buildReferenceUrl(reference: any, recid?: string | null) {
  if (recid) {
    return `${INSPIRE_LITERATURE_URL}/${recid}`;
  }
  if (Array.isArray(reference?.urls) && reference.urls.length) {
    return reference.urls[0].value;
  }
  return buildFallbackUrl(reference);
}

function buildFallbackUrl(
  reference: any,
  arxiv?: InspireArxivDetails | string | null,
) {
  if (Array.isArray(reference?.dois) && reference.dois.length) {
    return `${DOI_ORG_URL}/${reference.dois[0]}`;
  }
  const explicit = formatArxivDetails(arxiv);
  if (explicit?.id) {
    return `${ARXIV_ABS_URL}/${explicit.id}`;
  }
  const derived = formatArxivDetails(reference?.arxiv_eprint);
  if (derived?.id) {
    return `${ARXIV_ABS_URL}/${derived.id}`;
  }
  return undefined;
}

function buildFallbackUrlFromMetadata(
  metadata: any,
  arxiv?: InspireArxivDetails | null,
) {
  if (!metadata) {
    return undefined;
  }
  if (Array.isArray(metadata?.dois) && metadata.dois.length) {
    const first = metadata.dois[0];
    const value =
      typeof first === "string" ? first : (first?.value as string | undefined);
    if (value) {
      return `${DOI_ORG_URL}/${value}`;
    }
  }
  const provided = formatArxivDetails(arxiv)?.id;
  if (provided) {
    return `${ARXIV_ABS_URL}/${provided}`;
  }
  const derived = extractArxivFromMetadata(metadata);
  if (derived?.id) {
    return `${ARXIV_ABS_URL}/${derived.id}`;
  }
  return undefined;
}

function extractArxivFromReference(
  reference: any,
): InspireArxivDetails | undefined {
  if (!reference) {
    return undefined;
  }
  const id = normalizeArxivID(reference?.arxiv_eprint);
  const categoriesRaw =
    reference?.arxiv_categories ??
    reference?.arxiv_category ??
    reference?.arxiv_subject;
  const categories = normalizeArxivCategories(categoriesRaw);
  if (!id && !categories.length) {
    return undefined;
  }
  return {
    id,
    categories,
  };
}

function extractArxivFromMetadata(
  metadata: any,
): InspireArxivDetails | undefined {
  if (!metadata) {
    return undefined;
  }
  if (Array.isArray(metadata?.arxiv_eprints) && metadata.arxiv_eprints.length) {
    const first = metadata.arxiv_eprints.find(
      (entry: any) => entry?.value || entry?.id,
    );
    if (!first) {
      return undefined;
    }
    const id = normalizeArxivID(
      typeof first === "string" ? first : (first?.value ?? first?.id),
    );
    const categories = normalizeArxivCategories(first?.categories);
    if (!id && !categories.length) {
      return undefined;
    }
    return { id, categories };
  }
  return undefined;
}

function formatArxivTag(
  raw?: InspireArxivDetails | string | null,
): string | undefined {
  const details = formatArxivDetails(raw);
  if (!details?.id) {
    return undefined;
  }
  return `[arXiv:${details.id}]`;
}

function formatArxivDetails(
  raw?: InspireArxivDetails | string | null,
): { id?: string; categories: string[] } | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw === "string") {
    const id = normalizeArxivID(raw);
    return id ? { id, categories: [] } : undefined;
  }
  const id = normalizeArxivID(raw.id);
  const categories = normalizeArxivCategories(raw.categories);
  if (!id && !categories.length) {
    return undefined;
  }
  return { id, categories };
}

function normalizeArxivID(raw?: string | null) {
  if (!raw || typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^arxiv\s*:/i, "").trim();
}

function normalizeArxivCategories(input?: any): string[] {
  if (!input) {
    return [];
  }
  const values = Array.isArray(input) ? input : [input];
  return values
    .map((value) =>
      typeof value === "string" ? value.trim() : undefined,
    )
    .filter((value): value is string => Boolean(value));
}

/**
 * Format author list for display.
 * - If totalAuthors > displayed authors, show "et al."
 * - If totalAuthors > 50 (large collaboration), show only first author + "et al."
 * - Convert "others" to "et al."
 */
function formatAuthors(authors: string[], totalAuthors?: number): string {
  if (!authors.length) {
    return getString("references-panel-unknown-author");
  }
  // Filter out "others" and convert to et al. indication
  const hasOthers = authors.some(
    (name) => name.toLowerCase() === "others",
  );
  const filteredAuthors = authors.filter(
    (name) => name.toLowerCase() !== "others",
  );
  const formatted = filteredAuthors
    .map((name) => formatAuthorName(name))
    .filter((name): name is string => Boolean(name));
  if (!formatted.length) {
    return getString("references-panel-unknown-author");
  }
  const maxAuthors = (getPref("max_authors") as number) || 3;
  const actualTotal = totalAuthors ?? authors.length;
  // For large collaborations, always show first author + et al.
  if (actualTotal > LARGE_COLLABORATION_THRESHOLD) {
    return `${formatted[0]} et al.`;
  }
  // If more authors than max, or more authors than displayed, show et al.
  if (formatted.length > maxAuthors || actualTotal > formatted.length || hasOthers) {
    const displayCount = Math.min(formatted.length, maxAuthors);
    return `${formatted.slice(0, displayCount).join(", ")} et al.`;
  }
  return formatted.join(", ");
}

const NON_PERSON_AUTHOR_PATTERN =
  /\b(collaboration|group|team|consortium|experiment)\b/i;
const FAMILY_NAME_PARTICLES = new Set([
  "da",
  "de",
  "del",
  "della",
  "der",
  "di",
  "dos",
  "du",
  "van",
  "von",
  "bin",
  "ibn",
  "al",
  "la",
  "le",
  "mac",
  "mc",
  "st",
  "st.",
  "saint",
]);

function formatAuthorName(rawName?: string) {
  if (!rawName) {
    return "";
  }
  const trimmed = rawName.trim();
  if (!trimmed) {
    return "";
  }
  if (NON_PERSON_AUTHOR_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const hasComma = trimmed.includes(",");
  let family = "";
  let given = "";
  if (hasComma) {
    const [familyPart, givenPart] = trimmed.split(",", 2);
    family = (familyPart || "").trim();
    given = (givenPart || "").trim();
  } else {
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      family = parts[0];
    } else {
      let index = parts.length - 1;
      const familyParts = [parts[index]];
      index -= 1;
      while (index >= 0) {
        const candidate = parts[index];
        const lower = candidate.toLowerCase();
        if (FAMILY_NAME_PARTICLES.has(lower)) {
          familyParts.unshift(candidate);
          index -= 1;
        } else {
          break;
        }
      }
      family = familyParts.join(" ");
      given = parts.slice(0, parts.length - familyParts.length).join(" ");
    }
  }
  if (!given) {
    return family || trimmed;
  }
  const initials = buildInitials(given);
  if (!initials) {
    return `${given} ${family}`.trim();
  }
  return `${initials} ${family}`.trim();
}

function buildInitials(given: string) {
  // Normalize consecutive initials: "R.L." → "R. L."
  const normalizedGiven = normalizeInitials(given);
  const words = normalizedGiven.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "";
  }
  const wordInitials = words
    .map((word) => {
      // Handle already-initialed words like "R." - just keep them
      if (/^[A-Z]\.$/.test(word)) {
        return word;
      }
      const segments = word.split(/-+/).filter(Boolean);
      if (!segments.length) {
        return "";
      }
      const segmentInitials = segments
        .map((segment) => segment.trim()[0])
        .filter((char): char is string => Boolean(char))
        .map((char) => `${char.toUpperCase()}.`);
      return segmentInitials.join("-");
    })
    .filter(Boolean);
  return wordInitials.join(" ");
}

function buildDisplayText(entry: InspireReferenceEntry) {
  const label = entry.label ? `[${entry.label}] ` : "";
  // Use cached string for performance (this function is called in loops)
  const yearUnknown = getCachedStrings().yearUnknown;
  const normalizedYear =
    entry.year && entry.year !== yearUnknown ? entry.year : "";
  const summaryContainsYear =
    normalizedYear &&
    entry.summary &&
    entry.summary.includes(`(${normalizedYear})`);
  const shouldShowYearInline = Boolean(normalizedYear && !summaryContainsYear);
  const yearPart = shouldShowYearInline ? ` (${normalizedYear})` : "";
  return `${label}${entry.authorText}${yearPart}: ${entry.title};`;
}

function extractJournalName(entry: InspireReferenceEntry): string | undefined {
  const info = entry.publicationInfo;
  if (info?.journal_title) {
    return info.journal_title;
  }
  if (info?.journal_title_abbrev) {
    return info.journal_title_abbrev;
  }
  if (entry.summary) {
    const match = entry.summary.match(/^([^0-9(]+?)(?:\s+\d+|\(|$)/);
    if (match) {
      const journal = match[1].trim();
      if (journal.length > 2) {
        return journal;
      }
    }
  }
  return undefined;
}

function buildEntrySearchText(entry: InspireReferenceEntry): string {
  const segments: string[] = [];
  const collapsedSegments: string[] = [];

  const addSegment = (text?: string) => {
    if (!text) {
      return;
    }
    segments.push(text);
    const collapsed = text.replace(SEARCH_COLLAPSE_REGEX, "");
    if (collapsed && collapsed !== text) {
      collapsedSegments.push(collapsed);
    }
  };

  addSegment(entry.displayText);
  addSegment(entry.summary);

  const journalName = extractJournalName(entry);
  if (journalName) {
    for (const abbr of getJournalAbbreviations(journalName)) {
      addSegment(abbr);
    }
  }

  const arxivDetails = formatArxivDetails(entry.arxivDetails);
  if (arxivDetails?.id) {
    const arxivTag = `[arXiv:${arxivDetails.id}]`;
    // Avoid duplicating the tag if it's already part of the summary text
    if (!entry.summary || !entry.summary.includes(arxivTag)) {
      addSegment(arxivTag);
    }
    if (!entry.summary || !entry.summary.includes(arxivDetails.id)) {
      addSegment(arxivDetails.id);
    }
  }

  const allSegments = collapsedSegments.length
    ? [...segments, ...collapsedSegments]
    : segments;
  return buildSearchIndexText(allSegments.join(" "));
}

async function findItemByRecid(recid: string) {
  const fieldID = Zotero.ItemFields.getID("archiveLocation");
  if (!fieldID) {
    return null;
  }
  const sql = `
    SELECT itemID
    FROM itemData
      JOIN itemDataValues USING(valueID)
    WHERE fieldID = ?
      AND value = ?
    LIMIT 1
  `;
  const itemID = await Zotero.DB.valueQueryAsync(sql, [fieldID, recid]);
  if (!itemID) {
    return null;
  }
  return Zotero.Items.get(Number(itemID));
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic JSON object type for dynamic INSPIRE metadata
 */
type jsobject = {
  [key: string]: any;
};

/**
 * INSPIRE API metadata response structure (partial)
 */
interface InspireMetadataResponse {
  control_number?: string;
  titles?: Array<{ title: string; source?: string }>;
  authors?: Array<{
    full_name: string;
    inspire_roles?: string[];
    affiliations?: Array<{ value: string }>;
  }>;
  publication_info?: Array<{
    journal_title?: string;
    journal_volume?: string;
    journal_issue?: string;
    year?: number;
    artid?: string;
    page_start?: string;
    page_end?: string;
    material?: string;
    pubinfo_freetext?: string;
  }>;
  citation_count?: number;
  citation_count_without_self_citations?: number;
  dois?: Array<{ value: string }>;
  arxiv_eprints?: Array<{ value: string; categories?: string[] }>;
  abstracts?: Array<{ value: string; source?: string }>;
  texkeys?: string[];
  document_type?: string[];
  collaborations?: Array<{ value: string }>;
  isbns?: Array<{ value: string }>;
  imprints?: Array<{ publisher?: string; date?: string }>;
  author_count?: number;
  earliest_date?: string;
}
export class ZInspire {
  current: number;
  toUpdate: number;
  itemsToUpdate: Zotero.Item[];
  numberOfUpdatedItems: number;
  counter: number;
  CrossRefcounter: number;
  noRecidCount: number;
  error_norecid: boolean;
  error_norecid_shown: boolean;
  final_count_shown: boolean;
  progressWindow: ProgressWindowHelper;
  private isCancelled: boolean = false;
  constructor(
    current: number = -1,
    toUpdate: number = 0,
    itemsToUpdate: Zotero.Item[] = [],
    numberOfUpdatedItems: number = 0,
    counter: number = 0,
    CrossRefcounter: number = 0,
    noRecidCount: number = 0,
    error_norecid: boolean = false,
    error_norecid_shown: boolean = false,
    final_count_shown: boolean = false,
  ) {
    this.current = current;
    this.toUpdate = toUpdate;
    this.itemsToUpdate = itemsToUpdate;
    this.numberOfUpdatedItems = numberOfUpdatedItems;
    this.counter = counter;
    this.CrossRefcounter = CrossRefcounter;
    this.noRecidCount = noRecidCount;
    this.error_norecid = error_norecid;
    this.error_norecid_shown = error_norecid_shown;
    this.final_count_shown = final_count_shown;
    this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
      closeTime: -1,
    });
  }

  resetState(operation: string) {
    if (operation === "initial") {
      if (this.progressWindow) {
        this.progressWindow.close();
      }
      this.current = -1;
      this.toUpdate = 0;
      this.itemsToUpdate = [];
      this.numberOfUpdatedItems = 0;
      this.counter = 0;
      this.CrossRefcounter = 0;
      this.noRecidCount = 0;
      this.error_norecid = false;
      this.error_norecid_shown = false;
      this.final_count_shown = false;
    } else {
      if (this.error_norecid) {
        this.progressWindow.close();
        const icon = "chrome://zotero/skin/cross.png";
        if (this.error_norecid && !this.error_norecid_shown) {
          //ztoolkit.log("hello");
          const progressWindowNoRecid = new ztoolkit.ProgressWindow(
            config.addonName,
            { closeOnClick: true },
          );
          progressWindowNoRecid.changeHeadline("INSPIRE recid not found");
          const itemWord = this.noRecidCount === 1 ? "item" : "items";
          if (getPref("tag_enable") && getPref("tag_norecid") !== "") {
            progressWindowNoRecid.createLine({
              icon: icon,
              text:
                `No INSPIRE recid was found for ${this.noRecidCount} ${itemWord}. Tagged with '${getPref("tag_norecid")}'.`,
            });
          } else {
            progressWindowNoRecid.createLine({
              icon: icon,
              text: `No INSPIRE recid was found for ${this.noRecidCount} ${itemWord}.`,
            });
          }
          progressWindowNoRecid.show();
          progressWindowNoRecid.startCloseTimer(3000);
          this.error_norecid_shown = true;
        }
      } else {
        if (!this.final_count_shown) {
          const icon = "chrome://zotero/skin/tick.png";
          this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
            closeOnClick: true,
          });
          this.progressWindow.changeHeadline("Finished");
          // ztoolkit.log(this.progressWindow.ItemProgress)
          if (operation === "full" || operation === "noabstract") {
            this.progressWindow.createLine({
              text: "INSPIRE metadata updated for " + this.counter + " items.",
              progress: 100,
            });
          } else if (operation === "citations") {
            this.progressWindow.createLine({
              text:
                "INSPIRE citations updated for " +
                this.counter +
                " items;\n" +
                "CrossRef citations updated for " +
                this.CrossRefcounter +
                " items.",
              progress: 100,
            });
          }
          this.progressWindow.show();
          this.progressWindow.startCloseTimer(4000);
          this.final_count_shown = true;
        }
      }
    }
  }

  /**
   * Cancel the ongoing update operation
   */
  cancelUpdate() {
    if (!this.isCancelled && this.numberOfUpdatedItems < this.toUpdate) {
      this.isCancelled = true;
      try {
        this.progressWindow.changeLine({
          text: getString("update-cancelled")
        });
      } catch (_e) { /* ignore */ }
      Zotero.debug(`[${config.addonName}] cancelUpdate: cancelled by user`);
    }
  }

  updateSelectedCollection(operation: string) {
    const pane = Zotero.getActiveZoteroPane();
    const collection = pane?.getSelectedCollection();
    if (collection) {
      const items = collection.getChildItems(false, false);
      this.updateItems(items, operation);
    }
  }

  updateSelectedItems(operation: string) {
    const pane = Zotero.getActiveZoteroPane();
    const items = pane ? pane.getSelectedItems() : [];
    this.updateItems(items, operation);
  }

  updateItems(items0: Zotero.Item[], operation: string) {
    Zotero.debug(`[${config.addonName}] updateItems: starting, items0.length=${items0.length}, operation=${operation}`);
    // don't update note items
    const items = items0.filter((item) => item.isRegularItem());
    Zotero.debug(`[${config.addonName}] updateItems: filtered items.length=${items.length}`);

    Zotero.debug(`[${config.addonName}] updateItems: numberOfUpdatedItems=${this.numberOfUpdatedItems}, toUpdate=${this.toUpdate}`);
    if (items.length === 0 || this.numberOfUpdatedItems < this.toUpdate) {
      Zotero.debug(`[${config.addonName}] updateItems: early return due to condition check`);
      return;
    }

    Zotero.debug(`[${config.addonName}] updateItems: calling resetState("initial")`);
    this.resetState("initial");
    this.toUpdate = items.length;
    this.itemsToUpdate = items;

    // Progress Windows
    this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: false,  // Keep window open during update
    });
    const icon =
      "chrome://zotero/skin/toolbar-advanced-search" +
      // @ts-ignore - Plugin instance is not typed
      (Zotero.hiDPI ? "@2x" : "") +
      ".png";
    if (operation === "full" || operation === "noabstract") {
      this.progressWindow.changeHeadline("Retrieving INSPIRE metadata", icon);
    }
    if (operation === "citations") {
      this.progressWindow.changeHeadline(
        "Retrieving citation counts",
        icon,
      );
    }
    const inspireIcon =
      `chrome://${config.addonRef}/content/icons/inspire` +
      // @ts-ignore - Plugin instance is not typed
      (Zotero.hiDPI ? "@2x" : "") +
      ".png";
    this.progressWindow.createLine({
      text: "Retrieving... (Press ESC to cancel)",
      icon: inspireIcon,
    });
    this.progressWindow.show();

    // Add keyboard listener for ESC key to cancel
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !this.isCancelled && this.numberOfUpdatedItems < this.toUpdate) {
        this.cancelUpdate();
        document.removeEventListener('keydown', handleKeyPress);
      }
    };
    document.addEventListener('keydown', handleKeyPress);

    // Use concurrent processing for better performance
    Zotero.debug(`[${config.addonName}] updateItems: calling updateItemsConcurrent`);
    this.updateItemsConcurrent(operation).catch((err) => {
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent rejected: ${err}`);
      try {
        this.progressWindow.close();
      } catch (_e) { /* ignore */ }
      this.numberOfUpdatedItems = this.toUpdate;
    }).finally(() => {
      // Clean up keyboard listener
      document.removeEventListener('keydown', handleKeyPress);
    });
  }

  /**
   * Process items concurrently with controlled parallelism.
   * INSPIRE API allows 15 requests per 5 seconds, so we use 4 concurrent workers.
   */
  private async updateItemsConcurrent(operation: string) {
    try {
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: starting, operation=${operation}`);

      // Reset cancel flag at start
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: step 1 - resetting cancel flag`);
      this.isCancelled = false;

      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: step 2 - setting up variables`);
      const CONCURRENCY = 4; // Staying safe for INSPIRE API (15 req/5s limit)
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: step 3 - getting items, itemsToUpdate exists: ${!!this.itemsToUpdate}`);
      const items = this.itemsToUpdate;
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: step 4 - items.length=${items ? items.length : 'null'}`);
      const total = items.length;
      let completed = 0;
      let currentIndex = 0;

      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: total=${total}`);

      const updateProgress = () => {
        completed++;
        const percent = Math.round((completed / total) * 100);
        try {
          this.progressWindow.changeLine({ progress: percent });
          this.progressWindow.changeLine({
            text: `${completed}/${total} items updated`,
          });
          this.progressWindow.show();
        } catch (e) {
          Zotero.debug(`[${config.addonName}] updateProgress error: ${e}`);
        }
      };

      const processItem = async (item: Zotero.Item): Promise<void> => {
        // Check if cancelled before processing
        if (this.isCancelled) {
          return; // Skip this item
        }
        try {
          await this.updateItemInternal(item, operation);
        } catch (err) {
          Zotero.debug(`[${config.addonName}] processItem error for item=${item.id}: ${err}`);
        }
        updateProgress();
      };

      // Worker function that processes items from the shared queue
      const worker = async (): Promise<void> => {
        while (currentIndex < items.length && !this.isCancelled) {
          const index = currentIndex++;
          if (index >= items.length) break;
          await processItem(items[index]);
        }
      };

      // Start concurrent workers
      const workers: Promise<void>[] = [];
      const workerCount = Math.min(CONCURRENCY, total);
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: starting ${workerCount} workers`);
      for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
      }

      await Promise.all(workers);
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: all workers finished, completed=${completed}`);

      // Finish
      if (!this.isCancelled) {
        this.progressWindow.close();
        this.numberOfUpdatedItems = total;
        this.current = total - 1;
        this.resetState(operation);
        Zotero.debug(`[${config.addonName}] updateItemsConcurrent: done, counter=${this.counter}`);
      } else {
        // Cancelled - show stats
        this.progressWindow.close();
        this.numberOfUpdatedItems = total;
        this.current = total - 1;
        this.showCancelledStats(completed, total);
      }
    } catch (err) {
      Zotero.debug(`[${config.addonName}] updateItemsConcurrent: fatal error: ${err}`);
      try {
        this.progressWindow.close();
      } catch (_e) { /* ignore */ }
      this.numberOfUpdatedItems = this.toUpdate;
    }
  }

  /**
   * Show statistics when update was cancelled
   */
  private showCancelledStats(completed: number, total: number) {
    const statsWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    statsWindow.changeHeadline(getString("update-cancelled"));
    const icon = "chrome://zotero/skin/warning.png";
    statsWindow.createLine({
      icon: icon,
      text: getString("update-cancelled-stats", { args: { completed: completed.toString(), total: total.toString() } }),
    });
    statsWindow.show();
    statsWindow.startCloseTimer(5000);
  }

  // Legacy serial method (kept for reference, can be removed later)
  updateNextItem(operation: string) {
    this.numberOfUpdatedItems++;

    if (this.current === this.toUpdate - 1) {
      this.progressWindow.close();
      this.resetState(operation);
      return;
    }

    this.current++;

    // Progress Windows
    const percent = Math.round(
      (this.numberOfUpdatedItems / this.toUpdate) * 100,
    );
    this.progressWindow.changeLine({ progress: percent });
    this.progressWindow.changeLine({
      text: "Item " + this.current + " of " + this.toUpdate,
    });
    this.progressWindow.show();

    this.updateItem(this.itemsToUpdate[this.current], operation);
  }

  /**
   * Internal method to update a single item (used by concurrent processor)
   */
  private async updateItemInternal(item: Zotero.Item, operation: string) {
    Zotero.debug(`[${config.addonName}] updateItemInternal: starting, item=${item.id}, operation=${operation}`);
    if (
      operation === "full" ||
      operation === "noabstract" ||
      operation === "citations"
    ) {
      Zotero.debug(`[${config.addonName}] updateItemInternal: calling getInspireMeta`);
      const metaInspire = await getInspireMeta(item, operation);
      Zotero.debug(`[${config.addonName}] updateItemInternal: getInspireMeta returned, recid=${metaInspire !== -1 ? metaInspire.recid : 'N/A'}`);
      if (metaInspire !== -1 && metaInspire.recid !== undefined) {
        if (item.hasTag(getPref("tag_norecid") as string)) {
          item.removeTag(getPref("tag_norecid") as string);
        }
        if (item.itemType === "report" || item.itemType === "preprint") {
          item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
        }
        if (item.itemType !== "book" && metaInspire.document_type == "book") {
          item.setType(Zotero.ItemTypes.getID("book") as number);
        }
        await setInspireMeta(item, metaInspire, operation);
        await saveItemWithPendingInspireNote(item);
        this.counter++;
      } else {
        if (
          getPref("tag_enable") &&
          getPref("tag_norecid") !== "" &&
          !item.hasTag(getPref("tag_norecid") as string)
        ) {
          item.addTag(getPref("tag_norecid") as string, 1);
          await item.saveTx();
        } else if (
          !getPref("tag_enable") &&
          item.hasTag(getPref("tag_norecid") as string)
        ) {
          item.removeTag(getPref("tag_norecid") as string);
          await item.saveTx();
        }
        this.error_norecid = true;
        this.noRecidCount++;
        if (operation === "citations") {
          const crossref_count = await setCrossRefCitations(item);
          await item.saveTx();
          if (crossref_count >= 0) {
            this.CrossRefcounter++;
          }
        }
      }
    }
  }

  async updateItem(item: Zotero.Item, operation: string) {
    if (
      operation === "full" ||
      operation === "noabstract" ||
      operation === "citations"
    ) {
      // await removeArxivNote(item)

      const metaInspire = await getInspireMeta(item, operation);
      // Zotero.debug(`updateItem metaInspire: ${metaInspire}`);
      if (metaInspire !== -1 && metaInspire.recid !== undefined) {
        if (item.hasTag(getPref("tag_norecid") as string)) {
          item.removeTag(getPref("tag_norecid") as string);
          item.saveTx();
        }
        // if (metaInspire.journalAbbreviation && (item.itemType === 'report' || item.itemType === 'preprint')) {
        if (item.itemType === "report" || item.itemType === "preprint") {
          item.setType(Zotero.ItemTypes.getID("journalArticle") as number);
        }

        if (item.itemType !== "book" && metaInspire.document_type == "book")
          item.setType(Zotero.ItemTypes.getID("book") as number);

        await setInspireMeta(item, metaInspire, operation);
        await saveItemWithPendingInspireNote(item);
        this.counter++;
      } else {
        if (
          getPref("tag_enable") &&
          getPref("tag_norecid") !== "" &&
          !item.hasTag(getPref("tag_norecid") as string)
        ) {
          item.addTag(getPref("tag_norecid") as string, 1);
          item.saveTx();
        } else if (
          !getPref("tag_enable") &&
          item.hasTag(getPref("tag_norecid") as string)
        ) {
          item.removeTag(getPref("tag_norecid") as string);
          item.saveTx();
        }
        this.error_norecid = true;
        this.noRecidCount++;
        if (operation == "citations") {
          const crossref_count = await setCrossRefCitations(item);
          item.saveTx();
          if (crossref_count >= 0) {
            this.CrossRefcounter++;
          }
        }
      }
      this.updateNextItem(operation);
    } else {
      this.updateNextItem(operation);
    }
  }
}

async function getInspireMeta(item: Zotero.Item, operation: string) {
  const doi0 = item.getField("DOI") as string;
  let doi = doi0;
  const url = item.getField("url") as string;
  const extra = item.getField("extra") as string;
  let searchOrNot = 0;

  let idtype = "doi";
  const arxivReg = new RegExp(/arxiv/i);
  if (!doi || arxivReg.test(doi)) {
    if (extra.includes("arXiv:") || extra.includes("_eprint:")) {
      // arXiv number from Extra
      idtype = "arxiv";
      const regexArxivId = /(arXiv:|_eprint:)(.+)/; //'arXiv:(.+)'
      /* in this way, different situations are included:
      New and old types of arXiv number; 
      whether or not the arXiv line is at the end of extra
      */
      if (extra.match(regexArxivId)) {
        const arxiv_split = (extra.match(regexArxivId) || "   ")[2].split(" ");
        if (arxiv_split[0] === "") {
          doi = arxiv_split[1];
        } else {
          doi = arxiv_split[0];
        }
      }
    } else if (/(doi|arxiv|\/literature\/)/i.test(url)) {
      // patt taken from the Citations Count plugin
      const patt = /(?:arxiv.org[/]abs[/]|arXiv:)([a-z.-]+[/]\d+|\d+[.]\d+)/i;
      const m = patt.exec(url);
      if (!m) {
        // DOI from url
        if (/doi/i.test(url)) {
          doi = url.replace(/^.+doi.org\//, "");
        } else if (url.includes("/literature/")) {
          const _recid = /[^/]*$/.exec(url) || "    ";
          if (_recid[0].match(/^\d+/)) {
            idtype = "literature";
            doi = _recid[0];
          }
        }
      } else {
        // arxiv number from from url
        idtype = "arxiv";
        doi = m[1];
      }
    } else if (/DOI:/i.test(extra)) {
      // DOI in extra
      const regexDOIinExtra = /DOI:(.+)/i;
      doi = (extra.match(regexDOIinExtra) || "")[1].trim();
    } else if (/doi\.org\//i.test(extra)) {
      const regexDOIinExtra = /doi\.org\/(.+)/i;
      doi = (extra.match(regexDOIinExtra) || "")[1];
    } else {
      // INSPIRE recid in archiveLocation or Citation Key in Extra
      const _recid = item.getField("archiveLocation") as string;
      if (_recid.match(/^\d+/)) {
        idtype = "literature";
        doi = _recid;
      }
    }
  } else if (/doi/i.test(doi)) {
    //doi.includes("doi")
    doi = doi.replace(/^.+doi.org\//, ""); //doi.replace('https://doi.org/', '')
  }

  if (!doi && extra.includes("Citation Key:")) searchOrNot = 1;
  const t0 = performance.now();

  let urlInspire = "";
  if (searchOrNot === 0) {
    const edoi = encodeURIComponent(doi);
    urlInspire = `${INSPIRE_API_BASE}/${idtype}/${edoi}`;
  } else if (searchOrNot === 1) {
    const citekey = (extra.match(/^.*Citation\sKey:.*$/gm) || "")[0].split(
      ": ",
    )[1];
    urlInspire =
      `${INSPIRE_API_BASE}/literature?q=texkey%20${encodeURIComponent(citekey)}`;
  }

  if (!urlInspire) {
    return -1;
  }

  // Zotero.debug(`urlInspire: ${urlInspire}`);

  let status: number | null = null;
  const response = (await fetch(urlInspire)
    //   .then(response => response.json())
    .then((response) => {
      if (response.status !== 404) {
        status = 1;
        return response.json();
      }
    })
    .catch((_err) => null)) as any;

  // Zotero.debug(`getInspireMeta response: ${response}, status: ${status}`)
  if (status === null) {
    return -1;
  }

  const t1 = performance.now();
  Zotero.debug(`Fetching INSPIRE meta took ${t1 - t0} milliseconds.`);

  try {
    const meta = (() => {
      if (searchOrNot === 0) {
        return response["metadata"];
      } else {
        const hits = response["hits"].hits;
        if (hits.length === 1) return hits[0].metadata;
      }
    })();
    if (!meta) {
      return -1;
    }
    const assignStart = performance.now();
    const metaInspire = buildMetaFromMetadata(meta, operation);
    if (operation !== "citations") {
      const assignEnd = performance.now();
      Zotero.debug(
        `Assigning meta took ${assignEnd - assignStart} milliseconds.`,
      );
    }
    return metaInspire;
  } catch (err) {
    return -1;
  }
}

// Cache for recid lookups to avoid repeated API calls for the same item
// Key: itemID, Value: recid (string) or null (not found)
// Note: Only caches successful lookups to allow retrying failed ones
const recidLookupCache = new Map<number, string>();

async function fetchRecidFromInspire(item: Zotero.Item) {
  // Validate item.id before using as cache key
  if (typeof item.id !== "number" || !Number.isFinite(item.id)) {
    Zotero.debug(`[${config.addonName}] Invalid item.id: ${item.id}, skipping cache`);
    const meta = (await getInspireMeta(item, "literatureLookup")) as jsobject | -1;
    if (meta === -1 || typeof meta !== "object") return null;
    return meta.recid as string | undefined | null;
  }

  // Check cache first to avoid redundant API calls
  const cached = recidLookupCache.get(item.id);
  if (cached !== undefined) {
    Zotero.debug(`[${config.addonName}] Using cached recid for item ${item.id}: ${cached}`);
    return cached;
  }

  const meta = (await getInspireMeta(item, "literatureLookup")) as
    | jsobject
    | -1;
  if (meta === -1 || typeof meta !== "object") {
    // Don't cache failed lookups - allow retry on next access
    return null;
  }
  const recid = meta.recid as string | undefined | null;
  if (recid) {
    // Only cache successful lookups with valid recid
    recidLookupCache.set(item.id, recid);
  }
  return recid;
}

async function fetchInspireMetaByRecid(
  recid: string,
  signal?: AbortSignal,
  operation: string = "full",
  minimal: boolean = false,
) {
  let url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}`;
  if (minimal) {
    url += "?fields=metadata.title,metadata.creators,metadata.date";
  }
  const response = await fetch(url, { signal }).catch(() => null);
  if (!response || response.status === 404) {
    return -1;
  }
  const payload: any = await response.json();
  const meta = payload?.metadata;
  if (!meta) {
    return -1;
  }
  try {
    return buildMetaFromMetadata(meta, operation);
  } catch (_err) {
    return -1;
  }
}

/**
 * Fetch only the abstract for a given recid from INSPIRE API.
 * Tries the lightweight fields endpoint first, falls back to full record and search.
 */
async function fetchInspireAbstract(
  recid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  // Reuse existing metadata fetcher to ensure consistent parsing (includes abstracts)
  const meta = await fetchInspireMetaByRecid(recid, signal, "full").catch(
    () => -1,
  );
  if (meta !== -1 && meta) {
    const abstract = (meta as jsobject).abstractNote;
    if (typeof abstract === "string" && abstract.trim()) {
      return abstract.trim();
    }
  }
  return await fetchAbstractDirect(recid, signal);
}

async function fetchAbstractDirect(
  recid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}?fields=metadata.abstracts`;
  try {
    const response = await fetch(url, { signal }).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }
    const payload: any = await response.json();
    const abstracts = payload?.metadata?.abstracts;
    if (Array.isArray(abstracts) && abstracts.length) {
      const preferred =
        abstracts.find((a) => (a?.language || "").toLowerCase() === "en") ||
        abstracts.find((a) => a?.source === "arXiv") ||
        abstracts[0];
      const text = (preferred?.value || "").trim();
      return text || null;
    }
  } catch (_err) {
    return null;
  }
  return null;
}

/**
 * Fetch BibTeX entry for a given INSPIRE recid.
 * Uses the INSPIRE API's format=bibtex parameter.
 */
async function fetchBibTeX(
  recid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recid)}?format=bibtex`;
  try {
    const response = await fetch(url, { signal }).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }
    const bibtex = await response.text();
    return bibtex?.trim() || null;
  } catch (_err) {
    return null;
  }
}

/**
 * Copy text to the system clipboard.
 * Returns true on success, false on failure.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Use Zotero's built-in clipboard utility (preferred in Zotero environment)
    const clipboardService = Zotero.Utilities.Internal?.copyTextToClipboard;
    if (typeof clipboardService === "function") {
      clipboardService(text);
      return true;
    }

    // Fallback: use Mozilla's clipboard helper service
    const componentsAny = Components as any;
    const clipboardHelper = componentsAny?.classes?.[
      "@mozilla.org/widget/clipboardhelper;1"
    ]?.getService(componentsAny?.interfaces?.nsIClipboardHelper);
    if (clipboardHelper) {
      clipboardHelper.copyString(text);
      return true;
    }

    // Fallback: create a temporary textarea and use execCommand
    const doc = Zotero.getMainWindow()?.document;
    if (doc) {
      const textarea = doc.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.left = "-9999px";
      doc.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = doc.execCommand("copy");
      textarea.remove();
      return success;
    }
    return false;
  } catch (_err) {
    Zotero.debug(`[${config.addonName}] Failed to copy to clipboard: ${_err}`);
    return false;
  }
}

function buildMetaFromMetadata(meta: any, operation: string) {
  if (!meta) {
    throw new Error("Missing metadata");
  }
  const metaInspire: jsobject = {};
  metaInspire.recid = meta["control_number"];
  metaInspire.citation_count = meta["citation_count"];
  metaInspire.citation_count_wo_self_citations =
    meta["citation_count_without_self_citations"];

  if (operation !== "citations") {
    if (meta["dois"]) {
      metaInspire.DOI = meta["dois"][0].value;
    }

    if (meta["publication_info"]) {
      const publicationInfo = meta["publication_info"];
      const first = publicationInfo[0];
      if (first?.journal_title) {
        const jAbbrev = first.journal_title as string;
        metaInspire.journalAbbreviation = jAbbrev.replace(/\.\s|\./g, ". ");
        if (first.journal_volume) {
          metaInspire.volume = first.journal_volume;
        }
        if (first.artid) {
          metaInspire.pages = first.artid;
        } else if (first.page_start) {
          metaInspire.pages = first.page_start;
          if (first.page_end) {
            metaInspire.pages = metaInspire.pages + "-" + first.page_end;
          }
        }
        metaInspire.date = first.year;
        metaInspire.issue = first.journal_issue;
      }

      if (publicationInfo.length > 1) {
        const errNotes: string[] = [];
        for (let i = 1; i < publicationInfo.length; i++) {
          const next = publicationInfo[i];
          if (next.material === "erratum") {
            const jAbbrev = next.journal_title;
            let pagesErr = "";
            if (next.artid) {
              pagesErr = next.artid;
            } else if (next.page_start) {
              pagesErr = next.page_start;
              if (next.page_end) {
                pagesErr = pagesErr + "-" + next.page_end;
              }
            }
            errNotes[i - 1] =
              `Erratum: ${jAbbrev} ${next.journal_volume}, ${pagesErr} (${next.year})`;
          } else if (next.journal_title && (next.page_start || next.artid)) {
            let pagesNext = "";
            if (next.page_start) {
              pagesNext = next.page_start;
              if (next.page_end) {
                pagesNext = pagesNext + "-" + next.page_end;
              }
            } else if (next.artid) {
              pagesNext = next.artid;
            }
            errNotes[i - 1] =
              `${next.journal_title}  ${next.journal_volume} (${next.year}) ${pagesNext}`;
          }
          if (next.pubinfo_freetext) {
            errNotes[i - 1] = next.pubinfo_freetext;
          }
        }
        if (errNotes.length > 0) {
          metaInspire.note = `[${errNotes.join(", ")}]`;
        }
      }
    }

    const metaArxiv = meta["arxiv_eprints"];
    if (metaArxiv) {
      metaInspire.arxiv = metaArxiv[0];
      metaInspire.urlArxiv = `${ARXIV_ABS_URL}/${metaInspire.arxiv.value}`;
    }

    const metaAbstract = meta["abstracts"];
    if (metaAbstract) {
      metaInspire.abstractNote = metaAbstract[0].value;
      for (let i = 0; i < metaAbstract.length; i++) {
        if (metaAbstract[i].source === "arXiv") {
          metaInspire.abstractNote = metaAbstract[i].value;
          break;
        }
      }
    }

    const rawTitle = meta["titles"]?.[0]?.title;
    metaInspire.title = rawTitle ? cleanMathTitle(rawTitle) : rawTitle;
    metaInspire.document_type = meta["document_type"];
    metaInspire.citekey = meta["texkeys"]?.[0];
    if (meta["isbns"]) {
      metaInspire.isbns = meta["isbns"].map((e: any) => e.value);
    }
    if (meta["imprints"]) {
      const imprint = meta["imprints"][0];
      if (imprint.publisher) {
        metaInspire.publisher = imprint.publisher;
      }
      if (imprint.date) {
        metaInspire.date = imprint.date;
      }
    }

    const creators: any[] = [];
    const metaCol = meta["collaborations"];
    if (metaCol) {
      metaInspire.collaborations = metaCol.map((e: any) => e.value);
    }

    const metaAuthors = meta["authors"];
    if (metaAuthors?.length) {
      const authorCount = meta["author_count"] || metaAuthors.length;
      let maxAuthorCount = authorCount;
      if (authorCount > 10) {
        maxAuthorCount = 3;
      }
      for (let j = 0; j < maxAuthorCount; j++) {
        const [lastName, firstName] = metaAuthors[j].full_name.split(", ");
        creators[j] = {
          firstName,
          lastName,
          creatorType: metaAuthors[j].inspire_roles
            ? metaAuthors[j].inspire_roles[0]
            : "author",
        };
      }
      if (authorCount > 10) {
        creators.push({
          name: "others",
          creatorType: "author",
        });
      }
    } else if (metaCol) {
      for (let i = 0; i < metaCol.length; i++) {
        creators[i] = {
          name: metaInspire.collaborations[i],
          creatorType: "author",
        };
      }
    }
    metaInspire.creators = creators;
  }

  return metaInspire;
}

/*
copied from https://github.com/eschnett/zotero-citationcounts/blob/master/chrome/content/zotero-citationcounts.js
*/
async function getCrossrefCount(item: Zotero.Item) {
  const doi = item.getField("DOI");
  if (!doi) {
    // There is no DOI; skip item
    return -1;
  }
  const edoi = encodeURIComponent(doi);

  const t0 = performance.now();
  let response: any = null;

  if (response === null) {
    const style = "vnd.citationstyles.csl+json";
    const xform = "transform/application/" + style;
    const url = `${CROSSREF_API_URL}/${edoi}/${xform}`;
    response = await fetch(url)
      .then((response) => response.json())
      .catch((_err) => null);
  }

  if (response === null) {
    const url = "https://doi.org/" + edoi;
    const style = "vnd.citationstyles.csl+json";
    response = await fetch(url, {
      headers: {
        Accept: "application/" + style,
      },
    })
      .then((response) => response.json())
      .catch((_err) => null);
  }

  if (response === null) {
    // Something went wrong
    return -1;
  }

  const t1 = performance.now();
  Zotero.debug(`Fetching CrossRef meta took ${t1 - t0} milliseconds.`);

  let str = null;
  try {
    str = response["is-referenced-by-count"];
  } catch (err) {
    // There are no citation counts
    return -1;
  }

  const count = str ? parseInt(str) : -1;
  return count;
}

async function setInspireMeta(
  item: Zotero.Item,
  metaInspire: jsobject,
  operation: string,
) {
  // const today = new Date(Date.now()).toLocaleDateString('zh-CN');
  let extra = item.getField("extra") as string;
  const publication = item.getField("publicationTitle") as string;
  const citekey_pref = getPref("citekey");
  // item.setField('archiveLocation', metaInspire);
  if (metaInspire.recid !== -1 && metaInspire.recid !== undefined) {
    if (operation === "full" || operation === "noabstract") {
      item.setField("archive", "INSPIRE");
      item.setField("archiveLocation", metaInspire.recid);

      if (metaInspire.journalAbbreviation) {
        if (item.itemType === "journalArticle") {
          //metaInspire.document_type[0]  === "article"
          item.setField("journalAbbreviation", metaInspire.journalAbbreviation);
        } else if (
          metaInspire.document_type[0] === "book" &&
          item.itemType === "book"
        ) {
          item.setField("series", metaInspire.journalAbbreviation);
        } else {
          item.setField("publicationTitle", metaInspire.journalAbbreviation);
        }
      }
      // to avoid setting undefined to zotero items
      if (metaInspire.volume) {
        if (metaInspire.document_type[0] == "book") {
          item.setField("seriesNumber", metaInspire.volume);
        } else {
          item.setField("volume", metaInspire.volume);
        }
      }
      if (metaInspire.pages && metaInspire.document_type[0] !== "book") {
        item.setField("pages", metaInspire.pages);
      }
      if (metaInspire.date) {
        item.setField("date", metaInspire.date);
      }
      if (metaInspire.issue) {
        item.setField("issue", metaInspire.issue);
      }
      if (metaInspire.DOI) {
        // if (metaInspire.document_type[0] === "book") {
        if (
          item.itemType === "journalArticle" ||
          item.itemType === "preprint"
        ) {
          item.setField("DOI", metaInspire.DOI);
        } else {
          item.setField("url", `${DOI_ORG_URL}/${metaInspire.DOI}`);
        }
      }

      if (metaInspire.isbns && !item.getField("ISBN")) {
        item.setField("ISBN", metaInspire.isbns);
      }
      if (
        metaInspire.publisher &&
        !item.getField("publisher") &&
        (item.itemType == "book" || item.itemType == "bookSection")
      )
        item.setField("publisher", metaInspire.publisher);

      /* set the title and creators if there are none */
      if (!item.getField("title")) {
        item.setField("title", metaInspire.title);
      }
      if (
        !item.getCreator(0) ||
        !(item.getCreator(0) as _ZoteroTypes.Item.Creator).firstName
      )
        item.setCreators(metaInspire.creators);

      // The current arXiv.org Zotero translator put all cross-listed categories after the ID, and the primary category is not the first. Here we replace that list by only the primary one.
      // set the arXiv url, useful to use Find Available PDF for newly added arXiv papers
      if (metaInspire.arxiv) {
        const arxivId = metaInspire.arxiv.value;
        const _arxivReg = new RegExp(/^.*(arXiv:|_eprint:).*$(\n|)/gim);
        let arXivInfo = "";
        if (/^\d/.test(arxivId)) {
          const arxivPrimeryCategory = metaInspire.arxiv.categories[0];
          arXivInfo = `arXiv:${arxivId} [${arxivPrimeryCategory}]`;
        } else {
          arXivInfo = "arXiv:" + arxivId;
        }
        const numberOfArxiv = (extra.match(_arxivReg) || "").length;
        // Zotero.debug(`number of arXiv lines: ${numberOfArxiv}`)
        if (numberOfArxiv !== 1) {
          // The arXiv.org translater could add two lines of arXiv to extra; remove one in that case
          extra = extra.replace(_arxivReg, "");
          if (extra.endsWith("\n")) {
            extra += arXivInfo;
          } else {
            extra += "\n" + arXivInfo;
          }
        } else {
          extra = extra.replace(/^.*(arXiv:|_eprint:).*$/gim, arXivInfo);
          // Zotero.debug(`extra w arxiv-2: ${extra}`)
        }

        // set journalAbbr. to the arXiv ID prior to journal publication
        if (!metaInspire.journalAbbreviation) {
          if (item.itemType == "journalArticle") {
            item.setField("journalAbbreviation", arXivInfo);
          }
          if (publication.startsWith("arXiv:")) {
            item.setField("publicationTitle", "");
          }
        }
        const url = item.getField("url");
        if (metaInspire.urlArxiv && !url) {
          item.setField("url", metaInspire.urlArxiv);
        }
      }

      extra = extra.replace(/^.*type: article.*$\n/gm, "");

      if (metaInspire.collaborations && !extra.includes("tex.collaboration")) {
        extra =
          extra +
          "\n" +
          "tex.collaboration: " +
          metaInspire.collaborations.join(", ");
      }

      // Zotero.debug('setInspire-4')
      extra = setCitations(
        extra,
        metaInspire.citation_count,
        metaInspire.citation_count_wo_self_citations,
      );

      await queueOrUpsertInspireNote(item, metaInspire.note);

      // for citekey preference
      if (citekey_pref === "inspire") {
        if (extra.includes("Citation Key")) {
          const initialCiteKey = (extra.match(/^.*Citation\sKey:.*$/gm) ||
            "")[0].split(": ")[1];
          if (initialCiteKey !== metaInspire.citekey)
            extra = extra.replace(
              /^.*Citation\sKey.*$/gm,
              `Citation Key: ${metaInspire.citekey}`,
            );
        } else {
          extra += "\nCitation Key: " + metaInspire.citekey;
        }
      }
    }

    if (operation === "full" && metaInspire.abstractNote) {
      item.setField("abstractNote", metaInspire.abstractNote);
    }

    if (operation === "citations") {
      extra = setCitations(
        extra,
        metaInspire.citation_count,
        metaInspire.citation_count_wo_self_citations,
      );
    }
    extra = extra.replace(/\n\n/gm, "\n");
    extra = reorderExtraFields(extra);
    item.setField("extra", extra);

    // Set arXiv category tag if enabled
    setArxivCategoryTag(item);
  }
}

function setArxivCategoryTag(item: Zotero.Item) {
  const arxiv_tag_pref = getPref("arxiv_tag_enable");

  if (!arxiv_tag_pref) {
    return;
  }

  const extra = item.getField("extra") as string;

  // Extract arXiv primary category from extra field
  let primaryCategory = "";

  // Pattern 1: New format arXiv:2503.05295 [nucl-th]
  const newFormatMatch = extra.match(/arXiv:\d{4}\.\d{4,5}\s*\[([^\]]+)\]/i);
  if (newFormatMatch) {
    primaryCategory = newFormatMatch[1];
  } else {
    // Pattern 2: Old format arXiv:hep-ph/0703062
    const oldFormatMatch = extra.match(/arXiv:([a-z-]+)\/\d{7}/i);
    if (oldFormatMatch) {
      primaryCategory = oldFormatMatch[1];
    }
  }

  if (primaryCategory) {
    // Check if tag already exists
    if (!item.hasTag(primaryCategory)) {
      item.addTag(primaryCategory);
      item.saveTx();
    }
  }
}

type ItemWithPendingInspireNote = Zotero.Item & {
  _zinspirePendingInspireNote?: string;
};

const INSPIRE_NOTE_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

async function queueOrUpsertInspireNote(
  item: Zotero.Item,
  noteText?: string,
) {
  const trimmed = noteText?.trim();
  const itemWithPending = item as ItemWithPendingInspireNote;

  if (!trimmed || trimmed === "[]") {
    delete itemWithPending._zinspirePendingInspireNote;
    return;
  }

  if (!item.id) {
    itemWithPending._zinspirePendingInspireNote = trimmed;
    return;
  }

  await upsertInspireNote(item, trimmed);
  delete itemWithPending._zinspirePendingInspireNote;
}

async function flushPendingInspireNote(item: Zotero.Item) {
  const itemWithPending = item as ItemWithPendingInspireNote;
  if (item.id && itemWithPending._zinspirePendingInspireNote) {
    await upsertInspireNote(item, itemWithPending._zinspirePendingInspireNote);
    delete itemWithPending._zinspirePendingInspireNote;
  }
}

async function saveItemWithPendingInspireNote(item: Zotero.Item) {
  await item.saveTx();
  await flushPendingInspireNote(item);
}

async function upsertInspireNote(item: Zotero.Item, noteText: string) {
  if (!item.id) {
    return;
  }

  const normalizedTarget = normalizeInspireNoteContent(noteText);
  if (!normalizedTarget) {
    return;
  }

  const noteIDs = item.getNotes();
  let exactMatch: Zotero.Item | undefined;
  let fallbackMatch: Zotero.Item | undefined;
  const targetLooksLikeErratum = normalizedTarget.includes("erratum");

  for (const id of noteIDs) {
    const note = Zotero.Items.get(id);
    const normalizedExisting = normalizeInspireNoteContent(note.getNote());
    if (!normalizedExisting) {
      continue;
    }

    if (normalizedExisting === normalizedTarget) {
      exactMatch = note;
      break;
    }

    if (
      !fallbackMatch &&
      targetLooksLikeErratum &&
      normalizedExisting.includes("erratum")
    ) {
      fallbackMatch = note;
    }
  }

  const noteToUpdate = exactMatch ?? fallbackMatch;
  if (noteToUpdate) {
    if (noteToUpdate.getNote() !== noteText) {
      noteToUpdate.setNote(noteText);
      await noteToUpdate.saveTx();
    }
    return;
  }

  const newNote = new Zotero.Item("note");
  newNote.setNote(noteText);
  newNote.parentID = item.id;
  newNote.libraryID = item.libraryID;
  await newNote.saveTx();
}

function normalizeInspireNoteContent(note?: string): string {
  if (!note) {
    return "";
  }

  const withoutTags = note
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  const decoded = withoutTags.replace(
    /&([a-z]+);/gi,
    (_match, entity: string) =>
      INSPIRE_NOTE_HTML_ENTITIES[entity.toLowerCase()] ?? " ",
  );

  return decoded
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function setExtraCitations(extra: any, source: string, citation_count: any) {
  const today = new Date(Date.now()).toLocaleDateString("zh-CN");

  // Check if citation is already at the top with correct value
  const topLineMatch = extra.match(/^(\d+)\scitations\s\([\w\s]+[\d/-]+\)\n/);

  if (topLineMatch) {
    const topCitation = Number(topLineMatch[1]);

    // Citation is at top and value unchanged - no update needed
    if (citation_count === topCitation) {
      return extra;
    }
  }

  // Extract existing citation count and date from anywhere in extra (before removing)
  const temp = extra.match(/^\d+\scitations/gm);
  let existingCitation = 0;
  if (temp !== null && temp.length > 0) {
    existingCitation = Number(temp[0].replace(" citations", ""));
  }

  // Extract existing date before removing
  const dateMatch = extra.match(new RegExp(`${source}\\s([\\d/-]+)`));
  const existingDate = dateMatch ? dateMatch[1] : today;

  // Remove all existing citation lines (with or without trailing newline)
  extra = extra.replace(/^.*citations.*$\n?/gm, "");

  // Remove leading empty lines
  extra = extra.replace(/^\n+/, "");

  // Check if only position changed (value unchanged) - reuse existing date
  if (citation_count === existingCitation) {
    // Value unchanged, keep the existing date
    extra = `${citation_count} citations (${source} ${existingDate})\n` + extra;
  } else {
    // Value changed, use today's date
    extra = `${citation_count} citations (${source} ${today})\n` + extra;
  }

  return extra;
}

async function setCrossRefCitations(item: Zotero.Item) {
  let extra = item.getField("extra");
  let count_crossref = await getCrossrefCount(item);
  if (count_crossref >= 0) {
    extra = setExtraCitations(extra, "CrossRef", count_crossref) as string;
    extra = extra.replace(/\n\n/gm, "\n");
    extra = reorderExtraFields(extra);
    item.setField("extra", extra);

    // Set arXiv category tag if enabled
    setArxivCategoryTag(item);
  } else {
    count_crossref = -1;
  }
  return count_crossref;
}

function reorderExtraFields(extra: string) {
  const order_pref = getPref("extra_order");

  if (order_pref === "citations_first") {
    // For citations_first mode, setCitations has already placed citations at the top
    // Just return without reordering to avoid duplication
    return extra;
  }

  // For arxiv_first mode, we need to reorder
  // Extract different parts
  const citationLines: string[] = [];
  const arxivLines: string[] = [];
  const otherLines: string[] = [];

  const lines = extra.split("\n");

  for (const line of lines) {
    if (line.match(/^\d+\scitations/)) {
      citationLines.push(line);
    } else if (line.match(/^(arXiv:|_eprint:)/i)) {
      arxivLines.push(line);
    } else if (line.trim() !== "") {
      otherLines.push(line);
    }
  }

  // Reorder: arXiv first, then others, then citations
  const reordered = [...arxivLines, ...otherLines, ...citationLines];
  return reordered.join("\n");
}

function setCitations(
  extra: string,
  citation_count: number,
  citation_count_wo_self_citations: number,
) {
  const today = new Date(Date.now()).toLocaleDateString("zh-CN");

  // Check if citations are already at the top with correct values
  const topLinesMatch = extra.match(
    /^(\d+)\scitations\s\(INSPIRE\s[\d/-]+\)\n(\d+)\scitations\sw\/o\sself\s\(INSPIRE\s[\d/-]+\)\n/,
  );

  if (topLinesMatch) {
    const topCitation = Number(topLinesMatch[1]);
    const topCitationWoSelf = Number(topLinesMatch[2]);

    // Citations are at top and values unchanged - no update needed
    if (
      citation_count === topCitation &&
      citation_count_wo_self_citations === topCitationWoSelf
    ) {
      return extra;
    }
  }

  // Extract existing citation counts and date from anywhere in extra (before removing)
  const temp = extra.match(/^\d+\scitations/gm);
  let existingCitations: number[] = [0, 0];
  if (temp !== null && temp.length >= 2) {
    existingCitations = temp.map((e: any) =>
      Number(e.replace(" citations", "")),
    );
  }

  // Extract existing date before removing
  const dateMatch = extra.match(/INSPIRE\s([\d/-]+)/);
  const existingDate = dateMatch ? dateMatch[1] : today;

  // Remove all existing citation lines (with or without trailing newline)
  extra = extra.replace(/^.*citations.*$\n?/gm, "");

  // Remove leading empty lines
  extra = extra.replace(/^\n+/, "");

  // Check if only position changed (values unchanged) - reuse existing date
  if (
    citation_count === existingCitations[0] &&
    citation_count_wo_self_citations === existingCitations[1]
  ) {
    // Values unchanged, keep the existing date
    extra =
      `${citation_count} citations (INSPIRE ${existingDate})\n` +
      `${citation_count_wo_self_citations} citations w/o self (INSPIRE ${existingDate})\n` +
      extra;
  } else {
    // Values changed, use today's date
    extra =
      `${citation_count} citations (INSPIRE ${today})\n` +
      `${citation_count_wo_self_citations} citations w/o self (INSPIRE ${today})\n` +
      extra;
  }

  return extra;
}

