import { config } from "../../package.json";
import { ensureExternalToken } from "../utils/externalToken";
import { showTargetPickerUI, type SaveTargetRow } from "./pickerUI";

const ENDPOINT_PATH = "/connector/zinspirePickSaveTarget";

let previousEndpoint: any | null = null;
let registered = false;

type PickSaveTargetStatus = "pending" | "done" | "cancelled" | "error" | "expired";

type PickSaveTargetResponse =
  | { ok: true; cancelled: true }
  | {
      ok: true;
      libraryID: number;
      collectionIDs: number[];
      collectionKeys: string[];
      primaryCollectionKey?: string;
      selectedPath: string;
      tags: string[];
      note: string;
    };

type PickSaveTargetState = {
  requestID: string;
  createdAt: number;
  status: PickSaveTargetStatus;
  result?: PickSaveTargetResponse;
  error?: string;
  completion?: Promise<PickSaveTargetResponse>;
};

const REQUEST_TTL_MS = 10 * 60 * 1000;
const requestStates = new Map<string, PickSaveTargetState>();
let activeRequestID: string | null = null;

function generateRequestID(): string {
  try {
    const cryptoObj: Crypto | undefined = (globalThis as any).crypto;
    if (cryptoObj?.getRandomValues) {
      const bytes = new Uint8Array(9); // ~12 chars base64url
      cryptoObj.getRandomValues(bytes);
      let binary = "";
      for (const b of bytes) {
        binary += String.fromCharCode(b);
      }
      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }
  } catch (_err) {
    // Fall back
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupExpiredRequests(now = Date.now()): void {
  for (const [id, state] of requestStates.entries()) {
    if (now - state.createdAt > REQUEST_TTL_MS) {
      requestStates.delete(id);
    }
  }
  if (activeRequestID) {
    const state = requestStates.get(activeRequestID);
    if (!state || now - state.createdAt > REQUEST_TTL_MS) {
      activeRequestID = null;
    }
  }
}

function getRecentTargets(): { ids: Set<string>; ordered: string[] } {
  const ids = new Set<string>();
  const ordered: string[] = [];
  try {
    const raw = Zotero.Prefs.get("recentSaveTargets") as string | undefined;
    if (!raw) {
      return { ids, ordered };
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry?.id && typeof entry.id === "string") {
          ids.add(entry.id);
          ordered.push(entry.id);
        }
      }
    }
  } catch (err) {
    Zotero.debug?.(
      `[${config.addonName}] Failed to parse recentSaveTargets: ${err}`,
    );
    Zotero.Prefs.clear("recentSaveTargets");
  }
  return { ids, ordered };
}

function rememberRecentTarget(targetID: string) {
  try {
    const raw = Zotero.Prefs.get("recentSaveTargets") as string | undefined;
    let entries: Array<{ id: string }> = [];
    if (raw) {
      entries = JSON.parse(raw);
    }
    if (!Array.isArray(entries)) {
      entries = [];
    }
    entries = entries.filter((entry) => entry?.id !== targetID);
    entries.unshift({ id: targetID });
    Zotero.Prefs.set("recentSaveTargets", JSON.stringify(entries.slice(0, 5)));
  } catch (err) {
    Zotero.debug?.(
      `[${config.addonName}] Failed to update recentSaveTargets: ${err}`,
    );
    Zotero.Prefs.clear("recentSaveTargets");
  }
}

function getDefaultTargetID(): string | null {
  const pane = Zotero.getActiveZoteroPane();
  if (pane?.getSelectedCollection?.()) {
    const selected = pane.getSelectedCollection();
    if (selected) {
      return `C${selected.id}`;
    }
  }
  const libraryID =
    pane?.getSelectedLibraryID?.() ?? Zotero.Libraries.userLibrary?.libraryID;
  return libraryID ? `L${libraryID}` : null;
}

function buildSaveTargets(recentIDs: Set<string>): SaveTargetRow[] {
  const targets: SaveTargetRow[] = [];
  for (const library of Zotero.Libraries.getAll()) {
    if (!library?.editable) {
      continue;
    }
    const libraryID = library.libraryID;
    targets.push({
      id: `L${libraryID}`,
      name: library.name,
      level: 0,
      type: "library",
      libraryID,
      filesEditable: library.filesEditable,
      recent: recentIDs.has(`L${libraryID}`),
    });
    const collections = Zotero.Collections.getByLibrary(libraryID, true) || [];
    for (const collection of collections) {
      const rawLevel = (collection as any)?.level;
      const level = typeof rawLevel === "number" ? rawLevel + 1 : 1;
      targets.push({
        id: collection.treeViewID,
        name: collection.name,
        level,
        type: "collection",
        libraryID,
        collectionID: collection.id,
        filesEditable: library.filesEditable,
        parentID: collection.parentID
          ? `C${collection.parentID}`
          : `L${libraryID}`,
        recent: recentIDs.has(collection.treeViewID),
      });
    }
  }
  return targets;
}

