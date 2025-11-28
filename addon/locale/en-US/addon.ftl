startup-begin = Addon is loading
startup-finish = Addon is ready
menuitem-label = Addon Template: Helper Examples
menupopup-label = Update Inspire Metadata
menuitem-submenulabel0 = With abstracts
menuitem-submenulabel1 = Without abstracts
menuitem-submenulabel2 = Citation counts only

referencesSection = References
    .label = References
    .tooltiptext = INSPIRE References
references-panel-header = References
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
    .tooltiptext = Copy all references as BibTeX
references-panel-bibtex-fetching = Fetching BibTeX entries...
references-panel-bibtex-all-copied = { $count } BibTeX entries copied to clipboard
references-panel-bibtex-all-failed = Failed to copy BibTeX entries
references-panel-no-recid-entries = No INSPIRE records to copy