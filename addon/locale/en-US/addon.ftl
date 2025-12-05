startup-begin = Addon is loading
startup-finish = Addon is ready
menuitem-label = Addon Template: Helper Examples
menupopup-label = INSPIRE
menuitem-submenulabel0 = With abstracts
menuitem-submenulabel1 = Without abstracts
menuitem-submenulabel2 = Citation counts only
menuitem-download-cache = Download references cache
menuitem-cancel-update = Cancel update

download-cache-progress-title = Downloading references cache
download-cache-start =
  { $total ->
    [one] Preparing cache for 1 item...
   *[other] Preparing cache for { $total } items...
  }
download-cache-progress = Cached { $done } / { $total } items
download-cache-success =
  { $success ->
    [one] Cached references for 1 item
   *[other] Cached references for { $success } items
  }
download-cache-failed =
  { $failed ->
    [one] Failed to cache references for 1 item
   *[other] Failed to cache references for { $failed } items
  }
download-cache-no-selection = Select at least one regular item to download references cache
download-cache-no-recid = Unable to find INSPIRE IDs for the selected items
download-cache-disabled = Enable local cache in Preferences → INSPIRE to use this feature
download-cache-cancelled-title = Cache download cancelled
download-cache-cancelled = Cached { $done } / { $total } items before cancellation

pane-item-references-header = INSPIRE References
    .label = INSPIRE References
pane-item-references-sidenav = INSPIRE References
    .label = INSPIRE References
    .tooltiptext = INSPIRE References
references-panel-tab-references = References
references-panel-tab-cited = Cited by
references-panel-tab-entry-cited = Citing...
references-panel-tab-author-papers = Papers...
references-panel-status-empty = Select an item to load INSPIRE data
references-panel-reader-mode = INSPIRE data is unavailable in the reader view
references-panel-select-item = Select a single regular item to view INSPIRE data
references-panel-no-recid = INSPIRE record not found for this item
references-panel-status-loading = Loading references...
references-panel-status-loading-cited = Loading citing records...
references-panel-status-loading-entry = Loading citing records for the selected reference...
references-panel-status-loading-author = Loading papers by the author...
references-panel-status-error = Failed to load data from INSPIRE
references-panel-empty-list = No references available
references-panel-empty-cited = No citing records found
references-panel-entry-empty = Select a reference to view citing records
references-panel-author-empty = No papers found for this author
references-panel-no-match = No entries match the current filter
references-panel-refresh = Refresh
references-panel-back = Back
references-panel-back-tooltip = Return to the previous Zotero item
references-panel-forward = Forward
references-panel-forward-tooltip = Go forward to the next Zotero item
references-panel-entry-back = Back to { $tab }
references-panel-entry-back-tooltip = Return to the previous view
references-panel-filter-placeholder = Filter entries
references-panel-quick-filters = Filters
references-panel-quick-filter-high-citations = High citations (>50)
references-panel-quick-filter-high-citations-tooltip = Show papers with more than 50 citations
references-panel-quick-filter-recent-5y = Recent 5 years
references-panel-quick-filter-recent-5y-tooltip = Only show papers published within the last 5 calendar years
references-panel-quick-filter-recent-1y = Recent 1 year
references-panel-quick-filter-recent-1y-tooltip = Only show papers published in the current calendar year
references-panel-quick-filter-published = Published
references-panel-quick-filter-published-tooltip = Show papers with journal information (formally published)
references-panel-quick-filter-preprint = arXiv only
references-panel-quick-filter-preprint-tooltip = Show arXiv-only papers without journal information
references-panel-quick-filter-related = Related items
references-panel-quick-filter-related-tooltip = Show references already linked to the current Zotero item
references-panel-quick-filter-local-items = Local items
references-panel-quick-filter-local-items-tooltip = Show references that already exist in your Zotero library
references-panel-quick-filter-online-items = Online items
references-panel-quick-filter-online-items-tooltip = Show references not yet in your Zotero library
references-panel-sort-label = Sort entries
references-panel-sort-default = INSPIRE order
references-panel-sort-mostrecent = Most recent
references-panel-sort-mostcited = Most cited
references-panel-count =
  { $count ->
    [one] 1 reference
   *[other] { $count } references
  }