async function getSelectedPath(
  libraryID: number,
  primaryRowID: string,
): Promise<string> {
  const library = Zotero.Libraries.get(libraryID) as any;
  const libraryName =
    typeof library?.name === "string" ? library.name : `Library ${libraryID}`;
  if (!primaryRowID || !primaryRowID.startsWith("C")) {
    return libraryName;
  }

  const primaryCollectionID = Number.parseInt(primaryRowID.slice(1), 10);
  if (!Number.isFinite(primaryCollectionID)) {
    return libraryName;
  }

  const parts: string[] = [];
  let currentID: number | undefined = primaryCollectionID;
  while (currentID) {
    const collection = (await Zotero.Collections.getAsync(currentID)) as any;
    if (!collection) {
      break;
    }
    parts.unshift(collection.name);
    currentID = (collection as any).parentID || undefined;
  }
  return parts.length ? `${libraryName} / ${parts.join(" / ")}` : libraryName;
}

async function collectionIDsToKeys(collectionIDs: number[]): Promise<string[]> {
  const keys: string[] = [];
  for (const id of collectionIDs) {
    try {
      const collection = (await Zotero.Collections.getAsync(id)) as any;
      const key = collection?.key;
      if (typeof key === "string" && key) {
        keys.push(key);
      }
    } catch (_err) {
      // Ignore missing collections
    }
  }
  return keys;
}

async function selectionToResponse(
  selection: any | null,
): Promise<PickSaveTargetResponse> {
  if (!selection) {
    return { ok: true, cancelled: true };
  }
  const collectionKeys = await collectionIDsToKeys(selection.collectionIDs);
  const selectedPath = await getSelectedPath(
    selection.libraryID,
    selection.primaryRowID,
  );
  const response: any = {
    ok: true,
    libraryID: selection.libraryID,
    collectionIDs: selection.collectionIDs,
    collectionKeys,
    selectedPath,
    tags: selection.tags,
    note: selection.note,
  };
  if (collectionKeys.length) {
    response.primaryCollectionKey = collectionKeys[0];
  }
  return response as PickSaveTargetResponse;
}

async function promptForSaveTargetFromMainWindow(options: {
  multi: boolean;
  includeTagsNote: boolean;
}) {
  const mainWindow = Zotero.getMainWindow();
  const doc = mainWindow?.document;
  if (!mainWindow || !doc) {
    throw new Error("Main Zotero window not available");
  }
  try {
    mainWindow.focus();
  } catch (_err) {
    // Ignore focus errors
  }

  const recentTargets = getRecentTargets();
  const targets = buildSaveTargets(recentTargets.ids);
  if (!targets.length) {
    return null;
  }

  let defaultID = getDefaultTargetID();
  if (!defaultID) {
    defaultID = recentTargets.ordered[0] || targets[0]?.id || null;
  }

  const container = (doc.documentElement || doc.body) as any;
  if (!container || typeof container.appendChild !== "function") {
    throw new Error("Main Zotero window container not available");
  }

  const anchor = doc.createElement("div");
  anchor.style.position = "fixed";
  anchor.style.left = "50%";
  anchor.style.top = "25%";
  anchor.style.width = "10px";
  anchor.style.height = "10px";
  anchor.style.pointerEvents = "none";
  anchor.style.opacity = "0";
  container.appendChild(anchor);

  try {
    const listEl = (doc.scrollingElement ||
      doc.documentElement ||
      doc.body ||
      container) as unknown as HTMLElement;
    const selection = await showTargetPickerUI(
      targets,
      defaultID,
      anchor,
      container as unknown as HTMLElement,
      listEl,
      {
        ...options,
        // For external triggers, require explicit user confirmation via OK button
        // to avoid accidental early completion from Enter/double-click.
        confirmOnEnter: false,
        confirmOnDoubleClick: false,
      },
    );
    if (selection?.primaryRowID) {
      rememberRecentTarget(selection.primaryRowID);
    }
    return selection;
  } finally {
    anchor.remove();
  }
}

