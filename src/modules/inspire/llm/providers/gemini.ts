import type {
  LLMCompleteRequest,
  LLMCompleteResult,
  LLMStreamRequest,
} from "../types";
import { LLMError } from "../types";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function normalizeGeminiEndpoint(
  model: string,
  baseURL?: string,
): string {
  const raw = String(baseURL || "").trim();
  const base = (() => {
    if (!raw) return DEFAULT_GEMINI_BASE_URL;
    if (/^https?:\/\//i.test(raw)) return trimSlash(raw);
    throw new LLMError(
      "Invalid base URL (must start with http:// or https://)",
      { code: "bad_request", provider: "gemini" },
    );
  })();
  const safeModel = String(model || "gemini-1.5-flash").trim();
  // v1beta is the most widely available in the wild for API key auth.
  return `${base}/v1beta/models/${encodeURIComponent(safeModel)}:generateContent`;
}

export function normalizeGeminiStreamEndpoint(
  model: string,
  baseURL?: string,
): string {
  const raw = String(baseURL || "").trim();
  const base = (() => {
    if (!raw) return DEFAULT_GEMINI_BASE_URL;
    if (/^https?:\/\//i.test(raw)) return trimSlash(raw);
    throw new LLMError(
      "Invalid base URL (must start with http:// or https://)",
      { code: "bad_request", provider: "gemini" },
    );
  })();
  const safeModel = String(model || "gemini-1.5-flash").trim();
  // SSE streaming is enabled via alt=sse.
  return `${base}/v1beta/models/${encodeURIComponent(safeModel)}:streamGenerateContent?alt=sse`;
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

function tryGetErrorMessage(payload: unknown): string | null {
  const msg =
    (payload as any)?.error?.message ??
    (payload as any)?.message ??
    (payload as any)?.detail ??
    null;
  return typeof msg === "string" && msg.trim() ? msg.trim() : null;
}

function extractGeminiText(payload: unknown): string {
  const candidates = Array.isArray((payload as any)?.candidates)
    ? ((payload as any).candidates as any[])
    : [];
  const first = candidates[0] ?? null;
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const texts = parts
    .map((p: any) => p?.text)
    .filter((t: any) => typeof t === "string" && t);
  return texts.join("");
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
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      onDataLine(data);
    }
  }
}

export async function geminiComplete(
  req: LLMCompleteRequest,
): Promise<LLMCompleteResult> {
  const endpoint = normalizeGeminiEndpoint(
    req.profile.model,
    req.profile.baseURL,
  );
  const docs = Array.isArray(req.documents) ? req.documents : [];
  const images = Array.isArray(req.images) ? req.images : [];
  const payload = {
    ...(req.system
      ? { systemInstruction: { parts: [{ text: req.system }] } }
      : {}),
    contents: [
      {
        role: "user",
        parts: [
          ...images.map((img) => ({
            inline_data: {
              mime_type: img.mimeType,
              data: img.data,
            },
          })),
          ...docs.map((d) => ({
            inline_data: {
              mime_type: d.mimeType,
              data: d.data,
            },
          })),
          { text: req.user },
        ],
      },
    ],
    generationConfig: {
      temperature: req.temperature ?? 0.2,
      maxOutputTokens: req.maxOutputTokens ?? 1200,
    },
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": req.apiKey,
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });
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
  const usage = (data as any)?.usageMetadata;
  const inputTokens =
    typeof usage?.promptTokenCount === "number"
      ? usage.promptTokenCount
      : undefined;
  const outputTokens =
    typeof usage?.candidatesTokenCount === "number"
      ? usage.candidatesTokenCount
      : undefined;
  const totalTokens =
    typeof usage?.totalTokenCount === "number"
      ? usage.totalTokenCount
      : typeof inputTokens === "number" && typeof outputTokens === "number"
        ? inputTokens + outputTokens
        : undefined;

  return {
    text: extractGeminiText(data),
    usage:
      typeof inputTokens === "number" ||
      typeof outputTokens === "number" ||
      typeof totalTokens === "number"
        ? { inputTokens, outputTokens, totalTokens }
        : undefined,
    raw: data,
  };
}

export async function geminiStream(
  req: LLMStreamRequest,
): Promise<LLMCompleteResult> {
  const endpoint = normalizeGeminiStreamEndpoint(
    req.profile.model,
    req.profile.baseURL,
  );
  const docs = Array.isArray(req.documents) ? req.documents : [];
  const images = Array.isArray(req.images) ? req.images : [];
  const payload = {
    ...(req.system
      ? { systemInstruction: { parts: [{ text: req.system }] } }
      : {}),
    contents: [
      {
        role: "user",
        parts: [
          ...images.map((img) => ({
            inline_data: {
              mime_type: img.mimeType,
              data: img.data,
            },
          })),
          ...docs.map((d) => ({
            inline_data: {
              mime_type: d.mimeType,
              data: d.data,
            },
          })),
          { text: req.user },
        ],
      },
    ],
    generationConfig: {
      temperature: req.temperature ?? 0.2,
      maxOutputTokens: req.maxOutputTokens ?? 1200,
    },
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": req.apiKey,
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });
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

  let fullText = "";

  try {
    await streamSseText(
      res,
      (data) => {
        if (data === "[DONE]") {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        const next = extractGeminiText(parsed);
        if (!next) return;
        const delta = next.startsWith(fullText)
          ? next.slice(fullText.length)
          : next;
        if (!delta) return;
        fullText += delta;
        req.onDelta(delta);
      },
      req.signal,
    );
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    // If streams are unavailable in this runtime, fall back to non-stream call.
    if (
      err instanceof LLMError &&
      err.message === "Streaming not supported in this environment"
    ) {
      return geminiComplete(req);
    }
    throw err;
  }

  return { text: fullText };
}
