startup-begin = 插件正在加载
startup-finish = 插件已准备就绪
menuitem-label = 插件模板：辅助示例
menupopup-label = INSPIRE
menuitem-submenulabel0 = 包含摘要
menuitem-submenulabel1 = 不含摘要
menuitem-submenulabel2 = 仅引用次数
menuitem-download-cache = 下载引用缓存
menuitem-cancel-update = 取消更新

download-cache-progress-title = 正在下载引用缓存
download-cache-start =
  { $total ->
    [one] 正在准备 1 条缓存...
   *[other] 正在准备 { $total } 条缓存...
  }
download-cache-progress = 已缓存 { $done } / { $total } 条
download-cache-success =
  { $success ->
    [one] 已缓存 1 条引用
   *[other] 已缓存 { $success } 条引用
  }
download-cache-failed =
  { $failed ->
    [one] 1 条缓存失败
   *[other] { $failed } 条缓存失败
  }
download-cache-no-selection = 请选择至少一条常规条目以下载引用缓存
download-cache-no-recid = 无法找到所选条目的 INSPIRE ID
download-cache-disabled = 请在「首选项 → INSPIRE」中启用本地缓存以使用此功能
download-cache-cancelled-title = 缓存下载已取消
download-cache-cancelled = 取消前已缓存 { $done } / { $total } 条

pane-item-references-header = INSPIRE 引用
    .label = INSPIRE 引用
pane-item-references-sidenav = INSPIRE 引用
    .label = INSPIRE 引用
    .tooltiptext = INSPIRE 引用
references-panel-tab-references = 引用
references-panel-tab-cited = 被引
references-panel-tab-related = 相关
references-panel-tab-entry-cited = 引用...
references-panel-tab-author-papers = 作者
references-panel-citation-graph-button = 引用关系图…
references-panel-citation-graph-tooltip = 显示引用关系图（左键打开，右键展开）
references-panel-citation-graph-title = 引用关系图
references-panel-citation-graph-hint = 左键打开 · 右键展开
references-panel-citation-graph-title-multi = 引用关系图：{ $count } 个种子
references-panel-citation-graph-hint-multi = 左键打开 · 右键添加种子
references-panel-citation-graph-close = 关闭
references-panel-citation-graph-disabled-pdg = 已为 PDG《Review of Particle Physics》禁用引用关系图
references-panel-citation-graph-add-seed = + 添加种子
references-panel-citation-graph-seeds-title = 种子（{ $count }）
references-panel-citation-graph-seeds-hint = 点击 × 移除种子
references-panel-citation-graph-seed-remove = 移除种子
references-panel-citation-graph-seed-already-added = 该种子已添加
references-panel-citation-graph-add-seed-title = 添加种子论文
references-panel-citation-graph-add-seed-search-placeholder = 搜索 INSPIRE…
references-panel-citation-graph-add-seed-zotero-search-placeholder = 搜索 Zotero…
references-panel-citation-graph-add-seed-search = 搜索
references-panel-citation-graph-add-seed-add = 添加
references-panel-citation-graph-add-seed-from-zotero = 来自 Zotero
references-panel-citation-graph-add-seed-no-zotero = 请选择带有 INSPIRE ID 的 Zotero 条目作为种子。
references-panel-citation-graph-add-seed-zotero-search-hint = 输入以搜索 Zotero…
references-panel-citation-graph-add-seed-zotero-no-results = 未找到包含 INSPIRE ID 的 Zotero 条目。
references-panel-citation-graph-add-seed-from-inspire = 来自 INSPIRE 搜索
references-panel-citation-graph-add-seed-search-hint = 输入以搜索 INSPIRE…
references-panel-citation-graph-add-seed-no-results = 无结果
references-panel-citation-graph-save = 💾 保存▼
references-panel-citation-graph-export = 📤 导出▼
references-panel-citation-graph-load = 📥 加载
references-panel-citation-graph-save-to-data-dir = 保存到 Zotero 数据目录
references-panel-citation-graph-save-as = 另存为…
references-panel-citation-graph-save-file-title = 保存引用关系图
references-panel-citation-graph-save-no-data = 暂无可保存的数据
references-panel-citation-graph-save-dir-failed = 无法访问 Zotero 数据目录
references-panel-citation-graph-save-success = 已保存
references-panel-citation-graph-export-json = 导出 JSON（完整数据）…
references-panel-citation-graph-export-csv = 导出 CSV（节点）…
references-panel-citation-graph-export-svg = 导出 SVG…
references-panel-citation-graph-export-png = 导出 PNG…
references-panel-citation-graph-export-bibtex = 导出 BibTeX…
references-panel-citation-graph-export-file-title = 导出引用关系图
references-panel-citation-graph-export-success = 已导出
references-panel-citation-graph-export-failed = 导出失败
references-panel-citation-graph-export-bibtex-no-recid = 没有可导出的 INSPIRE recid
references-panel-citation-graph-load-from-file = 从文件加载…
references-panel-citation-graph-load-recent = 最近保存
references-panel-citation-graph-load-file-title = 加载引用关系图
references-panel-citation-graph-load-success = 已加载
references-panel-citation-graph-load-failed = 加载失败

