// ─────────────────────────────────────────────────────────────────────────────
// Selecting items by mouse the usual way, for lists shown as bars, days or
// rows: a click selects only the item (a click on the only selected item
// clears the selection), Ctrl/Cmd+click adds or removes one item, and
// Shift+click selects the items from the last clicked one to this one
// (added to the selection with Ctrl/Cmd as well). Used by the References
// panel's chart; the arXiv browser's calendar is to use it too.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClickModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Apply a click on `key` to `selected`. `order` is the selectable items in
 * the order shown: a Shift+click takes its range from them, and selects an
 * item not among them alone. `lastClicked` is the item clicked before, the
 * range's other end while anything is selected; the caller keeps it (sets it
 * to `key` after each click).
 */
export function applyClickSelection<K>(
  selected: Set<K>,
  key: K,
  order: readonly K[],
  lastClicked: K | undefined,
  modifiers: ClickModifiers,
): void {
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  if (modifiers.shiftKey) {
    const target = order.indexOf(key);
    if (target >= 0) {
      // Extend from the last clicked item only while some item is still
      // selected: a cleared selection starts again from this item
      const anchor =
        selected.size && lastClicked !== undefined
          ? order.indexOf(lastClicked)
          : -1;
      const start = anchor === -1 ? target : anchor;
      if (!additive) selected.clear();
      for (const item of order.slice(
        Math.min(start, target),
        Math.max(start, target) + 1,
      )) {
        selected.add(item);
      }
      return;
    }
    // Not among the items shown: select it alone
    if (!additive && !selected.has(key)) {
      selected.clear();
      selected.add(key);
      return;
    }
  }
  if (additive) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
  } else if (selected.size === 1 && selected.has(key)) {
    selected.clear();
  } else {
    selected.clear();
    selected.add(key);
  }
}
