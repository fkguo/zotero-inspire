// ─────────────────────────────────────────────────────────────────────────────
// abstractContextMenu - Copy menu of an abstract (hover card, abstract tooltip)
// Extracted from InspireReferencePanelController
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import { copyToClipboard } from "../apiUtils";
import { containsLatexMath, getRenderMode } from "../mathRenderer";

// Longest stretch of text next to a selection that is looked up in the LaTeX
// source to find where the selection starts and ends
const ANCHOR_SEARCH_MAX_LENGTH = 30;

export interface AbstractContextMenuOptions {
  /**
   * Document of the window the menu opens in. Defaults to the main Zotero
   * window's.
   */
  document?: Document;
  /** Shows a notice once text was copied */
  notify: (message: string) => void;
  /** Called when the menu opens (e.g. to keep a hover card open) */
  onOpen?: () => void;
  /** Called after the menu was closed and removed */
  onClose?: () => void;
}

/** The text of rendered formulas without KaTeX's hidden MathML copy. */
function getCleanKatexText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".katex-mathml").forEach((node) => node.remove());
  return (clone.textContent || "").trim();
}

/**
 * Show context menu for abstract with copy options.
 * Provides "Copy" (rendered text) and "Copy as LaTeX" (original source) options.
 */
export function showAbstractContextMenu(
  event: MouseEvent,
  container: HTMLElement,
  options: AbstractContextMenuOptions,
): void {
  const mainWindow = Zotero.getMainWindow();
  const doc =
    options.document || mainWindow?.document || container.ownerDocument;

  // Get selection from container's document context (important for tooltips/popups)
  const containerWindow = container.ownerDocument.defaultView;
  const selection =
    containerWindow?.getSelection?.() || mainWindow?.getSelection?.();

  // Get clean selected text by removing KaTeX's hidden MathML content
  // KaTeX duplicates content (MathML + visible HTML), so selection.toString() has duplicates
  let selectedText = "";
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const fragment = range.cloneContents();
    // Create a temporary container to clean the selection
    const tempDiv = doc.createElement("div");
    tempDiv.appendChild(fragment);
    selectedText = getCleanKatexText(tempDiv);
  }

  const latexSource =
    container.dataset.latexSource || container.textContent || "";
  const hasLatex = containsLatexMath(latexSource);
  const renderMode = getRenderMode();

  // Remove existing popup if any
  const popupId = "zinspire-abstract-context-popup";
  const existingPopup = doc.getElementById(popupId);
  if (existingPopup) {
    existingPopup.remove();
  }

  // Create XUL menupopup
  const popup = (doc as any).createXULElement("menupopup") as XUL.MenuPopup;
  popup.id = popupId;

  // Copy option (copies selected or all rendered text)
  const copyItem = (doc as any).createXULElement("menuitem");
  const copyLabel = selectedText
    ? getString("references-panel-abstract-copy-selection")
    : getString("references-panel-abstract-copy");
  copyItem.setAttribute("label", copyLabel);
  copyItem.addEventListener("command", async () => {
    const textToCopy = selectedText || container.textContent || "";
    await copyToClipboard(textToCopy);
    options.notify(getString("references-panel-abstract-copied"));
  });
  popup.appendChild(copyItem);

  // Copy as LaTeX option (only shown if LaTeX is present and in KaTeX mode)
  if (hasLatex && renderMode === "katex") {
    const copyLatexItem = (doc as any).createXULElement("menuitem");
    copyLatexItem.setAttribute(
      "label",
      getString("references-panel-abstract-copy-latex"),
    );
    copyLatexItem.addEventListener("command", async () => {
      let textToCopy = latexSource; // Default to full source

      if (selectedText) {
        // Try exact match first (works for non-math selections)
        if (latexSource.includes(selectedText)) {
          textToCopy = selectedText;
        } else {
          // Selection likely contains rendered math - try to locate region using anchors
          // KaTeX includes both visible HTML and hidden MathML in the DOM.
          // textContent includes BOTH, but selection only captures visible text.
          // We need to get only the visible text content.
          const fullText = getCleanKatexText(container);

          const selectionStart = fullText.indexOf(selectedText);

          if (selectionStart !== -1) {
            const beforeSel = fullText.substring(0, selectionStart);
            const afterSel = fullText.substring(
              selectionStart + selectedText.length,
            );

            // Find anchor text before selection that exists in source
            let anchorBefore = "";
            const maxAnchor = ANCHOR_SEARCH_MAX_LENGTH;
            for (
              let len = Math.min(maxAnchor, beforeSel.length);
              len > 0;
              len--
            ) {
              const candidate = beforeSel.slice(-len);
              if (latexSource.includes(candidate)) {
                anchorBefore = candidate;
                break;
              }
            }

            // Find anchor text after selection that exists in source
            let anchorAfter = "";
            for (
              let len = Math.min(maxAnchor, afterSel.length);
              len > 0;
              len--
            ) {
              const candidate = afterSel.slice(0, len);
              const searchStart = anchorBefore
                ? latexSource.indexOf(anchorBefore) + anchorBefore.length
                : 0;
              if (latexSource.indexOf(candidate, searchStart) !== -1) {
                anchorAfter = candidate;
                break;
              }
            }

            // Extract text between anchors in source
            const startAnchorPos = anchorBefore
              ? latexSource.indexOf(anchorBefore)
              : -1;
            const sourceStart =
              startAnchorPos !== -1 ? startAnchorPos + anchorBefore.length : 0;

            const endAnchorPos = anchorAfter
              ? latexSource.indexOf(anchorAfter, sourceStart)
              : -1;
            const sourceEnd =
              endAnchorPos !== -1 ? endAnchorPos : latexSource.length;

            if (sourceStart < sourceEnd) {
              textToCopy = latexSource.substring(sourceStart, sourceEnd);
            } else if (!anchorBefore && !anchorAfter) {
              Zotero.debug(
                `[${config.addonName}] Abstract anchor matching failed, copying full source`,
              );
            }
          }
        }
      }

      await copyToClipboard(textToCopy);
      options.notify(getString("references-panel-abstract-latex-copied"));
    });
    popup.appendChild(copyLatexItem);
  }

  // Add popup to document and open at mouse position
  options.onOpen?.();
  doc.documentElement.appendChild(popup);
  popup.addEventListener(
    "popuphidden",
    () => {
      popup.remove();
      options.onClose?.();
    },
    { once: true },
  );
  popup.openPopupAtScreen(event.screenX, event.screenY, true);
}
