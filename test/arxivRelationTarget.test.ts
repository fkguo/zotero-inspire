import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import {
  RelationTarget,
  relationTargetLine,
} from "../src/modules/arxiv/browser/relationTarget";

// The arXiv browser's relation target: the main window's current item (the
// item selected in the library, or the paper open in a reader tab), a
// regular item only; one chosen in the Select Items dialog holds until
// another item is selected in the main window.

let items: Map<number, Zotero.Item>;

beforeEach(() => {
  items = new Map();
  vi.stubGlobal("Zotero", {
    Items: { get: (id: number) => items.get(id) ?? false },
  });
  vi.stubGlobal("addon", {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id }]: Array<{ id: string }>) => [
            { value: id },
          ],
        },
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function item(id: number, regular = true): Zotero.Item {
  const fake = {
    id,
    isRegularItem: () => regular,
    getDisplayTitle: () => `Paper ${id}`,
  } as unknown as Zotero.Item;
  items.set(id, fake);
  return fake;
}

/** A target following `main` (the main window's current items) */
function target(main: { items: Zotero.Item[] }, pick?: Zotero.Item | null) {
  const onChange = vi.fn();
  const pickItem = vi.fn(async () => pick ?? null);
  const relation = new RelationTarget({
    mainItems: () => main.items,
    pickItem,
    onChange,
  });
  return { relation, onChange, pickItem };
}

const win = {} as Window;

describe("RelationTarget", () => {
  it("is the main window's current item", () => {
    const a = item(1);
    const { relation } = target({ items: [a] });
    expect(relation.current).toEqual({
      item: a,
      chosen: false,
      several: false,
    });
    expect(relation.item).toBe(a);
  });

  it("is the first of several items selected, and says so", () => {
    const a = item(1);
    const { relation } = target({ items: [a, item(2)] });
    expect(relation.current).toEqual({ item: a, chosen: false, several: true });
  });

  it("is none for a note (a note tab) or a file of its own", () => {
    const { relation } = target({ items: [item(1, false)] });
    expect(relation.current).toEqual({ item: null, reason: "notRegular" });
    expect(relation.item).toBeNull();
  });

  it("is none when nothing is selected", () => {
    const { relation } = target({ items: [] });
    expect(relation.current).toEqual({ item: null, reason: "none" });
  });

  it("follows the main window when the window gets the focus, telling only changes", () => {
    const main = { items: [item(1)] };
    const { relation, onChange } = target(main);
    relation.refresh();
    expect(onChange).not.toHaveBeenCalled();
    const b = item(2);
    main.items = [b];
    relation.refresh();
    expect(relation.item).toBe(b);
    expect(onChange).toHaveBeenCalledTimes(1);
    main.items = [b, item(3)];
    relation.refresh();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps an item chosen in the dialog until another item is selected in the main window", async () => {
    const main = { items: [item(1)] };
    const chosen = item(5);
    const { relation, pickItem } = target(main, chosen);
    await relation.choose(win, 7);
    expect(pickItem).toHaveBeenCalledWith(win, 7);
    expect(relation.current).toEqual({
      item: chosen,
      chosen: true,
      several: false,
    });
    // The focus comes back from the dialog: the choice holds
    relation.refresh();
    expect(relation.item).toBe(chosen);
    // Another item selected in the main window takes over
    const b = item(2);
    main.items = [b];
    relation.refresh();
    expect(relation.current).toEqual({
      item: b,
      chosen: false,
      several: false,
    });
  });

  it("stays as it was when the dialog is closed without a choice", async () => {
    const a = item(1);
    const { relation, onChange } = target({ items: [a] }, null);
    await relation.choose(win, undefined);
    expect(relation.item).toBe(a);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has no item once the item is deleted for good", () => {
    const a = item(1);
    const { relation } = target({ items: [a] });
    items.delete(1);
    expect(relation.item).toBeNull();
  });
});

describe("relationTargetLine", () => {
  it("names the target and why it is the target", () => {
    const doc = new JSDOM("<!DOCTYPE html><body></body>").window.document;
    const main = { items: [item(1), item(2)] };
    const { relation } = target(main);
    const onChoose = vi.fn();
    const line = relationTargetLine(doc, relation, onChoose);
    const text = () => line.element.textContent;
    const ref = (id: string) => `${config.addonRef}-${id}`;
    expect(text()).toContain("Paper 1");
    expect(text()).toContain(ref("arxiv-browser-relation-several"));
    main.items = [item(3, false)];
    relation.refresh();
    line.render();
    expect(text()).not.toContain("Paper");
    expect(text()).toContain(ref("arxiv-browser-relation-not-regular"));
    line.element.querySelector("button")!.click();
    expect(onChoose).toHaveBeenCalled();
  });
});
