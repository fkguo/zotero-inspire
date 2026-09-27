// ─────────────────────────────────────────────────────────────────────────────
// preprintWatch.test.ts - Unit tests for Preprint Watch module
// FTR-PREPRINT-WATCH: Test coverage for preprint detection and identification
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  isArxivDoi,
  isUnpublishedPreprint,
  ARXIV_DOI_PREFIX,
} from "../src/modules/inspire/preprintWatchService";
import { arxivIdFromItem } from "../src/modules/arxiv/arxivId";

// ─────────────────────────────────────────────────────────────────────────────
// arXiv DOI Detection Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("isArxivDoi", () => {
  it("correctly identifies arXiv DOIs", () => {
    expect(isArxivDoi("10.48550/arXiv.2301.12345")).toBe(true);
    expect(isArxivDoi("10.48550/arXiv.hep-ph/0001234")).toBe(true);
    expect(isArxivDoi("10.48550/arXiv.2401.00001")).toBe(true);
  });

  it("correctly rejects non-arXiv DOIs", () => {
    expect(isArxivDoi("10.1103/PhysRevD.100.012345")).toBe(false);
    expect(isArxivDoi("10.1007/JHEP01(2024)001")).toBe(false);
    expect(isArxivDoi("10.1016/j.physletb.2024.138456")).toBe(false);
  });

  it("handles null and undefined", () => {
    expect(isArxivDoi(null)).toBe(false);
    expect(isArxivDoi(undefined)).toBe(false);
    expect(isArxivDoi("")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// journalAbbreviation Detection Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("journalAbbreviation detection", () => {
  const ARXIV_JOURNAL_ABBREV_REGEX = /^arXiv:/i;

  it("detects arXiv journalAbbreviation", () => {
    expect(ARXIV_JOURNAL_ABBREV_REGEX.test("arXiv:2301.12345 [hep-ph]")).toBe(
      true,
    );
    expect(ARXIV_JOURNAL_ABBREV_REGEX.test("arXiv:hep-ph/0001234")).toBe(true);
    expect(ARXIV_JOURNAL_ABBREV_REGEX.test("ARXIV:2301.12345")).toBe(true);
  });

  it("rejects non-arXiv journalAbbreviation", () => {
    expect(ARXIV_JOURNAL_ABBREV_REGEX.test("Phys. Rev. D")).toBe(false);
    expect(ARXIV_JOURNAL_ABBREV_REGEX.test("JHEP")).toBe(false);
    expect(ARXIV_JOURNAL_ABBREV_REGEX.test("Eur. Phys. J. C")).toBe(false);
    expect(ARXIV_JOURNAL_ABBREV_REGEX.test("")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constants Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Constants", () => {
  it("ARXIV_DOI_PREFIX is correct", () => {
    expect(ARXIV_DOI_PREFIX).toBe("10.48550/arXiv");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mock Zotero Item Tests (for isUnpublishedPreprint logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("isUnpublishedPreprint logic", () => {
  // Test the logic without Zotero dependency
  const isUnpublishedPreprintLogic = (
    itemType: string,
    journalAbbrev: string,
    doi: string,
    extra: string,
  ): boolean => {
    const ARXIV_JOURNAL_ABBREV_REGEX = /^arXiv:/i;
    const isArxivDoiFn = (d: string) =>
      d?.startsWith("10.48550/arXiv") ?? false;

    // Skip non-journal articles
    if (itemType !== "journalArticle") return false;

    // Case 1: journalAbbreviation starts with "arXiv:"
    if (journalAbbrev && ARXIV_JOURNAL_ABBREV_REGEX.test(journalAbbrev)) {
      // But check if there's also a real journal DOI
      if (doi && !isArxivDoiFn(doi)) {
        return false; // Has journal DOI, already published
      }
      return true;
    }

    // Case 2: No journal info but has arXiv in Extra
    if (!journalAbbrev && extra?.includes("arXiv:")) {
      return true;
    }

    // Case 3: Only has arXiv DOI
    if (doi && isArxivDoiFn(doi) && !journalAbbrev) {
      return true;
    }

    return false;
  };

  it("identifies preprint with arXiv journalAbbreviation", () => {
    expect(
      isUnpublishedPreprintLogic(
        "journalArticle",
        "arXiv:2301.12345 [hep-ph]",
        "",
        "",
      ),
    ).toBe(true);
  });

  it("identifies preprint with arXiv journalAbbreviation and arXiv DOI", () => {
    expect(
      isUnpublishedPreprintLogic(
        "journalArticle",
        "arXiv:2301.12345 [hep-ph]",
        "10.48550/arXiv.2301.12345",
        "",
      ),
    ).toBe(true);
  });

  it("excludes published paper with journal DOI", () => {
    expect(
      isUnpublishedPreprintLogic(
        "journalArticle",
        "arXiv:2301.12345 [hep-ph]",
        "10.1103/PhysRevD.100.012345",
        "",
      ),
    ).toBe(false);
  });

  it("excludes paper with journal abbreviation (not arXiv)", () => {
    expect(
      isUnpublishedPreprintLogic(
        "journalArticle",
        "Phys. Rev. D",
        "10.1103/PhysRevD.100.012345",
        "",
      ),
    ).toBe(false);
  });

  it("identifies preprint with arXiv in Extra only", () => {
    expect(
      isUnpublishedPreprintLogic(
        "journalArticle",
        "",
        "",
        "arXiv:2301.12345 [hep-ph]",
      ),
    ).toBe(true);
  });

  it("identifies preprint with only arXiv DOI", () => {
    expect(
      isUnpublishedPreprintLogic(
        "journalArticle",
        "",
        "10.48550/arXiv.2301.12345",
        "",
      ),
    ).toBe(true);
  });

  it("excludes non-journalArticle items", () => {
    expect(
      isUnpublishedPreprintLogic("book", "arXiv:2301.12345 [hep-ph]", "", ""),
    ).toBe(false);

    expect(
      isUnpublishedPreprintLogic(
        "preprint",
        "arXiv:2301.12345 [hep-ph]",
        "",
        "",
      ),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real isUnpublishedPreprint / arxivIdFromItem on fake items
// Issue #7: Preprint items kept as Preprint must be monitored too.
// Fields that do not exist for a type read back as "" (Zotero getField).
// ─────────────────────────────────────────────────────────────────────────────

function fakeItem(itemType: string, fields: Record<string, string> = {}): any {
  return {
    id: 1,
    itemType,
    deleted: false,
    getField: (field: string) => fields[field] ?? "",
  };
}

describe("isUnpublishedPreprint with Preprint items", () => {
  it("treats a preprint with an arXiv ID in Extra as unpublished", () => {
    const item = fakeItem("preprint", { extra: "arXiv:2301.12345 [hep-ph]" });
    expect(isUnpublishedPreprint(item)).toBe(true);
    expect(arxivIdFromItem(item)).toBe("2301.12345");
  });

  it("finds the arXiv ID from URL, Archive ID, or arXiv DOI", () => {
    expect(
      isUnpublishedPreprint(
        fakeItem("preprint", { url: "https://arxiv.org/abs/2302.00001" }),
      ),
    ).toBe(true);
    const viaArchiveId = fakeItem("preprint", {
      archiveID: "arXiv:2303.00002",
    });
    expect(isUnpublishedPreprint(viaArchiveId)).toBe(true);
    expect(arxivIdFromItem(viaArchiveId)).toBe("2303.00002");
    expect(
      isUnpublishedPreprint(
        fakeItem("preprint", { DOI: "10.48550/arXiv.2304.00003" }),
      ),
    ).toBe(true);
  });

  it("handles old-style identifiers in Archive ID", () => {
    const item = fakeItem("preprint", { archiveID: "arXiv:hep-ph/0001234" });
    expect(arxivIdFromItem(item)).toBe("hep-ph/0001234");
    expect(isUnpublishedPreprint(item)).toBe(true);
  });

  it("ignores a preprint without any arXiv identifier", () => {
    expect(isUnpublishedPreprint(fakeItem("preprint", { title: "x" }))).toBe(
      false,
    );
  });

  it("keeps the journalArticle rules and skips other types", () => {
    expect(
      isUnpublishedPreprint(
        fakeItem("journalArticle", {
          journalAbbreviation: "Phys. Rev. D",
          DOI: "10.1103/PhysRevD.100.012345",
          volume: "100",
          pages: "012345",
        }),
      ),
    ).toBe(false);
    expect(
      isUnpublishedPreprint(
        fakeItem("journalArticle", { extra: "arXiv:2301.12345 [hep-ph]" }),
      ),
    ).toBe(true);
    expect(
      isUnpublishedPreprint(
        fakeItem("report", { extra: "arXiv:2301.12345 [hep-ph]" }),
      ),
    ).toBe(false);
  });
});
