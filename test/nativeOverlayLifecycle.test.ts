import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NativeFormatCache,
  type NativeFormatCompletion,
} from "../src/modules/inspire/pdfAnnotate/nativeFormatCache";
import type { NativeDocumentTuple } from "../src/modules/inspire/pdfAnnotate/nativeOverlayProfile";
import { OverlayAdmissionGuard } from "../src/modules/inspire/pdfAnnotate/overlayAdmission";
import { OverlayLifecycleStore } from "../src/modules/inspire/pdfAnnotate/overlayLifecycle";
import { OverlayMemoryAccountant } from "../src/modules/inspire/pdfAnnotate/overlayMemory";
import { OverlayPendingAdmissions } from "../src/modules/inspire/pdfAnnotate/overlayPendingAdmissions";
import { OverlayWindowRegistry } from "../src/modules/inspire/pdfAnnotate/overlayWindowRegistry";

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
    ww: {
      registerNotification: vi.fn(),
      unregisterNotification: vi.fn(),
    },
  };
  (globalThis as any).Zotero = {
    Reader: manager,
    Items: { get: vi.fn((id: number) => ({ id })) },
    Fulltext: {
      getItemCacheFile: vi.fn(() => ({ path: "/tmp/.zotero-ft-cache" })),
    },
    File: { getContentsAsync: vi.fn() },
  };
  (globalThis as any).IOUtils = { stat: vi.fn() };
});

describe("Reader admission and pending queue", () => {
  it("requires exactly one manager-owned PDF Reader identity", () => {
    const reader = makeReader(10, "tab-1");
    (globalThis as any).Zotero.Reader._readers.push(reader);
    const guard = new OverlayAdmissionGuard();
    expect(guard.validate(reader)).toMatchObject({
      kind: "admitted",
      value: { sourceAttachmentItemID: 10, tabID: "tab-1" },
    });
    (globalThis as any).Zotero.Reader._readers.push(reader);
    expect(guard.validate(reader)).toEqual({
      kind: "refused",
      code: "manager-identity-refused",
    });
    expect(guard.isManagerRefused(reader)).toBe(true);
  });

  it("refuses a manager snapshot over 64 without reading Reader getters", () => {
    const readers = (globalThis as any).Zotero.Reader._readers;
    for (let index = 0; index < 65; index++) readers.push({});
    let getterReads = 0;
    const candidate = {};
    Object.defineProperty(candidate, "itemID", {
      get() {
        getterReads++;
        return 1;
      },
    });
    expect(new OverlayAdmissionGuard().validate(candidate)).toEqual({
      kind: "refused",
      code: "manager-reader-cap",
    });
    expect(getterReads).toBe(0);
  });

  it("rejects an own but empty tab ID instead of treating it as standalone", () => {
    const reader = makeReader(10, "tab-1") as any;
    reader.tabID = "";
    (globalThis as any).Zotero.Reader._readers.push(reader);
    expect(new OverlayAdmissionGuard().validate(reader)).toEqual({
      kind: "refused",
      code: "reader-tab-id-shape",
    });
  });

  it("coalesces equal pending requests without scheduler churn and upgrades rank once", () => {
    const arm = vi.fn();
    const pending = new OverlayPendingAdmissions(arm, () => 1, vi.fn());
    const reader = makeReader(11, "tab-1");
    pending.ensure(reader, 11, "interaction", false);
    pending.ensure(reader, 11, "interaction", false);
    expect(arm).toHaveBeenCalledTimes(1);
    pending.ensure(reader, 11, "toolbar", true);
    expect(arm).toHaveBeenCalledTimes(2);
    pending.shutdown();
  });

  it("startup sweep queues selected tabs before focused standalone Readers", () => {
    const selected = makeReader(12, "tab-selected");
    const background = makeReader(13, "tab-background");
    const standalone = makeReader(14);
    (selected as any)._window.Zotero_Tabs.selectedID = "tab-selected";
    (background as any)._window.Zotero_Tabs.selectedID = "another-tab";
    const readers = (globalThis as any).Zotero.Reader._readers;
    readers.push(background, standalone, selected);
    const pending = new OverlayPendingAdmissions(vi.fn(), () => 1, vi.fn());
    pending.startupSweep();
    expect(pending.size).toBe(2);
    expect(pending.consumeNext()?.admission.reader).toBe(selected);
    expect(pending.consumeNext()?.admission.reader).toBe(standalone);
    pending.shutdown();
  });
});

