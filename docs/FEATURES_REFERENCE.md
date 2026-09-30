# Zotero INSPIRE Plugin - Technical Reference

> This document provides technical details for the INSPIRE References Panel, the arXiv browser (section 15) and related functionality.
> It serves as a reference for developers and advanced users. The plugin requires Zotero 10.

---

## 1. INSPIRE References Panel

### 1.1 View Modes

| Mode              | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| **References**    | Shows papers cited by the current item (from INSPIRE's references data) |
| **Cited By**      | Shows papers that cite the current item                                 |
| **Related**       | Recommends papers via a hybrid score (shared refs + co-citation)        |
| **Entry Cited**   | Shows papers citing a specific reference (click citation count)         |
| **Author Papers** | Shows all papers by a specific author (click author name)               |
| **Search**        | Shows INSPIRE search results                                            |
| **Favorites**     | Shows favorite authors and papers                                       |

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

#### Related Mode

The **Related** tab recommends papers using a **hybrid** similarity score that blends:

1. **Weighted bibliographic coupling** (shared references): pick `K` anchor references from the seed paper’s references; for each anchor `r`, fetch the top `N` papers that cite `r`, and aggregate per-candidate shared anchors.
2. **Co-citation** re-ranking: for the top `T` coupling candidates, query INSPIRE for the number of papers that cite **both** the seed and the candidate, and compute a normalized co-citation cosine similarity.

**Scoring (implementation)**:

- Anchor weight: `w_r = 1 / (1 + log1p(c_r))` where `c_r` is the anchor’s citation count (highly cited “generic” anchors contribute less).
- Coupling score: `couplingScore = (Σ_{r∈shared} w_r) / (Σ_{r∈anchors} w_r)`.
- Co-citation score: `coCitationScore = co / sqrt(seedCites * candCites)` (clamped to `[0,1]`).
- Blend weight: `α = 0` if `seedCites < 5`, else `α = 0.5 * sigmoid(0.15 * (seedCites - 30))`, where `sigmoid(x) = 1 / (1 + exp(-x))` (so `α ∈ [0, 0.5]`).
- Combined: `combinedScore = (1-α) * couplingScore + α * coCitationScore`.

**Budget control & filtering**:

- Co-citation is computed only for the top `T = 25` coupling candidates.
- By default it excludes review articles and ignores PDG _Review of Particle Physics_ as an anchor (too generic).

**Caching**:

- Stored in `localCache` under a versioned key (includes algorithm version and main preferences) so cached recommendations can be reused.

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
- Local status indicator: ● (in library), ②…⑳ (several items for the paper; a click selects the first), ⊕ (missing), ? (the library could not be read; a click tries again). Items come from one index of arXiv IDs, INSPIRE recids and DOIs over all libraries (trash excluded)
- Related item indicator: link icon
- **PDF status indicator**:
  - 📄 (green): PDF available, click to open
  - ⬇️ (blue): Item in library but no PDF, click to trigger Find Full Text
  - 📄 (gray): Item not in library (disabled)
- BibTeX copy button
- TeX key copy button
- Abstract tooltip on hover
- Author list: up to 10 authors; if more, shows first 3 + "others"

### 1.6 Favorites Tab

The **⭐ Favorites** tab provides quick access to favorite authors, papers, and presentations:

- **Favorite Authors**: Click the star (☆/★) button in Author Papers tab or author preview card to add/remove authors
- **Favorite Papers & Presentations**: Right-click any entry within the INSPIRE References panel and select "Add paper/presentation to favorites", or use the right-click menu in Zotero's main window. Items of type "Presentation" are categorized separately.
- **Display**: Favorites are organized in three collapsible sections (Authors, Papers, and Presentations) with drag-and-drop reordering within each section.
- **Filtering**: Text filter works across all favorites (searches author names, BAI, paper titles, authors, recids)
- **Navigation**: Click favorite entries to jump to the corresponding item or author papers view

**Storage**: Favorites are stored in preferences (`favorite_authors`, `favorite_papers`, and `favorite_presentations` as JSON arrays)

### 1.7 Interaction Table

| Action                        | Behavior                                           |
| ----------------------------- | -------------------------------------------------- |
| Click local status (●/⊕)      | Open existing item in library, or add missing item |
| Double-click local status (●) | Open PDF directly if available                     |
| Click link icon               | Add/remove related item relationship (undoable)    |
| Click PDF icon (green)        | Open PDF attachment in reader                      |
| Click PDF icon (blue)         | Trigger Find Full Text for the item                |
| Click author name             | View all papers by that author                     |
| Click title                   | Open in INSPIRE (or arXiv/DOI fallback)            |
| Click citation count          | View papers citing this entry                      |
| Click BibTeX button           | Copy BibTeX to clipboard                           |
| Click TeX key button          | Copy INSPIRE TeX key to clipboard                  |
| Hover over title              | Show abstract tooltip                              |
| Hover over author name        | Show author profile preview card                   |
| Click refresh button          | Reload current view (bypass cache)                 |
| Click export button           | Open export menu (clipboard, file, citation style) |
| Right-click entry (in panel)  | Context menu with favorite option                  |

### 1.8 Citation Graph

The **Citation Graph** dialog provides a 1-hop visualization of **References** (left) and **Cited-by** (right) for one or multiple seed papers.

- **Open**:
  - Panel toolbar graph button (uses the current item as seed)
  - Main toolbar button next to Zotero's search box (opens an empty canvas if no seeds are available)
  - Right-click menu → **INSPIRE** → **Combined Citation Graph…** (multi-seed)
- **Interactions**: click node to jump to Zotero item (if present); right-click to re-root; Cmd/Ctrl+click to add as seed; drag to pan; Cmd/Ctrl+wheel to zoom
- **Time zoom**: drag the range sliders under each x-axis to focus on a time window (left/right independent); nodes outside the window are hidden
- **Reviews toggle**: include/exclude review articles (including PDG RPP)

### Academic Tree

Open **Academic Tree** from an author preview card or the Author Papers profile, or switch to **Academic Tree** at the top of the Connections Graph window and search for an author.

- Set ancestors from **0 to 10** and descendants from **0 to 8**, with **2 generations in each direction** by default. Zero hides that direction. Branch expansion also stops at ten ancestor or eight descendant generations from the current root; click a boundary author's name to continue from a new center.
- **Sort within families**: all students of the same advisor on a generation row follow **Surname A–Z** (canonical INSPIRE name, default) or **Education year ↑**, including students who have additional advisors. Years use the degree type on that advisor–student relationship and a uniquely matching completed education record; unknown years come last, and ties use surname. If overlapping families require contradictory year orders, the advisor closest to the center takes priority. Card tooltips show education end years and their source. Navigation history and exports retain the selected order.
- Profiles and caches are shared with sidebar and hover cards, preserving canonical names and public education histories. Concurrent lookups share one request; incomplete old profiles are refreshed on demand.
- Author search history persists across reopening and restarts. The ▾ button or Down Arrow opens recent queries for reuse or clearing; Tab/Right Arrow accepts the sidebar-style inline suggestion at the end of the input. Author queries have their own history, using the same retention setting as literature search (30 days by default, up to 50 entries). Clearing history from preferences clears both.
- Click an author's name to trace their tree and display their author page in the sidebar while keeping the window open. Hovering over a name shows the same author preview card used in the sidebar.
- **Back / Forward** revisit authors and restore expanded branches, depth and relationship filters, selection, and the canvas position while updating the sidebar author page. Up to 20 visits are retained; selecting a different author after going back clears the forward history.
- Select a card's background for branch actions: expand one generation of advisors or students, set the person as the center, view papers, or open their INSPIRE profile.
- Cards fit their names and affiliations, preserving the 13px name font and centered text. When a full name would hide its ending, cards keep the first given name, use initials for later given names, retain the full surname, and grow slightly only when needed. The center stays above the middle of its direct students after expansion, with its single-supervisor ancestor chain vertical. The center also participates in its mentor’s student order while retaining this vertical alignment. Supplemental advisors stay near their students. Orthogonal links avoid cards, separate multiple-advisor arrowheads, and leave small gaps at crossings. Hover a line to highlight that relationship and its endpoints; hovering, focusing, or selecting a card highlights its relationships.
- A direct student of the center remains in generation +1. If another displayed student is also recorded as an advisor, that extra relationship remains visible as a same-generation connector instead of moving the direct student to generation +2.
- Shared advisors and multiple training relationships are retained. The layout accounts for multiple advisors when arranging generations. Filter PhD, master, bachelor, or other/unspecified relationships. Arrows run from advisor to student.
- Supplemental co-advisors use a very light gray background and a softer border, with unchanged name contrast. Classification matches the co-advisor filter; the center and selected card keep blue emphasis. Colors adapt to the Zotero theme and are preserved in light-theme image exports.
- **Co-advisors toggle**: supplemental co-advisors are hidden by default; show or hide them while keeping the center’s own mentors and expanded ancestor branches. **Find / path**: search loaded names, INSPIRE IDs and affiliations to locate a person without rerooting. Highlight the shortest relationship path between two loaded people, preserving arrow directions; the canvas fits that path.
- **Connectors**: branch points may be unevenly spaced to follow clear corridors. Cross-row links favor fewer turns before shorter distance; single-advisor arrows may enter slightly off-center to avoid tiny final jogs. Shared students retain separate advisor arrowheads; a directly aligned advisor keeps the center entry point when its vertical route is clear.
- **Relationship qualifications**: compact labels below the name and affiliation describe relationships to visible advisors, not the person’s highest degree. PhD, Diploma, Bachelor, Master, Habilitation, Laurea, Other and Unspecified remain distinct. Hover for the advisor–student mapping; hiding co-advisors removes their types from the labels. Filter each type individually or choose **Specified qualifications** for the first six. Other and missing types do not imply postdoctoral supervision. Labels are included in image exports.
- **Generation backgrounds**: both layouts use the same pale bands. Colors indicate display layers, not unique academic seniority. A student with mentors on different layers stays below all of them; links from earlier mentors can span layers.
- **Fit to page** (beside **Fit all**, **Center root**, **− / +**): wrap long generations to the window width without shrinking names. Pale generation bands and generation/row labels distinguish wrapping from descent; read left to right, then the next row. Scroll or drag vertically, or Ctrl/⌘ + scroll to zoom. Window resizing reflows the rows. Toggle off for the tree layout; **Fit all** retains its zoom-to-overview behavior. History and image/JSON exports preserve the mode.
- **Branches menu**: expand the direct students of all ancestors already shown, across every displayed ancestral generation. Each ancestor expands down exactly one generation; newly added people are not expanded recursively. The same button then switches to **Collapse added ancestors’ students**, which hides the added branches while keeping the original tree; expand again to restore loaded branches without fetching them again. Collapse a selected student branch or restore one/all collapsed branches without fetching data. Shared descendants remain when connected by another visible route; the center’s ancestral chain is protected. Locating a hidden person or showing a hidden path restores visibility.
- **📤 Export▼** uses the same popup and native file-saving code as Citation Graph: SVG/PNG export the complete layout for the selected scope. Current view includes every currently shown person, including people outside the panel; Full loaded tree also includes hidden branches. JSON/CSV export visible or all loaded people and relationships. JSON includes IDs, filters, collapse/path state and viewport. CSV distinguishes person and relationship rows. Full-tree export makes no network requests. Images use a light theme; PNG is bounded to 8192 pixels per side and 16 megapixels, while SVG retains full vector detail.

- Drag to pan, scroll to zoom, fit the whole graph, center the root, resize or maximize the window. Keyboard shortcuts: arrows to pan, +/− to zoom, and 0 to fit.
- **Refresh from INSPIRE** fetches fresh records for the current tree and expanded branches, retaining the previous graph while loading or if refresh fails. **Retry** appears after failures; **Continue loading** appears after **Stop**. Both reuse successful requests. Refresh preserves generation and relationship settings and the view position.
- Author cards show affiliations explicitly marked current by INSPIRE beneath the name. Historical or missing affiliations are omitted; hover over shortened text to read it in full.
- Results load progressively and can be stopped. The initial budget is 200 people; **Load more** increases it up to 1000. Focus on a branch to explore larger genealogies.
- Data comes from public INSPIRE author records. People are merged by author ID. Dashed cards contain names without linked author records and cannot be expanded automatically. Missing records do not establish that a relationship does not exist; failed branches can be retried.

### 1.9 Author Profile Preview

When hovering over an author name, a profile preview card appears with the following information:

| Field                | Description                                      |
| -------------------- | ------------------------------------------------ |
| **Name + BAI**       | Author name and INSPIRE Author Identifier        |
| **Position**         | Current institution and rank (if available)      |
| **arXiv Categories** | Research areas (e.g., hep-ph, nucl-th)           |
| **Quick Links**      | 📧 Email, 🆔 ORCID, 🔗 INSPIRE page, 🌐 Homepage |
| **View Papers**      | Button to open Author Papers tab                 |

The card also shows the number of the author's papers in your library and a link to the author's arXiv search. In the arXiv browser, the INSPIRE card is shown when the paper's INSPIRE record identifies the author; otherwise a local card shows the name, the library count and arXiv / INSPIRE search links (authors are never looked up by name there).

**Data Source Priority**:

1. **Direct recid lookup**: `/api/authors/{recid}` - most accurate, fastest
2. **BAI search**: `/api/authors?q=ids.value:{bai}` - highly reliable
3. **Name search**: `/api/authors?q=name:{name}` - fallback, may have duplicates

**Caching**:

- LRU cache with 100 entries, 30-minute TTL
- Multi-key caching: same profile cached under recid, BAI, and name keys

---

### 1.10 Item Tree Custom Columns

Zotero's main item list (Item Tree) supports two custom columns:

| Column  | Data Source (local)               | Notes                                                                                                                                     |
| ------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Cites` | `Extra` field                     | Reads `X citations ...` lines written by this plugin; default includes self-citations                                                     |
| `arXiv` | Journal Abbr. / Extra / URL / DOI | Extracted via `extractArxivIdFromItem()`; no network requests. Sorting normalizes old-style IDs (e.g., `hep-th/9802109`) by numeric part. |

**Preferences**:

| Preference                  | Type    | Default | Description                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cites_column_exclude_self` | boolean | false   | Show citation counts without self-citations when available. If the items list doesn't update, switch collections or restart Zotero.                                                                                                                                                                                                                                      |
| `arxiv_in_journal_abbrev`   | boolean | false   | Legacy: write `arXiv:...` into `journalAbbreviation` for unpublished papers (kept for backward compatibility).                                                                                                                                                                                                                                                           |
| `keep_preprint_type`        | boolean | true    | Keep `preprint` / `report` items as they are until INSPIRE reports a journal publication, then convert to `journalArticle`; unpublished arXiv `journalArticle` items (no journal data locally or on INSPIRE) become `preprint` again on a full update, and panel imports of unpublished papers are created as `preprint`. Ignored while `arxiv_in_journal_abbrev` is on. |

---

## 2. Caching System

### 2.1 Memory Caches (LRU)

All data caches use LRU (Least Recently Used) eviction to prevent unbounded memory growth.

| Cache                       | Max Size | Purpose                                   |
| --------------------------- | -------- | ----------------------------------------- |
| `referencesCache`           | 100      | Caches fetched references by recid + sort |
| `citedByCache`              | 50       | Caches cited-by results by recid + sort   |
| `entryCitedCache`           | 50       | Caches entry-cited/author-papers results  |
| `metadataCache`             | 500      | Caches individual record metadata         |
| `recidLookupCache`          | 500      | Caches recid lookups                      |
| `authorProfileCache`        | 100      | Caches author profiles (30min TTL)        |
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

| Category               | Operation                    | Description                                                    |
| ---------------------- | ---------------------------- | -------------------------------------------------------------- |
| **Update Metadata**    | With abstracts               | Full metadata update including abstract                        |
|                        | Without abstracts            | Metadata update excluding abstract                             |
|                        | Citation counts only         | Only update citation counts (falls back to CrossRef if needed) |
| **Cache**              | Download references cache    | Prefetch INSPIRE references into local cache                   |
| **Copy**               | Copy BibTeX                  | Fetch and copy BibTeX from INSPIRE                             |
|                        | Copy citation key            | Copy item's citation key                                       |
|                        | Copy INSPIRE recid           | Copy INSPIRE record ID                                         |
|                        | Copy INSPIRE link            | Copy INSPIRE literature URL                                    |
|                        | Copy INSPIRE link (Markdown) | Copy as markdown link with title                               |
|                        | Copy Zotero link             | Copy Zotero select link                                        |
| **Collaboration Tags** | Add Collaboration Tags       | Add collaboration name as tag for large collaboration papers   |
| **Preprint**           | Check Preprint Status        | Check if arXiv preprints have been published                   |
| **Favorites**          | Toggle Favorite Paper        | Add/remove current item from favorites                         |
| **Actions**            | Cancel update                | Cancel any ongoing update operation                            |

### 3.2 Collection Menu

| Category               | Operation                      | Description                                       |
| ---------------------- | ------------------------------ | ------------------------------------------------- |
| **Update Metadata**    | With abstracts                 | Update all items in collection with full metadata |
|                        | Without abstracts              | Update all items excluding abstracts              |
|                        | Citation counts only           | Update citation counts for all items              |
| **Cache**              | Download references cache      | Prefetch references for all items                 |
| **Collaboration Tags** | Reapply Collaboration Tags     | Reapply collaboration tags to items in collection |
| **Preprint**           | Check Preprints in Collection  | Check preprints in this collection                |
|                        | Check All Preprints in Library | Check all preprints in entire library             |
| **Actions**            | Cancel update                  | Cancel any ongoing update operation               |

---

## 4. Metadata Update

### 4.1 Standard Mode

- **Concurrent processing**: 4 parallel workers for batch updates
- **Progress window**: Zotero's popup kept on top and open while you work (`runProgressWindow.ts`); it can be dragged, and `Escape` in it cancels. Overlapping runs each keep their own popup and final notice
- **Cancel**: `Escape` in the main window (not in text fields, reader tabs, or the collection filter) or `INSPIRE` → `Cancel update` cancels every active run and aborts its requests; the notice reads "Processed completed/total items, N of them updated"
- **Failed requests**: an item without a usable INSPIRE answer (network, server or record problem) is left unchanged and counted in a notice; only an item INSPIRE answered without a record gets the `tag_norecid` tag (when `tag_enable` is on)
- **Authors**: an INSPIRE author list that is shorter than the item's, or lacks one of its authors, never replaces it in a plain update or a preprint publication update; in the Smart Update preview the change is a conflict, unticked, with a note
- **CrossRef fallback**: Falls back to CrossRef for citation counts if INSPIRE fails
- **Item type conversion**: `keep_preprint_type` is ignored while `arxiv_in_journal_abbrev` is on (Journal Abbr. exists only for Journal Article). With `keep_preprint_type` (default on), `preprint` / `report` items become `journalArticle` only once INSPIRE reports a journal publication, and unpublished arXiv `journalArticle` items are turned back into `preprint`; with it off, `preprint` / `report` become `journalArticle` as soon as an INSPIRE record is found (historical behaviour). Records typed `book` on INSPIRE become `book`. The `preprint` -> `journalArticle` / `journalArticle` -> `preprint` decisions need the full record, so they only run for full / no-abstract updates, never for citation-count-only requests
- **Tag support**: Can tag items without INSPIRE recid
- **arXiv tag**: with `arxiv_tag_enable`, the primary category (e.g. `hep-ph`, `math.RT`) is added as a plain tag; source order: the record's primary category, the `arXiv:<id> [cat]` line in Extra, the archive of an old-style ID

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

| Preference                      | Type    | Default | Description                            |
| ------------------------------- | ------- | ------- | -------------------------------------- |
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

| Format             | Examples                  |
| ------------------ | ------------------------- |
| Single number      | `[1]`, `[42]`             |
| Multiple numbers   | `[1,2,3]`, `[1, 2, 3]`    |
| Number range       | `[1-5]`, `[1–5]`          |
| Mixed format       | `[1,3-5,7]`               |
| Author-year        | `[Smith 2024]`, `[WGR17]` |
| Superscript digits | ¹²³⁴⁵⁶⁷⁸⁹⁰                |

### 5.3 Hover Preview

Preview card appears when hovering over lookup buttons:

- Contents: Title, authors, abstract, publication info, identifiers
- Cold-cache Zotero 10 numeric citations can first show marker-local Zotero bibliography text without inflating the complete References cache; document-level citation overlays require cached-list corroboration
- Status badge: click **In Library** to select the Zotero item; click **Online** to open the record in your browser (prefers INSPIRE)
- Actions: Add (if not in library), Open PDF (if available), Link/Unlink, copy BibTeX/texkey, favorite toggle
- Ambiguous match hint: "Author-year match only; click to select"

### 5.4 Panel Integration

When clicking the lookup button:

1. Automatically switches to References tab
2. Highlights the corresponding reference entry (temporary pulse + persistent focus)
3. Scrolls to that entry position

### 5.5 Native Target Reuse and Cache Loading

On source-audited Zotero 10.0 builds, the add-on first reuses Zotero's own resolved citation text. An internal-link target is marker-local and can be shown directly; a citation-overlay result is Zotero's document-level numeric match and must first be corroborated by the cached list, because the number may repeat in another chapter. Reader opening, toolbar rendering, and add-on startup do not pre-index the full native overlay store; in particular, the embedded PDF Preview created by ordinary library selection cannot use `renderToolbar` as a preload trigger. That global compatibility index is admitted only after a real Reader text-selection or citation interaction. When text selection creates a citation lookup control and only an internal-link target is available, even a multi-thousand-page PDF loads at most the linked bibliography page. The target text is matched against the cached INSPIRE list using unique arXiv/DOI evidence or journal-volume-page plus author metadata. Repeated chapter-local numbers and list positions are excluded from this strict path. A persisted old-parser mapping may retain a contiguous grouped multi-paper bibliography entry, but the same printed number in separated chapter runs fails closed instead of selecting a guessed entry.

Selecting an item while the References section is collapsed, or merely opening a Reader, does not inflate the add-on's References cache or parse `.zotero-ft-cache`. `onItemChange` records state only; the existing full list is materialized when the section is actually expanded or when lookup is clicked. If the list is still cold, hover can show a marker-local internal-link target without decompressing the large gzip cache. A document-level citation-overlay result instead loads/corroborates the cached list before it is shown; an in-memory list upgrades the hover card to rich INSPIRE metadata. If a compatible Reader supplies no native result at all, or a linked target yields no extractable text (unsupported build, non-numeric marker, scanned target page, or no overlay intersecting the selection), the historical cached-list fallback remains available and its first hover may materialize a cold cache. Ambiguous native evidence, or a target that exceeds the hover time budget, instead suppresses a cold hover card until the list is already in memory or the user clicks lookup. Zotero's processed target is a high-confidence shortcut, not a compatibility gate: on a strict click miss the add-on restores any persisted attachment mapping and retains the complete established PDF parser/matcher fallback.

When hover delegates to that historical matcher, it restores the same small persisted attachment mapping used by click before resolving the marker. Before any list or mapping is materialized, the unambiguous six-digit form `125130` can be recovered as `125–130`. An ambiguous four-digit token stays intact so a genuine high label such as `1234` is never split. Once the first real hover or click has a bound, a fully labelled chapter-reset list may refine copied `6264` to `62–64`; a sparse list instead uses the larger of its printed maximum and full length so a genuine unlabeled tail number is preserved. Equal-width lost-dash endpoints keep the established span limit; unequal-width recovery is limited to a short decimal-boundary crossing such as `912` → `9–12`, so a real high label such as `725` cannot become `7–25`. The label-coverage statistic comes from the matcher's existing index pass rather than a second full-list diagnosis. A persisted PDF mapping can only raise the bound.

### 5.6 Persistent Focus Selection

After jumping from PDF lookup, the entry maintains a focused state:

- Light blue background + blue left border
- Clears on: Escape key, tab switch, refresh, or clicking another entry
- Independent from batch import checkbox selection

### 5.7 Fuzzy Detection Mode (Experimental)

For PDFs with broken text layers:

- Location: Preferences → References Panel → Fuzzy citation detection
- Recognizes citation patterns without brackets
- Smart exclusions: Section/Figure/Table terms, physics units, decimals, etc.
- Default: Disabled

---

## 6. INSPIRE Search Integration

### 6.1 Search Bar Listener

The plugin integrates with Zotero's main search bar using the `inspire:` prefix.

| Feature     | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| **Trigger** | Type `inspire:` followed by query, press Enter                |
| **Syntax**  | Native INSPIRE query syntax (e.g.,`a Witten`, `t quark mass`) |
| **Results** | Displayed in "🔍 Search" tab in References Panel              |

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

| Setting     | Value                                       |
| ----------- | ------------------------------------------- |
| Max entries | 10                                          |
| Storage     | Zotero preferences (`inspireSearchHistory`) |
| Format      | JSON array of query strings                 |

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

- Before import, batch detection of duplicates in local library, from the library index (arXiv ID, recid, DOI)
- Every matching item is kept, recid matches first; the dialog shows "(N items)" for several and the libraries when group libraries are involved
- If the library cannot be read, nothing is imported and a notice asks to try again
- Functions: `findItemsByRecids()`, `findItemsByArxivs()`, `findItemsByDOIs()`, merged by `mergeHits()` (`library/localStatus.ts`)

### 7.4 Duplicate Dialog

- Shows list of duplicate entries with match type
- Default: unchecked (skip)
- Quick actions: "Skip All" / "Import All"

### 7.5 Batch Import Execution

- Single save target selection (library/collections/tags/notes)
- **One job per paper**: rows sharing a canonical arXiv ID or recid are imported once, and the result is written to every row showing the paper (`groupByPaper()`)
- Concurrent import with `CONCURRENCY = 3` limit
- ProgressWindow shows "Importing N/M"; PDFs, when attached, follow with their own progress line
- ESC key cancellation: aborts the signal of every paper in progress, so queued INSPIRE / arXiv requests are withdrawn and running ones end; the notice counts the papers that finished
- Error handling: individual failures don't affect other entries
- The arXiv browser uses the same manager with its own per-row import (section 15.6)

### 7.6 Export Enhancement

- Export buttons detect `selectedEntryIDs.size`
- When selected: only export selected entries
- When none: export all visible entries
- Export menu includes "Copy citation keys" for selected entries

### 7.7 Citation Style Export

The "Select Citation Style..." option opens a picker dialog for exporting references in any Zotero citation style:

| Feature              | Description                                       |
| -------------------- | ------------------------------------------------- |
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

- `journalAbbreviation` starts with `arXiv:` (legacy mode / older items) AND has no non-arXiv DOI
- Or has only arXiv DOI (`10.48550/arXiv.xxx`)
- Or has `arXiv:` in Extra field but no journal info

### 8.2 Entry Points

| Entry                   | Action                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Item context menu       | Check Preprint Status for selected items                                                     |
| Collection context menu | Check Preprints in Collection                                                                |
| Collection context menu | Check All Preprints in Library (My Library and every editable group)                         |
| Background (startup)    | Checks at startup as set by `preprint_watch_auto_check` (8.4), same scope as the entry above |

The three menu entries ask INSPIRE about every preprint they find. The background check (30 s after startup, as a background request, see 12.4) skips only a paper INSPIRE had no record of in the last 7 days (`BACKGROUND_NO_RECORD_REUSE_MS`).

INSPIRE is asked by arXiv ID, 50 IDs per request (`INSPIRE_ARXIV_BATCH_SIZE`; INSPIRE answered 75 and refused 80 with a 502), 3 requests in flight, each ID once even when several items share it. A record counts only if one of its `arxiv_eprints` equals the ID. Its title (word overlap at least 0.5) and first author (family name, or the collaboration) are compared with the item's; unless the item already names that recid, a mismatch is shown as "May be another paper: …" and the row starts unticked. A menu entry stops a background check in progress, and no background check starts until the entry's results dialog is closed; a background check that was stopped, or whose every result is an error (e.g. no network, and no answer recent enough to reuse), does not count as the day's check, and the next one continues with the papers not answered yet. The answers are kept in `preprintWatch.json` in the cache folder, each with the time INSPIRE gave it; a failed request is not stored and leaves the previous answer in place. The libraries are scanned on every check, so the file holds answers only, not the list of preprints.

### 8.3 Update Process

Each preprint gets one of four outcomes: published, unpublished (INSPIRE has a record without a journal publication), not in INSPIRE (no record), or failed (the request failed or was stopped). The results dialog shows the number of each; when no preprint is published, a notification shows these numbers instead.

The dialog opens when a preprint is published or when INSPIRE has a record of a preprint whose item has no recid; otherwise a notification shows the numbers (10 s).

When publications are found:

1. Shows dialog listing published items with checkboxes
2. User selects which items to update
3. Updates: DOI, journalAbbreviation, volume, pages, date (year)
4. Preserves arXiv info in Extra field

Records of unpublished preprints whose items lack the recid are listed in a second section ("In INSPIRE, not published: write the INSPIRE record only"). For ticked items the update writes Archive = INSPIRE and Archive Location = recid (only when both are empty or already agree), the citation key (only when empty and `citekey` is `inspire`) and the citation-count lines in Extra; bibliographic fields and Date Modified are unchanged. Items shown in the item pane or a reader, with unsaved changes, or changed since the check are not written, and the notice says so.

### 8.4 Preferences

| Preference                  | Type    | Default | Description                                                                          |
| --------------------------- | ------- | ------- | ------------------------------------------------------------------------------------ |
| `preprint_watch_enabled`    | boolean | true    | Master toggle                                                                        |
| `preprint_watch_auto_check` | string  | "never" | Background check: "startup" (every start), "daily" (first start of a day) or "never" |
| `preprint_watch_notify`     | boolean | true    | Show notification on findings                                                        |

---

## 9. Funding Information Extraction

Extracts funding acknowledgment information from PDF files.

### 9.1 Overview

The funding extraction feature parses PDF acknowledgment sections to identify funding agencies and grant numbers. This is useful for generating funding reports.

> **Note**: Extraction results may be incomplete due to PDF text quality, non-standard acknowledgment formats, or unrecognized funder patterns. Please verify manually for critical use cases.

### 9.2 Extraction Process

1. **PDF Selection**: Supports both regular items (uses best PDF attachment) and PDF attachments directly
2. **Text Extraction**: Reads PDF full text from Zotero's fulltext cache (or falls back to PDFWorker with 15s timeout)
3. **Acknowledgment Detection**: Locates acknowledgment/funding section using pattern matching
4. **Funder Identification**: Matches text against known funder patterns with regex

### 9.3 Supported Funders

| Category          | Examples                                                          |
| ----------------- | ----------------------------------------------------------------- |
| **China**         | NSFC, MoST (National Key R&D Program), CAS, CPSF, provincial NSFs |
| **USA**           | DOE, NSF (US), NIH, Fermilab, SLAC, BNL                           |
| **Europe**        | ERC, DFG, BMBF, STFC, INFN, ANR, SNSF, VolkswagenStiftung         |
| **Asia**          | JSPS, JST, NRF-KR, MOST-TW, KEK, RIKEN                            |
| **International** | CERN, NSERC (Canada), ARC (Australia)                             |

### 9.4 Output Formats

**Single Item** (compact):

```
NSFC: 12345678; DOE: SC0012345; DFG: TRR110
```

**Multiple Items** (table):

```
Title	arXiv	Funding
Paper Title 1	2301.12345	NSFC: 12345678
Paper Title 2	2302.07890	DOE: SC0012345; ERC: 123456789
```

### 9.5 Implementation Details

| Component                    | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `fundingPatterns.ts`         | Regex patterns for 50+ funding agencies       |
| `acknowledgmentExtractor.ts` | Locates acknowledgment section in PDF text    |
| `fundingExtractor.ts`        | Extracts grant numbers using pattern matching |
| `fundingService.ts`          | Main service with LRU caching (100 items)     |
| `copyFunding.ts`             | Formats output and copies to clipboard        |

### 9.6 Pattern Matching

Each funder pattern includes:

- **Primary patterns**: Regex to match funder name + grant number
- **Next pattern**: Regex to capture additional grant numbers in a list (e.g., "12345678, 87654321")
- **Priority**: Higher priority patterns are matched first
- **Category**: Region classification (china/us/eu/asia/intl)

### 9.7 Preferences

| Preference           | Type    | Default | Description                  |
| -------------------- | ------- | ------- | ---------------------------- |
| `funding_china_only` | boolean | false   | Only extract Chinese funders |

---

## 10. Constants Reference

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

// INSPIRE request pacing (rateLimiter.ts)
SEND_WINDOW_MAX = 12          // requests sent in any window
SEND_WINDOW_MS = 5000         // window length
MIN_RETRY_WAIT_MS = 5000      // shortest wait after a 429
MAX_RETRY_ATTEMPTS = 3

// arXiv
INSPIRE_ARXIV_BATCH_SIZE = 50 // arXiv IDs per INSPIRE query (preprint check, arXiv browser)
ARXIV_WEB_INTERVAL_MS = 15000 // arxiv.org: listing pages, PDFs, BibTeX, HTML snapshots
ARXIV_API_INTERVAL_MS = 3000  // export.arxiv.org API: metadata, search
SEARCH_RESULT_LIMIT = 10000   // arXiv API search results reachable

// LRU cache limits
referencesCache.maxSize = 100
citedByCache.maxSize = 50
entryCitedCache.maxSize = 50
metadataCache.maxSize = 500
```

---

## 11. Data Flow

```
User selects item
    ↓
deriveRecidFromItem() → Check archiveLocation (Archive "INSPIRE"), then URL
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

## 12. Performance Optimizations

### 12.1 Rendering

- **Frontend pagination**: Only renders first 100 entries, with infinite scroll for rest
- **Non-blocking enrichment**: Local status and citation counts fetched after initial render
- **Progressive rendering**: Shows data as it loads, not after complete
- **Filter input debouncing**: 150ms delay reduces re-renders during fast typing
- **Row element pooling**: Pool of up to 150 row elements for reuse
- **Chart lazy calculation**: Uses `setTimeout(0)` / `requestIdleCallback`

### 12.2 Data Fetching

- **Batch API queries**: Citation counts fetched in batches of 50 recids
- **Citation count parallel fetching**: 3 batches fetched in parallel per round
- **Local status query optimization**: SQL batch size increased to 500
- **Search text caching**: WeakMap caches `buildEntrySearchText()` results
- **Infinite scroll**: IntersectionObserver auto-loads more entries

### 12.3 Memory Management

- **LRU caches**: Bounded caches prevent memory leaks
- **Chart statistics caching**: Cached per view mode to avoid recomputation
- **String caching**: Locale strings cached for performance

### 12.4 INSPIRE Request Pacing

All INSPIRE requests of the plugin pass one limiter (`rateLimiter.ts`):

- At most 12 requests are sent in any 5 s (`SEND_WINDOW_MAX`, `SEND_WINDOW_MS`), below INSPIRE's limit of 15 per 5 s; retries count as sends.
- Two classes: foreground (default) and background. Waiting foreground requests are sent first; within a class, first come, first served. The only background caller is the startup preprint check.
- A request cancelled while it waits is never sent.
- After a `429`, the request waits for Retry-After, at least 5 s, and is retried up to 3 times, queuing again with its own class. The external BibTeX API disables these retries and returns a rate-limit error instead.
- The References panel toolbar shows **🚦 INSPIRE queue: N** while requests wait in the queue.

---

## 13. Debug Commands

Available in Zotero Error Console (`Tools` → `Developer` → `Error Console`):

| Command                                       | Description                                |
| --------------------------------------------- | ------------------------------------------ |
| `Zotero.ZoteroInspire.getCacheStats()`        | Returns cache statistics object            |
| `Zotero.ZoteroInspire.logCacheStats()`        | Logs formatted stats to debug output       |
| `Zotero.ZoteroInspire.resetCacheStats()`      | Resets all hit/miss counters               |
| `Zotero.ZoteroInspire.startMemoryMonitor(ms)` | Starts periodic logging (default: 30000ms) |
| `Zotero.ZoteroInspire.stopMemoryMonitor()`    | Stops periodic logging                     |

**Registered Caches**:

- `recidLookup` - INSPIRE recid lookups
- `pdfMapping` - PDF numeric reference mapping
- `pdfAuthorYearMapping` - PDF author-year mapping

**Sample Output**:

```
pdfMapping: 78.6% hit rate (11/14), size: 8/30
recidLookup: 95.0% hit rate (190/200), size: 156/500
[Overall]: 93.9% hit rate (201/214)
```

---

## 14. Abstract Rendering

### 14.1 LaTeX Mode

Two rendering modes for LaTeX formulas in abstracts:

| Mode        | Description                                                                |
| ----------- | -------------------------------------------------------------------------- |
| **KaTeX**   | Full KaTeX rendering for complex formulas (fractions, integrals, matrices) |
| **Unicode** | Converts simple LaTeX to Unicode characters (lightweight)                  |

**Preferences**:

| Preference          | Type   | Default | Description          |
| ------------------- | ------ | ------- | -------------------- |
| `latex_render_mode` | string | "katex" | "katex" or "unicode" |

**KaTeX Features**:

- Bundled KaTeX library (no external dependencies)
- Custom macros for physics notation (GeV, TeV, etc.)
- Graceful fallback on render errors
- Supports display and inline math modes

### 14.2 Abstract Copy Context Menu

Right-click on abstract preview card shows context menu:

| Option             | Description                      |
| ------------------ | -------------------------------- |
| **Copy**           | Copy full abstract as plain text |
| **Copy Selection** | Copy selected text (if any)      |
| **Copy as LaTeX**  | Copy original LaTeX source code  |

**Implementation**:

- Context menu appears on right-click over abstract content
- LaTeX source preserved from INSPIRE API response
- Selection-aware: shows "Copy Selection" only when text is selected

---

## 15. arXiv Browser

A separate window (`chrome://zoteroinspire/content/arxivBrowser.xhtml`) for reading arXiv listings of any category. Code: `src/modules/arxiv/` (data, adding) and `src/modules/arxiv/browser/` (window).

### 15.1 Window and Entry Points

| Entry          | Details                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| View menu      | `View` → `arXiv Browser`, registered with `Zotero.MenuManager` (`browserEntryPoints.ts`)     |
| Tab bar button | Right end of `zotero-tabs-toolbar`, before the sync button; tooltip "Open the arXiv browser" |
| Startup        | Opens when Zotero starts if `arxiv_browser_open_on_startup` is on                            |

- One window at a time; opening again focuses it. Size and position are remembered.
- The window closes with the main window and when the plugin shuts down; closing it cancels its queued arXiv requests.
- There are no settings inside the window beyond the list controls; the rest is in the plugin's preferences (15.12).

### 15.2 Subscriptions

- A subscription has a name, an ordered list of categories or whole archives, and the sections to show (new submissions and cross-lists on, replacements off by default). Stored as JSON in `arxiv_subscriptions`.
- Category picker: arXiv's groups → archives → categories (`arxivCategories.json`), searchable by name or identifier. An archive with several categories can be subscribed whole (one listing page). Aliases are stored under their canonical category (e.g. `math.MP` → `math-ph`).
- The editor estimates the requests and minimum time of a first load and suggests a whole archive above 10 categories.
- Category chips filter the list with the chart's click rules (`src/utils/clickSelection.ts`): click = only this one, Ctrl/Cmd+click = add/remove, Shift+click = range, click the only chosen one = all.

### 15.3 Days and Loading

- Calendar (`DayPicker.ts`): Monday–Friday listing days within arXiv's 90-day catch-up range, weeks starting on Monday. Click / Ctrl/Cmd+click / Shift+click as above; picked days load on **Load**. Presets load at once: newest day, last 5 announcement days, this week, unread days. The window opens with `arxiv_browser_open_days` ("newest", "recent", "week").
- Sources (`listingService.ts`): `/list/<cat>/new` for the newest day; `/list/math/recent` as the index of the last announcement days; `/catchup` for older days.
- The newest day is fetched first, before the date index. A day is shown as soon as its first category arrives; later categories are merged in, keeping the reader's position ("Still fetching: …").
- Estimated requests: newest = N categories, last 5 days = 1 + 5N, other days = 1 + N per day, at 15 s each.
- Failed or stale categories get **Retry**; a stopped load offers **Continue** for the days not loaded; days without an announcement are reported.

### 15.4 arXiv Requests and Cache

| Host               | Minimum interval | Timeout           | Used for                                    |
| ------------------ | ---------------- | ----------------- | ------------------------------------------- |
| `arxiv.org`        | 15 s             | 60 s (PDFs 120 s) | listing pages, PDFs, BibTeX, HTML snapshots |
| `export.arxiv.org` | 3 s              | 30 s              | API metadata of papers, search              |

- One serial queue per host for the whole plugin (`arxivFetch.ts`). A `429`/`503` with Retry-After pauses the queue until then and retries once; a second one, one without Retry-After, or a `403` fails the request and those queued behind it.
- Listings are stored in `localCache` type `arxiv_listing`: each category's checked listing per day (`day_<spec>_<date>`) for 100 days (`LISTING_RETENTION_DAYS`), the `/new` date seen, and the recent-days index.
- `/new` and the recent index are reused until a scheduled announcement (20:00 America/New_York, Sunday–Thursday) has passed since they were fetched; if arXiv is late, they are fetched again after 10 min. Reopening the window therefore needs no request. **Reload** fetches the newest listing again; other days come from the cache. A failed fetch falls back to the cached copy.

### 15.5 Reading State

- Stored per (subscription, listing day) in `<Zotero data directory>/zoteroinspire/arxiv-reading.json` (`JsonStateFile`: versioned, written through a temporary file; an unreadable file is kept under another name and reported), kept 100 days.
- Unread days (blue dots) start at the listing that was current when the subscription was made.
- A day is marked read when its complete listing (all categories fetched and checked) has been shown, or when it turned out to have no announcement. **Mark read** / **Mark unread** act on picked days; **Mark all read** marks every dotted day without fetching.

### 15.6 List and Detail Pane

- Pages of `arxiv_browser_page_size` papers (default 50, 10–500); day chips jump to a day ("…" still loading, "⚠" incomplete).
- Sorts: announcement order (sections New submissions / Cross-lists / Replacements), arXiv ID ↑ / ↓, primary category. A paper listed in several sections is shown once, in the first shown section (new, cross, replace). The section boxes are saved to the subscription.
- Abstracts: folded by default (`arxiv_browser_abstracts_expanded`); formulas are rendered when a row scrolls into view, in the `latex_render_mode` of the panel.
- Divider: drag or ←/→ (2 % per press); stored in `arxiv_browser_list_share` (default 60 %, 25–80).
- Filter box (150 ms debounce): authors, title, ID, categories, comments, journal reference with its abbreviations, abstract; accents normalized. Shares its history with the References panel.
- Quick filters: Local items, Online items, ≤10 Authors (a collaboration is not counted as an author), Published (journal reference), arXiv only. The panel's citation, recency, review and related-item filters are not offered, as they need INSPIRE data or the panel's current item.
- In-library marks: `findItemsByArxivs()` on the library index (all libraries, trash and feeds excluded); recomputed when the index changes.
- Author card: the paper's INSPIRE record (one search per paper by arXiv ID) identifies authors; otherwise the local card. No search by name.
- Version chooser: for a paper with several versions, the detail pane's version is a `<select>` of v1…vN. The newest comes from the listing; an older one is fetched once from the arXiv API (`id_list=<id>v<k>`, kept per window) and shown with its own title, authors, abstract, comments, journal reference and submission date (the API's `updated`). PDF opens a library PDF naming that version (URL or title "arXiv preprint PDF vN"; for the newest also one naming no version), else arXiv's PDF of that version; HTML and Save refer to that version.
- Status area: loading status with countdown to the next arXiv request; INSPIRE completion line (15.9).

