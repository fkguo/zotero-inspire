import { getPref, setPref } from "../../../utils/prefs";

export type AIProviderId = "openaiCompatible" | "anthropic" | "gemini";

export interface AIProfile {
  id: string;
  name: string;
  provider: AIProviderId;
  /** Base URL for OpenAI-compatible APIs (or proxy). */
  baseURL?: string;
  /** Model id/name understood by the provider. */
  model: string;
  /** Optional preset identifier for UI defaults. */
  preset?: string;
  createdAt: number;
  updatedAt?: number;
}

export type AIProfilePresetId =
  | "openai"
  | "claude"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "qwen"
  | "bailian"
  | "zhipu"
  | "doubao"
  | "siliconflow"
  | "ollama"
  | "lmstudio"
  | "custom";

export const AI_PROFILE_PRESETS: Array<{
  id: AIProfilePresetId;
  label: string;
  provider: AIProviderId;
  baseURL?: string;
  defaultModel: string;
}> = [
  {
    id: "openai",
    label: "OpenAI",
    provider: "openaiCompatible",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "claude",
    label: "Claude / Anthropic",
    provider: "anthropic",
    baseURL: "https://api.anthropic.com",
    defaultModel: "claude-3-5-sonnet-latest",
  },
  {
    id: "gemini",
    label: "Gemini",
    provider: "gemini",
    baseURL: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-1.5-flash",
  },
  {
    id: "deepseek",
    label: "DeepSeek (OpenAI-compatible)",
    provider: "openaiCompatible",
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  {
    id: "kimi",
    label: "Kimi / Moonshot (OpenAI-compatible)",
    provider: "openaiCompatible",
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
  },
  {
    id: "qwen",
    label: "Qwen / DashScope (OpenAI-compatible)",
    provider: "openaiCompatible",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-turbo",
  },
  {
    id: "bailian",
    label: "Bailian / Aliyun (OpenAI-compatible)",
    provider: "openaiCompatible",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-max",
  },
  {
    id: "zhipu",
    label: "Zhipu (try OpenAI-compatible / proxy)",
    provider: "openaiCompatible",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
  },
  {
    id: "doubao",
    label: "Doubao / Volcengine Ark (OpenAI-compatible)",
    provider: "openaiCompatible",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-pro-32k",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow (OpenAI-compatible)",
    provider: "openaiCompatible",
    baseURL: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
  },
  {
    id: "ollama",
    label: "Ollama (local, OpenAI-compatible)",
    provider: "openaiCompatible",
    baseURL: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local, OpenAI-compatible)",
    provider: "openaiCompatible",
    baseURL: "http://localhost:1234/v1",
    defaultModel: "local-model",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    provider: "openaiCompatible",
    baseURL: "",
    defaultModel: "gpt-4o-mini",
  },
];

