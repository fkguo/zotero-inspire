import type {
  LLMCompleteRequest,
  LLMCompleteResult,
  LLMStreamRequest,
} from "../types";
import { LLMError } from "../types";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function normalizeHttpBaseURL(baseURL: string): string {
  const raw = String(baseURL || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    return trimSlash(raw);
  }
  throw new LLMError("Invalid base URL (must start with http:// or https://)", {
    code: "bad_request",
    provider: "openaiCompatible",
  });
}

function hasV1Segment(url: string): boolean {
  return /(^|\/)v1(\/|$)/i.test(url);
}

function getOpenAICompatibleChatCompletionsEndpoints(
  baseURL: string,
): string[] {
  const cleanedBase = normalizeHttpBaseURL(baseURL);
  if (!cleanedBase) {
    return ["https://api.openai.com/v1/chat/completions"];
  }

  const cleaned = cleanedBase;
  const endpoints: string[] = [];
  const push = (url: string) => {
    if (!endpoints.includes(url)) endpoints.push(url);
  };

  if (/\/chat\/completions$/i.test(cleaned)) {
    push(cleaned);
  } else {
    push(`${cleaned}/chat/completions`);
  }

  if (!hasV1Segment(cleaned)) {
    if (/\/chat\/completions$/i.test(cleaned)) {
      push(cleaned.replace(/\/chat\/completions$/i, "/v1/chat/completions"));
    } else {
      push(`${cleaned}/v1/chat/completions`);
    }
  }

  return endpoints;
}

function getOpenAICompatibleResponsesEndpoints(baseURL: string): string[] {
  const cleanedBase = normalizeHttpBaseURL(baseURL);
  if (!cleanedBase) {
    return ["https://api.openai.com/v1/responses"];
  }

  const cleaned = cleanedBase;
  const endpoints: string[] = [];
  const push = (url: string) => {
    if (!endpoints.includes(url)) endpoints.push(url);
  };

  push(normalizeOpenAICompatibleResponsesEndpoint(cleaned));
  if (!hasV1Segment(cleaned)) {
    if (/\/responses$/i.test(cleaned)) {
      push(cleaned.replace(/\/responses$/i, "/v1/responses"));
    } else if (/\/chat\/completions$/i.test(cleaned)) {
      push(cleaned.replace(/\/chat\/completions$/i, "/v1/responses"));
    } else {
      push(`${cleaned}/v1/responses`);
    }
  }

  return endpoints;
}

function getOpenAICompatibleFilesEndpoints(baseURL: string): string[] {
  const cleanedBase = normalizeHttpBaseURL(baseURL);
  if (!cleanedBase) {
    return ["https://api.openai.com/v1/files"];
  }

  const cleaned = cleanedBase;
  const endpoints: string[] = [];
  const push = (url: string) => {
    if (!endpoints.includes(url)) endpoints.push(url);
  };

  if (/\/files$/i.test(cleaned)) {
    push(cleaned);
  } else if (/\/chat\/completions$/i.test(cleaned)) {
    push(cleaned.replace(/\/chat\/completions$/i, "/files"));
  } else if (/\/responses$/i.test(cleaned)) {
    push(cleaned.replace(/\/responses$/i, "/files"));
  } else {
    push(`${cleaned}/files`);
  }

  if (!hasV1Segment(cleaned)) {
    if (/\/files$/i.test(cleaned)) {
      push(cleaned.replace(/\/files$/i, "/v1/files"));
    } else if (/\/chat\/completions$/i.test(cleaned)) {
      push(cleaned.replace(/\/chat\/completions$/i, "/v1/files"));
    } else if (/\/responses$/i.test(cleaned)) {
      push(cleaned.replace(/\/responses$/i, "/v1/files"));
    } else {
      push(`${cleaned}/v1/files`);
    }
  }

  return endpoints;
}

function getOpenAICompatibleFilesPurpose(
  profile: LLMCompleteRequest["profile"],
): string {
  const baseURL = String(profile.baseURL || "").trim().toLowerCase();
  const preset = String(profile.preset || "").trim().toLowerCase();
  const model = String(profile.model || "").trim().toLowerCase();

  // Moonshot/Kimi uses a different purpose for document extraction.
  // Users may also access it via proxies, so include preset/model heuristics.
  if (
    baseURL.includes("moonshot.cn") ||
    preset === "kimi" ||
    model.includes("moonshot")
  ) {
    return "file-extract";
  }

  return "assistants";
}

function isMoonshotProfile(profile: LLMCompleteRequest["profile"]): boolean {
  const baseURL = String(profile.baseURL || "").trim().toLowerCase();
  const preset = String(profile.preset || "").trim().toLowerCase();
  const model = String(profile.model || "").trim().toLowerCase();
  return (
    baseURL.includes("moonshot.cn") ||
    preset === "kimi" ||
    model.startsWith("kimi-") ||
    model.includes("moonshot")
  );
}

function isDeepSeekProfile(profile: LLMCompleteRequest["profile"]): boolean {
  const baseURL = String(profile.baseURL || "").trim().toLowerCase();
  const preset = String(profile.preset || "").trim().toLowerCase();
  const model = String(profile.model || "").trim().toLowerCase();
  return (
    preset === "deepseek" || model.startsWith("deepseek") || baseURL.includes("deepseek")
  );
}

function getOpenAICompatibleExtraBody(
  profile: LLMCompleteRequest["profile"],
): Record<string, any> {
  // DeepSeek thinking mode: https://api-docs.deepseek.com/guides/thinking_mode
  if (isDeepSeekProfile(profile)) {
    return { thinking: { type: "enabled" } };
  }
  return {};
}

