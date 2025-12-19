/* eslint-disable no-undef */
pref("__prefsPrefix__.meta", "full");
pref("__prefsPrefix__.citekey", "inspire");
pref("__prefsPrefix__.tag_norecid", "\u26D4 No INSPIRE recid found");
pref("__prefsPrefix__.tag_enable", false);
pref("__prefsPrefix__.extra_order", "citations_first");
pref("__prefsPrefix__.arxiv_tag_enable", false);
pref("__prefsPrefix__.max_authors", 3);
pref("__prefsPrefix__.reader_auto_reopen", false);
pref("__prefsPrefix__.chart_enable", true);
pref("__prefsPrefix__.chart_default_collapsed", true);
pref("__prefsPrefix__.search_history_days", 30);
pref("__prefsPrefix__.pdf_fuzzy_citation", false); // Aggressive citation detection for broken PDF text layers
pref("__prefsPrefix__.pdf_parse_refs_list", false); // Parse PDF reference list to fix label mapping (for multi-citation references)
pref("__prefsPrefix__.pdf_force_mapping_on_mismatch", true); // When PDF/INSPIRE reference counts diverge, force PDF mapping and skip index fallback
pref("__prefsPrefix__.quick_filters_last_used", "[]");
// Local cache settings
pref("__prefsPrefix__.local_cache_enable", true);
pref("__prefsPrefix__.local_cache_ttl_hours", 24);
pref("__prefsPrefix__.local_cache_show_source", true);
pref("__prefsPrefix__.local_cache_custom_dir", ""); // Empty = use default (Zotero Data Directory)
pref("__prefsPrefix__.local_cache_compression", true); // Enable gzip compression for cache files
pref("__prefsPrefix__.local_cache_enrich_batch", 100); // Entries per metadata batch (25-200 recommended)
pref("__prefsPrefix__.local_cache_enrich_parallel", 4); // Parallel batch requests (1-5 recommended)
// Smart update settings (FTR-SMART-UPDATE)
pref("__prefsPrefix__.smart_update_enable", false); // Enable smart/incremental update mode
pref("__prefsPrefix__.smart_update_show_preview", true); // Show preview dialog before updating
pref("__prefsPrefix__.smart_update_auto_check", false); // Auto-check for updates when item is selected
pref("__prefsPrefix__.smart_update_protect_title", true); // Protect user-edited title
pref("__prefsPrefix__.smart_update_protect_authors", true); // Protect user-edited authors
pref("__prefsPrefix__.smart_update_protect_abstract", false); // Protect user-edited abstract
pref("__prefsPrefix__.smart_update_protect_journal", false); // Protect user-edited journal
pref("__prefsPrefix__.smart_update_protected_names", ""); // Comma-separated list of protected author names (e.g., "Meißner, Müller")
// Preprint watch settings (FTR-PREPRINT-WATCH)
pref("__prefsPrefix__.preprint_watch_enabled", true); // Enable preprint publication monitoring
pref("__prefsPrefix__.preprint_watch_auto_check", "never"); // Auto-check timing: "startup" | "daily" | "never"
pref("__prefsPrefix__.preprint_watch_last_check", 0); // Last check timestamp
pref("__prefsPrefix__.preprint_watch_notify", true); // Show notification when publications found
// Collaboration tag settings (FTR-COLLAB-TAGS)
pref("__prefsPrefix__.collab_tag_enable", false); // Enable collaboration tagging
pref("__prefsPrefix__.collab_tag_auto", false); // Auto-add tags when updating/importing
pref("__prefsPrefix__.collab_tag_template", "{name}"); // Tag format template ({name} = collaboration name)
