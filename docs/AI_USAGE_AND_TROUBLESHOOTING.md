# AI 功能使用与排障手册（Zotero INSPIRE 插件）

本文件描述插件内 AI 功能的使用步骤（从配置到生成输出）、快捷键，以及“点了没输出/不知道哪里错了”时的排障路径。

---

## 1. 入口

插件提供三个入口（取决于你当前的使用场景）：

1) **INSPIRE 面板内**：面板标题栏中的 `AI` 按钮会打开 AI 对话框（这是最推荐入口）。  
2) **Zotero 主窗口工具栏**：Search 框左侧有一个 `AI` 图标按钮（会用当前选中的条目打开 AI）。  
3) **AI 对话框顶部**：Profile 区域旁边的 `Keys…` 可打开 Key 管理器。

注意：工具栏 `AI` 按钮会使用 **当前选中的条目**。如果没选中条目、或条目没有 INSPIRE recid，会弹窗提示并终止。

---

## 2. Profile 与提供商（Provider）

AI 请求由一个 **Profile** 决定，Profile 由以下字段组成：

- `Provider`：`openaiCompatible` / `anthropic` / `gemini`
- `Base URL`：通常是 API 基地址（OpenAI-compatible 一般以 `/v1` 结尾）
- `Model`：模型名

常见 OpenAI-compatible 例子：

- OpenAI：`https://api.openai.com/v1`
- DeepSeek：`https://api.deepseek.com/v1`（必须带 `/v1`，否则会拼出错误的 `/chat/completions` 路径）
- 本地 Ollama：`http://localhost:11434/v1`

提示：插件内部会把 OpenAI-compatible 的 `Base URL` 拼成 `.../chat/completions`（除非你直接填了完整 endpoint，已经以 `/chat/completions` 结尾）。

### 2.1 Profile 的创建/切换

- `Add`：按预设创建一个 profile，并设为当前 profile
- Profile 下拉：切换当前 profile
- `Delete`：删除当前 profile（不会自动删除你在 Secure Storage/Preferences 里保存的 key，建议用 `Keys…` 清理）

---

## 3. API Key 的存储与管理

插件会尽可能把 key 存到 **更安全的存储**：

- **Secure Storage**：Zotero 底层的 LoginManager（通常没有独立 UI，但 Zotero 自己会用它存同步/WebDAV 凭据）。
- **Preferences**：如果 Secure Storage 不可用，则落到 Preferences（Config Editor）中。

### 3.1 在 AI 对话框里保存 key

1) 打开 AI 对话框  
2) 在顶部输入 `API key`  
3) 点 `Save`  
4) 保存成功后输入框会被清空（安全考虑）  
5) 看底部状态栏与 key 信息行：应显示 `API key: OK (...)`

### 3.2 用 Key Manager 统一管理所有 Profile 的 key

1) 在 AI 对话框顶部点 `Keys…`  
2) 每个 Profile 一行，显示：
   - 是否 `Set/Not set`
   - 存储位置：`Secure Storage` 或 `Preferences`
   - 若是 Preferences，会显示具体的 Config Editor key（用于你手动核对）
3) 点 `Set…/Replace…` 后，会出现输入框 + `Save` + `Cancel`

### 3.3 Preferences 存储时如何找到对应条目

当 Key Manager 显示为 Preferences，它会直接告诉你完整 pref key（例如类似）：

- `extensions.zotero.inspiremeta.ai_api_key_profile_openaiCompatible_profile_xxx`

你也可以在 Zotero 的 Config Editor 里搜索：

- `extensions.zotero.inspiremeta.ai_api_key_`
- `ai_api_key_profile_`

---

## 4. 快速开始：生成第一段 Summary

1) 在 Zotero 中选中一个 **包含 INSPIRE recid** 的条目  
2) 打开 AI 对话框（优先用 INSPIRE 面板内的 `AI` 按钮）  
3) 选择或 `Add` 一个 profile（例如 DeepSeek/OpenAI/Claude/Gemini）  
4) 填 `API key` → 点 `Save`（或用 `Keys…` 管理）  
5) 点 `Test`：看到 `Test OK` 再继续  
6) 在 `Summary` 页点击 `Generate`（或 `Ctrl/Cmd+Enter`）  
7) 输出会写入左侧 `AI output (Markdown)…`，右侧即时预览  
8) 需要保存：点底部 `Save as Note`（或 `Ctrl/Cmd+S`）

如果第 6 步没有任何输出，直接看第 7 节排障。

---

## 5. 各功能页说明

### 5.1 Summary

