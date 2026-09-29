startup-begin = Addon is loading
startup-finish = Addon is ready
menuitem-label = Addon Template: Helper Examples
menupopup-label = INSPIRE
menuitem-submenulabel0 = With abstracts
menuitem-submenulabel1 = Without abstracts
menuitem-submenulabel2 = Citation counts only
menuitem-download-cache = Download references cache
menuitem-citation-graph-merge = Connections Graph…
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
references-panel-tab-references = Refs.
references-panel-tab-cited = Cited by
references-panel-tab-related = Related
references-panel-tab-entry-cited = Citing...
references-panel-tab-author-papers = Author
connections-graph-title = Connections Graph
references-panel-citation-graph-button = Connections Graph
references-panel-citation-graph-tooltip = Show Connections Graph: Citation Graph and Academic Tree (click: open, right-click: expand)
references-panel-citation-graph-title = Citation Graph
references-panel-citation-graph-hint = Click to open · Right-click to expand · Cmd/Ctrl+click to add seed
references-panel-citation-graph-title-multi = Citation Graph: { $count } Seeds
references-panel-citation-graph-hint-multi = Click to open · Right-click to expand · Cmd/Ctrl+click to add seed
references-panel-citation-graph-back = Previous citation graph
references-panel-citation-graph-back-tooltip = Go back to the previous citation graph
references-panel-citation-graph-forward = Next citation graph
references-panel-citation-graph-forward-tooltip = Go forward to the next citation graph
references-panel-citation-graph-close = Close
references-panel-citation-graph-disabled-pdg = Citation graph is disabled for Review of Particle Physics (PDG)
references-panel-citation-graph-add-seed = + Add Seed
references-panel-citation-graph-seeds-title = Seeds ({ $count })
references-panel-citation-graph-seeds-hint = Click × to remove · Cmd/Ctrl+click a node to add seed · Right-click a node to open as graph
references-panel-citation-graph-seed-remove = Remove seed
references-panel-citation-graph-seed-already-added = Seed already added
references-panel-citation-graph-nodes-label = Nodes
references-panel-citation-graph-toggle-connections = Connections
references-panel-citation-graph-toggle-reviews = Incl. reviews
references-panel-citation-graph-toggle-reviews-exclude = Excl. reviews
references-panel-citation-graph-toggle-reviews-tooltip = Include/exclude review articles (including PDG)
references-panel-citation-graph-connections-loading = Connections: loading…
references-panel-citation-graph-connections-count = Connections: { $count }
references-panel-citation-graph-connections-too-many = Too many nodes for connections. Reduce the Nodes slider and try again.
references-panel-citation-graph-no-graph = No graph loaded
references-panel-citation-graph-not-in-library = Paper "{ $title }" is not in your Zotero library. Use the hover preview to open in INSPIRE.
references-panel-citation-graph-enrich-network-needed = Network needed to enrich citation graph. Showing cached results.
references-panel-citation-graph-add-seed-title = Add Seed Paper
references-panel-citation-graph-add-seed-search-placeholder = Search INSPIRE...
references-panel-citation-graph-add-seed-zotero-search-placeholder = Search Zotero...
references-panel-citation-graph-add-seed-search = Search
references-panel-citation-graph-add-seed-add = Add
references-panel-citation-graph-add-seed-remove = Remove
references-panel-citation-graph-add-seed-from-zotero = From Zotero
references-panel-citation-graph-add-seed-no-zotero = Select Zotero items with INSPIRE IDs to add them as seeds.
references-panel-citation-graph-add-seed-zotero-search-hint = Type to search Zotero...
references-panel-citation-graph-add-seed-zotero-no-results = No Zotero items with INSPIRE IDs found.
references-panel-citation-graph-add-seed-from-inspire = From INSPIRE search
references-panel-citation-graph-add-seed-search-hint = Type to search INSPIRE...
references-panel-citation-graph-add-seed-no-results = No results
references-panel-citation-graph-save = 💾 Save▼
references-panel-citation-graph-export = 📤 Export▼
references-panel-citation-graph-load = 📥 Load
references-panel-citation-graph-save-to-data-dir = Save to Zotero data directory
references-panel-citation-graph-save-as = Save as…
references-panel-citation-graph-save-file-title = Save Citation Graph
references-panel-citation-graph-save-no-data = Nothing to save yet
references-panel-citation-graph-save-dir-failed = Unable to access Zotero data directory
references-panel-citation-graph-save-success = Saved
references-panel-citation-graph-export-json = Export JSON (full data)…
references-panel-citation-graph-export-csv = Export CSV (nodes)…
references-panel-citation-graph-export-svg = Export SVG…
references-panel-citation-graph-export-png = Export PNG…
references-panel-citation-graph-export-bibtex = Export BibTeX…
references-panel-citation-graph-export-file-title = Export Citation Graph
references-panel-citation-graph-export-success = Exported
references-panel-citation-graph-export-failed = Export failed
references-panel-citation-graph-export-bibtex-no-recid = No INSPIRE recids to export
references-panel-citation-graph-load-from-file = Load from file…
references-panel-citation-graph-load-recent = Recent saves
references-panel-citation-graph-load-file-title = Load Citation Graph
references-panel-citation-graph-load-success = Loaded
references-panel-citation-graph-load-failed = Load failed

