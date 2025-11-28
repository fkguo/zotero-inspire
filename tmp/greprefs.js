//@line 2 "$SRCDIR/modules/libpref/greprefs.js"
//@line 1 "$SRCDIR/modules/libpref/init/all.js"
pref("security.tls.insecure_fallback_hosts", "");
pref("security.default_personal_cert",   "Ask Every Time");
pref("security.signed_app_signatures.policy", 2);
pref("security.pki.mitm_canary_issuer", "");
pref("security.pki.mitm_canary_issuer.enabled", true);
pref("security.pki.mitm_detected", false);
pref("security.remote_settings.intermediates.enabled", true);
pref("security.remote_settings.intermediates.downloads_per_poll", 5000);
pref("security.remote_settings.intermediates.parallel_downloads", 8);
//@line 60 "$SRCDIR/modules/libpref/init/all.js"
  pref("security.remote_settings.crlite_filters.enabled", true);
//@line 64 "$SRCDIR/modules/libpref/init/all.js"
pref("security.osreauthenticator.blank_password", false);
pref("security.osreauthenticator.password_last_changed_lo", 0);
pref("security.osreauthenticator.password_last_changed_hi", 0);
pref("security.crash_tracking.js_load_1.prevCrashes", 0);
pref("security.crash_tracking.js_load_1.maxCrashes", 1);
pref("general.useragent.compatMode.firefox", false);
pref("general.config.obscure_value", 13); // for MCD .cfg files
//@line 79 "$SRCDIR/modules/libpref/init/all.js"
pref("general.autoscroll.prevent_to_start.shiftKey", true); // Shift
pref("general.autoscroll.prevent_to_start.ctrlKey", false); // Control
pref("general.autoscroll.prevent_to_start.altKey", false);  // Alt
pref("general.autoscroll.prevent_to_start.metaKey", false);
pref("general.autoscroll.prevent_to_collapse_selection_by_middle_mouse_down", false);
pref("browser.bookmarks.max_backups",       5);
pref("browser.cache.disk_cache_ssl",        true);
pref("browser.cache.frecency_half_life_hours", 6);
pref("browser.download.forbid_open_with", false);
pref("dom.indexedDB.logging.enabled", true);
pref("dom.indexedDB.logging.details", true);
pref("dom.indexedDB.logging.profiler-marks", false);
pref("dom.workers.maxPerDomain", 512);
pref("dom.serviceWorkers.idle_timeout", 30000);
pref("dom.serviceWorkers.idle_extended_timeout", 30000);
pref("dom.serviceWorkers.update_delay", 1000);
pref("dom.serviceWorkers.testUpdateOverOneDay", false);
pref("dom.keyboardevent.keypress.hack.dispatch_non_printable_keys", "www.icloud.com");
pref("dom.keyboardevent.keypress.hack.dispatch_non_printable_keys.addl", "");
pref("dom.keyboardevent.keypress.hack.use_legacy_keycode_and_charcode", "*.collabserv.com,*.gov.online.office365.us,*.officeapps-df.live.com,*.officeapps.live.com,*.online.office.de,*.partner.officewebapps.cn,*.scniris.com");
pref("dom.keyboardevent.keypress.hack.use_legacy_keycode_and_charcode.addl", "");
pref("dom.text-recognition.enabled", true);
pref("browser.sessionhistory.max_total_viewers", -1);
pref("browser.send_pings", false);
pref("browser.send_pings.max_per_link", 1);           // limit the number of pings that are sent per link click
pref("browser.send_pings.require_same_host", false);  // only send pings to the same host if this is true
pref("browser.helperApps.neverAsk.saveToDisk", "");
pref("browser.helperApps.neverAsk.openFile", "");
pref("browser.helperApps.deleteTempFileOnExit", false);
pref("browser.triple_click_selects_paragraph", true);
pref("mathml.disabled",    false);
pref("mathml.scale_stretchy_operators.enabled", true);
pref("media.throttle-factor", 2);
pref("media.volume_scale", "1.0");
pref("media.play-stand-alone", true);
//@line 196 "$SRCDIR/modules/libpref/init/all.js"
pref("media.gmp.storage.version.expected", 1);
//@line 209 "$SRCDIR/modules/libpref/init/all.js"
  pref("media.decoder-doctor.notifications-allowed", "MediaWMFNeeded,MediaWidevineNoWMF,MediaCannotInitializePulseAudio,MediaCannotPlayNoDecoders,MediaUnsupportedLibavcodec,MediaPlatformDecoderNotFound");
//@line 211 "$SRCDIR/modules/libpref/init/all.js"
pref("media.decoder-doctor.decode-errors-allowed", "");
pref("media.decoder-doctor.decode-warnings-allowed", "");
pref("media.decoder-doctor.verbose", false);
pref("media.decoder-doctor.new-issue-endpoint", "https://webcompat.com/issues/new");
pref("media.videocontrols.picture-in-picture.enabled", false);
pref("media.videocontrols.picture-in-picture.display-text-tracks.enabled", true);
pref("media.videocontrols.picture-in-picture.video-toggle.enabled", false);
pref("media.videocontrols.picture-in-picture.video-toggle.always-show", false);
pref("media.videocontrols.picture-in-picture.video-toggle.min-video-secs", 45);
pref("media.videocontrols.picture-in-picture.video-toggle.position", "right");
pref("media.videocontrols.picture-in-picture.video-toggle.has-used", false);
pref("media.videocontrols.picture-in-picture.display-text-tracks.toggle.enabled", true);
pref("media.videocontrols.picture-in-picture.display-text-tracks.size", "medium");
pref("media.videocontrols.picture-in-picture.improved-video-controls.enabled", true);
pref("media.videocontrols.picture-in-picture.respect-disablePictureInPicture", true);
pref("media.videocontrols.keyboard-tab-to-all-controls", true);
//@line 232 "$SRCDIR/modules/libpref/init/all.js"
  pref("media.navigator.video.enabled", true);
  pref("media.navigator.video.default_fps",30);
  pref("media.navigator.video.use_remb", true);
  pref("media.navigator.video.use_transport_cc", true);
  pref("media.peerconnection.video.use_rtx", true);
  pref("media.peerconnection.video.use_rtx.blocklist", "doxy.me,*.doxy.me");
  pref("media.peerconnection.sdp.quirk.duplicate_fingerprint.allowlist", "");
  pref("media.navigator.video.use_tmmbr", false);
  pref("media.navigator.audio.use_fec", true);
  pref("media.navigator.video.offer_rtcp_rsize", true);
//@line 249 "$SRCDIR/modules/libpref/init/all.js"
    pref("media.peerconnection.sdp.parser", "sipcc");
    pref("media.peerconnection.sdp.alternate_parse_mode", "never");
    pref("media.peerconnection.sdp.strict_success", false);
    pref("media.navigator.video.red_ulpfec_enabled", true);
//@line 254 "$SRCDIR/modules/libpref/init/all.js"
  pref("media.peerconnection.sdp.disable_stereo_fmtp", false);
  pref("media.webrtc.debug.log_file", "");
  pref("media.navigator.video.default_width",0);  // adaptive default
  pref("media.navigator.video.default_height",0); // adaptive default
  pref("media.navigator.video.max_fs", 12288); // Enough for 2048x1536
  pref("media.navigator.video.max_fr", 60);
  pref("media.navigator.video.disable_h264_baseline", false);
  pref("media.navigator.video.h264.level", 31); // 0x42E01f - level 3.1
  pref("media.navigator.video.h264.max_br", 0);
  pref("media.navigator.video.h264.max_mbps", 0);
  pref("media.peerconnection.video.vp9_enabled", true);
  pref("media.peerconnection.video.vp9_preferred", false);
  pref("media.getusermedia.audio.max_channels", 0);
//@line 273 "$SRCDIR/modules/libpref/init/all.js"
    pref("media.getusermedia.camera.off_while_disabled.enabled", true);
    pref("media.getusermedia.microphone.off_while_disabled.enabled", false);
//@line 276 "$SRCDIR/modules/libpref/init/all.js"
  pref("media.getusermedia.camera.off_while_disabled.delay_ms", 3000);
  pref("media.getusermedia.microphone.off_while_disabled.delay_ms", 3000);
  pref("media.peerconnection.video.min_bitrate", 0);
  pref("media.peerconnection.video.start_bitrate", 0);
  pref("media.peerconnection.video.max_bitrate", 0);
  pref("media.peerconnection.video.min_bitrate_estimate", 0);
  pref("media.peerconnection.video.denoising", false);
  pref("media.navigator.audio.fake_frequency", 1000);
  pref("media.navigator.permission.disabled", false);
  pref("media.navigator.streams.fake", false);
  pref("media.peerconnection.default_iceservers", "[]");
  pref("media.peerconnection.allow_old_setParameters", true);
  pref("media.peerconnection.ice.loopback", false); // Set only for testing in offline environments.
  pref("media.peerconnection.ice.tcp", true);
  pref("media.peerconnection.ice.tcp_so_sock_count", 0); // Disable SO gathering
  pref("media.peerconnection.ice.link_local", false); // Set only for testing IPV6 in networks that don't assign IPV6 addresses
  pref("media.peerconnection.ice.force_interface", ""); // Limit to only a single interface
  pref("media.peerconnection.ice.relay_only", false); // Limit candidates to TURN
  pref("media.peerconnection.use_document_iceservers", true);
  pref("media.peerconnection.identity.timeout", 10000);
  pref("media.peerconnection.ice.stun_client_maximum_transmits", 7);
  pref("media.peerconnection.ice.trickle_grace_period", 5000);
  pref("media.peerconnection.ice.no_host", false);
  pref("media.peerconnection.ice.default_address_only", false);
//@line 307 "$SRCDIR/modules/libpref/init/all.js"
    pref("media.peerconnection.ice.obfuscate_host_addresses", true);
//@line 309 "$SRCDIR/modules/libpref/init/all.js"
  pref("media.peerconnection.ice.obfuscate_host_addresses.blocklist", "");
  pref("media.peerconnection.ice.proxy_only_if_behind_proxy", false);
  pref("media.peerconnection.ice.proxy_only", false);
  pref("media.peerconnection.ice.proxy_only_if_pbmode", false);
  pref("media.peerconnection.turn.disable", false);
  pref("media.peerconnection.treat_warnings_as_errors", false);
//@line 318 "$SRCDIR/modules/libpref/init/all.js"
    pref("media.peerconnection.description.legacy.enabled", true);
//@line 320 "$SRCDIR/modules/libpref/init/all.js"
  pref("media.peerconnection.dtls.version.min", 771);
  pref("media.peerconnection.dtls.version.max", 772);
//@line 326 "$SRCDIR/modules/libpref/init/all.js"
  pref("media.getusermedia.audio.processing.platform.enabled", true);
//@line 330 "$SRCDIR/modules/libpref/init/all.js"
  pref("media.getusermedia.audio.processing.aec.enabled", true);
  pref("media.getusermedia.audio.processing.aec", 1); // kModerateSuppression
  pref("media.getusermedia.audio.processing.aec.mobile", false);
  pref("media.getusermedia.audio.processing.noise.enabled", true);
  pref("media.getusermedia.audio.processing.noise", 2); // kHigh
  pref("media.getusermedia.audio.processing.agc.enabled", true);
  pref("media.getusermedia.audio.processing.agc", 1); // kAdaptiveDigital
  pref("media.getusermedia.audio.processing.agc2.forced", true);
  pref("media.getusermedia.audio.processing.hpf.enabled", true);
  pref("media.getusermedia.audio.processing.transient.enabled", true);
//@line 343 "$SRCDIR/modules/libpref/init/all.js"
//@line 345 "$SRCDIR/modules/libpref/init/all.js"
  pref("media.getusermedia.screensharing.enabled", true);
//@line 347 "$SRCDIR/modules/libpref/init/all.js"
pref("media.getusermedia.audio.capture.enabled", false);
pref("media.webvtt.debug.logging", false);
pref("media.recorder.audio_node.enabled", false);
pref("media.recorder.video.frame_drops", true);
pref("media.video-queue.default-size", 10);
pref("media.video-queue.send-to-compositor-size", 9999);
pref("media.cubeb.output_voice_routing", true);
pref("apz.overscroll.stop_velocity_threshold", "0.01");
pref("apz.overscroll.stretch_factor", "0.35");
pref("apz.zoom-to-focused-input.enabled", true);
pref("formhelper.autozoom.force-disable.test-only", false);
//@line 380 "$SRCDIR/modules/libpref/init/all.js"
  pref("gfx.hidpi.enabled", 2);
//@line 388 "$SRCDIR/modules/libpref/init/all.js"
pref("gfx.downloadable_fonts.enabled", true);
pref("gfx.downloadable_fonts.fallback_delay", 3000);
pref("gfx.downloadable_fonts.fallback_delay_short", 100);
//@line 396 "$SRCDIR/modules/libpref/init/all.js"
//@line 402 "$SRCDIR/modules/libpref/init/all.js"
  pref("gfx.canvas.azure.backends", "skia");
