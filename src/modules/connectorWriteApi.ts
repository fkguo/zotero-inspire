import { config, version } from "../../package.json";
import { ensureExternalToken } from "../utils/externalToken";
import { createItemFromInspireRecord } from "./inspire/library/itemCreation";
import { findItemByRecid } from "./inspire/library/arxivIndex";

/**
 * External write API for zotero-inspire.
 *
 * Zotero's built-in local HTTP API (`/api/...` on 127.0.0.1:23119) is GET-only:
 * any POST/PUT/DELETE is rejected at the server layer with
 * `400 "Endpoint does not support method"`. The connector save endpoints cannot
 * attach a local file to an existing item, nor delete items.
 *
 * This module registers an authenticated POST endpoint on the same connector
 * server so trusted local tools (e.g. an MCP server) can perform the writes that
 * the native local API cannot: attach a local file to an item, and trash/erase
 * items.
 *
 * Security model (defense in depth):
 *  - Every request must carry the `x-zinspire-token` header matching the token
 *    in pref `<prefsPrefix>.external_token` (see {@link ensureExternalToken}).
 *  - `allowRequestsFromUnsafeWebContent` is intentionally NOT set, so Zotero's
 *    server layer keeps blocking requests that look like they come from web
 *    content (UA starting with `Mozilla/` or carrying an `Origin` header).
 *  - `erase` (permanent delete) is a distinct op from `trash` so it can never be
 *    triggered accidentally by a `trash` caller.
 */

const ENDPOINT_PATH = "/connector/zinspireWrite";
const MAX_RESPONSE_BYTES = 1024 * 1024;

const CAPABILITIES = [
  "ping",
  "attach_file",
  "trash_item",
  "erase_item",
  "add_item",
  "pick_save_target",
] as const;

let previousEndpoint: any;
let hadPreviousEndpoint = false;
let registered = false;

type WriteResponseBody = Record<string, unknown>;
type EndpointResult = [number, string, string];

/** Error carrying an HTTP status + machine-readable code for the response. */
class WriteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WriteError";
    this.status = status;
    this.code = code;
  }
}

function jsonResult(status: number, body: WriteResponseBody): EndpointResult {
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    return [
      413,
      "application/json",
      JSON.stringify({
        ok: false,
        code: "RESPONSE_TOO_LARGE",
        error: `Response exceeds the ${MAX_RESPONSE_BYTES}-byte JSON limit`,
      }),
    ];
  }
  return [status, "application/json", serialized];
}

function debug(message: string): void {
  try {
    Zotero.debug?.(message);
  } catch (_err) {
    // Diagnostics must not turn a completed write into an apparent failure.
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WriteError(
      400,
      "INVALID_PARAMS",
      `${field} is required (non-empty string)`,
    );
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalPositiveIntArray(value: unknown, field: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new WriteError(
      400,
      "INVALID_PARAMS",
      `${field} must be an array of at most 100 integers`,
    );
  }
  const result: number[] = [];
  for (const entry of value) {
    const id = typeof entry === "number" ? entry : Number.NaN;
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new WriteError(
        400,
        "INVALID_PARAMS",
        `${field} must contain positive integers`,
      );
    }
    result.push(id);
  }
  return result;
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new WriteError(
      400,
      "INVALID_PARAMS",
      `${field} must be an array of at most 100 strings`,
    );
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new WriteError(
        400,
        "INVALID_PARAMS",
        `${field} must contain strings`,
      );
    }
    const text = entry.trim();
    if (text.length > 200) {
      throw new WriteError(
        400,
        "INVALID_PARAMS",
        `${field} entries must be at most 200 characters`,
      );
    }
    if (text) result.push(text);
  }
  return result;
}

function optionalNote(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 20000) {
    throw new WriteError(
      400,
      "INVALID_PARAMS",
      "note must be a string of at most 20000 characters",
    );
  }
  return value;
}

/** Resolve an explicit library_id, defaulting to the user library. */
function resolveLibraryID(raw: unknown): number {
  if (raw === undefined) {
    return Zotero.Libraries.userLibraryID;
  }
  const libraryID =
    typeof raw === "string" && /^\d+$/.test(raw)
      ? Number(raw)
      : typeof raw === "number"
        ? raw
        : Number.NaN;
  if (Number.isSafeInteger(libraryID) && libraryID > 0) {
    return libraryID;
  }
  throw new WriteError(
    400,
    "INVALID_LIBRARY_ID",
    "library_id must be a positive integer when provided",
  );
}

