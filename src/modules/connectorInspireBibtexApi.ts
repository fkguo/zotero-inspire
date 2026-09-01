import { config, version } from "../../package.json";
import { readExternalReadToken } from "../utils/externalToken";
import {
  buildInspireBibtexBatch,
  INSPIRE_BIBTEX_API_LIMITS,
  InspireBibtexApiError,
  utf8ByteLength,
  validateCitationKeys,
} from "./inspireBibtexApi";

export const INSPIRE_BIBTEX_ENDPOINT_PATH = "/connector/zinspireBibtex";
export const INSPIRE_BIBTEX_API_VERSION = "1" as const;

type EndpointResult = [number, string, string];
type ResponseBody = Record<string, unknown>;

let previousEndpoint: any;
let hadPreviousEndpoint = false;
let registered = false;

function jsonResult(status: number, body: ResponseBody): EndpointResult {
  return [status, "application/json", JSON.stringify(body)];
}

function apiErrorResult(
  status: number,
  code: string,
  error: string,
  details?: Record<string, unknown>,
): EndpointResult {
  return jsonResult(status, {
    ok: false,
    api_version: INSPIRE_BIBTEX_API_VERSION,
    code,
    error,
    ...(details ? { details } : {}),
  });
}

function boundedJsonResult(status: number, body: ResponseBody): EndpointResult {
  const serialized = JSON.stringify(body);
  if (utf8ByteLength(serialized) > INSPIRE_BIBTEX_API_LIMITS.maxResponseBytes) {
    return apiErrorResult(
      413,
      "RESPONSE_TOO_LARGE",
      `Response exceeds the ${INSPIRE_BIBTEX_API_LIMITS.maxResponseBytes}-byte JSON limit`,
    );
  }
  return [status, "application/json", serialized];
}

function publicLimits(): Record<string, number> {
  return {
    max_citation_keys: INSPIRE_BIBTEX_API_LIMITS.maxCitationKeys,
    max_citation_key_length: INSPIRE_BIBTEX_API_LIMITS.maxCitationKeyLength,
    better_bibtex_ready_timeout_ms:
      INSPIRE_BIBTEX_API_LIMITS.betterBibtexReadyTimeoutMs,
    better_bibtex_export_timeout_ms:
      INSPIRE_BIBTEX_API_LIMITS.betterBibtexExportTimeoutMs,
    better_bibtex_export_concurrency:
      INSPIRE_BIBTEX_API_LIMITS.betterBibtexExportConcurrency,
    network_timeout_ms: INSPIRE_BIBTEX_API_LIMITS.networkTimeoutMs,
    network_concurrency: INSPIRE_BIBTEX_API_LIMITS.networkConcurrency,
    max_recid_field_length: INSPIRE_BIBTEX_API_LIMITS.maxRecidFieldLength,
    max_bibtex_entry_bytes: INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes,
    max_merged_bibtex_bytes: INSPIRE_BIBTEX_API_LIMITS.maxMergedBibtexBytes,
    max_response_bytes: INSPIRE_BIBTEX_API_LIMITS.maxResponseBytes,
  };
}

function handlePing(): EndpointResult {
  return jsonResult(200, {
    ok: true,
    op: "ping",
    api_version: INSPIRE_BIBTEX_API_VERSION,
    addon: config.addonName,
    addon_id: config.addonID,
    plugin_version: version,
    capabilities: {
      operations: ["ping", "fetch"],
      resolver_priority: ["better-bibtex-key-manager", "zotero-fields"],
      partial_results: true,
      entry_key_rewrite: true,
      provider_priority: ["INSPIRE-HEP", "Better BibTeX"],
      fallback_provider: "Better BibTeX",
    },
    limits: publicLimits(),
    security: {
      read_only: true,
      connector_loopback: true,
      unsafe_web_content_allowed: false,
      auth_header: "x-zinspire-read-token",
    },
  });
}

