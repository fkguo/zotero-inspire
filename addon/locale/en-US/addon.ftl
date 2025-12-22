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
references-panel-recid-found = INSPIRE record found! Loading references...
references-panel-status-loading = Loading references...
references-panel-status-loading-cited = Loading citing records...
references-panel-status-loading-entry = Loading citing records for the selected reference...
references-panel-status-loading-author = Loading papers by the author...
references-panel-status-error = Failed to load data from INSPIRE
references-panel-status-stale-cache = Using offline cache ({ $hours }h old) - data may be outdated
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
references-panel-author-orcid-label = ORCID
references-panel-author-bai-label = BAI
references-panel-author-recid-label = INSPIRE ID
references-panel-copy-bibtex = Copy BibTeX
references-panel-copy-texkey = Copy TeX key
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
references-panel-button-add = Add to Library
references-panel-button-link = Link
references-panel-button-unlink = Unlink
references-panel-button-select = Select
references-panel-button-open-pdf = Open PDF

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
references-panel-cache-source-local-expired = From expired cache ({ $age }h ago) - offline mode

# Context menu copy actions
menuitem-copy-bibtex = Copy BibTeX
menuitem-copy-inspire-link = Copy INSPIRE link
menuitem-copy-citation-key = Copy citation key
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
preprint-all-current = All preprints are still unpublished.
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
preprint-results-errors = Errors

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
