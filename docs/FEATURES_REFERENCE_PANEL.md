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

### 2.2 年份统计
- **智能合并**: 自动合并早期年份，最多显示 10 个柱状图（根据容器宽度动态调整，最多 20 个）
- **合并策略**:
  - 优先保留最近年份的详细信息
  - 早期年份按目标数量合并（每个 bin 至少 3 篇论文）
  - 如果超过最大柱状图数，合并相邻的小 bin
- **标签格式**: 使用年份后两位数字，如 '20、'21-'23

### 2.3 引用数统计
- **固定区间**: 0、1-9、10-49、50-99、100-249、250-499、500+
- **每个区间显示对应引用数范围的论文数量**

### 2.4 交互功能
- **单选筛选**: 点击柱状图筛选对应区间，再次点击取消
- **多选筛选**: 按住 Ctrl/Cmd 键点击多个柱状图进行多选
- **筛选逻辑**: 图表筛选与文本过滤器结合（AND 逻辑）
- **折叠/展开**: 点击折叠按钮收起图表
- **清除筛选**: 有筛选时显示清除按钮（✕），一键清除所有图表筛选

### 2.5 技术实现
- **动态柱状图宽度**: 根据容器宽度计算，最大 50px，最小 15px
- **统计缓存**: 按视图模式缓存统计结果，避免重复计算
- **SVG 渲染**: 使用 SVG 绘制柱状图，支持响应式布局

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
- **DocumentFragment**: 批量 DOM 操作
- **Row Cache**: 缓存已创建的行元素
- **Row 元素池化**: 复用行容器元素（最大 150 个），减少 DOM 创建和 GC 压力
- **Filter 防抖**: 150ms 延迟，减少快速输入时的重渲染
- **图表延迟计算**: 使用 `setTimeout(0)` / `requestIdleCallback` 延迟图表渲染

### 6.2 数据缓存
所有数据缓存使用 LRU（最近最少使用）策略防止内存无限增长：

| 缓存 | 类型 | 最大条目 | 用途 |
|------|------|----------|------|
| References Cache | LRU | 100 | 按 recid + mode + sort 缓存 |
| Cited By Cache | LRU | 50 | 同上 |
| Entry Cited Cache | LRU | 50 | 同上 |
| Metadata Cache | LRU | 500 | 缓存 INSPIRE 元数据 |
| Row Cache | Map | - | 缓存已渲染的行元素（重渲染时清除） |
| Recid Lookup Cache | Map | - | 缓存成功的 recid 查找结果 |
| Search Text Cache | WeakMap | - | 缓存搜索文本（自动 GC） |

### 6.3 后台任务
- **非阻塞 Enrichment**: 
  - 使用 `setTimeout(0)` 延迟执行
  - 先渲染列表，后台更新本地状态和 citation count
- **Abort Controller**: 支持取消进行中的请求

### 6.4 网络优化
- **Citation Count 并行获取**: 每轮 3 批并行请求（原为串行），减少约 60% 等待时间
- **本地状态批量查询**: SQL 查询批次从 100 增大到 500，减少 80% 数据库交互

### 6.5 无限滚动
- **实现方式**: 使用 `IntersectionObserver` 监视 "Load More" 容器
- **触发时机**: 容器进入视口前 200px 时自动加载
- **Fallback**: 保留手动点击按钮作为备用方案
- **兼容性**: 完全兼容 Back/Forward 导航和滚动位置恢复

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

### 8.2 Notifier
- 监听 Zotero 条目变更
- 自动更新本地状态和关联状态

### 8.3 大型合作组处理
- 作者超过 20 人时，只显示第一作者 + "et al."
- 性能优化：限制作者信息提取数量

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
    ├── utils.ts             # 通用工具类 (ZInsUtils, ReaderTabHelper)
    ├── metadataService.ts   # INSPIRE元数据获取
    └── itemUpdater.ts       # 批量更新功能 (ZInspire)
```

### 9.2 核心类

| 类名 | 文件 | 职责 |
|------|------|------|
| `ZInspireReferencePane` | zinspire.ts | 面板注册和生命周期管理 |
| `InspireReferencePanelController` | zinspire.ts | 面板UI控制器（~4800行） |
| `ZInspire` | inspire/itemUpdater.ts | 批量更新条目（右键菜单功能） |
| `ZInsUtils` | inspire/utils.ts | 偏好设置和通知器注册 |
| `LRUCache` | inspire/utils.ts | LRU 缓存实现（限制缓存大小） |
| `ZInsMenu` | inspire/menu.ts | 右键菜单注册 |
| `ReaderTabHelper` | inspire/utils.ts | Reader标签页辅助 |

### 9.3 模块职责

#### constants.ts (~80行)
- API 端点常量：`INSPIRE_API_BASE`, `ARXIV_ABS_URL`, `DOI_ORG_URL`
- 分页配置：`CITED_BY_PAGE_SIZE`, `RENDER_PAGE_SIZE`
- 排序选项：`REFERENCE_SORT_OPTIONS`, `INSPIRE_SORT_OPTIONS`
- 类型守卫：`isReferenceSortOption()`, `isInspireSortOption()`

#### types.ts (~120行)
- 核心类型：`InspireReferenceEntry`, `AuthorSearchInfo`
- 导航类型：`ScrollSnapshot`, `ScrollState`, `NavigationSnapshot`
- 图表类型：`ChartBin`, `InspireViewMode`
- API 响应类型：`InspireMetadataResponse`, `jsobject`

#### textUtils.ts (~100行)
- 文本规范化：`normalizeSearchText()`, `buildVariantSet()`
- 搜索索引：`buildSearchIndexText()`, `buildFilterTokenVariants()`
- Token 解析：`parseFilterTokens()` (支持引号短语)

#### formatters.ts (~500行)
- 作者格式化：`formatAuthorName()`, `formatAuthors()`, `buildInitials()`
- 出版信息：`formatPublicationInfo()`, `buildPublicationSummary()`
- arXiv 处理：`formatArxivTag()`, `formatArxivDetails()`
- 显示文本：`buildDisplayText()`, `buildEntrySearchText()`
- 缓存字符串：`getCachedStrings()` (性能优化)

#### apiUtils.ts (~200行)
- Recid 提取：`deriveRecidFromItem()`, `extractRecidFromUrl()`
- URL 构建：`buildReferenceUrl()`, `buildFallbackUrl()`
- arXiv 提取：`extractArxivFromReference()`, `extractArxivFromMetadata()`
- 数据库查询：`findItemByRecid()`
- 剪贴板：`copyToClipboard()`

#### authorUtils.ts (~150行)
- 作者提取：`extractAuthorNamesFromReference()`, `extractAuthorNamesLimited()`
- BAI 验证：`isValidBAI()`
- 搜索信息：`extractAuthorSearchInfos()`

#### metadataService.ts (~450行)
- 元数据获取：`getInspireMeta()`, `fetchInspireMetaByRecid()`
- 摘要获取：`fetchInspireAbstract()`
- BibTeX 获取：`fetchBibTeX()`
- CrossRef 集成：`getCrossrefCount()`
- 元数据构建：`buildMetaFromMetadata()`

#### itemUpdater.ts (~500行)
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

## 版本信息

- **文档创建日期**: 2025-11-27
- **代码结构更新**: 2025-11-29
- **性能优化更新**: 2025-11-29
- **对应代码分支**: dev_inspire_refs
- **对应插件版本**: 1.1.1