citation-graph-merge-no-selection = 请选择至少两条带有 INSPIRE ID 的条目以合并引用关系图。
citation-graph-merge-truncated = 选择条目过多；仅使用前 { $count } 个种子。
references-panel-status-empty = 选择一条条目以加载 INSPIRE 数据
references-panel-reader-mode = 阅读器视图中不支持 INSPIRE 数据
references-panel-select-item = 请选择单个常规条目以查看 INSPIRE 数据
references-panel-no-recid = 未找到此条目的 INSPIRE 记录
references-panel-recid-found = INSPIRE 记录发现！正在加载引用...
references-panel-status-loading = 正在加载引用...
references-panel-status-loading-cited = 正在加载被引记录...
references-panel-status-loading-related = 正在发现相关论文...
references-panel-status-loading-related-progress = 正在发现相关论文... { $done }/{ $total }
references-panel-status-related-disabled-pdg = 已为 PDG《Review of Particle Physics》禁用“相关论文”
references-panel-status-loading-entry = 正在加载所选引用的被引记录...
references-panel-status-loading-author = 正在加载作者论文...
references-panel-status-error = 从 INSPIRE 加载数据失败
references-panel-status-stale-cache = 使用离线缓存（{ $hours }小时前）- 数据可能已过期
references-panel-empty-list = 暂无引用
references-panel-empty-cited = 未找到被引记录
references-panel-empty-related = 未找到相关论文
references-panel-empty-related-disabled-pdg = PDG《Review of Particle Physics》过于通用，已禁用“相关论文”推荐。
references-panel-entry-empty = 选择一条引用以查看被引记录
references-panel-author-empty = 未找到该作者的论文
references-panel-no-match = 没有条目符合当前筛选条件
references-panel-refresh = 刷新
references-panel-back = 后退
references-panel-back-tooltip = 返回上一条 Zotero 条目
references-panel-forward = 前进
references-panel-forward-tooltip = 前往下一条 Zotero 条目
references-panel-entry-back = 返回 { $tab }
references-panel-entry-back-tooltip = 返回上一视图
references-panel-entry-back-author = 返回 { $author }
references-panel-favorite-title = 收藏的作者
references-panel-favorite-empty = 暂无收藏的作者。点击作者资料中的 ☆ 添加。
references-panel-favorite-add = 添加到收藏
references-panel-favorite-remove = 从收藏中移除
references-panel-favorite-added = 已添加到收藏
references-panel-favorite-removed = 已从收藏中移除
references-panel-favorite-view = 查看所有收藏的作者
references-panel-favorite-papers-title = 收藏的论文
references-panel-favorite-papers-empty = 暂无收藏的论文。右键点击条目添加。
references-panel-favorite-paper-add = 收藏论文
references-panel-favorite-paper-remove = 取消收藏论文
references-panel-favorite-paper-added = 论文已收藏
references-panel-favorite-paper-removed = 论文已取消收藏
references-panel-favorite-presentations-title = 收藏的学术报告
references-panel-favorite-presentations-empty = 暂无收藏的报告。右键点击条目添加。
references-panel-favorite-presentation-add = 收藏报告
references-panel-favorite-presentation-remove = 取消收藏报告
references-panel-favorite-presentation-added = 报告已收藏
references-panel-favorite-presentation-removed = 报告已取消收藏
references-panel-filter-placeholder = 筛选条目
references-panel-quick-filters = 筛选
references-panel-quick-filter-high-citations = 高引用（>50）
references-panel-quick-filter-high-citations-tooltip = 显示引用次数超过 50 的论文
references-panel-quick-filter-recent-5y = 近 5 年
references-panel-quick-filter-recent-5y-tooltip = 仅显示最近 5 个日历年发表的论文
references-panel-quick-filter-recent-1y = 近 1 年
references-panel-quick-filter-recent-1y-tooltip = 仅显示当前日历年发表的论文
references-panel-quick-filter-non-review = 非综述论文
references-panel-quick-filter-non-review-tooltip = 隐藏综述论文（INSPIRE document_type 包含 review，或发表于 RMP / Phys. Rep. / PPNP / Rep. Prog. Phys. / Annual Reviews 等综述期刊）
references-panel-quick-filter-published = 已发表
references-panel-quick-filter-published-tooltip = 显示有期刊信息的论文（正式发表）
references-panel-quick-filter-preprint = 仅 arXiv
references-panel-quick-filter-preprint-tooltip = 显示仅有 arXiv 的论文（无期刊信息）
references-panel-quick-filter-related = 关联条目
references-panel-quick-filter-related-tooltip = 显示已关联到当前 Zotero 条目的引用
references-panel-quick-filter-local-items = 本地条目
references-panel-quick-filter-local-items-tooltip = 显示已存在于 Zotero 文库中的引用
references-panel-quick-filter-online-items = 在线条目
references-panel-quick-filter-online-items-tooltip = 显示尚未存入 Zotero 文库的引用
references-panel-sort-label = 排序方式
references-panel-sort-related = 相关度
references-panel-sort-default = INSPIRE 顺序
references-panel-sort-mostrecent = 最新发表
references-panel-sort-mostcited = 最多引用
references-panel-count =
  { $count ->
    [one] 1 条引用
   *[other] { $count } 条引用
  }
