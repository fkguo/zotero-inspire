pref-meta = 为新条目获取 INSPIRE 元数据
pref-citekey = 在 Extra 字段设置引用键
pref-extra-order = Extra 字段顺序
pref-arxiv-tag = arXiv 主分类标签
pref-refs-panel = 引用面板
pref-reader-history = 阅读器视图导航
pref-nofound = 未找到 INSPIRE 记录

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

pref-arxiv-tag1 =
    .label = 添加 arXiv 主分类作为标签（如 hep-ph、nucl-th）

pref-max-authors-label = 最大显示作者数：
pref-max-authors-desc = 引用面板中显示 "et al." 前的作者数量（默认：3）

pref-chart-enable =
    .label = 启用统计图表
pref-chart-enable-desc = 在面板顶部显示交互式统计图表（按年份/引用）。
pref-chart-default-collapsed =
    .label = 默认折叠

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

pref-help = { $name } 版本 { $version } { $time }
