// ─────────────────────────────────────────────────────────────────────────────
// preprintWatch.test.ts - Unit tests for Preprint Watch module
// FTR-PREPRINT-WATCH: Test coverage for preprint detection and identification
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  isArxivDoi,
  ARXIV_DOI_PREFIX,
} from "../src/modules/inspire/preprintWatchService";

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
// arXiv ID Extraction Regex Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("arXiv ID extraction patterns", () => {
  // Regex patterns from preprintWatchService.ts
  const ARXIV_ID_EXTRACT_REGEX = /arXiv:([\d.]+|[a-z-]+\/\d{7})/i;
  const ARXIV_URL_REGEX = /arxiv\.org\/abs\/([\d.]+|[a-z-]+\/\d{7})/i;
  const ARXIV_DOI_REGEX = /10\.48550\/arXiv\.([\d.]+)/i;

  describe("ARXIV_ID_EXTRACT_REGEX", () => {
    it("extracts new format arXiv IDs", () => {
      const match1 = "arXiv:2301.12345".match(ARXIV_ID_EXTRACT_REGEX);
      expect(match1?.[1]).toBe("2301.12345");

      const match2 = "arXiv:2401.00001 [hep-ph]".match(ARXIV_ID_EXTRACT_REGEX);
      expect(match2?.[1]).toBe("2401.00001");

      const match3 = "arXiv:2312.17654".match(ARXIV_ID_EXTRACT_REGEX);
      expect(match3?.[1]).toBe("2312.17654");
    });

    it("extracts old format arXiv IDs", () => {
      const match1 = "arXiv:hep-ph/0001234".match(ARXIV_ID_EXTRACT_REGEX);
      expect(match1?.[1]).toBe("hep-ph/0001234");

      const match2 = "arXiv:hep-th/9901001".match(ARXIV_ID_EXTRACT_REGEX);
      expect(match2?.[1]).toBe("hep-th/9901001");

      const match3 = "arXiv:gr-qc/0512345".match(ARXIV_ID_EXTRACT_REGEX);
      expect(match3?.[1]).toBe("gr-qc/0512345");
    });

    it("handles case insensitivity", () => {
      const match1 = "ARXIV:2301.12345".match(ARXIV_ID_EXTRACT_REGEX);
      expect(match1?.[1]).toBe("2301.12345");

      const match2 = "ArXiv:hep-ph/0001234".match(ARXIV_ID_EXTRACT_REGEX);
      expect(match2?.[1]).toBe("hep-ph/0001234");
    });
  });

  describe("ARXIV_URL_REGEX", () => {
    it("extracts arXiv ID from abs URLs", () => {
      const match1 = "https://arxiv.org/abs/2301.12345".match(ARXIV_URL_REGEX);
      expect(match1?.[1]).toBe("2301.12345");

      const match2 = "http://arxiv.org/abs/hep-ph/0001234".match(
        ARXIV_URL_REGEX,
      );
      expect(match2?.[1]).toBe("hep-ph/0001234");
    });
  });

  describe("ARXIV_DOI_REGEX", () => {
    it("extracts arXiv ID from arXiv DOIs", () => {
      const match1 = "10.48550/arXiv.2301.12345".match(ARXIV_DOI_REGEX);
      expect(match1?.[1]).toBe("2301.12345");

      const match2 = "10.48550/arXiv.2401.00001".match(ARXIV_DOI_REGEX);
      expect(match2?.[1]).toBe("2401.00001");
    });
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
// extractArxivIdFromItem logic tests
// ─────────────────────────────────────────────────────────────────────────────

describe("extractArxivIdFromItem logic", () => {
  const ARXIV_ID_EXTRACT_REGEX = /arXiv:([\d.]+|[a-z-]+\/\d{7})/i;
  const ARXIV_URL_REGEX = /arxiv\.org\/abs\/([\d.]+|[a-z-]+\/\d{7})/i;
  const ARXIV_DOI_REGEX = /10\.48550\/arXiv\.([\d.]+)/i;

  const extractArxivIdLogic = (
    journalAbbrev: string,
    extra: string,
    url: string,
    doi: string,
  ): string | null => {
    // Try journalAbbreviation first
    if (journalAbbrev) {
      const match = journalAbbrev.match(ARXIV_ID_EXTRACT_REGEX);
      if (match) return match[1];
    }

    // Try Extra field
    if (extra) {
      const match = extra.match(ARXIV_ID_EXTRACT_REGEX);
      if (match) return match[1];
    }

    // Try URL
    if (url?.includes("arxiv.org")) {
      const match = url.match(ARXIV_URL_REGEX);
      if (match) return match[1];
    }

    // Try DOI
    if (doi?.startsWith("10.48550/arXiv")) {
      const match = doi.match(ARXIV_DOI_REGEX);
      if (match) return match[1];
    }

    return null;
  };

  it("extracts from journalAbbreviation", () => {
    expect(extractArxivIdLogic("arXiv:2301.12345 [hep-ph]", "", "", "")).toBe(
      "2301.12345",
    );
    expect(extractArxivIdLogic("arXiv:hep-ph/0001234", "", "", "")).toBe(
      "hep-ph/0001234",
    );
  });

  it("extracts from Extra field", () => {
    expect(extractArxivIdLogic("", "arXiv:2301.12345", "", "")).toBe(
      "2301.12345",
    );
    expect(
      extractArxivIdLogic(
        "",
        "Some text\narXiv:2301.12345 [hep-ph]\nMore text",
        "",
        "",
      ),
    ).toBe("2301.12345");
  });

  it("extracts from URL", () => {
    expect(
      extractArxivIdLogic("", "", "https://arxiv.org/abs/2301.12345", ""),
    ).toBe("2301.12345");
    expect(
      extractArxivIdLogic("", "", "http://arxiv.org/abs/hep-ph/0001234", ""),
    ).toBe("hep-ph/0001234");
  });

  it("extracts from arXiv DOI", () => {
    expect(extractArxivIdLogic("", "", "", "10.48550/arXiv.2301.12345")).toBe(
      "2301.12345",
    );
  });

  it("respects priority: journalAbbrev > Extra > URL > DOI", () => {
    // All fields have different IDs, should return journalAbbrev's ID
    expect(
      extractArxivIdLogic(
        "arXiv:1111.11111",
        "arXiv:2222.22222",
        "https://arxiv.org/abs/3333.33333",
        "10.48550/arXiv.4444.44444",
      ),
    ).toBe("1111.11111");

    // No journalAbbrev, should return Extra's ID
    expect(
      extractArxivIdLogic(
        "",
        "arXiv:2222.22222",
        "https://arxiv.org/abs/3333.33333",
        "10.48550/arXiv.4444.44444",
      ),
    ).toBe("2222.22222");
  });

  it("returns null when no arXiv ID found", () => {
    expect(
      extractArxivIdLogic(
        "Phys. Rev. D",
        "",
        "",
        "10.1103/PhysRevD.100.012345",
      ),
    ).toBe(null);
    expect(extractArxivIdLogic("", "", "", "")).toBe(null);
  });
});
