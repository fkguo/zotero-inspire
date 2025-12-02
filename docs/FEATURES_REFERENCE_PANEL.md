# INSPIRE References Panel - 功能文档

> 此文档用于记录 References Panel 的所有功能实现，供后续优化参考，防止功能回退。

## 1. 核心功能

### 1.1 References Tab（引用文献列表）

- **数据来源**: INSPIRE API `/literature/{recid}?fields=metadata.references`
- **渲染方式**: 渐进式渲染，每 100 条渲染一次
- **排序选项**:
  - `default` - 默认顺序（原文顺序）
  - `yearDesc` - 按年份降序
  - `citationDesc` - 按引用次数降序
- **Citation Count**: 后台批量获取（每批 50 个 recid），获取后自动更新显示

### 1.2 Cited By Tab（被引文献列表）

- **数据来源**: INSPIRE API `/literature?q=refersto:recid:{recid}`
- **渲染方式**: 渐进式渲染，首次加载 250 条后立即渲染，后续并行加载
- **分页策略**:
  - Page size: 250（统一大小，避免 offset 错误）
  - 最大页数: 40（最多 10000 条）
  - 并行批次: 3 页同时获取
- **排序选项**: `mostrecent` / `mostcited`

### 1.3 Entry Cited Tab（条目引用/作者文章）

- **条目引用**: 点击条目的 citation count 按钮，显示该条目的 citing records
- **作者文章**: 点击作者名字，显示该作者的所有文章
- **作者搜索优先级**: BAI > recid > fullName

## 2. 统计图表功能

### 2.1 图表显示

- **位置**: 面板顶部，工具栏和列表之间
- **适用模式**: References、Cited By、Author Papers 三种模式
- **视图切换**: 支持"按年份"和"按引用数"两种视图模式
- **汇总统计**: 标题栏右侧显示当前模式的汇总数据

### 2.2 年份统计

- **智能合并**: 自动合并早期年份，最多显示 10 个柱状图（根据容器宽度动态调整，最多 20 个）
- **合并策略**:
  - 优先保留最近年份的详细信息
  - 早期年份按目标数量合并（每个 bin 至少 3 篇论文）
  - 如果超过最大柱状图数，合并相邻的小 bin
- **标签格式**: 使用年份后两位数字，如 '20、'21-'23
- **汇总显示**: 右上角显示总文章数（如 "45 papers"）

### 2.3 引用数统计

- **固定区间**: 0、1-9、10-49、50-99、100-249、250-499、500+
- **每个区间显示对应引用数范围的论文数量**
- **汇总显示**: 右上角显示总引用数、h-index、篇均引用（如 "1,234 cit. · h=15 · avg 27.4"）
- **h-index 计算**: 将论文按引用次数降序排列，找到最大的 h 使得有 h 篇论文引用次数 ≥ h

### 2.4 交互功能

- **单选筛选**: 点击柱状图筛选对应区间，再次点击取消
- **多选筛选**: 按住 Ctrl/Cmd 键点击多个柱状图进行多选
- **筛选逻辑**: 图表筛选与文本过滤器结合（AND 逻辑）
- **折叠/展开**: 点击折叠按钮收起图表
- **折叠清空筛选**: 折叠后会立即清空所有图表筛选，防止隐藏过滤器影响列表加载
- **默认折叠偏好**: 可在偏好设置中配置是否默认折叠
- **清除筛选**: 有筛选时显示清除按钮（✕），一键清除所有图表筛选
- **作者数过滤**: 点击 "≤10 Authors" 按钮可过滤仅显示作者数 ≤10 的论文（排除大型合作组）

### 2.5 技术实现

- **动态柱状图宽度**: 根据容器宽度计算，最大 50px，最小 15px
- **统计缓存**: 按视图模式缓存统计结果，避免重复计算
- **SVG 渲染**: 使用 SVG 绘制柱状图，支持响应式布局
- **偏好设置读取**: 构造函数中读取 `chart_default_collapsed` 初始化折叠状态
- **作者数判断**: 使用 `totalAuthors` 字段（来自 INSPIRE API 的 `author_count`），而非 `authors` 数组长度（数组被限制为最多 50 个）

