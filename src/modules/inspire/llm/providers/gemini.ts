import type { LLMCompleteRequest, LLMCompleteResult, LLMStreamRequest } from "../types";
import { LLMError } from "../types";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function normalizeGeminiEndpoint(model: string, baseURL?: string): string {
  const raw = String(baseURL || "").trim();
  const base = raw ? trimSlash(raw) : DEFAULT_GEMINI_BASE_URL;
  const safeModel = String(model || "gemini-1.5-flash").trim();
  // v1beta is the most widely available in the wild for API key auth.
  return `${base}/v1beta/models/${encodeURIComponent(safeModel)}:generateContent`;
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

export async function geminiComplete(req: LLMCompleteRequest): Promise<LLMCompleteResult> {
  const endpoint = normalizeGeminiEndpoint(req.profile.model, req.profile.baseURL);
  const payload = {
    ...(req.system
      ? { systemInstruction: { parts: [{ text: req.system }] } }
      : {}),
    contents: [{ role: "user", parts: [{ text: req.user }] }],
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
  return { text: extractGeminiText(data), raw: data };
}

// Gemini streaming requires a different endpoint (:streamGenerateContent). For now, fall back.
export async function geminiStream(req: LLMStreamRequest): Promise<LLMCompleteResult> {
  return geminiComplete(req);
}

