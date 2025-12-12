import { config } from "../../../package.json";
import { SEARCH_HISTORY_PREF_KEY } from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// LRUCache - Least Recently Used Cache with size limit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache statistics for monitoring cache efficiency.
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Current cache size */
  size: number;
  /** Maximum cache size */
  maxSize: number;
}

/**
 * LRU (Least Recently Used) Cache implementation.
 * Extends Map with automatic eviction of least recently used entries when full.
 *
 * Features:
 * - O(1) get and set operations
 * - Automatic eviction when exceeding maxSize
 * - get() moves entry to "most recently used" position
 * - Built-in hit/miss statistics tracking
 */
export class LRUCache<K, V> extends Map<K, V> {
  private readonly maxSize: number;
  private _hits = 0;
  private _misses = 0;

  constructor(maxSize: number) {
    super();
    this.maxSize = maxSize;
  }

  /**
   * Get value and move to most recently used position.
   * Tracks hits and misses for statistics.
   */
  get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      this._hits++;
      // Move to end (most recently used) by re-inserting
      super.delete(key);
      super.set(key, value);
    } else {
      this._misses++;
    }
    return value;
  }

  /**
   * Set value, evicting oldest entry if at capacity.
   */
  set(key: K, value: V): this {
    // If key exists, delete it first to update position
    if (super.has(key)) {
      super.delete(key);
    }
    // Evict oldest entry if at capacity
    else if (this.size >= this.maxSize) {
      const oldestKey = this.keys().next().value;
      if (oldestKey !== undefined) {
        super.delete(oldestKey);
      }
    }
    return super.set(key, value);
  }

  /**
   * Check if key exists (doesn't update position - use get() for that).
   */
  has(key: K): boolean {
    return super.has(key);
  }

  /**
   * Peek at value without updating position or tracking statistics.
   */
  peek(key: K): V | undefined {
    return super.get(key);
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
      size: this.size,
      maxSize: this.maxSize,
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Get max size of this cache.
   */
  getMaxSize(): number {
    return this.maxSize;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ZInsUtils - Plugin Utilities
// ─────────────────────────────────────────────────────────────────────────────

export class ZInsUtils {
  static registerPrefs() {
    const prefOptions = {
      pluginID: config.addonID,
      src: rootURI + "content/preferences.xhtml",
      image: `chrome://${config.addonRef}/content/icons/inspire.svg`,
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

// ─────────────────────────────────────────────────────────────────────────────
// ReaderTabHelper - Reader Tab Utilities
// ─────────────────────────────────────────────────────────────────────────────

export class ReaderTabHelper {
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

// ─────────────────────────────────────────────────────────────────────────────
// History Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clear all search history.
 */
export function clearAllHistoryPrefs(): void {
  try {
    Zotero.Prefs.set(`${config.addonRef}.${SEARCH_HISTORY_PREF_KEY}`, "[]", true);
    Zotero.debug(`[${config.addonName}] Search history cleared`);
  } catch (err) {
    Zotero.debug(`[${config.addonName}] Failed to clear history: ${err}`);
  }
}