## 3. 条目显示功能

### 3.1 每条条目包含

- **状态标记（圆点）**:
  - `●` 绿色 = 本地库中已有
  - `⊕` 灰色 = 本地库中没有，点击可添加
- **关联按钮**: 链接/取消链接到当前条目的 Related Items
- **BibTeX 按钮**: 复制 BibTeX 到剪贴板
- **作者链接**: 点击作者名可查看该作者的所有文章
- **标题链接**:
  - 左键 + 修饰键: 打开 INSPIRE 页面
  - 左键: 导航到本地条目（如有）或打开 INSPIRE
  - 悬停: 显示摘要 tooltip
- **Citation Count**: 点击可查看 citing records

### 3.2 摘要 Tooltip

- **触发方式**: 鼠标悬停标题 300ms 后显示
- **隐藏延迟**: 鼠标离开 600ms 后隐藏
- **数据获取**: 按需从 INSPIRE API 获取

## 4. 搜索和过滤

### 4.1 Filter 功能

- **实时搜索**: 输入时立即过滤
- **搜索范围**: 所有已加载的条目（`allEntries`）

  - 搜索字段包括：作者、标题、期刊信息、arXiv 号、期刊缩写等
- **多词搜索**: 空格分隔，所有词都需匹配
- **短语搜索**: 使用双引号 `"..."` 包裹文本可进行精确短语匹配

  - 忽略空格和标点符号（如 `.`）
  - 例如：`"Phys Rev Lett"` 可匹配 "Physical Review Letters" 或 "Phys. Rev. Lett."
- **期刊缩写支持**: 支持使用期刊缩写快速过滤

  - 输入缩写（如 `PRL`）可匹配对应的完整期刊名（如 "Physical Review Letters"）
  - 支持常见物理期刊缩写：PRL、PRD、PRA、PRB、PRC、PRE、PRX、JHEP、PLB、EPJC、CPC、CPL 等
  - 支持中国期刊：CPC（中国物理C）、CPL（中国物理快报）、APS（物理学报）、SciBull（科学通报）等
  - 缩写映射存储在 `src/utils/journalAbbreviations.ts`，便于后续扩展
- **文本规范化**:

  - 特殊字符替换（ß→ss, æ→ae 等）
  - Unicode 规范化（NFD + 移除组合标记）
  - 德语元音变体（ä→ae 等）
- **分页行为**:

  - 无 filter 时: 分页显示（每页 100 条）
  - 有 filter 时: 显示所有匹配结果

### 4.2 Cited By/Author 模式下的 Filter

- **自动更新**: 数据加载过程中，filter 结果自动更新
- **状态显示**: "X matches in Y loaded / Z total"

## 5. 导航功能

### 5.1 返回/前进按钮

- **返回**: 返回上一个查看的条目
- **前进**: 前进到下一个条目
- **导航栈**: 最多保存 20 个历史记录
- **跨实例共享**: 所有 panel 实例共享导航栈

### 5.2 Entry View 返回

- **功能**: 从 Entry Cited 模式返回到之前的 References/Cited By 模式
- **滚动恢复**: 返回时恢复之前的滚动位置

## 6. 性能优化

### 6.1 渲染优化

- **分页渲染**: 每页 100 条，滚动到底部自动加载更多（无限滚动）
- **渐进式渲染**: 数据边获取边渲染
- **增量追加渲染**: onProgress 使用 `appendNewEntries()` 增量追加而非完整重渲染
- **DocumentFragment**: 批量 DOM 操作
- **Row Cache**: 缓存已创建的行元素
- **Row 元素池化 (PERF-7)**: 复用行容器元素（最大 150 个），减少 DOM 创建和 GC 压力
- **完整子元素池化 (PERF-13)**: 使用 innerHTML 模板预创建行结构，复用时只更新内容不重建 DOM，子元素创建减少 ~65%
- **Filter 防抖**: 150ms 延迟，减少快速输入时的重渲染
- **图表延迟计算**: 使用 `setTimeout(0)` 延迟图表渲染
- **图表节流**: 300ms 节流间隔，避免频繁重绘
- **延迟 searchText**: 首次过滤时才计算 `searchText`，提升初始加载性能