- `Preview`：预览将发送给模型的 System/User 内容（用于检查“到底送了什么”）
- `Generate`：完整模式（引用更多、可包含摘要）
- `Fast`：快速模式（更少引用、更快更省）
- `AutoPilot`：对当前 Zotero 选中条目批量生成并保存 Note（会弹确认）
- `Follow-up question` + `Ask`：基于当前 summary/上下文追问
- `Deep Read`（追问旁）：从选中的论文（PDF/摘要）用本地检索挑片段，再只用这些片段向模型提问（仍需要 API key，但不会上传整篇 PDF）

### 5.2 Recommend

目标：从 INSPIRE 检索候选论文，再让模型在候选集合内做“有约束的推荐”（Grounded）。

- `Generate Queries`：让模型生成 INSPIRE 查询（写入下面的查询框）
- `Search + Rerank`：执行查询→拉候选→用 rerank 模板输出分组推荐
- `Include Related`：额外加入 Related Papers 作为候选来源
- 右侧结果里如有 `Import`：可把推荐论文导入 Zotero（会走同样的保存目标选择流程）

### 5.3 My Notes

- 左侧写 Markdown，右侧预览  
- 这部分不会调用模型（纯本地）

### 5.4 Templates

用于改 prompt（内置模板只读；用户模板可编辑/导入导出）。

- 占位符：`{seedTitle} {seedRecid} {seedCitekey} {seedAuthorYear} {userGoal} {outputLanguage} {style} {citationFormat}`
- `Run`：对某些 scope 的模板可以直接触发生成（例如 summary/inspireQuery/followup）

### 5.5 Library Q&A

目标：对你自己的 Zotero 条目做“检索 + 引用”的问答（本地检索，不需要额外部署向量库）。

- `Scope`：Current item / Current collection / My Library
- 勾选：Titles / Abstracts / My notes / Fulltext snippets
  - `Fulltext snippets` 依赖 Zotero 的全文索引与 PDF 可用；只抽取少量片段，不会上传整篇
- `Preview`：预览会发送什么（含命中的条目/片段数量）
- `Ask` / `Fast` / `Ask (stream)`：不同询问方式（取决于 UI 显示）
- `Save Note`：保存为 Zotero note；`Copy`/`Export .md…` 同理

---

## 6. 窗口操作与快捷键

### 6.1 窗口

- **拖动**：按住 AI 对话框顶部栏拖动
- **缩放**：从窗口右下角拖动缩放
- `Esc`：关闭预览层/关闭对话框

### 6.2 常用快捷键（AI 对话框内）

- `Ctrl/Cmd+Enter`：Summary → Generate
- `Ctrl/Cmd+Shift+Enter`：Summary → Fast
- `Ctrl/Cmd+P`：Preview（Summary / Library Q&A）
- `Ctrl/Cmd+S`：Save as Note（Summary / Library Q&A）
- `Ctrl/Cmd+E`：Export .md
- `Ctrl/Cmd+Shift+C`：Copy（Summary 导出 / Library Q&A）
- `Ctrl/Cmd+1..5`：切换 Summary/Recommend/My Notes/Templates/Library Q&A

---

## 7. “点了没输出”——最短排障路径

请按顺序做（不要跳步）：

### Step A：先看状态栏（底部一行字）

AI 对话框底部会显示状态（例如 `API key: not set`、`Missing API key...`）。

如果提示缺 key：

- 去顶部输入 key 后点 `Save`；或打开 `Keys…` 给当前 profile 设置 key

### Step B：点 `Test`

`Test` 是最快的“网络 + key + baseURL + model”验证：

- `Test OK`：说明至少能成功请求一次模型
- `Test failed: ...`：按错误信息处理（见第 5 节）

### Step C：确认条目有 INSPIRE recid

AI 对话框对 INSPIRE 工作流依赖 recid（用于拉引用/摘要等）。  
如果条目没有 recid，会出现类似 `Missing INSPIRE recid` 的状态。

如果工具栏 AI 按钮弹窗提示没有 recid：请先用 INSPIRE 工作流给条目写入/更新 recid（例如通过 INSPIRE 面板导入/刷新）。

### Step D：用 `Copy Debug` 把信息贴出来

如果仍然“没输出但也看不出原因”：

1) 在 AI 对话框底部点 `Copy Debug`
2) 把剪贴板内容贴出来（包含当前 profile、是否有 key、模型、baseURL 等关键信息）

---

## 8. 常见错误与含义

下面这些信息会出现在 `Test` 或运行时的状态栏中：

- **401 unauthorized**：API key 错/过期/没权限
- **403 forbidden**：账号/模型权限不足，或服务端拒绝
- **404**：Base URL 少了 `/v1`（OpenAI-compatible 最常见），或走错 endpoint
- **429 rate_limited**：触发限流；稍后重试或降低频率
- **Network error**：网络不通/代理/证书/被拦截

对 OpenAI-compatible 来说，最常见是：

- Base URL 没带 `/v1`（例如 DeepSeek）
- Model 名写错（服务端返回 400/404/invalid model）
