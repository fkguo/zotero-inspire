// ─────────────────────────────────────────────────────────────────────────────
// Recomputing the "in library" marks of papers (library/localStatus.ts), with
// lookups in the library index whose answers the tests hand out in any order
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const index = vi.hoisted(() => ({ libraryLookup: vi.fn() }));
vi.mock(
  "../src/modules/inspire/library/arxivIndex",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/modules/inspire/library/arxivIndex")
    >()),
    libraryLookup: index.libraryLookup,
  }),
);

import { LibraryIndexError } from "../src/modules/inspire/library/arxivIndex";
import {
  refreshLocalState,
  type LocalPaper,
} from "../src/modules/inspire/library/localStatus";

/** A lookup in a library that has `items` (recid -> item IDs) */
function libraryWith(items: Record<string, number[]>) {
  const hits = (ids: number[] = []) =>
    ids.map((itemID) => ({ itemID, libraryID: 1, hasRecid: true }));
  return {
    byRecid: (recid: string) => hits(items[recid]),
    byArxiv: () => [],
    byDOI: () => [],
  };
}

/** The next library lookup, answered when the test says so */
function heldLookup() {
  let answer!: (lookup: ReturnType<typeof libraryWith>) => void;
  let fail!: (err: Error) => void;
  index.libraryLookup.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        answer = resolve;
        fail = reject;
      }),
  );
  return {
    answer: (items: Record<string, number[]>) => answer(libraryWith(items)),
    fail: (err: Error) => fail(err),
  };
}

// An empty library unless a test says otherwise
beforeEach(() => {
  index.libraryLookup
    .mockReset()
    .mockImplementation(async () => libraryWith({}));
});

describe("refreshLocalState", () => {
  it("writes each paper's items, and clears those of papers not found", async () => {
    index.libraryLookup.mockResolvedValue(libraryWith({ "1": [5, 7] }));
    const papers: LocalPaper[] = [
      { recid: "1" },
      { recid: "2", localItemID: 9, localItemIDs: [9] },
      { recid: "3", localStatusUnknown: true },
      {},
    ];
    const changed = await refreshLocalState(papers);
    expect(papers).toEqual([
      { recid: "1", localItemID: 5, localItemIDs: [5, 7] },
      { recid: "2" },
      { recid: "3" },
      {},
    ]);
    expect(changed).toEqual([papers[0], papers[1], papers[2]]);
    // Nothing changes the second time
    expect(await refreshLocalState(papers)).toEqual([]);
  });

  it("marks the papers unknown when the library cannot be read", async () => {
    index.libraryLookup.mockImplementation(async () => {
      throw new LibraryIndexError("locked");
    });
    const papers: LocalPaper[] = [{ recid: "1", localItemID: 5 }, {}];
    await refreshLocalState(papers);
    expect(papers).toEqual([
      { recid: "1", localStatusUnknown: true },
      { localStatusUnknown: true },
    ]);
  });

  it("lets other failures through", async () => {
    index.libraryLookup.mockImplementation(async () => {
      throw new TypeError("a bug");
    });
    await expect(refreshLocalState([{ recid: "1" }])).rejects.toThrow(
      TypeError,
    );
  });

  // The generation rule: an older refresh that finishes after a newer one
  // does not overwrite the newer one's marks (before, the refresh that
  // finished last won)
  it("keeps the marks of the newer refresh when an older one finishes later", async () => {
    const paper: LocalPaper = { recid: "1" };
    const older = heldLookup();
    const newer = heldLookup();
    const first = refreshLocalState([paper]);
    const second = refreshLocalState([paper]);

    // The newer refresh sees the item moved to the trash; the older one
    // answers late with the library as it was
    newer.answer({});
    await second;
    older.answer({ "1": [5] });
    expect(await first).toEqual([]);
    expect(paper).toEqual({ recid: "1" });
  });

  it("writes the papers that no newer refresh took over", async () => {
    const shared: LocalPaper = { recid: "1" };
    const onlyOld: LocalPaper = { recid: "2" };
    const older = heldLookup();
    const newer = heldLookup();
    const first = refreshLocalState([shared, onlyOld]);
    const second = refreshLocalState([shared]);

    newer.answer({ "1": [5] });
    await second;
    older.answer({ "1": [6], "2": [8] });
    expect(await first).toEqual([onlyOld]);
    expect(shared.localItemID).toBe(5);
    expect(onlyOld.localItemID).toBe(8);
  });

  it("does not let an older failed read mark papers a newer refresh found", async () => {
    const paper: LocalPaper = { recid: "1" };
    const older = heldLookup();
    const newer = heldLookup();
    const first = refreshLocalState([paper]);
    const second = refreshLocalState([paper]);

    newer.answer({ "1": [5] });
    await second;
    older.fail(new LibraryIndexError("locked"));
    await first;
    expect(paper).toEqual({ recid: "1", localItemID: 5, localItemIDs: [5] });
  });

  // A caller reads the marks when its refresh returns (the lookup before
  // adding a paper): they are those of the newer refresh, not the old ones
  it("returns once a newer refresh that took its papers has written their marks", async () => {
    const paper: LocalPaper = { recid: "1", localStatusUnknown: true };
    const older = heldLookup();
    const newer = heldLookup();
    const first = refreshLocalState([paper]);
    const second = refreshLocalState([paper]);
    let firstReturned = false;
    void first.then(() => (firstReturned = true));

    older.answer({ "1": [5] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstReturned).toBe(false);
    expect(paper).toEqual({ recid: "1", localStatusUnknown: true });

    newer.answer({ "1": [5, 7] });
    expect(await first).toEqual([]);
    expect(paper).toEqual({ recid: "1", localItemID: 5, localItemIDs: [5, 7] });
    expect(await second).toEqual([paper]);
  });
});