async function fetchOpenAICompatibleWithFallback(options: {
  endpoints: string[];
  init: Omit<RequestInit, "signal">;
  signal?: AbortSignal;
}): Promise<{ res: Response; endpoint: string }> {
  const { endpoints, init, signal } = options;
  let lastRes: Response | null = null;
  let lastEndpoint = endpoints[0] || "";

  for (const endpoint of endpoints) {
    lastEndpoint = endpoint;
    const res = await fetch(endpoint, { ...init, signal });
    if (res.ok) return { res, endpoint };
    lastRes = res;
    if (res.status === 404 || res.status === 405) {
      continue;
    }
    return { res, endpoint };
  }

  return { res: lastRes as Response, endpoint: lastEndpoint };
}

export function normalizeOpenAICompatibleEndpoint(baseURL: string): string {
  const cleanedBase = normalizeHttpBaseURL(baseURL);
  if (!cleanedBase) {
    return "https://api.openai.com/v1/chat/completions";
  }
  const cleaned = cleanedBase;
  if (/\/chat\/completions$/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}/chat/completions`;
}

export function normalizeOpenAICompatibleResponsesEndpoint(
  baseURL: string,
): string {
  const cleanedBase = normalizeHttpBaseURL(baseURL);
  if (!cleanedBase) {
    return "https://api.openai.com/v1/responses";
  }
  const cleaned = cleanedBase;
  if (/\/responses$/i.test(cleaned)) {
    return cleaned;
  }
  if (/\/chat\/completions$/i.test(cleaned)) {
    return cleaned.replace(/\/chat\/completions$/i, "/responses");
  }
  return `${cleaned}/responses`;
}

function classifyHttpStatus(status: number): {
  code:
    | "unauthorized"
    | "forbidden"
    | "rate_limited"
    | "bad_request"
    | "server_error"
    | "unknown";
} {
  if (status === 401) return { code: "unauthorized" };
  if (status === 403) return { code: "forbidden" };
  if (status === 429) return { code: "rate_limited" };
  if (status >= 400 && status < 500) return { code: "bad_request" };
  if (status >= 500) return { code: "server_error" };
  return { code: "unknown" };
}

function tryGetErrorMessage(payload: unknown): string | null {
  const err = (payload as any)?.error;
  const msg =
    (typeof err === "string" ? err : err?.message) ??
    (payload as any)?.message ??
    (payload as any)?.detail ??
    null;
  return typeof msg === "string" && msg.trim() ? msg.trim() : null;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const src = String(base64 || "");
  if (!src) return new Uint8Array();

  // Node.js (tests/build tooling)
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(src, "base64"));
  }

  // Browser / Zotero (Gecko)
  if (typeof atob === "function") {
    const bin = atob(src);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i) & 0xff;
    }
    return out;
  }

  throw new LLMError("Base64 decode not supported in this environment", {
    code: "unknown",
    provider: "openaiCompatible",
  });
}

function utf8ToUint8Array(text: string): Uint8Array {
  const src = String(text ?? "");
  // Node.js (tests/build tooling)
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(src, "utf8"));
  }
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(src);
  }
  // Fallback (very old environments): naive Latin-1
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src.charCodeAt(i) & 0xff;
  return out;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const list = Array.isArray(parts) ? parts.filter(Boolean) : [];
  const total = list.reduce((sum, p) => sum + (p?.length || 0), 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of list) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function buildMultipartFormDataBody(params: {
  boundary: string;
  purpose: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Uint8Array {
  const boundary = String(params.boundary || "").trim();
  const purpose = String(params.purpose || "assistants");
  const filename = String(params.filename || "document").replace(/"/g, "");
  const mimeType = String(params.mimeType || "application/octet-stream");
  const bytes = params.bytes || new Uint8Array();

  const crlf = "\r\n";
  const head =
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="purpose"${crlf}${crlf}` +
    `${purpose}${crlf}` +
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}` +
    `Content-Type: ${mimeType}${crlf}${crlf}`;
  const tail = `${crlf}--${boundary}--${crlf}`;

  return concatUint8Arrays([utf8ToUint8Array(head), bytes, utf8ToUint8Array(tail)]);
}

function extractTextFromChatCompletions(payload: unknown): {
  text: string;
  usage?: any;
} {
  const choices = Array.isArray((payload as any)?.choices)
    ? ((payload as any).choices as any[])
    : [];
  const first = choices[0] ?? null;
  const coerceContentText = (value: any): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      const texts: string[] = [];
      for (const part of value) {
        const t = part?.text ?? part?.content ?? null;
        if (typeof t === "string" && t) {
          texts.push(t);
        }
      }
      return texts.join("");
    }
    if (value && typeof value === "object") {
      const t = (value as any).text ?? (value as any).content ?? null;
      if (typeof t === "string") return t;
    }
    return "";
  };

  const answer =
    coerceContentText(first?.message?.content) ||
    coerceContentText(first?.delta?.content) ||
    coerceContentText(first?.text);
  const reasoning =
    coerceContentText(first?.message?.reasoning_content) ||
    coerceContentText(first?.delta?.reasoning_content);

  const text = reasoning.trim()
    ? answer.trim()
      ? `### Thinking\n\n${reasoning.trimEnd()}\n\n### Answer\n\n${answer}`
      : reasoning
    : answer;
  const usage = (payload as any)?.usage;
  return { text, usage };
}

function extractTextFromResponses(payload: unknown): {
  text: string;
  usage?: any;
} {
  const outputText = (payload as any)?.output_text;
  if (typeof outputText === "string") {
    return { text: outputText, usage: (payload as any)?.usage };
  }

  const output = Array.isArray((payload as any)?.output)
    ? ((payload as any).output as any[])
    : [];
  const texts: string[] = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const text = part?.text ?? part?.content ?? null;
      if (typeof text === "string" && text) {
        texts.push(text);
      }
    }
  }
  return { text: texts.join(""), usage: (payload as any)?.usage };
}