references-panel-count-cited =
  { $count ->
    [one] 1 条被引记录
   *[other] { $count } 条被引记录
  }
references-panel-count-related =
  { $count ->
    [one] 1 篇相关论文
   *[other] { $count } 篇相关论文
  }
references-panel-count-entry =
  { $count ->
    [one] 引用 "{ $label }" 的 1 条记录
   *[other] 引用 "{ $label }" 的 { $count } 条记录
  }
references-panel-count-author =
  { $count ->
    [one] { $label } 的 1 篇论文
   *[other] { $label } 的 { $count } 篇论文
  }
references-panel-filter-count =
  { $visible } / { $total } 条引用
references-panel-filter-count-cited =
  { $visible } / { $total } 条被引记录
references-panel-filter-count-related =
  { $visible } / { $total } 篇相关论文
references-panel-filter-count-entry =
  引用 "{ $label }" 的 { $visible } / { $total } 条记录
references-panel-filter-count-author =
  { $label } 的 { $visible } / { $total } 篇论文
references-panel-dot-local = 条目已存在于文库中
references-panel-dot-add = 添加此引用到文库
references-panel-related-badge-tooltip = 与当前论文共享 { $count } 条参考文献
references-panel-link-existing = 点击取消关联条目
references-panel-link-missing = 关联为相关条目
references-panel-toast-linked = 相关条目已关联
references-panel-toast-added = 引用已添加到文库
references-panel-toast-missing = 未在 INSPIRE-HEP 中找到文献
references-panel-toast-no-pdf = 此条目没有 PDF 附件
references-panel-toast-selected = 条目已在文库中选中
references-panel-toast-bibtex-success = BibTeX 已复制到剪贴板
references-panel-unknown-author = 未知作者
references-panel-year-unknown = 无日期
references-panel-no-title = 标题不可用
references-panel-picker-title = 保存到
references-panel-picker-filter = 筛选文献集
references-panel-picker-cancel = 取消
references-panel-picker-confirm = 完成
references-panel-picker-empty = 无可编辑的文献集
references-panel-picker-hint = 选择一个文库，然后切换一个或多个文献集。
references-panel-toast-unlinked = 已取消关联条目
references-panel-picker-tags = 标签（逗号分隔）
references-panel-picker-tags-title = 输入标签，用逗号或分号分隔
references-panel-picker-note = 笔记
references-panel-picker-note-title = 输入要添加到条目的笔记
references-panel-citation-count = 被引 { $count } 次
references-panel-citation-count-unknown = 查看被引记录
references-panel-entry-select = 选择一条引用条目以查看被引记录
references-panel-entry-label-default = 所选引用
references-panel-loading-abstract = 正在加载摘要...
references-panel-no-abstract = 暂无摘要
# Hover Preview Card (FTR-HOVER-PREVIEW)
references-panel-preview-loading = 正在加载详情...
references-panel-preview-abstract-truncated = [已截断]
references-panel-author-papers-label = { $author } 的论文
references-panel-author-click-hint = 点击查看 { $author } 的论文
references-panel-author-profile-loading = 正在加载作者信息...
references-panel-author-profile-unavailable = 暂无作者信息
references-panel-author-stats-loading = 正在加载统计数据...
references-panel-author-stats = { $papers } 篇论文 · { $citations } 次引用 · h-index：{ $h }
references-panel-author-stats-no-self = { $papers } 篇论文 · { $citations } 次引用（不含自引） · h-index：{ $h }
references-panel-author-stats-partial = 基于已加载 { $count } 篇论文
references-panel-author-advisors = 导师
references-panel-author-emails = 邮箱
references-panel-author-orcid-tooltip = 打开 ORCID 页面
references-panel-author-inspire-tooltip = 在 INSPIRE 中查看
references-panel-author-homepage-tooltip = 打开个人主页
references-panel-author-profile-collapse = 收起
references-panel-author-profile-expand = 展开
references-panel-author-preview-view-papers = 查看全部论文
references-panel-author-copied = 已复制
references-panel-author-orcid-label = ORCID
references-panel-author-bai-label = BAI
references-panel-author-recid-label = INSPIRE ID
references-panel-copy-bibtex = 复制 BibTeX
references-panel-copy-texkey = 复制 TeX Key
references-panel-pdf-open = 打开 PDF
references-panel-pdf-find = 查找全文
references-panel-pdf-finding = 正在查找全文...
references-panel-pdf-not-found = 未找到全文
references-panel-bibtex-copied = BibTeX 已复制到剪贴板
references-panel-bibtex-failed = 获取 BibTeX 失败
references-panel-texkey-copied = TeX Key 已复制到剪贴板
references-panel-texkey-failed = 获取 TeX Key 失败