### 15.7 Adding Papers (`addToLibrary.ts`)

Every add asks for a save target first (`pickSaveTarget()`, shared with the References panel; remembered in Zotero's recent save targets). INSPIRE is asked again at add time (the add service can reuse an answer under 10 minutes old, but the window passes none). Adds into one library run one at a time.

| Route | Condition                                                            | Item                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | INSPIRE has a record whose `arxiv_eprints` contains the ID           | INSPIRE import, as in the References panel                                                                                                                                         |
| C     | "Add the journal version…", arXiv gives a DOI, INSPIRE has no record | Zotero's DOI lookup (`Zotero.Translate.Search`); used only if DOI, title (overlap ≥ 0.5) and first author agree (first author not compared when arXiv lists a collaboration first) |
| B     | otherwise                                                            | From arXiv API data: Preprint (per `keep_preprint_type`), complete author list, DOI `10.48550/arXiv.<id>`, `arXiv:<id> [cat]` in Extra                                             |

- INSPIRE unreachable: nothing is added; the notice offers **Add from arXiv data** or **Try later**.
- Duplicate check before creation, in the target library, by arXiv ID, recid and every journal DOI. A match by journal DOI alone asks whether it is the same paper ("Not this paper: add it").
- PDF: with `auto_find_fulltext_on_import`, the arXiv PDF of the current version from the arXiv API (`/pdf/<id>v<N>`, titled "arXiv preprint PDF vN", 120 s timeout) is downloaded through the arXiv queue and imported; `arxiv_pdf_skip_journal_items` skips it for non-preprint items of routes A and C.
- Tag: with `arxiv_tag_enable`, the primary category.
- Adding cannot be undone from the window.
- Batch: the References panel's `BatchImportManager` and `BatchToolbar`; INSPIRE and the arXiv API are asked about all papers first; routes A and B only; `Escape` cancels.

### 15.8 Relations, BibTeX and Links

- **Relate** (`l`, **Relate to items…**, row link button): Zotero's `selectItemsDialog.xhtml` on the regular items of the paper's library. `linkItems()` (`library/relatedItems.ts`) writes both directions in one transaction without changing Date Modified and stages one `Zotero.UndoHistory` action; `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` in the window call undo / redo. Items in different libraries are refused. The References panel uses the same function.
- **Copy BibTeX**: INSPIRE's (by the library item's recid when its eprint is this paper, else `arxiv:<id>` with `format=bibtex`), else arXiv's `/bibtex/<id>`. Key: the library item's citation key; else INSPIRE's texkey; else `<Name>:<YYYY><word>` (`citationKey.ts`: first author's family name or collaboration, ASCII-folded; year of the arXiv ID; first title word that is not one of Better BibTeX's default skip words).
- **Right-click menu**: Copy / Copy Selection, Copy as LaTeX (detail pane abstract, KaTeX mode), Select All, Open Link in Web Browser, Copy Link Address, Copy Title, Copy arXiv ID, Copy Link to the arXiv Page, Copy INSPIRE link, Copy BibTeX.
- The paper's INSPIRE record found in the window is shared by Copy BibTeX, Copy INSPIRE link and the author card.

