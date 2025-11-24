import { config } from "../../package.json";
import { getLocaleID, getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { ProgressWindowHelper } from "zotero-plugin-toolkit/dist/helpers/progressWindow";
import {
  showTargetPickerUI,
  SaveTargetRow,
  SaveTargetSelection,
} from "./pickerUI";
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
  authorText: string;
  displayText: string;
  searchText: string;
  localItemID?: number;
  isRelated?: boolean;
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
    // Zotero.debug(`[${config.addonName}] Registering INSPIRE reference pane`);
    ztoolkit.log(`[${config.addonName}] Registering INSPIRE reference pane`);

    Zotero.debug(`+++[${getLocaleID('references-panel-header')}]`);
    Zotero.debug(`+++[${config.addonName}] addonRef = ${config.addonRef}`);
    // 🔍 检查 document.l10n 是否可用
    // Zotero.debug(`+++[${config.addonName}] document.l10n available: ${!!document.l10n}`);

    const paneIcon = `chrome://${config.addonRef}/content/icons/inspire@0.5x.png`;
    const paneIcon2x = `chrome://${config.addonRef}/content/icons/inspire.png`;

    this.registrationKey = Zotero.ItemPaneManager.registerSection({
      // paneID: `${config.addonRef}-references`,
      paneID: 'zoteroinspire-references',
      pluginID: config.addonID,
      header: {
        // l10nID: getLocaleID("references-panel-header"),
        l10nID: 'zoteroinspire-references-panel-header',
        icon: paneIcon,
        darkIcon: paneIcon,
      },
      sidenav: {
        // l10nID: getLocaleID("references-panel-header"),
        l10nID: 'zoteroinspire-referencesSection',
        icon: paneIcon2x,
        darkIcon: paneIcon2x,
      },
      onInit: (args) => {
        // 🔍 检查生成的 DOM
        Zotero.debug(`+++[${config.addonName}] Panel initialized`);
        // Zotero.debug(`@@@[${config.addonName}] Body element: ${args.body?.outerHTML}`);
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
      // sectionButtons: [
      //   {
      //     type: 'refresh',
      //     icon: 'chrome://zotero/skin/16/universal/refresh.svg',
      //     l10nID: 'references-panel-refresh',
      //     onClick: this._handleRefresh.bind(this)
      //   }
      // ]
    });
  }

  // For sectionButtons
  // static _handleRefresh() {
  //   //
  // }

  static unregisterPanel() {
    if (typeof this.registrationKey === "string") {
      Zotero.ItemPaneManager.unregisterSection(this.registrationKey);
      this.registrationKey = undefined;
    }
  }
}

class InspireReferencePanelController {
  private body: HTMLDivElement;
  private statusEl: HTMLSpanElement;
  private listEl: HTMLDivElement;
  private refreshButton: HTMLButtonElement;
  private filterInput: HTMLInputElement;
  private filterText = "";
  private currentItemID?: number;
  private currentRecid?: string;
  private allEntries: InspireReferenceEntry[] = [];
  private referencesCache = new Map<string, InspireReferenceEntry[]>();
  private metadataCache = new Map<string, jsobject>();
  private rowCache = new Map<string, HTMLElement>();
  private activeAbort?: AbortController;
  private pendingToken?: string;
  private notifierID?: string;
  private pendingScrollRestore?: {
    itemID: number;
    scrollTop: number;
    scrollLeft: number;
    scrollSnapshots: Array<{ element: Element; top: number; left: number }>;
    activeElement: Element | null;
  };

  constructor(body: HTMLDivElement) {
    this.body = body;
    this.body.classList.add("zinspire-ref-panel");

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

    this.refreshButton = ztoolkit.UI.appendElement(
      {
        tag: "button",
        classList: ["zinspire-ref-panel__button"],
        attributes: { title: getString("references-panel-refresh") },
        properties: { textContent: getString("references-panel-refresh") },
        listeners: [
          {
            type: "click",
            listener: () => {
              if (this.currentRecid) {
                this.loadReferences(this.currentRecid, { force: true }).catch(
                  () => void 0,
                );
              }
            },
          },
        ],
      },
      toolbar,
    ) as HTMLButtonElement;

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
              this.filterText = target.value.trim().toLowerCase();
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
  }

