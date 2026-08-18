/**
 * Compatibility helpers for collection-tree selection APIs.
 *
 * Zotero 10 replaced the singular getters with plural getters to support
 * multiple selected rows. Older Zotero versions only expose the singular
 * methods, so callers should use these helpers instead of accessing either
 * API directly.
 */

export interface ZoteroPaneSelectionAPI {
  getSelectedCollections?: (asID?: false) => Zotero.Collection[] | undefined;
  getSelectedCollection?: (asID?: false) => Zotero.Collection | undefined;
  getSelectedLibraryIDs?: () => number[] | undefined;
  getSelectedLibraryID?: () => number | undefined;
}

function logSelectionError(method: string, error: unknown): void {
  if (typeof Zotero === "undefined") {
    return;
  }
  Zotero.debug(
    `[zotero-inspire] ${method} failed: ${(error as Error)?.message ?? error}`,
  );
}

export function getSelectedCollectionsCompat(
  pane: ZoteroPaneSelectionAPI | null | undefined,
): Zotero.Collection[] {
  if (!pane) {
    return [];
  }

  if (typeof pane.getSelectedCollections === "function") {
    try {
      const collections = pane.getSelectedCollections(false);
      return Array.isArray(collections) ? collections.filter(Boolean) : [];
    } catch (error) {
      logSelectionError("getSelectedCollections", error);
      return [];
    }
  }

  if (typeof pane.getSelectedCollection === "function") {
    try {
      const collection = pane.getSelectedCollection(false);
      return collection ? [collection] : [];
    } catch (error) {
      logSelectionError("getSelectedCollection", error);
    }
  }

  return [];
}

export function getPrimarySelectedCollection(
  pane: ZoteroPaneSelectionAPI | null | undefined,
): Zotero.Collection | undefined {
  return getSelectedCollectionsCompat(pane)[0];
}

export function getSelectedLibraryIDsCompat(
  pane: ZoteroPaneSelectionAPI | null | undefined,
): number[] {
  if (!pane) {
    return [];
  }

  if (typeof pane.getSelectedLibraryIDs === "function") {
    try {
      const libraryIDs = pane.getSelectedLibraryIDs();
      return Array.isArray(libraryIDs)
        ? libraryIDs.filter((id): id is number => typeof id === "number")
        : [];
    } catch (error) {
      logSelectionError("getSelectedLibraryIDs", error);
      return [];
    }
  }

  if (typeof pane.getSelectedLibraryID === "function") {
    try {
      const libraryID = pane.getSelectedLibraryID();
      return typeof libraryID === "number" ? [libraryID] : [];
    } catch (error) {
      logSelectionError("getSelectedLibraryID", error);
    }
  }

  return [];
}

export function getPrimarySelectedLibraryID(
  pane: ZoteroPaneSelectionAPI | null | undefined,
): number | undefined {
  return getSelectedLibraryIDsCompat(pane)[0];
}
