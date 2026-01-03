// ─────────────────────────────────────────────────────────────────────────────
// relatedPapersService.test.ts - Unit tests for related papers service helpers
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { selectRelatedAnchors } from "../src/modules/inspire/relatedPapersService";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

function createEntry(
  overrides: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id: "test-id",
    recid: "1",
    title: "Test Paper",
    authors: [],
    year: "2024",
    authorText: "",
    displayText: "",
    searchText: "",
    ...overrides,
  };
}

describe("selectRelatedAnchors", () => {
  it("dedupes by recid and skips PDG RPP", () => {
    const seed: InspireReferenceEntry[] = [
      createEntry({
        recid: "A",
        title: "Paper A",
        citationCount: 100,
        citationCountWithoutSelf: 5,
      }),
      // PDG RPP is intentionally excluded as an anchor (too generic)
      createEntry({
        recid: "PDG",
        title: "Review of Particle Physics",
        citationCount: 999999,
      }),
      createEntry({ recid: "B", title: "Paper B", citationCount: 10 }),
      // Duplicate recid should be ignored (first occurrence wins)
      createEntry({ recid: "A", title: "Paper A (dup)", citationCount: 999 }),
      // Missing recid should be ignored
      createEntry({ recid: undefined, title: "No recid", citationCount: 999 }),
    ];

    const anchors = selectRelatedAnchors(seed, 10);
    expect(anchors.map((a) => a.recid)).toEqual(["B", "A"]);
    expect(anchors.map((a) => a.title)).toEqual(["Paper B", "Paper A"]);
    expect(anchors.every((a) => Number.isFinite(a.weight) && a.weight > 0)).toBe(
      true,
    );
  });

  it("falls back to recid when title is empty", () => {
    const seed: InspireReferenceEntry[] = [
      createEntry({ recid: "10", title: "" }),
      createEntry({ recid: "11", title: "  " }),
    ];

    const anchors = selectRelatedAnchors(seed, 5);
    expect(anchors.map((a) => ({ recid: a.recid, title: a.title }))).toEqual([
      { recid: "10", title: "10" },
      { recid: "11", title: "11" },
    ]);
    expect(anchors.every((a) => Number.isFinite(a.weight) && a.weight > 0)).toBe(
      true,
    );
  });

  it("returns empty list for non-positive maxAnchors", () => {
    const seed: InspireReferenceEntry[] = [
      createEntry({ recid: "A", title: "Paper A", citationCount: 1 }),
    ];
    expect(selectRelatedAnchors(seed, 0)).toEqual([]);
    expect(selectRelatedAnchors(seed, -1)).toEqual([]);
  });

  it("excludes review document_type and review journals when enabled", () => {
    const seed: InspireReferenceEntry[] = [
      createEntry({
        recid: "A",
        title: "Normal Paper",
        citationCount: 10,
        publicationInfo: { journal_title: "Phys. Rev. D" },
      }),
      createEntry({
        recid: "B",
        title: "Review Type Paper",
        citationCount: 20,
        documentType: ["review"],
      }),
      createEntry({
        recid: "C",
        title: "RMP Paper",
        citationCount: 30,
        publicationInfo: { journal_title: "Rev. Mod. Phys." },
      }),
      createEntry({
        recid: "D",
        title: "PhysRept Paper",
        citationCount: 40,
        publicationInfo: { journal_title: "Phys. Rept." },
      }),
      createEntry({
        recid: "E",
        title: "PPNP Paper",
        citationCount: 50,
        publicationInfo: { journal_title: "Prog. Part. Nucl. Phys." },
      }),
      createEntry({
        recid: "F",
        title: "Annual Review Paper",
        citationCount: 60,
        publicationInfo: { journal_title: "Annual Review of Nuclear and Particle Science" },
      }),
      createEntry({
        recid: "G",
        title: "RPP Paper",
        citationCount: 70,
        publicationInfo: { journal_title: "Rep. Prog. Phys." },
      }),
    ];

    const anchors = selectRelatedAnchors(seed, 20, { excludeReviewArticles: true });
    expect(anchors.map((a) => a.recid)).toEqual(["A"]);
  });

  it("keeps review journals when review exclusion is disabled", () => {
    const seed: InspireReferenceEntry[] = [
      createEntry({
        recid: "A",
        title: "Normal Paper",
        citationCount: 10,
        publicationInfo: { journal_title: "Phys. Rev. D" },
      }),
      createEntry({
        recid: "B",
        title: "Review Type Paper",
        citationCount: 20,
        documentType: ["review"],
      }),
      createEntry({
        recid: "C",
        title: "RMP Paper",
        citationCount: 30,
        publicationInfo: { journal_title: "Rev. Mod. Phys." },
      }),
      createEntry({
        recid: "D",
        title: "PhysRept Paper",
        citationCount: 40,
        publicationInfo: { journal_title: "Phys. Rept." },
      }),
      createEntry({
        recid: "E",
        title: "PPNP Paper",
        citationCount: 50,
        publicationInfo: { journal_title: "Prog. Part. Nucl. Phys." },
      }),
      createEntry({
        recid: "F",
        title: "Annual Review Paper",
        citationCount: 60,
        publicationInfo: { journal_title: "Annual Review of Nuclear and Particle Science" },
      }),
      createEntry({
        recid: "G",
        title: "RPP Paper",
        citationCount: 70,
        publicationInfo: { journal_title: "Rep. Prog. Phys." },
      }),
    ];

    const anchors = selectRelatedAnchors(seed, 20, { excludeReviewArticles: false });
    expect(anchors.map((a) => a.recid).sort()).toEqual(
      ["A", "B", "C", "D", "E", "F", "G"].sort(),
    );
  });
});
