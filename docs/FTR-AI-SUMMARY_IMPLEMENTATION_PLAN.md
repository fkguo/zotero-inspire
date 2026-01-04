# FTR-AI-SUMMARY 实现方案（多 Provider LLM：OpenAI / Claude / Gemini / OpenAI-Compatible / 国内模型）

> 需求来源：规划文档 `FUTURE_IMPROVEMENTS.md` 的 `FTR-AI-SUMMARY`（AI 生成参考文献列表摘要：共同主题、关键论文、综述大纲；依赖 INSPIRE 摘要 + 外部 LLM API）。

---

## 实现状态与调研（截至 2026-01-04）

> Status: Implemented（本文档元信息/调研记录）

> 本文档已按“已实现 / 部分实现 / 未实现”在各节标题下标注状态，并尽量给出对应代码位置/commit（当前分支：`investigate-ai-summary`）。

状态标记：

- **Implemented**：已在代码中落地
- **Partial**：部分落地或存在明确缺口
- **Planned**：未落地（建议/待做）

本次联网调研（模型现状 & MCP）参考：

- DeepSeek Models & Pricing：`https://api-docs.deepseek.com/quick_start/pricing`
- Google Gemini model list：`https://ai.google.dev/gemini-api/docs/models/gemini`
- Moonshot 文档（JS bundle 内含模型名）：`https://platform.moonshot.cn/docs/api-reference`
- Zhipu Open Platform（JS bundle 内含模型名）：`https://open.bigmodel.cn/dev/api`
- Mistral 模型列表：`https://docs.mistral.ai/getting-started/models/`
- MCP 架构与传输层（STDIO / Streamable HTTP）：`https://modelcontextprotocol.io/docs/learn/architecture`

## 1. 目标与边界

> Status: Implemented（当前实现已覆盖 MVP：Summary/Recommend/My Notes + 多 provider + streaming + 采样/截断 + 导出；仍保持“非目标”不扩张为全文 RAG）。

### 1.1 目标（MVP）

> Status: Implemented（已支持对 seed + references 生成 summary / outline，并支持 recommend 与导出/保存）。

对**当前选中论文**的 References Panel 中“参考文献列表（References）”生成一份可直接使用的文献综述摘要，包含：

1. **共同主题**：3–7 个主题方向，每个主题给出代表性条目（可点击/可追溯）。
2. **关键论文识别**：按“奠基/方法/综述/高影响”等类型列出 5–15 篇并给出理由（基于已提供信息）。
3. **综述大纲**：输出一份“可直接写综述”的目录结构（含每节要点）。

### 1.2 非目标（暂不做）

> Status: Partial（当前仍未做全文 RAG/自动下载；但已新增“AI recommend/query expansion”，属于可控扩展）。

- 暂不做“语义搜索/全文 RAG/自动下载全文”。
- （注）这并不否定“全文能力”的价值：更适合放到证据优先的流水线（例如 `hep-research-mcp`）里做（PDF/LaTeX evidence + embeddings + 可复现写作），避免在 Zotero 插件内把计算与依赖膨胀到不可维护。
- 不承诺输出“严格事实性结论”（只允许基于提供条目的题录/摘要/引用数等信息）。

---

## 2. 输出规范（建议固定 Markdown 结构）

> Status: Partial（实现中强制输出固定 sections，但不强制包含“Reading Order / Suggested Queries”，这两块目前通过 Recommend/Query Expansion 另行覆盖）。

LLM 输出统一为 Markdown，便于复制到笔记/报告：

```md
## Common Themes

- Theme A: ... (代表作：\cite{texkey1}, \cite{texkey2} / [recid])
- Theme B: ...

## Key Papers (Why)

- Paper X (reason...) — \cite{texkey} / [recid]

## Literature Review Outline

1. Introduction ... (recommended refs: \cite{...}, \cite{...})
2. ...

## Suggested Reading Order (optional)

1. \cite{...} — ...
2. ...

## Suggested INSPIRE Queries (optional)

- intent: ... → inspire: t:"..." and date:2022->2026

## Notes / Limitations

- 仅基于提供的题录/摘要信息生成；不确定处已标注。
```

可选增强：要求模型在每条主题/关键论文条目末尾附带引用锚点（优先 `texkey`，否则 `recid`，再否则 title）。

---

## 3. 数据输入与成本控制

> Status: Implemented（采样/截断/摘要开关/并发补抓已落地，见 `src/modules/inspire/panel/AIDialog.ts`）。

### 3.1 输入数据来源

> Status: Implemented（已支持 seed 元信息 + references entries；seed abstract / ref abstracts 均为显式开关）。

输入应同时包含 **seed（当前论文）** 与 **references（参考文献列表）** 两部分信息：

- seed（来自 Zotero item + INSPIRE，如可用）：
  - `seedTitle`（必选）
  - `seedAbstract`（可选，受用户开关控制；主要影响 token 成本与输出质量）
  - `seedKeywords` / `inspireCategories`（如有，可选）
  - `userGoal`（用户填写：例如“写综述 Introduction/找最新实验约束”）

references：复用现有 `InspireReferenceEntry[]`（References tab 已加载的条目结构），可用字段包括：

- `title`, `authors`, `year`, `citationCount`, `documentType`
- `texkey`, `recid`, `inspireUrl`
- `abstract`（若已获取；否则可按需补抓）

### 3.2 采样与截断策略（避免 token 爆炸）

> Status: Implemented（top-cited + recent + diversity fill；abstracts 按需补抓；并有 `max_refs/abstract_char_limit` 截断）。

新增可配置偏好（建议默认值）：

- `ai_summary_max_refs`：默认 40（上限 80）
- `ai_summary_include_abstracts`：默认 `true`（在 INSPIRE/HEP 场景摘要通常公开；该开关主要用于 **token 成本/速度控制**，而不是“是否敏感”）
- `ai_summary_abstract_char_limit`：默认 800（每篇摘要最多 800 字符；需要更细节可调大到 2000+）

推荐采样算法（稳定、覆盖面更好）：

1. `top cited`：按 `citationCount` 取前 `N1`
2. `recent`：按 `year` 取最近 `N2`
3. `diversity fill`：剩余从中间段随机/均匀抽样补齐

当 `include_abstracts=true` 时，仅对最终入选的 `max_refs` 条目补抓摘要（并发限制 3–5），复用现有轻量抽象接口：

- `fetchInspireAbstract(recid)`（INSPIRE `fields=metadata.abstracts`）

#### 输出 token 上限（`max_output_tokens`）策略（关于“1200 会不会太少？”）

- 不建议“不设上限”：多数厂商本身也有上限；不设会带来 **成本不可控**、**延迟不可控**、**UI 卡顿**，并且更容易在长输出中“跑题/重复/截断”。
- 当前默认 `ai_summary_max_output_tokens=1200` 更偏向“可复制到 note 的综述摘要/提纲”，不是“全文复述”。若目标是“长综述草稿 / 多篇综合”，建议让用户显式选择更长输出档位（例如 2400/4000/8000）并给出预算提示。
- 对“全文或超多篇”更稳的做法不是单次拉长输出，而是 **分段/分批 summarization（map-reduce）**：
  1. per-paper：对每篇生成结构化摘要（固定长度 + 引用锚点）
  2. reduce：在“摘要集合”上生成主题/关键论文/大纲（可再分层）
  3. 最终：按章节输出（可选）
