import { getString } from "../utils/locale";
import type { AmbiguousCandidate } from "./inspire/pdfAnnotate/types";

// ─────────────────────────────────────────────────────────────────────────────
// Style helper functions for reference panel UI elements
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// FTR-CONSISTENT-UI: Unified button color constants for consistent styling
// ─────────────────────────────────────────────────────────────────────────────

/** Button colors for active state (dark mode) - use brighter color for better contrast */
const BUTTON_ACTIVE_BG_DARK = "#6b7280";
/** Button colors for active state (light mode) */
const BUTTON_ACTIVE_BG_LIGHT = "#475569";
/** Button colors for inactive state (dark mode) */
const BUTTON_INACTIVE_BG_DARK = "#2d2d30";
/** Button colors for inactive state (light mode) */
const BUTTON_INACTIVE_BG_LIGHT = "#e2e8f0";
/** Button text color for active state */
const BUTTON_ACTIVE_COLOR = "#ffffff";
/** Button text color for inactive state (dark mode) */
const BUTTON_INACTIVE_COLOR_DARK = "#9ca3af";
/** Button text color for inactive state (light mode) */
const BUTTON_INACTIVE_COLOR_LIGHT = "#475569";

/**
 * Apply unified pill button style for filter/toggle buttons.
 * This ensures consistent appearance across all filter buttons:
 * - Published Only button
 * - Author Filter button
 * - Excl. Self-Cit. button
 * - Year/Journal filter buttons
 *
 * @param el - Button element to style
 * @param isActive - Whether the button is in active/selected state
 * @param isDark - Whether dark mode is enabled
 */
export function applyPillButtonStyle(
  el: HTMLElement,
  isActive: boolean,
  isDark: boolean,
): void {
  // Base styles
  el.style.padding = "3px 10px";
  el.style.fontSize = "12px";
  el.style.borderRadius = "12px";
  el.style.border = "none";
  el.style.cursor = "pointer";
  el.style.transition = "background-color 0.15s ease, color 0.15s ease";
  el.style.whiteSpace = "nowrap";

  if (isActive) {
    el.style.background = isDark ? BUTTON_ACTIVE_BG_DARK : BUTTON_ACTIVE_BG_LIGHT;
    el.style.color = BUTTON_ACTIVE_COLOR;
  } else {
    el.style.background = isDark ? BUTTON_INACTIVE_BG_DARK : BUTTON_INACTIVE_BG_LIGHT;
    el.style.color = isDark ? BUTTON_INACTIVE_COLOR_DARK : BUTTON_INACTIVE_COLOR_LIGHT;
  }
}

/**
 * Apply inline styles to the reference entry text container (horizontal layout)
 */
export function applyRefEntryTextContainerStyle(el: HTMLElement): void {
  el.style.display = "flex";
  el.style.flexDirection = "row";
  el.style.alignItems = "flex-start";
  el.style.gap = "6px";

  const controls = el.querySelector(
    ".zinspire-ref-entry__controls",
  ) as HTMLElement | null;
  if (controls) {
    controls.style.display = "flex";
    controls.style.flexWrap = "wrap";
    controls.style.alignItems = "center";
    controls.style.alignContent = "flex-start";
    controls.style.justifyContent = "flex-end";
    controls.style.gap = "4px";
    controls.style.width = "56px";
    controls.style.flexShrink = "0";
  }
}

/**
 * Apply inline styles to the reference entry marker (dot indicator)
 */
export function applyRefEntryMarkerStyle(el: HTMLElement): void {
  el.style.flexShrink = "0";
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.width = "14px";
  el.style.height = "14px";
  el.style.fontSize = "12px";
  el.style.lineHeight = "1";
}

/**
 * Apply color to the marker based on local item presence
 */
export function applyRefEntryMarkerColor(
  el: HTMLElement,
  hasLocalItem: boolean,
): void {
  el.style.color = hasLocalItem ? "#1a8f4d" : "#d93025";
  el.style.opacity = "1";
}

/**
 * Apply inline styles to the reference entry link button
 */
export function applyRefEntryLinkButtonStyle(el: HTMLElement): void {
  el.style.flexShrink = "0";
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.width = "14px";
  el.style.height = "14px";
  el.style.border = "none";
  el.style.background = "transparent";
  el.style.padding = "0";
  el.style.cursor = "pointer";
}

/**
 * Apply inline styles to the reference entry content container
 */
export function applyRefEntryContentStyle(el: HTMLElement): void {
  el.style.flex = "1";
  el.style.minWidth = "0";
}

/**
 * Apply inline styles to clickable author name links.
 * Uses brighter blue in dark mode for better visibility.
 * @param el - The link element to style
 * @param isDark - Optional dark mode flag. If not provided, uses CSS variable.
 */
export function applyAuthorLinkStyle(el: HTMLElement, isDark?: boolean): void {
  el.style.cursor = "pointer";
  el.style.textDecoration = "none";
  // Use brighter blue in dark mode for better contrast
  if (isDark !== undefined) {
    el.style.color = isDark ? "#60a5fa" : "#0066cc";
  } else {
    // Fallback: use CSS variable that adapts to theme
    el.style.color = "var(--accent-color, #0066cc)";
  }
}

/**
 * Apply inline styles to clickable meta links (DOI/arXiv links in publication info).
 * Uses brighter blue in dark mode for better visibility.
 * @param el - The link element to style
 * @param isDark - Optional dark mode flag. If not provided, uses CSS variable.
 */
export function applyMetaLinkStyle(el: HTMLAnchorElement, isDark?: boolean): void {
  el.style.cursor = "pointer";
  el.style.textDecoration = "none";
  // Use brighter blue in dark mode for better contrast
  if (isDark !== undefined) {
    el.style.color = isDark ? "#60a5fa" : "#0066cc";
  } else {
    // Fallback: use CSS variable that adapts to theme
    el.style.color = "var(--accent-color, #0066cc)";
  }
}

/**
 * Apply styles to the tab button based on active state (pill button style)
 */
export function applyTabButtonStyle(el: HTMLElement, isActive: boolean): void {
  // Base styles applied to all tab buttons
  el.style.padding = "4px 12px";
  el.style.fontSize = "12px";
  el.style.borderRadius = "12px";
  el.style.cursor = "pointer";
  el.style.transition = "all 0.15s ease";
  el.style.whiteSpace = "nowrap";

  if (isActive) {
    // Active tab: primary color pill
    el.style.backgroundColor = "#0066cc";
    el.style.color = "#fff";
    el.style.fontWeight = "500";
    el.style.border = "1px solid #0066cc";
    el.style.boxShadow = "none";
  } else {
    // Inactive tab: outlined pill (clearly looks like a button)
    el.style.backgroundColor = "var(--material-background, #fff)";
    el.style.color = "var(--fill-secondary, #64748b)";
    el.style.fontWeight = "400";
    el.style.border = "1px solid var(--fill-quinary, #d1d5db)";
    el.style.boxShadow = "none";
  }
}

/**
 * Apply inline styles to the BibTeX copy button
 */