//@line 406 "$SRCDIR/modules/libpref/init/all.js"
pref("gfx.content.azure.backends", "skia");
//@line 413 "$SRCDIR/modules/libpref/init/all.js"
pref("gfx.webrender.debug.texture-cache", false);
pref("gfx.webrender.debug.texture-cache.clear-evicted", true);
pref("gfx.webrender.debug.render-targets", false);
pref("gfx.webrender.debug.gpu-cache", false);
pref("gfx.webrender.debug.alpha-primitives", false);
pref("gfx.webrender.debug.profiler", false);
pref("gfx.webrender.debug.gpu-time-queries", false);
pref("gfx.webrender.debug.gpu-sample-queries", false);
pref("gfx.webrender.debug.disable-batching", false);
pref("gfx.webrender.debug.epochs", false);
pref("gfx.webrender.debug.echo-driver-messages", false);
pref("gfx.webrender.debug.show-overdraw", false);
pref("gfx.webrender.debug.slow-frame-indicator", false);
pref("gfx.webrender.debug.picture-caching", false);
pref("gfx.webrender.debug.picture-borders", false);
pref("gfx.webrender.debug.force-picture-invalidation", false);
pref("gfx.webrender.debug.primitives", false);
pref("gfx.webrender.debug.small-screen", false);
pref("gfx.webrender.debug.obscure-images", false);
pref("gfx.webrender.debug.glyph-flashing", false);
pref("gfx.webrender.debug.capture-profiler", false);
pref("gfx.webrender.debug.profiler-ui", "Default");
pref("gfx.webrender.debug.window-visibility", false);
pref("gfx.webrender.multithreading", true);
//@line 445 "$SRCDIR/modules/libpref/init/all.js"
pref("gfx.webrender.pbo-uploads", true);
pref("gfx.webrender.batched-texture-uploads", false);
pref("gfx.webrender.draw-calls-for-texture-copy", false);
//@line 449 "$SRCDIR/modules/libpref/init/all.js"
pref("accessibility.warn_on_browsewithcaret", true);
pref("accessibility.browsewithcaret_shortcut.enabled", true);
//@line 461 "$SRCDIR/modules/libpref/init/all.js"
//@line 467 "$SRCDIR/modules/libpref/init/all.js"
pref("ui.textSelectAttentionBackground", "#38d878");
pref("ui.textSelectAttentionForeground", "#ffffff");
pref("ui.textHighlightBackground", "#ef0fff");
pref("ui.textHighlightForeground", "#ffffff");
pref("accessibility.force_disabled", 0);
pref("focusmanager.testmode", false);
pref("accessibility.typeaheadfind", true);
pref("accessibility.typeaheadfind.manual", true);
pref("accessibility.typeaheadfind.casesensitive", 0);
pref("accessibility.typeaheadfind.linksonly", true);
pref("accessibility.typeaheadfind.startlinksonly", false);
pref("accessibility.typeaheadfind.timeout", 4000);
pref("accessibility.typeaheadfind.soundURL", "beep");
pref("accessibility.typeaheadfind.wrappedSoundURL", "");
pref("accessibility.typeaheadfind.enablesound", true);
//@line 514 "$SRCDIR/modules/libpref/init/all.js"
  pref("accessibility.typeaheadfind.prefillwithselection", false);
