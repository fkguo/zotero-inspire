import { getPref, setPref } from "../../../utils/prefs";

export type AIPromptOutputFormat = "markdown" | "json";

export type AIPromptContextScope =
  | "summary"
  | "recommend"
  | "followup"
  | "inspireQuery";

export interface AIPromptTemplate {
  id: string;
  name: string;
  scope: AIPromptContextScope;
  output: AIPromptOutputFormat;
  /** User prompt, supports placeholders like {seedTitle}. */
  prompt: string;
  /** Optional system prompt override (advanced). */
  system?: string;
  createdAt: number;
  updatedAt?: number;
}

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

function normalizeScope(value: unknown): AIPromptContextScope | null {
  if (value === "summary") return "summary";
  if (value === "recommend") return "recommend";
  if (value === "followup") return "followup";
  if (value === "inspireQuery") return "inspireQuery";
  return null;
}

function normalizeOutput(value: unknown): AIPromptOutputFormat | null {
  if (value === "markdown") return "markdown";
  if (value === "json") return "json";
  return null;
}

function normalizeTemplate(input: unknown): AIPromptTemplate | null {
  const obj = input as Partial<AIPromptTemplate>;
  const id = isNonEmptyString(obj?.id) ? obj.id.trim() : null;
  const name = isNonEmptyString(obj?.name) ? obj.name.trim() : null;
  const scope = normalizeScope(obj?.scope);
  const output = normalizeOutput(obj?.output);
  const prompt = isNonEmptyString(obj?.prompt) ? obj.prompt : null;
  const createdAt =
    typeof obj?.createdAt === "number" && Number.isFinite(obj.createdAt)
      ? obj.createdAt
      : Date.now();

  if (!id || !name || !scope || !output || !prompt) return null;

  const system =
    typeof obj?.system === "string" ? obj.system.trim() || undefined : undefined;
  const updatedAt =
    typeof obj?.updatedAt === "number" && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : undefined;

  return { id, name, scope, output, prompt, system, createdAt, updatedAt };
}

export function createTemplateId(prefix = "tpl"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function getUserPromptTemplatesRaw(): string {
  return (getPref("ai_prompt_templates") || "[]") as unknown as string;
}

export function getUserPromptTemplates(): AIPromptTemplate[] {
  const parsed = safeJsonParse(getUserPromptTemplatesRaw());
  if (!Array.isArray(parsed)) return [];
  const out: AIPromptTemplate[] = [];
  for (const t of parsed) {
    const normalized = normalizeTemplate(t);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function setUserPromptTemplates(templates: AIPromptTemplate[]): void {
  setPref("ai_prompt_templates", JSON.stringify(Array.isArray(templates) ? templates : []));
}

export function upsertUserPromptTemplate(tpl: AIPromptTemplate): AIPromptTemplate[] {
  const list = getUserPromptTemplates();
  const next = normalizeTemplate(tpl);
  if (!next) return list;
  const idx = list.findIndex((t) => t.id === next.id);
  const updated: AIPromptTemplate = { ...next, updatedAt: Date.now() };
  if (idx >= 0) list[idx] = updated;
  else list.push(updated);
  setUserPromptTemplates(list);
  return list;
}

export function deleteUserPromptTemplate(templateId: string): AIPromptTemplate[] {
  const list = getUserPromptTemplates();
  const filtered = list.filter((t) => t.id !== templateId);
  setUserPromptTemplates(filtered);
  return filtered;
}

export const BUILTIN_PROMPT_TEMPLATES: AIPromptTemplate[] = [
  {
    id: "builtin_summary_review",
    name: "Literature Review Summary (Markdown)",
    scope: "summary",
    output: "markdown",
    prompt:
      "Generate a literature review summary for the seed paper and its references. Follow the fixed Markdown sections (Common Themes, Key Papers, Outline, Notes). Use cite anchors (prefer texkey, else recid). Language: {outputLanguage}. Style: {style}. User goal: {userGoal}.",
    createdAt: 0,
  },
  {
    id: "builtin_inspire_query_expand",
    name: "Generate INSPIRE Queries (Expansion)",
    scope: "inspireQuery",
    output: "json",
    prompt:
      "Given the seed paper and a list of references, generate 3-8 INSPIRE-HEP search queries to find related papers beyond the citation network. Return STRICT JSON: {\"queries\":[{\"intent\":\"...\",\"query\":\"...\"}]} . User goal: {userGoal}. Prefer recent years if relevant.",
    createdAt: 0,
  },
  {
    id: "builtin_recommend_rerank",
    name: "Grounded Rerank + Group (JSON)",
    scope: "recommend",
    output: "json",
    prompt:
      "You are given a candidate set of papers with recid/texkey and metadata. Group them into 3-8 topical groups and select the best items per group. Return STRICT JSON: {\"groups\":[{\"name\":\"...\",\"items\":[{\"recid\":\"...\",\"texkey\":\"...\",\"reason\":\"1-2 sentences\"}]}],\"notes\":[\"...\"]}. Only use recid/texkey that appear in the candidates.",
    createdAt: 0,
  },
];