function extractTextFromGeminiLike(payload: unknown): { text: string; usage?: any } {
  const candidates = Array.isArray((payload as any)?.candidates)
    ? ((payload as any).candidates as any[])
    : [];
  const first = candidates[0] ?? null;
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const texts = parts
    .map((p: any) => p?.text)
    .filter((t: any) => typeof t === "string" && t);
  const text = texts.join("");
  const usage = (payload as any)?.usage ?? (payload as any)?.usageMetadata;
  return { text, usage };
}

function extractTextFromAnyResponse(payload: unknown): {
  text: string;
  usage?: any;
} {
  const base: any = payload as any;
  const usage =
    base?.usage ??
    base?.usageMetadata ??
    base?.output?.usage ??
    base?.data?.usage ??
    base?.result?.usage ??
    null;

  const chat = extractTextFromChatCompletions(payload);
  if (chat.text.trim()) return { text: chat.text, usage: chat.usage ?? usage };

  const responses = extractTextFromResponses(payload);
  if (responses.text.trim())
    return { text: responses.text, usage: responses.usage ?? usage };

  const gemini = extractTextFromGeminiLike(payload);
  if (gemini.text.trim())
    return { text: gemini.text, usage: gemini.usage ?? usage };

  // Some providers wrap OpenAI-like payloads under `data`, `output`, or `result`.
  // Recurse into common wrapper keys before giving up.
  const nestedCandidates = [base?.data, base?.output, base?.result, base?.response];
  for (const nested of nestedCandidates) {
    if (!nested || typeof nested !== "object") continue;
    const inner = extractTextFromAnyResponse(nested);
    if (inner.text.trim()) {
      return { text: inner.text, usage: inner.usage ?? usage };
    }
  }

  const loose =
    base?.output_text ?? base?.text ?? base?.content ?? base?.result ?? null;
  if (typeof loose === "string" && loose.trim()) {
    return { text: loose, usage };
  }

  return { text: responses.text, usage: responses.usage ?? usage };
}

function extractStreamTextCandidate(payload: any): string {
  if (!payload || typeof payload !== "object") return "";

  // Common wrappers (some proxies nest the actual event under `data`)
  const nested = payload?.data;
  if (nested && typeof nested === "object") {
    const inner = extractStreamTextCandidate(nested);
    if (inner) return inner;
  }

  // OpenAI Responses streaming events:
  // `{"type":"response.output_text.delta","delta":"..."}` / `...done` with `text`.
  const type = typeof payload.type === "string" ? payload.type : "";
  if (type) {
    const delta = payload.delta;
    if (type.includes("delta")) {
      if (typeof delta === "string" && delta) return delta;
      if (typeof delta?.text === "string" && delta.text) return delta.text;
      if (typeof payload.text === "string" && payload.text) return payload.text;
    }
    if (type.includes("done") || type.includes("completed")) {
      if (typeof payload.text === "string" && payload.text) return payload.text;
      if (typeof payload.output_text === "string" && payload.output_text) {
        return payload.output_text;
      }
    }
  }

  // Some servers stream as JSON lines without `choices`.
  if (typeof payload.delta === "string" && payload.delta) return payload.delta;
  if (typeof payload.text === "string" && payload.text) return payload.text;
  if (typeof payload.output_text === "string" && payload.output_text) {
    return payload.output_text;
  }

  const geminiLike = extractTextFromGeminiLike(payload);
  if (geminiLike.text) return geminiLike.text;

  const choice = payload?.choices?.[0] ?? null;
  const delta = choice?.delta ?? null;

  const fromContentParts = (value: any): string => {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    const texts: string[] = [];
    for (const part of value) {
      const t = part?.text ?? part?.content ?? null;
      if (typeof t === "string" && t) {
        texts.push(t);
      }
    }
    return texts.join("");
  };

  const deltaContent = fromContentParts(delta?.content);
  if (deltaContent) return deltaContent;
  if (typeof delta?.text === "string" && delta.text) return delta.text;

  // Some OpenAI-compatible proxies stream full message content in each chunk.
  const msgContent = fromContentParts(choice?.message?.content);
  if (msgContent) return msgContent;

  if (typeof choice?.text === "string" && choice.text) return choice.text;

  // Responses API shapes (non-standard for chat.completions streaming).
  if (typeof payload?.output_text === "string" && payload.output_text) {
    return payload.output_text;
  }

  return "";
}

function appendStreamText(
  current: string,
  incoming: string,
): { nextFull: string; delta: string } {
  const next = String(incoming || "");
  if (!next) return { nextFull: current, delta: "" };
  if (!current) return { nextFull: next, delta: next };
  if (next.startsWith(current)) {
    const d = next.slice(current.length);
    return { nextFull: next, delta: d };
  }
  if (current.startsWith(next)) {
    // Repeated shorter prefix; ignore.
    return { nextFull: current, delta: "" };
  }
  return { nextFull: current + next, delta: next };
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

async function readResponseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    try {
      const text = await res.text();
      return text ? { _raw: text } : null;
    } catch {
      return null;
    }
  }
}

function getOpenAICompatibleFileContentEndpoints(
  baseURL: string,
  fileId: string,
): string[] {
  const endpoints: string[] = [];
  const push = (url: string) => {
    if (!endpoints.includes(url)) endpoints.push(url);
  };
  const id = encodeURIComponent(String(fileId || "").trim());
  for (const filesEndpoint of getOpenAICompatibleFilesEndpoints(baseURL)) {
    push(`${trimSlash(filesEndpoint)}/${id}/content`);
  }
  return endpoints;
}

