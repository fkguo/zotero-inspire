# Zotero INSPIRE Plugin - Feature Reference

> This document lists all implemented features for the INSPIRE References Panel and related functionality.
> It serves as a reference to prevent unintended changes during future optimizations.

---

## 1. INSPIRE References Panel (Item Pane Section)

### 1.1 Three View Modes

| Mode            | Description                                                              |
| --------------- | ------------------------------------------------------------------------ |
| **References**  | Shows papers cited by the current item (from INSPIRE's references data)  |
| **Cited By**    | Shows papers that cite the current item                                  |
| **Entry Cited** | Shows papers citing a specific reference, or papers by a specific author |

### 1.2 Data Loading Features

#### References Mode

- **Progressive rendering**: Renders entries in batches of 100 while fetching
- **Citation count enrichment**: Batch-fetches citation counts in background (50 recids per request)
- **Sorting options**: Default order, by year (descending), by citation count (descending)

#### Cited By / Author Papers Mode

- **Progressive loading**: First page (250 records) loads immediately, subsequent pages load in parallel batches
- **API pagination**: Uses consistent page size (250) to avoid offset bugs
- **Max results**: Up to 10,000 records (40 pages × 250)
- **Parallel fetching**: 3 pages fetched in parallel per batch
- **Sorting options**: Most recent, Most cited

### 1.3 UI Features

#### Statistics Chart

A statistics visualization chart is displayed at the top of the panel (between toolbar and list) for References, Cited By, and Author Papers modes:

- **Two view modes**:
  - **By Year**: Shows distribution of entries by publication year
    - Intelligently merges early years to show at most 10 bars (dynamically adjusted based on container width)
    - Prioritizes recent years for detailed breakdown
    - Minimum 3 papers per bin, or merge adjacent bins
    - **Summary display**: Shows total paper count in header (e.g., "45 papers")
  - **By Citations**: Shows distribution by citation count
    - Fixed bins: 0, 1-9, 10-49, 50-99, 100-249, 250-499, 500+
    - **Summary display**: Shows total citations, h-index, and average citations (e.g., "1,234 cit. · h=15 · avg 27.4")
- **Interactive filtering**:
  - Click a bar to filter entries in that bin
  - Hold Ctrl/Cmd to multi-select multiple bins
  - Click selected bar again to deselect
  - Chart filter combines with text filter using AND logic
- **Collapse/Expand**: Toggle button to hide/show chart
- **Auto-clear on collapse**: Collapsing the chart immediately clears all chart filters so hidden selections never affect list loading
- **Default collapse preference**: Configurable via Preferences → References Panel → "Collapsed by default"
- **Author count filter**: Toggle "≤10 Authors" button to show only papers with 10 or fewer authors (excludes large collaborations)
- **Published filter**: Toggle "Published only" button to show only papers with journal information (formally published papers), excluding arXiv-only papers. Papers with both journal info and arXiv are included (they are published)
- **Clear filter button**: Appears whenever any filter is active (text, chart selections, ≤10 Authors, Quick Filters, etc.) and clears all filters at once

#### Filter (Search)

- Real-time filtering across all loaded entries
- **Auto-update during loading**: Filter results update automatically as new data loads
- **No pagination when filtering**: Shows all matching results
- **Phrase search**: Use double quotes `"..."` for exact phrase matching, ignoring spaces and punctuation
  - Example: `"Phys Rev Lett"` matches "Physical Review Letters" or "Phys. Rev. Lett."
- **Journal abbreviation support**: Filter using common journal abbreviations
  - Example: `"PRL"` matches "Physical Review Letters"
  - Supports common physics journal abbreviations: PRL, PRC,PRD, JHEP, NPA, NPB, PLB, EPJA, EPJC, CPC, CPL, etc.
- Supports special characters (umlauts, accented characters) with normalization
- Multi-token search (space-separated terms, all must match)
- **Quick filters (Filters button)**:
  - The toolbar `Filters` button opens a popup with presets (🔥 High citations, 📅 Recent 5y, 📅 Recent 1y, 📰 Published, 📝 Preprints, ⭐ Related items)
  - Quick filters combine with text search, chart bins, and the ≤10 authors toggle (AND logic). The chart reuses the same filtering pipeline so bar counts match the list.
  - The last selection is stored in `quick_filters_last_used` and restored automatically the next time the panel opens.

#### Entry Display

- Reference label (e.g., `[1]`, `[2]`)
- **Clickable author names**: Click to view author's papers
- Year display
- **Clickable title**: Click to open in INSPIRE or arXiv/DOI fallback
- Publication summary (journal, volume, pages, arXiv ID)
- **Citation count button**: Shows count, click to view citing papers
- **Local status indicator**: ● for items in library, ⊕ for missing items
- **Related item indicator**: Link icon shows if item is related to current selection
- **BibTeX copy button**: Copy BibTeX entry to clipboard
- **Abstract tooltip**: Hover over title to see abstract (loaded on demand)
- **Author list**: Shows up to 10 authors; if more than 10, shows first 3 + "others"

#### Navigation

- **Back/Forward buttons**: Navigate through viewing history
- **Tab switching**: Switch between References/Cited By/Entry Cited modes
- **Scroll position preservation**: Remembers scroll position when navigating

#### Section Header Buttons

- **Refresh button**: Clear cache and reload current view from INSPIRE
- **Copy all BibTeX button**: Batch copy all visible entries as BibTeX to clipboard (uses efficient batch queries, 50 recids per request)

### 1.4 Interaction Features

| Action                        | Behavior                                           |
| ----------------------------- | -------------------------------------------------- |
| Click local status (●/⊕)      | Open existing item in library, or add missing item |
| Double-click local status (●) | Open PDF directly if available                     |
| Click link icon               | Add/remove related item relationship               |
| Click author name             | View all papers by that author                     |
| Click title                   | Open in INSPIRE (or arXiv/DOI fallback)            |
| Click citation count          | View papers citing this entry                      |
| Click BibTeX button           | Copy BibTeX to clipboard                           |
| Hover over title              | Show abstract tooltip                              |
| Click refresh button          | Reload current view (bypass cache)                 |
| Click copy all BibTeX button  | Copy all visible entries as BibTeX                 |

### 1.5 Caching

All data caches use LRU (Least Recently Used) eviction to prevent unbounded memory growth.

| Cache                       | Type    | Max Size | Purpose                                                      |
| --------------------------- | ------- | -------- | ------------------------------------------------------------ |
| `referencesCache`           | LRU     | 100      | Caches fetched references by recid + sort                    |
| `citedByCache`              | LRU     | 50       | Caches cited-by results by recid + sort                      |
| `entryCitedCache`           | LRU     | 50       | Caches entry-cited/author-papers results                     |
| `metadataCache`             | LRU     | 500      | Caches individual record metadata                            |
| `recidLookupCache`          | LRU     | 500      | Caches recid lookups to avoid repeated API calls             |
| `processedDataCache`        | LRU     | 20       | Caches PDF processed data per item                           |
| `pageDataCache`             | LRU     | 50       | Caches PDF page data per item+page                           |
| `pdfMappingCache`           | LRU     | 30       | Caches PDF numeric reference mapping                         |
| `pdfAuthorYearMappingCache` | LRU     | 30       | Caches PDF author-year mapping                               |
| `rowCache`                  | Map     | -        | Caches DOM elements for rendered rows (cleared on re-render) |
| `searchTextCache`           | WeakMap | -        | Caches search text per entry (auto GC'd)                     |

#### LRU Cache Statistics (v2.1.0)

All LRU caches now track hit/miss statistics for performance analysis:

```typescript
interface CacheStats {
  hits: number; // Number of cache hits
  misses: number; // Number of cache misses
  hitRate: number; // hits / (hits + misses)
  size: number; // Current entries in cache
  maxSize: number; // Maximum cache capacity
}
```

Access cache statistics via debug console commands (see Section 8.5).

#### Local persistent cache (v1.1.3)

- A dedicated `localCache` service stores References/Cited By/Author Papers JSON files on disk (with configurable directory, TTL, and clear buttons in Preferences → INSPIRE). References are permanent; other tabs default to 24 h TTL.
- **Smart caching strategy**:
  - **References**: Always stores a single unsorted cache file; sorting is done client-side at runtime
  - **Cited By / Author Papers**:
    - When total ≤ 10,000: stores a single unsorted cache file; sorting is done client-side (saves storage)
    - When total > 10,000: stores separate cache files per sort option (mostrecent/mostcited), as API returns different datasets
  - Cache files include `complete` flag and `total` field for integrity validation and smart decision-making
- **Gzip compression (1.1.3+)**: Large cache files are automatically compressed via pako (`.json.gz`), shrinking disk usage by ~80%. A “Compress cache files (gzip)” preference allows opting out when raw JSON files are needed.
- **Metadata enrichment throttle (1.1.4+)**: Preferences expose batch size (25–110 recids per request) and parallel request count (1–5) used when fetching missing titles/authors/citation counts. Increasing the limits speeds up enrichment but can hit INSPIRE limits (HTTP 400/502).
- **Integrity sampling**: When reading from disk, the service randomly samples a few entries (title + identifier) to detect corruption; invalid files are deleted and refetched automatically.
- The right-click **Download references cache** command (items or collections) uses the same helper to pre-populate the local cache and displays a progress window summarizing successes/failures. **Performance improved (v1.1.3+)**: reduces disk writes by 2/3 (writes once instead of three times).

### 1.6 Performance Optimizations

- **Frontend pagination**: Only renders first 100 entries, with infinite scroll for rest
- **Non-blocking enrichment**: Local status and citation counts fetched after initial render
- **Progressive rendering**: Shows data as it loads, not after complete
- **Batch API queries**: Citation counts fetched in batches of 50 recids
- **String caching**: Locale strings cached for performance
- **Chart statistics caching**: Chart stats cached per view mode to avoid recomputation

#### v1.1.1 Performance Enhancements

| Optimization                         | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| **Filter Input Debouncing**          | 150ms delay reduces re-renders during fast typing |
| **Citation Count Parallel Fetching** | 3 batches fetched in parallel per round           |
| **Search Text Caching**              | WeakMap caches `buildEntrySearchText()` results   |
| **Chart Lazy Calculation**           | Uses `setTimeout(0)` / `requestIdleCallback`      |
| **Row Element Pooling**              | Pool of up to 150 row elements for reuse          |
| **LRU Cache Limits**                 | Bounded caches prevent memory leaks               |
| **Local Status Query Optimization**  | SQL batch size increased to 500                   |
| **Infinite Scroll**                  | IntersectionObserver auto-loads more entries      |

### 1.5 PDF Reader Integration (v2.0.0)

When selecting text containing citation markers in the Zotero PDF Reader, the add-on automatically detects citations and provides lookup buttons.

#### Citation Detection

- **Text Selection**: Select text containing citations in PDF (e.g., "see Refs. [1,2,3]")
- **Popup Button**: When citations detected, shows "INSPIRE Refs. [n]" button in selection popup
- **Multiple Citations**: When multiple citations selected, shows multiple buttons for each

#### Supported Citation Formats

| Format             | Examples                                 |
| ------------------ | ---------------------------------------- |
| Single number      | `[1]`, `[42]`                            |
| Multiple numbers   | `[1,2,3]`, `[1, 2, 3]`                   |
| Number range       | `[1-5]`, `[1–5]`                         |
| Mixed format       | `[1,3-5,7]`                              |
| Author-year        | `[Smith 2024]`, `[WGR17]`                |
| arXiv ID           | `[arXiv:2301.12345]`, `[hep-ph/9901234]` |
| Superscript digits | ¹²³⁴⁵⁶⁷⁸⁹⁰                               |

#### Hover Preview

When hovering over citation lookup buttons in the PDF reader, a preview card appears showing entry details:

- **Preview card contents**: Title, authors, abstract, publication info, identifiers
- **Author-year consistency**: Preview shows exactly the same entry as clicking would scroll to
- **Ambiguous match hint**: For author-year citations with multiple candidates, displays "Author-year match only; click to select"

#### Panel Integration

When clicking the lookup button:

1. Automatically switches to References tab
2. Highlights the corresponding reference entry (temporary pulse + persistent focus)
3. Scrolls to that entry position

#### Persistent Focus Selection

After jumping from PDF lookup, the entry maintains a focused state (light blue background + blue left border) for easy identification:

- **Persistent display**: Focus selection does not auto-clear until user action
- **Clear methods**: Press Escape, switch tabs, refresh data, or click another entry
- **Independent from checkboxes**: Focus selection does not affect batch import checkbox selection

#### Fuzzy Detection Mode (Experimental)

For PDFs with broken text layers (e.g., brackets truncated), enable "Fuzzy citation detection" in Preferences:

- **Location**: Preferences → References Panel → Fuzzy citation detection
- **Function**: Recognizes citation patterns without brackets (e.g., "Bali 19" → `[19]`)
- **Smart Exclusions**: Automatically excludes:
  - Document structure terms (Section, Figure, Table, Equation, etc. and their abbreviations/plurals)
  - Physics units (GeV, MeV, TeV, fb, pb, K, Hz, etc. - comprehensive list)
  - Decimals, times, percentages, ordinals, fractions, dimensions
- **Default**: Disabled to avoid false positives

---

## 2. Right-Click Menu Operations

All INSPIRE operations are organized in a unified **INSPIRE** submenu (v1.1.4+) for a cleaner interface.

### 2.1 Item Menu

Right-click one or more items, then select **INSPIRE** to access:

| Category            | Operation                             | Description                                                                                                        |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Update Metadata** | `With abstracts`                      | Full metadata update including abstract                                                                            |
|                     | `Without abstracts`                   | Metadata update excluding abstract                                                                                 |
|                     | `Citation counts only`                | Only update citation counts (with/without self-citations; falls back to CrossRef if INSPIRE record not found)      |
| **Cache**           | `Download references cache` (v1.1.3+) | Prefetch INSPIRE references for the selected items into the local cache (shows progress and success/failure stats) |
| **Copy** (v1.1.4+)  | `Copy BibTeX`                         | Fetch and copy BibTeX from INSPIRE                                                                                 |
|                     | `Copy INSPIRE link`                   | Copy INSPIRE literature URL (`https://inspirehep.net/literature/{recid}`)                                          |
|                     | `Copy citation key`                   | Copy item's citation key                                                                                           |
|                     | `Copy Zotero link`                    | Copy Zotero select link (`zotero://select/...`)                                                                    |
| **Actions**         | `Cancel update`                       | Cancel any ongoing update operation                                                                                |

### 2.2 Collection Menu

Right-click a collection, then select **INSPIRE** to access:

| Category            | Operation                             | Description                                                                                                      |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Update Metadata** | `With abstracts`                      | Update all items in collection with full metadata                                                                |
|                     | `Without abstracts`                   | Update all items excluding abstracts                                                                             |
|                     | `Citation counts only`                | Update citation counts for all items                                                                             |
| **Cache**           | `Download references cache` (v1.1.3+) | Prefetch references for every item in the collection into the local cache (same progress UI as the item command) |
| **Actions**         | `Cancel update`                       | Cancel any ongoing update operation                                                                              |

**Note**: Copy actions are only available in the item menu, as they operate on individual items.

---

## 3. Metadata Update Features

- **Concurrent processing**: 4 parallel workers for batch updates
- **Progress window**: Shows update progress
- **CrossRef fallback**: Falls back to CrossRef for citation counts if INSPIRE fails
- **Item type conversion**: Converts preprints to journal articles when published
- **Tag support**: Can tag items without INSPIRE recid

---

## 4. Constants Reference

```typescript
// API pagination
CITED_BY_PAGE_SIZE = 250      // Consistent page size
CITED_BY_MAX_PAGES = 40       // Max pages (40 × 250 = 10000)
CITED_BY_MAX_RESULTS = 10000  // Hard limit
CITED_BY_PARALLEL_BATCH_SIZE = 3  // Pages fetched in parallel

// Frontend pagination
RENDER_PAGE_SIZE = 100        // Entries per render batch

// UI limits
NAVIGATION_STACK_LIMIT = 20   // Back/forward history limit
LARGE_COLLABORATION_THRESHOLD = 20  // Show "et al." if authors > this

// Tooltip timing
tooltipShowDelay = 300ms      // Delay before showing abstract
tooltipHideDelay = 600ms      // Delay before hiding abstract

// Batch operations
BATCH_SIZE = 50               // For citation count enrichment and BibTeX batch copy
PARALLEL_BATCHES = 3          // Parallel batches for citation count fetching

// Chart statistics
CHART_MAX_BARS = 10           // Maximum bars for year view (dynamically adjusted)
CHART_MIN_COUNT_PER_BIN = 3   // Minimum papers per bin before merging

// Performance optimizations (v1.1.1)
filterDebounceDelay = 150     // ms, debounce delay for filter input
maxRowPoolSize = 150          // Max row elements in pool
LOCAL_STATUS_CHUNK_SIZE = 500 // SQL query batch size for local status

// LRU cache limits
referencesCache.maxSize = 100 // Max references cache entries
citedByCache.maxSize = 50     // Max cited-by cache entries
entryCitedCache.maxSize = 50  // Max entry-cited cache entries
metadataCache.maxSize = 500   // Max metadata cache entries
```

---

## 5. Data Flow

```
User selects item
    ↓
deriveRecidFromItem() → Check archiveLocation, URL, extra field
    ↓ (if not found)
fetchRecidFromInspire() → API lookup by DOI/arXiv/texkey
    ↓
loadEntries(recid, mode)
    ↓
fetchReferences() / fetchCitedBy() / fetchAuthorPapers()
    ↓ (with onProgress callback)
renderReferenceList() → Progressive render
    ↓ (async, after render)
enrichLocalStatus() + enrichCitationCounts() / enrichEntries()
    ↓
updateRowStatus() / updateRowCitationCount()
```

---

## 6. INSPIRE Search Integration (v1.1.2)

### 6.1 Search Bar Listener

The plugin integrates with Zotero's main search bar to enable INSPIRE searches using the `inspire:` prefix.

| Feature     | Description                                                    |
| ----------- | -------------------------------------------------------------- |
| **Trigger** | Type `inspire:` followed by query, press Enter                 |
| **Syntax**  | Native INSPIRE query syntax (e.g., `a Witten`, `t quark mass`) |
| **Results** | Displayed in new "🔍 Search" tab in References Panel           |

### 6.2 Event Interception

To prevent Zotero's default search from triggering:

```typescript
// Capture phase + stopImmediatePropagation
searchBar.addEventListener("keydown", handler, { capture: true });
searchBar.addEventListener("keypress", handler, { capture: true });

// Triple protection
event.preventDefault();
event.stopPropagation();
event.stopImmediatePropagation();

// Focus transfer before clearing
itemsView.focus();
target.value = "";
```

### 6.3 Search History

| Setting     | Value                                       |
| ----------- | ------------------------------------------- |
| Max entries | 10                                          |
| Storage     | Zotero preferences (`inspireSearchHistory`) |
| Format      | JSON array of query strings                 |

### 6.4 Search Mode UI

When in search mode, the panel displays:

- Dedicated search input field
- Search button
- History dropdown with recent searches
- Clear history option

---

## 7. Batch Import Feature (v1.1.4)

### 7.1 Checkbox Selection

- Checkboxes appear on the left side of each entry
- Supports single selection, Shift+Click range selection, and Ctrl/Cmd+Click multi-selection
- Selection state managed via `selectedEntryIDs: Set<string>`

### 7.2 Batch Toolbar

- Appears when entries are selected, showing:
  - Selected count badge ("N selected")
  - "Select All" button (selects all filtered entries)
  - "Clear" button (clears all selections)
  - "Import" button (executes batch import)

### 7.3 Duplicate Detection

- Before import, batch detection of duplicates in local library
- Detection priority: recid > arXiv > DOI
- Batch query functions:
  - `findItemsByRecids()`: Batch query by recid (from `archiveLocation` field)
  - `findItemsByArxivs()`: Batch query by arXiv ID (extracted from `Extra` field)
  - `findItemsByDOIs()`: Batch query by DOI (from `DOI` or `Extra` field)

### 7.4 Duplicate Dialog

- Shows list of duplicate entries with match type (recid/arXiv/DOI)
- Checkboxes default to unchecked (skip), user can select which duplicates to import
- Quick actions: "Skip All" / "Import All"
- Dialog uses `position: fixed` for proper centering

### 7.5 Batch Import Execution

- Single save target selection (library/collections/tags/notes)
- Concurrent import with `CONCURRENCY = 3` limit
- ProgressWindow shows "Importing N/M" with percentage
- ESC key cancellation supported (with AbortController compatibility handling)
- Error handling: individual failures don't affect other entries

### 7.6 Export Enhancement

- Export buttons (`showExportMenu()` / `exportEntries()`) detect `selectedEntryIDs.size`
- When entries are selected: only export selected entries, menu header shows count
- When no selection: export all visible entries (original behavior)

---

## 8. Architecture Refactoring (v2.1.0)

A major internal refactoring focused on code quality, modularity, and maintainability.

### 8.1 Modular Panel Architecture

Extracted 6 independent manager classes from the monolithic `InspireReferencePanelController`:

| Manager              | Responsibility                                          | Lines |
| -------------------- | ------------------------------------------------------- | ----- |
| `ChartManager`       | Statistics chart rendering and interaction              | ~500  |
| `FilterManager`      | Text filtering, Quick Filters, author/published filters | ~400  |
| `NavigationManager`  | Back/forward navigation with scroll state preservation  | ~300  |
| `ExportManager`      | BibTeX/LaTeX export to clipboard or file                | ~500  |
| `BatchImportManager` | Batch selection, duplicate detection, and import        | ~520  |
| `RowPoolManager`     | Row pooling and template management (PERF-13 core)      | ~290  |

### 8.2 Performance Monitoring

New `PerformanceMonitor` class for timing operations and detecting slow operations:

```typescript
// Timing API
const monitor = getPerformanceMonitor();
const timerId = monitor.start("operation");
// ... do work ...
monitor.stop(timerId);

// Async measurement
const result = await monitor.measureAsync("fetchData", () => fetchData());

// Statistics
const stats = monitor.getStats("operation");
// { count, totalMs, avgMs, minMs, maxMs, lastMs }

// Report
const report = monitor.getReport();
// { startTime, endTime, duration, operations: [...stats] }
```

### 8.3 Unit Test Coverage

Added 153 unit tests using Vitest framework across 4 test files:

| Test File                      | Tests | Coverage                              |
| ------------------------------ | ----- | ------------------------------------- |
| `test/textUtils.test.ts`       | 25    | Text normalization and filtering      |
| `test/filters.test.ts`         | 56    | Filter predicates and Quick Filters   |
| `test/apiTypes.test.ts`        | 38    | API type guards and utility functions |
| `test/matchStrategies.test.ts` | 34    | PDF citation matching strategies      |

### 8.4 Code Quality Improvements

#### Magic Numbers to Named Constants

Extended `constants.ts` with organized constant groups:

```typescript
// UI timing constants
export const FILTER_DEBOUNCE_MS = 150;
export const CHART_THROTTLE_MS = 300;
export const TOOLTIP_SHOW_DELAY_MS = 300;
export const TOOLTIP_HIDE_DELAY_MS = 600;

// Cache size constants
export const REFERENCES_CACHE_SIZE = 100;
export const METADATA_CACHE_SIZE = 500;
export const ROW_POOL_MAX_SIZE = 150;

// Filter thresholds
export const HIGH_CITATIONS_THRESHOLD = 50;
export const SMALL_AUTHOR_GROUP_THRESHOLD = 10;
```

#### Style Utilities

New `styles.ts` module for consolidated inline styles:

```typescript
import { applyStyles, FLEX_STYLES, BUTTON_STYLES } from "./styles";

// Apply multiple style patterns
applyStyles(element, FLEX_STYLES.column, BUTTON_STYLES.primary);

// Check dark mode
if (isDarkMode()) { ... }
```

#### Filter Strategy Pattern

New `filters.ts` with unified filter predicates:

```typescript
import { matchesHighCitations, getQuickFilterPredicate } from "./filters";

// Direct predicate usage
const isHighCited = matchesHighCitations(entry, context);

// Registry-based lookup
const predicate = getQuickFilterPredicate("highCitations");
const matches = predicate(entry, context);
```

#### Complete API Type Definitions

New `apiTypes.ts` with full INSPIRE API types:

```typescript
import {
  isInspireLiteratureSearchResponse,
  getPrimaryTitle,
  getPrimaryArxivId,
  extractRecidFromRef,
} from "./apiTypes";

// Type guard
if (isInspireLiteratureSearchResponse(response)) {
  const hits = response.hits.hits;
}

// Utility functions
const title = getPrimaryTitle(metadata);
const arxiv = getPrimaryArxivId(metadata);
```

### 8.5 Memory Monitoring and Debug Commands

New `MemoryMonitor` class provides centralized cache statistics and debugging capabilities:

#### MemoryMonitor API

```typescript
// Singleton access
const monitor = MemoryMonitor.getInstance();

// Register caches for tracking
monitor.registerCache("myCache", myLRUCache);

// Get statistics
const report = monitor.getCacheStats();
// Returns: { caches: {...}, totalHits, totalMisses, overallHitRate, timestamp }

// Log to debug output
monitor.logCacheStats();

// Reset all counters
monitor.resetCacheStats();

// Periodic monitoring
monitor.start(30000); // Log every 30 seconds
monitor.stop();
```

#### Console Commands

Available in Zotero Error Console (`Tools` → `Developer` → `Error Console`):

| Command                                       | Description                                |
| --------------------------------------------- | ------------------------------------------ |
| `Zotero.ZoteroInspire.getCacheStats()`        | Returns cache statistics object            |
| `Zotero.ZoteroInspire.logCacheStats()`        | Logs formatted stats to debug output       |
| `Zotero.ZoteroInspire.resetCacheStats()`      | Resets all hit/miss counters               |
| `Zotero.ZoteroInspire.startMemoryMonitor(ms)` | Starts periodic logging (default: 30000ms) |
| `Zotero.ZoteroInspire.stopMemoryMonitor()`    | Stops periodic logging                     |

#### Registered Caches

The following caches are automatically registered on startup:

- `recidLookup` - INSPIRE recid lookups
- `processedData` - PDF processed data
- `pageData` - PDF page data
- `pdfMapping` - PDF numeric reference mapping
- `pdfAuthorYearMapping` - PDF author-year mapping

---

_Last updated: 2025-12-14 (v2.1.1)_
