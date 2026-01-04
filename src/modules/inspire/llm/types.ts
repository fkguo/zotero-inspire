import type { AIProfile, AIProviderId } from "./profileStore";

export type { AIProfile, AIProviderId };

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LLMCompleteRequest {
  profile: AIProfile;
  apiKey: string;
  system?: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * When true, the caller expects a JSON string.
   * Providers should NOT rely on vendor-specific response_format for compatibility.
   */
  expectJson?: boolean;
  signal?: AbortSignal;
}

export interface LLMStreamRequest extends LLMCompleteRequest {
  onDelta: (deltaText: string) => void;
}

export interface LLMCompleteResult {
  text: string;
  usage?: LLMUsage;
  /** Provider-specific raw payload (best-effort). Avoid persisting sensitive data. */
  raw?: unknown;
}

export type LLMErrorCode =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "timeout"
  | "network"
  | "bad_request"
  | "server_error"
  | "unknown";

export class LLMError extends Error {
  code: LLMErrorCode;
  status?: number;
  provider?: AIProviderId;

  constructor(message: string, options?: { code?: LLMErrorCode; status?: number; provider?: AIProviderId }) {
    super(message);
    this.name = "LLMError";
    this.code = options?.code ?? "unknown";
    this.status = options?.status;
    this.provider = options?.provider;
  }
}