async function startPickSaveTargetRequest(options: {
  multi: boolean;
  includeTagsNote: boolean;
}): Promise<PickSaveTargetState> {
  cleanupExpiredRequests();

  if (activeRequestID) {
    const active = requestStates.get(activeRequestID);
    if (active && active.status === "pending") {
      throw new Error("BUSY");
    }
    activeRequestID = null;
  }

  const requestID = generateRequestID();
  const state: PickSaveTargetState = {
    requestID,
    createdAt: Date.now(),
    status: "pending",
  };
  requestStates.set(requestID, state);
  activeRequestID = requestID;

  const completion = (async (): Promise<PickSaveTargetResponse> => {
    try {
      const selection = await promptForSaveTargetFromMainWindow(options);
      const response = await selectionToResponse(selection);
      state.status =
        "cancelled" in response && response.cancelled ? "cancelled" : "done";
      state.result = response;
      return response;
    } catch (err) {
      state.status = "error";
      state.error = String(err);
      return { ok: true, cancelled: true } as const;
    } finally {
      if (activeRequestID === requestID) {
        activeRequestID = null;
      }
    }
  })();

  state.completion = completion;
  return state;
}

class ZInspirePickSaveTargetEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(req: {
    headers: Record<string, string | undefined>;
    data: any;
  }): Promise<[number, string, string]> {
    const expectedToken = ensureExternalToken();
    const headerMap = req?.headers ?? {};
    const providedToken =
      headerMap["x-zinspire-token"] ??
      (headerMap as any)["X-ZInspire-Token"] ??
      headerMap["X-ZINSPIRE-TOKEN"];
    if (!providedToken || providedToken !== expectedToken) {
      return [
        403,
        "application/json",
        JSON.stringify({ ok: false, error: "FORBIDDEN" }),
      ];
    }

    const body = req?.data && typeof req.data === "object" ? req.data : {};
    const requestID =
      typeof body.requestID === "string" && body.requestID.trim()
        ? body.requestID.trim()
        : null;

    // Poll mode: return status/result without opening a new picker
    if (requestID) {
      cleanupExpiredRequests();
      const state = requestStates.get(requestID);
      if (!state) {
        return [
          200,
          "application/json",
          JSON.stringify({ ok: true, requestID, status: "expired" }),
        ];
      }
      const ageMs = Date.now() - state.createdAt;
      if (ageMs > REQUEST_TTL_MS) {
        requestStates.delete(requestID);
        return [
          200,
          "application/json",
          JSON.stringify({ ok: true, requestID, status: "expired" }),
        ];
      }
      if (state.status === "pending") {
        return [
          200,
          "application/json",
          JSON.stringify({ ok: true, requestID, status: "pending" }),
        ];
      }
      if (state.result) {
        return [
          200,
          "application/json",
          JSON.stringify({
            ...state.result,
            requestID,
            status: state.status,
          }),
        ];
      }
      return [
        200,
        "application/json",
        JSON.stringify({
          ok: true,
          requestID,
          status: state.status,
          error: state.error,
        }),
      ];
    }

    const multi = typeof body.multi === "boolean" ? body.multi : true;
    const includeTagsNote =
      typeof body.includeTagsNote === "boolean" ? body.includeTagsNote : true;
    const wait = typeof body.wait === "boolean" ? body.wait : true;

    let state: PickSaveTargetState;
    try {
      state = await startPickSaveTargetRequest({ multi, includeTagsNote });
    } catch (err) {
      const message = String(err);
      if (message.includes("BUSY")) {
        return [
          409,
          "application/json",
          JSON.stringify({ ok: false, error: "BUSY" }),
        ];
      }
      return [
        500,
        "application/json",
        JSON.stringify({ ok: false, error: message }),
      ];
    }

    if (!wait) {
      return [
        200,
        "application/json",
        JSON.stringify({
          ok: true,
          requestID: state.requestID,
          status: "pending",
        }),
      ];
    }

    const response = await state.completion!;
    return [200, "application/json", JSON.stringify(response)];
  }
}

export function registerZInspirePickSaveTargetEndpoint(): void {
  if (registered) {
    return;
  }
  const endpoints = (Zotero.Server as any)?.Endpoints;
  if (!endpoints) {
    Zotero.debug?.(
      `[${config.addonName}] Zotero.Server.Endpoints not available; cannot register ${ENDPOINT_PATH}`,
    );
    return;
  }
  if (endpoints[ENDPOINT_PATH] && !previousEndpoint) {
    previousEndpoint = endpoints[ENDPOINT_PATH];
  }
  endpoints[ENDPOINT_PATH] = ZInspirePickSaveTargetEndpoint as any;
  registered = true;
  Zotero.debug?.(
    `[${config.addonName}] Registered connector endpoint POST ${ENDPOINT_PATH}`,
  );
}

export function unregisterZInspirePickSaveTargetEndpoint(): void {
  if (!registered) {
    return;
  }
  const endpoints = (Zotero.Server as any)?.Endpoints;
  if (!endpoints) {
    registered = false;
    return;
  }
  if (previousEndpoint) {
    endpoints[ENDPOINT_PATH] = previousEndpoint;
  } else {
    delete endpoints[ENDPOINT_PATH];
  }
  previousEndpoint = null;
  registered = false;
}

