/* eslint-disable no-undef */
pref("__prefsPrefix__.meta", "full");
pref("__prefsPrefix__.citekey", "inspire");
pref("__prefsPrefix__.tag_norecid", "\u26D4 No INSPIRE recid found");
pref("__prefsPrefix__.tag_enable", false);
pref("__prefsPrefix__.extra_order", "citations_first");
pref("__prefsPrefix__.cites_column_exclude_self", false); // Cites column uses w/o-self citation count
pref("__prefsPrefix__.arxiv_in_journal_abbrev", false); // Legacy: write arXiv ID to Journal Abbreviation
pref("__prefsPrefix__.arxiv_tag_enable", false);
pref("__prefsPrefix__.max_authors", 3);
pref("__prefsPrefix__.reader_auto_reopen", false);
pref("__prefsPrefix__.chart_enable", true);
pref("__prefsPrefix__.chart_default_collapsed", true);
pref("__prefsPrefix__.related_papers_enable", true); // FTR-RELATED-PAPERS: enable Related tab
pref("__prefsPrefix__.related_papers_exclude_reviews", true); // FTR-RELATED-PAPERS: exclude review articles (default on)
pref("__prefsPrefix__.related_papers_max_results", 50); // FTR-RELATED-PAPERS: max related papers to display
pref("__prefsPrefix__.citation_graph_max_results", 25); // FTR-CITATION-GRAPH: max references/cited-by shown per side (global across seeds)
pref("__prefsPrefix__.external_token", ""); // External integrations: connector auth token (generated on first startup)
pref("__prefsPrefix__.latex_render_mode", "katex"); // LaTeX rendering: "unicode" | "katex"
pref("__prefsPrefix__.search_history_days", 30);
pref("__prefsPrefix__.pdf_fuzzy_citation", false); // Aggressive citation detection for broken PDF text layers
pref("__prefsPrefix__.pdf_parse_refs_list", false); // Parse PDF reference list to fix label mapping (for multi-citation references)
pref("__prefsPrefix__.pdf_force_mapping_on_mismatch", true); // When PDF/INSPIRE reference counts diverge, force PDF mapping and skip index fallback
pref("__prefsPrefix__.quick_filters_last_used", "[]");
// AI settings (FTR-AI-SUMMARY / AI tools)
pref("__prefsPrefix__.ai_summary_enable", false);
pref("__prefsPrefix__.ai_summary_provider", "openaiCompatible"); // openaiCompatible | anthropic | gemini
pref("__prefsPrefix__.ai_summary_preset", "openai"); // openai | deepseek | kimi | qwen | zhipu | ollama | lmstudio | custom
pref("__prefsPrefix__.ai_summary_base_url", "https://api.openai.com/v1"); // OpenAI-compatible base URL (or full /chat/completions endpoint)
pref("__prefsPrefix__.ai_summary_model", "gpt-4o-mini");
pref("__prefsPrefix__.ai_summary_temperature", 0.2);
pref("__prefsPrefix__.ai_summary_max_output_tokens", 1200);
pref("__prefsPrefix__.ai_summary_output_language", "auto"); // auto | en | zh-CN
pref("__prefsPrefix__.ai_summary_style", "academic"); // academic | bullet | grant-report | slides
pref("__prefsPrefix__.ai_summary_citation_format", "latex"); // latex | markdown | inspire-url | zotero-link
pref("__prefsPrefix__.ai_summary_include_seed_abstract", false);
pref("__prefsPrefix__.ai_summary_include_abstracts", false);
pref("__prefsPrefix__.ai_summary_max_refs", 40);
pref("__prefsPrefix__.ai_summary_abstract_char_limit", 800);
pref("__prefsPrefix__.ai_summary_cache_ttl_hours", 168); // 7 days
pref("__prefsPrefix__.ai_summary_streaming", true); // Stream responses when supported
pref("__prefsPrefix__.ai_batch_requests_per_minute", 12); // Batch/autopilot throttle
pref("__prefsPrefix__.ai_batch_max_items", 50); // Safety cap
pref("__prefsPrefix__.ai_profiles", "[]"); // JSON array of AI profiles (provider/baseURL/model; no API keys)
pref("__prefsPrefix__.ai_active_profile_id", ""); // Active profile id (empty = use first/default)
pref("__prefsPrefix__.ai_prompt_templates", "[]"); // JSON array of user-defined prompt templates/buttons
// Developer/debug toggles
pref("__prefsPrefix__.debug_panel_layout", false); // Enable panel layout debug logs/UI
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
// Funding extraction settings (FTR-FUNDING-EXTRACTION)
pref("__prefsPrefix__.funding_china_only", true); // Only extract Chinese funding agencies (NSFC, CAS, MoST, etc.)
// Favorite authors (FTR-FAVORITE-AUTHORS)
pref("__prefsPrefix__.favorite_authors", "[]"); // JSON array of FavoriteAuthor objects
// Favorite papers (FTR-FAVORITE-PAPERS)
pref("__prefsPrefix__.favorite_papers", "[]"); // JSON array of FavoritePaper objects
// Favorite presentations (FTR-FAVORITE-PRESENTATIONS)
pref("__prefsPrefix__.favorite_presentations", "[]"); // JSON array of FavoritePresentation objects
