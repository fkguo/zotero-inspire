// ─────────────────────────────────────────────────────────────────────────────
// The main window's "Copy INSPIRE link" and "Copy INSPIRE link (Markdown)"
// on the selected item: the link to its INSPIRE record (from the recid the
// item stores), and the notices. The arXiv browser's entry builds the same
// link (inspireLiteratureUrl); these tests keep the main window's as it was.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(async (_text: string) => true),
  lines: [] as Array<{ text?: string; type?: string }>,
}));
vi.mock("../src/modules/inspire/apiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/inspire/apiUtils")>()),
  copyToClipboard: mocks.copy,
}));
vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: { getCacheDir: async () => "/cache" },
}));
vi.mock("zotero-plugin-toolkit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zotero-plugin-toolkit")>();
  class FakeProgressWindow {
    createLine(line: { text?: string; type?: string }) {
      mocks.lines.push(line);
      return this;
    }
    show() {
      return this;
    }
    startCloseTimer() {
      return this;
    }
  }
  return { ...actual, ProgressWindowHelper: FakeProgressWindow };
});

import { ZInspire } from "../src/modules/inspire/itemUpdater";

let selected: unknown[];

/** A regular item with these fields */
function item(fields: Record<string, string>) {
  return {
    isRegularItem: () => true,
    getField: (name: string) => fields[name] ?? "",
  };
}

beforeEach(() => {
  selected = [];
  mocks.copy.mockClear();
  mocks.lines.length = 0;
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    getActiveZoteroPane: () => ({ getSelectedItems: () => selected }),
  });
  vi.stubGlobal("addon", {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id }]: Array<{ id: string }>) => [
            { value: id },
          ],
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const notices = () => mocks.lines.map((line) => `${line.type} ${line.text}`);

describe("main window: Copy INSPIRE link", () => {
  it("copies the link of the item's recid", async () => {
    selected = [item({ archive: "INSPIRE", archiveLocation: "3071234" })];
    await new ZInspire().copyInspireLink();
    expect(mocks.copy).toHaveBeenCalledWith(
      "https://inspirehep.net/literature/3071234",
    );
    expect(notices()).toEqual([
      "success zoteroinspire-copy-success-inspire-link",
    ]);
  });

  it("copies the Markdown link with the item's citation key", async () => {
    selected = [
      item({
        archive: "INSPIRE",
        archiveLocation: "3071234",
        citationKey: "Vattolo:2026omw",
      }),
    ];
    await new ZInspire().copyInspireLinkMarkdown();
    expect(mocks.copy).toHaveBeenCalledWith(
      "[Vattolo:2026omw](https://inspirehep.net/literature/3071234)",
    );
    expect(notices()).toEqual([
      "success zoteroinspire-copy-success-inspire-link-md",
    ]);
  });

  it("copies nothing for an item without a recid, saying so", async () => {
    selected = [item({ title: "A paper" })];
    await new ZInspire().copyInspireLink();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(notices()).toEqual(["fail zoteroinspire-copy-error-no-recid"]);
  });
});