### 6.2 数据缓存

所有数据缓存使用 LRU（最近最少使用）策略防止内存无限增长：

| 缓存               | 类型    | 最大条目 | 用途                               |
| ------------------ | ------- | -------- | ---------------------------------- |
| References Cache   | LRU     | 100      | 按 recid + mode + sort 缓存        |
| Cited By Cache     | LRU     | 50       | 同上                               |
| Entry Cited Cache  | LRU     | 50       | 同上                               |
| Metadata Cache     | LRU     | 500      | 缓存 INSPIRE 元数据                |
| Row Cache          | Map     | -        | 缓存已渲染的行元素（重渲染时清除） |
| Recid Lookup Cache | Map     | -        | 缓存成功的 recid 查找结果          |
| Search Text Cache  | WeakMap | -        | 缓存搜索文本（自动 GC）            |

### 6.3 后台任务

- **非阻塞 Enrichment**:
  - 使用 `setTimeout(0)` 延迟执行
  - 先渲染列表，后台更新本地状态和 citation count
- **Abort Controller**: 支持取消进行中的请求

### 6.4 网络优化

- **Citation Count 并行获取**: 每轮 3 批并行请求（原为串行），减少约 60% 等待时间
- **API 分页并行获取**: 每轮 5 页并行请求（从 3 增至 5），网络时间减少 30-40%
- **本地状态批量查询**: SQL 查询批次从 100 增大到 500，减少 80% 数据库交互

### 6.5 429 速率限制处理

- **被动式限制**: 正常请求零开销，直接透传到原生 fetch
- **429 自动重试**: 收到 429 响应时自动指数退避重试（最多 3 次）
- **退避策略**: 1s → 2s → 4s，支持 `Retry-After` 响应头
- **实现文件**: `src/modules/inspire/rateLimiter.ts`

### 6.6 无限滚动

- **实现方式**: 使用 `IntersectionObserver` 监视 "Load More" 容器
- **触发时机**: 容器进入视口前 200px 时自动加载
- **Fallback**: 保留手动点击按钮作为备用方案
- **兼容性**: 完全兼容 Back/Forward 导航和滚动位置恢复

### 6.7 事件委托 (PERF-14)

> **实现日期**: 2025-12-01

- **实现方式**: 在 `listEl` 上使用 4 个事件委托（click、mouseover、mouseout、mousemove），替代每行 10+ 个直接监听器
- **效果**: 1000 行列表监听器从 10000+ 降至 4 个
- **内存优化**: 监听器数量恒定，不随滚动增长
- **数据关联**: 行元素使用 `data-entry-id` 属性关联数据，作者链接使用 `data-author-index`
- **实现位置**: `src/modules/zinspire.ts` 的 `setupEventDelegation()` 方法

> ⚠️ **禁止回退**: 不要将事件委托改回直接在每个元素上绑定监听器，这会导致严重的内存问题。

### 6.8 完整子元素池化 (PERF-13)

> **实现日期**: 2025-12-01

- **实现方式**: 使用 `innerHTML` 一次性创建行模板（含所有子元素），从池复用时只更新内容不重建结构
- **模板结构**: 预创建 marker、linkButton、bibtexButton、label、authors、year、separator、titleLink、meta、statsButton 等元素
- **核心方法**:
  - `createRowTemplate()`: 创建完整行结构模板
  - `updateRowContent()`: 更新行内容（只修改 textContent/属性）
  - `updateRowMetadata()`: 元数据更新时也使用相同逻辑
- **效果**: 每行 DOM 元素创建从 ~16 个减少到 ~5 个（作者链接仍需动态创建），减少约 65%
- **依赖**: 必须配合 PERF-14（事件委托）使用

> ⚠️ **禁止回退**: 不要将 `getRowFromPool()` 改回清空内容（`textContent = ""`），这会破坏子元素池化效果。

