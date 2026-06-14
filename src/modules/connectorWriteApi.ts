import { config, version } from "../../package.json";
import { ensureExternalToken } from "../utils/externalToken";

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

const CAPABILITIES = [
  "ping",
  "attach_file",
  "trash_item",
  "erase_item",
] as const;

let previousEndpoint: any | null = null;
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
  return [status, "application/json", JSON.stringify(body)];
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WriteError(400, "INVALID_PARAMS", `${field} is required (non-empty string)`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Resolve an explicit library_id, defaulting to the user library. */
function resolveLibraryID(raw: unknown): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return Number.parseInt(raw.trim(), 10);
  }
  return Zotero.Libraries.userLibraryID;
}

async function resolveItem(libraryID: number, key: string): Promise<Zotero.Item> {
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
    throw new WriteError(404, "FILE_NOT_FOUND", `file_path does not exist: ${filePath}`);
  }
  if (!file.isFile()) {
    throw new WriteError(400, "NOT_A_FILE", `file_path is not a regular file: ${filePath}`);
  }
  return { file, absPath: file.path };
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

async function handleAttachFile(body: Record<string, any>): Promise<EndpointResult> {
  const parentKey = requireString(body.parent_item_key, "parent_item_key");
  const filePath = requireString(body.file_path, "file_path");
  const libraryID = resolveLibraryID(body.library_id);
  const mode = body.mode === "import" ? "import" : "link";
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

  const options: any = { file, parentItemID: parent.id };
  if (title) options.title = title;
  if (contentType) options.contentType = contentType;

  const attachment =
    mode === "import"
      ? await Zotero.Attachments.importFromFile(options)
      : await Zotero.Attachments.linkFromFile(options);

  const linkMode = (attachment as any).attachmentLinkMode as number;
  Zotero.debug(
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
    path: absPath,
  });
}

async function handleTrashItem(body: Record<string, any>): Promise<EndpointResult> {
  const key = requireString(body.item_key, "item_key");
  const libraryID = resolveLibraryID(body.library_id);
  const item = await resolveItem(libraryID, key);

  await Zotero.Items.trashTx(item.id);
  Zotero.debug(`[${config.addonName}] write trash_item ok: ${key} (library ${libraryID})`);

  return jsonResult(200, {
    ok: true,
    op: "trash_item",
    library_id: libraryID,
    item_key: key,
    item_id: item.id,
    trashed: true,
  });
}

async function handleEraseItem(body: Record<string, any>): Promise<EndpointResult> {
  const key = requireString(body.item_key, "item_key");
  const libraryID = resolveLibraryID(body.library_id);
  const item = await resolveItem(libraryID, key);
  const itemID = item.id;

  await item.eraseTx();
  Zotero.debug(`[${config.addonName}] write erase_item ok: ${key} (library ${libraryID})`);

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
 * Dispatch a validated, authenticated write request to the matching op handler.
 * Exported for unit testing without the connector server.
 */
export async function dispatchWriteOp(body: Record<string, any>): Promise<EndpointResult> {
  const op = typeof body.op === "string" ? body.op.trim() : "";
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
      default:
        return jsonResult(400, {
          ok: false,
          op: op || undefined,
          error: `Unknown op: ${op || "(missing)"}`,
          capabilities: [...CAPABILITIES],
        });
    }
  } catch (err) {
    if (err instanceof WriteError) {
      return jsonResult(err.status, { ok: false, op, code: err.code, error: err.message });
    }
    const message = err instanceof Error ? err.message : String(err);
    Zotero.debug(`[${config.addonName}] write op=${op} failed: ${message}`);
    return jsonResult(500, { ok: false, op, code: "INTERNAL_ERROR", error: message });
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
    Zotero.debug?.(
      `[${config.addonName}] Zotero.Server.Endpoints not available; cannot register ${ENDPOINT_PATH}`,
    );
    return;
  }
  if (endpoints[ENDPOINT_PATH] && !previousEndpoint) {
    previousEndpoint = endpoints[ENDPOINT_PATH];
  }
  endpoints[ENDPOINT_PATH] = ZInspireWriteEndpoint as any;
  registered = true;
  Zotero.debug?.(
    `[${config.addonName}] Registered connector endpoint POST ${ENDPOINT_PATH}`,
  );
}

export function unregisterZInspireWriteEndpoint(): void {
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
