// ─────────────────────────────────────────────────────────────────────────────
// pdfAnnotate.test.ts - Unit tests for PDF Annotation module
// S-003: Test coverage for pdfAnnotate core functionality
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  normalizeAuthorName,
  normalizeAuthorCompact,
  extractLastName,
  authorsMatch,
  isCollaboration,
  extractCollaborationName,
  buildInitialsPattern,
} from "../src/modules/inspire/pdfAnnotate/authorUtils";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizeJournal,
  journalsSimilar,
} from "../src/modules/inspire/pdfAnnotate/matchScoring";
import {
  SCORE,
  YEAR_DELTA,
  AUTHOR_SCORE,
  PARSE_CONFIG,
  MATCH_CONFIG,
  DEBUG_MODE,
} from "../src/modules/inspire/pdfAnnotate/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Author Utilities Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("authorUtils", () => {
  describe("normalizeAuthorName", () => {
    it("normalizes basic author names", () => {
      expect(normalizeAuthorName("Smith")).toBe("smith");
      expect(normalizeAuthorName("van der Berg")).toBe("van der berg");
    });

    it("handles diacritics and special characters", () => {
      expect(normalizeAuthorName("Müller")).toBe("muller");
      expect(normalizeAuthorName("Schröder")).toBe("schroder");
      expect(normalizeAuthorName("Groß")).toBe("gross");
      expect(normalizeAuthorName("Höhn")).toBe("hohn");
    });

    it("handles German eszett", () => {
      expect(normalizeAuthorName("Großmann")).toBe("grossmann");
    });

    it("handles Nordic characters", () => {
      expect(normalizeAuthorName("Søren")).toBe("soren");
      expect(normalizeAuthorName("Ægir")).toBe("aegir");
    });

    it("handles hyphenated names", () => {
      expect(normalizeAuthorName("García-López")).toContain("garcia");
      expect(normalizeAuthorName("Jean-Pierre")).toContain("jean");
    });
  });

  describe("normalizeAuthorCompact", () => {
    it("removes spaces and converts to lowercase", () => {
      expect(normalizeAuthorCompact("Van Der Berg")).toBe("vanderberg");
      expect(normalizeAuthorCompact("de la Cruz")).toBe("delacruz");
    });

    it("removes dots", () => {
      expect(normalizeAuthorCompact("J. Smith")).toBe("jsmith");
      expect(normalizeAuthorCompact("A.B.C.")).toBe("abc");
    });

    it("handles null and empty input", () => {
      expect(normalizeAuthorCompact(null)).toBe(null);
      expect(normalizeAuthorCompact(undefined)).toBe(null);
      expect(normalizeAuthorCompact("")).toBe(null);
    });
  });

  describe("extractLastName", () => {
    it("extracts last name from full name", () => {
      expect(extractLastName("John Smith")).toBe("smith");
      expect(extractLastName("J. Smith")).toBe("smith");
    });

    it("handles compound surnames", () => {
      expect(extractLastName("van der Berg")).toBe("berg");
    });

    it("handles single names", () => {
      expect(extractLastName("Einstein")).toBe("einstein");
    });

    it("handles comma-separated format", () => {
      expect(extractLastName("Smith, John")).toBe("smith");
    });
  });

  describe("authorsMatch", () => {
    it("matches identical names", () => {
      expect(authorsMatch("smith", "smith")).toBe(true);
    });

    it("matches names with different case", () => {
      expect(authorsMatch("Smith", "smith")).toBe(true);
      expect(authorsMatch("SMITH", "smith")).toBe(true);
    });

    it("matches names with diacritics variations", () => {
      expect(authorsMatch("Müller", "Muller")).toBe(true);
      expect(authorsMatch("Schröder", "Schroder")).toBe(true);
    });

    it("returns false for unrelated names", () => {
      expect(authorsMatch("smith", "jones")).toBe(false);
    });
  });

  describe("isCollaboration", () => {
    it("detects collaboration names", () => {
      expect(isCollaboration("ATLAS Collaboration")).toBe(true);
      expect(isCollaboration("CMS collaboration")).toBe(true);
      expect(isCollaboration("Belle Collab.")).toBe(true);
    });

    it("detects other collaboration keywords", () => {
      expect(isCollaboration("Particle Data Group")).toBe(true);
      expect(isCollaboration("Super-K Team")).toBe(true);
    });

    it("returns false for individual authors", () => {
      expect(isCollaboration("John Smith")).toBe(false);
      expect(isCollaboration("A. Einstein")).toBe(false);
    });
  });

  describe("extractCollaborationName", () => {
    it("extracts collaboration name", () => {
      expect(extractCollaborationName("ATLAS Collaboration")).toBe("atlas");
      expect(extractCollaborationName("CMS Collaboration")).toBe("cms");
    });

    it("handles collaboration variations", () => {
      const result = extractCollaborationName("Belle II Collaboration");
      expect(result).toContain("belle");
    });
  });

  describe("buildInitialsPattern", () => {
    it("builds regex pattern for author with initials", () => {
      const pattern = buildInitialsPattern("smith", "J");
      expect(pattern).toBeInstanceOf(RegExp);
      // Pattern should match "J Smith" or "Smith, J" (case-insensitive)
      expect(pattern.test("J Smith")).toBe(true);
      expect(pattern.test("Smith, J")).toBe(true);
    });

    it("handles multiple initials", () => {
      const pattern = buildInitialsPattern("smith", "JK");
      expect(pattern.test("JK Smith")).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Match Scoring Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("matchScoring", () => {
  describe("normalizeArxivId", () => {
    it("removes version suffix", () => {
      expect(normalizeArxivId("2301.12345v2")).toBe("2301.12345");
      expect(normalizeArxivId("2301.12345v10")).toBe("2301.12345");
    });

    it("handles old-style arXiv IDs", () => {
      const result = normalizeArxivId("hep-th/0512345");
      expect(result).toContain("0512345");
    });

    it("preserves IDs without version", () => {
      expect(normalizeArxivId("2301.12345")).toBe("2301.12345");
    });

    it("handles empty input", () => {
      expect(normalizeArxivId("")).toBe(null);
      expect(normalizeArxivId(null)).toBe(null);
      expect(normalizeArxivId(undefined)).toBe(null);
    });
  });

  describe("normalizeDoi", () => {
    it("converts to lowercase", () => {
      expect(normalizeDoi("10.1234/ABC")).toBe("10.1234/abc");
    });

    it("trims whitespace and punctuation", () => {
      expect(normalizeDoi("10.1234/abc,")).toBe("10.1234/abc");
      expect(normalizeDoi("  10.1234/abc  ")).toBe("10.1234/abc");
    });

    it("handles empty input", () => {
      expect(normalizeDoi("")).toBe(null);
      expect(normalizeDoi(null)).toBe(null);
    });
  });

  describe("normalizeJournal", () => {
    it("normalizes journal names", () => {
      const result = normalizeJournal("Phys. Rev. D");
      expect(result).toBeTruthy();
      expect(result?.toLowerCase()).toContain("phys");
    });

    it("handles empty input", () => {
      expect(normalizeJournal("")).toBe(null);
      expect(normalizeJournal(null)).toBe(null);
    });
  });

  describe("journalsSimilar", () => {
    it("matches same journals", () => {
      expect(journalsSimilar("Phys. Rev. D", "Phys. Rev. D")).toBe(true);
    });

    it("matches case-insensitively", () => {
      expect(journalsSimilar("JHEP", "jhep")).toBe(true);
    });

    it("matches abbreviated vs full names", () => {
      expect(journalsSimilar("Physical Review D", "Phys. Rev. D")).toBeTruthy();
    });

    it("returns false for different journals", () => {
      expect(journalsSimilar("JHEP", "Nuclear Physics B")).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constants Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("constants", () => {
  describe("DEBUG_MODE", () => {
    it("is a boolean", () => {
      expect(typeof DEBUG_MODE).toBe("boolean");
    });
  });

  describe("SCORE", () => {
    it("has all required score values", () => {
      expect(SCORE.ARXIV_EXACT).toBeDefined();
      expect(SCORE.DOI_EXACT).toBeDefined();
      expect(SCORE.JOURNAL_EXACT).toBeDefined();
      expect(SCORE.VALIDATION_ACCEPT).toBeDefined();
      expect(SCORE.YEAR_MATCH_ACCEPT).toBeDefined();
      expect(SCORE.NO_YEAR_ACCEPT).toBeDefined();
    });

    it("has correct priority ordering", () => {
      expect(SCORE.ARXIV_EXACT).toBeGreaterThan(SCORE.DOI_EXACT);
      expect(SCORE.DOI_EXACT).toBeGreaterThan(SCORE.JOURNAL_EXACT);
    });

    it("has positive score values", () => {
      expect(SCORE.ARXIV_EXACT).toBeGreaterThan(0);
      expect(SCORE.DOI_EXACT).toBeGreaterThan(0);
      expect(SCORE.JOURNAL_EXACT).toBeGreaterThan(0);
    });
  });

  describe("AUTHOR_SCORE", () => {
    it("has all required author scoring values", () => {
      expect(AUTHOR_SCORE.FIRST_AUTHOR_MATCH).toBeDefined();
      expect(AUTHOR_SCORE.FIRST_AUTHOR_IN_TEXT).toBeDefined();
      expect(AUTHOR_SCORE.ADDITIONAL_MULTIPLIER).toBeDefined();
      expect(AUTHOR_SCORE.MAX_ADDITIONAL).toBeDefined();
      expect(AUTHOR_SCORE.MAX_TEXT_MATCH).toBeDefined();
      expect(AUTHOR_SCORE.COUNT_MATCH_BONUS).toBeDefined();
      expect(AUTHOR_SCORE.COUNT_MISMATCH_PENALTY).toBeDefined();
      expect(AUTHOR_SCORE.ET_AL_MATCH_BONUS).toBeDefined();
      expect(AUTHOR_SCORE.ET_AL_MISMATCH_PENALTY).toBeDefined();
      expect(AUTHOR_SCORE.TEXT_FALLBACK_THRESHOLD).toBeDefined();
    });

    it("has correct value types", () => {
      expect(typeof AUTHOR_SCORE.ADDITIONAL_MULTIPLIER).toBe("number");
      expect(AUTHOR_SCORE.ADDITIONAL_MULTIPLIER).toBe(1.5);
    });

    it("penalty values are negative", () => {
      expect(AUTHOR_SCORE.COUNT_MISMATCH_PENALTY).toBeLessThan(0);
      expect(AUTHOR_SCORE.ET_AL_MISMATCH_PENALTY).toBeLessThan(0);
    });

    it("bonus values are positive", () => {
      expect(AUTHOR_SCORE.FIRST_AUTHOR_MATCH).toBeGreaterThan(0);
      expect(AUTHOR_SCORE.COUNT_MATCH_BONUS).toBeGreaterThan(0);
    });
  });

  describe("YEAR_DELTA", () => {
    it("has correct threshold ordering", () => {
      expect(YEAR_DELTA.CLOSE).toBeLessThan(YEAR_DELTA.REASONABLE);
      expect(YEAR_DELTA.REASONABLE).toBeLessThan(YEAR_DELTA.MAX_ACCEPTABLE);
    });
  });

  describe("PARSE_CONFIG", () => {
    it("has positive page limits", () => {
      expect(PARSE_CONFIG.MAX_REF_PAGES).toBeGreaterThan(0);
      expect(PARSE_CONFIG.MAX_ENTRY_LENGTH).toBeGreaterThan(0);
    });
  });

  describe("MATCH_CONFIG", () => {
    it("has alignment rates between 0 and 1", () => {
      expect(MATCH_CONFIG.ALIGN_RATE_HIGH).toBeGreaterThan(0);
      expect(MATCH_CONFIG.ALIGN_RATE_HIGH).toBeLessThanOrEqual(1);
      expect(MATCH_CONFIG.ALIGN_RATE_MEDIUM).toBeGreaterThan(0);
      expect(MATCH_CONFIG.ALIGN_RATE_MEDIUM).toBeLessThanOrEqual(1);
    });

    it("has reasonable year range", () => {
      expect(MATCH_CONFIG.YEAR_RANGE_MIN).toBeLessThan(
        MATCH_CONFIG.YEAR_RANGE_MAX,
      );
      expect(MATCH_CONFIG.YEAR_RANGE_MIN).toBeGreaterThanOrEqual(1900);
      expect(MATCH_CONFIG.YEAR_RANGE_MAX).toBeLessThanOrEqual(2100);
    });
  });
});
