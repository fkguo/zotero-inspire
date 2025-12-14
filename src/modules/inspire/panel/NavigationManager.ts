// ─────────────────────────────────────────────────────────────────────────────
// NavigationManager - Navigation history for References Panel
// Extracted from InspireReferencePanelController as part of controller refactoring
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getPref } from "../../../utils/prefs";
import {
  NAVIGATION_STACK_LIMIT,
  type ScrollSnapshot,
  type ScrollState,
  type NavigationSnapshot,
  type InspireViewMode,
  ReaderTabHelper,
} from "../index";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Navigation state for external access.
 */
export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isNavigating: boolean;
}

/**
 * Current context needed for navigation operations.
 */
export interface NavigationContext {
  currentItemID?: number;
  currentRecid?: string;
  currentTabType: "library" | "reader";
  currentReaderTabID?: string;
}

/**
 * Options for NavigationManager initialization.
 */
export interface NavigationManagerOptions {
  /** Callback to get list element for scroll capture */
  getListElement: () => HTMLElement | undefined;
  /** Callback to get body element for scroll hierarchy capture */
  getBodyElement: () => HTMLElement | undefined;
  /** Callback when navigation state changes */
  onStateChange?: () => void;
  /** Callback when navigation completes and scroll should be restored */
  onScrollRestore?: (scrollState: ScrollState, itemID: number) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// NavigationManager Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages navigation history for the References Panel.
 * Handles back/forward navigation between Zotero items with scroll state preservation.
 *
 * This is a shared (static) manager because navigation state must be synchronized
 * across all panel instances.
 */
export class NavigationManager {
  // Shared navigation state (static because navigation spans all instances)
  private static backStack: NavigationSnapshot[] = [];
  private static forwardStack: NavigationSnapshot[] = [];
  private static isNavigating = false;
  private static pendingScrollRestore?: ScrollState & { itemID: number };
  private static instances = new Set<NavigationManager>();

  // Instance-specific
  private options: NavigationManagerOptions;
  private pendingLocalScrollRestore?: ScrollState & { itemID: number };

  constructor(options: NavigationManagerOptions) {
    this.options = options;
    NavigationManager.instances.add(this);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the current navigation state.
   */
  getState(): NavigationState {
    return {
      canGoBack: NavigationManager.backStack.length > 0,
      canGoForward: NavigationManager.forwardStack.length > 0,
      isNavigating: NavigationManager.isNavigating,
    };
  }

  /**
   * Check if back navigation is available.
   */
  canGoBack(): boolean {
    return (
      NavigationManager.backStack.length > 0 && !NavigationManager.isNavigating
    );
  }

  /**
   * Check if forward navigation is available.
   */
  canGoForward(): boolean {
    return (
      NavigationManager.forwardStack.length > 0 &&
      !NavigationManager.isNavigating
    );
  }

  /**
   * Remember current item before navigating away.
   * Call this before switching to a different Zotero item.
   */
  rememberCurrentItem(context: NavigationContext): void {
    if (!context.currentItemID || NavigationManager.isNavigating) {
      return;
    }

    const stack = NavigationManager.backStack;
    const last = stack[stack.length - 1];

    // Don't push duplicate entries
    if (last?.itemID === context.currentItemID) {
      return;
    }

    // Capture live tab state for accurate snapshot
    const liveTabType = ReaderTabHelper.getSelectedTabType();
    const liveReaderTabID =
      liveTabType === "reader" ? ReaderTabHelper.getSelectedTabID() : undefined;

    // Also try to find reader tab by parent item's attachments
    const readerTabID =
      liveReaderTabID ||
      ReaderTabHelper.getReaderTabIDForParentItem(context.currentItemID) ||
      context.currentReaderTabID;

    const scrollState = this.captureScrollState();
    const finalTabType =
      liveTabType === "reader" ? "reader" : context.currentTabType;

    stack.push({
      itemID: context.currentItemID,
      recid: context.currentRecid,
      scrollState,
      tabType: finalTabType,
      readerTabID: readerTabID,
    });

    // Enforce stack limit
    if (stack.length > NAVIGATION_STACK_LIMIT) {
      stack.shift();
    }

    // Clear forward stack on new navigation
    NavigationManager.forwardStack = [];
    this.notifyStateChange();
  }

  /**
   * Navigate back to the previous item.
   * Returns the target item ID if navigation was initiated, undefined otherwise.
   */
  async goBack(context: NavigationContext): Promise<number | undefined> {
    const stack = NavigationManager.backStack;
    if (!stack.length) {
      return undefined;
    }

    const pane = Zotero.getActiveZoteroPane();
    if (!pane) {
      return undefined;
    }

    // Save current state to forward stack
    const currentSnapshot = this.captureNavigationSnapshot(context);
    if (currentSnapshot) {
      NavigationManager.forwardStack.push(currentSnapshot);
      if (NavigationManager.forwardStack.length > NAVIGATION_STACK_LIMIT) {
        NavigationManager.forwardStack.shift();
      }
    }

    // Clear pending scroll restore
    NavigationManager.pendingScrollRestore = undefined;

    // Find a valid snapshot to navigate to
    while (stack.length) {
      const snapshot = stack.pop();
      if (!snapshot) {
        break;
      }

      const targetItem = Zotero.Items.get(snapshot.itemID);
      if (!targetItem) {
        continue; // Skip invalid items
      }

      NavigationManager.isNavigating = true;
      NavigationManager.pendingScrollRestore = {
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
          this.notifyStateChange();
          return snapshot.itemID;
        }

        // Reader tab was closed - try to reopen if setting is enabled
        if (getPref("reader_auto_reopen")) {
          await this.reopenReaderTab(snapshot);
          this.notifyStateChange();
          return snapshot.itemID;
        }
      }

      // Fallback: select item in library
      pane.selectItems([snapshot.itemID]);
      this.notifyStateChange();
      return snapshot.itemID;
    }

    this.notifyStateChange();
    return undefined;
  }

