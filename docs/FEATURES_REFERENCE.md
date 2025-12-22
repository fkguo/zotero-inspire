# Zotero INSPIRE Plugin - Technical Reference

> This document provides technical details for the INSPIRE References Panel and related functionality.
> It serves as a reference for developers and advanced users.

---

## 1. INSPIRE References Panel

### 1.1 View Modes

| Mode                    | Description                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| **References**    | Shows papers cited by the current item (from INSPIRE's references data) |
| **Cited By**      | Shows papers that cite the current item                                 |
| **Entry Cited**   | Shows papers citing a specific reference (click citation count)         |
| **Author Papers** | Shows all papers by a specific author (click author name)               |
| **Search**        | Shows INSPIRE search results                                            |

### 1.2 Data Loading

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

### 1.3 Statistics Chart

A statistics visualization chart is displayed at the top of the panel for References, Cited By, and Author Papers modes:

- **By Year view**: Shows distribution of entries by publication year
  - Intelligently merges early years to show at most 10 bars
  - Summary display: total paper count (e.g., "45 papers")
- **By Citations view**: Shows distribution by citation count
  - Fixed bins: 0, 1-9, 10-49, 50-99, 100-249, 250-499, 500+
  - Summary display: total citations, h-index, average citations
- **Interactive filtering**: Click bars to filter, Ctrl/Cmd+click for multi-select, Shift+click for range selection
- **Collapse/Expand**: Auto-clears chart filters when collapsed
- **Author count filter**: "≤10 Authors" button excludes large collaborations
- **Self-citation filter**: "Excl. self-cit." button excludes self-citations (By Citations view and Author Papers)
- **Published filter**: "Published only" button shows only formally published papers

### 1.4 Filter System

- Real-time filtering across all loaded entries
- **Phrase search**: Double quotes `"..."` for exact phrase matching
- **Journal abbreviations**: Supports `"PRL"`, `"PRD"`, `"JHEP"`, `"NPA"`, `"NPB"`, `"PLB"`, `"EPJA"`, `"EPJC"`, `"CPC"`, `"CPL"`, `"CTP"`, etc.
- **Character normalization**: Handles umlauts, accents (ä→ae)
- **Quick filters**: Presets for High citations, Related items, Local items, Online items, Recent 5y, Recent 1y, Published, arXiv only,
- **AND logic**: All filters combine with AND logic

### 1.5 Entry Display

- Reference label (e.g., `[1]`, `[2]`)
- Clickable author names → view author's papers
- Year display
- Clickable title → open in INSPIRE or arXiv/DOI fallback
- Publication summary (journal, volume, pages, arXiv ID)
- Citation count button → view citing papers
- Local status indicator: ● (in library), ⊕ (missing)
- Related item indicator: link icon
- BibTeX copy button
- TeX key copy button
- Abstract tooltip on hover
- Author list: up to 10 authors; if more, shows first 3 + "others"

### 1.6 Interaction Table

| Action                         | Behavior                                           |
| ------------------------------ | -------------------------------------------------- |
| Click local status (●/⊕)     | Open existing item in library, or add missing item |
| Double-click local status (●) | Open PDF directly if available                     |
| Click link icon                | Add/remove related item relationship               |
| Click author name              | View all papers by that author                     |
| Click title                    | Open in INSPIRE (or arXiv/DOI fallback)            |
| Click citation count           | View papers citing this entry                      |
| Click BibTeX button            | Copy BibTeX to clipboard                           |
| Click TeX key button           | Copy INSPIRE TeX key to clipboard                  |
| Hover over title               | Show abstract tooltip                              |
| Hover over author name         | Show author profile preview card                   |
| Click refresh button           | Reload current view (bypass cache)                 |
| Click copy all BibTeX button   | Copy all visible entries as BibTeX                 |

### 1.7 Author Profile Preview

When hovering over an author name, a profile preview card appears with the following information:

| Field                      | Description                                      |
| -------------------------- | ------------------------------------------------ |
| **Name + BAI**       | Author name and INSPIRE Author Identifier        |
| **Position**         | Current institution and rank (if available)      |
| **arXiv Categories** | Research areas (e.g., hep-ph, nucl-th)           |
| **Quick Links**      | 📧 Email, 🆔 ORCID, 🔗 INSPIRE page, 🌐 Homepage |
| **View Papers**      | Button to open Author Papers tab                 |

**Data Source Priority**:

1. **Direct recid lookup**: `/api/authors/{recid}` - most accurate, fastest
2. **BAI search**: `/api/authors?q=ids.value:{bai}` - highly reliable
3. **Name search**: `/api/authors?q=name:{name}` - fallback, may have duplicates

**Caching**:

- LRU cache with 100 entries, 30-minute TTL
- Multi-key caching: same profile cached under recid, BAI, and name keys

---

## 2. Caching System

### 2.1 Memory Caches (LRU)

All data caches use LRU (Least Recently Used) eviction to prevent unbounded memory growth.

| Cache                         | Max Size | Purpose                                   |
| ----------------------------- | -------- | ----------------------------------------- |
| `referencesCache`           | 100      | Caches fetched references by recid + sort |
| `citedByCache`              | 50       | Caches cited-by results by recid + sort   |
| `entryCitedCache`           | 50       | Caches entry-cited/author-papers results  |
| `metadataCache`             | 500      | Caches individual record metadata         |
| `recidLookupCache`          | 500      | Caches recid lookups                      |
| `authorProfileCache`        | 100      | Caches author profiles (30min TTL)        |
| `processedDataCache`        | 20       | Caches PDF processed data per item        |
| `pageDataCache`             | 50       | Caches PDF page data per item+page        |
| `pdfMappingCache`           | 30       | Caches PDF numeric reference mapping      |
| `pdfAuthorYearMappingCache` | 30       | Caches PDF author-year mapping            |
| `rowCache`                  | -        | Caches DOM elements for rendered rows     |
| `searchTextCache`           | -        | WeakMap caches search text per entry      |

### 2.2 LRU Cache Statistics

All LRU caches track hit/miss statistics for performance analysis:

```typescript
interface CacheStats {
  hits: number; // Number of cache hits
  misses: number; // Number of cache misses
  hitRate: number; // hits / (hits + misses)
  size: number; // Current entries in cache
  maxSize: number; // Maximum cache capacity
}
```

### 2.3 Local Persistent Cache

A dedicated `localCache` service stores References/Cited By/Author Papers JSON files on disk:

- **References**: Permanent (no TTL)
- **Cited By / Author Papers**: Default 24h TTL (configurable)
- **Smart caching strategy**:
  - **References**: Single unsorted cache file; sorting done client-side
  - **Cited By / Author Papers**: Single cache if ≤10,000; separate files per sort if >10,000
- **Gzip compression**: Large files compressed via pako (`.json.gz`), ~80% disk savings
- **Integrity sampling**: Random validation on read; corrupt files auto-deleted
- **Batch prefetch**: Right-click "Download references cache" for offline use

---

## 3. Right-Click Menu Operations

### 3.1 Item Menu

| Category                  | Operation                    | Description                                                    |
| ------------------------- | ---------------------------- | -------------------------------------------------------------- |
| **Update Metadata** | With abstracts               | Full metadata update including abstract                        |
|                           | Without abstracts            | Metadata update excluding abstract                             |
|                           | Citation counts only         | Only update citation counts (falls back to CrossRef if needed) |
| **Cache**           | Download references cache    | Prefetch INSPIRE references into local cache                   |
| **Copy**            | Copy BibTeX                  | Fetch and copy BibTeX from INSPIRE                             |
|                           | Copy citation key            | Copy item's citation key                                       |
|                           | Copy INSPIRE link            | Copy INSPIRE literature URL                                    |
|                           | Copy INSPIRE link (Markdown) | Copy as markdown link with title                               |
|                           | Copy Zotero link             | Copy Zotero select link                                        |
| **Collaboration Tags** | Add Collaboration Tags    | Add collaboration name as tag for large collaboration papers   |
| **Preprint**        | Check Preprint Status        | Check if arXiv preprints have been published                   |
| **Actions**         | Cancel update                | Cancel any ongoing update operation                            |

### 3.2 Collection Menu

| Category                  | Operation                      | Description                                       |
| ------------------------- | ------------------------------ | ------------------------------------------------- |
| **Update Metadata** | With abstracts                 | Update all items in collection with full metadata |
|                           | Without abstracts              | Update all items excluding abstracts              |
|                           | Citation counts only           | Update citation counts for all items              |
| **Cache**           | Download references cache      | Prefetch references for all items                 |
| **Collaboration Tags** | Reapply Collaboration Tags  | Reapply collaboration tags to items in collection |
| **Preprint**        | Check Preprints in Collection  | Check preprints in this collection                |
|                           | Check All Preprints in Library | Check all preprints in entire library             |
| **Actions**         | Cancel update                  | Cancel any ongoing update operation               |

---

## 4. Metadata Update

### 4.1 Standard Mode

- **Concurrent processing**: 4 parallel workers for batch updates
- **Progress window**: Shows update progress
- **CrossRef fallback**: Falls back to CrossRef for citation counts if INSPIRE fails
- **Item type conversion**: Converts preprints to journal articles when published
- **Tag support**: Can tag items without INSPIRE recid

### 4.2 Smart Update Mode

When enabled, Smart Update compares local item data with INSPIRE metadata and allows selective field updates:

**Features**:

- **Field comparison**: Detects changes between local and INSPIRE data
- **Preview dialog**: Shows all detected changes with checkboxes (single-item updates)
- **Protected fields**: Configurable fields that won't be overwritten:
  - Title, Authors, Abstract, Journal
- **Protected author names**: Comma-separated list of names to always preserve (e.g., "Meißner, Müller")
- **Automatic diacritic preservation**: Detects when local names have diacritics (ä, ö, ü, ß, é, ñ) that INSPIRE stores as ASCII; automatically preserves local spelling

**Preferences**:

| Preference                        | Type    | Default | Description                            |
| --------------------------------- | ------- | ------- | -------------------------------------- |
| `smart_update_enable`           | boolean | false   | Master toggle                          |
| `smart_update_show_preview`     | boolean | true    | Show preview dialog for single items   |
| `smart_update_protect_title`    | boolean | true    | Protect title field                    |
| `smart_update_protect_authors`  | boolean | true    | Protect authors field                  |
| `smart_update_protect_abstract` | boolean | false   | Protect abstract field                 |
| `smart_update_protect_journal`  | boolean | false   | Protect journal field                  |
| `smart_update_protected_names`  | string  | ""      | Comma-separated protected author names |

---

## 5. PDF Reader Integration

### 5.1 Citation Detection

When selecting text containing citation markers in the Zotero PDF Reader, the add-on automatically detects citations and provides lookup buttons.

- **Text Selection**: Select text containing citations (e.g., "see Refs. [1,2,3]")
- **Popup Button**: Shows "INSPIRE Refs. [n]" button when citations detected
- **Multiple Citations**: Shows multiple buttons for multiple citations

### 5.2 Supported Citation Formats

| Format             | Examples                                     |
| ------------------ | -------------------------------------------- |
| Single number      | `[1]`, `[42]`                            |
| Multiple numbers   | `[1,2,3]`, `[1, 2, 3]`                   |
| Number range       | `[1-5]`, `[1–5]`                        |
| Mixed format       | `[1,3-5,7]`                                |
| Author-year        | `[Smith 2024]`, `[WGR17]`                |
| Superscript digits | ¹²³⁴⁵⁶⁷⁸⁹⁰                         |

### 5.3 Hover Preview

Preview card appears when hovering over lookup buttons:

- Contents: Title, authors, abstract, publication info, identifiers
- Ambiguous match hint: "Author-year match only; click to select"

### 5.4 Panel Integration

When clicking the lookup button:

1. Automatically switches to References tab
2. Highlights the corresponding reference entry (temporary pulse + persistent focus)
3. Scrolls to that entry position

### 5.5 Persistent Focus Selection

After jumping from PDF lookup, the entry maintains a focused state:

- Light blue background + blue left border
- Clears on: Escape key, tab switch, refresh, or clicking another entry
- Independent from batch import checkbox selection

### 5.6 Fuzzy Detection Mode (Experimental)

For PDFs with broken text layers:

- Location: Preferences → References Panel → Fuzzy citation detection
- Recognizes citation patterns without brackets
- Smart exclusions: Section/Figure/Table terms, physics units, decimals, etc.
- Default: Disabled

---

## 6. INSPIRE Search Integration

### 6.1 Search Bar Listener

The plugin integrates with Zotero's main search bar using the `inspire:` prefix.

| Feature           | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| **Trigger** | Type `inspire:` followed by query, press Enter                  |
| **Syntax**  | Native INSPIRE query syntax (e.g.,`a Witten`, `t quark mass`) |
| **Results** | Displayed in "🔍 Search" tab in References Panel                  |

### 6.2 Event Interception

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

| Setting     | Value                                         |
| ----------- | --------------------------------------------- |
| Max entries | 10                                            |
| Storage     | Zotero preferences (`inspireSearchHistory`) |
| Format      | JSON array of query strings                   |

---

## 7. Batch Import

### 7.1 Checkbox Selection

- Checkboxes on left side of each entry
- Single selection, Shift+Click range, Ctrl/Cmd+Click multi-selection
- Selection state: `selectedEntryIDs: Set<string>`

### 7.2 Batch Toolbar

Appears when entries are selected:

- Selected count badge ("N selected")
- "Select All" / "Clear" / "Import" buttons

### 7.3 Duplicate Detection

- Before import, batch detection of duplicates in local library
- Priority: recid > arXiv > DOI
- Functions: `findItemsByRecids()`, `findItemsByArxivs()`, `findItemsByDOIs()`

### 7.4 Duplicate Dialog

- Shows list of duplicate entries with match type
- Default: unchecked (skip)
- Quick actions: "Skip All" / "Import All"

### 7.5 Batch Import Execution

- Single save target selection (library/collections/tags/notes)
- Concurrent import with `CONCURRENCY = 3` limit
- ProgressWindow shows "Importing N/M"
- ESC key cancellation supported
- Error handling: individual failures don't affect other entries

### 7.6 Export Enhancement

- Export buttons detect `selectedEntryIDs.size`
- When selected: only export selected entries
- When none: export all visible entries
- Export menu includes "Copy citation keys" for selected entries

### 7.7 Citation Style Export

The "Select Citation Style..." option opens a picker dialog for exporting references in any Zotero citation style:

| Feature                    | Description                                       |
| -------------------------- | ------------------------------------------------- |
| **Style Selection**  | Choose from installed Zotero citation styles      |
| **Target Selection** | Pick destination library and collections          |
| **Tags & Notes**     | Optionally prefill tags and notes                 |
| **Draggable**        | Header bar supports drag-to-move                  |
| **Resizable**        | Edge handles for resizing (w, e, s, sw, se)       |
| **Filter**           | Search box filters styles and collections by name |

**Positioning Logic**:

- Prefers positioning below anchor button
- Falls back to above if insufficient space below
- Centers vertically if neither fits
- Minimum 10px from viewport top (ensures header visibility)

### 7.8 Copy Citation Keys

The "Copy citation keys" feature copies INSPIRE texkeys (citation keys) to clipboard, comma-separated for easy paste into LaTeX `\cite{}` commands.

**Data Source Priority**:

1. **Entry texkey**: Uses cached `entry.texkey` if already populated from enrichment
2. **Zotero library**: For entries with `localItemID`, fetches `citationKey` field from Zotero item (no network request)
3. **INSPIRE API**: Falls back to batch API query for remaining entries without texkeys

**Implementation Details**:

```typescript
// Priority 1: Check entry.texkey (already cached from enrichment)
if (entry.texkey?.trim()) continue;

// Priority 2: Check Zotero item's citationKey field
if (entry.localItemID) {
  const item = Zotero.Items.get(entry.localItemID);
  const citationKey = item?.getField("citationKey")?.trim();
  if (citationKey) {
    entry.texkey = citationKey;
    continue;
  }
}

// Priority 3: Batch fetch from INSPIRE API (only for remaining entries)
const url = `${INSPIRE_API_BASE}/literature?q=${query}&fields=control_number,texkeys`;
```

**Benefits**:

- Minimizes network requests by checking local sources first
- Works offline for entries already in Zotero library
- Batch fetches remaining texkeys efficiently (up to 100 per request)
- Supports AbortController for cancellation

---

## 8. Preprint Watch

Detects unpublished arXiv preprints and checks if they have been published.

### 8.1 Detection Logic

A Zotero item is identified as an unpublished preprint if:

- `journalAbbreviation` starts with `arXiv:` AND has no non-arXiv DOI
- Or has only arXiv DOI (`10.48550/arXiv.xxx`)
- Or has `arXiv:` in Extra field but no journal info

### 8.2 Entry Points

| Entry                   | Action                                       |
| ----------------------- | -------------------------------------------- |
| Item context menu       | Check Preprint Status for selected items     |
| Collection context menu | Check Preprints in Collection                |
| Collection context menu | Check All Preprints in Library (whole lib)   |
| Background (startup)    | Auto-check on first startup (once per day)   |

### 8.3 Update Process

When publications are found:

1. Shows dialog listing published items with checkboxes
2. User selects which items to update
3. Updates: DOI, journalAbbreviation, volume, pages, date (year)
4. Preserves arXiv info in Extra field

### 8.4 Preferences

| Preference                    | Type    | Default | Description                   |
| ----------------------------- | ------- | ------- | ----------------------------- |
| `preprint_watch_enabled`    | boolean | true    | Master toggle                 |
| `preprint_watch_auto_check` | string  | "daily" | Auto-check mode: daily/never  |
| `preprint_watch_notify`     | boolean | true    | Show notification on findings |

---

## 9. Constants Reference

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
CHART_MAX_BARS = 10           // Maximum bars for year view
CHART_MIN_COUNT_PER_BIN = 3   // Minimum papers per bin before merging

// Performance
filterDebounceDelay = 150     // ms, debounce delay for filter input
maxRowPoolSize = 150          // Max row elements in pool
LOCAL_STATUS_CHUNK_SIZE = 500 // SQL query batch size for local status

// LRU cache limits
referencesCache.maxSize = 100
citedByCache.maxSize = 50
entryCitedCache.maxSize = 50
metadataCache.maxSize = 500
```

---

## 10. Data Flow

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

## 11. Performance Optimizations

### 11.1 Rendering

- **Frontend pagination**: Only renders first 100 entries, with infinite scroll for rest
- **Non-blocking enrichment**: Local status and citation counts fetched after initial render
- **Progressive rendering**: Shows data as it loads, not after complete
- **Filter input debouncing**: 150ms delay reduces re-renders during fast typing
- **Row element pooling**: Pool of up to 150 row elements for reuse
- **Chart lazy calculation**: Uses `setTimeout(0)` / `requestIdleCallback`

### 11.2 Data Fetching

- **Batch API queries**: Citation counts fetched in batches of 50 recids
- **Citation count parallel fetching**: 3 batches fetched in parallel per round
- **Local status query optimization**: SQL batch size increased to 500
- **Search text caching**: WeakMap caches `buildEntrySearchText()` results
- **Infinite scroll**: IntersectionObserver auto-loads more entries

### 11.3 Memory Management

- **LRU caches**: Bounded caches prevent memory leaks
- **Chart statistics caching**: Cached per view mode to avoid recomputation
- **String caching**: Locale strings cached for performance

---

## 12. Debug Commands

Available in Zotero Error Console (`Tools` → `Developer` → `Error Console`):

| Command                                         | Description                                |
| ----------------------------------------------- | ------------------------------------------ |
| `Zotero.ZoteroInspire.getCacheStats()`        | Returns cache statistics object            |
| `Zotero.ZoteroInspire.logCacheStats()`        | Logs formatted stats to debug output       |
| `Zotero.ZoteroInspire.resetCacheStats()`      | Resets all hit/miss counters               |
| `Zotero.ZoteroInspire.startMemoryMonitor(ms)` | Starts periodic logging (default: 30000ms) |
| `Zotero.ZoteroInspire.stopMemoryMonitor()`    | Stops periodic logging                     |

**Registered Caches**:

- `recidLookup` - INSPIRE recid lookups
- `processedData` - PDF processed data
- `pageData` - PDF page data
- `pdfMapping` - PDF numeric reference mapping
- `pdfAuthorYearMapping` - PDF author-year mapping

**Sample Output**:

```
processedData: 85.2% hit rate (23/27), size: 15/20
pageData: 92.1% hit rate (117/127), size: 48/50
pdfMapping: 78.6% hit rate (11/14), size: 8/30
recidLookup: 95.0% hit rate (190/200), size: 156/500
[Overall]: 91.3% hit rate (341/368)
```

---

## 13. Abstract Rendering

### 13.1 LaTeX Mode

Two rendering modes for LaTeX formulas in abstracts:

| Mode        | Description                                                      |
| ----------- | ---------------------------------------------------------------- |
| **KaTeX**   | Full KaTeX rendering for complex formulas (fractions, integrals, matrices) |
| **Unicode** | Converts simple LaTeX to Unicode characters (lightweight)        |

**Preferences**:

| Preference             | Type   | Default | Description          |
| ---------------------- | ------ | ------- | -------------------- |
| `latex_render_mode`  | string | "katex" | "katex" or "unicode" |

**KaTeX Features**:

- Bundled KaTeX library (no external dependencies)
- Custom macros for physics notation (GeV, TeV, etc.)
- Graceful fallback on render errors
- Supports display and inline math modes

### 13.2 Abstract Copy Context Menu

Right-click on abstract preview card shows context menu:

| Option               | Description                              |
| -------------------- | ---------------------------------------- |
| **Copy**             | Copy full abstract as plain text         |
| **Copy Selection**   | Copy selected text (if any)              |
| **Copy as LaTeX**    | Copy original LaTeX source code          |

**Implementation**:

- Context menu appears on right-click over abstract content
- LaTeX source preserved from INSPIRE API response
- Selection-aware: shows "Copy Selection" only when text is selected
