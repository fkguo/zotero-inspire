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
    color: "var(--fill-secondary, #666)",
    fontSize: "12px",
  } as CSSProperties,
  link: {
    cursor: "pointer",
    textDecoration: "none",
    color: "var(--accent-color, #0066cc)",
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
    color: "var(--fill-tertiary, #9ca3af)",
    fontSize: "12px",
  } as CSSProperties,
  noDataItalic: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "var(--fill-tertiary, #9ca3af)",
    fontSize: "12px",
    fontStyle: "italic",
  } as CSSProperties,
} as const;

/**
 * Get dark mode aware chart "no data" styles.
 * Use this instead of CHART_STYLES for proper dark mode support.
 */
export function getChartNoDataStyle(): CSSProperties {
  const dark = isDarkMode();
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: dark ? "#6b7280" : "#9ca3af",
    fontSize: "12px",
  };
}

/**
 * Get dark mode aware chart "no data" italic styles.
 * Use this instead of CHART_STYLES for proper dark mode support.
 */
export function getChartNoDataItalicStyle(): CSSProperties {
  const dark = isDarkMode();
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: dark ? "#6b7280" : "#9ca3af",
    fontSize: "12px",
    fontStyle: "italic",
  };
}

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
 * Uses multiple detection methods for reliability:
 * 1. Check Zotero's platform-darkmode attribute (most reliable)
 * 2. Check data-color-scheme attribute
 * 3. Fall back to system preference via matchMedia
 */
export function isDarkMode(): boolean {
  try {
    // Try to get the main window document
    const mainWindow = Zotero.getMainWindow?.();
    const doc = mainWindow?.document;

    if (doc) {
      // Check Zotero-specific dark mode attribute (most reliable for Zotero 7)
      const platformDarkMode = doc.documentElement.getAttribute("zotero-platform-darkmode");
      if (platformDarkMode === "true") {
        return true;
      }
      if (platformDarkMode === "false") {
        return false;
      }

      // Check data-color-scheme attribute (explicit light/dark)
      const colorScheme = doc.documentElement.getAttribute("data-color-scheme");
      if (colorScheme === "dark") {
        return true;
      }
      if (colorScheme === "light") {
        return false;
      }
    }

    // Fallback: Check system preference via matchMedia
    if (mainWindow?.matchMedia) {
      const mediaQuery = mainWindow.matchMedia("(prefers-color-scheme: dark)");
      if (mediaQuery) {
        return mediaQuery.matches;
      }
    }

    // Last resort: check global matchMedia if available
    if (typeof matchMedia !== "undefined") {
      const globalMediaQuery = matchMedia("(prefers-color-scheme: dark)");
      if (globalMediaQuery) {
        return globalMediaQuery.matches;
      }
    }
  } catch {
    // Ignore errors and return false
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Color Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Status indicator colors (semantic - use getStatusColors() for dark mode) */
export const STATUS_COLORS = {
  local: "#1a8f4d", // Green - item exists locally
  notLocal: "#d93025", // Red - item not in local library
  link: "#0066cc", // Blue - clickable link
  muted: "#666", // Gray - secondary text
  chartNoData: "#9ca3af", // Light gray - chart placeholder
} as const;

/**
 * Get dark mode aware status colors.
 * Semantic colors adjusted for visibility in both light and dark modes.
 */
export function getStatusColors(): {
  local: string;
  notLocal: string;
  link: string;
  muted: string;
  chartNoData: string;
} {
  const dark = isDarkMode();
  return {
    local: dark ? "#22c55e" : "#1a8f4d", // Green - brighter in dark mode
    notLocal: dark ? "#ef4444" : "#d93025", // Red - brighter in dark mode
    link: dark ? "#60a5fa" : "#0066cc", // Blue - brighter in dark mode
    muted: dark ? "#9ca3af" : "#666", // Gray - lighter in dark mode
    chartNoData: dark ? "#6b7280" : "#9ca3af", // Gray
  };
}

/** Tab button colors (use getTabColors() for dark mode) */
export const TAB_COLORS = {
  activeBackground: "#e6f2ff",
  activeText: "#0b2d66",
} as const;

/**
 * Get dark mode aware tab colors.
 */
export function getTabColors(): {
  activeBackground: string;
  activeText: string;
} {
  const dark = isDarkMode();
  return {
    activeBackground: dark ? "rgba(96, 165, 250, 0.2)" : "#e6f2ff",
    activeText: dark ? "#93c5fd" : "#0b2d66",
  };
}

/**
 * Picker dialog color configuration for consistent styling.
 * Used by collection picker, ambiguous citation picker, etc.
 */
export interface PickerColors {
  // Panel/container backgrounds
  panelBg: string;
  headerBg: string;
  sectionBg: string;
  // Text colors
  textPrimary: string;
  textSecondary: string;
  // Input/control backgrounds
  inputBg: string;
  // Borders
  borderColor: string;
  inputBorder: string;
  // Selection/highlight states (matches tab colors)
  selectBg: string;
  selectColor: string;
  // Chips/buttons
  chipBg: string;
  chipBorder: string;
  chipColor: string;
  // Accent
  accentBlue: string;
}

/**
 * Get dark mode aware colors for picker dialogs.
 * Centralizes color definitions for consistent styling across picker UIs.
 */
export function getPickerColors(): PickerColors {
  const dark = isDarkMode();
  // Use consistent selection colors with tabs
  const tabColors = getTabColors();
  return {
    // Panel/container backgrounds
    panelBg: dark ? "#1e1e1e" : "#fff",
    headerBg: dark ? "#2b2b2b" : "#f5f5f5",
    sectionBg: dark ? "#2b2b2b" : "#f5f5f5",
    // Text colors
    textPrimary: dark ? "#e0e0e0" : "#000",
    textSecondary: dark ? "#999" : "#666",
    // Input/control backgrounds
    inputBg: dark ? "#3c3c3c" : "#fff",
    // Borders
    borderColor: dark ? "#444" : "#eee",
    inputBorder: dark ? "#555" : "#ccc",
    // Selection/highlight states - use tab colors for consistency
    selectBg: tabColors.activeBackground,
    selectColor: tabColors.activeText,
    // Chips/buttons
    chipBg: dark ? "#3c3c3c" : "#fff",
    chipBorder: dark ? "#555" : "#ccc",
    chipColor: dark ? "#e0e0e0" : "#000",
    // Accent
    accentBlue: dark ? "#60a5fa" : "#0066cc",
  };
}