## 7. 添加/保存功能

### 7.1 添加到本地库

- **目标选择器**: 选择保存到哪个 Collection
- **重复检测**: 基于 DOI/arXiv 检测已有条目
- **批量添加**: 支持添加多个条目

### 7.2 关联功能

- **添加关联**: 将条目添加到当前条目的 Related Items
- **移除关联**: 从 Related Items 中移除

## 8. 其他功能

### 8.1 刷新按钮

- 强制重新获取数据（清除缓存）

### 8.2 导出功能

- **触发方式**: 点击工具栏导出按钮，弹出菜单
- **菜单位置**: 锚定在按钮下方（使用 `openPopup` 而非 `openPopupAtScreen`）
- **支持格式**:
  - BibTeX (.bib)
  - LaTeX US (.tex)
  - LaTeX EU (.tex)
- **导出目标**:
  - **复制到剪贴板**: 适合小批量，有大小限制提示
  - **保存到文件**: 适合大批量导出，无大小限制
- **批量获取**: 每批 50 条，从 INSPIRE API 批量获取
- **进度提示**: 显示获取进度和最终结果
- **本地化**: 支持中英文提示信息

### 8.3 Notifier

- 监听 Zotero 条目变更
- 自动更新本地状态和关联状态

### 8.4 大型合作组处理

- 作者超过 20 人时，只显示第一作者 + "et al."
- 性能优化：限制作者信息提取数量

---

## 10. INSPIRE 搜索功能 (v1.1.2)

### 10.1 搜索栏集成

从 Zotero 主搜索栏触发 INSPIRE 搜索：

- **触发方式**: 输入 `inspire:` 前缀 + 查询词，按 Enter
- **语法支持**: INSPIRE 原生查询语法（直接传递给 API）
- **示例**:
  - `inspire: a Witten` - 作者搜索
  - `inspire: t quark mass` - 标题搜索
  - `inspire: arXiv:2305.12345` - arXiv ID 搜索

### 10.2 事件拦截机制

为防止 Zotero 默认搜索行为触发，使用以下技术：

```typescript
// 1. 捕获阶段监听（在 Zotero 处理器之前执行）
searchBar.addEventListener("keydown", handler, { capture: true });
searchBar.addEventListener("keypress", handler, { capture: true });

// 2. 三重保护
event.preventDefault();           // 阻止默认行为
event.stopPropagation();          // 阻止冒泡到父元素
event.stopImmediatePropagation(); // 阻止同元素上的其他监听器

// 3. 焦点转移（在清空搜索栏前）
itemsView.focus();
target.value = "";

// 4. Wrapper 函数设置共享 flag（⚠️ 关键结构，不可简化！）
const originalKeydownListener = this.searchBarListener;
this.searchBarListener = (event) => {
  if (isInspireSearch) handlingInspireSearch = true;
  originalKeydownListener(event);
};
```

> ⚠️ **重要警告 - 禁止简化代码结构**
>
> 上述 wrapper 函数结构**绝对不能**被"优化"为直接在监听器中设置 flag。
>
> 虽然 wrapper 看起来冗余，但它确保了：
>
> 1. 闭包绑定的正确顺序
> 2. keydown 和 keypress 监听器之间的 flag 正确同步
> 3. 搜索后面板能正常显示结果
>
> **已验证的失败案例**：将 flag 设置移入主监听器会导致搜索后 References Panel 无法显示。
> （教训记录：2025-11-30）

### 10.3 搜索模式 UI

进入搜索模式后，面板显示：

- **搜索输入框**: 专用搜索输入字段
- **搜索按钮**: 触发搜索
- **历史下拉菜单**: 显示最近 10 条搜索记录
- **清除历史**: 清除所有搜索历史

### 10.4 搜索历史

| 配置项     | 值                                         |
| ---------- | ------------------------------------------ |
| 最大条目数 | 10                                         |
| 存储位置   | Zotero 偏好设置 (`inspireSearchHistory`) |
| 存储格式   | JSON 字符串数组                            |

