// Small helpers for building the arXiv browser's elements. Elements are made
// in the XHTML namespace, as Zotero's .xhtml windows need for inputs and
// buttons.

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** A new element of `doc`, with a class and text if given */
export function html<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElementNS(
    XHTML_NS,
    tag,
  ) as HTMLElementTagNameMap[K];
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** A button of `doc` that runs `onClick` */
export function button(
  doc: Document,
  label: string,
  onClick: (event: MouseEvent) => void,
  className = "arxiv-browser__button",
): HTMLButtonElement {
  const element = html(doc, "button", className, label);
  element.type = "button";
  element.addEventListener("click", onClick);
  return element;
}

/** A checkbox with its label */
export function checkbox(
  doc: Document,
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  className = "arxiv-browser__check",
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = html(doc, "label", className);
  const input = html(doc, "input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  wrapper.append(input, doc.createTextNode(label));
  return { label: wrapper, input };
}

/** An entry of a menu */
export interface MenuEntry {
  label: string;
  run: () => void;
}

/** A menu of `entries`, removed once closed */
function menuOf(
  target: Document,
  entries: readonly MenuEntry[],
): XUL.MenuPopup {
  const doc = target as Document & {
    createXULElement(tag: string): XULElement;
  };
  const popup = doc.createXULElement("menupopup") as XUL.MenuPopup;
  for (const entry of entries) {
    const item = doc.createXULElement("menuitem");
    item.setAttribute("label", entry.label);
    item.addEventListener("command", () => entry.run());
    popup.append(item);
  }
  doc.documentElement.append(popup);
  popup.addEventListener("popuphidden", () => popup.remove(), { once: true });
  return popup;
}

/** A menu of `entries` below `anchor` */
export function showMenu(
  anchor: HTMLElement,
  entries: readonly MenuEntry[],
): void {
  menuOf(anchor.ownerDocument, entries).openPopup(
    anchor as unknown as XULElement,
    "after_start",
    0,
    0,
  );
}

/** A context menu of `entries` at (`x`, `y`) from `anchor`'s top left corner */
export function showMenuAt(
  anchor: Element,
  entries: readonly MenuEntry[],
  x: number,
  y: number,
): void {
  menuOf(anchor.ownerDocument, entries).openPopup(
    anchor as unknown as XULElement,
    "overlap",
    x,
    y,
    true,
  );
}
