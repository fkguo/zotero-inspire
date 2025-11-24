import { getString } from "../utils/locale";

export interface SaveTargetRow {
  id: string;
  name: string;
  level: number;
  type: "library" | "collection";
  libraryID: number;
  collectionID?: number;
  filesEditable: boolean;
  parentID?: string;
  recent?: boolean;
}

export interface SaveTargetSelection {
  libraryID: number;
  primaryRowID: string;
  collectionIDs: number[];
}

export function showTargetPickerUI(
  targets: SaveTargetRow[],
  defaultID: string | null,
  anchor: HTMLElement,
  body: HTMLElement,
  listEl: HTMLElement,
): Promise<SaveTargetSelection | null> {
  return new Promise((resolve) => {
    const doc = body.ownerDocument;

    const previousScrollTop = listEl.scrollTop;
    const previousScrollLeft = listEl.scrollLeft;
    const previousActiveElement = doc.activeElement as Element | null;
    const isElementNode = (value: any): value is Element =>
      Boolean(value && typeof value === "object" && value.nodeType === 1);

    type ScrollSnapshot = { element: Element; top: number; left: number };
    const captureScrollSnapshots = () => {
      const snapshots: ScrollSnapshot[] = [];
      let current: Element | null = body;
      while (current) {
        const node = current as any;
        if (
          typeof node.scrollTop === "number" &&
          typeof node.scrollHeight === "number" &&
          typeof node.clientHeight === "number" &&
          node.scrollHeight > node.clientHeight
        ) {
          snapshots.push({
            element: current,
            top: node.scrollTop ?? 0,
            left: node.scrollLeft ?? 0,
          });
        }
        current = current.parentElement;
      }
      const docElement =
        doc.scrollingElement ||
        (doc as any).documentElement ||
        (doc as any).body ||
        null;
      if (isElementNode(docElement)) {
        const node = docElement as any;
        snapshots.push({
          element: docElement,
          top: node.scrollTop ?? 0,
          left: node.scrollLeft ?? 0,
        });
      }
      return snapshots;
    };
    const scrollSnapshots = captureScrollSnapshots();

    const restoreViewState = () => {
      listEl.scrollTop = previousScrollTop;
      listEl.scrollLeft = previousScrollLeft;
      for (const snapshot of scrollSnapshots) {
        const target = snapshot.element as any;
        if (typeof target.scrollTo === "function") {
          target.scrollTo(snapshot.left, snapshot.top);
        } else {
          if (typeof target.scrollTop === "number") {
            target.scrollTop = snapshot.top;
          }
          if (typeof target.scrollLeft === "number") {
            target.scrollLeft = snapshot.left;
          }
        }
      }
      if (
        previousActiveElement &&
        typeof (previousActiveElement as any).focus === "function"
      ) {
        try {
          (previousActiveElement as any).focus();
        } catch (_err) {
          // Ignore focus restoration issues
        }
      }
    };

    const overlay = doc.createElement("div");
    overlay.classList.add("zinspire-collection-picker__overlay");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.zIndex = "10000";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.3)";
    overlay.style.transition = "background-color 0.2s ease";

    const panel = doc.createElement("div");
    panel.classList.add("zinspire-collection-picker");
    panel.style.position = "absolute";
    panel.style.margin = "0";
    panel.style.maxHeight = "400px";
    panel.style.minHeight = "200px";
    panel.style.overflowY = "hidden"; // Handle scroll inside list
    panel.style.backgroundColor = "var(--material-background, #fff)";
    panel.style.color = "var(--material-color, #000)";
    panel.style.border = "1px solid var(--material-border, #ccc)";
    panel.style.borderRadius = "6px";
    panel.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.25)";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.fontSize = "12px";
    panel.style.width = "360px";
    // Custom resize implementation instead of CSS resize
    // panel.style.resize = "both";
    // panel.style.overflow = "hidden";

    overlay.appendChild(panel);

    // Resize handles helper
    const addResizeHandle = (cursor: string, type: string) => {
      const handle = doc.createElement("div");
      handle.style.position = "absolute";
      handle.style.zIndex = "10001"; // Above content
      handle.style.cursor = cursor;

      if (type === "w") {
        handle.style.left = "0";
        handle.style.top = "0";
        handle.style.bottom = "0";
        handle.style.width = "6px";
      } else if (type === "e") {
        handle.style.right = "0";
        handle.style.top = "0";
        handle.style.bottom = "0";
        handle.style.width = "6px";
      } else if (type === "s") {
        handle.style.left = "0";
        handle.style.right = "0";
        handle.style.bottom = "0";
        handle.style.height = "6px";
      } else if (type === "sw") {
        handle.style.left = "0";
        handle.style.bottom = "0";
        handle.style.width = "10px";
        handle.style.height = "10px";
        handle.style.zIndex = "10002";
      } else if (type === "se") {
        handle.style.right = "0";
        handle.style.bottom = "0";
        handle.style.width = "10px";
        handle.style.height = "10px";
        handle.style.zIndex = "10002";
      }

      panel.appendChild(handle);

      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = panel.offsetWidth;
        const startHeight = panel.offsetHeight;
        const startLeft = panel.offsetLeft;

        // Ensure bottom constraint is removed before resizing height
        if (type.includes("s") && panel.style.bottom) {
          const rect = panel.getBoundingClientRect();
          panel.style.bottom = "auto";
          panel.style.top = `${rect.top}px`;
        }

        const onResizeMove = (e: MouseEvent) => {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;

          if (type.includes("e")) {
            panel.style.width = `${Math.max(250, startWidth + dx)}px`;
          }
          if (type.includes("s")) {
            panel.style.height = `${Math.max(200, startHeight + dy)}px`;
            panel.style.maxHeight = "none";
          }
          if (type.includes("w")) {
            const newWidth = Math.max(250, startWidth - dx);
            if (newWidth !== startWidth) {
              panel.style.width = `${newWidth}px`;
              // Adjust left position to make it look like resizing from left
              // New left = Old left + (Old width - New width)
              panel.style.left = `${startLeft + (startWidth - newWidth)}px`;
            }
          }
        };

        const onResizeEnd = () => {
          doc.removeEventListener("mousemove", onResizeMove);
          doc.removeEventListener("mouseup", onResizeEnd);
        };

        doc.addEventListener("mousemove", onResizeMove);
        doc.addEventListener("mouseup", onResizeEnd);
      });
    };

    // Position relative to anchor
    const rect = anchor.getBoundingClientRect();
    const top = rect.bottom + 5;
    const left = Math.max(10, rect.left - 20);

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;

    const viewportHeight = doc.documentElement.clientHeight;
    if (top + 300 > viewportHeight) {
      const bottom = viewportHeight - rect.top + 5;
      panel.style.top = "auto";
      panel.style.bottom = `${bottom}px`;
    }

    body.appendChild(overlay);

    // Add resize handles after appending panel to DOM
    addResizeHandle("w-resize", "w");
    addResizeHandle("e-resize", "e");
    addResizeHandle("s-resize", "s");
    addResizeHandle("sw-resize", "sw");
    addResizeHandle("se-resize", "se");

    const header = doc.createElement("div");
    header.classList.add("zinspire-collection-picker__header");
    header.textContent = getString("references-panel-picker-title");
    header.style.padding = "8px 12px";
    header.style.fontWeight = "600";
    header.style.borderBottom = "1px solid var(--material-border, #eee)";
    header.style.backgroundColor = "var(--material-side-background, #f5f5f5)";
    header.style.borderRadius = "6px 6px 0 0";
    header.style.cursor = "move"; // Indicate draggable
    panel.appendChild(header);

    // Drag logic
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onDragStart = (e: MouseEvent) => {
      if (e.target !== header) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = panel.offsetLeft;
      startTop = panel.offsetTop;

      // Remove bottom constraint if set, switch to top
      if (panel.style.bottom) {
        const rect = panel.getBoundingClientRect();
        panel.style.bottom = "auto";
        panel.style.top = `${rect.top}px`;
        startTop = rect.top;
      }

      doc.addEventListener("mousemove", onDragMove);
      doc.addEventListener("mouseup", onDragEnd);
      e.preventDefault();
    };

    const onDragMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${startLeft + dx}px`;
      panel.style.top = `${startTop + dy}px`;
    };

    const onDragEnd = () => {
      isDragging = false;
      doc.removeEventListener("mousemove", onDragMove);
      doc.removeEventListener("mouseup", onDragEnd);
    };

    header.addEventListener("mousedown", onDragStart);

    const hint = doc.createElement("div");
    hint.classList.add("zinspire-collection-picker__hint");
    hint.textContent = getString("references-panel-picker-hint");
    hint.style.padding = "8px 12px";
    hint.style.color = "GrayText";
    hint.style.fontSize = "11px";
    panel.appendChild(hint);

    const filterInput = doc.createElement("input");
    filterInput.classList.add("zinspire-collection-picker__filter");
    filterInput.placeholder = getString("references-panel-picker-filter");
    filterInput.style.margin = "8px 12px";
    filterInput.style.padding = "4px 8px";
    panel.appendChild(filterInput);

    const list = doc.createElement("div");
    list.classList.add("zinspire-collection-picker__list");
    list.style.flex = "1";
    list.style.overflowY = "auto";
    list.style.minHeight = "100px";
    list.style.borderTop = "1px solid var(--material-border, #eee)";
    list.style.borderBottom = "1px solid var(--material-border, #eee)";

    // Flex layout for compact items
    list.style.display = "flex";
    list.style.flexWrap = "wrap";
    list.style.alignContent = "flex-start";
    list.style.gap = "6px";
    list.style.padding = "8px";

    panel.appendChild(list);

    const actions = doc.createElement("div");
    actions.classList.add("zinspire-collection-picker__actions");
    actions.style.padding = "8px 12px";
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.backgroundColor = "var(--material-side-background, #f5f5f5)";
    actions.style.borderRadius = "0 0 6px 6px";

    const cancelBtn = doc.createElement("button");
    cancelBtn.classList.add("zinspire-collection-picker__button");
    cancelBtn.textContent = getString("references-panel-picker-cancel");
    cancelBtn.style.padding = "4px 12px";
    cancelBtn.style.minWidth = "60px";

    const okBtn = doc.createElement("button");
    okBtn.classList.add(
      "zinspire-collection-picker__button",
      "zinspire-collection-picker__button--primary",
    );
    okBtn.textContent = getString("references-panel-picker-confirm");
    okBtn.style.padding = "4px 12px";
    okBtn.style.minWidth = "60px";

    actions.append(cancelBtn, okBtn);
    panel.appendChild(actions);

    const rowMap = new Map<string, SaveTargetRow>();
    const buttonMap = new Map<string, HTMLButtonElement>();
    for (const row of targets) {
      rowMap.set(row.id, row);
      const button = doc.createElement("button");
      button.type = "button";
      button.dataset.id = row.id;
      button.dataset.type = row.type;
      button.classList.add("zinspire-collection-picker__row");
      button.style.setProperty(
        "--zinspire-collection-level",
        row.level.toString(),
      );
      // Compact chip styles
      button.style.display = "inline-flex";
      button.style.alignItems = "center";
      button.style.maxWidth = "100%";
      button.style.padding = "4px 8px";
      button.style.border = "1px solid var(--material-border, #ccc)";
      button.style.borderRadius = "12px"; // Chip shape
      button.style.background = "var(--material-background, #fff)";
      button.style.cursor = "pointer";
      button.style.whiteSpace = "nowrap";
      button.style.overflow = "hidden";
      button.style.textOverflow = "ellipsis";
      button.style.fontSize = "11px";

      button.addEventListener("mouseover", () => {
        if (!button.classList.contains("is-focused")) {
          button.style.backgroundColor = "Highlight";
          button.style.color = "HighlightText";
          button.style.borderColor = "Highlight";
        }
      });
      button.addEventListener("mouseout", () => {
        if (!button.classList.contains("is-focused")) {
          updateVisualState();
        }
      });

      button.textContent = row.name;
      if (row.recent) {
        button.dataset.recent = "1";
      }
      list.appendChild(button);
      buttonMap.set(row.id, button);
    }

    if (!targets.length) {
      const empty = doc.createElement("div");
      empty.classList.add("zinspire-collection-picker__empty");
      empty.textContent = getString("references-panel-picker-empty");
      list.appendChild(empty);
    }

    const deriveLibraryRowID = (rowID: string | null) => {
      if (!rowID) {
        return null;
      }
      const row = rowMap.get(rowID);
      if (!row) {
        return null;
      }
      return row.type === "library" ? row.id : `L${row.libraryID}`;
    };

    let focusedID: string | null =
      (defaultID && rowMap.has(defaultID) ? defaultID : null) ||
      targets[0]?.id ||
      null;
    let selectedLibraryRowID: string | null =
      deriveLibraryRowID(focusedID) ||
      targets.find((row) => row.type === "library")?.id ||
      null;
    let selectedLibraryID: number | null = selectedLibraryRowID
      ? rowMap.get(selectedLibraryRowID)?.libraryID ?? null
      : null;
    const selectedCollectionRowIDs = new Set<string>();
    if (focusedID) {
      const initialRow = rowMap.get(focusedID);
      if (initialRow?.type === "collection") {
        selectedCollectionRowIDs.add(initialRow.id);
      }
    }
    if (!selectedLibraryRowID && targets[0]) {
      selectedLibraryRowID =
        targets[0].type === "library"
          ? targets[0].id
          : `L${targets[0].libraryID}`;
      selectedLibraryID =
        rowMap.get(selectedLibraryRowID!)?.libraryID ?? targets[0].libraryID;
    }

    const applyCollectionHighlight = (
      button: HTMLButtonElement,
      checked: boolean,
    ) => {
      if (checked) {
        button.style.backgroundColor = "#e6f2ff";
        button.style.color = "#0b2d66";
        button.style.fontWeight = "600";
      } else {
        button.style.backgroundColor = "";
        button.style.color = "";
        button.style.fontWeight = "";
      }
    };

    const updateVisualState = () => {
      for (const [id, button] of buttonMap.entries()) {
        button.classList.toggle("is-focused", id === focusedID);
        if (button.dataset.type === "library") {
          button.classList.toggle(
            "is-library-active",
            id === selectedLibraryRowID,
          );
        } else {
          const isChecked = selectedCollectionRowIDs.has(id);
          button.classList.toggle("is-checked", isChecked);
          button.classList.toggle("is-library-active", false);
          applyCollectionHighlight(button, isChecked);
        }
      }
    };

    const focusRow = (id: string | null, scroll = true) => {
      focusedID = id;
      updateVisualState();
      if (scroll && id) {
        buttonMap.get(id)?.scrollIntoView({ block: "nearest" });
      }
    };

    focusRow(focusedID, false);

    const visibleButtons = () =>
      Array.from(buttonMap.values()).filter((btn) => !btn.hidden);

    const moveFocus = (delta: number) => {
      const buttons = visibleButtons();
      if (!buttons.length) {
        return;
      }
      let index = buttons.findIndex((btn) => btn.dataset.id === focusedID);
      if (index === -1) {
        index = 0;
      } else {
        index = Math.min(Math.max(index + delta, 0), buttons.length - 1);
      }
      const nextButton = buttons[index];
      focusRow(nextButton?.dataset.id ?? null);
    };

    const selectLibraryRow = (id: string | null) => {
      if (!id) {
        return;
      }
      const row = rowMap.get(id);
      if (!row || row.type !== "library") {
        return;
      }
      selectedLibraryRowID = row.id;
      selectedLibraryID = row.libraryID;
      for (const rowID of Array.from(selectedCollectionRowIDs)) {
        const candidate = rowMap.get(rowID);
        if (!candidate || candidate.libraryID !== row.libraryID) {
          selectedCollectionRowIDs.delete(rowID);
        }
      }
      focusRow(row.id, false);
      updateVisualState();
    };

    const toggleCollectionRow = (id: string | null) => {
      if (!id) {
        return;
      }
      const row = rowMap.get(id);
      if (!row || row.type !== "collection") {
        return;
      }
      if (!selectedLibraryID || selectedLibraryID !== row.libraryID) {
        selectLibraryRow(`L${row.libraryID}`);
      }
      if (selectedCollectionRowIDs.has(id)) {
        selectedCollectionRowIDs.delete(id);
      } else {
        selectedCollectionRowIDs.add(id);
      }
      focusRow(id);
      updateVisualState();
    };

    const applyFilter = () => {
      const query = filterInput.value.trim().toLowerCase();
      if (!query) {
        buttonMap.forEach((btn) => (btn.style.display = "inline-flex"));
        return;
      }
      const visible = new Set<string>();
      for (const row of targets) {
        const matches = row.name.toLowerCase().includes(query);
        if (matches) {
          visible.add(row.id);
          let parentID = row.parentID;
          while (parentID) {
            visible.add(parentID);
            parentID = rowMap.get(parentID)?.parentID;
          }
        }
      }
      buttonMap.forEach((btn, id) => {
        if (visible.has(id)) {
          btn.style.display = "inline-flex";
        } else {
          btn.style.display = "none";
        }
      });
      const focusedBtn = focusedID ? buttonMap.get(focusedID) : null;
      if (!focusedID || (focusedBtn && focusedBtn.style.display === "none")) {
        const firstVisible = Array.from(buttonMap.values()).find(
          (btn) => btn.style.display !== "none",
        );
        focusRow(firstVisible?.dataset.id ?? null);
      }
    };

    const buildSelection = (): SaveTargetSelection | null => {
      const libraryRowID =
        selectedLibraryRowID ||
        targets.find((row) => row.type === "library")?.id ||
        null;
      if (!libraryRowID) {
        return null;
      }
      const libraryRow = rowMap.get(libraryRowID);
      if (!libraryRow) {
        return null;
      }
      const collectionIDs = Array.from(selectedCollectionRowIDs)
        .map((id) => rowMap.get(id)?.collectionID)
        .filter((id): id is number => typeof id === "number");
      const primaryRowID =
        selectedCollectionRowIDs.values().next().value || libraryRowID;
      return {
        libraryID: libraryRow.libraryID,
        primaryRowID,
        collectionIDs,
      };
    };

    let isFinished = false;

    const finish = (selection: SaveTargetSelection | null) => {
      if (isFinished) {
        return;
      }
      isFinished = true;
      overlay.remove();
      filterInput.removeEventListener("input", applyFilter);
      list.removeEventListener("click", onListClick);
      list.removeEventListener("dblclick", onListDoubleClick);
      panel.removeEventListener("keydown", onKeyDown);
      cancelBtn.removeEventListener("click", onCancel);
      okBtn.removeEventListener("click", onConfirm);
      overlay.removeEventListener("click", onOverlayClick);
      doc.removeEventListener("keydown", onGlobalKeyDown, true);
      restoreViewState();
      resolve(selection);
    };

    const onConfirm = () => {
      finish(buildSelection());
    };

    const onCancel = () => finish(null);

    const onOverlayClick = (event: MouseEvent) => {
      if (event.target === overlay) {
        finish(null);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(-1);
        return;
      }
      if (event.key === " " && event.target !== filterInput) {
        event.preventDefault();
        const row = focusedID ? rowMap.get(focusedID) : null;
        if (!row) {
          return;
        }
        if (row.type === "library") {
          selectLibraryRow(row.id);
        } else {
          toggleCollectionRow(row.id);
        }
        return;
      }
      if (event.key === "Enter" && event.target !== filterInput) {
        event.preventDefault();
        onConfirm();
      }
    };

    const onListClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement)?.closest("button");
      if (!target) {
        return;
      }
      const id = target.getAttribute("data-id");
      const row = id ? rowMap.get(id) : null;
      if (!row) {
        return;
      }
      if (row.type === "library") {
        selectLibraryRow(row.id);
      } else {
        toggleCollectionRow(row.id);
      }
    };

    const onListDoubleClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement)?.closest("button");
      if (!target) {
        return;
      }
      const id = target.getAttribute("data-id");
      const row = id ? rowMap.get(id) : null;
      if (!row) {
        return;
      }
      if (row.type === "library") {
        selectLibraryRow(row.id);
      } else {
        toggleCollectionRow(row.id);
      }
      onConfirm();
    };

    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
    };

    filterInput.addEventListener("input", applyFilter);
    cancelBtn.addEventListener("click", onCancel);
    okBtn.addEventListener("click", onConfirm);
    list.addEventListener("click", onListClick);
    list.addEventListener("dblclick", onListDoubleClick);
    panel.addEventListener("keydown", onKeyDown);
    overlay.addEventListener("click", onOverlayClick);
    doc.addEventListener("keydown", onGlobalKeyDown, true);

    filterInput.focus();
  });
}