# 摘要复制右键菜单
references-panel-abstract-copy = 复制
references-panel-abstract-copy-selection = 复制所选内容
references-panel-abstract-copy-latex = 复制为 LaTeX
references-panel-abstract-copied = 摘要已复制到剪贴板
references-panel-abstract-latex-copied = LaTeX 源码已复制到剪贴板

# 预览卡片操作按钮 (FTR-HOVER-PREVIEW)
references-panel-status-local = 本地库中
references-panel-status-online = 在线
references-panel-button-add = 添加到库
references-panel-button-link = 关联
references-panel-button-unlink = 取消关联
references-panel-button-select = 定位
references-panel-button-open-pdf = 打开 PDF

update-cancelled = 用户取消更新
update-cancelled-stats = 取消前已更新 { $completed }/{ $total } 条

zoteroinspire-refresh-button =
    .tooltiptext = 刷新 INSPIRE 数据
zoteroinspire-copy-all-button =
    .tooltiptext = 导出引用（BibTeX/LaTeX）
references-panel-bibtex-fetching = 正在获取条目...
references-panel-bibtex-all-copied = { $count } 条 BibTeX 已复制到剪贴板
references-panel-bibtex-all-failed = 获取条目失败
references-panel-no-recid-entries = 无 INSPIRE 记录可导出

# 导出菜单本地化字符串
references-panel-export-copy-header = 📋 复制到剪贴板
references-panel-export-file-header = 💾 导出到文件
references-panel-export-copy-texkey = 复制 citation key
references-panel-export-texkey-copying = 正在复制 citation key...
references-panel-export-texkey-copied = 已复制 { $count } 个 citation key
references-panel-export-texkey-failed = 复制 citation key 失败
references-panel-export-copied = 已复制 { $count } 条 { $format } 条目
references-panel-export-saved = 已保存 { $count } 条 { $format } 条目
references-panel-export-clipboard-failed = 复制到剪贴板失败（内容过大？）
references-panel-export-too-large = 内容过大（{ $size }KB）- 请改用「导出到文件」
references-panel-export-cancelled = 导出已取消
references-panel-export-save-title = 导出引用