- 建议把 `max_output_tokens` 暴露为对话框 Options（并按 provider 做范围校验），同时在结果区展示 **token usage（若 provider 返回）或粗略估算**，让用户理解“为什么慢/为什么贵”。

#### 温度（`temperature`）策略（是否要按模型区分默认值？）

- 文献综述/提纲/grounded rerank 更适合低温度（例如 `0.0–0.3`），以减少“编造、跑题、风格漂移”，并提升结构稳定性。
- “生成 INSPIRE queries / brainstorming / 写作措辞多样化”可以更高一些（例如 `0.4–0.8`），但应与 **强约束输出（JSON schema / 候选集校验）** 搭配。
- provider 范围差异需要处理：OpenAI(-compatible) 常见范围 `0–2`；Anthropic 常见范围 `0–1`；Gemini 通常 `0–2`。实现中建议按 provider clamp，避免用户设置导致 400。
- 当前实现里 `ai_summary_temperature` 采用“百分比整数”落盘（例如 `20` 表示 `0.20`），读取时再归一化到 `0–2`（兼容 Zotero/OS 对数值 prefs 的限制）。

---

## 4. Provider 适配层设计（支持 OpenAI / Claude / Gemini / OpenAI-Compatible / 国内）

> Status: Implemented（已实现 OpenAI-Compatible + Anthropic + Gemini 三套适配；三者均支持非流式；OpenAI-Compatible/Claude/Gemini 支持流式（SSE））。

### 4.1 统一接口

> Status: Implemented（见 `src/modules/inspire/llm/types.ts` / `src/modules/inspire/llm/llmClient.ts`）。

在 `src/modules/inspire/` 下新增模块（建议）：

- `llm/types.ts`：通用类型
- `llm/providers/openaiCompatible.ts`
- `llm/providers/anthropic.ts`
- `llm/providers/gemini.ts`
- `llm/llmClient.ts`：根据偏好选择 provider

建议统一方法：

- `complete({ system, user, model, temperature, maxOutputTokens, signal }) -> { text, usage?, raw? }`

### 4.2 OpenAI-Compatible 作为“国内/网关统一入口”

> Status: Implemented（见 `src/modules/inspire/llm/providers/openaiCompatible.ts`，支持 baseURL 归一化与流式 SSE）。

策略：对 DeepSeek / Kimi /（支持兼容接口的）Qwen/智谱/自建网关等，统一走 OpenAI-compatible：

- 可配置 `baseURL`（默认 OpenAI 官方；用户可填国内厂商/网关地址）
- 可配置 `model`
- `Authorization: Bearer ${apiKey}`
- 使用 `POST /chat/completions`（兼容面最广）
- **用量解析**：若响应包含 `usage`，优先解析 `prompt_tokens / completion_tokens / total_tokens`（OpenAI/DeepSeek/Kimi/Qwen 常见），并兼容 `input_tokens / output_tokens` 等字段；流式若无 usage 则降级为估算。

兼容性细节（来自 Zotero AI 插件生态里最常见的踩坑点）：

- 有的厂商要求用户填写**完整 endpoint**（包含 `/chat/completions`），有的则要求填写**base URL**（例如 `.../v1`）再拼接路径。
- 建议实现时对 `ai_summary_base_url` 做一次规范化：
  - 若用户填写的 URL 末尾已包含 `/chat/completions`，则直接使用该 URL
  - 否则按 baseURL + `/chat/completions` 组装
- 在 Preferences 增加 “Test Connection” 可显著降低配置成本（避免生成时才发现 404/401）。

> 注：不同“兼容实现”对字段支持不一（如 `max_tokens`/`max_completion_tokens`、`response_format` 等）。MVP 只使用最小公共子集字段，保证兼容性。

### 4.3 Claude / Gemini 专用适配器

> Status: Implemented（Claude/Gemini 均已实现非流式+流式；Gemini streaming 使用 `:streamGenerateContent?alt=sse`）。

Claude（Anthropic）与 Gemini 协议不同，建议单独适配：

- Claude：`POST /v1/messages`，header `x-api-key` + `anthropic-version`
- Gemini：`generateContent` / `streamGenerateContent`（建议用 header 传 key，避免 key 出现在 URL）

### 4.4 Provider 预设（可选）

> Status: Implemented（见 `src/modules/inspire/llm/profileStore.ts` 的 `AI_PROFILE_PRESETS`；下方为建议更新与“最新模型现状”调研补充）。

在 UI 中提供“预设”下拉（可编辑 baseURL/model），例如：

- OpenAI（兼容）：`https://api.openai.com/v1`
- DeepSeek（兼容）：（示例）`https://api.deepseek.com`
- Kimi/Moonshot（兼容）：（示例）`https://api.moonshot.cn/v1`
- Qwen（优先兼容）：（示例）`https://dashscope.aliyuncs.com/compatible-mode/v1`
- 智谱（优先兼容）：（示例）`https://open.bigmodel.cn/api/paas/v4`（如不兼容则后续加专用适配器）

> 以上 baseURL 仅作“常见形态示例”，最终以各厂商文档为准；并始终允许用户覆盖。

**最新模型现状（调研摘要，2026-01-04）**

- DeepSeek（OpenAI-compatible）
  - Base URL：`https://api.deepseek.com`（文档示例直接请求 `/chat/completions`）
  - 常见模型：`deepseek-chat`、`deepseek-reasoner`
- Moonshot / Kimi（OpenAI-compatible）
  - Base URL：`https://api.moonshot.cn/v1`
  - 常见模型（含 vision 预览）：`moonshot-v1-8k`、`moonshot-v1-32k`、`moonshot-v1-128k`、`moonshot-v1-*-vision-preview`、`moonshot-v1-auto`
- Google Gemini（原生 Gemini API）
  - Base URL：`https://generativelanguage.googleapis.com`
  - 近期模型族：`gemini-2.5-pro`、`gemini-2.5-flash`、`gemini-2.0-flash`，以及 `gemini-*-image* / *-audio* / *-tts*` 变体（以官方 model list 为准）
- Qwen / DashScope（OpenAI-compatible 模式）
  - 常见模型族（以网关/账号开通为准）：`qwen-turbo`、`qwen-plus`、`qwen-max`，以及更高版本的 `qwen3-*` / `qwen3-vl-*`（不同入口命名可能不同）
- Zhipu（智谱）
  - 模型族在快速演进（例如 `glm-4-flash`、`glm-4.5`、`glm-4.6`、`glm-4v*` 等）；但 **是否 OpenAI-compatible 取决于具体 endpoint/网关**，建议在文档里明确“可能需要代理/兼容层”，并提供 Test 按钮快速验配。
- Mistral（OpenAI-compatible）
  - Base URL：`https://api.mistral.ai/v1`（文档示例为 `/chat/completions`）
  - 模型命名在快速变化（以官方列表为准），例如：`mistral-large-3-25-12`、`mistral-medium-3-1-25-08`、`mistral-small-3-2-25-06`、以及图像方向的 `mistral-color-*`（示例来自 model list 页面）。
- OpenAI / Anthropic（现网访问限制说明）
  - 本环境对 OpenAI 官方 docs/定价页存在 403 限制，Anthropic 部分页面存在区域限制，因此上述“最新模型名”以聚合索引/可访问页面为参考；实现上应以“用户可编辑 model/baseURL + Test Connection”为准，避免硬编码过度依赖某个版本号。

---

## 5. 配置项、密钥与隐私

> Status: Partial（偏好项与安全存储已实现，但 Preferences 页面未补齐 AI 分组；当前主要通过对话框配置/保存）。

