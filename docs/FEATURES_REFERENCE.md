# Zotero INSPIRE Plugin - Feature Reference

> This document lists all implemented features for the INSPIRE References Panel and related functionality.
> It serves as a reference to prevent unintended changes during future optimizations.

---

## 1. INSPIRE References Panel (Item Pane Section)

### 1.1 Three View Modes

| Mode                  | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
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

| Action                       | Behavior                                           |
| ---------------------------- | -------------------------------------------------- |
| Click local status (●/⊕)   | Open existing item in library, or add missing item |
| Click link icon              | Add/remove related item relationship               |
| Click author name            | View all papers by that author                     |
| Click title                  | Open in INSPIRE (or arXiv/DOI fallback)            |
| Click citation count         | View papers citing this entry                      |
| Click BibTeX button          | Copy BibTeX to clipboard                           |
| Hover over title             | Show abstract tooltip                              |
| Click refresh button         | Reload current view (bypass cache)                 |
| Click copy all BibTeX button | Copy all visible entries as BibTeX                 |

### 1.5 Caching

| Cache                | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `referencesCache`  | Caches fetched references by recid + sort        |
| `citedByCache`     | Caches cited-by results by recid + sort          |
| `entryCitedCache`  | Caches entry-cited/author-papers results         |
| `metadataCache`    | Caches individual record metadata                |
| `rowCache`         | Caches DOM elements for rendered rows            |
| `recidLookupCache` | Caches recid lookups to avoid repeated API calls |

### 1.6 Performance Optimizations

- **Frontend pagination**: Only renders first 100 entries, "Load More" for rest
- **Non-blocking enrichment**: Local status and citation counts fetched after initial render
- **Progressive rendering**: Shows data as it loads, not after complete
- **Batch API queries**: Citation counts fetched in batches of 50 recids
- **String caching**: Locale strings cached for performance

---

## 2. Right-Click Menu Operations

### 2.1 Item Menu

| Operation                                        | Description                             |
| ------------------------------------------------ | --------------------------------------- |
| **Update from INSPIRE (with abstract)**    | Full metadata update including abstract |
| **Update from INSPIRE (without abstract)** | Metadata update excluding abstract      |
| **Update citation counts**                 | Only update citation counts             |

### 2.2 Collection Menu

| Operation                         | Description                          |
| --------------------------------- | ------------------------------------ |
| **Update all from INSPIRE** | Update all items in collection       |
| **Update citation counts**  | Update citation counts for all items |

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

*Last updated: 2025*