async function fetchOpenAICompatibleFileExtractContent(options: {
  profile: LLMCompleteRequest["profile"];
  apiKey: string;
  fileId: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { profile, apiKey, fileId, signal } = options;
  const endpoints = getOpenAICompatibleFileContentEndpoints(
    profile.baseURL || "",
    fileId,
  );

  let res: Response;
  try {
    ({ res } = await fetchOpenAICompatibleWithFallback({
      endpoints,
      init: {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      signal,
    }));
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    throw new LLMError(`Network error: ${String(err)}`, {
      code: "network",
      provider: profile.provider,
    });
  }

  if (!res.ok) {
    const data = await readResponseJsonSafe(res);
    const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
    const classification = classifyHttpStatus(res.status);
    throw new LLMError(msg, {
      code: classification.code,
      status: res.status,
      provider: profile.provider,
    });
  }

  const data = await readResponseJsonSafe(res);
  if (typeof data === "string") return data;

  const contentRaw =
    (data as any)?.content ??
    (data as any)?.text ??
    (data as any)?.data ??
    (data as any)?._raw ??
    null;

  if (typeof contentRaw === "string") return contentRaw;
  if (
    contentRaw &&
    typeof contentRaw === "object" &&
    typeof (contentRaw as any)?.text === "string"
  ) {
    return (contentRaw as any).text;
  }

  try {
    const s = JSON.stringify(data);
    return typeof s === "string" ? s : "";
  } catch {
    return "";
  }
}

async function uploadOpenAICompatibleFiles(options: {
  profile: LLMCompleteRequest["profile"];
  apiKey: string;
  documents: Array<{ mimeType: string; data: string; filename?: string }>;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { profile, apiKey, documents, signal } = options;
  const endpoints = getOpenAICompatibleFilesEndpoints(profile.baseURL || "");
  const defaultPurpose = getOpenAICompatibleFilesPurpose(profile);
  const purposes = Array.from(
    new Set([defaultPurpose, "file-extract", "assistants"].filter(Boolean)),
  );

  const hasFormData = typeof FormData !== "undefined";
  const hasBlob = typeof Blob !== "undefined";

  const ids: string[] = [];
  for (const doc of documents) {
    const bytes = base64ToUint8Array(doc.data);
    const filename = doc.filename || "document";
    const useFormData = hasFormData && hasBlob;

    let uploadedId: string | null = null;
    let lastError: LLMError | null = null;

    for (const purpose of purposes) {
      // Build a fresh body for each attempt (some fetch implementations consume it).
      const boundary = `----zotero-inspire-${Math.random().toString(16).slice(2)}`;
      const buildBody = (): { body: any; contentType?: string } => {
        if (useFormData) {
          const toArrayBuffer = (u8: Uint8Array): ArrayBuffer => {
            const buf = u8.buffer;
            if (buf instanceof ArrayBuffer) {
              if (u8.byteOffset === 0 && u8.byteLength === buf.byteLength)
                return buf;
              return buf.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
            }
            // SharedArrayBuffer (or other ArrayBufferLike): copy into ArrayBuffer.
            return new Uint8Array(u8).buffer;
          };
          const blob = new Blob([toArrayBuffer(bytes)], {
            type: doc.mimeType || "application/octet-stream",
          });
          const form = new FormData();
          form.append("purpose", purpose);
          form.append("file", blob, filename);
          return { body: form };
        }

        // Fallback: construct multipart body manually (works even when FormData/Blob are missing).
        const body = buildMultipartFormDataBody({
          boundary,
          purpose,
          filename,
          mimeType: doc.mimeType || "application/octet-stream",
          bytes,
        });
        return { body, contentType: `multipart/form-data; boundary=${boundary}` };
      };

      let lastRes: Response | null = null;
      let lastEndpoint = endpoints[0] || "";

      for (const endpoint of endpoints) {
        lastEndpoint = endpoint;
        let res: Response;
        try {
          const { body, contentType } = buildBody();
          const headers: Record<string, string> = {
            Authorization: `Bearer ${apiKey}`,
          };
          if (contentType) headers["Content-Type"] = contentType;
          res = await fetch(endpoint, {
            method: "POST",
            headers,
            body: body as any,
            signal,
          });
        } catch (err: any) {
          if (err?.name === "AbortError") throw err;
          throw new LLMError(`Network error: ${String(err)}`, {
            code: "network",
            provider: profile.provider,
          });
        }

        if (res.ok) {
          lastRes = res;
          break;
        }
        lastRes = res;
        if (res.status === 404 || res.status === 405) {
          continue;
        }
        break;
      }

      const res = lastRes as Response;
      if (!res) {
        lastError = new LLMError(
          `File upload failed (no response) at ${lastEndpoint}`,
          { code: "network", provider: profile.provider },
        );
        continue;
      }

      if (!res.ok) {
        const data = await readResponseJsonSafe(res);
        const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
        const classification = classifyHttpStatus(res.status);
        const err = new LLMError(msg, {
          code: classification.code,
          status: res.status,
          provider: profile.provider,
        });
        lastError = err;

        const invalidPurpose =
          /invalid\s+purpose/i.test(msg) || /purpose\s+.*accepted/i.test(msg);
        if (invalidPurpose) {
          continue;
        }
        break;
      }

      const data = await readResponseJsonSafe(res);
      const idRaw = (data as any)?.id ?? (data as any)?.file_id ?? null;
      const id = typeof idRaw === "string" ? idRaw : "";
      if (!id.trim()) {
        lastError = new LLMError(
          "File upload succeeded but no file id was returned",
          { code: "bad_request", provider: profile.provider },
        );
        continue;
      }
      uploadedId = id.trim();
      break;
    }

    if (!uploadedId) {
      throw (
        lastError ||
        new LLMError("File upload failed", {
          code: "network",
          provider: profile.provider,
        })
      );
    }

    ids.push(uploadedId);
  }

  return ids;
}

function createAbortError(): Error {
  const err = new Error("Aborted");
  (err as any).name = "AbortError";
  return err;
}

async function streamSseText(
  res: Response,
  onDataLine: (data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = res.body as any;
  if (!body || typeof body.getReader !== "function") {
    throw new LLMError("Streaming not supported in this environment", {
      code: "unknown",
    });
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("data:")) {
      const data = trimmed.slice(5).trim();
      if (data) onDataLine(data);
      return;
    }

    // Ignore other SSE control lines
    if (
      trimmed.startsWith("event:") ||
      trimmed.startsWith("id:") ||
      trimmed.startsWith("retry:") ||
      trimmed.startsWith(":")
    ) {
      return;
    }

    // Fallback: some proxies stream NDJSON (one JSON object per line)
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      onDataLine(trimmed);
    }
  };

  while (true) {
    if (signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw createAbortError();
    }

    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      handleLine(line);
    }
  }

  // Flush trailing buffer (some servers omit the final newline)
  if (buffer.trim()) {
    for (const line of buffer.split(/\r?\n/)) {
      handleLine(line);
    }
  }
}

export async function openaiCompatibleComplete(
  req: LLMCompleteRequest,
): Promise<LLMCompleteResult> {
  const images = Array.isArray(req.images) ? req.images : [];
  if (Array.isArray(req.documents) && req.documents.length) {
    if (isMoonshotProfile(req.profile)) {
      return await openaiCompatibleChatCompletionsWithMoonshotFileExtractComplete(
        req,
      );
    }
    let responsesResult: LLMCompleteResult | null = null;
    try {
      responsesResult = await openaiCompatibleResponsesComplete(req);
      if (responsesResult.text.trim()) {
        return responsesResult;
      }
      // If the endpoint exists but the payload is unsupported, some providers return
      // an "OK" envelope with no text. Fall through to /chat/completions.
    } catch (err: any) {
      // Many OpenAI-compatible vendors only implement /chat/completions.
      // When /responses is missing (404/405), retry by sending the PDF as
      // multimodal message content to /chat/completions.
      if (!(err instanceof LLMError && (err.status === 404 || err.status === 405))) {
        throw err;
      }
    }

    try {
      return await openaiCompatibleChatCompletionsWithDocumentsComplete(req);
    } catch (err2: any) {
      // Some providers reject `file_data` in JSON; try uploading via /files and
      // referencing `file_id` instead (still PDF-based, not local snippets).
      if (
        err2 instanceof LLMError &&
        typeof err2.status === "number" &&
        (err2.status === 400 ||
          err2.status === 413 ||
          err2.status === 415 ||
          err2.status === 422)
      ) {
        return await openaiCompatibleChatCompletionsWithUploadedFilesComplete(req);
      }
      throw err2;
    }
  }

  const endpoints = getOpenAICompatibleChatCompletionsEndpoints(
    req.profile.baseURL || "",
  );
  const userContent =
    images.length > 0
      ? [
          ...images.map((img) => ({
            type: "image_url",
            image_url: {
              url: `data:${img.mimeType};base64,${img.data}`,
            },
          })),
          { type: "text", text: req.user },
        ]
      : req.user;
  const payload = {
    model: req.profile.model,
    messages: [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: userContent },
    ],
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxOutputTokens ?? 1200,
    ...getOpenAICompatibleExtraBody(req.profile),
  };

  let res: Response;
  try {
    ({ res } = await fetchOpenAICompatibleWithFallback({
      endpoints,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      signal: req.signal,
    }));
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    throw new LLMError(`Network error: ${String(err)}`, {
      code: "network",
      provider: req.profile.provider,
    });
  }

  if (!res.ok) {
    const data = await readResponseJsonSafe(res);
    const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
    const classification = classifyHttpStatus(res.status);
    throw new LLMError(msg, {
      code: classification.code,
      status: res.status,
      provider: req.profile.provider,
    });
  }

  const data = await readResponseJsonSafe(res);
  const { text, usage } = extractTextFromAnyResponse(data);
  if (!text.trim()) {
    const errMsg = tryGetErrorMessage(data);
    throw new LLMError(errMsg || "Empty response from model", {
      code: errMsg ? "bad_request" : "unknown",
      provider: req.profile.provider,
    });
  }
  const inputTokens = toFiniteNumber(
    usage?.prompt_tokens ?? usage?.input_tokens,
  );
  const outputTokens = toFiniteNumber(
    usage?.completion_tokens ?? usage?.output_tokens,
  );
  const totalTokens =
    toFiniteNumber(usage?.total_tokens ?? usage?.totalTokens) ??
    (typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : undefined);
  return {
    text,
    usage: usage
      ? typeof inputTokens === "number" ||
        typeof outputTokens === "number" ||
        typeof totalTokens === "number"
        ? { inputTokens, outputTokens, totalTokens }
        : undefined
      : undefined,
    raw: data,
  };
}