### 5.1 偏好项（prefs）建议

> Status: Partial（`addon/prefs.js` 已覆盖大部分 key；其中温度存储为整数百分比以规避 Zotero prefs 数值限制；另新增 `ai_summary_cache_enable`）。

在 `addon/prefs.js` 增加（示例 key 命名）：

- `ai_summary_enable`（bool，默认 false）
- `ai_summary_provider`（string：`openaiCompatible|anthropic|gemini`）
- `ai_summary_preset`（string：`openai|deepseek|kimi|qwen|zhipu|custom`）
- `ai_summary_base_url`（string，openaiCompatible 用）
- `ai_summary_model`（string）
- `ai_summary_temperature`（建议存储为 **int 百分比**，默认 20 → 0.2；读取时归一化到 0–2）
- `ai_summary_max_output_tokens`（number，默认 1200）
- `ai_summary_output_language`（string：`auto|en|zh-CN`，默认 auto）
- `ai_summary_style`（string：`academic|bullet|grant-report|slides`，默认 academic）
- `ai_summary_citation_format`（string：`latex|markdown|inspire-url|zotero-link`，默认 latex）
- `ai_summary_include_seed_abstract`（bool，默认 true）
- `ai_summary_include_abstracts`（bool，默认 true）
- `ai_summary_max_refs`（number，默认 40）
- `ai_summary_abstract_char_limit`（number，默认 800）
- `ai_summary_cache_enable`（bool，默认 false）
- `ai_summary_cache_ttl_hours`（number，默认 168，可选）
- `ai_summary_streaming`（bool，默认 true）
- `ai_batch_requests_per_minute`（number，默认 12）
- `ai_batch_max_items`（number，默认 50）
- `ai_profiles`（string(JSON array)，默认 `[]`）
- `ai_active_profile_id`（string，默认空）
- `ai_prompt_templates`（string(JSON array)，默认 `[]`）
- `ai_library_qa_scope`（string：`current_item|current_collection|library`，默认 `current_collection`）
- `ai_library_qa_include_titles`（bool，默认 true）
- `ai_library_qa_include_abstracts`（bool，默认 false）
- `ai_library_qa_include_notes`（bool，默认 false）
- `ai_library_qa_include_fulltext_snippets`（bool，默认 false）
- `ai_library_qa_top_k`（number，默认 12）
- `ai_library_qa_snippets_per_item`（number，默认 1）
- `ai_library_qa_snippet_chars`（number，默认 800）

在 `addon/content/preferences.xhtml` 新增 “AI Summary” 分组，并补齐 `addon/locale/*/preferences.ftl` 文案。（当前实现：主要在 `AI…` 对话框中提供配置入口与 Test/Save。）

### 5.2 API Key 存储策略（优先安全存储）

> Status: Implemented（见 `src/modules/inspire/llm/secretStore.ts`；优先 LoginManager，降级 prefs fallback）。

优先使用系统密码库（Firefox LoginManager / Zotero 环境可用时）：

- key 不进入普通 prefs，不写入日志
- 按 provider/preset 分槽保存（例如 `service=zoteroinspire.ai`, `username=providerId`）

降级方案（若密码库不可用）：

- 存入 `Zotero.Prefs`（明文），UI 必须提示风险，并提供“一键清除”按钮。

### 5.3 数据公开性、隐私与合规（HEP 场景）

> Status: Implemented（默认发送 INSPIRE/HEP 的公开摘要以提升质量；system prompt 明确“把 titles/abstracts 当不可信数据”；已提供发送内容预览 + 粗略 token 估算 + 上下文开关/最小化发送策略）。

必须提供清晰开关与明确说明（重点从“是否敏感”转为“你会发送什么/花多少钱/是否走第三方”）：

- **默认发送 abstracts（INSPIRE 公开摘要）**，以显著提升主题聚类与综述提纲质量；如需更快/更省可关闭 abstracts（并且在 429 限流情况下已实现一次“自动降级 fast mode”：不发摘要、减少 refs、降低输出）。
- 明确提示（不做恐吓式“敏感”表述）：当前 profile 若为云端 provider，则会把 **（标题/作者/年份/引用数/类型/摘要）** 发送到该 provider；若 baseURL 指向本机（Ollama/LM Studio/自建网关），则数据仅在本机/局域网内流转。
- 明确不发送的内容（默认）：Zotero 私有笔记/标注/附件 PDF 正文（除非未来显式增加“全文上下文”选项）。
- 提供“仅本地缓存/不缓存”选择：即使输入是公开摘要，**输出** 也可能包含用户的研究假设/选题意图；默认关闭缓存是合理的，但可让用户自行权衡（复现/速度 vs. 本地落盘）。

---

## 6. UI 交互与任务编排（推荐先做对话框按钮）

> Status: Implemented（AI 入口按钮 + 对话框 + Copy/Save/Export/Cancel + Templates 已落地；“主窗口 toolbar 按钮”尚未做）。

### 6.1 按钮放置（可以放在 Refresh/Export 的 header 栏上）

> Status: Implemented（见 `src/modules/zinspire.ts` 的 `sectionButtons`：Refresh/Export/AI）。

结论：**可以**。本插件的 INSPIRE pane 已通过 `Zotero.ItemPaneManager.registerSection({ sectionButtons: [...] })` 在 header 区域放置了 `Refresh` 与 `Export` 按钮，因此 AI 入口最自然的位置就是同一排的 header 按钮栏（空间紧凑且不影响 tab 布局）。

建议形态：

- 新增一个 **单一入口按钮**：`AI…`，图标建议用 “sparkles/robot”，最好自己设计一个美观优雅的svg作为图标。
- 点击后弹出对话框或下拉菜单（推荐对话框，后续可以扩展为“AI 工具箱”）。

理由：如果直接在 tab 区增加按钮，容易引入布局/溢出问题；放在 header 的 `sectionButtons` 与现有交互一致（刷新、导出、AI 都是“全局动作”）；同时也做一个放在 zotero主窗口的toolbar，放在Search框左侧。

### 6.2 MVP UI：AI Summary 对话框（不新增 viewMode）

> Status: Implemented（对话框包含 Summary/Recommend/My Notes/Templates；支持 Copy/Save as Note/Export .md/Cancel/Test/Save profile）。

对话框建议包含：

- `Generate / Regenerate`
- `Goal`（可选输入：写作目标/想要的推荐类型，用于提升相关性）
- `Cancel`（AbortController）
- `Copy Markdown`
- `Save as Note`（保存到 Zotero note）
- `Export .md…`（导出到外部文件，见第 11 节）
- `Options`（语言/风格/是否含 abstracts/引用格式等，默认折叠在齿轮按钮里）
- 状态区：生成中/使用缓存/错误信息（401/429/timeout）

理由：不引入新的 `InspireViewMode`，对现有 tab 切换/排序/键盘导航影响最小，符合 “1 天” 工期预期；同时为后续“AI 推荐文献”扩展留出空间（同一对话框加一个 tab 即可）。

### 6.3 数据流（点击 Generate）

> Status: Implemented（seed 校验、refs 采样、abstracts 按需补抓、调用 provider、渲染与导出均已落地）。

1. 校验：当前条目存在 `recid` 且 references 已加载（或触发加载）。
2. 构造候选 references 列表（采样/去噪/截断）。
3. 若 `include_abstracts=true`，对入选条目并发补抓 abstracts（可取消）。
4. 组装 prompt（system + user），调用选定 provider。
5. 渲染结果并允许导出。