describe("Reader lifecycle and capacity", () => {
  it("pre-reserves one bounded build peak and shrinks to exact live usage", () => {
    const reader = makeReader(20, "tab-1");
    const memory = new OverlayMemoryAccountant();
    const lifecycle = new OverlayLifecycleStore(memory);
    const state = lifecycle.admit(
      {
        reader,
        sourceAttachmentItemID: 20,
        tabID: "tab-1",
        window: (reader as any)._window,
      },
      1,
      true,
      0,
    )!;
    lifecycle.bindDocument(state, tuple("1", "1"), 0);
    expect(lifecycle.reserveBuildSlice(state)).toBe(true);
    expect(memory.snapshot()).toEqual({
      records: 32_968,
      textUnits: 2_000_000,
    });
    expect(lifecycle.syncBuildMemory(state)).toBe(true);
    expect(memory.snapshot()).toEqual({ records: 0, textUnits: 0 });
    lifecycle.reset();
  });

  it("pauses foreground service time without resetting it on reselection", () => {
    const reader = makeReader(21, "tab-1");
    const lifecycle = new OverlayLifecycleStore(new OverlayMemoryAccountant());
    const state = lifecycle.admit(
      {
        reader,
        sourceAttachmentItemID: 21,
        tabID: "tab-1",
        window: (reader as any)._window,
      },
      1,
      true,
      0,
    )!;
    expect(lifecycle.getServiceMilliseconds(state, 100)).toBe(100);
    lifecycle.setForeground(state, false, 100);
    lifecycle.setForeground(state, true, 500);
    expect(lifecycle.getServiceMilliseconds(state, 600)).toBe(200);
    lifecycle.bindDocument(state, tuple("1", "1"), 600);
    const readToken = state.readToken;
    lifecycle.setForeground(state, false, 700);
    lifecycle.setForeground(state, true, 900);
    expect(lifecycle.getServiceMilliseconds(state, 1_000)).toBe(200);
    expect(state.readToken).toBe(readToken);
    lifecycle.reset();
  });

  it("allows three distinct document bindings and fails closed on the fourth", () => {
    const reader = makeReader(22, "tab-1");
    const lifecycle = new OverlayLifecycleStore(new OverlayMemoryAccountant());
    const state = lifecycle.admit(
      {
        reader,
        sourceAttachmentItemID: 22,
        tabID: "tab-1",
        window: (reader as any)._window,
      },
      1,
      true,
      0,
    )!;
    expect(lifecycle.bindDocument(state, tuple("1", "1"), 1)).toBe(true);
    expect(lifecycle.bindDocument(state, tuple("2", "2"), 2)).toBe(true);
    expect(lifecycle.bindDocument(state, tuple("3", "3"), 3)).toBe(true);
    expect(lifecycle.bindDocument(state, tuple("4", "4"), 4)).toBe(false);
    expect(state.terminalCode).toBe("document-epoch-cap");
    lifecycle.reset();
  });

  it("makes the fourth pre-ready browsing-context replacement terminal", () => {
    const reader = makeReader(23, "tab-1");
    const lifecycle = new OverlayLifecycleStore(new OverlayMemoryAccountant());
    const state = lifecycle.admit(
      {
        reader,
        sourceAttachmentItemID: 23,
        tabID: "tab-1",
        window: (reader as any)._window,
      },
      1,
      true,
      0,
    )!;
    for (const id of ["1", "2", "3", "4"]) {
      expect(lifecycle.acceptBrowsingContext(state, id, Number(id))).toBe(true);
    }
    expect(lifecycle.acceptBrowsingContext(state, "5", 5)).toBe(false);
    expect(state.terminalCode).toBe("pre-ready-context-churn-cap");
    lifecycle.reset();
  });

  it("does not charge a bound document replacement as pre-ready churn", () => {
    const reader = makeReader(24, "tab-1");
    const lifecycle = new OverlayLifecycleStore(new OverlayMemoryAccountant());
    const state = lifecycle.admit(
      {
        reader,
        sourceAttachmentItemID: 24,
        tabID: "tab-1",
        window: (reader as any)._window,
      },
      1,
      true,
      0,
    )!;
    expect(lifecycle.acceptBrowsingContext(state, "1", 1)).toBe(true);
    expect(lifecycle.bindDocument(state, tuple("1", "1"), 1)).toBe(true);
    lifecycle.releaseDocument(state, 2);
    state.terminalCode = "native-page-ineligible";
    expect(lifecycle.acceptBrowsingContext(state, "2", 3)).toBe(true);
    expect(state.preReadyContextReplacements).toBe(0);
    expect(state.terminalCode).toBeUndefined();
    expect(lifecycle.bindDocument(state, tuple("2", "2"), 4)).toBe(true);
    expect(state.documentEpochs).toBe(2);
    lifecycle.reset();
  });

  it("shares one 64-window capacity pool and recovers after close", () => {
    const registry = new OverlayWindowRegistry();
    const windows = Array.from({ length: 65 }, () => makeWindow());
    const keys = windows
      .slice(0, 64)
      .map((window) => registry.ensure(window, vi.fn()));
    expect(keys.every(Boolean)).toBe(true);
    expect(registry.ensure(windows[64], vi.fn())).toBeUndefined();
    registry.close(keys[0]!);
    expect(registry.ensure(windows[64], vi.fn())).toBeDefined();
    registry.shutdown();
    expect(
      (globalThis as any).Services.ww.unregisterNotification,
    ).toHaveBeenCalledTimes(1);
  });
});