async function openaiCompatibleResponsesComplete(
  req: LLMCompleteRequest,
): Promise<LLMCompleteResult> {
  const endpoints = getOpenAICompatibleResponsesEndpoints(
    req.profile.baseURL || "",
  );
  const docs = Array.isArray(req.documents) ? req.documents : [];
  const userContent = [
    ...docs.map((d) => ({
      type: "input_file",
      file_data: `data:${d.mimeType};base64,${d.data}`,
    })),
    { type: "input_text", text: req.user },
  ];

  const input = [
    ...(req.system
      ? [
          {
            role: "system",
            content: [{ type: "input_text", text: req.system }],
          },
        ]
      : []),
    { role: "user", content: userContent },
  ];

  const payload = {
    model: req.profile.model,
    input,
    temperature: req.temperature ?? 0.2,
    max_output_tokens: req.maxOutputTokens ?? 1200,
    ...getOpenAICompatibleExtraBody(req.profile),
  };

  let res: Response;
  try {
    ({ res } = await fetchOpenAICompatibleWithFallback({
      endpoints,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      signal: req.signal,
    }));
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    throw new LLMError(`Network error: ${String(err)}`, {
      code: "network",
      provider: req.profile.provider,
    });
  }

  if (!res.ok) {
    const data = await readResponseJsonSafe(res);
    const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
    const classification = classifyHttpStatus(res.status);
    throw new LLMError(msg, {
      code: classification.code,
      status: res.status,
      provider: req.profile.provider,
    });
  }

  const data = await readResponseJsonSafe(res);
  const { text, usage } = extractTextFromResponses(data);
  const inputTokens = toFiniteNumber(
    usage?.input_tokens ?? usage?.prompt_tokens,
  );
  const outputTokens = toFiniteNumber(
    usage?.output_tokens ?? usage?.completion_tokens,
  );
  const totalTokens =
    toFiniteNumber(usage?.total_tokens ?? usage?.totalTokens) ??
    (typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : undefined);
  return {
    text,
    usage:
      typeof inputTokens === "number" ||
      typeof outputTokens === "number" ||
      typeof totalTokens === "number"
        ? { inputTokens, outputTokens, totalTokens }
        : undefined,
    raw: data,
  };
}