### 6.4 错误处理与重试

> Status: Implemented（基础错误归一化已实现；429 有自动降级/重试；发送预览与 token/用量提示已落地；仍可补齐更多“可行动提示”。）

- 401/403：提示“API Key 无效/权限不足”，引导去 Preferences 设置
- 429：指数退避重试 1–2 次后提示“限流”
- 网络失败/超时：提示并允许重试
- provider 返回异常结构：展示 raw 错误摘要（不泄露 key）

---

## 7. 缓存设计（建议复用本地缓存体系）

> Status: Implemented（已新增 `LocalCacheType: ai_summary`，对话框可启用/清除；TTL 使用 `ai_summary_cache_ttl_hours`，并受 `local_cache_enable` 总开关影响）。

新增 `LocalCacheType`：`ai_summary`

- key：`recid + hash(settings + refs_ids + include_abstracts_flag)`
- value：`{ markdown, provider, model, baseURL, inputs }`
- TTL：可配（默认 **168 小时**），支持“清除 AI Summary 缓存”

注意：若用户关闭缓存或开启“敏感模式”，则不落盘。

---

## 8. 测试计划（Vitest）

> Status: Partial（已添加 provider 相关契约测试（OpenAI-compatible endpoint/stream）；采样/Prompt/Abort 等覆盖仍可继续补齐）。

新增单元测试（mock fetch）：

1. **采样与截断**：给定固定 entries，断言入选数量、排序/覆盖策略稳定。
2. **Prompt 生成**：断言输出结构包含必须段落与引用锚点策略。
3. **Provider 请求构造**：
   - openaiCompatible：endpoint、headers、body 字段最小集
   - anthropic/gemini：鉴权与 body 映射
4. **Abort 取消**：请求中途 abort 后返回可预期错误状态，不写缓存。

（可选）在 CI/本地不跑真实 LLM，只做契约测试与错误归一化测试。

---

## 9. 分阶段里程碑（建议）

> Status: Partial（Phase 0/1/4 已完成；Phase 2 部分完成；Phase 3（map-reduce / Related 内嵌等）仍待做。9.1 的 M1–M9 已完成，作为可溯源里程碑保留。）

### Phase 0（已完成：基础设施）

> Status: Implemented（已由 9.1 M1/M2 覆盖）

- ✅ `AI Secret Store`（优先 LoginManager，降级 prefs fallback）
- ✅ 偏好项（`ai_summary_*`）骨架
- ✅ 本文档初版（含 10.3(B) 与 12.2 增强点）

> 已对应本仓库提交：`e91376d`（不影响 `dev-inspire_refs` 分支；后续开发继续在当前分支按里程碑本地 commit，不 push）。

### Phase 1（MVP，~1 天）

> Status: Implemented（已由 9.1 M2/M3 覆盖）

- ✅ Provider：OpenAI-Compatible + Claude + Gemini（均支持流式/非流式）
- ✅ UI：header 栏按钮（与 Refresh/Export 同行）+ 对话框 + Copy/SaveNote + Cancel
- ✅ 成本控制：max_refs + abstract 开关 + 截断
- ✅ 错误处理：401/429/timeout（并有 429 fast-mode retry）

### Phase 2（增强，~1–2 天）

> Status: Partial（缓存/导出已完成；“多 seed 合并 references”为一个 summary 仍未做）

- ✅ 缓存落盘（ai_summary cache type）
- ⬜ 结果渲染优化（可折叠主题/一键打开代表作 INSPIRE）
- ⬜ 多条目/多 seed 合并总结（“合并 references→一个 summary”，与 AutoPilot 的“逐条生成 note”不同）
- ✅ 导出 Markdown 到文件（见第 11 节）

### Phase 3（高级）

> Status: Planned

- ⬜ 块摘要（Map-Reduce）处理超大 references
- ⬜ 更严格结构化输出（JSON schema）+ 更强可视化/可解释性
- ⬜ AI 推荐相关文献（作为 Related tab 内嵌视图，见第 10 节）

### Phase 4 (增强)

> Status: Implemented（见 9.1 M5）

- ✅ 12.2 节中各项

---

## 9.1 可跟踪实施里程碑（按你选择：实现 10.3(B) + 12.2 增强 + 11.5 方案 B）

> Status: Implemented（M1–M9 已完成，commit 记录见右栏；未 push 仅作本地溯源。）

> 说明：每个里程碑完成后都做一次安全/漏洞检查（重点：密钥泄露、XSS/HTML 注入、URL 拼接、文件导出路径、安全日志），并本地 `git commit`（不 push），然后进入下一个里程碑。

| Milestone | Scope                                        | Done Definition（可验收点）                                                                                                                                              | Status（commit，仅本地记录不 push） |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| M1        | **AI Profiles（含模板 prefs 基础设施）**     | `ai_profiles/ai_active_profile_id` 生效；对话框内可选 profile；API key 通过 secretStore 保存/清除；提供“Test Connection”。（`ai_prompt_templates` 的 UI 在后续 M8 完成） | Done: `e91376d` + `3c9f5d6`         |
| M2        | **LLM Client（多 provider + streaming）**    | OpenAI-Compatible/Claude/Gemini 统一接口；支持非流式与流式；错误归一化（401/429/timeout）；不在日志输出 key。                                  | Done: `396996e`                     |
| M3        | **AI… 对话框 + 方案 B 内置 Markdown 编辑器** | header 栏新增 `AI…`；对话框支持 Summary/Recommend/My Notes；支持 Copy Markdown / Save as Note / Export `.md…`；My Notes 可写 Markdown + 预览（含数学渲染）。             | Done: `ee67389`                     |
| M4        | **10.3(B) Query Expansion Recommend**        | AI 生成 INSPIRE queries → 插件 Search API 拉取 → 与 Related 合并去重 → AI grounded rerank 分组；UI 展示分组 + 解释；推荐条目可点击打开/导入。                            | Done: `711d0bd`                     |
| M5        | **12.2 增强（完整实现）**                    | Streaming UI、userGoal、Follow-ups、AutoPilot（多条目队列 + throttle）、失败自动降级、可复现记录（front matter/hash）、主题 chips 过滤。                                 | Done: `0376160`                     |
| M6        | **Build 稳定性（prefs）**                    | 修复 float pref 警告（temperature 用整数存储，运行时换算）；TS build 无告警。                                                                                            | Done: `8e8f152`                     |
| M7        | **AI 输出缓存（可选、默认关闭）**            | 新增 `ai_summary_cache_enable`；Summary 支持 cache hit/miss；提供 “Clear cache”；缓存 TTL 由 `ai_summary_cache_ttl_hours` 控制。                                         | Done: `9388e76`                     |
| M8        | **Prompt Templates（Quick Actions + 管理）** | 新增 `Templates` tab：New/Duplicate/Delete/Save/Run；Recommend 的 Query/Rerank 支持选择模板并生效。                                                                      | Done: `9d411b2`                     |
| M9        | **Diagnostics**                              | 新增 “Copy Debug” 按钮：复制不含 API key 的诊断信息（profile/prefs/seed/模板选择/缓存目录等）。                                                                          | Done: `313ac94`                     |

实现顺序建议：`M1 → M2 → M3 → M4 → M5`（M4 依赖 M2/M3；M5 依赖全部）。

---

## 10. AI 推荐相关文献（与 Related Papers 融合）