export function applyBibTeXButtonStyle(el: HTMLElement): void {
  el.style.flexShrink = "0";
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.width = "16px";
  el.style.height = "16px";
  el.style.border = "none";
  el.style.background = "transparent";
  el.style.padding = "0";
  el.style.cursor = "pointer";
  el.style.fontSize = "11px";
  el.style.color = "#666";
  el.style.opacity = "0.7";
  el.style.transition = "opacity 0.15s ease";
}

/**
 * Apply inline styles to the author profile card (Author Papers header).
 * FTR-CONSISTENT-UI: Use same background as chart container for consistency
 */
export function applyAuthorProfileCardStyle(el: HTMLElement): void {
  el.style.background = "var(--material-sidepane, #f8fafc)";
  el.style.border = "1px solid var(--fill-quaternary, #e2e8f0)";
  el.style.borderRadius = "6px";
  el.style.padding = "10px 12px";
  el.style.marginBottom = "8px";
}

/**
 * Apply inline styles to the author hover preview card.
 */
export function applyAuthorPreviewCardStyle(el: HTMLElement): void {
  el.style.position = "fixed";
  el.style.zIndex = "99999";
  el.style.minWidth = "220px";
  el.style.maxWidth = "320px";
  el.style.background = "var(--material-background, #fff)";
  el.style.border = "1px solid var(--fill-quaternary, #e2e8f0)";
  el.style.borderRadius = "6px";
  el.style.padding = "8px 10px";
  el.style.boxShadow = "0 6px 20px rgba(0, 0, 0, 0.12)";
  el.style.fontSize = "12px";
  el.style.color = "var(--fill-primary, #334155)";
  // Enable text selection and copy (Ctrl/Cmd+C) - consistent with PDF preview card
  el.style.userSelect = "text";
  el.style.cursor = "auto";
}

/**
 * Attach right-click to copy functionality to a link element.
 * Updates tooltip to show value and enables copying on right-click.
 *
 * @param el - Link element to enhance
 * @param value - Value to copy (e.g., ORCID ID, BAI)
 * @param copiedText - Localized "Copied" text for feedback
 */
export function attachCopyableValue(
  el: HTMLElement,
  value: string,
  copiedText: string,
): void {
  // Update tooltip to show actual value with copy hint
  el.title = `${value} — Right-click to copy`;

  // Right-click to copy
  el.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      // Use Zotero's clipboard API for better compatibility
      const clipboardService = (Components.classes as any)[
        "@mozilla.org/widget/clipboardhelper;1"
      ]?.getService(Components.interfaces.nsIClipboardHelper);
      if (clipboardService) {
        clipboardService.copyString(value);
      } else {
        // Fallback to navigator.clipboard
        await navigator.clipboard.writeText(value);
      }
      // Show feedback via tooltip change
      const originalTitle = el.title;
      const originalText = el.textContent;
      el.textContent = `✓ ${copiedText}`;
      el.style.color = "#1a8f4d";
      setTimeout(() => {
        el.textContent = originalText;
        el.style.color = "";
        el.title = originalTitle;
      }, 1500);
    } catch (err) {
      Zotero.debug(`[zoteroinspire] Copy failed: ${err}`);
    }
  });
}

/**
 * Apply styles to the abstract tooltip container
 * Uses a soft blue-gray background that is easy on the eyes
 */
export function applyAbstractTooltipStyle(el: HTMLElement): void {
  el.style.position = "fixed";
  el.style.zIndex = "99999";
  el.style.maxWidth = "450px";
  el.style.maxHeight = "350px";
  el.style.overflowY = "auto";
  el.style.scrollbarGutter = "stable both-edges";
  el.style.padding = "12px 14px";
  el.style.paddingRight = "18px";
  // Soft blue-gray background - easy on the eyes, professional look
  el.style.backgroundColor = "#f0f4f8";
  el.style.color = "#1a2a3a";
  el.style.border = "1px solid #c8d4e0";
  el.style.borderRadius = "8px";
  el.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.15)";
  el.style.fontSize = "13px";
  el.style.lineHeight = "1.6";
  // Allow pointer events so user can scroll the tooltip
  el.style.pointerEvents = "auto";
  el.style.wordWrap = "break-word";
  el.style.whiteSpace = "pre-wrap";
  el.style.display = "none";
  // Smooth scrollbar styling
  el.style.scrollbarWidth = "thin";
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover Preview Card Styles (FTR-HOVER-PREVIEW)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply styles to the hover preview card container
 * Shows detailed paper information when hovering over a reference row
 */
export function applyPreviewCardStyle(el: HTMLElement): void {
  el.style.position = "fixed";
  el.style.zIndex = "99999";
  el.style.maxWidth = "420px";
  el.style.minWidth = "320px";
  el.style.maxHeight = "400px";
  el.style.overflowY = "auto";
  el.style.padding = "12px 14px";
  el.style.backgroundColor = "var(--material-background, #fff)";
  el.style.color = "var(--fill-primary, #1a2a3a)";
  el.style.border = "1px solid var(--fill-quinary, #c8d4e0)";
  el.style.borderRadius = "8px";
  el.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.15)";
  el.style.fontSize = "13px";
  el.style.lineHeight = "1.5";
  el.style.pointerEvents = "auto";
  el.style.display = "none";
  el.style.scrollbarWidth = "thin";
  // Enable text selection and copy (Ctrl/Cmd+C)
  el.style.userSelect = "text";
  el.style.cursor = "auto";
}

/**
 * Apply styles to preview card title
 */
export function applyPreviewCardTitleStyle(el: HTMLElement): void {
  el.style.fontSize = "14px";
  el.style.fontWeight = "600";
  el.style.lineHeight = "1.4";
  el.style.marginBottom = "8px";
  el.style.color = "var(--fill-primary, #1a2a3a)";
  el.style.wordWrap = "break-word";
}

/**
 * Apply styles to preview card section (authors, publication info, etc.)
 */
export function applyPreviewCardSectionStyle(el: HTMLElement): void {
  el.style.fontSize = "12px";
  el.style.lineHeight = "1.4";
  el.style.marginBottom = "6px";
  el.style.color = "var(--fill-secondary, #4a5568)";
}

/**
 * Apply styles to preview card identifiers row (arXiv, DOI)
 */
export function applyPreviewCardIdentifiersStyle(el: HTMLElement): void {
  el.style.fontSize = "12px";
  el.style.marginBottom = "6px";
  el.style.display = "flex";
  el.style.flexWrap = "wrap";
  el.style.gap = "8px";
  el.style.alignItems = "center";
}

/**
 * Apply styles to preview card abstract
 */
export function applyPreviewCardAbstractStyle(el: HTMLElement): void {
  el.style.fontSize = "12px";
  el.style.lineHeight = "1.5";
  el.style.color = "var(--fill-secondary, #4a5568)";
  el.style.marginTop = "8px";
  el.style.paddingTop = "8px";
  el.style.borderTop = "1px solid var(--fill-quinary, #e2e8f0)";
  el.style.fontStyle = "italic";
}

// ─────────────────────────────────────────────────────────────────────────────
// Save target picker UI
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveTargetRow {
  id: string;
  name: string;
  level: number;
  type: "library" | "collection";
  libraryID: number;
  collectionID?: number;
  filesEditable: boolean;
  parentID?: string;
  recent?: boolean;
}