async function openaiCompatibleChatCompletionsWithDocumentsComplete(
  req: LLMCompleteRequest,
): Promise<LLMCompleteResult> {
  const endpoints = getOpenAICompatibleChatCompletionsEndpoints(
    req.profile.baseURL || "",
  );
  const docs = Array.isArray(req.documents) ? req.documents : [];
  const userContent = [
    ...docs.map((d) => ({
      type: "input_file",
      file_data: `data:${d.mimeType};base64,${d.data}`,
    })),
    { type: "text", text: req.user },
  ];

  const payload = {
    model: req.profile.model,
    messages: [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: userContent },
    ],
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxOutputTokens ?? 1200,
    ...getOpenAICompatibleExtraBody(req.profile),
  };

  let res: Response;
  try {
    ({ res } = await fetchOpenAICompatibleWithFallback({
      endpoints,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      signal: req.signal,
    }));
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    throw new LLMError(`Network error: ${String(err)}`, {
      code: "network",
      provider: req.profile.provider,
    });
  }

  if (!res.ok) {
    const data = await readResponseJsonSafe(res);
    const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
    const classification = classifyHttpStatus(res.status);
    throw new LLMError(msg, {
      code: classification.code,
      status: res.status,
      provider: req.profile.provider,
    });
  }

  const data = await readResponseJsonSafe(res);
  const { text, usage } = extractTextFromAnyResponse(data);
  if (!text.trim()) {
    const errMsg = tryGetErrorMessage(data);
    throw new LLMError(errMsg || "Empty response from model", {
      code: errMsg ? "bad_request" : "unknown",
      provider: req.profile.provider,
    });
  }

  const inputTokens = toFiniteNumber(
    usage?.prompt_tokens ?? usage?.input_tokens,
  );
  const outputTokens = toFiniteNumber(
    usage?.completion_tokens ?? usage?.output_tokens,
  );
  const totalTokens =
    toFiniteNumber(usage?.total_tokens ?? usage?.totalTokens) ??
    (typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : undefined);
  return {
    text,
    usage:
      typeof inputTokens === "number" ||
      typeof outputTokens === "number" ||
      typeof totalTokens === "number"
        ? { inputTokens, outputTokens, totalTokens }
        : undefined,
    raw: data,
  };
}

function buildMoonshotFileExtractSystemMessageContent(options: {
  filename?: string;
  extractedText: string;
}): string {
  const filename = String(options.filename || "").trim();
  const extractedText = String(options.extractedText || "");
  if (!filename) return extractedText;
  return `Document: ${filename}\n\n${extractedText}`;
}

async function openaiCompatibleChatCompletionsWithMoonshotFileExtractComplete(
  req: LLMCompleteRequest,
): Promise<LLMCompleteResult> {
  const docs = Array.isArray(req.documents) ? req.documents : [];
  const fileIds = await uploadOpenAICompatibleFiles({
    profile: req.profile,
    apiKey: req.apiKey,
    documents: docs,
    signal: req.signal,
  });
  const extracted = await Promise.all(
    fileIds.map((id) =>
      fetchOpenAICompatibleFileExtractContent({
        profile: req.profile,
        apiKey: req.apiKey,
        fileId: id,
        signal: req.signal,
      }),
    ),
  );

  const endpoints = getOpenAICompatibleChatCompletionsEndpoints(
    req.profile.baseURL || "",
  );
  const messages = [
    ...(req.system ? [{ role: "system", content: req.system }] : []),
    ...extracted.map((text, i) => ({
      role: "system",
      content: buildMoonshotFileExtractSystemMessageContent({
        filename: docs[i]?.filename,
        extractedText: text,
      }),
    })),
    { role: "user", content: req.user },
  ];

  const payload = {
    model: req.profile.model,
    messages,
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxOutputTokens ?? 1200,
    ...getOpenAICompatibleExtraBody(req.profile),
  };

  let res: Response;
  try {
    ({ res } = await fetchOpenAICompatibleWithFallback({
      endpoints,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      signal: req.signal,
    }));
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    throw new LLMError(`Network error: ${String(err)}`, {
      code: "network",
      provider: req.profile.provider,
    });
  }

  if (!res.ok) {
    const data = await readResponseJsonSafe(res);
    const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
    const classification = classifyHttpStatus(res.status);
    throw new LLMError(msg, {
      code: classification.code,
      status: res.status,
      provider: req.profile.provider,
    });
  }

  const data = await readResponseJsonSafe(res);
  const { text, usage } = extractTextFromAnyResponse(data);
  if (!text.trim()) {
    const errMsg = tryGetErrorMessage(data);
    throw new LLMError(errMsg || "Empty response from model", {
      code: errMsg ? "bad_request" : "unknown",
      provider: req.profile.provider,
    });
  }

  const inputTokens = toFiniteNumber(
    usage?.prompt_tokens ?? usage?.input_tokens,
  );
  const outputTokens = toFiniteNumber(
    usage?.completion_tokens ?? usage?.output_tokens,
  );
  const totalTokens =
    toFiniteNumber(usage?.total_tokens ?? usage?.totalTokens) ??
    (typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : undefined);

  return {
    text,
    usage:
      typeof inputTokens === "number" ||
      typeof outputTokens === "number" ||
      typeof totalTokens === "number"
        ? { inputTokens, outputTokens, totalTokens }
        : undefined,
    raw: data,
  };
}