references-panel-count-cited =
  { $count ->
    [one] 1 citing record
   *[other] { $count } citing records
  }
references-panel-count-entry =
  { $count ->
    [one] 1 citing record for "{ $label }"
   *[other] { $count } citing records for "{ $label }"
  }
references-panel-count-author =
  { $count ->
    [one] 1 paper by { $label }
   *[other] { $count } papers by { $label }
  }
references-panel-filter-count =
  { $visible } / { $total } references
references-panel-filter-count-cited =
  { $visible } / { $total } citing records
references-panel-filter-count-entry =
  { $visible } / { $total } citing records for "{ $label }"
references-panel-filter-count-author =
  { $visible } / { $total } papers by { $label }
references-panel-dot-local = Item exists in your library
references-panel-dot-add = Add this reference to your library
references-panel-link-existing = Click to unlink the related item
references-panel-link-missing = Link as related item
references-panel-toast-linked = Related item linked successfully
references-panel-toast-added = Reference added to your library
references-panel-toast-missing = Article not found in INSPIRE-HEP
references-panel-toast-no-pdf = This item has no PDF attachment
references-panel-unknown-author = Unknown author
references-panel-year-unknown = n.d.
references-panel-no-title = Title unavailable
references-panel-picker-title = Save to
references-panel-picker-filter = Filter Collections
references-panel-picker-cancel = Cancel
references-panel-picker-confirm = Done
references-panel-picker-empty = No editable collections available
references-panel-picker-hint = Choose a library, then toggle one or more collections.
references-panel-toast-unlinked = Related item unlinked
references-panel-picker-tags = Tags (comma separated)
references-panel-picker-tags-title = Enter tags separated by comma or semicolon
references-panel-picker-note = Note
references-panel-picker-note-title = Enter a note to be added to the item
references-panel-citation-count = Cited by { $count }
references-panel-citation-count-unknown = View citing records
references-panel-entry-select = Select a reference entry to view citing records
references-panel-entry-label-default = Selected reference
references-panel-loading-abstract = Loading abstract...
references-panel-no-abstract = No abstract available
references-panel-author-papers-label = Papers by { $author }
references-panel-author-click-hint = Click to view papers by { $author }
references-panel-copy-bibtex = Copy BibTeX
references-panel-bibtex-copied = BibTeX copied to clipboard
references-panel-bibtex-failed = Failed to fetch BibTeX

update-cancelled = Update cancelled by user
update-cancelled-stats = Updated { $completed }/{ $total } items before cancellation

zoteroinspire-refresh-button =
    .tooltiptext = Refresh INSPIRE data
zoteroinspire-copy-all-button =
    .tooltiptext = Export references (BibTeX/LaTeX)
references-panel-bibtex-fetching = Fetching entries...
references-panel-bibtex-all-copied = { $count } BibTeX entries copied to clipboard
references-panel-bibtex-all-failed = Failed to fetch entries
references-panel-no-recid-entries = No INSPIRE records to export

# Export menu localization strings
references-panel-export-copy-header = 📋 Copy to Clipboard
references-panel-export-file-header = 💾 Export to File
references-panel-export-copied = { $count } { $format } entries copied
references-panel-export-saved = { $count } { $format } entries saved
references-panel-export-clipboard-failed = Failed to copy to clipboard (content too large?)
references-panel-export-too-large = Content too large ({ $size }KB) - please use "Export to File" instead
references-panel-export-cancelled = Export cancelled
references-panel-export-save-title = Export References

# Chart localization strings
references-panel-chart-collapse = Collapse chart
references-panel-chart-expand = Expand chart
references-panel-chart-by-year = By Year
references-panel-chart-by-citation = By Citations
references-panel-chart-no-data = No data to display
references-panel-chart-clear-filter = Clear filters
references-panel-chart-disabled-title = Chart Disabled
references-panel-chart-disabled-message = Statistics chart is disabled. Enable it in Zotero Preferences → INSPIRE.
references-panel-chart-author-filter = ≤10 Authors
references-panel-chart-author-filter-tooltip = Filter: only show papers with 10 or fewer authors (excludes large collaborations)
references-panel-chart-selfcite-filter = Excl. self-cit.
references-panel-chart-selfcite-filter-tooltip = Use citation counts without self-citations when in "By Citations" mode.
references-panel-chart-published-only = Published
references-panel-chart-published-only-tooltip = Filter: only show papers with journal information (excludes arXiv-only papers)