> Status: Partial（已在 `AI…` 对话框的 Recommend tab 落地 grounded rerank + query expansion；尚未作为 Related tab 的内嵌视图。）

### 10.1 看法（为什么值得做）

> Status: Implemented（现状分析/设计 rationale）

现有 Related（bibliographic coupling + co-citation）是**可解释、可复现**的，但它偏“结构相关”（共享引用/共被引）：

- 优点：不依赖 LLM，不会“编造论文”，解释性强（shared refs count / co-citation）。
- 局限：对“主题相关但引用网络弱”的新方向/跨领域论文召回较弱；排序也未必贴近用户当下写作任务（例如“我想找一个最新的 review/方法论文/实验约束”）。

因此更合适的结合方式是：**算法召回 + AI 解释/重排/扩展**，让 AI 做“语义对齐”与“写作导向”的推荐，而不是让 AI 凭空编造 paper 列表。

### 10.2 方案 A：对候选集做 AI 重排与分组（Grounded Re-ranking）

> Status: Partial（已在 Recommend tab 落地 grounded rerank；作为 Related tab 内嵌视图尚未做）

核心原则：**AI 只能在真实候选集中选择**，输出必须带 `recid/texkey`，插件再做校验。

1. 候选集生成（无需 AI）：
   - `Related` 的 top-K（例如 50）
   - 可选合并：`Cited-by` top-K（例如 50，提供“后续发展/跟进工作”）
2. 送给 LLM 的上下文：
   - seed 的（标题/摘要可选/关键词）
   - 每个候选的（title/year/authors/citationCount/documentType/abstract 可选）
3. LLM 输出：
   - 主题分组（例如 3–6 组）
   - 每组推荐 3–8 篇，并给 1–3 句理由
   - 只允许引用候选集中的 `recid/texkey`
4. UI 展示：
   - 在 Related tab 增加一个“AI refine”开关或一个“AI Recommended”子视图
   - 每条推荐同时展示“结构信号”（shared refs/co-citation）+ “AI 理由”（语义解释）

优点：成本可控（最多 100 篇候选），并且不产生“幻觉论文”。

实现建议（让“可控性”更强）：

- 对 “AI 推荐” 这种需要结构化渲染/导入按钮的输出，优先要求模型输出 **JSON**（包含 groups、items、recid/texkey、reason），插件做 schema 校验后再渲染；Markdown 仅作为展示层或导出层。
- 如果模型返回的 `recid/texkey` 不在候选集中：直接丢弃该条并在 UI 里标注“unverified”，避免幻觉污染列表。

### 10.3 方案 B（更强召回，也实现）：AI 生成 INSPIRE 查询 → 插件检索 → AI 再重排（Query Expansion）

> Status: Implemented（Recommend tab 已实现：Query template → Search API → rerank）

适用于用户希望“找更多超出引用网络的相关论文”：

1. 让 AI 从 seed + references 摘要中生成 3–8 条 INSPIRE 查询（例如 `t:\"chiral\" and date:2022->2026`、`a:Witten and t:...`、`k:pentaquarks and a:f k guo`）。
2. 插件用 INSPIRE Search API 执行查询，拿到真实结果集（每条 query top-20）。
3. 将结果与 Related 合并去重，形成扩展候选集。
4. 再跑一次方案 A 的 grounded rerank，输出最终推荐与分组。

关键点：**AI 只负责生成查询/排序解释**，真正的“论文存在性”由 INSPIRE API 保证。

### 10.4 UI 设计建议（吸收主流 AI 插件的“好用点”）

> Status: Implemented（Templates/连接测试/缓存/Debug/快捷键/发送预览/预算提示均已落地）

从 Zotero 生态里常见 AI 插件（对话侧边栏/机器人按钮/提示词模板/批处理）总结出的高价值交互点，建议在本插件里采用最小子集：

- **一键动作 + 可自定义模板**：默认提供 “总结/推荐/提纲/翻译” 等 quick actions；高级用户可编辑 prompt 模板（变量如 `{seedTitle}`、`{seedAbstract}`、`{referencesJson}`、`{userGoal}`）。
- **连接测试**：对话框内已提供 `Test`（检查 baseURL/key/model，带即时反馈/耗时）；后续可再补齐 Preferences 入口，避免用户生成时才发现 401/404。
- **预算与速度控制**：允许设置“候选数 K/摘要开关/并发数/每分钟请求数”，避免 429。
- **历史与可复用**：缓存上次推荐结果（同一 seed + 同一设置），并标记“from cache”。

并与本插件既有能力对齐（这是本项目的优势点）：

- **推荐条目复用现有行内动作**：对 AI 推荐列表里的每条 paper，复用当前 panel 已有的动作（Open INSPIRE / Import / Link / Favorite），并高亮“已在库中”的条目。
- **一键批量导入/收藏/加入集合**：对推荐结果支持多选后批处理（复用 batch import 思路），避免逐条点击。

### 10.5 推荐输出的“可解释性”与“可控性”

> Status: Partial（“候选集校验 + grounded 解释”已做；更多可视化/过滤可继续增强）

为了让推荐更可信、也更符合科研写作：

- 每条推荐显示 2 类信号：
  - 可计算信号：shared refs、co-citation、citations、year、documentType
  - 语义信号：AI 理由（限定 1–3 句）
- 提供“推荐类型”筛选（通过 prompt 控制）：
  - `review`（想找综述）
  - `methods`（想找方法/工具）
  - `recent`（想找最新进展）
  - `high-impact`（想找高引用关键工作）
- 与现有过滤偏好对齐：
  - 复用 `related_papers_exclude_reviews`、PDG 例外等现有逻辑，避免 AI 推荐把已明确不想看的条目“推荐回来”。
  - 增加展示层过滤：`hide already-in-library`、`year range`、`published only`（如果候选信息足够），让推荐更像“可用的阅读清单”。

---

## 11. Notes 导出为 Markdown 文件（外部保存）

> Status: Implemented（`AI…` 对话框已支持 “Save as Note” 与 “Export .md…”；并记录 seed 元信息与可复现 metadata）。

### 11.1 需求与价值

> Status: Implemented

仅保存为 Zotero Note 对一些写作工作流不够（例如 Git/Obsidian/Quarto/LaTeX 项目），因此建议增加：

- `Save as Note`：写入 Zotero
- `Export .md…`：导出到用户选择的目录

### 11.2 输出“头部信息”（Note 与 .md 共用一套数据结构）

> Status: Implemented（seed 元信息由 `buildSeedMetaForItem()` 构造；导出由 `buildMarkdownExport()` 生成）

建议为 seed（当前论文）构造一个 `SeedMeta`（或类似）对象，作为所有导出/渲染的单一数据源，至少包含：

- 标题：`title`
- 引用信息：`citekey (texkey)`、`author_year`、`authors`、`year`
- 期刊信息：`journal`、`volume`、`issue`、`pages`（或 `artid`）
- 标识符：`recid`、`doi`、`arxiv`
- 可点击链接（尽量全）：
  - `zotero_link`（回到该条目：`zotero://select/...`）
  - `zotero_pdf_link`（可选：若有 PDF 附件，优先“打开 PDF”协议；否则提供 PDF 附件的 `zotero://select/...`）
  - `inspire_url`
  - `doi_url`
  - `arxiv_url`

实现时建议以“可用就填、不可用就留空/省略”的方式处理，避免为了补齐字段而触发额外网络请求；对 Zotero item 已有字段优先使用本地数据，INSPIRE 字段作为补充/校验来源。

