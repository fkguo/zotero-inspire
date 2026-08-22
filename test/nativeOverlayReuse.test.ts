import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LabelMatcher } from "../src/modules/inspire/pdfAnnotate/labelMatcher";
import {
  NativeFormatCache,
  classifyCitationText,
  type NativeFormatCompletion,
} from "../src/modules/inspire/pdfAnnotate/nativeFormatCache";
import {
  createNativeOverlayBuildState,
  runNativeOverlayBuildSlice,
} from "../src/modules/inspire/pdfAnnotate/nativeOverlayBuilder";
import {
  AUDITED_ZOTERO_10_BUILD_IDS,
  NativeOverlayAdapter,
  selectNativeOverlayProfile,
  type NativeOverlayProfile,
} from "../src/modules/inspire/pdfAnnotate/nativeOverlayProfile";
import type { NativeOverlayMatchPackage } from "../src/modules/inspire/pdfAnnotate/nativeOverlayTypes";
import { OverlayCoordinator } from "../src/modules/inspire/pdfAnnotate/overlayCoordinator";
import { OverlayScheduler } from "../src/modules/inspire/pdfAnnotate/overlayScheduler";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

const BUILD_ID = [...AUDITED_ZOTERO_10_BUILD_IDS][0];

beforeEach(() => {
  const readers: object[] = [];
  const manager = {
    getByTabID: vi.fn((tabID: string) =>
      readers.find((reader: any) => String(reader.tabID) === String(tabID)),
    ),
  } as any;
  Object.defineProperty(manager, "_readers", {
    value: readers,
    configurable: true,
  });
  (globalThis as any).Services = {
    appinfo: { version: "10.0", appBuildID: BUILD_ID },
    ww: {
      registerNotification: vi.fn(),
      unregisterNotification: vi.fn(),
    },
  };
  (globalThis as any).Cu = {
    waiveXrays: (value: unknown) => value,
    unwaiveXrays: (value: unknown) => value,
  };
  (globalThis as any).Zotero = {
    Reader: manager,
    Items: { get: vi.fn((id: number) => ({ id })) },
    Fulltext: {
      getItemCacheFile: vi.fn(() => ({ path: "/tmp/.zotero-ft-cache" })),
    },
    File: { getContentsAsync: vi.fn() },
    setTimeout: (...args: any[]) => setTimeout(args[0], args[1]),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    requestIdleCallback: (...args: any[]) =>
      (globalThis as any).requestIdleCallback?.(...args),
    cancelIdleCallback: (...args: any[]) =>
      (globalThis as any).cancelIdleCallback?.(...args),
    debug: vi.fn(),
  };
  (globalThis as any).IOUtils = { stat: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).requestIdleCallback;
  delete (globalThis as any).cancelIdleCallback;
});

