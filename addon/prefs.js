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
pref("__prefsPrefix__.pdf_fuzzy_citation", false);  // Aggressive citation detection for broken PDF text layers
pref("__prefsPrefix__.pdf_parse_refs_list", false);  // Parse PDF reference list to fix label mapping (for multi-citation references)
pref("__prefsPrefix__.pdf_force_mapping_on_mismatch", true);  // When PDF/INSPIRE reference counts diverge, force PDF mapping and skip index fallback
pref("__prefsPrefix__.quick_filters_last_used", "[]");
// Local cache settings
pref("__prefsPrefix__.local_cache_enable", true);
pref("__prefsPrefix__.local_cache_ttl_hours", 24);
pref("__prefsPrefix__.local_cache_show_source", true);
pref("__prefsPrefix__.local_cache_custom_dir", "");  // Empty = use default (Zotero Data Directory)
pref("__prefsPrefix__.local_cache_compression", true);  // Enable gzip compression for cache files
pref("__prefsPrefix__.local_cache_enrich_batch", 100);  // Entries per metadata batch (25-200 recommended)
pref("__prefsPrefix__.local_cache_enrich_parallel", 4);  // Parallel batch requests (1-5 recommended)
