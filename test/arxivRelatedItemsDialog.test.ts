import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectItemsDialog } from "../src/modules/arxiv/browser/relatedItemsDialog";

// The items a paper of the arXiv browser is related to are chosen in Zotero's
// Select Items dialog, among the regular items of the paper's library.

let items: Map<number, Zotero.Item>;

beforeEach(() => {
  items = new Map();
  vi.stubGlobal("Zotero", {
    Promise: {
      defer: () => {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => (resolve = done));
        return { promise, resolve };
      },
    },
    Items: {
      getAsync: async (ids: number[]) => ids.map((id) => items.get(id)),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function item(id: number, regular = true): Zotero.Item {
  const fake = { id, isRegularItem: () => regular } as unknown as Zotero.Item;
  items.set(id, fake);
  return fake;
}

/** A window whose dialog answers with `chosen` (null: closed without) */
function windowAnswering(chosen: number[] | null) {
  const openDialog = vi.fn(
    (_url: string, _name: string, _features: string, io: any) => {
      io.dataOut = chosen;
      io.deferred.resolve();
    },
  );
  return { win: { openDialog } as unknown as Window, openDialog };
}

describe("selectItemsDialog", () => {
  it("offers the regular items of the paper's library, several at once, and gives the regular items chosen", async () => {
    const [a, b] = [item(1), item(2)];
    item(3, false);
    const { win, openDialog } = windowAnswering([1, 2, 3]);
    expect(await selectItemsDialog(win, 7)).toEqual([a, b]);
    const [url, , , io] = openDialog.mock.calls[0];
    expect(url).toBe("chrome://zotero/content/selectItemsDialog.xhtml");
    expect(io).toMatchObject({
      onlyRegularItems: true,
      filterLibraryIDs: [7],
    });
    expect(io.singleSelection).toBeUndefined();
  });

  it("gives no items when the dialog is closed without a choice", async () => {
    expect(await selectItemsDialog(windowAnswering(null).win, 1)).toEqual([]);
  });
});
