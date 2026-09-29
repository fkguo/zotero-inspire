import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  linkItems,
  unlinkItems,
} from "../src/modules/inspire/library/relatedItems";

// Relating items as Zotero's Related section does: both directions in one
// transaction, one undo step, Date Modified unchanged, never across libraries.

/** What happened, in order: transactions, undo labels, saves */
let log: string[];
let inTransaction: boolean;

interface FakeItem {
  id: number;
  key: string;
  libraryID: number;
  relatedItems: string[];
  addRelatedItem(other: FakeItem): boolean;
  removeRelatedItem(other: FakeItem): Promise<boolean>;
  save(options?: { skipDateModifiedUpdate?: boolean }): Promise<void>;
}

function item(id: number, libraryID = 1): FakeItem {
  return {
    id,
    key: `KEY${id}`,
    libraryID,
    relatedItems: [],
    addRelatedItem(other) {
      if (other.libraryID !== this.libraryID) {
        throw new Error("Cannot relate item to an item in a different library");
      }
      if (this.relatedItems.includes(other.key)) return false;
      this.relatedItems.push(other.key);
      return true;
    },
    async removeRelatedItem(other) {
      const index = this.relatedItems.indexOf(other.key);
      if (index < 0) return false;
      this.relatedItems.splice(index, 1);
      return true;
    },
    async save(options) {
      if (!inTransaction) throw new Error("saved outside the transaction");
      log.push(
        `save ${this.id}${options?.skipDateModifiedUpdate ? " (date kept)" : ""}`,
      );
    },
  };
}

const waitForDataLoad = vi.fn(async () => undefined);

beforeEach(() => {
  log = [];
  inTransaction = false;
  vi.stubGlobal("Zotero", {
    Libraries: { get: () => ({ waitForDataLoad }) },
    DB: {
      executeTransaction: async (fn: () => Promise<unknown>) => {
        log.push("begin");
        inTransaction = true;
        try {
          return await fn();
        } finally {
          inTransaction = false;
          log.push("commit");
        }
      },
    },
    UndoHistory: {
      stageAction: (action: string) => {
        if (!inTransaction) throw new Error("staged outside a transaction");
        log.push(action);
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const asItem = (fake: FakeItem) => fake as unknown as Zotero.Item;

describe("linkItems", () => {
  it("relates both ways in one transaction, as one undo step, keeping Date Modified", async () => {
    const source = item(1);
    const a = item(2);
    const b = item(3);
    const change = await linkItems(asItem(source), [asItem(a), asItem(b)]);

    expect(change).toEqual({ status: "changed", items: [a, b] });
    expect(source.relatedItems).toEqual(["KEY2", "KEY3"]);
    expect(a.relatedItems).toEqual(["KEY1"]);
    expect(b.relatedItems).toEqual(["KEY1"]);
    expect(log).toEqual([
      "begin",
      "undo-action-add-related",
      "save 1 (date kept)",
      "save 2 (date kept)",
      "save 1 (date kept)",
      "save 3 (date kept)",
      "commit",
    ]);
    expect(waitForDataLoad).toHaveBeenCalledWith("item");
  });

  it("completes a relation held by one side only", async () => {
    const source = item(1);
    const a = item(2);
    source.relatedItems.push("KEY2");
    const change = await linkItems(asItem(source), [asItem(a)]);

    expect(change.status).toBe("changed");
    expect(a.relatedItems).toEqual(["KEY1"]);
    expect(log).toContain("save 2 (date kept)");
    expect(log).not.toContain("save 1 (date kept)");
  });

  it("changes nothing for items already related", async () => {
    const source = item(1);
    const a = item(2);
    source.relatedItems.push("KEY2");
    a.relatedItems.push("KEY1");
    expect(await linkItems(asItem(source), [asItem(a)])).toEqual({
      status: "unchanged",
    });
    expect(log.filter((line) => line.startsWith("save"))).toEqual([]);
  });

  it("refuses items of another library and writes nothing", async () => {
    const source = item(1, 1);
    const same = item(2, 1);
    const other = item(3, 2);
    expect(
      await linkItems(asItem(source), [asItem(same), asItem(other)]),
    ).toEqual({ status: "otherLibrary" });
    expect(source.relatedItems).toEqual([]);
    expect(same.relatedItems).toEqual([]);
    expect(log).toEqual([]);
  });

  it("does not relate an item to itself", async () => {
    const source = item(1);
    expect(await linkItems(asItem(source), [asItem(source)])).toEqual({
      status: "unchanged",
    });
    expect(log).toEqual([]);
  });
});

describe("unlinkItems", () => {
  it("removes both directions in one transaction, as one undo step, keeping Date Modified", async () => {
    const source = item(1);
    const a = item(2);
    source.relatedItems.push("KEY2");
    a.relatedItems.push("KEY1");
    const change = await unlinkItems(asItem(source), [asItem(a)]);

    expect(change).toEqual({ status: "changed", items: [a] });
    expect(source.relatedItems).toEqual([]);
    expect(a.relatedItems).toEqual([]);
    expect(log).toEqual([
      "begin",
      "undo-action-remove-related",
      "save 1 (date kept)",
      "save 2 (date kept)",
      "commit",
    ]);
  });

  it("changes nothing for items not related", async () => {
    expect(await unlinkItems(asItem(item(1)), [asItem(item(2))])).toEqual({
      status: "unchanged",
    });
  });
});