### 10.5 搜索结果

- 显示在新的 "🔍 Search" 标签页中
- 仅在有搜索结果时显示该标签页
- 支持所有标准交互功能（Add to Library、Copy BibTeX 等）
- 支持排序（most recent / most cited）
- 支持文本过滤器和图表统计

---

## 9. 代码结构

### 9.1 模块概览

```
src/modules/
├── zinspire.ts              # 主模块（Reference Panel + 导出）
├── pickerUI.ts              # 保存目标选择器 UI
└── inspire/                 # 模块化子目录
    ├── index.ts             # 统一导出入口
    ├── constants.ts         # API常量、排序选项、分页配置
    ├── types.ts             # 接口和类型定义
    ├── textUtils.ts         # 文本规范化和搜索函数
    ├── formatters.ts        # 格式化和显示文本函数
    ├── apiUtils.ts          # API工具函数
    ├── authorUtils.ts       # 作者信息处理函数
    ├── menu.ts              # 右键菜单注册 (ZInsMenu)
    ├── utils.ts             # 通用工具类 (ZInsUtils, ReaderTabHelper, LRUCache)
    ├── metadataService.ts   # INSPIRE元数据获取
    ├── rateLimiter.ts       # 429速率限制处理 (inspireFetch)
    └── itemUpdater.ts       # 批量更新功能 (ZInspire)
```

### 9.2 核心类

| 类名                                | 文件                   | 职责                         |
| ----------------------------------- | ---------------------- | ---------------------------- |
| `ZInspireReferencePane`           | zinspire.ts            | 面板注册和生命周期管理（~650行） |
| `InspireReferencePanelController` | zinspire.ts            | 面板UI控制器（~6900行，高耦合） |
| `ZInspire`                        | inspire/itemUpdater.ts | 批量更新条目（右键菜单功能） |
| `ZInsUtils`                       | inspire/utils.ts       | 偏好设置和通知器注册         |
| `LRUCache`                        | inspire/utils.ts       | LRU 缓存实现（限制缓存大小） |
| `ZInsMenu`                        | inspire/menu.ts        | 右键菜单注册                 |
| `ReaderTabHelper`                 | inspire/utils.ts       | Reader标签页辅助             |

**行元素池化相关方法** (PERF-13):

| 方法名 | 职责 |
| ------ | ---- |
| `createRowTemplate()` | 使用 innerHTML 创建完整行结构模板 |
| `getRowFromPool()` | 从池获取行（不清空内容） |
| `returnRowToPool()` | 归还行到池（保留结构） |
| `updateRowContent()` | 更新行内容（只修改 textContent/属性） |
| `updateRowMetadata()` | 元数据更新（适配模板结构） |

### 9.3 模块职责

#### constants.ts (~100行)

- API 端点常量：`INSPIRE_API_BASE`, `ARXIV_ABS_URL`, `DOI_ORG_URL`
- 分页配置：`CITED_BY_PAGE_SIZE`, `RENDER_PAGE_SIZE`
- 排序选项：`REFERENCE_SORT_OPTIONS`, `INSPIRE_SORT_OPTIONS`
- 类型守卫：`isReferenceSortOption()`, `isInspireSortOption()`

#### types.ts (~180行)

- 核心类型：`InspireReferenceEntry`, `AuthorSearchInfo`
- 导航类型：`ScrollSnapshot`, `ScrollState`, `NavigationSnapshot`
- 图表类型：`ChartBin`, `InspireViewMode`
- API 响应类型：`InspireMetadataResponse`, `jsobject`

#### textUtils.ts (~135行)

- 文本规范化：`normalizeSearchText()`, `buildVariantSet()`
- 搜索索引：`buildSearchIndexText()`, `buildFilterTokenVariants()`
- Token 解析：`parseFilterTokens()` (支持引号短语)

#### formatters.ts (~500行)

- 作者格式化：`formatAuthorName()`, `formatAuthors()`, `buildInitials()`
- 出版信息：`formatPublicationInfo()`, `buildPublicationSummary()`
- arXiv 处理：`formatArxivTag()`, `formatArxivDetails()`
- 显示文本：`buildDisplayText()`, `buildEntrySearchText()`
- 缓存字符串：`getCachedStrings()` (性能优化)