export interface SaveTargetSelection {
  libraryID: number;
  primaryRowID: string;
  collectionIDs: number[];
  tags: string[];
  note: string;
}

export function showTargetPickerUI(
  targets: SaveTargetRow[],
  defaultID: string | null,
  anchor: HTMLElement,
  body: HTMLElement,
  listEl: HTMLElement,
): Promise<SaveTargetSelection | null> {
  return new Promise((resolve) => {
    const doc = body.ownerDocument;

    const previousScrollTop = listEl.scrollTop;
    const previousScrollLeft = listEl.scrollLeft;
    const previousActiveElement = doc.activeElement as Element | null;
    const isElementNode = (value: any): value is Element =>
      Boolean(value && typeof value === "object" && value.nodeType === 1);

    type ScrollSnapshot = { element: Element; top: number; left: number };
    const captureScrollSnapshots = () => {
      const snapshots: ScrollSnapshot[] = [];
      let current: Element | null = body;
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

    const restoreViewState = () => {
      listEl.scrollTop = previousScrollTop;
      listEl.scrollLeft = previousScrollLeft;
      for (const snapshot of scrollSnapshots) {
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
        previousActiveElement &&
        typeof (previousActiveElement as any).focus === "function"
      ) {
        try {
          (previousActiveElement as any).focus();
        } catch (_err) {
          // Ignore focus restoration issues
        }
      }
    };

    const overlay = doc.createElement("div");
    overlay.classList.add("zinspire-collection-picker__overlay");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.zIndex = "10000";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.3)";
    overlay.style.transition = "background-color 0.2s ease";

    const panel = doc.createElement("div");
    panel.classList.add("zinspire-collection-picker");
    panel.style.position = "absolute";
    panel.style.margin = "0";
    panel.style.maxHeight = "400px";
    panel.style.minHeight = "200px";
    panel.style.overflowY = "hidden"; // Handle scroll inside list
    panel.style.backgroundColor = "var(--material-background, #fff)";
    panel.style.color = "var(--material-color, #000)";
    panel.style.border = "1px solid var(--material-border, #ccc)";
    panel.style.borderRadius = "6px";
    panel.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.25)";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.fontSize = "14px";
    panel.style.width = "400px";
    // Custom resize implementation instead of CSS resize
    // panel.style.resize = "both";
    // panel.style.overflow = "hidden";
    panel.style.lineHeight = "1.25";

    overlay.appendChild(panel);

    // Resize handles helper
    const addResizeHandle = (cursor: string, type: string) => {
      const handle = doc.createElement("div");
      handle.style.position = "absolute";
      handle.style.zIndex = "10001"; // Above content
      handle.style.cursor = cursor;

      if (type === "w") {
        handle.style.left = "0";
        handle.style.top = "0";
        handle.style.bottom = "0";
        handle.style.width = "6px";
      } else if (type === "e") {
        handle.style.right = "0";
        handle.style.top = "0";
        handle.style.bottom = "0";
        handle.style.width = "6px";
      } else if (type === "s") {
        handle.style.left = "0";
        handle.style.right = "0";
        handle.style.bottom = "0";
        handle.style.height = "6px";
      } else if (type === "sw") {
        handle.style.left = "0";
        handle.style.bottom = "0";
        handle.style.width = "10px";
        handle.style.height = "10px";
        handle.style.zIndex = "10002";
      } else if (type === "se") {
        handle.style.right = "0";
        handle.style.bottom = "0";
        handle.style.width = "10px";
        handle.style.height = "10px";
        handle.style.zIndex = "10002";
      }

      panel.appendChild(handle);

      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = panel.offsetWidth;
        const startHeight = panel.offsetHeight;
        const startLeft = panel.offsetLeft;

        // Ensure bottom constraint is removed before resizing height
        if (type.includes("s") && panel.style.bottom) {
          const rect = panel.getBoundingClientRect();
          panel.style.bottom = "auto";
          panel.style.top = `${rect.top}px`;
        }

        const onResizeMove = (e: MouseEvent) => {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;

          if (type.includes("e")) {
            panel.style.width = `${Math.max(250, startWidth + dx)}px`;
          }
          if (type.includes("s")) {
            panel.style.height = `${Math.max(200, startHeight + dy)}px`;
            panel.style.maxHeight = "none";
          }
          if (type.includes("w")) {
            const newWidth = Math.max(250, startWidth - dx);
            if (newWidth !== startWidth) {
              panel.style.width = `${newWidth}px`;
              // Adjust left position to make it look like resizing from left
              // New left = Old left + (Old width - New width)
              panel.style.left = `${startLeft + (startWidth - newWidth)}px`;
            }
          }
        };

        const onResizeEnd = () => {
          doc.removeEventListener("mousemove", onResizeMove);
          doc.removeEventListener("mouseup", onResizeEnd);
        };

        doc.addEventListener("mousemove", onResizeMove);
        doc.addEventListener("mouseup", onResizeEnd);
      });
    };

    // Position relative to anchor
    // Ensure minimum distance from top of viewport so header is always visible
    const rect = anchor.getBoundingClientRect();
    const viewportHeight = doc.documentElement.clientHeight;
    const viewportWidth = doc.documentElement.clientWidth;
    const panelWidth = 400;
    const panelMinHeight = 300; // Approximate minimum height for usability
    const minTop = 10; // Minimum distance from viewport top

    let left = Math.max(10, rect.left - 20);
    if (left + panelWidth > viewportWidth) {
      left = Math.max(10, viewportWidth - panelWidth - 40);
    }

    // Calculate preferred position (below anchor)
    let calculatedTop = rect.bottom + 5;

    // Check if popup fits below the anchor
    const fitsBelow = calculatedTop + panelMinHeight <= viewportHeight;
    // Check if popup would fit above the anchor
    const fitsAbove = rect.top - panelMinHeight - 5 >= minTop;

    if (fitsBelow) {
      // Position below anchor, but ensure minimum top
      panel.style.top = `${Math.max(minTop, calculatedTop)}px`;
      panel.style.left = `${left}px`;
    } else if (fitsAbove) {
      // Position above anchor using bottom positioning
      const bottom = viewportHeight - rect.top + 5;
      panel.style.top = "auto";
      panel.style.bottom = `${bottom}px`;
      panel.style.left = `${left}px`;
    } else {
      // Not enough space above or below - center vertically and ensure header visible
      const centeredTop = Math.max(minTop, (viewportHeight - panelMinHeight) / 2);
      panel.style.top = `${centeredTop}px`;
      panel.style.left = `${left}px`;
    }

    body.appendChild(overlay);

    // Add resize handles after appending panel to DOM
    addResizeHandle("w-resize", "w");
    addResizeHandle("e-resize", "e");
    addResizeHandle("s-resize", "s");
    addResizeHandle("sw-resize", "sw");
    addResizeHandle("se-resize", "se");

    const header = doc.createElement("div");
    header.classList.add("zinspire-collection-picker__header");
    header.textContent = getString("references-panel-picker-title");
    header.style.padding = "8px 12px";
    header.style.fontWeight = "600";
    header.style.borderBottom = "1px solid var(--material-border, #eee)";
    header.style.backgroundColor = "var(--material-side-background, #f5f5f5)";
    header.style.borderRadius = "6px 6px 0 0";
    header.style.cursor = "move"; // Indicate draggable
    panel.appendChild(header);

    // Drag logic
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onDragStart = (e: MouseEvent) => {
      if (e.target !== header) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = panel.offsetLeft;
      startTop = panel.offsetTop;

      // Remove bottom constraint if set, switch to top
      if (panel.style.bottom) {
        const rect = panel.getBoundingClientRect();
        panel.style.bottom = "auto";
        panel.style.top = `${rect.top}px`;
        startTop = rect.top;
      }

      doc.addEventListener("mousemove", onDragMove);
      doc.addEventListener("mouseup", onDragEnd);
      e.preventDefault();
    };

    const onDragMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${startLeft + dx}px`;
      panel.style.top = `${startTop + dy}px`;
    };

    const onDragEnd = () => {
      isDragging = false;
      doc.removeEventListener("mousemove", onDragMove);
      doc.removeEventListener("mouseup", onDragEnd);
    };

    header.addEventListener("mousedown", onDragStart);

    const filterInput = doc.createElement("input");
    filterInput.classList.add("zinspire-collection-picker__filter");
    filterInput.placeholder = getString("references-panel-picker-filter");
    filterInput.style.margin = "8px 12px";
    filterInput.style.padding = "4px 8px";
    panel.appendChild(filterInput);

    const list = doc.createElement("div");
    list.classList.add("zinspire-collection-picker__list");
    list.style.flex = "1";
    list.style.overflowY = "auto";
    list.style.minHeight = "100px";
    list.style.borderTop = "1px solid var(--material-border, #eee)";
    list.style.borderBottom = "1px solid var(--material-border, #eee)";

    // Flex layout for compact items
    list.style.display = "flex";
    list.style.flexWrap = "wrap";
    list.style.alignContent = "flex-start";
    list.style.gap = "4px";
    list.style.padding = "8px";

    panel.appendChild(list);

    const options = doc.createElement("div");
    options.classList.add("zinspire-collection-picker__options");
    options.style.padding = "8px 12px";
    options.style.borderTop = "1px solid var(--material-border, #eee)";
    options.style.backgroundColor = "var(--material-side-background, #f5f5f5)";
    options.style.display = "flex";
    options.style.flexDirection = "column";
    options.style.gap = "8px";

    const tagsWrapper = doc.createElement("div");
    tagsWrapper.classList.add("zinspire-collection-picker__tags-wrapper");
    tagsWrapper.style.position = "relative";
    tagsWrapper.style.width = "100%";

    const tagsInput = doc.createElement("input");
    tagsInput.classList.add("zinspire-collection-picker__tags");
    const tagsPlaceholder = getString("references-panel-picker-tags");
    tagsInput.placeholder = tagsPlaceholder || "Tags (comma separated)";
    tagsInput.title = getString("references-panel-picker-tags-title");
    tagsInput.style.width = "100%";
    tagsInput.style.padding = "4px 8px";
    tagsInput.style.fontSize = "13px";
    tagsInput.style.boxSizing = "border-box";
    tagsInput.setAttribute("list", "zinspire-tags-datalist");
    tagsWrapper.appendChild(tagsInput);

    const tagsSuggestionPanel = doc.createElement("div");
    tagsSuggestionPanel.classList.add(
      "zinspire-collection-picker__tags-autocomplete",
    );
    tagsSuggestionPanel.style.position = "absolute";
    tagsSuggestionPanel.style.left = "0";
    tagsSuggestionPanel.style.right = "0";
    tagsSuggestionPanel.style.top = "calc(100% + 2px)";
    tagsSuggestionPanel.style.backgroundColor =
      "var(--material-background, #fff)";
    tagsSuggestionPanel.style.border = "1px solid var(--material-border, #ccc)";
    tagsSuggestionPanel.style.borderRadius = "4px";
    tagsSuggestionPanel.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)";
    tagsSuggestionPanel.style.display = "none";
    tagsSuggestionPanel.style.maxHeight = "180px";
    tagsSuggestionPanel.style.overflowY = "auto";
    tagsSuggestionPanel.style.zIndex = "100";
    tagsSuggestionPanel.style.padding = "4px 0";
    tagsWrapper.appendChild(tagsSuggestionPanel);

    // Ensure placeholder is visible (might be white on white depending on theme)
    // tagsInput.style.color = "inherit";
    // tagsInput.style.backgroundColor = "inherit";

    // Use HTML namespace for datalist to ensure it works in XHTML context (Zotero 7)
    const HTML_NS = "http://www.w3.org/1999/xhtml";
    const tagsDataList = doc.createElementNS(
      HTML_NS,
      "datalist",
    ) as HTMLDataListElement;
    tagsDataList.id = "zinspire-tags-datalist";

    const MAX_TAG_SUGGESTIONS = 8;
    const tagCandidates: string[] = [];
    const lowerCaseTagNames = new Set<string>();
    let visibleTagSuggestions: string[] = [];
    let activeTagSuggestionIndex = -1;

    const hideTagSuggestions = () => {
      visibleTagSuggestions = [];
      activeTagSuggestionIndex = -1;
      tagsSuggestionPanel.style.display = "none";
      tagsSuggestionPanel.textContent = "";
    };

    const refreshTagSuggestionHighlight = () => {
      Array.from(tagsSuggestionPanel.children).forEach((child, index) => {
        const button = child as HTMLButtonElement;
        if (index === activeTagSuggestionIndex) {
          button.style.backgroundColor = "var(--material-border, #e0e0e0)";
        } else {
          button.style.backgroundColor = "transparent";
        }
      });
    };

    const applyTagSuggestion = (value: string) => {
      const tokens = tagsInput.value.split(/[,;]/);
      if (!tokens.length) {
        tagsInput.value = value;
      } else {
        tokens[tokens.length - 1] = value;
        const normalized = tokens
          .map((token) => token.trim())
          .filter((token, index, arr) => token || index < arr.length - 1);
        if (!normalized.length) {
          normalized.push(value);
        }
        tagsInput.value = normalized.join(", ");
      }
      const caret = tagsInput.value.length;
      if (typeof tagsInput.setSelectionRange === "function") {
        tagsInput.setSelectionRange(caret, caret);
      }
      hideTagSuggestions();
    };

    const getExistingTagSet = () =>
      new Set(
        tagsInput.value
          .split(/[,;]/)
          .map((token) => token.trim().toLowerCase())
          .filter(Boolean),
      );

    const getCurrentTagQuery = () => {
      const parts = tagsInput.value.split(/[,;]/);
      const last = parts[parts.length - 1] ?? "";
      return last.trim().toLowerCase();
    };

    const renderTagSuggestions = (force = false) => {
      if (!tagCandidates.length) {
        hideTagSuggestions();
        return;
      }
      const query = getCurrentTagQuery();
      const allowEmptyQuery =
        force ||
        !!query ||
        /[,;]\s*$/.test(tagsInput.value) ||
        !tagsInput.value.trim();
      if (!query && !allowEmptyQuery) {
        hideTagSuggestions();
        return;
      }
      const used = getExistingTagSet();
      const matches: string[] = [];
      for (const name of tagCandidates) {
        const lower = name.toLowerCase();
        if (used.has(lower)) {
          continue;
        }
        if (query && !lower.includes(query)) {
          continue;
        }
        matches.push(name);
        if (matches.length >= MAX_TAG_SUGGESTIONS) {
          break;
        }
      }
      if (!matches.length) {
        hideTagSuggestions();
        return;
      }
      visibleTagSuggestions = matches;
      activeTagSuggestionIndex = 0;
      tagsSuggestionPanel.textContent = "";
      // PERF-FIX-11: Batch append with DocumentFragment to avoid repeated reflow
      const frag = doc.createDocumentFragment();
      // PERF-FIX-5: Use data attributes for event delegation instead of per-button listeners
      matches.forEach((name, index) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.classList.add(
          "zinspire-collection-picker__tags-autocomplete-item",
        );
        button.textContent = name;
        // PERF-FIX-5: Data attributes for delegated event handlers
        button.dataset.index = String(index);
        button.dataset.tagName = name;
        // PERF-FIX-12: Use cssText for batch style assignment
        button.style.cssText = `
          display: block;
          width: 100%;
          text-align: left;
          padding: 4px 8px;
          font-size: 12px;
          border: none;
          background: transparent;
          cursor: pointer;
        `;
        // PERF-FIX-5: Removed per-button event listeners - now using delegation
        frag.appendChild(button);
      });
      tagsSuggestionPanel.appendChild(frag);
      tagsSuggestionPanel.style.display = "block";
      refreshTagSuggestionHighlight();
    };

    const addTagCandidate = (rawName: unknown) => {
      const normalized =
        typeof rawName === "string"
          ? rawName.trim()
          : String(rawName ?? "").trim();
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (lowerCaseTagNames.has(key)) {
        return;
      }
      lowerCaseTagNames.add(key);
      tagCandidates.push(normalized);
      const option = doc.createElementNS(
        HTML_NS,
        "option",
      ) as HTMLOptionElement;
      option.value = normalized;
      tagsDataList.appendChild(option);
      if (
        doc.activeElement === tagsInput &&
        tagsSuggestionPanel.style.display !== "none"
      ) {
        renderTagSuggestions(true);
      }
    };

    const moveTagSuggestionHighlight = (delta: number) => {
      if (!visibleTagSuggestions.length) {
        return;
      }
      activeTagSuggestionIndex =
        (activeTagSuggestionIndex + delta + visibleTagSuggestions.length) %
        visibleTagSuggestions.length;
      refreshTagSuggestionHighlight();
    };

    tagsInput.addEventListener("input", () => renderTagSuggestions());
    tagsInput.addEventListener("focus", () => renderTagSuggestions(true));
    tagsInput.addEventListener("blur", () => {
      setTimeout(() => {
        hideTagSuggestions();
      }, 120);
    });
    tagsInput.addEventListener("keydown", (event) => {
      const suggestionsVisible = tagsSuggestionPanel.style.display !== "none";
      if (event.key === "ArrowDown") {
        event.stopPropagation();
        if (suggestionsVisible) {
          event.preventDefault();
          moveTagSuggestionHighlight(1);
        } else {
          renderTagSuggestions(true);
          event.preventDefault();
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.stopPropagation();
        if (suggestionsVisible) {
          event.preventDefault();
          moveTagSuggestionHighlight(-1);
        }
        return;
      }
      if (
        suggestionsVisible &&
        (event.key === "Enter" || event.key === "Tab") &&
        activeTagSuggestionIndex >= 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        applyTagSuggestion(visibleTagSuggestions[activeTagSuggestionIndex]);
        return;
      }
      if (suggestionsVisible && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        hideTagSuggestions();
      }
    });

    tagsSuggestionPanel.addEventListener("mousedown", (event) =>
      event.preventDefault(),
    );

    // PERF-FIX-5: Event delegation for tag suggestion buttons
    // Single listener handles all button clicks instead of per-button listeners
    tagsSuggestionPanel.addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement).closest(
        "button",
      ) as HTMLButtonElement | null;
      if (btn?.dataset.tagName) {
        applyTagSuggestion(btn.dataset.tagName);
      }
    });

    // PERF-FIX-5: Delegated mouseover for highlight updates
    tagsSuggestionPanel.addEventListener("mouseover", (event) => {
      const btn = (event.target as HTMLElement).closest(
        "button",
      ) as HTMLButtonElement | null;
      if (btn?.dataset.index !== undefined) {
        const idx = parseInt(btn.dataset.index, 10);
        if (!isNaN(idx) && idx !== activeTagSuggestionIndex) {
          activeTagSuggestionIndex = idx;
          refreshTagSuggestionHighlight();
        }
      }
    });

    // Fetch all tags from Zotero libraries
    const libraries = Zotero.Libraries.getAll();
    for (const lib of libraries) {
      if (!lib.editable) {
        continue;
      }
      try {
        const sql =
          "SELECT name FROM tags JOIN itemTags ON tags.tagID=itemTags.tagID JOIN items ON itemTags.itemID=items.itemID WHERE items.libraryID=? GROUP BY tags.tagID ORDER BY COUNT(*) DESC LIMIT 100";
        void Zotero.DB.queryAsync(sql, [lib.libraryID])
          .then((rows: any) => {
            if (!rows) {
              return;
            }
            for (const row of rows) {
              addTagCandidate(row.name);
            }
            if (doc.activeElement === tagsInput) {
              renderTagSuggestions(true);
            }
          })
          .catch((err: unknown) => {
            Zotero.debug?.(
              `[zoteroinspire] Failed to fetch tags for library ${lib.libraryID}: ${err}`,
            );
          });
      } catch (e) {
        Zotero.debug?.(
          `[zoteroinspire] Unexpected error while preparing tag suggestions: ${e}`,
        );
      }
    }
    options.appendChild(tagsDataList);

    const noteInput = doc.createElement("textarea");
    noteInput.classList.add("zinspire-collection-picker__note");
    const notePlaceholder = getString("references-panel-picker-note");
    noteInput.placeholder = notePlaceholder || "Note";
    noteInput.title = getString("references-panel-picker-note-title");
    noteInput.style.width = "100%";
    noteInput.style.padding = "4px 8px";
    noteInput.style.fontSize = "13px";
    noteInput.style.boxSizing = "border-box";
    noteInput.style.resize = "vertical";
    noteInput.rows = 2;
    noteInput.style.fontFamily = "inherit";
    noteInput.style.minHeight = "60px";
    noteInput.style.lineHeight = "1.4";

    options.appendChild(tagsWrapper);
    options.appendChild(noteInput);
    panel.appendChild(options);

    const actions = doc.createElement("div");
    actions.classList.add("zinspire-collection-picker__actions");
    actions.style.padding = "8px 12px";
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.backgroundColor = "var(--material-side-background, #f5f5f5)";
    actions.style.borderRadius = "0 0 6px 6px";

    const cancelBtn = doc.createElement("button");
    cancelBtn.classList.add("zinspire-collection-picker__button");
    cancelBtn.textContent = getString("references-panel-picker-cancel");
    cancelBtn.style.padding = "4px 12px";
    cancelBtn.style.minWidth = "60px";

    const okBtn = doc.createElement("button");
    okBtn.classList.add(
      "zinspire-collection-picker__button",
      "zinspire-collection-picker__button--primary",
    );
    okBtn.textContent = getString("references-panel-picker-confirm");
    okBtn.style.padding = "4px 12px";
    okBtn.style.minWidth = "60px";

    actions.append(cancelBtn, okBtn);
    panel.appendChild(actions);

    const rowMap = new Map<string, SaveTargetRow>();
    const buttonMap = new Map<string, HTMLButtonElement>();
    // PERF-FIX-11: Use DocumentFragment for batch DOM insertions
    const fragment = doc.createDocumentFragment();
    for (const row of targets) {
      rowMap.set(row.id, row);
      const button = doc.createElement("button");
      button.type = "button";
      button.dataset.id = row.id;
      button.dataset.type = row.type;
      button.classList.add("zinspire-collection-picker__row");
      // PERF-FIX-12: Use cssText for batch style assignment (compact chip styles)
      button.style.cssText = `
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        padding: 4px 8px;
        border: 1px solid var(--material-border, #ccc);
        border-radius: 12px;
        background: var(--material-background, #fff);
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 12px;
      `;
      // Set custom property after cssText (cssText clears all inline styles)
      button.style.setProperty(
        "--zinspire-collection-level",
        row.level.toString(),
      );

      button.addEventListener("mouseover", () => {
        if (!button.classList.contains("is-focused")) {
          button.style.backgroundColor = "Highlight";
          button.style.color = "HighlightText";
          button.style.borderColor = "Highlight";
        }
      });
      button.addEventListener("mouseout", () => {
        if (!button.classList.contains("is-focused")) {
          updateVisualState();
        }
      });

      button.textContent = row.name;
      if (row.recent) {
        button.dataset.recent = "1";
      }
      fragment.appendChild(button);
      buttonMap.set(row.id, button);
    }
    // PERF-FIX-11: Append all buttons at once
    list.appendChild(fragment);

    if (!targets.length) {
      const empty = doc.createElement("div");
      empty.classList.add("zinspire-collection-picker__empty");
      empty.textContent = getString("references-panel-picker-empty");
      list.appendChild(empty);
    }

    const deriveLibraryRowID = (rowID: string | null) => {
      if (!rowID) {
        return null;
      }
      const row = rowMap.get(rowID);
      if (!row) {
        return null;
      }
      return row.type === "library" ? row.id : `L${row.libraryID}`;
    };

    let focusedID: string | null =
      (defaultID && rowMap.has(defaultID) ? defaultID : null) ||
      targets[0]?.id ||
      null;
    let selectedLibraryRowID: string | null =
      deriveLibraryRowID(focusedID) ||
      targets.find((row) => row.type === "library")?.id ||
      null;
    let selectedLibraryID: number | null = selectedLibraryRowID
      ? (rowMap.get(selectedLibraryRowID)?.libraryID ?? null)
      : null;
    const selectedCollectionRowIDs = new Set<string>();
    if (focusedID) {
      const initialRow = rowMap.get(focusedID);
      if (initialRow?.type === "collection") {
        selectedCollectionRowIDs.add(initialRow.id);
      }
    }
    if (!selectedLibraryRowID && targets[0]) {
      selectedLibraryRowID =
        targets[0].type === "library"
          ? targets[0].id
          : `L${targets[0].libraryID}`;
      selectedLibraryID =
        rowMap.get(selectedLibraryRowID!)?.libraryID ?? targets[0].libraryID;
    }

    const applyCollectionHighlight = (
      button: HTMLButtonElement,
      checked: boolean,
    ) => {
      if (checked) {
        button.style.backgroundColor = "#e6f2ff";
        button.style.color = "#0b2d66";
        button.style.fontWeight = "600";
      } else {
        button.style.backgroundColor = "";
        button.style.color = "";
        button.style.fontWeight = "";
      }
    };

    const updateVisualState = () => {
      for (const [id, button] of buttonMap.entries()) {
        button.classList.toggle("is-focused", id === focusedID);
        if (button.dataset.type === "library") {
          button.classList.toggle(
            "is-library-active",
            id === selectedLibraryRowID,
          );
          if (id === selectedLibraryRowID) {
            button.style.backgroundColor = "#e6f2ff";
            button.style.color = "#0b2d66";
            button.style.fontWeight = "600";
          } else if (id !== focusedID) {
            // Reset styles for non-selected library rows (unless focused)
            button.style.backgroundColor = "";
            button.style.color = "";
            button.style.fontWeight = "";
          }
        } else {
          const isChecked = selectedCollectionRowIDs.has(id);
          button.classList.toggle("is-checked", isChecked);
          button.classList.toggle("is-library-active", false);
          applyCollectionHighlight(button, isChecked);
        }
      }
    };

    const focusRow = (id: string | null, scroll = true) => {
      focusedID = id;
      updateVisualState();
      if (scroll && id) {
        buttonMap.get(id)?.scrollIntoView({ block: "nearest" });
      }
    };

    focusRow(focusedID, false);

    const visibleButtons = () =>
      Array.from(buttonMap.values()).filter((btn) => !btn.hidden);

    const moveFocus = (delta: number) => {
      const buttons = visibleButtons();
      if (!buttons.length) {
        return;
      }
      let index = buttons.findIndex((btn) => btn.dataset.id === focusedID);
      if (index === -1) {
        index = 0;
      } else {
        index = Math.min(Math.max(index + delta, 0), buttons.length - 1);
      }
      const nextButton = buttons[index];
      focusRow(nextButton?.dataset.id ?? null);
    };

    const selectLibraryRow = (id: string | null) => {
      if (!id) {
        return;
      }
      const row = rowMap.get(id);
      if (!row || row.type !== "library") {
        return;
      }
      selectedLibraryRowID = row.id;
      selectedLibraryID = row.libraryID;
      for (const rowID of Array.from(selectedCollectionRowIDs)) {
        const candidate = rowMap.get(rowID);
        if (!candidate || candidate.libraryID !== row.libraryID) {
          selectedCollectionRowIDs.delete(rowID);
        }
      }
      focusRow(row.id, false);
      updateVisualState();
    };

    const toggleCollectionRow = (id: string | null) => {
      if (!id) {
        return;
      }
      const row = rowMap.get(id);
      if (!row || row.type !== "collection") {
        return;
      }
      if (!selectedLibraryID || selectedLibraryID !== row.libraryID) {
        selectLibraryRow(`L${row.libraryID}`);
      }
      if (selectedCollectionRowIDs.has(id)) {
        selectedCollectionRowIDs.delete(id);
      } else {
        selectedCollectionRowIDs.add(id);
      }
      focusRow(id);
      updateVisualState();
    };

    const applyFilter = () => {
      const query = filterInput.value.trim().toLowerCase();
      if (!query) {
        buttonMap.forEach((btn) => (btn.style.display = "inline-flex"));
        return;
      }
      const visible = new Set<string>();
      for (const row of targets) {
        const matches = row.name.toLowerCase().includes(query);
        if (matches) {
          visible.add(row.id);
          let parentID = row.parentID;
          while (parentID) {
            visible.add(parentID);
            parentID = rowMap.get(parentID)?.parentID;
          }
        }
      }
      buttonMap.forEach((btn, id) => {
        if (visible.has(id)) {
          btn.style.display = "inline-flex";
        } else {
          btn.style.display = "none";
        }
      });
      const focusedBtn = focusedID ? buttonMap.get(focusedID) : null;
      if (!focusedID || (focusedBtn && focusedBtn.style.display === "none")) {
        const firstVisible = Array.from(buttonMap.values()).find(
          (btn) => btn.style.display !== "none",
        );
        focusRow(firstVisible?.dataset.id ?? null);
      }
    };

    const buildSelection = (): SaveTargetSelection | null => {
      const libraryRowID =
        selectedLibraryRowID ||
        targets.find((row) => row.type === "library")?.id ||
        null;
      if (!libraryRowID) {
        return null;
      }
      const libraryRow = rowMap.get(libraryRowID);
      if (!libraryRow) {
        return null;
      }
      const collectionIDs = Array.from(selectedCollectionRowIDs)
        .map((id) => rowMap.get(id)?.collectionID)
        .filter((id): id is number => typeof id === "number");
      const primaryRowID =
        selectedCollectionRowIDs.values().next().value || libraryRowID;
      return {
        libraryID: libraryRow.libraryID,
        primaryRowID,
        collectionIDs,
        tags: tagsInput.value
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean),
        note: noteInput.value.trim(),
      };
    };

    let isFinished = false;

    const finish = (selection: SaveTargetSelection | null) => {
      if (isFinished) {
        return;
      }
      isFinished = true;
      overlay.remove();
      filterInput.removeEventListener("input", applyFilter);
      list.removeEventListener("click", onListClick);
      list.removeEventListener("dblclick", onListDoubleClick);
      panel.removeEventListener("keydown", onKeyDown);
      cancelBtn.removeEventListener("click", onCancel);
      okBtn.removeEventListener("click", onConfirm);
      overlay.removeEventListener("click", onOverlayClick);
      doc.removeEventListener("keydown", onGlobalKeyDown, true);
      restoreViewState();
      resolve(selection);
    };

    const onConfirm = () => {
      finish(buildSelection());
    };

    const onCancel = () => finish(null);

    const onOverlayClick = (event: MouseEvent) => {
      if (event.target === overlay) {
        finish(null);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(-1);
        return;
      }
      if (
        event.key === " " &&
        event.target !== filterInput &&
        event.target !== tagsInput &&
        event.target !== noteInput
      ) {
        event.preventDefault();
        const row = focusedID ? rowMap.get(focusedID) : null;
        if (!row) {
          return;
        }
        if (row.type === "library") {
          selectLibraryRow(row.id);
        } else {
          toggleCollectionRow(row.id);
        }
        return;
      }
      if (event.key === "Enter" && event.target !== filterInput) {
        event.preventDefault();
        onConfirm();
      }
    };

    const onListClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement)?.closest("button");
      if (!target) {
        return;
      }
      const id = target.getAttribute("data-id");
      const row = id ? rowMap.get(id) : null;
      if (!row) {
        return;
      }
      if (row.type === "library") {
        selectLibraryRow(row.id);
      } else {
        toggleCollectionRow(row.id);
      }
    };

    const onListDoubleClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement)?.closest("button");
      if (!target) {
        return;
      }
      const id = target.getAttribute("data-id");
      const row = id ? rowMap.get(id) : null;
      if (!row) {
        return;
      }
      if (row.type === "library") {
        selectLibraryRow(row.id);
      } else {
        toggleCollectionRow(row.id);
      }
      onConfirm();
    };

    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
    };

    filterInput.addEventListener("input", applyFilter);
    cancelBtn.addEventListener("click", onCancel);
    okBtn.addEventListener("click", onConfirm);
    list.addEventListener("click", onListClick);
    list.addEventListener("dblclick", onListDoubleClick);
    panel.addEventListener("keydown", onKeyDown);
    overlay.addEventListener("click", onOverlayClick);
    doc.addEventListener("keydown", onGlobalKeyDown, true);

    filterInput.focus();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ambiguous citation picker UI (FTR-AMBIGUOUS-AUTHOR-YEAR)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result from the ambiguous citation picker
 */
export interface AmbiguousCitationSelection {
  /** Selected candidate */
  candidate: AmbiguousCandidate;
  /** Index in the original candidates array */
  candidateIndex: number;
}

/**
 * Show a picker UI for selecting between ambiguous citation matches.
 * Used when same first author has multiple papers in the same year.
 *
 * @param citationText - The citation text (e.g., "Guo et al. (2016)")
 * @param candidates - Array of possible matches
 * @param body - Container element for the picker
 * @returns Selected candidate or null if cancelled
 */
export function showAmbiguousCitationPicker(
  citationText: string,
  candidates: AmbiguousCandidate[],
  body: HTMLElement,
): Promise<AmbiguousCitationSelection | null> {
  return new Promise((resolve) => {
    const doc = body.ownerDocument;

    // Create overlay
    const overlay = doc.createElement("div");
    overlay.classList.add("zinspire-ambiguous-picker__overlay");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.zIndex = "10000";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.3)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.transition = "background-color 0.2s ease";

    // Create panel
    const panel = doc.createElement("div");
    panel.classList.add("zinspire-ambiguous-picker");
    panel.style.backgroundColor = "var(--material-background, #fff)";
    panel.style.color = "var(--material-color, #000)";
    panel.style.border = "1px solid var(--material-border, #ccc)";
    panel.style.borderRadius = "8px";
    panel.style.boxShadow = "0 4px 24px rgba(0, 0, 0, 0.25)";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.fontSize = "14px";
    panel.style.maxWidth = "500px";
    panel.style.width = "90%";
    panel.style.maxHeight = "80vh";
    panel.style.overflow = "hidden";

    overlay.appendChild(panel);

    // Header
    const header = doc.createElement("div");
    header.classList.add("zinspire-ambiguous-picker__header");
    header.style.padding = "12px 16px";
    header.style.fontWeight = "600";
    header.style.fontSize = "15px";
    header.style.borderBottom = "1px solid var(--material-border, #eee)";
    header.style.backgroundColor = "var(--material-side-background, #f5f5f5)";
    header.style.borderRadius = "8px 8px 0 0";
    header.textContent = getString("pdf-annotate-ambiguous-title", {
      args: { citation: citationText },
    });
    panel.appendChild(header);

    // Message
    const message = doc.createElement("div");
    message.classList.add("zinspire-ambiguous-picker__message");
    message.style.padding = "12px 16px";
    message.style.fontSize = "13px";
    message.style.color = "var(--fill-secondary, #666)";
    message.textContent = getString("pdf-annotate-ambiguous-message");
    panel.appendChild(message);

    // Candidates list
    const list = doc.createElement("div");
    list.classList.add("zinspire-ambiguous-picker__list");
    list.style.flex = "1";
    list.style.overflowY = "auto";
    list.style.padding = "8px 16px";
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "12px";
    panel.appendChild(list);

    let focusedIndex = 0;
    const buttons: HTMLButtonElement[] = [];

    // updateFocus will be called after buttons are created
    const updateFocus = () => {
      buttons.forEach((btn, idx) => {
        const radioIndicator = (btn as any)._radioIndicator as
          | HTMLElement
          | undefined;
        const innerDot = (btn as any)._innerDot as HTMLElement | undefined;
        if (idx === focusedIndex) {
          btn.style.backgroundColor = "#e6f2ff";
          btn.style.borderColor = "#0066cc";
          if (radioIndicator) radioIndicator.style.borderColor = "#0066cc";
          if (innerDot) innerDot.style.opacity = "1";
        } else {
          btn.style.backgroundColor = "var(--material-background, #fff)";
          btn.style.borderColor = "var(--material-border, #ccc)";
          if (radioIndicator)
            radioIndicator.style.borderColor = "var(--material-border, #ccc)";
          if (innerDot) innerDot.style.opacity = "0";
        }
      });
    };

    // Create buttons for each candidate
    // PERF-FIX-11: Use DocumentFragment for batch DOM insertions
    const candidateFragment = doc.createDocumentFragment();
    candidates.forEach((candidate, index) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.classList.add("zinspire-ambiguous-picker__candidate");
      // PERF-FIX-12: Use cssText for batch style assignment
      button.style.cssText = `
        display: flex;
        flex-direction: row;
        align-items: center;
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--material-border, #ccc);
        border-radius: 6px;
        background-color: var(--material-background, #fff);
        cursor: pointer;
        text-align: left;
        transition: background-color 0.15s ease, border-color 0.15s ease;
        gap: 12px;
      `;

      // Radio-style indicator
      const radioIndicator = doc.createElement("div");
      // PERF-FIX-12: Use cssText for batch style assignment
      radioIndicator.style.cssText = `
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid var(--material-border, #ccc);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: border-color 0.15s ease;
      `;
      button.appendChild(radioIndicator);

      // Inner dot (shown when selected)
      const innerDot = doc.createElement("div");
      // PERF-FIX-12: Use cssText for batch style assignment
      innerDot.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #0066cc;
        opacity: 0;
        transition: opacity 0.15s ease;
      `;
      radioIndicator.appendChild(innerDot);

      // Content container
      const content = doc.createElement("div");
      // PERF-FIX-12: Use cssText for batch style assignment
      content.style.cssText = `
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      `;

      // Main line: Journal + Volume + Page
      const mainLine = doc.createElement("div");
      // PERF-FIX-12: Use cssText for batch style assignment
      mainLine.style.cssText = `
        display: flex;
        align-items: baseline;
        gap: 6px;
        flex-wrap: wrap;
      `;

      // Journal name (bold)
      if (candidate.journal) {
        const journalSpan = doc.createElement("span");
        // PERF-FIX-12: Use cssText for batch style assignment
        journalSpan.style.cssText = `
          font-weight: 600;
          font-size: 14px;
          color: var(--fill-primary, #333);
        `;
        journalSpan.textContent = candidate.journal;
        mainLine.appendChild(journalSpan);
      }

      // Volume + Page
      const volPageParts: string[] = [];
      if (candidate.volume) volPageParts.push(candidate.volume);
      if (candidate.page) volPageParts.push(candidate.page);
      if (volPageParts.length > 0) {
        const volPageSpan = doc.createElement("span");
        // PERF-FIX-12: Use cssText for batch style assignment
        volPageSpan.style.cssText = `
          font-size: 14px;
          color: var(--fill-primary, #333);
        `;
        volPageSpan.textContent = volPageParts.join(", ");
        mainLine.appendChild(volPageSpan);
      }

      // If no journal info, use displayText as fallback
      if (!candidate.journal && !candidate.volume) {
        const fallbackSpan = doc.createElement("span");
        // PERF-FIX-12: Use cssText for batch style assignment
        fallbackSpan.style.cssText = `
          font-size: 14px;
          color: var(--fill-primary, #333);
        `;
        fallbackSpan.textContent = candidate.displayText;
        mainLine.appendChild(fallbackSpan);
      }

      content.appendChild(mainLine);

      // Title line (truncated)
      if (candidate.title) {
        const titleLine = doc.createElement("div");
        // PERF-FIX-12: Use cssText for batch style assignment
        titleLine.style.cssText = `
          font-size: 13px;
          color: var(--fill-primary, #333);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        `;
        // Truncate title if too long
        const maxTitleLength = 60;
        const truncatedTitle =
          candidate.title.length > maxTitleLength
            ? candidate.title.substring(0, maxTitleLength) + "..."
            : candidate.title;
        titleLine.textContent = truncatedTitle;
        titleLine.title = candidate.title; // Full title on hover
        content.appendChild(titleLine);
      }

      button.appendChild(content);

      // Store reference to radio indicator for updateFocus
      (button as any)._radioIndicator = radioIndicator;
      (button as any)._innerDot = innerDot;

      // Hover effects
      button.addEventListener("mouseenter", () => {
        focusedIndex = index;
        updateFocus();
      });

      // Click handler
      button.addEventListener("click", () => {
        finish({ candidate, candidateIndex: index });
      });

      candidateFragment.appendChild(button);
      buttons.push(button);
    });
    // PERF-FIX-11: Append all candidate buttons at once
    list.appendChild(candidateFragment);

    // Actions bar
    const actions = doc.createElement("div");
    actions.classList.add("zinspire-ambiguous-picker__actions");
    actions.style.padding = "12px 16px";
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.borderTop = "1px solid var(--material-border, #eee)";
    actions.style.backgroundColor = "var(--material-side-background, #f5f5f5)";
    actions.style.borderRadius = "0 0 8px 8px";

    const cancelBtn = doc.createElement("button");
    cancelBtn.classList.add("zinspire-ambiguous-picker__button");
    cancelBtn.textContent = getString("pdf-annotate-ambiguous-cancel");
    cancelBtn.style.padding = "6px 16px";
    cancelBtn.style.minWidth = "70px";
    cancelBtn.style.border = "1px solid var(--material-border, #ccc)";
    cancelBtn.style.borderRadius = "4px";
    cancelBtn.style.backgroundColor = "var(--material-background, #fff)";
    cancelBtn.style.cursor = "pointer";

    actions.appendChild(cancelBtn);
    panel.appendChild(actions);

    body.appendChild(overlay);
    updateFocus();

    let isFinished = false;

    const finish = (selection: AmbiguousCitationSelection | null) => {
      if (isFinished) return;
      isFinished = true;
      overlay.remove();
      doc.removeEventListener("keydown", onKeyDown, true);
      resolve(selection);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusedIndex = Math.min(focusedIndex + 1, candidates.length - 1);
        updateFocus();
        buttons[focusedIndex]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusedIndex = Math.max(focusedIndex - 1, 0);
        updateFocus();
        buttons[focusedIndex]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const candidate = candidates[focusedIndex];
        if (candidate) {
          finish({ candidate, candidateIndex: focusedIndex });
        }
        return;
      }
    };

    cancelBtn.addEventListener("click", () => finish(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });
    doc.addEventListener("keydown", onKeyDown, true);

    // Focus first button
    buttons[0]?.focus();
  });
}
