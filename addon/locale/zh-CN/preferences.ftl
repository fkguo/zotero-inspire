pref-meta = 为新条目获取 INSPIRE 元数据
pref-citekey = 使用 INSPIRE 引用键
pref-extra-order = Extra 字段顺序
pref-arxiv-tag = arXiv 主分类标签
pref-refs-panel = 引用面板
pref-reader-history = 阅读器视图导航
pref-nofound = 未找到 INSPIRE 记录
pref-latex-label = 摘要 LaTeX：
pref-latex-mode-unicode = Unicode
    .tooltiptext = 使用 Unicode 字符显示简单公式，轻量渲染
pref-latex-mode-katex = KaTeX（默认）
    .tooltiptext = 使用 KaTeX 高保真渲染复杂 LaTeX 公式
pref-latex-mode-description = KaTeX 可渲染分数、积分、矩阵等复杂公式。仅在获取摘要时有效。

pref-enable =
    .label = 启用

meta-full =
    .label = 包含摘要
meta-noabstract =
    .label = 不含摘要
meta-citations =
    .label = 仅引用次数
meta-no =
    .label = 禁用

citekey-inspire =
    .label = INSPIRE 引用键
citekey-no =
    .label = 禁用

extra-order-citations-first =
    .label = 引用次数优先
extra-order-arxiv-first =
    .label = arXiv ID 优先

pref-cites-column-exclude-self =
    .label = Cites 列：不含自引
pref-cites-column-exclude-self-desc = 在可用时使用不含自引的引用次数。若主列表未刷新，可切换集合或重启 Zotero。

pref-arxiv-in-journal-abbrev =
    .label = （兼容）将 arXiv 号写入 Journal Abbr.
pref-arxiv-in-journal-abbrev-desc = 对未发表论文，将 `arXiv:...` 写入 Journal Abbreviation 字段。

pref-arxiv-tag1 =
    .label = 添加 arXiv 主分类作为标签（如 hep-ph、nucl-th）

pref-max-authors-label = 最大显示作者数：
pref-max-authors-desc = 引用面板中显示 "et al." 前的作者数量（默认：3）

pref-chart-enable =
    .label = 启用统计图表
pref-chart-enable-desc = 在面板顶部显示交互式统计图表（按年份/引用）。
pref-chart-default-collapsed =
    .label = 默认折叠

pref-related-papers-enable =
    .label = 启用“相关论文”标签页
pref-related-papers-enable-desc = 在面板中显示“相关”标签页，推荐与当前论文共享参考文献的论文。

pref-related-papers-exclude-reviews =
    .label = 排除综述论文
pref-related-papers-exclude-reviews-desc = 在“相关”推荐中隐藏综述论文（INSPIRE document_type 包含 review，或发表于 RMP / Phys. Rep. / PPNP / Rep. Prog. Phys. / Annual Reviews 等综述期刊）。

pref-related-papers-max-results-label = 相关论文显示数量：
pref-related-papers-max-results-desc = “相关”标签页最多显示多少条（默认：50）。

pref-citation-graph-max-results-label = 引用关系图显示数量：
pref-citation-graph-max-results-desc = 引用关系图中参考文献/被引文献最多显示多少条（默认：25）。

pref-keyboard-shortcuts-title = 键盘快捷键
pref-keyboard-shortcuts-desc = 使用键盘导航和操作条目
pref-keyboard-shortcuts-nav = ↑/↓ 或 j/k：导航条目 · Home/End：跳转到首项/末项 · ←/→：后退/前进
pref-keyboard-shortcuts-action = Enter：打开 PDF 或选中条目 · Space/l：切换关联 · Ctrl+C：复制 BibTeX
pref-keyboard-shortcuts-tab = Tab/Shift+Tab：切换标签页 · Escape：清除焦点

pref-search-history-clear =
    .label = 清除搜索历史
pref-search-history-cleared = 历史已清除
pref-search-history-days-label = 保留搜索历史（天）：

pref-pdf-fuzzy-citation =
    .label = 模糊引用检测（实验性）
pref-pdf-fuzzy-citation-desc = 当 PDF 文本层损坏时（如括号截断）启用激进模式匹配。可能导致误检。

pref-pdf-parse-refs-list =
    .label = 解析 PDF 引用列表（修复多引用对齐问题）
pref-pdf-parse-refs-list-desc = 当 INSPIRE 标签缺失时，扫描 PDF 的参考文献部分以确定引用边界。如果点击 [21] 跳转到 [20] 的第二篇论文，请启用此选项。
pref-pdf-force-mapping =
    .label = 当 INSPIRE 不同时强制使用 PDF 映射