  /**
   * Navigate forward to the next item.
   * Returns the target item ID if navigation was initiated, undefined otherwise.
   */
  async goForward(context: NavigationContext): Promise<number | undefined> {
    const stack = NavigationManager.forwardStack;
    if (!stack.length) {
      return undefined;
    }

    const pane = Zotero.getActiveZoteroPane();
    if (!pane) {
      return undefined;
    }

    // Save current state to back stack
    const currentSnapshot = this.captureNavigationSnapshot(context);
    if (currentSnapshot) {
      NavigationManager.backStack.push(currentSnapshot);
      if (NavigationManager.backStack.length > NAVIGATION_STACK_LIMIT) {
        NavigationManager.backStack.shift();
      }
    }

    // Clear pending scroll restore
    NavigationManager.pendingScrollRestore = undefined;

    // Find a valid snapshot to navigate to
    while (stack.length) {
      const snapshot = stack.pop();
      if (!snapshot) {
        break;
      }

      const targetItem = Zotero.Items.get(snapshot.itemID);
      if (!targetItem) {
        continue; // Skip invalid items
      }

      NavigationManager.isNavigating = true;
      NavigationManager.pendingScrollRestore = {
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
          this.notifyStateChange();
          return snapshot.itemID;
        }

        // Reader tab was closed - try to reopen if setting is enabled
        if (getPref("reader_auto_reopen")) {
          await this.reopenReaderTab(snapshot);
          this.notifyStateChange();
          return snapshot.itemID;
        }
      }

      // Fallback: select item in library
      pane.selectItems([snapshot.itemID]);
      this.notifyStateChange();
      return snapshot.itemID;
    }

    this.notifyStateChange();
    return undefined;
  }

  /**
   * Clear navigation history after the navigation flag is used.
   * Should be called after item change handling completes.
   */
  clearNavigatingFlag(): void {
    NavigationManager.isNavigating = false;
  }

  /**
   * Check if we are currently in navigation mode.
   */
  isNavigating(): boolean {
    return NavigationManager.isNavigating;
  }

