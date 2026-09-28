import { describe, expect, it } from "vitest";
import { applyClickSelection } from "../src/utils/clickSelection";

// Selecting by mouse: click, Ctrl/Cmd+click, Shift+click (the References
// panel's chart bars and the arXiv browser's calendar days).

const ORDER = ["a", "b", "c", "d", "e"];
const plain = { shiftKey: false, ctrlKey: false, metaKey: false };
const shift = { ...plain, shiftKey: true };
const cmd = { ...plain, metaKey: true };
const ctrl = { ...plain, ctrlKey: true };

function clicks(
  steps: Array<[string, typeof plain]>,
  selected = new Set<string>(),
) {
  let last: string | undefined;
  for (const [key, modifiers] of steps) {
    applyClickSelection(selected, key, ORDER, last, modifiers);
    last = key;
  }
  return [...selected].sort();
}

describe("click selection", () => {
  it("selects one item with a click, and clears it with a second click", () => {
    expect(clicks([["b", plain]])).toEqual(["b"]);
    expect(
      clicks([
        ["b", plain],
        ["d", plain],
      ]),
    ).toEqual(["d"]);
    expect(
      clicks([
        ["b", plain],
        ["b", plain],
      ]),
    ).toEqual([]);
  });

  it("adds and removes items with Ctrl or Cmd", () => {
    expect(
      clicks([
        ["b", plain],
        ["d", cmd],
        ["e", ctrl],
        ["b", cmd],
      ]),
    ).toEqual(["d", "e"]);
  });

  it("selects the range from the last clicked item with Shift, in either direction", () => {
    expect(
      clicks([
        ["b", plain],
        ["d", shift],
      ]),
    ).toEqual(["b", "c", "d"]);
    expect(
      clicks([
        ["d", plain],
        ["a", shift],
      ]),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("replaces the selection with the range, or adds the range with Ctrl/Cmd", () => {
    expect(
      clicks([
        ["a", plain],
        ["e", cmd],
        ["c", shift],
      ]),
    ).toEqual(["c", "d", "e"]);
    expect(
      clicks([
        ["a", plain],
        ["d", cmd],
        ["e", { ...shift, metaKey: true }],
      ]),
    ).toEqual(["a", "d", "e"]);
  });

  it("starts the range at the clicked item when nothing is selected", () => {
    expect(
      clicks([
        ["b", plain],
        ["b", plain],
        ["d", shift],
      ]),
    ).toEqual(["d"]);
  });

  it("selects an item not among those shown alone with Shift", () => {
    const selected = new Set(["a"]);
    applyClickSelection(selected, "x", ORDER, "a", shift);
    expect([...selected]).toEqual(["x"]);
  });
});
