pref-meta = Fetch INSPIRE Metadata for New Items
pref-citekey = Set Citekey in Extra Field
pref-extra-order = Field Order in Extra
pref-arxiv-tag = arXiv Primary Category Tag
pref-refs-panel = References Panel
pref-reader-history = Reader View Navigation
pref-nofound = INSPIRE Record Not Found
pref-latex-label = Abstract LaTeX:
pref-latex-mode-unicode = Unicode
    .tooltiptext = Use Unicode characters for simple formulas. Lightweight rendering.
pref-latex-mode-katex = KaTeX (default)
    .tooltiptext = Use KaTeX to render complex LaTeX formulas with high fidelity.
pref-latex-mode-description = KaTeX renders complex equations (fractions, integrals, matrices). Only applies when fetching abstracts.

pref-enable =
    .label = Enable

meta-full =
    .label = With abstracts
meta-noabstract =
    .label = Without abstracts
meta-citations =
    .label = Citation counts only
meta-no =
    .label = Disabled

citekey-inspire =
    .label = INSPIRE citekey
citekey-no =
    .label = Disabled

extra-order-citations-first =
    .label = Citations first
extra-order-arxiv-first =
    .label = arXiv ID first

pref-cites-column-exclude-self =
    .label = Cites column: exclude self-citations
pref-cites-column-exclude-self-desc = Use citation counts without self-citations (when available). If the items list doesn't update, switch collections or restart Zotero.

pref-arxiv-in-journal-abbrev =
    .label = Legacy: write arXiv ID into Journal Abbr.
pref-arxiv-in-journal-abbrev-desc = For unpublished papers, store `arXiv:...` in the Journal Abbreviation field.

pref-arxiv-tag1 =
    .label = Add arXiv primary category as tag (e.g., hep-ph, nucl-th)

pref-max-authors-label = Maximum authors to display:
pref-max-authors-desc = Number of authors shown before "et al." in the references panel (default: 3)

pref-chart-enable =
    .label = Enable statistics chart
pref-chart-enable-desc = Show interactive statistics chart (by year/citations) at the top of the panel.
pref-chart-default-collapsed =
    .label = Collapsed by default

pref-related-papers-enable =
    .label = Enable Related Papers tab
pref-related-papers-enable-desc = Show a Related tab that recommends papers sharing references with the current paper.

pref-related-papers-exclude-reviews =
    .label = Exclude review articles
pref-related-papers-exclude-reviews-desc = Hide review articles (document type: review) and papers in major review journals (RMP, Phys. Rep., PPNP, Rep. Prog. Phys., Annual Reviews) in Related recommendations.

pref-related-papers-max-results-label = Related papers to show:
pref-related-papers-max-results-desc = Maximum number of items displayed in the Related tab (default: 50).

pref-citation-graph-max-results-label = Citation graph papers to show:
pref-citation-graph-max-results-desc = Maximum number of references and cited-by papers shown in the citation graph (default: 25).

pref-keyboard-shortcuts-title = Keyboard Shortcuts
pref-keyboard-shortcuts-desc = Navigate and interact with entries using keyboard
pref-keyboard-shortcuts-nav = ↑/↓ or j/k: Navigate entries · Home/End: Jump to first/last · ←/→: Back/Forward
pref-keyboard-shortcuts-action = Enter: Open PDF or select item · Space/l: Toggle link · Ctrl+C: Copy BibTeX
pref-keyboard-shortcuts-tab = Tab/Shift+Tab: Switch tabs · Escape: Clear focus

pref-search-history-clear =
    .label = Clear Search History
pref-search-history-cleared = History cleared
pref-search-history-days-label = Keep search history for (days):

pref-pdf-fuzzy-citation =
    .label = Fuzzy citation detection (experimental)
pref-pdf-fuzzy-citation-desc = Enable aggressive pattern matching when PDF text layer is broken (e.g., brackets truncated). May cause false positives.

pref-pdf-parse-refs-list =
    .label = Parse PDF reference list (fixes multi-citation alignment)
pref-pdf-parse-refs-list-desc = Scans the PDF's References section to determine citation boundaries when INSPIRE labels are missing. Enable this if clicking [21] jumps to [20]'s second paper.
pref-pdf-force-mapping =
    .label = Force PDF mapping when INSPIRE differs
pref-pdf-force-mapping-desc = If PDF and INSPIRE reference lists diverge (e.g., arXiv vs published version), prefer PDF-derived mapping and skip index fallback to avoid wrong jumps.

