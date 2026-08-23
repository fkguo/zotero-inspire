import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InspireReferencePanelController,
  ZInspireReferencePane,
  getItemPaneMaterializationKey,
  getSafeLostDashLabelBound,
  resolveMatchIndicesForDisplay,
  resolveCitationRecidForInteraction,
  resolveSafeNumericMatches,
  shouldAttemptOnDemandPDFParse,
} from "../src/modules/zinspire";
import { LabelMatcher } from "../src/modules/inspire/pdfAnnotate/labelMatcher";
import { postProcessLabels } from "../src/modules/inspire/pdfAnnotate/citationParser";
import { ReaderIntegration } from "../src/modules/inspire/pdfAnnotate/readerIntegration";
import {
  initializeOverlayCoordinator,
  shutdownOverlayCoordinator,
} from "../src/modules/inspire/pdfAnnotate/overlayCoordinatorRegistry";
import { localCache } from "../src/modules/inspire/localCache";
import * as referencesService from "../src/modules/inspire/referencesService";
import * as parserModule from "../src/modules/inspire/pdfAnnotate/pdfReferencesParser";
import * as textSampling from "../src/modules/inspire/pdfAnnotate/textSampling";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

describe("Zotero item-pane lifecycle", () => {
  let registered: any;

  beforeEach(() => {
    registered = undefined;
    (globalThis as any).addon = { data: {} };
    (globalThis as any).Zotero = {
      debug: vi.fn(),
      ItemPaneManager: {
        registerSection: vi.fn((options: any) => {
          registered = options;
          return "zoteroinspire-references";
        }),
        unregisterSection: vi.fn(),
      },
    };
    (ZInspireReferencePane as any).registrationKey = undefined;
    (ZInspireReferencePane as any).controllers = new WeakMap();
    (InspireReferencePanelController as any).instances.clear();
    (InspireReferencePanelController as any).citationListenerRegistered = false;
    (InspireReferencePanelController as any).sharedCitationHandler = undefined;
    (InspireReferencePanelController as any).recidAvailableHandler = undefined;
    (InspireReferencePanelController as any).noRecidHandler = undefined;
    (InspireReferencePanelController as any).lastGlobalCitationEventKey =
      undefined;
    (InspireReferencePanelController as any).lastGlobalCitationEventTs = 0;
    (InspireReferencePanelController as any).globalCitationInFlightKey =
      undefined;
    (ReaderIntegration as any).instance = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    (ZInspireReferencePane as any).registrationKey = undefined;
    (ZInspireReferencePane as any).controllers = new WeakMap();
    (InspireReferencePanelController as any).instances.clear();
    (InspireReferencePanelController as any).citationListenerRegistered = false;
    (InspireReferencePanelController as any).sharedCitationHandler = undefined;
    (InspireReferencePanelController as any).recidAvailableHandler = undefined;
    (InspireReferencePanelController as any).noRecidHandler = undefined;
    (InspireReferencePanelController as any).lastGlobalCitationEventKey =
      undefined;
    (InspireReferencePanelController as any).lastGlobalCitationEventTs = 0;
    (InspireReferencePanelController as any).globalCitationInFlightKey =
      undefined;
    (ReaderIntegration as any).instance = null;
    shutdownOverlayCoordinator();
    vi.restoreAllMocks();
  });

  it("does not read References cache or PDF text when a Reader tab opens", async () => {
    vi.useFakeTimers();
    const attachment = { id: 84, parentItemID: 42 };
    const parent = {
      id: 42,
      isRegularItem: () => true,
      getField: (field: string) =>
        field === "archiveLocation" ? "123456" : "",
    };
    const fulltextCache = vi.fn();
    const readCacheFile = vi.fn();
    let tabObserver: { notify: (...args: any[]) => Promise<void> } | undefined;
    const reader = {
      itemID: attachment.id,
      tabID: "reader-tab",
      _window: { Zotero_Tabs: { selectedID: "reader-tab" } },
    };
    Object.assign((globalThis as any).Zotero, {
      Items: {
        get: vi.fn((id: number) =>
          id === attachment.id ? attachment : id === parent.id ? parent : null,
        ),
        getAsync: vi.fn(async (id: number) =>
          id === attachment.id ? attachment : id === parent.id ? parent : null,
        ),
      },
      Fulltext: { getItemCacheFile: fulltextCache },
      File: { getContentsAsync: readCacheFile },
      Reader: {
        getByTabID: vi.fn(() => reader),
      },
      Notifier: {
        registerObserver: vi.fn((observer: any, types: string[]) => {
          if (types.includes("tab")) tabObserver = observer;
          return "tab-observer";
        }),
        unregisterObserver: vi.fn(),
      },
    });
    const coordinator = initializeOverlayCoordinator(false);
    const requestPrewarm = vi
      .spyOn(coordinator, "requestPrewarm")
      .mockImplementation(() => undefined);
    const reconcileTabSelection = vi.spyOn(
      coordinator,
      "reconcileTabSelection",
    );
    const integration = new ReaderIntegration();
    const restoreMapping = vi.spyOn(integration, "ensureCachedPDFMappings");
    const cacheGet = vi.spyOn(localCache, "get");
    const cacheSet = vi.spyOn(localCache, "set");
    const fetchReferences = vi.spyOn(
      referencesService,
      "fetchReferencesEntries",
    );
    const enrichReferences = vi.spyOn(
      referencesService,
      "enrichReferencesEntries",
    );
    const parserFactory = vi.spyOn(parserModule, "getPDFReferencesParser");
    const buildTextCandidates = vi.spyOn(
      textSampling,
      "buildPdfTextCandidatesForReferenceParsing",
    );

    // Drive the notifier used in production, including both immediate select
    // and delayed add paths. Foreground reconciliation is allowed, but neither
    // path may start plugin-owned cache/PDF work.
    (integration as any).initialized = true;
    (integration as any).registerTabNotifier();
    expect(tabObserver).toBeDefined();
    await tabObserver!.notify("select", "tab", ["reader-tab"], {
      "reader-tab": { type: "reader" },
    });
    await tabObserver!.notify("add", "tab", ["reader-tab"], {
      "reader-tab": { type: "reader" },
    });
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(requestPrewarm).not.toHaveBeenCalled();
    expect(reconcileTabSelection).toHaveBeenCalledOnce();
    expect(restoreMapping).not.toHaveBeenCalled();
    expect(cacheGet).not.toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
    expect(fetchReferences).not.toHaveBeenCalled();
    expect(enrichReferences).not.toHaveBeenCalled();
    expect(parserFactory).not.toHaveBeenCalled();
    expect(buildTextCandidates).not.toHaveBeenCalled();
    expect(fulltextCache).not.toHaveBeenCalled();
    expect(readCacheFile).not.toHaveBeenCalled();
  });

  it("keeps the largest printed-label bound monotone across later list estimates", () => {
    const integration = new ReaderIntegration();
    integration.setMaxKnownLabel(84, 250);
    integration.setMaxKnownLabel(84, 200);

    expect(integration.getMaxKnownLabel(84)).toBe(250);
    expect(
      postProcessLabels(["230"], integration.getMaxKnownLabel(84)),
    ).toEqual(["230"]);

    integration.setMaxKnownLabel(84, 300);
    expect(integration.getMaxKnownLabel(84)).toBe(300);
  });

  it("uses printed max only for dense labels and cardinality for a sparse tail", () => {
    const denseReview = Array.from({ length: 11_225 }, (_, index) => ({
      id: `dense-${index}`,
      label: String((index % 700) + 1),
    })) as InspireReferenceEntry[];
    const denseMatcher = new LabelMatcher(denseReview, 84);
    const denseDiagnosis = vi.spyOn(denseMatcher, "diagnoseAlignment");
    const denseBound = getSafeLostDashLabelBound(denseMatcher);
    expect(denseBound).toBe(700);
    expect(denseDiagnosis).not.toHaveBeenCalled();
    expect(postProcessLabels(["6264"], denseBound)).toEqual(["62", "63", "64"]);

    const sparseTail = Array.from({ length: 300 }, (_, index) => ({
      id: `sparse-${index + 1}`,
      label: index < 100 ? String(index + 1) : undefined,
    })) as InspireReferenceEntry[];
    const sparseMatcher = new LabelMatcher(sparseTail, 85);
    const sparseDiagnosis = vi.spyOn(sparseMatcher, "diagnoseAlignment");
    const sparseBound = getSafeLostDashLabelBound(sparseMatcher);
    expect(sparseBound).toBe(300);
    expect(sparseDiagnosis).not.toHaveBeenCalled();
    expect(postProcessLabels(["123"], sparseBound)).toEqual(["123"]);
  });

  it("does not turn genuine high labels into wide unequal-width ranges", () => {
    expect(postProcessLabels(["725"], 700)).toEqual(["725"]);
    expect(postProcessLabels(["123"], 45)).toEqual(["123"]);

    // Preserve historical lost-dash recovery at decimal-width boundaries.
    expect(postProcessLabels(["912"], 79)).toEqual(["9", "10", "11", "12"]);
    expect(postProcessLabels(["99102"], 150)).toEqual([
      "99",
      "100",
      "101",
      "102",
    ]);
  });

  it("reloads a successful persisted mapping after LRU eviction while memoizing misses", async () => {
    const integration = new ReaderIntegration();
    const mapping = {
      parsedAt: 1,
      labelCounts: new Map([["1", 1]]),
      totalLabels: 1,
      confidence: "high" as const,
    };
    const loadCachedPDFMappings = vi
      .spyOn(integration as any, "loadCachedPDFMappings")
      .mockImplementation(async (attachmentItemID: number) => {
        if (attachmentItemID === 999) return false;
        integration.setCachedPDFMapping(attachmentItemID, mapping);
        return true;
      });

    await expect(integration.ensureCachedPDFMappings(1)).resolves.toBe(true);
    for (let attachmentItemID = 2; attachmentItemID <= 31; attachmentItemID++) {
      integration.setCachedPDFMapping(attachmentItemID, mapping);
    }
    expect(integration.getCachedPDFMapping(1)).toBeUndefined();

    await expect(integration.ensureCachedPDFMappings(1)).resolves.toBe(true);
    expect(
      loadCachedPDFMappings.mock.calls.filter(([itemID]) => itemID === 1),
    ).toHaveLength(2);

    await expect(integration.ensureCachedPDFMappings(999)).resolves.toBe(false);
    await expect(integration.ensureCachedPDFMappings(999)).resolves.toBe(false);
    expect(
      loadCachedPDFMappings.mock.calls.filter(([itemID]) => itemID === 999),
    ).toHaveLength(1);
  });

  it("does not let an embedded attachment Preview trigger toolbar/startup prewarm", () => {
    const registerEventListener = vi.fn();
    const unregisterEventListener = vi.fn();
    Object.assign((globalThis as any).Zotero, {
      Prefs: { get: vi.fn(() => true) },
      Reader: {
        registerEventListener,
        unregisterEventListener,
      },
      Notifier: {
        registerObserver: vi.fn(() => "observer"),
        unregisterObserver: vi.fn(),
      },
      Items: { get: vi.fn(() => null) },
    });
    const coordinator = initializeOverlayCoordinator(true);
    const startupSweep = vi.spyOn(coordinator, "startupSweep");
    const integration = new ReaderIntegration();

    expect(integration.initialize()).toBe(true);
    expect(registerEventListener).toHaveBeenCalledTimes(1);
    expect(registerEventListener).toHaveBeenCalledWith(
      "renderTextSelectionPopup",
      expect.any(Function),
      expect.any(String),
    );
    expect(registerEventListener).not.toHaveBeenCalledWith(
      "renderToolbar",
      expect.anything(),
      expect.anything(),
    );
    expect(startupSweep).not.toHaveBeenCalled();

    integration.cleanup();
  });

  it("primes one marker-local target on lookup UI interaction and completes a timed-out hover", async () => {
    const coordinator = initializeOverlayCoordinator(false);
    let finish!: (value: any) => void;
    const target = new Promise<any>((resolve) => {
      finish = resolve;
    });
    const resolveLinkedReference = vi
      .spyOn(coordinator, "resolveLinkedReference")
      .mockReturnValue(target);
    const integration = new ReaderIntegration();
    const reader = { itemID: 84 };
    const context = {
      readerRef: { deref: () => reader },
      sourceAttachmentItemID: 84,
      parentItemID: 42,
      linkedReferenceCapture: {
        kind: "linked",
        handle: "linked-ref-test",
        label: "27",
      },
    } as any;

    (integration as any).primeLinkedReference(context);
    (integration as any).primeLinkedReference(context);
    expect(resolveLinkedReference).toHaveBeenCalledOnce();

    const button = { isConnected: true } as HTMLElement;
    (integration as any).currentPreviewButton = button;
    const retry = vi
      .spyOn(integration as any, "emitPreviewRequest")
      .mockResolvedValue(undefined);
    (integration as any).scheduleLinkedReferencePreviewRetry(
      button,
      context,
      "27",
      "numeric",
      ["27"],
    );
    finish({
      kind: "resolved",
      label: "27",
      text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
      source: "link-target",
    });
    await target;
    await Promise.resolve();

    expect(retry).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith(button, context, "27", "numeric", [
      "27",
    ]);
  });

  it("keeps off-screen item changes state-only and loads on visible async render", async () => {
    ZInspireReferencePane.registerPanel();
    expect(registered).toBeTruthy();

    const body = {
      closest: vi.fn(() => ({
        open: true,
        hasAttribute: vi.fn(() => true),
      })),
    } as unknown as HTMLDivElement;
    const handleItemChange = vi.fn().mockResolvedValue(undefined);
    const handleVisibleItemChange = vi.fn().mockResolvedValue(undefined);
    (ZInspireReferencePane as any).controllers.set(body, {
      handleItemChange,
      handleVisibleItemChange,
    });
    const args = { body } as any;

    registered.onItemChange(args);
    await Promise.resolve();
    expect(handleItemChange).toHaveBeenNthCalledWith(1, args, {
      loadData: false,
    });

    await registered.onAsyncRender(args);
    expect(handleVisibleItemChange).toHaveBeenCalledWith(args);
  });

  it("uses bounded geometry and toggle state when an older host wrapper is unknown", async () => {
    ZInspireReferencePane.registerPanel();
    expect(registered).toBeTruthy();

    const visibleBody = {
      hidden: false,
      offsetHeight: 120,
      closest: vi.fn(() => null),
      getBoundingClientRect: vi.fn(() => ({ height: 120 })),
    } as unknown as HTMLDivElement;
    const visibleLoad = vi.fn().mockResolvedValue(undefined);
    (ZInspireReferencePane as any).controllers.set(visibleBody, {
      handleVisibleItemChange: visibleLoad,
    });
    const visibleArgs = { body: visibleBody } as any;
    await registered.onAsyncRender(visibleArgs);
    expect(visibleLoad).toHaveBeenCalledWith(visibleArgs);

    const collapsedBody = {
      hidden: false,
      offsetHeight: 0,
      closest: vi.fn(() => null),
      getBoundingClientRect: vi.fn(() => ({ height: 0 })),
    } as unknown as HTMLDivElement;
    const collapsedLoad = vi.fn().mockResolvedValue(undefined);
    (ZInspireReferencePane as any).controllers.set(collapsedBody, {
      handleVisibleItemChange: collapsedLoad,
    });
    await registered.onAsyncRender({ body: collapsedBody } as any);
    expect(collapsedLoad).not.toHaveBeenCalled();

    const toggleLoad = vi.fn().mockResolvedValue(undefined);
    (ZInspireReferencePane as any).controllers.set(collapsedBody, {
      handleVisibleItemChange: toggleLoad,
    });
    const toggleArgs = {
      body: collapsedBody,
      event: {
        currentTarget: {
          hasAttribute: vi.fn((name: string) => name === "open"),
        },
      },
    } as any;
    registered.onToggle(toggleArgs);
    await vi.waitFor(() => expect(toggleLoad).toHaveBeenCalledWith(toggleArgs));
  });

  it("does not load, auto-check, or render during a real collapsed item change", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const loadEntries = vi.fn().mockResolvedValue(undefined);
    const performAutoCheck = vi.fn().mockResolvedValue(undefined);
    const renderChartLoading = vi.fn();
    const renderMessage = vi.fn();
    const updateSortSelector = vi.fn();
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 7,
      currentRecid: "7",
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      selectedEntryIDs: new Set(),
      chartSelectedBins: new Set(),
      allEntries: [{ id: "old" }],
      lastRenderedEntries: [{ id: "old" }],
      isFavoritesViewActive: false,
      updateBatchToolbarVisibility: vi.fn(),
      clearAutoCheckNotification: vi.fn(),
      clearEntryCitedContext: vi.fn(),
      cancelActiveRequest: vi.fn(),
      loadEntries,
      performAutoCheck,
      renderChartLoading,
      renderMessage,
      updateSortSelector,
      getLoadingMessageForMode: vi.fn(() => "Loading references"),
      restoreScrollPositionIfNeeded: vi.fn(),
    });
    const item = {
      id: 42,
      isRegularItem: () => true,
      getField: (field: string) =>
        field === "archiveLocation" ? "123456" : "",
    };

    await controller.handleItemChange({ tabType: "library", item } as any, {
      loadData: false,
    });

    expect(controller.currentItemID).toBe(42);
    expect(controller.currentRecid).toBe("123456");
    expect(controller.pendingAutoCheckItemID).toBe(42);
    expect(controller.pendingVisibleItemSwitchID).toBe(42);
    expect(loadEntries).not.toHaveBeenCalled();
    expect(performAutoCheck).not.toHaveBeenCalled();
    expect(renderChartLoading).not.toHaveBeenCalled();
    expect(renderMessage).not.toHaveBeenCalled();
    expect(updateSortSelector).not.toHaveBeenCalled();

    await controller.handleItemChange({ tabType: "library", item } as any, {
      loadData: true,
    });
    expect(renderChartLoading).toHaveBeenCalledOnce();
    expect(renderMessage).toHaveBeenCalledWith("Loading references");
    expect(loadEntries).toHaveBeenCalledWith("123456", "references");
    expect(performAutoCheck).toHaveBeenCalledWith(item, "123456");
    expect(controller.pendingVisibleItemSwitchID).toBeUndefined();
  });

  it("clears the previous recid before a deferred lookup for another item", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 7,
      currentRecid: "old-item-recid",
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      selectedEntryIDs: new Set(),
      chartSelectedBins: new Set(),
      allEntries: [{ id: "old" }],
      lastRenderedEntries: [{ id: "old" }],
      isFavoritesViewActive: false,
      updateBatchToolbarVisibility: vi.fn(),
      clearAutoCheckNotification: vi.fn(),
      clearEntryCitedContext: vi.fn(),
      cancelActiveRequest: vi.fn(),
    });
    const item = {
      id: 42,
      isRegularItem: () => true,
      getField: () => "",
    };

    await controller.handleItemChange({ tabType: "library", item } as any, {
      loadData: false,
    });

    expect(controller.currentItemID).toBe(42);
    expect(controller.currentRecid).toBeUndefined();
    expect(controller.pendingVisibleItemSwitchID).toBe(42);
  });

  it("keeps Reader recid notifications state-only while the section is collapsed", async () => {
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    const body = {
      closest: vi.fn(() => ({
        open: false,
        hasAttribute: vi.fn(() => false),
      })),
    } as unknown as HTMLDivElement;
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const loadEntries = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const renderChartImmediate = vi.fn();
    const renderMessage = vi.fn();
    const updateSortSelector = vi.fn();
    Object.assign(controller, {
      body,
      currentItemID: 42,
      currentRecid: undefined,
      allEntries: [{ id: "old" }],
      lastRenderedEntries: [{ id: "old" }],
      lastAsyncRenderKey: "old:key",
      asyncRenderLoad: { key: "old:key", promise: Promise.resolve() },
      loadEntries,
      showToast,
      renderChartImmediate,
      renderMessage,
      updateSortSelector,
    });
    (InspireReferencePanelController as any).instances.add(controller);
    (controller as any).initPdfCitationLookup();

    (integration as any).emit("itemRecidAvailable", {
      parentItemID: 42,
      recid: "123456",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.currentRecid).toBe("123456");
    expect(controller.pendingVisibleItemSwitchID).toBe(42);
    expect(controller.lastAsyncRenderKey).toBeUndefined();
    expect(loadEntries).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(updateSortSelector).not.toHaveBeenCalled();

    (integration as any).emit("itemNoRecid", { parentItemID: 42 });
    expect(controller.currentRecid).toBeUndefined();
    expect(controller.allEntries).toEqual([]);
    expect(controller.lastRenderedEntries).toEqual([]);
    expect(renderChartImmediate).not.toHaveBeenCalled();
    expect(renderMessage).not.toHaveBeenCalled();
    expect(updateSortSelector).not.toHaveBeenCalled();

    controller.currentRecid = "still-42";
    controller.allEntries = [{ id: "still-42" }];
    (integration as any).emit("itemRecidAvailable", {
      parentItemID: 99,
      recid: "wrong-item",
    });
    (integration as any).emit("itemNoRecid", { parentItemID: 99 });
    await Promise.resolve();
    expect(controller.currentRecid).toBe("still-42");
    expect(controller.allEntries).toEqual([{ id: "still-42" }]);
    expect(loadEntries).not.toHaveBeenCalled();
  });

  it("preserves attachment parse-attempt state across item switches", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 7,
      currentRecid: "old-item-recid",
      labelMatcherCache: new Map([[84, { stale: true }]]),
      pdfParseAttemptedMap: new Map([[84, true]]),
      pdfParseFallbackWarningShown: new Set([84]),
      selectedEntryIDs: new Set(),
      chartSelectedBins: new Set(),
      allEntries: [],
      lastRenderedEntries: [],
      isFavoritesViewActive: false,
      updateBatchToolbarVisibility: vi.fn(),
      clearAutoCheckNotification: vi.fn(),
      clearEntryCitedContext: vi.fn(),
      cancelActiveRequest: vi.fn(),
    });
    const item = {
      id: 42,
      isRegularItem: () => true,
      getField: () => "",
    };

    await controller.handleItemChange({ tabType: "library", item } as any, {
      loadData: false,
    });

    expect(controller.labelMatcherCache.size).toBe(0);
    expect(controller.pdfParseAttemptedMap.get(84)).toBe(true);
    expect(controller.pdfParseFallbackWarningShown.has(84)).toBe(true);
  });

  it("preserves a remotely resolved recid on same-item state-only notifications", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "remote-recid",
    });
    const item = {
      id: 42,
      isRegularItem: () => true,
      getField: () => "",
    };

    await controller.handleItemChange({ tabType: "library", item } as any, {
      loadData: false,
    });

    expect(controller.currentRecid).toBe("remote-recid");
  });

  it("fails closed when the host collapsible wrapper cannot be identified", async () => {
    ZInspireReferencePane.registerPanel();
    const body = {
      closest: vi.fn(() => null),
    } as unknown as HTMLDivElement;
    const handleVisibleItemChange = vi.fn().mockResolvedValue(undefined);
    (ZInspireReferencePane as any).controllers.set(body, {
      handleVisibleItemChange,
    });

    await registered.onAsyncRender({ body } as any);
    expect(handleVisibleItemChange).not.toHaveBeenCalled();
  });

  it("uses Zotero's backing open attribute for collapsed and empty-open sections", async () => {
    ZInspireReferencePane.registerPanel();
    const section = {
      open: false,
      hasAttribute: vi.fn(() => false),
    };
    const body = {
      closest: vi.fn(() => section),
    } as unknown as HTMLDivElement;
    const handleVisibleItemChange = vi.fn().mockResolvedValue(undefined);
    (ZInspireReferencePane as any).controllers.set(body, {
      handleVisibleItemChange,
    });
    const args = { body } as any;

    await registered.onAsyncRender(args);
    registered.onToggle(args);
    await Promise.resolve();
    expect(handleVisibleItemChange).not.toHaveBeenCalled();
    expect(body.closest).toHaveBeenCalledWith(
      "collapsible-section, .collapsible-section",
    );

    // Zotero 10's getter stays false while `empty` is set. Opening an empty
    // custom section still adds the backing attribute, which must trigger the
    // first materialization and break that empty-state cycle.
    section.hasAttribute.mockReturnValue(true);
    await registered.onAsyncRender(args);
    expect(handleVisibleItemChange).toHaveBeenCalledWith(args);
  });

  it("loads through Zotero's explicit open-toggle hook", async () => {
    ZInspireReferencePane.registerPanel();
    const section = {
      open: true,
      hasAttribute: vi.fn(() => true),
    };
    const body = {
      closest: vi.fn(() => section),
    } as unknown as HTMLDivElement;
    const handleVisibleItemChange = vi.fn().mockResolvedValue(undefined);
    (ZInspireReferencePane as any).controllers.set(body, {
      handleVisibleItemChange,
    });
    const args = { body } as any;

    registered.onToggle(args);
    await Promise.resolve();
    expect(handleVisibleItemChange).toHaveBeenCalledOnce();
    expect(handleVisibleItemChange).toHaveBeenCalledWith(args);
  });

  it("contains item-pane callback rejections instead of propagating into Zotero", async () => {
    ZInspireReferencePane.registerPanel();
    const section = { open: true, hasAttribute: vi.fn(() => true) };
    const body = {
      closest: vi.fn(() => section),
    } as unknown as HTMLDivElement;
    const failure = new Error("render failed");
    const handleVisibleItemChange = vi.fn().mockRejectedValue(failure);
    const handleItemChange = vi.fn().mockRejectedValue(failure);
    (ZInspireReferencePane as any).controllers.set(body, {
      handleVisibleItemChange,
      handleItemChange,
    });
    const args = { body } as any;

    await expect(registered.onAsyncRender(args)).resolves.toBeUndefined();
    registered.onToggle(args);
    registered.onItemChange(args);
    await Promise.resolve();

    expect((globalThis as any).Zotero.debug).toHaveBeenCalledWith(
      expect.stringContaining("Item-pane async render failed"),
    );
    expect((globalThis as any).Zotero.debug).toHaveBeenCalledWith(
      expect.stringContaining("Item-pane toggle load failed"),
    );
    expect((globalThis as any).Zotero.debug).toHaveBeenCalledWith(
      expect.stringContaining("Item-pane state update failed"),
    );
  });

  it("retries an aborted visible load instead of marking it materialized", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const abort = Object.assign(new Error("cancelled"), {
      name: "AbortError",
    });
    const loadEntries = vi
      .fn()
      .mockRejectedValueOnce(abort)
      .mockResolvedValueOnce(undefined);
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "123",
      pendingAutoCheckItemID: undefined,
      lastAsyncRenderKey: undefined,
      asyncRenderLoad: undefined,
      visibleItemLoad: undefined,
      allEntries: [],
      restoreScrollPositionIfNeeded: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
    });
    const item = {
      id: 42,
      isRegularItem: () => true,
      getField: (field: string) => (field === "archiveLocation" ? "123" : ""),
    };
    const args = { tabType: "library", item } as any;

    await controller.handleItemChange(args, { loadData: true });
    expect(loadEntries).toHaveBeenCalledTimes(1);
    expect(controller.lastAsyncRenderKey).toBeUndefined();

    await controller.handleItemChange(args, { loadData: true });
    expect(loadEntries).toHaveBeenCalledTimes(2);
    expect(controller.lastAsyncRenderKey).toBe("42:123:references");
  });

  it("resolves a missing local recid only after an explicit interaction", async () => {
    const remote = vi.fn().mockResolvedValue("987654");
    const noLocalRecid = {
      getField: vi.fn(() => ""),
    } as any;
    await expect(
      resolveCitationRecidForInteraction(noLocalRecid, remote),
    ).resolves.toBe("987654");
    expect(remote).toHaveBeenCalledOnce();

    const localRecid = {
      getField: vi.fn((field: string) =>
        field === "archiveLocation" ? "123456" : "",
      ),
    } as any;
    remote.mockClear();
    await expect(
      resolveCitationRecidForInteraction(localRecid, remote),
    ).resolves.toBe("123456");
    expect(remote).not.toHaveBeenCalled();
  });

  it("does not let a stale visible recid lookup overwrite a same-item notification", async () => {
    let finishLookup!: (recid: string | null) => void;
    const fetchRecidForItem = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finishLookup = resolve;
        }),
    );
    const loadEntries = vi.fn().mockResolvedValue(undefined);
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: undefined,
      recidStateRevision: 0,
      pendingAutoCheckItemID: undefined,
      pendingVisibleItemSwitchID: undefined,
      lastAsyncRenderKey: undefined,
      asyncRenderLoad: undefined,
      visibleItemLoad: { key: "pending", promise: Promise.resolve() },
      allEntries: [],
      lastRenderedEntries: [],
      fetchRecidForItem,
      restoreScrollPositionIfNeeded: vi.fn(),
      cancelActiveRequest: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
    });
    const item = {
      id: 42,
      isRegularItem: () => true,
      getField: () => "",
    };

    const visibleLoad = controller.handleItemChange(
      { tabType: "library", item } as any,
      { loadData: true },
    );
    await vi.waitFor(() => expect(fetchRecidForItem).toHaveBeenCalledOnce());
    await controller.handleRecidBecameAvailable(42, "new-recid", {
      loadData: false,
    });
    finishLookup("stale-recid");
    await visibleLoad;

    expect(controller.currentRecid).toBe("new-recid");
    expect(controller.pendingVisibleItemSwitchID).toBe(42);
    expect(controller.visibleItemLoad).toBeUndefined();
    expect(loadEntries).not.toHaveBeenCalled();
  });

  it("does not resurrect a recid after a newer no-recid notification", async () => {
    let finishLookup!: (recid: string | null) => void;
    const fetchRecidForItem = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finishLookup = resolve;
        }),
    );
    const loadEntries = vi.fn().mockResolvedValue(undefined);
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: undefined,
      recidStateRevision: 0,
      pendingAutoCheckItemID: undefined,
      pendingVisibleItemSwitchID: undefined,
      lastAsyncRenderKey: undefined,
      asyncRenderLoad: undefined,
      visibleItemLoad: { key: "pending", promise: Promise.resolve() },
      allEntries: [],
      lastRenderedEntries: [],
      fetchRecidForItem,
      restoreScrollPositionIfNeeded: vi.fn(),
      cancelActiveRequest: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
    });
    const item = {
      id: 42,
      isRegularItem: () => true,
      getField: () => "",
    };

    const visibleLoad = controller.handleItemChange(
      { tabType: "library", item } as any,
      { loadData: true },
    );
    await vi.waitFor(() => expect(fetchRecidForItem).toHaveBeenCalledOnce());
    controller.handleNoRecid(42, { render: false });
    finishLookup("stale-recid");
    await visibleLoad;

    expect(controller.currentRecid).toBeUndefined();
    expect(controller.pendingVisibleItemSwitchID).toBe(42);
    expect(controller.visibleItemLoad).toBeUndefined();
    expect(loadEntries).not.toHaveBeenCalled();
  });

  it("uses a newer recid notification when a cross-item citation sync finishes late", async () => {
    let finishLookup!: (recid: string | null) => void;
    const fetchRecidForItem = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finishLookup = resolve;
        }),
    );
    const entry = { id: "new-entry", label: "1" } as InspireReferenceEntry;
    const loadEntries = vi.fn(async (recid: string) => {
      if (recid === "new-recid") controller.allEntries = [entry];
    });
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign((globalThis as any).Zotero, {
      Items: {
        get: vi.fn(() => ({
          id: 42,
          isRegularItem: () => true,
          getField: () => "",
        })),
      },
    });
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 99,
      currentRecid: "old-item-recid",
      recidStateRevision: 0,
      currentAttachmentID: undefined,
      labelMatcherCache: new Map(),
      allEntries: [],
      lastRenderedEntries: [],
      lastAsyncRenderKey: undefined,
      asyncRenderLoad: undefined,
      fetchRecidForItem,
      cancelActiveRequest: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
      renderChartImmediate: vi.fn(),
      renderMessage: vi.fn(),
    });

    const sync = controller.ensureItemForCitation(42);
    await vi.waitFor(() => expect(fetchRecidForItem).toHaveBeenCalledOnce());
    await controller.handleRecidBecameAvailable(42, "new-recid", {
      loadData: false,
    });
    finishLookup("stale-recid");

    await expect(sync).resolves.toBe(true);
    expect(controller.currentRecid).toBe("new-recid");
    expect(loadEntries).toHaveBeenCalledOnce();
    expect(loadEntries).toHaveBeenCalledWith("new-recid", "references");
    expect(loadEntries).not.toHaveBeenCalledWith("stale-recid", "references");
  });

  it("shares concurrent visible renders for the same item and mode", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    let finish!: () => void;
    const loadEntries = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "123",
      pendingAutoCheckItemID: undefined,
      lastAsyncRenderKey: undefined,
      asyncRenderLoad: undefined,
      allEntries: [],
      restoreScrollPositionIfNeeded: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
    });
    const item = {
      id: 42,
      isRegularItem: () => true,
      getField: (field: string) => (field === "archiveLocation" ? "123" : ""),
    };
    const args = { tabType: "library", item } as any;

    const first = controller.handleVisibleItemChange(args);
    const second = controller.handleVisibleItemChange(args);
    expect(loadEntries).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    expect(controller.lastAsyncRenderKey).toBe("42:123:references");
  });

  it("starts a new visible flight for a different item while the old one is pending", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const finish = new Map<string, () => void>();
    const loadEntries = vi.fn(
      (recid: string) =>
        new Promise<void>((resolve) => {
          finish.set(recid, resolve);
        }),
    );
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 7,
      currentRecid: "7",
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      selectedEntryIDs: new Set(),
      chartSelectedBins: new Set(),
      allEntries: [],
      lastRenderedEntries: [],
      isFavoritesViewActive: false,
      pendingAutoCheckItemID: undefined,
      lastAsyncRenderKey: undefined,
      asyncRenderLoad: undefined,
      updateBatchToolbarVisibility: vi.fn(),
      clearAutoCheckNotification: vi.fn(),
      clearEntryCitedContext: vi.fn(),
      cancelActiveRequest: vi.fn(),
      performAutoCheck: vi.fn().mockResolvedValue(undefined),
      renderChartLoading: vi.fn(),
      renderMessage: vi.fn(),
      getLoadingMessageForMode: vi.fn(() => "Loading references"),
      restoreScrollPositionIfNeeded: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
    });
    const item42 = {
      id: 42,
      isRegularItem: () => true,
      getField: (field: string) => (field === "archiveLocation" ? "4200" : ""),
    };
    const item43 = {
      id: 43,
      isRegularItem: () => true,
      getField: (field: string) => (field === "archiveLocation" ? "4300" : ""),
    };

    const oldFlight = controller.handleVisibleItemChange({
      tabType: "library",
      item: item42,
    } as any);
    await vi.waitFor(() => {
      expect(loadEntries).toHaveBeenCalledWith("4200", "references");
    });
    const newFlight = controller.handleVisibleItemChange({
      tabType: "library",
      item: item43,
    } as any);
    await vi.waitFor(() => {
      expect(loadEntries).toHaveBeenCalledWith("4300", "references");
    });

    finish.get("4200")!();
    await oldFlight;
    expect(controller.currentItemID).toBe(43);
    expect(controller.lastAsyncRenderKey).toBeUndefined();
    expect(controller.visibleItemLoad?.key).toBe("library:43:references");

    finish.get("4300")!();
    await newFlight;
    expect(controller.currentItemID).toBe(43);
    expect(controller.currentRecid).toBe("4300");
    expect(controller.lastAsyncRenderKey).toBe("43:4300:references");
    expect(controller.visibleItemLoad).toBeUndefined();
  });

  it("does not let an older visible load materialize after a state-only item switch", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    let finishOldLoad!: () => void;
    const loadEntries = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishOldLoad = resolve;
        }),
    );
    const renderChartImmediate = vi.fn();
    const renderReferenceList = vi.fn();
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 7,
      currentRecid: "7",
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      selectedEntryIDs: new Set(),
      chartSelectedBins: new Set(),
      allEntries: [],
      lastRenderedEntries: [],
      isFavoritesViewActive: false,
      pendingAutoCheckItemID: undefined,
      lastAsyncRenderKey: undefined,
      asyncRenderLoad: undefined,
      updateBatchToolbarVisibility: vi.fn(),
      clearAutoCheckNotification: vi.fn(),
      clearEntryCitedContext: vi.fn(),
      cancelActiveRequest: vi.fn(),
      performAutoCheck: vi.fn().mockResolvedValue(undefined),
      renderChartLoading: vi.fn(),
      renderMessage: vi.fn(),
      getLoadingMessageForMode: vi.fn(() => "Loading references"),
      restoreScrollPositionIfNeeded: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
      renderChartImmediate,
      renderReferenceList,
    });
    const oldItem = {
      id: 42,
      isRegularItem: () => true,
      getField: (field: string) => (field === "archiveLocation" ? "4200" : ""),
    };
    const nextItem = {
      id: 43,
      isRegularItem: () => true,
      getField: (field: string) => (field === "archiveLocation" ? "4300" : ""),
    };

    const oldVisibleLoad = controller.handleItemChange(
      { tabType: "library", item: oldItem } as any,
      { loadData: true },
    );
    await vi.waitFor(() => {
      expect(loadEntries).toHaveBeenCalledWith("4200", "references");
    });

    await controller.handleItemChange(
      { tabType: "library", item: nextItem } as any,
      { loadData: false },
    );
    finishOldLoad();
    await oldVisibleLoad;

    expect(controller.currentItemID).toBe(43);
    expect(controller.currentRecid).toBe("4300");
    expect(controller.lastAsyncRenderKey).toBeUndefined();
    expect(controller.pendingVisibleItemSwitchID).toBe(43);
    expect(renderChartImmediate).not.toHaveBeenCalled();
    expect(renderReferenceList).not.toHaveBeenCalled();
  });

  it("does not render an old item's disk cache after the selected item changes", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    let finishCacheRead!: (value: any) => void;
    vi.spyOn(localCache, "get").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCacheRead = resolve;
        }) as any,
    );
    const renderReferenceList = vi.fn();
    const renderChart = vi.fn();
    const setRefreshButtonLoading = vi.fn();
    const cache = new Map<string, InspireReferenceEntry[]>();
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "4200",
      activeAbort: undefined,
      pendingToken: undefined,
      allEntries: [],
      chartSelectedBins: new Set(),
      referencesCache: cache,
      getCacheForMode: vi.fn(() => cache),
      getSortOptionForMode: vi.fn(() => "default"),
      getCacheKey: vi.fn((recid: string) => recid),
      getLocalCacheType: vi.fn(() => "refs"),
      getSortedReferences: vi.fn((entries: InspireReferenceEntry[]) => [
        ...entries,
      ]),
      getLoadingMessageForMode: vi.fn(() => "Loading references"),
      setStatus: vi.fn(),
      renderMessage: vi.fn(),
      setRefreshButtonLoading,
      updateCacheSourceDisplay: vi.fn(),
      renderChart,
      renderReferenceList,
    });

    const load = (controller as any).loadEntries("4200", "references");
    await Promise.resolve();
    renderReferenceList.mockClear();
    renderChart.mockClear();
    controller.currentItemID = 43;
    controller.currentRecid = "4300";
    finishCacheRead({
      data: [{ id: "stale-row", label: "1" }],
      fromCache: true,
      ageHours: 0,
    });
    await load;

    expect(cache.get("4200")?.[0]?.id).toBe("stale-row");
    expect(controller.currentItemID).toBe(43);
    expect(controller.currentRecid).toBe("4300");
    expect(controller.allEntries).toEqual([]);
    expect(renderChart).not.toHaveBeenCalled();
    expect(renderReferenceList).not.toHaveBeenCalled();
    expect(setRefreshButtonLoading.mock.calls).toEqual([[true], [false]]);
  });

  it("does not let an obsolete disk read stop a successor load's spinner", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    let finishOldRead!: (value: any) => void;
    let finishNewRead!: (value: any) => void;
    vi.spyOn(localCache, "get").mockImplementation(
      (_type: string, recid: string) =>
        new Promise((resolve) => {
          if (recid === "old-recid") finishOldRead = resolve;
          else finishNewRead = resolve;
        }) as any,
    );
    const cache = new Map<string, InspireReferenceEntry[]>();
    const setRefreshButtonLoading = vi.fn();
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "old-recid",
      activeAbort: undefined,
      pendingToken: undefined,
      allEntries: [],
      chartSelectedBins: new Set(),
      referencesCache: cache,
      getCacheForMode: vi.fn(() => cache),
      getSortOptionForMode: vi.fn(() => "default"),
      getCacheKey: vi.fn((recid: string) => recid),
      getLocalCacheType: vi.fn(() => "refs"),
      getSortedReferences: vi.fn((entries: InspireReferenceEntry[]) => [
        ...entries,
      ]),
      getLoadingMessageForMode: vi.fn(() => "Loading references"),
      setStatus: vi.fn(),
      renderMessage: vi.fn(),
      setRefreshButtonLoading,
      updateCacheSourceDisplay: vi.fn(),
      renderChart: vi.fn(),
      renderReferenceList: vi.fn(),
    });

    const oldLoad = (controller as any).loadEntries("old-recid", "references");
    await Promise.resolve();
    controller.currentRecid = "new-recid";
    const newLoad = (controller as any).loadEntries("new-recid", "references");
    await Promise.resolve();

    finishOldRead({
      data: [{ id: "old-row", label: "1" }],
      fromCache: true,
      ageHours: 0,
    });
    await oldLoad;
    expect(setRefreshButtonLoading.mock.calls).toEqual([[true], [true]]);

    finishNewRead({
      data: [{ id: "new-row", label: "1" }],
      fromCache: true,
      ageHours: 0,
    });
    await newLoad;
    expect(setRefreshButtonLoading.mock.calls).toEqual([
      [true],
      [true],
      [false],
    ]);
    expect(controller.allEntries).toEqual([{ id: "new-row", label: "1" }]);
  });

  it("does not render an obsolete References cache after the same item's recid changes", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    let finishCacheRead!: (value: any) => void;
    vi.spyOn(localCache, "get").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCacheRead = resolve;
        }) as any,
    );
    const renderReferenceList = vi.fn();
    const renderChart = vi.fn();
    const cache = new Map<string, InspireReferenceEntry[]>();
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "old-recid",
      activeAbort: undefined,
      pendingToken: undefined,
      allEntries: [],
      chartSelectedBins: new Set(),
      referencesCache: cache,
      getCacheForMode: vi.fn(() => cache),
      getSortOptionForMode: vi.fn(() => "default"),
      getCacheKey: vi.fn((recid: string) => recid),
      getLocalCacheType: vi.fn(() => "refs"),
      getSortedReferences: vi.fn((entries: InspireReferenceEntry[]) => [
        ...entries,
      ]),
      getLoadingMessageForMode: vi.fn(() => "Loading references"),
      setStatus: vi.fn(),
      renderMessage: vi.fn(),
      setRefreshButtonLoading: vi.fn(),
      updateCacheSourceDisplay: vi.fn(),
      renderChart,
      renderReferenceList,
    });

    const load = (controller as any).loadEntries("old-recid", "references");
    await Promise.resolve();
    controller.currentRecid = "new-recid";
    finishCacheRead({
      data: [{ id: "stale-row", label: "1" }],
      fromCache: true,
      ageHours: 0,
    });
    await load;

    // The old result may warm its exact cache key, but it cannot become the
    // visible list for a newer recid on the same Zotero item.
    expect(cache.get("old-recid")?.[0]?.id).toBe("stale-row");
    expect(controller.currentItemID).toBe(42);
    expect(controller.currentRecid).toBe("new-recid");
    expect(controller.allEntries).toEqual([]);
    expect(renderChart).not.toHaveBeenCalled();
    expect(renderReferenceList).not.toHaveBeenCalled();
  });

  it("does not render an obsolete References API result after the same item's recid changes", async () => {
    let finishNetwork!: (entries: InspireReferenceEntry[]) => void;
    vi.spyOn(localCache, "get").mockResolvedValue(null);
    const fetchReferences = vi
      .spyOn(referencesService, "fetchReferencesEntries")
      .mockImplementation(
        () =>
          new Promise<InspireReferenceEntry[]>((resolve) => {
            finishNetwork = resolve;
          }),
      );
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const renderReferenceList = vi.fn();
    const renderChart = vi.fn();
    const cache = new Map<string, InspireReferenceEntry[]>();
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "old-recid",
      activeAbort: undefined,
      pendingToken: undefined,
      allEntries: [],
      chartSelectedBins: new Set(),
      referencesCache: cache,
      getCacheForMode: vi.fn(() => cache),
      getSortOptionForMode: vi.fn(() => "default"),
      getCacheKey: vi.fn((recid: string) => recid),
      getLocalCacheType: vi.fn(() => "refs"),
      getSortedReferences: vi.fn((entries: InspireReferenceEntry[]) => [
        ...entries,
      ]),
      getLoadingMessageForMode: vi.fn(() => "Loading references"),
      setStatus: vi.fn(),
      renderMessage: vi.fn(),
      setRefreshButtonLoading: vi.fn(),
      updateCacheSourceDisplay: vi.fn(),
      renderChart,
      renderReferenceList,
    });

    const load = (controller as any).loadEntries("old-recid", "references");
    await vi.waitFor(() => expect(fetchReferences).toHaveBeenCalledOnce());
    renderReferenceList.mockClear();
    renderChart.mockClear();

    // Exercise the loadEntries closure itself: even if a caller changes the
    // recid without invalidating the token, an abort-unaware API completion is
    // not allowed to render into the new recid's pane.
    controller.currentRecid = "new-recid";
    finishNetwork([{ id: "stale-api-row", label: "1" }]);
    await load;

    expect(cache.get("old-recid")?.[0]?.id).toBe("stale-api-row");
    expect(controller.currentItemID).toBe(42);
    expect(controller.currentRecid).toBe("new-recid");
    expect(controller.allEntries).toEqual([]);
    expect(renderChart).not.toHaveBeenCalled();
    expect(renderReferenceList).not.toHaveBeenCalled();
  });

  it("cancels in-flight callbacks when the same item's recid changes or disappears", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const firstAbort = vi.fn();
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "old-recid",
      activeAbort: { abort: firstAbort },
      pendingToken: "old-token",
      allEntries: [{ id: "old" }],
      lastRenderedEntries: [{ id: "old" }],
      lastAsyncRenderKey: "42:old-recid:references",
      asyncRenderLoad: { key: "old", promise: Promise.resolve() },
    });

    await controller.handleRecidBecameAvailable(42, "new-recid", {
      loadData: false,
    });
    expect(firstAbort).toHaveBeenCalledOnce();
    expect(controller.pendingToken).toBeUndefined();
    expect(controller.currentRecid).toBe("new-recid");

    const secondAbort = vi.fn();
    controller.activeAbort = { abort: secondAbort };
    controller.pendingToken = "new-token";
    controller.handleNoRecid(42, { render: false });
    expect(secondAbort).toHaveBeenCalledOnce();
    expect(controller.pendingToken).toBeUndefined();
    expect(controller.currentRecid).toBeUndefined();
    expect(controller.allEntries).toEqual([]);
  });

  it("does not materialize a References list again after an explicit lookup already rendered it", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const loadEntries = vi.fn().mockResolvedValue(undefined);
    const renderChartImmediate = vi.fn();
    const renderReferenceList = vi.fn();
    Object.assign(controller, {
      viewMode: "references",
      currentItemID: 42,
      currentRecid: "123",
      pendingAutoCheckItemID: undefined,
      lastAsyncRenderKey: getItemPaneMaterializationKey(
        42,
        "123",
        "references",
      ),
      asyncRenderLoad: undefined,
      allEntries: [{ id: "already-rendered" }],
      restoreScrollPositionIfNeeded: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
      renderChartImmediate,
      renderReferenceList,
    });
    const item = {
      id: 42,
      isRegularItem: () => true,
      getField: (field: string) => (field === "archiveLocation" ? "123" : ""),
    };

    await controller.handleItemChange({ tabType: "library", item } as any, {
      loadData: true,
    });

    expect(loadEntries).not.toHaveBeenCalled();
    expect(renderChartImmediate).toHaveBeenCalledOnce();
    expect(renderReferenceList).toHaveBeenCalledWith({
      preserveScroll: true,
    });
  });

  it("shares the complete open-trigger path before recid resolution", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    let finish!: () => void;
    const handleItemChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    Object.assign(controller, {
      viewMode: "references",
      visibleItemLoad: undefined,
      handleItemChange,
    });
    const args = {
      tabType: "library",
      item: { id: 42 },
    } as any;

    const fromAsyncRender = controller.handleVisibleItemChange(args);
    const fromToggle = controller.handleVisibleItemChange(args);
    expect(handleItemChange).toHaveBeenCalledOnce();
    finish();
    await Promise.all([fromAsyncRender, fromToggle]);
    expect(controller.visibleItemLoad).toBeUndefined();
  });

  it("shows exact Zotero text on cold hover without resolving recid or disk cache", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const scheduleShowNativeReference = vi.fn();
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: undefined,
      hoverPreview: { scheduleShowNativeReference },
    });
    const event = {
      parentItemID: 42,
      attachmentItemID: 84,
      label: "27",
      labels: ["27"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: {
        kind: "resolved",
        label: "27",
        text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
        source: "link-target",
      },
    } as any;

    await controller.handleCitationPreviewRequest(event);
    expect(scheduleShowNativeReference).toHaveBeenCalledWith(
      event.linkedReference.text,
      { label: "27", buttonRect: event.buttonRect },
    );
  });

  it("uses a newer recid notification when a current-item hover lookup finishes late", async () => {
    const entry = {
      id: "new-davies",
      label: "27",
      title: "Hypothesis testing",
    } as InspireReferenceEntry;
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    let finishLookup!: (recid: string | null) => void;
    const fetchRecidForItem = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finishLookup = resolve;
        }),
    );
    Object.assign((globalThis as any).Zotero, {
      Items: {
        get: vi.fn(() => ({
          id: 42,
          isRegularItem: () => true,
          getField: () => "",
        })),
      },
    });
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: undefined,
      recidStateRevision: 0,
      currentAttachmentID: 84,
      viewMode: "references",
      referenceSort: "default",
      referencesCache: new Map([["new-recid", [entry]]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      fetchRecidForItem,
      cancelActiveRequest: vi.fn(),
      updateSortSelector: vi.fn(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });
    const event = {
      parentItemID: 42,
      attachmentItemID: 84,
      label: "27",
      labels: ["27"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: undefined,
    } as any;

    const preview = controller.handleCitationPreviewRequest(event);
    await vi.waitFor(() => expect(fetchRecidForItem).toHaveBeenCalledOnce());
    await controller.handleRecidBecameAvailable(42, "new-recid", {
      loadData: false,
    });
    finishLookup("stale-recid");
    await preview;

    expect(controller.currentRecid).toBe("new-recid");
    expect(controller.referencesCache.has("stale-recid")).toBe(false);
    expect(scheduleShowMulti).toHaveBeenCalledWith(
      [entry],
      expect.objectContaining({ label: "27" }),
    );
  });

  it("uses a newer recid notification when a click-time lookup finishes late", async () => {
    const entry = {
      id: "new-davies",
      label: "27",
      title: "Hypothesis testing",
    } as InspireReferenceEntry;
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    vi.spyOn(integration, "setMaxKnownLabel").mockImplementation(
      () => undefined,
    );
    initializeOverlayCoordinator(false);
    let finishLookup!: (recid: string | null) => void;
    const fetchRecidForItem = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finishLookup = resolve;
        }),
    );
    Object.assign((globalThis as any).Zotero, {
      Prefs: { get: vi.fn(() => false) },
      Items: {
        get: vi.fn(() => ({
          id: 42,
          itemType: "journalArticle",
          isRegularItem: () => true,
          getField: () => "",
        })),
      },
    });
    const scrollToEntryByIndex = vi.fn();
    const highlightEntryRows = vi.fn();
    const loadEntries = vi.fn().mockResolvedValue(undefined);
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: undefined,
      recidStateRevision: 0,
      currentReaderTabID: undefined,
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["new-recid", [entry]]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      citationInFlightKey: undefined,
      lastCitationEventKey: undefined,
      lastCitationEventTs: 0,
      allEntries: [entry],
      fetchRecidForItem,
      cancelActiveRequest: vi.fn(),
      updateSortSelector: vi.fn(),
      loadEntries,
      listEl: { children: [{ id: "row" }] },
      body: { isConnected: true },
      ensureINSPIREPaneVisible: vi.fn(() => false),
      scrollToEntryByIndex,
      highlightEntryRows,
      showToast: vi.fn(),
    });
    const event = {
      parentItemID: 42,
      attachmentItemID: 84,
      citation: {
        raw: "[27]",
        type: "numeric",
        labels: ["27"],
        position: null,
      },
      linkedReference: undefined,
      readToken: undefined,
    };

    const lookup = controller.handleCitationLookup(event);
    await vi.waitFor(() => expect(fetchRecidForItem).toHaveBeenCalledOnce());
    await controller.handleRecidBecameAvailable(42, "new-recid", {
      loadData: false,
    });
    finishLookup("stale-recid");
    await lookup;

    expect(controller.currentRecid).toBe("new-recid");
    expect(controller.referencesCache.has("stale-recid")).toBe(false);
    expect(loadEntries).not.toHaveBeenCalled();
    expect(scrollToEntryByIndex).toHaveBeenCalledWith(0);
    expect(highlightEntryRows).toHaveBeenCalledWith([0]);
  });

  it("does not split a high label backed by exact Zotero-native evidence", async () => {
    const entries = Array.from({ length: 64 }, (_, index) => ({
      id: `entry-${index + 1}`,
      label: String(index + 1),
      title: `Reference ${index + 1}`,
    })) as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    const scheduleShowNativeReference = vi.fn();
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", entries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: { scheduleShowNativeReference, scheduleShowMulti },
    });
    const linkedReference = {
      kind: "resolved",
      label: "6264",
      text: "[6264] Exact high-number Zotero reference.",
      source: "link-target",
    } as const;
    const buttonRect = { top: 10, left: 20, bottom: 30, right: 40 };

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "6264",
      labels: ["6264"],
      citationType: "numeric",
      buttonRect,
      linkedReference,
    });

    expect(scheduleShowMulti).not.toHaveBeenCalled();
    expect(scheduleShowNativeReference).toHaveBeenCalledWith(
      linkedReference.text,
      { label: "6264", buttonRect },
    );
  });

  it("corroborates a cold document-level citation overlay before showing it", async () => {
    const entries = [
      { id: "wrong-jhep", label: "27", title: "Wrong chapter record" },
      { id: "separator", label: "28", title: "Chapter separator" },
      { id: "davies", label: "27", title: "Hypothesis testing" },
    ] as InspireReferenceEntry[];
    const cacheGet = vi.spyOn(localCache, "get").mockResolvedValue({
      data: entries,
      fromCache: true,
      ageHours: 0,
    } as any);
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    const scheduleShowNativeReference = vi.fn();
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map(),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: { scheduleShowNativeReference, scheduleShowMulti },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "27",
      labels: ["27"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: {
        kind: "resolved",
        label: "27",
        text: "[27] Wrong JHEP chapter record.",
        source: "citation-overlay",
      },
    });

    expect(cacheGet).toHaveBeenCalledWith("refs", "123");
    expect(scheduleShowNativeReference).not.toHaveBeenCalled();
    expect(scheduleShowMulti).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", undefined],
    [
      "a linked target has no extractable text",
      { kind: "no-evidence" as const, label: "27" },
    ],
  ])(
    "uses the historical disk-cache hover fallback when native evidence is %s",
    async (_case, linkedReference) => {
      const entry = {
        id: "davies",
        label: "27",
        title: "Hypothesis testing",
      } as InspireReferenceEntry;
      const cacheGet = vi.spyOn(localCache, "get").mockResolvedValue({
        data: [entry],
        fromCache: true,
        ageHours: 0,
      } as any);
      const integration = new ReaderIntegration();
      (ReaderIntegration as any).instance = integration;
      vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
      vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
      vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
        undefined,
      );
      initializeOverlayCoordinator(false);
      const scheduleShowMulti = vi.fn();
      const controller = Object.create(
        InspireReferencePanelController.prototype,
      ) as any;
      Object.assign(controller, {
        currentItemID: 42,
        currentRecid: "123",
        currentAttachmentID: 84,
        viewMode: "references",
        referenceSort: "default",
        referencesCache: new Map(),
        labelMatcherCache: new Map(),
        pdfParseAttemptedMap: new Map(),
        hoverPreview: {
          scheduleShowNativeReference: vi.fn(),
          scheduleShowMulti,
        },
      });

      await controller.handleCitationPreviewRequest({
        parentItemID: 42,
        attachmentItemID: 84,
        label: "27",
        labels: ["27"],
        citationType: "numeric",
        buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
        linkedReference,
      });

      expect(cacheGet).toHaveBeenCalledWith("refs", "123");
      expect(scheduleShowMulti).toHaveBeenCalledWith(
        [entry],
        expect.objectContaining({ label: "27" }),
      );
    },
  );

  it("does no recid or cache work after an ambiguous or timed-out native hover", async () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const scheduleShowNativeReference = vi.fn();
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: undefined,
      hoverPreview: { scheduleShowNativeReference },
      referencesCache: {
        get: vi.fn(() => {
          throw new Error("cache must remain untouched");
        }),
      },
    });
    const baseEvent = {
      parentItemID: 42,
      attachmentItemID: 84,
      label: "27",
      labels: ["27"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
    } as const;

    await controller.handleCitationPreviewRequest({
      ...baseEvent,
      linkedReference: { kind: "unresolved", label: "27" },
    });
    await controller.handleCitationPreviewRequest({
      ...baseEvent,
      linkedReference: { kind: "timeout", label: "27" },
    });
    expect(scheduleShowNativeReference).not.toHaveBeenCalled();
    expect(controller.referencesCache.get).not.toHaveBeenCalled();
  });

  it("keeps the production legacy hover matcher for an inconclusive unique warm label", async () => {
    const entry = {
      id: "davies",
      label: "27",
      title: "Hypothesis testing",
    } as InspireReferenceEntry;
    const coordinator = initializeOverlayCoordinator(false);
    const legacyMatch = vi.spyOn(coordinator, "matchLabelsWithReadyNative");
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", [entry]]]),
      labelMatcherCache: new Map(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "27",
      labels: ["27"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: { kind: "unresolved", label: "27" },
    });

    expect(legacyMatch).toHaveBeenCalledOnce();
    expect(scheduleShowMulti).toHaveBeenCalledWith(
      [entry],
      expect.objectContaining({ label: "27" }),
    );
  });

  it("lets the established matcher decide an inconclusive hover when INSPIRE labels are absent", async () => {
    const entries = [
      { id: "first", title: "First reference" },
      { id: "second", title: "Second reference" },
    ] as InspireReferenceEntry[];
    const coordinator = initializeOverlayCoordinator(false);
    const legacyMatch = vi
      .spyOn(coordinator, "matchLabelsWithReadyNative")
      .mockReturnValue([
        {
          pdfLabel: "2",
          entryIndex: 1,
          entryId: "second",
          confidence: "medium",
          matchMethod: "inferred",
        },
      ]);
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", entries]]),
      labelMatcherCache: new Map(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "2",
      labels: ["2"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: { kind: "unresolved", label: "2" },
    });

    expect(legacyMatch).toHaveBeenCalledOnce();
    expect(scheduleShowMulti).toHaveBeenCalledWith(
      [entries[1]],
      expect.objectContaining({ label: "2" }),
    );
  });

  it("restores a persisted mapping before delegating an inconclusive hover", async () => {
    const wrong = {
      id: "first",
      title: "Wrong positional reference",
      doi: "10.1234/wrong",
    } as InspireReferenceEntry;
    const correct = {
      id: "second",
      title: "Mapped reference",
      doi: "10.1234/correct",
    } as InspireReferenceEntry;
    const mapping = {
      parsedAt: 1,
      labelCounts: new Map([
        ["1", 1],
        ["2", 1],
      ]),
      labelPaperInfos: new Map([
        [
          "2",
          [
            {
              rawText: "mapped reference",
              doi: "10.1234/correct",
            },
          ],
        ],
      ]),
      totalLabels: 2,
      confidence: "high" as const,
    };
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    const ensureCachedPDFMappings = vi
      .spyOn(integration, "ensureCachedPDFMappings")
      .mockResolvedValue(true);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(mapping);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign((globalThis as any).Zotero, {
      Prefs: { get: vi.fn(() => true) },
    });
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", [wrong, correct]]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "2",
      labels: ["2"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: { kind: "timeout", label: "2" },
    });

    expect(ensureCachedPDFMappings).toHaveBeenCalledWith(84);
    expect(scheduleShowMulti).toHaveBeenCalledWith(
      [correct],
      expect.objectContaining({ label: "2" }),
    );
  });

  it("keeps a contiguous grouped hover result when native evidence is inconclusive", async () => {
    const entries = [
      { id: "group-first", label: "12", title: "First grouped paper" },
      { id: "group-second", label: "12", title: "Second grouped paper" },
    ] as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    const coordinator = initializeOverlayCoordinator(false);
    const legacyMatch = vi.spyOn(coordinator, "matchLabelsWithReadyNative");
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", entries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "12",
      labels: ["12"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: { kind: "unresolved", label: "12" },
    });

    expect(legacyMatch).not.toHaveBeenCalled();
    expect(scheduleShowMulti).toHaveBeenCalledWith(
      entries,
      expect.objectContaining({ label: "12" }),
    );
  });

  it("refines a four-digit lost-dash token only after the warm-list bound is known", async () => {
    const entries = Array.from({ length: 64 }, (_, index) => ({
      id: `entry-${index + 1}`,
      label: String(index + 1),
      title: `Reference ${index + 1}`,
    })) as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", entries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "6264",
      labels: ["6264"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: undefined,
    });

    expect(scheduleShowMulti).toHaveBeenCalledWith(
      entries.slice(61, 64),
      expect.objectContaining({ label: "6264" }),
    );
  });

  it("refines a lost-dash token for a PDF whose parent is not the active panel item", async () => {
    const entries = Array.from({ length: 64 }, (_, index) => ({
      id: `entry-${index + 1}`,
      label: String(index + 1),
      title: `Reference ${index + 1}`,
    })) as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    vi.spyOn(localCache, "get").mockResolvedValue({
      data: entries,
      fromCache: true,
      ageHours: 0,
    } as any);
    Object.assign((globalThis as any).Zotero, {
      Items: {
        get: vi.fn(() => ({
          id: 42,
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 99,
      currentRecid: "999",
      currentAttachmentID: 198,
      viewMode: "references",
      referencesCache: new Map(),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "6264",
      labels: ["6264"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: undefined,
    });

    expect(localCache.get).toHaveBeenCalledWith("refs", "123");
    expect(scheduleShowMulti).toHaveBeenCalledWith(
      entries.slice(61, 64),
      expect.objectContaining({ label: "6264" }),
    );
  });

  it("corroborates a foreign-panel citation overlay with the cached matcher", async () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      id: `entry-${index + 1}`,
      label: String(index + 1),
      title: `Reference ${index + 1}`,
    })) as InspireReferenceEntry[];
    const davies = {
      id: "davies",
      label: "1",
      title: "Hypothesis testing",
      authors: ["Davies, Robert B."],
      authorText: "Robert B. Davies",
      year: "1987",
      publicationInfo: {
        journal_title: "Biometrika",
        journal_volume: "74",
        page_start: "33",
      },
    } as InspireReferenceEntry;
    entries[0] = davies;
    entries[26] = {
      id: "wrong-positional-27",
      label: "27",
      title: "Wrong positional entry",
    } as InspireReferenceEntry;

    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    vi.spyOn(localCache, "get").mockResolvedValue({
      data: entries,
      fromCache: true,
      ageHours: 0,
    } as any);
    Object.assign((globalThis as any).Zotero, {
      Items: {
        get: vi.fn(() => ({
          id: 42,
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    const scheduleShowNativeReference = vi.fn();
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 99,
      currentRecid: "999",
      currentAttachmentID: 198,
      viewMode: "references",
      referencesCache: new Map(),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: { scheduleShowNativeReference, scheduleShowMulti },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "27",
      labels: ["27"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: {
        kind: "resolved",
        label: "27",
        text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
        source: "citation-overlay",
      },
    });

    expect(localCache.get).toHaveBeenCalledWith("refs", "123");
    expect(scheduleShowMulti).toHaveBeenCalledWith(
      [davies],
      expect.objectContaining({ label: "27" }),
    );
    expect(scheduleShowNativeReference).not.toHaveBeenCalled();
  });

  it("keeps a repeated foreign-panel citation overlay untrusted", async () => {
    const entries = [
      {
        id: "wrong-jhep",
        label: "27",
        title: "Three-pion contribution to hadronic vacuum polarization",
        doi: "10.1007/JHEP08(2019)137",
      },
      { id: "separator", label: "28", title: "Another chapter" },
      {
        id: "davies",
        label: "27",
        title: "Hypothesis testing",
        authors: ["Davies, Robert B."],
        year: "1987",
        publicationInfo: {
          journal_title: "Biometrika",
          journal_volume: "74",
          page_start: "33",
        },
      },
    ] as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    vi.spyOn(localCache, "get").mockResolvedValue({
      data: entries,
      fromCache: true,
      ageHours: 0,
    } as any);
    Object.assign((globalThis as any).Zotero, {
      Items: {
        get: vi.fn(() => ({
          id: 42,
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    const scheduleShowNativeReference = vi.fn();
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 99,
      currentRecid: "999",
      currentAttachmentID: 198,
      viewMode: "references",
      referencesCache: new Map(),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: { scheduleShowNativeReference, scheduleShowMulti },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "27",
      labels: ["27"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: {
        kind: "resolved",
        label: "27",
        text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
        source: "citation-overlay",
      },
    });

    expect(scheduleShowMulti).not.toHaveBeenCalled();
    expect(scheduleShowNativeReference).not.toHaveBeenCalled();
  });

  it("does not split a genuine four-digit label in a large warm list", async () => {
    const entries = Array.from({ length: 1_234 }, (_, index) => ({
      id: `entry-${index + 1}`,
      label: String(index + 1),
      title: `Reference ${index + 1}`,
    })) as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", entries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "1234",
      labels: ["1234"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: undefined,
    });

    expect(scheduleShowMulti).toHaveBeenCalledWith(
      [entries[1_233]],
      expect.objectContaining({ label: "1234" }),
    );
  });

  it("keeps a genuine sparse-tail label intact in the production hover path", async () => {
    const entries = Array.from({ length: 300 }, (_, index) => ({
      id: `entry-${index + 1}`,
      label: index < 100 ? String(index + 1) : undefined,
      title: `Reference ${index + 1}`,
    })) as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123-recid",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123-recid", entries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "123",
      labels: ["123"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: undefined,
    });

    expect(scheduleShowMulti).toHaveBeenCalledWith(
      [entries[122]],
      expect.objectContaining({ label: "123" }),
    );
  });

  it("never splits a raw token that the canonical INSPIRE list already prints", async () => {
    const entry = {
      id: "real-6264",
      label: "6264",
      title: "Genuine high-number reference",
    } as InspireReferenceEntry;
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    // Simulate an adversarial stale/foreign lower estimate. The matcher itself
    // still corroborates that 6264 is a real printed label.
    vi.spyOn(integration, "setMaxKnownLabel").mockImplementation(
      () => undefined,
    );
    vi.spyOn(integration, "getMaxKnownLabel").mockReturnValue(64);
    initializeOverlayCoordinator(false);
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", [entry]]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      hoverPreview: {
        scheduleShowNativeReference: vi.fn(),
        scheduleShowMulti,
      },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "6264",
      labels: ["6264"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: undefined,
    });

    expect(scheduleShowMulti).toHaveBeenCalledWith(
      [entry],
      expect.objectContaining({ label: "6264" }),
    );
  });

  it("falls through to the production legacy hover matcher when exact native text is not a strong metadata match", async () => {
    const entry = {
      id: "atlas-note",
      label: "27",
      title: "ATLAS conference note",
    } as InspireReferenceEntry;
    const coordinator = initializeOverlayCoordinator(false);
    const legacyMatch = vi.spyOn(coordinator, "matchLabelsWithReadyNative");
    const scheduleShowNativeReference = vi.fn();
    const scheduleShowMulti = vi.fn();
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", [entry]]]),
      labelMatcherCache: new Map(),
      hoverPreview: { scheduleShowNativeReference, scheduleShowMulti },
    });

    await controller.handleCitationPreviewRequest({
      parentItemID: 42,
      attachmentItemID: 84,
      label: "27",
      labels: ["27"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
      linkedReference: {
        kind: "resolved",
        label: "27",
        text: "[27] ATLAS Collaboration, ATLAS-CONF-2020-001.",
        source: "link-target",
      },
    });

    expect(legacyMatch).toHaveBeenCalledOnce();
    expect(scheduleShowMulti).toHaveBeenCalledWith(
      [entry],
      expect.objectContaining({ label: "27" }),
    );
    expect(scheduleShowNativeReference).not.toHaveBeenCalled();
  });

  it("uses a warm strict target for a rich card and never guesses on failure", async () => {
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    const correct = {
      id: "davies",
      recid: "2",
      label: "27",
      title: "Hypothesis testing",
      authors: ["Davies, Robert B."],
      authorText: "Robert B. Davies",
      year: "1987",
      publicationInfo: {
        journal_title: "Biometrika",
        journal_volume: "74",
        page_start: "33",
      },
    } as InspireReferenceEntry;
    const wrong = {
      id: "wrong",
      recid: "1",
      label: "27",
      title: "Wrong chapter paper",
      authors: ["Other, A."],
      year: "2019",
      doi: "10.1007/JHEP08(2019)137",
    } as InspireReferenceEntry;
    const separator = {
      id: "chapter-separator",
      label: "28",
      title: "Another chapter reference",
    } as InspireReferenceEntry;
    const makeController = () => {
      const controller = Object.create(
        InspireReferencePanelController.prototype,
      ) as any;
      Object.assign(controller, {
        currentItemID: 42,
        currentRecid: "123",
        currentAttachmentID: 84,
        viewMode: "references",
        referencesCache: new Map([["123", [wrong, separator, correct]]]),
        labelMatcherCache: new Map(),
        hoverPreview: {
          scheduleShowNativeReference: vi.fn(),
          scheduleShowMulti: vi.fn(),
        },
      });
      return controller;
    };
    const baseEvent = {
      parentItemID: 42,
      attachmentItemID: 84,
      label: "27",
      labels: ["27"],
      citationType: "numeric",
      buttonRect: { top: 10, left: 20, bottom: 30, right: 40 },
    } as const;

    const exact = makeController();
    await exact.handleCitationPreviewRequest({
      ...baseEvent,
      linkedReference: {
        kind: "resolved",
        label: "27",
        text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
        source: "link-target",
      },
    });
    expect(exact.hoverPreview.scheduleShowMulti).toHaveBeenCalledWith(
      [correct],
      expect.objectContaining({ label: "27" }),
    );
    expect(
      exact.hoverPreview.scheduleShowNativeReference,
    ).not.toHaveBeenCalled();

    const untrusted = makeController();
    await untrusted.handleCitationPreviewRequest({
      ...baseEvent,
      linkedReference: {
        kind: "resolved",
        label: "27",
        text: "[27] Wrong global chapter record.",
        source: "citation-overlay",
      },
    });
    expect(untrusted.hoverPreview.scheduleShowMulti).not.toHaveBeenCalled();
    expect(
      untrusted.hoverPreview.scheduleShowNativeReference,
    ).not.toHaveBeenCalled();
  });

  it("fails closed in the production click handler for a repeated label without local evidence", async () => {
    const entries = [
      {
        id: "wrong-jhep",
        label: "27",
        title: "Three-pion contribution to hadronic vacuum polarization",
      },
      {
        id: "chapter-separator",
        label: "28",
        title: "Another chapter reference",
      },
      {
        id: "davies",
        label: "27",
        title: "Hypothesis testing",
      },
    ] as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    vi.spyOn(integration, "setMaxKnownLabel").mockImplementation(
      () => undefined,
    );
    const coordinator = initializeOverlayCoordinator(false);
    const legacyMatch = vi.spyOn(coordinator, "matchLabelsWithReadyNative");
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const showToast = vi.fn();
    const ensureINSPIREPaneVisible = vi.fn();
    Object.assign((globalThis as any).Zotero, {
      Prefs: { get: vi.fn(() => true) },
      Items: {
        get: vi.fn(() => ({
          id: 42,
          itemType: "journalArticle",
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentReaderTabID: undefined,
      currentAttachmentID: undefined,
      viewMode: "references",
      referencesCache: new Map([["123", entries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map([[84, true]]),
      pdfParseFallbackWarningShown: new Set(),
      citationInFlightKey: undefined,
      lastCitationEventKey: undefined,
      lastCitationEventTs: 0,
      allEntries: entries,
      showToast,
      ensureINSPIREPaneVisible,
    });

    await (controller as any).handleCitationLookup({
      parentItemID: 42,
      attachmentItemID: 84,
      citation: {
        raw: "[27]",
        type: "numeric",
        labels: ["27"],
        position: null,
      },
      linkedReference: undefined,
      readToken: undefined,
    });

    expect(legacyMatch).not.toHaveBeenCalled();
    expect(ensureINSPIREPaneVisible).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("pdf-annotate-not-found"),
    );
  });

  it("reports not found when a matched entry is absent from the rendered list", async () => {
    const canonicalEntries = [
      { id: "old-27", label: "27", title: "Old cached reference" },
    ] as InspireReferenceEntry[];
    const renderedEntries = [
      { id: "new-28", label: "28", title: "Reloaded reference" },
    ] as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    vi.spyOn(integration, "setMaxKnownLabel").mockImplementation(
      () => undefined,
    );
    initializeOverlayCoordinator(false);
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const showToast = vi.fn();
    const scrollToEntryByIndex = vi.fn();
    Object.assign((globalThis as any).Zotero, {
      Prefs: { get: vi.fn(() => false) },
      Items: {
        get: vi.fn(() => ({
          id: 42,
          itemType: "journalArticle",
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentReaderTabID: undefined,
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", canonicalEntries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      citationInFlightKey: undefined,
      lastCitationEventKey: undefined,
      lastCitationEventTs: 0,
      allEntries: renderedEntries,
      listEl: { children: [{ id: "row" }] },
      body: { isConnected: true },
      ensureINSPIREPaneVisible: vi.fn(() => false),
      scrollToEntryByIndex,
      highlightEntryRows: vi.fn(),
      showToast,
    });

    await (controller as any).handleCitationLookup({
      parentItemID: 42,
      attachmentItemID: 84,
      citation: {
        raw: "[27]",
        type: "numeric",
        labels: ["27"],
        position: null,
      },
      linkedReference: undefined,
      readToken: undefined,
    });

    expect(scrollToEntryByIndex).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("pdf-annotate-not-found"),
    );
  });

  it("keeps a contiguous grouped citation working with the parser disabled by default", async () => {
    const entries = [
      { id: "group-first", label: "12", title: "First grouped paper" },
      { id: "group-second", label: "12", title: "Second grouped paper" },
    ] as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    vi.spyOn(integration, "setMaxKnownLabel").mockImplementation(
      () => undefined,
    );
    const coordinator = initializeOverlayCoordinator(false);
    const legacyMatch = vi.spyOn(coordinator, "matchLabelsWithReadyNative");
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const scrollToEntryByIndex = vi.fn();
    const highlightEntryRows = vi.fn();
    Object.assign((globalThis as any).Zotero, {
      // `pdf_parse_refs_list` is false in addon/prefs.js by default.
      Prefs: { get: vi.fn(() => false) },
      Items: {
        get: vi.fn(() => ({
          id: 42,
          itemType: "journalArticle",
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentReaderTabID: undefined,
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", entries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      citationInFlightKey: undefined,
      lastCitationEventKey: undefined,
      lastCitationEventTs: 0,
      allEntries: entries,
      listEl: { children: [{ id: "row" }] },
      body: { isConnected: true },
      ensureINSPIREPaneVisible: vi.fn(() => false),
      scrollToEntryByIndex,
      highlightEntryRows,
      showToast: vi.fn(),
    });

    await (controller as any).handleCitationLookup({
      parentItemID: 42,
      attachmentItemID: 84,
      citation: {
        raw: "[12]",
        type: "numeric",
        labels: ["12"],
        position: null,
      },
      linkedReference: undefined,
      readToken: undefined,
    });

    expect(legacyMatch).not.toHaveBeenCalled();
    expect(scrollToEntryByIndex).toHaveBeenCalledWith(0);
    expect(highlightEntryRows).toHaveBeenCalledWith([0, 1]);
  });

  it("refines a lost-dash token before production click positioning", async () => {
    const entries = Array.from({ length: 64 }, (_, index) => ({
      id: `entry-${index + 1}`,
      label: String(index + 1),
      title: `Reference ${index + 1}`,
    })) as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    initializeOverlayCoordinator(false);
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const scrollToEntryByIndex = vi.fn();
    const highlightEntryRows = vi.fn();
    Object.assign((globalThis as any).Zotero, {
      Prefs: { get: vi.fn(() => false) },
      Items: {
        get: vi.fn(() => ({
          id: 42,
          itemType: "journalArticle",
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentReaderTabID: undefined,
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", entries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      citationInFlightKey: undefined,
      lastCitationEventKey: undefined,
      lastCitationEventTs: 0,
      allEntries: entries,
      listEl: { children: [{ id: "row" }] },
      body: { isConnected: true },
      ensureINSPIREPaneVisible: vi.fn(() => false),
      scrollToEntryByIndex,
      highlightEntryRows,
      showToast: vi.fn(),
    });

    await (controller as any).handleCitationLookup({
      parentItemID: 42,
      attachmentItemID: 84,
      citation: {
        raw: "[6264]",
        type: "numeric",
        labels: ["6264"],
        position: null,
      },
      linkedReference: undefined,
      readToken: undefined,
    });

    expect(scrollToEntryByIndex).toHaveBeenCalledWith(61);
    expect(highlightEntryRows).toHaveBeenCalledWith([61, 62, 63]);
  });

  it("marks a whole-PDF parse attempt before await and deduplicates a concurrent click", async () => {
    const entries = [
      { id: "chapter-one", label: "27" },
      { id: "chapter-two", label: "27" },
    ] as InspireReferenceEntry[];
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    vi.spyOn(integration, "setMaxKnownLabel").mockImplementation(
      () => undefined,
    );
    initializeOverlayCoordinator(false);
    let finishParse!: (value: boolean) => void;
    const parse = new Promise<boolean>((resolve) => {
      finishParse = resolve;
    });
    const tryParsePDFReferences = vi.fn(() => parse);
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    Object.assign((globalThis as any).Zotero, {
      Prefs: { get: vi.fn(() => true) },
      Items: {
        get: vi.fn(() => ({
          id: 42,
          itemType: "journalArticle",
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentReaderTabID: undefined,
      currentAttachmentID: undefined,
      viewMode: "references",
      referencesCache: new Map([["123", entries]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      citationInFlightKey: undefined,
      lastCitationEventKey: undefined,
      lastCitationEventTs: 0,
      allEntries: entries,
      tryParsePDFReferences,
      showToast: vi.fn(),
      ensureINSPIREPaneVisible: vi.fn(),
    });
    const event = {
      parentItemID: 42,
      attachmentItemID: 84,
      citation: {
        raw: "[27]",
        type: "numeric",
        labels: ["27"],
        position: null,
      },
      linkedReference: undefined,
      readToken: undefined,
    };

    const first = (controller as any).handleCitationLookup(event);
    await vi.waitFor(() => {
      expect(tryParsePDFReferences).toHaveBeenCalledOnce();
    });
    expect(controller.pdfParseAttemptedMap.get(84)).toBe(true);

    await (controller as any).handleCitationLookup(event);
    expect(tryParsePDFReferences).toHaveBeenCalledOnce();

    finishParse(false);
    await first;
    expect(controller.citationInFlightKey).toBeUndefined();
    expect(
      (InspireReferencePanelController as any).globalCitationInFlightKey,
    ).toBe("42:27");
  });

  it("materializes a hover-warmed References cache before click positioning", async () => {
    const entry = {
      id: "davies",
      label: "27",
      title: "Hypothesis testing",
    } as InspireReferenceEntry;
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    vi.spyOn(integration, "setMaxKnownLabel").mockImplementation(
      () => undefined,
    );
    initializeOverlayCoordinator(false);
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const ensureINSPIREPaneVisible = vi.fn(() => false);
    const scrollToEntryByIndex = vi.fn();
    const highlightEntryRows = vi.fn();
    const loadEntries = vi.fn(async () => {
      controller.allEntries = [entry];
    });
    Object.assign((globalThis as any).Zotero, {
      Prefs: { get: vi.fn(() => true) },
      Items: {
        get: vi.fn(() => ({
          id: 42,
          itemType: "journalArticle",
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentReaderTabID: undefined,
      currentAttachmentID: 84,
      viewMode: "references",
      referencesCache: new Map([["123", [entry]]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      citationInFlightKey: undefined,
      lastCitationEventKey: undefined,
      lastCitationEventTs: 0,
      // Hover has warmed only the canonical cache; the sidebar is still cold.
      allEntries: [],
      loadEntries,
      listEl: { children: [{ id: "row" }] },
      body: { isConnected: true },
      ensureINSPIREPaneVisible,
      scrollToEntryByIndex,
      highlightEntryRows,
      showToast: vi.fn(),
    });

    await (controller as any).handleCitationLookup({
      parentItemID: 42,
      attachmentItemID: 84,
      citation: {
        raw: "[27]",
        type: "numeric",
        labels: ["27"],
        position: null,
      },
      linkedReference: undefined,
      readToken: undefined,
    });

    expect(loadEntries).toHaveBeenCalledWith("123", "references");
    expect(loadEntries.mock.invocationCallOrder[0]).toBeLessThan(
      ensureINSPIREPaneVisible.mock.invocationCallOrder[0],
    );
    expect(scrollToEntryByIndex).toHaveBeenCalledWith(0);
    expect(highlightEntryRows).toHaveBeenCalledWith([0]);
  });

  it("locates the marker-local Davies target in a differently sorted sidebar", async () => {
    const wrong = {
      id: "wrong-jhep",
      label: "27",
      title: "Three-pion contribution to hadronic vacuum polarization",
      authors: ["Hoferichter, Martin"],
      year: "2019",
      doi: "10.1007/JHEP08(2019)137",
      publicationInfo: {
        journal_title: "JHEP",
        journal_volume: "08",
        page_start: "137",
      },
    } as InspireReferenceEntry;
    const davies = {
      id: "davies",
      label: "27",
      title: "Hypothesis testing",
      authors: ["Davies, Robert B."],
      year: "1987",
      doi: "10.1093/biomet/74.1.33",
      publicationInfo: {
        journal_title: "Biometrika",
        journal_volume: "74",
        page_start: "33",
      },
    } as InspireReferenceEntry;
    const integration = new ReaderIntegration();
    (ReaderIntegration as any).instance = integration;
    vi.spyOn(integration, "ensureCachedPDFMappings").mockResolvedValue(false);
    vi.spyOn(integration, "getCachedPDFMapping").mockReturnValue(undefined);
    vi.spyOn(integration, "getCachedAuthorYearMapping").mockReturnValue(
      undefined,
    );
    const setMaxKnownLabel = vi
      .spyOn(integration, "setMaxKnownLabel")
      .mockImplementation(() => undefined);
    const coordinator = initializeOverlayCoordinator(false);
    const legacyMatch = vi.spyOn(coordinator, "matchLabelsWithReadyNative");
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const scrollToEntryByIndex = vi.fn();
    const highlightEntryRows = vi.fn();
    Object.assign((globalThis as any).Zotero, {
      Prefs: { get: vi.fn(() => true) },
      Items: {
        get: vi.fn(() => ({
          id: 42,
          itemType: "journalArticle",
          isRegularItem: () => true,
          getField: (field: string) =>
            field === "archiveLocation" ? "123" : "",
        })),
      },
    });
    Object.assign(controller, {
      currentItemID: 42,
      currentRecid: "123",
      currentReaderTabID: undefined,
      currentAttachmentID: undefined,
      viewMode: "references",
      referencesCache: new Map([["123", [wrong, davies]]]),
      labelMatcherCache: new Map(),
      pdfParseAttemptedMap: new Map(),
      pdfParseFallbackWarningShown: new Set(),
      citationInFlightKey: undefined,
      lastCitationEventKey: undefined,
      lastCitationEventTs: 0,
      // Deliberately reverse canonical order to exercise stable-ID targeting.
      allEntries: [davies, wrong],
      listEl: { children: [{ id: "row" }] },
      body: { isConnected: true },
      ensureINSPIREPaneVisible: vi.fn(() => false),
      scrollToEntryByIndex,
      highlightEntryRows,
      showToast: vi.fn(),
    });

    await (controller as any).handleCitationLookup({
      parentItemID: 42,
      attachmentItemID: 84,
      citation: {
        raw: "[27]",
        type: "numeric",
        labels: ["27"],
        position: null,
      },
      linkedReference: {
        kind: "resolved",
        label: "27",
        text: "[27] R. B. Davies, Biometrika 74, 33 (1987).",
        source: "link-target",
      },
      readToken: undefined,
    });

    expect(legacyMatch).not.toHaveBeenCalled();
    expect(setMaxKnownLabel).toHaveBeenCalledWith(84, 27);
    expect(scrollToEntryByIndex).toHaveBeenCalledWith(0);
    expect(highlightEntryRows).toHaveBeenCalledWith([0]);
  });

  it("maps a canonical matcher result into a differently sorted sidebar", () => {
    const canonical = [
      { id: "first", label: "1" },
      { id: "davies", label: "27" },
      { id: "last", label: "99" },
    ] as InspireReferenceEntry[];
    const matcher = new LabelMatcher(canonical, 84);
    const display = [canonical[2], canonical[0], canonical[1]];

    expect(
      resolveMatchIndicesForDisplay(matcher.match("27"), matcher, display),
    ).toEqual([2]);
  });

  it("explicit References refresh permits a fresh parser attempt", () => {
    const controller = Object.create(
      InspireReferencePanelController.prototype,
    ) as any;
    const deleteCache = vi
      .spyOn(localCache, "delete")
      .mockResolvedValue(undefined as never);
    Object.assign((globalThis as any).Zotero, {
      Items: { get: vi.fn(() => ({ id: 42 })) },
    });
    Object.assign(controller, {
      currentRecid: "123",
      currentItemID: 42,
      viewMode: "references",
      referencesCache: new Map([["123", [{ id: "old" }]]]),
      labelMatcherCache: new Map([[84, {}]]),
      pdfParseAttemptedMap: new Map([[84, true]]),
      pdfParseFallbackWarningShown: new Set([84]),
      rowCache: new Map(),
      chartSelectedBins: new Set(),
      clearFocusedEntry: vi.fn(),
      cancelActiveRequest: vi.fn(),
      renderChartLoading: vi.fn(),
      renderMessage: vi.fn(),
      getLoadingMessageForMode: vi.fn(() => "Loading references"),
      loadEntries: vi.fn().mockResolvedValue(undefined),
      allEntries: [{ id: "old" }],
      totalApiCount: 1,
    });

    controller.handleRefresh();

    expect(controller.pdfParseAttemptedMap.size).toBe(0);
    expect(controller.pdfParseFallbackWarningShown.size).toBe(0);
    expect(controller.labelMatcherCache.size).toBe(0);
    expect(deleteCache).toHaveBeenCalledWith("refs", "123");
    expect(controller.loadEntries).toHaveBeenCalledWith("123", "references", {
      force: true,
    });
  });
});

describe("on-demand whole-PDF parse policy", () => {
  const base = {
    linkedStrictMatchCount: 0,
    pdfParseEnabled: true,
    hasPDFMapping: false,
    pdfParseAttempted: false,
    totalEntries: 10_000,
    labelAvailableCount: 10_000,
    recommendation: "USE_INSPIRE_LABEL" as const,
    requestedLabelsNeedMapping: true,
    globalDuplicateLabels: true,
    forcePDFStrict: true,
  };

  it("permits one legacy-parser fallback for repeated-label reviews", () => {
    expect(shouldAttemptOnDemandPDFParse(base)).toBe(true);
  });

  it("does not retry a failed or unproductive whole-document parse", () => {
    expect(
      shouldAttemptOnDemandPDFParse({ ...base, pdfParseAttempted: true }),
    ).toBe(false);
  });

  it("does not parse when the legacy parser preference is disabled", () => {
    expect(
      shouldAttemptOnDemandPDFParse({ ...base, pdfParseEnabled: false }),
    ).toBe(false);
  });

  it("does not parse when Zotero-native text already matched strictly", () => {
    expect(
      shouldAttemptOnDemandPDFParse({ ...base, linkedStrictMatchCount: 1 }),
    ).toBe(false);
  });

  it("does not parse a unique requested label because other review chapters repeat", () => {
    expect(
      shouldAttemptOnDemandPDFParse({
        ...base,
        requestedLabelsNeedMapping: false,
        recommendation: "USE_INDEX_WITH_FALLBACK",
      }),
    ).toBe(false);
  });

  it("retains mismatch parsing when low alignment is not explained by duplicates", () => {
    expect(
      shouldAttemptOnDemandPDFParse({
        ...base,
        requestedLabelsNeedMapping: false,
        globalDuplicateLabels: false,
        recommendation: "USE_INDEX_WITH_FALLBACK",
      }),
    ).toBe(true);
  });

  it("never calls the numeric fallback for a repeated label without local evidence", () => {
    const matcher = new LabelMatcher(
      [
        { id: "chapter-one", label: "27" },
        { id: "chapter-separator", label: "28" },
        { id: "chapter-two", label: "27" },
      ] as InspireReferenceEntry[],
      84,
    );
    const legacyMatch = vi.fn(() => matcher.match("27"));

    expect(
      resolveSafeNumericMatches({
        labels: ["27"],
        matcher,
        linkedStrictMatches: [],
        legacyMatch,
      }),
    ).toEqual([]);
    expect(legacyMatch).not.toHaveBeenCalled();
  });

  it("preserves a bounded contiguous grouped label without a PDF mapping", () => {
    const entries = [
      { id: "group-first", label: "27" },
      { id: "group-second", label: "27" },
    ] as InspireReferenceEntry[];
    const matcher = new LabelMatcher(entries, 84);
    const legacyMatch = vi.fn(() => matcher.match("27"));

    expect(
      resolveSafeNumericMatches({
        labels: ["27"],
        matcher,
        linkedStrictMatches: [],
        legacyMatch,
      }).map((match) => match.entryId),
    ).toEqual(["group-first", "group-second"]);
    expect(legacyMatch).not.toHaveBeenCalled();
  });

  it("does not treat a count-only 11,225-entry mapping as duplicate-label evidence", () => {
    const entries = Array.from({ length: 11_225 }, (_, index) => ({
      id: `chapter-${index}`,
      label: "27",
    })) as InspireReferenceEntry[];
    const matcher = new LabelMatcher(entries, 84);
    matcher.setPDFMapping({
      parsedAt: 1,
      labelCounts: new Map([["27", entries.length]]),
      totalLabels: 1,
      confidence: "high",
    });
    const legacyMatch = vi.fn(() => matcher.match("27"));

    expect(
      resolveSafeNumericMatches({
        labels: ["27"],
        matcher,
        linkedStrictMatches: [],
        legacyMatch,
      }),
    ).toEqual([]);
    expect(legacyMatch).not.toHaveBeenCalled();
  });

  it("does not let a count-only mapping multiply a unique-label legacy match", () => {
    const entries = [
      { id: "first", label: "1" },
      { id: "unique-second", label: "2" },
      { id: "third", label: "3" },
      { id: "fourth", label: "4" },
    ] as InspireReferenceEntry[];
    const matcher = new LabelMatcher(entries, 84);
    matcher.setPDFMapping({
      parsedAt: 1,
      labelCounts: new Map([
        ["1", 1],
        ["2", 3],
      ]),
      totalLabels: 2,
      confidence: "high",
    });

    expect(matcher.match("2").map((match) => match.entryId)).toEqual([
      "unique-second",
    ]);
  });

  it("preserves a metadata-resolved grouped citation from the old PDF mapping", () => {
    (globalThis as any).Zotero.Prefs = { get: vi.fn(() => true) };
    const entries = [
      { id: "first", label: "27", doi: "10.1234/group.first" },
      { id: "second", label: "27", doi: "10.1234/group.second" },
    ] as InspireReferenceEntry[];
    const matcher = new LabelMatcher(entries, 84);
    matcher.setPDFMapping({
      parsedAt: 1,
      labelCounts: new Map([["27", 3]]),
      labelPaperInfos: new Map([
        [
          "27",
          [
            { rawText: "first", doi: "10.1234/group.first" },
            { rawText: "second", doi: "10.1234/group.second" },
            { rawText: "paper absent from INSPIRE" },
          ],
        ],
      ]),
      totalLabels: 1,
      confidence: "high",
    });
    const legacyMatch = vi.fn(() => matcher.match("27"));

    const matches = resolveSafeNumericMatches({
      labels: ["27"],
      matcher,
      linkedStrictMatches: [],
      legacyMatch,
    });
    expect(matches.map((match) => match.entryId)).toEqual(["first", "second"]);
    expect(matches.map((match) => match.sourcePaperIndex)).toEqual([0, 1]);
    expect(legacyMatch).not.toHaveBeenCalled();
  });

  it("rejects precise grouped attribution when two source papers claim one entry", () => {
    (globalThis as any).Zotero.Prefs = { get: vi.fn(() => true) };
    const entries = [
      { id: "first", label: "27", doi: "10.1234/group.first" },
      { id: "second", label: "27", doi: "10.1234/group.second" },
    ] as InspireReferenceEntry[];
    const matcher = new LabelMatcher(entries, 84);
    matcher.setPDFMapping({
      parsedAt: 1,
      labelCounts: new Map([["27", 3]]),
      labelPaperInfos: new Map([
        [
          "27",
          [
            { rawText: "first", doi: "10.1234/group.first" },
            { rawText: "duplicate first", doi: "10.1234/group.first" },
            { rawText: "second", doi: "10.1234/group.second" },
          ],
        ],
      ]),
      totalLabels: 1,
      confidence: "high",
    });

    expect(matcher.matchResolvedPDFDuplicateLabel("27")).toEqual([]);
    expect(
      matcher
        .matchContiguousDuplicateLabel("27")
        .map((match) => match.sourcePaperIndex),
    ).toEqual([undefined, undefined]);
  });

  it("rejects metadata-complete mappings when the same number occurs in separated chapters", () => {
    (globalThis as any).Zotero.Prefs = { get: vi.fn(() => true) };
    const entries = [
      { id: "chapter-one-27", label: "27", doi: "10.1234/chapter.one" },
      { id: "chapter-one-28", label: "28" },
      { id: "chapter-two-27", label: "27", doi: "10.1234/chapter.two" },
    ] as InspireReferenceEntry[];
    const matcher = new LabelMatcher(entries, 84);
    matcher.setPDFMapping({
      parsedAt: 1,
      labelCounts: new Map([
        ["27", 2],
        ["28", 1],
      ]),
      labelPaperInfos: new Map([
        [
          "27",
          [
            { rawText: "chapter one", doi: "10.1234/chapter.one" },
            { rawText: "chapter two", doi: "10.1234/chapter.two" },
          ],
        ],
      ]),
      totalLabels: 3,
      confidence: "high",
    });
    const legacyMatch = vi.fn(() => matcher.match("27"));

    expect(
      resolveSafeNumericMatches({
        labels: ["27"],
        matcher,
        linkedStrictMatches: [],
        legacyMatch,
      }),
    ).toEqual([]);
    expect(legacyMatch).not.toHaveBeenCalled();
  });

  it("keeps the legacy matcher for a unique requested label even if another label repeats", () => {
    const entries = [
      { id: "unique", label: "1" },
      { id: "chapter-one", label: "27" },
      { id: "chapter-two", label: "27" },
    ] as InspireReferenceEntry[];
    const matcher = new LabelMatcher(entries, 84);
    const legacyMatch = vi.fn((labels: string[]) => matcher.matchAll(labels));

    expect(
      resolveSafeNumericMatches({
        labels: ["1"],
        matcher,
        linkedStrictMatches: [],
        legacyMatch,
      }).map((match) => match.entryId),
    ).toEqual(["unique"]);
    expect(legacyMatch).toHaveBeenCalledWith(["1"]);
  });

  it("ignores strict matches whose copied label does not match the request", () => {
    const matcher = new LabelMatcher(
      [{ id: "expected", label: "27" }] as InspireReferenceEntry[],
      84,
    );
    const legacyMatch = vi.fn((labels: string[]) => matcher.matchAll(labels));

    expect(
      resolveSafeNumericMatches({
        labels: ["27"],
        matcher,
        linkedStrictMatches: [
          {
            pdfLabel: "26",
            entryIndex: 0,
            entryId: "wrong-copied-label",
            confidence: "high",
            matchMethod: "overlay",
          },
        ],
        legacyMatch,
      }).map((match) => match.entryId),
    ).toEqual(["expected"]);
    expect(legacyMatch).toHaveBeenCalledWith(["27"]);
  });

  it("preserves printed order when unique and grouped labels share one citation", () => {
    const entries = [
      { id: "unique-three", label: "3" },
      { id: "group-first", label: "27" },
      { id: "group-second", label: "27" },
    ] as InspireReferenceEntry[];
    const matcher = new LabelMatcher(entries, 84);
    const legacyMatch = vi.fn((labels: string[]) => matcher.matchAll(labels));

    const matches = resolveSafeNumericMatches({
      labels: ["3", "27"],
      matcher,
      linkedStrictMatches: [],
      legacyMatch,
    });

    expect(matches.map((match) => match.entryId)).toEqual([
      "unique-three",
      "group-first",
      "group-second",
    ]);
    expect(legacyMatch).toHaveBeenCalledWith(["3"]);
  });
});