/** Dispatch an authenticated request after Zotero has parsed the JSON body. */
export async function dispatchInspireBibtexOp(
  body: unknown,
): Promise<EndpointResult> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiErrorResult(
      400,
      "INVALID_REQUEST",
      "Request body must be a JSON object",
    );
  }

  const request = body as Record<string, unknown>;
  const rawOp = typeof request.op === "string" ? request.op : "";
  if (rawOp.length > 16) {
    return apiErrorResult(400, "INVALID_OP", "Unsupported request op");
  }
  const op = rawOp.trim();
  try {
    if (!op) {
      return apiErrorResult(400, "INVALID_REQUEST", "Request op is required");
    }
    if (op === "ping") return handlePing();
    if (op !== "fetch") {
      return apiErrorResult(400, "INVALID_OP", "Unsupported request op");
    }

    const citationKeys = validateCitationKeys(request.citation_keys);
    const response = await buildInspireBibtexBatch(citationKeys);
    return boundedJsonResult(200, { op: "fetch", ...response });
  } catch (err) {
    if (err instanceof InspireBibtexApiError) {
      return apiErrorResult(err.status, err.code, err.message, err.details);
    }
    const message = err instanceof Error ? err.message : String(err);
    Zotero.debug?.(
      `[${config.addonName}] read-only INSPIRE BibTeX op=${op} failed: ${message}`,
    );
    return apiErrorResult(
      500,
      "INTERNAL_ERROR",
      "Unexpected internal failure while processing the request",
    );
  }
}

function getHeader(
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === wanted && typeof value === "string") return value;
  }
  return undefined;
}

function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < provided.length; index++) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

class ZInspireBibtexEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(req: {
    headers: Record<string, string | undefined>;
    data: unknown;
  }): Promise<EndpointResult> {
    // Startup creates the token. Request handling only reads it, so even a
    // malformed request cannot mutate Zotero preferences or library data.
    const expectedToken = readExternalReadToken();
    if (!expectedToken) {
      return apiErrorResult(
        503,
        "TOKEN_UNAVAILABLE",
        "The read-only integration token has not been initialized",
      );
    }
    const providedToken = getHeader(
      req?.headers ?? {},
      "x-zinspire-read-token",
    );
    if (!providedToken || !tokensMatch(providedToken, expectedToken)) {
      return apiErrorResult(
        403,
        "FORBIDDEN",
        "Invalid read-only integration token",
      );
    }
    return dispatchInspireBibtexOp(req?.data);
  }
}

export function registerZInspireBibtexEndpoint(): void {
  if (registered) return;
  const endpoints = (Zotero.Server as any)?.Endpoints;
  if (!endpoints) {
    Zotero.debug?.(
      `[${config.addonName}] Zotero.Server.Endpoints not available; cannot register ${INSPIRE_BIBTEX_ENDPOINT_PATH}`,
    );
    return;
  }

  hadPreviousEndpoint = Object.prototype.hasOwnProperty.call(
    endpoints,
    INSPIRE_BIBTEX_ENDPOINT_PATH,
  );
  previousEndpoint = endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH];
  endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH] = ZInspireBibtexEndpoint as any;
  registered = true;
  Zotero.debug?.(
    `[${config.addonName}] Registered read-only connector endpoint POST ${INSPIRE_BIBTEX_ENDPOINT_PATH}`,
  );
}

export function unregisterZInspireBibtexEndpoint(): void {
  if (!registered) return;
  const endpoints = (Zotero.Server as any)?.Endpoints;
  if (endpoints) {
    // Do not clobber a later owner that replaced this path after registration.
    if (endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH] === ZInspireBibtexEndpoint) {
      if (hadPreviousEndpoint) {
        endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH] = previousEndpoint;
      } else {
        delete endpoints[INSPIRE_BIBTEX_ENDPOINT_PATH];
      }
    }
  }
  previousEndpoint = undefined;
  hadPreviousEndpoint = false;
  registered = false;
}
