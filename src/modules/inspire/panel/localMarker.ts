// ─────────────────────────────────────────────────────────────────────────────
// The "in library" mark of a paper in a list row and in the hover card: ● for
// one item with the paper's recid (in the arXiv browser, its arXiv
// identifier), a circled number for several (the tooltip lists them), ⊕ for
// none (a click adds the paper), ? when the library could not be read (a
// click tries again).
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { getCachedStrings } from "../formatters";
import { applyRefEntryMarkerColor } from "../../pickerUI";
import { loadedItem, type LocalPaper } from "../library/localStatus";

/** ② … ⑳ for 2 to 20 items */
const CIRCLED_NUMBERS = "②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

export type LocalMarkState = "local" | "missing" | "unknown";

export function localMarkState(paper: LocalPaper): LocalMarkState {
  if (paper.localStatusUnknown) return "unknown";
  return paper.localItemID ? "local" : "missing";
}

/** Number of items found for the paper (0 when it is not in the library) */
export function localItemCount(paper: LocalPaper): number {
  if (!paper.localItemID) return 0;
  return Math.max(1, paper.localItemIDs?.length ?? 1);
}

/**
 * The items of a paper found in the library, one line each ("title — library
 * name"), under a heading with their number; "" for fewer than two
 */
export function localItemsList(paper: LocalPaper): string {
  const count = localItemCount(paper);
  if (count < 2) return "";
  const lines = (paper.localItemIDs ?? []).map((itemID) => {
    // An item of a library not loaded yet shows only its library
    const item = loadedItem(itemID);
    const libraryID = item
      ? item.libraryID
      : (Zotero.Items.getLibraryAndKeyFromID(itemID) || undefined)?.libraryID;
    const title = item
      ? (typeof item.getDisplayTitle === "function"
          ? item.getDisplayTitle()
          : "") || String(item.getField("title") ?? "")
      : "";
    const library =
      libraryID === undefined
        ? undefined
        : (Zotero.Libraries.get(libraryID) as any)?.name;
    const parts = [title, library].filter(
      (part): part is string => typeof part === "string" && part !== "",
    );
    return `• ${parts.join(" — ") || `#${itemID}`}`;
  });
  return [
    getString(
      paper.localFoundBy === "arxiv"
        ? "references-panel-dot-local-several-arxiv"
        : "references-panel-dot-local-several",
      { args: { count } },
    ),
    ...lines,
  ].join("\n");
}

/** ② … ⑳ for a paper with 2 to 20 items, "" otherwise */
export function localCountMark(paper: LocalPaper): string {
  const count = localItemCount(paper);
  return count >= 2 && count - 2 < CIRCLED_NUMBERS.length
    ? CIRCLED_NUMBERS[count - 2]
    : "";
}

/** Show a paper's mark on a list row's marker element */
export function applyLocalMarker(
  marker: HTMLElement,
  paper: LocalPaper,
  dark: boolean,
): void {
  const s = getCachedStrings();
  const state = localMarkState(paper);
  marker.dataset.state = state;
  if (state === "unknown") {
    marker.textContent = "?";
    marker.style.color = dark ? "#9ca3af" : "#6b7280";
    marker.style.opacity = "1";
    marker.setAttribute(
      "title",
      getString("references-panel-dot-unknown") || "",
    );
    return;
  }
  marker.textContent = localCountMark(paper) || (state === "local" ? "●" : "⊕");
  applyRefEntryMarkerColor(marker, state === "local", dark);
  marker.setAttribute(
    "title",
    state === "local" ? localItemsList(paper) || s.dotLocal : s.dotAdd,
  );
}
