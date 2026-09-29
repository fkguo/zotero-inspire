import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import type { WindowReporter } from "../src/modules/arxiv/browser/browserActions";
import { CompletionLine } from "../src/modules/arxiv/browser/completionLine";
import type { CompletionEntry } from "../src/modules/inspire/library/inspireCompletion";

// The arXiv browser's INSPIRE completion entry: a count from the library
// alone; INSPIRE is asked only when the user clicks Check now, and the items
// it has a record of go to the dialog where the user ticks what is written.

let win: DOMWindow;

beforeEach(() => {
  win = new JSDOM("<!DOCTYPE html><body></body>", {
    url: "https://zotero.test/",
  }).window;
  vi.stubGlobal("Zotero", { debug: vi.fn() });
  vi.stubGlobal("addon", {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id, args }]: Array<{
            id: string;
            args?: Record<string, unknown>;
          }>) => [{ value: args ? `${id} ${JSON.stringify(args)}` : id }],
        },
      },
    },
  });
});
afterEach(() => {
  win.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function msg(key: string, args?: Record<string, unknown>) {
  const id = `${config.addonRef}-${key}`;
  return args ? `${id} ${JSON.stringify(args)}` : id;
}

function entry(
  itemID: number,
  status: CompletionEntry["status"],
): CompletionEntry {
  return {
    itemID,
    libraryID: 1,
    arxivId: `2609.1000${itemID}`,
    title: `Paper ${itemID}`,
    status,
    mismatches: [],
    preselected: status === "found",
  };
}

function line(
  candidates: number,
  answers: CompletionEntry[] = [],
): {
  completion: CompletionLine;
  check: ReturnType<typeof vi.fn>;
  review: ReturnType<typeof vi.fn>;
  count: { value: number };
  notes: string[];
  asked: string[][];
} {
  const count = { value: candidates };
  const notes: string[] = [];
  const asked: string[][] = [];
  const reporter: WindowReporter = {
    notify: (message) => void notes.push(message),
    ask: (lines) =>
      void asked.push(typeof lines === "string" ? [lines] : [...lines]),
    startProgress: () => ({ update: () => undefined, close: () => undefined }),
  };
  const check = vi.fn(async () => answers);
  const review = vi.fn(async () => undefined);
  const completion = new CompletionLine(win.document, {
    reporter,
    candidates: async () =>
      Array.from({ length: count.value }, (_, i) => ({ id: i }) as any),
    check,
    review,
  });
  win.document.body.append(completion.element);
  return { completion, check, review, count, notes, asked };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("INSPIRE completion entry", () => {
  it("counts the recent preprints without an INSPIRE record, asking INSPIRE nothing", async () => {
    const { completion, check } = line(3);
    await settle();
    expect(completion.element.hidden).toBe(false);
    expect(completion.element.textContent).toContain(
      msg("arxiv-browser-completion", { count: 3 }),
    );
    expect(check).not.toHaveBeenCalled();
    completion.dispose();
  });

  it("is hidden when there are none", async () => {
    const { completion } = line(0);
    await settle();
    expect(completion.element.hidden).toBe(true);
    completion.dispose();
  });

  it("asks INSPIRE on Check now and shows the records found in this window, for the user to tick", async () => {
    const found = entry(1, "found");
    const { completion, check, review, asked } = line(3, [
      found,
      entry(2, "notFound"),
      entry(3, "failed"),
    ]);
    await settle();
    completion.element.querySelector("button")!.click();
    await vi.waitFor(() => expect(review).toHaveBeenCalled());
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0][0]).toHaveLength(3);
    expect(review.mock.calls[0][0]).toEqual([found]);
    expect(review.mock.calls[0][1].document).toBe(win.document);
    expect(asked).toEqual([
      [msg("arxiv-browser-completion-failed", { count: 1 })],
    ]);
    completion.dispose();
  });

  it("says so when INSPIRE has none of them yet", async () => {
    const { completion, review, notes } = line(1, [entry(1, "notFound")]);
    await settle();
    completion.element.querySelector("button")!.click();
    await vi.waitFor(() =>
      expect(notes).toEqual([msg("arxiv-browser-completion-none-found")]),
    );
    expect(review).not.toHaveBeenCalled();
    completion.dispose();
  });

  it("counts again a moment after the library changed", async () => {
    const { completion, count } = line(1);
    await settle();
    count.value = 2;
    completion.recount();
    await vi.waitFor(
      () =>
        expect(completion.element.textContent).toContain(
          msg("arxiv-browser-completion", { count: 2 }),
        ),
      { timeout: 4000 },
    );
    completion.dispose();
  });
});