字段来源与优先级（建议）：

- `seed_citekey`：
  1. INSPIRE `texkey`（若 seed 有 `recid`，可用轻量字段拉取 `metadata.texkeys`）
  2. Zotero `Extra` 中已存在的 citekey（本插件或其他插件写入时）3.（可选）Better BibTeX citation key（若用户安装且可通过 API 获取）
- `seed_author_year`：
  - 优先用 Zotero creators + year 生成 `FirstAuthor et al. (YYYY)`（作者为 Collaboration 时保持原样）
- `seed_journal/volume/issue/pages/year`：
  1. Zotero item 的字段（本地、最稳定）
  2. INSPIRE `publication_info`（作为补充/纠错来源）
- `seed_doi`：
  - Zotero DOI 字段 → 其次 Extra/URL 中解析 → 再考虑 INSPIRE
- `seed_arxiv`：
  - 复用现有本地提取逻辑（Journal Abbr./Extra/URL/DOI 回退），避免额外请求
- `zotero_link`：
  - Personal library：`zotero://select/library/items/<ITEM_KEY>`
  - Group library：`zotero://select/groups/<GROUP_ID>/items/<ITEM_KEY>`
- `zotero_pdf_link`：
  - 若能确认 Zotero 支持 `zotero://open-pdf/...` 协议则优先使用（体验最好）
  - 否则提供 PDF 附件条目的 `zotero://select/...`（点击后按 Enter 打开）

### 11.3 Markdown 导出形态（建议：YAML front matter + 美观可读的 Metadata 卡片）

> Status: Implemented（已采用 YAML front matter + metadata table + “My Notes”占位段，见 `src/modules/inspire/panel/AIDialog.ts` 的 `buildMarkdownExport()`）

导出的 Markdown 文件建议包含简单的头部信息，便于追溯：

```md
---
source: zotero-inspire
type: ai_summary
seed_recid: 123456
seed_citekey: Guo:2017jvc
seed_author_year: "Guo et al. (2017)"
seed_title: "..."
seed_year: 2017
seed_journal: "<journal>"
seed_volume: "<volume>"
seed_issue: "<issue>"
seed_pages: "<pages_or_artid>"
seed_doi: "<doi>"
seed_arxiv: "<arxiv_id>"
created_at: 2026-01-03T12:34:56Z
model: deepseek-chat
provider: openaiCompatible
addon_version: 2.5.0
prompt_version: 1
zotero_item_key: ABCD1234
zotero_link: zotero://select/library/items/ABCD1234
inspire_url: https://inspirehep.net/literature/123456
doi_url: https://doi.org/<doi>
arxiv_url: https://arxiv.org/abs/<arxiv_id>
---

# AI Summary: {seedTitle}

**Links**: [Zotero]({zotero_link}) · [INSPIRE]({inspire_url}) · [arXiv]({arxiv_url}) · [DOI]({doi_url})

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Citekey     | `\\cite{<seed_citekey>}`                                |
| Author–Year | {seed_author_year}                                      |
| Journal     | {seed_journal} {seed_volume} ({seed_year}) {seed_pages} |
| arXiv       | [{seed_arxiv}]({arxiv_url})                             |
| DOI         | [{seed_doi}]({doi_url})                                 |

...正文...

## My Notes (Markdown)

> 写下你的想法/评论；推荐用 Markdown（列表、代码块、LaTeX 数学等）。
> 若在 Zotero 原生 note 编辑器里体验受限，见第 11.5 节（Better Notes 同步 / 插件内置 Markdown 编辑器）。
```

文件名模板（可选偏好）：

- `ai-summary_{texkey-or-recid}_{YYYYMMDD}.md`

说明：

- front matter 用于机器可读/可复现；表格用于人类阅读与点击跳转。
- `zotero_link` 在 Obsidian 等外部编辑器里不一定可打开，但在 Zotero 内通常可点击；仍建议保留（是“回到条目”的最短路径）。
- `seed_citekey` 建议优先使用 INSPIRE `texkey`（稳定、用于 LaTeX）；若用户更依赖 Better BibTeX 的 citation key，可在实现时同时写入 `seed_bbt_citekey`（如可获取）。

### 11.4 Zotero Note 形态（建议：顶部 Metadata 卡片 + 正文）

> Status: Implemented（保存为 HTML；同时在隐藏区保存 Markdown source 以便无损导出/再编辑，见 `buildAiNoteHtml()`）

Zotero Note 建议保存为 **HTML**（而不是纯 Markdown），以确保链接可点击、排版稳定。推荐布局：

- 顶部一行链接：`Open in Zotero / INSPIRE / arXiv / DOI / PDF`
- 一个紧凑的 2 列表格：`citekey`、`author-year`、期刊信息、arXiv、DOI
- 正文：AI Summary / AI Recommended / Outline 等
- （可折叠）生成信息：provider/model/temperature/refs 数等（便于排查与复现）

这样既满足“美观实用”，也让用户在 Zotero 内部能一键跳转到来源与全文。

### 11.5 用户评论（Markdown）与“接近原生 Markdown”的编辑体验

> Status: Implemented（已选择并落地“方案 B：内置 Markdown 编辑器”；Better Notes 保持可选兼容，不作为依赖）

现实约束：Zotero 原生 note 本质是富文本（HTML）编辑器，直接输入 Markdown 只能当作纯文本；数学公式/代码块体验也会受限。要获得接近 Obsidian/GitHub 的 Markdown 体验，建议提供以下两条路径（可同时支持）：

**方案 A（推荐，成本最低）：与 Better Notes 工作流兼容**

- Better Notes 支持“直接粘贴 Markdown 转富文本”以及 **Note ↔ Markdown 文件双向同步**；用户可在 Obsidian/VS Code 等编辑器里获得完整 Markdown/数学体验，再自动同步回 Zotero note。
- 本插件侧的配合点：
  - `Export .md…` 生成的 Markdown 文件带完整 front matter + metadata 卡片 + “My Notes”空段落
  - 在 Zotero note 顶部显示该 `.md` 文件路径（或可复制路径），并提示“可用 Better Notes 设为 Auto-Sync” -（可选）若检测到 Better Notes 已安装，在对话框里显示一个“Open Better Notes / Set Auto-Sync”提示入口（不强依赖 BN API）

优点：

- 生态成熟：Markdown ↔ Note 同步、外部编辑器体验、图片/附件处理等都更完善。
- 本插件开发成本低：我们只要把 `.md` 生成得“好用”（metadata + 占位区 + 可追溯信息）。

缺点：

- 依赖额外插件与学习成本：对只想“轻量写几句评论”的用户来说，Better Notes 的配置/工作流可能偏重。
- 行为不可控：BN 的同步/渲染细节由其决定，我们很难保证一致性与长期兼容（尤其跨 Zotero 版本/BN 版本）。

**方案 B（在 Zotero 内部获得 Markdown 体验）：插件内置 Markdown 编辑器（对话框/侧栏）**

- 在 `AI…` 对话框中提供一个 `My Notes (Markdown)` 编辑区：
  - 左侧 `textarea`（支持 Tab 缩进、快捷键、历史版本）
  - 右侧实时预览（Markdown 渲染 + KaTeX/数学渲染，复用本插件已有 KaTeX 资源）
- 保存策略（推荐）：
  - 在 Zotero note 中保存“渲染后的 HTML”（保证可读、可点链接）
  - 同时将用户写的 Markdown 源文以隐藏块保存（例如 `<pre data-zoteroinspire-md="user-notes">...</pre>` 或 HTML 注释），用于后续再次编辑与导出 `.md` 时保持无损

