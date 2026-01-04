import type { AIProfile } from "./profileStore";
import type { LLMCompleteRequest, LLMCompleteResult, LLMStreamRequest } from "./types";
import { LLMError } from "./types";
import { openaiCompatibleComplete, openaiCompatibleStream } from "./providers/openaiCompatible";
import { anthropicComplete, anthropicStream } from "./providers/anthropic";
import { geminiComplete, geminiStream } from "./providers/gemini";

export function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as any).name === "AbortError"
  );
}

export async function llmComplete(req: LLMCompleteRequest): Promise<LLMCompleteResult> {
  switch (req.profile.provider) {
    case "openaiCompatible":
      return openaiCompatibleComplete(req);
    case "anthropic":
      return anthropicComplete(req);
    case "gemini":
      return geminiComplete(req);
    default:
      throw new LLMError("Unsupported provider", { code: "unknown" });
  }
}

export async function llmStream(req: LLMStreamRequest): Promise<LLMCompleteResult> {
  switch (req.profile.provider) {
    case "openaiCompatible":
      return openaiCompatibleStream(req);
    case "anthropic":
      return anthropicStream(req);
    case "gemini":
      return geminiStream(req);
    default:
      throw new LLMError("Unsupported provider", { code: "unknown" });
  }
}

export async function testLLMConnection(options: {
  profile: AIProfile;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; message: string }> {
  const { profile, apiKey, signal } = options;
  try {
    const result = await llmComplete({
      profile,
      apiKey,
      system: "You are a connectivity test. Reply with exactly: OK",
      user: "OK",
      temperature: 0,
      maxOutputTokens: 16,
      signal,
    });
    const text = (result.text || "").trim();
    return { ok: true, message: text ? `OK: ${text}` : "OK" };
  } catch (err: any) {
    if (isAbortError(err)) {
      return { ok: false, message: "Cancelled" };
    }
    if (err instanceof LLMError) {
      const status = typeof err.status === "number" ? ` (HTTP ${err.status})` : "";
      return { ok: false, message: `${err.code}${status}: ${err.message}` };
    }
    return { ok: false, message: String(err) };
  }
}