pref-reader-auto-reopen =
    .label = Reopen reader tab when navigating back/forward
pref-reader-auto-reopen-desc = When enabled, if the reader tab was closed, it will be reopened automatically when using Back or Forward navigation.

pref-ai = AI
pref-ai-desc = Configure AI summary and library Q&A behavior. API keys are managed in the AI dialog.

pref-ai-summary-title = Summary
pref-ai-output-language-label = Output language:
pref-ai-output-language-auto =
    .label = Auto
pref-ai-output-language-en =
    .label = English
pref-ai-output-language-zh =
    .label = Chinese (zh-CN)

pref-ai-style-label = Style:
pref-ai-style-academic =
    .label = Academic
pref-ai-style-bullet =
    .label = Bullet points
pref-ai-style-grant-report =
    .label = Grant report
pref-ai-style-slides =
    .label = Slides

pref-ai-citation-format-label = Citation format:
pref-ai-citation-format-latex =
    .label = LaTeX (\\cite{"{"}...{"}"})
pref-ai-citation-format-markdown =
    .label = Markdown ([key](url))
pref-ai-citation-format-inspire-url =
    .label = INSPIRE URL
pref-ai-citation-format-zotero-link =
    .label = Zotero link

pref-ai-max-output-tokens-label = Max output tokens:
pref-ai-max-output-tokens-desc = Higher values produce longer answers but cost more and take longer.
pref-ai-temperature-label = Temperature:
pref-ai-temperature-desc = Stored as percent to support Zotero prefs: 20 = 0.2 (range 0–200 → 0.00–2.00).
pref-ai-max-refs-label = Max references:
pref-ai-max-refs-desc = Number of references sampled from the References list.
pref-ai-abstract-char-limit-label = Abstract char limit:
pref-ai-abstract-char-limit-desc = Truncate each abstract to this many characters before sending to the model.

pref-ai-include-seed-abstract =
    .label = Include seed abstract
pref-ai-include-ref-abstracts =
    .label = Include reference abstracts
pref-ai-streaming =
    .label = Stream output (when supported)

pref-ai-cache-enable =
    .label = Cache AI outputs locally
pref-ai-cache-enable-desc = Uses the Local Cache storage; API keys are never stored.
pref-ai-cache-ttl-label = Cache TTL:
pref-ai-cache-ttl-desc = How long to keep cached AI outputs before expiring.

pref-ai-autopilot-title = AutoPilot
pref-ai-autopilot-rpm-label = Requests per minute:
pref-ai-autopilot-rpm-desc = Throttle batch generation to avoid rate limits and high costs.
pref-ai-autopilot-max-items-label = Max items per run:
pref-ai-autopilot-max-items-desc = Safety cap for batch generation.

pref-ai-library-qa-title = Library Q&A
pref-ai-library-qa-scope-label = Scope:
pref-ai-library-qa-scope-current-item =
    .label = Current item
pref-ai-library-qa-scope-current-collection =
    .label = Current collection
pref-ai-library-qa-scope-library =
    .label = My library
pref-ai-library-qa-include-titles =
    .label = Titles
pref-ai-library-qa-include-abstracts =
    .label = Abstracts
pref-ai-library-qa-include-notes =
    .label = My notes
pref-ai-library-qa-include-fulltext-snippets =
    .label = Fulltext snippets
pref-ai-library-qa-top-k-label = Top K items:
pref-ai-library-qa-top-k-desc = How many items to include in the context (max 30).
pref-ai-library-qa-snippets-per-item-label = Snippets per item:
pref-ai-library-qa-snippets-per-item-desc = How many text snippets to include per item (max 3).
pref-ai-library-qa-snippet-chars-label = Snippet size:
pref-ai-library-qa-snippet-chars-desc = Character limit per snippet.

pref-nofound-enable =
    .label = Add tag to items without INSPIRE record
pref-nofound-tag-label = Tag name:

pref-local-cache = Local Cache
pref-local-cache-enable =
    .label = Enable local cache for offline access
pref-local-cache-enable-desc = Cache references and cited-by data to disk. Speeds up loading and enables offline browsing.
pref-local-cache-show-source =
    .label = Show cache source indicator in panel
pref-local-cache-ttl-label = Cache expiry (cited-by data):
pref-local-cache-ttl-unit = hours
pref-local-cache-ttl-desc = How long to keep cited-by and author papers data. References are cached permanently.
pref-local-cache-dir-label = Storage location:
pref-local-cache-dir-browse =
    .label = Browse...