这样用户既能在 Zotero 里写 Markdown，又能导出到外部 `.md`，并且数学公式可以在预览中得到良好支持。

优点：

- 零依赖、低心智负担：用户不需要安装/学习 Better Notes，就能获得接近“原生 Markdown”的编辑体验（至少在本插件对话框里）。
- 可深度定制：可以针对本插件场景优化（自动插入 citekey/链接、自动引用推荐条目、快速插入 `\cite{}` 等）。

缺点：

- 开发与维护成本高：Markdown 解析/渲染、数学渲染、安全（XSS 过滤）、编辑体验（快捷键/撤销/粘贴）都需要我们负责。
- “在 Zotero note 编辑器里直接写 Markdown”仍然做不到：Markdown 编辑发生在本插件 UI 中，note 里保存的是渲染后的 HTML（这是可用性与兼容性的折中）。

**推荐取舍（结合你的反馈：Better Notes 复杂、用得少）**：

- 默认优先实现 **方案 B（内置 Markdown 编辑器）**，让“写几句评论 + 数学公式 + 导出 md”不依赖任何外部插件。
- 方案 A 保持“兼容但不强绑定”：我们输出的 `.md` 与 note 结构对 Better Notes 友好，但不把 BN 作为必需依赖。

### 11.6 保存位置策略

> Status: Partial（当前每次弹出文件选择器；“默认导出目录”偏好尚未实现）

提供两种模式（与现有导出行为一致）：

1. 每次弹出文件选择器（最直观）
2. 允许用户在偏好中设置默认导出目录（空则使用 Zotero Data Directory）

---

## 12. 参考现有 AI Zotero 插件的“精华设计”（增强清单）

> Status: Partial（streaming/userGoal/templates/diagnostics 等已落地；主窗口 toolbar / Preferences 分组与引导等仍建议补齐。）

本插件不需要变成“全功能 AI 助手”，但可以吸收一些已被验证很“省心好用”的设计点，并以最小代价集成到 INSPIRE 工作流里。

### 12.1 高价值、低侵入（建议尽快纳入）

> Status: Implemented（已落地：发送预览、预算/用量展示（含 latency）、模板导入/导出、快捷键、fast mode；仍可改进：更细粒度字段级上下文开关与 Preferences 引导。）

- ✅ **本地模型预设（Ollama / LM Studio）**：已提供 OpenAI-compatible 预设（见 `AI_PROFILE_PRESETS`）：
  - Ollama：`http://localhost:11434/v1`
  - LM Studio：`http://localhost:1234/v1`（或用户自定义）
- ✅ **发送内容预览 / 最小化发送**：Summary/Library Q&A 均提供 Send Preview，并可用开关最小化发送字段（abstracts/notes/fulltext snippets 等）。
- ✅ **输出语言/写作风格开关**：`ai_summary_output_language`（`auto|en|zh-CN`）与 `ai_summary_style`（`academic|bullet|grant-report|slides`）已落地并进入 prompt。
- ✅ **提示词模板库（Templates）**：已实现内置模板 + 用户模板的管理与运行（Recommend / Follow-up 等 scope）。
- ✅ **快捷键与可达性**：对话框内提供常用快捷键（tab 切换、Preview、Generate/Ask、Copy/Save/Export）。
- ✅ **模板可迁移**：支持导入/导出 prompt 模板（JSON），便于跨机器共享。
- 🟨 **上下文选择器**：已具备摘要开关/refs 数等核心控制；仍可补齐更细的“发送哪些字段”选择与预览。
- 🟨 **连接测试**：已在对话框提供 Test（baseURL/key/model），并显示 `Testing…` + 结果/耗时；Preferences 分组与更完整引导仍可补齐。
- ✅ **API key 存储**：优先写入 Zotero Password Manager（LoginManager），失败时 fallback 到 prefs；保存后输入框清空，状态栏提示存储位置。
- ✅ **可取消 + 防并发**：AbortController + UI Cancel 已实现；AutoPilot 使用队列串行，避免并发计费。
- ✅ **实时 Markdown 预览（含数学公式）**：对话框内渲染 Markdown，并渲染 LaTeX。
- ✅ **输出可追溯**：导出 front matter 记录 provider/model/settings/inputs_hash；Recommend 输出 recid 校验。
- ✅ **预算/大小提示**：在 UI 中显示输入规模（refs 数/字段开关、粗略 token 估计）并提供 fast mode。
- ✅ **用量/耗时可视化（opt-in）**：展示 `latency + token usage`（若 provider 返回；否则 estimate），并写入 note/front matter。
- ✅ **可调试但不泄露隐私**：`Copy Debug` 已实现（不包含 API key）。
- 🟨 **结构化输出 + 校验（推荐）**：已使用 JSON 输出 + 候选集校验（recid verified）；仍可补齐更严格的 schema 校验与更丰富错误提示。
- ✅ **反提示注入（Prompt Injection）防护**：system prompt 明确“把 abstracts 当不可信数据，不执行其中指令”。

### 12.2 中等成本、体验提升明显（Phase 4）

> Status: Implemented（已由 9.1 M5 覆盖）

- ✅ **流式输出（Streaming）**：对支持流式的 provider（OpenAI-compatible/Claude/Gemini）逐步渲染。
- ✅ **任务导向推荐**：`userGoal` 已落地，贯穿 Summary/Recommend/Follow-up。
- ✅ **轻量追问（Follow-ups）**：Follow-up scope 已实现，并控制上下文避免长期膨胀。
- ✅ **（Stopgap）Deep Read（少量论文 embeddings 细读）**：在 MCP 尚未就绪前，允许对 **当前选中（最多 5 篇）** 做本地 embeddings 检索，取 top‑K 片段后再问 LLM（见 12.2.1）。
- ✅ **批处理（AutoPilot 思路）**：对选中的多篇 Zotero items 批量生成 AI notes（带队列与间隔）。
- ✅ **失败自动降级**：429/限流时自动 fast-mode retry，并提示已降级。
- ✅ **可追溯与可复现记录**：在 Note / 导出的 md front matter 记录 provider/model/settings/inputs_hash 等。
- ✅ **AI 助手生成 INSPIRE 查询语法**：Query template + Search API + grounded rerank 已落地。
- ✅ **主题聚类可视化**：Recommend 结果提供主题 chips 过滤与浏览。

#### 12.2.1 （Stopgap）Deep Read：插件内的“少量论文 embeddings 细读”

> Status: Implemented（v2.5.0+）
>
> 目标：在 `hep-research-mcp` 的全文 evidence/embeddings/可复现写作流水线尚未完全落地前，先在 Zotero 内提供一个 **小规模、可控、尽量不膨胀依赖** 的“细读”能力，用于追问时快速对照原文片段。

**用户体验**

- 在 `AI…` 对话框的 Follow-up 行勾选 `Deep Read` 后，插件会：
  1. 读取 **当前选中** 的 Zotero items（最多 5 篇；未选中则使用 seed item）
  2. 对每篇优先取 PDF 的 `.zotero-ft-cache`（若无则回退 abstract）
  3. 本地切块 + hashing embeddings（完全本地、确定性、零模型依赖）
  4. 对问题做同样的 embedding，计算相似度，挑选 top‑K 片段
  5. **仅把这些片段（而不是整篇全文）** 发送给第三方 LLM 生成回答
  6. 在输出中附带 `Deep Read evidence (sent to LLM)` 列表，便于用户核对与回放