### 15.9 HTML Snapshots and INSPIRE Completion

- **HTML**: shown unless the listing says arXiv has no HTML version (search results carry no such flag, so the button is always shown there). The button opens the saved snapshot in Zotero, else `arxiv.org/html/<id>` in the web browser. **Save HTML Snapshot to the Library** calls `Zotero.Attachments.importFromURL` on `/html/<id>v<N>` through the arXiv queue, one paper at a time, titled "arXiv HTML vN", as a child of the paper's item (added first if needed); a version already saved is not saved again. SVG figures in `<object>` elements are rewritten to `<img>`, which Zotero's reader displays.
- **INSPIRE completion** (`library/inspireCompletion.ts`, `completionLine.ts`): counts items added in the last 30 days, in editable libraries, with an arXiv ID and no recid (library only, recounted 2 s after a change). **Check now** looks them up by arXiv ID with the identity check of 8.2 and lists the records in the preprint results dialog; ticked items get the INSPIRE record written as in 8.3.

### 15.10 Search

- `export.arxiv.org/api/query` sorted by submission date, newest first (`arxivApi.ts`). Prefixes `ti au abs co jr cat rn id all submittedDate`; `AND`, `OR`, `ANDNOT` (any case); unprefixed terms become `all:` and are joined with AND; unclosed quotes and brackets are closed.
- Results are fetched a page at a time at the list's page size, listed by month of submission, and kept for the window's session; at most 10000 are reachable. Search history: `arxivSearchHistory`.