# 引用样式导出（使用 Zotero 内置的参考文献对话框）
references-panel-export-citation-header = 📝 引用样式
references-panel-export-citation-copied = 已复制 { $count } 条格式化引用
references-panel-export-citation-no-local = 无可格式化的本地 Zotero 条目（仅支持本地库中的条目）
references-panel-export-citation-select-style = 选择引用样式...
references-panel-export-citation-import-needed = 需要先将 { $count } 条引用导入到 Zotero 库中。请选择目标文件夹。
references-panel-export-citation-importing = 正在导入 { $done } / { $total } 以供引用导出...
references-panel-export-citation-import-failed = 部分引用导入失败。{ $total } 条中仅 { $success } 条可格式化。

# 图表本地化字符串
references-panel-chart-collapse = 折叠图表
references-panel-chart-expand = 展开图表
references-panel-chart-by-year = 按年份
references-panel-chart-by-citation = 按引用
references-panel-chart-no-data = 无数据显示
references-panel-chart-clear-filter = 清除筛选
references-panel-chart-disabled-title = 图表已禁用
references-panel-chart-disabled-message = 统计图表已禁用。请在「Zotero 首选项 → INSPIRE」中启用。
references-panel-chart-author-filter = ≤10 作者
references-panel-chart-author-filter-tooltip = 筛选：仅显示作者数不超过 10 人的论文（排除大型合作组）
references-panel-chart-selfcite-filter = 排除自引
references-panel-chart-selfcite-filter-tooltip = 在「按引用」模式下使用不含自引的引用次数。
references-panel-chart-published-only = 已发表
references-panel-chart-published-only-tooltip = 筛选：仅显示有期刊信息的论文（排除仅有 arXiv 的论文）
references-panel-chart-total = 总计
references-panel-chart-filtered = 已筛选

# 速率限制本地化字符串
references-panel-rate-limit-tooltip = INSPIRE API 速率限制状态
references-panel-rate-limit-queued = { $count } 个请求排队中（速率限制生效）

# 搜索功能本地化字符串
references-panel-tab-search = 🔍 搜索
references-panel-search-placeholder = INSPIRE 搜索查询...
references-panel-search-button-tooltip = 执行 INSPIRE 搜索
references-panel-search-history-tooltip = 显示搜索历史
references-panel-search-clear-history = 清除搜索历史
references-panel-search-prompt = 输入搜索查询以搜索 INSPIRE
references-panel-search-empty = 未找到搜索结果
references-panel-search-label-default = 搜索结果
references-panel-status-loading-search = 正在搜索 INSPIRE...
references-panel-count-search =
  { $count ->
    [one] "{ $query }" 的 1 条结果
   *[other] "{ $query }" 的 { $count } 条结果
  }
references-panel-filter-count-search =
  "{ $query }" 的 { $visible } / { $total } 条结果

# 缓存来源指示器字符串
references-panel-cache-source-api = 来自 INSPIRE
references-panel-cache-source-memory = 来自内存缓存
references-panel-cache-source-local = 来自本地缓存（{ $age } 小时前）
references-panel-cache-source-local-expired = 来自过期缓存（{ $age } 小时前）- 离线模式

# 右键菜单复制操作
menuitem-copy-bibtex = 复制 BibTeX
menuitem-copy-inspire-link = 复制 INSPIRE 链接
menuitem-copy-citation-key = 复制引用键
menuitem-copy-zotero-link = 复制 Zotero 链接
copy-success-bibtex =
  { $count ->
    [one] 已复制 1 条 BibTeX
   *[other] 已复制 { $count } 条 BibTeX
  }
copy-success-inspire-link = INSPIRE 链接已复制到剪贴板
copy-success-citation-key =
  { $count ->
    [one] 已复制 1 个引用键
   *[other] 已复制 { $count } 个引用键
  }