describe("source-gated Zotero 10 adapter", () => {
  it("enables only the exact audited version and build profile", () => {
    expect(selectNativeOverlayProfile(true).status).toBe("audited-zotero-10");
    (globalThis as any).Services.appinfo.version = "10.0.1";
    expect(selectNativeOverlayProfile(true).status).toBe("unsupported-host");
    (globalThis as any).Services.appinfo.version = "10.0";
    expect(selectNativeOverlayProfile(false).status).toBe("disabled-by-pref");
  });

  it("does not touch private Reader state when the startup preference is off", () => {
    let privateReads = 0;
    const reader = {};
    Object.defineProperty(reader, "_internalReader", {
      get() {
        privateReads++;
        throw new Error("must remain untouched");
      },
    });
    const adapter = new NativeOverlayAdapter({
      status: "disabled-by-pref",
      version: "10.0",
      buildID: BUILD_ID,
    });
    expect(adapter.inspect(reader)).toEqual({
      kind: "terminal",
      code: "disabled-by-pref",
    });
    expect(privateReads).toBe(0);
  });

  it("keeps construction gaps pending but classifies present-wrong Xray shapes", () => {
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    expect(adapter.inspect({})).toEqual({
      kind: "pending",
      marker: "internal-reader",
    });
    expect(adapter.inspect({ _internalReader: null })).toEqual({
      kind: "pending",
      marker: "internal-reader",
    });
    const wrong = {};
    Object.defineProperty(wrong, "_internalReader", {
      get: () => ({}),
    });
    expect(adapter.inspect(wrong)).toEqual({
      kind: "incompatible",
      code: "internal-reader-shape",
    });
    const reader = makeNativeReader(1, { 0: makeCitationOverlays(3) });
    (reader as any)._internalReader._primaryView._iframe.browsingContext.id =
      "wrong";
    expect(adapter.inspect(reader)).toEqual({
      kind: "incompatible",
      code: "browsing-context-shape",
    });
  });

  it("treats zero pages and a null completed-store field as pending", () => {
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    expect(adapter.inspect(makeNativeReader(0, {})).kind).toBe("pending");
    const reader = makeNativeReader(1, {});
    (reader as any)._internalReader._primaryView._processedPageOverlays = null;
    expect(adapter.inspect(reader).kind).toBe("pending");
  });

  it("keeps a changing completed-store observation pending", () => {
    const firstStore = { 0: makeCitationOverlays(3) };
    const secondStore = { 0: makeCitationOverlays(4) };
    const reader = makeNativeReader(1, firstStore) as any;
    const primary = reader._internalReader._primaryView;
    const pdfDocument = primary._iframeWindow.PDFViewerApplication.pdfDocument;
    let numPageReads = 0;
    Object.defineProperty(pdfDocument, "numPages", {
      configurable: true,
      get() {
        numPageReads++;
        if (numPageReads === 2) {
          primary._processedPageOverlays = secondStore;
        }
        return 1;
      },
    });
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    expect(adapter.inspect(reader)).toEqual({
      kind: "pending",
      marker: "tuple-changing",
    });
    expect(numPageReads).toBe(2);
  });

  it("requires the completed-document witness before reading the store", () => {
    for (const findDocument of [undefined, {}]) {
      const reader = makeNativeReader(
        1,
        { 0: makeCitationOverlays(3) },
        76,
      ) as any;
      const primary = reader._internalReader._primaryView;
      primary._findController._pdfDocument = findDocument;
      let storeDescriptorReads = 0;
      reader._internalReader._primaryView = new Proxy(primary, {
        getOwnPropertyDescriptor(target, key) {
          if (key === "_processedPageOverlays") storeDescriptorReads++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      const adapter = new NativeOverlayAdapter(
        selectNativeOverlayProfile(true),
      );
      expect(adapter.inspect(reader).kind).toBe("pending");
      expect(storeDescriptorReads).toBe(0);
    }
  });

  it("rejects the 2,270-page RPP source before reading the overlay store", () => {
    let storeReads = 0;
    const reader = makeNativeReader(2_270, {}, 77);
    const primary = (reader as any)._internalReader._primaryView;
    Object.defineProperty(primary, "_processedPageOverlays", {
      configurable: true,
      get() {
        storeReads++;
        throw new Error("RPP must not inspect the store");
      },
    });
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    expect(adapter.inspect(reader)).toEqual({
      kind: "native-page-ineligible",
      numPages: 2_270,
    });
    expect(storeReads).toBe(0);
  });

  it("rejects a bound same-context inner navigation before touching its store", () => {
    const reader = makeNativeReader(1, {}, 78) as any;
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    const first = adapter.inspect(reader);
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;
    let storeReads = 0;
    Object.defineProperty(
      reader._internalReader._primaryView,
      "_processedPageOverlays",
      {
        configurable: true,
        get() {
          storeReads++;
          return {};
        },
      },
    );
    reader._internalReader._primaryView._iframe.contentWindow.windowGlobalChild.innerWindowId = 203;
    expect(adapter.inspect(reader, first.tuple)).toEqual({
      kind: "terminal",
      code: "same-context-navigation",
    });
    expect(storeReads).toBe(0);
  });
});

describe("idle-sliced native overlay builder", () => {
  it("keeps the legacy two-key unreliable and three-key reliable boundary", () => {
    const two = completeBuild(
      makeNativeReader(1, { 0: makeCitationOverlays(2) }),
      {},
    ).result;
    const three = completeBuild(
      makeNativeReader(1, { 0: makeCitationOverlays(3) }),
      {},
    ).result;
    expect(two.kind).toBe("complete");
    expect(three.kind).toBe("complete");
    if (two.kind !== "complete" || three.kind !== "complete") return;
    expect(two.package).toBeUndefined();
    expect(three.package?.tokenMap.size).toBe(3);
  });

  it("builds and publishes a reliable primitive package", () => {
    const store = { 0: makeCitationOverlays(3) };
    const { result, state } = completeBuild(makeNativeReader(1, store), store);
    expect(result.kind).toBe("complete");
    if (result.kind !== "complete") return;
    expect(result.package?.tokenMap.size).toBe(3);
    expect(result.package?.tokenMap.get("1")?.[0]?.doi).toBe("10.1234/ref1");
    expect(state.rawByLabel.size).toBe(0);
    expect(state.dedupByLabel.size).toBe(0);
  });

  it("handles a 1,000-reference review without truncation", () => {
    const store = { 0: makeCitationOverlays(1_000) };
    const { result } = completeBuild(makeNativeReader(1, store), store, 20_000);
    expect(result.kind).toBe("complete");
    if (result.kind !== "complete") return;
    expect(result.package?.tokenMap.size).toBe(1_000);
    expect(result.package?.tokenMap.get("1000")?.[0]?.doi).toBe(
      "10.1234/ref1000",
    );
  });

  it("preserves the legacy single-label all-reference fallback", () => {
    const store = {
      0: [
        {
          type: "citation",
          word: Array.from("(Smith et al., 2020)", (c) => ({ c })),
          references: [
            { index: 1, text: "First paper, doi:10.1234/single1" },
            { index: 2, text: "Second paper, doi:10.1234/single2" },
          ],
        },
        ...makeCitationOverlays(2).map((overlay, index) => ({
          ...overlay,
          word: Array.from(String(900_001 + index), (c) => ({ c })),
        })),
      ],
    };
    const { result } = completeBuild(makeNativeReader(1, store), store);
    expect(result.kind).toBe("complete");
    if (result.kind !== "complete") return;
    expect(
      result.package?.tokenMap.get("2020")?.map((token) => token.doi),
    ).toEqual(["10.1234/single1", "10.1234/single2"]);
  });

  it("terminates atomically if a sliced overlay page shrinks", () => {
    const store = {
      0: [
        {
          type: "citation",
          word: [{ c: "1" }],
          references: Array.from({ length: 100 }, (_, index) => ({
            index: 1,
            text: `Paper ${index}, doi:10.1234/mutable${index}`,
          })),
        },
      ],
    };
    const reader = makeNativeReader(1, store);
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    const inspection = adapter.inspect(reader);
    expect(inspection.kind).toBe("ready");
    if (inspection.kind !== "ready") return;
    const state = createNativeOverlayBuildState(inspection.tuple, 1);
    state.phase = "collect";
    state.acceptedSignature = [[0, 1]];
    let clock = 0;
    const first = runNativeOverlayBuildSlice(
      adapter,
      reader,
      state,
      () => ++clock,
      12,
    );
    expect(first.kind).toBe("progress");
    expect(state.scratch).toBeDefined();
    expect(state.scratch?.referenceCursor).toBeGreaterThan(0);
    store[0].length = 0;
    const second = runNativeOverlayBuildSlice(
      adapter,
      reader,
      state,
      () => 0,
      1,
    );
    expect(second).toEqual({
      kind: "terminal",
      code: "overlay-reacquire-shape",
    });
    expect(state.rawByLabel.size).toBe(0);
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects a references array shortened between slices", () => {
    const store = makeSlicedReferenceStore();
    const { adapter, reader, state } = beginPartialReferenceBuild(store);
    store[0][0].references.length = 1;
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "references-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects a same-content references array replacement between slices", () => {
    const store = makeSlicedReferenceStore();
    const { adapter, reader, state } = beginPartialReferenceBuild(store);
    store[0][0].references = [...store[0][0].references];
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "references-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects a same-shape overlay object replacement between slices", () => {
    const store = makeSlicedReferenceStore();
    const { adapter, reader, state } = beginPartialReferenceBuild(store);
    store[0][0] = { ...store[0][0] };
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "overlay-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects an in-place reference text mutation between slices", () => {
    const store = makeSlicedReferenceStore();
    const { adapter, reader, state } = beginPartialReferenceBuild(store);
    store[0][0].references[0].text = "Changed paper, doi:10.1234/changed";
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "references-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects an in-place reference index mutation between slices", () => {
    const store = makeSlicedReferenceStore();
    const { adapter, reader, state } = beginPartialReferenceBuild(store);
    store[0][0].references[0].index = 2;
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "references-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects a copied reference index becoming malformed", () => {
    const store = makeSlicedReferenceStore();
    const { adapter, reader, state } = beginPartialReferenceBuild(store);
    store[0][0].references[0].index = -1;
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "references-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });

  it("caps verification text work when malformed slots mutate between slices", () => {
    const references = Array.from({ length: 401 }, () => ({}) as any);
    const store = {
      0: [{ type: "citation", word: [{ c: "1" }], references }],
    };
    const reader = makeNativeReader(1, store);
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    const inspection = adapter.inspect(reader);
    expect(inspection.kind).toBe("ready");
    if (inspection.kind !== "ready") return;
    const state = createNativeOverlayBuildState(inspection.tuple, 1);
    state.phase = "collect";
    state.acceptedSignature = [[0, 1]];
    const first = runNativeOverlayBuildSlice(
      adapter,
      reader,
      state,
      () => (state.scratch?.referenceCursor === references.length ? 1 : 0),
      1,
    );
    expect(first.kind).toBe("progress");
    expect(state.scratch?.referenceCursor).toBe(references.length);
    expect(state.scratch?.verifyReferenceCursor).toBe(0);

    const largeMalformedText = "x".repeat(20_000);
    for (const reference of references) {
      reference.text = largeMalformedText;
      reference.index = -1;
    }
    let result: ReturnType<typeof runNativeOverlayBuildSlice> = {
      kind: "progress",
    };
    for (let slice = 0; slice < 500 && result.kind === "progress"; slice++) {
      result = runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1);
    }
    expect(result).toEqual({
      kind: "terminal",
      code: "reference-verification-text-work-cap",
    });
    expect(state.referenceVerificationTextWork).toBe(8_020_000);
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects a same-content word array replacement between slices", () => {
    const store = makeSlicedReferenceStore();
    const { adapter, reader, state } = beginPartialReferenceBuild(store);
    store[0][0].word = [{ c: "1" }];
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "word-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects an in-place word primitive mutation between slices", () => {
    const store = makeSlicedReferenceStore();
    const { adapter, reader, state } = beginPartialReferenceBuild(store);
    store[0][0].word[0].c = "2";
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "word-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects an in-place word primitive becoming empty", () => {
    const store = makeSlicedReferenceStore();
    const { adapter, reader, state } = beginPartialReferenceBuild(store);
    store[0][0].word[0].c = "";
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "word-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });

  it("rejects a store changed after collection before publication", () => {
    const store = { 0: makeCitationOverlays(3) };
    const reader = makeNativeReader(1, store);
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    const inspection = adapter.inspect(reader);
    expect(inspection.kind).toBe("ready");
    if (inspection.kind !== "ready") return;
    const state = createNativeOverlayBuildState(inspection.tuple, 1);
    for (let slice = 0; slice < 100; slice++) {
      const result = runNativeOverlayBuildSlice(
        adapter,
        reader,
        state,
        () => 0,
        1,
      );
      expect(result.kind).toBe("progress");
      if (state.phase === "tokenize") break;
    }
    expect(state.phase).toBe("tokenize");
    store[0].push(makeCitationOverlays(1)[0]);
    let result: ReturnType<typeof runNativeOverlayBuildSlice> | undefined;
    for (let slice = 0; slice < 100; slice++) {
      result = runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1);
      if (result.kind !== "progress") break;
    }
    expect(result).toEqual({
      kind: "terminal",
      code: "publish-signature-changed",
    });
    expect(state.phase).toBe("terminal");
  });

  it("fails before allocating scratch for 4,097 references in one overlay", () => {
    const overlay = {
      type: "citation",
      word: [{ c: "1" }],
      references: new Array(4_097),
    };
    const store = { 0: [overlay] };
    const { result, state } = completeBuild(makeNativeReader(1, store), store);
    expect(result).toEqual({
      kind: "terminal",
      code: "per-overlay-reference-cap",
    });
    expect(state.scratch).toBeUndefined();
  });

  it("releases temporary empty-label markers during tokenization", () => {
    const store = {
      0: [
        {
          type: "citation",
          word: Array.from("1,2", (c) => ({ c })),
          references: [{ index: 3, text: "Unattached reference" }],
        },
      ],
    };
    const { result, state } = completeBuild(makeNativeReader(1, store), store);
    expect(result.kind).toBe("complete");
    expect(state.tokenMap.size).toBe(2);
    expect(state.liveRecords).toBe(2);
  });

  it("resumes a deadline-cut word scan without recharging completed chunks", () => {
    const wordText = `${"x".repeat(240)}1,2,3`;
    const store = {
      0: [
        {
          type: "citation",
          word: Array.from(wordText, (c) => ({ c })),
          references: [1, 2, 3].map((index) => ({
            index,
            text: `Paper ${index}, doi:10.1234/resume${index}`,
          })),
        },
      ],
    };
    const reader = makeNativeReader(1, store);
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    const inspection = adapter.inspect(reader);
    expect(inspection.kind).toBe("ready");
    if (inspection.kind !== "ready") return;
    const state = createNativeOverlayBuildState(inspection.tuple, 1);
    state.phase = "collect";
    state.acceptedSignature = [[0, 1]];
    let clock = 0;
    const first = runNativeOverlayBuildSlice(
      adapter,
      reader,
      state,
      () => ++clock,
      12,
    );
    expect(first.kind).toBe("progress");
    expect(state.labelScratch?.cursor).toBeGreaterThan(0);
    expect(state.labelScratch?.cursor).toBeLessThan(wordText.length);
    expect(state.overlaySlots).toBe(1);

    let result = first;
    for (let slice = 0; slice < 20 && result.kind === "progress"; slice++) {
      result = runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1);
    }
    expect(result.kind).toBe("complete");
    if (result.kind !== "complete") return;
    expect(result.package?.tokenMap.size).toBe(3);
    expect(state.labelScratch).toBeUndefined();
    expect(state.overlaySlots).toBe(1);
    expect(state.wordSlots).toBe(wordText.length);
    expect(state.wordChunks).toBe(Math.ceil(wordText.length / 16));
  });

  it("terminates if a word array changes during a sliced label scan", () => {
    const wordText = `${"x".repeat(240)}1,2,3`;
    const store = {
      0: [
        {
          type: "citation",
          word: Array.from(wordText, (c) => ({ c })),
          references: [1, 2, 3].map((index) => ({
            index,
            text: `Paper ${index}, doi:10.1234/labelscan${index}`,
          })),
        },
      ],
    };
    const reader = makeNativeReader(1, store);
    const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
    const inspection = adapter.inspect(reader);
    expect(inspection.kind).toBe("ready");
    if (inspection.kind !== "ready") return;
    const state = createNativeOverlayBuildState(inspection.tuple, 1);
    state.phase = "collect";
    state.acceptedSignature = [[0, 1]];
    let clock = 0;
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => ++clock, 12)
        .kind,
    ).toBe("progress");
    expect(state.labelScratch).toBeDefined();
    store[0][0].word = Array.from(wordText, (c) => ({ c }));
    expect(
      runNativeOverlayBuildSlice(adapter, reader, state, () => 0, 1),
    ).toEqual({
      kind: "terminal",
      code: "overlay-reacquire-shape",
    });
    expect(state.tokenMap.size).toBe(0);
  });
});

describe("call-scoped high-scale matching", () => {
  it("rebuilds the generic index per call so in-place enrichment is visible", () => {
    const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];
    const matcher = new LabelMatcher(entries, 91);
    const nativePackage = genericPackage("9", "12", "345");
    expect(matcher.match("9", nativePackage)).toEqual([]);
    entries[1].publicationInfo = {
      journal_title: "Phys.Rev.D",
      journal_volume: "12",
      page_start: "345",
    };
    expect(matcher.match("9", nativePackage)[0]?.entryId).toBe("entry-2");
  });

  it("builds one ephemeral generic index per batch and none for ordinary calls", () => {
    const entries = [makeEntry(1, "1", "10"), makeEntry(2, "2", "20")];
    const matcher = new LabelMatcher(entries, 92);
    const spy = vi.spyOn(matcher as any, "buildGenericCallIndex");
    matcher.match("1");
    expect(spy).toHaveBeenCalledTimes(0);
    const nativePackage: NativeOverlayMatchPackage = {
      tokenMap: new Map([
        ["1", [genericToken("1", "10")]],
        ["2", [genericToken("2", "20")]],
        ["3", []],
      ]),
      revision: 1,
    };
    const result = matcher.matchAll(["1", "2"], nativePackage);
    expect(result).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(matcher).some((key) => key.includes("genericIndex")),
    ).toBe(false);
  });

  it("poisons a fifth generic candidate and runs the ordinary fallback", () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      makeEntry(index + 1, "7", "70"),
    );
    entries[4].label = "8";
    const matcher = new LabelMatcher(entries, 93);
    const result = matcher.match("8", genericPackage("8", "7", "70"));
    expect(result[0]?.entryId).toBe("entry-5");
    expect(result[0]?.matchMethod).not.toBe("overlay");
  });

  it("omits a same-key source entry whose journal is missing", () => {
    const entries = [makeEntry(1, "7", "70"), makeEntry(2)];
    entries[1].publicationInfo = {
      journal_volume: "7",
      page_start: "70",
    };
    entries[1].label = "8";
    const matcher = new LabelMatcher(entries, 98);
    const result = matcher.match("8", genericPackage("8", "7", "70"));
    expect(result[0]?.entryId).toBe("entry-1");
    expect(result[0]?.matchMethod).toBe("overlay");
  });

  it("poisons a same-key source entry with a truthy non-string journal", () => {
    const entries = [makeEntry(1, "7", "70"), makeEntry(2)];
    entries[1].publicationInfo = {
      journal_title: {} as string,
      journal_volume: "7",
      page_start: "70",
    };
    entries[1].label = "8";
    const matcher = new LabelMatcher(entries, 99);
    const result = matcher.match("8", genericPackage("8", "7", "70"));
    expect(result[0]?.entryId).toBe("entry-2");
    expect(result[0]?.matchMethod).not.toBe("overlay");
  });

  it("falls through safely for a null generic token payload", () => {
    const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];
    const matcher = new LabelMatcher(entries, 100);
    const nativePackage: NativeOverlayMatchPackage = {
      tokenMap: new Map([
        ["1", [{ genericJournal: null as any }]],
        ["2", []],
        ["3", []],
      ]),
      revision: 1,
    };
    expect(() => matcher.match("1", nativePackage)).not.toThrow();
    expect(matcher.match("1", nativePackage)[0]?.matchMethod).not.toBe(
      "overlay",
    );
  });

  it("keeps all 11,225 RPP entries and rebuilds the bounded index every call", () => {
    const count = 11_225;
    const entries = Array.from({ length: count }, (_, index) =>
      makeEntry(index + 1, String(index + 1), String(200_000 + index)),
    );
    const constructionStart = performance.now();
    const matcher = new LabelMatcher(entries, 94);
    const constructionMilliseconds = performance.now() - constructionStart;
    const target = entries[count - 1].publicationInfo!;
    const nativePackage = genericPackage(
      "7",
      String(target.journal_volume),
      String(target.page_start),
    );
    const timings: number[] = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const result = matcher.match("7", nativePackage);
      timings.push(performance.now() - start);
      expect(result[0]?.entryId).toBe(`entry-${count}`);
    }
    expect(entries).toHaveLength(11_225);
    expect(constructionMilliseconds).toBeLessThan(50);
    expect(
      Math.max(...timings),
      `generic interaction timings: ${timings.map((value) => value.toFixed(3)).join(", ")} ms`,
    ).toBeLessThan(12);
  });

  it("accepts the 16,384-entry boundary and disables only generic native work above it", () => {
    const entries = Array.from({ length: 16_385 }, (_, index) =>
      makeEntry(index + 1, String(index + 1), String(300_000 + index)),
    );
    const boundaryMatcher = new LabelMatcher(entries.slice(0, 16_384), 95);
    const boundaryStart = performance.now();
    const boundaryResult = boundaryMatcher.match(
      "6",
      genericPackage("6", "16384", "316383"),
    );
    const boundaryMilliseconds = performance.now() - boundaryStart;
    expect(boundaryResult[0]?.entryId).toBe("entry-16384");
    expect(boundaryMilliseconds).toBeLessThan(12);

    entries[0].label = "6";
    const matcher = new LabelMatcher(entries, 96);
    const result = matcher.match("6", genericPackage("6", "16385", "316384"));
    expect(result[0]?.entryId).toBe("entry-1");
    expect(result[0]?.matchMethod).not.toBe("overlay");
  });

  it("keeps the ordinary RPP path below the whole-task gate with zero generic pass", () => {
    const entries = Array.from({ length: 11_225 }, (_, index) =>
      makeEntry(index + 1, String(index + 1), String(400_000 + index)),
    );
    entries[0].label = "1";
    const start = performance.now();
    const matcher = new LabelMatcher(entries, 97);
    const genericSpy = vi.spyOn(matcher as any, "buildGenericCallIndex");
    const result = matcher.match("1");
    const taskMilliseconds = performance.now() - start;
    expect(result[0]?.entryId).toBe("entry-1");
    expect(genericSpy).not.toHaveBeenCalled();
    expect(taskMilliseconds).toBeLessThan(50);
  });
});

describe("bounded native fulltext format reuse", () => {
  it("keeps the audited bounded read when private overlay reuse is disabled", async () => {
    (globalThis as any).IOUtils.stat = vi
      .fn()
      .mockResolvedValue({ size: 6_238_790, lastModified: 43 });
    const read = vi.fn().mockResolvedValue("[1] ".repeat(300));
    (globalThis as any).Zotero.File.getContentsAsync = read;
    const completions: NativeFormatCompletion[] = [];
    const cache = new NativeFormatCache(
      selectNativeOverlayProfile(false),
      (completion) => completions.push(completion),
      () => false,
    );
    cache.enqueue(43, 1);
    await vi.waitFor(() => expect(completions).toHaveLength(1));
    expect(read).toHaveBeenCalledWith(
      "/tmp/.zotero-ft-cache",
      undefined,
      65_536,
    );
    cache.shutdown();
  });

  it("classifies a bounded prefix and then validates the cached fingerprint stat-only", async () => {
    const prefix = `${"[1] ".repeat(300)}${"plain ".repeat(200)}`;
    const stat = vi
      .fn()
      .mockResolvedValue({ size: 6_238_790, lastModified: 44 });
    const read = vi.fn().mockResolvedValue(prefix);
    (globalThis as any).IOUtils.stat = stat;
    (globalThis as any).Zotero.File.getContentsAsync = read;
    const completions: NativeFormatCompletion[] = [];
    const cache = new NativeFormatCache(
      auditedProfile(),
      (completion) => completions.push(completion),
      () => false,
    );
    cache.enqueue(44, 1);
    await vi.waitFor(() => expect(completions).toHaveLength(1));
    expect(completions[0].hint?.format).toBe("numeric");
    expect(read).toHaveBeenCalledWith(
      "/tmp/.zotero-ft-cache",
      undefined,
      65_536,
    );
    cache.enqueue(44, 1);
    await vi.waitFor(() => expect(completions).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(1);
    expect(stat).toHaveBeenCalledTimes(3);
    cache.shutdown();
  });

  it("refuses an unaudited cache over 262,144 bytes before reading", async () => {
    (globalThis as any).IOUtils.stat = vi
      .fn()
      .mockResolvedValue({ size: 262_145, lastModified: 1 });
    const read = vi.fn();
    (globalThis as any).Zotero.File.getContentsAsync = read;
    const completions: NativeFormatCompletion[] = [];
    const cache = new NativeFormatCache(
      { status: "unsupported-host", version: "9.0", buildID: "x" },
      (completion) => completions.push(completion),
      () => false,
    );
    cache.enqueue(45, 1);
    await vi.waitFor(() => expect(completions).toHaveLength(1));
    expect(completions[0].hint).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    cache.shutdown();
  });

  it("does not queue a fingerprint replacement after the last state releases", () => {
    const completions: NativeFormatCompletion[] = [];
    const cache = new NativeFormatCache(
      auditedProfile(),
      (completion) => completions.push(completion),
      () => false,
    );
    (cache as any).lineage.set(46, 1);
    (cache as any).advanceAfterFingerprintChange(
      {
        attachmentItemID: 46,
        generation: 1,
        coordinatorGeneration: 1,
        path: "/tmp/.zotero-ft-cache",
      },
      {
        attachmentItemID: 46,
        generation: 1,
        coordinatorGeneration: 1,
        attempted: true,
        fingerprintChanged: true,
      },
    );
    expect(completions).toHaveLength(1);
    expect((cache as any).queue.size).toBe(0);
    cache.shutdown();
  });

  it("keeps the selection classifier bounded to the first and last 4,096 units", () => {
    const numericEdge = "[1] ".repeat(1_024);
    const middle = "(Smith et al., 2024) ".repeat(10_000);
    expect(classifyCitationText(`${numericEdge}${middle}${numericEdge}`)).toBe(
      "numeric",
    );
  });
});

describe("interaction facade", () => {
  it("creates no overlay work/read token when startup reuse is disabled", () => {
    let delivered: ((deadline: unknown) => void) | undefined;
    (globalThis as any).Zotero.requestIdleCallback = vi.fn(
      (callback: (deadline: unknown) => void) => {
        delivered = callback;
        return 40;
      },
    );
    const coordinator = new OverlayCoordinator(false);
    const reader = makeNativeReader(1, { 0: makeCitationOverlays(3) }, 87);
    (globalThis as any).Zotero.Reader._readers.push(reader);
    const inspect = vi.spyOn(coordinator.adapter, "inspect");
    coordinator.requestPrewarm(reader, 87, true, "toolbar");
    delivered?.({ didTimeout: true });
    const state = (coordinator as any).lifecycle.getByReader(reader);
    expect(state?.foreground).toBe(true);
    expect(state?.workToken).toBeUndefined();
    expect(state?.readToken).toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
    coordinator.shutdown();
  });

  it("returns immediately before pump-side admission and never inspects the document", () => {
    const idleCallbacks: Array<() => void> = [];
    (globalThis as any).requestIdleCallback = vi.fn((callback: () => void) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    (globalThis as any).cancelIdleCallback = vi.fn();
    const coordinator = new OverlayCoordinator(true);
    const reader = makeNativeReader(1, { 0: makeCitationOverlays(3) }, 88);
    (globalThis as any).Zotero.Reader._readers.push(reader);
    const inspect = vi.spyOn(coordinator.adapter, "inspect");
    const evidence = coordinator.classifySelectionWithReadyEvidence(
      reader,
      88,
      "[1]",
    );
    expect(evidence.originAnchor?.kind).toBe("pending");
    const token = coordinator.validateOriginAnchorForEvent(
      reader,
      88,
      evidence.originAnchor,
      "hover",
    );
    expect(token).toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
    expect(idleCallbacks).toHaveLength(1);
    coordinator.shutdown();
  });

  it("does not authorize native evidence for another attachment's matcher", () => {
    const coordinator = new OverlayCoordinator(true);
    const reader = makeNativeReader(
      1,
      { 0: makeCitationOverlays(3) },
      88,
    ) as any;
    (globalThis as any).Zotero.Reader._readers.push(reader);
    const { lifecycle, state, readToken } = publishNativePackageForTest(
      coordinator,
      reader,
      88,
      genericPackage("9", "12", "345"),
    );
    const entries = [makeEntry(1), makeEntry(2, "12", "345"), makeEntry(3)];
    const wrongSourceMatcher = new LabelMatcher(entries, 999);
    expect(
      coordinator.matchLabelWithReadyNative(readToken, wrongSourceMatcher, "9"),
    ).toEqual([]);
    expect(lifecycle.states.get(state.stateID)).toBe(state);
    expect(state.readToken).toBe(readToken);

    const correctMatcher = new LabelMatcher(entries, 88);
    expect(
      coordinator.matchLabelWithReadyNative(readToken, correctMatcher, "9")[0]
        ?.entryId,
    ).toBe("entry-2");
    coordinator.shutdown();
  });

  it("revokes a native package whose revision does not match its read token", () => {
    const coordinator = new OverlayCoordinator(true);
    const reader = makeNativeReader(
      1,
      { 0: makeCitationOverlays(3) },
      88,
    ) as any;
    (globalThis as any).Zotero.Reader._readers.push(reader);
    const mismatchedPackage = {
      ...genericPackage("9", "12", "345"),
      revision: 999,
    };
    const { state, readToken } = publishNativePackageForTest(
      coordinator,
      reader,
      88,
      mismatchedPackage,
    );
    const matcher = new LabelMatcher(
      [makeEntry(1), makeEntry(2, "12", "345"), makeEntry(3)],
      88,
    );
    expect(
      coordinator.matchLabelWithReadyNative(readToken, matcher, "9"),
    ).toEqual([]);
    expect(state.readToken).toBeUndefined();
    expect(state.nativePackage).toBeUndefined();
    coordinator.shutdown();
  });

  it("revokes an async read token when the outer Reader item changes", () => {
    const coordinator = new OverlayCoordinator(true);
    const reader = makeNativeReader(
      1,
      { 0: makeCitationOverlays(3) },
      88,
    ) as any;
    (globalThis as any).Zotero.Reader._readers.push(reader);
    const inspection = coordinator.adapter.inspect(reader);
    expect(inspection.kind).toBe("ready");
    if (inspection.kind !== "ready") return;
    const lifecycle = (coordinator as any).lifecycle;
    const state = lifecycle.admit(
      {
        reader,
        sourceAttachmentItemID: 88,
        tabID: "tab-1",
        window: reader._window,
      },
      1,
      true,
      0,
    );
    lifecycle.bindDocument(state, inspection.tuple, 0);
    lifecycle.publish(state, genericPackage("1", "1", "10"), 0);
    const readToken = state.readToken;
    reader.itemID = 89;
    const matcher = new LabelMatcher(
      [makeEntry(1, "1", "10"), makeEntry(2), makeEntry(3)],
      88,
    );
    coordinator.matchLabelWithReadyNative(readToken, matcher, "1");
    expect(lifecycle.states.size).toBe(0);
    coordinator.shutdown();
  });

  it("revokes an old popup document as soon as its browsing context changes", () => {
    const coordinator = new OverlayCoordinator(true);
    const reader = makeNativeReader(
      1,
      { 0: makeCitationOverlays(3) },
      89,
    ) as any;
    (globalThis as any).Zotero.Reader._readers.push(reader);
    const inspection = coordinator.adapter.inspect(reader);
    expect(inspection.kind).toBe("ready");
    if (inspection.kind !== "ready") return;
    const lifecycle = (coordinator as any).lifecycle;
    const state = lifecycle.admit(
      {
        reader,
        sourceAttachmentItemID: 89,
        tabID: "tab-1",
        window: reader._window,
      },
      2,
      true,
      0,
    );
    lifecycle.acceptBrowsingContext(state, "101", 0);
    lifecycle.bindDocument(state, inspection.tuple, 0);
    const anchor = {
      kind: "state" as const,
      stateID: state.stateID,
      sourceAttachmentItemID: 89,
      browsingContextID: "101",
    };
    reader._internalReader._primaryView._iframe.browsingContext.id = 102;
    expect(
      coordinator.validateOriginAnchorForEvent(reader, 89, anchor, "hover"),
    ).toBeUndefined();
    expect(state.readToken).toBeUndefined();
    expect(state.tuple).toBeUndefined();
    expect(state.observedBrowsingContextID).toBe("102");
    coordinator.shutdown();
  });

  it("round-robins due Readers before servicing a newly appended pending item", () => {
    (globalThis as any).requestIdleCallback = vi.fn(() => 73);
    (globalThis as any).cancelIdleCallback = vi.fn();
    const coordinator = new OverlayCoordinator(true);
    const first = makeNativeReader(
      1,
      { 0: makeCitationOverlays(3) },
      201,
    ) as any;
    const second = makeNativeReader(
      1,
      { 0: makeCitationOverlays(3) },
      202,
    ) as any;
    const pending = makeNativeReader(
      1,
      { 0: makeCitationOverlays(3) },
      203,
    ) as any;
    const readers = (globalThis as any).Zotero.Reader._readers;
    readers.push(first, second, pending);
    const lifecycle = (coordinator as any).lifecycle;
    for (const reader of [first, second]) {
      lifecycle.admit(
        {
          reader,
          sourceAttachmentItemID: reader.itemID,
          tabID: reader.tabID,
          window: reader._window,
        },
        reader.itemID,
        true,
        0,
      );
    }
    const inspected: number[] = [];
    vi.spyOn(coordinator.adapter, "inspect").mockImplementation(
      (reader, tuple) => {
        inspected.push((reader as any).itemID);
        return NativeOverlayAdapter.prototype.inspect.call(
          coordinator.adapter,
          reader,
          tuple,
        );
      },
    );
    const pump = () =>
      (coordinator as any).pump({
        buildMilliseconds: 4,
        genuineIdle: false,
        didTimeout: true,
      });
    pump();
    coordinator.requestPrewarm(pending, 203, false, "interaction");
    pump();
    pump();
    expect(inspected.slice(0, 3)).toEqual([201, 202, 201]);
    expect(lifecycle.getByReader(pending)).toBeUndefined();
    pump();
    expect(lifecycle.getByReader(pending)).toBeDefined();
    coordinator.shutdown();
  });
});

describe("single-handle scheduler", () => {
  it("does not mix Timer functions from different providers", () => {
    const zotero = (globalThis as any).Zotero;
    zotero.setTimeout = undefined;
    zotero.clearTimeout = undefined;
    zotero.requestIdleCallback = vi.fn(() => 70);
    zotero.cancelIdleCallback = vi.fn();
    delete (globalThis as any).requestIdleCallback;
    delete (globalThis as any).cancelIdleCallback;
    expect(OverlayScheduler.supportsNativeIdleRuntime()).toBe(false);
  });

  it("uses module-global Timer APIs when Zotero exports are absent", () => {
    const zotero = (globalThis as any).Zotero;
    zotero.setTimeout = undefined;
    zotero.clearTimeout = undefined;
    zotero.requestIdleCallback = undefined;
    zotero.cancelIdleCallback = undefined;
    const requestIdle = vi.fn(() => 71);
    const cancelIdle = vi.fn();
    (globalThis as any).requestIdleCallback = requestIdle;
    (globalThis as any).cancelIdleCallback = cancelIdle;
    expect(OverlayScheduler.supportsNativeIdleRuntime()).toBe(true);
    const scheduler = new OverlayScheduler(vi.fn(), () => 10);
    scheduler.ensureScheduled();
    expect(requestIdle).toHaveBeenCalledTimes(1);
    scheduler.cancel();
    expect(cancelIdle).toHaveBeenCalledWith(71);
  });

  it("binds Zotero Timer functions to their host object", () => {
    const zotero = (globalThis as any).Zotero;
    const requestIdle = vi.fn(function (this: unknown) {
      expect(this).toBe(zotero);
      return 72;
    });
    const cancelIdle = vi.fn(function (this: unknown, id: unknown) {
      expect(this).toBe(zotero);
      expect(id).toBe(72);
    });
    zotero.requestIdleCallback = requestIdle;
    zotero.cancelIdleCallback = cancelIdle;
    const scheduler = new OverlayScheduler(vi.fn(), () => 10);
    scheduler.ensureScheduled();
    scheduler.cancel();
    expect(requestIdle).toHaveBeenCalledTimes(1);
    expect(cancelIdle).toHaveBeenCalledTimes(1);
  });

  it("disables and reports native reuse when a required Timer API is missing", () => {
    (globalThis as any).Zotero.requestIdleCallback = undefined;
    delete (globalThis as any).requestIdleCallback;
    const coordinator = new OverlayCoordinator(true);
    expect(coordinator.adapter.enabled).toBe(false);
    expect((globalThis as any).Zotero.debug).toHaveBeenCalledWith(
      expect.stringContaining("required Timer APIs unavailable"),
    );
    coordinator.shutdown();
  });

  it("clears an idle handle when no work remains and can arm again later", () => {
    let nextHandle = 80;
    const cancelIdle = vi.fn();
    (globalThis as any).Zotero.requestIdleCallback = vi.fn(() => nextHandle++);
    (globalThis as any).Zotero.cancelIdleCallback = cancelIdle;
    const scheduler = new OverlayScheduler(vi.fn(), () => 10);
    scheduler.ensureScheduled();
    expect(scheduler.hasHandle).toBe(true);
    scheduler.clearScheduled();
    expect(scheduler.hasHandle).toBe(false);
    expect(cancelIdle).toHaveBeenCalledTimes(1);
    scheduler.ensureScheduled();
    expect(scheduler.hasHandle).toBe(true);
    scheduler.cancel();
    expect(cancelIdle).toHaveBeenCalledTimes(2);
  });

  it("degrades once without a zero-delay handoff loop when idle dispatch throws", () => {
    let timerCallback: (() => void) | undefined;
    (globalThis as any).Zotero.requestIdleCallback = vi.fn(() => {
      throw new Error("idle unavailable");
    });
    (globalThis as any).Zotero.setTimeout = vi.fn((callback: () => void) => {
      timerCallback = callback;
      return 21;
    });
    const unavailable = vi.fn();
    const pump = vi.fn(() => undefined);
    const scheduler = new OverlayScheduler(pump, () => 10, unavailable);
    scheduler.ensureScheduled();
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(timerCallback).toBeTypeOf("function");
    timerCallback?.();
    expect(pump).toHaveBeenCalledTimes(1);
    expect(scheduler.hasHandle).toBe(false);
  });

  it("contains a throwing host timer arm and degrades only once", () => {
    (globalThis as any).Zotero.requestIdleCallback = undefined;
    (globalThis as any).Zotero.setTimeout = vi.fn(() => {
      throw new Error("timer unavailable");
    });
    const unavailable = vi.fn();
    const scheduler = new OverlayScheduler(vi.fn(), () => 10, unavailable);
    expect(() => scheduler.ensureScheduled(250)).not.toThrow();
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(scheduler.hasHandle).toBe(false);
  });

  it("hands a due timer off to idle before running the pump", () => {
    let timerCallback: (() => void) | undefined;
    let idleCallback: ((deadline: unknown) => void) | undefined;
    (globalThis as any).Zotero.setTimeout = vi.fn(
      (callback: () => void, delay: number) => {
        expect(delay).toBe(250);
        timerCallback = callback;
        return 11;
      },
    );
    (globalThis as any).Zotero.clearTimeout = vi.fn();
    (globalThis as any).Zotero.requestIdleCallback = vi.fn(
      (callback: (deadline: unknown) => void) => {
        idleCallback = callback;
        return 12;
      },
    );
    (globalThis as any).Zotero.cancelIdleCallback = vi.fn();
    const pump = vi.fn(() => undefined);
    let clock = 100;
    const scheduler = new OverlayScheduler(pump, () => clock);
    scheduler.ensureScheduled(250);
    expect(pump).not.toHaveBeenCalled();
    clock = 350;
    timerCallback?.();
    expect(pump).not.toHaveBeenCalled();
    expect(idleCallback).toBeTypeOf("function");
    idleCallback?.({ didTimeout: true });
    expect(pump).toHaveBeenCalledTimes(1);
    expect(scheduler.hasHandle).toBe(false);
  });

  it("uses the fixed four-millisecond timeout budget without reading timeRemaining", () => {
    let delivered: ((deadline: unknown) => void) | undefined;
    const cancelIdle = vi.fn();
    (globalThis as any).requestIdleCallback = vi.fn(
      (callback: (deadline: unknown) => void, options: { timeout: number }) => {
        expect(options.timeout).toBe(50);
        delivered = callback;
        return 7;
      },
    );
    (globalThis as any).cancelIdleCallback = cancelIdle;
    const pump = vi.fn(() => undefined);
    const scheduler = new OverlayScheduler(pump, () => 10);
    scheduler.ensureScheduled();
    expect(scheduler.hasHandle).toBe(true);
    delivered?.({
      didTimeout: true,
      timeRemaining: () => {
        throw new Error("timeout branch must not read timeRemaining");
      },
    });
    expect(pump).toHaveBeenCalledWith({
      buildMilliseconds: 4,
      genuineIdle: false,
      didTimeout: true,
    });
    expect(scheduler.hasHandle).toBe(false);
    scheduler.cancel();
    expect(cancelIdle).not.toHaveBeenCalled();
  });

  it("revokes native runtime when the coordinator pump throws", () => {
    let delivered: ((deadline: unknown) => void) | undefined;
    (globalThis as any).Zotero.requestIdleCallback = vi.fn(
      (callback: (deadline: unknown) => void) => {
        delivered = callback;
        return 31;
      },
    );
    const unavailable = vi.fn();
    const scheduler = new OverlayScheduler(
      () => {
        throw new Error("pump failure");
      },
      () => 10,
      unavailable,
    );
    scheduler.ensureScheduled();
    expect(() => delivered?.({ didTimeout: true })).not.toThrow();
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(scheduler.hasHandle).toBe(false);
  });
});

function makeCitationOverlays(count: number): any[] {
  return Array.from({ length: count }, (_, index) => {
    const label = String(index + 1);
    return {
      type: "citation",
      word: Array.from(label, (c) => ({ c })),
      references: [
        {
          index: index + 1,
          text: `Paper ${label}, doi:10.1234/ref${label}`,
        },
      ],
    };
  });
}

function makeNativeReader(
  numPages: number,
  store: object,
  itemID = 11,
): object {
  const pdfDocument = { numPages };
  const window = {
    Zotero_Tabs: { selectedID: "tab-1" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    document: { hasFocus: () => true },
  };
  return {
    type: "pdf",
    itemID,
    tabID: "tab-1",
    _window: window,
    _internalReader: {
      _primaryView: {
        _iframe: {
          browsingContext: { id: 101 },
          contentWindow: { windowGlobalChild: { innerWindowId: 202 } },
        },
        _iframeWindow: {
          PDFViewerApplication: {
            pdfLoadingTask: { docId: "d0" },
            pdfDocument,
          },
        },
        _findController: { _pdfDocument: pdfDocument },
        _processedPageOverlays: store,
      },
    },
  };
}

function completeBuild(reader: object, _store: object, maxSlices = 2_000) {
  const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
  const inspection = adapter.inspect(reader);
  if (inspection.kind !== "ready") throw new Error("fixture must be ready");
  const state = createNativeOverlayBuildState(inspection.tuple, 1);
  for (let slice = 0; slice < maxSlices; slice++) {
    const result = runNativeOverlayBuildSlice(
      adapter,
      reader,
      state,
      () => 0,
      1,
    );
    if (result.kind !== "progress") return { result, state };
  }
  throw new Error(`build did not finish in ${maxSlices} slices`);
}

function makeSlicedReferenceStore() {
  return {
    0: [
      {
        type: "citation",
        word: [{ c: "1" }],
        references: Array.from({ length: 100 }, (_, index) => ({
          index: 1,
          text: `Paper ${index}, doi:10.1234/mutable${index}`,
        })),
      },
    ],
  };
}

function beginPartialReferenceBuild(
  store: ReturnType<typeof makeSlicedReferenceStore>,
) {
  const reader = makeNativeReader(1, store);
  const adapter = new NativeOverlayAdapter(selectNativeOverlayProfile(true));
  const inspection = adapter.inspect(reader);
  if (inspection.kind !== "ready") throw new Error("fixture must be ready");
  const state = createNativeOverlayBuildState(inspection.tuple, 1);
  state.phase = "collect";
  state.acceptedSignature = [[0, 1]];
  let clock = 0;
  const first = runNativeOverlayBuildSlice(
    adapter,
    reader,
    state,
    () => ++clock,
    12,
  );
  if (
    first.kind !== "progress" ||
    !state.scratch ||
    state.scratch.referenceCursor <= 0
  ) {
    throw new Error("fixture must stop during reference collection");
  }
  return { adapter, reader, state };
}

function publishNativePackageForTest(
  coordinator: OverlayCoordinator,
  reader: any,
  sourceAttachmentItemID: number,
  nativePackage: NativeOverlayMatchPackage,
) {
  const inspection = coordinator.adapter.inspect(reader);
  if (inspection.kind !== "ready") throw new Error("fixture must be ready");
  const lifecycle = (coordinator as any).lifecycle;
  const state = lifecycle.admit(
    {
      reader,
      sourceAttachmentItemID,
      tabID: "tab-1",
      window: reader._window,
    },
    1,
    true,
    0,
  );
  if (!state) throw new Error("fixture must admit a state");
  if (!lifecycle.bindDocument(state, inspection.tuple, 0)) {
    throw new Error("fixture must bind a document");
  }
  if (!lifecycle.publish(state, nativePackage, 0) || !state.readToken) {
    throw new Error("fixture must publish a package");
  }
  return { lifecycle, state, readToken: state.readToken };
}

function makeEntry(
  index: number,
  volume?: string,
  page?: string,
): InspireReferenceEntry {
  return {
    id: `entry-${index}`,
    recid: index,
    title: `Paper ${index}`,
    authors: [],
    year: "2024",
    ...(volume && page
      ? {
          publicationInfo: {
            journal_title: "Phys.Rev.D",
            journal_volume: volume,
            page_start: page,
          },
        }
      : {}),
  } as InspireReferenceEntry;
}

function genericToken(volume: string, page: string) {
  return {
    genericJournal: { journal: "Phys. Rev. D", volume, page },
  };
}

function genericPackage(
  label: string,
  volume: string,
  page: string,
): NativeOverlayMatchPackage {
  return {
    tokenMap: new Map([
      [label, [genericToken(volume, page)]],
      ["900001", []],
      ["900002", []],
    ]),
    revision: 1,
  };
}

function auditedProfile(): NativeOverlayProfile {
  return {
    status: "audited-zotero-10",
    version: "10.0",
    buildID: BUILD_ID,
  };
}