//@line 518 "$SRCDIR/modules/libpref/init/all.js"
pref("accessibility.typeaheadfind.matchesCountLimit", 1000);
pref("findbar.highlightAll", false);
pref("findbar.entireword", false);
pref("findbar.iteratorTimeout", 100);
pref("findbar.matchdiacritics", 0);
pref("findbar.modalHighlight", false);
pref("gfx.use_text_smoothing_setting", false);
pref("toolkit.autocomplete.richBoundaryCutoff", 200);
pref("toolkit.scrollbox.scrollIncrement", 20);
pref("toolkit.scrollbox.clickToScroll.scrollDelay", 150);
pref("toolkit.shopping.ohttpConfigURL", "https://prod.ohttp-gateway.prod.webservices.mozgcp.net/ohttp-configs");
pref("toolkit.shopping.ohttpRelayURL", "https://mozilla-ohttp.fastly-edge.com/");
pref("toolkit.sqlitejsm.loglevel", "Error");
pref("toolkit.tabbox.switchByScrolling", false);
pref("toolkit.telemetry.server", "");
pref("toolkit.telemetry.server_owner", "Mozilla");
pref("toolkit.telemetry.debugSlowSql", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.dap_enabled", false);
pref("toolkit.telemetry.dap.logLevel", "Warn");
pref("toolkit.telemetry.dap_task1_enabled", false);
pref("toolkit.telemetry.dap_task1_taskid", "");
pref("toolkit.telemetry.dap_visit_counting_enabled", false);
pref("toolkit.telemetry.dap_visit_counting_experiment_list", "[]");
pref("toolkit.telemetry.dap.leader.url", "https://dap-09-3.api.divviup.org");
pref("toolkit.telemetry.dap.leader.hpke", "ACkAACAAAQABACDk8wgwe2-TqHyaL74uqjVWMcF1zi9pxiwQhu4aPwncYw");
pref("toolkit.telemetry.dap.helper.url", "https://dap.services.mozilla.com");
pref("toolkit.telemetry.dap.helper.hpke", "ACkAACAAAQABACAucqWdIQRN6BxumPBRXIlg2JsxcznwWX7vyqzM3cjuQA");
pref("toolkit.telemetry.translations.logLevel", "Error");
pref("toolkit.telemetry.user_characteristics_ping.current_version", 0);
pref("toolkit.telemetry.user_characteristics_ping.last_version_sent", 0);
pref("toolkit.telemetry.user_characteristics_ping.opt-out", false);
pref("toolkit.telemetry.user_characteristics_ping.send-once", false);
pref("toolkit.telemetry.user_characteristics_ping.uuid", "");
pref("toolkit.telemetry.user_characteristics_ping.logLevel", "Warn");
//@line 608 "$SRCDIR/modules/libpref/init/all.js"
  pref("toolkit.asyncshutdown.crash_timeout", 60000); // 1 minute
//@line 610 "$SRCDIR/modules/libpref/init/all.js"
pref("toolkit.asyncshutdown.log", false);
//@line 619 "$SRCDIR/modules/libpref/init/all.js"
  pref("browser.dom.window.dump.enabled", false, sticky);
  pref("devtools.console.stdout.chrome", false, sticky);
//@line 625 "$SRCDIR/modules/libpref/init/all.js"
pref("devtools.console.stdout.content", false, sticky);
pref("toolkit.dump.emit", false);
pref("devtools.performance.recording.ui-base-url", "https://profiler.firefox.com");
pref("devtools.performance.recording.child.timeout_s", 15);
//@line 649 "$SRCDIR/modules/libpref/init/all.js"
  pref("devtools.performance.popup.feature-flag", false);
//@line 651 "$SRCDIR/modules/libpref/init/all.js"
//@line 658 "$SRCDIR/modules/libpref/init/all.js"
  pref("devtools.performance.recording.preset", "web-developer");
  pref("devtools.performance.recording.preset.remote", "web-developer");
//@line 661 "$SRCDIR/modules/libpref/init/all.js"
pref("devtools.performance.recording.active-tab-view.enabled", false);
pref("devtools.performance.recording.entries", 10000000);
pref("devtools.performance.recording.entries.remote", 10000000);
pref("devtools.performance.recording.interval", 1000);
pref("devtools.performance.recording.interval.remote", 1000);
pref("devtools.performance.recording.duration", 0);
pref("devtools.performance.recording.duration.remote", 0);
pref("devtools.performance.recording.features", "[\"js\",\"stackwalk\",\"cpu\",\"screenshots\",\"memory\"]");
pref("devtools.performance.recording.features.remote", "[\"js\",\"stackwalk\",\"cpu\",\"screenshots\",\"memory\",\"java\"]");
pref("devtools.performance.recording.threads", "[\"GeckoMain\",\"Compositor\",\"Renderer\"]");
pref("devtools.performance.recording.threads.remote", "[\"GeckoMain\",\"Compositor\",\"Renderer\"]");
pref("devtools.performance.recording.objdirs", "[]");
pref("devtools.performance.recording.power.external-url", "");
pref("devtools.performance.recording.markers.external-url", "");
pref("devtools.performance.popup.intro-displayed", false);
//@line 698 "$SRCDIR/modules/libpref/init/all.js"
  pref("devtools.performance.aboutprofiling.has-developer-options", false);
//@line 700 "$SRCDIR/modules/libpref/init/all.js"
pref("devtools.inspector.compatibility.target-browsers", "");
pref("view_source.editor.path", "");
pref("view_source.editor.args", "");
pref("nglayout.enable_drag_images", true);
pref("browser.fixup.alternate.prefix", "www.");
pref("browser.fixup.alternate.protocol", "https");
pref("browser.fixup.alternate.suffix", ".com");
pref("browser.fixup.fallback-to-https", true);
pref("print.shrink-to-fit.scale-limit-percent", 20);
pref("print.show_page_setup_menu", false);
pref("print.print_headerleft", "&T");
pref("print.print_headercenter", "");
pref("print.print_headerright", "&U");
pref("print.print_footerleft", "&PT");
pref("print.print_footercenter", "");
pref("print.print_footerright", "&D");
pref("print.cups.monochrome.extra_settings", "");
pref("print.save_print_settings", true);
pref("print.more-settings.open", false);
pref("print.print_edge_top", 0);
pref("print.print_edge_left", 0);
pref("print.print_edge_right", 0);
pref("print.print_edge_bottom", 0);
//@line 782 "$SRCDIR/modules/libpref/init/all.js"
pref("dom.beforeunload_timeout_ms",         1000);
pref("dom.disable_window_flip",             false);
pref("dom.disable_window_move_resize",      false);
pref("dom.allow_scripts_to_close_windows",          false);
pref("dom.mutation_events.forceEnable", "");
pref("dom.popup_allowed_events", "change click dblclick auxclick mousedown mouseup pointerdown pointerup notificationclick reset submit touchend contextmenu");
pref("dom.storage.shadow_writes", false);
pref("dom.storage.snapshot_prefill", 16384);
pref("dom.storage.snapshot_gradual_prefill", 4096);
pref("dom.storage.snapshot_reusing", true);
pref("dom.storage.client_validation", true);
pref("dom.forms.datetime.timepicker", false);
pref("dom.forms.selectSearch", false);
//@line 814 "$SRCDIR/modules/libpref/init/all.js"
  pref("dom.forms.select.customstyling", false);
//@line 818 "$SRCDIR/modules/libpref/init/all.js"
pref("dom.cycle_collector.incremental", true);
pref("privacy.resistFingerprinting.exemptedDomains", "*.example.invalid");
pref("privacy.fingerprintingProtection.overrides", "");
pref("privacy.fingerprintingProtection.granularOverrides", "");
pref("privacy.baselineFingerprintingProtection.overrides", "");
pref("privacy.baselineFingerprintingProtection.granularOverrides", "");
pref("privacy.restrict3rdpartystorage.partitionedHosts", "accounts.google.com/o/oauth2/,d35nw2lg0ahg0v.cloudfront.net/,datastudio.google.com/embed/reporting/,d3qlaywcwingl6.cloudfront.net/");
pref("privacy.restrict3rdpartystorage.userInteractionRequiredForHosts", "");
pref("privacy.restrict3rdpartystorage.url_decorations", "");
pref("privacy.popups.maxReported", 100);
pref("privacy.purge_trackers.enabled", true);
//@line 867 "$SRCDIR/modules/libpref/init/all.js"
  pref("privacy.purge_trackers.logging.level", "Error");
//@line 869 "$SRCDIR/modules/libpref/init/all.js"
pref("privacy.purge_trackers.max_purge_count", 100);
pref("privacy.purge_trackers.consider_entity_list", false);
pref("dom.event.contextmenu.enabled",       true);
pref("javascript.enabled",                  true);
pref("javascript.options.wasm",                   true);
pref("javascript.options.wasm_trustedprincipals", true);
pref("javascript.options.wasm_verbose",           false);
pref("javascript.options.wasm_baselinejit",       true);
pref("javascript.options.asyncstack", true);
pref("javascript.options.asyncstack_capture_debuggee_only", true);
pref("javascript.options.discardSystemSource", false);
pref("javascript.options.mem.max", -1);
pref("javascript.options.mem.nursery.min_kb", 256);
pref("javascript.options.mem.nursery.max_kb", 65536);
pref("javascript.options.mem.gc_per_zone", true);
pref("javascript.options.mem.gc_incremental", true);
pref("javascript.options.mem.incremental_weakmap", true);
pref("javascript.options.mem.gc_incremental_slice_ms", 5);
pref("javascript.options.mem.gc_compacting", true);
pref("javascript.options.mem.gc_generational", true);
//@line 932 "$SRCDIR/modules/libpref/init/all.js"
//@line 936 "$SRCDIR/modules/libpref/init/all.js"
pref("javascript.options.mem.gc_parallel_marking", true);
//@line 940 "$SRCDIR/modules/libpref/init/all.js"
//@line 946 "$SRCDIR/modules/libpref/init/all.js"
pref("javascript.options.mem.gc_parallel_marking_threshold_mb", 4);
//@line 952 "$SRCDIR/modules/libpref/init/all.js"
pref("javascript.options.mem.gc_max_parallel_marking_threads", 2);
pref("javascript.options.mem.gc_high_frequency_time_limit_ms", 1000);
pref("javascript.options.mem.gc_small_heap_size_max_mb", 100);
pref("javascript.options.mem.gc_large_heap_size_min_mb", 500);
pref("javascript.options.mem.gc_high_frequency_small_heap_growth", 300);
pref("javascript.options.mem.gc_high_frequency_large_heap_growth", 150);
pref("javascript.options.mem.gc_low_frequency_heap_growth", 150);
pref("javascript.options.mem.gc_balanced_heap_limits", false);
pref("javascript.options.mem.gc_heap_growth_factor", 50);
pref("javascript.options.mem.gc_allocation_threshold_mb", 27);
pref("javascript.options.mem.gc_malloc_threshold_base_mb", 38);
pref("javascript.options.mem.gc_small_heap_incremental_limit", 150);
pref("javascript.options.mem.gc_large_heap_incremental_limit", 110);
pref("javascript.options.mem.gc_urgent_threshold_mb", 16);
pref("javascript.options.mem.gc_min_empty_chunk_count", 1);
pref("javascript.options.mem.gc_helper_thread_ratio", 50);
pref("javascript.options.mem.gc_max_helper_threads", 8);
pref("javascript.options.mem.nursery_eager_collection_threshold_kb", 256);
pref("javascript.options.mem.nursery_eager_collection_threshold_percent", 25);
pref("javascript.options.mem.nursery_eager_collection_timeout_ms", 5000);
pref("javascript.options.mem.nursery_max_time_goal_ms", 4);
//@line 1019 "$SRCDIR/modules/libpref/init/all.js"
pref("javascript.options.shared_memory", true);
pref("javascript.options.throw_on_debuggee_would_run", false);
pref("javascript.options.dump_stack_on_debuggee_would_run", false);
pref("image.animation_mode",                "normal");
pref("network.tickle-wifi.enabled", false);
pref("network.tickle-wifi.duration", 400);
pref("network.tickle-wifi.delay", 16);
pref("network.protocol-handler.external-default", true);      // OK to load
pref("network.protocol-handler.warn-external-default", true); // warn before load
pref("network.protocol-handler.external.hcp", false);
pref("network.protocol-handler.external.vbscript", false);
pref("network.protocol-handler.external.javascript", false);
pref("network.protocol-handler.external.data", false);
pref("network.protocol-handler.external.ie.http", false);
pref("network.protocol-handler.external.iehistory", false);
pref("network.protocol-handler.external.ierss", false);
pref("network.protocol-handler.external.mk", false);
pref("network.protocol-handler.external.ms-cxh", false);
pref("network.protocol-handler.external.ms-cxh-full", false);
pref("network.protocol-handler.external.ms-help", false);
pref("network.protocol-handler.external.ms-msdt", false);
pref("network.protocol-handler.external.res", false);
pref("network.protocol-handler.external.search", false);
pref("network.protocol-handler.external.search-ms", false);
pref("network.protocol-handler.external.shell", false);
pref("network.protocol-handler.external.vnd.ms.radio", false);
//@line 1065 "$SRCDIR/modules/libpref/init/all.js"
  pref("network.protocol-handler.external.help", false);
//@line 1067 "$SRCDIR/modules/libpref/init/all.js"
pref("network.protocol-handler.external.disk", false);
pref("network.protocol-handler.external.disks", false);
pref("network.protocol-handler.external.afp", false);
pref("network.protocol-handler.external.moz-icon", false);
pref("network.protocol-handler.external.ttp", false);  // http
pref("network.protocol-handler.external.htp", false);  // http
pref("network.protocol-handler.external.ttps", false); // https
pref("network.protocol-handler.external.tps", false);  // https
pref("network.protocol-handler.external.ps", false);   // https
pref("network.protocol-handler.external.htps", false); // https
pref("network.protocol-handler.external.ile", false);  // file
pref("network.protocol-handler.external.le", false);   // file
pref("network.protocol-handler.expose-all", true);
pref("network.manage-offline-status", true);
pref("network.http.version", "1.1");      // default
pref("network.http.proxy.version", "1.1");    // default
pref("network.http.proxy.respect-be-conservative", true);
pref("network.http.default-socket-type", "");
pref("network.http.keep-alive.timeout", 115);
pref("network.http.response.timeout", 300);
//@line 1137 "$SRCDIR/modules/libpref/init/all.js"
  pref("network.http.max-connections", 900);
//@line 1139 "$SRCDIR/modules/libpref/init/all.js"
pref("network.http.max-persistent-connections-per-server", 6);
pref("network.http.max-urgent-start-excessive-connections-per-host", 3);
pref("network.http.max-persistent-connections-per-proxy", 32);
pref("network.http.request.max-start-delay", 10);
pref("network.http.request.max-attempts", 10);
pref("network.http.redirection-limit", 20);
pref("network.http.accept-encoding", "gzip, deflate");
pref("network.http.accept-encoding.secure", "gzip, deflate, br, zstd");
pref("network.http.prompt-temp-redirect", false);
pref("network.http.assoc-req.enforce", false);
pref("network.http.qos", 0);
pref("network.http.connection-retry-timeout", 250);
pref("network.http.connection-timeout", 90);
pref("network.http.tls-handshake-timeout", 30);
pref("network.http.fallback-connection-timeout", 5);
pref("network.http.network-changed.timeout", 5);
//@line 1219 "$SRCDIR/modules/libpref/init/all.js"
  pref("network.http.speculative-parallel-limit", 20);
//@line 1221 "$SRCDIR/modules/libpref/init/all.js"
pref("network.http.rendering-critical-requests-prioritization", true);
pref("network.http.fast-fallback-to-IPv4", true);
pref("network.http.http3.default-qpack-table-size", 65536); // 64k
pref("network.http.http3.default-max-stream-blocked", 20);
pref("network.http.http3.alt-svc-mapping-for-testing", "");
pref("network.http.altsvc.enabled", true);
pref("network.http.altsvc.oe", false);
pref("network.http.diagnostics", false);
pref("network.http.pacing.requests.enabled", true);
pref("network.http.pacing.requests.min-parallelism", 6);
pref("network.http.pacing.requests.hz", 80);
pref("network.http.pacing.requests.burst", 10);
pref("network.http.tcp_keepalive.short_lived_connections", true);
pref("network.http.tcp_keepalive.short_lived_time", 60);
pref("network.http.tcp_keepalive.short_lived_idle_time", 10);
pref("network.http.tcp_keepalive.long_lived_connections", true);
pref("network.http.tcp_keepalive.long_lived_idle_time", 600);
pref("network.http.enforce-framing.http1", false); // should be named "strict"
pref("network.http.enforce-framing.soft", true);
pref("network.http.enforce-framing.strict_chunked_encoding", true);
pref("network.http.focused_window_transaction_ratio", "0.9");
pref("network.http.send_window_size", 1024);
pref("network.http.accept", "");
pref("network.sts.max_time_for_events_between_two_polls", 100);
pref("network.sts.poll_busy_wait_period", 50);
pref("network.sts.poll_busy_wait_period_timeout", 7);
pref("network.sts.max_time_for_pr_close_during_shutdown", 5000);
pref("network.sts.pollable_event_timeout", 6);
pref("network.websocket.max-message-size", 2147483647);
pref("network.websocket.timeout.open", 20);
pref("network.websocket.timeout.close", 20);
pref("network.websocket.timeout.ping.request", 0);
pref("network.websocket.timeout.ping.response", 10);
pref("network.websocket.max-connections", 200);
pref("network.websocket.allowInsecureFromHTTPS", false);
pref("network.websocket.delay-failed-reconnects", true);
pref("network.prefetch-next", true);
pref("network.negotiate-auth.trusted-uris", "");
pref("network.negotiate-auth.delegation-uris", "");
pref("network.negotiate-auth.allow-non-fqdn", false);
pref("network.negotiate-auth.allow-proxies", true);
pref("network.negotiate-auth.gsslib", "");
pref("network.negotiate-auth.using-native-gsslib", true);
//@line 1372 "$SRCDIR/modules/libpref/init/all.js"
pref("network.auth.force-generic-ntlm", false);
pref("network.automatic-ntlm-auth.allow-proxies", true);
pref("network.automatic-ntlm-auth.allow-non-fqdn", false);
pref("network.automatic-ntlm-auth.trusted-uris", "");
pref("network.generic-ntlm-auth.workstation", "WORKSTATION");
pref("network.auth.private-browsing-sso", false);
pref("network.http.throttle.enable", false);
pref("network.http.throttle.suspend-for", 900);
pref("network.http.throttle.resume-for", 100);
pref("network.http.throttle.hold-time-ms", 800);
pref("network.http.throttle.max-time-ms", 500);
pref("network.http.on_click_priority", true);
pref("network.proxy.http",                  "");
pref("network.proxy.http_port",             0);
pref("network.proxy.ssl",                   "");
pref("network.proxy.ssl_port",              0);
pref("network.proxy.socks",                 "");
pref("network.proxy.socks_port",            0);
pref("network.proxy.socks_version",         5);
pref("network.proxy.proxy_over_tls",        true);
pref("network.proxy.no_proxies_on",         "");
pref("network.proxy.failover_timeout",      1800); // 30 minutes
pref("network.online",                      true); //online/offline
pref("network.cookie.sameSite.laxByDefault.disabledHosts", "");
pref("network.cookie.maxNumber", 3000);
pref("network.cookie.maxPerHost", 180);
pref("network.cookie.quotaPerHost", 150);
pref("network.proxy.autoconfig_url", "");
pref("network.proxy.autoconfig_url.include_path", false);
pref("network.proxy.autoconfig_retry_interval_min", 5);    // 5 seconds
pref("network.proxy.autoconfig_retry_interval_max", 300);  // 5 minutes
pref("network.proxy.enable_wpad_over_dhcp", true);
pref("converter.html2txt.structs",          true); // Output structured phrases (strong, em, code, sub, sup, b, i, u)
pref("converter.html2txt.header_strategy",  1); // 0 = no indention; 1 = indention, increased with header level; 2 = numbering and slight indention
pref("intl.accept_languages",               "chrome://global/locale/intl.properties");
pref("intl.menuitems.alwaysappendaccesskeys","chrome://global/locale/intl.properties");
pref("intl.menuitems.insertseparatorbeforeaccesskeys","chrome://global/locale/intl.properties");
pref("intl.ellipsis",                       "chrome://global-platform/locale/intl.properties");
pref("intl.regional_prefs.use_os_locales",  false);
pref("font.language.group",                 "chrome://global/locale/intl.properties");
pref("font.cjk_pref_fallback_order",        "zh-cn,zh-hk,zh-tw,ja,ko");
pref("intl.l10n.pseudo", "");
pref("intl.hyphenation-alias.en", "en-us");
pref("intl.hyphenation-alias.en-*", "en-us");
pref("intl.hyphenation-alias.af-*", "af");
pref("intl.hyphenation-alias.bg-*", "bg");
pref("intl.hyphenation-alias.bn-*", "bn");
pref("intl.hyphenation-alias.ca-*", "ca");
pref("intl.hyphenation-alias.cs-*", "cs");
pref("intl.hyphenation-alias.cy-*", "cy");
pref("intl.hyphenation-alias.da-*", "da");
pref("intl.hyphenation-alias.eo-*", "eo");
pref("intl.hyphenation-alias.es-*", "es");
pref("intl.hyphenation-alias.et-*", "et");
pref("intl.hyphenation-alias.fi-*", "fi");
pref("intl.hyphenation-alias.fr-*", "fr");
pref("intl.hyphenation-alias.gl-*", "gl");
pref("intl.hyphenation-alias.gu-*", "gu");
pref("intl.hyphenation-alias.hi-*", "hi");
pref("intl.hyphenation-alias.hr-*", "hr");
pref("intl.hyphenation-alias.hsb-*", "hsb");
pref("intl.hyphenation-alias.hu-*", "hu");
pref("intl.hyphenation-alias.ia-*", "ia");
pref("intl.hyphenation-alias.is-*", "is");
pref("intl.hyphenation-alias.it-*", "it");
pref("intl.hyphenation-alias.kmr-*", "kmr");
pref("intl.hyphenation-alias.kn-*", "kn");
pref("intl.hyphenation-alias.la-*", "la");
pref("intl.hyphenation-alias.lt-*", "lt");
pref("intl.hyphenation-alias.ml-*", "ml");
pref("intl.hyphenation-alias.mn-*", "mn");
pref("intl.hyphenation-alias.nl-*", "nl");
pref("intl.hyphenation-alias.or-*", "or");
pref("intl.hyphenation-alias.pa-*", "pa");
pref("intl.hyphenation-alias.pl-*", "pl");
pref("intl.hyphenation-alias.pt-*", "pt");
pref("intl.hyphenation-alias.ru-*", "ru");
pref("intl.hyphenation-alias.sl-*", "sl");
pref("intl.hyphenation-alias.sv-*", "sv");
pref("intl.hyphenation-alias.ta-*", "ta");
pref("intl.hyphenation-alias.te-*", "te");
pref("intl.hyphenation-alias.tr-*", "tr");
pref("intl.hyphenation-alias.uk-*", "uk");
pref("intl.hyphenation-alias.as", "bn");
pref("intl.hyphenation-alias.as-*", "bn");
pref("intl.hyphenation-alias.mr", "hi");
pref("intl.hyphenation-alias.mr-*", "hi");
pref("intl.hyphenation-alias.sk", "cs");
pref("intl.hyphenation-alias.sk-*", "cs");
pref("intl.hyphenation-alias.de", "de-1996");
pref("intl.hyphenation-alias.de-*", "de-1996");
pref("intl.hyphenation-alias.de-AT-1901", "de-1901");
pref("intl.hyphenation-alias.de-DE-1901", "de-1901");
pref("intl.hyphenation-alias.de-CH-*", "de-CH");
pref("intl.hyphenation-alias.sr", "sh");
pref("intl.hyphenation-alias.bs", "sh");
pref("intl.hyphenation-alias.sh-*", "sh");
pref("intl.hyphenation-alias.sr-*", "sh");
pref("intl.hyphenation-alias.bs-*", "sh");
pref("intl.hyphenation-alias.no", "nb");
pref("intl.hyphenation-alias.no-*", "nb");
pref("intl.hyphenation-alias.nb-*", "nb");
pref("intl.hyphenation-alias.nn-*", "nn");
pref("intl.hyphenate-capitalized.de-1996", true);
pref("intl.hyphenate-capitalized.de-1901", true);
pref("intl.hyphenate-capitalized.de-CH", true);
pref("intl.hyphenate-capitalized.af", true);
pref("intl.hyphenate-capitalized.fi", true);
pref("intl.hyphenate-capitalized.nl", true);
pref("font.name.serif.ar", "");
pref("font.name.sans-serif.ar", "");
pref("font.name.monospace.ar", "");
pref("font.name.cursive.ar", "");
pref("font.name.serif.el", "");
pref("font.name.sans-serif.el", "");
pref("font.name.monospace.el", "");
pref("font.name.cursive.el", "");
pref("font.name.serif.he", "");
pref("font.name.sans-serif.he", "");
pref("font.name.monospace.he", "");
pref("font.name.cursive.he", "");
pref("font.name.serif.ja", "");
pref("font.name.sans-serif.ja", "");
pref("font.name.monospace.ja", "");
pref("font.name.cursive.ja", "");
pref("font.name.serif.ko", "");
pref("font.name.sans-serif.ko", "");
pref("font.name.monospace.ko", "");
pref("font.name.cursive.ko", "");
pref("font.name.serif.th", "");
pref("font.name.sans-serif.th", "");
pref("font.name.monospace.th", "");
pref("font.name.cursive.th", "");
pref("font.name.serif.x-cyrillic", "");
pref("font.name.sans-serif.x-cyrillic", "");
pref("font.name.monospace.x-cyrillic", "");
pref("font.name.cursive.x-cyrillic", "");
pref("font.name.serif.x-unicode", "");
pref("font.name.sans-serif.x-unicode", "");
pref("font.name.monospace.x-unicode", "");
pref("font.name.cursive.x-unicode", "");
pref("font.name.serif.x-western", "");
pref("font.name.sans-serif.x-western", "");
pref("font.name.monospace.x-western", "");
pref("font.name.cursive.x-western", "");
pref("font.name.serif.zh-CN", "");
pref("font.name.sans-serif.zh-CN", "");
pref("font.name.monospace.zh-CN", "");
pref("font.name.cursive.zh-CN", "");
pref("font.name.serif.zh-TW", "");
pref("font.name.sans-serif.zh-TW", "");
pref("font.name.monospace.zh-TW", "");
pref("font.name.cursive.zh-TW", "");
pref("font.name.serif.zh-HK", "");
pref("font.name.sans-serif.zh-HK", "");
pref("font.name.monospace.zh-HK", "");
pref("font.name.cursive.zh-HK", "");
pref("font.name.serif.x-devanagari", "");
pref("font.name.sans-serif.x-devanagari", "");
pref("font.name.monospace.x-devanagari", "");
pref("font.name.cursive.x-devanagari", "");
pref("font.name.serif.x-tamil", "");
pref("font.name.sans-serif.x-tamil", "");
pref("font.name.monospace.x-tamil", "");
pref("font.name.cursive.x-tamil", "");
pref("font.name.serif.x-armn", "");
pref("font.name.sans-serif.x-armn", "");
pref("font.name.monospace.x-armn", "");
pref("font.name.cursive.x-armn", "");
pref("font.name.serif.x-beng", "");
pref("font.name.sans-serif.x-beng", "");
pref("font.name.monospace.x-beng", "");
pref("font.name.cursive.x-beng", "");
pref("font.name.serif.x-cans", "");
pref("font.name.sans-serif.x-cans", "");
pref("font.name.monospace.x-cans", "");
pref("font.name.cursive.x-cans", "");
pref("font.name.serif.x-ethi", "");
pref("font.name.sans-serif.x-ethi", "");
pref("font.name.monospace.x-ethi", "");
pref("font.name.cursive.x-ethi", "");
pref("font.name.serif.x-geor", "");
pref("font.name.sans-serif.x-geor", "");
pref("font.name.monospace.x-geor", "");
pref("font.name.cursive.x-geor", "");
pref("font.name.serif.x-gujr", "");
pref("font.name.sans-serif.x-gujr", "");
pref("font.name.monospace.x-gujr", "");
pref("font.name.cursive.x-gujr", "");
pref("font.name.serif.x-guru", "");
pref("font.name.sans-serif.x-guru", "");
pref("font.name.monospace.x-guru", "");
pref("font.name.cursive.x-guru", "");
pref("font.name.serif.x-khmr", "");
pref("font.name.sans-serif.x-khmr", "");
pref("font.name.monospace.x-khmr", "");
pref("font.name.cursive.x-khmr", "");
pref("font.name.serif.x-mlym", "");
pref("font.name.sans-serif.x-mlym", "");
pref("font.name.monospace.x-mlym", "");
pref("font.name.cursive.x-mlym", "");
pref("font.name.serif.x-orya", "");
pref("font.name.sans-serif.x-orya", "");
pref("font.name.monospace.x-orya", "");
pref("font.name.cursive.x-orya", "");
pref("font.name.serif.x-telu", "");
pref("font.name.sans-serif.x-telu", "");
pref("font.name.monospace.x-telu", "");
pref("font.name.cursive.x-telu", "");
pref("font.name.serif.x-knda", "");
pref("font.name.sans-serif.x-knda", "");
pref("font.name.monospace.x-knda", "");
pref("font.name.cursive.x-knda", "");
pref("font.name.serif.x-sinh", "");
pref("font.name.sans-serif.x-sinh", "");
pref("font.name.monospace.x-sinh", "");
pref("font.name.cursive.x-sinh", "");
pref("font.name.serif.x-tibt", "");
pref("font.name.sans-serif.x-tibt", "");
pref("font.name.monospace.x-tibt", "");
pref("font.name.cursive.x-tibt", "");
pref("font.name.serif.x-math", "");
pref("font.name.sans-serif.x-math", "");
pref("font.name.monospace.x-math", "");
pref("font.name.cursive.x-math", "");
pref("font.name-list.serif.x-math", "Latin Modern Math, STIX Two Math, XITS Math, Cambria Math, Libertinus Math, DejaVu Math TeX Gyre, TeX Gyre Bonum Math, TeX Gyre Pagella Math, TeX Gyre Schola, TeX Gyre Termes Math, STIX Math, Asana Math, STIXGeneral, DejaVu Serif, DejaVu Sans, serif");
pref("font.name-list.sans-serif.x-math", "sans-serif");
pref("font.name-list.monospace.x-math", "monospace");
pref("font.blacklist.underline_offset", "FangSong,Gulim,GulimChe,MingLiU,MingLiU-ExtB,MingLiU_HKSCS,MingLiU-HKSCS-ExtB,MS Gothic,MS Mincho,MS PGothic,MS PMincho,MS UI Gothic,PMingLiU,PMingLiU-ExtB,SimHei,SimSun,SimSun-ExtB,Hei,Kai,Apple LiGothic,Apple LiSung,Osaka");
pref("security.dialog_enable_delay", 1000);
pref("security.notification_enable_delay", 500);
//@line 1744 "$SRCDIR/modules/libpref/init/all.js"
pref("security.insecure_field_warning.ignore_local_ip_address", true);
pref("services.settings.poll_interval", 86400); // 24H
pref("services.common.uptake.sampleRate", 1);   // 1%
pref("extensions.abuseReport.enabled", false);
pref("extensions.abuseReport.amoFormURL", "https://addons.mozilla.org/%LOCALE%/firefox/feedback/addon/%addonID%/");
pref("extensions.addonAbuseReport.url", "https://services.addons.mozilla.org/api/v5/abuse/report/addon/");
pref("extensions.blocklist.enabled", true);
pref("extensions.blocklist.detailsURL", "https://blocked.cdn.mozilla.net/");
pref("extensions.blocklist.itemURL", "https://blocked.cdn.mozilla.net/%blockID%.html");
pref("extensions.blocklist.addonItemURL", "https://addons.mozilla.org/%LOCALE%/firefox/blocked-addon/%addonID%/%addonVersion%/");
pref("extensions.blocklist.level", 2);
pref("extensions.eventPages.enabled", true);
pref("extensions.manifestV2.actionsPopupURLRestricted", false);
pref("extensions.manifestV3.enabled", true);
//@line 1777 "$SRCDIR/modules/libpref/init/all.js"
  pref("extensions.backgroundServiceWorker.enabled", false, locked);
//@line 1780 "$SRCDIR/modules/libpref/init/all.js"
//@line 1784 "$SRCDIR/modules/libpref/init/all.js"
  pref("extensions.openPopupWithoutUserGesture.enabled", false);
//@line 1786 "$SRCDIR/modules/libpref/init/all.js"
pref("extensions.install_origins.enabled", false);
pref("extensions.browser_style_mv3.supported", false);
pref("extensions.browser_style_mv3.same_as_mv2", false);
pref("extensions.ml.enabled", true);
pref("extensions.htmlaboutaddons.local_model_management", true);
pref("middlemouse.paste", false);
pref("middlemouse.contentLoadURL", false);
pref("middlemouse.scrollbarPosition", false);
//@line 1805 "$SRCDIR/modules/libpref/init/all.js"
  pref("mousebutton.4th.enabled", true);
  pref("mousebutton.5th.enabled", true);
//@line 1811 "$SRCDIR/modules/libpref/init/all.js"
pref("mousewheel.default.action", 1);
pref("mousewheel.with_alt.action", 2);
pref("mousewheel.with_control.action", 3);
pref("mousewheel.with_meta.action", 1);
pref("mousewheel.with_shift.action", 4);
pref("mousewheel.default.action.override_x", -1);
pref("mousewheel.with_alt.action.override_x", -1);
pref("mousewheel.with_control.action.override_x", -1);
pref("mousewheel.with_meta.action.override_x", -1);
pref("mousewheel.with_shift.action.override_x", -1);
pref("mousewheel.default.delta_multiplier_x", 100);
pref("mousewheel.default.delta_multiplier_y", 100);
pref("mousewheel.default.delta_multiplier_z", 100);
pref("mousewheel.with_alt.delta_multiplier_x", 100);
pref("mousewheel.with_alt.delta_multiplier_y", 100);
pref("mousewheel.with_alt.delta_multiplier_z", 100);
pref("mousewheel.with_control.delta_multiplier_x", 100);
pref("mousewheel.with_control.delta_multiplier_y", 100);
pref("mousewheel.with_control.delta_multiplier_z", 100);
pref("mousewheel.with_meta.delta_multiplier_x", 100);
pref("mousewheel.with_meta.delta_multiplier_y", 100);
pref("mousewheel.with_meta.delta_multiplier_z", 100);
pref("mousewheel.with_shift.delta_multiplier_x", 100);
pref("mousewheel.with_shift.delta_multiplier_y", 100);
pref("mousewheel.with_shift.delta_multiplier_z", 100);
pref("gestures.enable_single_finger_input", true);
pref("dom.use_watchdog", true);
pref("dom.global_stop_script", true);
//@line 1875 "$SRCDIR/modules/libpref/init/all.js"
  pref("dom.ipc.processCount", 8);
//@line 1881 "$SRCDIR/modules/libpref/init/all.js"
pref("dom.ipc.processCount.file", 1);
pref("dom.ipc.processCount.extension", 1);
pref("dom.ipc.processCount.privilegedabout", 1);
pref("dom.ipc.processCount.privilegedmozilla", 1);
//@line 1899 "$SRCDIR/modules/libpref/init/all.js"
pref("dom.ipc.processCount.webIsolated", 4);
//@line 1901 "$SRCDIR/modules/libpref/init/all.js"
pref("dom.ipc.processCount.inference", 1);
pref("dom.ipc.keepProcessesAlive.privilegedabout", 1);
pref("svg.disabled", false);
pref("browser.tabs.remote.enforceRemoteTypeRestrictions", false);
pref("browser.tabs.remote.separatePrivilegedContentProcess", false);
pref("browser.tabs.remote.separatedMozillaDomains", "addons.mozilla.org,accounts.firefox.com");
pref("font.default.ar", "sans-serif");
pref("font.minimum-size.ar", 0);
pref("font.size.variable.ar", 16);
pref("font.size.monospace.ar", 13);
pref("font.default.el", "serif");
pref("font.minimum-size.el", 0);
pref("font.size.variable.el", 16);
pref("font.size.monospace.el", 13);
pref("font.default.he", "sans-serif");
pref("font.minimum-size.he", 0);
pref("font.size.variable.he", 16);
pref("font.size.monospace.he", 13);
pref("font.default.ja", "sans-serif");
pref("font.minimum-size.ja", 0);
pref("font.size.variable.ja", 16);
pref("font.size.monospace.ja", 16);
pref("font.default.ko", "sans-serif");
pref("font.minimum-size.ko", 0);
pref("font.size.variable.ko", 16);
pref("font.size.monospace.ko", 16);
pref("font.default.th", "sans-serif");
pref("font.minimum-size.th", 0);
pref("font.size.variable.th", 16);
pref("font.size.monospace.th", 13);
pref("font.default.x-cyrillic", "serif");
pref("font.minimum-size.x-cyrillic", 0);
pref("font.size.variable.x-cyrillic", 16);
pref("font.size.monospace.x-cyrillic", 13);
pref("font.default.x-devanagari", "serif");
pref("font.minimum-size.x-devanagari", 0);
pref("font.size.variable.x-devanagari", 16);
pref("font.size.monospace.x-devanagari", 13);
pref("font.default.x-tamil", "serif");
pref("font.minimum-size.x-tamil", 0);
pref("font.size.variable.x-tamil", 16);
pref("font.size.monospace.x-tamil", 13);
pref("font.default.x-armn", "serif");
pref("font.minimum-size.x-armn", 0);
pref("font.size.variable.x-armn", 16);
pref("font.size.monospace.x-armn", 13);
pref("font.default.x-beng", "serif");
pref("font.minimum-size.x-beng", 0);
pref("font.size.variable.x-beng", 16);
pref("font.size.monospace.x-beng", 13);
pref("font.default.x-cans", "serif");
pref("font.minimum-size.x-cans", 0);
pref("font.size.variable.x-cans", 16);
pref("font.size.monospace.x-cans", 13);
pref("font.default.x-ethi", "serif");
pref("font.minimum-size.x-ethi", 0);
pref("font.size.variable.x-ethi", 16);
pref("font.size.monospace.x-ethi", 13);
pref("font.default.x-geor", "serif");
pref("font.minimum-size.x-geor", 0);
pref("font.size.variable.x-geor", 16);
pref("font.size.monospace.x-geor", 13);
pref("font.default.x-gujr", "serif");
pref("font.minimum-size.x-gujr", 0);
pref("font.size.variable.x-gujr", 16);
pref("font.size.monospace.x-gujr", 13);
pref("font.default.x-guru", "serif");
pref("font.minimum-size.x-guru", 0);
pref("font.size.variable.x-guru", 16);
pref("font.size.monospace.x-guru", 13);
pref("font.default.x-khmr", "serif");
pref("font.minimum-size.x-khmr", 0);
pref("font.size.variable.x-khmr", 16);
pref("font.size.monospace.x-khmr", 13);
pref("font.default.x-mlym", "serif");
pref("font.minimum-size.x-mlym", 0);
pref("font.size.variable.x-mlym", 16);
pref("font.size.monospace.x-mlym", 13);
pref("font.default.x-orya", "serif");
pref("font.minimum-size.x-orya", 0);
pref("font.size.variable.x-orya", 16);
pref("font.size.monospace.x-orya", 13);
pref("font.default.x-telu", "serif");
pref("font.minimum-size.x-telu", 0);
pref("font.size.variable.x-telu", 16);
pref("font.size.monospace.x-telu", 13);
pref("font.default.x-knda", "serif");
pref("font.minimum-size.x-knda", 0);
pref("font.size.variable.x-knda", 16);
pref("font.size.monospace.x-knda", 13);
pref("font.default.x-sinh", "serif");
pref("font.minimum-size.x-sinh", 0);
pref("font.size.variable.x-sinh", 16);
pref("font.size.monospace.x-sinh", 13);
pref("font.default.x-tibt", "serif");
pref("font.minimum-size.x-tibt", 0);
pref("font.size.variable.x-tibt", 16);
pref("font.size.monospace.x-tibt", 13);
pref("font.default.x-unicode", "serif");
pref("font.minimum-size.x-unicode", 0);
pref("font.size.variable.x-unicode", 16);
pref("font.size.monospace.x-unicode", 13);
pref("font.default.x-western", "serif");
pref("font.minimum-size.x-western", 0);
pref("font.size.variable.x-western", 16);
pref("font.size.monospace.x-western", 13);
pref("font.default.zh-CN", "sans-serif");
pref("font.minimum-size.zh-CN", 0);
pref("font.size.variable.zh-CN", 16);
pref("font.size.monospace.zh-CN", 16);
pref("font.default.zh-HK", "sans-serif");
pref("font.minimum-size.zh-HK", 0);
pref("font.size.variable.zh-HK", 16);
pref("font.size.monospace.zh-HK", 16);
pref("font.default.zh-TW", "sans-serif");
pref("font.minimum-size.zh-TW", 0);
pref("font.size.variable.zh-TW", 16);
pref("font.size.monospace.zh-TW", 16);
pref("font.default.x-math", "serif");
pref("font.minimum-size.x-math", 0);
pref("font.size.variable.x-math", 16);
pref("font.size.monospace.x-math", 13);
//@line 2333 "$SRCDIR/modules/libpref/init/all.js"
//@line 2335 "$SRCDIR/modules/libpref/init/all.js"
  pref("browser.drag_out_of_frame_style", 1);
  pref("font.name-list.emoji", "Apple Color Emoji");
  pref("font.name-list.serif.ar", "Al Bayan");
  pref("font.name-list.sans-serif.ar", "Geeza Pro");
  pref("font.name-list.monospace.ar", "Menlo, Geeza Pro");
  pref("font.name-list.cursive.ar", "DecoType Naskh");
  pref("font.name-list.fantasy.ar", "KufiStandardGK");
  pref("font.name-list.serif.el", "Times, Times New Roman");
  pref("font.name-list.sans-serif.el", "Helvetica, Lucida Grande");
  pref("font.name-list.monospace.el", "Menlo");
  pref("font.name-list.cursive.el", "Lucida Grande, Times");
  pref("font.name-list.fantasy.el", "Lucida Grande, Times");
  pref("font.name-list.serif.he", "Times New Roman");
  pref("font.name-list.sans-serif.he", "Arial");
  pref("font.name-list.monospace.he", "Menlo, Courier New");
  pref("font.name-list.cursive.he", "Times New Roman");
  pref("font.name-list.fantasy.he", "Times New Roman");
  pref("font.name-list.serif.ja", "Hiragino Mincho ProN, Hiragino Mincho Pro");
  pref("font.name-list.sans-serif.ja", "Hiragino Kaku Gothic ProN, Hiragino Kaku Gothic Pro, Hiragino Sans");
  pref("font.name-list.monospace.ja", "Osaka-Mono, Menlo, Hiragino Kaku Gothic ProN, Hiragino Sans");
  pref("font.name-list.serif.ko", "AppleMyungjo");
  pref("font.name-list.sans-serif.ko", "Apple SD Gothic Neo, AppleGothic");
  pref("font.name-list.monospace.ko", "Menlo, Apple SD Gothic Neo, AppleGothic");
  pref("font.name-list.serif.th", "Thonburi");
  pref("font.name-list.sans-serif.th", "Thonburi");
  pref("font.name-list.monospace.th", "Menlo, Ayuthaya");
  pref("font.name-list.serif.x-armn", "Noto Sans Armenian");
  pref("font.name-list.sans-serif.x-armn", "Noto Sans Armenian");
  pref("font.name-list.monospace.x-armn", "Menlo, Noto Sans Armenian");
  pref("font.name-list.serif.x-beng", "Bangla MN");
  pref("font.name-list.sans-serif.x-beng", "Bangla Sangam MN");
  pref("font.name-list.monospace.x-beng", "Menlo, Bangla Sangam MN");
  pref("font.name-list.serif.x-cans", "Euphemia UCAS");
  pref("font.name-list.sans-serif.x-cans", "Euphemia UCAS");
  pref("font.name-list.monospace.x-cans", "Menlo, Euphemia UCAS");
  pref("font.name-list.serif.x-cyrillic", "Times, Times New Roman");
  pref("font.name-list.sans-serif.x-cyrillic", "Helvetica, Arial");
  pref("font.name-list.monospace.x-cyrillic", "Menlo");
  pref("font.name-list.cursive.x-cyrillic", "Geneva");
  pref("font.name-list.fantasy.x-cyrillic", "Charcoal CY");
  pref("font.name-list.serif.x-devanagari", "ITF Devanagari, Devanagari MT");
  pref("font.name-list.sans-serif.x-devanagari", "Kohinoor Devanagari, Devanagari Sangam MN, Devanagari MT");
  pref("font.name-list.monospace.x-devanagari", "Menlo, Kohinoor Devanagari, Devanagari Sangam MN, Devanagari MT");
  pref("font.name-list.serif.x-ethi", "Kefa, Abyssinica SIL");
  pref("font.name-list.sans-serif.x-ethi", "Kefa, Abyssinica SIL");
  pref("font.name-list.monospace.x-ethi", "Menlo, Kefa, Abyssinica SIL");
  pref("font.name-list.serif.x-geor", "TITUS Cyberbit Basic");
  pref("font.name-list.sans-serif.x-geor", "Zuzumbo");
  pref("font.name-list.monospace.x-geor", "Menlo, Zuzumbo");
  pref("font.name-list.serif.x-gujr", "Gujarati MT");
  pref("font.name-list.sans-serif.x-gujr", "Gujarati Sangam MN, Gujarati MT");
  pref("font.name-list.monospace.x-gujr", "Menlo, Gujarati Sangam MN, Gujarati MT");
  pref("font.name-list.serif.x-guru", "Gurmukhi MT");
  pref("font.name-list.sans-serif.x-guru", "Gurmukhi MT");
  pref("font.name-list.monospace.x-guru", "Menlo, Gurmukhi MT");
  pref("font.name-list.serif.x-khmr", "Khmer MN");
  pref("font.name-list.sans-serif.x-khmr", "Khmer Sangam MN");
  pref("font.name-list.monospace.x-khmr", "Menlo, Khmer Sangam MN");
  pref("font.name-list.serif.x-mlym", "Malayalam MN");
  pref("font.name-list.sans-serif.x-mlym", "Malayalam Sangam MN");
  pref("font.name-list.monospace.x-mlym", "Menlo, Malayalam Sangam MN");
  pref("font.name-list.serif.x-orya", "Oriya MN");
  pref("font.name-list.sans-serif.x-orya", "Oriya Sangam MN");
  pref("font.name-list.monospace.x-orya", "Menlo, Oriya Sangam MN");
  pref("font.name-list.serif.x-telu", "Telugu MN, Pothana");
  pref("font.name-list.sans-serif.x-telu", "Telugu Sangam MN, Pothana");
  pref("font.name-list.monospace.x-telu", "Menlo, Telugu Sangam MN, Pothana");
  pref("font.name-list.serif.x-knda", "Kannada MN, Kedage");
  pref("font.name-list.sans-serif.x-knda", "Kannada Sangam MN, Kedage");
  pref("font.name-list.monospace.x-knda", "Menlo, Kannada Sangam MN, Kedage");
  pref("font.name-list.serif.x-sinh", "Sinhala MN");
  pref("font.name-list.sans-serif.x-sinh", "Sinhala Sangam MN");
  pref("font.name-list.monospace.x-sinh", "Menlo, Sinhala Sangam MN");
  pref("font.name-list.serif.x-tamil", "InaiMathi");
  pref("font.name-list.sans-serif.x-tamil", "InaiMathi");
  pref("font.name-list.monospace.x-tamil", "Menlo, InaiMathi");
  pref("font.name-list.serif.x-tibt", "Kailasa");
  pref("font.name-list.sans-serif.x-tibt", "Kailasa");
  pref("font.name-list.monospace.x-tibt", "Menlo, Kailasa");
  pref("font.name-list.serif.x-unicode", "Times");
  pref("font.name-list.sans-serif.x-unicode", "Helvetica");
  pref("font.name-list.monospace.x-unicode", "Menlo");
  pref("font.name-list.cursive.x-unicode", "Apple Chancery");
  pref("font.name-list.fantasy.x-unicode", "Papyrus");
  pref("font.name-list.serif.x-western", "Times, Times New Roman");
  pref("font.name-list.sans-serif.x-western", "Helvetica, Arial");
  pref("font.name-list.monospace.x-western", "Menlo");
  pref("font.name-list.cursive.x-western", "Apple Chancery");
  pref("font.name-list.fantasy.x-western", "Papyrus");
  pref("font.name-list.serif.zh-CN", "Times New Roman, Songti SC, STSong, Heiti SC");
  pref("font.name-list.sans-serif.zh-CN", "Arial, PingFang SC, STHeiti, Heiti SC");
  pref("font.name-list.monospace.zh-CN", "Menlo, PingFang SC, STHeiti, Heiti SC");
  pref("font.name-list.cursive.zh-CN", "Kaiti SC");
  pref("font.name-list.serif.zh-TW", "Times New Roman, Songti TC, LiSong Pro, Heiti TC");
  pref("font.name-list.sans-serif.zh-TW", "Arial, PingFang TC, Heiti TC, LiHei Pro");
  pref("font.name-list.monospace.zh-TW", "Menlo, PingFang TC, Heiti TC, LiHei Pro");
  pref("font.name-list.cursive.zh-TW", "Kaiti TC");
  pref("font.name-list.serif.zh-HK", "Times New Roman, Songti TC, LiSong Pro, Heiti TC");
  pref("font.name-list.sans-serif.zh-HK", "Arial, PingFang TC, Heiti TC, LiHei Pro");
  pref("font.name-list.monospace.zh-HK", "Menlo, PingFang TC, Heiti TC, LiHei Pro");
  pref("font.name-list.cursive.zh-HK", "Kaiti TC");
  pref("font.minimum-size.th", 10);
  pref("font.name-list.serif.x-math", "Latin Modern Math, STIX Two Math, XITS Math, Cambria Math, Libertinus Math, DejaVu Math TeX Gyre, TeX Gyre Bonum Math, TeX Gyre Pagella Math, TeX Gyre Schola, TeX Gyre Termes Math, STIX Math, Asana Math, STIXGeneral, DejaVu Serif, DejaVu Sans, Symbol, Times");
  pref("font.name-list.sans-serif.x-math", "Helvetica");
  pref("font.name-list.monospace.x-math", "Menlo");
  pref("font.name-list.cursive.x-math", "Apple Chancery");
  pref("font.name-list.fantasy.x-math", "Papyrus");
  pref("font.single-face-list", "Osaka-Mono:Osaka");
  pref("font.preload-names-list", "Hiragino Kaku Gothic ProN,Hiragino Mincho ProN,STSong");
  pref("font.weight-override.AppleSDGothicNeo-Thin", 100); // Ensure Thin < UltraLight < Light
  pref("font.weight-override.AppleSDGothicNeo-UltraLight", 200);
  pref("font.weight-override.AppleSDGothicNeo-Light", 300);
  pref("font.weight-override.AppleSDGothicNeo-Heavy", 900); // Ensure Heavy > ExtraBold (800)
  pref("font.weight-override.Avenir-Book", 300); // Ensure Book < Roman (400)
  pref("font.weight-override.Avenir-BookOblique", 300);
  pref("font.weight-override.Avenir-MediumOblique", 500); // Harmonize MediumOblique with Medium
  pref("font.weight-override.Avenir-Black", 900); // Ensure Black > Heavy (800)
  pref("font.weight-override.Avenir-BlackOblique", 900);
  pref("font.weight-override.AvenirNext-MediumItalic", 500); // Harmonize MediumItalic with Medium
  pref("font.weight-override.AvenirNextCondensed-MediumItalic", 500);
  pref("font.weight-override.HelveticaNeue-Light", 300); // Ensure Light > Thin (200)
  pref("font.weight-override.HelveticaNeue-LightItalic", 300);
  pref("mousewheel.enable_pixel_scrolling", true);
//@line 2528 "$SRCDIR/modules/libpref/init/all.js"
//@line 2661 "$SRCDIR/modules/libpref/init/all.js"
//@line 2681 "$SRCDIR/modules/libpref/init/all.js"
//@line 2864 "$SRCDIR/modules/libpref/init/all.js"
//@line 2884 "$SRCDIR/modules/libpref/init/all.js"
//@line 2987 "$SRCDIR/modules/libpref/init/all.js"
pref("signon.rememberSignons",              true);
pref("signon.autofillForms",                true);
pref("signon.autofillForms.autocompleteOff", true);
pref("signon.autofillForms.http",           false);
pref("signon.autologin.proxy",              false);
pref("signon.capture.inputChanges.enabled", true);
pref("signon.formlessCapture.enabled",      true);
pref("signon.formRemovalCapture.enabled",   true);
pref("signon.generation.available",               true);
pref("signon.improvedPasswordRules.enabled", true);
pref("signon.backup.enabled",               true);
pref("signon.generation.confidenceThreshold",     "0.75");
pref("signon.generation.enabled",                 true);
pref("signon.passwordEditCapture.enabled",        false);
pref("signon.privateBrowsingCapture.enabled",     true);
pref("signon.storeWhenAutocompleteOff",     true);
pref("signon.userInputRequiredToCapture.enabled", true);
pref("signon.usernameOnlyForm.lookupThreshold",  5);
pref("signon.debug",                        false);
pref("signon.recipes.path", "resource://app/defaults/settings/main/password-recipes.json");
pref("signon.recipes.remoteRecipes.enabled", true);
pref("signon.relatedRealms.enabled", false);
pref("signon.schemeUpgrades",                     true);
pref("signon.includeOtherSubdomainsInLookup",     true);
pref("signon.masterPasswordReprompt.timeout_ms", 900000); // 15 Minutes
pref("signon.showAutoCompleteFooter",             false);
pref("signon.firefoxRelay.base_url", "https://relay.firefox.com/api/v1/");
pref("signon.firefoxRelay.learn_more_url", "https://support.mozilla.org/1/firefox/%VERSION%/%OS%/%LOCALE%/firefox-relay-integration");
pref("signon.firefoxRelay.manage_url", "https://relay.firefox.com/accounts/profile/?utm_medium=firefox-desktop&utm_source=modal&utm_campaign=limit&utm_content=manage-masks-global");
pref("signon.firefoxRelay.terms_of_service_url", "https://www.mozilla.org/%LOCALE%/about/legal/terms/subscription-services/");
pref("signon.firefoxRelay.privacy_policy_url", "https://www.mozilla.org/%LOCALE%/privacy/subscription-services/");
pref("signon.signupDetection.confidenceThreshold",     "0.75");
pref("browser.formfill.debug",            false);
pref("browser.formfill.enable",           true);
pref("browser.formfill.expire_days",      180);
pref("browser.formfill.agedWeight",       2);
pref("browser.formfill.bucketSize",       1);
pref("browser.formfill.maxTimeGroupings", 25);
pref("browser.formfill.timeGroupingSize", 604800);
pref("browser.formfill.boundaryWeight",   25);
pref("browser.formfill.prefixWeight",     5);
pref("browser.zoom.full", false);
pref("toolkit.zoomManager.zoomValues", ".3,.5,.67,.8,.9,1,1.1,1.2,1.33,1.5,1.7,2,2.4,3,4,5");
pref("image.http.accept", "");
pref("network.tcp.keepalive.enabled", true);
pref("network.tcp.keepalive.idle_time", 600); // seconds; 10 mins
//@line 3063 "$SRCDIR/modules/libpref/init/all.js"
//@line 3068 "$SRCDIR/modules/libpref/init/all.js"
//@line 3072 "$SRCDIR/modules/libpref/init/all.js"
pref("geo.provider.network.url", "https://www.googleapis.com/geolocation/v1/geolocate?key=%GOOGLE_LOCATION_SERVICE_API_KEY%");
pref("geo.provider.network.timeToWaitBeforeSending", 5000);
pref("geo.provider.network.timeout", 60000);
//@line 3083 "$SRCDIR/modules/libpref/init/all.js"
  pref("geo.provider.use_corelocation", true);
//@line 3085 "$SRCDIR/modules/libpref/init/all.js"
//@line 3090 "$SRCDIR/modules/libpref/init/all.js"
pref("browser.region.log", false);
pref("browser.region.network.url", "https://location.services.mozilla.com/v1/country?key=%MOZILLA_API_KEY%");
pref("browser.region.network.scan", false);
pref("browser.region.timeout", 5000);
pref("browser.region.update.enabled", true);
pref("browser.meta_refresh_when_inactive.disabled", false);
pref("xpinstall.whitelist.required", true);
pref("xpinstall.signatures.required", false);
pref("extensions.langpacks.signatures.required", false);
pref("extensions.webExtensionsMinPlatformVersion", "42.0a1");
pref("extensions.experiments.enabled", true);
pref("extensions.webextensions.keepStorageOnUninstall", false);
pref("extensions.webextensions.keepUuidOnUninstall", false);
pref("extensions.webextensions.identity.redirectDomain", "extensions.allizom.org");
pref("extensions.webextensions.restrictedDomains", "accounts-static.cdn.mozilla.net,accounts.firefox.com,addons.cdn.mozilla.net,addons.mozilla.org,api.accounts.firefox.com,content.cdn.mozilla.net,discovery.addons.mozilla.org,install.mozilla.org,oauth.accounts.firefox.com,profile.accounts.firefox.com,support.mozilla.org,sync.services.mozilla.com");
pref("extensions.quarantinedDomains.enabled", true);
pref("extensions.quarantinedDomains.list", "");
pref("extensions.originControls.grantByDefault", true);
pref("extensions.webextensions.protocol.remote", true);
pref("extensions.webextensions.userScripts.enabled", true);
pref("extensions.userScripts.mv3.enabled", true);
pref("extensions.webextensions.ExtensionStorageIDB.enabled", true);
pref("extensions.htmlaboutaddons.inline-options.enabled", true);
pref("extensions.htmlaboutaddons.recommendations.enabled", false);
pref("extensions.recommendations.privacyPolicyUrl", "");
pref("extensions.recommendations.themeRecommendationUrl", "");
pref("extensions.webcompat-reporter.newIssueEndpoint", "https://webcompat.com/issues/new");
//@line 3154 "$SRCDIR/modules/libpref/init/all.js"
  pref("extensions.webcompat-reporter.enabled", false);
//@line 3156 "$SRCDIR/modules/libpref/init/all.js"
pref("extensions.webextensions.base-content-security-policy", "script-src 'self' https://* http://localhost:* http://127.0.0.1:* moz-extension: blob: filesystem: 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline';");
pref("extensions.webextensions.base-content-security-policy.v3", "script-src 'self' 'wasm-unsafe-eval';");
pref("extensions.webextensions.default-content-security-policy", "script-src 'self' 'wasm-unsafe-eval';");
pref("extensions.webextensions.default-content-security-policy.v3", "script-src 'self'; upgrade-insecure-requests;");
pref("network.buffer.cache.count", 24);
pref("network.buffer.cache.size",  32768);
pref("dom.webnotifications.requireinteraction.count", 3);
//@line 3172 "$SRCDIR/modules/libpref/init/all.js"
  pref("full-screen-api.macos-native-full-screen", true);
//@line 3175 "$SRCDIR/modules/libpref/init/all.js"
//@line 3177 "$SRCDIR/modules/libpref/init/all.js"
  pref("full-screen-api.transition-duration.enter", "200 200");
  pref("full-screen-api.transition-duration.leave", "200 200");
//@line 3183 "$SRCDIR/modules/libpref/init/all.js"
pref("full-screen-api.transition.timeout", 1000);
pref("full-screen-api.warning.timeout", 3000);
pref("full-screen-api.warning.delay", 500);
pref("pointer-lock-api.warning.timeout", 3000);
pref("dom.push.loglevel", "Error");
pref("dom.push.serverURL", "wss://push.services.mozilla.com/");
pref("dom.push.userAgentID", "");
pref("dom.push.maxQuotaPerSubscription", 16);
pref("dom.push.maxRecentMessageIDsPerSubscription", 100);
pref("dom.push.quotaUpdateDelay", 3000); // 3 seconds
pref("dom.push.connection.enabled", true);
pref("dom.push.retryBaseInterval", 5000);
pref("dom.push.pingInterval", 1800000); // 30 minutes
pref("dom.push.requestTimeout", 10000);
pref("memory.ghost_window_timeout_seconds", 60);
pref("memory.dump_reports_on_oom", false);
pref("memory.blob_report.stack_frames", 0);
pref("gfx.vr.osvr.utilLibPath", "");
pref("gfx.vr.osvr.commonLibPath", "");
pref("gfx.vr.osvr.clientLibPath", "");
pref("gfx.vr.osvr.clientKitLibPath", "");
pref("memory_info_dumper.watch_fifo.enabled", false);
pref("network.captive-portal-service.minInterval", 60000); // 60 seconds
pref("network.captive-portal-service.maxInterval", 1500000); // 25 minutes
pref("network.captive-portal-service.backoffFactor", "5.0");
pref("network.captive-portal-service.enabled", false);
pref("network.connectivity-service.enabled", false);
pref("network.connectivity-service.DNSv4.domain", "example.org");
pref("network.connectivity-service.DNSv6.domain", "example.org");
pref("network.connectivity-service.DNS_HTTPS.domain", "cloudflare-dns.com");
pref("network.connectivity-service.IPv4.url", "http://detectportal.firefox.com/success.txt?ipv4");
pref("network.connectivity-service.IPv6.url", "http://detectportal.firefox.com/success.txt?ipv6");
pref("network.trr.uri", "");
pref("network.trr.credentials", "");
pref("network.trr.custom_uri", "");
pref("network.trr.confirmationNS", "example.com");
pref("network.trr.excluded-domains", "");
pref("network.trr.builtin-excluded-domains", "localhost,local");
pref("captivedetect.canonicalURL", "http://detectportal.firefox.com/canonical.html");
pref("captivedetect.canonicalContent", "<meta http-equiv=\"refresh\" content=\"0;url=https://support.mozilla.org/kb/captive-portal\"/>");
pref("captivedetect.maxWaitingTime", 5000);
pref("captivedetect.pollingTime", 3000);
pref("captivedetect.maxRetryCount", 5);
pref("urlclassifier.malwareTable", "goog-malware-proto,goog-unwanted-proto,moztest-harmful-simple,moztest-malware-simple,moztest-unwanted-simple");
//@line 3285 "$SRCDIR/modules/libpref/init/all.js"
  pref("urlclassifier.phishTable", "goog-phish-proto,moztest-phish-simple");
//@line 3291 "$SRCDIR/modules/libpref/init/all.js"
pref("urlclassifier.downloadAllowTable", "goog-downloadwhite-proto");
pref("urlclassifier.downloadBlockTable", "goog-badbinurl-proto");
pref("urlclassifier.trackingAnnotationTable", "moztest-track-simple,ads-track-digest256,social-track-digest256,analytics-track-digest256,content-track-digest256");
pref("urlclassifier.trackingAnnotationWhitelistTable", "moztest-trackwhite-simple,mozstd-trackwhite-digest256,google-trackwhite-digest256");
pref("urlclassifier.trackingTable", "moztest-track-simple,ads-track-digest256,social-track-digest256,analytics-track-digest256");
pref("urlclassifier.trackingWhitelistTable", "moztest-trackwhite-simple,mozstd-trackwhite-digest256,google-trackwhite-digest256");
pref("urlclassifier.features.fingerprinting.blacklistTables", "base-fingerprinting-track-digest256");
pref("urlclassifier.features.fingerprinting.whitelistTables", "mozstd-trackwhite-digest256,google-trackwhite-digest256");
pref("urlclassifier.features.fingerprinting.annotate.blacklistTables", "base-fingerprinting-track-digest256");
pref("urlclassifier.features.fingerprinting.annotate.whitelistTables", "mozstd-trackwhite-digest256,google-trackwhite-digest256");
pref("urlclassifier.features.cryptomining.blacklistTables", "base-cryptomining-track-digest256");
pref("urlclassifier.features.cryptomining.whitelistTables", "mozstd-trackwhite-digest256");
pref("urlclassifier.features.cryptomining.annotate.blacklistTables", "base-cryptomining-track-digest256");
pref("urlclassifier.features.cryptomining.annotate.whitelistTables", "mozstd-trackwhite-digest256");
pref("urlclassifier.features.socialtracking.blacklistTables", "social-tracking-protection-facebook-digest256,social-tracking-protection-linkedin-digest256,social-tracking-protection-twitter-digest256");
pref("urlclassifier.features.socialtracking.whitelistTables", "mozstd-trackwhite-digest256,google-trackwhite-digest256");
pref("urlclassifier.features.socialtracking.annotate.blacklistTables", "social-tracking-protection-facebook-digest256,social-tracking-protection-linkedin-digest256,social-tracking-protection-twitter-digest256");
pref("urlclassifier.features.socialtracking.annotate.whitelistTables", "mozstd-trackwhite-digest256,google-trackwhite-digest256");
pref("urlclassifier.features.emailtracking.blocklistTables", "base-email-track-digest256");
pref("urlclassifier.features.emailtracking.allowlistTables", "mozstd-trackwhite-digest256");
pref("urlclassifier.features.emailtracking.datacollection.blocklistTables", "base-email-track-digest256,content-email-track-digest256");
pref("urlclassifier.features.emailtracking.datacollection.allowlistTables", "mozstd-trackwhite-digest256");
pref("urlclassifier.features.consentmanager.annotate.blocklistTables", "consent-manager-track-digest256");
pref("urlclassifier.features.consentmanager.annotate.allowlistTables", "mozstd-trackwhite-digest256");
pref("urlclassifier.disallow_completions", "goog-downloadwhite-digest256,base-track-digest256,mozstd-trackwhite-digest256,content-track-digest256,mozplugin-block-digest256,mozplugin2-block-digest256,ads-track-digest256,social-track-digest256,analytics-track-digest256,base-fingerprinting-track-digest256,content-fingerprinting-track-digest256,base-cryptomining-track-digest256,content-cryptomining-track-digest256,fanboyannoyance-ads-digest256,fanboysocial-ads-digest256,easylist-ads-digest256,easyprivacy-ads-digest256,adguard-ads-digest256,social-tracking-protection-digest256,social-tracking-protection-facebook-digest256,social-tracking-protection-linkedin-digest256,social-tracking-protection-twitter-digest256,base-email-track-digest256,content-email-track-digest256,consent-manager-track-digest256");
pref("urlclassifier.trackingAnnotationSkipURLs", "");
pref("privacy.rejectForeign.allowList", "");
pref("privacy.trackingprotection.emailtracking.webapp.domains", "mail.163.com,mail.aol.com,fastmail.com,webmail.gandi.net,mail.google.com,navigator-bs.gmx.com,app.hey.com,horde.org/apps/webmail,hushmail.com,icloud.com/mail,kolabnow.com,laposte.net/accueil,mail.lycos.com,mail.com/mail/,mail.ru,mailfence.com,outlook.live.com,email-postaci.com/,posteo.de,mail.protonmail.com,app.rackspace.com,mail.rediff.com,emailmg.ipage.com,runbox.com,mail.sina.com.cn,tutanota.com,mail.yahoo.com,mail.yandex.com,mail.zimbra.com,zoho.com/mail/");
pref("urlclassifier.gethashnoise", 4);
pref("urlclassifier.gethash.timeout_ms", 5000);
pref("urlclassifier.alternate_error_page", "blocked");
pref("browser.safebrowsing.debug", false);
pref("browser.safebrowsing.allowOverride", true);
//@line 3349 "$SRCDIR/modules/libpref/init/all.js"
  pref("browser.safebrowsing.id", "navclient-auto-ffox");
//@line 3353 "$SRCDIR/modules/libpref/init/all.js"
pref("browser.safebrowsing.downloads.enabled", true);
pref("browser.safebrowsing.downloads.remote.enabled", true);
pref("browser.safebrowsing.downloads.remote.timeout_ms", 15000);
pref("browser.safebrowsing.downloads.remote.url", "https://sb-ssl.google.com/safebrowsing/clientreport/download?key=%GOOGLE_SAFEBROWSING_API_KEY%");
pref("browser.safebrowsing.downloads.remote.block_dangerous",            true);
pref("browser.safebrowsing.downloads.remote.block_dangerous_host",       true);
pref("browser.safebrowsing.downloads.remote.block_potentially_unwanted", true);
pref("browser.safebrowsing.downloads.remote.block_uncommon",             true);
//@line 3366 "$SRCDIR/modules/libpref/init/all.js"
pref("browser.safebrowsing.provider.google.pver", "2.2");
pref("browser.safebrowsing.provider.google.lists", "goog-badbinurl-shavar,goog-downloadwhite-digest256,goog-phish-shavar,googpub-phish-shavar,goog-malware-shavar,goog-unwanted-shavar");
pref("browser.safebrowsing.provider.google.updateURL", "https://safebrowsing.google.com/safebrowsing/downloads?client=SAFEBROWSING_ID&appver=%MAJOR_VERSION%&pver=2.2&key=%GOOGLE_SAFEBROWSING_API_KEY%");
pref("browser.safebrowsing.provider.google.gethashURL", "https://safebrowsing.google.com/safebrowsing/gethash?client=SAFEBROWSING_ID&appver=%MAJOR_VERSION%&pver=2.2");
pref("browser.safebrowsing.provider.google.reportURL", "https://safebrowsing.google.com/safebrowsing/diagnostic?site=");
pref("browser.safebrowsing.provider.google.reportPhishMistakeURL", "https://%LOCALE%.phish-error.mozilla.com/?url=");
pref("browser.safebrowsing.provider.google.reportMalwareMistakeURL", "https://%LOCALE%.malware-error.mozilla.com/?url=");
pref("browser.safebrowsing.provider.google.advisoryURL", "https://developers.google.com/safe-browsing/v4/advisory");
pref("browser.safebrowsing.provider.google.advisoryName", "Google Safe Browsing");
pref("browser.safebrowsing.provider.google4.pver", "4");
pref("browser.safebrowsing.provider.google4.lists", "goog-badbinurl-proto,goog-downloadwhite-proto,goog-phish-proto,googpub-phish-proto,goog-malware-proto,goog-unwanted-proto,goog-harmful-proto");
pref("browser.safebrowsing.provider.google4.updateURL", "https://safebrowsing.googleapis.com/v4/threatListUpdates:fetch?$ct=application/x-protobuf&key=%GOOGLE_SAFEBROWSING_API_KEY%&$httpMethod=POST");
pref("browser.safebrowsing.provider.google4.gethashURL", "https://safebrowsing.googleapis.com/v4/fullHashes:find?$ct=application/x-protobuf&key=%GOOGLE_SAFEBROWSING_API_KEY%&$httpMethod=POST");
pref("browser.safebrowsing.provider.google4.reportURL", "https://safebrowsing.google.com/safebrowsing/diagnostic?site=");
pref("browser.safebrowsing.provider.google4.reportPhishMistakeURL", "https://%LOCALE%.phish-error.mozilla.com/?url=");
pref("browser.safebrowsing.provider.google4.reportMalwareMistakeURL", "https://%LOCALE%.malware-error.mozilla.com/?url=");
pref("browser.safebrowsing.provider.google4.advisoryURL", "https://developers.google.com/safe-browsing/v4/advisory");
pref("browser.safebrowsing.provider.google4.advisoryName", "Google Safe Browsing");
pref("browser.safebrowsing.provider.google4.dataSharingURL", "https://safebrowsing.googleapis.com/v4/threatHits?$ct=application/x-protobuf&key=%GOOGLE_SAFEBROWSING_API_KEY%&$httpMethod=POST");
pref("browser.safebrowsing.provider.google4.dataSharing.enabled", false);
//@line 3392 "$SRCDIR/modules/libpref/init/all.js"
pref("browser.safebrowsing.reportPhishURL", "https://%LOCALE%.phish-report.mozilla.com/?url=");
pref("browser.safebrowsing.provider.mozilla.pver", "2.2");
pref("browser.safebrowsing.provider.mozilla.lists", "base-track-digest256,mozstd-trackwhite-digest256,google-trackwhite-digest256,content-track-digest256,mozplugin-block-digest256,mozplugin2-block-digest256,ads-track-digest256,social-track-digest256,analytics-track-digest256,base-fingerprinting-track-digest256,content-fingerprinting-track-digest256,base-cryptomining-track-digest256,content-cryptomining-track-digest256,fanboyannoyance-ads-digest256,fanboysocial-ads-digest256,easylist-ads-digest256,easyprivacy-ads-digest256,adguard-ads-digest256,social-tracking-protection-digest256,social-tracking-protection-facebook-digest256,social-tracking-protection-linkedin-digest256,social-tracking-protection-twitter-digest256,base-email-track-digest256,content-email-track-digest256,consent-manager-track-digest256");
pref("browser.safebrowsing.provider.mozilla.updateURL", "moz-sbrs:://antitracking");
pref("browser.safebrowsing.provider.mozilla.gethashURL", "https://shavar.services.mozilla.com/gethash?client=SAFEBROWSING_ID&appver=%MAJOR_VERSION%&pver=2.2");
pref("browser.safebrowsing.provider.mozilla.nextupdatetime", "1");
pref("browser.safebrowsing.provider.mozilla.lists.base", "moz-std");
pref("browser.safebrowsing.provider.mozilla.lists.content", "moz-full");
//@line 3411 "$SRCDIR/modules/libpref/init/all.js"
  pref("urlclassifier.blockedTable", "moztest-block-simple");
//@line 3413 "$SRCDIR/modules/libpref/init/all.js"
//@line 3422 "$SRCDIR/modules/libpref/init/all.js"
pref("browser.search.log", false);
pref("browser.search.update", true);
pref("browser.search.suggest.enabled", true);
pref("browser.search.suggest.enabled.private", false);
pref("browser.search.separatePrivateDefault", true);
pref("browser.search.separatePrivateDefault.ui.enabled", false);
pref("browser.search.removeEngineInfobar.enabled", true);
pref("browser.search.rustSelector.featureGate", true);
pref("media.gmp-manager.allowLocalSources", true);
pref("media.gmp-manager.url", "");
pref("media.gmp-manager.checkContentSignature", true);
pref("media.gmp-manager.cert.requireBuiltIn", true);
pref("media.gmp-manager.cert.checkAttributes", true);
pref("media.gmp-manager.certs.1.issuerName", "CN=DigiCert SHA2 Secure Server CA,O=DigiCert Inc,C=US");
pref("media.gmp-manager.certs.1.commonName", "aus5.mozilla.org");
pref("media.gmp-manager.certs.2.issuerName", "CN=thawte SSL CA - G2,O=\"thawte, Inc.\",C=US");
pref("media.gmp-manager.certs.2.commonName", "aus5.mozilla.org");
pref("reader.parse-on-load.enabled", true);
pref("reader.parse-node-limit", 3000);
pref("reader.debug", false);
pref("reader.errors.includeURLs", false);
pref("reader.font_size", 5);
pref("reader.font_type", "sans-serif");
pref("reader.font_type.values", "[\"sans-serif\",\"serif\",\"monospace\"]");
pref("reader.font_weight", "regular");
pref("reader.font_weight.values", "[\"regular\",\"light\",\"bold\"]");
pref("reader.content_width", 3);
pref("reader.line_height", 4);
pref("reader.character_spacing", 0);
pref("reader.word_spacing", 0);
pref("reader.text_alignment", "start");
pref("reader.color_scheme", "auto");
pref("reader.color_scheme.values", "[\"auto\",\"light\",\"dark\",\"sepia\",\"contrast\",\"gray\"]");
pref("reader.custom_colors.foreground", "");
pref("reader.custom_colors.background", "");
pref("reader.custom_colors.unvisited-links", "");
pref("reader.custom_colors.visited-links", "");
pref("reader.custom_colors.selection-highlight", "");
pref("reader.toolbar.vertical", true);
//@line 3559 "$SRCDIR/modules/libpref/init/all.js"
  pref("narrate.enabled", true);
//@line 3563 "$SRCDIR/modules/libpref/init/all.js"
pref("narrate.test", false);
pref("narrate.rate", 0);
pref("narrate.voice", " { \"default\": \"automatic\" }");
pref("narrate.filter-voices", true);
pref("memory.report_concurrency", 10);
pref("toolkit.pageThumbs.screenSizeDivisor", 7);
pref("toolkit.pageThumbs.minWidth", 0);
pref("toolkit.pageThumbs.minHeight", 0);
pref("webextensions.webRequest.requestBodyMaxRawBytes", 16777216);
pref("webextensions.storage.session.enforceQuota", true);
pref("webextensions.storage.sync.kinto", false);
pref("webextensions.storage.sync.serverURL", "https://webextensions.settings.services.mozilla.com/v1");
pref("dom.input.fallbackUploadDir", "");
pref("plugins.rewrite_youtube_embeds", true);
pref("media.default_volume", "1.0");
pref("dom.storageManager.prompt.testing", false);
pref("dom.storageManager.prompt.testing.allow", false);
pref("browser.storageManager.pressureNotification.minIntervalMS", 1200000);
pref("browser.storageManager.pressureNotification.usageThresholdGB", 5);
pref("browser.sanitizer.loglevel", "Warn");
pref("browser.translations.enable", false);
pref("browser.translations.select.enable", false);
pref("browser.translations.logLevel", "Error");
pref("browser.translations.mostRecentTargetLanguages", "");
pref("browser.translations.alwaysTranslateLanguages", "");
pref("browser.translations.neverTranslateLanguages", "");
pref("browser.translations.useHTML", false);
pref("browser.translations.automaticallyPopup", true);
pref("browser.translations.useLexicalShortlist", false);
pref("browser.translations.simulateUnsupportedEngine", false);
pref("browser.translations.chaos.errors", false);
pref("browser.translations.chaos.timeoutMS", 0);
pref("browser.ml.enable", true);
pref("browser.ml.logLevel", "Error");
pref("browser.ml.modelHubRootUrl", "https://model-hub.mozilla.org/");
pref("browser.ml.modelHubUrlTemplate", "{model}/{revision}");
pref("browser.ml.modelCacheMaxSize", 4);
pref("browser.ml.modelCacheTimeout", 120000);
pref("browser.ml.minimumPhysicalMemory", 3);
pref("browser.ml.checkForMemory", true);
pref("browser.ml.overridePipelineOptions", "{}");
pref("prompts.authentication_dialog_abuse_limit", 2);
pref("dom.payments.request.supportedRegions", "US,CA");
//@line 3681 "$SRCDIR/modules/libpref/init/all.js"
pref("toolkit.aboutProcesses.showAllSubframes", false);
//@line 3688 "$SRCDIR/modules/libpref/init/all.js"
  pref("toolkit.aboutProcesses.showThreads", false);
//@line 3690 "$SRCDIR/modules/libpref/init/all.js"
pref("toolkit.aboutProcesses.showProfilerIcons", true);
pref("toolkit.aboutProcesses.profileDuration", 5);
//@line 3702 "$SRCDIR/modules/libpref/init/all.js"
  pref("toolkit.aboutLogging.uploadProfileToCloud", false);
//@line 3706 "$SRCDIR/modules/libpref/init/all.js"
//@line 3716 "$SRCDIR/modules/libpref/init/all.js"
  pref("toolkit.crashreporter.include_context_heap", false);
//@line 3720 "$SRCDIR/modules/libpref/init/all.js"
pref("toolkit.legacyUserProfileCustomizations.stylesheets", false);
//@line 3728 "$SRCDIR/modules/libpref/init/all.js"
  pref("datareporting.policy.dataSubmissionEnabled", true);
  pref("datareporting.policy.dataSubmissionPolicyNotifiedTime", "0");
  pref("datareporting.policy.dataSubmissionPolicyAcceptedVersion", 0);
  pref("datareporting.policy.currentPolicyVersion", 2);
  pref("datareporting.policy.minimumPolicyVersion", 1);
  pref("datareporting.policy.minimumPolicyVersion.channel-beta", 2);
  pref("datareporting.policy.firstRunURL", "https://www.mozilla.org/privacy/firefox/");
//@line 3736 "$SRCDIR/modules/libpref/init/all.js"
    pref("datareporting.policy.dataSubmissionPolicyBypassNotification", false);
//@line 3741 "$SRCDIR/modules/libpref/init/all.js"
//@line 3744 "$SRCDIR/modules/libpref/init/all.js"
    pref("datareporting.healthreport.infoURL", "https://www.mozilla.org/legal/privacy/firefox.html#health-report");
    pref("datareporting.healthreport.uploadEnabled", true);
    pref("datareporting.usage.uploadEnabled", true);
//@line 3752 "$SRCDIR/modules/libpref/init/all.js"
pref("services.common.log.logger.rest.request", "Debug");
pref("services.common.log.logger.rest.response", "Debug");
pref("services.common.log.logger.tokenserverclient", "Debug");
//@line 3758 "$SRCDIR/modules/libpref/init/all.js"
  pref("services.sync.lastversion", "firstrun");
  pref("services.sync.sendVersionInfo", true);
  pref("services.sync.scheduler.idleInterval", 3600);  // 1 hour
  pref("services.sync.scheduler.activeInterval", 600);   // 10 minutes
  pref("services.sync.scheduler.immediateInterval", 90);    // 1.5 minutes
  pref("services.sync.scheduler.idleTime", 300);   // 5 minutes
  pref("services.sync.scheduler.fxa.singleDeviceInterval", 3600); // 1 hour
  pref("services.sync.engine.addons", true);
  pref("services.sync.engine.addresses", false);
  pref("services.sync.engine.bookmarks", true);
  pref("services.sync.engine.creditcards", false);
  pref("services.sync.engine.history", true);
  pref("services.sync.engine.passwords", true);
  pref("services.sync.engine.prefs", true);
  pref("services.sync.engine.tabs", true);
  pref("services.sync.engine.tabs.filteredSchemes", "about|resource|chrome|file|blob|moz-extension|data");
  pref("services.sync.engine.addresses.available", false);
  pref("services.sync.engine.creditcards.available", false);
  pref("services.sync.addons.ignoreUserEnabledChanges", false);
  pref("services.sync.addons.trustedSourceHostnames", "addons.mozilla.org");
  pref("services.sync.log.appender.console", "Fatal");
  pref("services.sync.log.appender.dump", "Error");
  pref("services.sync.log.appender.file.level", "Trace");
  pref("services.sync.log.appender.file.logOnError", true);
//@line 3802 "$SRCDIR/modules/libpref/init/all.js"
    pref("services.sync.log.appender.file.logOnSuccess", false);
//@line 3804 "$SRCDIR/modules/libpref/init/all.js"
  pref("services.sync.log.appender.file.maxErrorAge", 864000); // 10 days
  pref("services.sync.log.logger", "Debug");
  pref("services.sync.log.logger.engine", "Debug");
  pref("services.sync.log.cryptoDebug", false);
  pref("services.sync.telemetry.submissionInterval", 43200); // 12 hours in seconds
  pref("services.sync.telemetry.maxPayloadCount", 500);
//@line 3827 "$SRCDIR/modules/libpref/init/all.js"
  pref("services.sync.engine.bookmarks.validation.interval", 86400); // 24 hours in seconds
  pref("services.sync.engine.passwords.validation.interval", 86400); // 24 hours in seconds
  pref("services.sync.engine.bookmarks.validation.percentageChance", 10);
  pref("services.sync.engine.passwords.validation.percentageChance", 10);
  pref("services.sync.engine.bookmarks.validation.maxRecords", 1000);
  pref("services.sync.engine.passwords.validation.maxRecords", 1000);
  pref("services.sync.maxResyncs", 1);
  pref("identity.fxaccounts.auth.uri", "https://api.accounts.firefox.com/v1");
  pref("services.sync.extension-storage.skipPercentageChance", 50);
//@line 3853 "$SRCDIR/modules/libpref/init/all.js"
//@line 3855 "$SRCDIR/modules/libpref/init/all.js"
  pref("marionette.debugging.clicktostart", false);
  pref("marionette.port", 2828);
  pref("remote.active-protocols", 1);
//@line 3880 "$SRCDIR/modules/libpref/init/all.js"
    pref("remote.experimental.enabled", false);
//@line 3882 "$SRCDIR/modules/libpref/init/all.js"
  pref("remote.log.level", "Info");
  pref("remote.log.truncate", true);
  pref("remote.prefs.recommended", true);
  pref("remote.retry-on-abort", true);
  pref("remote.experimental-parent-navigation.enabled", false);
//@line 3905 "$SRCDIR/modules/libpref/init/all.js"
pref("devtools.jsonview.enabled", true);
pref("devtools.theme", "auto", sticky);
pref("devtools.policy.disabled", false);
pref("devtools.errorconsole.deprecation_warnings", true);
//@line 3923 "$SRCDIR/modules/libpref/init/all.js"
  pref("devtools.debugger.prompt-connection", true, sticky);
//@line 3925 "$SRCDIR/modules/libpref/init/all.js"
//@line 3927 "$SRCDIR/modules/libpref/init/all.js"
  pref("devtools.chrome.enabled", false, sticky);
  pref("devtools.debugger.remote-enabled", false, sticky);
//@line 3936 "$SRCDIR/modules/libpref/init/all.js"
pref("devtools.debugger.features.windowless-service-workers", true);
pref("devtools.debugger.log", false);
pref("devtools.debugger.log.verbose", false);
pref("devtools.debugger.remote-port", 6000);
pref("devtools.debugger.remote-websocket", false);
pref("devtools.debugger.force-local", true);
pref("devtools.netmonitor.responseBodyLimit", 1048576);
pref("devtools.netmonitor.requestBodyLimit", 1048576);
pref("devtools.netmonitor.msg.messageDataLimit", 100000);
pref("devtools.defaultColorUnit", "authored");
pref("devtools.dump.emit", false);
pref("devtools.discovery.log", false);
pref("devtools.remote.adb.extensionID", "adb@mozilla.org");
pref("devtools.remote.adb.extensionURL", "https://ftp.mozilla.org/pub/labs/devtools/adb-extension/#OS#/adb-extension-latest-#OS#.xpi");
pref("devtools.inspector.inactive.css.enabled", true);
pref("devtools.f12_enabled", true);
//@line 3985 "$SRCDIR/modules/libpref/init/all.js"
pref("dom.postMessage.sharedArrayBuffer.bypassCOOP_COEP.insecure.enabled", false, locked);
//@line 3987 "$SRCDIR/modules/libpref/init/all.js"
pref("extensions.formautofill.available", "detect");
pref("extensions.formautofill.addresses.supported", "detect");
pref("extensions.formautofill.addresses.enabled", true);
pref("extensions.formautofill.addresses.capture.enabled", true);
//@line 4004 "$SRCDIR/modules/libpref/init/all.js"
  pref("extensions.formautofill.addresses.experiments.enabled", false);
//@line 4007 "$SRCDIR/modules/libpref/init/all.js"
pref("extensions.formautofill.addresses.ignoreAutocompleteOff", true);
pref("extensions.formautofill.addresses.supportedCountries", "US,CA,FR,DE");
pref("extensions.formautofill.creditCards.supported", "detect");
pref("extensions.formautofill.creditCards.enabled", true);
pref("extensions.formautofill.creditCards.ignoreAutocompleteOff", true);
pref("extensions.formautofill.creditCards.supportedCountries", "US,CA,GB,FR,DE,IT,ES,AT,BE,PL");
pref("extensions.formautofill.creditCards.heuristics.mode", 2);
pref("extensions.formautofill.creditCards.heuristics.fathom.types", "cc-number,cc-name");
pref("extensions.formautofill.creditCards.heuristics.fathom.confidenceThreshold", "0.5");
pref("extensions.formautofill.creditCards.heuristics.fathom.highConfidenceThreshold", "0.95");
pref("extensions.formautofill.creditCards.heuristics.fathom.testConfidence", "0");
pref("extensions.formautofill.loglevel", "Warn");
pref("extensions.formautofill.heuristics.captureOnFormRemoval", true);
pref("extensions.formautofill.heuristics.captureOnPageNavigation", true);
pref("extensions.formautofill.heuristics.detectDynamicFormChanges", true);
pref("extensions.formautofill.heuristics.fillOnDynamicFormChanges", true);
pref("extensions.formautofill.heuristics.fillOnDynamicFormChanges.timeout", 1000);
pref("extensions.formautofill.heuristics.refillOnSiteClearingFields", true);
pref("extensions.formautofill.heuristics.refillOnSiteClearingFields.timeout", 500);
pref("extensions.formautofill.heuristics.autofillSameOriginWithTop", true);
//@line 4049 "$SRCDIR/modules/libpref/init/all.js"
pref("toolkit.osKeyStore.loglevel", "Warn");
pref("extensions.formautofill.supportRTL", false);
pref("cookiebanners.listService.logLevel", "Error");
pref("cookiebanners.bannerClicking.logLevel", "Error");
pref("cookiebanners.bannerClicking.enabled", true);
pref("cookiebanners.bannerClicking.testing", false);
pref("cookiebanners.bannerClicking.timeoutAfterLoad", 5000);
pref("cookiebanners.bannerClicking.timeoutAfterDOMContentLoaded", 20000);
pref("cookiebanners.bannerClicking.pollingInterval", 500);
pref("cookiebanners.listService.testRules", "[]");
pref("cookiebanners.listService.testSkipRemoteSettings", false);
pref("dom.sitepermsaddon-provider.separatedBlocklistedDomains", "shopee.co.th,shopee.tw,shopee.co.id,shopee.com.my,shopee.vn,shopee.ph,shopee.sg,shopee.com.br,shopee.com,shopee.cn,shopee.io,shopee.pl,shopee.com.mx,shopee.com.co,shopee.cl,shopee.kr,shopee.es,shopee.in,alipay.com,miravia.es");
pref("privacy.query_stripping.listService.logLevel", "Error");
pref("extensions.webcompat.useScriptingAPI", true);
pref("privacy.fingerprintingProtection.WebCompatService.logLevel", "Error");
pref("privacy.query_stripping.strip_on_share.enableTestMode", false);
//@line 4106 "$SRCDIR/modules/libpref/init/all.js"
  pref("toolkit.backgroundtasks.tests.geckoPrefsInherited", 17);
  pref("toolkit.backgroundtasks.tests.geckoPrefsOverriden", 18);
//@line 4111 "$SRCDIR/modules/libpref/init/all.js"
pref("privacy.query_stripping.strip_on_share.canDisable", true);
pref("captchadetection.loglevel", "Warn");
pref("captchadetection.actor.enabled", true);