#### apiUtils.ts (~260行)

- Recid 提取：`deriveRecidFromItem()`, `extractRecidFromUrl()`
- URL 构建：`buildReferenceUrl()`, `buildFallbackUrl()`
- arXiv 提取：`extractArxivFromReference()`, `extractArxivFromMetadata()`
- 数据库查询：`findItemByRecid()`
- 剪贴板：`copyToClipboard()`

#### authorUtils.ts (~175行)

- 作者提取：`extractAuthorNamesFromReference()`, `extractAuthorNamesLimited()`
- BAI 验证：`isValidBAI()`
- 搜索信息：`extractAuthorSearchInfos()`

#### metadataService.ts (~450行)

- 元数据获取：`getInspireMeta()`, `fetchInspireMetaByRecid()`
- 摘要获取：`fetchInspireAbstract()`
- BibTeX 获取：`fetchBibTeX()`
- CrossRef 集成：`getCrossrefCount()`
- 元数据构建：`buildMetaFromMetadata()`

#### itemUpdater.ts (~790行)

- `ZInspire` 类：批量更新控制器
- 元数据设置：`setInspireMeta()`
- 引用管理：`setCitations()`, `setCrossRefCitations()`
- 笔记管理：`queueOrUpsertInspireNote()`, `upsertInspireNote()`
- arXiv 标签：`setArxivCategoryTag()`

### 9.4 数据流

```
用户操作
    ↓
ZInspireReferencePane (注册/生命周期)
    ↓
InspireReferencePanelController (UI逻辑)
    ├── loadEntries() → INSPIRE API
    ├── renderReferenceList() → DOM
    ├── handleItemChange() → Zotero ItemPane API
    └── 使用 inspire/ 子模块的工具函数
```

### 9.5 关键接口

```typescript
// 条目数据结构
interface InspireReferenceEntry {
  id: string;
  recid?: string;
  title: string;
  authors: string[];
  authorText: string;
  displayText: string;
  searchText: string;
  year: string;
  citationCount?: number;
  localItemID?: number;
  isRelated?: boolean;
  abstract?: string;
  // ... 更多字段见 types.ts
}

// 作者搜索信息（支持精确搜索）
interface AuthorSearchInfo {
  fullName: string;
  bai?: string;     // INSPIRE BAI (最精确)
  recid?: string;   // INSPIRE author recid
}

// 导航快照（支持返回/前进）
interface NavigationSnapshot {
  itemID: number;
  recid?: string;
  scrollState: ScrollState;
  tabType: "library" | "reader";
  readerTabID?: string;
}
```

### 9.6 导入方式

```typescript
// 方式1：从主模块导入（推荐，保持兼容性）
import { ZInsUtils, ZInsMenu, ZInspire, ZInspireReferencePane } from "./modules/zinspire";

// 方式2：从子模块导入（适合仅需特定功能）
import { formatAuthors, buildDisplayText } from "./modules/inspire/formatters";
import { deriveRecidFromItem, findItemByRecid } from "./modules/inspire/apiUtils";
import { fetchInspireMetaByRecid } from "./modules/inspire/metadataService";

// 方式3：从统一入口导入
import { INSPIRE_API_BASE, InspireReferenceEntry } from "./modules/inspire";
```

---

## 11. 重要实现注意事项

> ⚠️ **此章节记录经过验证的关键设计决策和 bug 修复，禁止在后续开发中回退或简化**

### 11.1 图表渲染一致性

**问题**: 图表与列表数据不同步

| Bug | 原因 | 修复方案 | 修复日期 |
|-----|------|----------|----------|
| 切换条目后图表停留在 "Loading..." | `handleItemChange()` 中 `currentRecid === recid` 分支只调用了 `renderReferenceList()`，遗漏了图表渲染 | 添加 `renderChartImmediate()` 调用 | 2025-12-01 |
| 点击 "≤10 Authors" 按钮后图表不更新 | `doRenderChart()` 使用 `this.allEntries` 而非考虑 `authorFilterEnabled` 过滤 | 图表数据应用 `authorFilterEnabled` 过滤 | 2025-12-01 |

