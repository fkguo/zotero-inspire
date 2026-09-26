import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspireReferencePanelController } from "../src/modules/zinspire";
import { METADATA_BATCH_SIZE } from "../src/modules/inspire/constants";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";
import { getString } from "../src/utils/locale";

// Exports from the References panel share one cancel handle: starting an
// export cancels the one still running, and closing the panel (destroy())
// cancels whatever is running. Here a second export starts while the first
// is still waiting for INSPIRE.

type ExportKind = "exportEntries" | "copyCitationKeys";

const START: Record<ExportKind, (controller: any) => Promise<void>> = {
  exportEntries: (controller) =>
    controller.exportEntries("bibtex", "clipboard", ".bib"),
  copyCitationKeys: (controller) =>
    controller.copyCitationKeys(controller.allEntries),
};

// INSPIRE's answer to a batch request from each kind of export.
const ANSWER: Record<ExportKind, string> = {
  exportEntries: "@article{First:2020abc,\n  title = {First}\n}",
  copyCitationKeys: JSON.stringify({
    hits: {
      hits: [{ metadata: { control_number: 1, texkeys: ["First:2020abc"] } }],
    },
  }),
};

function entry(recid: string): InspireReferenceEntry {
  return {
    id: recid,
    recid,
    title: recid,
    year: "",
    authors: [],
    authorText: "",
    displayText: "",
    searchText: "",
  };
}

function createController(entryCount: number) {
  const controller = Object.create(
    InspireReferencePanelController.prototype,
  ) as any;
  Object.assign(controller, {
    allEntries: Array.from({ length: entryCount }, (_, i) =>
      entry(String(i + 1)),
    ),
    // Nothing is selected, so every entry is exported. Once the selection is
    // kept by BatchImportManager, exportEntries() asks it instead.
    selectedEntryIDs: new Set<string>(),
    batchImport: { getSelectedEntryIDs: () => new Set<string>() },
  });
  return controller;
}

// Progress windows opened by the exports, in order.
let progressWindows: ProgressWindowStub[] = [];

class ProgressWindowStub {
  win = { changeHeadline: vi.fn() };
  createLine = vi.fn();
  changeLine = vi.fn();
  show = vi.fn();
  close = vi.fn();
  constructor() {
    progressWindows.push(this);
  }
}

// The last message a progress window showed.
function lastMessage(progressWindow: ProgressWindowStub) {
  return progressWindow.changeLine.mock.lastCall?.[0]?.text;
}

// A request that stays open until its signal is aborted, then fails the way
// fetch() does.
function pendingUntilAborted(_url: string, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const abort = () =>
      reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

describe("References panel export cancellation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let copyText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Progress windows close themselves after a delay; keep those timers
    // from outliving the test.
    vi.useFakeTimers();
    progressWindows = [];
    fetchMock = vi.fn(pendingUntilAborted);
    copyText = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("addon", { data: {} });
    vi.stubGlobal("ztoolkit", { ProgressWindow: ProgressWindowStub });
    vi.stubGlobal("Zotero", {
      debug: vi.fn(),
      Utilities: { Internal: { copyTextToClipboard: copyText } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ["exportEntries", "copyCitationKeys"],
    ["copyCitationKeys", "exportEntries"],
  ] as const)(
    "keeps a newer export cancellable after the %s it replaced ends",
    async (first, second) => {
      const controller = createController(1);

      const older = START[first](controller);
      const newer = START[second](controller);
      const [olderSignal, newerSignal] = fetchMock.mock.calls.map(
        ([, init]) => init.signal as AbortSignal,
      );
      expect(olderSignal.aborted).toBe(true);
      expect(newerSignal.aborted).toBe(false);

      // The replaced export ends only now, while the newer one is running.
      await older;
      expect(lastMessage(progressWindows[0])).toBe(
        getString("references-panel-export-cancelled"),
      );

      controller.cancelExport();
      expect(newerSignal.aborted).toBe(true);
      await newer;
      expect(controller.exportAbort).toBeUndefined();
    },
  );

  it.each(["exportEntries", "copyCitationKeys"] as const)(
    "stops a replaced %s before its next batch",
    async (kind) => {
      // Two batches: METADATA_BATCH_SIZE entries, then one more.
      const controller = createController(METADATA_BATCH_SIZE + 1);
      // Every request is answered at once, except the older export's first
      // one: its answer arrives after the newer export has started, as if it
      // was already on its way when the older export was cancelled.
      fetchMock.mockImplementation(async () => new Response(ANSWER[kind]));
      let answerFirstRequest!: (response: Response) => void;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => (answerFirstRequest = resolve)),
      );

      const older = START[kind](controller);
      const newer = START[kind](controller);
      answerFirstRequest(new Response(ANSWER[kind]));
      await Promise.all([older, newer]);

      // The newer export fetched both batches; the older one stopped after
      // its first and left the clipboard alone.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(copyText).toHaveBeenCalledOnce();
      expect(lastMessage(progressWindows[0])).toBe(
        getString("references-panel-export-cancelled"),
      );
    },
  );
});
