// ─────────────────────────────────────────────────────────────────────────────
// Centralized Style Utilities for INSPIRE Panel
// ─────────────────────────────────────────────────────────────────────────────
// This module provides reusable style patterns and utilities to reduce
// inline style duplication across the codebase.

// ─────────────────────────────────────────────────────────────────────────────
// Style Types
// ─────────────────────────────────────────────────────────────────────────────

type CSSProperties = Partial<CSSStyleDeclaration>;

// ─────────────────────────────────────────────────────────────────────────────
// Common Style Patterns
// ─────────────────────────────────────────────────────────────────────────────

/** Flexbox layout patterns */
export const FLEX_STYLES = {
  row: {
    display: "flex",
    flexDirection: "row",
  } as CSSProperties,
  rowCenter: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
  } as CSSProperties,
  rowCenterBetween: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as CSSProperties,
  column: {
    display: "flex",
    flexDirection: "column",
  } as CSSProperties,
  columnCenter: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  } as CSSProperties,
  inlineCenter: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  } as CSSProperties,
} as const;

/** Button base styles */
export const BUTTON_STYLES = {
  base: {
    border: "none",
    background: "transparent",
    padding: "0",
    cursor: "pointer",
  } as CSSProperties,
  pill: {
    border: "none",
    borderRadius: "4px",
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: "12px",
  } as CSSProperties,
  icon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "transparent",
    padding: "0",
    cursor: "pointer",
  } as CSSProperties,
} as const;

/** Text styles */
export const TEXT_STYLES = {
  ellipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as CSSProperties,
  small: {
    fontSize: "12px",
  } as CSSProperties,
  muted: {
    color: "#666",
    fontSize: "12px",
  } as CSSProperties,
  link: {
    cursor: "pointer",
    textDecoration: "none",
    color: "#0066cc",
  } as CSSProperties,
} as const;

/** Container styles */
export const CONTAINER_STYLES = {
  card: {
    padding: "8px",
    borderRadius: "4px",
    backgroundColor: "var(--fill-tertiary)",
  } as CSSProperties,
  spacer: {
    flex: "1",
  } as CSSProperties,
} as const;

/** Chart/visualization styles */
export const CHART_STYLES = {
  noData: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#9ca3af",
    fontSize: "12px",
  } as CSSProperties,
  noDataItalic: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#9ca3af",
    fontSize: "12px",
    fontStyle: "italic",
  } as CSSProperties,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Style Application Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply a style object to an element.
 * @param element - Target HTML element
 * @param styles - CSS properties to apply
 */
export function applyStyle(element: HTMLElement, styles: CSSProperties): void {
  for (const [key, value] of Object.entries(styles)) {
    if (value !== undefined && value !== null) {
      (element.style as any)[key] = value;
    }
  }
}

/**
 * Apply multiple style objects to an element.
 * Later styles override earlier ones for conflicting properties.
 * @param element - Target HTML element
 * @param stylesList - Array of CSS property objects to apply
 */
export function applyStyles(
  element: HTMLElement,
  ...stylesList: CSSProperties[]
): void {
  for (const styles of stylesList) {
    applyStyle(element, styles);
  }
}

/**
 * Create a style string from a CSS properties object.
 * Useful for setting cssText directly.
 * @param styles - CSS properties object
 * @returns CSS string suitable for element.style.cssText
 */
export function toStyleString(styles: CSSProperties): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(styles)) {
    if (value !== undefined && value !== null) {
      // Convert camelCase to kebab-case
      const kebabKey = key.replace(/([A-Z])/g, "-$1").toLowerCase();
      lines.push(`${kebabKey}: ${value};`);
    }
  }
  return lines.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if the current Zotero theme is dark mode.
 */
export function isDarkMode(): boolean {
  const doc = Zotero.getMainWindow?.()?.document;
  if (!doc) return false;
  return (
    doc.documentElement.getAttribute("zotero-platform-darkmode") === "true" ||
    doc.documentElement.getAttribute("data-color-scheme") === "dark"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Color Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Status indicator colors */
export const STATUS_COLORS = {
  local: "#1a8f4d", // Green - item exists locally
  notLocal: "#d93025", // Red - item not in local library
  link: "#0066cc", // Blue - clickable link
  muted: "#666", // Gray - secondary text
  chartNoData: "#9ca3af", // Light gray - chart placeholder
} as const;

/** Tab button colors */
export const TAB_COLORS = {
  activeBackground: "#e6f2ff",
  activeText: "#0b2d66",
} as const;
