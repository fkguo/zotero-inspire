import type { LLMCompleteRequest, LLMCompleteResult, LLMStreamRequest } from "../types";
import { LLMError } from "../types";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function normalizeOpenAICompatibleEndpoint(baseURL: string): string {
  const raw = String(baseURL || "").trim();
  if (!raw) {
    return "https://api.openai.com/v1/chat/completions";
  }
  const cleaned = trimSlash(raw);
  if (/\/chat\/completions$/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}/chat/completions`;
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
  const msg =
    (payload as any)?.error?.message ??
    (payload as any)?.message ??
    (payload as any)?.detail ??
    null;
  return typeof msg === "string" && msg.trim() ? msg.trim() : null;
}

function extractTextFromChatCompletions(payload: unknown): { text: string; usage?: any } {
  const choices = Array.isArray((payload as any)?.choices)
    ? ((payload as any).choices as any[])
    : [];
  const first = choices[0] ?? null;
  const content =
    first?.message?.content ??
    first?.text ??
    first?.delta?.content ??
    "";
  const text = typeof content === "string" ? content : String(content || "");
  const usage = (payload as any)?.usage;
  return { text, usage };
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

export async function openaiCompatibleComplete(
  req: LLMCompleteRequest,
): Promise<LLMCompleteResult> {
  const endpoint = normalizeOpenAICompatibleEndpoint(req.profile.baseURL || "");
  const payload = {
    model: req.profile.model,
    messages: [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: req.user },
    ],
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxOutputTokens ?? 1200,
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey}`,
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
  const { text, usage } = extractTextFromChatCompletions(data);
  return {
    text,
    usage: usage
      ? {
          inputTokens: usage?.prompt_tokens,
          outputTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens,
        }
      : undefined,
    raw: data,
  };
}

export async function openaiCompatibleStream(
  req: LLMStreamRequest,
): Promise<LLMCompleteResult> {
  const endpoint = normalizeOpenAICompatibleEndpoint(req.profile.baseURL || "");
  const payload = {
    model: req.profile.model,
    messages: [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: req.user },
    ],
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxOutputTokens ?? 1200,
    stream: true,
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey}`,
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
  await streamSseText(
    res,
    (data) => {
      if (data === "[DONE]") {
        return;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        fullText += delta;
        req.onDelta(delta);
      }
    },
    req.signal,
  );

  return { text: fullText };
}

