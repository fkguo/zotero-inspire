import type { LLMCompleteRequest, LLMCompleteResult, LLMStreamRequest } from "../types";
import { LLMError } from "../types";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function normalizeAnthropicEndpoint(baseURL?: string): string {
  const raw = String(baseURL || "").trim();
  const base = raw ? trimSlash(raw) : DEFAULT_ANTHROPIC_BASE_URL;
  if (/\/v1\/messages$/i.test(base)) return base;
  return `${base}/v1/messages`;
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

function extractAnthropicText(payload: unknown): string {
  const content = Array.isArray((payload as any)?.content)
    ? ((payload as any).content as any[])
    : [];
  const parts = content
    .map((p) => (p?.type === "text" ? p?.text : ""))
    .filter((s) => typeof s === "string" && s);
  return parts.join("");
}

export async function anthropicComplete(req: LLMCompleteRequest): Promise<LLMCompleteResult> {
  const endpoint = normalizeAnthropicEndpoint(req.profile.baseURL);
  const payload = {
    model: req.profile.model,
    max_tokens: req.maxOutputTokens ?? 1200,
    temperature: req.temperature ?? 0.2,
    ...(req.system ? { system: req.system } : {}),
    messages: [{ role: "user", content: req.user }],
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": req.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
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
  const usage = (data as any)?.usage;
  const inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
  const totalTokens =
    typeof usage?.total_tokens === "number"
      ? usage.total_tokens
      : typeof inputTokens === "number" && typeof outputTokens === "number"
        ? inputTokens + outputTokens
        : undefined;

  return {
    text: extractAnthropicText(data),
    usage:
      typeof inputTokens === "number" || typeof outputTokens === "number" || typeof totalTokens === "number"
        ? { inputTokens, outputTokens, totalTokens }
        : undefined,
    raw: data,
  };
}

// Optional: streaming support (SSE). Not all environments/providers support readable streams.
export async function anthropicStream(req: LLMStreamRequest): Promise<LLMCompleteResult> {
  const endpoint = normalizeAnthropicEndpoint(req.profile.baseURL);
  const payload = {
    model: req.profile.model,
    max_tokens: req.maxOutputTokens ?? 1200,
    temperature: req.temperature ?? 0.2,
    stream: true,
    ...(req.system ? { system: req.system } : {}),
    messages: [{ role: "user", content: req.user }],
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": req.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
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

  const body = res.body as any;
  if (!body || typeof body.getReader !== "function") {
    // Fall back to non-stream.
    return anthropicComplete(req);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const deltaText = parsed?.delta?.text ?? parsed?.content_block?.text ?? null;
      if (typeof deltaText === "string" && deltaText) {
        fullText += deltaText;
        req.onDelta(deltaText);
      }
      const type = parsed?.type;
      if (type === "message_stop") {
        // Done.
        break;
      }
    }
  }

  return { text: fullText };
}