describe("format lineage", () => {
  it("advances once on a changed fingerprint and refreshes the bounded prefix", async () => {
    const oldFingerprint = { size: 1_000, lastModified: 1 };
    const newFingerprint = { size: 1_100, lastModified: 2 };
    (globalThis as any).IOUtils.stat = vi
      .fn()
      .mockResolvedValueOnce(oldFingerprint)
      .mockResolvedValueOnce(oldFingerprint)
      .mockResolvedValueOnce(newFingerprint)
      .mockResolvedValueOnce(newFingerprint)
      .mockResolvedValueOnce(newFingerprint);
    const read = vi
      .fn()
      .mockResolvedValueOnce("[1] ".repeat(300))
      .mockResolvedValueOnce("(Smith et al., 2024) ".repeat(100));
    (globalThis as any).Zotero.File.getContentsAsync = read;
    const completions: NativeFormatCompletion[] = [];
    const cache = new NativeFormatCache(
      { status: "audited-zotero-10", version: "10.0", buildID: "test" },
      (completion) => completions.push(completion),
      () => true,
    );
    cache.enqueue(31, 1);
    await vi.waitFor(() => expect(completions).toHaveLength(1));
    cache.enqueue(31, 1);
    await vi.waitFor(() => expect(completions).toHaveLength(3));
    expect(completions.map((completion) => completion.generation)).toEqual([
      1, 2, 2,
    ]);
    expect(completions[1].invalidateVerified).toBe(true);
    expect(completions[2].hint?.format).toBe("author-year");
    expect(read).toHaveBeenCalledTimes(2);
    cache.shutdown();
  });
});

function makeReader(itemID: number, tabID?: string): object {
  return {
    type: "pdf",
    itemID,
    ...(tabID ? { tabID } : {}),
    _window: makeWindow(tabID),
  };
}

function makeWindow(selectedID = "tab-1") {
  return {
    Zotero_Tabs: { selectedID },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    document: { hasFocus: () => true },
  };
}

function tuple(context: string, innerWindow: string): NativeDocumentTuple {
  return {
    browsingContextID: context,
    innerWindowID: innerWindow,
    viewKey: `${context}:${innerWindow}`,
    documentKey: `${context}:${innerWindow}:d0`,
    docID: "d0",
    numPages: 1,
  };
}
