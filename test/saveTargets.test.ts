import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rememberSaveTarget,
  recentSaveTargets,
  saveTargetOf,
} from "../src/modules/saveTargets";

// Save targets by their picker row IDs: a library ("L<id>") or a collection
// ("C<id>"), usable only while it exists and its library can be edited.

let prefs: Record<string, unknown>;

beforeEach(() => {
  prefs = {};
  const libraries: Record<number, { name: string; editable: boolean }> = {
    1: { name: "My Library", editable: true },
    2: { name: "Read-only group", editable: false },
  };
  const collections: Record<number, object> = {
    12: { id: 12, name: "to-read", libraryID: 1, deleted: false },
    13: { id: 13, name: "Old", libraryID: 1, deleted: true },
    14: { id: 14, name: "Shared", libraryID: 2, deleted: false },
  };
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Prefs: {
      get: (key: string) => prefs[key],
      set: (key: string, value: unknown) => {
        prefs[key] = value;
      },
      clear: (key: string) => delete prefs[key],
    },
    Libraries: { get: (id: number) => libraries[id] ?? false },
    Collections: { get: (id: number) => collections[id] ?? false },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("saveTargetOf", () => {
  it("gives a library and a collection as targets, with their names", () => {
    expect(saveTargetOf("L1")).toEqual({
      libraryID: 1,
      primaryRowID: "L1",
      collectionIDs: [],
      tags: [],
      note: "",
      name: "My Library",
    });
    expect(saveTargetOf("C12")).toEqual({
      libraryID: 1,
      primaryRowID: "C12",
      collectionIDs: [12],
      tags: [],
      note: "",
      name: "to-read",
    });
  });

  it("gives nothing for a deleted collection, a library that cannot be edited, or anything else", () => {
    expect(saveTargetOf("C13")).toBeNull();
    expect(saveTargetOf("C14")).toBeNull();
    expect(saveTargetOf("L2")).toBeNull();
    expect(saveTargetOf("C99")).toBeNull();
    expect(saveTargetOf("")).toBeNull();
    expect(saveTargetOf("X1")).toBeNull();
  });
});

describe("recent save targets", () => {
  it("keeps the five used last, the latest first", () => {
    for (const id of ["L1", "C12", "C13", "C14", "C15", "L1", "C16"]) {
      rememberSaveTarget(id);
    }
    expect(recentSaveTargets().ordered).toEqual([
      "C16",
      "L1",
      "C15",
      "C14",
      "C13",
    ]);
  });
});