pref-pdf-force-mapping-desc = 如果 PDF 和 INSPIRE 引用列表不一致（如 arXiv 版本与发表版本），优先使用 PDF 派生的映射，跳过索引回退以避免错误跳转。

pref-reader-auto-reopen =
    .label = 前进/后退导航时重新打开阅读器标签页
pref-reader-auto-reopen-desc = 启用后，如果阅读器标签页已关闭，在使用前进或后退导航时将自动重新打开。

pref-ai = AI
pref-ai-desc = 配置 AI Summary 与 Library Q&A 的行为。API key 请在 AI 对话框中管理。

pref-ai-summary-title = Summary（综述）
pref-ai-output-language-label = 输出语言：
pref-ai-output-language-auto =
    .label = 自动
pref-ai-output-language-en =
    .label = 英文
pref-ai-output-language-zh =
    .label = 中文（zh-CN）

pref-ai-style-label = 风格：
pref-ai-style-academic =
    .label = 学术
pref-ai-style-bullet =
    .label = 要点列表
pref-ai-style-grant-report =
    .label = 基金/项目报告
pref-ai-style-slides =
    .label = 幻灯片

pref-ai-citation-format-label = 引用格式：
pref-ai-citation-format-latex =
    .label = LaTeX（\\cite{"{"}...{"}"}）
pref-ai-citation-format-markdown =
    .label = Markdown（[key](url)）
pref-ai-citation-format-inspire-url =
    .label = INSPIRE 链接
pref-ai-citation-format-zotero-link =
    .label = Zotero 链接

pref-ai-max-output-tokens-label = 最大输出 tokens：
pref-ai-max-output-tokens-desc = 值越大输出越长，但更慢也更贵。
pref-ai-temperature-label = 温度：
pref-ai-temperature-desc = 为兼容 Zotero prefs 用百分比存储：20=0.2（范围 0–200 → 0.00–2.00）。
pref-ai-max-refs-label = 最大参考文献数：
pref-ai-max-refs-desc = 从 References 列表中采样进入 prompt 的条目数。
pref-ai-abstract-char-limit-label = 摘要截断长度：
pref-ai-abstract-char-limit-desc = 每条摘要在发送给模型前会截断到该字符数。

pref-ai-include-seed-abstract =
    .label = 包含 seed 摘要
pref-ai-include-ref-abstracts =
    .label = 包含参考文献摘要
pref-ai-streaming =
    .label = 流式输出（若支持）

pref-ai-cache-enable =
    .label = 本地缓存 AI 输出
pref-ai-cache-enable-desc = 使用“本地缓存”目录；不会保存 API key。
pref-ai-cache-ttl-label = 缓存有效期：
pref-ai-cache-ttl-desc = 缓存 AI 输出在过期前保留的时长。

pref-ai-autopilot-title = AutoPilot（批量）
pref-ai-autopilot-rpm-label = 每分钟请求数：
pref-ai-autopilot-rpm-desc = 批量生成时限速以减少 429/成本。
pref-ai-autopilot-max-items-label = 每次最大条目数：
pref-ai-autopilot-max-items-desc = 批量生成的安全上限。

pref-ai-library-qa-title = Library Q&A（库内问答）
pref-ai-library-qa-scope-label = 范围：
pref-ai-library-qa-scope-current-item =
    .label = 当前条目
pref-ai-library-qa-scope-current-collection =
    .label = 当前集合
pref-ai-library-qa-scope-library =
    .label = 我的文库
pref-ai-library-qa-include-titles =
    .label = 标题
pref-ai-library-qa-include-abstracts =
    .label = 摘要
pref-ai-library-qa-include-notes =
    .label = 我的笔记
pref-ai-library-qa-include-fulltext-snippets =
    .label = 全文片段
pref-ai-library-qa-top-k-label = Top K 条目：
pref-ai-library-qa-top-k-desc = 最多纳入上下文的条目数（最大 30）。
pref-ai-library-qa-snippets-per-item-label = 每条目片段数：
pref-ai-library-qa-snippets-per-item-desc = 每个条目最多加入多少片段（最大 3）。
pref-ai-library-qa-snippet-chars-label = 片段长度：
pref-ai-library-qa-snippet-chars-desc = 每个片段的字符上限。

pref-nofound-enable =
    .label = 为没有 INSPIRE 记录的条目添加标签
pref-nofound-tag-label = 标签名称：

pref-local-cache = 本地缓存
pref-local-cache-enable =
    .label = 启用本地缓存以支持离线访问
pref-local-cache-enable-desc = 将引用和被引数据缓存到磁盘。加快加载速度并支持离线浏览。
pref-local-cache-show-source =
    .label = 在面板中显示缓存来源指示器
