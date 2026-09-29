// ─────────────────────────────────────────────────────────────────────────────
// Where a new item can be saved: the editable libraries and their
// collections, as the save-target picker (pickerUI.ts) lists them, with the
// targets used recently (Zotero's own "recentSaveTargets" preference, which
// Zotero's Connector keeps as well) and the target the main window suggests
// (the collection or library selected there).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../package.json";
import { getString } from "../utils/locale";
import {
  getPrimarySelectedCollection,
  getPrimarySelectedLibraryID,
} from "../utils/zoteroPaneSelection";
import {
  showTargetPickerUI,
  type SaveTargetPickerOptions,
  type SaveTargetRow,
  type SaveTargetSelection,
} from "./pickerUI";

const RECENT_PREF = "recentSaveTargets";

/** The targets used recently, most recent first (their picker row IDs) */
export function recentSaveTargets(): { ids: Set<string>; ordered: string[] } {
  const ids = new Set<string>();
  const ordered: string[] = [];
  try {
    const raw = Zotero.Prefs.get(RECENT_PREF) as string | undefined;
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
    Zotero.Prefs.clear(RECENT_PREF);
  }
  return { ids, ordered };
}

/** Put a target (its picker row ID) first among the recent ones */
export function rememberSaveTarget(targetID: string): void {
  try {
    const raw = Zotero.Prefs.get(RECENT_PREF) as string | undefined;
    let entries: Array<{ id: string }> = [];
    if (raw) {
      entries = JSON.parse(raw);
    }
    if (!Array.isArray(entries)) {
      entries = [];
    }
    entries = entries.filter((entry) => entry?.id !== targetID);
    entries.unshift({ id: targetID });
    Zotero.Prefs.set(RECENT_PREF, JSON.stringify(entries.slice(0, 5)));
  } catch (err) {
    Zotero.debug(
      `[${config.addonName}] Failed to update recentSaveTargets: ${err}`,
    );
    Zotero.Prefs.clear(RECENT_PREF);
  }
}

/**
 * The target the main window suggests: its selected collection, else its
 * selected library, else My Library
 */
export function mainWindowSaveTargetID(): string | null {
  const pane = Zotero.getActiveZoteroPane?.();
  const selected = getPrimarySelectedCollection(pane);
  if (selected) {
    return `C${selected.id}`;
  }
  const libraryID =
    getPrimarySelectedLibraryID(pane) ??
    Zotero.Libraries.userLibrary?.libraryID;
  return libraryID ? `L${libraryID}` : null;
}

/** The picker's rows: every editable library and its collections */
export function buildSaveTargets(recentIDs: Set<string>): SaveTargetRow[] {
  const targets: SaveTargetRow[] = [];
  for (const library of Zotero.Libraries.getAll()) {
    if (!library?.editable) {
      continue;
    }
    const libraryID = library.libraryID;
    targets.push({
      id: `L${libraryID}`,
      name: library.name,
      level: 0,
      type: "library",
      libraryID,
      filesEditable: library.filesEditable,
      recent: recentIDs.has(`L${libraryID}`),
    });
    const collections = Zotero.Collections.getByLibrary(libraryID, true) || [];
    for (const collection of collections) {
      const rawLevel = (collection as any)?.level;
      const level = typeof rawLevel === "number" ? rawLevel + 1 : 1;
      targets.push({
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
      });
    }
  }
  return targets;
}

/**
 * Ask where to save with the save-target picker over `body` (keeping `listEl`
 * in place), the main window's target chosen at first; null when there is
 * no editable library (`notify` says so) or the picker is closed
 */
export function pickSaveTarget(
  anchor: HTMLElement,
  body: HTMLElement,
  listEl: HTMLElement,
  notify: (message: string) => void,
  pickerOptions?: SaveTargetPickerOptions,
): Promise<SaveTargetSelection | null> {
  const recent = recentSaveTargets();
  const targets = buildSaveTargets(recent.ids);
  if (!targets.length) {
    notify(getString("references-panel-picker-empty"));
    return Promise.resolve(null);
  }
  const defaultID =
    mainWindowSaveTargetID() || recent.ordered[0] || targets[0]?.id || null;
  return showTargetPickerUI(
    targets,
    defaultID,
    anchor,
    body,
    listEl,
    pickerOptions,
  );
}

/**
 * The target of a picker row ID ("L<libraryID>" or "C<collectionID>"), with
 * no tags or note; null when it is gone or its library cannot be edited
 */
export function saveTargetOf(
  targetID: string,
): (SaveTargetSelection & { name: string }) | null {
  const id = Number(targetID.slice(1));
  if (!Number.isInteger(id) || id <= 0) return null;
  if (targetID.startsWith("L")) {
    const library = Zotero.Libraries.get(id);
    return library && library.editable
      ? {
          libraryID: id,
          primaryRowID: targetID,
          collectionIDs: [],
          tags: [],
          note: "",
          name: library.name,
        }
      : null;
  }
  if (targetID.startsWith("C")) {
    const collection = Zotero.Collections.get(id);
    const library = collection && Zotero.Libraries.get(collection.libraryID);
    return collection && !collection.deleted && library && library.editable
      ? {
          libraryID: collection.libraryID,
          primaryRowID: targetID,
          collectionIDs: [id],
          tags: [],
          note: "",
          name: collection.name,
        }
      : null;
  }
  return null;
}