function safeJsonParse(raw: string): unknown {
  if (!raw || raw === "[]") return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeProvider(value: unknown): AIProviderId | null {
  if (value === "openaiCompatible") return "openaiCompatible";
  if (value === "anthropic") return "anthropic";
  if (value === "gemini") return "gemini";
  return null;
}

function normalizeProfile(input: unknown): AIProfile | null {
  const obj = input as Partial<AIProfile>;
  const id = isNonEmptyString(obj?.id) ? obj.id.trim() : null;
  const name = isNonEmptyString(obj?.name) ? obj.name.trim() : null;
  const provider = normalizeProvider(obj?.provider);
  const model = isNonEmptyString(obj?.model) ? obj.model.trim() : null;
  const createdAt =
    typeof obj?.createdAt === "number" && Number.isFinite(obj.createdAt)
      ? obj.createdAt
      : Date.now();

  if (!id || !name || !provider || !model) return null;

  const baseURL =
    typeof obj?.baseURL === "string"
      ? obj.baseURL.trim() || undefined
      : undefined;
  const preset =
    typeof obj?.preset === "string"
      ? obj.preset.trim() || undefined
      : undefined;
  const updatedAt =
    typeof obj?.updatedAt === "number" && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : undefined;

  return {
    id,
    name,
    provider,
    baseURL,
    model,
    preset,
    createdAt,
    updatedAt,
  };
}

export function createAIProfileId(prefix = "ai"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function getAIProfilesRaw(): string {
  return (getPref("ai_profiles") || "[]") as unknown as string;
}

export function getAIProfiles(): AIProfile[] {
  const parsed = safeJsonParse(getAIProfilesRaw());
  if (!Array.isArray(parsed)) return [];
  const out: AIProfile[] = [];
  for (const entry of parsed) {
    const normalized = normalizeProfile(entry);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function setAIProfiles(profiles: AIProfile[]): void {
  const safe = Array.isArray(profiles) ? profiles : [];
  setPref("ai_profiles", JSON.stringify(safe));
}

export function getActiveAIProfileId(): string {
  return (getPref("ai_active_profile_id") || "") as unknown as string;
}

export function setActiveAIProfileId(id: string): void {
  setPref("ai_active_profile_id", String(id || ""));
}

function buildDefaultProfileFromLegacyPrefs(): AIProfile | null {
  try {
    const legacyProvider = normalizeProvider(getPref("ai_summary_provider"));
    const legacyModelRaw = getPref("ai_summary_model");
    const legacyModel = isNonEmptyString(legacyModelRaw)
      ? legacyModelRaw
      : null;

    if (!legacyProvider || !legacyModel) return null;

    const legacyPreset = String(getPref("ai_summary_preset") || "").trim();
    const legacyBaseURL = String(getPref("ai_summary_base_url") || "").trim();

    return {
      id: createAIProfileId("legacy"),
      name: legacyPreset ? `Legacy: ${legacyPreset}` : "Legacy",
      provider: legacyProvider,
      baseURL: legacyBaseURL || undefined,
      model: legacyModel,
      preset: legacyPreset || undefined,
      createdAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function buildDefaultOpenAIProfile(): AIProfile {
  const preset = AI_PROFILE_PRESETS.find((p) => p.id === "openai")!;
  return {
    id: createAIProfileId("default"),
    name: preset.label,
    provider: preset.provider,
    baseURL: preset.baseURL,
    model: preset.defaultModel,
    preset: preset.id,
    createdAt: Date.now(),
  };
}

export function ensureAIProfilesInitialized(): AIProfile[] {
  const existing = getAIProfiles();
  if (existing.length) {
    return existing;
  }

  const legacy = buildDefaultProfileFromLegacyPrefs();
  const initial = legacy ? [legacy] : [buildDefaultOpenAIProfile()];
  setAIProfiles(initial);
  setActiveAIProfileId(initial[0]?.id || "");
  return initial;
}

export function getActiveAIProfile(): AIProfile {
  const profiles = ensureAIProfilesInitialized();
  const activeId = getActiveAIProfileId();
  const match = activeId ? profiles.find((p) => p.id === activeId) : undefined;
  return match ?? profiles[0] ?? buildDefaultOpenAIProfile();
}

export function upsertAIProfile(profile: AIProfile): AIProfile[] {
  const profiles = ensureAIProfilesInitialized();
  const next = normalizeProfile(profile) ?? null;
  if (!next) return profiles;

  const idx = profiles.findIndex((p) => p.id === next.id);
  const updated: AIProfile = { ...next, updatedAt: Date.now() };
  if (idx >= 0) {
    profiles[idx] = updated;
  } else {
    profiles.push(updated);
  }
  setAIProfiles(profiles);
  return profiles;
}

export function deleteAIProfile(profileId: string): AIProfile[] {
  const profiles = ensureAIProfilesInitialized();
  const filtered = profiles.filter((p) => p.id !== profileId);
  const next = filtered.length ? filtered : [buildDefaultOpenAIProfile()];
  setAIProfiles(next);
  const active = getActiveAIProfileId();
  if (active === profileId) {
    setActiveAIProfileId(next[0]?.id || "");
  }
  return next;
}