citation-graph-merge-no-selection = Select at least two items with INSPIRE IDs to merge citation graphs.
citation-graph-merge-truncated = Selection is large; using the first { $count } seeds.
references-panel-status-empty = Select an item to load INSPIRE data
references-panel-reader-mode = INSPIRE data is unavailable in the reader view
references-panel-select-item = Select a single regular item to view INSPIRE data
references-panel-no-recid = INSPIRE record not found for this item
references-panel-recid-found = INSPIRE record found! Loading references...
references-panel-status-loading = Loading references...
references-panel-status-loading-cited = Loading citing records...
references-panel-status-loading-related = Discovering related papers...
references-panel-status-loading-related-progress = Discovering related papers... { $done }/{ $total }
references-panel-status-related-disabled-pdg = Related is disabled for Review of Particle Physics (PDG)
references-panel-status-loading-entry = Loading citing records for the selected reference...
references-panel-status-loading-author = Loading papers by the author...
references-panel-status-error = Failed to load data from INSPIRE
references-panel-status-stale-cache = Using offline cache ({ $hours }h old) - data may be outdated
references-panel-empty-list = No references available
references-panel-empty-cited = No citing records found
references-panel-empty-related = No related papers found
references-panel-empty-related-disabled-pdg = Related recommendations are disabled for Review of Particle Physics (PDG) because it is too generic.
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
references-panel-entry-back-author = Back to { $author }
references-panel-favorite-title = Favorite Authors
references-panel-favorite-empty = No favorite authors yet. Click ☆ in author profile to add.
references-panel-favorite-add = Add to favorites
references-panel-favorite-remove = Remove from favorites
references-panel-favorite-added = Added to favorites
references-panel-favorite-removed = Removed from favorites
references-panel-favorite-view = View all favorite authors
references-panel-favorite-papers-title = Favorite Papers
references-panel-favorite-papers-empty = No favorite papers yet. Right-click on an entry to add.
references-panel-favorite-paper-add = Add paper to favorites
references-panel-favorite-paper-remove = Remove paper from favorites
references-panel-favorite-paper-added = Paper added to favorites
references-panel-favorite-paper-removed = Paper removed from favorites
references-panel-favorite-presentations-title = Favorite Presentations
references-panel-favorite-presentations-empty = No favorite presentations yet. Right-click on a presentation to add.
references-panel-favorite-presentation-add = Add presentation to favorites
references-panel-favorite-presentation-remove = Remove presentation from favorites
references-panel-favorite-presentation-added = Presentation added to favorites
references-panel-favorite-presentation-removed = Presentation removed from favorites
references-panel-filter-placeholder = Filter entries
references-panel-quick-filters = Filters
references-panel-quick-filter-high-citations = High citations (>50)
references-panel-quick-filter-high-citations-tooltip = Show papers with more than 50 citations
references-panel-quick-filter-recent-5y = Recent 5 years
references-panel-quick-filter-recent-5y-tooltip = Only show papers published within the last 5 calendar years
references-panel-quick-filter-recent-1y = Recent 1 year
references-panel-quick-filter-recent-1y-tooltip = Only show papers published in the current calendar year
references-panel-quick-filter-non-review = Non-review articles
references-panel-quick-filter-non-review-tooltip = Hide review articles (document type: review, or major review journals like RMP/Phys. Rep./PPNP/Rep. Prog. Phys./Annual Reviews)
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
references-panel-sort-related = Relevance
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
references-panel-count-related =
  { $count ->
    [one] 1 related paper
   *[other] { $count } related papers
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
references-panel-filter-count-related =
  { $visible } / { $total } related papers
references-panel-filter-count-entry =
  { $visible } / { $total } citing records for "{ $label }"
references-panel-filter-count-author =
  { $visible } / { $total } papers by { $label }
references-panel-dot-local = Item exists in your library
references-panel-dot-add = Add this reference to your library
references-panel-dot-local-several = { $count } items in your library have this paper's INSPIRE ID; a click selects the first:
references-panel-dot-local-several-arxiv = { $count } items in your library have this paper's arXiv ID; a click selects the first:
references-panel-dot-unknown = Could not read your library, so it is not known whether this paper is in it. Click to try again.
references-panel-related-badge-tooltip = Shares { $count } references with the current paper
references-panel-link-existing = Click to unlink the related item
references-panel-link-missing = Link as related item
references-panel-toast-linked = Related item linked successfully
references-panel-toast-link-other-library = Items in different libraries cannot be related
references-panel-toast-link-target-gone = Not linked: the item it was to be linked to has been deleted or moved to the trash
references-panel-toast-added = Reference added to your library
references-panel-toast-missing = Article not found in INSPIRE-HEP
references-panel-library-lookup-failed = Could not read your library. Please try again.
references-panel-library-lookup-failed-add = Could not check whether this paper is already in your library, so it was not added. Please try again.
references-panel-toast-no-pdf = This item has no PDF attachment
references-panel-toast-selected = Item selected in library
references-panel-toast-bibtex-success = BibTeX copied to clipboard
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
# Hover Preview Card (FTR-HOVER-PREVIEW)
references-panel-preview-loading = Loading details...
references-panel-preview-abstract-truncated = [truncated]
references-panel-author-papers-label = Papers by { $author }
references-panel-author-click-hint = Click to view papers by { $author }
references-panel-author-profile-loading = Loading author profile...
references-panel-author-profile-unavailable = Author profile not available
references-panel-author-stats-loading = Loading statistics...
references-panel-author-stats = { $papers } papers · { $citations } citations · h-index: { $h }
references-panel-author-stats-no-self = { $papers } papers · { $citations } citations (no self) · h-index: { $h }
references-panel-author-stats-partial = Based on { $count } loaded papers
references-panel-author-advisors = Advisors
references-panel-author-emails = Emails
references-panel-author-orcid-tooltip = Open ORCID profile
references-panel-author-inspire-tooltip = View on INSPIRE
references-panel-author-homepage-tooltip = Open homepage
references-panel-author-profile-collapse = Collapse
references-panel-author-profile-expand = Expand
references-panel-author-preview-view-papers = View all papers
references-panel-author-copied = Copied
references-panel-author-library-count =
  { $count ->
    [one] 1 paper in your library
   *[other] { $count } papers in your library
  }
references-panel-author-search-arxiv = Search arXiv for this author
references-panel-author-search-inspire = Search INSPIRE for this author
references-panel-author-orcid-label = ORCID
references-panel-author-bai-label = BAI
references-panel-author-recid-label = INSPIRE ID
references-panel-copy-bibtex = Copy BibTeX
references-panel-copy-texkey = Copy TeX key
references-panel-pdf-open = Open PDF
references-panel-pdf-find = Find Full Text
references-panel-pdf-finding = Finding full text...
references-panel-pdf-not-found = No full text found
references-panel-bibtex-copied = BibTeX copied to clipboard
references-panel-bibtex-failed = Failed to fetch BibTeX
references-panel-texkey-copied = TeX key copied to clipboard
references-panel-texkey-failed = Failed to copy TeX key
references-panel-copy-link = Copy link
references-panel-open-link = Open in browser
references-panel-link-copied = Link copied to clipboard
references-panel-copy-failed = Failed to copy to clipboard

# Abstract Copy Context Menu
references-panel-abstract-copy = Copy
references-panel-abstract-copy-selection = Copy Selection
references-panel-abstract-copy-latex = Copy as LaTeX
references-panel-abstract-copied = Abstract copied to clipboard
references-panel-abstract-latex-copied = LaTeX source copied to clipboard

# Preview Card Action Buttons (FTR-HOVER-PREVIEW)
references-panel-status-local = In Library
references-panel-status-online = Online
references-panel-status-local-several = In Library ({ $count })
references-panel-status-unknown = Library unknown
references-panel-button-add = Add to Library
references-panel-button-link = Link
references-panel-button-unlink = Unlink
references-panel-button-select = Select
references-panel-button-open-pdf = Open PDF

update-cancelled = Update cancelled by user
update-cancelled-stats = Processed { $completed }/{ $total } items, { $updated } of them updated
update-request-failed =
  { $count ->
    [one] No usable answer from INSPIRE for 1 item (network, server or record problem); it was left unchanged
   *[other] No usable answer from INSPIRE for { $count } items (network, server or record problem); they were left unchanged
  }

zoteroinspire-refresh-button =
    .tooltiptext = Refresh INSPIRE data
zoteroinspire-copy-all-button =
    .tooltiptext = Export references (BibTeX/LaTeX)
references-panel-bibtex-fetching = Fetching entries...
references-panel-bibtex-all-failed = Failed to fetch entries
references-panel-no-recid-entries = No INSPIRE records to export

# Export menu localization strings
references-panel-export-copy-header = 📋 Copy to Clipboard
references-panel-export-file-header = 💾 Export to File
references-panel-export-copy-texkey = Copy citation keys
references-panel-export-texkey-copying = Copying citation keys...
references-panel-export-texkey-copied = Copied { $count } citation key(s)
references-panel-export-texkey-failed = Failed to copy citation keys
references-panel-export-copied = { $count } { $format } entries copied
references-panel-export-saved = { $count } { $format } entries saved
references-panel-export-clipboard-failed = Failed to copy to clipboard (content too large?)
references-panel-export-too-large = Content too large ({ $size }KB) - please use "Export to File" instead
references-panel-export-cancelled = Export cancelled
references-panel-export-save-title = Export References

# Citation style export (uses Zotero's built-in bibliography dialog)
references-panel-export-citation-header = 📝 Citation Style
references-panel-export-citation-copied = { $count } formatted references copied
references-panel-export-citation-no-local = No local Zotero items to format (only local library items can use citation styles)
references-panel-export-citation-select-style = Select Citation Style...
references-panel-export-citation-import-needed = { $count } reference(s) need to be imported to your Zotero library first. Select a collection to import them.
references-panel-export-citation-importing = Importing { $done } / { $total } for citation export...
references-panel-export-citation-import-failed = Failed to import some references. Only { $success } of { $total } can be formatted.

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
references-panel-rate-limit-label = INSPIRE queue: { $count }

# Search feature localization strings
references-panel-tab-search = 🔍
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
references-panel-cache-source-local-expired = From expired cache ({ $age }h ago) - offline mode

# Context menu copy actions
menuitem-copy-bibtex = Copy BibTeX
menuitem-copy-citation-key = Copy citation key
menuitem-copy-inspire-recid = Copy INSPIRE recid
menuitem-copy-inspire-link = Copy INSPIRE link
menuitem-copy-inspire-link-md = Copy INSPIRE link (Markdown)
menuitem-copy-zotero-link = Copy Zotero link
copy-success-bibtex =
  { $count ->
    [one] Copied 1 BibTeX entry
   *[other] Copied { $count } BibTeX entries
  }
copy-success-inspire-link = INSPIRE link copied to clipboard
copy-success-inspire-link-md = Markdown link copied to clipboard
copy-success-citation-key =
  { $count ->
    [one] Copied 1 citation key
   *[other] Copied { $count } citation keys
  }
copy-success-inspire-recid =
  { $count ->
    [one] Copied 1 INSPIRE recid
   *[other] Copied { $count } INSPIRE recids
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
references-panel-batch-attaching-pdfs = Attaching PDFs { $done } / { $total }...
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
references-panel-batch-duplicate-items = ({ $count } items)
references-panel-batch-duplicate-libraries = in { $libraries }
references-panel-batch-duplicate-skip-all = Skip all duplicates
references-panel-batch-duplicate-import-all = Import all anyway
references-panel-batch-duplicate-confirm = Confirm selection
references-panel-batch-duplicate-cancel = Cancel
references-panel-batch-duplicate-check-failed = Could not check your library for these papers, so nothing was imported. Please try again.

# PDF Citation Lookup (FTR-PDF-ANNOTATE)
pdf-annotate-lookup-button = Look up in References
pdf-annotate-not-found = Reference [{ $label }] is not in the INSPIRE reference list for this paper. If it exists in the PDF but not here, consider submitting a correction to INSPIRE.
pdf-annotate-no-text-layer = This PDF has no text layer. Citations cannot be detected.

# Multi-label matching (FTR-PDF-ANNOTATE-MULTI-LABEL)
pdf-annotate-multi-match =
  { $count ->
    [one] Found 1 entry for [{ $label }]
   *[other] Found { $count } entries for [{ $label }]
  }
pdf-annotate-multi-match-truncated = Found { $count } entries for [{ $label }] (showing first { $shown })
pdf-annotate-fallback-warning = INSPIRE references may differ from the PDF (labels: { $rate }%). Using position match; consider submitting a correction to INSPIRE.
pdf-annotate-parse-success = Parsed PDF references: { $total } citations ({ $multi } multi-paper)

# Smart Update feature (FTR-SMART-UPDATE)
smart-update-untitled = (Untitled)
smart-update-value-empty = (empty)
smart-update-field-title = Title
smart-update-field-date = Date
smart-update-field-journal = Journal
smart-update-field-volume = Volume
smart-update-field-pages = Pages
smart-update-field-issue = Issue
smart-update-field-abstract = Abstract
smart-update-field-doi = DOI
smart-update-field-arxiv = arXiv
smart-update-field-citations = Citations
smart-update-field-citations-wo-self = Citations (w/o self)
smart-update-field-citekey = Citation Key
smart-update-field-collaboration = Collaboration
smart-update-field-authors = Authors
smart-update-authors-lost = INSPIRE's author list lacks authors this item has; tick to replace them anyway.

# Smart Update Preview Dialog
smart-update-preview-title = Smart Update Preview
smart-update-preview-header = Changes for: { $title }
smart-update-preview-info = Select the fields you want to update. Uncheck to skip a field.
smart-update-preview-current = Current
smart-update-preview-new = New
smart-update-preview-apply = Apply
smart-update-preview-cancel = Cancel
smart-update-preview-no-changes = No changes detected for this item.

# Auto-check update notification (FTR-SMART-UPDATE-AUTO-CHECK)
smart-update-auto-check-available = Updates available from INSPIRE
smart-update-auto-check-view = View Changes
smart-update-auto-check-dismiss = Dismiss
smart-update-auto-check-changes =
  { $count ->
    [one] 1 field has new data
   *[other] { $count } fields have new data
  }

# Ambiguous citation picker (FTR-AMBIGUOUS-AUTHOR-YEAR)
pdf-annotate-ambiguous-title = Multiple matches for "{ $citation }"
pdf-annotate-ambiguous-message = This citation matches multiple papers. Please select the correct one:
pdf-annotate-ambiguous-cancel = Cancel
# FTR-AMBIGUOUS-AUTHOR-YEAR: Preview message for ambiguous author-year match
pdf-annotate-ambiguous-preview-hint = Author-year match only; click to select

# Preprint Watch feature (FTR-PREPRINT-WATCH)
preprint-check-menu = Check Preprint Status
preprint-check-collection-menu = Check Preprints in Collection
preprint-check-all-menu = Check All Preprints in Library
preprint-check-progress = Checking preprints... ({ $current }/{ $total })
preprint-check-scanning = Scanning library for preprints...
preprint-check-cancelled = Check cancelled
preprint-found-published =
  { $count ->
    [one] 1 preprint has been published!
   *[other] { $count } preprints have been published!
  }
preprint-check-summary =
  Checked { $total ->
    [one] 1 preprint
   *[other] { $total } preprints
  }: { $published } published, { $unpublished } unpublished, { $notInInspire } not covered by INSPIRE (publication unknown), { $errors } failed
preprint-no-preprints = No unpublished preprints found.
preprint-update-success =
  { $count ->
    [one] Successfully updated 1 item.
   *[other] Successfully updated { $count } items.
  }
preprint-update-selected = Update Selected
preprint-select-all = Select All
preprint-cancel = Cancel
preprint-doi-updated = DOI updated: { $oldDoi } → { $newDoi }
preprint-results-published = Published
preprint-results-unpublished = Unpublished
preprint-results-not-in-inspire = Not covered by INSPIRE (publication unknown)
preprint-results-errors = Errors
preprint-found-records =
  { $count ->
    [one] 1 preprint has an INSPIRE record its item does not name yet
   *[other] { $count } preprints have an INSPIRE record their items do not name yet
  }
preprint-section-published = Published: update the bibliographic information
preprint-section-records = In INSPIRE, not published: write the INSPIRE record only (recid, empty citation key, citation counts; bibliographic information unchanged)
preprint-record-line = INSPIRE { $recid }: { $title } ({ $author })
preprint-mismatch = May be another paper: { $reasons }
preprint-mismatch-title = the titles differ
preprint-mismatch-firstAuthor = the first authors differ
preprint-mismatch-recordIncomplete = INSPIRE's record has no title or first author
preprint-records-written =
  { $count ->
    [one] Wrote the INSPIRE record of 1 item.
   *[other] Wrote the INSPIRE record of { $count } items.
  }
preprint-records-shown = { $count } not written: shown in the item pane or a reader (select another item and check again)
preprint-records-changed = { $count } not written: changed or deleted since the check, or with unsaved changes
preprint-records-archive-conflict = { $count } without recid: Archive or Loc. in Archive holds another value

# Collaboration Tags feature (FTR-COLLAB-TAGS)
collab-tag-menu-add = Add Collaboration Tags
collab-tag-menu-reapply = Reapply Collaboration Tags
collab-tag-progress = Adding collaboration tags...
collab-tag-result =
  { $added ->
    [0] { $updated ->
      [0] No changes
      [one] Updated 1 tag
     *[other] Updated { $updated } tags
    }
    [one] Added 1 tag{ $updated ->
      [0] {""}
     *[other] , updated { $updated }
    }
   *[other] Added { $added } tags{ $updated ->
      [0] {""}
     *[other] , updated { $updated }
    }
  }{ $skipped ->
    [0] {""}
   *[other] , skipped { $skipped }
  }
collab-tag-no-selection = Select at least one item to add collaboration tags
collab-tag-disabled = Enable collaboration tags in Preferences → INSPIRE to use this feature

# Funding extraction - Main window menu
menuitem-copy-funding = Copy Funding Info

# Favorite paper - Main window menu (FTR-FAVORITE-PAPERS)
menuitem-favorite-paper = Toggle Favorite Paper
references-panel-favorite-paper-select-one = Select exactly one item to toggle favorite
references-panel-favorite-paper-no-recid = Cannot favorite: no INSPIRE ID found

# Funding extraction - Progress messages
funding-extraction-progress = Extracting funding info from PDF...
funding-extraction-complete = Found { $count } grant(s) from { $funders } funder(s)
funding-extraction-none = No funding information found
funding-no-selection = No items selected
funding-no-entries = No entries to export
funding-no-pdf = No PDF attachment found
funding-no-linked-items = No items are linked to Zotero library
funding-some-unlinked = { $count } entries are not linked (skipped)

# Funding extraction - References panel export menu
references-panel-export-funding-header = — Funding Info —
references-panel-export-funding-copy = Copy Funding Table
references-panel-export-funding-csv = Export Funding (CSV)
references-panel-export-funding-saved = Funding table saved ({ $count } entries)
references-panel-export-funding-copied = Funding table copied ({ $count } entries)

# Academic genealogy
academic-tree-title = Academic Tree
academic-tree-back = ← Back
academic-tree-forward = Forward →
academic-tree-maximize = Maximize / restore window
academic-tree-search-placeholder = Author name or INSPIRE BAI
academic-tree-search = Search authors
academic-tree-searching = Searching authors…
academic-tree-choose = Choose an author to view their academic tree.
academic-tree-no-authors = No authors found. Try another name or BAI.
academic-tree-search-error = Author search failed. Please try again.
academic-tree-select = Select author
academic-tree-up = Ancestors
academic-tree-down = Descendants
academic-tree-depth-limit = Limit: { $count } generations. Click this person's name to make them the center and continue tracing.
academic-tree-degree = Relationship type
academic-tree-all = All relationships
academic-tree-phd = PhD
academic-tree-master = Master
academic-tree-bachelor = Bachelor
academic-tree-other = Other
academic-tree-diploma = Diploma
academic-tree-habilitation = Habilitation
academic-tree-laurea = Laurea
academic-tree-specified = Specified qualifications
academic-tree-unknown = Unspecified
academic-tree-refresh = Refresh from INSPIRE
academic-tree-refresh-hint = Fetch fresh INSPIRE records for this tree, including expanded branches, and update the cache.
academic-tree-retry = Retry
academic-tree-continue = Continue loading
academic-tree-refreshing = Refreshing from INSPIRE… The previous tree remains visible.
academic-tree-refresh-error = { $count } requests failed. The previous tree is retained; retry to finish refreshing.
academic-tree-profile-error = { $count } author profiles could not be loaded; retry to complete their details.
academic-tree-stop = Stop
academic-tree-more = Load more
academic-tree-fit = Fit all
academic-tree-fit-page = Fit to page
academic-tree-fit-page-hint = Wrap long generations into rows at the window width without shrinking names. Read left to right, then the next row of the same generation. Scroll or drag vertically; Ctrl/⌘ + scroll zooms. Toggle off to restore the tree layout.
academic-tree-generation = Generation { $generation }
academic-tree-generation-row = Row { $row } of { $rows }
academic-tree-center = Center root
academic-tree-zoom-in = Zoom in
academic-tree-zoom-out = Zoom out
academic-tree-loading = Loading generations…
academic-tree-load-error = Could not load the author. Retry or select another author.
academic-tree-partial-error = { $count } branches failed; retry to load them.
academic-tree-limit = Expansion paused (node budget: { $count }); load more or focus on a branch.
academic-tree-count = { $count } people · { $links } relationships
academic-tree-unlinked = INSPIRE has no linked author record for this name; automatic expansion is unavailable.
academic-tree-no-advisors = No advisors found in INSPIRE under the selected relationship filter.
academic-tree-no-students = No students found in INSPIRE under the selected relationship filter.
academic-tree-node-error = This branch could not be loaded. Use expand or retry.
academic-tree-expand-up = Expand 1 advisor generation
academic-tree-expand-down = Expand 1 student generation
academic-tree-reroot = Set as center
academic-tree-inspire = INSPIRE profile
academic-tree-papers = View papers
academic-tree-stopped = Loading stopped. The relationships already loaded remain visible.
academic-tree-canvas-help = Click a name to trace their academic tree and show their papers in the sidebar. Hover over a name for the author preview. Click a card for branch actions. Drag to pan, scroll to zoom. In Fit to page mode, scroll to browse and Ctrl/⌘ + scroll to zoom; arrows, +/− and 0 also work.
academic-tree-source-note = Source: public INSPIRE author records. Arrows run from advisor to student; dashed cards have no linked author ID. Missing records do not establish the absence of a relationship. Blue lines highlight the chosen relationship path, or the selected or hovered person’s relationships when no path is active.

academic-tree-view-menu = Find / path
academic-tree-expand-menu = Branches
academic-tree-co-advisors = Show co-advisors
academic-tree-co-advisors-hint = Hide supplemental co-advisors outside the center’s lineage and expanded ancestor branches. The center’s own advisors remain visible.
academic-tree-find-placeholder = Find in loaded tree: name, ID, affiliation
academic-tree-find-empty = No matches in the loaded tree.
academic-tree-locate = Locate without changing center
academic-tree-path-from = Path from person…
academic-tree-path-to = Path to person…
academic-tree-show-path = Show relationship path
academic-tree-clear-path = Clear path
academic-tree-path-empty = Choose two people connected in the loaded tree. No path found.
academic-tree-expand-ancestors = Expand all shown ancestors’ students
academic-tree-collapse-ancestors = Collapse added ancestors’ students
academic-tree-collapse-ancestors-hint = Hide the student branches added by this expansion, keeping the original tree and the center’s ancestral chain. Expand again to restore loaded branches.
academic-tree-expand-ancestors-hint = Load the direct students of every ancestor already shown, across all displayed ancestral generations. Newly added people are not expanded recursively.
academic-tree-collapse = Collapse selected student branch
academic-tree-restore-branch = Restore selected student branch
academic-tree-restore-branches = Restore all collapsed branches
academic-tree-export = Export
academic-tree-export-scope = Export scope
academic-tree-export-view = Current view
academic-tree-export-full = Full loaded tree
academic-tree-export-hint = SVG/PNG: complete layout of the selected scope; Current view includes all currently shown people, even outside the panel. JSON/CSV: people and relationships in the selected scope. Full tree includes hidden branches, without fetching more data. SVG preserves detail in large trees.
academic-tree-export-success = Academic tree exported.
academic-tree-export-error = Export failed. Please retry.
academic-tree-visible-count = { $count } visible

academic-tree-selection = Selected: { $name }
academic-tree-revealed = Related hidden branches were revealed.
academic-tree-find-more = { $count } more matches. Refine your search.

academic-tree-legend = INSPIRE · Advisor → student · Gray cards: supplemental co-advisors · Dashed: unlinked record · Center chain aligned; each advisor’s students ordered by surname or education year · Hover a line to trace it · Missing data may omit relationships.

academic-tree-sort = Sort within families
academic-tree-sort-name = Surname A–Z
academic-tree-sort-year = Education year ↑
academic-tree-sort-hint = Sort all students of each advisor on the same generation row, including those with co-advisors. Years match the degree on that advisor–student relationship. Unknown years come last; ties use surname. Conflicting family orders favor the advisor closest to the center.
academic-tree-education-year = Education ended { $year } (INSPIRE)

## arXiv browser window

arxiv-browser-window =
    .title = arXiv Browser
arxiv-browser-empty = Create or choose a subscription to browse arXiv listings.
arxiv-browser-subscription = Subscription
arxiv-browser-chip-hint = Click: only this category. Ctrl/Cmd+click: add or remove one. Shift+click: a range. Click the only one chosen again: all.
arxiv-browser-subscription-new = New…
arxiv-browser-subscription-edit = Edit…
arxiv-browser-subscription-delete = Delete
arxiv-browser-subscription-delete-confirm = Delete the subscription “{ $name }”?
arxiv-browser-subscription-default-name = Subscription { $number }
arxiv-browser-editor-title-new = New subscription
arxiv-browser-editor-title-edit = Edit subscription
arxiv-browser-editor-name = Name
arxiv-browser-editor-search = Search categories (name or identifier)
arxiv-browser-editor-selected = Chosen (their listings are shown in this order)
arxiv-browser-editor-none-selected = No category chosen yet.
arxiv-browser-editor-whole-archive = All of { $archive } ({ $count } categories, one listing page)
arxiv-browser-editor-alias = the same listing as { $canonical }
arxiv-browser-editor-move-up = Move up
arxiv-browser-editor-move-down = Move down
arxiv-browser-editor-remove = Remove
arxiv-browser-editor-sections = Show:
arxiv-browser-section-new = New submissions
arxiv-browser-section-cross = Cross-lists
arxiv-browser-section-replace = Replacements
arxiv-browser-editor-estimate =
    A first load sends arXiv, for new: { $new ->
        [1] 1 request
       *[other] { $new } requests (at least { $newTime })
    }; for recent: { $recent } requests (at least { $recentTime }); for catch-up: { $catchup ->
        [1] 1 request
       *[other] { $catchup } requests
    } per announcement day. arXiv asks for 15 s between requests; days already loaded come from the cache.
arxiv-browser-editor-many = Many categories: a first recent load takes at least { $time }. If they lie in one archive, subscribing to the whole archive needs one request per day (its listing then covers all its categories); or split them into several subscriptions.
arxiv-browser-editor-save = Save
arxiv-browser-editor-cancel = Cancel
arxiv-browser-duration-seconds = { $count } s
arxiv-browser-duration-minutes = { $count } min
arxiv-browser-duration-minutes-seconds = { $minutes } min { $seconds } s
arxiv-browser-days = Choose the days to list
arxiv-browser-days-newest = Newest day
arxiv-browser-days-recent = Last 5 announcement days
arxiv-browser-days-week = This week
arxiv-browser-days-unread = Unread days
arxiv-browser-days-unread-none = No unread days
arxiv-browser-days-unread-legend = Blue dot: not read yet.
arxiv-browser-days-day-unread = { $date }, not read yet
arxiv-browser-days-mark-read = Mark read
arxiv-browser-days-mark-unread = Mark unread
arxiv-browser-days-mark-all-read = Mark all read
arxiv-browser-reading-file-unreadable = The file of the days marked read ({ $path }) could not be read. Days marked now are kept only until Zotero closes.
arxiv-browser-reading-file-kept = The file of the days marked read could not be read. It was kept as { $path }, and days are marked afresh.
arxiv-browser-days-range = { $first } – { $last } ({ $count } days)
arxiv-browser-days-previous-month = Previous month
arxiv-browser-days-next-month = Next month
arxiv-browser-days-hint = Click a day; Ctrl/⌘+click adds or removes one; Shift+click picks a range.
arxiv-browser-days-none = No day picked.
arxiv-browser-days-picked = { $days ->
        [one] 1 day picked
       *[other] { $days } days picked
    }; if not cached, { $requests ->
        [one] 1 request
       *[other] { $requests } requests
    }, at least { $time }.
arxiv-browser-days-estimate = If not cached: { $requests ->
        [one] 1 request
       *[other] { $requests } requests
    }, at least { $time }
arxiv-browser-days-load = Load
arxiv-browser-reload = Reload
arxiv-browser-reload-tooltip = Load the chosen days again, fetching the newest listing afresh when it is among them (other days come from the cache)
arxiv-browser-cancel = Cancel
arxiv-browser-continue = Continue
arxiv-browser-status-waiting = Keeping arXiv’s request interval: continuing in { $seconds } s.
arxiv-browser-status-paused = arXiv is unavailable for now; retrying at { $time }.
arxiv-browser-status-sending = Fetching from arXiv…
arxiv-browser-status-queued = { $count ->
        [one] (1 more request queued)
       *[other] ({ $count } more requests queued)
    }
arxiv-browser-status-loading = Loading…
arxiv-browser-status-loaded = { $days ->
        [one] 1 day
       *[other] { $days } days
    }, { $papers ->
        [one] 1 paper
       *[other] { $papers } papers
    }.
arxiv-browser-status-stopped = Loading stopped: { $reason }.
arxiv-browser-status-cancelled = Loading cancelled.
arxiv-browser-status-previous-issue = The newest listing is still the previous one (arXiv may have postponed the announcement); try Reload later.
arxiv-browser-status-no-announcement = No announcement on { $dates }.
arxiv-browser-nothing-loaded = Nothing loaded.
arxiv-browser-reason-cancelled = cancelled
arxiv-browser-reason-timeout = arXiv did not answer in time
arxiv-browser-reason-offline = Zotero is offline
arxiv-browser-reason-network = no connection to arXiv
arxiv-browser-reason-unavailable = arXiv is unavailable for now
arxiv-browser-reason-forbidden = arXiv refused the request
arxiv-browser-reason-stopped = not requested after an earlier refusal
arxiv-browser-reason-http = unexpected answer from arXiv
arxiv-browser-reason-out-of-range = older than arXiv’s 90 days of catch-up listings
arxiv-browser-reason-parse = the page could not be read
arxiv-browser-reason-check = the pages of the day did not add up
arxiv-browser-reason-mixed-dates = the pages showed different days
arxiv-browser-day-count = { $count ->
        [one] 1 paper
       *[other] { $count } papers
    }
arxiv-browser-day-filtered = { $shown } of { $count } papers
arxiv-browser-continued = (continued)
arxiv-browser-day-empty = No papers in the subscribed categories on this day.
arxiv-browser-day-none-shown = None in the shown sections.
arxiv-browser-day-none-chosen = None on the chosen categories' pages.
arxiv-browser-day-no-match = None matches the filter.
arxiv-browser-day-failed = This day was not fetched.
arxiv-browser-day-incomplete = This day was not fetched completely.
arxiv-browser-day-loading = Still fetching: { $specs } …
arxiv-browser-day-spec-failed = { $spec }: { $reason }
arxiv-browser-day-spec-stale = { $spec }: arXiv still shows { $date }
arxiv-browser-day-spec-cached = { $spec }: copy from the cache (fetching failed: { $reason })
arxiv-browser-retry = Retry
arxiv-browser-sort = Sort
arxiv-browser-sort-announcement = Announcement order
arxiv-browser-sort-id-asc = arXiv ID ↑
arxiv-browser-sort-id-desc = arXiv ID ↓
arxiv-browser-sort-primary = Primary category
arxiv-browser-filter = Filter: words or "phrases"
arxiv-browser-search = Search arXiv
arxiv-browser-search-tooltip = Search all of arXiv, newest submissions first (Enter). Words search all fields and must all match; arXiv’s syntax works too: au:witten, ti:tetraquark, abs:"chiral perturbation", cat:hep-ph, AND, OR, ANDNOT, ( ), submittedDate:[202601010000 TO 202612312359]
arxiv-browser-search-clear = Clear the search and go back to the days listed
arxiv-browser-search-running = Searching arXiv…
arxiv-browser-search-none = arXiv found no papers.
arxiv-browser-search-found = arXiv found { $total ->
        [one] 1 paper
       *[other] { $total } papers
    }; { $fetched } fetched.
arxiv-browser-search-limit = arXiv gives the first { $limit } only.
arxiv-browser-search-refused = arXiv did not accept the search: { $message }
arxiv-browser-quick-filter-local-tooltip = Show papers already in your Zotero library
arxiv-browser-quick-filter-online-tooltip = Show papers not yet in your Zotero library
arxiv-browser-quick-filter-related-tooltip = Show papers whose Zotero item has related items
arxiv-browser-page-size = Per page
arxiv-browser-abstracts = Abstracts
arxiv-browser-abstract-show = Abstract ▸
arxiv-browser-abstract-hide = Abstract ▾
arxiv-browser-page-previous = ‹ Previous
arxiv-browser-page-next = Next ›
arxiv-browser-papers = { $count ->
        [one] 1 paper
       *[other] { $count } papers
    }
arxiv-browser-section-tag-cross = cross-list
arxiv-browser-section-tag-replace = replacement
arxiv-browser-open-pdf = Open the PDF on arXiv (in your web browser)
arxiv-browser-divider = Drag (or use ← and →) to change the widths of the list and the detail pane
arxiv-browser-detail-empty = Choose a paper to see it here.
arxiv-browser-copied-id = Copied { $id }
arxiv-browser-bibtex-waiting = Fetching the BibTeX from arXiv (keeping its request interval)…
arxiv-browser-bibtex-copied-inspire = Copied INSPIRE's BibTeX of { $id }
arxiv-browser-bibtex-copied-arxiv = Copied arXiv's BibTeX of { $id } (not in INSPIRE)
arxiv-browser-bibtex-copied-arxiv-unreachable = Copied arXiv's BibTeX of { $id } (INSPIRE could not be reached)
arxiv-browser-bibtex-failed = Could not get the BibTeX of { $id }: { $reason }
arxiv-browser-inspire-link-not-found = { $id } is not in INSPIRE: no link copied
arxiv-browser-inspire-link-unreachable = INSPIRE could not be reached: no link copied for { $id }
arxiv-browser-detail-section-new = { $category }: new submission
arxiv-browser-detail-section-cross = { $category }: cross-list
arxiv-browser-detail-section-replace = { $category }: replacement
arxiv-browser-detail-authors-limit = arXiv’s listing names at most 100 authors; the arXiv page has them all.
arxiv-browser-detail-version = version { $version }
arxiv-browser-detail-announced = announced { $date }
arxiv-browser-detail-submitted = submitted { $date }
arxiv-browser-detail-comments = Comments:
arxiv-browser-detail-journal-ref = Journal reference:
arxiv-browser-detail-in-library = ✓ In your library
arxiv-browser-show-in-library = Show in library
arxiv-browser-copy-id = Copy arXiv ID
arxiv-browser-copy-bibtex = Copy BibTeX
arxiv-browser-menu-select-all = Select All
arxiv-browser-menu-open-link = Open Link in Web Browser
arxiv-browser-menu-copy-link = Copy Link Address
arxiv-browser-menu-copy-title = Copy Title
arxiv-browser-menu-copy-abs-link = Copy Link to the arXiv Page
arxiv-browser-copied-text = Copied
arxiv-browser-open-abstract-page = arXiv page
arxiv-browser-open-pdf-button = PDF
arxiv-browser-open-html = Open arXiv's HTML version in the web browser
arxiv-browser-open-html-button = HTML
arxiv-browser-dot-add = Click to add this paper to your library
arxiv-browser-dot-local = In your library; click to select it in the main window
arxiv-browser-row-related = { $count ->
    [one] Related to one item (click to relate it to more; remove relations in the item's Related section):
   *[other] Related to { $count } items (click to relate it to more; remove relations in the item's Related section):
}
arxiv-browser-row-link = Click to choose the items to relate this paper to (a paper not in your library is added first)
arxiv-browser-add = Add…
arxiv-browser-add-journal = Add the journal version…
arxiv-browser-link = Relate to items…
arxiv-browser-adding = Adding { $id }…
arxiv-browser-added = Added { $id } to { $target }
arxiv-browser-note-journal-mismatch = The journal DOI given on arXiv belongs to another paper: added as the arXiv preprint.
arxiv-browser-note-journal-not-found = The journal DOI could not be looked up: added as the arXiv preprint.
arxiv-browser-note-no-pdf = The arXiv API did not answer: added from INSPIRE, without the PDF.
arxiv-browser-note-no-journal-doi = arXiv gives no journal DOI for this paper: added as the arXiv preprint.
arxiv-browser-pdf-failed = The PDF of { $id } was not attached: { $reason }
arxiv-browser-pdf-not-pdf = arXiv did not send a PDF
arxiv-browser-pdf-files-not-editable = the library does not allow files
arxiv-browser-pdf-save = Zotero could not store the file
arxiv-browser-in-library-already = { $id } is already in { $library }
arxiv-browser-doi-only = { $library } has an item with the journal DOI given for { $id } on arXiv: { $titles }. Is it this paper?
arxiv-browser-doi-only-add = Not this paper: add it
arxiv-browser-inspire-unknown = INSPIRE could not be reached, so it is not known whether INSPIRE has { $id }.
arxiv-browser-add-from-arxiv = Add from arXiv data
arxiv-browser-add-from-arxiv-count = { $count ->
        [one] Add 1 paper from arXiv data
       *[other] Add { $count } papers from arXiv data
    }
arxiv-browser-try-later = Try later
arxiv-browser-not-added = { $id } was not added: { $reason }
arxiv-browser-not-added-in-library = already in the library
arxiv-browser-not-added-inspire-unknown = INSPIRE could not be reached
arxiv-browser-not-added-arxiv-unavailable = the arXiv API is not answering; try again later
arxiv-browser-not-added-not-on-arxiv = the arXiv API does not know it
arxiv-browser-not-added-library-unreadable = the library could not be read
arxiv-browser-not-added-not-editable = the library cannot be edited
arxiv-browser-linked = Related to “{ $title }”
arxiv-browser-linked-several = Related to { $count } items
arxiv-browser-undo-hint = (Edit → Undo, or Ctrl/Cmd+Z, takes it back)
arxiv-browser-notice-close = Close
arxiv-browser-batch-added = Added { $added } of { $total } papers to { $target }
arxiv-browser-batch-not-added = Not added:
arxiv-browser-batch-none-added = None of the { $total } papers was added
arxiv-browser-batch-pdf-failed = PDF not attached:
arxiv-browser-completion = { $count ->
        [one] 1 preprint added recently has no INSPIRE record yet
       *[other] { $count } preprints added recently have no INSPIRE record yet
    }
arxiv-browser-completion-check = Check now
arxiv-browser-completion-checking = Asking INSPIRE about the preprints added recently…
arxiv-browser-completion-none-found = INSPIRE has none of them yet.
arxiv-browser-completion-failed = INSPIRE could not be reached for { $count ->
        [one] 1 preprint
       *[other] { $count } preprints
    }; check again later.
arxiv-browser-completion-unreachable = INSPIRE could not be reached; check again later.
arxiv-browser-batch-cancelled = Cancelled: { $count ->
        [one] 1 paper not added
       *[other] { $count } papers not added
    }
arxiv-pdf-attachment-title = arXiv preprint PDF v{ $version }