async function resolveItem(
  libraryID: number,
  key: string,
): Promise<Zotero.Item> {
  const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  if (!item) {
    throw new WriteError(
      404,
      "ITEM_NOT_FOUND",
      `No item with key ${key} in library ${libraryID}`,
    );
  }
  return item as Zotero.Item;
}

/**
 * Validate a caller-supplied path and return the corresponding nsIFile.
 * `Zotero.File.pathToFile` throws on relative/invalid paths, which we map to a
 * clear 400.
 */
function resolveExistingFile(filePath: string): { file: any; absPath: string } {
  let file: any;
  try {
    file = (Zotero.File as any).pathToFile(filePath);
  } catch (_err) {
    throw new WriteError(
      400,
      "INVALID_PATH",
      `file_path is not a valid absolute path: ${filePath}`,
    );
  }
  if (!file || !file.exists()) {
    throw new WriteError(
      404,
      "FILE_NOT_FOUND",
      `file_path does not exist: ${filePath}`,
    );
  }
  if (!file.isFile()) {
    throw new WriteError(
      400,
      "NOT_A_FILE",
      `file_path is not a regular file: ${filePath}`,
    );
  }
  return { file, absPath: file.path };
}

/**
 * The name Zotero gives a single file added to an item from disk
 * (ZoteroPane.addAttachmentFromDialog, the item tree's drop): the parent's
 * name when Zotero renames files ("Rename linked files" for a linked file),
 * the parent has no other non-HTML file, and the file's type is one Zotero
 * renames; else none
 */
async function renamedFileBaseName(
  parent: Zotero.Item,
  path: string,
  link: boolean,
): Promise<string | undefined> {
  const attachments = Zotero.Attachments as any;
  if (!attachments.shouldAutoRenameFile(link, parent.libraryID)) {
    return undefined;
  }
  // The parent's children and data, in a library not shown yet
  const library = Zotero.Libraries.get(parent.libraryID) as
    | { waitForDataLoad(type: string): Promise<void> }
    | false;
  if (library) await library.waitForDataLoad("item");
  if ((parent as any).numNonHTMLFileAttachments()) return undefined;
  return (
    (await attachments.getRenamedFileBaseNameIfAllowedType(parent, path)) ||
    undefined
  );
}

function linkModeLabel(linkMode: number): string {
  switch (linkMode) {
    case 0:
      return "imported_file";
    case 1:
      return "imported_url";
    case 2:
      return "linked_file";
    case 3:
      return "linked_url";
    case 4:
      return "embedded_image";
    default:
      return String(linkMode);
  }
}

async function handlePing(): Promise<EndpointResult> {
  return jsonResult(200, {
    ok: true,
    op: "ping",
    addon: config.addonName,
    addon_id: config.addonID,
    version,
    capabilities: [...CAPABILITIES],
  });
}

async function handleAttachFile(
  body: Record<string, any>,
): Promise<EndpointResult> {
  const parentKey = requireString(body.parent_item_key, "parent_item_key");
  const filePath = requireString(body.file_path, "file_path");
  const libraryID = resolveLibraryID(body.library_id);
  const mode = body.mode === undefined ? "link" : body.mode;
  if (mode !== "import" && mode !== "link") {
    throw new WriteError(
      400,
      "INVALID_PARAMS",
      'mode must be either "import" or "link"',
    );
  }
  const title = optionalString(body.title);
  const contentType = optionalString(body.content_type);

  const parent = await resolveItem(libraryID, parentKey);
  if (!parent.isRegularItem()) {
    throw new WriteError(
      400,
      "INVALID_PARENT",
      `parent_item_key ${parentKey} is not a regular item (cannot hold attachments)`,
    );
  }

  const { file, absPath } = resolveExistingFile(filePath);
  const fileBaseName = await renamedFileBaseName(
    parent,
    absPath,
    mode === "link",
  );

  const options: any = { file, parentItemID: parent.id };
  if (title) options.title = title;
  if (contentType) options.contentType = contentType;
  let path = absPath;
  if (fileBaseName && mode === "import") {
    options.fileBaseName = fileBaseName;
  } else if (fileBaseName) {
    // As Zotero does: the linked file is renamed where it is, with a number
    // added when the name is taken, and linked under its old name if that fails
    try {
      const ext = Zotero.File.getExtension(absPath);
      const newName = await (Zotero.File as any).rename(
        absPath,
        fileBaseName + (ext ? "." + ext : ""),
        { unique: true },
      );
      path = PathUtils.join(PathUtils.parent(absPath)!, newName);
      options.file = path;
    } catch (err) {
      Zotero.logError(err as Error);
    }
  }

  const attachment =
    mode === "import"
      ? await Zotero.Attachments.importFromFile(options)
      : await Zotero.Attachments.linkFromFile(options);

  const linkMode = (attachment as any).attachmentLinkMode as number;
  debug(
    `[${config.addonName}] write attach_file ok: parent=${parentKey} mode=${mode} attachment=${attachment.key}`,
  );

  return jsonResult(200, {
    ok: true,
    op: "attach_file",
    mode,
    library_id: libraryID,
    parent_item_key: parentKey,
    attachment_key: attachment.key,
    attachment_id: attachment.id,
    link_mode: linkMode,
    link_mode_label: linkModeLabel(linkMode),
    path,
  });
}

