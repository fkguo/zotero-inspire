// ─────────────────────────────────────────────────────────────────────────────
// Items the plugin creates are marked until the new-item hook has seen them:
// the hook leaves out its automatic INSPIRE update for them only, and removes
// the mark. Items added any other way are updated as before.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMeta: vi.fn(),
  prefs: new Map<string, unknown>([["meta", "full"]]),
}));

vi.mock("../src/modules/inspire/metadataService", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchInspireMetaByRecid: mocks.fetchMeta,
}));
vi.mock("../src/modules/inspire/itemUpdater", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setInspireMeta: async () => undefined,
  getItemTypePolicy: () => ({ keepPreprintType: true }),
  saveItemWithPendingInspireNote: (item: any, options: unknown) =>
    item.saveTx(options),
}));
vi.mock("../src/utils/prefs", () => ({
  getPref: (key: string) => mocks.prefs.get(key),
  setPref: () => undefined,
}));

import hooks from "../src/hooks";
import {
  createItemFromInspireMeta,
  createItemFromInspireRecord,
  markCreatedByPlugin,
} from "../src/modules/inspire/library/itemCreation";
import { FakeNewItem, installFakeNewItems } from "./fakeNewItem";

const TARGET = { libraryID: 1, collectionIDs: [] };
let updateItems: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Items: {
      get: (ids: number[]) =>
        FakeNewItem.created.filter((item) => ids.includes(item.id!)),
    },
  });
  installFakeNewItems();
  updateItems = vi.fn();
  vi.stubGlobal("_globalThis", { inspire: { updateItems } });
  mocks.fetchMeta.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("items the plugin creates", () => {
  it("are saved with the plugin's mark, which the new-item hook removes without updating them", async () => {
    const item = await createItemFromInspireMeta(
      { title: "A paper", document_type: ["article"] },
      TARGET,
    );
    const saved = item as unknown as FakeNewItem;
    expect(saved.marksAtSave).toEqual([["_zinspireCreatedByPlugin"]]);

    await hooks.onNotify("add", "item", [item.id], {});

    expect(updateItems).not.toHaveBeenCalled();
    expect(Object.keys(saved)).not.toContain("_zinspireCreatedByPlugin");
  });

  it("leave other items of the same addition to the automatic update", async () => {
    const mine = new Zotero.Item("preprint") as unknown as FakeNewItem;
    markCreatedByPlugin(mine as any);
    await mine.saveTx();
    const other = new Zotero.Item("preprint") as unknown as FakeNewItem;
    other.setField("extra", "arXiv:2609.28544");
    await other.saveTx();

    await hooks.onNotify("add", "item", [mine.id, other.id], {});

    expect(updateItems).toHaveBeenCalledWith([other], "full");
  });

  it("are updated automatically when added again later without the mark", async () => {
    const item = new Zotero.Item("preprint") as unknown as FakeNewItem;
    markCreatedByPlugin(item as any);
    await item.saveTx();
    await hooks.onNotify("add", "item", [item.id], {});
    // The mark was read once: a later "add" of the same item (undone
    // deletion, say) is treated like any other
    await hooks.onNotify("add", "item", [item.id], {});
    expect(updateItems).toHaveBeenCalledTimes(1);
  });

  it("are not created when INSPIRE gives no record", async () => {
    mocks.fetchMeta.mockResolvedValue(-1);
    expect(await createItemFromInspireRecord("123", TARGET)).toBeNull();
    expect(FakeNewItem.created).toEqual([]);
  });
});