  /**
   * Get and clear the pending scroll restore state.
   * Returns the scroll state if there's a pending restore for the given item.
   */
  getPendingScrollRestore(
    itemID: number,
  ): (ScrollState & { itemID: number }) | undefined {
    // Check instance-specific first
    if (this.pendingLocalScrollRestore?.itemID === itemID) {
      const result = this.pendingLocalScrollRestore;
      this.pendingLocalScrollRestore = undefined;
      return result;
    }

    // Check shared
    if (NavigationManager.pendingScrollRestore?.itemID === itemID) {
      const result = NavigationManager.pendingScrollRestore;
      NavigationManager.pendingScrollRestore = undefined;
      return result;
    }

    return undefined;
  }

  /**
   * Set a pending scroll restore for the current instance.
   */
  setPendingScrollRestore(itemID: number, scrollState: ScrollState): void {
    this.pendingLocalScrollRestore = {
      itemID,
      ...scrollState,
    };
  }

  /**
   * Clear all navigation history.
   */
  static clearHistory(): void {
    NavigationManager.backStack = [];
    NavigationManager.forwardStack = [];
    NavigationManager.isNavigating = false;
    NavigationManager.pendingScrollRestore = undefined;

    // Notify all instances
    for (const instance of NavigationManager.instances) {
      instance.notifyStateChange();
    }
  }

  /**
   * Cleanup this manager instance.
   */
  destroy(): void {
    NavigationManager.instances.delete(this);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Scroll State
  // ─────────────────────────────────────────────────────────────────────────────

  private captureScrollState(): ScrollState {
    const listEl = this.options.getListElement();
    const body = this.options.getBodyElement();

    if (!listEl || !body) {
      return {
        scrollTop: 0,
        scrollLeft: 0,
        scrollSnapshots: [],
        activeElement: null,
      };
    }

    const doc = body.ownerDocument;
    const isElementNode = (value: unknown): value is Element =>
      Boolean(
        value && typeof value === "object" && (value as Node).nodeType === 1,
      );

    const scrollSnapshots: ScrollSnapshot[] = [];
    let current: Element | null = body;

    // Capture scroll positions of all scrollable ancestors
    while (current) {
      const node = current as HTMLElement;
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

    // Also capture document-level scroll
    const docElement =
      doc.scrollingElement ||
      (doc as Document).documentElement ||
      doc.body ||
      null;

    if (isElementNode(docElement)) {
      const node = docElement as HTMLElement;
      scrollSnapshots.push({
        element: docElement,
        top: node.scrollTop ?? 0,
        left: node.scrollLeft ?? 0,
      });
    }

    return {
      scrollTop: listEl.scrollTop,
      scrollLeft: listEl.scrollLeft,
      scrollSnapshots,
      activeElement: doc.activeElement as Element | null,
    };
  }

  private captureNavigationSnapshot(
    context: NavigationContext,
  ): NavigationSnapshot | null {
    if (!context.currentItemID) {
      return null;
    }

    // Capture live tab state for accurate snapshot
    const liveTabType = ReaderTabHelper.getSelectedTabType();
    const liveReaderTabID =
      liveTabType === "reader"
        ? ReaderTabHelper.getSelectedTabID() ||
          ReaderTabHelper.getReaderTabIDForParentItem(context.currentItemID)
        : undefined;

    return {
      itemID: context.currentItemID,
      recid: context.currentRecid,
      scrollState: this.captureScrollState(),
      tabType: liveTabType === "reader" ? "reader" : context.currentTabType,
      readerTabID: liveReaderTabID || context.currentReaderTabID,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Reader Tab Handling
  // ─────────────────────────────────────────────────────────────────────────────

  private async reopenReaderTab(snapshot: NavigationSnapshot): Promise<void> {
    if (
      !snapshot.itemID ||
      !Zotero.Reader ||
      typeof Zotero.Reader.open !== "function"
    ) {
      return;
    }

    try {
      // Zotero.Reader.open expects an attachment ID, not the parent item ID
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
          `[${config.addonName}] NavigationManager: No attachment found for item ${snapshot.itemID}`,
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
        `[${config.addonName}] NavigationManager: Failed to reopen reader for item ${snapshot.itemID}: ${err}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: State Notification
  // ─────────────────────────────────────────────────────────────────────────────

  private notifyStateChange(): void {
    // Notify all instances
    for (const instance of NavigationManager.instances) {
      instance.options.onStateChange?.();
    }
  }
}