async function handleTrashItem(
  body: Record<string, any>,
): Promise<EndpointResult> {
  const key = requireString(body.item_key, "item_key");
  const libraryID = resolveLibraryID(body.library_id);
  const item = await resolveItem(libraryID, key);

  await Zotero.Items.trashTx(item.id);
  debug(
    `[${config.addonName}] write trash_item ok: ${key} (library ${libraryID})`,
  );

  return jsonResult(200, {
    ok: true,
    op: "trash_item",
    library_id: libraryID,
    item_key: key,
    item_id: item.id,
    trashed: true,
  });
}

async function handleEraseItem(
  body: Record<string, any>,
): Promise<EndpointResult> {
  const key = requireString(body.item_key, "item_key");
  const libraryID = resolveLibraryID(body.library_id);
  const item = await resolveItem(libraryID, key);
  const itemID = item.id;

  await item.eraseTx();
  debug(
    `[${config.addonName}] write erase_item ok: ${key} (library ${libraryID})`,
  );

  return jsonResult(200, {
    ok: true,
    op: "erase_item",
    library_id: libraryID,
    item_key: key,
    item_id: itemID,
    erased: true,
  });
}

/**
 * Create an item from an INSPIRE record in the target returned by
 * `zinspirePickSaveTarget`. The picker itself stays in that endpoint; this op
 * only performs the create and duplicate check.
 */
async function handleAddItem(
  body: Record<string, any>,
): Promise<EndpointResult> {
  const recid = requireString(body.recid, "recid");
  if (!/^[1-9]\d{0,18}$/.test(recid)) {
    throw new WriteError(
      400,
      "INVALID_RECID",
      "recid must be a positive integer",
    );
  }
  const libraryID = resolveLibraryID(body.library_id);
  const library = Zotero.Libraries.get(libraryID) as any;
  if (!library || !library.editable) {
    throw new WriteError(
      400,
      "INVALID_LIBRARY_ID",
      `Library ${libraryID} is not editable`,
    );
  }

  const collectionIDs = optionalPositiveIntArray(
    body.collection_ids,
    "collection_ids",
  );
  for (const collectionID of collectionIDs) {
    const collection = Zotero.Collections.get(collectionID) as any;
    if (
      !collection ||
      collection.deleted ||
      collection.libraryID !== libraryID
    ) {
      throw new WriteError(
        400,
        "INVALID_COLLECTION_ID",
        `Collection ${collectionID} is not in library ${libraryID}`,
      );
    }
  }

  const tags = optionalStringArray(body.tags, "tags");
  const note = optionalNote(body.note);

  // Adding the same INSPIRE record twice is almost never intended. Fail
  // closed if the index cannot be read rather than risk a duplicate.
  let existing: Zotero.Item | null = null;
  try {
    existing = await findItemByRecid(recid);
  } catch (_err) {
    throw new WriteError(
      503,
      "LIBRARY_UNAVAILABLE",
      "The Zotero library index is unavailable; nothing was added",
    );
  }
  if (existing?.id) {
    return jsonResult(200, {
      ok: true,
      op: "add_item",
      status: "existing",
      item_key: existing.key,
      item_id: existing.id,
      library_id: existing.libraryID,
    });
  }

  let item: Zotero.Item | null;
  try {
    item = await createItemFromInspireRecord(recid, {
      libraryID,
      collectionIDs,
      tags,
      note,
    });
  } catch (_err) {
    throw new WriteError(
      502,
      "INSPIRE_LOOKUP_FAILED",
      "Could not fetch the INSPIRE record; nothing was added",
    );
  }
  if (!item) {
    throw new WriteError(
      404,
      "INSPIRE_RECORD_NOT_FOUND",
      `INSPIRE has no record ${recid}`,
    );
  }

  debug(
    `[${config.addonName}] write add_item ok: ${recid} -> ${item.key} (library ${item.libraryID})`,
  );
  return jsonResult(200, {
    ok: true,
    op: "add_item",
    status: "added",
    item_key: item.key,
    item_id: item.id,
    library_id: item.libraryID,
    collection_ids: collectionIDs,
  });
}

