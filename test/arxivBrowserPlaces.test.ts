// ─────────────────────────────────────────────────────────────────────────────
// The arXiv browser window's places, for Back and Forward: a new place drops
// those after the current one, at most 50 are kept, a place that cannot be
// shown again goes; Back and Forward within a page keep to the place's own
// steps in its history, up to where the next place began when it shows the
// same page element.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  pageCanGoBack,
  pageCanGoForward,
  PlaceHistory,
  sameDays,
  sameSelection,
  type Place,
} from "../src/modules/arxiv/browser/placeHistory";

const search = (text: string): Place => ({
  list: { kind: "search", text },
  position: null,
  pane: { kind: "detail" },
});
const page = (element: number, start: number): Place => ({
  list: { kind: "search", text: "x" },
  position: null,
  pane: {
    kind: "page",
    paper: { id: "2502.20357", url: "https://arxiv.org/html/2502.20357" },
    address: "https://arxiv.org/html/2502.20357",
    element,
    start,
  },
});
const texts = (history: PlaceHistory) => {
  const out: string[] = [];
  while (history.back());
  for (let place = history.current; place; place = history.forward()) {
    out.push(place.list.kind === "search" ? place.list.text : "days");
  }
  return out;
};

describe("arXiv browser places", () => {
  it("goes back and forward, and a new place drops those after the current one", () => {
    const history = new PlaceHistory();
    expect(history.current).toBeNull();
    expect(history.back()).toBeNull();
    history.push(search("a"));
    history.push(search("b"));
    history.push(search("c"));
    expect(history.back()?.list).toEqual({ kind: "search", text: "b" });
    expect(history.previous?.list).toEqual({ kind: "search", text: "a" });
    expect(history.next?.list).toEqual({ kind: "search", text: "c" });
    history.push(search("d"));
    expect(history.next).toBeNull();
    expect(texts(history)).toEqual(["a", "b", "d"]);
  });

  it("keeps the newest 50 places", () => {
    const history = new PlaceHistory();
    for (let i = 0; i < 55; i++) history.push(search(String(i)));
    const kept = texts(history);
    expect(kept).toHaveLength(50);
    expect(kept[0]).toBe("5");
    expect(kept[49]).toBe("54");
  });

  it("drops the places after the current one, or the current one", () => {
    const history = new PlaceHistory();
    for (const text of ["a", "b", "c", "d"]) history.push(search(text));
    history.back();
    history.back();
    history.dropForward();
    expect(history.next).toBeNull();
    expect(texts(history)).toEqual(["a", "b"]);
    history.push(search("c"));
    history.back();
    // b goes: c takes its index, a is before it
    history.dropCurrent();
    expect(history.current?.list).toEqual({ kind: "search", text: "c" });
    expect(history.previous?.list).toEqual({ kind: "search", text: "a" });
  });

  it("steps back in a page only above where the place began in it", () => {
    const place = page(3, 2);
    expect(pageCanGoBack(place, { element: 3, index: 3, count: 4 })).toBe(true);
    expect(pageCanGoBack(place, { element: 3, index: 2, count: 4 })).toBe(
      false,
    );
    // Another element (the page was closed and opened again)
    expect(pageCanGoBack(place, { element: 4, index: 3, count: 4 })).toBe(
      false,
    );
    expect(pageCanGoBack(search("a"), { element: 3, index: 3, count: 4 })).toBe(
      false,
    );
    expect(pageCanGoBack(place, null)).toBe(false);
  });

  it("steps forward in a page up to where the next place began in it, else to its end", () => {
    const place = page(3, 0);
    const at = (index: number) => ({ element: 3, index, count: 4 });
    // The next place shows the same element from entry 2 on
    expect(pageCanGoForward(place, page(3, 2), at(1))).toBe(true);
    expect(pageCanGoForward(place, page(3, 2), at(2))).toBe(false);
    // The next place shows another page, or there is none: to the end
    expect(pageCanGoForward(place, page(5, 0), at(2))).toBe(true);
    expect(pageCanGoForward(place, null, at(3))).toBe(false);
    expect(pageCanGoForward(place, null, { ...at(2), element: 4 })).toBe(false);
  });

  it("compares choices of days", () => {
    expect(sameSelection({ kind: "newest" }, { kind: "newest" })).toBe(true);
    expect(sameSelection({ kind: "newest" }, { kind: "recent" })).toBe(false);
    expect(
      sameSelection(
        { kind: "days", dates: ["2026-09-23", "2026-09-22"] },
        { kind: "days", dates: ["2026-09-22", "2026-09-23"] },
      ),
    ).toBe(true);
    expect(
      sameSelection(
        { kind: "days", dates: ["2026-09-23"] },
        { kind: "days", dates: ["2026-09-22"] },
      ),
    ).toBe(false);
    expect(sameDays(["2026-09-25"], ["2026-09-25"])).toBe(true);
    expect(sameDays(undefined, ["2026-09-25"])).toBe(false);
  });
});
