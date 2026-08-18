import { describe, expect, it, vi } from "vitest";
import {
  getPrimarySelectedCollection,
  getPrimarySelectedLibraryID,
  getSelectedCollectionsCompat,
  getSelectedLibraryIDsCompat,
  type ZoteroPaneSelectionAPI,
} from "../src/utils/zoteroPaneSelection";

function collection(id: number): Zotero.Collection {
  return { id } as Zotero.Collection;
}

describe("Zotero pane selection compatibility", () => {
  it("uses Zotero 10 plural collection getters", () => {
    const first = collection(1);
    const second = collection(2);
    const legacyGetter = vi.fn(() => {
      throw new Error("legacy getter must not run");
    });
    const pane: ZoteroPaneSelectionAPI = {
      getSelectedCollections: () => [first, second],
      getSelectedCollection: legacyGetter,
    };

    expect(getSelectedCollectionsCompat(pane)).toEqual([first, second]);
    expect(getPrimarySelectedCollection(pane)).toBe(first);
    expect(legacyGetter).not.toHaveBeenCalled();
  });

  it("falls back to Zotero 7-9 singular collection getters", () => {
    const selected = collection(7);
    const pane: ZoteroPaneSelectionAPI = {
      getSelectedCollection: () => selected,
    };

    expect(getSelectedCollectionsCompat(pane)).toEqual([selected]);
    expect(getPrimarySelectedCollection(pane)).toBe(selected);
  });

  it("does not invoke a removed singular getter for an empty plural selection", () => {
    const legacyGetter = vi.fn(() => {
      throw new Error("removed");
    });
    const pane: ZoteroPaneSelectionAPI = {
      getSelectedCollections: () => [],
      getSelectedCollection: legacyGetter,
    };

    expect(getSelectedCollectionsCompat(pane)).toEqual([]);
    expect(legacyGetter).not.toHaveBeenCalled();
  });

  it("does not invoke a removed singular getter when the plural getter throws", () => {
    const legacyCollectionGetter = vi.fn(() => {
      throw new Error("removed");
    });
    const legacyLibraryGetter = vi.fn(() => {
      throw new Error("removed");
    });
    const pane: ZoteroPaneSelectionAPI = {
      getSelectedCollections: () => {
        throw new Error("selection unavailable");
      },
      getSelectedCollection: legacyCollectionGetter,
      getSelectedLibraryIDs: () => {
        throw new Error("selection unavailable");
      },
      getSelectedLibraryID: legacyLibraryGetter,
    };

    expect(getSelectedCollectionsCompat(pane)).toEqual([]);
    expect(getSelectedLibraryIDsCompat(pane)).toEqual([]);
    expect(legacyCollectionGetter).not.toHaveBeenCalled();
    expect(legacyLibraryGetter).not.toHaveBeenCalled();
  });

  it("uses plural library getters and filters invalid IDs", () => {
    const legacyGetter = vi.fn(() => 9);
    const pane: ZoteroPaneSelectionAPI = {
      getSelectedLibraryIDs: () => [3, undefined, 4] as unknown as number[],
      getSelectedLibraryID: legacyGetter,
    };

    expect(getSelectedLibraryIDsCompat(pane)).toEqual([3, 4]);
    expect(getPrimarySelectedLibraryID(pane)).toBe(3);
    expect(legacyGetter).not.toHaveBeenCalled();
  });

  it("falls back to a singular library getter and handles no pane", () => {
    const pane: ZoteroPaneSelectionAPI = {
      getSelectedLibraryID: () => 11,
    };

    expect(getSelectedLibraryIDsCompat(pane)).toEqual([11]);
    expect(getPrimarySelectedLibraryID(pane)).toBe(11);
    expect(getSelectedCollectionsCompat(undefined)).toEqual([]);
    expect(getSelectedLibraryIDsCompat(null)).toEqual([]);
  });
});