/**
 * Dispatch a validated, authenticated write request to the matching op handler.
 * Exported for unit testing without the connector server.
 */
export async function dispatchWriteOp(
  body: Record<string, any>,
): Promise<EndpointResult> {
  const rawOp = typeof body.op === "string" ? body.op : "";
  if (rawOp.length > 32) {
    return jsonResult(400, {
      ok: false,
      code: "INVALID_OP",
      error: "Unsupported request op",
      capabilities: [...CAPABILITIES],
    });
  }
  const op = rawOp.trim();
  try {
    switch (op) {
      case "ping":
        return await handlePing();
      case "attach_file":
        return await handleAttachFile(body);
      case "trash_item":
        return await handleTrashItem(body);
      case "erase_item":
        return await handleEraseItem(body);
      case "add_item":
        return await handleAddItem(body);
      default:
        return jsonResult(400, {
          ok: false,
          code: "INVALID_OP",
          error: "Unsupported request op",
          capabilities: [...CAPABILITIES],
        });
    }
  } catch (err) {
    if (err instanceof WriteError) {
      return jsonResult(err.status, {
        ok: false,
        op,
        code: err.code,
        error: err.message,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    debug(`[${config.addonName}] write op=${op} failed: ${message}`);
    return jsonResult(500, {
      ok: false,
      code: "INTERNAL_ERROR",
      error: "Unexpected internal failure while processing the request",
    });
  }
}

class ZInspireWriteEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(req: {
    headers: Record<string, string | undefined>;
    data: any;
  }): Promise<EndpointResult> {
    const expectedToken = ensureExternalToken();
    if (!expectedToken) {
      return jsonResult(503, { ok: false, error: "TOKEN_UNAVAILABLE" });
    }
    const headerMap = req?.headers ?? {};
    const providedToken =
      headerMap["x-zinspire-token"] ??
      (headerMap as any)["X-ZInspire-Token"] ??
      headerMap["X-ZINSPIRE-TOKEN"];
    if (!providedToken || providedToken !== expectedToken) {
      return jsonResult(403, { ok: false, error: "FORBIDDEN" });
    }

    const body = req?.data && typeof req.data === "object" ? req.data : {};
    return dispatchWriteOp(body);
  }
}

export function registerZInspireWriteEndpoint(): void {
  if (registered) {
    return;
  }
  const endpoints = (Zotero.Server as any)?.Endpoints;
  if (!endpoints) {
    debug(
      `[${config.addonName}] Zotero.Server.Endpoints not available; cannot register ${ENDPOINT_PATH}`,
    );
    return;
  }
  hadPreviousEndpoint = Object.prototype.hasOwnProperty.call(
    endpoints,
    ENDPOINT_PATH,
  );
  previousEndpoint = endpoints[ENDPOINT_PATH];
  endpoints[ENDPOINT_PATH] = ZInspireWriteEndpoint as any;
  registered = true;
  debug(
    `[${config.addonName}] Registered connector endpoint POST ${ENDPOINT_PATH}`,
  );
}

export function unregisterZInspireWriteEndpoint(): void {
  if (!registered) {
    return;
  }
  const endpoints = (Zotero.Server as any)?.Endpoints;
  if (!endpoints) {
    previousEndpoint = undefined;
    hadPreviousEndpoint = false;
    registered = false;
    return;
  }
  if (endpoints[ENDPOINT_PATH] === ZInspireWriteEndpoint) {
    if (hadPreviousEndpoint) {
      endpoints[ENDPOINT_PATH] = previousEndpoint;
    } else {
      delete endpoints[ENDPOINT_PATH];
    }
  }
  previousEndpoint = undefined;
  hadPreviousEndpoint = false;
  registered = false;
}
