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
references-panel-tab-entry-cited = 引用...
references-panel-tab-author-papers = 论文...
references-panel-status-empty = 选择一条条目以加载 INSPIRE 数据
references-panel-reader-mode = 阅读器视图中不支持 INSPIRE 数据
references-panel-select-item = 请选择单个常规条目以查看 INSPIRE 数据
references-panel-no-recid = 未找到此条目的 INSPIRE 记录
references-panel-status-loading = 正在加载引用...
references-panel-status-loading-cited = 正在加载被引记录...
references-panel-status-loading-entry = 正在加载所选引用的被引记录...
references-panel-status-loading-author = 正在加载作者论文...
references-panel-status-error = 从 INSPIRE 加载数据失败
references-panel-empty-list = 暂无引用
references-panel-empty-cited = 未找到被引记录
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
references-panel-filter-placeholder = 筛选条目
references-panel-quick-filters = 筛选
references-panel-quick-filter-high-citations = 高引用（>50）
references-panel-quick-filter-high-citations-tooltip = 显示引用次数超过 50 的论文
references-panel-quick-filter-recent-5y = 近 5 年
references-panel-quick-filter-recent-5y-tooltip = 仅显示最近 5 个日历年发表的论文
references-panel-quick-filter-recent-1y = 近 1 年
references-panel-quick-filter-recent-1y-tooltip = 仅显示当前日历年发表的论文
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
references-panel-filter-count-entry =
  引用 "{ $label }" 的 { $visible } / { $total } 条记录
references-panel-filter-count-author =
  { $label } 的 { $visible } / { $total } 篇论文
references-panel-dot-local = 条目已存在于文库中
references-panel-dot-add = 添加此引用到文库
references-panel-link-existing = 点击取消关联条目
references-panel-link-missing = 关联为相关条目
references-panel-toast-linked = 相关条目已关联
references-panel-toast-added = 引用已添加到文库
references-panel-toast-missing = 未在 INSPIRE-HEP 中找到文献
references-panel-toast-no-pdf = 此条目没有 PDF 附件
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
references-panel-author-papers-label = { $author } 的论文
references-panel-author-click-hint = 点击查看 { $author } 的论文
references-panel-copy-bibtex = 复制 BibTeX
references-panel-bibtex-copied = BibTeX 已复制到剪贴板
references-panel-bibtex-failed = 获取 BibTeX 失败

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
references-panel-export-copied = 已复制 { $count } 条 { $format } 条目
references-panel-export-saved = 已保存 { $count } 条 { $format } 条目
references-panel-export-clipboard-failed = 复制到剪贴板失败（内容过大？）
references-panel-export-too-large = 内容过大（{ $size }KB）- 请改用「导出到文件」
references-panel-export-cancelled = 导出已取消
references-panel-export-save-title = 导出引用

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