# Rate limiter localization strings
references-panel-rate-limit-tooltip = INSPIRE API rate limit status
references-panel-rate-limit-queued = { $count } requests queued (rate limiting active)

# Search feature localization strings
references-panel-tab-search = 🔍 Search
references-panel-search-placeholder = INSPIRE search query...
references-panel-search-button-tooltip = Execute INSPIRE search
references-panel-search-history-tooltip = Show search history
references-panel-search-clear-history = Clear search history
references-panel-search-prompt = Enter a search query to search INSPIRE
references-panel-search-empty = No results found for this search
references-panel-search-label-default = Search results
references-panel-status-loading-search = Searching INSPIRE...
references-panel-count-search =
  { $count ->
    [one] 1 result for "{ $query }"
   *[other] { $count } results for "{ $query }"
  }
references-panel-filter-count-search =
  { $visible } / { $total } results for "{ $query }"

# Cache source indicator strings
references-panel-cache-source-api = From INSPIRE
references-panel-cache-source-memory = From memory cache
references-panel-cache-source-local = From local cache ({ $age }h ago)

# Context menu copy actions
menuitem-copy-bibtex = Copy BibTeX
menuitem-copy-inspire-link = Copy INSPIRE link
menuitem-copy-citation-key = Copy citation key
menuitem-copy-zotero-link = Copy Zotero link
copy-success-bibtex =
  { $count ->
    [one] Copied 1 BibTeX entry
   *[other] Copied { $count } BibTeX entries
  }
copy-success-inspire-link = INSPIRE link copied to clipboard
copy-success-citation-key =
  { $count ->
    [one] Copied 1 citation key
   *[other] Copied { $count } citation keys
  }
copy-success-zotero-link = Zotero link copied to clipboard
copy-error-no-selection = Select exactly one item to copy
copy-error-no-recid = INSPIRE record ID not found for this item
copy-error-no-citation-key = No citation key set for this item
copy-error-clipboard-failed = Failed to copy to clipboard
copy-error-bibtex-failed = Failed to fetch BibTeX from INSPIRE

# Batch import feature localization strings (FTR-BATCH-IMPORT)
references-panel-batch-selected =
  { $count ->
    [one] 1 selected
   *[other] { $count } selected
  }
references-panel-batch-select-all = Select all
references-panel-batch-clear = Clear
references-panel-batch-import = Import
references-panel-batch-importing = Importing { $done } / { $total }...
references-panel-batch-import-success =
  { $count ->
    [one] Imported 1 reference
   *[other] Imported { $count } references
  }
references-panel-batch-import-partial = Imported { $success } / { $total } references ({ $failed } failed)
references-panel-batch-import-cancelled = Import cancelled ({ $done } / { $total } completed)
references-panel-batch-no-selection = Select at least one reference to import
references-panel-batch-duplicate-title = Duplicate Detection
references-panel-batch-duplicate-message =
  { $count ->
    [one] 1 reference already exists in your library:
   *[other] { $count } references already exist in your library:
  }
references-panel-batch-duplicate-match-recid = (matched by INSPIRE ID)
references-panel-batch-duplicate-match-arxiv = (matched by arXiv ID)
references-panel-batch-duplicate-match-doi = (matched by DOI)
references-panel-batch-duplicate-skip-all = Skip all duplicates
references-panel-batch-duplicate-import-all = Import all anyway
references-panel-batch-duplicate-confirm = Confirm selection
references-panel-batch-duplicate-cancel = Cancel

# PDF Citation Lookup (FTR-PDF-ANNOTATE)
pdf-annotate-lookup-button = Look up in References
pdf-annotate-not-found = Reference [{ $label }] not found in this paper
pdf-annotate-no-text-layer = This PDF has no text layer. Citations cannot be detected.