copy-success-zotero-link = Zotero 链接已复制到剪贴板
copy-error-no-selection = 请选择单个条目以复制
copy-error-no-recid = 未找到此条目的 INSPIRE 记录 ID
copy-error-no-citation-key = 此条目未设置引用键
copy-error-clipboard-failed = 复制到剪贴板失败
copy-error-bibtex-failed = 从 INSPIRE 获取 BibTeX 失败

# 批量导入功能本地化字符串 (FTR-BATCH-IMPORT)
references-panel-batch-selected =
  { $count ->
    [one] 已选择 1 条
   *[other] 已选择 { $count } 条
  }
references-panel-batch-select-all = 全选
references-panel-batch-clear = 清除
references-panel-batch-import = 导入
references-panel-batch-importing = 正在导入 { $done } / { $total }...
references-panel-batch-import-success =
  { $count ->
    [one] 已导入 1 条引用
   *[other] 已导入 { $count } 条引用
  }
references-panel-batch-import-partial = 已导入 { $success } / { $total } 条引用（{ $failed } 条失败）
references-panel-batch-import-cancelled = 导入已取消（已完成 { $done } / { $total }）
references-panel-batch-no-selection = 请选择至少一条引用以导入
references-panel-batch-duplicate-title = 重复检测
references-panel-batch-duplicate-message =
  { $count ->
    [one] 1 条引用已存在于文库中：
   *[other] { $count } 条引用已存在于文库中：
  }
references-panel-batch-duplicate-match-recid = （按 INSPIRE ID 匹配）
references-panel-batch-duplicate-match-arxiv = （按 arXiv ID 匹配）
references-panel-batch-duplicate-match-doi = （按 DOI 匹配）
references-panel-batch-duplicate-skip-all = 跳过所有重复
references-panel-batch-duplicate-import-all = 仍然全部导入
references-panel-batch-duplicate-confirm = 确认选择
references-panel-batch-duplicate-cancel = 取消

# PDF 引用查找 (FTR-PDF-ANNOTATE)
pdf-annotate-lookup-button = 在引用中查找
pdf-annotate-not-found = 引用 [{ $label }] 不在此论文的 INSPIRE 引用列表中。如果它存在于 PDF 中但不在这里，请考虑向 INSPIRE 提交更正。
pdf-annotate-no-text-layer = 此 PDF 没有文本层，无法检测引用。

# 多标签匹配 (FTR-PDF-ANNOTATE-MULTI-LABEL)
pdf-annotate-multi-match =
  { $count ->
    [one] 找到 [{ $label }] 的 1 条记录
   *[other] 找到 [{ $label }] 的 { $count } 条记录
  }
pdf-annotate-multi-match-truncated = 找到 [{ $label }] 的 { $count } 条记录（显示前 { $shown } 条）
pdf-annotate-fallback-warning = INSPIRE 引用可能与 PDF 不同（标签匹配率：{ $rate }%）。使用位置匹配；请考虑向 INSPIRE 提交更正。
pdf-annotate-parse-success = 已解析 PDF 引用：{ $total } 条（{ $multi } 条多论文引用）

# 智能更新功能 (FTR-SMART-UPDATE)
smart-update-untitled = （无标题）
smart-update-value-empty = （空）
smart-update-field-title = 标题
smart-update-field-date = 日期
smart-update-field-journal = 期刊
smart-update-field-volume = 卷
smart-update-field-pages = 页码
smart-update-field-issue = 期号
smart-update-field-abstract = 摘要
smart-update-field-doi = DOI
smart-update-field-arxiv = arXiv
smart-update-field-citations = 引用次数
smart-update-field-citations-wo-self = 引用次数（不含自引）
smart-update-field-citekey = 引用键
smart-update-field-collaboration = 合作组
smart-update-field-authors = 作者

# 智能更新预览对话框
smart-update-preview-title = 智能更新预览
smart-update-preview-header = { $title } 的变更
smart-update-preview-info = 选择要更新的字段。取消勾选可跳过该字段。
smart-update-preview-current = 当前值
smart-update-preview-new = 新值
smart-update-preview-apply = 应用
smart-update-preview-cancel = 取消
smart-update-preview-no-changes = 未检测到此条目的变更。