**实现要点（当前代码）**

- hashing embeddings：`src/modules/inspire/llm/localEmbeddings.ts`
- Follow-up deep read：`src/modules/inspire/panel/AIDialog.ts`（`Deep Read` checkbox + `buildDeepReadEvidence()`）
- 片段来源：
  - 优先：Zotero Fulltext cache（`Zotero.Fulltext.getItemCacheFile()` / `.zotero-ft-cache`）
  - 回退：INSPIRE abstract（`fetchInspireAbstract()`）或 Zotero `abstractNote`

**边界与局限（明确告诉用户）**

- 这是 **hashing（稀疏）向量**，语义能力有限；它的定位是“够用的 baseline/兜底”，不是研究级 semantic search。
- PDF cache 可能包含页眉页脚/断词等噪声；片段命中不保证完美，需要用户在 Zotero 里点回原文核对。
- Deep Read 仍然会把 **命中的片段文本** 发送给所选 LLM provider；如果选中条目里混入了非公开文档，用户需要自行把控。

**与 hep-research-mcp 的衔接（后续演进）**

- 当 MCP 端具备 evidence catalog + 真正的 embeddings + rerank/NLI 后：
  - Zotero 插件的 Deep Read 可以退化为“快速模式”，或仅作为 MCP 不可用时的 fallback
  - 复杂检索/跨多篇写作/冲突分析应迁移到 MCP（证据可回放、产物可复现）

### 12.3 （可选高级）利用文献库做 Library Q&A（需预算/用量提示）

> Status: Implemented（新增 `Library Q&A` tab：local-first 检索→精选上下文→回答；避免“一次性上传大量 PDF”，并配套预算/用量提示与最小化发送策略）

我们已有两类“库级优势”：

1. Zotero 库里**可结构化的题录/标签/笔记**（低隐私风险、低 token）
2. Zotero 的**全文索引/附件体系**（信息密度高，但隐私/成本更敏感）

因此更建议做的是：**Chat with Library（检索→精选上下文→回答）**，而不是“大规模多模态上传 PDF”。

#### 目标（用户能得到什么）

- 对“我的文献库/某个 Collection”的问题进行问答，并给出**可点击的来源引用**（Zotero link / citekey / recid）。
- 每次回答都显示 **本次 turn 的 token 用量（in/out/total）**：优先使用 provider 返回的 usage；没有则给出估算 + 免责声明。

#### UI 方案（最小可用）

在现有 `AI…` 对话框新增一个 tab：`Library Q&A`，包含：

- Scope：`Current item` / `Current collection` / `My Library`（可选扩展：Saved Search / Tag）
- Context toggles：`titles`（默认 on）/ `abstracts`（默认 off）/ `my notes`（默认 off）/ `fulltext snippets`（默认 off）
- Retrieval：`topK`（默认 12）、`snippetsPerItem`（默认 1）、`snippetChars`（默认 800）
- Budget preview：`Estimated input tokens` + `Max output tokens` + “可能费用”提示（仅提示，不强依赖计价）
- Answer footer：`Usage: in/out/total tokens` +（可选）`latency` + “Copy/Save/Export”

#### 检索与上下文构建（不上传全文）

1. **检索（local-first）**
   - 在 scope 内用本地字段检索：title/creator/year/tag/notes（Zotero Search）。
   - （可选）使用 Zotero 全文索引拿到“命中片段”；只取少量 snippet，不把整篇 PDF 发给 LLM。
2. **上下文打包**
   - 对每个候选 item 构造一个最小 record：`title/authors/year`、`zotero_link`、`abstract/note_snippet/fulltext_snippet`（可选、截断）
   - 严格限制：`topK * snippetChars`；并提供“将发送内容预览”（与 12.1 的“发送内容预览”一致）
3. **回答与引用**
   - system prompt 强制：只允许引用候选集中的条目，并以 `[Z#]` 标注来源（插件为 `[Z#]` 提供可点击的 Zotero/INSPIRE 链接定义）。
   - 插件做校验：不在候选集的引用标记为 `unverified`。

#### Token 用量展示（必须）

- **优先方案（准确）**：provider 返回 `usage` 时直接展示并记录：
  - UI：`Usage (this turn): in X / out Y / total Z`
  - Note/front matter：`usage_input_tokens`、`usage_output_tokens`、`usage_total_tokens`、`latency_ms`
- **降级方案（估算）**：无 usage 时用“字符数→token 粗估”，并明确标注为 estimate：
  - `tokens_est ≈ chars / 4`（英文）与 `≈ chars / 2`（CJK）+ 固定开销

### 12.4 调研：插件调用 MCP 的可行性与方案（含 hep-research-mcp 协同）

> Status: Planned（技术上可行；对 `hep-research-mcp`（stdio-only）优先推荐“最小桥接/外部 runner/文件投递”；Streamable HTTP 仅适用于**本身提供 HTTP transport** 的 MCP server）

MCP（Model Context Protocol）是基于 JSON-RPC 2.0 的“工具协议”，把外部能力以统一的 `tools/list`、`tools/call` 暴露给客户端/模型。

定位建议：`zotero-inspire` 负责 **Zotero 内的轻量交互与快速产出**（浏览/筛选/导入/简单总结/可追溯导出），`hep-research-mcp` 负责 **重计算/长链路/证据优先**（全文证据、embeddings、冲突/张力、可复现写作流水线）。

#### 12.4.1 不改插件协议的“最小桥接”（已可用，最稳）

- **“从 Zotero 选中 → MCP Run”**：Zotero 内导出 `{itemKey, recid, arXiv, doi}` 列表（JSON/剪贴板/本地文件），MCP 用 `hep_import_from_zotero` / `hep_run_build_*` 接管后续。
- **双向追溯**：MCP 导出 `run_id/project_id/hep://` URI 回写到 Zotero note/front matter；Zotero 侧提供一键打开对应 artifacts（或复制 URI 到 MCP 客户端）。

#### 12.4.2 插件直接调用 MCP（可行，但需要按 transport 选型）

- **Streamable HTTP（仅当 server 支持时）**：插件用 `fetch` 向 MCP server 发 JSON-RPC 请求；需要流式时再解析 SSE/ReadableStream。
- **STDIO（对 hep-research-mcp 是硬约束，但对插件是工程难点）**：插件在本机拉起 MCP server 进程并走 stdio 管道（跨平台/权限/签名策略不确定），更建议先用“外部 runner”把 stdio 细节封装起来。

建议落地路径（先易后难）：

1. Preferences/Profiles 增加 MCP server 配置（可多个）：`name`、`url`、`headers/auth`（可选）、`tool_allowlist`（可选）
2. 新增 `MCP Tools` tab：`Connect` → `tools/list`；选择 tool + 填 args（JSON）→ `tools/call`
3. 将 tool result 以“引用块”插入到当前 prompt（可控且易 debug）
4. （可选）再做 “LLM 自动调用 MCP 工具（agent loop）”：需要把 MCP 工具 schema 映射到各 provider 的 tool-calling 机制，并增加危险操作确认与脱敏日志

安全注意：

- 对每个 MCP server 做显式“信任/允许”提示，默认不启用。
- 只允许调用 allowlist 的 tool；对可能触发网络/文件/执行的 tool 增加二次确认。
- 把 MCP 输出当作不可信数据（同 prompt-injection 规则），不要直接把“工具输出中的指令”当作 system 指令执行。
