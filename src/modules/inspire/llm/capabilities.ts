import type { AIProfile } from "./profileStore";

/**
 * Check if the given AI profile supports direct PDF upload.
 * Currently supported (best-effort):
 * - Gemini (inline_data)
 * - Anthropic Claude (documents)
 * - OpenAI-compatible (depends on endpoint/model capabilities)
 */
export function profileSupportsPdfUpload(profile: AIProfile): boolean {
  const provider = String(profile.provider || "").toLowerCase();
  const baseURL = String(profile.baseURL || "").toLowerCase();
  const preset = String(profile.preset || "").toLowerCase();
  const model = String(profile.model || "").toLowerCase();

  // DeepSeek's OpenAI-compatible endpoint is text-only (no PDF/document attachments).
  if (
    provider === "openaicompatible" &&
    (preset === "deepseek" ||
      model.startsWith("deepseek") ||
      baseURL.includes("deepseek"))
  ) {
    return false;
  }

  return (
    provider === "gemini" ||
    provider === "anthropic" ||
    provider === "openaicompatible"
  );
}

/**
 * Best-effort check for whether the current profile/model supports image input.
 * This is heuristic: vendors vary widely in model naming and capability flags.
 */
export function profileSupportsImageInput(profile: AIProfile): boolean {
  const provider = String(profile.provider || "").toLowerCase();
  const baseURL = String(profile.baseURL || "").toLowerCase();
  const preset = String(profile.preset || "").toLowerCase();
  const model = String(profile.model || "").toLowerCase();

  if (provider === "gemini") return true;

  if (provider === "anthropic") {
    // Claude 3+ supports vision; older models generally do not.
    return (
      model.includes("claude-3") ||
      model.includes("claude-3.5") ||
      model.includes("claude-4") ||
      /\bclaude[-_ ]?(3|4)\b/i.test(profile.model)
    );
  }

  if (provider === "openaicompatible") {
    // DeepSeek OpenAI-compatible models are text-only.
    if (
      preset === "deepseek" ||
      model.startsWith("deepseek") ||
      baseURL.includes("deepseek")
    ) {
      return false;
    }

    const rawModel = String(profile.model || "");
    const hasVl =
      /(^|[^a-z0-9])vl([^a-z0-9]|$)/i.test(rawModel) ||
      /-vl/i.test(rawModel) ||
      /vl-/i.test(rawModel);

    return (
      model.includes("gpt-4o") ||
      model.includes("gpt-4.1") ||
      model.includes("gpt-4-turbo") ||
      model.includes("gpt-4-vision") ||
      model.includes("vision") ||
      hasVl ||
      model.includes("llava") ||
      model.includes("pixtral") ||
      model.includes("glm-4v") ||
      model.includes("glm-4.1v") ||
      model.includes("qwen-vl")
    );
  }

  return false;
}