  destroy() {
    this.unregisterNotifier();
    this.cancelActiveRequest();
    this.allEntries = [];
    this.referencesCache.clear();
    this.metadataCache.clear();
    this.rowCache.clear();
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
        // Listen for item additions
        if (event === "add" && type === "item") {
          await this.handleItemAdded(ids as number[]);
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

  async handleItemChange(
    args: _ZoteroTypes.ItemPaneManagerSection.SectionHookArgs,
  ) {
    if (args.tabType !== "library" && args.tabType !== "reader") {
      this.renderMessage(getString("references-panel-reader-mode"));
      return;
    }
    const item = args.item;
    if (!item || !item.isRegularItem()) {
      this.currentItemID = undefined;
      this.currentRecid = undefined;
      this.renderMessage(getString("references-panel-select-item"));
      return;
    }
    const previousItemID = this.currentItemID;
    const itemChanged = previousItemID !== item.id;
    this.currentItemID = item.id;

    if (itemChanged) {
      this.cancelActiveRequest();
      this.allEntries = [];
      this.renderMessage(getString("references-panel-status-loading"));
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
      return;
    }
    if (this.currentRecid !== recid) {
      this.currentRecid = recid;
      await this.loadReferences(recid).catch((err) => {
        if ((err as any)?.name !== "AbortError") {
          Zotero.debug(
            `[${config.addonName}] Failed to load references: ${err}`,
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
  }

  private restoreScrollPositionIfNeeded() {
    if (!this.pendingScrollRestore) {
      return;
    }

    // Only restore if itemPane is showing the original item
    if (this.currentItemID !== this.pendingScrollRestore.itemID) {
      return;
    }

    // Restore scroll position
    this.listEl.scrollTop = this.pendingScrollRestore.scrollTop;
    this.listEl.scrollLeft = this.pendingScrollRestore.scrollLeft;

    // Restore parent scroll positions
    for (const snapshot of this.pendingScrollRestore.scrollSnapshots) {
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

    // Restore focus if possible
    if (
      this.pendingScrollRestore.activeElement &&
      typeof (this.pendingScrollRestore.activeElement as any).focus === "function"
    ) {
      try {
        (this.pendingScrollRestore.activeElement as any).focus();
      } catch (_err) {
        // Ignore focus restoration issues
      }
    }

    // Clear the pending restore
    this.pendingScrollRestore = undefined;
  }

  private async loadReferences(
    recid: string,
    options: { force?: boolean } = {},
  ) {
    this.cancelActiveRequest();
    this.setStatus(getString("references-panel-status-loading"));
    this.renderMessage(getString("references-panel-status-loading"));
    this.refreshButton.disabled = true;

    const cached = this.referencesCache.get(recid);
    if (cached && !options.force) {
      this.allEntries = cached;
      this.renderReferenceList();
      this.refreshButton.disabled = false;
      // Restore scroll position after rendering if needed
      setTimeout(() => {
        this.restoreScrollPositionIfNeeded();
      }, 0);
      return;
    }

    const supportsAbort =
      typeof AbortController !== "undefined" &&
      typeof AbortController === "function";
    const controller = supportsAbort ? new AbortController() : null;
    this.activeAbort = controller ?? undefined;
    const token = `${recid}-${performance.now()}`;
    this.pendingToken = token;

    try {
      const entries = await this.fetchReferences(recid, controller?.signal);
      this.allEntries = entries;
      this.referencesCache.set(recid, entries);

      if (this.pendingToken === token) {
        this.renderReferenceList();
        // Restore scroll position after rendering if needed
        setTimeout(() => {
          this.restoreScrollPositionIfNeeded();
        }, 0);
      }

      await Promise.allSettled([
        this.enrichLocalStatus(entries, controller?.signal),
        this.enrichEntries(entries, controller?.signal),
      ]);
    } finally {
      if (this.pendingToken === token) {
        this.activeAbort = undefined;
        this.refreshButton.disabled = false;
      }
    }
  }

  private async fetchReferences(recid: string, signal?: AbortSignal) {
    Zotero.debug(
      `[${config.addonName}] Fetching references for recid ${recid}`,
    );
    const response = await fetch(
      `https://inspirehep.net/api/literature/${encodeURIComponent(recid)}?fields=metadata.references`,
      signal ? { signal } : undefined,
    ).catch(() => null);
    if (!response || response.status === 404) {
      throw new Error("Reference list not found");
    }
    const payload: any = await response.json();
    const references = payload?.metadata?.references ?? [];
    Zotero.debug(
      `[${config.addonName}] Retrieved ${references.length} references for ${recid}`,
    );
    const entries = await Promise.all(
      references.map((ref: any, index: number) => this.buildEntry(ref, index)),
    );
    return entries;
  }

  private async enrichEntries(
    entries: InspireReferenceEntry[],
    signal?: AbortSignal,
  ) {
    const needsDetails = entries.filter(
      (entry) =>
        !entry.title || entry.title === getString("references-panel-no-title"),
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

  private updateRowStatus(entry: InspireReferenceEntry) {
    const row = this.rowCache.get(entry.id);
    if (!row) return;

    const marker = row.querySelector(".zinspire-ref-entry__dot") as HTMLElement;
    if (marker) {
      marker.textContent = entry.localItemID ? "●" : "○";
      marker.dataset.state = entry.localItemID ? "local" : "missing";
      if (entry.localItemID) {
        marker.style.color = "#1a8f4d";
        marker.classList.remove("is-clickable");
        marker.style.cursor = "default";
      } else {
        marker.style.color = "#d93025";
        marker.classList.add("is-clickable");
        marker.style.cursor = "pointer";
      }
      marker.setAttribute(
        "title",
        entry.localItemID
          ? getString("references-panel-dot-local")
          : getString("references-panel-dot-add"),
      );
    }

    const linkButton = row.querySelector(
      ".zinspire-ref-entry__link",
    ) as HTMLButtonElement;
    if (linkButton) {
      linkButton.dataset.state = entry.isRelated ? "linked" : "unlinked";
      linkButton.style.cursor = entry.isRelated ? "default" : "pointer";
      linkButton.innerHTML = "";
      linkButton.setAttribute(
        "title",
        entry.isRelated
          ? getString("references-panel-link-existing")
          : getString("references-panel-link-missing"),
      );

      if (entry.isRelated) {
        const linkedIcon = row.ownerDocument.createElement("img");
        linkedIcon.src = "chrome://zotero/skin/itempane/16/related.svg";
        linkedIcon.width = 14;
        linkedIcon.height = 14;
        linkedIcon.setAttribute("draggable", "false");
        linkedIcon.style.margin = "0";
        linkedIcon.style.padding = "0";
        linkedIcon.style.display = "block";
        linkedIcon.style.filter =
          "brightness(0) saturate(100%) invert(28%) sepia(72%) saturate(1235%) hue-rotate(199deg) brightness(90%) contrast(94%)";
        linkButton.appendChild(linkedIcon);
        linkButton.style.color = "#1a56db";
      } else {
        linkButton.textContent = "⊘";
        linkButton.style.color = "#ff8c00";
      }
      linkButton.style.opacity = "1";
    }
  }

  private updateRowMetadata(entry: InspireReferenceEntry) {
    const row = this.rowCache.get(entry.id);
    if (!row) return;

    const titleLink = row.querySelector(
      ".zinspire-ref-entry__title",
    ) as HTMLAnchorElement;
    if (titleLink) {
      titleLink.textContent = entry.displayText;
    }
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
      if (!entry.recid || this.metadataCache.has(entry.recid)) {
        const cached = entry.recid
          ? this.metadataCache.get(entry.recid)
          : undefined;
        if (cached) {
          this.applyMetadataToEntry(entry, cached);
          this.updateRowMetadata(entry);
        }
        continue;
      }
      const meta = await fetchInspireMetaByRecid(
        entry.recid,
        undefined,
        "full",
        true,
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
      entry.authors = (meta.creators as any[])
        .map((creator) => {
          if (creator.name) {
            return creator.name as string;
          }
          const first = creator.firstName ?? "";
          const last = creator.lastName ?? "";
          return `${first} ${last}`.trim();
        })
        .filter(Boolean);
      entry.authorText = formatAuthors(entry.authors);
    }
    if (
      (!entry.year ||
        entry.year === getString("references-panel-year-unknown")) &&
      meta.date
    ) {
      entry.year = `${meta.date}`.slice(0, 4);
    }
    entry.displayText = buildDisplayText(entry);
    entry.searchText = entry.displayText.toLowerCase();
  }

  private async buildEntry(
    referenceWrapper: any,
    index: number,
  ): Promise<InspireReferenceEntry> {
    const reference = referenceWrapper?.reference ?? {};
    const recid =
      extractRecidFromRecordRef(referenceWrapper?.record?.["$ref"]) ||
      extractRecidFromUrls(reference?.urls);
    const authors = extractAuthorNames(reference);
    const summary = buildPublicationSummary(reference?.publication_info);
    const entry: InspireReferenceEntry = {
      id: `${index}-${recid ?? reference?.label ?? Date.now()}`,
      label: reference?.label,
      recid: recid ?? undefined,
      inspireUrl: buildReferenceUrl(reference, recid),
      fallbackUrl: buildFallbackUrl(reference),
      title:
        reference?.title?.title?.trim() ||
        getString("references-panel-no-title"),
      summary,
      year:
        reference?.publication_info?.year?.toString() ??
        getString("references-panel-year-unknown"),
      authors,
      authorText: formatAuthors(authors),
      displayText: "",
      searchText: "",
    };
    entry.displayText = buildDisplayText(entry);
    entry.searchText = entry.displayText.toLowerCase();
    // DB lookup moved to enrichLocalStatus
    return entry;
  }

  private renderReferenceList(options: { preserveScroll?: boolean } = {}) {
    const { preserveScroll = false } = options;
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
    this.listEl.textContent = "";
    this.rowCache.clear();
    if (!this.allEntries.length) {
      this.renderMessage(getString("references-panel-empty-list"));
      restoreScroll();
      return;
    }
    const filtered = this.filterText
      ? this.allEntries.filter((entry) =>
        entry.searchText.includes(this.filterText),
      )
      : this.allEntries;
    if (!filtered.length) {
      this.renderMessage(getString("references-panel-no-match"));
    } else {
      const fragment = this.listEl.ownerDocument.createDocumentFragment();
      for (const entry of filtered) {
        fragment.appendChild(this.createReferenceRow(entry));
      }
      this.listEl.appendChild(fragment);
    }
    if (this.filterText) {
      this.setStatus(
        getString("references-panel-filter-count", {
          args: {
            visible: filtered.length,
            total: this.allEntries.length,
          },
        }),
      );
    } else {
      this.setStatus(
        getString("references-panel-count", {
          args: { count: this.allEntries.length },
        }),
      );
    }
    restoreScroll();
  }

  private createReferenceRow(entry: InspireReferenceEntry) {
    const row = this.listEl.ownerDocument.createElement("div");
    row.classList.add("zinspire-ref-entry");

    const marker = this.listEl.ownerDocument.createElement("span");
    marker.classList.add("zinspire-ref-entry__dot");
    marker.textContent = entry.localItemID ? "●" : "○";
    marker.dataset.state = entry.localItemID ? "local" : "missing";
    const applyMarkerStyle = (hasLocalItem: boolean) => {
      if (hasLocalItem) {
        marker.style.color = "#1a8f4d";
        marker.style.opacity = "1";
      } else {
        marker.style.color = "#d93025";
        marker.style.opacity = "1";
      }
    };
    applyMarkerStyle(Boolean(entry.localItemID));
    marker.setAttribute(
      "title",
      entry.localItemID
        ? getString("references-panel-dot-local")
        : getString("references-panel-dot-add"),
    );
    if (!entry.localItemID) {
      marker.classList.add("is-clickable");
      marker.style.cursor = "pointer";
      marker.addEventListener("click", (event) => {
        event.preventDefault();
        const target = (event.target as HTMLElement).closest(
          ".zinspire-ref-entry__dot",
        ) as HTMLElement;
        this.handleAddAction(entry, target).catch(() => void 0);
      });
    }

    const linkButton = this.listEl.ownerDocument.createElement("button");
    linkButton.classList.add("zinspire-ref-entry__link");
    linkButton.dataset.state = entry.isRelated ? "linked" : "unlinked";
    linkButton.style.cursor = entry.isRelated ? "default" : "pointer";
    let linkedIcon: HTMLImageElement | null = null;
    linkButton.setAttribute(
      "title",
      entry.isRelated
        ? getString("references-panel-link-existing")
        : getString("references-panel-link-missing"),
    );
    if (entry.isRelated) {
      linkedIcon = this.listEl.ownerDocument.createElement("img");
      linkedIcon.src = "chrome://zotero/skin/itempane/16/related.svg";
      linkedIcon.width = 14;
      linkedIcon.height = 14;
      linkedIcon.setAttribute("draggable", "false");
      linkedIcon.style.margin = "0";
      linkedIcon.style.padding = "0";
      linkedIcon.style.display = "block";
      linkButton.appendChild(linkedIcon);
    } else {
      linkButton.textContent = "⊘";
    }
    const applyLinkStyle = (isLinked: boolean) => {
      if (isLinked) {
        linkButton.style.color = "#1a56db";
        linkButton.style.opacity = "1";
        if (linkedIcon) {
          linkedIcon.style.filter =
            "brightness(0) saturate(100%) invert(28%) sepia(72%) saturate(1235%) hue-rotate(199deg) brightness(90%) contrast(94%)";
        }
      } else {
        linkButton.style.color = "#ff8c00";
        linkButton.style.opacity = "1";
      }
    };
    applyLinkStyle(Boolean(entry.isRelated));
    linkButton.addEventListener("click", (event) => {
      event.preventDefault();
      this.handleLinkAction(entry).catch((err) => {
        if ((err as any)?.name !== "AbortError") {
          Zotero.debug(
            `[${config.addonName}] Unable to link reference: ${err}`,
          );
        }
      });
    });

    const content = this.listEl.ownerDocument.createElement("div");
    content.classList.add("zinspire-ref-entry__content");

    const titleLink = this.listEl.ownerDocument.createElement("a");
    titleLink.classList.add("zinspire-ref-entry__title");
    titleLink.textContent = entry.displayText;
    titleLink.href = entry.inspireUrl || entry.fallbackUrl || "#";
    titleLink.addEventListener("click", (event) => {
      event.preventDefault();
      this.handleTitleClick(entry);
    });

    content.appendChild(titleLink);
    if (entry.summary) {
      const meta = this.listEl.ownerDocument.createElement("div");
      meta.classList.add("zinspire-ref-entry__meta");
      meta.textContent = entry.summary;
      content.appendChild(meta);
    }

    const textContainer = this.listEl.ownerDocument.createElement("div");
    textContainer.classList.add("zinspire-ref-entry__text");
    textContainer.append(marker, linkButton, content);
    row.appendChild(textContainer);
    this.rowCache.set(entry.id, row);
    return row;
  }

  private async handleLinkAction(entry: InspireReferenceEntry) {
    if (!this.currentItemID) {
      return;
    }
    if (!entry.localItemID) {
      this.showToast(getString("references-panel-toast-add-first"));
      return;
    }
    if (entry.isRelated) {
      this.showToast(getString("references-panel-toast-already-linked"));
      return;
    }
    await this.linkExistingReference(entry.localItemID);
    entry.isRelated = true;
    this.renderReferenceList();
  }

  private async handleTitleClick(entry: InspireReferenceEntry) {
    if (entry.localItemID) {
      const pane = Zotero.getActiveZoteroPane();
      pane?.selectItems([entry.localItemID]);
      return;
    }
    if (entry.inspireUrl || entry.fallbackUrl) {
      Zotero.launchURL(entry.inspireUrl || entry.fallbackUrl!);
      return;
    }
    this.showToast(getString("references-panel-toast-missing"));
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
      entry.searchText = entry.displayText.toLowerCase();
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

    // Save current scroll position and view state for itemPane restoration
    const doc = this.body.ownerDocument;
    const previousScrollTop = this.listEl.scrollTop;
    const previousScrollLeft = this.listEl.scrollLeft;
    const previousActiveElement = doc.activeElement as Element | null;
    const isElementNode = (value: any): value is Element =>
      Boolean(value && typeof value === "object" && value.nodeType === 1);

    type ScrollSnapshot = { element: Element; top: number; left: number };
    const captureScrollSnapshots = () => {
      const snapshots: ScrollSnapshot[] = [];
      let current: Element | null = this.body;
      while (current) {
        const node = current as any;
        if (
          typeof node.scrollTop === "number" &&
          typeof node.scrollHeight === "number" &&
          typeof node.clientHeight === "number" &&
          node.scrollHeight > node.clientHeight
        ) {
          snapshots.push({
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
        snapshots.push({
          element: docElement,
          top: node.scrollTop ?? 0,
          left: node.scrollLeft ?? 0,
        });
      }
      return snapshots;
    };
    const scrollSnapshots = captureScrollSnapshots();

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
    await setInspireMeta(newItem, meta as jsobject, "full");
    await newItem.saveTx();
    this.rememberRecentTarget(target.primaryRowID);

    // Save scroll state so switching back to the original item restores the view
    if (originalItemID) {
      this.pendingScrollRestore = {
        itemID: originalItemID,
        scrollTop: previousScrollTop,
        scrollLeft: previousScrollLeft,
        scrollSnapshots,
        activeElement: previousActiveElement,
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

function extractAuthorNames(reference: any): string[] {
  if (Array.isArray(reference?.authors) && reference.authors.length) {
    return reference.authors
      .map((author: any) => author?.full_name)
      .filter(Boolean);
  }
  if (
    Array.isArray(reference?.collaborations) &&
    reference.collaborations.length
  ) {
    return reference.collaborations.filter(Boolean);
  }
  return [];
}

function buildPublicationSummary(info?: any) {
  if (!info) {
    return undefined;
  }
  const parts: string[] = [];
  if (info.journal_title) {
    parts.push(info.journal_title);
  }
  if (info.journal_volume) {
    parts.push(info.journal_volume);
  }
  if (info.year) {
    parts.push(`(${info.year})`);
  }
  if (info.artid) {
    parts.push(info.artid);
  } else if (info.page_start) {
    parts.push(
      info.page_end ? `${info.page_start}-${info.page_end}` : info.page_start,
    );
  }
  return parts.length ? parts.join(" ") : undefined;
}

function buildReferenceUrl(reference: any, recid?: string | null) {
  if (recid) {
    return `https://inspirehep.net/literature/${recid}`;
  }
  if (Array.isArray(reference?.urls) && reference.urls.length) {
    return reference.urls[0].value;
  }
  return buildFallbackUrl(reference);
}

function buildFallbackUrl(reference: any) {
  if (Array.isArray(reference?.dois) && reference.dois.length) {
    return `https://doi.org/${reference.dois[0]}`;
  }
  if (reference?.arxiv_eprint) {
    return `https://arxiv.org/abs/${reference.arxiv_eprint}`;
  }
  return undefined;
}

function formatAuthors(authors: string[]) {
  if (!authors.length) {
    return getString("references-panel-unknown-author");
  }
  const maxAuthors = getPref("max_authors") as number || 3;
  if (authors.length > maxAuthors) {
    return `${authors[0]} et al.`;
  }
  return authors.join(", ");
}

function buildDisplayText(entry: InspireReferenceEntry) {
  const label = entry.label ? `[${entry.label}] ` : "";
  return `${label}${entry.authorText} (${entry.year}): ${entry.title};`;
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

type jsobject = {
  [key: string]: any;
};
export class ZInspire {
  current: number;
  toUpdate: number;
  itemsToUpdate: Zotero.Item[];
  numberOfUpdatedItems: number;
  counter: number;
  CrossRefcounter: number;
  error_norecid: boolean;
  error_norecid_shown: boolean;
  final_count_shown: boolean;
  progressWindow: ProgressWindowHelper;
  constructor(
    current: number = -1,
    toUpdate: number = 0,
    itemsToUpdate: Zotero.Item[] = [],
    numberOfUpdatedItems: number = 0,
    counter: number = 0,
    CrossRefcounter: number = 0,
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
          if (getPref("tag_enable") && getPref("tag_norecid") !== "") {
            // progressWindowNoRecid.ItemProgress.setText("No INSPIRE recid was found for some items. These have been tagged with '" + getPref("tag_norecid") + "'.")
            progressWindowNoRecid.createLine({
              icon: icon,
              text:
                "No INSPIRE recid was found for some items. These have been tagged with '" +
                getPref("tag_norecid") +
                "'.",
            });
          } else {
            // progressWindowNoRecid.ItemProgress.setText("No INSPIRE recid was found for some items.")
            progressWindowNoRecid.createLine({
              icon: icon,
              text: "No INSPIRE recid was found for some items.",
            });
          }
          progressWindowNoRecid.show();
          progressWindowNoRecid.startCloseTimer(8000);
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
    // don't update note items
    const items = items0.filter((item) => item.isRegularItem());

    if (items.length === 0 || this.numberOfUpdatedItems < this.toUpdate) {
      return;
    }

    this.resetState("initial");
    this.toUpdate = items.length;
    this.itemsToUpdate = items;

    // Progress Windows
    this.progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: false,
    });
    const icon =
      "chrome://zotero/skin/toolbar-advanced-search" +
      // @ts-ignore - Plugin instance is not typed
      (Zotero.hiDPI ? "@2x" : "") +
      ".png";
    if (operation === "full" || operation === "noabstract") {
      this.progressWindow.changeHeadline("Getting INSPIRE metadata", icon);
    }
    if (operation === "citations") {
      this.progressWindow.changeHeadline(
        "Getting INSPIRE citation counts",
        icon,
      );
    }
    const inspireIcon =
      `chrome://${config.addonRef}/content/icons/inspire` +
      // @ts-ignore - Plugin instance is not typed
      (Zotero.hiDPI ? "@2x" : "") +
      ".png";
    this.progressWindow.createLine({
      text: "Retrieving INSPIRE metadata.",
      icon: inspireIcon,
    });
    this.updateNextItem(operation);
  }

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
        item.saveTx();
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
    urlInspire = "https://inspirehep.net/api/" + idtype + "/" + edoi;
  } else if (searchOrNot === 1) {
    const citekey = (extra.match(/^.*Citation\sKey:.*$/gm) || "")[0].split(
      ": ",
    )[1];
    urlInspire =
      "https://inspirehep.net/api/literature?q=texkey%20" +
      encodeURIComponent(citekey);
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

async function fetchRecidFromInspire(item: Zotero.Item) {
  const meta = (await getInspireMeta(item, "literatureLookup")) as
    | jsobject
    | -1;
  if (meta === -1 || typeof meta !== "object") {
    return null;
  }
  return meta.recid as string | undefined | null;
}

async function fetchInspireMetaByRecid(
  recid: string,
  signal?: AbortSignal,
  operation: string = "full",
  minimal: boolean = false,
) {
  let url = `https://inspirehep.net/api/literature/${encodeURIComponent(recid)}`;
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
      metaInspire.urlArxiv = "https://arxiv.org/abs/" + metaInspire.arxiv.value;
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

    metaInspire.title = meta["titles"]?.[0]?.title;
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
    const url = "https://api.crossref.org/works/" + edoi + "/" + xform;
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
          item.setField("url", "https://doi.org/" + metaInspire.DOI);
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

      // for erratum, added by FK Guo, date: 2023-08-27
      // Zotero.debug(`++++metaInspire.note: ${metaInspire.note}`)
      if (metaInspire.note && metaInspire.note !== "[]") {
        // Only create note if item is already saved (has an ID)
        // For new items, note creation should be handled after item.saveTx()
        if (item.id) {
          const noteIDs = item.getNotes();
          // check whether the same erratum note is already there
          let errTag = false;
          for (const id of noteIDs) {
            const note = Zotero.Items.get(id);
            const noteHTML = note.getNote().replace("–", "-").replace("--", "-");
            if (noteHTML.includes(metaInspire.note)) {
              errTag = true;
            }
            // Zotero.debug(`=======+++++++ ${id} : ${errTag}`)
          }
          if (!errTag) {
            const newNote = new Zotero.Item("note");
            newNote.setNote(metaInspire.note);
            newNote.parentID = item.id;
            await newNote.saveTx();
          }
        }
      }

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