### 15.11 Keyboard

| Key                              | Action                                                |
| -------------------------------- | ----------------------------------------------------- |
| `j` / `↓`, `k` / `↑`             | Next / previous paper, across pages                   |
| `n` / `p`                        | Next / previous page (more search results at the end) |
| `Home` / `End`                   | First / last paper of the page                        |
| `Space`                          | Fold or unfold the focused paper's abstract           |
| `Enter`                          | Open the arXiv page in the web browser                |
| `a` / `l` / `x`                  | Add / relate / tick the focused paper                 |
| `Escape`                         | Clear the focus; close the calendar or editor         |
| `Ctrl/Cmd+Shift+C`               | Copy BibTeX of the focused paper                      |
| `Ctrl/Cmd+C`                     | Copy the selection, each formula once                 |
| `Ctrl/Cmd+A`                     | Select the text of the focused pane                   |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | Zotero's undo / redo                                  |
| `Ctrl/Cmd+W`                     | Close the window                                      |

Keys other than `Ctrl/Cmd+W` are ignored in text fields and while the subscription editor is open; `Space` and `Enter` keep their meaning on buttons and links.

### 15.12 Preferences

| Preference                           | Type    | Default    | Description                                                   |
| ------------------------------------ | ------- | ---------- | ------------------------------------------------------------- |
| `arxiv_subscriptions`                | string  | `"[]"`     | JSON list of subscriptions (set by the window)                |
| `arxiv_browser_default_subscription` | string  | `""`       | Subscription the window opens with; empty = the first         |
| `arxiv_browser_open_days`            | string  | `"newest"` | `"newest"`, `"recent"` (last 5 announcement days) or `"week"` |
| `arxiv_browser_page_size`            | integer | 50         | Papers per page, 10–500                                       |
| `arxiv_browser_abstracts_expanded`   | boolean | false      | Abstracts unfolded in the list                                |
| `arxiv_browser_open_on_startup`      | boolean | false      | Open the window when Zotero starts                            |
| `arxiv_browser_list_share`           | integer | 60         | List width in percent, 25–80 (set by the divider)             |
| `arxiv_pdf_skip_journal_items`       | boolean | false      | No arXiv PDF for journal items added from the window          |