pref-local-cache-dir-reset =
    .label = Reset
pref-local-cache-dir-desc = Leave empty to use default location (Zotero Data Directory). Custom directory will NOT sync with Zotero.
pref-local-cache-compression =
    .label = Compress cache files (gzip)
pref-local-cache-compression-desc = Reduces disk usage by ~80% for large cache files. Recommended for users with many references.
pref-local-cache-enrich-title = Metadata enrichment
pref-local-cache-enrich-desc = Controls how many INSPIRE records are fetched in parallel when completing reference metadata.
pref-local-cache-enrich-batch-label = Batch size:
pref-local-cache-enrich-parallel-label = Parallel requests:
pref-local-cache-enrich-hint = Larger values are faster but may trigger INSPIRE errors (HTTP 502/400). Allowed range: 25–110 entries, 1–5 requests.
pref-local-cache-enrich-info = Current: { $batch } entries / { $parallel } requests. Defaults: { $defaultBatch } entries / { $defaultParallel } requests.
pref-local-cache-clear =
    .label = Clear Cache
pref-local-cache-cleared = Cache cleared ({ $count } files)
pref-local-cache-stats = { $count } files, { $size }

pref-smart-update = Smart Update
pref-smart-update-enable =
    .label = Enable smart update mode
pref-smart-update-enable-desc = Only update fields that have changed. Preserves user edits and shows a preview before updating.
pref-smart-update-preview =
    .label = Show preview dialog before updating
pref-smart-update-preview-desc = Review detected changes and choose which fields to update.
pref-smart-update-auto-check =
    .label = Auto-check for updates when item is selected
pref-smart-update-auto-check-desc = Automatically check INSPIRE for new metadata when you select an item. Shows update notification if changes are found.
pref-smart-update-protect-title = Protected fields
pref-smart-update-protect-desc = Skip these fields if you have already entered data (won't overwrite your edits).
pref-smart-update-protect-field-title =
    .label = Title
pref-smart-update-protect-field-authors =
    .label = Authors
pref-smart-update-protect-field-abstract =
    .label = Abstract
pref-smart-update-protect-field-journal =
    .label = Journal
pref-smart-update-protected-names-title = Protected author names
pref-smart-update-protected-names-desc = Author names in this list will be preserved even when updating. Diacritics (ä, ö, ü, ß, etc.) are auto-detected.
pref-smart-update-protected-names-input =
    .placeholder = e.g., Meißner, Müller, O'Brien

pref-preprint-watch = Preprint Watch
pref-preprint-watch-enable =
    .label = Enable preprint publication monitoring
pref-preprint-watch-enable-desc = Detect unpublished arXiv preprints in your library and check if they have been published.
pref-preprint-watch-startup =
    .label = Check automatically on Zotero startup
pref-preprint-watch-startup-desc = Checks once per day on the first startup. Skips if already checked within the last 24 hours.
pref-preprint-watch-notify =
    .label = Show notification when publications found
pref-preprint-watch-notify-desc = Display a notification when preprints are found to have been published.

pref-collab-tags = Collaboration Tags
pref-collab-tag-enable =
    .label = Enable collaboration tags
pref-collab-tag-enable-desc = Automatically add tags based on INSPIRE collaboration information (e.g., ATLAS, CMS, LHCb).
pref-collab-tag-auto =
    .label = Add tags when updating/importing
pref-collab-tag-auto-desc = Automatically add collaboration tags when items are updated from INSPIRE or imported.
pref-collab-tag-template-label = Tag format:
pref-collab-tag-template-desc = Use {"{name}"} for collaboration name. Examples: {"{name}"}, #collab/{"{name}"}, collab:{"{name}"}

pref-funding-extraction = Funding Extraction
pref-funding-china-only =
    .label = Extract only Chinese funding agencies
pref-funding-china-only-desc = When enabled, only extract funding info from Chinese agencies (NSFC, CAS, MoST, etc.). Disable to extract all funders including DOE, NSF, ERC, etc.

pref-dev = Developer
pref-dev-panel-layout =
    .label = Enable panel layout debug (Citing…)
pref-dev-panel-layout-desc = Logs [PANEL-LAYOUT] lines and shows a "Copy layout" button in the panel header (for debugging).

pref-help = { $name } Build { $version } { $time }