# 自动检查更新通知 (FTR-SMART-UPDATE-AUTO-CHECK)
smart-update-auto-check-available = INSPIRE 有可用更新
smart-update-auto-check-view = 查看变更
smart-update-auto-check-dismiss = 忽略
smart-update-auto-check-changes =
  { $count ->
    [one] 1 个字段有新数据
   *[other] { $count } 个字段有新数据
  }

# 多义引用选择器 (FTR-AMBIGUOUS-AUTHOR-YEAR)
pdf-annotate-ambiguous-title = "{ $citation }" 有多个匹配
pdf-annotate-ambiguous-message = 此引用匹配多篇论文。请选择正确的一篇：
pdf-annotate-ambiguous-cancel = 取消
pdf-annotate-ambiguous-preview-hint = 仅作者-年份匹配；点击选择

# 预印本监控功能 (FTR-PREPRINT-WATCH)
preprint-check-menu = 检查预印本状态
preprint-check-collection-menu = 检查该分类中的预印本
preprint-check-all-menu = 检查全部预印本
preprint-check-progress = 正在检查预印本... ({ $current }/{ $total })
preprint-check-scanning = 正在扫描库中的预印本...
preprint-check-cancelled = 检查已取消
preprint-found-published =
  { $count ->
    [one] 发现 1 篇预印本已正式发表！
   *[other] 发现 { $count } 篇预印本已正式发表！
  }
preprint-all-current = 所有预印本均未正式发表。
preprint-no-preprints = 未找到未发表的预印本。
preprint-update-success =
  { $count ->
    [one] 成功更新 1 个条目。
   *[other] 成功更新 { $count } 个条目。
  }
preprint-update-selected = 更新所选
preprint-select-all = 全选
preprint-cancel = 取消
preprint-doi-updated = DOI 已更新: { $oldDoi } → { $newDoi }
preprint-results-published = 已发表
preprint-results-unpublished = 未发表
preprint-results-errors = 错误

# Collaboration Tags feature (FTR-COLLAB-TAGS)
collab-tag-menu-add = 添加合作组标签
collab-tag-menu-reapply = 重新应用合作组标签
collab-tag-progress = 正在添加合作组标签...
collab-tag-result =
  { $added ->
    [0] { $updated ->
      [0] 无更改
      [one] 更新了 1 个标签
     *[other] 更新了 { $updated } 个标签
    }
    [one] 添加了 1 个标签{ $updated ->
      [0] {""}
     *[other] ，更新了 { $updated } 个
    }
   *[other] 添加了 { $added } 个标签{ $updated ->
      [0] {""}
     *[other] ，更新了 { $updated } 个
    }
  }{ $skipped ->
    [0] {""}
   *[other] ，跳过 { $skipped } 个
  }
collab-tag-no-selection = 请至少选择一个条目以添加合作组标签
collab-tag-disabled = 请在 首选项 → INSPIRE 中启用合作组标签功能

# 基金信息提取 - 主窗口菜单
menuitem-copy-funding = 复制基金信息

# 收藏论文 - 主窗口菜单 (FTR-FAVORITE-PAPERS)
menuitem-favorite-paper = 切换收藏论文
references-panel-favorite-paper-select-one = 请选择一个条目以切换收藏状态
references-panel-favorite-paper-no-recid = 无法收藏：未找到 INSPIRE ID

# 基金信息提取 - 进度消息
funding-extraction-progress = 正在从 PDF 提取基金信息...
funding-extraction-complete = 找到 { $count } 个基金号，来自 { $funders } 个资助机构
funding-extraction-none = 未找到基金信息
funding-no-selection = 未选择条目
funding-no-entries = 没有可导出的条目
funding-no-pdf = 未找到 PDF 附件
funding-no-linked-items = 没有条目链接到 Zotero 库
funding-some-unlinked = { $count } 个条目未链接（已跳过）

# 基金信息提取 - 引用面板导出菜单
references-panel-export-funding-header = — 基金信息 —
references-panel-export-funding-copy = 复制基金表格
references-panel-export-funding-csv = 导出基金信息 (CSV)
references-panel-export-funding-saved = 已保存基金表格（{ $count } 条）
references-panel-export-funding-copied = 已复制基金表格（{ $count } 条）