pref-local-cache-ttl-label = 缓存过期时间（被引数据）：
pref-local-cache-ttl-unit = 小时
pref-local-cache-ttl-desc = 被引和作者论文数据的保留时间。引用数据永久缓存。
pref-local-cache-dir-label = 存储位置：
pref-local-cache-dir-browse =
    .label = 浏览...
pref-local-cache-dir-reset =
    .label = 重置
pref-local-cache-dir-desc = 留空则使用默认位置（Zotero 数据目录）。自定义目录不会与 Zotero 同步。
pref-local-cache-compression =
    .label = 压缩缓存文件（gzip）
pref-local-cache-compression-desc = 对大型缓存文件减少约 80% 的磁盘使用。建议引用较多的用户启用。
pref-local-cache-enrich-title = 元数据补全
pref-local-cache-enrich-desc = 控制补全引用元数据时并行获取的 INSPIRE 记录数量。
pref-local-cache-enrich-batch-label = 批量大小：
pref-local-cache-enrich-parallel-label = 并行请求：
pref-local-cache-enrich-hint = 较大的值更快但可能触发 INSPIRE 错误（HTTP 502/400）。允许范围：25-110 条，1-5 个请求。
pref-local-cache-enrich-info = 当前：{ $batch } 条 / { $parallel } 个请求。默认值：{ $defaultBatch } 条 / { $defaultParallel } 个请求。
pref-local-cache-clear =
    .label = 清除缓存
pref-local-cache-cleared = 缓存已清除（{ $count } 个文件）
pref-local-cache-stats = { $count } 个文件，{ $size }

pref-smart-update = 智能更新
pref-smart-update-enable =
    .label = 启用智能更新模式
pref-smart-update-enable-desc = 仅更新已变更的字段。保留用户编辑内容，更新前显示预览。
pref-smart-update-preview =
    .label = 更新前显示预览对话框
pref-smart-update-preview-desc = 查看检测到的变更并选择要更新的字段。
pref-smart-update-auto-check =
    .label = 选中条目时自动检查更新
pref-smart-update-auto-check-desc = 选中条目时自动从 INSPIRE 检查新元数据。如发现变更则显示更新通知。
pref-smart-update-protect-title = 受保护字段
pref-smart-update-protect-desc = 如果您已输入数据，则跳过这些字段（不会覆盖您的编辑）。
pref-smart-update-protect-field-title =
    .label = 标题
pref-smart-update-protect-field-authors =
    .label = 作者
pref-smart-update-protect-field-abstract =
    .label = 摘要
pref-smart-update-protect-field-journal =
    .label = 期刊
pref-smart-update-protected-names-title = 受保护的作者姓名
pref-smart-update-protected-names-desc = 此列表中的作者姓名在更新时将被保留。带变音符号的姓名（如 ä、ö、ü、ß 等）会自动检测。
pref-smart-update-protected-names-input =
    .placeholder = 例如：Meißner, Müller, O'Brien

pref-preprint-watch = 预印本监控
pref-preprint-watch-enable =
    .label = 启用预印本发表状态监控
pref-preprint-watch-enable-desc = 检测库中未正式发表的 arXiv 预印本，并检查它们是否已正式发表。
pref-preprint-watch-startup =
    .label = Zotero 启动时自动检查
pref-preprint-watch-startup-desc = 每天首次启动时检查一次。如果 24 小时内已检查过，则跳过。
pref-preprint-watch-notify =
    .label = 发现已发表时显示通知
pref-preprint-watch-notify-desc = 当发现预印本已正式发表时显示通知。

pref-collab-tags = 合作组标签
pref-collab-tag-enable =
    .label = 启用合作组标签
pref-collab-tag-enable-desc = 根据 INSPIRE 合作组信息自动添加标签（如 ATLAS、CMS、LHCb）。
pref-collab-tag-auto =
    .label = 更新/导入时添加标签
pref-collab-tag-auto-desc = 从 INSPIRE 更新条目或导入时自动添加合作组标签。
pref-collab-tag-template-label = 标签格式：
pref-collab-tag-template-desc = 使用 {"{name}"} 作为合作组名称占位符。示例：{"{name}"}、#collab/{"{name}"}、collab:{"{name}"}

pref-funding-extraction = 基金提取
pref-funding-china-only =
    .label = 仅提取中国资助机构
pref-funding-china-only-desc = 启用后仅提取中国资助机构的基金信息（国自然、中科院、科技部等）。禁用则提取所有资助者（包括 DOE、NSF、ERC 等）。

pref-dev = 开发者
pref-dev-panel-layout =
    .label = 启用面板布局调试（Citing…）
pref-dev-panel-layout-desc = 输出 [PANEL-LAYOUT] 调试日志，并在面板状态栏显示“Copy layout”按钮（用于定位溢出/遮挡问题）。

pref-help = { $name } 版本 { $version } { $time }