async function openaiCompatibleChatCompletionsWithUploadedFilesComplete(
  req: LLMCompleteRequest,
): Promise<LLMCompleteResult> {
  const docs = Array.isArray(req.documents) ? req.documents : [];
  const fileIds = await uploadOpenAICompatibleFiles({
    profile: req.profile,
    apiKey: req.apiKey,
    documents: docs,
    signal: req.signal,
  });

  const endpoints = getOpenAICompatibleChatCompletionsEndpoints(
    req.profile.baseURL || "",
  );
  const userContent = [
    ...fileIds.map((id) => ({ type: "input_file", file_id: id })),
    { type: "text", text: req.user },
  ];

  const payload = {
    model: req.profile.model,
    messages: [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: userContent },
    ],
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxOutputTokens ?? 1200,
    ...getOpenAICompatibleExtraBody(req.profile),
  };

  let res: Response;
  try {
    ({ res } = await fetchOpenAICompatibleWithFallback({
      endpoints,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      signal: req.signal,
    }));
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    throw new LLMError(`Network error: ${String(err)}`, {
      code: "network",
      provider: req.profile.provider,
    });
  }

  if (!res.ok) {
    const data = await readResponseJsonSafe(res);
    const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
    const classification = classifyHttpStatus(res.status);
    throw new LLMError(msg, {
      code: classification.code,
      status: res.status,
      provider: req.profile.provider,
    });
  }

  const data = await readResponseJsonSafe(res);
  const { text, usage } = extractTextFromAnyResponse(data);
  if (!text.trim()) {
    const errMsg = tryGetErrorMessage(data);
    if (errMsg) {
      throw new LLMError(errMsg, {
        code: "bad_request",
        provider: req.profile.provider,
      });
    }
  }

  const inputTokens = toFiniteNumber(
    usage?.prompt_tokens ?? usage?.input_tokens,
  );
  const outputTokens = toFiniteNumber(
    usage?.completion_tokens ?? usage?.output_tokens,
  );
  const totalTokens =
    toFiniteNumber(usage?.total_tokens ?? usage?.totalTokens) ??
    (typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : undefined);
  return {
    text,
    usage:
      typeof inputTokens === "number" ||
      typeof outputTokens === "number" ||
      typeof totalTokens === "number"
        ? { inputTokens, outputTokens, totalTokens }
        : undefined,
    raw: data,
  };
}

async function consumeOpenAICompatibleStreamResponse(
  req: LLMStreamRequest,
  res: Response,
): Promise<LLMCompleteResult> {
  const contentType = String(res.headers.get("content-type") || "");
  const looksJson = /\bjson\b/i.test(contentType);

  // Keep a clone for trying an alternate parsing strategy (some proxies lie about
  // content-type or ignore `stream: true`).
  let fallback: Response | null = null;
  try {
    fallback = res.clone();
  } catch {
    fallback = null;
  }

  const emitFullOnce = (text: string) => {
    if (!text) return;
    req.onDelta(text);
  };

  const parseJsonFromResponse = async (response: Response) => {
    const data = await readResponseJsonSafe(response);
    const { text, usage } = extractTextFromAnyResponse(data);
    if (!text.trim()) {
      const errMsg = tryGetErrorMessage(data);
      if (errMsg) {
        throw new LLMError(errMsg, {
          code: "bad_request",
          provider: req.profile.provider,
        });
      }
    }
    return { text, usage, raw: data };
  };

  const consumeSse = async (response: Response): Promise<string> => {
    let fullText = "";
    let deepseekThinkingStream = false;
    let deepseekThinkingStarted = false;
    let deepseekAnswerStarted = false;
    await streamSseText(
      response,
      (data) => {
        if (data === "[DONE]") {
          return;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          // Some proxies stream plain text deltas without JSON envelopes.
          const candidate = String(data || "");
          if (!candidate) return;
          const { nextFull, delta } = appendStreamText(fullText, candidate);
          fullText = nextFull;
          if (delta) {
            req.onDelta(delta);
          }
          return;
        }
        const choice = parsed?.choices?.[0] ?? null;
        const deltaObj = choice?.delta ?? null;
        if (
          !deepseekThinkingStream &&
          deltaObj &&
          typeof deltaObj === "object" &&
          Object.prototype.hasOwnProperty.call(deltaObj, "reasoning_content")
        ) {
          deepseekThinkingStream = true;
        }

        if (deepseekThinkingStream) {
          const reasoningDelta =
            typeof deltaObj?.reasoning_content === "string"
              ? deltaObj.reasoning_content
              : "";
          const contentDelta =
            typeof deltaObj?.content === "string"
              ? deltaObj.content
              : "";

          if (reasoningDelta) {
            if (!deepseekThinkingStarted) {
              const head = "### Thinking\n\n";
              fullText += head;
              req.onDelta(head);
              deepseekThinkingStarted = true;
            }
            fullText += reasoningDelta;
            req.onDelta(reasoningDelta);
          }

          if (contentDelta) {
            if (deepseekThinkingStarted && !deepseekAnswerStarted) {
              const sep = "\n\n### Answer\n\n";
              fullText += sep;
              req.onDelta(sep);
              deepseekAnswerStarted = true;
            }
            fullText += contentDelta;
            req.onDelta(contentDelta);
          }
          return;
        }

        const candidate = extractStreamTextCandidate(parsed);
        if (!candidate) {
          const errMsg = tryGetErrorMessage(parsed);
          if (errMsg) {
            throw new LLMError(errMsg, {
              code: "bad_request",
              provider: req.profile.provider,
            });
          }
          return;
        }
        const { nextFull, delta } = appendStreamText(fullText, candidate);
        fullText = nextFull;
        if (delta) {
          req.onDelta(delta);
        }
      },
      req.signal,
    );
    return fullText;
  };

  if (looksJson) {
    const parsed = await parseJsonFromResponse(res);
    if (parsed.text) {
      emitFullOnce(parsed.text);
      return { text: parsed.text, raw: parsed.raw };
    }
    if (fallback) {
      const streamed = await consumeSse(fallback);
      return { text: streamed };
    }
    return { text: "" };
  }

  const streamed = await consumeSse(res);
  if (streamed) {
    return { text: streamed };
  }
  if (fallback) {
    try {
      const parsed = await parseJsonFromResponse(fallback);
      if (parsed.text) {
        emitFullOnce(parsed.text);
        return { text: parsed.text, raw: parsed.raw };
      }
    } catch {
      // ignore
    }
  }

  return { text: "" };
}

