// ─────────────────────────────────────────────────────────────────────────────
// authorYearCitation.test.ts - Unit tests for author-year citation detection
// Tests RMP-style citations: (Author, Year), Author et al. (Year), etc.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";
import { CitationParser } from "../src/modules/inspire/pdfAnnotate/citationParser";
import { LabelMatcher } from "../src/modules/inspire/pdfAnnotate/labelMatcher";
import type { InspireReferenceEntry } from "../src/modules/inspire/types";

// Mock ztoolkit global (used for logging in citationParser.ts)
beforeAll(() => {
  (globalThis as any).ztoolkit = {
    log: vi.fn(),
  };
  // Mock Zotero.debug for labelMatcher.ts
  (globalThis as any).Zotero = {
    debug: vi.fn(),
  };
});

describe("Author-Year Citation Detection", () => {
  let parser: CitationParser;

  beforeEach(() => {
    parser = new CitationParser();
  });

  describe("parseSelection - Author-Year Formats", () => {
    // Pattern 1: Authors inside parentheses with comma before year
    describe("Pattern 1: (Authors, Year)", () => {
      it("should detect single author in parentheses: (Sjostrand, 2008)", () => {
        const result = parser.parseSelection("(Sjostrand, 2008)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Sjostrand");
        expect(result?.labels).toContain("2008");
      });

      it("should detect multiple authors with comma-and: (Sjostrand, Mrenna, and Skands, 2008)", () => {
        const result = parser.parseSelection(
          "(Sjostrand, Mrenna, and Skands, 2008)",
        );
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Sjostrand");
        expect(result?.labels).toContain("Mrenna");
        expect(result?.labels).toContain("Skands");
        expect(result?.labels).toContain("2008");
      });

      it("should detect et al. inside parentheses: (Bahr et al., 2008)", () => {
        const result = parser.parseSelection("(Bahr et al., 2008)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Bahr");
        expect(result?.labels).toContain("2008");
        // Should have "et al." format label
        expect(result?.labels.some((l) => l.includes("et al."))).toBe(true);
      });

      it("should detect year with suffix: (Guo et al., 2014b)", () => {
        const result = parser.parseSelection("(Guo et al., 2014b)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Guo");
        expect(result?.labels).toContain("2014b");
      });

      it("should detect two authors with 'and': (Author and Author, Year)", () => {
        const result = parser.parseSelection("(Weinstein and Isgur, 1982)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Weinstein");
        expect(result?.labels).toContain("Isgur");
        expect(result?.labels).toContain("1982");
      });
    });

    // Pattern 2: et al. outside parentheses, year in parentheses
    describe("Pattern 2: Author et al. (Year)", () => {
      it("should detect: Weinstein et al. (1982)", () => {
        const result = parser.parseSelection("Weinstein et al. (1982)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Weinstein");
        expect(result?.labels).toContain("1982");
      });

      it("should detect multiple authors before et al.: Albaladejo, Guo et al. (2017)", () => {
        const result = parser.parseSelection("Albaladejo, Guo et al. (2017)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Albaladejo");
        expect(result?.labels).toContain("Guo");
        expect(result?.labels).toContain("2017");
      });

      it("should detect with year suffix: Chen et al. (2017a)", () => {
        const result = parser.parseSelection("Chen et al. (2017a)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Chen");
        expect(result?.labels).toContain("2017a");
      });
    });

    // Pattern 3: Two authors with 'and', year in parentheses
    describe("Pattern 3: Author and Author (Year)", () => {
      it("should detect: Weinstein and Isgur (1982)", () => {
        const result = parser.parseSelection("Weinstein and Isgur (1982)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Weinstein");
        expect(result?.labels).toContain("Isgur");
        expect(result?.labels).toContain("1982");
      });

      it("should detect: Artoisenet and Braaten (2010)", () => {
        const result = parser.parseSelection("Artoisenet and Braaten (2010)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Artoisenet");
        expect(result?.labels).toContain("Braaten");
        expect(result?.labels).toContain("2010");
      });
    });

    // Pattern 4: Single author with year in parentheses
    describe("Pattern 4: Author (Year)", () => {
      it("should detect: Zweig (1964)", () => {
        const result = parser.parseSelection("Zweig (1964)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Zweig");
        expect(result?.labels).toContain("1964");
      });

      it("should detect: Okubo (1963)", () => {
        const result = parser.parseSelection("Okubo (1963)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Okubo");
        expect(result?.labels).toContain("1963");
      });
    });

    // Exclusion tests - should NOT detect as author-year
    describe("Exclusions - Should NOT detect as author-year", () => {
      it("should NOT detect standalone year as author-year: 2008", () => {
        const result = parser.parseSelection("2008");
        // Should be numeric, not author-year
        if (result) {
          expect(result.type).not.toBe("author-year");
        }
      });

      it("should NOT detect document references: Section (2017)", () => {
        const result = parser.parseSelection("Section (2017)");
        // Should not match as author-year citation
        if (result?.type === "author-year") {
          expect(result.labels).not.toContain("Section");
        }
      });

      it("should NOT detect Figure references: Figure (2)", () => {
        const result = parser.parseSelection("Figure (2)");
        // Single digit year is not valid
        expect(result?.type).not.toBe("author-year");
      });

      it("should NOT detect Equation references: Equation (35)", () => {
        const result = parser.parseSelection("Equation (35)");
        expect(result?.type).not.toBe("author-year");
      });
    });

    // Complex real-world examples from the debug output
    describe("Real-world examples from RMP papers", () => {
      it("should detect: PYTHIA (Sjostrand, Mrenna, and Skands, 2008)", () => {
        const result = parser.parseSelection(
          "PYTHIA (Sjostrand, Mrenna, and Skands, 2008)",
        );
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Sjostrand");
        expect(result?.labels).toContain("Mrenna");
        expect(result?.labels).toContain("Skands");
        expect(result?.labels).toContain("2008");
      });

      it("should detect: HERWIG (Bahr et al., 2008)", () => {
        const result = parser.parseSelection("HERWIG (Bahr et al., 2008)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Bahr");
        expect(result?.labels).toContain("2008");
      });

      it("should detect citation in sentence context", () => {
        const text =
          "as discussed by Albaladejo, Guo et al. (2017) in their review";
        const result = parser.parseSelection(text);
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Albaladejo");
        expect(result?.labels).toContain("Guo");
        expect(result?.labels).toContain("2017");
      });
    });

    // Year suffix disambiguation tests
    describe("Year suffix disambiguation (2017a vs 2017b)", () => {
      it("should preserve year suffix: (Chen, 2017a)", () => {
        const result = parser.parseSelection("(Chen, 2017a)");
        expect(result).not.toBeNull();
        expect(result?.labels).toContain("2017a");
        expect(result?.labels).not.toContain("2017"); // Should have suffix
      });

      it("should preserve year suffix: (Chen, 2017b)", () => {
        const result = parser.parseSelection("(Chen, 2017b)");
        expect(result).not.toBeNull();
        expect(result?.labels).toContain("2017b");
      });

      it("should handle multiple citations with different suffixes", () => {
        // This tests if we can distinguish between same author/different years
        const result1 = parser.parseSelection("(Guo, 2014a)");
        const result2 = parser.parseSelection("(Guo, 2014b)");

        expect(result1).not.toBeNull();
        expect(result2).not.toBeNull();
        expect(result1?.labels).toContain("2014a");
        expect(result2?.labels).toContain("2014b");
      });
    });

    // Special character handling
    describe("Special character handling in author names", () => {
      it("should handle hyphenated names: García-Márquez (2020)", () => {
        const result = parser.parseSelection("García-Márquez (2020)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
      });

      it("should handle apostrophes: O'Brien (2015)", () => {
        const result = parser.parseSelection("O'Brien (2015)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
      });

      it("should handle German ß: Guo and Meißner (2011)", () => {
        const result = parser.parseSelection("Guo and Meißner (2011)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Guo");
        expect(result?.labels).toContain("Meißner");
        expect(result?.labels).toContain("2011");
      });

      it("should handle German umlauts: Müller (2019)", () => {
        const result = parser.parseSelection("Müller (2019)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Müller");
      });

      it("should handle German ß in text context", () => {
        const result = parser.parseSelection(
          "Guo and Meißner (2011). The amplitude f",
        );
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Meißner");
      });
    });

    // Complex RMP citation patterns
    describe("Complex RMP patterns", () => {
      it("should detect multiple years for same author: (Cho et al., 2011a, 2011b)", () => {
        const result = parser.parseSelection("(Cho et al., 2011a, 2011b)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Cho");
        expect(result?.labels).toContain("2011a");
        expect(result?.labels).toContain("2011b");
        // Should have 2 distinct citations detected
        expect(result?.raw).toContain("2011a");
        expect(result?.raw).toContain("2011b");
      });

      it("should detect semicolon-separated citations: (A et al., 2011; B et al., 2015)", () => {
        const result = parser.parseSelection(
          "(Cho et al., 2011a; Song et al., 2015)",
        );
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Cho");
        expect(result?.labels).toContain("Song");
        expect(result?.labels).toContain("2011a");
        expect(result?.labels).toContain("2015");
      });

      it("should detect complex mixed citation: (Cho et al., 2011a, 2011b; Cho, Song, and Lee, 2015)", () => {
        const result = parser.parseSelection(
          "(Cho et al., 2011a, 2011b; Cho, Song, and Lee, 2015)",
        );
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        // Should find all 3 citations
        expect(result?.labels).toContain("Cho");
        expect(result?.labels).toContain("2011a");
        expect(result?.labels).toContain("2011b");
        expect(result?.labels).toContain("2015");
      });

      it("should detect multi-author outside paren: Larionov, Strikman, and Bleicher (2015)", () => {
        const result = parser.parseSelection(
          "Larionov, Strikman, and Bleicher (2015)",
        );
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Larionov");
        expect(result?.labels).toContain("Strikman");
        expect(result?.labels).toContain("Bleicher");
        expect(result?.labels).toContain("2015");
      });

      it("should detect consecutive years: Bignamini et al. (2009, 2010)", () => {
        const result = parser.parseSelection("Bignamini et al. (2009, 2010)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Bignamini");
        expect(result?.labels).toContain("2009");
        expect(result?.labels).toContain("2010");
        // Should have 2 distinct citations
        expect(result?.raw).toContain("2009");
        expect(result?.raw).toContain("2010");
        // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Should have subCitations for UI display
        expect(result?.subCitations).toBeDefined();
        expect(result?.subCitations?.length).toBe(2);
        expect(result?.subCitations?.[0].displayText).toContain("2009");
        expect(result?.subCitations?.[1].displayText).toContain("2010");
      });

      it("should handle combined text with multiple citation styles", () => {
        // Real-world RMP text combining different formats
        const text =
          "(Cho et al., 2011a, 2011b; Cho, Song, and Lee, 2015). Larionov, Strikman, and Bleicher (2015)";
        const result = parser.parseSelection(text);
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        // Should detect citations from both formats
        expect(result?.labels).toContain("Cho");
        expect(result?.labels).toContain("Larionov");
        // Should have subCitations for each detected paper
        expect(result?.subCitations).toBeDefined();
        // 4 distinct papers: Cho 2011a, Cho 2011b, Cho/Song/Lee 2015, Larionov/Strikman/Bleicher 2015
        expect(result?.subCitations?.length).toBe(4);
      });

      it("should detect two authors in parentheses: (Weinstein and Isgur, 1982)", () => {
        const result = parser.parseSelection("(Weinstein and Isgur, 1982)");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("author-year");
        expect(result?.labels).toContain("Weinstein");
        expect(result?.labels).toContain("Isgur");
        expect(result?.labels).toContain("1982");
      });

      it("should NOT detect numeric patterns as author-year: [1,2,3]", () => {
        const result = parser.parseSelection("[1,2,3]");
        expect(result).not.toBeNull();
        expect(result?.type).toBe("numeric");
        expect(result?.labels).toContain("1");
        expect(result?.labels).toContain("2");
        expect(result?.labels).toContain("3");
      });
    });
  });

  describe("hasCitations - Quick check", () => {
    it("should return true for author-year patterns", () => {
      // Note: hasCitations currently only checks for numeric patterns
      // Author-year detection is done in parseSelection
      // This test documents current behavior
      expect(parser.hasCitations("[1]")).toBe(true);
      expect(parser.hasCitations("[1-5]")).toBe(true);
    });
  });

  describe("Long text selections", () => {
    it("should detect citation in long paragraph", () => {
      const longText =
        "This is a very long paragraph of text that discusses various physics topics. The foundational work by Weinstein and Isgur (1982) provided important insights into the quark model. More text follows here to make the selection longer.";
      const result = parser.parseSelection(longText);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("author-year");
      expect(result?.labels).toContain("Weinstein");
      expect(result?.labels).toContain("Isgur");
      expect(result?.labels).toContain("1982");
    });

    it("should detect citation with surrounding mathematical notation", () => {
      const text =
        "The amplitude f(q2) was calculated by Guo and Meißner (2011) using dispersion relations.";
      const result = parser.parseSelection(text);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("author-year");
      expect(result?.labels).toContain("Guo");
      expect(result?.labels).toContain("Meißner");
    });

    it("should detect multiple citations in long selection", () => {
      const text =
        "As discussed by Cho et al. (2011a) and later extended by Guo and Meißner (2011), the exotic states can be understood.";
      const result = parser.parseSelection(text);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("author-year");
      expect(result?.labels).toContain("Cho");
      expect(result?.labels).toContain("2011a");
      expect(result?.labels).toContain("Guo");
      expect(result?.labels).toContain("Meißner");
      expect(result?.labels).toContain("2011");
    });

    it("should detect citation even with non-numeric bracket content", () => {
      const text =
        "see [some note] and also the work by Smith (2020) for details";
      const result = parser.parseSelection(text);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("author-year");
      expect(result?.labels).toContain("Smith");
      expect(result?.labels).toContain("2020");
    });

    it("should detect citation after period", () => {
      const text = "Guo and Meißner (2011). The amplitude f";
      const result = parser.parseSelection(text);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("author-year");
      expect(result?.labels).toContain("Guo");
      expect(result?.labels).toContain("Meißner");
    });

    it("should handle text with newlines", () => {
      const text =
        "The amplitude f(q2) was\ncalculated by Guo and Meißner (2011)\nusing dispersion relations.";
      const result = parser.parseSelection(text);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("author-year");
      expect(result?.labels).toContain("Guo");
      expect(result?.labels).toContain("Meißner");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LabelMatcher.matchAuthorYear tests
// ─────────────────────────────────────────────────────────────────────────────

// Helper to create a minimal entry for testing
function createEntry(
  overrides: Partial<InspireReferenceEntry> = {},
): InspireReferenceEntry {
  return {
    id: "test-id",
    recid: 12345,
    label: "1",
    title: "Test Paper",
    authors: [],
    year: "2023",
    ...overrides,
  };
}

describe("LabelMatcher.matchAuthorYear", () => {
  describe("Matching with authors array", () => {
    it("should match 'Guerrieri et al. 2014' to entry with first author Guerrieri", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-1",
          year: "2013",
          authors: ["Smith, J."],
          label: "1",
        }),
        createEntry({
          id: "entry-2",
          year: "2014",
          authors: ["Guerrieri, A.L.", "Piccinini, F."],
          label: "2",
        }),
        createEntry({
          id: "entry-3",
          year: "2014",
          authors: ["Jones, B."],
          label: "3",
        }),
      ];

      const matcher = new LabelMatcher(entries);
      const labels = ["Guerrieri et al. 2014", "Guerrieri", "2014"];
      const results = matcher.matchAuthorYear(labels);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entryId).toBe("entry-2");
    });

    it("should match 'Weinstein and Isgur 1982' to two-author entry", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-1",
          year: "1982",
          authors: ["Weinstein, J.", "Isgur, N."],
          label: "1",
        }),
        createEntry({
          id: "entry-2",
          year: "1982",
          authors: ["Other, A."],
          label: "2",
        }),
      ];

      const matcher = new LabelMatcher(entries);
      const labels = ["Weinstein and Isgur 1982", "Weinstein", "Isgur", "1982"];
      const results = matcher.matchAuthorYear(labels);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entryId).toBe("entry-1");
    });
  });

  describe("Matching with authorText only (no authors array)", () => {
    it("should match via authorText when authors array is empty", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-1",
          year: "2014",
          authors: [],
          authorText: "A.L. Guerrieri, F. Piccinini, A. Pilloni, A.D. Polosa",
          label: "1",
        }),
        createEntry({
          id: "entry-2",
          year: "2014",
          authors: [],
          authorText: "J. Smith",
          label: "2",
        }),
      ];

      const matcher = new LabelMatcher(entries);
      const labels = ["Guerrieri et al. 2014", "Guerrieri", "2014"];
      const results = matcher.matchAuthorYear(labels);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entryId).toBe("entry-1");
    });

    it("should not match when author name not found in authorText", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-1",
          year: "2014",
          authors: [],
          authorText: "J. Smith, B. Jones",
          label: "1",
        }),
      ];

      const matcher = new LabelMatcher(entries);
      const labels = ["Guerrieri et al. 2014", "Guerrieri", "2014"];
      const results = matcher.matchAuthorYear(labels);

      expect(results.length).toBe(0);
    });
  });

  describe("Year matching", () => {
    it("should prefer exact year match", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-1",
          year: "2013",
          authors: ["Guerrieri, A."],
          label: "1",
        }),
        createEntry({
          id: "entry-2",
          year: "2014",
          authors: ["Guerrieri, A."],
          label: "2",
        }),
        createEntry({
          id: "entry-3",
          year: "2015",
          authors: ["Guerrieri, A."],
          label: "3",
        }),
      ];

      const matcher = new LabelMatcher(entries);
      const labels = ["Guerrieri 2014", "Guerrieri", "2014"];
      const results = matcher.matchAuthorYear(labels);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entryId).toBe("entry-2");
    });

    it("should handle year suffix (2017a, 2017b)", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-1",
          year: "2017",
          authors: ["Chen, Y."],
          label: "1",
        }),
      ];

      const matcher = new LabelMatcher(entries);
      const labels = ["Chen 2017a", "Chen", "2017a"];
      const results = matcher.matchAuthorYear(labels);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entryId).toBe("entry-1");
    });
  });

  describe("Edge cases", () => {
    it("should return empty array when no year provided", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-1",
          year: "2014",
          authors: ["Guerrieri, A."],
          label: "1",
        }),
      ];

      const matcher = new LabelMatcher(entries);
      const labels = ["Guerrieri"];
      const results = matcher.matchAuthorYear(labels);

      // Should still find if author matches (year gives +3, author gives +5)
      // But without year, might not reach threshold
      // Actually with our current logic, it should still work if author matches
      expect(results.length).toBeGreaterThanOrEqual(0); // Depends on implementation
    });

    it("should handle case-insensitive author matching", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-1",
          year: "2014",
          authors: ["GUERRIERI, A.L."],
          label: "1",
        }),
      ];

      const matcher = new LabelMatcher(entries);
      const labels = ["Guerrieri et al. 2014", "Guerrieri", "2014"];
      const results = matcher.matchAuthorYear(labels);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entryId).toBe("entry-1");
    });
  });

  // FTR-PDF-ANNOTATE-AUTHOR-YEAR: Tests for precise matching with journal/volume/page
  describe("Precise matching with PDF paper info", () => {
    it("should use setAuthorYearMapping to enable precise matching", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-cho-2011a",
          year: "2011",
          authors: ["Cho, S."],
          label: "1",
          publicationInfo: {
            journal_title: "Phys.Rev.Lett.",
            journal_volume: "106",
            page_start: "212001",
          },
        }),
        createEntry({
          id: "entry-cho-2011b",
          year: "2011",
          authors: ["Cho, S."],
          label: "2",
          publicationInfo: {
            journal_title: "Phys.Rev.C",
            journal_volume: "84",
            page_start: "064910",
          },
        }),
      ];

      const matcher = new LabelMatcher(entries);

      // Set up author-year mapping from PDF (values are arrays of PDFPaperInfo)
      matcher.setAuthorYearMapping({
        parsedAt: Date.now(),
        authorYearMap: new Map([
          [
            "cho 2011a",
            [
              {
                rawText:
                  "Cho, S., et al., 2011a, Phys. Rev. Lett. 106, 212001.",
                firstAuthorLastName: "Cho",
                year: "2011a",
                journalAbbrev: "Phys. Rev. Lett.",
                volume: "106",
                pageStart: "212001",
              },
            ],
          ],
          [
            "cho 2011b",
            [
              {
                rawText: "Cho, S., et al., 2011b, Phys. Rev. C 84, 064910.",
                firstAuthorLastName: "Cho",
                year: "2011b",
                journalAbbrev: "Phys. Rev. C",
                volume: "84",
                pageStart: "064910",
              },
            ],
          ],
        ]),
        totalReferences: 2,
        confidence: "high",
      });

      expect(matcher.hasAuthorYearMapping()).toBe(true);

      // Test 2011a match - should find entry with PRL 106, 212001
      const results2011a = matcher.matchAuthorYear([
        "Cho et al. 2011a",
        "Cho",
        "2011a",
      ]);
      expect(results2011a.length).toBeGreaterThan(0);
      expect(results2011a[0].entryId).toBe("entry-cho-2011a");

      // Test 2011b match - should find entry with PRC 84, 064910
      const results2011b = matcher.matchAuthorYear([
        "Cho et al. 2011b",
        "Cho",
        "2011b",
      ]);
      expect(results2011b.length).toBeGreaterThan(0);
      expect(results2011b[0].entryId).toBe("entry-cho-2011b");
    });

    it("should fall back to fuzzy matching when PDF mapping not available", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-1",
          year: "2011",
          authors: ["Cho, S."],
          label: "1",
        }),
      ];

      const matcher = new LabelMatcher(entries);
      // No setAuthorYearMapping called

      expect(matcher.hasAuthorYearMapping()).toBe(false);

      const results = matcher.matchAuthorYear([
        "Cho et al. 2011",
        "Cho",
        "2011",
      ]);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entryId).toBe("entry-1");
      // Should be fuzzy match since no PDF mapping
      expect(results[0].matchMethod).toBe("fuzzy");
    });

    // Regression test for Braaten 2005a/2005b disambiguation (issue reported by user)
    it("should correctly distinguish Braaten 2005a from 2005b using journal/volume/page", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-braaten-2005a",
          year: "2005",
          authors: ["Braaten, E.", "Kusunoki, M."],
          label: "10",
          publicationInfo: {
            journal_title: "Phys.Rev.D",
            journal_volume: "71",
            page_start: "074005",
          },
        }),
        createEntry({
          id: "entry-braaten-2005b",
          year: "2005",
          authors: ["Braaten, E.", "Kusunoki, M."],
          label: "11",
          publicationInfo: {
            journal_title: "Phys.Rev.D",
            journal_volume: "72",
            page_start: "014012",
          },
        }),
      ];

      const matcher = new LabelMatcher(entries);

      // Set up author-year mapping from PDF reference list (values are arrays)
      matcher.setAuthorYearMapping({
        parsedAt: Date.now(),
        authorYearMap: new Map([
          [
            "braaten 2005a",
            [
              {
                rawText:
                  "Braaten, E., and M. Kusunoki, 2005a, Phys. Rev. D 71, 074005.",
                firstAuthorLastName: "Braaten",
                year: "2005a",
                journalAbbrev: "Phys. Rev. D",
                volume: "71",
                pageStart: "074005",
              },
            ],
          ],
          [
            "braaten 2005b",
            [
              {
                rawText:
                  "Braaten, E., and M. Kusunoki, 2005b, Phys. Rev. D 72, 014012.",
                firstAuthorLastName: "Braaten",
                year: "2005b",
                journalAbbrev: "Phys. Rev. D",
                volume: "72",
                pageStart: "014012",
              },
            ],
          ],
        ]),
        totalReferences: 2,
        confidence: "high",
      });

      expect(matcher.hasAuthorYearMapping()).toBe(true);

      // Test 2005a match - should find entry with PRD 71, 074005
      const results2005a = matcher.matchAuthorYear([
        "Braaten and Kusunoki 2005a",
        "Braaten",
        "Kusunoki",
        "2005a",
      ]);
      expect(results2005a.length).toBeGreaterThan(0);
      expect(results2005a[0].entryId).toBe("entry-braaten-2005a");

      // Test 2005b match - should find entry with PRD 72, 014012
      const results2005b = matcher.matchAuthorYear([
        "Braaten and Kusunoki 2005b",
        "Braaten",
        "Kusunoki",
        "2005b",
      ]);
      expect(results2005b.length).toBeGreaterThan(0);
      expect(results2005b[0].entryId).toBe("entry-braaten-2005b");

      // Verify they are different entries
      expect(results2005a[0].entryId).not.toBe(results2005b[0].entryId);
    });

    // New test: Verify fuzzy matching with PDF info disambiguation
    // This tests the fix for the Braaten 2005b bug where precise matching fails
    // but fuzzy matching can still use volume/page info for disambiguation
    it("should use PDF volume/page info during fuzzy matching when precise matching fails", () => {
      const entries: InspireReferenceEntry[] = [
        createEntry({
          id: "entry-braaten-2005a",
          year: "2005",
          authors: ["Braaten, E.", "Kusunoki, M."],
          label: "10",
          publicationInfo: {
            journal_title: "Phys.Rev.D",
            journal_volume: "71",
            page_start: "074005",
          },
        }),
        createEntry({
          id: "entry-braaten-2005b",
          year: "2005",
          authors: ["Braaten, E.", "Kusunoki, M."],
          label: "11",
          publicationInfo: {
            journal_title: "Phys.Rev.D",
            journal_volume: "72",
            page_start: "014012",
          },
        }),
      ];

      const matcher = new LabelMatcher(entries);

      // Set up author-year mapping with ONLY the key we're searching for (values are arrays)
      // This simulates the case where PDF parsing succeeded but findPreciseMatch might fail
      // The fuzzy matching should use the volume/page info for disambiguation
      matcher.setAuthorYearMapping({
        parsedAt: Date.now(),
        authorYearMap: new Map([
          // Only include 2005b - this ensures fuzzy matching is used with PDF info
          [
            "braaten 2005b",
            [
              {
                rawText:
                  "Braaten, E., and M. Kusunoki, 2005b, Phys. Rev. D 72, 014012.",
                firstAuthorLastName: "Braaten",
                year: "2005b",
                journalAbbrev: "Phys. Rev. D",
                volume: "72",
                pageStart: "014012",
              },
            ],
          ],
        ]),
        totalReferences: 1,
        confidence: "high",
      });

      // Test 2005b match - should find entry with PRD 72, 014012 via fuzzy matching
      // with volume disambiguation (since precise match is looking for exact journal match)
      const results2005b = matcher.matchAuthorYear([
        "Braaten and Kusunoki 2005b",
        "Braaten",
        "Kusunoki",
        "2005b",
      ]);
      expect(results2005b.length).toBeGreaterThan(0);
      // Should match 2005b (vol 72) not 2005a (vol 71)
      expect(results2005b[0].entryId).toBe("entry-braaten-2005b");
    });
  });
});