**关键代码位置**:
- `handleItemChange()`: 条目切换时必须同时调用 `renderReferenceList()` 和 `renderChartImmediate()`
- `doRenderChart()`: 必须根据 `authorFilterEnabled` 过滤数据

### 11.2 图表年份模式回退

**问题**: 当 references 没有年份信息时，图表显示 "No data" 而非有用信息

**修复**: 在 `doRenderChart()` 中添加回退逻辑：
```typescript
// 当 year 模式无数据但有条目时，自动回退到 citation 模式
if (!stats.length && this.chartViewMode === "year" && entries.length > 0) {
  stats = this.computeCitationStats(entries);
}
```

**注意**: 这是显示回退，不改变 `chartViewMode` 状态，用户仍可切换视图。

### 11.3 事件委托架构 (PERF-14)

**设计决策**: 使用事件委托而非直接绑定

- 所有行元素的交互事件（click、mouseover、mouseout、mousemove）通过 `listEl` 统一委托
- 行元素使用 `data-entry-id` 关联数据
- 作者链接使用 `data-author-index` 关联原始索引

**禁止回退原因**: 直接绑定会导致 1000 行 = 10000+ 监听器，造成严重内存问题。

### 11.4 完整子元素池化 (PERF-13)

**设计决策**: 预创建行结构模板，复用时只更新内容

- `createRowTemplate()` 使用 innerHTML 一次性创建完整行结构
- `getRowFromPool()` 直接返回池化元素，**不清空内容**
- `updateRowContent()` 和 `updateRowMetadata()` 只更新 textContent/属性
- 条件元素（label、year、meta、stats）通过 `display: none` 控制显隐
- 作者容器每次清空重建（数量可变）

**禁止回退原因**:
- 不要在 `getRowFromPool()` 中使用 `textContent = ""` 清空内容
- 不要在 `updateRowMetadata()` 中重建整个 title 容器
- 这些会破坏子元素池化效果，导致每行重新创建 ~15 个 DOM 元素

**关键代码位置**:
- `createRowTemplate()`: 约第 6402 行
- `updateRowContent()`: 约第 6487 行
- `updateRowMetadata()`: 约第 4207 行

### 11.5 搜索栏 Wrapper 函数结构

**设计决策**: 必须使用 wrapper 函数设置 `handlingInspireSearch` flag

详见第 10 章（INSPIRE 搜索功能）10.2 节中的警告说明。

---

## 版本信息

- **文档创建日期**: 2025-11-27
- **代码结构更新**: 2025-11-29
- **性能优化更新**: 2025-11-29
- **429 限制处理**: 2025-11-29
- **v1.1.2 性能优化**: 2025-11-29 (延迟searchText、增量渲染、图表节流、并行数增加)
- **v1.1.2 导出功能**: 2025-11-30 (多格式导出菜单、支持文件保存)
- **v1.1.2 INSPIRE 搜索**: 2025-11-30 (搜索栏集成、capture 阶段事件拦截)
- **v1.1.2 图表增强**: 2025-11-30 (汇总统计显示、默认折叠偏好设置)
- **v1.1.2 作者过滤**: 2025-11-30 (作者数过滤器、搜索历史空格修复、清空历史按钮)
- **v1.1.2 代码重构**: 2025-12-01 (模块化重构，zinspire.ts 从 ~10000 行减少到 ~7300 行)
- **v1.1.2 事件委托**: 2025-12-01 (PERF-14，监听器从 10000+ 降至 4)
- **v1.1.2 子元素池化**: 2025-12-01 (PERF-13，行子元素创建减少 ~65%)
- **v1.1.2 Bug 修复**: 2025-12-01 (图表渲染一致性、年份模式回退、作者过滤器图表同步)
- **对应代码分支**: dev_inspire_refs
- **对应插件版本**: 1.1.2