export async function openaiCompatibleStream(
  req: LLMStreamRequest,
): Promise<LLMCompleteResult> {
  const endpoints = getOpenAICompatibleChatCompletionsEndpoints(
    req.profile.baseURL || "",
  );
  const docs = Array.isArray(req.documents) ? req.documents : [];
  const images = Array.isArray(req.images) ? req.images : [];
  const wantsDocs = docs.length > 0;

  const buildPayload = (userContent: any) => ({
    model: req.profile.model,
    messages: [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: userContent },
    ],
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxOutputTokens ?? 1200,
    stream: true,
    ...getOpenAICompatibleExtraBody(req.profile),
  });

  const send = async (payload: any): Promise<Response> => {
    let res: Response;
    try {
      ({ res } = await fetchOpenAICompatibleWithFallback({
        endpoints,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${req.apiKey}`,
          },
          body: JSON.stringify(payload),
        },
        signal: req.signal,
      }));
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      throw new LLMError(`Network error: ${String(err)}`, {
        code: "network",
        provider: req.profile.provider,
      });
    }
    return res;
  };

  if (wantsDocs) {
    if (isMoonshotProfile(req.profile)) {
      const fileIds = await uploadOpenAICompatibleFiles({
        profile: req.profile,
        apiKey: req.apiKey,
        documents: docs,
        signal: req.signal,
      });
      const extracted = await Promise.all(
        fileIds.map((id) =>
          fetchOpenAICompatibleFileExtractContent({
            profile: req.profile,
            apiKey: req.apiKey,
            fileId: id,
            signal: req.signal,
          }),
        ),
      );

      const payload = {
        model: req.profile.model,
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          ...extracted.map((text, i) => ({
            role: "system",
            content: buildMoonshotFileExtractSystemMessageContent({
              filename: docs[i]?.filename,
              extractedText: text,
            }),
          })),
          { role: "user", content: req.user },
        ],
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxOutputTokens ?? 1200,
        stream: true,
        ...getOpenAICompatibleExtraBody(req.profile),
      };

      const res = await send(payload);
      if (!res.ok) {
        const classification = classifyHttpStatus(res.status);
        if (
          classification.code === "unauthorized" ||
          classification.code === "forbidden" ||
          classification.code === "rate_limited"
        ) {
          const data = await readResponseJsonSafe(res);
          const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
          throw new LLMError(msg, {
            code: classification.code,
            status: res.status,
            provider: req.profile.provider,
          });
        }

        const result = await openaiCompatibleComplete(req);
        if (result.text) req.onDelta(result.text);
        return result;
      }

      return await consumeOpenAICompatibleStreamResponse(req, res);
    }

    let res = await send(
      buildPayload([
        ...docs.map((d) => ({
          type: "input_file",
          file_data: `data:${d.mimeType};base64,${d.data}`,
        })),
        { type: "text", text: req.user },
      ]),
    );

    if (!res.ok) {
      const classification = classifyHttpStatus(res.status);
      // Auth/rate-limit errors won't be fixed by retries.
      if (
        classification.code === "unauthorized" ||
        classification.code === "forbidden" ||
        classification.code === "rate_limited"
      ) {
        const data = await readResponseJsonSafe(res);
        const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
        throw new LLMError(msg, {
          code: classification.code,
          status: res.status,
          provider: req.profile.provider,
        });
      }

      // Some servers reject inline `file_data`; try /files + file_id instead.
      if (
        res.status === 400 ||
        res.status === 413 ||
        res.status === 415 ||
        res.status === 422
      ) {
        try {
          const fileIds = await uploadOpenAICompatibleFiles({
            profile: req.profile,
            apiKey: req.apiKey,
            documents: docs,
            signal: req.signal,
          });
          res = await send(
            buildPayload([
              ...fileIds.map((id) => ({ type: "input_file", file_id: id })),
              { type: "text", text: req.user },
            ]),
          );
        } catch {
          // ignore and fall back below
        }
      }

      if (!res.ok) {
        // Fall back to non-stream (best-effort compatibility across vendors).
        const result = await openaiCompatibleComplete(req);
        if (result.text) req.onDelta(result.text);
        return result;
      }
    }

    return await consumeOpenAICompatibleStreamResponse(req, res);
  }

  const userContent =
    images.length > 0
      ? [
          ...images.map((img) => ({
            type: "image_url",
            image_url: {
              url: `data:${img.mimeType};base64,${img.data}`,
            },
          })),
          { type: "text", text: req.user },
        ]
      : req.user;
  const res = await send(buildPayload(userContent));
  if (!res.ok) {
    const data = await readResponseJsonSafe(res);
    const msg = tryGetErrorMessage(data) || `HTTP ${res.status}`;
    const classification = classifyHttpStatus(res.status);
    throw new LLMError(msg, {
      code: classification.code,
      status: res.status,
      provider: req.profile.provider,
    });
  }

  return await consumeOpenAICompatibleStreamResponse(req, res);
}
