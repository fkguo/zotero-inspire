// ─────────────────────────────────────────────────────────────────────────────
// The item the arXiv browser relates papers to: the main window's current
// item, as the item pane shows it — the item selected in the library, or the
// paper open in a reader tab (read one paper, relate new ones to it). With
// several selected, the first; a note (a note tab) or an attachment of its
// own is no target. It is read again whenever the browser window gets the
// focus. Another item can be chosen with Zotero's Select Items dialog; the
// choice holds until another item is selected in the main window.
// ─────────────────────────────────────────────────────────────────────────────

import { getString } from "../../../utils/locale";
import { button, html } from "./dom";

export type RelationTargetState =
  | {
      item: Zotero.Item;
      /** Chosen in the dialog rather than the main window's */
      chosen: boolean;
      /** The main window has several items selected: the first is taken */
      several: boolean;
    }
  | {
      item: null;
      /** Nothing selected, or what is selected is not a regular item */
      reason: "none" | "notRegular";
    };

export interface RelationTargetOptions {
  /** The main window's current items (ZoteroPane.getSelectedItems) */
  mainItems?: () => Zotero.Item[];
  /**
   * Ask the user for a regular item (of `libraryID` when given); null when
   * none was chosen
   */
  pickItem?: (
    win: Window,
    libraryID: number | undefined,
  ) => Promise<Zotero.Item | null>;
  /** The target changed */
  onChange(): void;
}

function mainWindowItems(): Zotero.Item[] {
  const pane = Zotero.getMainWindow()?.ZoteroPane;
  return (pane?.getSelectedItems() ?? []) as Zotero.Item[];
}

/** Zotero's Select Items dialog, as the item pane's Related section opens it */
async function selectItemsDialog(
  win: Window,
  libraryID: number | undefined,
): Promise<Zotero.Item | null> {
  const io: Record<string, unknown> = {
    dataIn: null,
    dataOut: null,
    deferred: Zotero.Promise.defer(),
    itemTreeID: "zoteroinspire-arxiv-relation-select-item",
    onlyRegularItems: true,
    singleSelection: true,
    ...(libraryID ? { filterLibraryIDs: [libraryID] } : {}),
  };
  win.openDialog(
    "chrome://zotero/content/selectItemsDialog.xhtml",
    "",
    "chrome,dialog=no,centerscreen,resizable=yes",
    io,
  );
  await (io.deferred as { promise: Promise<void> }).promise;
  const [id] = (io.dataOut as number[] | null) ?? [];
  if (!id) return null;
  const item = (await Zotero.Items.getAsync(id)) as Zotero.Item | false;
  return item && item.isRegularItem() ? item : null;
}

export class RelationTarget {
  private readonly mainItems: () => Zotero.Item[];
  private readonly pickItem: NonNullable<RelationTargetOptions["pickItem"]>;
  /** An item chosen in the dialog, and the main window's item at the time */
  private chosen: { itemID: number; mainID: number | null } | null = null;
  private state: RelationTargetState = { item: null, reason: "none" };

  constructor(private readonly options: RelationTargetOptions) {
    this.mainItems = options.mainItems ?? mainWindowItems;
    this.pickItem = options.pickItem ?? selectItemsDialog;
    this.state = this.read();
  }

  get current(): RelationTargetState {
    return this.state;
  }

  /** The target item, if any (erased meanwhile: none) */
  get item(): Zotero.Item | null {
    const item = this.state.item;
    return item && Zotero.Items.get(item.id) ? item : null;
  }

  /** Read the main window's current item again (the window got the focus) */
  refresh(): void {
    const before = this.state;
    const next = this.read();
    this.state = next;
    if (
      before.item?.id !== next.item?.id ||
      (before.item ? before.several : before.reason) !==
        (next.item ? next.several : next.reason)
    ) {
      this.options.onChange();
    }
  }

  private read(): RelationTargetState {
    const items = this.mainItems();
    const main = items[0] ?? null;
    const chosen =
      this.chosen && (main?.id ?? null) === this.chosen.mainID
        ? (Zotero.Items.get(this.chosen.itemID) as Zotero.Item | false)
        : false;
    if (chosen) return { item: chosen, chosen: true, several: false };
    // Another item selected in the main window takes over
    this.chosen = null;
    if (!main) return { item: null, reason: "none" };
    return main.isRegularItem()
      ? { item: main, chosen: false, several: items.length > 1 }
      : { item: null, reason: "notRegular" };
  }

  /**
   * Choose the target in Zotero's Select Items dialog, among the regular
   * items of `libraryID` (the library papers are added to)
   */
  async choose(win: Window, libraryID: number | undefined): Promise<void> {
    const item = await this.pickItem(win, libraryID);
    if (!item) return;
    this.chosen = { itemID: item.id, mainID: this.mainItems()[0]?.id ?? null };
    this.refresh();
  }
}

/** The toolbar's line naming the target, with its Change… button */
export function relationTargetLine(
  doc: Document,
  target: RelationTarget,
  onChoose: () => void,
): { element: HTMLElement; render(): void } {
  const element = html(doc, "span", "arxiv-browser__relation");
  const label = html(doc, "span", "arxiv-browser__relation-target");
  const note = html(doc, "span", "arxiv-browser__relation-note");
  const change = button(
    doc,
    getString("arxiv-browser-relation-change"),
    onChoose,
  );
  element.append(
    html(
      doc,
      "span",
      "arxiv-browser__label",
      getString("arxiv-browser-relation-label"),
    ),
    label,
    note,
    change,
  );
  const render = () => {
    const state = target.current;
    if (state.item) {
      const title = state.item.getDisplayTitle() || `#${state.item.id}`;
      label.textContent = title;
      label.title = title;
      note.textContent = state.chosen
        ? getString("arxiv-browser-relation-chosen")
        : state.several
          ? getString("arxiv-browser-relation-several")
          : getString("arxiv-browser-relation-main");
    } else {
      label.textContent = "";
      label.title = "";
      note.textContent = getString(
        state.reason === "notRegular"
          ? "arxiv-browser-relation-not-regular"
          : "arxiv-browser-relation-none",
      );
    }
  };
  render();
  return { element, render };
}
