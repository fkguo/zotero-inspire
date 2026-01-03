// ─────────────────────────────────────────────────────────────────────────────
// smartUpdate.test.ts - Unit tests for smart update comparison logic
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/prefs", () => ({
  getPref: vi.fn(),
}));

import { getPref } from "../src/utils/prefs";
import { compareItemWithInspire } from "../src/modules/inspire/smartUpdate";

function createItem(fields: Record<string, unknown>): any {
  const data = new Map<string, unknown>(Object.entries(fields));
  return {
    id: 1,
    itemType: "journalArticle",
    getField: (field: string) => data.get(field) ?? "",
    getCreators: () => [],
  };
}

describe("compareItemWithInspire (arXiv journalAbbreviation fallback)", () => {
  beforeEach(() => {
    vi.mocked(getPref).mockReset();
  });

  it("does not flag journalAbbreviation when arxiv_in_journal_abbrev is false", () => {
    vi.mocked(getPref).mockReturnValue(false);

    const item = createItem({
      title: "Test Paper",
      extra: "arXiv:1234.5678 [hep-ph]\n",
      journalAbbreviation: "",
    });

    const diff = compareItemWithInspire(item as any, {
      title: "Test Paper",
      arxiv: { value: "1234.5678", categories: ["hep-ph"] },
    } as any);

    expect(getPref).toHaveBeenCalledWith("arxiv_in_journal_abbrev");
    expect(diff.hasChanges).toBe(false);
    expect(diff.changes).toEqual([]);
  });

  it("flags journalAbbreviation when arxiv_in_journal_abbrev is true", () => {
    vi.mocked(getPref).mockReturnValue(true);

    const item = createItem({
      title: "Test Paper",
      extra: "arXiv:1234.5678 [hep-ph]\n",
      journalAbbreviation: "",
    });

    const diff = compareItemWithInspire(item as any, {
      title: "Test Paper",
      arxiv: { value: "1234.5678", categories: ["hep-ph"] },
    } as any);

    expect(getPref).toHaveBeenCalledWith("arxiv_in_journal_abbrev");
    expect(diff.hasChanges).toBe(true);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].field).toBe("journalAbbreviation");
  });
});

